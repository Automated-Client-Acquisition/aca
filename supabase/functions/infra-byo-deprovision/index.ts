/**
 * BYO Deprovision — single endpoint that handles teardown for mailboxes,
 * domains, or full servers. The body's `target_kind` discriminates.
 *
 * Mailbox / domain teardowns enqueue deployer jobs that SSH in and clean up
 * Postfix / Dovecot / OpenDKIM, then delete the DB row. Server teardown is
 * DB-only in v1 — the user is expected to run `apt purge postfix opendkim
 * dovecot` themselves on the box. We do leave deploy_state.deprovisioned_at
 * as a marker so the agent knows to stop reporting.
 *
 * Body:
 *   { organization_id, target_kind: 'mailbox', mailbox_id, delete_maildir? }
 *   { organization_id, target_kind: 'domain',  domain_id,  delete_keys? }
 *   { organization_id, target_kind: 'server',  server_id }
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

interface DeprovisionBody {
  organization_id: string;
  target_kind: 'mailbox' | 'domain' | 'server';
  mailbox_id?: string;
  domain_id?: string;
  server_id?: string;
  delete_maildir?: boolean;
  delete_keys?: boolean;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: DeprovisionBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, target_kind } = body;
  if (!organization_id || !target_kind) {
    return jsonResponse({ success: false, error: 'organization_id and target_kind required' }, 400);
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

  if (target_kind === 'mailbox') {
    if (!body.mailbox_id) return jsonResponse({ success: false, error: 'mailbox_id required' }, 400);
    const { data: mailbox } = await supabase
      .from('email_mailboxes')
      .select('id, organization_id')
      .eq('id', body.mailbox_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!mailbox) return jsonResponse({ success: false, error: 'Mailbox not found' }, 404);

    const { data: existing } = await supabase
      .from('infra_byo_jobs')
      .select('id, status')
      .eq('organization_id', organization_id)
      .eq('job_type', 'deprovision_mailbox')
      .eq('target_kind', 'mailbox')
      .eq('target_id', body.mailbox_id)
      .in('status', ['pending', 'running'])
      .maybeSingle();
    if (existing) {
      return jsonResponse({ success: true, job_id: existing.id, status: existing.status, reused: true });
    }

    try {
      const result = await enqueueByoJob(supabase, {
        organization_id,
        job_type: 'deprovision_mailbox',
        target_kind: 'mailbox',
        target_id: body.mailbox_id,
        input: { delete_maildir: !!body.delete_maildir },
        created_by: userRes.user.id,
      });
      pingByoDeployer(result.job_id).catch(() => {});
      return jsonResponse({ success: true, job_id: result.job_id, status: 'pending', reused: false });
    } catch (e) {
      return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
    }
  }

  if (target_kind === 'domain') {
    if (!body.domain_id) return jsonResponse({ success: false, error: 'domain_id required' }, 400);
    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('id, organization_id, infra_type')
      .eq('id', body.domain_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!domain) return jsonResponse({ success: false, error: 'Domain not found' }, 404);
    if (domain.infra_type !== 'byo') return jsonResponse({ success: false, error: 'Domain is not a BYO domain' }, 400);

    const { data: existing } = await supabase
      .from('infra_byo_jobs')
      .select('id, status')
      .eq('organization_id', organization_id)
      .eq('job_type', 'deprovision_domain')
      .eq('target_kind', 'domain')
      .eq('target_id', body.domain_id)
      .in('status', ['pending', 'running'])
      .maybeSingle();
    if (existing) {
      return jsonResponse({ success: true, job_id: existing.id, status: existing.status, reused: true });
    }

    try {
      const result = await enqueueByoJob(supabase, {
        organization_id,
        job_type: 'deprovision_domain',
        target_kind: 'domain',
        target_id: body.domain_id,
        input: { delete_keys: !!body.delete_keys },
        created_by: userRes.user.id,
      });
      pingByoDeployer(result.job_id).catch(() => {});
      return jsonResponse({ success: true, job_id: result.job_id, status: 'pending', reused: false });
    } catch (e) {
      return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
    }
  }

  if (target_kind === 'server') {
    if (!body.server_id) return jsonResponse({ success: false, error: 'server_id required' }, 400);
    const { data: server } = await supabase
      .from('byo_servers')
      .select('id, organization_id, deploy_state')
      .eq('id', body.server_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);

    // v1 server teardown = mark + delete DB rows. The user runs apt purge.
    // Mark deprovisioned_at so the agent (if still running) can detect.
    await supabase
      .from('byo_servers')
      .update({
        status: 'disconnected',
        deploy_state: {
          ...((server.deploy_state as Record<string, unknown> | null) ?? {}),
          deprovisioned_at: new Date().toISOString(),
        },
      })
      .eq('id', body.server_id);

    // Cascade: cleanup of byo_server_ips happens via FK ON DELETE CASCADE when
    // the row is deleted; mailboxes attached via sending_domain_id get marked
    // disconnected when their domain is removed (Phase 7 deprovision_domain).
    return jsonResponse({ success: true, status: 'disconnected', note: 'Server marked disconnected. Run "apt purge postfix opendkim dovecot" on the server to clean up.' });
  }

  return jsonResponse({ success: false, error: `Unknown target_kind "${target_kind}"` }, 400);
});
