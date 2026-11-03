/**
 * Diagnostic: send one email from mailbox A to mailbox B via Graph, for
 * manually verifying the Graph-webhook pilot (graph-mail-webhook /
 * infra-graph-subscription-sync / aca-imap-poller's /webhook-poll) end to
 * end against a real inbound message rather than just a subscription
 * validation handshake. Not part of the ingestion pipeline itself — a
 * one-off verification tool, same category as this repo's other test-*
 * functions (test-blueprint, test-replicate-call).
 *
 * Body: { fromMailboxId, toMailboxId, subject?, text? } — both must be
 * m365-connected email_mailboxes rows.
 *
 * Or { fromMailboxId, toEmails: string[], subject, text } to send one message
 * per external address (e.g. an EmailGuard / GlockApps seed list for an
 * inbox-placement test over the real Graph send path).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { sendEmailViaGraph } from '../_shared/m365-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const configuredSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET');
  if (!configuredSecret || req.headers.get('x-internal-secret') !== configuredSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { fromMailboxId?: string; toMailboxId?: string; toEmails?: string[]; subject?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const toEmails = (body.toEmails || []).map((e) => e.trim()).filter(Boolean);
  if (!body.fromMailboxId || (!body.toMailboxId && !toEmails.length)) {
    return new Response(JSON.stringify({ error: 'fromMailboxId and toMailboxId (or toEmails) are required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const from = await loadSenderMailbox(supabase, body.fromMailboxId);

    if (toEmails.length) {
      if (!body.subject || !body.text) throw new Error('subject and text are required with toEmails');
      const results = [];
      for (const toEmail of toEmails) {
        const r = await sendEmailViaGraph({
          tenantId: from.tenantId,
          senderUserId: from.email_address,
          toEmail,
          subject: body.subject,
          text: body.text,
        });
        results.push({ to: toEmail, success: r.success, error: r.success ? undefined : r.error });
      }
      return new Response(JSON.stringify({ from: from.email_address, subject: body.subject, results }), {
        status: results.every((r) => r.success) ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const to = await loadRecipientMailbox(supabase, body.toMailboxId!);

    const subject = body.subject || `Graph webhook pilot test ${new Date().toISOString()}`;
    const text = body.text || `Verifying graph-mail-webhook end to end: this message was sent by debug-send-graph-test-email from ${from.email_address} to ${to.email_address}.`;

    const result = await sendEmailViaGraph({
      tenantId: from.tenantId,
      senderUserId: from.email_address,
      toEmail: to.email_address,
      subject,
      text,
    });

    if (!result.success) {
      return new Response(JSON.stringify({ error: result.error, code: result.code }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      status: 'sent',
      from: from.email_address,
      to: to.email_address,
      toMailboxId: to.id,
      subject,
      sentAt: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Debug Send Test Email] Failed:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function resolveTenantId(supabase: SupabaseClient, sendingDomainId: string): Promise<string | null> {
  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('m365_tenant_id')
    .eq('id', sendingDomainId)
    .maybeSingle();
  if (!domain?.m365_tenant_id) return null;

  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('id', domain.m365_tenant_id)
    .maybeSingle();
  return tenant?.tenant_id || null;
}

async function loadSenderMailbox(supabase: SupabaseClient, mailboxId: string) {
  const { data: mb, error } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, connection_type, sending_domain_id')
    .eq('id', mailboxId)
    .maybeSingle();
  if (error || !mb) throw new Error(`Sender mailbox not found: ${error?.message || mailboxId}`);
  if (mb.connection_type !== 'm365') throw new Error(`Sender ${mb.email_address} is not m365`);
  if (!mb.sending_domain_id) throw new Error(`Sender ${mb.email_address} has no sending_domain_id`);
  const tenantId = await resolveTenantId(supabase, mb.sending_domain_id);
  if (!tenantId) throw new Error(`No tenant_id for sender ${mb.email_address}`);
  return { id: mb.id, email_address: mb.email_address, tenantId };
}

async function loadRecipientMailbox(supabase: SupabaseClient, mailboxId: string) {
  const { data: mb, error } = await supabase
    .from('email_mailboxes')
    .select('id, email_address')
    .eq('id', mailboxId)
    .maybeSingle();
  if (error || !mb) throw new Error(`Recipient mailbox not found: ${error?.message || mailboxId}`);
  return mb;
}
