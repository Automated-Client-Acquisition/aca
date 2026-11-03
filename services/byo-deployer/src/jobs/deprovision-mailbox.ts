/**
 * deprovision_mailbox — remove a virtual mailbox from the BYO server and
 * delete the email_mailboxes row.
 *
 * Inputs (job.input):
 *   delete_maildir — if true, wipes /var/mail/vhosts/<domain>/<user>/.
 *                    Default false so the user can recover mail if they
 *                    accidentally delete the wrong mailbox.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { REMOVE_MAILBOX_SCRIPT } from '../scripts/remove-mailbox.js';

export interface DeprovisionMailboxInput {
  organization_id: string;
  target_id: string; // email_mailboxes.id
  delete_maildir?: boolean;
}

export interface DeprovisionMailboxResult {
  ok: boolean;
  email_address?: string;
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-remove-mailbox.sh';

export async function runDeprovisionMailboxJob(
  supabase: SupabaseClient,
  input: DeprovisionMailboxInput,
  log: (line: string) => Promise<void>,
): Promise<DeprovisionMailboxResult> {
  const { data: mailbox, error } = await supabase
    .from('email_mailboxes')
    .select('id, organization_id, email_address, sending_domain_id, connection_type')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (error || !mailbox) return { ok: false, message: `Mailbox not found: ${error?.message ?? 'no row'}` };
  if (mailbox.connection_type !== 'smtp') {
    return { ok: false, message: `Mailbox connection_type is "${mailbox.connection_type}", expected "smtp"` };
  }

  const domainId = mailbox.sending_domain_id as string | null;
  if (!domainId) {
    // No domain attached → nothing to do server-side.
    await supabase.from('email_mailboxes').delete().eq('id', mailbox.id);
    await log(`[deprovision_mailbox] no sending domain — deleted DB row only`);
    return { ok: true, email_address: mailbox.email_address as string };
  }

  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('id, byo_server_id, infra_type')
    .eq('id', domainId)
    .maybeSingle();
  const serverId = (domain?.byo_server_id as string | null) ?? null;

  if (!serverId || (domain && domain.infra_type !== 'byo')) {
    await supabase.from('email_mailboxes').delete().eq('id', mailbox.id);
    await log(`[deprovision_mailbox] server unavailable — deleted DB row only`);
    return { ok: true, email_address: mailbox.email_address as string };
  }

  const { data: server } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, status')
    .eq('id', serverId)
    .maybeSingle();
  if (!server || !server.ssh_private_key_encrypted) {
    await supabase.from('email_mailboxes').delete().eq('id', mailbox.id);
    await log(`[deprovision_mailbox] server gone — deleted DB row only`);
    return { ok: true, email_address: mailbox.email_address as string };
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
    const escEmail = (mailbox.email_address as string).replace(/'/g, "'\\''");
    const deleteMaildir = input.delete_maildir ? 'yes' : 'no';

    await log(`[deprovision_mailbox] uploading remove-mailbox.sh for ${mailbox.email_address}`);
    await session.putContents(REMOTE_SCRIPT, REMOVE_MAILBOX_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    const result = await session.exec(
      rootCmd(`bash ${REMOTE_SCRIPT} '${escEmail}' '${deleteMaildir}'`),
      { log },
    );
    if (result.code !== 0) {
      return { ok: false, message: `remove-mailbox.sh exited with code ${result.code}` };
    }

    await supabase.from('email_mailboxes').delete().eq('id', mailbox.id);
    await log(`[deprovision_mailbox] complete — ${mailbox.email_address} removed (delete_maildir=${deleteMaildir})`);
    return { ok: true, email_address: mailbox.email_address as string };
  } finally {
    await session.dispose();
  }
}
