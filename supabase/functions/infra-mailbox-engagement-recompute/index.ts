/**
 * Mailbox Engagement Recompute — Phase 8.4.1.
 *
 * Daily cron (04:31 UTC) computes an engagement score per mailbox over the
 * last 50 sends and uses it to modulate daily_limit:
 *
 *   score = (replies * 5 + opens) / max(sent, 1)
 *
 *   score < 0.02 over 100+ sends  → daily_limit to a quarter of baseline (floor)
 *   score < 0.05 over 50+ sends   → halve daily_limit (cool the mailbox)
 *   score > 0.10                  → +25% over warmup curve (let hot mailboxes run)
 *   else                          → reset to baseline
 *
 * This function never changes `status`. Engagement reflects the list and the
 * copy, not the inbox — pausing mailboxes for it took healthy infrastructure
 * offline one row at a time while the offending list kept sending
 * (2026-09-16).
 *
 * v2 (2026-04-30): rewritten to use a single bucketed SQL aggregation
 * per-batch instead of N+1 per-mailbox queries. The previous loop timed
 * out at ~600 mailboxes; the bucketed version handles thousands.
 *
 * Body (optional):
 *   {
 *     mailbox_ids?: uuid[]   // scope recompute to specific mailboxes (smoke test)
 *     batch_size?: number    // mailboxes per aggregation call, default 200
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const WINDOW_SIZE = 50;
const PAUSE_THRESHOLD_SCORE = 0.02;
const PAUSE_THRESHOLD_SENT = 100;
const COOL_THRESHOLD_SCORE = 0.05;
const COOL_THRESHOLD_SENT = 50;
const HOT_THRESHOLD_SCORE = 0.10;

interface MailboxRow {
  id: string;
  organization_id: string;
  email_address: string;
  status: string;
  daily_limit: number;
  daily_limit_baseline: number | null;
  warmup_max_daily: number | null;
}

interface AggregateRow {
  mailbox_id: string;
  sent: number;
  opens: number;
  clicks: number;
  replies: number;
  unsubscribes: number;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Only caller is the engagement-recompute cron, which sends the service-role key.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  // Body is optional — let the cron call with no body, allow targeted runs from tests.
  let body: { mailbox_ids?: string[]; batch_size?: number } = {};
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json();
  } catch { /* empty body is fine */ }
  const scopeIds = body.mailbox_ids;
  const batchSize = Math.min(Math.max(body.batch_size ?? 200, 50), 500);

  const startedAt = Date.now();

  // 1) List target mailboxes.
  let mailboxQuery = supabase
    .from('email_mailboxes')
    .select('id, organization_id, email_address, status, daily_limit, daily_limit_baseline, warmup_max_daily')
    .in('status', ['ready', 'paused'])
    .limit(5000);
  if (scopeIds && scopeIds.length > 0) {
    mailboxQuery = mailboxQuery.in('id', scopeIds);
  }
  const { data: mailboxes, error: mboxErr } = await mailboxQuery;
  if (mboxErr) return jsonResponse({ success: false, error: mboxErr.message }, 500);
  const mboxList = (mailboxes ?? []) as MailboxRow[];

  // 2) For each batch, aggregate the last WINDOW_SIZE sends per mailbox.
  // We use a window-function approach: pull recent rows, rank within mailbox,
  // bucket by mailbox_id. One query per batch, O(batch * 50) rows returned.
  const updates: Array<{ id: string; score: number; sent: number; total30d: number; daily_limit: number; status: string; reason: string }> = [];
  const now = new Date();
  const nowIso = now.toISOString();

  for (let i = 0; i < mboxList.length; i += batchSize) {
    const batch = mboxList.slice(i, i + batchSize);
    const batchIds = batch.map((m) => m.id);

    // Two queries per batch:
    //   (a) recent logs (ordered desc) for the engagement window — used for score
    //   (b) head-count-style total sends for the PAUSE threshold (must reach 100+)
    // (b) is needed because the score window caps at WINDOW_SIZE=50 sends, so the
    //     windowed `sent` count would never reach the pause threshold otherwise.
    const [logResult, totalsResult] = await Promise.all([
      supabase
        .from('email_send_log')
        .select('mailbox_id, status, opened_at, clicked_at, replied_at, unsubscribed_at, sent_at')
        .in('mailbox_id', batchIds)
        .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'unsubscribed'])
        .order('sent_at', { ascending: false })
        .limit(batchSize * WINDOW_SIZE),
      // For each mailbox, count ALL sends in the last 30 days. Truncating at 30
      // days keeps the count meaningful (long-dead mailboxes don't get paused
      // forever based on ancient activity).
      supabase
        .from('email_send_log')
        .select('mailbox_id', { count: 'exact', head: false })
        .in('mailbox_id', batchIds)
        .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied'])
        .gte('sent_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const logs = logResult.data;
    if (logResult.error) {
      console.warn(`[engagement-recompute] log fetch failed for batch ${i}: ${logResult.error.message}`);
      continue;
    }

    // Bucket totals (lifetime-ish sends per mailbox, last 30 days)
    const totalSends = new Map<string, number>();
    for (const id of batchIds) totalSends.set(id, 0);
    for (const row of (totalsResult.data ?? []) as Array<{ mailbox_id: string }>) {
      totalSends.set(row.mailbox_id, (totalSends.get(row.mailbox_id) ?? 0) + 1);
    }

    // Bucket logs by mailbox_id, capping at WINDOW_SIZE per mailbox.
    const bucketed = new Map<string, AggregateRow>();
    for (const id of batchIds) {
      bucketed.set(id, { mailbox_id: id, sent: 0, opens: 0, clicks: 0, replies: 0, unsubscribes: 0 });
    }
    const counts = new Map<string, number>();
    for (const id of batchIds) counts.set(id, 0);
    for (const row of (logs ?? []) as Array<{ mailbox_id: string; status: string; opened_at: string | null; clicked_at: string | null; replied_at: string | null; unsubscribed_at: string | null }>) {
      const c = counts.get(row.mailbox_id) ?? 0;
      if (c >= WINDOW_SIZE) continue;
      counts.set(row.mailbox_id, c + 1);
      const agg = bucketed.get(row.mailbox_id);
      if (!agg) continue;
      if (['sent', 'delivered', 'opened', 'clicked', 'replied'].includes(row.status)) agg.sent++;
      if (row.opened_at) agg.opens++;
      if (row.clicked_at) agg.clicks++;
      if (row.replied_at || row.status === 'replied') agg.replies++;
      if (row.unsubscribed_at) agg.unsubscribes++;
    }

    // 3) Decide new state per mailbox + parallel UPDATE in concurrency-bounded chunks.
    const decisions: Array<{ mb: MailboxRow; score: number; sent: number; total30d: number; newDailyLimit: number; newStatus: string; reason: string; agg: AggregateRow }> = [];
    for (const mb of batch) {
      const agg = bucketed.get(mb.id) ?? { sent: 0, opens: 0, replies: 0, clicks: 0, unsubscribes: 0, mailbox_id: mb.id };
      const score = agg.sent > 0 ? (agg.replies * 5 + agg.opens) / agg.sent : 0;
      const total30d = totalSends.get(mb.id) ?? 0;
      const baseline = mb.daily_limit_baseline ?? mb.daily_limit;
      let newDailyLimit = baseline;
      // This function NEVER pauses a mailbox. Engagement is driven by the list
      // and the copy, not by the inbox: a bad list sprayed through rotation
      // would take the whole pool offline one mailbox at a time. The strongest
      // action available here is throttling down to the floor.
      const newStatus = mb.status;
      let reason = 'reset_to_baseline';

      // FLOOR: sustained low engagement (100+ sends in 30d AND windowed score
      // < 0.02). Previously paused the mailbox; now throttles it hard instead.
      if (total30d >= PAUSE_THRESHOLD_SENT && score < PAUSE_THRESHOLD_SCORE && agg.sent >= COOL_THRESHOLD_SENT) {
        newDailyLimit = Math.max(1, Math.floor(baseline / 4));
        reason = `floored_low_engagement_${score.toFixed(4)}`;
      } else if (agg.sent >= COOL_THRESHOLD_SENT && score < COOL_THRESHOLD_SCORE) {
        newDailyLimit = Math.max(1, Math.floor(baseline / 2));
        reason = `cooled_low_engagement_${score.toFixed(4)}`;
      } else if (score >= HOT_THRESHOLD_SCORE && agg.sent >= COOL_THRESHOLD_SENT) {
        const cap = mb.warmup_max_daily ?? Math.ceil(baseline * 1.25);
        newDailyLimit = Math.min(cap, Math.ceil(baseline * 1.25));
        reason = `boosted_high_engagement_${score.toFixed(4)}`;
      }
      decisions.push({ mb, score, sent: agg.sent, total30d, newDailyLimit, newStatus, reason, agg });
    }

    // Parallel updates with concurrency cap. 20 concurrent UPDATE calls per batch.
    const concurrency = 20;
    for (let j = 0; j < decisions.length; j += concurrency) {
      const slice = decisions.slice(j, j + concurrency);
      await Promise.all(slice.map(async (d) => {
        const { error: updErr } = await supabase
          .from('email_mailboxes')
          .update({
            engagement_score: d.score,
            engagement_score_recorded_at: nowIso,
            engagement_metrics: { ...d.agg, window_size: WINDOW_SIZE, computed_at: nowIso, reason: d.reason },
            daily_limit: d.newDailyLimit,
            daily_limit_baseline: d.mb.daily_limit_baseline ?? d.mb.daily_limit,
            status: d.newStatus,
            updated_at: nowIso,
          })
          .eq('id', d.mb.id);
        if (updErr) {
          console.warn(`[engagement-recompute] update failed for ${d.mb.id}: ${updErr.message}`);
        } else {
          updates.push({ id: d.mb.id, score: d.score, sent: d.sent, total30d: d.total30d, daily_limit: d.newDailyLimit, status: d.newStatus, reason: d.reason });
        }
      }));
    }
  }

  return jsonResponse({
    success: true,
    mailboxes_evaluated: mboxList.length,
    mailboxes_updated: updates.length,
    elapsed_ms: Date.now() - startedAt,
    sample: updates.slice(0, 10),
  });
});
