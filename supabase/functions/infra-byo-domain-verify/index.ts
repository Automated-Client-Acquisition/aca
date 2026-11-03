/**
 * BYO Domain DNS Verify — re-resolves SPF / DKIM / DMARC TXT records via DoH
 * (Cloudflare + Google) and updates email_sending_domains verification flags.
 *
 * Synchronous (no job queue) — DNS lookups are fast and don't need long-running
 * SSH. Reuses _shared/dns-utils.ts which is the same path the M365 verify uses.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { verifyDnsRecord } from '../_shared/dns-utils.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

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

interface VerifyBody { organization_id: string; domain_id: string }

interface DnsRecordRow {
  type: 'A' | 'TXT' | 'MX' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  ttl: number;
  verified: boolean;
  description?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: VerifyBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, domain_id } = body;
  if (!organization_id || !domain_id) return jsonResponse({ success: false, error: 'organization_id and domain_id required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  // Membership alone missed agency client orgs and super-admin impersonation.
  try {
    await assertOrgAccess(req, supabase, organization_id);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }

  const { data: domain, error: domainErr } = await supabase
    .from('email_sending_domains')
    .select('id, domain, infra_type, dns_records, dkim_selector')
    .eq('id', domain_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (domainErr) return jsonResponse({ success: false, error: domainErr.message }, 500);
  if (!domain) return jsonResponse({ success: false, error: 'Domain not found' }, 404);
  if (domain.infra_type !== 'byo') {
    return jsonResponse({ success: false, error: `Domain is "${domain.infra_type}" — use the matching verify endpoint` }, 400);
  }

  const records = (domain.dns_records as DnsRecordRow[] | null) ?? [];
  if (records.length === 0) {
    return jsonResponse({ success: false, error: 'No DNS records to verify yet — provision the domain first' }, 400);
  }

  // Verify each record in parallel (DoH is fast and we only have 3-4 records).
  const verified = await Promise.all(records.map(async (r) => {
    const result = await verifyDnsRecord({ type: r.type, name: r.name, value: r.value, priority: r.priority });
    return { ...r, verified: result.ok, foundValue: result.foundValue, error: result.error };
  }));

  const isSpf   = (r: DnsRecordRow) => r.type === 'TXT' && r.value.startsWith('v=spf1');
  const isDkim  = (r: DnsRecordRow) => r.type === 'TXT' && r.name.includes('._domainkey.');
  const isDmarc = (r: DnsRecordRow) => r.type === 'TXT' && (r.name.startsWith('_dmarc.') || r.name.startsWith('_dmarc'));

  const isMx    = (r: DnsRecordRow) => r.type === 'MX';

  const spfVerified   = verified.find(isSpf)?.verified   ?? false;
  const dkimVerified  = verified.find(isDkim)?.verified  ?? false;
  const dmarcVerified = verified.find(isDmarc)?.verified ?? false;
  // A domain provisioned before MX generation existed has no MX row at all —
  // absent is not verified, otherwise it reports healthy while dropping every
  // reply. Re-provision the domain to generate the record.
  const mxVerified    = verified.find(isMx)?.verified    ?? false;

  const allVerified = verified.every((r) => r.verified) && mxVerified;
  const dnsStatus = allVerified ? 'verified' : (dkimVerified && spfVerified && !dmarcVerified ? 'dkim_pending' : 'records_generated');

  // Persist the per-record verification flags so the existing DNS dialog UI
  // shows the green check badges for verified records.
  await supabase
    .from('email_sending_domains')
    .update({
      dns_records: verified.map(({ foundValue: _f, error: _e, ...keep }) => keep),
      spf_verified: spfVerified,
      dkim_verified: dkimVerified,
      dmarc_verified: dmarcVerified,
      mx_verified: mxVerified,
      dns_status: dnsStatus,
      last_dns_check_at: new Date().toISOString(),
    })
    .eq('id', domain.id);

  return jsonResponse({
    success: true,
    dns_status: dnsStatus,
    spf_verified: spfVerified,
    dkim_verified: dkimVerified,
    dmarc_verified: dmarcVerified,
    mx_verified: mxVerified,
    mx_missing: !verified.some(isMx),
    records: verified,
  });
});
