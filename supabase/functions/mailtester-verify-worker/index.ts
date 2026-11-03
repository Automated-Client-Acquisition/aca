/**
 * mailtester-verify-worker — cron-driven drain for Mailtester async jobs.
 *
 * Runs once a minute via pg_cron. Picks up jobs in 'queued' or 'running' state
 * and processes a slice of pending_emails up to the plan's per-minute budget,
 * pacing requests inside the slice at the plan's RPS to stay under the
 * documented per-10s rate cap.
 *
 * Stops short of the 150s edge function ceiling by leaving any remaining
 * addresses on the job row — the next cron tick continues. Idempotent.
 *
 * Auth: pg_cron sends the service-role JWT; no other invokers expected.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  MAILTESTER_PLAN_LIMITS,
  type MailtesterNinjaPlan,
  type SupabaseServiceClient,
  type VerificationStatus,
  type VerificationRecord,
} from '../_shared/list-verifier.ts';
import {
  mapMailtesterNinjaResponse,
  isMailtesterKeyError,
  isMailtesterQuotaError,
  type MailtesterNinjaResponse,
} from '../_shared/mailtester-ninja.ts';
import {
  bumpTickStats,
  emailsPerTick,
  emptyTickStats,
  getMailtesterUsedToday,
  intervalMsForPlan,
  type WorkerTickStats,
} from '../_shared/mailtester-async.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { isRoleLocalPart } from '../_shared/role-prefixes.ts';
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

class MailtesterTimeoutError extends Error {
  constructor(email: string, timeoutMs: number) {
    super(`Mailtester timed out after ${timeoutMs}ms for ${email}`);
    this.name = 'MailtesterTimeoutError';
  }
}

async function checkMailtesterNinja(
  apiKey: string,
  email: string,
  timeoutMs = 10_000,
): Promise<{
  status: VerificationStatus;
  raw: MailtesterNinjaResponse;
  failure: 'confirmed_auth' | 'provider_rejected' | 'quota' | null;
}> {
  const url = `https://happy.mailtester.ninja/ninja?email=${encodeURIComponent(email)}&key=${encodeURIComponent(apiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // AbortSignal.timeout fires a TimeoutError DOMException — convert it into a
    // typed error so the worker can decide to drop the address as 'unknown'
    // instead of requeuing it forever.
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new MailtesterTimeoutError(email, timeoutMs);
    }
    throw e;
  }
  if (res.status === 401 || res.status === 403) {
    return { status: 'unknown', raw: {}, failure: 'confirmed_auth' };
  }
  if (!res.ok) {
    throw new Error(`Mailtester returned ${res.status}`);
  }
  const json = (await res.json()) as MailtesterNinjaResponse;
  // HTTP 200 can carry a provider-level rejection. Quotas are explicitly not
  // authentication failures: they must never flip the stored key invalid.
  if (isMailtesterQuotaError(json)) {
    return { status: 'unknown', raw: json, failure: 'quota' };
  }
  if (isMailtesterKeyError(json)) {
    return { status: 'unknown', raw: json, failure: 'provider_rejected' };
  }
  return { status: mapMailtesterNinjaResponse(json), raw: json, failure: null };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function normalize(email: string): { ok: boolean; lower: string; local: string; domain: string } {
  const trimmed = (email ?? '').trim();
  if (!EMAIL_RE.test(trimmed)) {
    return { ok: false, lower: trimmed.toLowerCase(), local: '', domain: '' };
  }
  const lower = trimmed.toLowerCase();
  const at = lower.lastIndexOf('@');
  return { ok: true, lower, local: lower.slice(0, at), domain: lower.slice(at + 1) };
}

async function persist(
  supabase: SupabaseServiceClient,
  organizationId: string,
  rec: VerificationRecord,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('email_address_verifications')
    .upsert(
      {
        organization_id: organizationId,
        ...rec,
        verified_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
      { onConflict: 'organization_id,email_lower' },
    );
  if (error) {
    console.warn(`[mailtester-worker] persist failed for ${rec.email}: ${error.message}`);
  }
}

interface UnknownVerificationRow {
  id: string;
  raw_response: MailtesterNinjaResponse | null;
}

interface RepairSummary {
  checked: number;
  valid: number;
  invalid: number;
  catch_all: number;
}

async function repairRecentUnknownMailtesterRows(
  supabase: SupabaseServiceClient,
): Promise<RepairSummary> {
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const summary: RepairSummary = { checked: 0, valid: 0, invalid: 0, catch_all: 0 };

  const { data, error } = await supabase
    .from('email_address_verifications')
    .select('id, raw_response')
    .eq('provider', 'mailtester_ninja')
    .eq('status', 'unknown')
    .gte('verified_at', since)
    .not('raw_response', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.warn(`[mailtester-worker] recent unknown repair query failed: ${error.message}`);
    return summary;
  }

  const idsByStatus: Record<'valid' | 'invalid' | 'catch_all', string[]> = {
    valid: [],
    invalid: [],
    catch_all: [],
  };

  for (const row of (data ?? []) as UnknownVerificationRow[]) {
    summary.checked += 1;
    const status = mapMailtesterNinjaResponse(row.raw_response ?? {});
    if (status === 'valid' || status === 'invalid' || status === 'catch_all') {
      idsByStatus[status].push(row.id);
    }
  }

  for (const status of Object.keys(idsByStatus) as Array<keyof typeof idsByStatus>) {
    const ids = idsByStatus[status];
    if (ids.length === 0) continue;

    const { error: updateErr } = await supabase
      .from('email_address_verifications')
      .update({
        status,
        is_catch_all: status === 'catch_all',
      })
      .in('id', ids);

    if (updateErr) {
      console.warn(`[mailtester-worker] recent unknown repair update failed for ${status}: ${updateErr.message}`);
      continue;
    }
    summary[status] += ids.length;
  }

  if (summary.valid || summary.invalid || summary.catch_all) {
    console.log(
      `[mailtester-worker] repaired recent unknown rows: valid=${summary.valid} invalid=${summary.invalid} catch_all=${summary.catch_all}`,
    );
  }

  return summary;
}

interface JobRow {
  id: string;
  organization_id: string;
  plan: MailtesterNinjaPlan;
  pending_emails: string[];
  status: string;
  processed: number;
  valid: number;
  invalid: number;
  catch_all: number;
  unknown: number;
  timeout_attempts: Record<string, number> | null;
  consecutive_timeout_ticks: number | null;
}

// Timeout retry strategy (see migration 20260714150000):
//   * An address that times out is retried up to MAX_ADDRESS_TIMEOUT_ATTEMPTS
//     times before being given up as 'unknown'. Retries never persist a row, so
//     they don't burn the daily quota.
//   * A whole tick that times out with ZERO real responses is treated as a
//     provider outage: nothing is drained, the job backs off OUTAGE_BACKOFF_MS
//     and retries. After MAX_CONSECUTIVE_OUTAGE_TICKS such ticks the job is
//     failed with an actionable error instead of shredding the list.
const MAX_ADDRESS_TIMEOUT_ATTEMPTS = 3;
const MAX_CONSECUTIVE_OUTAGE_TICKS = 15;
const OUTAGE_BACKOFF_MS = 60_000;
const OUTAGE_MIN_TIMEOUTS = 3;

// Cron fires every 60s. The worker stops processing well before the next
// cron so its successor can claim cleanly. The lease MUST exceed the worst-case
// gap between heartbeats — a single batch of SMTP probes can take up to the
// per-call timeout (10s). With a 20s lease and a heartbeat at the top of every
// batch, last_tick_at can never go stale mid-tick, so a parallel cron firing
// can't re-claim a live job. The fencing token (locked_by) is the belt-and-
// suspenders: even if a takeover happened, the preempted worker's writes are
// rejected because its token no longer matches.
// Per-invocation launch budget. Longer than the 1-minute cron on purpose: the
// 20s claim lease means a job can't be re-picked until 20s after a tick ends,
// so short 50s ticks left the job idle every other minute (finalize ~0:55 →
// re-claimable ~1:15, past the 1:00 cron). An 80s budget keeps one invocation
// launching continuously across cron boundaries (overlapping crons no-op on the
// held lease) for a far higher duty cycle, still well under the 150s edge-
// function wall-clock limit. Heartbeats every 2s hold the lease throughout.
const TICK_DEADLINE_MS = 80_000;
const CLAIM_LEASE_MS = 20_000;
const HEARTBEAT_INTERVAL_MS = 2_000;
// Per-call ceiling for a single Mailtester probe. Kept at 10s because many
// legitimate corporate mail servers (common on cold B2B lists) answer a real
// verdict in the 5-10s range — cutting this shorter just converts those into
// deferred timeouts. Safe to keep high now that calls run concurrently: a slow
// probe ties up one MAX_IN_FLIGHT slot instead of stalling a whole batch.
const CALL_TIMEOUT_MS = 10_000;
// Concurrency cap only — the ~910ms launch cadence (intervalMsForPlan) is the
// real throttle that holds the plan's sliding-window rate cap. Sized so that a
// full 10s of in-flight calls at that cadence (~11) never gates the launch
// rate; the pacing, not this, is the throttle.
const MAX_IN_FLIGHT = 16;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!supabaseUrl || !serviceKey || !encryptionKey) {
    return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  const tickStart = Date.now();
  const repaired = await repairRecentUnknownMailtesterRows(supabase);

  // Pull active jobs. Order:
  //   1. Prefer continuing a 'running' job over picking up a fresh 'queued'
  //      one (lexically 'queued' < 'running', so descending puts running
  //      first). Avoids new clicks preempting in-flight progress.
  //   2. Within each status, oldest first so old work drains before new.
  // The org-level mutex inside try_claim_mailtester_job ensures we never
  // process two jobs for the same org in the same window — required because
  // Mailtester rate-limits per API key.
  const { data: jobs, error: jobsErr } = await supabase
    .from('mailtester_verification_jobs')
    .select('id, organization_id, plan, pending_emails, status, processed, valid, invalid, catch_all, unknown, timeout_attempts, consecutive_timeout_ticks')
    .in('status', ['queued', 'running'])
    .order('status', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(20);
  console.log(`[mailtester-worker] jobs query returned: error=${jobsErr ? jobsErr.message : 'none'} count=${jobs?.length ?? 0} ids=${(jobs ?? []).map((j) => (j as { id: string }).id).join(',')}`);
  if (jobsErr) {
    return jsonResponse({ success: false, error: jobsErr.message }, 500);
  }

  const summary: Array<{ job_id: string; processed: number; remaining: number; status: string }> = [];

  for (const jobAny of (jobs ?? []) as JobRow[]) {
    if (Date.now() - tickStart > TICK_DEADLINE_MS) break;

    const job = jobAny;

    // Per-claim fencing token. Stamped onto the row by try_claim and required
    // (WHERE locked_by = token) on every subsequent write, so if this worker is
    // ever preempted (lease lapsed → another tick re-claims), its stale writes
    // are silently rejected instead of clobbering pending_emails / counts.
    const token = crypto.randomUUID();

    // Atomic lease via RPC. We avoid PostgREST's `.or()` filter for timestamp
    // comparison because ISO timestamps contain dots that confuse PostgREST's
    // filter parser ("column ... does not exist"). The RPC does the same
    // conditional UPDATE in plpgsql and returns true iff the row was claimed.
    const { data: claimed, error: claimErr } = await supabase.rpc('try_claim_mailtester_job', {
      p_job_id: job.id,
      p_lease_seconds: Math.ceil(CLAIM_LEASE_MS / 1000),
      p_token: token,
    });
    if (claimErr) {
      console.warn(`[mailtester-worker] claim error for ${job.id}: ${claimErr.message}`);
      continue;
    }
    if (!claimed) {
      // Another worker holds the lease for this job — skip and let it finish.
      continue;
    }

    // Empty queue → finalize.
    if (!job.pending_emails || job.pending_emails.length === 0) {
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          status: 'succeeded',
          finished_at: new Date().toISOString(),
          last_tick_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', token);
      summary.push({ job_id: job.id, processed: 0, remaining: 0, status: 'succeeded' });
      continue;
    }

    // Resolve key + decrypt
    const { data: keyRow } = await supabase
      .from('api_keys')
      .select('key_encrypted, is_valid')
      .eq('organization_id', job.organization_id)
      .eq('provider', 'mailtester_ninja')
      .maybeSingle();
    if (!keyRow?.key_encrypted) {
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          status: 'failed',
          error: 'Mailtester Ninja API key is missing for this organization',
          finished_at: new Date().toISOString(),
          last_tick_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', token);
      summary.push({ job_id: job.id, processed: 0, remaining: job.pending_emails.length, status: 'failed' });
      continue;
    }
    let apiKey: string;
    // `is_valid` may have been set false by an older worker that mistook a
    // quota response for a disabled key. Let the provider give us fresh
    // evidence instead of making that stale bit permanently block retries.
    let keyRevalidated = keyRow.is_valid === true;
    try {
      apiKey = await decryptApiKey(keyRow.key_encrypted, encryptionKey);
    } catch (e) {
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          status: 'failed',
          error: `Failed to decrypt API key: ${e instanceof Error ? e.message : 'unknown'}`,
          finished_at: new Date().toISOString(),
          last_tick_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', token);
      summary.push({ job_id: job.id, processed: 0, remaining: job.pending_emails.length, status: 'failed' });
      continue;
    }

    // Daily cap pre-check
    const cap = MAILTESTER_PLAN_LIMITS[job.plan].perDay;
    let usedToday = await getMailtesterUsedToday(supabase, job.organization_id);
    if (usedToday >= cap) {
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          status: 'queued',
          daily_limit_reached: true,
          last_tick_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', token);
      summary.push({ job_id: job.id, processed: 0, remaining: job.pending_emails.length, status: 'queued' });
      continue;
    }

    // Slice = up to per-tick budget OR remaining headroom under daily cap
    const tickBudget = Math.min(emailsPerTick(job.plan), Math.max(0, cap - usedToday));
    const slice = job.pending_emails.slice(0, tickBudget);
    const remaining = job.pending_emails.slice(tickBudget);

    // try_claim already flipped the row to 'running' and stamped started_at +
    // last_tick_at, so no separate "mark running" write is needed here.

    // Addresses fully resolved this tick (persisted to email_address_verifications).
    // finalize_mailtester_tick removes exactly these from the live pending_emails;
    // transient-failure requeues are NOT added, so they stay queued.
    const resolved: string[] = [];
    // Addresses that timed out THIS tick — held aside instead of being drained
    // inline, so we can tell "one flaky recipient" (retry it) from "the provider
    // is down" (whole tick timed out → back off, don't touch anything).
    const timedOut: string[] = [];
    const stats: WorkerTickStats = emptyTickStats();
    const intervalMs = intervalMsForPlan(job.plan);
    let providerFailure: 'confirmed_auth' | 'provider_rejected' | 'quota' | null = null;
    // Heartbeat the lease while we process so a parallel cron tick won't
    // claim our slice mid-run. Touched only when the lease is about to
    // expire — every HEARTBEAT_INTERVAL_MS ms.
    let lastHeartbeatAt = Date.now();

    // Rate-paced CONCURRENT launcher. The plan's cap is a sliding window
    // (Pro: 11 / 10s), so throughput is bounded by how fast we START calls, not
    // by how long each takes. We launch one call every `intervalMs` (~910ms on
    // Pro → 10.99 per 10s, a hair under the cap) and smooth (never burst — the
    // old 3-at-once batches tripped 429s and, worse, awaited the batch's slowest
    // member, so a single 10s timeout throttled everything to ~15% of plan).
    // Here a slow recipient just occupies one of MAX_IN_FLIGHT slots while the
    // rest keep flowing, so we approach the plan's real throughput.
    //
    // CALL_TIMEOUT_MS is 5s (was 10s): a genuine Mailtester verdict returns in
    // well under a second; a multi-second wait is almost always a dead SMTP
    // probe, and a shorter ceiling frees the slot (and the retry/outage
    // classifier) far sooner.
    const inFlight = new Set<Promise<void>>();
    let nextLaunchAt = Date.now();

    // Records one settled call. Mirrors the old per-address handling: persist
    // real verdicts, requeue transient failures, DEFER timeouts for the
    // post-tick retry/outage classifier, and treat auth failure as sticky.
    const recordResult = async (
      email: string,
      settled: PromiseSettledResult<Awaited<ReturnType<typeof checkMailtesterNinja>>>,
    ): Promise<void> => {
      const norm = normalize(email);
      if (settled.status === 'rejected') {
        const reason = settled.reason;
        const isTimeout = reason instanceof MailtesterTimeoutError;
        console.warn(`[mailtester-worker] call failed for ${email}: ${reason instanceof Error ? reason.message : 'unknown'}${isTimeout ? ' (deferred for retry/outage check)' : ' (requeue)'}`);
        if (isTimeout) timedOut.push(email);
        else remaining.push(email);
        return;
      }
      const v = settled.value;
      if (v.failure) {
        providerFailure ??= v.failure;
        remaining.push(email);
        return;
      }
      if (!keyRevalidated) {
        const { error: revalidateErr } = await supabase
          .from('api_keys')
          .update({ is_valid: true, last_validated: new Date().toISOString() })
          .eq('organization_id', job.organization_id)
          .eq('provider', 'mailtester_ninja');
        if (revalidateErr) {
          console.warn(`[mailtester-worker] could not restore Mailtester key health: ${revalidateErr.message}`);
        } else {
          keyRevalidated = true;
        }
      }
      await persist(supabase, job.organization_id, {
        email,
        email_lower: norm.lower,
        domain: norm.domain,
        local_part: norm.local,
        status: v.status,
        provider: 'mailtester_ninja',
        smtp_response_code: null,
        is_disposable: false,
        is_role: isRoleLocalPart(norm.local),
        is_catch_all: v.status === 'catch_all',
        is_spamtrap: false,
        raw_response: v.raw,
      });
      bumpTickStats(stats, v.status);
      resolved.push(email);
      usedToday += 1;
    };

    let launchIndex = 0;
    for (; launchIndex < slice.length; launchIndex += 1) {
      if (providerFailure) break;
      if (Date.now() - tickStart > TICK_DEADLINE_MS) break;
      // Don't oversubscribe the daily cap: count in-flight calls as spent.
      if (cap - usedToday - inFlight.size <= 0) {
        stats.daily_limit_reached = true;
        break;
      }
      if (Date.now() - lastHeartbeatAt > HEARTBEAT_INTERVAL_MS) {
        await supabase
          .from('mailtester_verification_jobs')
          .update({ last_tick_at: new Date().toISOString() })
          .eq('id', job.id)
          .eq('locked_by', token)
          .in('status', ['queued', 'running']);
        lastHeartbeatAt = Date.now();
      }

      // Hold the sliding-window cap: one launch per intervalMs, evenly spaced.
      const wait = nextLaunchAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      nextLaunchAt = Math.max(nextLaunchAt + intervalMs, Date.now());

      const email = slice[launchIndex];
      let entry!: Promise<void>;
      entry = checkMailtesterNinja(apiKey, email, CALL_TIMEOUT_MS)
        .then(
          (value) => recordResult(email, { status: 'fulfilled', value }),
          (reason) => recordResult(email, { status: 'rejected', reason }),
        )
        .finally(() => { inFlight.delete(entry); });
      inFlight.add(entry);

      // Bound concurrency; the launch cadence, not this, is the throttle.
      if (inFlight.size >= MAX_IN_FLIGHT) await Promise.race(inFlight);
    }

    // Requeue anything we never launched (deadline / cap / auth bail).
    if (launchIndex < slice.length) remaining.unshift(...slice.slice(launchIndex));

    // Let in-flight calls finish and record before the tick finalizes.
    await Promise.allSettled(inFlight);
    if (usedToday >= cap) stats.daily_limit_reached = true;

    // --- Timeout retry strategy --------------------------------------------
    // Classify the tick. If the provider returned NOTHING real (no valid/
    // invalid/catch-all/unknown from an actual response) yet several addresses
    // timed out, the provider is down — back off the whole job without draining
    // or persisting anything, so a transient outage can't shred the list.
    const providerAnswered = stats.processed > 0;
    if (!providerFailure && !providerAnswered && timedOut.length >= OUTAGE_MIN_TIMEOUTS) {
      const outageTicks = (job.consecutive_timeout_ticks ?? 0) + 1;
      if (outageTicks >= MAX_CONSECUTIVE_OUTAGE_TICKS) {
        await supabase
          .from('mailtester_verification_jobs')
          .update({
            status: 'failed',
            error: 'Email verification provider (Mailtester Ninja) stopped responding — every check timed out for several minutes. This run was paused; re-launch it once the provider recovers.',
            consecutive_timeout_ticks: outageTicks,
            retry_after: null,
            finished_at: new Date().toISOString(),
            last_tick_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('locked_by', token)
          .in('status', ['queued', 'running']);
        console.warn(`[mailtester-worker] job ${job.id} FAILED after ${outageTicks} consecutive provider-outage ticks.`);
        summary.push({ job_id: job.id, processed: 0, remaining: job.pending_emails.length, status: 'failed' });
      } else {
        // Nothing was added to `resolved`, so finalize is not called: the
        // timed-out addresses stay in pending_emails untouched. Just back off.
        await supabase
          .from('mailtester_verification_jobs')
          .update({
            status: 'queued',
            consecutive_timeout_ticks: outageTicks,
            retry_after: new Date(Date.now() + OUTAGE_BACKOFF_MS).toISOString(),
            last_tick_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('locked_by', token)
          .in('status', ['queued', 'running']);
        console.warn(`[mailtester-worker] job ${job.id} provider outage (tick ${outageTicks}/${MAX_CONSECUTIVE_OUTAGE_TICKS}) — backing off ${OUTAGE_BACKOFF_MS}ms, ${timedOut.length} addresses left queued.`);
        summary.push({ job_id: job.id, processed: 0, remaining: job.pending_emails.length, status: 'queued' });
      }
      continue;
    }

    // Provider is up. Apply bounded per-address retry to the addresses that
    // timed out: each keeps a counter and stays queued until it exceeds the cap,
    // at which point we give up and record 'unknown' (the only path that
    // persists a row + drains it). Retries never persist, so they don't burn the
    // daily quota.
    const attempts: Record<string, number> = { ...(job.timeout_attempts ?? {}) };
    let attemptsChanged = false;
    for (const email of timedOut) {
      const norm = normalize(email);
      const key = norm.lower;
      const n = (attempts[key] ?? 0) + 1;
      if (n >= MAX_ADDRESS_TIMEOUT_ATTEMPTS) {
        await persist(supabase, job.organization_id, {
          email,
          email_lower: norm.lower,
          domain: norm.domain,
          local_part: norm.local,
          status: 'unknown',
          provider: 'mailtester_ninja',
          smtp_response_code: null,
          is_disposable: false,
          is_role: isRoleLocalPart(norm.local),
          is_catch_all: false,
          is_spamtrap: false,
          raw_response: { reason: 'timeout', attempts: n },
        });
        bumpTickStats(stats, 'unknown');
        resolved.push(email);
        // NOT counted against usedToday: the endpoint never returned a result
        // for this address (it only ever timed out), so it isn't a billable
        // verification and must not consume the daily budget.
        if (key in attempts) { delete attempts[key]; attemptsChanged = true; }
      } else {
        attempts[key] = n;
        attemptsChanged = true;
      }
    }

    // Prune counters for every address drained this tick (successes included) so
    // the map only ever holds addresses still pending a retry — keeps the jsonb
    // bounded on large jobs where transient timeouts later succeed.
    for (const email of resolved) {
      const key = email.toLowerCase();
      if (key in attempts) { delete attempts[key]; attemptsChanged = true; }
    }

    // Persist whatever we resolved this tick atomically (drains exactly the
    // resolved addresses from the live pending_emails, advances counters) — even
    // on auth failure, so completed work isn't lost. Guarded by the fencing
    // token: if we were preempted, this write is rejected and counts stay clean.
    const { data: finRows, error: finErr } = await supabase.rpc('finalize_mailtester_tick', {
      p_job_id: job.id,
      p_token: token,
      p_processed_emails: resolved,
      p_valid_delta: stats.valid,
      p_invalid_delta: stats.invalid,
      p_catch_all_delta: stats.catch_all,
      p_unknown_delta: stats.unknown,
      p_daily_limit_reached: stats.daily_limit_reached,
    });
    const fin = Array.isArray(finRows) && finRows.length > 0
      ? (finRows[0] as { applied: boolean; pending_after: number; status: string })
      : null;
    if (finErr) {
      console.error(`[mailtester-worker] finalize FAILED for ${job.id}: ${finErr.message} (code=${finErr.code})`);
    } else if (!fin?.applied) {
      console.warn(`[mailtester-worker] finalize skipped for ${job.id} — lease lost (preempted/cancelled). resolved=${resolved.length} discarded.`);
    } else {
      console.log(`[mailtester-worker] finalize OK ${job.id}: resolved=${resolved.length}, pending_after=${fin.pending_after}, status=${fin.status}`);
    }

    // Provider answered this tick: clear any outage back-off and persist the
    // updated per-address timeout counters so bounded retry survives across
    // ticks. Token-guarded + gated to non-terminal rows so a job that finalize
    // just marked 'succeeded' is left alone.
    if (!providerFailure && (attemptsChanged || (job.consecutive_timeout_ticks ?? 0) > 0)) {
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          timeout_attempts: attempts,
          consecutive_timeout_ticks: 0,
          retry_after: null,
        })
        .eq('id', job.id)
        .eq('locked_by', token)
        .in('status', ['queued', 'running']);
    }

    if (providerFailure) {
      // An HTTP 401/403 is the only confirmed authentication failure. A 200
      // body such as "Disabled Key" can also be returned for provider-side
      // account states, so preserve the user's saved key in that case.
      if (providerFailure === 'confirmed_auth') {
        await supabase
          .from('api_keys')
          .update({ is_valid: false, last_validated: new Date().toISOString() })
          .eq('organization_id', job.organization_id)
          .eq('provider', 'mailtester_ninja');
      }
      const error = providerFailure === 'quota'
        ? 'Mailtester Ninja reported that its quota or rate limit was reached. The saved API key remains enabled; retry after the provider allowance resets.'
        : providerFailure === 'confirmed_auth'
          ? 'Mailtester Ninja returned an authentication error (HTTP 401/403). Update the key in Settings and re-launch.'
          : 'Mailtester Ninja rejected the verification request. The saved API key remains enabled; test the connection in Settings, then retry.';
      await supabase
        .from('mailtester_verification_jobs')
        .update({
          status: 'failed',
          error,
          finished_at: new Date().toISOString(),
          last_tick_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', token)
        .in('status', ['queued', 'running']);
      summary.push({ job_id: job.id, processed: stats.processed, remaining: fin?.pending_after ?? remaining.length, status: 'failed' });
      continue;
    }

    summary.push({
      job_id: job.id,
      processed: stats.processed,
      remaining: fin?.pending_after ?? remaining.length,
      status: fin?.status ?? 'running',
    });
  }

  return jsonResponse({ success: true, repaired, jobs: summary });
});
