/**
 * BYO Server Validate — Step 3 of the wizard.
 *
 * Enqueues a 'connect' job: the deployer SSHes in, fingerprints the host key,
 * confirms sudo access, and tests outbound port 25 connectivity to
 * gmail-smtp-in.l.google.com:25 from the user's server.
 *
 * Returns the job id; the frontend subscribes to infra_byo_jobs realtime
 * updates to stream the log into the wizard.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';

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

interface ValidateBody {
  organization_id: string;
  server_id: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: ValidateBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }

  const { organization_id, server_id } = body;
  if (!organization_id || !server_id) {
    return jsonResponse({ success: false, error: 'organization_id and server_id are required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ success: false, error: 'Server is not configured' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // Auth: caller must belong to the organization.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ success: false, error: 'Missing Authorization header' }, 401);
  }
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  // Ensure the server exists and is in a valid state to validate.
  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, status, organization_id')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (serverErr) return jsonResponse({ success: false, error: serverErr.message }, 500);
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);

  // Idempotency: if a connect job is already running or pending for this
  // server, return it instead of stacking duplicates.
  const { data: existing } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'connect')
    .eq('target_kind', 'server')
    .eq('target_id', server_id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return jsonResponse({ success: true, job_id: existing.id, status: existing.status, reused: true });
  }

  // Flip server status to 'connecting' so the UI reflects activity.
  await supabase
    .from('byo_servers')
    .update({ status: 'connecting', last_error: null })
    .eq('id', server_id)
    .eq('organization_id', organization_id);

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'connect',
      target_kind: 'server',
      target_id: server_id,
      input: {},
      created_by: userRes.user.id,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse(
      { success: false, error: e instanceof Error ? e.message : 'Failed to enqueue job' },
      500,
    );
  }

  // Best-effort wake the deployer immediately. Falls back to NOTIFY otherwise.
  pingByoDeployer(job_id).catch(() => {});

  return jsonResponse({ success: true, job_id, status: 'pending', reused: false });
});
