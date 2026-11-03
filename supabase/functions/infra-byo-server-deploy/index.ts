/**
 * BYO Server Deploy — kicks off the deploy_base job after connect succeeded.
 *
 * The deployer service runs apt install postfix opendkim dovecot ufw fail2ban,
 * writes base configs, and flips byo_servers.status to 'ready'.
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

interface DeployBody { organization_id: string; server_id: string }

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: DeployBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, server_id } = body;
  if (!organization_id || !server_id) return jsonResponse({ success: false, error: 'organization_id and server_id required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, status, port25_verified')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (serverErr) return jsonResponse({ success: false, error: serverErr.message }, 500);
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);
  if (!server.port25_verified) {
    return jsonResponse({ success: false, error: 'Server has not passed connect validation. Run validate first.' }, 400);
  }

  // Idempotency: if a deploy_base job is already running/pending, return it.
  const { data: existing } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'deploy_base')
    .eq('target_kind', 'server')
    .eq('target_id', server_id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return jsonResponse({ success: true, job_id: existing.id, status: existing.status, reused: true });

  await supabase.from('byo_servers').update({ status: 'deploying', last_error: null }).eq('id', server_id);

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'deploy_base',
      target_kind: 'server',
      target_id: server_id,
      // admin_email lets deploy_base auto-chain install_tls on success so the
      // user doesn't have to remember to click "Install TLS" before the first
      // send (lack of TLS = test sends fail with snakeoil-cert TLS rejection).
      input: { admin_email: userRes.user.email ?? null },
      created_by: userRes.user.id,
      max_attempts: 2,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({ success: true, job_id, status: 'pending', reused: false });
});
