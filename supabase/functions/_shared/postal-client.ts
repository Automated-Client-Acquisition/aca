/**
 * @deprecated — Legacy VM/Postfix mailbox management. Replaced by ACS (acs-client.ts).
 * Kept only for backward compatibility with existing postal-type domains.
 *
 * Postal Client — VM Mailbox Management via Azure Run Command API
 *
 * Manages mailboxes, forwarding, and configuration on Postfix VMs
 * using the aca-manage script installed via cloud-init.
 */

import { getAzureToken, runCommandOnVM } from './azure-sdk.ts';
import { decryptValue } from './encryption.ts';

export interface VMCredentials {
  token: string;
  subscriptionId: string;
  resourceGroup: string;
  vmName: string;
}

export interface MailboxCreateParams {
  username: string;
  password: string;
  displayName: string;
}

/**
 * Get Azure token and VM details from subscription + domain records.
 */
export async function getVMCredentials(
  sub: { tenant_id: string; client_id: string; client_secret_encrypted: string; subscription_id: string; resource_group: string | null },
  vmName: string,
  resourceGroupOverride?: string | null
): Promise<VMCredentials> {
  const clientSecret = await decryptValue(sub.client_secret_encrypted);
  const token = await getAzureToken(sub.tenant_id, sub.client_id, clientSecret);
  return {
    token,
    subscriptionId: sub.subscription_id,
    resourceGroup: resourceGroupOverride || sub.resource_group || 'aca-email-infra',
    vmName,
  };
}

/**
 * Create a mailbox on the VM.
 */
export async function createMailbox(
  creds: VMCredentials,
  params: MailboxCreateParams
): Promise<string> {
  const output = await runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage create-mailbox '${escapeShell(params.username)}' '${escapeShell(params.password)}' '${escapeShell(params.displayName)}'`]
  );
  return output;
}

/**
 * Create multiple mailboxes in a single RunCommand call.
 * Azure RunCommand only allows one concurrent execution per VM, and each call
 * takes ~10s for the async polling cycle. Batching N mailboxes into one script
 * reduces N×10s down to ~10-15s regardless of count.
 *
 * Returns per-mailbox results parsed from the script output.
 */
export async function createMailboxBatch(
  creds: VMCredentials,
  mailboxes: MailboxCreateParams[]
): Promise<Array<{ username: string; success: boolean; error?: string }>> {
  if (mailboxes.length === 0) return [];
  if (mailboxes.length === 1) {
    try {
      await createMailbox(creds, mailboxes[0]);
      return [{ username: mailboxes[0].username, success: true }];
    } catch (err) {
      return [{ username: mailboxes[0].username, success: false, error: err instanceof Error ? err.message : String(err) }];
    }
  }

  // Build a shell script that creates each mailbox and outputs status per line
  const lines = ['#!/bin/bash'];
  for (const mb of mailboxes) {
    const u = escapeShell(mb.username);
    const p = escapeShell(mb.password);
    const d = escapeShell(mb.displayName);
    lines.push(
      `if /usr/local/bin/aca-manage create-mailbox '${u}' '${p}' '${d}' >/dev/null 2>&1; then`,
      `  echo 'OK:${u}'`,
      `else`,
      `  echo 'FAIL:${u}'`,
      `fi`
    );
  }

  const output = await runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    lines
  );

  // Parse output lines: "OK:username" or "FAIL:username"
  const resultMap = new Map<string, boolean>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('OK:')) {
      resultMap.set(trimmed.slice(3), true);
    } else if (trimmed.startsWith('FAIL:')) {
      resultMap.set(trimmed.slice(5), false);
    }
  }

  return mailboxes.map((mb) => ({
    username: mb.username,
    success: resultMap.get(mb.username) ?? false,
    ...(resultMap.get(mb.username) === false || resultMap.get(mb.username) === undefined
      ? { error: resultMap.has(mb.username) ? 'aca-manage create-mailbox failed' : 'No output from VM command' }
      : {}),
  }));
}

/**
 * Delete a mailbox from the VM.
 */
export async function deleteMailbox(
  creds: VMCredentials,
  username: string
): Promise<string> {
  const output = await runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage delete-mailbox '${escapeShell(username)}'`]
  );
  return output;
}

/**
 * List all mailboxes on the VM.
 */
export async function listMailboxes(creds: VMCredentials): Promise<string[]> {
  const output = await runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    ['/usr/local/bin/aca-manage list-mailboxes']
  );
  return output.trim().split('\n').filter(Boolean);
}

/**
 * Set email forwarding for a specific address.
 */
export async function setForwarding(
  creds: VMCredentials,
  sourceEmail: string,
  targetEmail: string
): Promise<string> {
  return runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage set-forwarding '${escapeShell(sourceEmail)}' '${escapeShell(targetEmail)}'`]
  );
}

/**
 * Set catch-all for a domain.
 */
export async function setCatchAll(
  creds: VMCredentials,
  domain: string,
  targetEmail: string
): Promise<string> {
  return runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage set-catchall '${escapeShell(domain)}' '${escapeShell(targetEmail)}'`]
  );
}

/**
 * Remove catch-all for a domain.
 */
export async function removeCatchAll(
  creds: VMCredentials,
  domain: string
): Promise<string> {
  return runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage remove-catchall '${escapeShell(domain)}'`]
  );
}

/**
 * Set domain web forwarding via Nginx.
 */
export async function setDomainForward(
  creds: VMCredentials,
  url: string
): Promise<string> {
  return runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    [`/usr/local/bin/aca-manage set-domain-forward '${escapeShell(url)}'`]
  );
}

/**
 * Get DKIM public key from the VM.
 */
export async function getDkimPublicKey(creds: VMCredentials): Promise<string | null> {
  try {
    const output = await runCommandOnVM(
      creds.token,
      creds.subscriptionId,
      creds.resourceGroup,
      creds.vmName,
      ['/usr/local/bin/aca-manage get-dkim-public-key']
    );
    if (output && !output.startsWith('ERROR')) {
      return output.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run health check on the VM (Postfix, Dovecot, OpenDKIM, Nginx status).
 */
export async function healthCheck(creds: VMCredentials): Promise<Record<string, string>> {
  const output = await runCommandOnVM(
    creds.token,
    creds.subscriptionId,
    creds.resourceGroup,
    creds.vmName,
    ['/usr/local/bin/aca-manage health-check']
  );

  const result: Record<string, string> = {};
  for (const line of output.trim().split('\n')) {
    const [key, value] = line.split(': ').map((s) => s.trim());
    if (key && value) result[key] = value;
  }
  return result;
}

/**
 * Test SMTP connection to the VM on port 587.
 */
export async function testSMTPConnection(ip: string, port = 587, timeoutMs = 10000): Promise<boolean> {
  try {
    const conn = await Deno.connect({ hostname: ip, port, transport: 'tcp' });
    const buf = new Uint8Array(512);
    const timer = setTimeout(() => conn.close(), timeoutMs);
    const n = await conn.read(buf);
    clearTimeout(timer);
    conn.close();
    if (n && n > 0) {
      const banner = new TextDecoder().decode(buf.subarray(0, n));
      return banner.startsWith('220');
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Test IMAP connection to the VM on port 993.
 */
export async function testIMAPConnection(ip: string, port = 993, timeoutMs = 10000): Promise<boolean> {
  try {
    const conn = await Deno.connectTls({ hostname: ip, port });
    const buf = new Uint8Array(512);
    const timer = setTimeout(() => conn.close(), timeoutMs);
    const n = await conn.read(buf);
    clearTimeout(timer);
    conn.close();
    if (n && n > 0) {
      const banner = new TextDecoder().decode(buf.subarray(0, n));
      return banner.includes('OK') || banner.includes('Dovecot');
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Test mailbox authentication and service health on the VM itself.
 * Runs doveadm auth test + health-check via Azure Run Command.
 * Much more reliable than testing from Deno Deploy over the network.
 */
export async function testMailboxAuth(
  creds: VMCredentials,
  username: string,
  password: string
): Promise<{ success: boolean; smtp_ok: boolean; imap_ok: boolean; error?: string }> {
  try {
    const output = await runCommandOnVM(
      creds.token,
      creds.subscriptionId,
      creds.resourceGroup,
      creds.vmName,
      [
        `/usr/local/bin/aca-manage health-check && doveadm auth test '${escapeShell(username)}' '${escapeShell(password)}' 2>&1 || echo "AUTH_FAILED"`,
      ]
    );

    const postfixOk = output.includes('postfix: active');
    const dovecotOk = output.includes('dovecot: active');
    const smtpPort = /smtp-port:\s*[1-9]/.test(output);
    const imapPort = /imap-port:\s*[1-9]/.test(output);
    const authOk = output.includes('auth succeeded') || output.includes('passdb');

    const smtpHealthy = postfixOk && smtpPort;
    const imapHealthy = dovecotOk && imapPort && authOk;

    return {
      success: smtpHealthy && imapHealthy,
      smtp_ok: smtpHealthy,
      imap_ok: imapHealthy,
      error: !authOk
        ? 'Authentication failed for mailbox user'
        : !smtpHealthy
          ? 'SMTP service not available on VM'
          : !imapHealthy
            ? 'IMAP service not available on VM'
            : undefined,
    };
  } catch (err) {
    return {
      success: false,
      smtp_ok: false,
      imap_ok: false,
      error: err instanceof Error ? err.message : 'VM command failed',
    };
  }
}

/**
 * Escape single quotes for shell commands.
 */
function escapeShell(str: string): string {
  return str.replace(/'/g, "'\\''");
}
