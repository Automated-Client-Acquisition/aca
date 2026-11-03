/**
 * Infrastructure Health Check (Cron — runs hourly)
 *
 * Comprehensive health monitoring for cold email infrastructure:
 * 1. Azure subscription credential validation
 * 2. VM status check (running/stopped)
 * 3. DNS record re-verification
 * 4. SMTP/IMAP connectivity testing (inbox connection check)
 * 5. Domain reputation monitoring (bounce rate, spam complaints, blacklists)
 * 6. Per-mailbox connection health
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getAzureToken, getVMStatus, AzureAPIError, runCommandOnVM } from '../_shared/azure-sdk.ts';
import { decryptValue } from '../_shared/encryption.ts';
import { verifyDnsRecord } from '../_shared/dns-utils.ts';
import { healthCheck as vmHealthCheck, testSMTPConnection, testIMAPConnection } from '../_shared/postal-client.ts';

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

// Diagnostic health thresholds; never stop or throttle sending
const BOUNCE_RATE_WARNING = 0.05;  // 5% — yellow warning
const BOUNCE_RATE_CRITICAL = 0.10; // 10% — critical observation
const SPAM_RATE_WARNING = 0.01;    // 1% — needs attention
const SPAM_RATE_CRITICAL = 0.03;   // 3% — domain at risk

// Well-known DNS blacklists to check
const BLACKLISTS = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net',
  'spam.dnsbl.sorbs.net',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const results: Array<{ domain: string; checks: Record<string, unknown> }> = [];

    // 1. Get all active subscriptions
    const { data: subscriptions } = await supabase
      .from('azure_subscriptions')
      .select('*')
      .eq('status', 'connected');

    if (!subscriptions?.length) {
      return jsonResponse({ success: true, message: 'No active subscriptions', results: [] });
    }

    // Validate each subscription
    for (const sub of subscriptions) {
      try {
        const clientSecret = await decryptValue(sub.client_secret_encrypted);
        await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);

        await supabase
          .from('azure_subscriptions')
          .update({ last_validated_at: new Date().toISOString(), last_error: null })
          .eq('id', sub.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Credential validation failed';
        console.error(`[Health] Subscription ${sub.subscription_id} credential check failed:`, message);

        await supabase
          .from('azure_subscriptions')
          .update({ status: 'error', last_error: message, updated_at: new Date().toISOString() })
          .eq('id', sub.id);
      }
    }

    // 2. Get all running domains
    const { data: domains } = await supabase
      .from('email_sending_domains')
      .select('*, azure_subscriptions!inner(*)')
      .in('vm_status', ['running', 'error']);

    if (!domains?.length) {
      return jsonResponse({ success: true, message: 'No active domains', results: [] });
    }

    for (const domain of domains) {
      const checks: Record<string, unknown> = {};
      const sub = domain.azure_subscriptions;

      // 2a. VM status check
      try {
        const clientSecret = await decryptValue(sub.client_secret_encrypted);
        const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
        const domainRg = domain.metadata?.resource_group || sub.resource_group || 'aca-email-infra';
        const vmStatus = await getVMStatus(
          token,
          sub.subscription_id,
          domainRg,
          domain.vm_name
        );
        checks.vm_status = vmStatus.provisioningState;
        checks.vm_power = vmStatus.powerState;

        if (vmStatus.provisioningState !== 'Succeeded' || vmStatus.powerState !== 'running') {
          checks.vm_healthy = false;
        } else {
          checks.vm_healthy = true;
        }
      } catch (err) {
        checks.vm_status = 'unreachable';
        checks.vm_healthy = false;
        checks.vm_error = err instanceof Error ? err.message : 'VM check failed';
      }

      // 2b. SMTP connectivity
      if (domain.public_ip) {
        const smtpOk = await testSMTPConnection(domain.public_ip, 587);
        checks.smtp_connected = smtpOk;

        // 2c. IMAP connectivity
        const imapOk = await testIMAPConnection(domain.public_ip, 993);
        checks.imap_connected = imapOk;
      } else {
        checks.smtp_connected = false;
        checks.imap_connected = false;
      }

      // 2d. Service health via Run Command (if VM is reachable)
      if (checks.vm_healthy && domain.public_ip) {
        try {
          const clientSecret = await decryptValue(sub.client_secret_encrypted);
          const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
          const health = await vmHealthCheck({
            token,
            subscriptionId: sub.subscription_id,
            resourceGroup: domain.metadata?.resource_group || sub.resource_group || 'aca-email-infra',
            vmName: domain.vm_name,
          });
          checks.services = health;
        } catch {
          checks.services = { error: 'Could not run health check on VM' };
        }
      }

      // 3. Domain reputation monitoring — check bounce rates from recent stats
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: mailboxes } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, status')
        .eq('sending_domain_id', domain.id);

      if (mailboxes?.length) {
        const mailboxIds = mailboxes.map((m) => m.id);

        // Get aggregate send stats for last 7 days
        const { data: stats } = await supabase
          .from('email_mailbox_daily_stats')
          .select('sent, bounced, spam_complaints')
          .in('mailbox_id', mailboxIds)
          .gte('stat_date', sevenDaysAgo);

        if (stats?.length) {
          const totalSent = stats.reduce((sum, s) => sum + (s.sent || 0), 0);
          const totalBounced = stats.reduce((sum, s) => sum + (s.bounced || 0), 0);
          const totalSpam = stats.reduce((sum, s) => sum + (s.spam_complaints || 0), 0);

          const bounceRate = totalSent > 0 ? totalBounced / totalSent : 0;
          const spamRate = totalSent > 0 ? totalSpam / totalSent : 0;

          checks.bounce_rate = Math.round(bounceRate * 10000) / 100; // percentage
          checks.spam_rate = Math.round(spamRate * 10000) / 100;
          checks.total_sent_7d = totalSent;
          checks.total_bounced_7d = totalBounced;
          checks.total_spam_7d = totalSpam;

          // Determine domain health
          if (bounceRate >= BOUNCE_RATE_CRITICAL || spamRate >= SPAM_RATE_CRITICAL) {
            checks.domain_health = 'burned';
          } else if (bounceRate >= BOUNCE_RATE_WARNING || spamRate >= SPAM_RATE_WARNING) {
            checks.domain_health = 'warning';
          } else {
            checks.domain_health = 'healthy';
          }
        } else {
          checks.domain_health = 'no_data';
        }

        // Per-mailbox connection check
        const disconnectedMailboxes: string[] = [];
        for (const mb of mailboxes) {
          if (mb.status === 'disconnected') continue;
          // Simple connectivity: if SMTP is down, all mailboxes are disconnected
          if (!checks.smtp_connected) {
            disconnectedMailboxes.push(mb.email_address);
          }
        }
        checks.disconnected_mailboxes = disconnectedMailboxes;
        checks.active_mailboxes = mailboxes.filter((m) => m.status !== 'disconnected').length;
      }

      // 4. IP blacklist check
      if (domain.public_ip) {
        const blacklistResults = await checkBlacklists(domain.public_ip);
        checks.blacklisted = blacklistResults.filter((r) => r.listed).length > 0;
        checks.blacklist_details = blacklistResults;

        if (checks.blacklisted && checks.domain_health !== 'burned') {
          checks.domain_health = 'burned';
        }
      }

      // 5. Periodic DNS re-verification (every 6 hours)
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      if (domain.dns_records?.length && (!domain.last_dns_check_at || domain.last_dns_check_at < sixHoursAgo)) {
        let dnsAllOk = true;
        const dnsFailures: string[] = [];

        for (const record of domain.dns_records) {
          if ((record as any).optional) continue;
          try {
            const result = await verifyDnsRecord(record);
            if (!result.ok) {
              dnsAllOk = false;
              dnsFailures.push(record.name);
            }
          } catch {
            dnsAllOk = false;
            dnsFailures.push(record.name);
          }
        }

        checks.dns_all_verified = dnsAllOk;
        checks.dns_failures = dnsFailures;

        if (!dnsAllOk && domain.dns_status === 'verified') {
          await supabase
            .from('email_sending_domains')
            .update({
              dns_status: 'pending',
              last_dns_check_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', domain.id);
          checks.dns_regression = true;
        } else {
          await supabase
            .from('email_sending_domains')
            .update({ last_dns_check_at: new Date().toISOString() })
            .eq('id', domain.id);
        }
      }

      // 6. Policy progression (SPF ~all -> -all, DMARC none -> quarantine -> reject, MTA-STS testing -> enforce)
      if (domain.dns_status === 'verified' && domain.dns_records?.length) {
        const domainAgeDays = Math.floor(
          (Date.now() - new Date(domain.created_at).getTime()) / (24 * 60 * 60 * 1000)
        );

        const { data: readyMailboxes } = await supabase
          .from('email_mailboxes')
          .select('id')
          .eq('sending_domain_id', domain.id)
          .eq('status', 'ready')
          .limit(1);

        const hasReadyMailboxes = (readyMailboxes?.length || 0) > 0;
        const domainHealthy = checks.domain_health === 'healthy' || checks.domain_health === 'no_data';

        let policyChanged = false;
        const updatedRecords = [...domain.dns_records];

        // SPF: ~all -> -all after warmup complete
        if (hasReadyMailboxes) {
          const spfIdx = updatedRecords.findIndex(
            (r: any) => r.type === 'TXT' && r.value?.includes('v=spf1') && r.value?.includes('~all')
          );
          if (spfIdx >= 0) {
            updatedRecords[spfIdx] = {
              ...updatedRecords[spfIdx],
              value: updatedRecords[spfIdx].value.replace('~all', '-all'),
              verified: false,
            };
            policyChanged = true;
            console.log(`[Health] [${domain.domain}] SPF upgraded to hardfail (-all)`);
          }
        }

        // DMARC: none -> quarantine (after warmup), quarantine -> reject (after 60 days healthy)
        if (hasReadyMailboxes || domainAgeDays >= 60) {
          const dmarcIdx = updatedRecords.findIndex(
            (r: any) => r.type === 'TXT' && r.name?.startsWith('_dmarc.')
          );
          if (dmarcIdx >= 0) {
            const currentPolicy = updatedRecords[dmarcIdx].value.match(/p=(\w+)/)?.[1];

            if (currentPolicy === 'none' && hasReadyMailboxes) {
              updatedRecords[dmarcIdx] = {
                ...updatedRecords[dmarcIdx],
                value: updatedRecords[dmarcIdx].value.replace('p=none', 'p=quarantine'),
                verified: false,
              };
              policyChanged = true;
              console.log(`[Health] [${domain.domain}] DMARC upgraded to quarantine`);
            } else if (currentPolicy === 'quarantine' && domainAgeDays >= 60 && domainHealthy && !checks.blacklisted) {
              updatedRecords[dmarcIdx] = {
                ...updatedRecords[dmarcIdx],
                value: updatedRecords[dmarcIdx].value.replace('p=quarantine', 'p=reject'),
                verified: false,
              };
              policyChanged = true;
              console.log(`[Health] [${domain.domain}] DMARC upgraded to reject`);
            }
          }
        }

        // MTA-STS: testing -> enforce (after 60 days healthy)
        if (domainAgeDays >= 60 && domainHealthy && !checks.blacklisted) {
          const mtaStsIdx = updatedRecords.findIndex(
            (r: any) => r.type === 'TXT' && r.name?.startsWith('_mta-sts.')
          );
          if (mtaStsIdx >= 0) {
            updatedRecords[mtaStsIdx] = {
              ...updatedRecords[mtaStsIdx],
              value: `v=STSv1; id=${Date.now()}`,
              verified: false,
            };
            policyChanged = true;

            // Update nginx on VM to enforce mode
            try {
              const clientSecret = await decryptValue(sub.client_secret_encrypted);
              const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
              const rg = domain.metadata?.resource_group || sub.resource_group || 'aca-email-infra';
              await runCommandOnVM(token, sub.subscription_id, rg, domain.vm_name, [
                `/usr/local/bin/aca-manage upgrade-mta-sts-mode enforce '${domain.domain}'`
              ]);
            } catch (err) {
              console.error(`[Health] MTA-STS upgrade failed for ${domain.domain}:`, err);
            }
          }
        }

        if (policyChanged) {
          await supabase
            .from('email_sending_domains')
            .update({
              dns_records: updatedRecords,
              dns_status: 'pending',
              dmarc_verified: false,
              spf_verified: false,
              updated_at: new Date().toISOString(),
            })
            .eq('id', domain.id);

          checks.policy_upgraded = true;
        }
      }

      // 7. Health is diagnostic. Domain pause/resume belongs to the operator;
      // recipient observations never change mailbox status or daily limits.
      if (checks.domain_health === 'burned' || checks.domain_health === 'warning') {
        checks.monitoring_note = 'All recipients in mailbox daily stats; provider breakdown unavailable. Monitoring continues; sending unchanged. Operator may pause/resume the domain.';
        console.warn(`[Health] [${domain.domain}] ${checks.domain_health}: ${checks.monitoring_note}`);
      }

      // 8. Calculate domain health score
      const domainBounceRate = typeof checks.bounce_rate === 'number' ? checks.bounce_rate / 100 : 0;
      const domainSpamRate = typeof checks.spam_rate === 'number' ? checks.spam_rate / 100 : 0;
      const domainHealthScore = Math.max(0, Math.min(1, 1.0 - domainBounceRate * 5 - domainSpamRate * 10));

      // 9. Update domain record with health status
      const metadata = {
        ...(domain.metadata || {}),
        last_health_check: {
          timestamp: new Date().toISOString(),
          vm_healthy: checks.vm_healthy,
          smtp_connected: checks.smtp_connected,
          imap_connected: checks.imap_connected,
          domain_health: checks.domain_health,
          bounce_rate: checks.bounce_rate,
          spam_rate: checks.spam_rate,
          blacklisted: checks.blacklisted,
          disconnected_mailboxes: checks.disconnected_mailboxes,
        },
      };

      // If SMTP is down, mark all mailboxes as needing attention
      if (!checks.smtp_connected && mailboxes?.length) {
        const activeMailboxIds = mailboxes
          .filter((m) => m.status !== 'disconnected')
          .map((m) => m.id);

        if (activeMailboxIds.length > 0) {
          for (const mailboxId of activeMailboxIds) {
            const { error } = await supabase.rpc('apply_mailbox_metadata_patch', {
              p_id: mailboxId,
              p_set: { connection_issue: 'SMTP unreachable', last_check: new Date().toISOString() },
              p_unset: [],
            });
            if (error) console.warn(`[Health] Connection observation failed for ${mailboxId}: ${error.message}`);
          }
        }
      }

      const domainUpdate: Record<string, unknown> = {
        last_health_check_at: new Date().toISOString(),
        domain_health: checks.domain_health || 'no_data',
        health_score: Math.round(domainHealthScore * 100) / 100,
        bounce_rate: Math.round(domainBounceRate * 10000) / 10000,
        spam_rate: Math.round(domainSpamRate * 10000) / 10000,
        metadata,
        updated_at: new Date().toISOString(),
      };

      await supabase
        .from('email_sending_domains')
        .update(domainUpdate)
        .eq('id', domain.id);

      // 10. Log health history for trending
      await supabase
        .from('email_domain_health_log')
        .insert({
          domain_id: domain.id,
          health_score: Math.round(domainHealthScore * 100) / 100,
          bounce_rate: Math.round(domainBounceRate * 10000) / 10000,
          spam_rate: Math.round(domainSpamRate * 10000) / 10000,
          domain_health: checks.domain_health || 'no_data',
          total_sent_7d: checks.total_sent_7d || 0,
          blacklisted: checks.blacklisted || false,
          notes: checks.monitoring_note ?? 'Infrastructure monitoring; sending controls unchanged.',
        });

      results.push({ domain: domain.domain, checks });
    }

    // ================================================================
    // 11. Subscription-level health aggregation
    // ================================================================
    for (const sub of subscriptions!) {
      const { data: subDomains } = await supabase
        .from('email_sending_domains')
        .select('id, domain_health, mailbox_count')
        .eq('subscription_id', sub.id);

      if (!subDomains?.length) continue;

      const total = subDomains.length;
      const healthy = subDomains.filter((d) => d.domain_health === 'healthy' || d.domain_health === 'no_data').length;
      const burned = subDomains.filter((d) => d.domain_health === 'burned').length;
      const totalMailboxes = subDomains.reduce((sum, d) => sum + (d.mailbox_count || 0), 0);

      // Subscription health = ratio of healthy domains
      const subHealthScore = total > 0 ? Math.round((healthy / total) * 100) / 100 : 1.0;

      // Count active mailboxes across all domains
      const domainIds = subDomains.map((d) => d.id);
      const { count: activeCount } = await supabase
        .from('email_mailboxes')
        .select('id', { count: 'exact', head: true })
        .in('sending_domain_id', domainIds)
        .in('status', ['ready', 'warming']);

      await supabase
        .from('azure_subscriptions')
        .update({
          health_score: subHealthScore,
          total_domains: total,
          healthy_domains: healthy,
          burned_domains: burned,
          total_mailboxes: totalMailboxes,
          active_mailboxes: activeCount || 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', sub.id);
    }

    return jsonResponse({ success: true, checked: results.length, results });

  } catch (error) {
    console.error('[Infra Health Check] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

// ============================================================================
// IP Blacklist Check
// ============================================================================

async function checkBlacklists(ip: string): Promise<Array<{ list: string; listed: boolean }>> {
  // Reverse the IP octets for DNSBL lookup
  const reversed = ip.split('.').reverse().join('.');
  const results: Array<{ list: string; listed: boolean }> = [];

  for (const bl of BLACKLISTS) {
    try {
      const query = `${reversed}.${bl}`;
      const records = await Deno.resolveDns(query, 'A');
      // If we get A records back, the IP is listed
      results.push({ list: bl, listed: records.length > 0 });
    } catch {
      // NXDOMAIN = not listed (this is the expected/good result)
      results.push({ list: bl, listed: false });
    }
  }

  return results;
}
