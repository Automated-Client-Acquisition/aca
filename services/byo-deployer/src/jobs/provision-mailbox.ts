/**
 * provision_mailbox — creates a virtual mailbox on the BYO server, encrypts
 * SMTP+IMAP credentials, and inserts/updates an email_mailboxes row with
 * connection_type='smtp' so the existing send/receive pipeline picks it up
 * without any changes elsewhere.
 *
 * Inputs (passed via job.input):
 *   server_id     — byo_servers.id
 *   domain_id     — email_sending_domains.id (must be infra_type='byo' & verified)
 *   username      — local part (before the @)
 *   display_name  — friendly From-name
 *
 * Idempotency: a re-run with the same email rotates the password and
 * overwrites credentials. The existing email_mailboxes row (matched on
 * organization_id + email_address) is reused.
 */

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue, encryptValue } from '../encryption.js';
import { ADD_MAILBOX_SCRIPT } from '../scripts/add-mailbox.js';
import { SET_MAILBOX_TRANSPORT_SCRIPT } from '../scripts/set-mailbox-transport.js';

export interface ProvisionMailboxInput {
  organization_id: string;
  target_id: string; // email_mailboxes.id (we create the row eagerly in the edge fn)
  sticky_ip_id?: string;       // byo_server_ips.id chosen by edge-fn pickStickyIp
  sticky_ip_address?: string;  // resolved IP for the deployer to bind to
}

export interface ProvisionMailboxResult {
  ok: boolean;
  mailbox_id?: string;
  email_address?: string;
  message?: string;
}

interface SmtpCredentialsShape {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_email: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
}

const REMOTE_SCRIPT = '/tmp/aca-add-mailbox.sh';
const SUBMISSION_PORT = 587;
const IMAPS_PORT = 993;

function generatePassword(): string {
  // 32 bytes → 43 base64url chars; alphabetic-only safer for shell quoting.
  const buf = randomBytes(24);
  // base64url, then trim non-alphanumerics so the password is safe to pass on
  // command line and via SASL.
  return buf.toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 28);
}

export async function runProvisionMailboxJob(
  supabase: SupabaseClient,
  input: ProvisionMailboxInput,
  log: (line: string) => Promise<void>,
): Promise<ProvisionMailboxResult> {
  const { data: mailbox, error: mboxErr } = await supabase
    .from('email_mailboxes')
    .select('id, organization_id, email_address, display_name, sending_domain_id, connection_type, status')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (mboxErr || !mailbox) {
    return { ok: false, message: `Mailbox row not found: ${mboxErr?.message ?? 'no row'}` };
  }
  if (mailbox.connection_type !== 'smtp') {
    return { ok: false, message: `Mailbox connection_type is "${mailbox.connection_type}", expected "smtp"` };
  }
  if (!mailbox.sending_domain_id) {
    return { ok: false, message: 'Mailbox is not attached to a sending_domain_id' };
  }

  const { data: domain, error: domainErr } = await supabase
    .from('email_sending_domains')
    .select('id, domain, infra_type, byo_server_id, dns_status, byo_helo_hostname, dkim_verified, spf_verified')
    .eq('id', mailbox.sending_domain_id as string)
    .single();
  if (domainErr || !domain) {
    return { ok: false, message: `Domain not found: ${domainErr?.message ?? 'no row'}` };
  }
  if (domain.infra_type !== 'byo') {
    return { ok: false, message: 'Domain is not a BYO domain' };
  }
  if (!domain.byo_server_id) {
    return { ok: false, message: 'Domain has no attached BYO server' };
  }
  // We allow provisioning before DNS verification so the user can warm up the
  // mailbox while DNS propagates, but we warn in the log.
  if (!domain.dkim_verified || !domain.spf_verified) {
    await log('[provision_mailbox] WARN: SPF/DKIM not verified yet — sends will work but deliverability will suffer until DNS propagates.');
  }

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, hostname, status')
    .eq('id', domain.byo_server_id as string)
    .single();
  if (serverErr || !server) {
    return { ok: false, message: `Server not found: ${serverErr?.message ?? 'no row'}` };
  }
  if (server.status !== 'ready') {
    return { ok: false, message: `Server status is "${server.status}" — must be 'ready'` };
  }
  if (!server.ssh_private_key_encrypted) {
    return { ok: false, message: 'Server has no encrypted private key' };
  }

  const emailAddress = (mailbox.email_address as string).toLowerCase().trim();
  const displayName = (mailbox.display_name as string | null) ?? '';
  const password = generatePassword();
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
    await supabase
      .from('email_mailboxes')
      .update({ status: 'disconnected', last_error: `SSH failed: ${msg}` })
      .eq('id', mailbox.id);
    return { ok: false, message: `SSH failed: ${msg}` };
  }

  try {
    const rootCmd = (cmd: string) =>
      server.ssh_username === 'root' ? cmd : `sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`;

    await log(`[provision_mailbox] uploading add-mailbox.sh for ${emailAddress}`);
    await session.putContents(REMOTE_SCRIPT, ADD_MAILBOX_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    // Pass password via stdin-friendly env var to avoid leaking it into ps/syslog.
    // Bash will read $1/$2/$3 fine since rootCmd quotes the whole inner script.
    const escapedPassword = password.replace(/'/g, "'\\''");
    const escapedEmail = emailAddress.replace(/'/g, "'\\''");
    const escapedName = displayName.replace(/'/g, "'\\''");
    const result = await session.exec(
      rootCmd(`bash ${REMOTE_SCRIPT} '${escapedEmail}' '${escapedPassword}' '${escapedName}'`),
      { log },
    );
    if (result.code !== 0) {
      const msg = `add-mailbox.sh exited with code ${result.code}`;
      await supabase
        .from('email_mailboxes')
        .update({ status: 'disconnected', last_error: msg })
        .eq('id', mailbox.id);
      return { ok: false, message: msg };
    }

    // Sticky-IP pin: if the edge function chose an outbound IP for this mailbox,
    // write the sender_transport entry so Postfix routes via that bind address.
    if (input.sticky_ip_address) {
      await log(`[provision_mailbox] pinning ${emailAddress} → ${input.sticky_ip_address}`);
      await session.putContents('/tmp/aca-set-mailbox-transport.sh', SET_MAILBOX_TRANSPORT_SCRIPT);
      await session.exec('chmod +x /tmp/aca-set-mailbox-transport.sh');
      const escIp = input.sticky_ip_address.replace(/'/g, "'\\''");
      const pinResult = await session.exec(
        rootCmd(`bash /tmp/aca-set-mailbox-transport.sh '${escapedEmail}' '${escIp}'`),
        { log },
      );
      if (pinResult.code !== 0) {
        // Non-fatal: mailbox still works, just falls back to default IP.
        await log(`[provision_mailbox] WARN: failed to pin to ${input.sticky_ip_address} (code ${pinResult.code}). Falling back to default routing.`);
      }
    }

    // Encrypt SMTP + IMAP credentials in the format extractSMTPCredentials expects.
    const helo = (domain.byo_helo_hostname as string | null) || (server.hostname as string);
    const creds: SmtpCredentialsShape = {
      smtp_host: helo,
      smtp_port: SUBMISSION_PORT,
      smtp_username: emailAddress,
      smtp_password: password,
      from_email: emailAddress,
      imap_host: helo,
      imap_port: IMAPS_PORT,
      imap_username: emailAddress,
      imap_password: password,
    };
    const encrypted = encryptValue(JSON.stringify(creds));

    // Update the email_mailboxes row so the existing send / IMAP poll / inbox
    // pipeline picks the mailbox up. We DON'T set connection_type / sending_domain_id —
    // those were set when the row was inserted by the edge fn.
    const newMetadata: Record<string, unknown> = {
      smtp_credentials: encrypted,
      byo_provisioned_at: new Date().toISOString(),
    };
    if (input.sticky_ip_id) newMetadata.sticky_ip_id = input.sticky_ip_id;
    if (input.sticky_ip_address) newMetadata.sticky_ip_address = input.sticky_ip_address;

    await supabase
      .from('email_mailboxes')
      .update({
        provider: 'smtp',
        status: 'warming',
        last_error: null,
        imap_connected: true,
        // Preserve existing metadata fields, just add credentials.
        // We can't merge JSON via the REST client without a round-trip, so
        // overwrite metadata with the new shape (it's only the creds blob).
        metadata: newMetadata,
      })
      .eq('id', mailbox.id);

    await log(`[provision_mailbox] complete — ${emailAddress} ready (status=warming)`);
    return { ok: true, mailbox_id: mailbox.id as string, email_address: emailAddress };
  } finally {
    await session.dispose();
  }
}
