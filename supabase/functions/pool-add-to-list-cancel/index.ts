// ============================================================================
// pool-add-to-list-cancel
// ----------------------------------------------------------------------------
// Cancel a pending/running pool_add_to_list_jobs row. The worker
// (process-pool-add-to-list) re-checks status every batch and only writes
// its progress/self-kick back when status is still 'pending' or 'running'
// (see that function's write-back guard), so flipping status here reliably
// stops it within one in-flight batch.
//
// Body: { job_id: UUID }
//
// pool_add_to_list_jobs only allows UPDATE from the service role (RLS), so
// this can't be done as a plain client-side .update() — it needs an edge
// function to authenticate the caller and act with the service key.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // --- auth --------------------------------------------------------------
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization' }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid token' }, 401);
    }

    // --- body --------------------------------------------------------------
    const body = await req.json() as { job_id?: string };
    if (!body.job_id) {
      return json({ error: 'job_id is required' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // --- membership check ----------------------------------------------------
    const { data: job, error: jobErr } = await supabase
      .from('pool_add_to_list_jobs')
      .select('id, organization_id, status')
      .eq('id', body.job_id)
      .single();
    if (jobErr || !job) {
      return json({ error: 'job not found' }, 404);
    }

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .eq('organization_id', job.organization_id)
      .maybeSingle();
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    if (job.status !== 'pending' && job.status !== 'running') {
      return json({ error: `job already ${job.status}` }, 409);
    }

    // --- cancel ---------------------------------------------------------------
    const { data: updated, error: updateErr } = await supabase
      .from('pool_add_to_list_jobs')
      .update({ status: 'cancelled', completed_at: new Date().toISOString() })
      .eq('id', body.job_id)
      .in('status', ['pending', 'running'])
      .select('id, status')
      .single();
    if (updateErr || !updated) {
      return json({ error: 'job already finished, cancel raced with completion' }, 409);
    }

    return json({ cancelled: true, job_id: updated.id });
  } catch (err) {
    console.error('[pool-add-to-list-cancel] error', err);
    return json({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
