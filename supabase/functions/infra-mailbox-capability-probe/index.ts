/**
 * Mailbox Capability Probe — read-only, sends no mail.
 *
 * `status='ready' AND imap_connected` is what ACA BELIEVES about a mailbox, not
 * proof it can send or receive. This asks Microsoft directly, per mailbox:
 *
 *   token      the tenant issues an app token at all
 *   mail_send  the ACA app holds the Graph Mail.Send application role
 *   user       m365_user_id resolves to a real account, and it is enabled
 *   mailbox    the account has an Exchange mailbox whose Inbox is readable
 *
 *   can_send    = token && mail_send && user && enabled && mailbox
 *   can_receive = token && user && mailbox   (the poller reads the Inbox)
 *
 * The tenant is resolved EXACTLY as the live sender resolves it —
 * m365_tenants by (organization_id, admin_email) — NOT from the sending domain.
 * connection_retest resolves from the domain, and the two can disagree; probing
 * the domain's tenant would test a path the sender never takes.
 *
 * Proves a mailbox is CONFIGURED to send and receive. It cannot prove a message
 * lands in a recipient's inbox — only a real round-trip does that.
 *
 * Results are written to metadata.capability_probe for aggregation in SQL.
 *
 * It also ACTS on exactly one finding, because nothing else catches it: a tenant
 * whose ACA app lacks the Mail.Send application role. Those mailboxes read
 * `ready` + connected, get picked by the auto pool, fall back to SMTP (where a
 * 535 is deliberately ignored on the assumption Graph works) and fail silently
 * on every send without ever being benched. So:
 *   ready  + tenant definitively missing Mail.Send -> paused (tenant_mail_send_missing)
 *   paused (tenant_mail_send_missing) + can_send   -> released
 * Only a DEFINITIVE `mail_send === false` benches — an undetermined role check
 * never does. Every other failure is recorded, not acted on.
 *
 * Body: { limit?: number, offset?: number, mailbox_ids?: uuid[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  getM365Token,
  checkSendAppRole,
  GRAPH_MAIL_SEND_ROLE_ID,
} from '../_shared/m365-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GRAPH = 'https://graph.microsoft.com/v1.0';
const CONCURRENCY = 10;

interface TenantState {
  token: string | null;
  tokenError: string | null;
  mailSend: boolean | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Callers: the capability-probe cron (vault service key) and infra-domain-move (service key).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const body = await req.json().catch(() => ({}));
  const limit: number = Math.min(body.limit ?? 250, 500);
  const offset: number = body.offset ?? 0;

  let q = supabase
    .from('email_mailboxes')
    .select('id, email_address, organization_id, metadata, status')
    .eq('connection_type', 'm365')
    // Ready+connected mailboxes, plus the ones this probe benched — otherwise a
    // tenant that gets re-consented could never come back on its own.
    // Record capability for paused and warming mailboxes too: warmup still uses
    // them as recipients and repliers, and a paused mailbox on a tenant without
    // Mail.Send produced a wall of "Access is denied" replies because nothing had
    // ever recorded that it cannot send. Benching below still only touches ready.
    .in('status', ['ready', 'paused', 'warming'])
    .order('id', { ascending: true });
  q = body.mailbox_ids?.length ? q.in('id', body.mailbox_ids) : q.range(offset, offset + limit - 1);

  const { data: mailboxes, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const tenantCache = new Map<string, Promise<TenantState>>();

  // Mirrors resolveM365TenantId in workers/sequence-sender/src/index.ts.
  async function tenantFor(orgId: string, adminEmail: string): Promise<TenantState & { tenantId: string | null }> {
    const key = `${orgId}|${adminEmail}`;
    if (!tenantCache.has(key)) {
      tenantCache.set(key, (async (): Promise<TenantState> => {
        const { data } = await supabase
          .from('m365_tenants')
          .select('tenant_id')
          .eq('organization_id', orgId)
          .eq('admin_email', adminEmail)
          .maybeSingle();
        const tenantId = (data?.tenant_id as string | undefined) ?? null;
        if (!tenantId) return { token: null, tokenError: 'no m365_tenants row for (org, admin_email)', mailSend: null };
        try {
          const token = await getM365Token(tenantId);
          const role = await checkSendAppRole(token, GRAPH_MAIL_SEND_ROLE_ID);
          return { token, tokenError: null, mailSend: role.consented };
        } catch (err) {
          return { token: null, tokenError: err instanceof Error ? err.message : 'token failed', mailSend: null };
        }
      })());
    }
    const state = await tenantCache.get(key)!;
    return { ...state, tenantId: null };
  }

  async function probe(mb: { id: string; email_address: string; organization_id: string; metadata: Record<string, unknown> | null; status: string }) {
    const meta = mb.metadata ?? {};
    const userId = meta.m365_user_id as string | undefined;
    const adminEmail = meta.m365_admin_email as string | undefined;

    const result: Record<string, unknown> = { checked_at: new Date().toISOString() };

    if (!userId || !adminEmail) {
      Object.assign(result, { can_send: false, can_receive: false, reason: 'missing m365_user_id or m365_admin_email' });
      return { id: mb.id, result };
    }

    const t = await tenantFor(mb.organization_id, adminEmail);
    result.token = !!t.token;
    result.mail_send = t.mailSend;
    if (!t.token) {
      Object.assign(result, { can_send: false, can_receive: false, reason: `tenant: ${t.tokenError}` });
      return { id: mb.id, result };
    }

    const auth = { headers: { Authorization: `Bearer ${t.token}` } };
    const u = encodeURIComponent(userId);

    const userRes = await fetch(`${GRAPH}/users/${u}?$select=id,accountEnabled,userPrincipalName`, auth);
    if (!userRes.ok) {
      const txt = (await userRes.text()).slice(0, 160);
      Object.assign(result, { user: false, can_send: false, can_receive: false, reason: `user ${userRes.status}: ${txt}` });
      return { id: mb.id, result };
    }
    const user = await userRes.json();
    result.user = true;
    result.account_enabled = user.accountEnabled === true;

    const inboxRes = await fetch(`${GRAPH}/users/${u}/mailFolders/inbox?$select=id,totalItemCount`, auth);
    result.mailbox = inboxRes.ok;
    if (!inboxRes.ok) {
      const txt = (await inboxRes.text()).slice(0, 160);
      result.reason = `inbox ${inboxRes.status}: ${txt}`;
    }

    result.can_receive = result.mailbox === true;
    result.can_send =
      result.mailbox === true && result.account_enabled === true && t.mailSend === true;

    if (!result.reason && !result.can_send) {
      result.reason = !result.account_enabled
        ? 'account disabled'
        : t.mailSend === false
        ? 'tenant missing Mail.Send application role'
        : 'mail_send undetermined';
    }
    return { id: mb.id, result };
  }

  const rows = (mailboxes ?? []) as Array<{ id: string; email_address: string; organization_id: string; metadata: Record<string, unknown> | null; status: string }>;
  const statusById = new Map(rows.map((r) => [r.id, r.status]));
  const pausedReasonById = new Map(rows.map((r) => [r.id, (r.metadata ?? {}).paused_reason as string | undefined]));
  const results: Array<{ id: string; result: Record<string, unknown> }> = [];
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const settled = await Promise.all(rows.slice(i, i + CONCURRENCY).map((mb) => probe(mb).catch((err) => ({
      id: mb.id,
      result: { checked_at: new Date().toISOString(), can_send: false, can_receive: false, reason: `probe error: ${err instanceof Error ? err.message : err}` },
    }))));
    results.push(...settled);
  }

  let benched = 0;
  let released = 0;
  const releasedMailboxIds: string[] = [];

  // Key-scoped writes — never read-modify-write the whole metadata blob.
  for (let i = 0; i < results.length; i += CONCURRENCY) {
    await Promise.all(results.slice(i, i + CONCURRENCY).map(async (r) => {
      const status = statusById.get(r.id);
      const missingMailSend = r.result.mail_send === false;
      const now = new Date().toISOString();

      if (status === 'ready' && missingMailSend) {
        await supabase.rpc('apply_mailbox_metadata_patch', {
          p_id: r.id,
          p_set: { capability_probe: r.result, paused_reason: 'tenant_mail_send_missing', paused_at: now },
          p_unset: [],
        });
        await supabase.from('email_mailboxes')
          .update({ status: 'paused', updated_at: now })
          .eq('id', r.id).eq('status', 'ready');
        benched++;
      } else if (
        status === 'paused' &&
        r.result.can_send === true &&
        // ONLY the pause this probe owns. It now reads every paused mailbox, and a
        // config check passing proves nothing about a manual pause, a burned
        // domain, or a tenant Microsoft blocks outbound (that tenant still holds
        // Mail.Send and has a readable inbox).
        pausedReasonById.get(r.id) === 'tenant_mail_send_missing'
      ) {
        await supabase.rpc('apply_mailbox_metadata_patch', {
          p_id: r.id,
          p_set: { capability_probe: r.result, released_at: now, released_from: 'tenant_mail_send_missing' },
          p_unset: ['paused_reason', 'paused_at'],
        });
        await supabase.from('email_mailboxes')
          .update({ status: 'ready', last_error: null, updated_at: now })
          .eq('id', r.id).eq('status', 'paused');
        released++;
        releasedMailboxIds.push(r.id);
      } else {
        await supabase.rpc('apply_mailbox_metadata_patch', {
          p_id: r.id,
          p_set: { capability_probe: r.result },
          p_unset: [],
        });
      }
    }));
  }

  // A domain probed while its tenant could not send reads "No health evidence"
  // until its next scheduled probe. Now that its mailboxes can send again, make
  // it due so the next probe run measures it instead of waiting out the cadence.
  if (releasedMailboxIds.length) {
    const { data: freed } = await supabase
      .from('email_mailboxes')
      .select('sending_domain_id')
      .in('id', releasedMailboxIds);
    const domainIds = [...new Set((freed ?? []).map((m) => m.sending_domain_id as string).filter(Boolean))];
    if (domainIds.length) {
      await supabase
        .from('email_sending_domains')
        .update({ next_probe_at: new Date().toISOString() })
        .in('id', domainIds)
        .in('health_status', ['unknown']);
    }
  }

  return new Response(JSON.stringify({
    success: true,
    probed: results.length,
    can_send: results.filter((r) => r.result.can_send === true).length,
    can_receive: results.filter((r) => r.result.can_receive === true).length,
    benched,
    released,
    next_offset: body.mailbox_ids?.length ? null : (rows.length === limit ? offset + limit : null),
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
