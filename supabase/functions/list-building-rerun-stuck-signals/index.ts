/**
 * Re-run stuck signals + finalize stuck pack-refresh jobs.
 *
 * Two responsibilities, run on the same 5-min cron because they share
 * "scan for things stuck in the signal pipeline" framing:
 *
 * 1. Stuck signals (original):
 *    - signal_activity_log.outcome = 'enrolled'
 *    - signal_activity_log.exported_at IS NULL
 *    - the corresponding company has 0 lb_decision_makers
 *
 *    For each, insert a fresh stage='dm' lb_work_items row pointing at
 *    the existing list_building_jobs row (re-using the same job_id).
 *
 * 2. Stuck pack-refresh jobs (added 2026-05-22):
 *    - pack_refresh_jobs.status = 'running'
 *    - started_at < NOW() - 2h
 *    - has at least one apify_runs[*].status = 'pending'
 *
 *    Mark the job 'failed' and flip every still-pending run to 'failed'.
 *    Without this, a wedged poller (post-ingest status-write timeout) would
 *    re-fetch the same Apify dataset every 2 min indefinitely — exactly
 *    the bug we triaged on 2026-05-21 (3 jobs, 48K spam rows, ~1.2K wasted
 *    Apify pulls). The poller now has its own 60-min guillotine, but a 2h
 *    backstop here covers any case where the poller itself can't run
 *    (deploy gap, edge-function outage, lock stuck open, etc.).
 *
 * Idempotent: a fresh pending dm work_item for the same company_id is
 * skipped; a refresh job already in a terminal state is skipped.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

interface StuckRow {
  signal_id: number;
  organization_id: string;
  discovered_company_id: string;
  job_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
}

async function findStuckSignals(
  supabase: SupabaseClient,
  organizationId?: string,
): Promise<StuckRow[]> {
  // Two-step: first the enrolled-not-exported signals + their company
  // metadata, then filter down to only those with zero lb_decision_makers.
  // Skip dm_dead companies and ones that have already burned the attempt cap
  // (mirrors recover_stuck_dm_signals — see migration 20260612000000).
  let q = supabase
    .from('signal_activity_log')
    .select(`
      id,
      organization_id,
      discovered_company_id,
      lb_discovered_companies!inner (
        id, job_id, company_name, domain, website_url, linkedin_url,
        dm_dead, dm_attempt_count
      )
    `)
    .eq('outcome', 'enrolled')
    .is('exported_at', null);
  if (organizationId) q = q.eq('organization_id', organizationId);
  const { data, error } = await q;
  if (error) {
    console.error('[rerun-stuck] select failed', error);
    return [];
  }
  type Row = {
    id: number;
    organization_id: string;
    discovered_company_id: string;
    lb_discovered_companies: {
      id: string;
      job_id: string;
      company_name: string;
      domain: string | null;
      website_url: string | null;
      linkedin_url: string | null;
      dm_dead: boolean | null;
      dm_attempt_count: number | null;
    };
  };
  const rows = (data ?? []) as unknown as Row[];

  const result: StuckRow[] = [];
  for (const r of rows) {
    const c = r.lb_discovered_companies;
    if (!c) continue;
    if (c.dm_dead) continue;
    if ((c.dm_attempt_count ?? 0) >= 3) continue;
    const { count } = await supabase
      .from('lb_decision_makers')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', c.id);
    if ((count ?? 0) > 0) continue;
    result.push({
      signal_id: r.id,
      organization_id: r.organization_id,
      discovered_company_id: c.id,
      job_id: c.job_id,
      company_name: c.company_name,
      domain: c.domain,
      website_url: c.website_url,
      linkedin_url: c.linkedin_url,
    });
  }
  return result;
}

async function enqueueDmIfNotPending(
  supabase: SupabaseClient,
  row: StuckRow,
): Promise<'enqueued' | 'already_pending' | 'recent_attempt' | 'no_targets'> {
  // Don't double-queue.
  const { data: existing } = await supabase
    .from('lb_work_items')
    .select('id')
    .eq('stage', 'dm')
    .eq('status', 'pending')
    .contains('payload', { company_id: row.discovered_company_id })
    .limit(1);
  if ((existing as Array<{ id: number }> | null)?.length) {
    return 'already_pending';
  }

  // Don't re-enqueue if there's been any dm attempt in the last 7d — even
  // a completed-with-zero-results one. Matches the discovery-pipeline and
  // recover_stuck_dm_signals guards (migration 20260612000000).
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data: recent } = await supabase
    .from('lb_work_items')
    .select('id')
    .eq('stage', 'dm')
    .gte('created_at', sevenDaysAgo)
    .contains('payload', { company_id: row.discovered_company_id })
    .limit(1);
  if ((recent as Array<{ id: number }> | null)?.length) {
    return 'recent_attempt';
  }

  if (!row.linkedin_url && !row.website_url) return 'no_targets';

  const { error } = await supabase.from('lb_work_items').insert({
    job_id: row.job_id,
    organization_id: row.organization_id,
    stage: 'dm',
    status: 'pending',
    payload: {
      company_id: row.discovered_company_id,
      company_name: row.company_name,
      domain: row.domain,
      website_url: row.website_url,
      linkedin_url: row.linkedin_url,
    },
    priority: 8, // higher than fresh pack-refresh dm items so the rerun
                  // path drains first.
  });
  if (error) {
    console.warn('[rerun-stuck] insert work_item failed', error);
    return 'no_targets';
  }
  return 'enqueued';
}

// Finalize any pack_refresh_jobs row whose Apify poller has been wedged for
// > MAX_REFRESH_AGE_MS. Marks the row 'failed' and every still-pending
// apify_runs entry 'failed' so the poller stops re-fetching the dataset.
const MAX_REFRESH_AGE_MS = 2 * 60 * 60 * 1000;

interface ApifyRunEntry {
  run_id: string;
  status: 'pending' | 'webhook_received' | 'failed';
  started_at: string;
  finished_at?: string;
  error?: string | null;
  items_processed?: number;
  [key: string]: unknown;
}

async function finalizeStuckRefreshJobs(supabase: SupabaseClient): Promise<{
  scanned: number;
  finalized: number;
}> {
  const cutoff = new Date(Date.now() - MAX_REFRESH_AGE_MS).toISOString();
  const { data, error } = await supabase
    .from('pack_refresh_jobs')
    .select('id, organization_id, subscription_id, apify_runs, started_at, errors, list_building_job_id')
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .neq('apify_runs', '[]');
  if (error) {
    console.error('[rerun-stuck] refresh-jobs select failed', error);
    return { scanned: 0, finalized: 0 };
  }
  const rows = (data as Array<{
    id: string;
    organization_id: string;
    subscription_id: string;
    apify_runs: ApifyRunEntry[] | null;
    started_at: string;
    errors: unknown[] | null;
    list_building_job_id: string | null;
  }> | null) ?? [];

  let finalized = 0;
  for (const row of rows) {
    const runs = Array.isArray(row.apify_runs) ? row.apify_runs : [];
    const hasPending = runs.some((r) => r.status === 'pending');
    if (!hasPending) continue;
    const failedRuns = runs.map((r) =>
      r.status === 'pending'
        ? { ...r, status: 'failed' as const, finished_at: new Date().toISOString(), error: 'watchdog_aged_out' }
        : r,
    );
    const { error: updateErr } = await supabase
      .from('pack_refresh_jobs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        apify_runs: failedRuns,
        errors: [
          ...(Array.isArray(row.errors) ? row.errors : []),
          `watchdog finalized: refresh job stuck > ${Math.round(MAX_REFRESH_AGE_MS / 60000)}min`,
        ],
      })
      .eq('id', row.id);
    if (updateErr) {
      console.warn(`[rerun-stuck] watchdog update failed for refresh job ${row.id}`, updateErr.message);
      continue;
    }
    if (row.list_building_job_id) {
      await supabase
        .from('list_building_jobs')
        .update({
          status: 'failed',
          progress: 100,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.list_building_job_id);
    }
    console.log(`[rerun-stuck] watchdog finalized refresh job ${row.id} (sub ${row.subscription_id})`);
    finalized += 1;
  }
  return { scanned: rows.length, finalized };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let organizationId: string | undefined;
    let subscriptionId: string | undefined;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body && typeof body.organization_id === 'string') organizationId = body.organization_id;
        if (body && typeof body.subscription_id === 'string') subscriptionId = body.subscription_id;
      } catch {
        // body optional
      }
    }

    // If subscription_id is provided, scope to that subscription's org.
    if (subscriptionId && !organizationId) {
      const { data: sub } = await supabase
        .from('pack_subscriptions')
        .select('organization_id')
        .eq('id', subscriptionId)
        .maybeSingle();
      organizationId = (sub as { organization_id?: string } | null)?.organization_id;
    }

    // The service-role client acts on the org named by the body (or its
    // subscription), so the caller must be able to access it. With no org this
    // scans every org, which only the cron (service key) may do.
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const stuck = await findStuckSignals(supabase, organizationId);
    const counts: Record<string, number> = {
      enqueued: 0,
      already_pending: 0,
      recent_attempt: 0,
      no_targets: 0,
    };

    for (const row of stuck) {
      const r = await enqueueDmIfNotPending(supabase, row);
      counts[r] += 1;
    }

    // Watchdog runs unscoped — Apify-poller wedge can hit any org and we
    // want it killed everywhere on every tick, not only when the cron
    // happens to be invoked for that org.
    const watchdog = await finalizeStuckRefreshJobs(supabase);

    return new Response(
      JSON.stringify({
        ok: true,
        scope: organizationId ? `org:${organizationId}` : 'all_orgs',
        stuck_signals_found: stuck.length,
        ...counts,
        watchdog_refresh_jobs_scanned: watchdog.scanned,
        watchdog_refresh_jobs_finalized: watchdog.finalized,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[rerun-stuck] fatal', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
