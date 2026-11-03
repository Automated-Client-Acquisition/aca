import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Workers call this to bulk-enqueue the next stage after a batch finishes.
 * Service-role only.
 *
 * POST { job_id: UUID, stage: 'discovery'|'dm'|'pattern'|'smtp'|'icp', payloads: any[], depends_on?: number, priority?: number }
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('authorization') || '';
    const apiKeyHeader = req.headers.get('apikey') || '';
    const presented = authHeader.replace(/^Bearer\s+/i, '') || apiKeyHeader;
    if (presented !== serviceKey) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

    const body = await req.json();
    const { job_id, stage, payloads, depends_on, priority } = body ?? {};

    if (!job_id || !stage || !Array.isArray(payloads)) {
      return new Response(JSON.stringify({ error: 'job_id, stage, payloads[] required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const validStages = ['discovery', 'dm', 'pattern', 'smtp', 'icp'];
    if (!validStages.includes(stage)) {
      return new Response(JSON.stringify({ error: `stage must be one of ${validStages.join(',')}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payloads.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up organization_id from the parent job (single query).
    const { data: job, error: jobErr } = await supabase
      .from('list_building_jobs')
      .select('organization_id')
      .eq('id', job_id)
      .single();
    if (jobErr || !job) {
      return new Response(JSON.stringify({ error: 'job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rows = payloads.map((p: unknown) => ({
      job_id,
      organization_id: job.organization_id,
      stage,
      payload: p,
      priority: priority ?? 5,
      depends_on: depends_on ?? null,
    }));

    // Chunk inserts to keep payloads under ~1MB.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('lb_work_items').insert(slice);
      if (error) throw error;
      inserted += slice.length;
    }

    return new Response(JSON.stringify({ ok: true, inserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-enqueue-next] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
