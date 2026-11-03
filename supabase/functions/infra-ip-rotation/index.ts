/**
 * @deprecated — Legacy VM IP rotation. No longer needed with ACS (no dedicated IPs).
 * Can be removed once all postal-type domains are decommissioned.
 *
 * Infrastructure IP Rotation (Cron — runs daily)
 *
 * Checks all email_sending_domains where ip_assigned_at + 14 days < NOW()
 * and rotates their public IP addresses via Azure API.
 *
 * Flow per domain:
 * 1. Create new static public IP
 * 2. Disassociate old IP from NIC
 * 3. Associate new IP to NIC
 * 4. Delete old IP resource
 * 5. Update Postfix config on VM (hostname, HELO)
 * 6. Regenerate SPF record (new IP)
 * 7. Set dns_status = 'pending'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { rotatePublicIP, getAzureToken, runCommandOnVM } from '../_shared/azure-sdk.ts';
import { decryptValue, encryptJSON, decryptJSON } from '../_shared/encryption.ts';

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

const IP_ROTATION_DAYS = 14;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Find domains due for IP rotation
    const cutoffDate = new Date(Date.now() - IP_ROTATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data: domains } = await supabase
      .from('email_sending_domains')
      .select('*, azure_subscriptions!inner(*)')
      .eq('vm_status', 'running')
      .not('public_ip', 'is', null)
      .lt('ip_assigned_at', cutoffDate);

    if (!domains?.length) {
      return jsonResponse({ success: true, message: 'No domains due for IP rotation', rotated: 0 });
    }

    const results: Array<{ domain: string; success: boolean; old_ip?: string; new_ip?: string; error?: string }> = [];

    for (const domain of domains) {
      const sub = domain.azure_subscriptions;

      try {
        console.log(`[IP Rotation] Rotating IP for ${domain.domain} (current: ${domain.public_ip})`);

        const clientSecret = await decryptValue(sub.client_secret_encrypted);
        const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
        const rg = domain.metadata?.resource_group || sub.resource_group || 'aca-email-infra';
        const nicName = `${domain.vm_name}-nic`;
        const oldIpName = `${domain.vm_name}-ip`;
        const newIpName = `${domain.vm_name}-ip-${Date.now()}`;

        // Rotate the IP via Azure API
        const newIp = await rotatePublicIP(
          token,
          sub.subscription_id,
          rg,
          sub.region || 'eastus',
          nicName,
          oldIpName,
          newIpName,
          `mail.${domain.domain}`
        );

        // Update Postfix config on VM
        try {
          await runCommandOnVM(
            token,
            sub.subscription_id,
            rg,
            domain.vm_name,
            [`/usr/local/bin/aca-manage update-hostname 'mail.${domain.domain}' '${newIp.ipAddress}'`]
          );
        } catch (err) {
          console.error(`[IP Rotation] Failed to update Postfix config for ${domain.domain}:`, err);
        }

        // Re-run certbot for new IP (cert may need reissue)
        try {
          await runCommandOnVM(
            token,
            sub.subscription_id,
            rg,
            domain.vm_name,
            [`/usr/local/bin/aca-manage setup-tls '${domain.domain}'`]
          );
        } catch (err) {
          console.error(`[IP Rotation] Certbot re-run failed for ${domain.domain}:`, err);
        }

        // Update DNS records — SPF needs new IP
        const dnsRecords = (domain.dns_records || []).map((r: Record<string, unknown>) => {
          // Update SPF record with new IP
          if (r.type === 'TXT' && typeof r.value === 'string' && r.value.startsWith('v=spf1')) {
            const suffix = r.value.includes('-all') ? '-all' : '~all';
            return { ...r, value: `v=spf1 ip4:${newIp.ipAddress} ${suffix}`, verified: false };
          }
          // Update all A records (root, www, mail, mta-sts)
          if (r.type === 'A') {
            return { ...r, value: newIp.ipAddress, verified: false };
          }
          // Refresh MTA-STS id to invalidate caches
          if (r.type === 'TXT' && typeof r.value === 'string' && r.value.startsWith('v=STSv1')) {
            return { ...r, value: `v=STSv1; id=${Date.now()}`, verified: false };
          }
          return r;
        });

        // Update domain record
        await supabase
          .from('email_sending_domains')
          .update({
            public_ip: newIp.ipAddress,
            public_ip_resource_id: newIp.id,
            ip_assigned_at: new Date().toISOString(),
            dns_status: 'pending',
            dns_records: dnsRecords,
            spf_verified: false,
            metadata: {
              ...(domain.metadata || {}),
              last_ip_rotation: {
                old_ip: domain.public_ip,
                new_ip: newIp.ipAddress,
                rotated_at: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', domain.id);

        // Re-encrypt SMTP/IMAP credentials with new IP for all mailboxes on this domain
        // Credentials are stored as encrypted blob in metadata.smtp_credentials
        const { data: mbs } = await supabase
          .from('email_mailboxes')
          .select('id, metadata')
          .eq('sending_domain_id', domain.id)
          .neq('status', 'disconnected');

        for (const mb of mbs || []) {
          try {
            const meta = mb.metadata || {};
            const encryptedCreds = meta.smtp_credentials as string;
            if (!encryptedCreds) continue;

            // Decrypt, update hosts, re-encrypt
            const creds = await decryptJSON<Record<string, unknown>>(encryptedCreds);
            creds.smtp_host = newIp.ipAddress;
            creds.imap_host = newIp.ipAddress;
            const reEncrypted = await encryptJSON(creds);

            await supabase
              .from('email_mailboxes')
              .update({
                metadata: { ...meta, smtp_credentials: reEncrypted },
                updated_at: new Date().toISOString(),
              })
              .eq('id', mb.id);
          } catch (credErr) {
            console.error(`[IP Rotation] Failed to re-encrypt creds for mailbox ${mb.id}:`, credErr);
          }
        }

        console.log(`[IP Rotation] ${domain.domain}: ${domain.public_ip} → ${newIp.ipAddress}`);

        results.push({
          domain: domain.domain,
          success: true,
          old_ip: domain.public_ip,
          new_ip: newIp.ipAddress,
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : 'IP rotation failed';
        console.error(`[IP Rotation] Failed for ${domain.domain}:`, message);

        await supabase
          .from('email_sending_domains')
          .update({
            metadata: {
              ...(domain.metadata || {}),
              ip_rotation_error: { message, failed_at: new Date().toISOString() },
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', domain.id);

        results.push({ domain: domain.domain, success: false, error: message });
      }
    }

    return jsonResponse({
      success: true,
      rotated: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });

  } catch (error) {
    console.error('[Infra IP Rotation] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
