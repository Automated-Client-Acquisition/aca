/**
 * Shared DMARC rua collector lookup + cross-domain authorization.
 *
 * Every _dmarc TXT record generated for a new M365 sending domain used to
 * default to rua=mailto:dmarc@<domain> — a mailbox nobody ever provisions.
 * Every aggregate report to every domain that got that default has been
 * silently bounced. The fix is one shared collector mailbox per org
 * (dmarc_collector_mailboxes); this module is what lets new-domain
 * provisioning stay compliant automatically instead of needing this retrofit
 * again for every future domain.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/** The org's active shared DMARC collector mailbox address, if one exists. */
export async function getActiveDmarcCollectorEmail(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('dmarc_collector_mailboxes')
    .select('email_address')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return (data as { email_address: string } | null)?.email_address ?? null;
}

/**
 * Ensure the RFC 7489 §7.1 external-destination authorization record exists
 * on the collector mailbox's own zone for a newly provisioned reporting
 * domain — without it, receivers silently discard rua reports sent off-domain.
 *
 * Best-effort and non-fatal by design: provisioning a new sending domain must
 * not fail because a DNS write on a *different* domain's zone failed. Callers
 * should log the result, not throw on it.
 *
 * Routes through the `registrar-dns` edge function's `create_dns_record`
 * action rather than talking to a registrar API directly, so it inherits
 * that function's real production credential resolution (an org's Porkbun
 * key lives encrypted in `api_keys`, not in a Deno.env secret — there is no
 * PORKBUN_API_KEY env var in this project). Only works today because the one
 * collector mailbox in use (dmarc-reports@qualificationlab.com) sits on a
 * Porkbun-hosted zone with a valid `api_keys` row for `organizationId`; if
 * the collector ever moves to a Cloudflare-hosted domain this needs whatever
 * `create_dns_record`-equivalent Cloudflare gets, since registrar-dns only
 * resolves Porkbun today.
 */
export async function ensureDmarcAuthorizationRecord(
  collectorEmail: string,
  reportingDomain: string,
  organizationId: string,
): Promise<{ attempted: boolean; success: boolean; error?: string }> {
  const collectorDomain = collectorEmail.split('@')[1]?.toLowerCase();
  if (!collectorDomain || collectorDomain === reportingDomain.toLowerCase()) {
    return { attempted: false, success: true };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return { attempted: false, success: false, error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not available' };
  }

  const name = `${reportingDomain.toLowerCase()}._report._dmarc.${collectorDomain}`;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/registrar-dns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify({
        action: 'create_dns_record',
        organization_id: organizationId,
        domain: collectorDomain,
        record: { type: 'TXT', name, value: 'v=DMARC1', ttl: 3600 },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.success === false) {
      return { attempted: true, success: false, error: body?.error || `registrar-dns HTTP ${res.status}` };
    }
    return { attempted: true, success: true };
  } catch (e) {
    return { attempted: true, success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
