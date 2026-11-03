/**
 * Email Stats Aggregate Edge Function
 *
 * Cron (daily): rolls up email_send_log into email_mailbox_daily_stats
 * and updates mailbox-level aggregate metrics (bounce_rate, reply_rate, spam_rate).
 *
 * Uses unique-lead counting (Smartlead/Instantly model):
 * - "sent" = unique leads emailed per mailbox per day
 * - "opened" = unique leads who opened at least one email
 * - Rates are per-unique-lead, not per individual email
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Status rank for determining "best" engagement per lead
const STATUS_RANK: Record<string, number> = {
  sent: 1, sending: 1, delivered: 2, opened: 3, clicked: 4, replied: 5, bounced: 0, spam: -1,
};

const EXCLUDED_STATUSES = ['filtered', 'queued', 'failed', 'skipped'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[Stats Aggregate] Starting daily aggregation...');

    // Aggregate yesterday's stats by default, or accept a date param
    let targetDate: string;
    try {
      const body = await req.json();
      targetDate = body.date || getYesterdayDate();
    } catch {
      targetDate = getYesterdayDate();
    }

    console.log(`[Stats Aggregate] Aggregating for date: ${targetDate}`);

    // Get all sends on the target date (include lead_id for unique-lead counting)
    const { data: mailboxSends, error: queryError } = await supabase
      .from('email_send_log')
      .select('mailbox_id, status, lead_id')
      .gte('sent_at', `${targetDate}T00:00:00Z`)
      .lt('sent_at', `${targetDate}T23:59:59.999Z`);

    if (queryError) {
      throw new Error(`Failed to query send_log: ${queryError.message}`);
    }

    if (!mailboxSends || mailboxSends.length === 0) {
      console.log('[Stats Aggregate] No sends found for target date');
      return new Response(
        JSON.stringify({ success: true, mailboxesProcessed: 0, statsRows: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Group by mailbox_id → lead_id, keep best status per lead per mailbox
    const mailboxLeadMap: Record<string, Map<string, string>> = {};
    let totalRows = 0;

    for (const send of mailboxSends) {
      if (!send.mailbox_id) continue;
      if (EXCLUDED_STATUSES.includes(send.status)) continue;
      totalRows++;

      if (!mailboxLeadMap[send.mailbox_id]) {
        mailboxLeadMap[send.mailbox_id] = new Map();
      }

      const leadKey = send.lead_id || `_row_${totalRows}`;
      const prev = mailboxLeadMap[send.mailbox_id].get(leadKey);
      if (!prev || (STATUS_RANK[send.status] ?? -1) > (STATUS_RANK[prev] ?? -1)) {
        mailboxLeadMap[send.mailbox_id].set(leadKey, send.status);
      }
    }

    // Count per-mailbox stats from deduplicated lead statuses
    const mailboxGroups: Record<string, Record<string, number>> = {};

    for (const [mbId, leadMap] of Object.entries(mailboxLeadMap)) {
      const stats = {
        sent: 0,
        delivered: 0,
        opened: 0,
        clicked: 0,
        replied: 0,
        bounced: 0,
        spam_complaints: 0,
      };

      for (const status of leadMap.values()) {
        stats.sent++; // unique leads emailed
        switch (status) {
          case 'sent':
          case 'sending':
          case 'delivered':
            stats.delivered++;
            break;
          case 'opened':
            stats.delivered++;
            stats.opened++;
            break;
          case 'clicked':
            stats.delivered++;
            stats.opened++;
            stats.clicked++;
            break;
          case 'replied':
            stats.delivered++;
            stats.replied++;
            break;
          case 'bounced':
            stats.bounced++;
            break;
          case 'spam':
            stats.spam_complaints++;
            break;
        }
      }

      mailboxGroups[mbId] = stats;
    }

    // Upsert stats into email_mailbox_daily_stats
    const mailboxIds = Object.keys(mailboxGroups);
    let statsRowCount = 0;

    for (const mailboxId of mailboxIds) {
      const stats = mailboxGroups[mailboxId];

      const { error: upsertError } = await supabase
        .from('email_mailbox_daily_stats')
        .upsert({
          mailbox_id: mailboxId,
          stat_date: targetDate,
          ...stats,
        }, {
          onConflict: 'mailbox_id,stat_date',
        });

      if (upsertError) {
        console.error(`[Stats Aggregate] Failed to upsert stats for mailbox ${mailboxId}:`, upsertError.message);
        continue;
      }

      statsRowCount++;
    }

    console.log(`[Stats Aggregate] Upserted ${statsRowCount} daily stat rows`);

    // Update aggregate metrics on each mailbox from recent history (last 30 days)
    let metricsUpdated = 0;

    for (const mailboxId of mailboxIds) {
      try {
        await updateMailboxAggregateMetrics(supabase, mailboxId);
        metricsUpdated++;
      } catch (error) {
        console.error(`[Stats Aggregate] Failed to update metrics for mailbox ${mailboxId}:`, error);
      }
    }

    console.log(`[Stats Aggregate] Updated aggregate metrics for ${metricsUpdated} mailboxes`);

    // ========================================
    // A/B Variant Stats Aggregation
    // Recalculate variant stats from email_send_log as a safety net
    // (primary tracking is via trigger + real-time increment)
    // Uses unique-lead counting per variant
    // ========================================
    let variantsUpdated = 0;
    try {
      const { data: variantRows } = await supabase
        .from('email_ab_variants')
        .select('id, sequence_id, step_index');

      if (variantRows && variantRows.length > 0) {
        for (const variant of variantRows) {
          const { data: logs } = await supabase
            .from('email_send_log')
            .select('status, lead_id')
            .eq('variant_id', variant.id)
            .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced']);

          if (!logs || logs.length === 0) continue;

          // Group by lead_id, keep best status per lead
          const leadBest = new Map<string, string>();
          for (const log of logs) {
            const key = log.lead_id || `_row_${Math.random()}`;
            const prev = leadBest.get(key);
            if (!prev || (STATUS_RANK[log.status] ?? -1) > (STATUS_RANK[prev] ?? -1)) {
              leadBest.set(key, log.status);
            }
          }

          const stats = { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
          for (const status of leadBest.values()) {
            stats.sent++;
            switch (status) {
              case 'opened':
                stats.opened++;
                break;
              case 'clicked':
                stats.opened++;
                stats.clicked++;
                break;
              case 'replied':
                stats.replied++;
                break;
              case 'bounced':
                stats.bounced++;
                break;
            }
          }

          await supabase
            .from('email_ab_variants')
            .update(stats)
            .eq('id', variant.id);

          variantsUpdated++;
        }
      }
      console.log(`[Stats Aggregate] Updated stats for ${variantsUpdated} A/B variants`);
    } catch (variantError) {
      console.error('[Stats Aggregate] Failed to update variant stats:', variantError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: targetDate,
        mailboxesProcessed: mailboxIds.length,
        statsRows: statsRowCount,
        metricsUpdated,
        variantsUpdated,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Stats Aggregate] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Get yesterday's date as YYYY-MM-DD string.
 */
function getYesterdayDate(): string {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toISOString().split('T')[0];
}

/**
 * Update mailbox-level aggregate metrics from the last 30 days of daily stats.
 */
async function updateMailboxAggregateMetrics(supabase: any, mailboxId: string): Promise<void> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceDate = thirtyDaysAgo.toISOString().split('T')[0];

  const { data: stats, error } = await supabase
    .from('email_mailbox_daily_stats')
    .select('sent, delivered, opened, clicked, replied, bounced, spam_complaints')
    .eq('mailbox_id', mailboxId)
    .gte('stat_date', sinceDate);

  if (error || !stats || stats.length === 0) return;

  // Aggregate totals
  const totals = stats.reduce(
    (acc: any, row: any) => {
      acc.sent += row.sent || 0;
      acc.delivered += row.delivered || 0;
      acc.opened += row.opened || 0;
      acc.clicked += row.clicked || 0;
      acc.replied += row.replied || 0;
      acc.bounced += row.bounced || 0;
      acc.spam += row.spam_complaints || 0;
      return acc;
    },
    { sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, bounced: 0, spam: 0 }
  );

  if (totals.sent === 0) return;

  // Calculate rates
  const bounceRate = totals.bounced / totals.sent;
  const replyRate = totals.replied / totals.sent;
  const spamRate = totals.spam / totals.sent;

  // Health score: starts at 1.0, penalized by bounces and spam
  const healthScore = Math.max(0, Math.min(1, 1.0 - bounceRate * 5 - spamRate * 10));

  await supabase
    .from('email_mailboxes')
    .update({
      bounce_rate: Math.round(bounceRate * 10000) / 10000,
      reply_rate: Math.round(replyRate * 10000) / 10000,
      spam_rate: Math.round(spamRate * 10000) / 10000,
      health_score: Math.round(healthScore * 100) / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', mailboxId);
}
