/**
 * install_tls — issues a Let's Encrypt cert for the server's HELO hostname
 * and swaps Postfix + Dovecot to use it.
 *
 * Inputs (job.input):
 *   admin_email — required, used as certbot account / renewal notification
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { INSTALL_TLS_SCRIPT } from '../scripts/install-tls.js';

export interface InstallTlsInput {
  organization_id: string;
  target_id: string; // byo_servers.id
  admin_email: string;
}

export interface InstallTlsResult {
  ok: boolean;
  helo?: string;
  not_after?: string;
  issuer?: string;
  message?: string;
}

const REMOTE_SCRIPT = '/tmp/aca-install-tls.sh';

function parseBlock(blob: string): Record<string, string> {
  const map: Record<string, string> = {};
  let inBlock = false;
  for (const line of blob.split('\n')) {
    if (line.trim() === 'ACA_TLS_BEGIN') { inBlock = true; continue; }
    if (line.trim() === 'ACA_TLS_END') break;
    if (!inBlock) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return map;
}

export async function runInstallTlsJob(
  supabase: SupabaseClient,
  input: InstallTlsInput,
  log: (line: string) => Promise<void>,
): Promise<InstallTlsResult> {
  const { data: server, error } = await supabase
    .from('byo_servers')
    .select('id, organization_id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, hostname, status, deploy_state')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();
  if (error || !server) return { ok: false, message: `Server not found: ${error?.message ?? 'no row'}` };
  if (server.status !== 'ready' && server.status !== 'degraded') {
    return { ok: false, message: `Server status is "${server.status}". Deploy first.` };
  }
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server missing private key' };
  if (!input.admin_email || !input.admin_email.includes('@')) {
    return { ok: false, message: 'admin_email is required for Let\'s Encrypt registration' };
  }

  const privateKeyPem = decryptValue(server.ssh_private_key_encrypted as string);
  const helo = server.hostname as string;

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

    await log(`[install_tls] uploading install-tls.sh for ${helo}`);
    await session.putContents(REMOTE_SCRIPT, INSTALL_TLS_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_SCRIPT}`);

    const escHelo = helo.replace(/'/g, "'\\''");
    const escEmail = input.admin_email.replace(/'/g, "'\\''");
    const result = await session.exec(
      rootCmd(`bash ${REMOTE_SCRIPT} '${escHelo}' '${escEmail}'`),
      { log },
    );
    if (result.code !== 0) {
      let msg = `install-tls.sh exited with code ${result.code}`;
      if (result.code === 2) msg = `${helo} doesn't resolve. Set its A record to a server IP and retry.`;
      if (result.code === 3) msg = `${helo} resolves to an IP that isn't on this server's NIC. Verify the A record points to one of the server's IPs.`;
      return { ok: false, message: msg };
    }

    const parsed = parseBlock(result.stdout);
    await supabase
      .from('byo_servers')
      .update({
        deploy_state: {
          ...((server.deploy_state as Record<string, unknown> | null) ?? {}),
          tls: {
            helo: parsed.HELO,
            cert_path: parsed.CERT_PATH,
            key_path: parsed.KEY_PATH,
            not_after: parsed.NOT_AFTER,
            issuer: parsed.ISSUER,
            subject: parsed.SUBJECT,
            installed_at: new Date().toISOString(),
          },
        },
      })
      .eq('id', server.id);

    await log(`[install_tls] complete — cert valid until ${parsed.NOT_AFTER || 'unknown'}`);
    return {
      ok: true,
      helo: parsed.HELO,
      not_after: parsed.NOT_AFTER,
      issuer: parsed.ISSUER,
    };
  } finally {
    await session.dispose();
  }
}
