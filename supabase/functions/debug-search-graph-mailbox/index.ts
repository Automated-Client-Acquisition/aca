/**
 * Diagnostic: search one mailbox's inbox directly via Microsoft Graph,
 * bypassing our own delta cursor / subscription state entirely. For checking
 * whether a specific sender's email genuinely exists in the mailbox when our
 * own ingestion pipeline shows nothing — rules out "never arrived" vs.
 * "arrived but wasn't ingested" independent of any bug in our own code.
 *
 * Body: { mailboxId, fromEmail? }
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getM365Token } from '../_shared/m365-client.ts';

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

  let body: { mailboxId?: string; fromEmail?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!body.mailboxId) {
    return new Response(JSON.stringify({ error: 'mailboxId is required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: mb, error } = await supabase
      .from('email_mailboxes')
      .select('id, email_address, sending_domain_id')
      .eq('id', body.mailboxId)
      .maybeSingle();
    if (error || !mb) throw new Error(`Mailbox not found: ${error?.message || body.mailboxId}`);
    if (!mb.sending_domain_id) throw new Error(`Mailbox ${mb.email_address} has no sending_domain_id`);

    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('m365_tenant_id')
      .eq('id', mb.sending_domain_id)
      .maybeSingle();
    if (!domain?.m365_tenant_id) throw new Error(`No m365 tenant row for ${mb.email_address}`);

    const { data: tenant } = await supabase
      .from('m365_tenants')
      .select('tenant_id')
      .eq('id', domain.m365_tenant_id)
      .maybeSingle();
    if (!tenant?.tenant_id) throw new Error(`No tenant_id for ${mb.email_address}`);

    const token = await getM365Token(tenant.tenant_id);

    // Graph rejects $filter on from/emailAddress/address combined with
    // $orderby ("InefficientFilter") unless ConsistencyLevel:eventual is
    // set — and even then, ordering isn't guaranteed on that filter shape.
    // Drop $orderby for the filtered case; result count is small enough
    // (mailbox inbox, one sender) that order doesn't matter for this check.
    let url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mb.email_address)}/mailFolders('inbox')/messages?$select=id,subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=25`;
    if (body.fromEmail) {
      url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mb.email_address)}/mailFolders('inbox')/messages?$filter=${encodeURIComponent(`from/emailAddress/address eq '${body.fromEmail}'`)}&$select=id,subject,from,receivedDateTime,bodyPreview&$top=25`;
    }

    const graphRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body.fromEmail ? { ConsistencyLevel: 'eventual' } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    const graphBody = await graphRes.json();
    if (!graphRes.ok) {
      throw new Error(`Graph search failed (${graphRes.status}): ${JSON.stringify(graphBody)}`);
    }

    const messages = (graphBody.value || []).map((m: any) => ({
      id: m.id,
      subject: m.subject,
      from: m.from?.emailAddress?.address,
      receivedDateTime: m.receivedDateTime,
      bodyPreview: m.bodyPreview,
    }));

    return new Response(JSON.stringify({ mailbox: mb.email_address, filter: body.fromEmail || null, count: messages.length, messages }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[Debug Search Graph Mailbox] Failed:', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
