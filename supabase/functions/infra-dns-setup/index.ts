/**
 * Infrastructure DNS Setup
 *
 * Generates and verifies DNS records for email sending domains.
 * Actions:
 *   - generate: Generate DNS records for a domain
 *   - verify: Verify all DNS records via DNS lookups
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { verifyDnsRecord, VerifyResult } from '../_shared/dns-utils.ts';
import { getAzureToken, runCommandOnVM, setReverseDns, azureDomainLabel } from '../_shared/azure-sdk.ts';
import { decryptValue } from '../_shared/encryption.ts';
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

    // ── verify ──────────────────────────────────────────────────────
    if (action === 'verify') {
      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      // The service-role client acts on whatever org the body names, so the caller
      // must be able to access it (a valid anon-key JWT alone is not enough).
      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      let { data: domainRecord, error: fetchError } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      // For M365 domains, re-read DKIM from Exchange Online before verifying so a
      // stale/provisional Selector CNAME (the shard letter Microsoft hands out
      // before the domain's MX is correctly pointed at Microsoft) gets corrected
      // to the live value on every manual verify — instead of waiting for the 24h
      // drift-check cron. infra-m365-dkim-drift-check also auto-pushes the fresh
      // CNAMEs to Cloudflare when DNS is managed. Best-effort: never block verify.
      if (domainRecord.infra_type === 'm365' && domainRecord.m365_tenant_id) {
        try {
          const driftRes = await fetch(`${supabaseUrl}/functions/v1/infra-m365-dkim-drift-check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseKey}` },
            body: JSON.stringify({ domain_id: domainRecord.id, organization_id: domainRecord.organization_id }),
          });
          driftRes.body?.cancel().catch(() => { /* ignore */ });
          // Re-read the domain — the drift-check may have rewritten dns_records
          // with the live EXO Selector CNAMEs and downgraded dkim_verified.
          const { data: refreshed } = await supabase
            .from('email_sending_domains')
            .select('*')
            .eq('id', domainRecord.id)
            .single();
          if (refreshed) domainRecord = refreshed;
        } catch (err) {
          console.warn(`[DNS Setup] DKIM pre-verify refresh failed for ${domainRecord.domain}: ${err instanceof Error ? err.message : err}`);
        }
      }

      const domain = domainRecord.domain;
      const dnsRecords = domainRecord.dns_records || [];
      const results: Array<{ type: string; name: string; verified: boolean; found_value?: string; error?: string; conflict?: string }> = [];

      let spfVerified = false;
      let dkimVerified = false;
      let dmarcVerified = false;

      for (const record of dnsRecords) {
        try {
          const verified = await verifyDnsRecord(record);
          results.push({
            type: record.type,
            name: record.name,
            verified: verified.ok,
            found_value: verified.foundValue,
            error: verified.error,
            conflict: verified.conflict,
          });

          // Track auth verification. A conflict (duplicate SPF/DMARC, extra
          // MX) means the record is published but receivers won't trust it,
          // so we treat conflicting records as NOT verified for the purposes
          // of the auth flags — even though the individual record entry stays
          // ok:true and the wizard shows it as a warning.
          const trusted = verified.ok && !verified.conflict;
          if (record.name === domain && record.type === 'TXT' && record.value.startsWith('v=spf1')) {
            spfVerified = trusted;
          }
          if (record.name.includes('._domainkey.')) {
            dkimVerified = verified.ok;
          }
          if (record.name === `_dmarc.${domain}`) {
            dmarcVerified = trusted;
          }
        } catch (err) {
          results.push({
            type: record.type,
            name: record.name,
            verified: false,
            error: err instanceof Error ? err.message : 'Lookup failed',
          });
        }
      }

      // Update DNS records with verified flags + any conflict warning. The
      // wizard reads `conflict` off each record to render an inline warning
      // even when verified:true.
      const updatedRecords = dnsRecords.map((r: Record<string, unknown>, i: number) => ({
        ...r,
        verified: results[i]?.verified || false,
        conflict: results[i]?.conflict ?? null,
      }));

      // A domain with conflicts is not "all verified" for downstream gates
      // (TLS provisioning, mailbox creation) — even though each record
      // individually passes the existence check, mail will silently fail.
      const allVerified = results.every((r) => r.verified && !r.conflict);
      const conflicts = results.filter((r) => r.conflict).map((r) => ({ name: r.name, type: r.type, conflict: r.conflict! }));

      await supabase
        .from('email_sending_domains')
        .update({
          dns_records: updatedRecords,
          dns_status: allVerified ? 'verified' : 'pending',
          spf_verified: spfVerified,
          dkim_verified: dkimVerified,
          dmarc_verified: dmarcVerified,
          last_dns_check_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', domain_id);

      // Trigger certbot + reverse DNS when all DNS records verified
      // Run if: first-time verification OR TLS was never successfully configured (tls_configured flag missing)
      const tlsAlreadyConfigured = domainRecord.metadata?.tls_configured === true;
      if (allVerified && !tlsAlreadyConfigured) {
        try {
          const { data: sub } = await supabase
            .from('azure_subscriptions')
            .select('*')
            .eq('id', domainRecord.subscription_id)
            .single();

          if (sub && sub.status === 'connected') {
            const clientSecret = await decryptValue(sub.client_secret_encrypted);
            const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
            const rg = domainRecord.metadata?.resource_group || sub.resource_group || 'aca-email-infra';

            // Run certbot on VM to get Let's Encrypt TLS certs
            try {
              console.log(`[DNS Setup] Triggering certbot for ${domain}`);
              const tlsResult = await runCommandOnVM(token, sub.subscription_id, rg, domainRecord.vm_name, [
                `/usr/local/bin/aca-manage setup-tls '${domain}'`
              ]);
              const tlsOk = tlsResult && tlsResult.includes('OK: TLS configured');
              if (tlsOk) {
                // Mark TLS as configured so we don't re-run on every verify
                await supabase
                  .from('email_sending_domains')
                  .update({
                    metadata: { ...domainRecord.metadata, tls_configured: true, tls_configured_at: new Date().toISOString() },
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', domain_id);
                console.log(`[DNS Setup] TLS successfully configured for ${domain}`);
              } else {
                console.warn(`[DNS Setup] Certbot ran but may have failed for ${domain}: ${tlsResult?.substring(0, 200)}`);
              }
            } catch (err) {
              console.error(`[DNS Setup] Certbot trigger failed for ${domain}:`, err);
            }

            // Set reverse DNS (PTR) on the public IP
            try {
              const ipName = `${domainRecord.vm_name}-ip`;
              console.log(`[DNS Setup] Setting reverse DNS for ${domain}`);
              await setReverseDns(
                token, sub.subscription_id, rg, sub.region || 'eastus',
                ipName, `mail.${domain}`,
                azureDomainLabel(`mail-${domain}`)
              );
            } catch (err) {
              console.error(`[DNS Setup] Reverse DNS setup failed for ${domain}:`, err);
            }
          }
        } catch (err) {
          console.error(`[DNS Setup] Post-verification setup failed for ${domain}:`, err);
        }
      }

      return jsonResponse({
        success: true,
        all_verified: allVerified,
        results,
        conflicts,
        has_conflicts: conflicts.length > 0,
        spf_verified: spfVerified,
        dkim_verified: dkimVerified,
        dmarc_verified: dmarcVerified,
      });
    }

    // ── setup-tls ─────────────────────────────────────────────────
    // Trigger Let's Encrypt TLS setup on one or all running domains.
    // Use this to fix domains stuck with self-signed certificates.
    if (action === 'setup-tls') {
      const { domain_id, organization_id, all } = body;

      if (!organization_id) {
        return jsonResponse({ error: 'organization_id is required' }, 400);
      }

      try {
        await assertOrgAccess(req, supabase, organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }

      // Fetch domains to process
      let query = supabase
        .from('email_sending_domains')
        .select('*')
        .eq('organization_id', organization_id)
        .eq('vm_status', 'running');

      if (domain_id && !all) {
        query = query.eq('id', domain_id);
      }

      const { data: domains, error: fetchError } = await query;

      if (fetchError || !domains?.length) {
        return jsonResponse({ error: 'No running domains found' }, 404);
      }

      const results: Array<{ domain: string; success: boolean; message: string }> = [];

      for (const domainRecord of domains) {
        try {
          const { data: sub } = await supabase
            .from('azure_subscriptions')
            .select('*')
            .eq('id', domainRecord.subscription_id)
            .single();

          if (!sub || sub.status !== 'connected') {
            results.push({ domain: domainRecord.domain, success: false, message: 'Azure subscription not connected' });
            continue;
          }

          const clientSecret = await decryptValue(sub.client_secret_encrypted);
          const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
          const rg = domainRecord.metadata?.resource_group || sub.resource_group || 'aca-email-infra';

          console.log(`[TLS Setup] Running certbot + Dovecot fix for ${domainRecord.domain} on VM ${domainRecord.vm_name}`);
          const d = domainRecord.domain;
          // Step 1: Run certbot (may already have certs)
          await runCommandOnVM(token, sub.subscription_id, rg, domainRecord.vm_name, [
            `certbot --nginx -d "mail.${d}" -d "mta-sts.${d}" --non-interactive --agree-tos --email "admin@${d}" --redirect 2>&1 || true`
          ]).catch(() => {});
          // Step 2: Configure Postfix + Dovecot with the certs, increase process limits, and restart
          const tlsResult = await runCommandOnVM(token, sub.subscription_id, rg, domainRecord.vm_name, [
            `CERT=/etc/letsencrypt/live/mail.${d}/fullchain.pem && KEY=/etc/letsencrypt/live/mail.${d}/privkey.pem && if [ -f "$CERT" ]; then postconf -e "smtpd_tls_cert_file=$CERT" && postconf -e "smtpd_tls_key_file=$KEY" && postfix reload && echo "ssl = required" > /etc/dovecot/conf.d/10-ssl.conf && echo "ssl_cert = <$CERT" >> /etc/dovecot/conf.d/10-ssl.conf && echo "ssl_key = <$KEY" >> /etc/dovecot/conf.d/10-ssl.conf && echo "ssl_min_protocol = TLSv1.2" >> /etc/dovecot/conf.d/10-ssl.conf && printf "service imap-login {\\n  process_limit = 500\\n  service_count = 0\\n  process_min_avail = 5\\n  client_limit = 2\\n  vsz_limit = 128M\\n}\\n" > /etc/dovecot/conf.d/15-limits.conf && systemctl restart dovecot && echo "OK: TLS configured"; else echo "ERROR: Certbot failed - certs not found"; fi`
          ]);

          const tlsOk = tlsResult && tlsResult.includes('OK: TLS configured');

          if (tlsOk) {
            await supabase
              .from('email_sending_domains')
              .update({
                metadata: { ...(domainRecord.metadata || {}), tls_configured: true, tls_configured_at: new Date().toISOString() },
                updated_at: new Date().toISOString(),
              })
              .eq('id', domainRecord.id);

            results.push({ domain: domainRecord.domain, success: true, message: 'TLS configured with Let\'s Encrypt' });
          } else {
            results.push({ domain: domainRecord.domain, success: false, message: tlsResult?.substring(0, 300) || 'Certbot returned no output' });
          }

          // Also set reverse DNS if not done
          try {
            const ipName = `${domainRecord.vm_name}-ip`;
            await setReverseDns(
              token, sub.subscription_id, rg, sub.region || 'eastus',
              ipName, `mail.${domainRecord.domain}`,
              azureDomainLabel(`mail-${domainRecord.domain}`)
            );
          } catch {
            // Non-critical
          }
        } catch (err) {
          results.push({
            domain: domainRecord.domain,
            success: false,
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      return jsonResponse({
        success: true,
        processed: results.length,
        results,
      });
    }

    // ── diagnose ─────────────────────────────────────────────────
    // Run the built-in diagnostic commands on a domain's VM (as root) to
    // troubleshoot issues. Ops-only: service role required, and caller-supplied
    // commands are never accepted.
    if (action === 'diagnose') {
      if (!isServiceRoleRequest(req)) {
        return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
      }

      const { domain_id, organization_id } = body;

      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domainRecord } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();

      if (!domainRecord) {
        return jsonResponse({ error: 'Domain not found' }, 404);
      }

      const { data: sub } = await supabase
        .from('azure_subscriptions')
        .select('*')
        .eq('id', domainRecord.subscription_id)
        .single();

      if (!sub || sub.status !== 'connected') {
        return jsonResponse({ error: 'Azure subscription not connected' }, 400);
      }

      const clientSecret = await decryptValue(sub.client_secret_encrypted);
      const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
      const rg = domainRecord.metadata?.resource_group || sub.resource_group || 'aca-email-infra';
      const d = domainRecord.domain;

      const commands = [
        `echo "=== CONFIG ===" && cat /etc/dovecot/conf.d/10-ssl.conf 2>/dev/null && echo "=== LIMITS ===" && cat /etc/dovecot/conf.d/15-limits.conf 2>/dev/null && echo "=== STATUS ===" && systemctl status dovecot 2>&1 | head -10 && echo "=== PORTS ===" && ss -tlnp | grep -E '993|143'`
      ];

      const diagnosticResult = await runCommandOnVM(token, sub.subscription_id, rg, domainRecord.vm_name, commands);

      return jsonResponse({
        success: true,
        domain: d,
        vm_name: domainRecord.vm_name,
        diagnostic: diagnosticResult,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra DNS Setup] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
