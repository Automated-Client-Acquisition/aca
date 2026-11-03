/**
 * M365 Mailbox Convert to Shared — Bulk Conversion Edge Function
 *
 * Converts regular (licensed) M365 mailboxes to Shared mailboxes via the EXO
 * Admin REST API. Shared mailboxes:
 *   - Cost $0/month (no Exchange Online license required, up to 50GB)
 *   - Support SMTP AUTH + IMAP once a password is set on the underlying user
 *   - Are what Plusvibe and similar warmup tools expect
 *
 * Background:
 *   createSharedMailbox() in m365-client.ts historically left mailboxes as
 *   Regular (the "Step 2: convert" was deliberately skipped). Microsoft
 *   tolerates this briefly then SMTP-throttles unlicensed regular mailboxes.
 *   This function repairs existing mailboxes by running the conversion that
 *   should have happened at creation time.
 *
 * Actions:
 *   list_candidates   — Inspect a domain's mailboxes, report current
 *                       RecipientTypeDetails for each (read-only, free).
 *   convert_one       — Convert one mailbox by mailbox_id. Useful for the
 *                       "test one first in Plusvibe" verification step.
 *   bulk_convert      — Convert all mailboxes for a given domain_id (or
 *                       organization_id). Supports dry_run=true.
 *
 * Auth:
 *   Service role required (enforced at the top of the handler). Caller must
 *   supply organization_id; the function verifies the targeted mailbox(es)
 *   belong to that org.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

// Inlined from _shared/m365-client.ts to keep this function's bundle small
// (importing the full file pulls in DKIM, domain mgmt, user mgmt, etc. that
// this function doesn't need). Keep these in sync if the shared module changes.
class M365Error extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
    this.name = 'M365Error';
  }
}

async function getEXOToken(tenantId: string): Promise<string> {
  const clientId = Deno.env.get('M365_APP_CLIENT_ID');
  const clientSecret = Deno.env.get('M365_APP_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new M365Error('CONFIG_ERROR', 'M365_APP_CLIENT_ID and M365_APP_CLIENT_SECRET must be set');
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://outlook.office.com/.default',
    }),
  });
  if (!res.ok) {
    const error = await res.text();
    if (error.includes('AADSTS700016') || error.includes('AADSTS65001') || error.includes('AADSTS7000229')) {
      throw new M365Error('CONSENT_NOT_GRANTED', 'Admin consent not granted for this tenant', 403);
    }
    throw new M365Error('AUTH_FAILED', `Failed to get EXO token: ${error}`, res.status);
  }
  const data = await res.json();
  return data.access_token as string;
}

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

interface MailboxRow {
  id: string;
  email_address: string;
  organization_id: string;
  sending_domain_id: string | null;
  status: string | null;
}

interface DomainRow {
  id: string;
  domain: string;
  m365_tenant_id: string | null;
  organization_id: string;
}

interface MailboxState {
  mailbox_id: string;
  email: string;
  current_type: string | null;
  needs_conversion: boolean;
  error?: string;
}

// Fetch the live RecipientTypeDetails from EXO so we know whether the mailbox
// is already Shared (skip), Regular (convert), or missing entirely (error).
async function readRecipientType(
  exoToken: string,
  tenantId: string,
  email: string
): Promise<string | null> {
  const url = `https://outlook.office365.com/adminapi/beta/${tenantId}/Mailbox('${encodeURIComponent(email)}')?$select=RecipientTypeDetails,PrimarySmtpAddress`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${exoToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EXO read failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data?.RecipientTypeDetails ?? null;
}

// Read the Exchange directory DisplayName for a mailbox. This is the value
// Exchange Online stamps onto the From header of outbound mail for SHARED
// mailboxes — it overrides whatever display name the SMTP client puts in the
// "From:" header. If this is blank or equals the email address, recipients see
// a bare address even though our DB display_name is correct.
async function readExoDisplayName(
  exoToken: string,
  tenantId: string,
  email: string
): Promise<{ displayName: string | null; primarySmtp: string | null }> {
  const url = `https://outlook.office365.com/adminapi/beta/${tenantId}/Mailbox('${encodeURIComponent(email)}')?$select=DisplayName,PrimarySmtpAddress,RecipientTypeDetails`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${exoToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`EXO read failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return {
    displayName: data?.DisplayName ?? null,
    primarySmtp: data?.PrimarySmtpAddress ?? null,
  };
}

// PATCH Mailbox('email') { Type: 'Shared' } — mirrors the convert_to_user
// action in infra-mailbox-provision but in the reverse direction.
async function patchToShared(
  exoToken: string,
  tenantId: string,
  email: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `https://outlook.office365.com/adminapi/beta/${tenantId}/Mailbox('${encodeURIComponent(email)}')`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${exoToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ Type: 'Shared' }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

// Convert one mailbox: read current type, PATCH if needed, verify the change.
async function convertOne(
  exoToken: string,
  tenantId: string,
  email: string,
  dryRun: boolean,
  skipVerify = false
): Promise<{
  before: string | null;
  after: string | null;
  changed: boolean;
  dry_run: boolean;
  error?: string;
}> {
  const before = await readRecipientType(exoToken, tenantId, email);

  if (before === 'SharedMailbox') {
    return { before, after: before, changed: false, dry_run: dryRun };
  }

  if (dryRun) {
    return { before, after: 'SharedMailbox', changed: false, dry_run: true };
  }

  const patchResult = await patchToShared(exoToken, tenantId, email);
  if (!patchResult.ok) {
    return {
      before,
      after: before,
      changed: false,
      dry_run: false,
      error: `PATCH failed (${patchResult.status}): ${patchResult.body}`,
    };
  }

  // In bulk mode we trust the PATCH 200 response and rely on a follow-up
  // list_candidates call for verification — that lets us fit 50 conversions
  // inside the 150s edge function timeout. In convert_one (the smoke test),
  // we read back so the caller gets a fully-verified "after" state.
  if (skipVerify) {
    return { before, after: 'SharedMailbox', changed: true, dry_run: false };
  }

  await new Promise((r) => setTimeout(r, 1000));
  let after: string | null = null;
  try {
    after = await readRecipientType(exoToken, tenantId, email);
  } catch (e) {
    return {
      before,
      after: null,
      changed: false,
      dry_run: false,
      error: `Verification read failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (after !== 'SharedMailbox') {
    return {
      before,
      after,
      changed: false,
      dry_run: false,
      error: `Conversion accepted but RecipientTypeDetails is still ${after ?? 'unknown'}`,
    };
  }

  return { before, after, changed: true, dry_run: false };
}

// Resolve the EXO token for a given mailbox row by walking
// mailbox -> sending_domain -> m365_tenant.tenant_id.
async function resolveExoToken(
  supabase: SupabaseClient<any>,
  mailbox: MailboxRow
): Promise<{ exoToken: string; tenantId: string }> {
  if (!mailbox.sending_domain_id) {
    throw new Error(`Mailbox ${mailbox.email_address} has no sending_domain_id`);
  }
  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('m365_tenant_id')
    .eq('id', mailbox.sending_domain_id)
    .single();
  if (!domain?.m365_tenant_id) {
    throw new Error(`Domain for ${mailbox.email_address} is not an M365 domain`);
  }
  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('id', domain.m365_tenant_id)
    .single();
  if (!tenant?.tenant_id) {
    throw new Error(`No tenant_id found for mailbox ${mailbox.email_address}`);
  }
  const exoToken = await getEXOToken(tenant.tenant_id);
  return { exoToken, tenantId: tenant.tenant_id };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Ops-only: every action runs with the service-role client on whatever
  // organization_id the body names, so only the service role may call it.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { action } = body;

    // ── list_candidates ───────────────────────────────────────────────
    // Inspect a domain's mailboxes and report current RecipientTypeDetails.
    // Read-only — no mutations. Use this as the dry-run preview.
    if (action === 'list_candidates') {
      const { organization_id, domain_id } = body;
      if (!organization_id || !domain_id) {
        return jsonResponse({ error: 'organization_id and domain_id are required' }, 400);
      }

      const { data: domain, error: domainErr } = await supabase
        .from('email_sending_domains')
        .select('id, domain, m365_tenant_id, organization_id')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single<DomainRow>();
      if (domainErr || !domain) return jsonResponse({ error: 'Domain not found' }, 404);
      if (!domain.m365_tenant_id) return jsonResponse({ error: 'Domain is not an M365 domain' }, 400);

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('tenant_id')
        .eq('id', domain.m365_tenant_id)
        .single();
      if (!tenant?.tenant_id) return jsonResponse({ error: 'M365 tenant not found' }, 404);

      const { data: mailboxes, error: mbErr } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, sending_domain_id, status')
        .eq('organization_id', organization_id)
        .eq('sending_domain_id', domain.id);
      if (mbErr) return jsonResponse({ error: mbErr.message }, 500);

      const exoToken = await getEXOToken(tenant.tenant_id);
      const results: MailboxState[] = [];
      for (const mb of (mailboxes || []) as MailboxRow[]) {
        try {
          const type = await readRecipientType(exoToken, tenant.tenant_id, mb.email_address);
          results.push({
            mailbox_id: mb.id,
            email: mb.email_address,
            current_type: type,
            needs_conversion: type !== 'SharedMailbox',
          });
        } catch (e) {
          results.push({
            mailbox_id: mb.id,
            email: mb.email_address,
            current_type: null,
            needs_conversion: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      const needing = results.filter((r) => r.needs_conversion).length;
      return jsonResponse({
        domain: domain.domain,
        total: results.length,
        needing_conversion: needing,
        already_shared: results.filter((r) => r.current_type === 'SharedMailbox').length,
        errors: results.filter((r) => r.error).length,
        mailboxes: results,
      });
    }

    // ── read_display_name ─────────────────────────────────────────────
    // Read-only diagnostic. Reports the Exchange directory DisplayName for one
    // mailbox alongside our stored display_name, so we can confirm whether
    // Exchange Online is overriding the From-header display name (the cause of
    // sends showing a bare email address instead of the person's name).
    if (action === 'read_display_name') {
      const { organization_id, mailbox_id } = body;
      if (!organization_id || !mailbox_id) {
        return jsonResponse({ error: 'organization_id and mailbox_id are required' }, 400);
      }

      const { data: mailbox, error: mbErr } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, sending_domain_id, status, display_name')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single<MailboxRow & { display_name: string | null }>();
      if (mbErr || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      const { exoToken, tenantId } = await resolveExoToken(supabase, mailbox);
      const exo = await readExoDisplayName(exoToken, tenantId, mailbox.email_address);
      const storedName = (mailbox.display_name || '').trim();
      const exoName = (exo.displayName || '').trim();
      // The smoking gun: EXO DisplayName is blank or equals the address, while
      // our stored display_name is a real name → Exchange is stripping the name.
      const exoNameIsBare =
        exoName === '' || exoName.toLowerCase() === mailbox.email_address.toLowerCase();
      return jsonResponse({
        mailbox_id: mailbox.id,
        email: mailbox.email_address,
        stored_display_name: mailbox.display_name,
        exo_display_name: exo.displayName,
        exo_primary_smtp: exo.primarySmtp,
        exo_name_is_bare: exoNameIsBare,
        mismatch: storedName !== exoName,
        diagnosis: exoNameIsBare
          ? 'Exchange DisplayName is blank or equals the address — this is why recipients see a bare email. Fix: set EXO DisplayName via Set-Mailbox.'
          : storedName !== exoName
            ? `Exchange DisplayName ("${exoName}") differs from stored ("${storedName}") — recipients see the Exchange value.`
            : 'Exchange DisplayName matches stored display_name — From-header stripping is not happening here.',
      });
    }

    // ── read_sent_headers ─────────────────────────────────────────────
    // Read-only diagnostic. Pulls recent Sent Items via MS Graph and returns
    // the parsed From (name + address) plus the FULL raw internet headers, so
    // we can see the exact bytes Exchange emitted on the wire — independent of
    // how any receiving client (Gmail) chooses to render them.
    if (action === 'read_sent_headers') {
      const { organization_id, mailbox_id, to_filter, top } = body;
      if (!organization_id || !mailbox_id) {
        return jsonResponse({ error: 'organization_id and mailbox_id are required' }, 400);
      }

      const { data: mailbox, error: mbErr } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, sending_domain_id, status, display_name')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single<MailboxRow & { display_name: string | null }>();
      if (mbErr || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      const { tenantId } = await resolveExoToken(supabase, mailbox);
      const clientId = Deno.env.get('M365_APP_CLIENT_ID');
      const clientSecret = Deno.env.get('M365_APP_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        return jsonResponse({ error: 'M365_APP_CLIENT_ID and M365_APP_CLIENT_SECRET must be set' }, 500);
      }
      const tokRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
      });
      if (!tokRes.ok) return jsonResponse({ error: `Graph token failed: ${await tokRes.text()}` }, 500);
      const graphToken = (await tokRes.json()).access_token as string;

      const user = encodeURIComponent(mailbox.email_address);
      const topN = typeof top === 'number' ? Math.min(top, 25) : 10;
      const url = `https://graph.microsoft.com/v1.0/users/${user}/mailFolders/sentitems/messages?$top=${topN}&$select=subject,from,sender,toRecipients,sentDateTime,internetMessageHeaders`;
      const msgRes = await fetch(url, { headers: { Authorization: `Bearer ${graphToken}` } });
      if (!msgRes.ok) return jsonResponse({ error: `Graph messages read failed (${msgRes.status}): ${await msgRes.text()}` }, 500);
      const msgData = await msgRes.json();

      const messages = (msgData.value || [])
        .map((m: Record<string, any>) => {
          const headers = (m.internetMessageHeaders || []) as Array<{ name: string; value: string }>;
          const pick = (name: string) =>
            headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
          return {
            subject: m.subject,
            sent: m.sentDateTime,
            to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address),
            from_address: m.from?.emailAddress?.address ?? null,
            from_name: m.from?.emailAddress?.name ?? null,
            sender_name: m.sender?.emailAddress?.name ?? null,
            raw_from_header: pick('From'),
            raw_sender_header: pick('Sender'),
            raw_reply_to_header: pick('Reply-To'),
            all_headers: headers,
          };
        })
        .filter((m: any) => !to_filter || (m.to || []).some((t: string) => t === to_filter));

      return jsonResponse({
        mailbox: mailbox.email_address,
        stored_display_name: mailbox.display_name,
        count: messages.length,
        messages,
      });
    }

    // ── read_dkim_status ──────────────────────────────────────────────
    // Read-only diagnostic. Calls EXO Get-DkimSigningConfig for a domain and
    // reports whether DKIM is actually SIGNING (Enabled=true, Status=Valid) vs
    // merely having its CNAMEs published. Published CNAMEs with signing disabled
    // means outbound mail goes out UNSIGNED → DKIM fails at the receiver →
    // Gmail distrusts the From identity and shows the bare address. No mutations.
    if (action === 'read_dkim_status') {
      const { organization_id, domain_id } = body;
      if (!organization_id || !domain_id) {
        return jsonResponse({ error: 'organization_id and domain_id are required' }, 400);
      }

      const { data: domain, error: domainErr } = await supabase
        .from('email_sending_domains')
        .select('id, domain, m365_tenant_id, organization_id')
        .eq('id', domain_id)
        .eq('organization_id', organization_id)
        .single<DomainRow>();
      if (domainErr || !domain) return jsonResponse({ error: 'Domain not found' }, 404);
      if (!domain.m365_tenant_id) return jsonResponse({ error: 'Domain is not an M365 domain' }, 400);

      const { data: tenant } = await supabase
        .from('m365_tenants')
        .select('tenant_id')
        .eq('id', domain.m365_tenant_id)
        .single();
      if (!tenant?.tenant_id) return jsonResponse({ error: 'M365 tenant not found' }, 404);

      // EXO InvokeCommand → Get-DkimSigningConfig (read-only cmdlet)
      const exoToken = await getEXOToken(tenant.tenant_id as string);
      const invRes = await fetch(
        `https://outlook.office365.com/adminapi/beta/${tenant.tenant_id}/InvokeCommand`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${exoToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            CmdletInput: { CmdletName: 'Get-DkimSigningConfig', Parameters: { Identity: domain.domain } },
          }),
        }
      );
      if (!invRes.ok) {
        return jsonResponse({ error: `Get-DkimSigningConfig failed (${invRes.status}): ${await invRes.text()}` }, 500);
      }
      const invData = await invRes.json();
      const cfg = (invData?.value?.[0] ?? null) as Record<string, unknown> | null;
      if (!cfg) {
        return jsonResponse({
          domain: domain.domain,
          signing: false,
          diagnosis: 'No DkimSigningConfig returned — DKIM signing is NOT configured in Exchange for this domain. Outbound mail is unsigned.',
        });
      }

      const enabled = cfg['Enabled'] === true;
      const status = cfg['Status'] as string | undefined;
      const signing = enabled && status === 'Valid';
      return jsonResponse({
        domain: domain.domain,
        signing,
        exo_enabled: enabled,
        exo_status: status ?? null,
        selector1_cname: cfg['Selector1CNAME'] ?? null,
        selector2_cname: cfg['Selector2CNAME'] ?? null,
        diagnosis: signing
          ? 'DKIM is enabled and Valid — outbound mail is signed. This is NOT the cause of the bare-address display.'
          : `DKIM is NOT actively signing (Enabled=${enabled}, Status=${status ?? 'unknown'}). Outbound mail goes out unsigned → fails DKIM at receivers → Gmail distrusts the From name. Re-enable DKIM signing in Exchange.`,
      });
    }

    // ── convert_one ───────────────────────────────────────────────────
    // Convert a single mailbox. Use this to validate the flow (and Plusvibe
    // reconnection) before running bulk_convert.
    if (action === 'convert_one') {
      const { organization_id, mailbox_id, dry_run } = body;
      if (!organization_id || !mailbox_id) {
        return jsonResponse({ error: 'organization_id and mailbox_id are required' }, 400);
      }

      const { data: mailbox, error: mbErr } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, sending_domain_id, status')
        .eq('id', mailbox_id)
        .eq('organization_id', organization_id)
        .single<MailboxRow>();
      if (mbErr || !mailbox) return jsonResponse({ error: 'Mailbox not found' }, 404);

      const { exoToken, tenantId } = await resolveExoToken(supabase, mailbox);
      const result = await convertOne(exoToken, tenantId, mailbox.email_address, !!dry_run);
      return jsonResponse({ mailbox_id: mailbox.id, email: mailbox.email_address, ...result });
    }

    // ── bulk_convert ──────────────────────────────────────────────────
    // Convert all mailboxes for a domain (or whole org). dry_run=true reports
    // what would change without mutating anything.
    if (action === 'bulk_convert') {
      const { organization_id, domain_id, dry_run, offset, limit } = body;
      if (!organization_id) {
        return jsonResponse({ error: 'organization_id is required' }, 400);
      }

      const startOffset = typeof offset === 'number' ? offset : 0;
      const pageLimit = typeof limit === 'number' ? limit : 50;

      let mailboxQuery = supabase
        .from('email_mailboxes')
        .select('id, email_address, organization_id, sending_domain_id, status')
        .eq('organization_id', organization_id)
        .order('email_address')
        .range(startOffset, startOffset + pageLimit - 1);
      if (domain_id) mailboxQuery = mailboxQuery.eq('sending_domain_id', domain_id);
      const { data: mailboxes, error: mbErr } = await mailboxQuery;
      if (mbErr) return jsonResponse({ error: mbErr.message }, 500);
      if (!mailboxes || mailboxes.length === 0) {
        return jsonResponse({ total: 0, results: [] });
      }

      // Group mailboxes by tenant to amortize token acquisition.
      const tokenCache = new Map<string, { exoToken: string; tenantId: string }>();
      const resolveTokenFor = async (mailbox: MailboxRow) => {
        const key = mailbox.sending_domain_id || '';
        if (!tokenCache.has(key)) {
          const resolved = await resolveExoToken(supabase, mailbox);
          tokenCache.set(key, resolved);
        }
        return tokenCache.get(key)!;
      };

      const results: Array<{
        mailbox_id: string;
        email: string;
        before: string | null;
        after: string | null;
        changed: boolean;
        dry_run: boolean;
        error?: string;
      }> = [];

      for (const mb of mailboxes as MailboxRow[]) {
        try {
          const { exoToken, tenantId } = await resolveTokenFor(mb);
          // skipVerify=true: bulk mode trusts PATCH 200 and relies on a
          // follow-up list_candidates to verify the whole batch at once.
          const r = await convertOne(exoToken, tenantId, mb.email_address, !!dry_run, true);
          results.push({ mailbox_id: mb.id, email: mb.email_address, ...r });
        } catch (e) {
          results.push({
            mailbox_id: mb.id,
            email: mb.email_address,
            before: null,
            after: null,
            changed: false,
            dry_run: !!dry_run,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        // Light pacing — EXO tolerates this fine.
        await new Promise((r) => setTimeout(r, 50));
      }

      return jsonResponse({
        dry_run: !!dry_run,
        offset: startOffset,
        limit: pageLimit,
        total: results.length,
        changed: results.filter((r) => r.changed).length,
        already_shared: results.filter((r) => r.before === 'SharedMailbox').length,
        errors: results.filter((r) => r.error).length,
        results,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const isM365 = e instanceof M365Error;
    console.error('[Convert to Shared] Error:', e);
    return jsonResponse(
      {
        error: e instanceof Error ? e.message : String(e),
        code: isM365 ? (e as M365Error).code : undefined,
      },
      500
    );
  }
});
