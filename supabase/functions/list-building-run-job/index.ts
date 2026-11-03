import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
// pipeline.ts is imported dynamically below only when LB_RUN_INLINE=1,
// otherwise the module graph is too heavy to boot in the edge runtime.

/**
 * Runs the List Building pipeline for a single job.
 * Idempotent: if the job is already in a terminal state, returns { ok: true } immediately.
 * Invoked by create-job (fire-and-forget) and by the recovery cron (every 1 min).
 *
 * Default behavior (ScrapeBox mode): enqueues the initial discovery work item into
 * `lb_work_items` and returns — the Fly workers take it from there.
 *
 * Legacy mode: if env `LB_RUN_INLINE=1`, runs the in-process pipeline as before
 * (useful for local dev without workers).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  // Callers: list-building-create-job (service client) and the recovery SQL function (service key).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const inlineMode = Deno.env.get('LB_RUN_INLINE') === '1';
    const supabase = createClient(supabaseUrl, serviceKey);

    const { job_id } = await req.json();
    if (!job_id) {
      return new Response(JSON.stringify({ error: 'job_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: job } = await supabase
      .from('list_building_jobs')
      .select('id, organization_id, status, updated_at, query, icp_id, worker_config')
      .eq('id', job_id)
      .single();

    if (!job) {
      return new Response(JSON.stringify({ error: 'job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: `status=${job.status}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (job.status === 'running') {
      const staleMs = Date.now() - new Date(job.updated_at as string).getTime();
      if (staleMs < 2 * 60_000) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'fresh_heartbeat' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (inlineMode) {
      // Legacy inline pipeline for local dev - dynamic import to avoid
      // loading the full pipeline graph at boot in queue mode.
      const { runListBuildingPipeline } = await import('../_shared/list-building/pipeline.ts');
      runListBuildingPipeline(job_id, supabase).then(
        () => {},
        (err) => console.error('[lb-run-job] inline pipeline error', err),
      );
      return new Response(JSON.stringify({ ok: true, mode: 'inline' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Queue mode: enqueue the initial discovery work item and mark the job running.
    // Idempotent: skip if a pending/claimed discovery item already exists for this job.
    const { data: existing } = await supabase
      .from('lb_work_items')
      .select('id')
      .eq('job_id', job_id)
      .eq('stage', 'discovery')
      .in('status', ['pending', 'claimed'])
      .limit(1);

    if (!existing || existing.length === 0) {
      const payload = {
        query: job.query,
        icp_id: job.icp_id,
        worker_config: job.worker_config ?? {},
      };
      const { error: insertErr } = await supabase.from('lb_work_items').insert({
        job_id,
        organization_id: job.organization_id,
        stage: 'discovery',
        payload,
        priority: 5,
      });
      if (insertErr) throw insertErr;
    }

    await supabase
      .from('list_building_jobs')
      .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', job_id)
      .neq('status', 'running');

    return new Response(JSON.stringify({ ok: true, mode: 'queue' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-run-job] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
