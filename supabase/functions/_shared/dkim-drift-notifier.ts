/**
 * DKIM Drift Notifier
 *
 * Sends a transactional email to org owners/admins when a domain's DKIM signing
 * has drifted (Microsoft rotated partitions, EXO dropped Status: Valid, etc.).
 *
 * Two narratives, picked by the `mode` param:
 *   - 'auto_healed':  ACA already pushed the new CNAMEs to the registrar; the email
 *                     is informational ("we fixed it for you, here's what changed").
 *   - 'action_required': BYO domain — the customer needs to update their DNS manually.
 *                     The email lists the new CNAMEs to publish.
 *
 * No-op (logs only) when RESEND_API_KEY is missing.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { fromAddress } from "./site-config.ts";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
}

interface DriftEmailParams {
  domainId: string;
  domain: string;
  organizationId: string;
  mode: 'auto_healed' | 'action_required';
  newSelectorRecords: DnsRecord[];
  exoStatus: string | null;
  pushedRecordCount?: number;
}

export interface NotifyResult {
  sent: boolean;
  recipients: string[];
  reason?: string;
}

export async function getOrgRecipients(supabase: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('organization_id', organizationId)
    .in('role', ['owner', 'admin'])
    .eq('is_active', true);

  if (error || !data) return [];
  return data.map((u) => u.email).filter((e): e is string => Boolean(e));
}

function renderRecordsTable(records: DnsRecord[]): string {
  const rows = records
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px">${r.type}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all">${r.name}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all">${r.value}</td>
      </tr>`,
    )
    .join('');
  return `
    <table style="border-collapse:collapse;width:100%;margin:16px 0">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;font-size:13px">Type</th>
          <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;font-size:13px">Name</th>
          <th style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left;font-size:13px">Value</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildEmail(params: DriftEmailParams): { subject: string; html: string } {
  const { domain, mode, newSelectorRecords, exoStatus, pushedRecordCount } = params;

  if (mode === 'auto_healed') {
    return {
      subject: `Action handled: DKIM records updated for ${domain}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
          <h1 style="font-size:20px;margin:0 0 16px">DKIM signing was re-registered for ${domain}</h1>
          <p style="line-height:1.6">Microsoft 365 silently moved <strong>${domain}</strong> to a new DKIM signing partition. This breaks email signing until the DNS records point at the new target.</p>
          <p style="line-height:1.6"><strong>You don't need to do anything</strong> — because this domain is registered under your ACA-managed registrar account, we already pushed ${pushedRecordCount ?? 'the'} updated CNAME record${pushedRecordCount === 1 ? '' : 's'} for you. Microsoft typically completes its propagation check within a few hours, after which DKIM will resume signing automatically.</p>
          <p style="line-height:1.6">For reference, here are the new records we published:</p>
          ${renderRecordsTable(newSelectorRecords)}
          <p style="line-height:1.6;font-size:13px;color:#6b7280">EXO status at time of detection: <code>${exoStatus ?? 'unknown'}</code>. We'll re-check tomorrow morning and confirm signing has resumed.</p>
          <p style="line-height:1.6;margin-top:24px">— The ACA team</p>
        </div>`,
    };
  }

  return {
    subject: `Action required: DKIM records need updating for ${domain}`,
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827">
        <h1 style="font-size:20px;margin:0 0 16px">Your DKIM records for ${domain} need updating</h1>
        <p style="line-height:1.6">Microsoft 365 silently moved <strong>${domain}</strong> to a new DKIM signing partition. Until you update the DNS, your outbound mail will leave unsigned and inboxes will start flagging it.</p>
        <p style="line-height:1.6">Because this domain is hosted at a registrar we don't manage on your behalf, you'll need to publish the new CNAME values at your DNS provider:</p>
        ${renderRecordsTable(newSelectorRecords)}
        <p style="line-height:1.6">Replace the existing <code>selector1._domainkey</code> and <code>selector2._domainkey</code> CNAMEs with the values above. Once propagated (usually 5-30 minutes), open the domain in ACA and click <strong>Repair DKIM</strong> — we'll re-verify and signing will resume.</p>
        <p style="line-height:1.6;font-size:13px;color:#6b7280">EXO status at time of detection: <code>${exoStatus ?? 'unknown'}</code>.</p>
        <p style="line-height:1.6;margin-top:24px">— The ACA team</p>
      </div>`,
  };
}

export async function notifyDkimDrift(
  supabase: SupabaseClient,
  params: DriftEmailParams,
): Promise<NotifyResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn(`[dkim-drift-notifier] RESEND_API_KEY missing — skipping notification for ${params.domain}`);
    return { sent: false, recipients: [], reason: 'missing_api_key' };
  }

  const recipients = await getOrgRecipients(supabase, params.organizationId);
  if (recipients.length === 0) {
    console.warn(`[dkim-drift-notifier] no owner/admin recipients for org ${params.organizationId} — skipping`);
    return { sent: false, recipients: [], reason: 'no_recipients' };
  }

  const from = Deno.env.get('DKIM_DRIFT_FROM_EMAIL')
    ?? Deno.env.get('TENANT_ORDER_FROM_EMAIL')
    ?? fromAddress("team");

  const { subject, html } = buildEmail(params);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, html }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[dkim-drift-notifier] Resend failed for ${params.domain}: ${res.status} ${text}`);
      return { sent: false, recipients, reason: `http_${res.status}` };
    }
    console.log(`[dkim-drift-notifier] sent ${params.mode} email for ${params.domain} to ${recipients.length} recipient(s)`);
    return { sent: true, recipients };
  } catch (e) {
    console.error(`[dkim-drift-notifier] network error for ${params.domain}:`, e);
    return { sent: false, recipients, reason: 'network_error' };
  }
}
