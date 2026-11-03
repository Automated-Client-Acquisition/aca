/**
 * test_port25 — re-check outbound port 25 on an already-connected server.
 *
 * `connect` tests port 25 once, at onboarding. Providers revoke SMTP access
 * after the fact (abuse review, plan change, an unblock that silently lapses),
 * and until now the only way to notice was a full reconnect, which also resets
 * server status. This job re-tests in isolation and records the result.
 *
 * Read-only on the server: it opens a TCP connection and reads the banner.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';

export interface TestPort25Input {
  organization_id: string;
  target_id: string; // byo_servers.id
}

export interface TestPort25Result {
  ok: boolean;
  port25_verified?: boolean;
  banner?: string;
  message?: string;
}

/** Well-known MX hosts that answer on 25. Two, so one outage isn't a false alarm. */
const PROBE_HOSTS = ['gmail-smtp-in.l.google.com', 'mx1.hotmail.com'];

export async function runTestPort25Job(
  supabase: SupabaseClient,
  input: TestPort25Input,
  log: (line: string) => Promise<void>,
): Promise<TestPort25Result> {
  const { data: server, error } = await supabase
    .from('byo_servers')
    .select('id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, status')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();

  if (error || !server) return { ok: false, message: `Server not found: ${error?.message ?? 'no row'}` };
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server has no encrypted private key' };

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
    let banner: string | null = null;

    for (const host of PROBE_HOSTS) {
      await log(`[test_port25] probing ${host}:25 ...`);
      // bash's /dev/tcp avoids depending on `nc`, which minimal images lack.
      const probe = await session.exec(
        `timeout 10 bash -c 'exec 3<>/dev/tcp/${host}/25 && head -n1 <&3 && exec 3<&-' 2>&1 || echo PORT25_FAILED`,
      );
      const firstLine = probe.stdout.trim().split('\n')[0] || '';
      if (!probe.stdout.includes('PORT25_FAILED') && /^220[ -]/.test(firstLine)) {
        banner = firstLine;
        await log(`[test_port25] ${host}: OPEN — ${firstLine}`);
        break;
      }
      await log(`[test_port25] ${host}: no banner`);
    }

    const verified = banner !== null;
    const nowIso = new Date().toISOString();

    // Only touch status when the verdict actually changes it. A passing probe
    // must not promote a server that is mid-deploy or errored for another
    // reason, and a failing probe must not clobber an unrelated last_error.
    const patch: Record<string, unknown> = {
      port25_verified: verified,
      port25_last_check_at: nowIso,
    };
    if (!verified && server.status === 'ready') {
      patch.status = 'error';
      patch.last_error =
        'Outbound port 25 is no longer reachable from this server. Your provider may have re-blocked SMTP — check with them before sending resumes.';
    }
    if (verified && server.status === 'error') {
      patch.status = 'ready';
      patch.last_error = null;
    }

    await supabase.from('byo_servers').update(patch).eq('id', server.id);

    await log(`[test_port25] result: ${verified ? 'OPEN' : 'BLOCKED'}`);
    return verified
      ? { ok: true, port25_verified: true, banner: banner ?? undefined }
      : {
          ok: false,
          port25_verified: false,
          message: `Outbound port 25 is blocked (probed ${PROBE_HOSTS.join(', ')}). Request an unblock from your provider, or move the server to Hetzner / OVH / IONOS.`,
        };
  } finally {
    await session.dispose();
  }
}
