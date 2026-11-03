/**
 * Email Warmup Tick Edge Function
 *
 * Cron (every hour): advances warmup day, updates daily_limit per warmup ramp
 * schedule, auto-promotes to 'ready' when the ramp completes, and releases
 * mailboxes whose pause has expired or is no longer a reason we act on.
 *
 * Deliberately does NOT pause on bounce rate. Bounce rate describes the LIST,
 * not the mailbox — see `sequence-bounce-guard`, which pauses the sequence.
 * The only reputation signal that stops a mailbox here is spam complaints.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  calculateWarmupDay,
  getDailyLimitWithConfig,
  getWarmupCompletionDay,
  isValidSendDay,
  MIN_SENDS_FOR_REPUTATION_ACTION,
  shouldPromoteToReady,
} from '../_shared/email-warmup.ts';
import type { MailboxWarmupConfig } from '../_shared/email-warmup.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * A circuit-breaker pause is a COOLDOWN, not a death sentence. Consecutive
 * errors only reset on a successful send, and a paused mailbox never sends, so
 * without an expiry the pause could never lift on its own.
 */
const CIRCUIT_BREAKER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Pause reasons a human owns. The tick never releases these — the operator
 * paused it, or another control owns the pause.
 */
const OPERATOR_OWNED_PAUSE_REASONS = new Set([
  'manual',
  'domain_not_sendable',
  'domain_paused',
  'spam_complaints',
  // Owned by infra-mailbox-capability-probe, which releases it once Microsoft
  // confirms the tenant can send again. Health stats say nothing about consent.
  'tenant_mail_send_missing',
  // Microsoft fails ALL outbound mail from the tenant (verified by message trace
  // across every domain on it) while inbound still works. That tenant cannot
  // send again — it gets replaced, not waited out.
  'tenant_outbound_blocked',
  // Owned by infra-domain-move for the duration of a move between tenants.
  'domain_moving',
]);

/** Key-scoped metadata write; never read-modify-write the whole blob. */
async function patchMailboxMetadata(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  mailboxId: string,
  set: Record<string, unknown>,
  unset: string[] = []
) {
  const { error } = await supabase.rpc('apply_mailbox_metadata_patch', {
    p_id: mailboxId,
    p_set: set,
    p_unset: unset,
  });
  if (error) {
    console.warn(`[Warmup Tick] metadata patch failed for ${mailboxId}: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[Warmup Tick] Starting warmup tick...');

    // Reset daily counters for all mailboxes where reset date is before today
    const today = new Date().toISOString().split('T')[0];
    const { data: resetMailboxes } = await supabase
      .from('email_mailboxes')
      .update({
        daily_sent: 0,
        daily_sent_reset_at: today,
        updated_at: new Date().toISOString(),
      })
      .lt('daily_sent_reset_at', today)
      .select('id');

    if (resetMailboxes && resetMailboxes.length > 0) {
      console.log(`[Warmup Tick] Reset daily counters for ${resetMailboxes.length} mailboxes`);
    }

    // Fetch all warming mailboxes (including warmup config columns)
    const { data: warmingMailboxes, error: fetchError } = await supabase
      .from('email_mailboxes')
      .select('id, organization_id, email_address, warmup_start_date, warmup_day, daily_limit, bounce_rate, health_score, status, warmup_max_daily, warmup_daily_rampup, warmup_weekdays_only, warmup_randomize, warmup_randomize_range')
      .eq('status', 'warming');

    if (fetchError) {
      throw new Error(`Failed to fetch warming mailboxes: ${fetchError.message}`);
    }

    if (!warmingMailboxes || warmingMailboxes.length === 0) {
      console.log('[Warmup Tick] No warming mailboxes found');
      return new Response(
        JSON.stringify({ success: true, processed: 0, promoted: 0, paused: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch org timezones for timezone-aware weekend detection
    const orgIds = [...new Set(warmingMailboxes.map((m) => m.organization_id))];
    const { data: orgSettings } = await supabase
      .from('organization_channel_limits')
      .select('organization_id, timezone')
      .in('organization_id', orgIds);
    const orgTimezoneMap = new Map(
      orgSettings?.map((s) => [s.organization_id, s.timezone || 'UTC']) || []
    );

    console.log(`[Warmup Tick] Processing ${warmingMailboxes.length} warming mailboxes`);

    let processedCount = 0;
    let promotedCount = 0;

    for (const mailbox of warmingMailboxes) {
      try {
        // Build per-mailbox config if custom values are present
        const config: MailboxWarmupConfig | null = mailbox.warmup_max_daily != null
          ? {
              warmup_max_daily: mailbox.warmup_max_daily,
              warmup_daily_rampup: mailbox.warmup_daily_rampup ?? 5,
              warmup_weekdays_only: mailbox.warmup_weekdays_only ?? true,
              warmup_randomize: mailbox.warmup_randomize ?? false,
              warmup_randomize_range: mailbox.warmup_randomize_range ?? 3,
            }
          : null;

        // Skip weekends when configured (timezone-aware)
        // Read weekdays_only from config or directly from mailbox row (default true)
        const orgTimezone = orgTimezoneMap.get(mailbox.organization_id) || 'UTC';
        const weekdaysOnly = config?.warmup_weekdays_only ?? mailbox.warmup_weekdays_only ?? true;
        if (weekdaysOnly && !isValidSendDay(true, orgTimezone)) {
          console.log(`[Warmup Tick] Skipping ${mailbox.email_address}: weekdays only`);
          continue;
        }

        // Guard: if warming but no start date, set it now so ramp is predictable
        if (!mailbox.warmup_start_date) {
          console.log(`[Warmup Tick] Setting warmup_start_date for ${mailbox.email_address} (was missing)`);
          mailbox.warmup_start_date = new Date().toISOString();
        }

        // Calculate current warmup day
        const warmupDay = calculateWarmupDay(mailbox.warmup_start_date);

        const dailyLimit = getDailyLimitWithConfig(warmupDay, config);
        const bounceRate = mailbox.bounce_rate || 0;
        const healthScore = mailbox.health_score || 1.0;

        // NOTE: warmup_day is NOT written here. Since
        // 20260803120000_mailbox_warmup_engine.sql it means "distinct days with
        // a confirmed-delivered warmup send" and is maintained by
        // trg_warmup_send_rollup. Writing calendar days over it is what made the
        // old warmup_day fiction (mailboxes reporting day 48 with zero sends).
        // `warmupDay` below is still used locally to pace the daily_limit ramp.
        const update: Record<string, any> = {
          daily_limit: dailyLimit,
          warmup_start_date: mailbox.warmup_start_date,
          updated_at: new Date().toISOString(),
        };

        // NO bounce-based auto-pause here. It used to fire at bounce_rate >= 5%
        // computed over LIFETIME sends, so a mailbox whose first cold send hit a
        // dead address sat at 100% and was paused forever (9 mailboxes in prod
        // were paused on a denominator of exactly 1). Bounce rate belongs to the
        // list; `sequence-bounce-guard` pauses the sequence instead.
        //
        // Check if should promote to ready (using config-aware completion day)
        // Same denominator email-rotation uses for bounce_rate, so the sample-size
        // gate in shouldPromoteToReady judges the number it was computed from.
        let sentCount = 0;
        if (warmupDay >= getWarmupCompletionDay(config) && bounceRate > 0) {
          const { count } = await supabase
            .from('email_send_log')
            .select('id', { count: 'exact', head: true })
            .eq('mailbox_id', mailbox.id)
            .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced']);
          sentCount = count ?? 0;
        }

        if (warmupDay >= getWarmupCompletionDay(config) && shouldPromoteToReady(warmupDay, bounceRate, healthScore, sentCount)) {
          update.status = 'ready';
          // Reset daily_limit to production level after warmup completes
          update.daily_limit = mailbox.warmup_max_daily || 50;
          promotedCount++;
          console.log(`[Warmup Tick] Promoted ${mailbox.email_address} to ready (day ${warmupDay}, daily_limit: ${update.daily_limit})`);
        }

        await supabase
          .from('email_mailboxes')
          .update(update)
          .eq('id', mailbox.id);

        processedCount++;
      } catch (error) {
        console.error(`[Warmup Tick] Error processing ${mailbox.email_address}:`, error);
      }
    }

    console.log(`[Warmup Tick] Complete: ${processedCount} processed, ${promotedCount} promoted`);

    // ================================================================
    // Phase 2: Health score recalculation for ALL active mailboxes
    // (not just warming — ready/paused mailboxes need ongoing monitoring)
    // ================================================================
    let healthUpdated = 0;
    let releasedCount = 0;

    const { data: activeMailboxes } = await supabase
      .from('email_mailboxes')
      .select('id, status, bounce_rate, spam_rate, reply_rate, health_score, daily_limit, sending_domain_id, metadata, warmup_enabled, warmup_day')
      .in('status', ['ready', 'paused']);

    if (activeMailboxes?.length) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const sinceDate = thirtyDaysAgo.toISOString().split('T')[0];

      for (const mb of activeMailboxes) {
        try {
          const { data: stats } = await supabase
            .from('email_mailbox_daily_stats')
            .select('sent, bounced, spam_complaints, replied')
            .eq('mailbox_id', mb.id)
            .gte('stat_date', sinceDate);

          const totals = (stats ?? []).reduce(
            (acc: Record<string, number>, row: Record<string, number>) => {
              acc.sent += row.sent || 0;
              acc.bounced += row.bounced || 0;
              acc.spam += row.spam_complaints || 0;
              acc.replied += row.replied || 0;
              return acc;
            },
            { sent: 0, bounced: 0, spam: 0, replied: 0 }
          );

          const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

          // Metrics are only meaningful with sends behind them. A mailbox with
          // an empty window still falls through to the release check below —
          // that skip is exactly what made an auto-pause permanent, because a
          // paused mailbox sends nothing and its stats age out of the window.
          let spamRate = 0;
          if (totals.sent > 0) {
            const bounceRate = totals.bounced / totals.sent;
            spamRate = totals.spam / totals.sent;
            const replyRate = totals.replied / totals.sent;
            const healthScore = Math.max(0, Math.min(1, 1.0 - bounceRate * 5 - spamRate * 10));

            update.bounce_rate = Math.round(bounceRate * 10000) / 10000;
            update.spam_rate = Math.round(spamRate * 10000) / 10000;
            update.reply_rate = Math.round(replyRate * 10000) / 10000;
            update.health_score = Math.round(healthScore * 100) / 100;
          }

          const meta = (mb.metadata ?? {}) as Record<string, unknown>;
          const pausedReason = typeof meta.paused_reason === 'string' ? meta.paused_reason : null;

          // Auto-burn on SPAM COMPLAINTS only. A spam complaint is the
          // recipient's provider judging THIS sender, so the mailbox is the
          // right object to stop. Bounces are not used: they describe the list,
          // and a bad list would otherwise burn every mailbox it touched.
          if (
            mb.status === 'ready' &&
            spamRate >= 0.05 &&
            totals.sent >= MIN_SENDS_FOR_REPUTATION_ACTION
          ) {
            update.status = 'burned';
            update.last_error = `Auto-burned: spam complaints ${(spamRate * 100).toFixed(1)}% over ${totals.sent} sends`;
            await patchMailboxMetadata(supabase, mb.id, {
              paused_reason: 'spam_complaints',
              paused_at: new Date().toISOString(),
              paused_stats: { sent: totals.sent, spam: totals.spam, spam_rate: spamRate },
            });
            console.log(`[Warmup Tick] Auto-burned ${mb.id}: spam=${(spamRate * 100).toFixed(1)}% over ${totals.sent} sends`);
          }
          // Release: get the mailbox back in the pool unless a human owns the
          // pause or the domain is the thing that's broken. Runs whether or not
          // the mailbox has recent stats, so a pause can always expire.
          else if (mb.status === 'paused' && !OPERATOR_OWNED_PAUSE_REASONS.has(pausedReason ?? '')) {
            // A circuit-breaker pause only lifts once its cooldown has elapsed.
            let cooldownElapsed = true;
            if (pausedReason === 'circuit_breaker') {
              const pausedAt = typeof meta.paused_at === 'string' ? Date.parse(meta.paused_at) : NaN;
              cooldownElapsed =
                !Number.isFinite(pausedAt) || Date.now() - pausedAt >= CIRCUIT_BREAKER_COOLDOWN_MS;
            }

            // Never release onto a domain that isn't sendable.
            let domainOk = true;
            if (mb.sending_domain_id) {
              const { data: sendable, error: sendabilityError } = await supabase.rpc(
                'is_sending_domain_sendable',
                { p_domain_id: mb.sending_domain_id },
              );
              domainOk = !sendabilityError && sendable === true;
              if (sendabilityError) {
                console.warn(`[Warmup Tick] Sendability lookup failed for ${mb.sending_domain_id}: ${sendabilityError.message}; keeping mailbox paused`);
              }
            }

            // A live spam problem still holds it, at a meaningful denominator.
            const spamClean =
              spamRate < 0.05 || totals.sent < MIN_SENDS_FOR_REPUTATION_ACTION;

            if (cooldownElapsed && domainOk && spamClean) {
              update.status = 'ready';
              update.last_error = null;
              await patchMailboxMetadata(
                supabase,
                mb.id,
                { released_at: new Date().toISOString(), released_from: pausedReason ?? 'unspecified' },
                ['paused_reason', 'paused_at', 'paused_stats', 'bounce_spike_stats', 'consecutive_errors']
              );
              releasedCount++;
              console.log(`[Warmup Tick] Released ${mb.id} (was: ${pausedReason ?? 'unspecified'})`);
            }
          }

          await supabase.from('email_mailboxes').update(update).eq('id', mb.id);
          healthUpdated++;
        } catch (err) {
          console.error(`[Warmup Tick] Health check failed for mailbox ${mb.id}:`, err);
        }
      }
    }

    console.log(`[Warmup Tick] Health updated for ${healthUpdated} active mailboxes, ${releasedCount} released`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: processedCount,
        promoted: promotedCount,
        released: releasedCount,
        healthUpdated,
        dailyCountersReset: resetMailboxes?.length || 0,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Warmup Tick] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
