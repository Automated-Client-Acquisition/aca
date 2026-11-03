import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Live throughput telemetry for a list building job.
 * GET ?job_id=<uuid> returns per-stage counts/rates, active workers, and MX hotspots.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    if (!jobId) {
      return new Response(JSON.stringify({ error: 'job_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Per-stage in-flight + throughput counts from lb_work_items
    const stages = ['discovery', 'dm', 'pattern', 'smtp', 'icp'] as const;
    const perStage: Record<string, {
      pending: number;
      in_flight: number;
      completed: number;
      failed: number;
      dead: number;
      per_sec: number;
    }> = {};

    const sinceIso = new Date(Date.now() - 60_000).toISOString();

    for (const stage of stages) {
      const [pending, claimed, completed, failed, dead, recent] = await Promise.all([
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'pending'),
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'claimed'),
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'completed'),
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'failed'),
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'dead'),
        supabase.from('lb_work_items').select('id', { count: 'exact', head: true })
          .eq('job_id', jobId).eq('stage', stage).eq('status', 'completed')
          .gte('completed_at', sinceIso),
      ]);

      perStage[stage] = {
        pending: pending.count ?? 0,
        in_flight: claimed.count ?? 0,
        completed: completed.count ?? 0,
        failed: failed.count ?? 0,
        dead: dead.count ?? 0,
        per_sec: Math.round(((recent.count ?? 0) / 60) * 100) / 100,
      };
    }

    // Active workers (heartbeat within last 30s)
    const liveSince = new Date(Date.now() - 30_000).toISOString();
    const { data: workers } = await supabase
      .from('lb_worker_heartbeats')
      .select('worker_id, kind, last_seen_at, current_job_id, in_flight_items, throughput_per_sec')
      .gte('last_seen_at', liveSince)
      .order('last_seen_at', { ascending: false })
      .limit(50);

    // MX hotspots — top by rate_limit_hits in the last 5 minutes.
    const mxSince = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: mxRows } = await supabase
      .from('lb_mx_throughput')
      .select('mx_host, attempts, successes, rate_limit_hits')
      .gte('minute_bucket', mxSince);

    const mxAgg = new Map<string, { attempts: number; successes: number; rate_limit_hits: number }>();
    for (const r of mxRows ?? []) {
      const prev = mxAgg.get(r.mx_host) ?? { attempts: 0, successes: 0, rate_limit_hits: 0 };
      prev.attempts += r.attempts ?? 0;
      prev.successes += r.successes ?? 0;
      prev.rate_limit_hits += r.rate_limit_hits ?? 0;
      mxAgg.set(r.mx_host, prev);
    }
    const mxHotspots = Array.from(mxAgg.entries())
      .map(([mx_host, v]) => ({ mx_host, ...v }))
      .sort((a, b) => b.rate_limit_hits - a.rate_limit_hits || b.attempts - a.attempts)
      .slice(0, 5);

    return new Response(JSON.stringify({
      job_id: jobId,
      per_stage: perStage,
      workers: workers ?? [],
      mx_hotspots: mxHotspots,
      generated_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-throughput] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
