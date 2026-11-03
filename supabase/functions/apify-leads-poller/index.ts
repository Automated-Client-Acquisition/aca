/**
 * Apify Leads Import Poller — defense-in-depth fallback.
 *
 * Cron-invoked every few minutes. The primary completion path for an
 * `apify_leads_import_jobs` run is the ad-hoc Apify webhook → `apify-leads-webhook`,
 * which ingests the dataset and chains the next batch. That webhook is a single
 * point of failure: if Apify's callback is dropped, delayed, or 401'd (as it was
 * on 2026-06-02 before `verify_jwt=false` was set), the job hangs on its current
 * batch forever while the actor still bills.
 *
 * This poller closes that gap. For each `status='running'` job it:
 *   1. Finds the in-flight batch (the one marked 'running').
 *   2. Asks the Apify API for that batch's run status (via the run_id stored
 *      on the batch).
 *   3. If the run SUCCEEDED *and* finished long enough ago that the webhook
 *      had its chance (WEBHOOK_GRACE) → ingest the dataset + chain the next
 *      batch via the SAME shared code the webhook uses (`apify-leads-ingest`).
 *   4. If the run FAILED/ABORTED/TIMED-OUT → mark the batch failed + continue.
 *   5. If the whole job has been running past JOB_MAX_AGE → guillotine it
 *      ('failed') so it can't hang indefinitely.
 *   6. Also recovers jobs whose chaining stalled (a batch finished but the next
 *      one was never started) and jobs whose finalize step was lost.
 *
 * The WEBHOOK_GRACE window means that in the normal case (webhook fires within
 * seconds) the poller finds nothing to do — it only acts when the push path
 * demonstrably failed, which also avoids racing the webhook on the same batch.
 *
 * Per-job claim (claim_apify_leads_import_job RPC) prevents overlapping cron
 * ticks from double-processing. The dedup in processApifyLead + the
 * lead_list_members unique constraint are the final backstop against any
 * double-ingest producing duplicates.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptApiKey, APIFY_BASE_URL, type BatchInfo } from '../_shared/apify-leads-utils.ts';
import { ingestBatchDataset, failBatch, handleBatchComplete } from '../_shared/apify-leads-ingest.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const POLL_BATCH_SIZE = 20;
// Give the push webhook a head start. If a run finished within this window we
// leave it for the webhook and re-check next tick — this both targets the
// "webhook was dropped" case and avoids racing the webhook on the same batch.
const WEBHOOK_GRACE_MS = 90 * 1000;
// Per-run stall ceiling. If Apify still reports a batch's run as RUNNING this
// long after IT started (Apify's own startedAt, not the job's), the run is
// presumed wedged and the batch is failed. Keyed off the individual run — NOT
// total job age — so a large multi-batch import that's actively progressing is
// never killed just for taking a while. A single leads-finder run of 2500
// leads completes in minutes; 90 min is far beyond any healthy run.
const RUN_STALL_MS =
  (parseInt(Deno.env.get('APIFY_LEADS_RUN_STALL_MIN') || '90', 10) || 90) * 60 * 1000;
// Last-resort backstop for jobs we CAN'T poll (no run id on the in-flight
// batch, or Apify is unreachable) — without it such a job would hang forever.
// Jobs whose runs we can poll are resolved by run status, not this age.
const JOB_MAX_AGE_MS =
  (parseInt(Deno.env.get('APIFY_LEADS_JOB_MAX_AGE_MIN') || '180', 10) || 180) * 60 * 1000;
const CLAIM_LOCK_SECONDS = 300;

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);

interface ImportJobRow {
  id: string;
  organization_id: string;
  target_list_id: string;
  search_config: unknown;
  total_requested: number;
  batch_size: number | null;
  batches: BatchInfo[] | null;
  current_batch: number | null;
  status: string;
  started_at: string | null;
  created_at: string;
}

async function getApifyToken(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!keyRow) return null;
  return decryptApiKey((keyRow as { key_encrypted: string }).key_encrypted, encryptionKey);
}

async function fetchRunStatus(
  token: string,
  runId: string,
): Promise<{ status: string; startedAt: string | null; finishedAt: string | null } | null> {
  const resp = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}?token=${token}`);
  if (!resp.ok) {
    console.warn(`[apify-leads-poller] actor-runs/${runId} ${resp.status}`);
    return null;
  }
  const json = await resp.json();
  const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>);
  return {
    status: (data.status as string) ?? 'UNKNOWN',
    startedAt: (data.startedAt as string) ?? null,
    finishedAt: (data.finishedAt as string) ?? null,
  };
}

function jobAgeMs(job: ImportJobRow): number {
  const anchor = job.started_at || job.created_at;
  return Date.now() - new Date(anchor).getTime();
}

/**
 * Force-fail a wedged job: mark every non-terminal batch failed, then run the
 * shared finalize path (handleBatchComplete on the last index → no chaining,
 * just finalize). Also stamps error_message for visibility.
 */
async function guillotineJob(
  supabase: SupabaseClient,
  job: ImportJobRow,
  batches: BatchInfo[],
  reason: string,
): Promise<void> {
  for (const b of batches) {
    if (b.status === 'pending' || b.status === 'running') {
      b.status = 'failed';
      b.error = reason;
    }
  }
  await handleBatchComplete(supabase, job as unknown as Record<string, unknown>, batches, batches.length - 1, null, Deno.env.get('SUPABASE_URL')!, null);
  await supabase
    .from('apify_leads_import_jobs')
    .update({ error_message: reason })
    .eq('id', job.id);
  console.warn(`[apify-leads-poller] job ${job.id} guillotined: ${reason}`);
}

type Outcome = 'ingested' | 'failed_batch' | 'chained' | 'finalized' | 'guillotined' | 'noop';

async function reconcileJob(supabase: SupabaseClient, job: ImportJobRow): Promise<Outcome> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY') ?? null;
  const batches: BatchInfo[] = Array.isArray(job.batches) ? job.batches : [];

  if (batches.length === 0) {
    // Job marked running but never built its batch plan. Let the age backstop
    // catch it; nothing to poll.
    if (jobAgeMs(job) > JOB_MAX_AGE_MS) {
      await supabase
        .from('apify_leads_import_jobs')
        .update({ status: 'failed', error_message: 'No batches and job aged out', completed_at: new Date().toISOString() })
        .eq('id', job.id);
      return 'guillotined';
    }
    return 'noop';
  }

  const token = await getApifyToken(supabase, job.organization_id);
  if (!token) {
    console.warn(`[apify-leads-poller] no apify token for org ${job.organization_id}`);
    if (jobAgeMs(job) > JOB_MAX_AGE_MS) {
      await guillotineJob(supabase, job, batches, 'Apify API key unavailable and job aged out');
      return 'guillotined';
    }
    return 'noop';
  }

  const runningIdx = batches.findIndex((b) => b.status === 'running');

  // No running batch — either chaining stalled, or finalize was lost.
  if (runningIdx === -1) {
    const firstPending = batches.findIndex((b) => b.status === 'pending');
    if (firstPending === -1) {
      // Everything terminal but the job is still 'running' → finalize was lost.
      await handleBatchComplete(supabase, job as unknown as Record<string, unknown>, batches, batches.length - 1, token, supabaseUrl, encryptionKey);
      return 'finalized';
    }
    // A batch finished but its successor was never launched → resume chaining
    // from the batch just before the first pending one.
    await handleBatchComplete(supabase, job as unknown as Record<string, unknown>, batches, firstPending - 1, token, supabaseUrl, encryptionKey);
    return 'chained';
  }

  const batch = batches[runningIdx];

  if (!batch.apify_run_id) {
    // Can't poll a batch with no run id. Only the job-age backstop can rescue
    // it — without that it would hang forever.
    if (jobAgeMs(job) > JOB_MAX_AGE_MS) {
      await guillotineJob(supabase, job, batches, `In-flight batch has no Apify run id and job exceeded max age (${Math.round(JOB_MAX_AGE_MS / 60000)}min)`);
      return 'guillotined';
    }
    return 'noop';
  }

  const rs = await fetchRunStatus(token, batch.apify_run_id);
  if (!rs) {
    // Transient Apify error — leave it for next tick, unless the job is so old
    // that something is clearly wrong and we can't poll our way out.
    if (jobAgeMs(job) > JOB_MAX_AGE_MS) {
      await guillotineJob(supabase, job, batches, `Apify run unreachable and job exceeded max age (${Math.round(JOB_MAX_AGE_MS / 60000)}min)`);
      return 'guillotined';
    }
    return 'noop';
  }

  if (!TERMINAL_STATUSES.has(rs.status)) {
    // Still running on Apify's side. Healthy unless THIS run has been going far
    // longer than any real leads-finder run would — then it's wedged. Keyed off
    // the run's own startedAt so long multi-batch jobs aren't wrongly killed.
    const runAgeMs = rs.startedAt ? Date.now() - new Date(rs.startedAt).getTime() : 0;
    if (runAgeMs > RUN_STALL_MS) {
      console.warn(`[apify-leads-poller] job ${job.id} batch ${runningIdx} run ${batch.apify_run_id} stalled (${Math.round(runAgeMs / 60000)}min, still ${rs.status})`);
      await failBatch(supabase, {
        job: job as unknown as Record<string, unknown>,
        batches,
        batchIndex: runningIdx,
        errorMessage: `Apify run stalled (${Math.round(runAgeMs / 60000)}min, status ${rs.status})`,
        apifyToken: token,
        supabaseUrl,
        encryptionKey,
      });
      return 'failed_batch';
    }
    return 'noop';
  }

  if (rs.status === 'SUCCEEDED') {
    const finishedAgoMs = rs.finishedAt ? Date.now() - new Date(rs.finishedAt).getTime() : Number.POSITIVE_INFINITY;
    if (finishedAgoMs < WEBHOOK_GRACE_MS) {
      // Finished very recently — give the webhook its chance first.
      console.log(`[apify-leads-poller] job ${job.id} batch ${runningIdx} succeeded ${Math.round(finishedAgoMs / 1000)}s ago, deferring to webhook`);
      return 'noop';
    }
    console.log(`[apify-leads-poller] job ${job.id} batch ${runningIdx}: webhook missed, ingesting (run ${batch.apify_run_id})`);
    await ingestBatchDataset(supabase, {
      job: job as unknown as Record<string, unknown>,
      batches,
      batchIndex: runningIdx,
      datasetId: batch.dataset_id,
      apifyToken: token,
      supabaseUrl,
      encryptionKey,
    });
    return 'ingested';
  }

  // FAILED / ABORTED / TIMED-OUT
  console.warn(`[apify-leads-poller] job ${job.id} batch ${runningIdx} run ${rs.status}`);
  await failBatch(supabase, {
    job: job as unknown as Record<string, unknown>,
    batches,
    batchIndex: runningIdx,
    errorMessage: `Apify run ${rs.status}`,
    apifyToken: token,
    supabaseUrl,
    encryptionKey,
  });
  return 'failed_batch';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: candidates, error } = await supabase
      .from('apify_leads_import_jobs')
      .select('id, organization_id, target_list_id, search_config, total_requested, batch_size, batches, current_batch, status, started_at, created_at')
      .eq('status', 'running')
      .order('created_at', { ascending: true })
      .limit(POLL_BATCH_SIZE);

    if (error) {
      console.error('[apify-leads-poller] select failed', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const jobs = (candidates as ImportJobRow[] | null) ?? [];
    const tally: Record<Outcome, number> = {
      ingested: 0, failed_batch: 0, chained: 0, finalized: 0, guillotined: 0, noop: 0,
    };
    let skippedLocked = 0;

    for (const job of jobs) {
      // Atomic conditional claim. Returns the job id if we won the lock, NULL
      // if another tick holds it (or it's no longer 'running').
      const { data: claimedId, error: claimErr } = await supabase
        .rpc('claim_apify_leads_import_job', { p_job_id: job.id, p_lock_seconds: CLAIM_LOCK_SECONDS });
      if (claimErr) {
        console.error(`[apify-leads-poller] claim rpc failed for job ${job.id}`, claimErr.message);
        continue;
      }
      if (!claimedId) {
        skippedLocked++;
        continue;
      }
      try {
        const outcome = await reconcileJob(supabase, job);
        tally[outcome]++;
      } catch (err) {
        console.error(`[apify-leads-poller] reconcile failed for job ${job.id}`, err instanceof Error ? err.message : err);
      } finally {
        await supabase.rpc('release_apify_leads_import_job', { p_job_id: job.id });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, scanned: jobs.length, skipped_locked: skippedLocked, ...tally }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[apify-leads-poller] fatal', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
