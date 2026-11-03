/**
 * deploy_base — installs Postfix + OpenDKIM + Dovecot, writes base config.
 *
 * Idempotent. After success, server.status = 'ready' and version columns are
 * populated. After failure, server.status = 'error' with last_error tailored
 * for the wizard.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { connectSsh } from '../ssh-session.js';
import { decryptValue } from '../encryption.js';
import { INSTALL_BASE_SCRIPT } from '../scripts/install-base.js';
import { CONFIGURE_BASE_SCRIPT } from '../scripts/configure-base.js';
import { INSTALL_AGENT_SCRIPT } from '../scripts/install-agent.js';

export interface DeployBaseInput {
  organization_id: string;
  target_id: string; // byo_servers.id
  // Optional — when present, deploy_base auto-enqueues install_tls so the
  // first test send doesn't fail with the snakeoil cert. Falls back to no-op
  // if missing (older clients, manual job inserts).
  admin_email?: string | null;
}

export interface DeployBaseResult {
  ok: boolean;
  postfix_version?: string;
  opendkim_version?: string;
  dovecot_version?: string;
  message?: string;
}

const REMOTE_INSTALL_PATH   = '/tmp/aca-install-base.sh';
const REMOTE_CONFIGURE_PATH = '/tmp/aca-configure-base.sh';
const REMOTE_AGENT_INSTALL  = '/tmp/aca-install-agent.sh';

function parseVersions(blob: string) {
  const out: { postfix?: string; opendkim?: string; dovecot?: string } = {};
  for (const line of blob.split('\n')) {
    const [k, ...rest] = line.split('=');
    const v = rest.join('=').trim();
    if (k === 'POSTFIX_VERSION') out.postfix = v;
    else if (k === 'OPENDKIM_VERSION') out.opendkim = v;
    else if (k === 'DOVECOT_VERSION') out.dovecot = v;
  }
  return out;
}

export async function runDeployBaseJob(
  supabase: SupabaseClient,
  input: DeployBaseInput,
  log: (line: string) => Promise<void>,
): Promise<DeployBaseResult> {
  const { data: server, error } = await supabase
    .from('byo_servers')
    .select('id, organization_id, ssh_host, ssh_port, ssh_username, ssh_private_key_encrypted, hostname, status, agent_secret_encrypted')
    .eq('id', input.target_id)
    .eq('organization_id', input.organization_id)
    .single();

  if (error || !server) return { ok: false, message: `Server not found: ${error?.message ?? 'no row'}` };
  if (!server.ssh_private_key_encrypted) return { ok: false, message: 'Server has no encrypted private key' };

  // Reflect intent in the server status before the long-running work begins.
  await supabase.from('byo_servers').update({ status: 'deploying', last_error: null }).eq('id', server.id);

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
    await supabase.from('byo_servers').update({ status: 'error', last_error: `SSH failed: ${msg}` }).eq('id', server.id);
    return { ok: false, message: `SSH failed: ${msg}` };
  }

  try {
    const helo = (server.hostname as string) || '';
    const rootCmd = (cmd: string) =>
      server.ssh_username === 'root' ? cmd : `sudo -n bash -c '${cmd.replace(/'/g, "'\\''")}'`;

    // 1) Upload + run install-base
    await log('[deploy_base] uploading install-base.sh');
    await session.putContents(REMOTE_INSTALL_PATH, INSTALL_BASE_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_INSTALL_PATH}`);
    const installRes = await session.exec(rootCmd(`bash ${REMOTE_INSTALL_PATH}`), { log });
    if (installRes.code !== 0) {
      const msg = `install-base.sh exited with code ${installRes.code}`;
      await supabase.from('byo_servers').update({ status: 'error', last_error: msg }).eq('id', server.id);
      return { ok: false, message: msg };
    }

    // 2) Upload + run configure-base with the HELO hostname
    await log('[deploy_base] uploading configure-base.sh');
    await session.putContents(REMOTE_CONFIGURE_PATH, CONFIGURE_BASE_SCRIPT);
    await session.exec(`chmod +x ${REMOTE_CONFIGURE_PATH}`);
    const configureRes = await session.exec(rootCmd(`bash ${REMOTE_CONFIGURE_PATH} ${helo}`), { log });
    if (configureRes.code !== 0) {
      const msg = `configure-base.sh exited with code ${configureRes.code}`;
      await supabase.from('byo_servers').update({ status: 'error', last_error: msg }).eq('id', server.id);
      return { ok: false, message: msg };
    }

    // 3) Pull versions written by install-base.sh to /tmp/aca-versions
    const versionsRes = await session.exec(rootCmd('cat /tmp/aca-versions'));
    const versions = parseVersions(versionsRes.stdout);

    // 4) Install the monitoring agent + cron entry. Phase 6 — pushes
    //    bounces/sends/health to the infra-byo-events webhook every minute.
    if (server.agent_secret_encrypted) {
      const agentSecret = decryptValue(server.agent_secret_encrypted as string);
      const supabaseUrl = process.env.SUPABASE_URL;
      if (!supabaseUrl) {
        await log('[deploy_base] WARN: SUPABASE_URL not set on deployer — skipping agent install');
      } else {
        const eventsUrl = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/infra-byo-events`;
        await log('[deploy_base] installing aca-agent for monitoring + bounce reports');
        await session.putContents(REMOTE_AGENT_INSTALL, INSTALL_AGENT_SCRIPT);
        await session.exec(`chmod +x ${REMOTE_AGENT_INSTALL}`);
        const escSecret = agentSecret.replace(/'/g, "'\\''");
        const escUrl = eventsUrl.replace(/'/g, "'\\''");
        const escId = (server.id as string).replace(/'/g, "'\\''");
        const agentRes = await session.exec(
          rootCmd(`bash ${REMOTE_AGENT_INSTALL} '${escId}' '${escUrl}' '${escSecret}'`),
          { log },
        );
        if (agentRes.code !== 0) {
          // Non-fatal: server still works, just no monitoring until we retry.
          await log(`[deploy_base] WARN: agent install exited with code ${agentRes.code}; deliverability monitoring will be unavailable until you re-run deploy.`);
        }
      }
    }

    await supabase
      .from('byo_servers')
      .update({
        status: 'ready',
        last_error: null,
        postfix_version: versions.postfix ?? null,
        opendkim_version: versions.opendkim ?? null,
        dovecot_version: versions.dovecot ?? null,
        deploy_state: { last_deploy: new Date().toISOString(), helo, agent_installed: !!server.agent_secret_encrypted },
      })
      .eq('id', server.id);

    // Auto-chain install_tls so the first test send doesn't hit the snakeoil
    // cert and fail with a TLS handshake error. Skipped silently when no
    // admin_email is on the job (older clients, internal triggers).
    if (input.admin_email && input.admin_email.includes('@')) {
      try {
        const { data: existingTls } = await supabase
          .from('infra_byo_jobs')
          .select('id')
          .eq('organization_id', input.organization_id)
          .eq('job_type', 'install_tls')
          .eq('target_id', server.id)
          .in('status', ['pending', 'running'])
          .limit(1)
          .maybeSingle();
        if (!existingTls) {
          await supabase.from('infra_byo_jobs').insert({
            organization_id: input.organization_id,
            job_type: 'install_tls',
            target_kind: 'server',
            target_id: server.id,
            input: { admin_email: input.admin_email },
            status: 'pending',
            attempts: 0,
            max_attempts: 2,
          });
          await log(`[deploy_base] auto-enqueued install_tls (admin=${input.admin_email})`);
        }
      } catch (e) {
        await log(`[deploy_base] WARN: failed to auto-enqueue install_tls: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    await log(`[deploy_base] complete — postfix ${versions.postfix} / opendkim ${versions.opendkim} / dovecot ${versions.dovecot}`);
    return {
      ok: true,
      postfix_version: versions.postfix,
      opendkim_version: versions.opendkim,
      dovecot_version: versions.dovecot,
    };
  } finally {
    await session.dispose();
  }
}
