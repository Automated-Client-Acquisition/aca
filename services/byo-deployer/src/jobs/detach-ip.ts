/**
 * detach_ip — remove an IP transport from Postfix.
 *
 * Mailboxes pinned to this IP fall back to the default smtp transport
 * (server's primary IP). The byo_server_ips row is left in 'disabled' state
 * for audit, not deleted; the edge function decides whether to delete it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { REMOVE_IP_TRANSPORT_SCRIPT } from '../scripts/remove-ip-transport.js';

export interface DetachIpInput {
  organization_id: string;
  target_id: string; // byo_server_ips.id
}

export interface DetachIpResult {
  ok: boolean;
  ip_address?: string;
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-remove-ip-transport.sh';

export async function runDetachIpJob(
  supabase: SupabaseClient,
  input: DetachIpInput,
  log: (line: string) => Promise<void>,
): Promise<DetachIpResult> {
  const { data: ipRow, error } = await supabase
    .from('byo_server_ips')
    .select('id, organization_id, server_id, ip_address, metadata')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (error || !ipRow) return { ok: false, message: `IP row not found: ${error?.message ?? 'no row'}` };

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, status')
    .eq('id', ipRow.server_id as string)
    .single();
  if (serverErr || !server) return { ok: false, message: `Server not found: ${serverErr?.message ?? 'no row'}` };
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server missing private key' };

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

    await log(`[detach_ip] uploading remove-ip-transport.sh for ${ipRow.ip_address}`);
    await session.putContents(REMOTE_SCRIPT, REMOVE_IP_TRANSPORT_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    const escapedIp = (ipRow.ip_address as string).replace(/'/g, "'\\''");
    const result = await session.exec(rootCmd(`bash ${REMOTE_SCRIPT} '${escapedIp}'`), { log });
    if (result.code !== 0) {
      return { ok: false, message: `remove-ip-transport.sh exited with code ${result.code}` };
    }

    // Unpin all mailboxes that had this IP as their sticky_ip_id; they revert to default routing.
    const { error: unpinErr } = await supabase.rpc('byo_unpin_mailboxes_from_ip', { p_ip_id: ipRow.id }).maybeSingle();
    if (unpinErr && !/function .* does not exist/i.test(unpinErr.message)) {
      // Fallback: do it client-side. The RPC is a Phase 6 nicety; not having it isn't fatal.
      await log(`[detach_ip] (info) RPC unavailable, unpinning mailboxes via direct update`);
    }
    // Always do the DB-level unpin too (idempotent).
    const { data: pinnedMailboxes } = await supabase
      .from('email_mailboxes')
      .select('id, metadata')
      .eq('organization_id', input.organization_id);
    if (pinnedMailboxes) {
      for (const mbox of pinnedMailboxes as Array<{ id: string; metadata: Record<string, unknown> | null }>) {
        const md = mbox.metadata ?? {};
        if (md.sticky_ip_id === ipRow.id) {
          const { sticky_ip_id: _drop, ...rest } = md as Record<string, unknown>;
          void _drop;
          await supabase.from('email_mailboxes').update({ metadata: rest }).eq('id', mbox.id);
        }
      }
    }

    const ipMeta = (ipRow.metadata as Record<string, unknown> | null) ?? {};
    await supabase
      .from('byo_server_ips')
      .update({
        status: 'disabled',
        metadata: { ...ipMeta, detached_at: new Date().toISOString() },
      })
      .eq('id', ipRow.id);

    await log(`[detach_ip] ${ipRow.ip_address} removed from Postfix transport map`);
    return { ok: true, ip_address: ipRow.ip_address as string };
  } finally {
    await session.dispose();
  }
}
