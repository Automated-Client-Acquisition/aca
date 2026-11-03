/**
 * Sequence Bounce Guard.
 *
 * The aggregate bounce guard for outbound email. Bounce rate is a property of
 * the LIST being sent, not of the mailbox sending it: rotation spreads a bad
 * list across the whole pool, so a per-mailbox bounce guard pauses healthy
 * inboxes one at a time while the list that caused the bounces keeps feeding.
 * Every per-mailbox bounce pause was removed on 2026-09-16 and replaced by this
 * function, which pauses the SEQUENCE — the object that actually owns the list.
 *
 * Per active sequence, over a rolling window:
 *
 *   bounce_rate = bounced / (delivered-ish sends)
 *
 *   rate >= 10% with >= 5 bounces and >= 20 sends  → pause the sequence
 *   rate >=  5% with the same floors               → warn (recorded, not paused)
 *
 * The absolute floors matter more than the rate. A rate over a handful of sends
 * is noise — "100%" over one send is one dead address, and acting on it is what
 * took 51 mailboxes offline permanently.
 *
 * Body (optional):
 *   {
 *     sequence_ids?: uuid[]  // scope to specific sequences (smoke test)
 *     window_days?: number   // default 7
 *     dry_run?: boolean      // evaluate and report, change nothing
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

const DEFAULT_WINDOW_DAYS = 7;
const PAUSE_RATE = 0.10;
const WARN_RATE = 0.05;
/** Floors — no action on a small denominator, in either direction. */
const MIN_SENDS = 20;
const MIN_BOUNCES = 5;

/** Statuses that represent an email that actually left the building. */
const SENT_STATUSES = ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced'];

interface SequenceRow {
  id: string;
  organization_id: string;
  name: string;
  status: string;
  settings: Record<string, unknown> | null;
  lead_list_id: string | null;
  lead_list_ids: string[] | null;
}

interface Verdict {
  sequence_id: string;
  name: string;
  sent: number;
  bounced: number;
  rate: number;
  action: 'paused' | 'warned' | 'ok' | 'below_floor';
  lead_list_ids: string[];
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Only the hourly pg_cron job (service-role key) calls this; it pauses sequences in any org.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  let body: { sequence_ids?: string[]; window_days?: number; dry_run?: boolean } = {};
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json();
  } catch {
    body = {};
  }

  const windowDays = body.window_days ?? DEFAULT_WINDOW_DAYS;
  const dryRun = body.dry_run === true;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const startedAt = Date.now();

  // Only active sequences can be paused; draft/paused ones send nothing.
  let seqQuery = supabase
    .from('email_sequences')
    .select('id, organization_id, name, status, settings, lead_list_id, lead_list_ids')
    .eq('status', 'active');
  if (body.sequence_ids?.length) seqQuery = seqQuery.in('id', body.sequence_ids);

  const { data: sequences, error: seqErr } = await seqQuery;
  if (seqErr) return jsonResponse({ success: false, error: seqErr.message }, 500);

  const verdicts: Verdict[] = [];

  for (const seq of (sequences ?? []) as SequenceRow[]) {
    try {
      // Two head-counts rather than pulling rows — these logs are large.
      const [{ count: sent }, { count: bounced }] = await Promise.all([
        supabase
          .from('email_send_log')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', seq.id)
          .gte('sent_at', since)
          .in('status', SENT_STATUSES),
        supabase
          .from('email_send_log')
          .select('id', { count: 'exact', head: true })
          .eq('sequence_id', seq.id)
          .gte('sent_at', since)
          .eq('status', 'bounced'),
      ]);

      const totalSent = sent ?? 0;
      const totalBounced = bounced ?? 0;
      const rate = totalSent > 0 ? totalBounced / totalSent : 0;

      const listIds = Array.from(
        new Set([...(seq.lead_list_ids ?? []), ...(seq.lead_list_id ? [seq.lead_list_id] : [])])
      );

      // Floors first. Below them the rate carries no information at all.
      if (totalSent < MIN_SENDS || totalBounced < MIN_BOUNCES) {
        verdicts.push({
          sequence_id: seq.id,
          name: seq.name,
          sent: totalSent,
          bounced: totalBounced,
          rate,
          action: 'below_floor',
          lead_list_ids: listIds,
        });
        continue;
      }

      const stats = {
        window_days: windowDays,
        sent: totalSent,
        bounced: totalBounced,
        rate: Math.round(rate * 10000) / 10000,
        lead_list_ids: listIds,
        evaluated_at: new Date().toISOString(),
      };

      if (rate >= PAUSE_RATE) {
        if (!dryRun) {
          await supabase
            .from('email_sequences')
            .update({
              status: 'paused',
              settings: {
                ...(seq.settings ?? {}),
                paused_reason: 'bounce_rate',
                bounce_guard: stats,
              },
              updated_at: new Date().toISOString(),
            })
            .eq('id', seq.id);
        }
        console.warn(
          `[BounceGuard] PAUSED sequence ${seq.id} (${seq.name}): ${totalBounced}/${totalSent} = ${(rate * 100).toFixed(1)}%`
        );
        verdicts.push({ ...stats, sequence_id: seq.id, name: seq.name, action: 'paused' } as Verdict);
      } else if (rate >= WARN_RATE) {
        if (!dryRun) {
          await supabase
            .from('email_sequences')
            .update({
              settings: { ...(seq.settings ?? {}), bounce_guard: { ...stats, level: 'warning' } },
              updated_at: new Date().toISOString(),
            })
            .eq('id', seq.id);
        }
        verdicts.push({ ...stats, sequence_id: seq.id, name: seq.name, action: 'warned' } as Verdict);
      } else {
        verdicts.push({ ...stats, sequence_id: seq.id, name: seq.name, action: 'ok' } as Verdict);
      }
    } catch (err) {
      console.error(`[BounceGuard] Failed evaluating sequence ${seq.id}:`, err);
    }
  }

  return jsonResponse({
    success: true,
    dry_run: dryRun,
    window_days: windowDays,
    sequences_evaluated: verdicts.length,
    paused: verdicts.filter((v) => v.action === 'paused').length,
    warned: verdicts.filter((v) => v.action === 'warned').length,
    elapsed_ms: Date.now() - startedAt,
    verdicts: verdicts.filter((v) => v.action === 'paused' || v.action === 'warned'),
  });
});
