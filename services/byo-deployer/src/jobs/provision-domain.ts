/**
 * provision_domain — generate DKIM, register domain in Postfix, return DNS records.
 *
 * Reads the email_sending_domains row created by infra-byo-domain-provision,
 * SSHes to the associated byo_server, runs add-domain.sh, parses the
 * ACA_DNS_RECORDS_BEGIN/END block, and writes the records back to
 * email_sending_domains.dns_records as JSON for the UI to render.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue, encryptValue } from '../encryption.js';
import { ADD_DOMAIN_SCRIPT } from '../scripts/add-domain.js';

export interface ProvisionDomainInput {
  organization_id: string;
  target_id: string; // email_sending_domains.id
}

export interface DnsRecord {
  type: 'TXT' | 'MX' | 'CNAME' | 'A';
  name: string;
  value: string;
  priority?: number;
  ttl: number;
  verified: boolean;
  description?: string;
}

export interface ProvisionDomainResult {
  ok: boolean;
  domain?: string;
  dkim_selector?: string;
  dns_records?: DnsRecord[];
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-add-domain.sh';

function parseDnsBlob(blob: string): Record<string, string> {
  const map: Record<string, string> = {};
  let inBlock = false;
  for (const line of blob.split('\n')) {
    if (line.trim() === 'ACA_DNS_RECORDS_BEGIN') { inBlock = true; continue; }
    if (line.trim() === 'ACA_DNS_RECORDS_END') break;
    if (!inBlock) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return map;
}

/** Quote a value for safe interpolation into a bash command line. */
function shq(value: string): string {
  return `'${String(value ?? '').replace(/'/g, "'\\''")}'`;
}

function buildDnsRecords(parsed: Record<string, string>): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (parsed.SPF_VALUE) {
    records.push({
      type: 'TXT', name: parsed.DOMAIN, value: parsed.SPF_VALUE, ttl: 3600, verified: false,
      description: 'SPF — authorizes the server\'s public IP to send mail for this domain.',
    });
  }
  if (parsed.DKIM_HOST && parsed.DKIM_VALUE) {
    records.push({
      type: 'TXT', name: parsed.DKIM_HOST, value: parsed.DKIM_VALUE, ttl: 3600, verified: false,
      description: 'DKIM — public key matching the private key OpenDKIM uses to sign outbound mail.',
    });
  }
  if (parsed.MX_HOST && parsed.MX_VALUE) {
    records.push({
      type: 'MX',
      name: parsed.MX_HOST,
      value: parsed.MX_VALUE,
      priority: Number(parsed.MX_PRIORITY) || 10,
      ttl: 3600,
      verified: false,
      description:
        'MX — routes inbound mail to this server. Without it replies and DMARC reports bounce, so the domain can send but never hear back.',
    });
  }
  if (parsed.DMARC_HOST && parsed.DMARC_VALUE) {
    records.push({
      type: 'TXT', name: parsed.DMARC_HOST, value: parsed.DMARC_VALUE, ttl: 3600, verified: false,
      description:
        'DMARC — p=reject with strict SPF/DKIM alignment. Publish this together with the SPF and DKIM records above: on its own it rejects your own mail.',
    });
  }
  return records;
}

export async function runProvisionDomainJob(
  supabase: SupabaseClient,
  input: ProvisionDomainInput,
  log: (line: string) => Promise<void>,
): Promise<ProvisionDomainResult> {
  const { data: domain, error } = await supabase
    .from('email_sending_domains')
    .select('id, organization_id, domain, infra_type, byo_server_id, dkim_selector, byo_helo_hostname, dmarc_email')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();

  if (error || !domain) return { ok: false, message: `Domain not found: ${error?.message ?? 'no row'}` };
  if (domain.infra_type !== 'byo') return { ok: false, message: 'Domain is not a BYO domain' };
  if (!domain.byo_server_id) return { ok: false, message: 'Domain is not attached to a byo_server' };

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, hostname, status')
    .eq('id', domain.byo_server_id as string)
    .single();
  if (serverErr || !server) return { ok: false, message: `Server not found: ${serverErr?.message ?? 'no row'}` };
  if (server.status !== 'ready') {
    return { ok: false, message: `Server status is "${server.status}" — deploy_base must complete first` };
  }
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server has no encrypted private key' };

  const privateKeyPem = decryptValue(server.ssh_private_key_encrypted as string);
  const selector = (domain.dkim_selector as string | null) || 'aca1';

  // Use the server's known IPv4 directly. ifconfig.io fallback prefers IPv6
  // on dual-stack hosts and produces broken SPF (ip4: prefix with v6 address).
  const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
  const publicIpHint = IPV4_RE.test(server.ssh_host as string) ? (server.ssh_host as string) : '';

  let session;
  try {
    session = await connectSsh(
      {
        host: server.ssh_host as string,
        port: server.ssh_port as number,
        username: server.ssh_username as string,
        privateKeyPem,
      },
      log,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `SSH failed: ${msg}` };
  }

  try {
    const rootCmd = (cmd: string) =>
      server.ssh_username === 'root' ? cmd : `sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`;

    await log(`[provision_domain] uploading add-domain.sh for ${domain.domain}`);
    await session.putContents(REMOTE_SCRIPT, ADD_DOMAIN_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    // The MX target is the server's own hostname — a long-lived infrastructure
    // host whose reputation outlives any single sending domain.
    const mailHost = (server.hostname as string | null) ?? '';
    const dmarcRua = (domain.dmarc_email as string | null) ?? '';
    if (!mailHost) {
      await log('[provision_domain] WARN: server has no hostname — skipping MX record, inbound mail will not reach this domain');
    }

    const result = await session.exec(
      rootCmd(
        `bash ${REMOTE_SCRIPT} ${shq(domain.domain as string)} ${shq(selector)} ${shq(publicIpHint)} ${shq(mailHost)} ${shq(dmarcRua)}`,
      ),
      { log },
    );
    if (result.code !== 0) {
      const msg = `add-domain.sh exited with code ${result.code}`;
      await supabase
        .from('email_sending_domains')
        .update({ dns_status: 'error', metadata: { last_error: msg } })
        .eq('id', domain.id);
      return { ok: false, message: msg };
    }

    const parsed = parseDnsBlob(result.stdout);
    const records = buildDnsRecords(parsed);
    if (records.length === 0) {
      const msg = 'add-domain.sh did not emit any DNS records — check the deployer log';
      await supabase
        .from('email_sending_domains')
        .update({ dns_status: 'error', metadata: { last_error: msg, parsed } })
        .eq('id', domain.id);
      return { ok: false, message: msg };
    }

    // Phase 7: read the freshly-generated DKIM private key off the server and
    // store it encrypted in metadata as a disaster-recovery backup. If the
    // server dies, we can restore the key on a new server without losing DNS
    // validity (the public DKIM record stays valid).
    let dkimPrivateKeyBackup: string | null = null;
    try {
      const keyPath = `/etc/opendkim/keys/${(domain.domain as string)}/${selector}.private`;
      const escKeyPath = keyPath.replace(/'/g, "'\\''");
      const keyRead = await session.exec(rootCmd(`cat '${escKeyPath}'`));
      if (keyRead.code === 0 && keyRead.stdout.includes('PRIVATE KEY')) {
        dkimPrivateKeyBackup = encryptValue(keyRead.stdout.trim());
        await log(`[provision_domain] DKIM private key backed up (encrypted, ${keyRead.stdout.length} bytes)`);
      } else {
        await log(`[provision_domain] WARN: could not read DKIM private key for backup`);
      }
    } catch (e) {
      await log(`[provision_domain] WARN: DKIM key backup failed (non-fatal): ${e instanceof Error ? e.message : String(e)}`);
    }

    await supabase
      .from('email_sending_domains')
      .update({
        dns_status: 'records_generated',
        dns_records: records,
        spf_verified: false,
        dkim_verified: false,
        dmarc_verified: false,
        mx_verified: false,
        dkim_selector: selector,
        byo_helo_hostname: server.hostname,
        max_mailboxes: 150,
        metadata: {
          provisioned_at: new Date().toISOString(),
          public_ip: parsed.PUBLIC_IP || null,
          ...(dkimPrivateKeyBackup ? { dkim_private_key_backup_encrypted: dkimPrivateKeyBackup } : {}),
        },
      })
      .eq('id', domain.id);

    await log(`[provision_domain] complete — ${records.length} DNS records written`);
    return { ok: true, domain: domain.domain as string, dkim_selector: selector, dns_records: records };
  } finally {
    await session.dispose();
  }
}
