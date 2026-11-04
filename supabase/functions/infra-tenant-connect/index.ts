/**
 * M365 Tenant Connect Edge Function
 *
 * Manages Microsoft 365 tenant connections for email infrastructure.
 *
 * Actions:
 *   initiate_consent — Resolve tenant ID from onmicrosoft.com domain, insert pending row, return consent URL
 *   validate         — Confirm admin consent was granted by calling MS Graph
 *   disconnect       — Remove tenant connection
 *   refresh          — Re-validate an existing tenant connection
 *
 * Authentication flow:
 *   1. User provides their onmicrosoft.com domain
 *   2. We resolve the tenant GUID via OpenID discovery
 *   3. We insert an m365_tenants row with status='consent_pending'
 *   4. We return an admin consent URL for the customer's M365 admin to click
 *   5. After consent, the m365-consent-callback function updates consent_granted=true
 *   6. validate action confirms the token works and marks status='connected'
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  resolveTenantId,
  buildAdminConsentUrl,
  getM365Token,
  getEXOToken,
  getTenantOrganization,
  getSecurityDefaultsEnabled,
  ensureExoServicePrincipal,
  ensureExchangeRecipientAdminRole,
  ensureExchangeAdminRole,
  ensureUserAdminRole,
  ensureTenantSmtpAuthEnabled,
  ensureSecurityDefaultsDisabled,
  checkSendAppRole,
  grantSendAppRole,
  GRAPH_MAIL_SEND_ROLE_ID,
  M365Error,
} from '../_shared/m365-client.ts';
import { encryptValue } from '../_shared/encryption.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { AuthError } from '../_shared/cli-auth.ts';

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

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { action, organization_id } = body;

    // Authorization: service role, or a caller who can access the organization that
    // owns the target. Actions keyed by tenant row id resolve the org from the row.
    if (['initiate_consent', 'connect_direct', 'bulk_connect'].includes(action)) {
      await assertOrgAccess(req, supabase, organization_id);
    } else if (['validate', 'refresh', 'disconnect', 'initiate_exo_consent'].includes(action)) {
      const { data: owner } = body.id
        ? await supabase.from('m365_tenants').select('organization_id').eq('id', body.id).maybeSingle()
        : { data: null };
      // A missing row and someone else's row look the same to the caller.
      await assertOrgAccess(req, supabase, owner?.organization_id);
    } else {
      await assertOrgAccess(req, supabase, null); // unknown action: service role only
    }

    // ── action: initiate_consent ────────────────────────────────────────────
    if (action === 'initiate_consent') {
      const { onmicrosoft_domain, display_name, admin_email, admin_password } = body;

      if (!organization_id || !onmicrosoft_domain) {
        return jsonResponse({ success: false, error: 'organization_id and onmicrosoft_domain are required' });
      }

      // Normalize domain
      const domain = onmicrosoft_domain.trim().toLowerCase().replace(/^https?:\/\//, '');
      if (!domain.includes('.')) {
        return jsonResponse({ success: false, error: 'Invalid domain format. Use: yourcompany.onmicrosoft.com' });
      }

      console.log(`[Tenant Connect] Resolving tenant ID for: ${domain}`);

      // Resolve Azure AD tenant GUID from the onmicrosoft.com domain
      let tenantId: string;
      try {
        tenantId = await resolveTenantId(domain);
      } catch (err) {
        return jsonResponse({
          success: false,
          error: err instanceof M365Error ? err.message : 'Failed to resolve tenant. Check the onmicrosoft.com domain is correct.',
        });
      }

      console.log(`[Tenant Connect] Resolved tenant ID: ${tenantId}`);

      // Encrypt admin password if provided (used for shared mailbox SMTP delegation)
      let adminPasswordEncrypted: string | null = null;
      if (admin_password) {
        adminPasswordEncrypted = await encryptValue(admin_password);
      }

      // Insert or update m365_tenants row
      const { data: tenant, error: upsertError } = await supabase
        .from('m365_tenants')
        .upsert({
          organization_id,
          tenant_id: tenantId,
          onmicrosoft_domain: domain,
          display_name: display_name || domain,
          admin_email: admin_email || null,
          admin_password_encrypted: adminPasswordEncrypted,
          consent_granted: false,
          status: 'consent_pending',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id,tenant_id',
        })
        .select()
        .single();

      if (upsertError) {
        return jsonResponse({ success: false, error: `Failed to save tenant: ${upsertError.message}` });
      }

      // Build admin consent URL — single app, no suffix needed
      let consentUrl: string;
      try {
        consentUrl = buildAdminConsentUrl(tenantId, `${tenant.id}`, admin_email || undefined, domain);
      } catch (err) {
        return jsonResponse({ success: false, error: 'M365_APP_CLIENT_ID and M365_CONSENT_REDIRECT_URI must be configured' });
      }

      console.log(`[Tenant Connect] Consent URL generated for tenant ${tenantId}`);

      return jsonResponse({
        success: true,
        tenant_id: tenant.id,
        azure_tenant_id: tenantId,
        consent_url: consentUrl,
        status: 'consent_pending',
      });
    }

    // ── action: validate ────────────────────────────────────────────────────
    if (action === 'validate') {
      const { id } = body; // m365_tenants row ID

      if (!id) return jsonResponse({ success: false, error: 'id is required' });

      const { data: tenant, error: fetchErr } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !tenant) {
        return jsonResponse({ success: false, error: 'Tenant not found' });
      }

      console.log(`[Tenant Connect] Validating tenant ${tenant.tenant_id}...`);

      // Try to get a Graph token — this will fail if consent was not granted
      let token: string;
      try {
        token = await getM365Token(tenant.tenant_id);
      } catch (err) {
        const m365Err = err as M365Error;
        await supabase
          .from('m365_tenants')
          .update({
            status: 'error',
            last_error: m365Err.message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        // Return consent URL so frontend can re-open the consent popup
        let consentUrl: string | undefined;
        if (m365Err.code === 'CONSENT_NOT_GRANTED') {
          try {
            consentUrl = buildAdminConsentUrl(tenant.tenant_id, `${id}`, tenant.admin_email || undefined, tenant.onmicrosoft_domain || undefined);
          } catch { /* ignore */ }
        }

        // Check if the stored error indicates Exchange Online is missing (AADSTS650052 from callback)
        const isExchangeMissing = tenant.last_error?.includes('Exchange Online') || tenant.last_error?.includes('AADSTS650052');

        return jsonResponse({
          success: false,
          error: isExchangeMissing
            ? 'Tenant does not have Exchange Online. Activate an Exchange Online license in M365 Admin Center → Billing → Purchase services.'
            : m365Err.code === 'CONSENT_NOT_GRANTED'
              ? 'Admin consent has not been granted yet. Please try the consent popup again.'
              : m365Err.message,
          code: m365Err.code,
          ...(consentUrl ? { consent_url: consentUrl } : {}),
        });
      }

      // Verify token works by fetching organization info
      let orgInfo: { displayName: string; id: string };
      try {
        orgInfo = await getTenantOrganization(token);
      } catch (err) {
        await supabase
          .from('m365_tenants')
          .update({
            status: 'error',
            last_error: (err as Error).message,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);

        return jsonResponse({ success: false, error: (err as Error).message });
      }

      // Check Security Defaults — blocks Basic Auth SMTP/IMAP if enabled
      const securityDefaultsEnabled = await getSecurityDefaultsEnabled(token);

      // Probe for EXO consent — try to get an Exchange Online token
      let exoConsentGranted = !!tenant.exo_consent_granted;
      let exoProbeError: string | null = null;
      if (!exoConsentGranted) {
        try {
          await getEXOToken(tenant.tenant_id);
          exoConsentGranted = true;
          console.log(`[Tenant Connect] EXO consent auto-detected for tenant ${tenant.tenant_id}`);
        } catch (exoErr) {
          exoProbeError = (exoErr as Error).message;
          console.warn(`[Tenant Connect] EXO token probe failed for ${tenant.tenant_id}: ${exoProbeError}`);

          // AADSTS650052 = tenant needs a Business Basic license (or higher) with Exchange Online
          if (exoProbeError.includes('AADSTS650052') || exoProbeError.includes('AADSTS7000229')) {
            exoProbeError = 'Tenant needs a Microsoft 365 Business Basic license (or higher) with Exchange Online. Purchase one in M365 Admin Center > Billing > Purchase services.';
          }
        }
      }

      // Compute prerequisites status snapshot. Each check returns one of:
      //   { ok: true,  status: 'ok' }                       — green
      //   { ok: false, status: 'pending', message: '...' }  — auto-fixing
      //   { ok: false, status: 'error',   message: '...' }  — needs human action
      const now = new Date().toISOString();
      const checks: Record<string, { ok: boolean; status: 'ok' | 'pending' | 'error'; message?: string; checked_at: string }> = {
        consent: exoConsentGranted
          ? { ok: true, status: 'ok', checked_at: now }
          : { ok: false, status: 'error', message: 'Admin consent for Microsoft Graph + Exchange Online has not been granted. Click "Re-grant permissions" to fix.', checked_at: now },
        license: exoProbeError && exoProbeError.includes('Business Basic')
          ? { ok: false, status: 'error', message: 'Tenant needs a Microsoft 365 Business Basic license (or higher) with Exchange Online. Purchase one in M365 Admin Center → Billing → Purchase services.', checked_at: now }
          : { ok: true, status: 'ok', checked_at: now },
      };

      // Mail.Send application role. Tenants consented before Mail.Send joined the
      // app registration hold a stale consent: everything else checks out and the
      // tenant reads "connected", yet every Graph send fails with "Access is
      // denied". Try the headless grant first (works where the app already holds
      // AppRoleAssignment.ReadWrite.All); otherwise a Global Admin has to
      // re-consent. An undetermined read is not a failure.
      try {
        let role = await checkSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
        if (role.consented === false) {
          const grant = await grantSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
          if (grant.granted) role = await checkSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
        }
        if (role.consented === false) {
          checks.mail_send = {
            ok: false,
            status: 'error',
            message: 'The ACA app does not hold the Mail.Send permission on this tenant, so its mailboxes cannot send (they stay paused). Click "Re-grant permissions" and approve as a Global Admin, then Refresh.',
            checked_at: now,
          };
        } else {
          checks.mail_send = { ok: true, status: 'ok', checked_at: now };
        }
      } catch (roleErr) {
        console.warn(`[Tenant Connect] Mail.Send role check failed: ${(roleErr as Error).message}`);
      }

      // Provision prerequisites at connect time so role propagation delays
      // happen during onboarding, not at first mailbox creation. All calls
      // are idempotent.
      if (exoConsentGranted) {
        // Directory roles — Exchange Recipient Admin, Exchange Admin, User Admin
        try {
          await ensureExoServicePrincipal(token);
          await ensureExchangeRecipientAdminRole(token);
          await ensureExchangeAdminRole(token);
          await ensureUserAdminRole(token);
          checks.directory_roles = { ok: true, status: 'ok', checked_at: now };
          console.log(`[Tenant Connect] Directory prerequisites provisioned for tenant ${tenant.tenant_id}`);
        } catch (prereqErr) {
          const msg = (prereqErr as Error).message;
          console.warn(`[Tenant Connect] Directory prerequisite setup failed: ${msg}`);
          checks.directory_roles = {
            ok: false,
            status: 'error',
            message: `Could not assign directory roles: ${msg}. The app may need additional permissions or admin consent.`,
            checked_at: now,
          };
        }

        // Security Defaults — must be disabled before SMTP AUTH can be enabled.
        // The auto-disable path requires Policy.ReadWrite.ConditionalAccess. If
        // that permission is missing, ensureSecurityDefaultsDisabled() throws —
        // but the customer may have disabled SD manually already. Re-probe the
        // current state on the catch path so a manual fix flips the check green.
        try {
          await ensureSecurityDefaultsDisabled(token);
          checks.security_defaults = { ok: true, status: 'ok', checked_at: now };
        } catch (sdErr) {
          const msg = (sdErr as Error).message;
          console.warn(`[Tenant Connect] Could not disable Security Defaults: ${msg}`);
          const freshSdState = await getSecurityDefaultsEnabled(token);
          if (freshSdState === false) {
            checks.security_defaults = { ok: true, status: 'ok', checked_at: now };
          } else {
            checks.security_defaults = {
              ok: false,
              status: 'error',
              message: 'Security Defaults must be disabled manually. In the Entra admin center: Entra ID > Overview > Properties > scroll to bottom > "Manage security defaults" > set to Disabled > Save. Then click "Refresh status" here.',
              checked_at: now,
            };
          }
        }

        // Tenant-level SMTP AUTH check.
        //
        // Proof-by-existence: if ANY mailbox under this tenant's domains is
        // currently in `ready` status, tenant SMTP AUTH is provably working
        // (a `ready` status means SMTP login succeeded). No write call needed.
        //
        // Otherwise we attempt Set-TransportConfig and fall back to "pending"
        // if EXO role propagation hasn't completed (cron retries every 5 min).
        const { count: readyMailboxCount } = await supabase
          .from('email_mailboxes')
          .select('id, sending_domain_id, email_sending_domains!inner(m365_tenant_id)', { count: 'exact', head: true })
          .eq('status', 'ready')
          .eq('email_sending_domains.m365_tenant_id', id);

        if (readyMailboxCount && readyMailboxCount > 0) {
          checks.smtp_auth = { ok: true, status: 'ok', checked_at: now };
          await supabase
            .from('m365_tenants')
            .update({ pending_tenant_smtp_fix: false })
            .eq('id', id);
        } else {
          await supabase
            .from('m365_tenants')
            .update({ pending_tenant_smtp_fix: true })
            .eq('id', id);

          try {
            const exoToken = await getEXOToken(tenant.tenant_id);
            const result = await ensureTenantSmtpAuthEnabled(exoToken, tenant.tenant_id, tenant.onmicrosoft_domain);
            if (result.nowEnabled) {
              await supabase
                .from('m365_tenants')
                .update({ pending_tenant_smtp_fix: false })
                .eq('id', id);
              checks.smtp_auth = { ok: true, status: 'ok', checked_at: now };
            } else {
              checks.smtp_auth = {
                ok: false,
                status: 'pending',
                message: 'Enabling tenant-level SMTP AUTH. This may take 5-30 minutes after onboarding while Microsoft propagates the Exchange Administrator role. Auto-retrying every 5 minutes.',
                checked_at: now,
              };
            }
          } catch (smtpErr) {
            console.warn(`[Tenant Connect] Tenant SMTP AUTH enablement failed (cron will retry): ${(smtpErr as Error).message}`);
            checks.smtp_auth = {
              ok: false,
              status: 'pending',
              message: 'Enabling tenant-level SMTP AUTH. This may take 5-30 minutes after onboarding while Microsoft propagates the Exchange Administrator role. Auto-retrying every 5 minutes.',
              checked_at: now,
            };
          }
        }

        // Cross-check: if SMTP AUTH is provably working, Security Defaults must
        // be disabled (SD blocks Basic Auth login). Trust the proof when the
        // direct policy read returned `null` (permission/transient error) — the
        // customer shouldn't see a red SD warning while their mailboxes work.
        if (checks.smtp_auth?.ok && checks.security_defaults && !checks.security_defaults.ok) {
          console.log('[Tenant Connect] SMTP AUTH proves Security Defaults disabled — flipping check green');
          checks.security_defaults = { ok: true, status: 'ok', checked_at: now };
        }
      }

      // Mark as connected
      await supabase
        .from('m365_tenants')
        .update({
          status: 'connected',
          consent_granted: true,
          consent_granted_at: new Date().toISOString(),
          display_name: tenant.display_name || orgInfo.displayName,
          last_validated_at: new Date().toISOString(),
          last_error: null,
          ...(exoConsentGranted ? {
            exo_consent_granted: true,
            exo_consent_granted_at: new Date().toISOString(),
          } : {}),
          metadata: { ...(tenant.metadata || {}), security_defaults_enabled: securityDefaultsEnabled },
          prerequisites_status: checks,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      console.log(`[Tenant Connect] Tenant ${tenant.tenant_id} connected (${orgInfo.displayName}), security_defaults=${securityDefaultsEnabled}, exo_consent=${exoConsentGranted}`);

      // If EXO not granted, build a consent URL for the frontend to retry
      let retryConsentUrl: string | undefined;
      if (!exoConsentGranted) {
        try {
          retryConsentUrl = buildAdminConsentUrl(tenant.tenant_id, `${id}`, tenant.admin_email || undefined, tenant.onmicrosoft_domain || undefined);
        } catch { /* ignore */ }
      }

      return jsonResponse({
        success: true,
        status: 'connected',
        tenant_display_name: orgInfo.displayName,
        security_defaults_enabled: securityDefaultsEnabled,
        exo_consent_granted: exoConsentGranted,
        ...(exoProbeError ? { exo_probe_error: exoProbeError } : {}),
        ...(retryConsentUrl ? { consent_url: retryConsentUrl } : {}),
        warnings: securityDefaultsEnabled
          ? ['Security Defaults are enabled on this tenant. You must disable them in Azure AD > Properties before SMTP AUTH will work.']
          : [],
      });
    }

    // ── action: connect_direct ─────────────────────────────────────────────
    // For CSP operators who already have admin access — skips the consent flow.
    // Resolves tenant, upserts row with consent_granted=true, validates immediately.
    if (action === 'connect_direct') {
      const { onmicrosoft_domain, display_name, admin_email, admin_password } = body;

      if (!organization_id || !onmicrosoft_domain) {
        return jsonResponse({ success: false, error: 'organization_id and onmicrosoft_domain are required' });
      }

      const domain = onmicrosoft_domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.onmicrosoft\.com$/, '') + '.onmicrosoft.com';

      let tenantId: string;
      try {
        tenantId = await resolveTenantId(domain);
      } catch (err) {
        return jsonResponse({
          success: false,
          error: err instanceof M365Error ? err.message : `Failed to resolve tenant for ${domain}`,
        });
      }

      const adminPasswordEncrypted = admin_password ? await encryptValue(admin_password) : null;

      // Upsert with consent pre-granted (CSP has access)
      const { data: tenant, error: upsertError } = await supabase
        .from('m365_tenants')
        .upsert({
          organization_id,
          tenant_id: tenantId,
          onmicrosoft_domain: domain,
          display_name: display_name || domain,
          admin_email: admin_email || null,
          admin_password_encrypted: adminPasswordEncrypted,
          consent_granted: true,
          consent_granted_at: new Date().toISOString(),
          status: 'pending',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,tenant_id' })
        .select()
        .single();

      if (upsertError) {
        return jsonResponse({ success: false, error: `Failed to save tenant: ${upsertError.message}` });
      }

      // Immediately validate via Graph
      let token: string;
      try {
        token = await getM365Token(tenantId);
      } catch (err) {
        await supabase.from('m365_tenants').update({
          status: 'error',
          last_error: (err as Error).message,
          updated_at: new Date().toISOString(),
        }).eq('id', tenant.id);
        return jsonResponse({ success: false, error: (err as Error).message, tenant_id: tenant.id });
      }

      let orgInfo: { displayName: string; id: string };
      try {
        orgInfo = await getTenantOrganization(token);
      } catch (err) {
        await supabase.from('m365_tenants').update({
          status: 'error',
          last_error: (err as Error).message,
          updated_at: new Date().toISOString(),
        }).eq('id', tenant.id);
        return jsonResponse({ success: false, error: (err as Error).message, tenant_id: tenant.id });
      }

      // Probe EXO consent (CSP likely has access)
      let exoConsentGranted = false;
      try {
        await getEXOToken(tenantId);
        exoConsentGranted = true;
      } catch { /* expected if EXO not available */ }

      await supabase.from('m365_tenants').update({
        status: 'connected',
        display_name: display_name || orgInfo.displayName,
        last_validated_at: new Date().toISOString(),
        last_error: null,
        ...(exoConsentGranted ? {
          exo_consent_granted: true,
          exo_consent_granted_at: new Date().toISOString(),
        } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', tenant.id);

      return jsonResponse({
        success: true,
        tenant_id: tenant.id,
        status: 'connected',
        exo_consent_granted: exoConsentGranted,
        tenant_display_name: orgInfo.displayName,
      });
    }

    // ── action: bulk_connect ───────────────────────────────────────────────
    // Bulk CSP import — connects multiple tenants at once.
    if (action === 'bulk_connect') {
      const { tenants: tenantList } = body; // Array<{ onmicrosoft_domain, display_name?, admin_email?, admin_password? }>

      if (!organization_id || !Array.isArray(tenantList) || tenantList.length === 0) {
        return jsonResponse({ success: false, error: 'organization_id and tenants[] are required' });
      }

      const results: Array<{ domain: string; success: boolean; tenant_id?: string; display_name?: string; error?: string }> = [];

      for (const entry of tenantList) {
        const domain = (entry.onmicrosoft_domain || '').trim().toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\.onmicrosoft\.com$/, '') + '.onmicrosoft.com';

        if (!domain || domain === '.onmicrosoft.com') {
          results.push({ domain: entry.onmicrosoft_domain || '', success: false, error: 'Invalid domain' });
          continue;
        }

        try {
          const tenantId = await resolveTenantId(domain);
          const entryPasswordEncrypted = entry.admin_password ? await encryptValue(entry.admin_password) : null;

          const { data: tenant, error: upsertError } = await supabase
            .from('m365_tenants')
            .upsert({
              organization_id,
              tenant_id: tenantId,
              onmicrosoft_domain: domain,
              display_name: entry.display_name || domain,
              admin_email: entry.admin_email || null,
              admin_password_encrypted: entryPasswordEncrypted,
              consent_granted: true,
              consent_granted_at: new Date().toISOString(),
              status: 'pending',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'organization_id,tenant_id' })
            .select()
            .single();

          if (upsertError || !tenant) {
            results.push({ domain, success: false, error: upsertError?.message || 'Insert failed' });
            continue;
          }

          const token = await getM365Token(tenantId);
          const orgInfo = await getTenantOrganization(token);

          let exoOk = false;
          try { await getEXOToken(tenantId); exoOk = true; } catch { /* ok */ }

          await supabase.from('m365_tenants').update({
            status: 'connected',
            display_name: entry.display_name || orgInfo.displayName,
            last_validated_at: new Date().toISOString(),
            last_error: null,
            ...(exoOk ? { exo_consent_granted: true, exo_consent_granted_at: new Date().toISOString() } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', tenant.id);

          results.push({ domain, success: true, tenant_id: tenant.id, display_name: orgInfo.displayName });
        } catch (err) {
          results.push({ domain, success: false, error: (err as Error).message });
        }
      }

      return jsonResponse({
        success: true,
        connected: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      });
    }

    // ── action: initiate_exo_consent ────────────────────────────────────────
    // Kept for backward compat — now returns the same consent URL as initiate_consent.
    // Single app handles both Graph + EXO permissions.
    if (action === 'initiate_exo_consent') {
      const { id } = body;
      if (!id) return jsonResponse({ success: false, error: 'id is required' });

      const { data: tenant, error: fetchErr } = await supabase
        .from('m365_tenants')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !tenant) {
        return jsonResponse({ success: false, error: 'Tenant not found' });
      }

      let consentUrl: string;
      try {
        consentUrl = buildAdminConsentUrl(tenant.tenant_id, `${id}`, tenant.admin_email || undefined, tenant.onmicrosoft_domain || undefined);
      } catch (err) {
        return jsonResponse({ success: false, error: 'M365_APP_CLIENT_ID and M365_CONSENT_REDIRECT_URI must be configured' });
      }

      console.log(`[Tenant Connect] Consent URL generated for tenant ${tenant.tenant_id} (via initiate_exo_consent)`);

      return jsonResponse({
        success: true,
        consent_url: consentUrl,
      });
    }

    // ── action: disconnect ──────────────────────────────────────────────────
    if (action === 'disconnect') {
      const { id } = body;
      if (!id) return jsonResponse({ success: false, error: 'id is required' });

      const { error: deleteError } = await supabase
        .from('m365_tenants')
        .delete()
        .eq('id', id);

      if (deleteError) {
        return jsonResponse({ success: false, error: `Failed to disconnect: ${deleteError.message}` });
      }

      return jsonResponse({ success: true });
    }

    // ── action: refresh ─────────────────────────────────────────────────────
    // Refresh is a re-run of `validate`. The previous implementation
    // self-fetched `req.url`, which inside an edge function points at the
    // internal container URL — that 404s. Re-enter the handler directly with a
    // synthetic Request instead.
    if (action === 'refresh') {
      const { id } = body;
      if (!id) return jsonResponse({ success: false, error: 'id is required' });

      const validateReq = new Request(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify({ action: 'validate', id }),
      });
      return await handleRequest(validateReq);
    }

    return jsonResponse({ success: false, error: `Unknown action: ${action}` });

  } catch (error) {
    if (error instanceof AuthError) return jsonResponse({ success: false, error: error.message }, error.status);
    console.error('[Tenant Connect] Error:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
}

Deno.serve(handleRequest);
