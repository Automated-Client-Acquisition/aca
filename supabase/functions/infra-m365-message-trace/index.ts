/**
 * M365 Message Trace — read-only deliverability forensics.
 *
 * Answers the question SMTP success can't: after Microsoft accepted the message,
 * did it actually relay it to the recipient, or did outbound filtering quarantine
 * / drop it? `email_send_log` only records that our SMTP handoff succeeded — a
 * tenant flagged for outbound spam still returns 250 and then silently discards.
 *
 * Runs Get-MessageTraceV2 (falls back to the retired v1 cmdlet) per tenant via
 * the EXO Admin REST API. Read-only: no cmdlet here mutates tenant state.
 *
 * Body: { organization_id, mailbox_ids: string[], start: ISO, end: ISO, recipient?: string }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getEXOToken, exoInvokeCommand } from '../_shared/m365-client.ts';

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: {
    organization_id: string;
    mailbox_ids: string[];
    start: string;
    end: string;
    recipient?: string;
    detail?: boolean;
    dkim?: boolean;
  };
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const { organization_id, mailbox_ids, start, end, recipient, detail, dkim } = body;
  if (!organization_id || !Array.isArray(mailbox_ids) || !mailbox_ids.length || !start || !end) {
    return jsonResponse({ success: false, error: 'organization_id, mailbox_ids[], start, end required' }, 400);
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

  const { data: mailboxes, error: mboxErr } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, metadata')
    .eq('organization_id', organization_id)
    .in('id', mailbox_ids);
  if (mboxErr) return jsonResponse({ success: false, error: mboxErr.message }, 500);
  if (!mailboxes?.length) return jsonResponse({ success: false, error: 'No mailboxes found' }, 404);

  const results: unknown[] = [];

  for (const mbox of mailboxes) {
    const adminEmail = (mbox.metadata as Record<string, unknown>)?.m365_admin_email as string | undefined;
    const entry: Record<string, unknown> = { mailbox_id: mbox.id, sender: mbox.email_address };

    if (!adminEmail) {
      results.push({ ...entry, error: 'mailbox has no m365_admin_email in metadata' });
      continue;
    }

    const { data: tenant } = await supabase
      .from('m365_tenants')
      .select('tenant_id, onmicrosoft_domain, exo_consent_granted')
      .eq('admin_email', adminEmail)
      .maybeSingle();

    if (!tenant?.tenant_id) {
      results.push({ ...entry, error: `no m365_tenants row for admin ${adminEmail}` });
      continue;
    }
    entry.tenant_id = tenant.tenant_id;
    if (!tenant.exo_consent_granted) {
      results.push({ ...entry, error: 'EXO consent not granted for this tenant' });
      continue;
    }

    try {
      const token = await getEXOToken(tenant.tenant_id as string);

      // A published DKIM CNAME proves nothing on its own — Exchange can have
      // signing disabled while the DNS records sit there looking correct.
      // Get-DkimSigningConfig is the authoritative answer for whether outbound
      // mail from this domain is actually being signed.
      if (dkim) {
        const senderDomain = (mbox.email_address as string).split('@')[1];
        try {
          const dk = await exoInvokeCommand(
            token, tenant.tenant_id as string, tenant.onmicrosoft_domain as string,
            'Get-DkimSigningConfig', { Identity: senderDomain }
          );
          const cfg = Array.isArray(dk?.value) ? dk.value[0] : dk?.value;
          entry.dkim = cfg ? {
            Domain: cfg.Domain,
            Enabled: cfg.Enabled,
            Status: cfg.Status,
            // Both selectors matter: the CNAME values Exchange expects are
            // minted per signing-config, so a stale stored value silently
            // yields Status=CnameMissing.
            Selector1CNAME: cfg.Selector1CNAME,
            Selector2CNAME: cfg.Selector2CNAME,
            LastChecked: cfg.LastChecked,
          } : { error: 'no DkimSigningConfig returned' };
        } catch (dkerr) {
          entry.dkim = { error: (dkerr as Error).message };
        }
      }

      const params: Record<string, unknown> = {
        SenderAddress: mbox.email_address,
        StartDate: start,
        EndDate: end,
      };
      if (recipient) params.RecipientAddress = recipient;

      // v1 Get-MessageTrace was retired; try V2 first and fall back so this
      // keeps working on tenants that still expose the old cmdlet.
      let raw: any;
      let cmdlet = 'Get-MessageTraceV2';
      try {
        raw = await exoInvokeCommand(token, tenant.tenant_id as string, tenant.onmicrosoft_domain as string, cmdlet, params);
      } catch (v2err) {
        cmdlet = 'Get-MessageTrace';
        try {
          raw = await exoInvokeCommand(token, tenant.tenant_id as string, tenant.onmicrosoft_domain as string, cmdlet, params);
        } catch (v1err) {
          results.push({
            ...entry,
            error: `V2: ${(v2err as Error).message} | V1: ${(v1err as Error).message}`,
          });
          continue;
        }
      }

      const rows = Array.isArray(raw?.value) ? raw.value : raw?.value ? [raw.value] : [];

      const mapped = [];
      for (const r of rows) {
        const row: Record<string, unknown> = {
          Received: r.Received,
          RecipientAddress: r.RecipientAddress,
          Subject: r.Subject,
          Status: r.Status,
          Detail: r.Detail ?? null,
          MessageId: r.MessageId,
          MessageTraceId: r.MessageTraceId,
        };

        // The per-event detail carries the remote server's actual SMTP response
        // — the only thing that distinguishes "Microsoft blocked it on the way
        // out" from "the recipient's server rejected it".
        if (detail && r.MessageTraceId) {
          try {
            const d = await exoInvokeCommand(
              token,
              tenant.tenant_id as string,
              tenant.onmicrosoft_domain as string,
              cmdlet === 'Get-MessageTraceV2' ? 'Get-MessageTraceDetailV2' : 'Get-MessageTraceDetail',
              {
                MessageTraceId: r.MessageTraceId,
                RecipientAddress: r.RecipientAddress,
              }
            );
            const dr = Array.isArray(d?.value) ? d.value : d?.value ? [d.value] : [];
            row.events = dr.map((e: any) => ({
              Date: e.Date,
              Event: e.Event,
              Action: e.Action,
              Detail: e.Detail,
            }));
          } catch (derr) {
            row.detail_error = (derr as Error).message;
          }
        }
        mapped.push(row);
      }

      results.push({ ...entry, cmdlet, row_count: rows.length, rows: mapped });
    } catch (err) {
      results.push({ ...entry, error: (err as Error).message });
    }
  }

  return jsonResponse({ success: true, window: { start, end }, results });
});
