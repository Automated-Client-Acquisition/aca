/**
 * deprovision_domain — full teardown of a BYO sending domain on the server.
 *
 * Removes Postfix vhost entries, Dovecot passdb entries for *@domain, and
 * (if delete_keys=true) the DKIM keypair + Maildir for the domain. Marks any
 * email_mailboxes attached to this domain as 'disconnected'. Deletes the
 * email_sending_domains row when the script succeeds.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { REMOVE_DOMAIN_SCRIPT } from '../scripts/remove-domain.js';

export interface DeprovisionDomainInput {
  organization_id: string;
  target_id: string; // email_sending_domains.id
  delete_keys?: boolean;
}

export interface DeprovisionDomainResult {
  ok: boolean;
  domain?: string;
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-remove-domain.sh';

export async function runDeprovisionDomainJob(
  supabase: SupabaseClient,
  input: DeprovisionDomainInput,
  log: (line: string) => Promise<void>,
): Promise<DeprovisionDomainResult> {
  const { data: domain, error } = await supabase
    .from('email_sending_domains')
    .select('id, organization_id, domain, infra_type, byo_server_id, dkim_selector')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (error || !domain) return { ok: false, message: `Domain not found: ${error?.message ?? 'no row'}` };
  if (domain.infra_type !== 'byo') return { ok: false, message: 'Domain is not a BYO domain' };

  const serverId = domain.byo_server_id as string | null;
  // If the server is gone (deprovisioned), just clean up the DB and return ok.
  if (!serverId) {
    await markMailboxesDisconnected(supabase, domain.id as string);
    await supabase.from('email_sending_domains').delete().eq('id', domain.id);
    await log(`[deprovision_domain] no server attached — deleted DB row only`);
    return { ok: true, domain: domain.domain as string };
  }

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, status')
    .eq('id', serverId)
    .maybeSingle();
  if (serverErr) return { ok: false, message: serverErr.message };

  // If the server row itself is gone, fall through to DB cleanup only.
  if (!server || !server.ssh_private_key_encrypted) {
    await markMailboxesDisconnected(supabase, domain.id as string);
    await supabase.from('email_sending_domains').delete().eq('id', domain.id);
    await log(`[deprovision_domain] server unavailable — deleted DB row only`);
    return { ok: true, domain: domain.domain as string };
  }

  const privateKeyPem = decryptValue(server.ssh_private_key_encrypted as string);
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
    const escDomain = (domain.domain as string).replace(/'/g, "'\\''");
    const escSelector = ((domain.dkim_selector as string | null) ?? 'aca1').replace(/'/g, "'\\''");
    const deleteKeys = input.delete_keys ? 'yes' : 'no';

    await log(`[deprovision_domain] uploading remove-domain.sh for ${domain.domain}`);
    await session.putContents(REMOTE_SCRIPT, REMOVE_DOMAIN_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    const result = await session.exec(
      rootCmd(`bash ${REMOTE_SCRIPT} '${escDomain}' '${escSelector}' '${deleteKeys}'`),
      { log },
    );
    if (result.code !== 0) {
      return { ok: false, message: `remove-domain.sh exited with code ${result.code}` };
    }

    await markMailboxesDisconnected(supabase, domain.id as string);
    await supabase.from('email_sending_domains').delete().eq('id', domain.id);

    await log(`[deprovision_domain] complete — ${domain.domain} torn down (delete_keys=${deleteKeys})`);
    return { ok: true, domain: domain.domain as string };
  } finally {
    await session.dispose();
  }
}

async function markMailboxesDisconnected(supabase: SupabaseClient, domainId: string) {
  await supabase
    .from('email_mailboxes')
    .update({ status: 'disconnected', last_error: 'Domain deprovisioned' })
    .eq('sending_domain_id', domainId);
}
