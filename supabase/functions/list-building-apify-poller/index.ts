/**
 * Apify Run Poller.
 *
 * Cron-invoked every 2 minutes. For each pack_refresh_jobs row whose
 * apify_runs array contains entries with status='pending', this function:
 *
 *   1. GET https://api.apify.com/v2/actor-runs/{run_id}?token=...
 *      to check status.
 *   2. If SUCCEEDED → fetch dataset items → translate via the pack module's
 *      mapRecord() → run through processDiscoveryRecords (ICP score, persist,
 *      enqueue stage='dm'). Mark the apify_runs entry as 'webhook_received'.
 *   3. If FAILED / TIMED_OUT / ABORTED → mark entry 'failed', append error.
 *   4. Once every entry is in a terminal state, close out the refresh_job
 *      (status='completed' or 'failed', finished_at=now).
 *
 * Architecture choice: polling instead of Apify webhooks. Webhook setup
 * requires per-org HMAC secret management; polling is simpler, works the
 * same way, and a 2-min latency penalty is fine for daily/weekly cadences.
 *
 * Idempotent: an entry already in a terminal status is skipped.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { getPackDefinition } from '../_shared/list-building/pack-modules/registry.ts';
import {
  processDiscoveryRecords,
  type PackSubscriptionRow,
} from '../_shared/list-building/discovery-pipeline.ts';
import type { DiscoveryRecord } from '../_shared/list-building/pack-modules/types.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const POLL_BATCH_SIZE = 20;
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED']);
// Guillotine: if a run has been pending this long, assume it's wedged and
// fail it instead of asking Apify yet again. Prevents the 2-min poller cron
// from re-fetching the same dataset for days when the post-ingest status
// write times out. 60 min is well above any realistic SignalBase run time.
const RUN_MAX_AGE_MS = 60 * 60 * 1000;

interface ApifyRunEntry {
  run_id: string;
  dataset_id: string;
  module_key: string;
  signal_type: string;
  source: string;
  status: 'pending' | 'webhook_received' | 'failed';
  started_at: string;
  finished_at?: string;
  error?: string | null;
  items_processed?: number;
}

interface RefreshJobRow {
  id: string;
  organization_id: string;
  subscription_id: string;
  list_building_job_id: string | null;
  apify_runs: ApifyRunEntry[];
  status: string;
  contacts_added: number;
  contacts_skipped: number;
  errors: unknown[];
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

async function fetchRunStatus(token: string, runId: string): Promise<{ status: string; finished_at: string | null } | null> {
  const url = `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(`[apify-poller] runs/${runId} ${resp.status}`);
    return null;
  }
  const json = await resp.json();
  const data = (json as { data?: Record<string, unknown> }).data ?? (json as Record<string, unknown>);
  return {
    status: (data.status as string) ?? 'UNKNOWN',
    finished_at: (data.finishedAt as string) ?? null,
  };
}

async function fetchDatasetItems(token: string, datasetId: string): Promise<Record<string, unknown>[]> {
  const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json&clean=true`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.warn(`[apify-poller] dataset ${datasetId} ${resp.status}: ${txt.slice(0, 200)}`);
    return [];
  }
  const json = await resp.json();
  return Array.isArray(json) ? (json as Record<string, unknown>[]) : [];
}

async function loadSubscription(supabase: SupabaseClient, subId: string): Promise<PackSubscriptionRow | null> {
  const { data } = await supabase
    .from('pack_subscriptions')
    .select(
      'id, organization_id, pack_key, tier, config, refresh_cadence, lead_list_id, last_refreshed_at, '
      + 'icp_id, icp_product_id, min_icp_score, review_band, destination_type, destination_id, daily_cap, weekly_cap',
    )
    .eq('id', subId)
    .maybeSingle();
  return (data as PackSubscriptionRow | null) ?? null;
}

// Persist a single run's terminal status immediately so a downstream timeout
// in processDiscoveryRecords can't cause the next poller tick to re-fetch the
// same dataset. Reads the current row, replaces the matching run by run_id,
// writes back. Best-effort: on failure we still continue (worst case = the
// guillotine catches it later).
async function markRunStatus(
  supabase: SupabaseClient,
  jobId: string,
  runId: string,
  patch: Partial<ApifyRunEntry>,
): Promise<void> {
  const { data, error } = await supabase
    .from('pack_refresh_jobs')
    .select('apify_runs')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) {
    console.warn(`[apify-poller] markRunStatus select failed for ${jobId}`, error?.message);
    return;
  }
  const runs = (data as { apify_runs: ApifyRunEntry[] | null }).apify_runs ?? [];
  const updated = runs.map((r) => (r.run_id === runId ? { ...r, ...patch } : r));
  const { error: updateErr } = await supabase
    .from('pack_refresh_jobs')
    .update({ apify_runs: updated })
    .eq('id', jobId);
  if (updateErr) {
    console.warn(`[apify-poller] markRunStatus update failed for ${jobId}/${runId}`, updateErr.message);
  }
}

async function processOneRefreshJob(
  supabase: SupabaseClient,
  job: RefreshJobRow,
): Promise<{ progressed: boolean; finalized: boolean }> {
  const token = await getApifyToken(supabase, job.organization_id);
  if (!token) {
    console.warn(`[apify-poller] no apify token for org ${job.organization_id}`);
    return { progressed: false, finalized: false };
  }

  const sub = await loadSubscription(supabase, job.subscription_id);
  if (!sub) return { progressed: false, finalized: false };

  const pack = getPackDefinition(sub.pack_key);
  if (!pack) return { progressed: false, finalized: false };

  let progressed = false;
  const updatedRuns: ApifyRunEntry[] = [];

  for (const run of job.apify_runs) {
    if (run.status !== 'pending') {
      updatedRuns.push(run);
      continue;
    }

    // Guillotine: any pending run older than RUN_MAX_AGE_MS is presumed dead.
    // Mark it failed locally + persist immediately so we don't fetch Apify
    // for it again on the next tick.
    const ageMs = Date.now() - new Date(run.started_at).getTime();
    if (ageMs > RUN_MAX_AGE_MS) {
      console.warn(`[apify-poller] run ${run.run_id} aged out (${Math.round(ageMs / 60000)}min)`);
      const failed: ApifyRunEntry = {
        ...run,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: 'run_aged_out',
        items_processed: 0,
      };
      updatedRuns.push(failed);
      await markRunStatus(supabase, job.id, run.run_id, failed);
      progressed = true;
      continue;
    }

    const runStatus = await fetchRunStatus(token, run.run_id);
    if (!runStatus) {
      // Transient error — leave entry pending, retry next tick.
      updatedRuns.push(run);
      continue;
    }
    if (!TERMINAL_STATUSES.has(runStatus.status)) {
      // Still running.
      updatedRuns.push(run);
      continue;
    }

    progressed = true;

    if (runStatus.status !== 'SUCCEEDED') {
      console.warn(`[apify-poller] run ${run.run_id} ${runStatus.status}`);
      const failed: ApifyRunEntry = {
        ...run,
        status: 'failed',
        finished_at: runStatus.finished_at ?? new Date().toISOString(),
        error: runStatus.status,
        items_processed: 0,
      };
      updatedRuns.push(failed);
      await markRunStatus(supabase, job.id, run.run_id, failed);
      continue;
    }

    // Fetch dataset items.
    const items = await fetchDatasetItems(token, run.dataset_id);
    console.log(`[apify-poller] run ${run.run_id} succeeded, dataset has ${items.length} items`);

    if (items.length === 0) {
      const done: ApifyRunEntry = {
        ...run,
        status: 'webhook_received',
        finished_at: runStatus.finished_at ?? new Date().toISOString(),
        items_processed: 0,
      };
      updatedRuns.push(done);
      await markRunStatus(supabase, job.id, run.run_id, done);
      continue;
    }

    // Find the pack module that produced this run so we can translate items.
    const mod = pack.modules.find((m) => m.key === run.module_key);
    if (!mod || !mod.mapRecord) {
      console.warn(`[apify-poller] module ${run.module_key} not found or has no mapRecord`);
      const failed: ApifyRunEntry = {
        ...run,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: 'module_mapping_missing',
        items_processed: 0,
      };
      updatedRuns.push(failed);
      await markRunStatus(supabase, job.id, run.run_id, failed);
      continue;
    }

    const records: DiscoveryRecord[] = [];
    for (const raw of items) {
      const mapped = mod.mapRecord(raw, {
        signalType: run.signal_type,
        moduleKey: run.module_key,
        sourceLabel: run.source,
      });
      if (mapped) records.push(mapped);
    }

    if (records.length === 0) {
      const done: ApifyRunEntry = {
        ...run,
        status: 'webhook_received',
        finished_at: runStatus.finished_at ?? new Date().toISOString(),
        items_processed: 0,
      };
      updatedRuns.push(done);
      await markRunStatus(supabase, job.id, run.run_id, done);
      continue;
    }

    // Hand off to the shared pipeline (same code path as the sync flow).
    if (!job.list_building_job_id) {
      console.warn('[apify-poller] refresh job has no list_building_job_id; cannot persist');
      const failed: ApifyRunEntry = {
        ...run,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: 'no_list_building_job_id',
        items_processed: 0,
      };
      updatedRuns.push(failed);
      await markRunStatus(supabase, job.id, run.run_id, failed);
      continue;
    }

    // CRITICAL: mark webhook_received BEFORE the LLM-scoring loop. If
    // processDiscoveryRecords times out (sequential OpenRouter calls × ~100
    // records is the original failure mode), the run still must not get
    // re-fetched on the next tick. We trade "this batch's records might be
    // lost on crash" for "we will never re-ingest the same dataset twice."
    const claimed: ApifyRunEntry = {
      ...run,
      status: 'webhook_received',
      finished_at: runStatus.finished_at ?? new Date().toISOString(),
    };
    await markRunStatus(supabase, job.id, run.run_id, claimed);

    const outcome = await processDiscoveryRecords(supabase, sub, job.list_building_job_id, records);
    console.log(`[apify-poller] run ${run.run_id} processed: ${JSON.stringify(outcome)}`);

    updatedRuns.push({
      ...claimed,
      items_processed: outcome.persisted_company_ids.length,
    });
    await markRunStatus(supabase, job.id, run.run_id, {
      items_processed: outcome.persisted_company_ids.length,
    });

    // Append per-run errors to the refresh-job error log.
    if (outcome.errors.length > 0) {
      job.errors = [...(job.errors ?? []), ...outcome.errors];
    }
    // Bump contacts_added so the UI reflects the trickle of arrivals.
    job.contacts_added = (job.contacts_added ?? 0) + outcome.enrolled + outcome.review_pending;
    job.contacts_skipped = (job.contacts_skipped ?? 0) + outcome.dropped_below_threshold;
  }

  // Apply updates.
  const allTerminal = updatedRuns.every((r) => r.status !== 'pending');
  const anyFailed = updatedRuns.some((r) => r.status === 'failed');
  const finalized = allTerminal;

  await supabase
    .from('pack_refresh_jobs')
    .update({
      apify_runs: updatedRuns,
      contacts_added: job.contacts_added,
      contacts_skipped: job.contacts_skipped,
      errors: job.errors,
      ...(finalized
        ? {
            status: anyFailed && job.contacts_added === 0 ? 'failed' : 'completed',
            finished_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', job.id);

  // If finalized, also mark the underlying list_building_jobs row done.
  if (finalized && job.list_building_job_id) {
    await supabase
      .from('list_building_jobs')
      .update({
        status: anyFailed && job.contacts_added === 0 ? 'failed' : 'completed',
        progress: 100,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.list_building_job_id);
  }

  return { progressed, finalized };
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

    // Select all running refresh jobs that have at least one entry in
    // apify_runs. We filter to "has pending run" client-side rather than
    // using PostgREST's JSONB contains (which is finicky with array shape).
    const { data: candidateJobs, error } = await supabase
      .from('pack_refresh_jobs')
      .select('id, organization_id, subscription_id, list_building_job_id, apify_runs, status, contacts_added, contacts_skipped, errors')
      .eq('status', 'running')
      .neq('apify_runs', '[]')
      .order('created_at', { ascending: true })
      .limit(POLL_BATCH_SIZE * 3);

    if (error) {
      console.error('[apify-poller] select failed', error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const all = (candidateJobs as RefreshJobRow[] | null) ?? [];
    const jobs = all
      .filter((j) => Array.isArray(j.apify_runs) && j.apify_runs.some((r) => r.status === 'pending'))
      .slice(0, POLL_BATCH_SIZE);

    let progressedCount = 0;
    let finalizedCount = 0;
    let skippedLocked = 0;
    for (const job of jobs) {
      // Atomic conditional claim via RPC. PostgREST's .or(...) syntax
      // can't handle ISO-8601 timestamps cleanly (the colons are parsed
      // as separators), so we delegate to a SECURITY DEFINER plpgsql
      // function. Returns the job id if we won the race, NULL otherwise.
      const { data: claimedId, error: claimErr } = await supabase
        .rpc('claim_pack_refresh_job', { p_job_id: job.id, p_lock_seconds: 300 });
      if (claimErr) {
        console.error(`[apify-poller] claim rpc failed for job ${job.id}`, claimErr.message);
        continue;
      }
      if (!claimedId) {
        skippedLocked++;
        continue;
      }
      try {
        const { progressed, finalized } = await processOneRefreshJob(supabase, job);
        if (progressed) progressedCount += 1;
        if (finalized) finalizedCount += 1;
      } finally {
        await supabase.rpc('release_pack_refresh_job', { p_job_id: job.id });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        scanned: jobs.length,
        progressed: progressedCount,
        finalized: finalizedCount,
        skipped_locked: skippedLocked,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[apify-poller] fatal', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
