/**
 * BYO Mailbox Provision — Phase 4 entry point.
 *
 * Inserts a placeholder email_mailboxes row with connection_type='smtp' and
 * sending_domain_id pointing at the BYO domain, then enqueues a
 * provision_mailbox job. The deployer SSHes in, creates the Maildir, sets the
 * Dovecot password, postmaps virtual_mailboxes, and writes encrypted SMTP+IMAP
 * credentials back to the email_mailboxes row.
 *
 * Once that completes, the existing send pipeline (email-rotation +
 * smtp-client) and IMAP poller (email-imap-poller) light up automatically —
 * no parallel system needed.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';
import { pickStickyIp } from '../_shared/byo/ip-rotation.ts';

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

interface ProvisionMailboxBody {
  organization_id: string;
  domain_id: string;
  username: string;       // local part
  display_name: string;
  daily_limit?: number;
}

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: ProvisionMailboxBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, domain_id, username, display_name, daily_limit = 5 } = body;

  if (!organization_id || !domain_id || !username || !display_name) {
    return jsonResponse({ success: false, error: 'organization_id, domain_id, username, display_name required' }, 400);
  }
  const normalizedUsername = username.trim().toLowerCase();
  if (!USERNAME_RE.test(normalizedUsername)) {
    return jsonResponse({ success: false, error: 'Username must be lowercase alphanumeric (with . _ -). 1-64 chars.' }, 400);
  }
  if (display_name.trim().length === 0 || display_name.length > 80) {
    return jsonResponse({ success: false, error: 'display_name must be 1-80 chars' }, 400);
  }
  if (!Number.isInteger(daily_limit) || daily_limit < 1 || daily_limit > 200) {
    return jsonResponse({ success: false, error: 'daily_limit must be between 1 and 200' }, 400);
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

  // Verify domain belongs to org and is a deployed BYO domain.
  const { data: domain, error: domainErr } = await supabase
    .from('email_sending_domains')
    .select('id, domain, infra_type, byo_server_id, dns_status, max_mailboxes, mailbox_count')
    .eq('id', domain_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (domainErr) return jsonResponse({ success: false, error: domainErr.message }, 500);
  if (!domain) return jsonResponse({ success: false, error: 'Domain not found' }, 404);
  if (domain.infra_type !== 'byo') return jsonResponse({ success: false, error: 'Domain is not a BYO domain' }, 400);
  if (!domain.byo_server_id) return jsonResponse({ success: false, error: 'Domain not attached to a BYO server' }, 400);
  if ((domain.mailbox_count ?? 0) >= (domain.max_mailboxes ?? 150)) {
    return jsonResponse({ success: false, error: `Domain has reached its mailbox limit (${domain.max_mailboxes})` }, 400);
  }

  const emailAddress = `${normalizedUsername}@${domain.domain}`;

  // Idempotency: if a mailbox row already exists for this address, reuse it.
  // The deployer's add-mailbox.sh rotates the password on re-run, so this is safe.
  const { data: existing } = await supabase
    .from('email_mailboxes')
    .select('id, status, connection_type, sending_domain_id')
    .eq('organization_id', organization_id)
    .eq('email_address', emailAddress)
    .maybeSingle();

  let mailboxId: string;
  if (existing) {
    if (existing.connection_type !== 'smtp') {
      return jsonResponse({ success: false, error: `Mailbox already exists with connection_type "${existing.connection_type}"` }, 409);
    }
    if (existing.sending_domain_id && existing.sending_domain_id !== domain_id) {
      return jsonResponse({ success: false, error: 'Mailbox already attached to a different domain' }, 409);
    }
    mailboxId = existing.id as string;
    await supabase
      .from('email_mailboxes')
      .update({
        display_name,
        sending_domain_id: domain_id,
        connection_type: 'smtp',
        provider: 'smtp',
        status: 'warming',
        daily_limit,
        last_error: null,
      })
      .eq('id', mailboxId);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('email_mailboxes')
      .insert({
        organization_id,
        email_address: emailAddress,
        display_name,
        connection_type: 'smtp',
        provider: 'smtp',
        sending_domain_id: domain_id,
        status: 'warming',
        warmup_day: 0,
        daily_limit,
        daily_sent: 0,
        warmup_start_date: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insertErr) {
      return jsonResponse({ success: false, error: `Failed to create mailbox row: ${insertErr.message}` }, 500);
    }
    mailboxId = (inserted as { id: string }).id;
  }

  // Idempotency on the job side too.
  const { data: existingJob } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'provision_mailbox')
    .eq('target_kind', 'mailbox')
    .eq('target_id', mailboxId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingJob) {
    return jsonResponse({ success: true, mailbox_id: mailboxId, job_id: existingJob.id, status: existingJob.status, reused: true });
  }

  // Pick a sticky outbound IP for this mailbox before enqueueing — the
  // deployer writes the sender_transport entry as part of provision_mailbox.
  // Falls back to the server's primary IP if no IP is registered yet.
  let stickyIp: { ip_id: string; ip_address: string; ptr_verified: boolean } | null = null;
  try {
    stickyIp = await pickStickyIp(supabase, {
      organization_id,
      server_id: domain.byo_server_id as string,
      domain_id,
    });
    if (stickyIp && !stickyIp.ptr_verified) {
      console.warn(`[byo-mailbox-provision] Selected unverified PTR IP ${stickyIp.ip_address} for mailbox ${mailboxId} — set reverse DNS at the hosting provider.`);
    }
  } catch (e) {
    // Non-fatal — log and proceed with default routing.
    console.error('[byo-mailbox-provision] pickStickyIp failed', e);
  }

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'provision_mailbox',
      target_kind: 'mailbox',
      target_id: mailboxId,
      input: {
        server_id: domain.byo_server_id,
        domain_id,
        email_address: emailAddress,
        ...(stickyIp ? { sticky_ip_id: stickyIp.ip_id, sticky_ip_address: stickyIp.ip_address } : {}),
      },
      created_by: userRes.user.id,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({
    success: true,
    mailbox_id: mailboxId,
    job_id,
    status: 'pending',
    reused: false,
    sticky_ip: stickyIp,
  });
});
