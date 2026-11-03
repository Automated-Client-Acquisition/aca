/**
 * M365 Mailbox Provisioning Edge Function — Shared Mailbox Model
 *
 * Architecture:
 *   - 1 M365 Business Basic license (~$6/mo) = 1 admin account per tenant
 *   - Up to 100 shared mailboxes per tenant (free via Exchange Online)
 *   - SMTP AUTH: admin authenticates, From: = shared mailbox address (Send As)
 *   - IMAP: admin credentials + delegated format admin@tenant\inbox@domain.com
 *   - Net cost: ~$0.06/inbox at 100 inboxes per tenant
 *
 * Prerequisites (user must complete before mailboxes work):
 *   1. Security Defaults disabled in Azure AD (blocks Basic Auth otherwise)
 *   2. SMTP AUTH enabled at tenant level (M365 Admin > Settings > Org Settings > Modern Auth)
 *   3. Azure app has Exchange.ManageAsApp permission + Exchange Admin role
 *
 * Actions:
 *   create      — Create one shared mailbox + grant Send As + Full Access to admin
 *   bulk_create — Create multiple mailboxes (500ms delay between each)
 *   delete      — Delete a shared mailbox
 *   list        — List mailboxes for a domain (DB only)
 *   retest      — Re-test Graph for M365, SMTP/IMAP for other mailboxes
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  getEXOToken,
  createSharedMailbox,
  deleteM365User,
  resetMailboxPassword,
  resolveUserIdByEmail,
  enableSmtpAuth,
  generateMailboxPassword,
  setUserProfilePhoto,
  ensureExchangeRecipientAdminRole,
  ensureExchangeAdminRole,
  ensureUserAdminRole,
  ensureExoServicePrincipal,
  ensureSecurityDefaultsDisabled,
  ensureTenantSmtpAuthEnabled,
  M365Error,
} from '../_shared/m365-client.ts';
import {
  encryptCredentials,
  testSMTPConnection,
  testIMAPConnection,
  extractSMTPCredentials,
  sendEmailViaSMTP,
} from '../_shared/smtp-client.ts';
import { decryptValue } from '../_shared/encryption.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { DEFAULT_FAST_TEXT_MODEL, DEFAULT_IMAGE_MODEL } from '../_shared/default-models.ts';
import OpenRouterImageProvider from '../_shared/providers/OpenRouterImageProvider.ts';
import { buildMailboxAvatarPrompt, inferGenderFromName, parseInferredGender } from '../_shared/mailbox-avatar.ts';
import { selectInChunks } from '../_shared/chunked-query.ts';
import { testM365MailboxConnection, m365RetestStatus, type M365HealthMailbox } from '../_shared/m365-mailbox-health.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function retestGraphMailbox(
  supabase: SupabaseClient,
  mailbox: M365HealthMailbox & { id: string },
) {
  const graph = await testM365MailboxConnection(supabase, mailbox, getM365Token);
  const now = new Date().toISOString();
  const { error: patchError } = await supabase.rpc('apply_mailbox_metadata_patch', {
    p_id: mailbox.id,
    p_set: graph.success ? { consecutive_auth_errors: 0 } : {
      graph_auth_error: graph.error,
      graph_auth_failed_at: now,
    },
    p_unset: graph.success ? [
      'graph_auth_error', 'graph_auth_failed_at', 'graph_auth_fail_count',
      'imap_auth_error', 'imap_auth_failed_at', 'imap_auth_fail_count',
      'disconnected_reason', 'disconnected_at', 'disconnected_error',
    ] : [],
  });
  if (patchError) throw patchError;

  // The status condition preserves a pause/burn applied while the GET ran.
  // The DB domain-sendability guard can further turn a proposed ready into paused.
  const { data: updated, error: updateError } = await supabase.from('email_mailboxes')
    .update({
      status: m365RetestStatus(mailbox, graph.success),
      imap_connected: graph.success,
      last_error: graph.success ? null : `Graph: ${graph.error || 'failed'}`,
      updated_at: now,
    })
    .eq('id', mailbox.id)
    .eq('status', mailbox.status)
    .select('status')
    .maybeSingle();
  if (updateError) throw updateError;
  return { graph, status: updated?.status ?? null };
}

// ── Internal: create one shared mailbox ──────────────────────────────────────

async function createOneMailbox(
  supabase: SupabaseClient<any>,
  params: {
    organization_id: string;
    domain_id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
    /**
     * Re-create this address on the domain's CURRENT tenant even though an m365
     * row already exists for it. Used by infra-domain-move: the domain row now
     * points at a new tenant, the old mailbox no longer exists there, and the
     * upsert below rewrites the existing row in place so its id — and every
     * sequence, enrollment and reply thread that references it — survives.
     */
    reprovision?: boolean;
  }
) {
  const { organization_id, domain_id, username, display_name, avatar_url, reprovision } = params;

  if (!username || username.includes('@') || username.includes(' ')) {
    throw new Error('username must not contain @ or spaces');
  }
  if (!display_name) throw new Error('display_name is required');

  // Fetch domain
  const { data: domain, error: domainError } = await supabase
    .from('email_sending_domains')
    .select('*')
    .eq('id', domain_id)
    .eq('organization_id', organization_id)
    .single();

  if (domainError || !domain) throw new Error('Domain not found');
  if (domain.infra_type !== 'm365') throw new Error('Domain is not an M365 domain');
  if (!domain.m365_domain_verified) throw new Error('Domain not yet verified — complete DNS verification first');

  // Fetch tenant
  const { data: tenant, error: tenantError } = await supabase
    .from('m365_tenants')
    .select('*')
    .eq('id', domain.m365_tenant_id)
    .single();

  if (tenantError || !tenant) throw new Error('M365 tenant not found');
  if (!tenant.admin_password_encrypted) {
    throw new Error('Admin password not set for this tenant. Re-connect the tenant and provide the admin account password.');
  }
  if (!tenant.admin_email) {
    throw new Error('Admin email not set for this tenant. Re-connect the tenant and provide the admin email.');
  }

  const adminEmail = tenant.admin_email as string;
  const sharedEmail = `${username.toLowerCase()}@${domain.domain}`;

  // Idempotency guard: if a mailbox row already exists for this address in this
  // org AND it's already a live M365 mailbox on this same domain, return it as-is.
  // Re-running the full create flow would generate a new password and overwrite
  // the stored credentials, breaking anything that already cached the old
  // password (warmup pools, sequences, etc.).
  //
  // Scoped to connection_type/sending_domain_id (not just email_address+org) because
  // an org can have a stale row at the same address from a different provider
  // (e.g. an archived ZapMail mailbox) — matching on address alone short-circuits
  // before any EXO/Graph call and hands back a row that was never actually
  // provisioned in M365, silently no-op'ing the create.
  const { data: existingMailbox } = await supabase
    .from('email_mailboxes')
    .select('*')
    .eq('email_address', sharedEmail)
    .eq('organization_id', organization_id)
    .maybeSingle();

  if (!reprovision && existingMailbox && existingMailbox.connection_type === 'm365' && existingMailbox.sending_domain_id === domain_id) {
    console.log(`[Infra Mailbox] Mailbox ${sharedEmail} already exists (id: ${existingMailbox.id}) — returning existing row, not re-creating`);
    return existingMailbox;
  }

  // Graph token — for MS Graph API calls
  // EXO token  — for Exchange Online Admin API (createSharedMailbox, deleteSharedMailbox)
  const [graphToken, exoToken] = await Promise.all([
    getM365Token(tenant.tenant_id),
    getEXOToken(tenant.tenant_id),
  ]);

  // Ensure prerequisites for EXO App-Only auth in the customer tenant.
  // Both calls are idempotent and cheap (single Graph filter query when already done).
  // Without these, EXO returns "The role assigned to application <id> isn't supported in this scenario".
  try {
    await ensureExoServicePrincipal(graphToken);
    await ensureExchangeRecipientAdminRole(graphToken);
    await ensureExchangeAdminRole(graphToken);
    await ensureUserAdminRole(graphToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Infra Mailbox] EXO prerequisite setup failed for tenant ${tenant.tenant_id}: ${msg}`);
    throw new Error(
      `Failed to configure Exchange permissions in customer tenant. ` +
      `The customer admin may need to re-grant consent so the app can self-assign roles. ${msg}`
    );
  }

  // Disable Security Defaults if still enabled (safety net — connect-time
  // call may have failed if Policy.ReadWrite.ConditionalAccess wasn't yet
  // consented). Without this, SMTP AUTH login is rejected at the tenant level.
  try {
    await ensureSecurityDefaultsDisabled(graphToken);
  } catch (err) {
    console.warn(
      `[Infra Mailbox] Could not disable Security Defaults for ${tenant.tenant_id} (will continue): ${err instanceof Error ? err.message : err}`
    );
  }
  // Note: tenant-level SMTP AUTH (Set-TransportConfig) is handled by the
  // dedicated cron `tenant-smtp-fix-retry` because EXO role propagation can
  // take 5-30 min after connect, and we don't want to block mailbox creation
  // on it. The mailbox will land in "disconnected" if SMTP is still blocked,
  // and the auto-retest cron will recover it once the tenant fix completes.

  // Create the shared mailbox via EXO Admin API.
  // EXO caches role membership independently of Graph (~5-30 min propagation),
  // so even though we just assigned the Exchange Recipient Admin role, the very
  // first mailbox creation in a freshly-consented tenant can hit:
  //   "The role assigned to application X isn't supported in this scenario"
  // We retry with exponential backoff so onboarding doesn't fail just because
  // the customer was fast.
  let mailboxUser: { id: string };
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      mailboxUser = await createSharedMailbox(exoToken, tenant.tenant_id, {
        displayName: display_name,
        mailNickname: username.toLowerCase(),
        emailAddress: sharedEmail,
      });
      break;
    } catch (err) {
      const m365Err = err as M365Error;
      const isRolePropagationError =
        m365Err.code === 'EXO_ERROR' &&
        typeof m365Err.message === 'string' &&
        m365Err.message.includes("isn't supported in this scenario");

      if (!isRolePropagationError || attempt === maxAttempts) {
        throw err;
      }

      // Exponential backoff: 5s, 15s, 45s, 90s
      const delaysMs = [5_000, 15_000, 45_000, 90_000];
      const waitMs = delaysMs[attempt - 1] ?? 90_000;
      console.warn(
        `[Infra Mailbox] EXO role not yet propagated for tenant ${tenant.tenant_id} (attempt ${attempt}/${maxAttempts}). Waiting ${waitMs}ms then retrying...`
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  if (!mailboxUser!) {
    throw new Error('Failed to create shared mailbox after retries');
  }
  console.log(`[Infra Mailbox] Created shared mailbox ${sharedEmail} (id: ${mailboxUser.id})`);

  // Generate a strong password for this mailbox and reset it via Graph.
  // Shared mailboxes are created without a usable password by default.
  // Resetting it allows SMTP AUTH and IMAP login directly as the shared mailbox.
  // This requires: User.ReadWrite.All (app permission, already in our set).
  //
  // Microsoft Graph reads from a replicated store separate from EXO. After EXO
  // creates the mailbox, the new user takes 5-90s to appear on Graph reads,
  // so resolveUserIdByEmail throws "Resource ... does not exist" if called too
  // soon. We retry with exponential backoff specifically for that error.
  const mailboxPassword = generateMailboxPassword();
  let sharedMailboxUserId: string | null = null;

  const isReplicationLagError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('does not exist') || msg.includes('Request_ResourceNotFound');
  };

  const resolveWithRetry = async (): Promise<string> => {
    const delaysMs = [2_000, 5_000, 10_000, 20_000, 30_000]; // ~67s total
    let lastErr: unknown;
    for (let i = 0; i <= delaysMs.length; i++) {
      try {
        return await resolveUserIdByEmail(graphToken, sharedEmail);
      } catch (e) {
        lastErr = e;
        if (!isReplicationLagError(e) || i === delaysMs.length) throw e;
        const wait = delaysMs[i];
        console.warn(
          `[Infra Mailbox] Graph user not yet replicated for ${sharedEmail} (attempt ${i + 1}/${delaysMs.length + 1}). Waiting ${wait}ms...`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  };

  // Reset password with retry. The User Administrator directory role we just
  // assigned to the SP can take 5-15 min to propagate through Microsoft's role
  // cache, so the first PATCH /users/{id} attempts may return
  // "Insufficient privileges". Retry with backoff to absorb the lag.
  const isPrivilegeError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Insufficient privileges') || msg.includes('Authorization_RequestDenied');
  };

  try {
    sharedMailboxUserId = await resolveWithRetry();
    const pwDelays = [3_000, 10_000, 30_000, 60_000]; // ~103s total
    let pwSet = false;
    for (let i = 0; i <= pwDelays.length; i++) {
      try {
        await resetMailboxPassword(graphToken, sharedMailboxUserId, mailboxPassword);
        pwSet = true;
        break;
      } catch (e) {
        if (!isPrivilegeError(e) || i === pwDelays.length) throw e;
        const wait = pwDelays[i];
        console.warn(
          `[Infra Mailbox] User Admin role not yet propagated for password reset on ${sharedEmail} (attempt ${i + 1}/${pwDelays.length + 1}). Waiting ${wait}ms...`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    if (pwSet) {
      console.log(`[Infra Mailbox] Password set for ${sharedEmail} (Graph id: ${sharedMailboxUserId})`);
    }
  } catch (e) {
    console.warn(`[Infra Mailbox] Could not set mailbox password (non-fatal, will use admin creds): ${e instanceof Error ? e.message : e}`);
  }

  // Defensive: ensure tenant-level SMTP AUTH is still enabled. Connect-time
  // already does this, but a tenant admin may have re-disabled it out-of-band
  // or the connect-time call may have been skipped for externally-created tenants.
  // Without this, per-mailbox CASMailbox flips are meaningless.
  try {
    await ensureTenantSmtpAuthEnabled(exoToken, tenant.tenant_id, tenant.onmicrosoft_domain);
  } catch (e) {
    console.warn(`[Infra Mailbox] Could not ensure tenant-level SMTP AUTH (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  // Enable SMTP AUTH on the shared mailbox itself
  // Uses EXO CASMailbox endpoint (primary) with Graph beta fallback
  try {
    const userId = sharedMailboxUserId || await resolveWithRetry();
    await enableSmtpAuth(graphToken, userId, exoToken, tenant.tenant_id, sharedEmail);
  } catch (e) {
    console.warn(`[Infra Mailbox] Could not enable SMTP AUTH (non-fatal): ${e instanceof Error ? e.message : e}`);
  }

  const resolvedAvatarUrl = avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(display_name)}&background=random&size=128`;

  // SMTP + IMAP: authenticate directly as the shared mailbox
  // No delegation required — the shared mailbox has its own credentials
  const smtpPassword = sharedMailboxUserId ? mailboxPassword : (tenant.admin_password_encrypted ? await decryptValue(tenant.admin_password_encrypted) : mailboxPassword);
  const encrypted = await encryptCredentials({
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
    smtp_username: sharedEmail,
    smtp_password: smtpPassword,
    imap_host: 'outlook.office365.com',
    imap_port: 993,
    imap_username: sharedEmail,
    imap_password: smtpPassword,
  });

  const mailboxPayload = {
    organization_id,
    email_address: sharedEmail,
    display_name,
    connection_type: 'm365',
    sending_domain_id: domain_id,
    provider: 'outlook',
    status: 'warming',
    // Enrol in the warmup mesh for real. `status: 'warming'` is cosmetic —
    // email-warmup-send-tick filters on `warmup_enabled`, so without this every
    // m365 mailbox showed a "Warming" badge while sending zero warmup mail.
    warmup_enabled: true,
    warmup_day: 0,
    daily_limit: 3,
    daily_sent: 0,
    health_score: 1.00,
    imap_connected: false,
    metadata: {
      smtp_credentials: encrypted,
      smtp_host: 'smtp.office365.com',
      smtp_port: 587,
      smtp_from: sharedEmail,
      imap_host: 'outlook.office365.com',
      imap_port: 993,
      avatar_url: resolvedAvatarUrl,
      m365_user_id: sharedMailboxUserId || mailboxUser.id,
      m365_mailbox_type: 'shared',
      m365_admin_email: adminEmail,
    },
  };

  // Upsert — if the mailbox already exists in DB (from a prior failed run), update it
  const { data: mailbox, error: upsertError } = await supabase
    .from('email_mailboxes')
    .upsert(mailboxPayload, { onConflict: 'email_address,organization_id', ignoreDuplicates: false })
    .select()
    .single();

  if (upsertError) throw new Error(`Failed to upsert mailbox record: ${upsertError.message}`);

  // Increment mailbox_count on domain — not when re-provisioning an existing row,
  // which is already counted.
  const { error: rpcError } = reprovision
    ? { error: null }
    : await supabase.rpc('increment_mailbox_count', { domain_id_input: domain_id });
  if (rpcError) {
    await supabase
      .from('email_sending_domains')
      .update({ mailbox_count: (domain.mailbox_count || 0) + 1 })
      .eq('id', domain_id);
  }

  // Sync avatar to M365 as profile photo (if domain setting enabled)
  if (domain.sync_avatars_to_m365 && resolvedAvatarUrl && sharedMailboxUserId) {
    try {
      await setUserProfilePhoto(graphToken, sharedMailboxUserId, resolvedAvatarUrl);
      console.log(`[Infra Mailbox] Profile photo synced to M365 for ${sharedEmail}`);
    } catch (e) {
      console.warn(`[Infra Mailbox] Profile photo sync failed (non-fatal): ${e instanceof Error ? e.message : e}`);
    }
  }

  // Connectivity test with retry-with-backoff.
  //
  // Exchange Online provisioning is layered: Graph creates the user, EXO creates
  // the mailbox object, then the SMTP/IMAP front-ends pick it up. SMTP AUTH login
  // typically only starts working 30-180s after mailbox creation, even though all
  // prior API calls succeed. We retry the SMTP test until it passes (max ~3 min).
  //
  // For m365 mailboxes: SMTP test only (inbound handled by Graph API polling).
  try {
    const creds = await extractSMTPCredentials(mailbox.metadata || {});
    if (creds) {
      const smtpDelays = [10_000, 20_000, 30_000, 45_000, 60_000, 60_000]; // ~225s total
      let smtpResult: { success: boolean; error?: string } = { success: false };
      for (let i = 0; i <= smtpDelays.length; i++) {
        smtpResult = await testSMTPConnection(creds);
        if (smtpResult.success) break;

        // Fail-fast on tenant-level config errors that won't fix themselves.
        // 5.7.139 = SMTP AUTH disabled at tenant level (we try to fix this at
        // connect time + before mailbox creation, so seeing it here means
        // ensureTenantSmtpAuthEnabled failed and admin must enable it manually).
        const errMsg = smtpResult.error || '';
        const isPermanentTenantBlock =
          errMsg.includes('5.7.139') ||
          errMsg.includes('SmtpClientAuthentication is disabled for the Tenant') ||
          errMsg.includes('5.7.57'); // not authenticated for sender
        if (isPermanentTenantBlock) {
          console.warn(`[Infra Mailbox] Permanent tenant-level SMTP block for ${sharedEmail}, not retrying: ${errMsg}`);
          break;
        }

        if (i === smtpDelays.length) break;
        const wait = smtpDelays[i];
        console.warn(
          `[Infra Mailbox] SMTP not yet accepting login for ${sharedEmail} (attempt ${i + 1}/${smtpDelays.length + 1}): ${errMsg || 'failed'}. Waiting ${wait}ms...`
        );
        await new Promise((r) => setTimeout(r, wait));
      }
      // On success: KEEP the mailbox in `warming` (it was provisioned that way)
      // so it actually ramps through the warmup schedule. Previously this set
      // `ready` on the first successful SMTP test — ~20s after creation — which
      // silently skipped warmup entirely (mailboxes jumped warming→ready with
      // warmup_day still 0). Verifying SMTP only proves the mailbox can send; it
      // does not mean the mailbox is warmed. We also stamp warmup_start_date now
      // (at verification time, not creation) so the hourly warmup-tick ramps it
      // and only promotes to `ready` once the ramp completes.
      //
      // On failure, mark as `disconnected` (NOT `pending`) so the auto-retest
      // cron picks it up. `pending` means "not yet tested"; `disconnected`
      // means "tested and failed, retry later".
      const newStatus = smtpResult.success
        ? (mailbox.status === 'warming' ? 'warming' : 'ready')
        : 'disconnected';
      const verifyUpdate: Record<string, unknown> = {
        status: newStatus,
        // imap_connected=true for m365: inbound handled by Graph API poller (no IMAP needed)
        imap_connected: smtpResult.success,
        last_error: smtpResult.success
          ? null
          : (smtpResult.error || '').includes('5.7.139')
            ? 'Security Defaults is blocking SMTP. Disable it in Entra ID > Overview > Properties > Manage security defaults > set to Disabled > Save.'
            : `SMTP: ${smtpResult.error || 'failed'}`,
      };
      // Anchor the warmup ramp at verification time so the tick starts ramping.
      if (newStatus === 'warming' && !mailbox.warmup_start_date) {
        verifyUpdate.warmup_start_date = new Date().toISOString();
        verifyUpdate.warmup_day = 0;
      }
      await supabase
        .from('email_mailboxes')
        .update(verifyUpdate)
        .eq('id', mailbox.id);
      mailbox.status = newStatus;
      if (smtpResult.success) {
        console.log(`[Infra Mailbox] SMTP login verified for ${sharedEmail}`);
      } else {
        console.warn(`[Infra Mailbox] SMTP login still failing for ${sharedEmail} after retries: ${smtpResult.error || 'failed'}`);
      }
    }
  } catch (e) {
    console.warn('[Infra Mailbox] Connectivity test failed (non-fatal):', e instanceof Error ? e.message : e);
  }

  return mailbox;
}

// ── Internal: repair SMTP AUTH on one existing mailbox ──────────────────────
// Re-applies CASMailbox SMTP AUTH flag, resets the AD password, re-stores
// credentials, and retests SMTP. Assumes tenant-level SMTP AUTH has already
// been ensured by the caller (do it once per tenant, not per mailbox).
// Returns a result object; never throws (errors are recorded on the mailbox row).
async function repairOneMailbox(
  supabase: SupabaseClient<any>,
  mailbox: Record<string, any>,
  tenantId: string,
  exoToken: string,
): Promise<{ success: boolean; email: string; error?: string }> {
  const email = mailbox.email_address as string;
  try {
    const graphToken = await getM365Token(tenantId);

    // Resolve user with replication-lag retry
    let userId: string | null = null;
    const delaysMs = [2_000, 5_000, 10_000];
    for (let i = 0; i <= delaysMs.length; i++) {
      try {
        userId = await resolveUserIdByEmail(graphToken, email);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const isNotFound = msg.includes('does not exist') || msg.includes('Request_ResourceNotFound');
        if (!isNotFound || i === delaysMs.length) break;
        await new Promise((r) => setTimeout(r, delaysMs[i]));
      }
    }

    // Re-apply SMTP AUTH + IMAP via CASMailbox
    await enableSmtpAuth(graphToken, userId || '', exoToken, tenantId, email, true);

    // Reset password (with privilege-propagation retry)
    const newPassword = generateMailboxPassword();
    let passwordReset = false;
    if (userId) {
      const pwDelays = [3_000, 10_000, 30_000];
      for (let i = 0; i <= pwDelays.length; i++) {
        try {
          await resetMailboxPassword(graphToken, userId, newPassword);
          passwordReset = true;
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isPrivErr = msg.includes('Insufficient privileges') || msg.includes('Authorization_RequestDenied');
          if (!isPrivErr || i === pwDelays.length) {
            console.warn(`[Infra Mailbox] Password reset failed for ${email} (non-fatal): ${msg}`);
            break;
          }
          await new Promise((r) => setTimeout(r, pwDelays[i]));
        }
      }
    }

    // Build fresh credentials
    let creds = await extractSMTPCredentials(mailbox.metadata || {});
    if (!creds && !passwordReset) {
      return { success: false, email, error: 'No SMTP credentials found and password reset failed' };
    }

    if (passwordReset) {
      creds = {
        smtp_host: 'smtp.office365.com',
        smtp_port: 587,
        smtp_username: email,
        smtp_password: newPassword,
        imap_host: 'outlook.office365.com',
        imap_port: 993,
        imap_username: email,
        imap_password: newPassword,
      };
      const encrypted = await encryptCredentials(creds);
      // Atomic merge — read-modify-write here would race with concurrent
      // writers (cron auto-retest, manual repair clicks) and clobber the
      // freshly-set credentials. See cd7f9b5c for the analogous heal fix.
      const { error: mergeErr } = await supabase.rpc('merge_mailbox_smtp_credentials', {
        p_id: mailbox.id,
        p_encrypted: encrypted,
      });
      if (mergeErr) console.warn(`[Infra Mailbox] merge_mailbox_smtp_credentials failed for ${email}: ${mergeErr.message}`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // Retest SMTP with short backoff (bulk mode — keep per-mailbox time bounded)
    let smtpResult: { success: boolean; error?: string } = { success: false };
    const smtpDelays = [0, 5_000, 15_000];
    for (let i = 0; i < smtpDelays.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, smtpDelays[i]));
      smtpResult = await testSMTPConnection(creds!);
      if (smtpResult.success) break;
    }

    // Preserve `warming` — a healthy warming mailbox passing a retest must keep
    // ramping, not jump to `ready` (which skips warmup).
    const newStatus = smtpResult.success
      ? (mailbox.status === 'warming' ? 'warming' : 'ready')
      : 'disconnected';
    await supabase
      .from('email_mailboxes')
      .update({
        imap_connected: smtpResult.success,
        status: newStatus,
        last_error: smtpResult.success ? null : `SMTP: ${smtpResult.error || 'failed'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mailbox.id);

    return { success: smtpResult.success, email, error: smtpResult.success ? undefined : smtpResult.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Infra Mailbox] repairOneMailbox failed for ${email}: ${msg}`);
    await supabase
      .from('email_mailboxes')
      .update({
        status: 'disconnected',
        last_error: `Repair failed: ${msg}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', mailbox.id);
    return { success: false, email, error: msg };
  }
}

// ── Async Job Processing ──────────────────────────────────────────────────────

// Per-chunk budget: each mailbox takes ~5-10s including M365 role propagation
// delays, so ~40 mailboxes comfortably fits under the edge function wall-clock
// limit. When the chunk finishes without completing the job, we self-invoke
// to continue with the next chunk.
const CHUNK_SIZE = 40;
const INTER_MAILBOX_DELAY_MS = 500;
const STUCK_JOB_THRESHOLD_MS = 5 * 60 * 1000;

interface JobMailbox {
  username: string;
  display_name: string;
  avatar_url?: string;
  /** See createOneMailbox `reprovision`. */
  reprovision?: boolean;
}

// Generating an AI headshot per mailbox (LLM gender/ethnicity inference + image
// gen + upload) is far slower than the bare M365 create. To stay under the edge
// wall-clock limit we process a much smaller slice per chunk when avatars are on,
// and the job self-resumes for the next slice.
const AVATAR_GEN_CHUNK_SIZE = 10;
const AVATAR_GEN_PARALLELISM = 5;

// Pushing an avatar to Graph is one image download + one PUT per mailbox —
// much lighter than AI avatar generation, so a larger chunk still comfortably
// fits under the edge wall-clock limit even with bounded concurrency inside it.
const AVATAR_SYNC_CHUNK_SIZE = 25;
const AVATAR_SYNC_CONCURRENCY = 5;

/** Resolve + decrypt the org's OpenRouter key. Returns null if unavailable. */
async function resolveOpenRouterKey(
  supabase: SupabaseClient<any>,
  organizationId: string
): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.warn('[Infra Mailbox] ENCRYPTION_KEY not set — cannot generate avatars');
    return null;
  }
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', organizationId)
    .eq('provider', 'openrouter')
    .maybeSingle();
  if (!data?.key_encrypted) {
    console.warn(`[Infra Mailbox] No OpenRouter key for org ${organizationId} — avatars will fall back to ui-avatars`);
    return null;
  }
  try {
    return await decryptApiKey(data.key_encrypted as string, encryptionKey);
  } catch (err) {
    console.warn(`[Infra Mailbox] Failed to decrypt OpenRouter key: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Generate a realistic AI headshot for a mailbox display name and upload it to
 * the avatars bucket. Mirrors generate-mailbox-names' avatar_only logic (gender/
 * ethnicity inference from the name → photoreal prompt). Returns the public URL,
 * or null on any failure (caller falls back to the existing ui-avatars default).
 */
async function generateMailboxAvatar(
  supabase: SupabaseClient<any>,
  openRouterKey: string,
  displayName: string
): Promise<string | null> {
  try {
    let gender = inferGenderFromName(displayName);
    let ethnicity = '';
    try {
      const inferRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: DEFAULT_FAST_TEXT_MODEL,
          messages: [{ role: 'user', content: `What is the gender and ethnicity of someone named "${displayName}"?\nRespond with EXACTLY two words separated by a comma: gender, ethnicity\nExample: female, French\nExample: male, Indian\nGender MUST be "male" or "female". Ethnicity should be a visual descriptor.` }],
          temperature: 0.1,
          max_tokens: 20,
        }),
      });
      if (inferRes.ok) {
        const inferData = await inferRes.json();
        const text = (inferData.choices?.[0]?.message?.content ?? '').trim();
        const llmGender = parseInferredGender(text);
        if (gender === 'unspecified' && llmGender !== 'unspecified') gender = llmGender;
        const parts = text.split(',').map((p: string) => p.trim());
        if (parts.length >= 2) ethnicity = parts.slice(1).join(', ').replace(/^[\s.]+|[\s.]+$/g, '');
      }
    } catch (err) {
      console.warn(`[Infra Mailbox] Avatar gender inference failed for "${displayName}": ${err instanceof Error ? err.message : err}`);
    }
    const prompt = buildMailboxAvatarPrompt({
      displayName,
      gender,
      ethnicity,
    });

    const imageProvider = new OpenRouterImageProvider(openRouterKey, { referer: Deno.env.get('SUPABASE_URL') });
    const slug = displayName.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
    return await imageProvider.generateAndUpload(supabase, prompt, DEFAULT_IMAGE_MODEL, {
      aspectRatio: '1:1',
      fileName: `mailbox/${slug}-${Date.now()}.jpg`,
      bucket: 'avatars',
    });
  } catch (err) {
    console.warn(`[Infra Mailbox] Avatar generation failed for "${displayName}": ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function selfInvokeResume(jobId: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/infra-mailbox-provision`;
  // resume_job is service-role only.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ action: 'resume_job', job_id: jobId }),
  });
  // Intentionally don't await body — this is a fire-and-forget continuation.
  res.body?.cancel().catch(() => { /* ignore */ });
}

async function selfInvokeResumeAvatarSync(jobId: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/infra-mailbox-provision`;
  // resume_avatar_sync_job is service-role only.
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ action: 'resume_avatar_sync_job', job_id: jobId }),
  });
  res.body?.cancel().catch(() => { /* ignore */ });
}

interface AvatarSyncResult {
  synced: string[];
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
}

/**
 * Push each of the given mailboxes' stored avatar_url to M365 as its Graph
 * profile photo. Non-M365 mailboxes, or ones missing avatar_url/m365_user_id/
 * sending_domain_id, are reported as skipped rather than errored. The
 * selection can span multiple domains/tenants, so Graph tokens are resolved
 * and cached per Azure tenant. Explicit user-triggered sync — does not gate
 * on email_sending_domains.sync_avatars_to_m365 (that flag governs implicit
 * sync on the single-mailbox `update` action only).
 */
async function syncAvatarsForMailboxIds(
  supabase: SupabaseClient<any>,
  organizationId: string,
  mailboxIds: string[],
): Promise<AvatarSyncResult> {
  const mailboxes = await selectInChunks<{ id: string; email_address: string; connection_type: string; sending_domain_id: string | null; metadata: Record<string, unknown> | null }>(
    supabase,
    'email_mailboxes',
    'id, email_address, connection_type, sending_domain_id, metadata',
    'id',
    mailboxIds,
    (q) => q.eq('organization_id', organizationId),
  );

  const skipped: Array<{ email: string; reason: string }> = [];
  const candidates: Array<{ id: string; email_address: string; sending_domain_id: string; avatarUrl: string; userId: string }> = [];

  for (const mb of mailboxes) {
    const meta = (mb.metadata || {}) as Record<string, unknown>;
    const avatarUrl = meta.avatar_url as string | undefined;
    const userId = meta.m365_user_id as string | undefined;

    if (mb.connection_type !== 'm365') {
      skipped.push({ email: mb.email_address, reason: 'not_m365' });
    } else if (!userId) {
      skipped.push({ email: mb.email_address, reason: 'missing_m365_user_id' });
    } else if (!avatarUrl) {
      skipped.push({ email: mb.email_address, reason: 'missing_avatar_url' });
    } else if (!mb.sending_domain_id) {
      skipped.push({ email: mb.email_address, reason: 'missing_sending_domain' });
    } else {
      candidates.push({
        id: mb.id,
        email_address: mb.email_address,
        sending_domain_id: mb.sending_domain_id,
        avatarUrl,
        userId,
      });
    }
  }

  const synced: string[] = [];
  const errors: Array<{ email: string; error: string }> = [];

  if (candidates.length > 0) {
    const domainIds = Array.from(new Set(candidates.map((c) => c.sending_domain_id)));
    const domains = await selectInChunks<{ id: string; m365_tenant_id: string | null }>(
      supabase,
      'email_sending_domains',
      'id, m365_tenant_id',
      'id',
      domainIds,
    );

    const tenantIdByDomain = new Map<string, string>();
    const m365TenantIds = new Set<string>();
    for (const d of domains) {
      if (d.m365_tenant_id) {
        tenantIdByDomain.set(d.id, d.m365_tenant_id);
        m365TenantIds.add(d.m365_tenant_id);
      }
    }

    const tenants = await selectInChunks<{ id: string; tenant_id: string | null }>(
      supabase,
      'm365_tenants',
      'id, tenant_id',
      'id',
      Array.from(m365TenantIds),
    );

    const azureTenantIdByM365TenantId = new Map<string, string>();
    for (const t of tenants) {
      if (t.tenant_id) azureTenantIdByM365TenantId.set(t.id, t.tenant_id);
    }

    // One Graph token per distinct Azure tenant — several domains can share a tenant.
    const tokenByAzureTenantId = new Map<string, string>();
    const getTokenForDomain = async (domainId: string): Promise<string | null> => {
      const m365TenantId = tenantIdByDomain.get(domainId);
      if (!m365TenantId) return null;
      const azureTenantId = azureTenantIdByM365TenantId.get(m365TenantId);
      if (!azureTenantId) return null;
      let token = tokenByAzureTenantId.get(azureTenantId);
      if (!token) {
        token = await getM365Token(azureTenantId);
        tokenByAzureTenantId.set(azureTenantId, token);
      }
      return token;
    };

    const queue = [...candidates];
    const workers = Array.from({ length: Math.min(AVATAR_SYNC_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const candidate = queue.shift();
        if (!candidate) break;
        try {
          const token = await getTokenForDomain(candidate.sending_domain_id);
          if (!token) {
            errors.push({ email: candidate.email_address, error: 'Could not resolve M365 tenant token' });
            continue;
          }
          await setUserProfilePhoto(token, candidate.userId, candidate.avatarUrl);
          synced.push(candidate.email_address);
        } catch (e) {
          errors.push({ email: candidate.email_address, error: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    await Promise.all(workers);
  }

  return { synced, skipped, errors };
}

/**
 * Process up to AVATAR_SYNC_CHUNK_SIZE mailboxes for an avatar sync job, then
 * either complete the job or self-invoke to continue. Mirrors processJobChunk
 * (mailbox provisioning) — same claim/heartbeat/resume skeleton, different
 * per-item work (Graph photo push instead of mailbox creation).
 */
async function processAvatarSyncChunk(
  supabase: SupabaseClient<any>,
  jobId: string,
) {
  const { data: job, error: fetchErr } = await supabase
    .from('mailbox_avatar_sync_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (fetchErr || !job) {
    console.error(`[Infra Mailbox] Avatar sync job ${jobId} not found: ${fetchErr?.message}`);
    return;
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return;
  }

  // Unlike the mailbox-provisioning job processor, this doesn't skip when the
  // job is already 'running' with a fresh heartbeat: the self-invoke chain
  // (bulk_sync_avatars_async -> resume_avatar_sync_job -> ...) IS the fresh
  // heartbeat, so that check would just make every chunk after the first
  // refuse to run, stalling progress until the cron sweep resumes it every
  // 5 minutes. resume_stuck_avatar_sync_jobs already filters to stale
  // heartbeats at the SQL level (heartbeat_at < cutoff), so a genuinely
  // still-running chain can't get double-processed by the cron anyway.
  const now = new Date();

  await supabase
    .from('mailbox_avatar_sync_jobs')
    .update({
      status: 'running',
      heartbeat_at: now.toISOString(),
      started_at: job.started_at ?? now.toISOString(),
    })
    .eq('id', jobId);

  const mailboxIds = job.mailbox_ids as string[];
  const total = mailboxIds.length;
  const startIdx = job.processed_index as number;
  const endIdx = Math.min(startIdx + AVATAR_SYNC_CHUNK_SIZE, total);
  const chunkIds = mailboxIds.slice(startIdx, endIdx);

  const skipped = (job.skipped as Array<{ email: string; reason: string }>) ?? [];
  const errors = (job.errors as Array<{ email: string; error: string }>) ?? [];
  let syncedCount = job.synced_count as number;

  try {
    const result = await syncAvatarsForMailboxIds(supabase, job.organization_id as string, chunkIds);
    syncedCount += result.synced.length;
    skipped.push(...result.skipped);
    errors.push(...result.errors);
  } catch (e) {
    errors.push({ email: '(chunk)', error: e instanceof Error ? e.message : String(e) });
  }

  await supabase
    .from('mailbox_avatar_sync_jobs')
    .update({
      processed_index: endIdx,
      synced_count: syncedCount,
      skipped,
      errors,
      current_email: null,
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (endIdx >= total) {
    await supabase
      .from('mailbox_avatar_sync_jobs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', jobId);
    console.log(`[Infra Mailbox] Avatar sync job ${jobId} completed: ${syncedCount} synced, ${skipped.length} skipped, ${errors.length} errors`);
  } else {
    console.log(`[Infra Mailbox] Avatar sync job ${jobId} chunk done at ${endIdx}/${total}, self-invoking continuation`);
    await selfInvokeResumeAvatarSync(jobId);
  }
}

/**
 * Process up to CHUNK_SIZE mailboxes for a job, then either complete the job
 * or self-invoke to continue. Called by bulk_create_async (initial kick),
 * resume_job (continuation), and resume_stuck_jobs (cron recovery).
 */
async function processJobChunk(
  supabase: SupabaseClient<any>,
  jobId: string
) {
  const { data: job, error: fetchErr } = await supabase
    .from('mailbox_provisioning_jobs')
    .select('*')
    .eq('id', jobId)
    .single();

  if (fetchErr || !job) {
    console.error(`[Infra Mailbox] Job ${jobId} not found: ${fetchErr?.message}`);
    return;
  }

  if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
    return;
  }

  // Unlike an earlier version of this function, this doesn't skip when the
  // job is already 'running' with a fresh heartbeat: the self-invoke chain
  // (bulk_create_async -> resume_job -> ...) IS the fresh heartbeat, so that
  // check just made every chunk after the first refuse to run, stalling
  // progress until the cron sweep resumed it every 5 minutes.
  // resume_stuck_jobs already filters to stale heartbeats at the SQL level
  // (heartbeat_at < cutoff), so a genuinely still-running chain can't get
  // double-processed by the cron anyway.
  const now = new Date();

  await supabase
    .from('mailbox_provisioning_jobs')
    .update({
      status: 'running',
      heartbeat_at: now.toISOString(),
      started_at: job.started_at ?? now.toISOString(),
    })
    .eq('id', jobId);

  const mailboxes = job.mailboxes as JobMailbox[];
  const total = mailboxes.length;
  const startIdx = job.processed_index as number;
  const genAvatars = (job as { generate_avatars?: boolean }).generate_avatars === true;
  const chunkSize = genAvatars ? AVATAR_GEN_CHUNK_SIZE : CHUNK_SIZE;
  const endIdx = Math.min(startIdx + chunkSize, total);

  const errors = (job.errors as Array<{ username: string; error: string }>) ?? [];
  const createdIds = (job.created_mailbox_ids as string[]) ?? [];
  let createdCount = job.created_count as number;
  let failedCount = job.failed_count as number;

  // When avatars are enabled, pre-generate AI headshots for this chunk's slice
  // in parallel (the per-mailbox create loop below is serial). Any mailbox that
  // already carries a browser-generated avatar_url is left untouched. Failures
  // are non-fatal — createOneMailbox falls back to a ui-avatars placeholder.
  const avatarByIndex = new Map<number, string>();
  if (genAvatars) {
    const openRouterKey = await resolveOpenRouterKey(supabase, job.organization_id as string);
    if (openRouterKey) {
      const needing: number[] = [];
      for (let i = startIdx; i < endIdx; i++) {
        if (!mailboxes[i].avatar_url) needing.push(i);
      }
      for (let o = 0; o < needing.length; o += AVATAR_GEN_PARALLELISM) {
        const slice = needing.slice(o, o + AVATAR_GEN_PARALLELISM);
        const results = await Promise.allSettled(
          slice.map((idx) => generateMailboxAvatar(supabase, openRouterKey, mailboxes[idx].display_name))
        );
        results.forEach((r, k) => {
          if (r.status === 'fulfilled' && r.value) avatarByIndex.set(slice[k], r.value);
        });
        // Keep the job's heartbeat fresh during the (slow) avatar batch so the
        // stuck-job detector doesn't relaunch a worker that's still alive.
        await supabase
          .from('mailbox_provisioning_jobs')
          .update({ heartbeat_at: new Date().toISOString() })
          .eq('id', jobId);
      }
    }
  }

  for (let i = startIdx; i < endIdx; i++) {
    // Check for cancellation between each mailbox
    const { data: statusCheck } = await supabase
      .from('mailbox_provisioning_jobs')
      .select('status')
      .eq('id', jobId)
      .single();
    if (statusCheck?.status === 'cancelled') {
      console.log(`[Infra Mailbox] Job ${jobId} cancelled mid-run at index ${i}`);
      return;
    }

    const mb = mailboxes[i];
    try {
      const mailbox = await createOneMailbox(supabase, {
        organization_id: job.organization_id as string,
        domain_id: job.domain_id as string,
        username: mb.username,
        display_name: mb.display_name,
        avatar_url: avatarByIndex.get(i) ?? mb.avatar_url,
        reprovision: mb.reprovision === true,
      });
      createdIds.push((mailbox as { id: string }).id);
      createdCount += 1;
    } catch (err) {
      const message = err instanceof M365Error
        ? `[${err.code}] ${err.message}`
        : (err instanceof Error ? err.message : 'Create failed');
      errors.push({ username: mb.username, error: message });
      failedCount += 1;
    }

    // Update progress + heartbeat after each mailbox so the UI stays live
    // and the stuck-job detector can tell this worker is still alive.
    await supabase
      .from('mailbox_provisioning_jobs')
      .update({
        processed_index: i + 1,
        current_username: mb.username,
        created_count: createdCount,
        failed_count: failedCount,
        errors,
        created_mailbox_ids: createdIds,
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (i < endIdx - 1) {
      await new Promise((r) => setTimeout(r, INTER_MAILBOX_DELAY_MS));
    }
  }

  // Chunk done. Either complete the job or queue another chunk.
  if (endIdx >= total) {
    await supabase
      .from('mailbox_provisioning_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_username: null,
      })
      .eq('id', jobId);
    console.log(`[Infra Mailbox] Job ${jobId} completed: ${createdCount} created, ${failedCount} failed`);
  } else {
    console.log(`[Infra Mailbox] Job ${jobId} chunk done at ${endIdx}/${total}, self-invoking continuation`);
    await selfInvokeResume(jobId);
  }
}

// Cron jobs and self-invoked continuations: no organization in the body, so only
// the service role may call them.
const SERVICE_ROLE_ONLY_ACTIONS = new Set([
  'resume_job',
  'resume_stuck_jobs',
  'retest_all_disconnected',
  'retry_pending_tenant_smtp_fix',
  'resume_avatar_sync_job',
  'resume_stuck_avatar_sync_jobs',
]);

// ── Main Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { action } = body;

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    // bulk_repair_smtp_auth without an organization_id sweeps every org.
    if (SERVICE_ROLE_ONLY_ACTIONS.has(action) || (action === 'bulk_repair_smtp_auth' && !body.organization_id)) {
      if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
    } else {
      try {
        await assertOrgAccess(req, supabase, body.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
    }

    // ── create ────────────────────────────────────────────────────────
    if (action === 'create') {
      const { organization_id, domain_id, username, display_name, avatar_url } = body;
      if (!organization_id || !domain_id || !username || !display_name) {
        return jsonResponse({ error: 'Missing required fields: organization_id, domain_id, username, display_name' }, 400);
      }
      try {
        const mailbox = await createOneMailbox(supabase, { organization_id, domain_id, username, display_name, avatar_url });
        return jsonResponse({
          success: true,
          mailbox: {
            id: mailbox.id,
            email_address: mailbox.email_address,
            display_name: mailbox.display_name,
            status: mailbox.status,
            avatar_url: (mailbox.metadata as Record<string, unknown>)?.avatar_url,
          },
        });
      } catch (err) {
        const message = err instanceof M365Error ? `[${err.code}] ${err.message}` : (err instanceof Error ? err.message : 'Create failed');
        console.error(`[Infra Mailbox] Create failed for ${username}:`, message);
        return jsonResponse({ error: message }, 500);
      }
    }

    // ── bulk_create ───────────────────────────────────────────────────
    if (action === 'bulk_create') {
      const { organization_id, domain_id, mailboxes } = body;
      if (!organization_id || !domain_id || !Array.isArray(mailboxes) || mailboxes.length === 0) {
        return jsonResponse({ error: 'Missing required fields: organization_id, domain_id, mailboxes[]' }, 400);
      }

      const created: unknown[] = [];
      const errors: Array<{ username: string; error: string }> = [];

      for (let i = 0; i < mailboxes.length; i++) {
        const mb = mailboxes[i];
        try {
          const mailbox = await createOneMailbox(supabase, {
            organization_id, domain_id,
            username: mb.username,
            display_name: mb.display_name,
            avatar_url: mb.avatar_url,
          });
          created.push(mailbox);
        } catch (err) {
          const message = err instanceof M365Error ? `[${err.code}] ${err.message}` : (err instanceof Error ? err.message : 'Create failed');
          errors.push({ username: mb.username, error: message });
        }
        if (i < mailboxes.length - 1) await new Promise(r => setTimeout(r, 500));
      }

      return jsonResponse({ created, errors });
    }

    // ── bulk_create_async ─────────────────────────────────────────────
    // Creates a mailbox_provisioning_jobs row and kicks off background
    // processing. Returns immediately with the job id so the frontend
    // can poll for progress. Page-close survives.
    if (action === 'bulk_create_async') {
      const { organization_id, domain_id, mailboxes, generate_avatars } = body;
      if (!organization_id || !domain_id || !Array.isArray(mailboxes) || mailboxes.length === 0) {
        return jsonResponse({ error: 'Missing required fields: organization_id, domain_id, mailboxes[]' }, 400);
      }

      const { data: job, error: insertErr } = await supabase
        .from('mailbox_provisioning_jobs')
        .insert({
          organization_id,
          domain_id,
          status: 'pending',
          total: mailboxes.length,
          mailboxes,
          generate_avatars: generate_avatars === true,
        })
        .select('id')
        .single();

      if (insertErr || !job) {
        return jsonResponse({ error: `Failed to create job: ${insertErr?.message}` }, 500);
      }

      // Fire-and-forget the first chunk. Response returns immediately.
      const work = processJobChunk(supabase, job.id).catch((err) => {
        console.error(`[Infra Mailbox] bulk_create_async initial chunk failed for job ${job.id}:`, err);
      });
      try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* not available locally */ }

      return jsonResponse({ success: true, job_id: job.id });
    }

    // ── resume_job ────────────────────────────────────────────────────
    // Continuation handler — called by selfInvokeResume after each chunk
    // and by the stuck-job cron. Processes one chunk and either completes
    // or re-invokes itself.
    if (action === 'resume_job') {
      const { job_id } = body;
      if (!job_id) return jsonResponse({ error: 'job_id is required' }, 400);

      const work = processJobChunk(supabase, job_id).catch((err) => {
        console.error(`[Infra Mailbox] resume_job chunk failed for ${job_id}:`, err);
      });
      try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* ignore */ }

      return jsonResponse({ success: true, job_id });
    }

    // ── resume_stuck_jobs ─────────────────────────────────────────────
    // Safety-net called by pg_cron every 5 min. Finds running jobs whose
    // last heartbeat is older than the threshold (worker crashed mid-chunk)
    // and relaunches them.
    if (action === 'resume_stuck_jobs') {
      const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS).toISOString();
      const { data: stuck, error: queryErr } = await supabase
        .from('mailbox_provisioning_jobs')
        .select('id')
        .eq('status', 'running')
        .lt('heartbeat_at', cutoff)
        .limit(20);

      if (queryErr) {
        return jsonResponse({ error: `Failed to query stuck jobs: ${queryErr.message}` }, 500);
      }

      const stuckIds = (stuck ?? []).map((r) => r.id as string);
      console.log(`[Infra Mailbox] resume_stuck_jobs found ${stuckIds.length} stuck job(s)`);

      for (const id of stuckIds) {
        const work = processJobChunk(supabase, id).catch((err) => {
          console.error(`[Infra Mailbox] resume_stuck_jobs chunk failed for ${id}:`, err);
        });
        try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* ignore */ }
      }

      return jsonResponse({ success: true, resumed: stuckIds.length });
    }

    // ── delete ────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      const metadata = (mailbox.metadata || {}) as Record<string, unknown>;

      if (mailbox.sending_domain_id) {
        try {
          const { data: domain } = await supabase
            .from('email_sending_domains')
            .select('m365_tenant_id, domain')
            .eq('id', mailbox.sending_domain_id)
            .single();

          if (domain?.m365_tenant_id) {
            const { data: tenant } = await supabase
              .from('m365_tenants')
              .select('tenant_id')
              .eq('id', domain.m365_tenant_id)
              .single();

            if (tenant?.tenant_id) {
              // Delete the underlying Entra user — that removes the mailbox
              // (Shared or Regular) in one shot. The EXO /Mailbox DELETE
              // endpoint returns "Delete not supported" for live user-backed
              // mailboxes, so we go through Graph.
              const graphToken = await getM365Token(tenant.tenant_id);
              const userEmail = mailbox.email_address;
              try {
                const userId = await resolveUserIdByEmail(graphToken, userEmail);
                await deleteM365User(graphToken, userId);
              } catch (e) {
                console.warn(`[Infra Mailbox] Could not delete M365 user ${userEmail} (non-fatal):`, e instanceof Error ? e.message : e);
              }
            }
          }
        } catch (e) {
          console.warn('[Infra Mailbox] Error during M365 user deletion (non-fatal):', e instanceof Error ? e.message : e);
        }
      }

      await supabase.from('email_mailboxes').delete().eq('id', mailbox_id);

      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('mailbox_count')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain) {
          await supabase
            .from('email_sending_domains')
            .update({ mailbox_count: Math.max(0, (domain.mailbox_count || 1) - 1) })
            .eq('id', mailbox.sending_domain_id);
        }
      }

      return jsonResponse({ success: true });
    }

    // ── list ──────────────────────────────────────────────────────────
    if (action === 'list') {
      const { domain_id, organization_id } = body;
      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }
      const { data: mailboxes, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*')
        .eq('sending_domain_id', domain_id)
        .eq('organization_id', organization_id)
        .order('created_at', { ascending: true });

      if (fetchError) return jsonResponse({ error: `Failed to list mailboxes: ${fetchError.message}` }, 500);
      return jsonResponse({ success: true, mailboxes: mailboxes || [] });
    }

    // ── update ────────────────────────────────────────────────────────
    // Patches metadata fields on an existing mailbox (avatar_url, display_name, daily_limit)
    if (action === 'update') {
      const { mailbox_id, organization_id, avatar_url, display_name, daily_limit } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, display_name, metadata')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      const updateObj: Record<string, unknown> = {};
      // Collected metadata keys are written via merge_mailbox_metadata after the
      // column update — read-modify-write here would race with concurrent writers
      // (repair, heal, IMAP poller) and clobber smtp_credentials. See cd7f9b5c.
      const metadataPatch: Record<string, unknown> = {};

      if (avatar_url !== undefined) {
        const existingMetadata = (mailbox.metadata || {}) as Record<string, unknown>;
        metadataPatch.avatar_url = avatar_url;

        // A signature bakes the avatar as a static <img src>, not a live reference —
        // if we only update avatar_url here, the signature keeps pointing at the old
        // image (which a later avatar swap/cleanup can delete, breaking it in every
        // reply sent from this mailbox). Keep them in sync.
        const existingSignature = existingMetadata.signature as string | undefined;
        if (existingSignature && /<img\b[^>]*\bsrc=/i.test(existingSignature)) {
          metadataPatch.signature = existingSignature.replace(
            /(<img\b[^>]*\bsrc=")[^"]*(")/i,
            `$1${avatar_url.replace(/&/g, '&amp;')}$2`,
          );
        }

        // Sync avatar to M365 if domain setting enabled
        const m365UserId = existingMetadata.m365_user_id as string | undefined;
        if (m365UserId && avatar_url) {
          try {
            const { data: mbDomain } = await supabase
              .from('email_mailboxes')
              .select('sending_domain_id')
              .eq('id', mailbox_id)
              .single();
            if (mbDomain?.sending_domain_id) {
              const { data: domain } = await supabase
                .from('email_sending_domains')
                .select('sync_avatars_to_m365, m365_tenant_id')
                .eq('id', mbDomain.sending_domain_id)
                .single();
              if (domain?.sync_avatars_to_m365 && domain.m365_tenant_id) {
                const { data: tenant } = await supabase
                  .from('m365_tenants')
                  .select('tenant_id')
                  .eq('id', domain.m365_tenant_id)
                  .single();
                if (tenant?.tenant_id) {
                  const graphToken = await getM365Token(tenant.tenant_id);
                  await setUserProfilePhoto(graphToken, m365UserId, avatar_url);
                  console.log(`[Infra Mailbox] Profile photo synced to M365 for ${mailbox.email_address}`);
                }
              }
            }
          } catch (e) {
            console.warn(`[Infra Mailbox] Profile photo sync on update failed (non-fatal): ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      if (display_name !== undefined) {
        updateObj.display_name = display_name;
      }
      if (daily_limit !== undefined) {
        updateObj.daily_limit = daily_limit;
      }

      if (Object.keys(updateObj).length === 0 && Object.keys(metadataPatch).length === 0) {
        return jsonResponse({ error: 'No fields to update' }, 400);
      }

      if (Object.keys(metadataPatch).length > 0) {
        const { error: mergeErr } = await supabase.rpc('merge_mailbox_metadata', {
          p_id: mailbox_id,
          p_merge: metadataPatch,
        });
        if (mergeErr) return jsonResponse({ error: `Metadata merge failed: ${mergeErr.message}` }, 500);
      }

      let updated: unknown = null;
      if (Object.keys(updateObj).length > 0) {
        const { data, error: updateError } = await supabase
          .from('email_mailboxes')
          .update(updateObj)
          .eq('id', mailbox_id)
          .select('id, email_address, display_name, metadata')
          .single();
        if (updateError) return jsonResponse({ error: `Update failed: ${updateError.message}` }, 500);
        updated = data;
      } else {
        const { data } = await supabase
          .from('email_mailboxes')
          .select('id, email_address, display_name, metadata')
          .eq('id', mailbox_id)
          .single();
        updated = data;
      }

      return jsonResponse({ success: true, mailbox: updated });
    }

    // ── convert_to_user ───────────────────────────────────────────────
    // One-time: converts shared mailboxes back to regular user type so they
    // can authenticate directly with username+password for warmup tools.
    if (action === 'convert_to_user') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      let exoToken: string | null = null;
      let tenantId: string | null = null;
      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('m365_tenant_id')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain?.m365_tenant_id) {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('tenant_id')
            .eq('id', domain.m365_tenant_id)
            .single();
          if (tenant?.tenant_id) {
            tenantId = tenant.tenant_id;
            exoToken = await getEXOToken(tenant.tenant_id);
          }
        }
      }

      if (!exoToken || !tenantId) {
        return jsonResponse({ error: 'Could not resolve EXO token' }, 400);
      }

      // Convert back to regular user mailbox so SMTP AUTH works with direct credentials
      const exoBase = `https://outlook.office365.com/adminapi/beta/${tenantId}/`;
      const patchRes = await fetch(`${exoBase}Mailbox('${encodeURIComponent(mailbox.email_address)}')`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Type: 'Regular' }),
      });
      const patchText = await patchRes.text();
      console.log(`[convert_to_user] PATCH Type=Regular for ${mailbox.email_address}: ${patchRes.status} ${patchText}`);

      return jsonResponse({ success: patchRes.ok, status: patchRes.status, body: patchText });
    }

    // ── repair ────────────────────────────────────────────────────────
    // Normal UI recovery: M365 checks Graph; legacy repair below handles SMTP.
    if (action === 'repair') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      // The UI's "Repair connection" action is also the normal recovery click.
      // Verify M365's actual transport without resetting a healthy Graph sender's
      // password. Explicit SMTP credential repair has its own repair_credentials action.
      if (mailbox.connection_type === 'm365') {
        const { graph, status } = await retestGraphMailbox(supabase, mailbox);
        return jsonResponse({
          success: graph.success,
          error: graph.error,
          graph,
          smtp: { success: false, skipped: true, note: 'M365 uses Graph; SMTP is fallback only' },
          imap: { success: graph.success, note: 'M365 uses Graph API polling, not IMAP' },
          status,
        });
      }

      // Get tenant info
      let exoToken: string | null = null;
      let tenantId: string | null = null;
      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('m365_tenant_id')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain?.m365_tenant_id) {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('tenant_id')
            .eq('id', domain.m365_tenant_id)
            .single();
          if (tenant?.tenant_id) {
            tenantId = tenant.tenant_id;
            exoToken = await getEXOToken(tenant.tenant_id);
          }
        }
      }

      if (!exoToken || !tenantId) {
        return jsonResponse({ error: 'Could not resolve EXO token for this mailbox' }, 400);
      }

      const graphToken = await getM365Token(tenantId);

      // Resolve user with replication-lag retry (M365 user takes a few seconds
      // to appear on Graph reads after creation)
      const resolveWithRetry = async (): Promise<string | null> => {
        const delaysMs = [2_000, 5_000, 10_000];
        for (let i = 0; i <= delaysMs.length; i++) {
          try {
            return await resolveUserIdByEmail(graphToken, mailbox.email_address);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const isNotFound = msg.includes('does not exist') || msg.includes('Request_ResourceNotFound');
            if (!isNotFound || i === delaysMs.length) return null;
            await new Promise((r) => setTimeout(r, delaysMs[i]));
          }
        }
        return null;
      };
      const userId = await resolveWithRetry();

      // Re-apply SMTP AUTH + IMAP via CASMailbox (noRetry=true — mailbox already exists)
      await enableSmtpAuth(graphToken, userId || '', exoToken, tenantId, mailbox.email_address, true);

      // Reset the password via Graph and re-store credentials.
      // Exchange Online IMAP requires the mailbox's actual AD password — the stored one
      // may have become stale after a Type conversion or tenant policy change.
      // Retry on "Insufficient privileges" — User Administrator role propagation
      // can take 5-15 min after assignment.
      const newPassword = generateMailboxPassword();
      let passwordReset = false;
      if (userId) {
        const pwDelays = [3_000, 10_000, 30_000];
        for (let i = 0; i <= pwDelays.length; i++) {
          try {
            await resetMailboxPassword(graphToken, userId, newPassword);
            passwordReset = true;
            console.log(`[Infra Mailbox] Password reset for ${mailbox.email_address}`);
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const isPrivErr = msg.includes('Insufficient privileges') || msg.includes('Authorization_RequestDenied');
            if (!isPrivErr || i === pwDelays.length) {
              console.warn(`[Infra Mailbox] Password reset failed (non-fatal): ${msg}`);
              break;
            }
            console.warn(`[Infra Mailbox] Password reset privilege error for ${mailbox.email_address} (attempt ${i + 1}), waiting ${pwDelays[i]}ms`);
            await new Promise((r) => setTimeout(r, pwDelays[i]));
          }
        }
      }

      // Build fresh credentials using the new password (if reset succeeded) or existing creds
      let creds = await extractSMTPCredentials(mailbox.metadata || {});
      if (!creds) return jsonResponse({ error: 'No SMTP credentials found' }, 400);

      if (passwordReset) {
        creds = {
          smtp_host: 'smtp.office365.com',
          smtp_port: 587,
          smtp_username: mailbox.email_address,
          smtp_password: newPassword,
          imap_host: 'outlook.office365.com',
          imap_port: 993,
          imap_username: mailbox.email_address,
          imap_password: newPassword,
        };
        const encrypted = await encryptCredentials(creds);
        // Atomic merge — read-modify-write here would race with concurrent
        // writers (cron auto-retest, manual repair clicks) and clobber the
        // freshly-set credentials. See cd7f9b5c for the analogous heal fix.
        const { error: mergeErr } = await supabase.rpc('merge_mailbox_smtp_credentials', {
          p_id: mailbox_id,
          p_encrypted: encrypted,
        });
        if (mergeErr) {
          return jsonResponse({ error: `Failed to persist new credentials: ${mergeErr.message}` }, 500);
        }
      }

      // Wait 3s for password propagation before testing
      if (passwordReset) await new Promise(r => setTimeout(r, 3000));

      // M365 mailboxes: inbound polling uses Graph API, not IMAP.
      // imap_connected=true means "eligible for Graph API polling".
      // Retry the SMTP test a few times — Microsoft can take 10-30s after a
      // password reset before SMTP front-ends accept the new credentials.
      let smtpResult: { success: boolean; error?: string } = { success: false };
      const smtpDelays = [0, 5_000, 15_000, 30_000];
      for (let i = 0; i < smtpDelays.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, smtpDelays[i]));
        smtpResult = await testSMTPConnection(creds);
        if (smtpResult.success) break;
      }
      const imapResult = { success: true, note: 'm365 uses Graph API polling, not IMAP' };

      const newStatus = smtpResult.success
        ? (mailbox.status === 'warming' ? 'warming' : 'ready')
        : 'disconnected';
      await supabase
        .from('email_mailboxes')
        .update({
          imap_connected: smtpResult.success, // true = eligible for Graph polling
          status: newStatus,
          last_error: !smtpResult.success
            ? `SMTP: ${smtpResult.error || 'failed'}`
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mailbox_id);

      return jsonResponse({ success: true, smtp: smtpResult, imap: imapResult });
    }

    // ── bulk_repair_smtp_auth ─────────────────────────────────────────
    // Repair every non-ready m365 mailbox in one call: fix tenant-level SMTP
    // AUTH once per tenant, then re-apply CASMailbox + reset password + retest
    // each mailbox. Use this when many mailboxes are failing with 504 5.7.4
    // (Unrecognized authentication type) because SMTP AUTH was never enabled.
    //
    // Body params (all optional):
    //   organization_id  — restrict to one org (recommended)
    //   tenant_id        — restrict to one m365 tenant (m365_tenants.id)
    //   statuses         — string[] of statuses to target (default: ['disconnected','pending','warming'])
    //   limit            — max mailboxes to process (default: 200)
    if (action === 'bulk_repair_smtp_auth') {
      const {
        organization_id,
        tenant_id,
        statuses,
        limit = 200,
      } = body as {
        organization_id?: string;
        tenant_id?: string;
        statuses?: string[];
        limit?: number;
      };

      const targetStatuses = statuses && statuses.length > 0
        ? statuses
        : ['disconnected', 'pending', 'warming'];

      // Build query. We need sending_domain_id + the m365_tenant_id it points to,
      // so we fetch domains in a second step (Supabase PostgREST join requires
      // the FK relationship to be named explicitly and we want to stay simple).
      let query = supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, metadata, status, sending_domain_id')
        .eq('connection_type', 'm365')
        .in('status', targetStatuses)
        .order('updated_at', { ascending: true })
        .limit(limit);

      if (organization_id) query = query.eq('organization_id', organization_id);

      const { data: mailboxes, error: fetchErr } = await query;
      if (fetchErr) return jsonResponse({ error: `Failed to fetch mailboxes: ${fetchErr.message}` }, 500);
      if (!mailboxes || mailboxes.length === 0) {
        return jsonResponse({ success: true, total: 0, repaired: 0, failed: 0, tenants: [], mailboxes: [] });
      }

      // Resolve each mailbox → m365 tenant via its sending domain.
      const domainIds = Array.from(new Set(mailboxes.map((m) => m.sending_domain_id).filter(Boolean))) as string[];
      const { data: domains } = await supabase
        .from('email_sending_domains')
        .select('id, m365_tenant_id')
        .in('id', domainIds);
      const domainToTenant = new Map<string, string>();
      for (const d of domains || []) {
        if (d.m365_tenant_id) domainToTenant.set(d.id, d.m365_tenant_id);
      }

      const tenantRowIds = Array.from(new Set(Array.from(domainToTenant.values())));
      const filteredTenantRowIds = tenant_id ? tenantRowIds.filter((id) => id === tenant_id) : tenantRowIds;

      const { data: tenantRows } = await supabase
        .from('m365_tenants')
        .select('id, tenant_id, onmicrosoft_domain')
        .in('id', filteredTenantRowIds);
      const tenantMap = new Map<string, { tenantId: string; onmicrosoftDomain: string | null }>();
      for (const t of tenantRows || []) {
        tenantMap.set(t.id, { tenantId: t.tenant_id, onmicrosoftDomain: t.onmicrosoft_domain });
      }

      // Phase 1: fix tenant-level SMTP AUTH once per tenant.
      const tenantResults: Array<{ tenant_row_id: string; tenant_id: string; ok: boolean; error?: string; nowEnabled?: boolean }> = [];
      const tenantTokens = new Map<string, string>();
      for (const rowId of Array.from(tenantMap.keys())) {
        const info = tenantMap.get(rowId)!;
        try {
          const exoToken = await getEXOToken(info.tenantId);
          tenantTokens.set(rowId, exoToken);
          const result = await ensureTenantSmtpAuthEnabled(exoToken, info.tenantId, info.onmicrosoftDomain || '');
          tenantResults.push({ tenant_row_id: rowId, tenant_id: info.tenantId, ok: true, nowEnabled: result.nowEnabled });
          console.log(`[Bulk Repair] Tenant ${info.tenantId} SMTP AUTH ensured (nowEnabled=${result.nowEnabled})`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          tenantResults.push({ tenant_row_id: rowId, tenant_id: info.tenantId, ok: false, error: msg });
          console.warn(`[Bulk Repair] Tenant ${info.tenantId} SMTP AUTH enable failed: ${msg}`);
        }
      }

      // Phase 2: repair each mailbox (skip if its tenant token couldn't be obtained
      // or if a tenant filter was passed and this mailbox is in a different tenant).
      const mailboxResults: Array<{ id: string; email: string; success: boolean; error?: string }> = [];
      let repaired = 0;
      let failed = 0;
      for (const mb of mailboxes) {
        const tenantRowId = mb.sending_domain_id ? domainToTenant.get(mb.sending_domain_id) : undefined;
        if (!tenantRowId || !tenantMap.has(tenantRowId)) {
          mailboxResults.push({ id: mb.id, email: mb.email_address, success: false, error: 'Could not resolve m365 tenant for mailbox' });
          failed++;
          continue;
        }
        if (tenant_id && tenantRowId !== tenant_id) continue;

        const exoToken = tenantTokens.get(tenantRowId);
        if (!exoToken) {
          mailboxResults.push({ id: mb.id, email: mb.email_address, success: false, error: 'EXO token unavailable for tenant' });
          failed++;
          continue;
        }

        const info = tenantMap.get(tenantRowId)!;
        const result = await repairOneMailbox(supabase, mb, info.tenantId, exoToken);
        mailboxResults.push({ id: mb.id, email: result.email, success: result.success, error: result.error });
        if (result.success) repaired++;
        else failed++;

        // Small throttle — avoid hammering EXO Admin REST
        await new Promise((r) => setTimeout(r, 250));
      }

      return jsonResponse({
        success: true,
        total: mailboxResults.length,
        repaired,
        failed,
        tenants: tenantResults,
        mailboxes: mailboxResults,
      });
    }

    // ── retest ────────────────────────────────────────────────────────
    if (action === 'retest') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      // M365 sends through app-only Graph. A stale SMTP password is fallback
      // health, not a reason to disconnect or reset credentials on this path.
      if (mailbox.connection_type === 'm365') {
        const { graph, status } = await retestGraphMailbox(supabase, mailbox);
        return jsonResponse({
          success: graph.success,
          error: graph.error,
          graph,
          smtp: { success: false, skipped: true, note: 'M365 uses Graph; SMTP is fallback only' },
          imap: { success: graph.success, note: 'M365 uses Graph API polling, not IMAP' },
          status,
        });
      }

      const creds = await extractSMTPCredentials(mailbox.metadata || {});
      if (!creds) return jsonResponse({ error: 'No SMTP credentials found for this mailbox' }, 400);

      // M365 mailboxes: SMTP test only — inbound uses Graph API polling, not IMAP
      const isM365 = mailbox.connection_type === 'm365';
      let smtpResult = await testSMTPConnection(creds);

      // Self-heal: if SMTP fails with 5.7.139 (Security Defaults blocking), attempt
      // to disable Security Defaults and re-enable tenant SMTP AUTH before giving up.
      if (!smtpResult.success && isM365 && (smtpResult.error || '').includes('5.7.139')) {
        try {
          const { data: domain } = await supabase
            .from('email_sending_domains')
            .select('m365_tenant_id')
            .eq('id', mailbox.sending_domain_id)
            .single();
          if (domain?.m365_tenant_id) {
            const { data: tenant } = await supabase
              .from('m365_tenants')
              .select('tenant_id, onmicrosoft_domain')
              .eq('id', domain.m365_tenant_id)
              .single();
            if (tenant) {
              const graphToken = await getM365Token(tenant.tenant_id);
              await ensureSecurityDefaultsDisabled(graphToken);
              const exoToken = await getEXOToken(tenant.tenant_id);
              await ensureTenantSmtpAuthEnabled(exoToken, tenant.tenant_id, tenant.onmicrosoft_domain);
              console.log(`[Infra Mailbox] Self-healed Security Defaults / SMTP AUTH for tenant ${tenant.tenant_id}, retesting...`);
              // Wait briefly for propagation then retest
              await new Promise(r => setTimeout(r, 2000));
              smtpResult = await testSMTPConnection(creds);
            }
          }
        } catch (healErr) {
          console.warn(`[Infra Mailbox] Self-heal attempt failed for ${mailbox_id}: ${(healErr as Error).message}`);
        }
      }

      // Self-heal: if SMTP still fails with a generic 535 on a SHARED M365 mailbox we own,
      // the most common cause is that Microsoft flipped accountEnabled back to false on the
      // shared user (it does this periodically as a "security hygiene" sweep) or that the
      // per-user SmtpClientAuthenticationDisabled override drifted. Both are recoverable by
      // re-running our provision-time recipe: fresh password + accountEnabled:true via Graph,
      // plus enableSmtpAuth via EXO. Skip when:
      //   - not M365, or
      //   - not a shared mailbox (BYO user mailboxes — we don't own their password), or
      //   - we don't have m365_user_id metadata (legacy rows we can't safely reset).
      const meta = (mailbox.metadata || {}) as Record<string, unknown>;
      const isSharedOwned =
        meta.m365_mailbox_type === 'shared' && typeof meta.m365_user_id === 'string' && (meta.m365_user_id as string).length > 0;
      const looksLikeAuthError =
        /\b535\b/.test(smtpResult.error || '') ||
        /authentication unsuccessful|authentication failed|invalid login|bad credentials/i.test(smtpResult.error || '');

      if (!smtpResult.success && isM365 && isSharedOwned && looksLikeAuthError) {
        try {
          const { data: domain } = await supabase
            .from('email_sending_domains')
            .select('m365_tenant_id')
            .eq('id', mailbox.sending_domain_id)
            .single();
          if (domain?.m365_tenant_id) {
            const { data: tenant } = await supabase
              .from('m365_tenants')
              .select('tenant_id, onmicrosoft_domain')
              .eq('id', domain.m365_tenant_id)
              .single();
            if (tenant) {
              const graphToken = await getM365Token(tenant.tenant_id);
              const exoToken = await getEXOToken(tenant.tenant_id);
              const newPassword = generateMailboxPassword();
              const userId = meta.m365_user_id as string;
              await resetMailboxPassword(graphToken, userId, newPassword);
              try {
                await enableSmtpAuth(graphToken, userId, exoToken, tenant.tenant_id, mailbox.email_address, true);
              } catch (eAuth) {
                // enableSmtpAuth occasionally races EXO replication on freshly-touched users.
                // Don't abort — the next retest pass will pick it up.
                console.warn(`[Infra Mailbox] enableSmtpAuth during self-heal failed (non-fatal): ${(eAuth as Error).message}`);
              }
              // Persist the new password so future sends use it. Encrypt the same shape we
              // wrote at provision time so extractSMTPCredentials keeps working.
              const newCreds = {
                smtp_host: 'smtp.office365.com',
                smtp_port: 587,
                smtp_username: mailbox.email_address,
                smtp_password: newPassword,
                imap_host: 'outlook.office365.com',
                imap_port: 993,
                imap_username: mailbox.email_address,
                imap_password: newPassword,
              };
              const encrypted = await encryptCredentials(newCreds);
              await supabase
                .from('email_mailboxes')
                .update({
                  metadata: {
                    ...(meta as Record<string, unknown>),
                    smtp_credentials: encrypted,
                  },
                  updated_at: new Date().toISOString(),
                })
                .eq('id', mailbox_id);
              // Wait for EXO/Graph propagation. Per-user SMTP auth toggles take ~5-30s.
              await new Promise((r) => setTimeout(r, 5000));
              console.log(`[Infra Mailbox] Self-healed shared-mailbox auth for ${mailbox.email_address}, retesting with new password...`);
              smtpResult = await testSMTPConnection(newCreds);
            }
          }
        } catch (healErr) {
          console.warn(`[Infra Mailbox] Shared-mailbox auth self-heal failed for ${mailbox_id}: ${(healErr as Error).message}`);
        }
      }

      const imapResult = isM365
        ? { success: true, note: 'm365 uses Graph API polling, not IMAP' }
        : await testIMAPConnection(creds);

      const newStatus = smtpResult.success && imapResult.success
        ? (mailbox.status === 'warming' ? 'warming' : 'ready')
        : 'disconnected';
      // Build actionable error message
      let lastError: string | null = null;
      if (!smtpResult.success) {
        const rawErr = smtpResult.error || 'failed';
        if (rawErr.includes('5.7.139') || rawErr.includes('security defaults')) {
          lastError = 'Security Defaults is blocking SMTP. Disable it in Entra ID > Overview > Properties > Manage security defaults > set to Disabled > Save.';
        } else {
          lastError = `SMTP: ${rawErr}`;
        }
      } else if (!imapResult.success) {
        lastError = `IMAP: ${(imapResult as { error?: string }).error || 'failed'}`;
      }
      await supabase
        .from('email_mailboxes')
        .update({
          imap_connected: smtpResult.success, // for m365: true = in Graph polling pool
          status: newStatus,
          last_error: lastError,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mailbox_id);

      return jsonResponse({ success: true, smtp: smtpResult, imap: imapResult });
    }

    // ── repair_credentials (explicit SMTP credential repair) ──────────
    // Separate from normal Graph connection recovery: intentionally regenerates
    // the per-mailbox password used by the SMTP fallback.
    if (action === 'repair_credentials') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();
      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);
      if (mailbox.connection_type !== 'm365') {
        return jsonResponse({ error: 'repair_credentials only supports m365 mailboxes' }, 400);
      }

      // Resolve domain → tenant
      const { data: domain, error: domainErr } = await supabase
        .from('email_sending_domains')
        .select('*')
        .eq('id', mailbox.sending_domain_id)
        .single();
      if (domainErr || !domain) return jsonResponse({ error: 'Sending domain not found' }, 404);

      const { data: tenant, error: tenantErr } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', domain.m365_tenant_id)
        .single();
      if (tenantErr || !tenant) return jsonResponse({ error: 'M365 tenant not found' }, 404);

      const sharedEmail = mailbox.email_address as string;
      const adminEmail = tenant.admin_email as string;

      try {
        const [graphToken, exoToken] = await Promise.all([
          getM365Token(tenant.tenant_id),
          getEXOToken(tenant.tenant_id),
        ]);

        // Find the user — accept replication lag, retry briefly
        const resolveWithRetry = async (): Promise<string> => {
          const delaysMs = [2_000, 5_000, 10_000];
          let lastErr: unknown;
          for (let i = 0; i <= delaysMs.length; i++) {
            try {
              return await resolveUserIdByEmail(graphToken, sharedEmail);
            } catch (e) {
              lastErr = e;
              const msg = e instanceof Error ? e.message : String(e);
              const isNotFound = msg.includes('does not exist') || msg.includes('Request_ResourceNotFound');
              if (!isNotFound || i === delaysMs.length) throw e;
              await new Promise((r) => setTimeout(r, delaysMs[i]));
            }
          }
          throw lastErr;
        };

        const userId = await resolveWithRetry();

        // Generate new password and reset it (with privilege-error retry for
        // role propagation lag, same as createOneMailbox).
        const newPassword = generateMailboxPassword();
        const pwDelays = [3_000, 10_000, 30_000];
        let pwSet = false;
        for (let i = 0; i <= pwDelays.length; i++) {
          try {
            await resetMailboxPassword(graphToken, userId, newPassword);
            pwSet = true;
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            const isPrivErr = msg.includes('Insufficient privileges') || msg.includes('Authorization_RequestDenied');
            if (!isPrivErr || i === pwDelays.length) throw e;
            console.warn(`[Infra Mailbox] Password reset privilege error for ${sharedEmail} (attempt ${i + 1}), waiting ${pwDelays[i]}ms`);
            await new Promise((r) => setTimeout(r, pwDelays[i]));
          }
        }
        if (!pwSet) throw new Error('Could not reset mailbox password');

        // Re-enable SMTP AUTH on the mailbox (in case it got disabled).
        try {
          await enableSmtpAuth(graphToken, userId, exoToken, tenant.tenant_id, sharedEmail);
        } catch (e) {
          console.warn(`[Infra Mailbox] enableSmtpAuth failed during repair (non-fatal): ${e instanceof Error ? e.message : e}`);
        }

        // Re-encrypt and store fresh credentials
        const encrypted = await encryptCredentials({
          smtp_host: 'smtp.office365.com',
          smtp_port: 587,
          smtp_username: sharedEmail,
          smtp_password: newPassword,
          imap_host: 'outlook.office365.com',
          imap_port: 993,
          imap_username: sharedEmail,
          imap_password: newPassword,
        });

        const updatedMetadata = {
          ...((mailbox.metadata as Record<string, unknown>) || {}),
          smtp_credentials: encrypted,
          smtp_host: 'smtp.office365.com',
          smtp_port: 587,
          smtp_from: sharedEmail,
          imap_host: 'outlook.office365.com',
          imap_port: 993,
          m365_user_id: userId,
          m365_mailbox_type: 'shared',
          m365_admin_email: adminEmail,
        };

        // SMTP connectivity test (single attempt — caller can retest later)
        const creds = await extractSMTPCredentials(updatedMetadata);
        const smtpResult = creds ? await testSMTPConnection(creds) : { success: false, error: 'No credentials' };
        const newStatus = smtpResult.success
          ? (mailbox.status === 'warming' ? 'warming' : 'ready')
          : 'disconnected';

        await supabase
          .from('email_mailboxes')
          .update({
            metadata: updatedMetadata,
            status: newStatus,
            imap_connected: smtpResult.success,
            last_error: smtpResult.success ? null : `SMTP: ${smtpResult.error || 'failed'}`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', mailbox_id);

        console.log(`[Infra Mailbox] Repaired credentials for ${sharedEmail} (smtp test: ${smtpResult.success ? 'pass' : 'fail'})`);
        return jsonResponse({
          success: true,
          status: newStatus,
          smtp_test: smtpResult,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Infra Mailbox] Repair failed for ${sharedEmail}: ${msg}`);
        return jsonResponse({ error: msg }, 500);
      }
    }

    // ── retry_pending_tenant_smtp_fix ─────────────────────────────────
    // Cron-invoked: find m365_tenants flagged with pending_tenant_smtp_fix=true
    // and try to enable tenant-level SMTP AUTH via Set-TransportConfig.
    // EXO caches role membership for 5-30 min after a directory role is
    // assigned, so the connect-time attempt usually returns 403. This cron
    // retries every 5 min until the role propagates and the call succeeds,
    // then clears the flag.
    if (action === 'retry_pending_tenant_smtp_fix') {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      const { data: tenants, error: fetchErr } = await supabaseClient
        .from('m365_tenants')
        .select('id, tenant_id, onmicrosoft_domain, prerequisites_status')
        .eq('pending_tenant_smtp_fix', true)
        .eq('status', 'connected')
        .limit(20);

      if (fetchErr) {
        return jsonResponse({ error: `Failed to fetch pending tenants: ${fetchErr.message}` }, 500);
      }
      if (!tenants || tenants.length === 0) {
        return jsonResponse({ success: true, checked: 0, fixed: 0, still_pending: 0 });
      }

      // Lazy import to avoid forcing this on every cold start
      const { getEXOToken, ensureTenantSmtpAuthEnabled } = await import('../_shared/m365-client.ts');

      let fixed = 0;
      let stillPending = 0;
      for (const t of tenants) {
        const now = new Date().toISOString();
        const currentChecks = (t.prerequisites_status || {}) as Record<string, unknown>;

        // Proof-by-existence: if any mailbox under this tenant is currently
        // `ready`, SMTP AUTH is provably working — clear the pending flag.
        const { count: readyCount } = await supabaseClient
          .from('email_mailboxes')
          .select('id, sending_domain_id, email_sending_domains!inner(m365_tenant_id)', { count: 'exact', head: true })
          .eq('status', 'ready')
          .eq('email_sending_domains.m365_tenant_id', t.id);

        if (readyCount && readyCount > 0) {
          await supabaseClient
            .from('m365_tenants')
            .update({
              pending_tenant_smtp_fix: false,
              prerequisites_status: {
                ...currentChecks,
                smtp_auth: { ok: true, status: 'ok', checked_at: now },
              },
            })
            .eq('id', t.id);
          fixed++;
          console.log(`[Infra Mailbox] Tenant SMTP AUTH proven-working for ${t.tenant_id} via ready mailboxes`);
          continue;
        }

        try {
          const exoToken = await getEXOToken(t.tenant_id);
          const result = await ensureTenantSmtpAuthEnabled(exoToken, t.tenant_id, t.onmicrosoft_domain);
          if (result.nowEnabled) {
            await supabaseClient
              .from('m365_tenants')
              .update({
                pending_tenant_smtp_fix: false,
                prerequisites_status: {
                  ...currentChecks,
                  smtp_auth: { ok: true, status: 'ok', checked_at: now },
                },
              })
              .eq('id', t.id);
            fixed++;
            console.log(`[Infra Mailbox] Tenant SMTP AUTH fixed for ${t.tenant_id}`);
          } else {
            stillPending++;
          }
        } catch (err) {
          stillPending++;
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Infra Mailbox] Tenant SMTP AUTH retry failed for ${t.tenant_id}: ${msg}`);
          // Refresh checked_at so the UI shows the cron is still trying
          await supabaseClient
            .from('m365_tenants')
            .update({
              prerequisites_status: {
                ...currentChecks,
                smtp_auth: {
                  ok: false,
                  status: 'pending',
                  message: 'Enabling tenant-level SMTP AUTH. Waiting for Microsoft to propagate the Exchange Administrator role (5-30 min). Auto-retrying every 5 minutes.',
                  checked_at: now,
                },
              },
            })
            .eq('id', t.id);
        }
      }
      return jsonResponse({ success: true, checked: tenants.length, fixed, still_pending: stillPending });
    }

    // ── retest_all_disconnected ───────────────────────────────────────
    // Cron-invoked: find all disconnected/pending m365 + smtp mailboxes and
    // retest their active transport. Mailboxes can land in "disconnected" during
    // provisioning lag, transient network blips or auth failures; CSV-imported smtp mailboxes
    // start in "pending" until the post-import background verifier (or this cron)
    // proves them out. This recovers them automatically so users never need to
    // click "Retest" manually.
    if (action === 'retest_all_disconnected') {
      const { limit = 50 } = body;

      // Pick up both `disconnected` and `pending` mailboxes across m365 (Graph)
      // and smtp (CSV/BYO) connection types. `pending` legitimately means "not yet
      // tested"; stuck pending/disconnected rows are recovered here.
      const { data: mailboxes, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, metadata, connection_type, status')
        .in('connection_type', ['m365', 'smtp'])
        .in('status', ['disconnected', 'pending'])
        .order('updated_at', { ascending: true })
        .limit(limit);

      if (fetchError) {
        return jsonResponse({ error: `Failed to fetch disconnected mailboxes: ${fetchError.message}` }, 500);
      }

      if (!mailboxes || mailboxes.length === 0) {
        return jsonResponse({ success: true, checked: 0, recovered: 0, still_disconnected: 0 });
      }

      console.log(`[Infra Mailbox] Auto-retest: checking ${mailboxes.length} disconnected mailboxes`);

      let recovered = 0;
      let stillDisconnected = 0;

      for (const mb of mailboxes) {
        try {
          if (mb.connection_type === 'm365') {
            const { graph, status } = await retestGraphMailbox(supabase, mb);
            if (graph.success && (status === 'ready' || status === 'warming')) recovered++;
            else stillDisconnected++;
            continue;
          }

          const creds = await extractSMTPCredentials(mb.metadata || {});
          if (!creds) {
            stillDisconnected++;
            continue;
          }
          const smtpResult = await testSMTPConnection(creds);

          // m365 uses Graph API polling for inbound (no IMAP); smtp/BYO mailboxes
          // need IMAP for reply detection, so they're only "ready" once both pass.
          const needsImap = mb.connection_type === 'smtp';
          const imapResult = needsImap && smtpResult.success
            ? await testIMAPConnection(creds)
            : { success: smtpResult.success, error: undefined as string | undefined };

          const ok = smtpResult.success && imapResult.success;
          const failDetail = !smtpResult.success
            ? `SMTP: ${smtpResult.error || 'failed'}`
            : `IMAP: ${imapResult.error || 'failed'}`;

          await supabase
            .from('email_mailboxes')
            .update({
              status: ok ? 'ready' : 'disconnected',
              imap_connected: ok,
              last_error: ok ? null : failDetail,
              updated_at: new Date().toISOString(),
            })
            .eq('id', mb.id);
          if (ok) {
            recovered++;
            console.log(`[Infra Mailbox] Auto-retest recovered ${mb.email_address}`);
          } else {
            stillDisconnected++;
          }
        } catch (err) {
          stillDisconnected++;
          console.warn(`[Infra Mailbox] Auto-retest error for ${mb.email_address}: ${err instanceof Error ? err.message : err}`);
        }
      }

      console.log(`[Infra Mailbox] Auto-retest done: ${recovered} recovered, ${stillDisconnected} still disconnected`);
      return jsonResponse({
        success: true,
        checked: mailboxes.length,
        recovered,
        still_disconnected: stillDisconnected,
      });
    }

    // ── diagnose_graph ────────────────────────────────────────────────
    // Check MS Graph-level auth policy for a user
    if (action === 'diagnose_graph') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      let tenantId: string | null = null;
      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('m365_tenant_id')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain?.m365_tenant_id) {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('tenant_id')
            .eq('id', domain.m365_tenant_id)
            .single();
          if (tenant?.tenant_id) tenantId = tenant.tenant_id;
        }
      }

      if (!tenantId) return jsonResponse({ error: 'Could not resolve tenant' }, 400);

      const graphToken = await getM365Token(tenantId);
      const userId = (mailbox.metadata as Record<string, unknown>)?.m365_user_id as string;
      if (!userId) return jsonResponse({ error: 'No m365_user_id in metadata' }, 400);

      // Check user auth policy and mailbox settings
      const [userRes, mailboxSettingsRes, authPoliciesRes] = await Promise.allSettled([
        fetch(`https://graph.microsoft.com/v1.0/users/${userId}?$select=id,userPrincipalName,authenticationPolicies,assignedLicenses`, {
          headers: { Authorization: `Bearer ${graphToken}` },
        }).then(r => r.json()),
        fetch(`https://graph.microsoft.com/beta/users/${userId}/mailboxSettings`, {
          headers: { Authorization: `Bearer ${graphToken}` },
        }).then(r => r.json()),
        fetch(`https://graph.microsoft.com/v1.0/policies/authenticationMethodsPolicy`, {
          headers: { Authorization: `Bearer ${graphToken}` },
        }).then(r => r.json()),
      ]);

      return jsonResponse({
        user: userRes.status === 'fulfilled' ? userRes.value : { error: String(userRes.reason) },
        mailbox_settings: mailboxSettingsRes.status === 'fulfilled' ? mailboxSettingsRes.value : { error: String(mailboxSettingsRes.reason) },
        auth_methods_policy: authPoliciesRes.status === 'fulfilled' ? authPoliciesRes.value : { error: String(authPoliciesRes.reason) },
      });
    }

    // ── diagnose_tenant ───────────────────────────────────────────────
    // Check tenant-level IMAP/SMTP Basic Auth policy settings.
    if (action === 'diagnose_tenant') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      let exoToken: string | null = null;
      let tenantId: string | null = null;
      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('m365_tenant_id')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain?.m365_tenant_id) {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('tenant_id')
            .eq('id', domain.m365_tenant_id)
            .single();
          if (tenant?.tenant_id) {
            tenantId = tenant.tenant_id;
            exoToken = await getEXOToken(tenant.tenant_id);
          }
        }
      }

      if (!exoToken || !tenantId) return jsonResponse({ error: 'Could not resolve EXO token' }, 400);

      const exoBase = `https://outlook.office.com/adminapi/beta/${tenantId}`;

      // Check tenant-level auth policy
      const [authPolicyRes, orgConfigRes] = await Promise.allSettled([
        fetch(`${exoBase}/AuthenticationPolicy`, {
          headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
        }).then(r => r.json()),
        fetch(`${exoBase}/TransportConfig?$select=SmtpClientAuthenticationDisabled`, {
          headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
        }).then(r => r.json()),
      ]);

      return jsonResponse({
        auth_policies: authPolicyRes.status === 'fulfilled' ? authPolicyRes.value : { error: String(authPolicyRes.reason) },
        transport_config: orgConfigRes.status === 'fulfilled' ? orgConfigRes.value : { error: String(orgConfigRes.reason) },
      });
    }

    // ── diagnose ──────────────────────────────────────────────────────
    // Returns EXO mailbox type and CASMailbox settings for a mailbox.
    // Use to debug IMAP/SMTP auth issues.
    if (action === 'diagnose') {
      const { mailbox_id, organization_id } = body;
      if (!mailbox_id || !organization_id) {
        return jsonResponse({ error: 'mailbox_id and organization_id are required' }, 400);
      }

      const { data: mailbox, error: fetchError } = await supabase
        .from('email_mailboxes')
        .select('*, sending_domain_id')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();

      if (fetchError || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      let exoToken: string | null = null;
      let tenantId: string | null = null;
      if (mailbox.sending_domain_id) {
        const { data: domain } = await supabase
          .from('email_sending_domains')
          .select('m365_tenant_id')
          .eq('id', mailbox.sending_domain_id)
          .single();
        if (domain?.m365_tenant_id) {
          const { data: tenant } = await supabase
            .from('m365_tenants')
            .select('tenant_id')
            .eq('id', domain.m365_tenant_id)
            .single();
          if (tenant?.tenant_id) {
            tenantId = tenant.tenant_id;
            exoToken = await getEXOToken(tenant.tenant_id);
          }
        }
      }

      if (!exoToken || !tenantId) return jsonResponse({ error: 'Could not resolve EXO token' }, 400);

      const email = mailbox.email_address;
      const exoBase = `https://outlook.office.com/adminapi/beta/${tenantId}`;

      const [mbRes, casRes] = await Promise.allSettled([
        fetch(`${exoBase}/Mailbox('${encodeURIComponent(email)}')?$select=RecipientTypeDetails,PrimarySmtpAddress,ExternalDirectoryObjectId,AccountDisabled`, {
          headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
        }).then(r => r.json()),
        fetch(`${exoBase}/CASMailbox('${encodeURIComponent(email)}')?$select=SmtpClientAuthenticationDisabled,ImapEnabled,PopEnabled`, {
          headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
        }).then(r => r.json()),
      ]);

      return jsonResponse({
        email,
        mailbox_type: mbRes.status === 'fulfilled' ? mbRes.value : { error: String(mbRes.reason) },
        cas_mailbox: casRes.status === 'fulfilled' ? casRes.value : { error: String(casRes.reason) },
      });
    }

    // ── send_test ──────────────────────────────────────────────────────────────
    if (action === 'send_test') {
      const { mailbox_id, organization_id, to, subject, text } = body;
      if (!mailbox_id || !organization_id || !to) {
        return jsonResponse({ error: 'mailbox_id, organization_id, and to are required' }, 400);
      }
      const { data: mailbox } = await supabase
        .from('email_mailboxes')
        .select('*')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single();
      if (!mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);
      const creds = await extractSMTPCredentials(mailbox.metadata);
      if (!creds) return jsonResponse({ error: 'No SMTP credentials found' }, 400);
      const result = await sendEmailViaSMTP({
        credentials: creds,
        from_email: mailbox.email_address,
        from_name: mailbox.display_name || mailbox.email_address,
        to_email: to,
        subject: subject || 'Test email from ACA',
        text: text || 'This is a test email.',
      });
      return jsonResponse({ success: result.success, error: result.error });
    }

    // ── sync_avatars ───────────────────────────────────────────────────────────
    // Bulk-push existing avatar_url images to M365 as profile photos
    if (action === 'sync_avatars') {
      const { domain_id, organization_id } = body;
      if (!domain_id || !organization_id) {
        return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
      }

      const { data: domain } = await supabase
        .from('email_sending_domains')
        .select('m365_tenant_id, domain')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single();
      if (!domain?.m365_tenant_id) return jsonResponse({ error: 'Domain not found or not M365' }, 404);

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('tenant_id')
        .eq('id', domain.m365_tenant_id)
        .single();
      if (!tenant?.tenant_id) return jsonResponse({ error: 'Tenant not found' }, 404);

      const graphToken = await getM365Token(tenant.tenant_id);

      const { data: mailboxes } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, metadata')
        .eq('sending_domain_id', domain_id)
        .eq('connection_type', 'm365');

      if (!mailboxes || mailboxes.length === 0) {
        return jsonResponse({ success: true, synced: 0, errors: [] });
      }

      const synced: string[] = [];
      const errors: Array<{ email: string; error: string }> = [];

      for (const mb of mailboxes) {
        const meta = (mb.metadata || {}) as Record<string, unknown>;
        const avatarUrl = meta.avatar_url as string | undefined;
        const userId = meta.m365_user_id as string | undefined;
        if (!avatarUrl || !userId) {
          console.log(`[sync_avatars] Skipping ${mb.email_address}: avatarUrl=${!!avatarUrl}, userId=${!!userId}`);
          continue;
        }
        try {
          console.log(`[sync_avatars] Syncing ${mb.email_address} (userId=${userId}) avatar: ${avatarUrl.substring(0, 80)}...`);
          await setUserProfilePhoto(graphToken, userId, avatarUrl);
          synced.push(mb.email_address);
          console.log(`[sync_avatars] ✓ ${mb.email_address}`);
        } catch (e) {
          console.error(`[sync_avatars] ✗ ${mb.email_address}:`, e);
          errors.push({ email: mb.email_address, error: e instanceof Error ? e.message : String(e) });
        }
      }

      return jsonResponse({ success: true, synced: synced.length, errors });
    }

    // ── bulk_sync_avatars_async ──────────────────────────────────────────────
    // Creates a mailbox_avatar_sync_jobs row and kicks off background
    // processing (chunked, self-invoking — see processAvatarSyncChunk).
    // Returns immediately with the job id so the frontend can poll for
    // progress instead of blocking on however many Graph calls the selection
    // needs. Explicit user-triggered action — does not gate on
    // email_sending_domains.sync_avatars_to_m365 (that flag governs implicit
    // sync on the single-mailbox `update` action only).
    if (action === 'bulk_sync_avatars_async') {
      const { organization_id, mailbox_ids } = body as { organization_id?: string; mailbox_ids?: string[] };
      if (!organization_id || !Array.isArray(mailbox_ids) || mailbox_ids.length === 0) {
        return jsonResponse({ error: 'organization_id and mailbox_ids are required' }, 400);
      }

      const { data: job, error: insertErr } = await supabase
        .from('mailbox_avatar_sync_jobs')
        .insert({
          organization_id,
          status: 'pending',
          total: mailbox_ids.length,
          mailbox_ids,
        })
        .select('id')
        .single();

      if (insertErr || !job) {
        return jsonResponse({ error: `Failed to create avatar sync job: ${insertErr?.message}` }, 500);
      }

      const work = processAvatarSyncChunk(supabase, job.id).catch((err) => {
        console.error(`[Infra Mailbox] bulk_sync_avatars_async initial chunk failed for job ${job.id}:`, err);
      });
      try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* not available locally */ }

      return jsonResponse({ success: true, job_id: job.id });
    }

    // ── resume_avatar_sync_job ───────────────────────────────────────────────
    // Continuation handler — called by selfInvokeResumeAvatarSync after each
    // chunk and by the stuck-job cron. Processes one chunk and either
    // completes or re-invokes itself.
    if (action === 'resume_avatar_sync_job') {
      const { job_id } = body as { job_id?: string };
      if (!job_id) return jsonResponse({ error: 'job_id is required' }, 400);

      const work = processAvatarSyncChunk(supabase, job_id).catch((err) => {
        console.error(`[Infra Mailbox] resume_avatar_sync_job chunk failed for ${job_id}:`, err);
      });
      try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* ignore */ }

      return jsonResponse({ success: true, job_id });
    }

    // ── resume_stuck_avatar_sync_jobs ────────────────────────────────────────
    // Safety-net called by pg_cron every 5 min. Finds running jobs whose last
    // heartbeat is older than the threshold (worker crashed mid-chunk) and
    // relaunches them.
    if (action === 'resume_stuck_avatar_sync_jobs') {
      const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS).toISOString();
      const { data: stuck, error: queryErr } = await supabase
        .from('mailbox_avatar_sync_jobs')
        .select('id')
        .eq('status', 'running')
        .lt('heartbeat_at', cutoff)
        .limit(20);

      if (queryErr) {
        return jsonResponse({ error: `Failed to query stuck avatar sync jobs: ${queryErr.message}` }, 500);
      }

      const stuckIds = (stuck ?? []).map((r) => r.id as string);
      console.log(`[Infra Mailbox] resume_stuck_avatar_sync_jobs found ${stuckIds.length} stuck job(s)`);

      for (const id of stuckIds) {
        const work = processAvatarSyncChunk(supabase, id).catch((err) => {
          console.error(`[Infra Mailbox] resume_stuck_avatar_sync_jobs chunk failed for ${id}:`, err);
        });
        try { (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil(work); } catch { /* ignore */ }
      }

      return jsonResponse({ success: true, resumed: stuckIds.length });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra Mailbox Provision] Error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
