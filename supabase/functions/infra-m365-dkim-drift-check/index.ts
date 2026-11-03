/**
 * M365 DKIM Drift Check
 *
 * Microsoft silently rotates tenants between DKIM signing partitions
 * (e.g. d-v1 → y-v1). When that happens, EXO flips `Enabled: false /
 * Status: CnameMissing` and outbound mail goes out unsigned — but the
 * customer (and ACA) only find out when their next mail-tester run fails.
 *
 * This function polls every M365 domain currently marked `dkim_verified: true`,
 * asks EXO what selector CNAMEs it expects today, and compares them to what's
 * stored in `dns_records`. On drift it:
 *   - replaces the stored DKIM CNAMEs with the new EXO values
 *   - flips `dkim_verified: false`, `dns_status: 'dkim_pending'`
 *   - logs a warning the org can react to
 *
 * Read-only with respect to Microsoft (no Enable/Set cmdlets) — purely passive
 * detection. Intended to run weekly via pg_cron.
 *
 * Auth: the service-role key (cron, infra-dns-setup) may run any scope,
 * including the all-orgs sweep with no organization_id. A user JWT / aca_ token
 * must send an organization_id it can access, and the run is then limited to
 * that org. `notify_existing_drift` is service-role only.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  getDkimSigningConfig,
  enableDkimSigning,
  type DnsRecord,
} from '../_shared/m365-client.ts';
import { pushDkimToDnsProvider, type PushResult } from '../_shared/registrar-push.ts';
import { notifyDkimDrift, type NotifyResult } from '../_shared/dkim-drift-notifier.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

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

interface DriftReport {
  domain_id: string;
  domain: string;
  outcome: 'no_drift' | 'drift_detected' | 'exo_unreachable' | 'tenant_missing' | 'error';
  exo_status?: string | null;
  exo_enabled?: boolean | null;
  old_selector1?: string | null;
  new_selector1?: string | null;
  registrar_push?: PushResult;
  exo_re_enable_status?: string | null;
  notification?: NotifyResult;
  error?: string;
}

function findStoredSelectorValue(records: DnsRecord[], selectorName: string): string | null {
  const match = records.find((r) => r.name.toLowerCase() === selectorName.toLowerCase());
  return match?.value?.toLowerCase().replace(/\.$/, '') ?? null;
}

function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.toLowerCase().replace(/\.$/, '');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Optional payload to scope the run (defaults to all M365 domains marked verified).
  // When `notify_existing_drift: true`, skip detection and just send the action-required
  // email for the supplied domain_id(s) based on currently stored dns_records — useful
  // for back-filling notifications after a manual downgrade.
  let body: {
    domain_id?: string;
    organization_id?: string;
    notify_existing_drift?: boolean;
    domain_ids?: string[];
    bypass_debounce?: boolean;
  } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  // The service-role client acts on whatever org the body names, so the caller
  // must be able to access it (a valid anon-key JWT alone is not enough). With no
  // organization_id (the cron's all-orgs sweep) only the service role passes.
  try {
    await assertOrgAccess(req, supabase, body.organization_id);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }

  if (body.notify_existing_drift) {
    // Looks domains up by id with no organization filter.
    if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

    const ids = body.domain_ids ?? (body.domain_id ? [body.domain_id] : []);
    if (ids.length === 0) return jsonResponse({ error: 'notify_existing_drift requires domain_id or domain_ids' }, 400);

    const { data: rows, error: rowErr } = await supabase
      .from('email_sending_domains')
      .select('id, organization_id, domain, dns_records, registrar_credentials_id, dns_provider_id, cloudflare_zone_id, metadata')
      .in('id', ids);
    if (rowErr) return jsonResponse({ error: rowErr.message }, 500);

    const sent: Record<string, NotifyResult> = {};
    for (const r of (rows ?? [])) {
      const records = (r.dns_records as DnsRecord[] | null) ?? [];
      const newSelectorRecords = records
        .filter((x) => x.type === 'CNAME' && x.name.toLowerCase().includes('._domainkey.'))
        .map((x) => ({ type: x.type, name: x.name, value: x.value }));

      const mode = r.registrar_credentials_id ? 'auto_healed' : 'action_required';
      const result = await notifyDkimDrift(supabase, {
        domainId: r.id,
        domain: r.domain,
        organizationId: r.organization_id,
        mode,
        newSelectorRecords,
        exoStatus: 'manual_replay',
      });
      if (result.sent) {
        const meta = (r.metadata as Record<string, unknown> | null) ?? {};
        await supabase
          .from('email_sending_domains')
          .update({
            metadata: {
              ...meta,
              dkim_drift_notified_at: new Date().toISOString(),
              dkim_drift_notified_mode: mode,
            },
          })
          .eq('id', r.id);
      }
      sent[r.domain] = result;
    }
    return jsonResponse({ success: true, mode: 'notify_existing_drift', sent });
  }

  // Check every M365 domain whose ownership is verified. This covers three cases:
  //   1. dkim_verified = true → previously working, may have drifted (original case)
  //   2. dkim_verified = false + dns_managed → auto-heal via CF/Porkbun and the next
  //      run flips it to verified once the new keys propagate
  //   3. dkim_verified = false + BYO DNS → notify the user with the current CNAMEs
  //      so they can paste the right values into their registrar
  //
  // Without the previous narrow filter, never-verified domains with stale partition
  // values (which is the leadgrowthhacks/clientbank.net pattern — EXO returned an
  // old partition at provision time and we cached it) get healed too.
  let query = supabase
    .from('email_sending_domains')
    .select('id, organization_id, domain, m365_tenant_id, dns_records, dkim_verified, m365_domain_verified, spf_verified, dns_status, registrar_credentials_id, dns_provider_id, cloudflare_zone_id, metadata')
    .eq('infra_type', 'm365')
    .eq('m365_domain_verified', true);

  if (body.domain_id) query = query.eq('id', body.domain_id);
  if (body.organization_id) query = query.eq('organization_id', body.organization_id);

  const { data: domains, error: fetchError } = await query;
  if (fetchError) return jsonResponse({ error: fetchError.message }, 500);
  if (!domains || domains.length === 0) {
    return jsonResponse({ success: true, checked: 0, drift_detected: 0, results: [] });
  }

  const reports: DriftReport[] = [];

  // Sequential to keep EXO PowerShell load reasonable. ~50 domains/min worst case.
  for (const d of domains) {
    const records: DnsRecord[] = (d.dns_records as DnsRecord[]) || [];

    let tenantTenantId: string | null = null;
    try {
      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('tenant_id')
        .eq('id', d.m365_tenant_id)
        .single();
      tenantTenantId = tenant?.tenant_id ?? null;
    } catch { /* fall through */ }

    if (!tenantTenantId) {
      reports.push({ domain_id: d.id, domain: d.domain, outcome: 'tenant_missing' });
      continue;
    }

    let token: string;
    try {
      token = await getM365Token(tenantTenantId);
    } catch (e) {
      reports.push({ domain_id: d.id, domain: d.domain, outcome: 'exo_unreachable', error: (e as Error).message });
      continue;
    }

    let config;
    try {
      config = await getDkimSigningConfig(token, tenantTenantId, d.domain);
    } catch (e) {
      reports.push({ domain_id: d.id, domain: d.domain, outcome: 'exo_unreachable', error: (e as Error).message });
      continue;
    }

    if (!config) {
      // EXO returned nothing — could mean the signing config was deleted on the M365 side.
      // Treat as drift (downgrade verification) so the next user-facing check re-provisions.
      await supabase
        .from('email_sending_domains')
        .update({ dkim_verified: false, dns_status: 'dkim_pending', updated_at: new Date().toISOString() })
        .eq('id', d.id);
      reports.push({ domain_id: d.id, domain: d.domain, outcome: 'drift_detected', exo_status: null, exo_enabled: null });
      continue;
    }

    const exoSel1 = normalize(config.Selector1CNAME);
    const exoSel2 = normalize(config.Selector2CNAME);
    const storedSel1 = findStoredSelectorValue(records, `selector1._domainkey.${d.domain}`);
    const storedSel2 = findStoredSelectorValue(records, `selector2._domainkey.${d.domain}`);

    const exoSaysSigning = config.Enabled === true && config.Status === 'Valid';
    const selectorsMatch = exoSel1 === storedSel1 && exoSel2 === storedSel2;

    if (selectorsMatch && exoSaysSigning) {
      // EXO already confirms this domain is signing correctly. Self-heal any
      // stale cached state instead of just reporting "fine" and moving on —
      // otherwise a domain whose initial provisioning never got its final write
      // (e.g. the wizard was closed before polling finished) stays stuck showing
      // dkim_pending forever even though Microsoft has been signing its mail the
      // whole time, and nothing ever re-derives the correct status from EXO truth.
      if (!d.dkim_verified || (d.spf_verified && d.dns_status !== 'verified')) {
        await supabase
          .from('email_sending_domains')
          .update({
            dkim_verified: true,
            dns_status: d.spf_verified ? 'verified' : d.dns_status,
            last_dns_check_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', d.id);
      } else {
        await supabase
          .from('email_sending_domains')
          .update({ last_dns_check_at: new Date().toISOString() })
          .eq('id', d.id);
      }
      reports.push({
        domain_id: d.id,
        domain: d.domain,
        outcome: 'no_drift',
        exo_status: config.Status,
        exo_enabled: config.Enabled,
      });
      continue;
    }

    // Drift: either EXO expects different selectors than what we stored,
    // or EXO has dropped signing (Status != Valid / Enabled false).
    // Update DKIM rows to the EXO truth and downgrade verification so the UI
    // surfaces the new CNAMEs and the customer republishes.
    const updatedRecords = records.map((r) => {
      const lc = r.name.toLowerCase();
      if (lc === `selector1._domainkey.${d.domain}`.toLowerCase() && exoSel1) {
        return { ...r, value: config.Selector1CNAME!, verified: false };
      }
      if (lc === `selector2._domainkey.${d.domain}`.toLowerCase() && exoSel2) {
        return { ...r, value: config.Selector2CNAME!, verified: false };
      }
      return r;
    });

    await supabase
      .from('email_sending_domains')
      .update({
        dns_records: updatedRecords,
        dkim_verified: false,
        dns_status: 'dkim_pending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', d.id);

    console.warn(
      `[DKIM Drift] ${d.domain}: EXO Status=${config.Status} Enabled=${config.Enabled}; ` +
      `selector1 stored=${storedSel1} exo=${exoSel1}; selector2 stored=${storedSel2} exo=${exoSel2}`,
    );

    // Auto-heal path: push the fresh EXO CNAMEs back to whichever DNS provider
    // owns this domain, then re-trigger Set-DkimSigningConfig so EXO picks up
    // the new keys on its next propagation check. The next cron run (24h)
    // flips dkim_verified back to true once the live key is published.
    //
    // Provider precedence: Cloudflare → Porkbun. CF is the modern path used
    // by the wizard and propagates in seconds; Porkbun is the legacy registrar
    // integration. Domains can have both linked during a migration, prefer CF.
    let reEnableStatus: string | null = null;
    const { channel: pushChannel, result } = await pushDkimToDnsProvider(supabase, {
      id: d.id,
      domain: d.domain,
      dns_records: updatedRecords,
      dns_provider_id: d.dns_provider_id,
      cloudflare_zone_id: d.cloudflare_zone_id,
      registrar_credentials_id: d.registrar_credentials_id,
    });
    const pushResult: PushResult | undefined = pushChannel ? result : undefined;

    if (pushResult?.attempted && pushResult.failed === 0) {
      try {
        const reEnabled = await enableDkimSigning(token, tenantTenantId, d.domain);
        reEnableStatus = reEnabled?.Status ?? 'no_response';
        console.log(`[DKIM Drift] ${d.domain}: pushed ${pushResult.pushed} record(s) via ${pushChannel}; EXO re-enable Status=${reEnableStatus}`);
      } catch (e) {
        reEnableStatus = `error: ${(e as Error).message}`;
      }
    } else if (pushResult?.attempted) {
      console.error(`[DKIM Drift] ${d.domain}: ${pushChannel} push failed — ${pushResult.errors.join(' | ')}`);
    }

    // Notify org owners/admins. Two distinct narratives:
    //   - auto_healed: registrar push succeeded → informational ("we fixed it")
    //   - action_required: BYO domain or push failed → customer must publish CNAMEs
    const newSelectorRecords = updatedRecords
      .filter((r) => r.type === 'CNAME' && r.name.toLowerCase().includes('._domainkey.'))
      .map((r) => ({ type: r.type, name: r.name, value: r.value }));

    const autoHealed = pushResult?.attempted === true && pushResult.failed === 0;

    // 7-day debounce per (domain, mode): a BYO customer who hasn't fixed it shouldn't
    // get the same email every morning. Auto-healed notifications also debounce — they
    // only fire on the run that actually performed the heal.
    const meta = (d.metadata as Record<string, unknown> | null) ?? {};
    const lastNotifiedRaw = (meta.dkim_drift_notified_at as string | undefined) ?? null;
    const lastNotifiedMode = (meta.dkim_drift_notified_mode as string | undefined) ?? null;
    const lastNotifiedAt = lastNotifiedRaw ? new Date(lastNotifiedRaw).getTime() : 0;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const targetMode = autoHealed ? 'auto_healed' : 'action_required';
    const recentlyNotifiedSameMode = lastNotifiedMode === targetMode && Date.now() - lastNotifiedAt < sevenDaysMs;

    let notification: NotifyResult | undefined;
    if (!recentlyNotifiedSameMode) {
      notification = await notifyDkimDrift(supabase, {
        domainId: d.id,
        domain: d.domain,
        organizationId: d.organization_id,
        mode: targetMode,
        newSelectorRecords,
        exoStatus: config.Status,
        pushedRecordCount: pushResult?.pushed,
      });

      if (notification.sent) {
        await supabase
          .from('email_sending_domains')
          .update({
            metadata: {
              ...meta,
              dkim_drift_notified_at: new Date().toISOString(),
              dkim_drift_notified_mode: targetMode,
            },
          })
          .eq('id', d.id);
      }
    } else {
      notification = { sent: false, recipients: [], reason: 'debounced_7d' };
    }

    reports.push({
      domain_id: d.id,
      domain: d.domain,
      outcome: 'drift_detected',
      exo_status: config.Status,
      exo_enabled: config.Enabled,
      old_selector1: storedSel1,
      new_selector1: exoSel1,
      registrar_push: pushResult,
      exo_re_enable_status: reEnableStatus,
      notification,
    });
  }

  const driftCount = reports.filter((r) => r.outcome === 'drift_detected').length;
  return jsonResponse({
    success: true,
    checked: reports.length,
    drift_detected: driftCount,
    results: reports,
  });
});
