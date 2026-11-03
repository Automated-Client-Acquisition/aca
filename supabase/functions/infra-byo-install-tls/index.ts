/**
 * BYO Install TLS — issues a Let's Encrypt cert for the server's HELO hostname
 * and swaps Postfix + Dovecot to use it. Required for inbound TLS reputation
 * with Gmail / Yahoo / Outlook (snakeoil cert is a deliverability soft-signal).
 *
 * Body: { organization_id, server_id, admin_email }
 *
 * The server's hostname (used as HELO) must already have an A record
 * pointing to one of the server's IPs. The script verifies this before
 * running certbot.
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

interface InstallTlsBody {
  organization_id: string;
  server_id: string;
  admin_email: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: InstallTlsBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, server_id, admin_email } = body;
  if (!organization_id || !server_id || !admin_email) {
    return jsonResponse({ success: false, error: 'organization_id, server_id, admin_email required' }, 400);
  }
  if (!EMAIL_RE.test(admin_email.trim())) {
    return jsonResponse({ success: false, error: 'admin_email must be a valid email address' }, 400);
  }

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

  const { data: server } = await supabase
    .from('byo_servers')
    .select('id, status')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);
  if (server.status !== 'ready' && server.status !== 'degraded') {
    return jsonResponse({ success: false, error: `Server status is "${server.status}". Deploy first.` }, 400);
  }

  // Idempotency on the job side.
  const { data: existing } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'install_tls')
    .eq('target_kind', 'server')
    .eq('target_id', server_id)
    .in('status', ['pending', 'running'])
    .maybeSingle();
  if (existing) {
    return jsonResponse({ success: true, job_id: existing.id, status: existing.status, reused: true });
  }

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'install_tls',
      target_kind: 'server',
      target_id: server_id,
      input: { admin_email: admin_email.trim() },
      created_by: userRes.user.id,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({ success: true, job_id, status: 'pending', reused: false });
});
