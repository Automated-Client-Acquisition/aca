/**
 * Connect job — Phase 2.
 *
 * Validates that:
 *   1. SSH login with our generated keypair works
 *   2. Host key fingerprint is recorded (pinned for future jobs)
 *   3. Sudo access works (NOPASSWD for non-root, free for root)
 *   4. Outbound port 25 is reachable to gmail-smtp-in.l.google.com
 *   5. Server has enough RAM and disk for Postfix+OpenDKIM+Dovecot
 *
 * On success, flips byo_servers.status to 'ready' (waiting on user to deploy).
 * On failure, sets status='error' with a tailored last_error message.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';

export interface ConnectJobInput {
  organization_id: string;
  target_id: string; // byo_servers.id
}

export interface ConnectJobResult {
  ok: boolean;
  fingerprint?: string;
  port25_verified?: boolean;
  ram_mb?: number;
  disk_gb?: number;
  postfix_present?: boolean;
  message?: string;
}

export async function runConnectJob(
  supabase: SupabaseClient,
  input: ConnectJobInput,
  log: (line: string) => Promise<void>,
): Promise<ConnectJobResult> {
  const { data: server, error } = await supabase
    .from('byo_servers')
    .select('id, organization_id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, ssh_fingerprint, hostname')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();

  if (error || !server) {
    return { ok: false, message: `Server not found: ${error?.message || 'no row'}` };
  }
  if (!server.ssh_private_key_encrypted) {
    return { ok: false, message: 'Server has no encrypted private key — re-create it' };
  }

  const privateKeyPem = decryptValue(server.ssh_private_key_encrypted as string);

  await log(`[connect] target ${server.ssh_username}@${server.ssh_host}:${server.ssh_port}`);

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
    await log(`[connect] SSH failed: ${msg}`);
    let userMessage = `SSH connection failed: ${msg}`;
    if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(msg)) {
      userMessage = `Cannot reach ${server.ssh_host}:${server.ssh_port}. Check hostname, firewall, and that sshd is running.`;
    } else if (/All configured authentication methods failed/i.test(msg)) {
      userMessage = `SSH authentication failed. Confirm the public key is in ~/.ssh/authorized_keys for user "${server.ssh_username}".`;
    }
    await supabase
      .from('byo_servers')
      .update({ status: 'error', last_error: userMessage, port25_verified: false, port25_last_check_at: new Date().toISOString() })
      .eq('id', server.id);
    return { ok: false, message: userMessage };
  }

  try {
    // 1) Sudo check — non-fatal if user is root
    if (server.ssh_username !== 'root') {
      const sudo = await session.exec('sudo -n true', { log });
      if (sudo.code !== 0) {
        const userMessage = `User "${server.ssh_username}" cannot run sudo without password. Add NOPASSWD to sudoers or connect as root.`;
        await log(`[connect] sudo -n failed: ${sudo.stderr}`);
        await supabase
          .from('byo_servers')
          .update({ status: 'error', last_error: userMessage })
          .eq('id', server.id);
        return { ok: false, message: userMessage };
      }
      await log('[connect] sudo OK');
    }

    // 2) Resource check
    const mem = await session.exec(`awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo`);
    const ramMb = parseInt(mem.stdout.trim(), 10) || 0;
    const disk = await session.exec(`df -BG --output=avail / | awk 'NR==2 {gsub("G",""); print $1}'`);
    const diskGb = parseInt(disk.stdout.trim(), 10) || 0;
    await log(`[connect] resources: ${ramMb} MB RAM, ${diskGb} GB free disk`);
    if (ramMb < 512) {
      const userMessage = `Server has only ${ramMb} MB RAM. Need at least 512 MB for Postfix + OpenDKIM + Dovecot.`;
      await supabase.from('byo_servers').update({ status: 'error', last_error: userMessage }).eq('id', server.id);
      return { ok: false, message: userMessage };
    }
    if (diskGb < 5) {
      const userMessage = `Server has only ${diskGb} GB free disk. Need at least 5 GB.`;
      await supabase.from('byo_servers').update({ status: 'error', last_error: userMessage }).eq('id', server.id);
      return { ok: false, message: userMessage };
    }

    // 3) Detect existing mail stack so deploy_base can be idempotent later
    const postfixCheck = await session.exec('command -v postfix >/dev/null 2>&1 && postconf -d mail_version | awk "{print \\$3}" || echo none');
    const postfixVersion = postfixCheck.stdout.trim();
    const postfixPresent = postfixVersion !== 'none' && postfixVersion !== '';
    await log(`[connect] postfix: ${postfixPresent ? postfixVersion : 'not installed (will install)'}`);

    // 4) Port 25 outbound test — the critical one. We use bash's /dev/tcp to
    //    avoid depending on `nc`, which isn't installed by default on minimal images.
    await log('[connect] testing outbound port 25 to gmail-smtp-in.l.google.com:25 ...');
    const port25 = await session.exec(
      `timeout 10 bash -c 'exec 3<>/dev/tcp/gmail-smtp-in.l.google.com/25 && head -n1 <&3 && exec 3<&-' 2>&1 || echo PORT25_FAILED`,
    );
    const port25Ok = !port25.stdout.includes('PORT25_FAILED') && /^220[ -]/.test(port25.stdout.trim().split('\n')[0] || '');
    await log(`[connect] port 25: ${port25Ok ? 'OPEN' : 'BLOCKED'}`);

    if (!port25Ok) {
      const userMessage = `Outbound port 25 is blocked on this server. Most clouds block it by default — request unblock from your provider, or move the server to Hetzner / OVH / IONOS / contabo.`;
      await supabase
        .from('byo_servers')
        .update({
          status: 'error',
          last_error: userMessage,
          port25_verified: false,
          port25_last_check_at: new Date().toISOString(),
          postfix_version: postfixPresent ? postfixVersion : null,
        })
        .eq('id', server.id);
      return { ok: false, port25_verified: false, ram_mb: ramMb, disk_gb: diskGb, postfix_present: postfixPresent, message: userMessage };
    }

    // 5) All checks passed — mark ready.
    const fingerprint = session.hostKeyFingerprint || (server.ssh_fingerprint as string | null) || '';
    await supabase
      .from('byo_servers')
      .update({
        status: 'ready',
        last_error: null,
        port25_verified: true,
        port25_last_check_at: new Date().toISOString(),
        ssh_fingerprint: fingerprint,
        postfix_version: postfixPresent ? postfixVersion : null,
        deploy_state: { last_connect: new Date().toISOString(), ram_mb: ramMb, disk_gb: diskGb },
      })
      .eq('id', server.id);

    await log('[connect] all checks passed — server ready for deploy_base');
    return { ok: true, fingerprint, port25_verified: true, ram_mb: ramMb, disk_gb: diskGb, postfix_present: postfixPresent };
  } finally {
    await session.dispose();
  }
}
