/**
 * EMERGENCY HEAL — rotate M365 mailbox passwords after SMTP_ENCRYPTION_KEY rotation.
 *
 * What this does, per mailbox:
 *   1. Look up the mailbox's M365 tenant via metadata.m365_admin_email → m365_tenants.tenant_id
 *   2. Get an app-credentials Graph token for that tenant
 *   3. Generate a fresh 32-char random password
 *   4. PATCH /users/{m365_user_id} with new passwordProfile
 *   5. Encrypt the new password with the (already rotated) SMTP_ENCRYPTION_KEY
 *   6. Update email_mailboxes.metadata.smtp_credentials
 *
 * What it deliberately does NOT do:
 *   - Touch tenant.admin_password_encrypted (user must re-enter via UI)
 *   - Touch BYO server SSH keys (deleted, will be recreated via wizard)
 *   - Process zapmail mailboxes (already healed via zapmail-connect)
 *
 * Body:
 *   {
 *     dry_run?: boolean         // if true, returns plan without executing
 *     limit?: number            // process at most N mailboxes (default 50, max 200 per call)
 *     mailbox_ids?: string[]    // optional: scope to specific mailbox ids
 *     organization_id?: string  // optional: scope to one org
 *   }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue } from '../_shared/encryption.ts';
import { getM365Token } from '../_shared/m365-client.ts';
import { encryptCredentials, type SMTPCredentials } from '../_shared/smtp-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generatePassword(): string {
  // M365 requires 3 of 4: lowercase, uppercase, digit, symbol. We satisfy all 4
  // and pad to 24 random alphanumeric chars for entropy (~140 bits).
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digit = '23456789';
  const symbol = '!@#$%^&*-_=+';
  const all = lower + upper + digit + symbol;
  const pickFrom = (set: string): string => {
    const buf = new Uint8Array(1);
    crypto.getRandomValues(buf);
    return set[buf[0] % set.length];
  };
  // Guarantee one of each class, then 20 random across all classes.
  const chars = [pickFrom(lower), pickFrom(upper), pickFrom(digit), pickFrom(symbol)];
  for (let i = 0; i < 20; i++) chars.push(pickFrom(all));
  // Fisher-Yates shuffle so the guaranteed chars aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const r = new Uint8Array(1);
    crypto.getRandomValues(r);
    const j = r[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

interface MailboxRow {
  id: string;
  email_address: string;
  organization_id: string;
  metadata: Record<string, unknown> | null;
}

interface TenantRow {
  tenant_id: string;
  admin_email: string;
  organization_id: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const authHeader = req.headers.get('Authorization');
  const cronSecret = req.headers.get('x-cron-secret');
  const expectedCronSecret = Deno.env.get('CRON_SECRET');
  const bearerOk = authHeader?.startsWith('Bearer ') && authHeader.replace('Bearer ', '') === serviceKey;
  const cronOk = !!cronSecret && !!expectedCronSecret && cronSecret === expectedCronSecret;
  if (!bearerOk && !cronOk) return jsonResponse({ success: false, error: 'Service-role or cron-secret required — heal is privileged' }, 403);

  let body: { dry_run?: boolean; limit?: number; mailbox_ids?: string[]; organization_id?: string } = {};
  try {
    if (req.headers.get('content-length') !== '0') body = await req.json();
  } catch { /* empty body fine */ }

  const dryRun = body.dry_run === true;
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) Fetch broken M365 mailboxes (those whose smtp_credentials predate the key rotation)
  let q = supabase
    .from('email_mailboxes')
    .select('id, email_address, organization_id, metadata')
    .eq('connection_type', 'm365')
    .not('metadata->>smtp_credentials', 'is', null)
    // Process oldest-stale first so we heal long-broken ones before recently broken ones
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (body.mailbox_ids && body.mailbox_ids.length > 0) q = q.in('id', body.mailbox_ids);
  if (body.organization_id) q = q.eq('organization_id', body.organization_id);
  const { data: mailboxes, error: mboxErr } = await q;
  if (mboxErr) return jsonResponse({ success: false, error: mboxErr.message }, 500);
  const mboxList = (mailboxes ?? []) as MailboxRow[];

  if (mboxList.length === 0) {
    return jsonResponse({ success: true, mailboxes_scanned: 0, healed: 0, failed: 0, sample: [] });
  }

  // 2) Build admin_email → tenant_id lookup (covers all tenants in scope)
  const adminEmails = Array.from(new Set(
    mboxList.map((m) => (m.metadata?.m365_admin_email as string | undefined) ?? null).filter(Boolean) as string[],
  ));
  const { data: tenants } = await supabase
    .from('m365_tenants')
    .select('tenant_id, admin_email, organization_id')
    .in('admin_email', adminEmails);
  const tenantByAdmin = new Map<string, TenantRow>();
  for (const t of (tenants ?? []) as TenantRow[]) {
    tenantByAdmin.set(`${t.organization_id}|${t.admin_email}`, t);
  }

  // Cache Graph tokens per tenant — one client_credentials call per tenant
  const tokenByTenant = new Map<string, string>();

  const results: Array<{ id: string; email: string; status: 'ok' | 'skipped' | 'failed'; reason?: string }> = [];
  let healed = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (const mb of mboxList) {
    const meta = (mb.metadata ?? {}) as Record<string, unknown>;
    const adminEmail = meta.m365_admin_email as string | undefined;
    const m365UserId = meta.m365_user_id as string | undefined;

    if (!adminEmail || !m365UserId) {
      results.push({ id: mb.id, email: mb.email_address, status: 'skipped', reason: 'missing_metadata' });
      continue;
    }

    const tenantKey = `${mb.organization_id}|${adminEmail}`;
    const tenant = tenantByAdmin.get(tenantKey);
    if (!tenant) {
      results.push({ id: mb.id, email: mb.email_address, status: 'skipped', reason: 'tenant_not_found' });
      continue;
    }

    if (dryRun) {
      results.push({ id: mb.id, email: mb.email_address, status: 'ok', reason: 'dry_run' });
      continue;
    }

    try {
      // 3) Get Graph token for this tenant (cached)
      let accessToken = tokenByTenant.get(tenant.tenant_id);
      if (!accessToken) {
        accessToken = await getM365Token(tenant.tenant_id);
        tokenByTenant.set(tenant.tenant_id, accessToken);
      }

      // 4) Generate a new password and PATCH the user
      const newPassword = generatePassword();
      const patchRes = await fetch(`https://graph.microsoft.com/v1.0/users/${m365UserId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          passwordProfile: {
            password: newPassword,
            forceChangePasswordNextSignIn: false,
          },
        }),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        throw new Error(`Graph PATCH ${patchRes.status}: ${errText.slice(0, 200)}`);
      }

      // 5) Encrypt new credentials with the (already rotated) SMTP_ENCRYPTION_KEY
      const creds: SMTPCredentials = {
        smtp_host: 'smtp.office365.com',
        smtp_port: 587,
        smtp_username: mb.email_address,
        smtp_password: newPassword,
        imap_host: 'outlook.office365.com',
        imap_port: 993,
        imap_username: mb.email_address,
        imap_password: newPassword,
      };
      const encrypted = await encryptCredentials(creds);

      // 6) Update mailbox row.
      //
      // We MUST NOT do read-modify-write on metadata here. Other code paths
      // (IMAP poller updating last_imap_uid, inbox poller updating spam uid,
      // etc.) read+merge+write the same metadata blob. If they hold a snapshot
      // that predates our heal, their write clobbers smtp_credentials with the
      // pre-heal (undecryptable) value. Use the RPC for an atomic JSONB merge
      // so smtp_credentials is set without disturbing other keys.
      const { error: updErr } = await supabase.rpc('merge_mailbox_smtp_credentials', {
        p_id: mb.id,
        p_encrypted: encrypted,
      });
      if (updErr) throw new Error(`db_update_failed: ${updErr.message}`);

      healed++;
      results.push({ id: mb.id, email: mb.email_address, status: 'ok' });
    } catch (e) {
      failed++;
      const msg = e instanceof Error ? e.message : 'unknown';
      results.push({ id: mb.id, email: mb.email_address, status: 'failed', reason: msg });
    }
  }

  return jsonResponse({
    success: true,
    mailboxes_scanned: mboxList.length,
    healed,
    failed,
    elapsed_ms: Date.now() - startedAt,
    sample: results.slice(0, 30),
  });
});
