// ============================================================================
// pool-add-to-list
// ----------------------------------------------------------------------------
// Enqueue a background job that adds all leads matching a pool-search query
// into a lead list. Returns {job_id} immediately. The actual paginate +
// upsert + member-insert work is done by the cron-driven
// process-pool-add-to-list function (1-minute tick).
//
// Body:
//   {
//     target_list_id: UUID,           // existing lead_lists.id
//     query_body:     <pool-search>,  // same shape as list-building-pool-search
//   }
//
// The job persists in pool_add_to_list_jobs. The UI polls that table for
// progress (see usePoolAddToListJob).
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
    const body = await req.json() as {
      target_list_id?: string;
      query_body?: Record<string, unknown>;
    };
    if (!body.target_list_id) {
      return json({ error: 'target_list_id is required' }, 400);
    }
    if (!body.query_body || typeof body.query_body !== 'object') {
      return json({ error: 'query_body is required' }, 400);
    }

    // --- resolve org from the target list ---------------------------------
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: list, error: listErr } = await supabase
      .from('lead_lists')
      .select('id, organization_id')
      .eq('id', body.target_list_id)
      .single();
    if (listErr || !list) {
      return json({ error: 'lead list not found' }, 404);
    }

    // Membership check: user must belong to the list's org.
    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .eq('organization_id', list.organization_id)
      .maybeSingle();
    if (!membership) {
      return json({ error: 'forbidden' }, 403);
    }

    // --- enqueue -----------------------------------------------------------
    const { data: job, error: jobErr } = await supabase
      .from('pool_add_to_list_jobs')
      .insert({
        organization_id: list.organization_id,
        target_list_id: list.id,
        created_by: userData.user.id,
        query_body: body.query_body,
        status: 'pending',
      })
      .select('id')
      .single();
    if (jobErr || !job) {
      console.error('[pool-add-to-list] job insert failed', jobErr);
      return json({ error: jobErr?.message ?? 'job insert failed' }, 500);
    }

    // Fire the processor immediately (don't wait for the 1-minute cron tick)
    // so the user sees progress within seconds. Don't await — fire-and-forget.
    fetch(`${supabaseUrl}/functions/v1/process-pool-add-to-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ source: 'enqueue', job_id: job.id }),
    }).catch((e) => console.warn('[pool-add-to-list] processor kick failed', e));

    return json({ job_id: job.id });
  } catch (err) {
    console.error('[pool-add-to-list] error', err);
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
