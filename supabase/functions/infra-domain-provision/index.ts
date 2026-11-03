/**
 * M365 Domain Provisioning Edge Function
 *
 * Manages custom email domains on M365 tenants via MS Graph API.
 *
 * Actions:
 *   provision   — Add domain to M365 tenant, get DNS verification records
 *   status      — Check domain verification status
 *   refresh_dns — Re-fetch DNS records from Graph and merge into stored records
 *   verify_dns  — Trigger DNS verification at Microsoft
 *   repair_dkim — Re-run Enable-DkimSigningConfig for a verified domain (fixes silent enable failures)
 *   delete      — Remove domain + all its users from tenant
 *   replace     — Provision replacement domain for a burned domain
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  addDomainToTenant,
  getDomainVerificationRecords,
  getDomainServiceRecords,
  getDomainStatus,
  verifyDomain,
  deleteDomain,
  listDomainUsers,
  deleteM365User,
  generateM365DnsRecords,
  getDkimSigningConfig,
  enableDkimSigning,
  buildDkimDnsRecords,
  M365Error,
  type DnsRecord,
} from '../_shared/m365-client.ts';
import { createRegistrarClient } from '../_shared/registrar-client.ts';
import { pushDkimToDnsProvider } from '../_shared/registrar-push.ts';
import { getActiveDmarcCollectorEmail, ensureDmarcAuthorizationRecord } from '../_shared/dmarc-collector.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/**
 * Build the 2 predictable DKIM CNAMEs for an M365 domain.
 *
 * Used as a fallback only — the source of truth is EXO Get-DkimSigningConfig.
 * Microsoft uses two infrastructures:
 *   - Modern (post-2024 tenants): <prefix>.<partition>-v1.dkim.mail.microsoft (e.g. d-v1, p-v1)
 *   - Legacy: <prefix>.onmicrosoft.com — no longer signs mail for new tenants
 *
 * We can't determine the partition without asking EXO, but `d-v1` is the dominant
 * one for new tenants, so it's the safest guess. If the tenant actually uses `p-v1`
 * (or another partition), enrichWithDkim will REPLACE these records the moment EXO
 * responds with the real value (see line 158-178 below). The legacy onmicrosoft.com
 * format must never be the predictable fallback — it silently 404s for new tenants.
 */
function buildPredictableDkimRecords(domain: string, onmicrosoftDomain: string): DnsRecord[] {
  const onmicrosoftPrefix = onmicrosoftDomain.replace('.onmicrosoft.com', '');
  const domainDashes = domain.replace(/\./g, '-');
  return [
    {
      type: 'CNAME',
      name: `selector1._domainkey.${domain}`,
      value: `selector1-${domainDashes}._domainkey.${onmicrosoftPrefix}.d-v1.dkim.mail.microsoft`,
      ttl: 3600,
      verified: false,
      description: 'DKIM selector 1 - cryptographic email signature for deliverability',
    },
    {
      type: 'CNAME',
      name: `selector2._domainkey.${domain}`,
      value: `selector2-${domainDashes}._domainkey.${onmicrosoftPrefix}.d-v1.dkim.mail.microsoft`,
      ttl: 3600,
      verified: false,
      description: 'DKIM selector 2 - for key rotation',
    },
  ];
}

/**
 * Enrich a domain's dns_records with DKIM CNAMEs after ownership verification.
 *
 * - Tries EXO (Enable-DkimSigningConfig / Get-DkimSigningConfig) to get real CNAMEs.
 * - Falls back to Microsoft's predictable CNAME format if EXO API isn't available.
 * - Verifies DKIM via EXO "Enabled" flag, or falls back to live DNS lookup.
 * - Returns the merged dns_records and whether DKIM is fully verified.
 *
 * Safe to call multiple times — de-duplicates by record name.
 */
async function enrichWithDkim(params: {
  token: string;
  tenantId: string;
  onmicrosoftDomain: string;
  domain: string;
  existingRecords: DnsRecord[];
}): Promise<{ updatedRecords: DnsRecord[]; dkimVerified: boolean; newDkimCount: number }> {
  const { token, tenantId, onmicrosoftDomain, domain, existingRecords } = params;

  // 1. Try to enable + fetch DKIM config via EXO (gives us real selector CNAMEs)
  let dkimRecords: DnsRecord[] = [];
  const dkimConfig = await enableDkimSigning(token, tenantId, domain)
    ?? await getDkimSigningConfig(token, tenantId, domain);

  if (dkimConfig) {
    dkimRecords = buildDkimDnsRecords(domain, dkimConfig);
  }

  // 2. Fallback: construct CNAMEs from Microsoft's predictable format
  if (dkimRecords.length === 0) {
    dkimRecords = buildPredictableDkimRecords(domain, onmicrosoftDomain);
  }

  // 3. Determine if DKIM is actually signing outbound mail.
  //
  //    The only signal that proves Microsoft is signing is a public-key TXT record
  //    living at the CNAME target. EXO's `Enabled: true / Status: Valid` is necessary
  //    but not sufficient — Microsoft silently rotates tenants between signing
  //    partitions (e.g. d-v1 → y-v1 — see keplerpixel.com, 2026-05) which leaves EXO
  //    in `Status: CnameMissing` while the customer's DNS still points at the old
  //    partition. Any verification path that doesn't end at "the target carries a
  //    DKIM key" can go silently stale.
  //
  //    So we require BOTH: EXO says signing is on, AND the live target carries a
  //    DKIM TXT record matching the values EXO returned.

  const isModernSigningTarget = (target: string) =>
    /\.[a-z]-v\d+\.dkim\.mail\.microsoft\.?$/i.test(target.replace(/\.$/, ''));

  // Resolve a name's CNAME chain (1 hop) via DoH. Returns lowercased, dot-stripped answers.
  const resolveCname = async (name: string): Promise<string[]> => {
    try {
      const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=CNAME`);
      if (!resp.ok) return [];
      const data = await resp.json() as { Answer?: { data: string }[] };
      return (data.Answer || []).map((a) => a.data.replace(/\.$/, '').toLowerCase());
    } catch {
      return [];
    }
  };

  // Resolve TXT records at a name. Returns the joined string per record.
  const resolveTxt = async (name: string): Promise<string[]> => {
    try {
      const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`);
      if (!resp.ok) return [];
      const data = await resp.json() as { Answer?: { data: string }[] };
      return (data.Answer || []).map((a) => a.data.replace(/^"|"$/g, '').replace(/" "/g, ''));
    } catch {
      return [];
    }
  };

  // Resolve MX records at a name. Returns lowercased exchange hosts (dot-stripped).
  const resolveMx = async (name: string): Promise<string[]> => {
    try {
      const resp = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=MX`);
      if (!resp.ok) return [];
      const data = await resp.json() as { Answer?: { data: string }[] };
      return (data.Answer || []).map((a) => {
        // Google DoH returns MX as "<pref> <host>." — pull off the host
        const parts = a.data.trim().split(/\s+/);
        return (parts[parts.length - 1] || '').replace(/\.$/, '').toLowerCase();
      });
    } catch {
      return [];
    }
  };

  // Live-check whether a single DnsRecord row is actually published with the expected
  // value. Used for non-DKIM records (ownership TXT, SPF, MX, DMARC, autodiscover
  // CNAME). DKIM has its own gating path that handles partition-rotation nuance.
  //
  // Also detects duplicate-policy conflicts that silently kill deliverability even
  // when our record is published:
  //   - Multiple SPF records → RFC 7208 §3.2 PERMERROR (SPF ignored entirely)
  //   - Multiple DMARC records → RFC 7489 §6.6.3 (policy ignored)
  //   - Extra MX records → inbound mail round-robined to other hosts
  // Returns `published: true, conflict: "..."` for these so the wizard can
  // surface a warning even though the record technically exists.
  const checkRecord = async (r: DnsRecord): Promise<{ published: boolean; conflict?: string }> => {
    const want = (r.value || '').trim().toLowerCase().replace(/\.$/, '');
    if (!want) return { published: false };
    try {
      if (r.type === 'TXT') {
        const txts = await resolveTxt(r.name);
        const published = txts.some((t) => t.trim().toLowerCase() === want);
        if (!published) return { published: false };
        if (want.startsWith('v=spf1')) {
          const spfRecords = txts.filter((t) => t.trim().toLowerCase().startsWith('v=spf1'));
          if (spfRecords.length > 1) {
            return { published, conflict: `Multiple SPF records detected (${spfRecords.length}) — receivers will return PERMERROR per RFC 7208 and ignore SPF entirely. Merge into a single record. Found: ${spfRecords.join(' | ')}` };
          }
        }
        if (want.startsWith('v=dmarc1')) {
          const dmarcRecords = txts.filter((t) => t.trim().toLowerCase().startsWith('v=dmarc1'));
          if (dmarcRecords.length > 1) {
            return { published, conflict: `Multiple DMARC records detected (${dmarcRecords.length}) — RFC 7489 requires a single record; receivers will ignore the policy entirely. Keep only one. Found: ${dmarcRecords.join(' | ')}` };
          }
        }
        return { published };
      }
      if (r.type === 'MX') {
        const mxes = await resolveMx(r.name);
        const published = mxes.includes(want);
        if (!published) return { published: false };
        const extras = mxes.filter((m) => m !== want);
        if (extras.length > 0) {
          return { published, conflict: `Extra MX record(s) detected — inbound mail will be split between hosts. Remove: ${extras.join(', ')}` };
        }
        return { published };
      }
      if (r.type === 'CNAME') {
        const cnames = await resolveCname(r.name);
        return { published: cnames.includes(want) };
      }
      // Unknown type — don't claim verified
      return { published: false };
    } catch {
      return { published: false };
    }
  };

  // Per-selector check. The hard gate is "does a DKIM-key TXT (v=DKIM1 / k= / p=) resolve
  // at the customer's selector name" — that is exactly what mail-tester, MxToolbox, Gmail
  // and Outlook verify, so it's what we gate dkim_verified on.
  //
  // The modern-target naming and first-hop CNAME compare are kept as SOFT signals —
  // logged for diagnostics and consumed by infra-m365-dkim-drift-check, but they no
  // longer block verification. Earlier they did, which produced false negatives when:
  //   - Microsoft rolled out a target naming format we hadn't seen
  //   - the customer fronted their CNAME through a multi-hop chain (Cloudflare
  //     flattening etc.) so first-hop didn't byte-match EXO's value even though
  //     Microsoft was demonstrably signing.
  const selectorCarriesKey = async (
    r: DnsRecord,
  ): Promise<{ verified: boolean; targetMatches: boolean; modernTarget: boolean }> => {
    const expected = r.value.toLowerCase().replace(/\.$/, '');
    const modernTarget = isModernSigningTarget(expected);
    const cnameAnswers = await resolveCname(r.name);
    const targetMatches = cnameAnswers.includes(expected);
    const txts = await resolveTxt(r.name);
    const verified = txts.some((t) => /(?:^|;|\s)(?:v=DKIM1|k=|p=)/i.test(t));
    return { verified, targetMatches, modernTarget };
  };

  const allDkim = [
    ...existingRecords.filter((r) => r.name.toLowerCase().includes('_domainkey')),
    ...dkimRecords,
  ];
  const uniqueDkim = [...new Map(allDkim.map((r) => [r.name.toLowerCase(), r])).values()];

  const exoSaysSigning = dkimConfig?.Enabled === true && dkimConfig?.Status === 'Valid';

  let dkimVerified = false;
  if (uniqueDkim.length > 0) {
    const keyChecks = await Promise.all(uniqueDkim.map(selectorCarriesKey));
    const allKeysPresent = keyChecks.every((c) => c.verified);
    dkimVerified = allKeysPresent;

    const targetMismatches = keyChecks.filter((c) => c.verified && !c.targetMatches).length;
    const legacyTargets = keyChecks.filter((c) => !c.modernTarget).length;

    if (dkimVerified) {
      console.log(
        `[Infra M365] DKIM verified for ${domain} (live TXT key at ${uniqueDkim.length} selector target(s); EXO agrees: ${exoSaysSigning}; first-hop CNAME mismatches: ${targetMismatches}; legacy-named targets: ${legacyTargets})`,
      );
    } else if (exoSaysSigning) {
      console.warn(
        `[Infra M365] DKIM NOT verified for ${domain} despite EXO Status=Valid — no DKIM-key TXT resolves at selector(s). Customer's CNAMEs may not yet be published / propagated, or Microsoft has rotated signing partitions and the new CNAMEs need to be republished.`,
      );
    } else {
      console.warn(`[Infra M365] DKIM pending for ${domain}: no live key at selector(s) and EXO not yet reporting Valid.`);
    }
  }

  // 4. Live-check non-DKIM (ownership/routing) records via DoH.
  //    Previously these were marked verified: true unconditionally on the assumption
  //    that "M365 verified the ownership TXT, so the rest must be there too." That's
  //    wrong: a customer can verify just the MS=… TXT and never publish SPF/MX/DMARC,
  //    leaving us with green flags in the DB but mail that hard-fails SPF in the wild.
  //    Each record now gets its own DoH lookup; verified reflects DNS truth.
  const nonDkimExisting = await Promise.all(
    existingRecords
      .filter((r) => !r.name.toLowerCase().includes('_domainkey'))
      .map(async (r) => {
        const { published, conflict } = await checkRecord(r);
        // A conflicting record (duplicate SPF/DMARC, extra MX) is technically
        // published but receivers won't trust it, so we mark verified:false to
        // gate downstream provisioning. The wizard reads `conflict` to render
        // the specific reason inline.
        return { ...r, verified: published && !conflict, conflict: conflict ?? null };
      }),
  );

  // 5. Replace DKIM records with the freshly-computed set.
  //    Critical: we must REPLACE, not just dedupe by name — Microsoft has rolled out a
  //    new DKIM infrastructure (*.p-v1.dkim.mail.microsoft) and legacy onmicrosoft.com
  //    targets are no longer valid. If we dedupe by name we'd keep stale target values
  //    even when EXO reports the new ones.
  const existingDkim = existingRecords.filter((r) => r.name.toLowerCase().includes('_domainkey'));
  const previousDkimByName = new Map(existingDkim.map((r) => [r.name.toLowerCase(), r]));
  const freshDkim = dkimRecords.map((r) => ({
    ...r,
    verified: dkimVerified,
  }));
  const freshNames = new Set(freshDkim.map((r) => r.name.toLowerCase()));

  const replacedDkimCount = freshDkim.filter((r) => {
    const prev = previousDkimByName.get(r.name.toLowerCase());
    return prev && prev.value.toLowerCase() !== r.value.toLowerCase();
  }).length;
  const newDkimCount = freshDkim.filter((r) => !previousDkimByName.has(r.name.toLowerCase())).length;

  // If EXO gave us fewer selectors than we had before (shouldn't happen normally, but defensive),
  // keep any legacy ones that aren't being replaced — but they'll be marked unverified.
  const orphanedDkim = existingDkim
    .filter((r) => !freshNames.has(r.name.toLowerCase()))
    .map((r) => ({ ...r, verified: false }));

  const updatedRecords = [...nonDkimExisting, ...freshDkim, ...orphanedDkim];

  return {
    updatedRecords,
    dkimVerified,
    newDkimCount: newDkimCount + replacedDkimCount,
  };
}

/**
 * Publish the DKIM CNAMEs enrichWithDkim just resolved to the DNS provider ACA
 * manages for this domain (Cloudflare / Porkbun), while DKIM is still unverified.
 *
 * Provisioning pushes buildPredictableDkimRecords' guess (d-v1 partition), but EXO
 * often hands back a different partition and selector prefix (q-v1/p-v1,
 * `<mx-prefix>`). enrichWithDkim only rewrites dns_records in the DB, so without
 * this push the live zone keeps the dead guess and DKIM sits "pending" until the
 * daily drift-check cron heals it. The push is idempotent (unchanged records are
 * skipped) and a no-op for BYO-DNS domains. Never throws.
 */
async function syncDkimToManagedDns(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  domainRecord: {
    id: string;
    domain: string;
    dns_provider_id: string | null;
    cloudflare_zone_id: string | null;
    registrar_credentials_id: string | null;
  },
  updatedRecords: DnsRecord[],
  dkimVerified: boolean,
): Promise<void> {
  if (dkimVerified) return;
  try {
    const { channel, result } = await pushDkimToDnsProvider(supabase, {
      id: domainRecord.id,
      domain: domainRecord.domain,
      dns_records: updatedRecords,
      dns_provider_id: domainRecord.dns_provider_id,
      cloudflare_zone_id: domainRecord.cloudflare_zone_id,
      registrar_credentials_id: domainRecord.registrar_credentials_id,
    });
    if (!channel) return;
    if (result.failed > 0) {
      console.error(`[Infra M365] DKIM push to ${channel} failed for ${domainRecord.domain}: ${result.errors.join(' | ')}`);
    } else if (result.pushed > 0) {
      console.log(`[Infra M365] Pushed ${result.pushed} DKIM record(s) to ${channel} for ${domainRecord.domain}`);
    }
  } catch (err) {
    console.error(`[Infra M365] DKIM push threw for ${domainRecord.domain}:`, err instanceof Error ? err.message : err);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { action } = body;

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, body.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // ── provision ────────────────────────────────────────────────────
    if (action === 'provision') {
      const { organization_id, m365_tenant_id, domain, auto_push_dns } = body;

      if (!organization_id || !m365_tenant_id || !domain) {
        return jsonResponse({ error: 'Missing required fields: organization_id, m365_tenant_id, domain' }, 400);
      }

      // Validate domain format (must contain a dot, no @)
      if (domain.includes('@') || !domain.includes('.')) {
        return jsonResponse({ error: 'Invalid domain format — must not contain @ and must have at least one dot' }, 400);
      }
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i.test(domain)) {
        return jsonResponse({ error: 'Invalid domain format' }, 400);
      }

      // Fetch M365 tenant and verify status
      const { data: tenant, error: tenantError } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', m365_tenant_id)
        .eq('organization_id', organization_id)
        .single();

      if (tenantError || !tenant) {
        return jsonResponse({ error: 'M365 tenant not found' }, 404);
      }

      if (tenant.status !== 'connected') {
        return jsonResponse({ error: `M365 tenant is not connected (status: ${tenant.status})` }, 400);
      }

      // Check if domain already provisioned for this org
      const { data: existing } = await supabase
        .from('email_sending_domains')
        .select('id, vm_status, m365_tenant_id')
        .eq('organization_id', organization_id)
        .eq('domain', domain.toLowerCase())
        .maybeSingle();

      if (existing) {
        // Allow reassigning if: domain is in error state, or being moved to a different M365 tenant
        const isReassign = existing.m365_tenant_id !== m365_tenant_id;
        if (existing.vm_status !== 'error' && !isReassign) {
          return jsonResponse({ error: 'Domain already exists for this organization' }, 409);
        }

        // Block reassignment if domain has active mailboxes — they'd become orphaned
        if (isReassign) {
          const { count: activeMailboxCount } = await supabase
            .from('email_mailboxes')
            .select('*', { count: 'exact', head: true })
            .eq('sending_domain_id', existing.id)
            .in('status', ['ready', 'warming', 'paused']);

          if (activeMailboxCount && activeMailboxCount > 0) {
            return jsonResponse({
              error: `Cannot reassign domain to a different tenant: ${activeMailboxCount} active mailbox(es) are linked to it. Delete or disconnect them first.`,
            }, 409);
          }
        }

        // Reset the record for retry or reassignment to new tenant
        await supabase
          .from('email_sending_domains')
          .update({
            m365_tenant_id,
            infra_type: 'm365',
            vm_status: 'provisioning',
            dns_status: 'pending',
            m365_domain_id: null,
            m365_domain_verified: false,
            dns_records: [],
            metadata: null,
          })
          .eq('id', existing.id);
      }

      // Get or create the domain record
      let domainRecord: { id: string; domain: string; [key: string]: unknown };

      if (existing) {
        const { data: refreshed, error: fetchError } = await supabase
          .from('email_sending_domains')
          .select('*')
          .eq('id', existing.id)
          .single();
        if (fetchError || !refreshed) {
          return jsonResponse({ error: 'Failed to fetch domain record after reset' }, 500);
        }
        domainRecord = refreshed;
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('email_sending_domains')
          .insert({
            organization_id,
            // subscription_id is now nullable — M365 domains don't use Azure subscriptions
            subscription_id: null,
            domain: domain.toLowerCase(),
            infra_type: 'm365',
            m365_tenant_id,
            vm_status: 'provisioning',
            dns_status: 'pending',
            max_mailboxes: 100,
          })
          .select()
          .single();

        if (insertError) {
          console.error(`[Infra M365] Failed to create domain record:`, insertError.message);
          return jsonResponse({ error: `Failed to create domain: ${insertError.message}` }, 500);
        }
        domainRecord = inserted;
      }

      console.log(`[Infra M365] Provisioning domain ${domain} for org ${organization_id} on tenant ${tenant.tenant_id}`);

      try {
        // Get M365 token
        const token = await getM365Token(tenant.tenant_id);

        // Add domain to M365 tenant (idempotent — ignore if already exists)
        let addedDomain: { id: string };
        try {
          addedDomain = await addDomainToTenant(token, domain.toLowerCase());
        } catch (addErr) {
          const addM365Err = addErr as M365Error;

          // Domain is already claimed by a DIFFERENT Microsoft tenant — actionable user error
          if (
            addM365Err.message?.includes('Domain is being used by an active tenant') ||
            addM365Err.message?.includes('already exists in another') ||
            addM365Err.message?.includes('already claimed')
          ) {
            await supabase
              .from('email_sending_domains')
              .update({
                vm_status: 'error',
                metadata: {
                  provisioning_error: 'DOMAIN_CLAIMED_BY_OTHER_TENANT',
                  failed_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
              })
              .eq('id', domainRecord.id);

            return jsonResponse({
              error: 'DOMAIN_CLAIMED_BY_OTHER_TENANT',
              error_title: `${domain} is already claimed by another Microsoft 365 tenant`,
              error_message:
                `Microsoft won't let us add ${domain} to this tenant because another Microsoft 365 / Entra ID tenant already owns it. ` +
                `This usually happens when someone previously signed up for a Microsoft service (Teams, Power BI, Copilot, etc.) using an @${domain} email address, which auto-creates a "shadow" tenant that claims the domain.`,
              next_steps: [
                `Check which tenant owns it: run "curl https://login.microsoftonline.com/${domain}/.well-known/openid-configuration" and look at the issuer URL for the tenant ID.`,
                `If it's YOUR tenant: sign in to https://entra.microsoft.com, go to Identity → Settings → Domain names, and delete ${domain} from that tenant. Then retry here.`,
                `If nobody has access to the claiming tenant: go to https://admin.microsoft.com, start a Microsoft 365 trial signup using admin@${domain}, and when prompted click "Become the admin" to take over the shadow tenant via a DNS TXT record. Then delete the domain from it.`,
                `Once the domain is released, click "Retry" here — it usually propagates within a few minutes.`,
              ],
              help_url: 'https://learn.microsoft.com/en-us/microsoft-365/admin/misc/become-the-admin',
            }, 409);
          }

          // ObjectConflict = domain already exists in THIS tenant — that's fine, continue
          if (addM365Err.code !== 'ObjectConflict' && addM365Err.code !== 'Request_BadRequest') throw addErr;
          console.log(`[Infra M365] Domain ${domain} already exists in tenant, continuing...`);
          addedDomain = { id: domain.toLowerCase() };
        }

        // Store the domain ID immediately — DNS records fetched async by `status` polling
        await supabase
          .from('email_sending_domains')
          .update({
            m365_domain_id: addedDomain.id,
            vm_status: 'provisioning', // stays provisioning until status fetch succeeds
            dns_status: 'pending',
            updated_at: new Date().toISOString(),
          })
          .eq('id', domainRecord.id);

        // Try to fetch DNS records immediately (fast path — sometimes Graph is ready)
        let dnsRecords: DnsRecord[] = [];
        try {
          const [verificationRecords, serviceRecords, dmarcCollector] = await Promise.all([
            getDomainVerificationRecords(token, domain.toLowerCase()),
            getDomainServiceRecords(token, domain.toLowerCase()),
            getActiveDmarcCollectorEmail(supabase, organization_id),
          ]);
          dnsRecords = generateM365DnsRecords(domain.toLowerCase(), verificationRecords, serviceRecords, dmarcCollector ?? undefined);
          if (dmarcCollector) {
            const authResult = await ensureDmarcAuthorizationRecord(dmarcCollector, domain.toLowerCase(), organization_id);
            if (authResult.attempted && !authResult.success) {
              console.warn(`[Infra M365] DMARC authorization record failed for ${domain}: ${authResult.error}`);
            }
          }
          // Append predictable DKIM CNAMEs so users add all records in one shot.
          // Harmless to pre-publish — Microsoft won't sign until domain is verified + DKIM is enabled in EXO.
          dnsRecords = [
            ...dnsRecords,
            ...buildPredictableDkimRecords(domain.toLowerCase(), tenant.onmicrosoft_domain as string),
          ];
          await supabase
            .from('email_sending_domains')
            .update({
              dns_records: dnsRecords,
              vm_status: 'running',
              dns_status: 'records_generated',
              updated_at: new Date().toISOString(),
            })
            .eq('id', domainRecord.id);
          console.log(`[Infra M365] DNS records fetched immediately for ${domain}`);
        } catch (dnsErr) {
          const dnsM365Err = dnsErr as M365Error;
          if (dnsM365Err.code === 'Request_ResourceNotFound') {
            // Graph not indexed yet — frontend will poll status action to fetch records
            console.log(`[Infra M365] Graph not indexed yet for ${domain}, frontend will poll status`);
          } else {
            throw dnsErr;
          }
        }

        return jsonResponse({
          success: true,
          domain_id: domainRecord.id,
          dns_records: dnsRecords, // may be empty — frontend polls status if so
        });

      } catch (err) {
        const message = err instanceof M365Error ? `[${err.code}] ${err.message}` : (err instanceof Error ? err.message : 'M365 provisioning failed');
        console.error(`[Infra M365] Provisioning failed for ${domain}:`, message);

        await supabase
          .from('email_sending_domains')
          .update({
            vm_status: 'error',
            metadata: { provisioning_error: message, failed_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq('id', domainRecord.id);

        return jsonResponse({ error: `Provisioning failed: ${message}` }, 500);
      }
    }

    // ── status ───────────────────────────────────────────────────────
    if (action === 'status') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      // For M365 domains, check verification status with MS Graph
      if (domainRecord.infra_type === 'm365' && domainRecord.m365_tenant_id) {
        try {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('*')
            .eq('id', domainRecord.m365_tenant_id)
            .single();

          if (tenant) {
            const token = await getM365Token(tenant.tenant_id);

            // If still provisioning (Graph not indexed at provision time), try to fetch DNS records now
            if (domainRecord.vm_status === 'provisioning') {
              try {
                const [verificationRecords, serviceRecords, dmarcCollector] = await Promise.all([
                  getDomainVerificationRecords(token, domainRecord.domain),
                  getDomainServiceRecords(token, domainRecord.domain),
                  getActiveDmarcCollectorEmail(supabase, organization_id),
                ]);
                let dnsRecords = generateM365DnsRecords(domainRecord.domain, verificationRecords, serviceRecords, dmarcCollector ?? undefined);
                if (dmarcCollector) {
                  const authResult = await ensureDmarcAuthorizationRecord(dmarcCollector, domainRecord.domain, organization_id);
                  if (authResult.attempted && !authResult.success) {
                    console.warn(`[Infra M365] DMARC authorization record failed for ${domainRecord.domain}: ${authResult.error}`);
                  }
                }
                // Append predictable DKIM CNAMEs so all records land in one batch
                dnsRecords = [
                  ...dnsRecords,
                  ...buildPredictableDkimRecords(domainRecord.domain, tenant.onmicrosoft_domain as string),
                ];
                await supabase
                  .from('email_sending_domains')
                  .update({
                    dns_records: dnsRecords,
                    vm_status: 'running',
                    dns_status: 'records_generated',
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', domain_id);
                domainRecord.dns_records = dnsRecords;
                domainRecord.vm_status = 'running';
                domainRecord.dns_status = 'records_generated';
                console.log(`[Infra M365 Status] DNS records now available for ${domainRecord.domain}`);
              } catch (dnsErr) {
                const dnsM365Err = dnsErr as M365Error;
                if (dnsM365Err.code !== 'Request_ResourceNotFound') throw dnsErr;
                // Still not indexed — keep vm_status as provisioning, frontend keeps polling
              }
            }

            let status: { isVerified: boolean };
            try {
              status = await getDomainStatus(token, domainRecord.domain);
            } catch (statusErr) {
              const statusM365Err = statusErr as M365Error;
              if (statusM365Err.code === 'Request_ResourceNotFound') {
                status = { isVerified: false };
              } else {
                throw statusErr;
              }
            }

            if (status.isVerified && !domainRecord.m365_domain_verified) {
              // Ownership verified — enrich with DKIM CNAMEs so user has something to paste
              const existingRecords: DnsRecord[] = (domainRecord.dns_records as DnsRecord[]) || [];

              const { updatedRecords, dkimVerified } = await enrichWithDkim({
                token,
                tenantId: tenant.tenant_id,
                onmicrosoftDomain: tenant.onmicrosoft_domain as string,
                domain: domainRecord.domain,
                existingRecords,
              });
              await syncDkimToManagedDns(supabase, domainRecord, updatedRecords, dkimVerified);

              const hasPendingDkim = updatedRecords.some(
                (r) => r.name.toLowerCase().includes('_domainkey') && !r.verified
              );
              // Derive auth flags from real DNS truth (set by isRecordPublished
              // inside enrichWithDkim), not from blind assumption.
              const spfPublished = updatedRecords.some(
                (r) => r.type === 'TXT' && /^v=spf1\b/i.test(r.value || '') && r.verified === true,
              );
              const dmarcPublished = updatedRecords.some(
                (r) => r.type === 'TXT' && r.name.toLowerCase().startsWith('_dmarc.') && r.verified === true,
              );
              const dnsStatus = hasPendingDkim
                ? 'dkim_pending'
                : (spfPublished ? 'verified' : 'spf_pending');

              await supabase
                .from('email_sending_domains')
                .update({
                  m365_domain_verified: true,
                  dns_status: dnsStatus,
                  spf_verified: spfPublished,
                  dkim_verified: !hasPendingDkim,
                  dmarc_verified: dmarcPublished,
                  dns_records: updatedRecords,
                  last_dns_check_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq('id', domain_id);

              domainRecord.m365_domain_verified = true;
              domainRecord.dns_status = dnsStatus;
              domainRecord.dns_records = updatedRecords;
              domainRecord.dkim_verified = !hasPendingDkim;
              domainRecord.spf_verified = spfPublished;
              domainRecord.dmarc_verified = dmarcPublished;
              void dkimVerified;
            }
          }
        } catch (outerErr) {
          console.error(`[Infra M365 Status] Failed to check verification:`, outerErr instanceof Error ? outerErr.message : outerErr);
        }
      }

      return jsonResponse({
        success: true,
        domain: {
          id: domainRecord.id,
          domain: domainRecord.domain,
          infra_type: domainRecord.infra_type,
          vm_status: domainRecord.vm_status,
          dns_status: domainRecord.dns_status,
          dns_records: domainRecord.dns_records,
          m365_domain_verified: domainRecord.m365_domain_verified,
          m365_domain_id: domainRecord.m365_domain_id,
          spf_verified: domainRecord.spf_verified,
          dkim_verified: domainRecord.dkim_verified,
          dmarc_verified: domainRecord.dmarc_verified,
          mailbox_count: domainRecord.mailbox_count,
          max_mailboxes: domainRecord.max_mailboxes,
          metadata: domainRecord.metadata,
        },
      });
    }

    // ── refresh_dns ──────────────────────────────────────────────────
    // Force re-fetch DNS records from Graph and update DB (e.g. after isOptional fix)
    if (action === 'refresh_dns') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      if (domainRecord.infra_type !== 'm365') {
        return jsonResponse({ error: 'refresh_dns is only for M365 domains' }, 400);
      }

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', domainRecord.m365_tenant_id)
        .single();

      if (!tenant) return jsonResponse({ error: 'M365 tenant not found' }, 404);

      const token = await getM365Token(tenant.tenant_id);

      const [verificationRecords, serviceRecords, dmarcCollector] = await Promise.all([
        getDomainVerificationRecords(token, domainRecord.domain),
        getDomainServiceRecords(token, domainRecord.domain),
        getActiveDmarcCollectorEmail(supabase, organization_id),
      ]);
      if (dmarcCollector) {
        const authResult = await ensureDmarcAuthorizationRecord(dmarcCollector, domainRecord.domain, organization_id);
        if (authResult.attempted && !authResult.success) {
          console.warn(`[Infra M365] DMARC authorization record failed for ${domainRecord.domain}: ${authResult.error}`);
        }
      }

      const freshRecords = generateM365DnsRecords(domainRecord.domain, verificationRecords, serviceRecords, dmarcCollector ?? undefined);

      // Merge: keep existing records (preserve verified states + ownership TXT),
      // add any new records from Graph that aren't already present
      const existingRecords: DnsRecord[] = (domainRecord.dns_records as DnsRecord[]) || [];
      const existingByKey = new Map(existingRecords.map((r: DnsRecord) => [`${r.type}:${r.name}:${r.value}`, r]));
      const existingByNameType = new Map(existingRecords.map((r: DnsRecord) => [`${r.type}:${r.name}`, r]));

      const mergedRecords: DnsRecord[] = [...existingRecords];
      for (const r of freshRecords) {
        const key = `${r.type}:${r.name}:${r.value}`;
        const nameTypeKey = `${r.type}:${r.name}`;
        if (!existingByKey.has(key) && !existingByNameType.has(nameTypeKey)) {
          mergedRecords.push(r);
        }
      }

      await supabase
        .from('email_sending_domains')
        .update({
          dns_records: mergedRecords,
          vm_status: 'running',
          dns_status: domainRecord.dns_status === 'pending' ? 'records_generated' : domainRecord.dns_status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', domain_id);

      return jsonResponse({ success: true, dns_records: mergedRecords });
    }

    // ── verify_dns ───────────────────────────────────────────────────
    if (action === 'verify_dns') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      if (domainRecord.infra_type !== 'm365') {
        return jsonResponse({ error: 'verify_dns (M365) is only for M365 domains' }, 400);
      }

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', domainRecord.m365_tenant_id)
        .single();

      if (!tenant) {
        return jsonResponse({ error: 'M365 tenant not found' }, 404);
      }

      const token = await getM365Token(tenant.tenant_id);

      let result: { isVerified: boolean };
      try {
        result = await verifyDomain(token, domainRecord.domain);
      } catch (verifyErr) {
        const verifyM365Err = verifyErr as M365Error;
        // Domain not in tenant yet — not an error, just not verified
        if (verifyM365Err.code === 'Request_ResourceNotFound') {
          return jsonResponse({ success: true, isVerified: false, reason: 'Domain not found in M365 tenant — re-provision may be needed' });
        }
        // Microsoft transient DNS check failure — treat as not-yet-verified, caller can retry
        if (verifyM365Err.code === 'Request_BadRequest' && verifyM365Err.message?.includes('InternalError')) {
          return jsonResponse({ success: true, isVerified: false, reason: 'Microsoft DNS check encountered a transient error — please retry in a few seconds' });
        }
        throw verifyErr;
      }

      // Fallback: /verify sometimes returns isVerified: false on already-verified domains
      // without throwing the "already verified" 400. Double-check current status from Graph.
      if (!result.isVerified) {
        try {
          const status = await getDomainStatus(token, domainRecord.domain);
          if (status.isVerified) {
            result = { isVerified: true };
          }
        } catch {
          // ignore — keep isVerified: false
        }
      }

      if (result.isVerified) {
        const existingRecords: DnsRecord[] = (domainRecord.dns_records as DnsRecord[]) || [];

        const { updatedRecords, dkimVerified, newDkimCount } = await enrichWithDkim({
          token,
          tenantId: tenant.tenant_id,
          onmicrosoftDomain: tenant.onmicrosoft_domain as string,
          domain: domainRecord.domain,
          existingRecords,
        });
        await syncDkimToManagedDns(supabase, domainRecord, updatedRecords, dkimVerified);

        const hasPendingDkim = updatedRecords.some(
          (r) => r.name.toLowerCase().includes('_domainkey') && !r.verified
        );
        const spfPublished = updatedRecords.some(
          (r) => r.type === 'TXT' && /^v=spf1\b/i.test(r.value || '') && r.verified === true,
        );
        const dmarcPublished = updatedRecords.some(
          (r) => r.type === 'TXT' && r.name.toLowerCase().startsWith('_dmarc.') && r.verified === true,
        );
        const dnsStatus = hasPendingDkim
          ? 'dkim_pending'
          : (spfPublished ? 'verified' : 'spf_pending');

        await supabase
          .from('email_sending_domains')
          .update({
            m365_domain_verified: true,
            dns_status: dnsStatus,
            spf_verified: spfPublished,
            dkim_verified: !hasPendingDkim,
            dmarc_verified: dmarcPublished,
            dns_records: updatedRecords,
            last_dns_check_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', domain_id);

        return jsonResponse({
          success: true,
          isVerified: true,
          dkim_verified: !hasPendingDkim,
          spf_verified: spfPublished,
          dmarc_verified: dmarcPublished,
          dkim_records_added: newDkimCount,
          dns_records: updatedRecords,
        });
      }

      return jsonResponse({
        success: true,
        isVerified: false,
      });
    }

    // ── repair_dkim ──────────────────────────────────────────────────
    // Re-run Enable-DkimSigningConfig + re-read state for an already-verified domain.
    //
    // Needed because earlier versions of enableDkimSigning hardcoded `Enabled: true`
    // in its return value, so domains could end up with `dkim_verified: true` in our DB
    // while EXO actually had signing disabled (Set-DkimSigningConfig silently failed
    // because the CNAMEs weren't live yet at enable time).
    //
    // Call this action once the DKIM CNAMEs are live at the registrar. It'll retry the
    // enable cmdlet and write the truth back to the DB.
    if (action === 'repair_dkim') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      if (domainRecord.infra_type !== 'm365') {
        return jsonResponse({ error: 'repair_dkim is only for M365 domains' }, 400);
      }

      if (!domainRecord.m365_domain_verified) {
        return jsonResponse({ error: 'Domain ownership is not yet verified — run verify_dns first' }, 400);
      }

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', domainRecord.m365_tenant_id)
        .single();

      if (!tenant) return jsonResponse({ error: 'M365 tenant not found' }, 404);

      const token = await getM365Token(tenant.tenant_id);
      const existingRecords: DnsRecord[] = (domainRecord.dns_records as DnsRecord[]) || [];

      // enrichWithDkim calls enableDkimSigning which now re-reads actual state after enable attempt
      const { updatedRecords, dkimVerified } = await enrichWithDkim({
        token,
        tenantId: tenant.tenant_id,
        onmicrosoftDomain: tenant.onmicrosoft_domain as string,
        domain: domainRecord.domain,
        existingRecords,
      });
      await syncDkimToManagedDns(supabase, domainRecord, updatedRecords, dkimVerified);

      // Also read the raw EXO config to surface diagnostic info to the caller
      const finalConfig = await getDkimSigningConfig(token, tenant.tenant_id, domainRecord.domain);

      const hasPendingDkim = updatedRecords.some(
        (r) => r.name.toLowerCase().includes('_domainkey') && !r.verified
      );
      const spfPublished = updatedRecords.some(
        (r) => r.type === 'TXT' && /^v=spf1\b/i.test(r.value || '') && r.verified === true,
      );
      const dmarcPublished = updatedRecords.some(
        (r) => r.type === 'TXT' && r.name.toLowerCase().startsWith('_dmarc.') && r.verified === true,
      );
      const dnsStatus = hasPendingDkim
        ? 'dkim_pending'
        : (spfPublished ? 'verified' : 'spf_pending');

      await supabase
        .from('email_sending_domains')
        .update({
          dns_status: dnsStatus,
          dkim_verified: !hasPendingDkim,
          spf_verified: spfPublished,
          dmarc_verified: dmarcPublished,
          dns_records: updatedRecords,
          last_dns_check_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', domain_id);

      return jsonResponse({
        success: true,
        dkim_verified: dkimVerified,
        exo_status: finalConfig?.Status ?? null,
        exo_enabled: finalConfig?.Enabled ?? null,
        selector1_cname: finalConfig?.Selector1CNAME ?? null,
        selector2_cname: finalConfig?.Selector2CNAME ?? null,
        dns_records: updatedRecords,
        note: dkimVerified
          ? 'DKIM signing is active. Microsoft may take 1–5 min to publish the public key TXT at the selector target.'
          : `DKIM is NOT yet signing. EXO Status: ${finalConfig?.Status ?? 'unknown'}. Ensure both selector CNAMEs are published at the registrar and have propagated, then retry.`,
      });
    }

    // ── delete ───────────────────────────────────────────────────────
    if (action === 'delete') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      console.log(`[Infra M365] Deleting domain ${domainRecord.domain} (type: ${domainRecord.infra_type})`);

      // Block deletion if domain has active mailboxes unless force flag is set
      const { count: activeMailboxCount } = await supabase
        .from('email_mailboxes')
        .select('*', { count: 'exact', head: true })
        .eq('sending_domain_id', domain_id)
        .in('status', ['ready', 'warming', 'paused']);

      if (activeMailboxCount && activeMailboxCount > 0 && !body.force) {
        return jsonResponse({
          error: `Cannot delete domain: ${activeMailboxCount} active mailbox(es) are linked to it. Pass force: true to disconnect them and proceed, or delete/disconnect them first.`,
          active_mailbox_count: activeMailboxCount,
        }, 409);
      }

      // Mark associated mailboxes as disconnected
      await supabase
        .from('email_mailboxes')
        .update({ status: 'disconnected', updated_at: new Date().toISOString() })
        .eq('sending_domain_id', domain_id);

      // Delete M365 resources if this is an M365 domain
      if (domainRecord.infra_type === 'm365' && domainRecord.m365_tenant_id) {
        try {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('*')
            .eq('id', domainRecord.m365_tenant_id)
            .single();

          if (tenant) {
            const token = await getM365Token(tenant.tenant_id);

            // List and delete all domain users
            try {
              const users = await listDomainUsers(token, domainRecord.domain);
              for (const user of users) {
                try {
                  await deleteM365User(token, user.id);
                  console.log(`[Infra M365] Deleted user ${user.userPrincipalName}`);
                } catch (userErr) {
                  console.warn(`[Infra M365] Failed to delete user ${user.userPrincipalName}:`, userErr instanceof Error ? userErr.message : userErr);
                }
              }
            } catch (listErr) {
              console.warn(`[Infra M365] Failed to list domain users:`, listErr instanceof Error ? listErr.message : listErr);
            }

            // Delete the domain from the tenant (non-fatal if not found)
            try {
              await deleteDomain(token, domainRecord.domain);
              console.log(`[Infra M365] Deleted domain ${domainRecord.domain} from tenant`);
            } catch (domErr) {
              // Non-fatal — domain may not exist in Graph
              console.warn(`[Infra M365] Could not delete domain from Graph (non-fatal):`, domErr instanceof Error ? domErr.message : domErr);
            }
          }
        } catch (err) {
          console.error(`[Infra M365] Error during M365 cleanup for ${domainRecord.domain}:`, err instanceof Error ? err.message : err);
          // Continue to delete the DB record regardless
        }
      }

      // Delete domain record from DB
      await supabase
        .from('email_sending_domains')
        .delete()
        .eq('id', domain_id);

      return jsonResponse({ success: true });
    }

    // ── replace ──────────────────────────────────────────────────────
    if (action === 'replace') {
      const { burned_domain_id, new_domain, organization_id } = body;

      if (!burned_domain_id || !new_domain || !organization_id) {
        return jsonResponse({ error: 'burned_domain_id, new_domain, and organization_id are required' }, 400);
      }

      if (new_domain.includes('@') || !new_domain.includes('.')) {
        return jsonResponse({ error: 'Invalid domain format — must not contain @ and must have at least one dot' }, 400);
      }
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z]{2,})+$/i.test(new_domain)) {
        return jsonResponse({ error: 'Invalid domain format' }, 400);
      }

      // Fetch burned domain
      const { data: burnedDomain, error: burnedError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', burned_domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (burnedError || !burnedDomain) {
        return jsonResponse({ error: 'Burned domain not found' }, 404);
      }

      if (burnedDomain.infra_type !== 'm365') {
        return jsonResponse({ error: 'replace (M365) only works with M365 domains' }, 400);
      }

      // Check new domain doesn't already exist
      const { data: existingNew } = await supabase
        .from('email_sending_domains')
        .select('id')
        .eq('organization_id', organization_id)
        .eq('domain', new_domain.toLowerCase())
        .maybeSingle();

      if (existingNew) {
        return jsonResponse({ error: 'New domain already exists for this organization' }, 409);
      }

      // Fetch existing mailbox identities from burned domain for migration
      const { data: burnedMailboxes } = await supabase
        .from('email_mailboxes')
        .select('email_address, display_name, metadata')
        .eq('sending_domain_id', burned_domain_id)
        .in('status', ['burned', 'paused', 'ready', 'warming']);

      const migratedIdentities = (burnedMailboxes || []).map((mb: { email_address: string; display_name: string | null; metadata: Record<string, unknown> | null }) => ({
        username: mb.email_address.split('@')[0],
        display_name: mb.display_name || '',
      }));

      // Fetch tenant info
      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', burnedDomain.m365_tenant_id)
        .single();

      if (!tenant) {
        return jsonResponse({ error: 'M365 tenant not found' }, 404);
      }

      console.log(`[Infra M365] Replacing burned domain ${burnedDomain.domain} with ${new_domain}`);

      // Provision the new domain using the same tenant
      try {
        const token = await getM365Token(tenant.tenant_id);
        const dom = new_domain.toLowerCase();

        // The domain may already be in the tenant from an earlier run that added
        // it and then failed before writing the DB row. Adopt it instead of
        // failing, so replace is safe to retry.
        let addedDomain: { id: string };
        try {
          addedDomain = await addDomainToTenant(token, dom);
        } catch (addErr) {
          const existing = await getDomainStatus(token, dom).catch(() => null);
          if (!existing?.id) throw addErr;
          console.log(`[Infra M365] ${dom} already present in tenant — adopting it`);
          addedDomain = { id: existing.id };
        }

        // Graph is eventually consistent: POST /domains returns before the
        // domain object is queryable, so the record fetch 404s if called
        // immediately. Back off and retry rather than losing the whole run.
        const withRetry = async <T>(fn: () => Promise<T>, label: string): Promise<T> => {
          let lastErr: unknown;
          for (let attempt = 1; attempt <= 5; attempt++) {
            try {
              return await fn();
            } catch (err) {
              lastErr = err;
              const msg = err instanceof Error ? err.message : String(err);
              if (!msg.includes('Request_ResourceNotFound')) throw err;
              console.log(`[Infra M365] ${label} not ready for ${dom} (attempt ${attempt}/5), backing off`);
              await new Promise((r) => setTimeout(r, attempt * 3000));
            }
          }
          throw lastErr;
        };

        const [verificationRecords, serviceRecords, dmarcCollector] = await Promise.all([
          withRetry(() => getDomainVerificationRecords(token, dom), 'verificationDnsRecords'),
          withRetry(() => getDomainServiceRecords(token, dom), 'serviceConfigurationRecords'),
          getActiveDmarcCollectorEmail(supabase, organization_id),
        ]);
        if (dmarcCollector) {
          const authResult = await ensureDmarcAuthorizationRecord(dmarcCollector, new_domain.toLowerCase(), organization_id);
          if (authResult.attempted && !authResult.success) {
            console.warn(`[Infra M365] DMARC authorization record failed for ${new_domain}: ${authResult.error}`);
          }
        }

        const dnsRecords = generateM365DnsRecords(new_domain.toLowerCase(), verificationRecords, serviceRecords, dmarcCollector ?? undefined);

        // Create new domain record
        const { data: newDomainRecord, error: insertError } = await supabase
          .from('email_sending_domains')
          .insert({
            organization_id,
            subscription_id: null,
            domain: new_domain.toLowerCase(),
            infra_type: 'm365',
            m365_tenant_id: burnedDomain.m365_tenant_id,
            m365_domain_id: addedDomain.id,
            vm_status: 'running',
            dns_status: 'records_generated',
            dns_records: dnsRecords,
            max_mailboxes: 100,
            replaces_id: burned_domain_id,
          })
          .select()
          .single();

        if (insertError) {
          return jsonResponse({ error: `Failed to create replacement domain: ${insertError.message}` }, 500);
        }

        // Link burned domain to replacement
        await supabase
          .from('email_sending_domains')
          .update({ replaced_by_id: newDomainRecord.id, updated_at: new Date().toISOString() })
          .eq('id', burned_domain_id);

        return jsonResponse({
          success: true,
          new_domain_id: newDomainRecord.id,
          dns_records: dnsRecords,
          migrated_identities: migratedIdentities,
        });

      } catch (err) {
        const message = err instanceof M365Error ? `[${err.code}] ${err.message}` : (err instanceof Error ? err.message : 'Replace failed');
        console.error(`[Infra M365] Replace domain failed for ${new_domain}:`, message);
        return jsonResponse({ error: `Replace failed: ${message}` }, 500);
      }
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra Domain Provision] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
