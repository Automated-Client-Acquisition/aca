import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

interface CreateJobBody {
  name: string;
  icp_id?: string;
  query: { niche: string; geo: string; sources?: string[]; employee_range?: string; limit?: number };
  target_list_id?: string;
  worker_config?: Record<string, unknown>;
}

async function resolveOrgId(supabase: SupabaseClient<any>, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  return (data as { organization_id: string } | null)?.organization_id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '');

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const orgId = await resolveOrgId(supabase, userData.user.id);
    if (!orgId) {
      return new Response(JSON.stringify({ error: 'No organization for user' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = (await req.json()) as CreateJobBody;
    if (!body?.name || !body?.query?.niche) {
      return new Response(JSON.stringify({ error: 'name and query.niche required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: job, error: insErr } = await supabase
      .from('list_building_jobs')
      .insert({
        organization_id: orgId,
        name: body.name,
        icp_id: body.icp_id ?? null,
        query: body.query,
        target_list_id: body.target_list_id ?? null,
        worker_config: body.worker_config ?? {},
        status: 'pending',
      })
      .select('id')
      .single();

    if (insErr || !job) {
      return new Response(JSON.stringify({ error: insErr?.message ?? 'insert failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fire and forget: kick off the run without awaiting.
    supabase.functions
      .invoke('list-building-run-job', { body: { job_id: job.id } })
      .then(() => {}, (err) => console.error('[lb-create-job] invoke run failed', err));

    return new Response(JSON.stringify({ job_id: job.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-create-job] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
