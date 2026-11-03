/**
 * attach_ip — register an additional outbound IP with Postfix.
 *
 * The IP must already be bound to the server's NIC by the user's hosting
 * provider (Hetzner control panel, OVH "Additional IPs", etc.). add-ip-transport.sh
 * fails fast if the IP isn't on a local interface.
 *
 * Inputs (job.input):
 *   server_id    — byo_servers.id
 *   ip_id        — byo_server_ips.id
 *   ip_address   — string for convenience
 *   helo_name    — optional, defaults to <ip-with-dashes>.<server.hostname>
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { ADD_IP_TRANSPORT_SCRIPT } from '../scripts/add-ip-transport.js';

export interface AttachIpInput {
  organization_id: string;
  target_id: string; // byo_server_ips.id
}

export interface AttachIpResult {
  ok: boolean;
  ip_address?: string;
  transport_name?: string;
  helo_name?: string;
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-add-ip-transport.sh';

function parseBlock(blob: string): Record<string, string> {
  const map: Record<string, string> = {};
  let inBlock = false;
  for (const line of blob.split('\n')) {
    if (line.trim() === 'ACA_IP_TRANSPORT_BEGIN') { inBlock = true; continue; }
    if (line.trim() === 'ACA_IP_TRANSPORT_END') break;
    if (!inBlock) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return map;
}

export async function runAttachIpJob(
  supabase: SupabaseClient,
  input: AttachIpInput,
  log: (line: string) => Promise<void>,
): Promise<AttachIpResult> {
  const { data: ipRow, error } = await supabase
    .from('byo_server_ips')
    .select('id, organization_id, server_id, ip_address, ptr_record, status, metadata')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (error || !ipRow) return { ok: false, message: `IP row not found: ${error?.message ?? 'no row'}` };

  const { data: server, error: serverErr } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, hostname, status')
    .eq('id', ipRow.server_id as string)
    .single();
  if (serverErr || !server) return { ok: false, message: `Server not found: ${serverErr?.message ?? 'no row'}` };
  if (server.status !== 'ready') {
    return { ok: false, message: `Server status is "${server.status}" — must be 'ready'` };
  }
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server missing private key' };

  const privateKeyPem = decryptValue(server.ssh_private_key_encrypted as string);
  const ipMeta = (ipRow.metadata as Record<string, unknown> | null) ?? {};
  const heloName = (ipMeta.helo_name as string | undefined) ??
    `${(ipRow.ip_address as string).replaceAll('.', '-')}.${server.hostname}`;

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
    await supabase.from('byo_server_ips').update({ status: 'disabled', metadata: { ...ipMeta, last_error: `SSH failed: ${msg}` } }).eq('id', ipRow.id);
    return { ok: false, message: `SSH failed: ${msg}` };
  }

  try {
    const rootCmd = (cmd: string) =>
      server.ssh_username === 'root' ? cmd : `sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`;

    await log(`[attach_ip] uploading add-ip-transport.sh for ${ipRow.ip_address}`);
    await session.putContents(REMOTE_SCRIPT, ADD_IP_TRANSPORT_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    const escapedHelo = heloName.replace(/'/g, "'\\''");
    const escapedIp = (ipRow.ip_address as string).replace(/'/g, "'\\''");
    const result = await session.exec(
      rootCmd(`bash ${REMOTE_SCRIPT} '${escapedIp}' '${escapedHelo}'`),
      { log },
    );
    if (result.code !== 0) {
      const msg = result.code === 2
        ? `IP ${ipRow.ip_address} is not bound to a NIC on this server. Have your provider attach it first.`
        : `add-ip-transport.sh exited with code ${result.code}`;
      await supabase
        .from('byo_server_ips')
        .update({ status: 'disabled', metadata: { ...ipMeta, last_error: msg, last_attach_attempt: new Date().toISOString() } })
        .eq('id', ipRow.id);
      return { ok: false, ip_address: ipRow.ip_address as string, message: msg };
    }

    const parsed = parseBlock(result.stdout);
    await supabase
      .from('byo_server_ips')
      .update({
        status: 'active',
        metadata: {
          ...ipMeta,
          helo_name: parsed.HELO ?? heloName,
          transport_name: parsed.TRANSPORT,
          last_attached_at: new Date().toISOString(),
          last_error: null,
        },
      })
      .eq('id', ipRow.id);

    await log(`[attach_ip] ${ipRow.ip_address} → ${parsed.TRANSPORT} (HELO ${parsed.HELO}) — active`);
    return {
      ok: true,
      ip_address: ipRow.ip_address as string,
      transport_name: parsed.TRANSPORT,
      helo_name: parsed.HELO,
    };
  } finally {
    await session.dispose();
  }
}
