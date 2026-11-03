/**
 * REST resource: /v1/network (ACA Network, open-source plan Phase 1b)
 *
 *   GET    /v1/network/mailboxes                list the org's mailboxes, keyset-paginated
 *   GET    /v1/network/mailboxes/{id}           fetch one
 *   POST   /v1/network/mailboxes/connect        bring an existing SMTP/IMAP mailbox into warmup
 *   PATCH  /v1/network/mailboxes/{id}           warmup on/off, display name, new credentials
 *   DELETE /v1/network/mailboxes/{id}           remove the mailbox and its stored credentials
 *   GET    /v1/network/mailboxes/{id}/warmup    warmup sends, placement, rescues, replies
 *
 * Path segments arrive as ?resource=, ?action= and ?id= from the Vercel proxy.
 *
 * Who can call it: an `aca_` token with the `network` scope (only issued to orgs
 * whose network_status is approved), or a signed-in session. The scope is
 * checked by createResource; the org's status is re-checked on every request
 * here, because a token keeps its scopes after the org is suspended.
 *
 * Mailboxes connected here are ordinary email_mailboxes rows, so the warmup
 * engine treats them like any other: up to 3 sends, 3 receives and 2 replies a
 * day. Cloud never sends cold mail through a self-hosted install's mailbox, so
 * daily_sent stays 0 there and the engine's headroom check is a no-op; the
 * install keeps its own cold volume 3 under daily_limit.
 *
 * Inbox sync. For a network_only org (a self-hosted install) the row is saved
 * with imap_connected = false. Warmup does not read that flag (partner choice,
 * send and receive ticks all ignore it), but the reply pollers and the Cloud
 * sequence sender do, so Cloud reads only its own warmup mail and never copies
 * the install's prospect replies into crm_conversations. Hosted orgs get
 * imap_connected = true, as when connecting a mailbox in the dashboard.
 */

import {
  ApiError,
  createResource,
  json,
  parseLimit,
  decodeCursor,
  paginated,
  requireUuid,
} from '../_shared/rest-api.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { AuthenticatedCaller } from '../_shared/cli-auth.ts';
import {
  testSMTPConnection,
  testIMAPConnection,
  encryptCredentials,
  extractSMTPCredentials,
  type SMTPCredentials,
} from '../_shared/smtp-client.ts';

// One literal (not concatenated) so supabase-js can type the rows it returns.
const MAILBOX_COLUMNS = 'id, email_address, display_name, provider, connection_type, status, imap_connected, warmup_enabled, warmup_day, warmup_start_date, warmup_sends_total, warmup_delivered_total, warmup_last_send_at, daily_limit, health_score, last_error, metadata, created_at, updated_at';

const DEFAULT_WARMUP_DAYS = 30;
const MAX_WARMUP_DAYS = 90;
const RECENT_SENDS = 20;

// The service client is untyped (no generated Database types in edge functions),
// so rows come back loosely typed either way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

interface NetworkOrg {
  id: string;
  network_only: boolean;
}

/** The caller's org, if it may use the network right now. */
async function requireNetworkOrg(supabase: SupabaseClient, caller: AuthenticatedCaller): Promise<NetworkOrg> {
  if (!caller.organization_id) {
    throw new ApiError('This endpoint acts on one organization; call it with an org token.', 403);
  }
  const { data: org, error } = await supabase
    .from('organizations')
    .select('id, network_status, network_only')
    .eq('id', caller.organization_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!org) throw new ApiError('Organization not found', 404);
  if (org.network_status !== 'approved') {
    const why = org.network_status === 'none'
      ? 'has not applied for ACA Network access (Settings → ACA Network)'
      : `has ACA Network status "${org.network_status}"`;
    throw new ApiError(`This organization ${why}.`, 403);
  }
  return { id: org.id, network_only: !!org.network_only };
}

/** Public shape: no credentials, no raw metadata. */
function toMailbox(row: Row) {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    email_address: row.email_address,
    display_name: row.display_name,
    provider: row.provider,
    connection_type: row.connection_type,
    status: row.status,
    inbox_sync: !!row.imap_connected,
    warmup_enabled: !!row.warmup_enabled,
    warmup_day: row.warmup_day ?? 0,
    warmup_start_date: row.warmup_start_date,
    warmup_sends_total: row.warmup_sends_total ?? 0,
    warmup_delivered_total: row.warmup_delivered_total ?? 0,
    warmup_last_send_at: row.warmup_last_send_at,
    daily_limit: row.daily_limit,
    health_score: row.health_score,
    smtp_host: meta.smtp_host ?? null,
    imap_host: meta.imap_host ?? null,
    last_error: row.last_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchMailbox(supabase: SupabaseClient, orgId: string, id: string) {
  const { data, error } = await supabase
    .from('email_mailboxes')
    .select(MAILBOX_COLUMNS)
    .eq('organization_id', orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ApiError('Mailbox not found', 404);
  return data;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function port(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new ApiError('port must be an integer from 1 to 65535');
  return n;
}

function section(body: Record<string, unknown>, key: 'smtp' | 'imap'): Record<string, unknown> {
  const v = body[key];
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new ApiError(`${key} must be an object`);
  return v as Record<string, unknown>;
}

/** Test both connections before anything is stored, and say which one failed. */
async function testConnections(creds: SMTPCredentials) {
  const smtp = await testSMTPConnection(creds);
  if (!smtp.success) throw new ApiError(`SMTP connection failed: ${smtp.error}`, 422);
  const imap = await testIMAPConnection(creds);
  if (!imap.success) throw new ApiError(`IMAP connection failed: ${imap.error}`, 422);
}

function credentialMetadata(creds: SMTPCredentials, encrypted: string) {
  return {
    smtp_credentials: encrypted,
    smtp_host: creds.smtp_host,
    smtp_port: creds.smtp_port,
    imap_host: creds.imap_host || null,
    imap_port: creds.imap_port || null,
  };
}

function detectProvider(email: string): 'gmail' | 'outlook' | 'smtp' {
  const domain = email.split('@')[1]?.toLowerCase() || '';
  if (domain.includes('gmail') || domain.includes('googlemail')) return 'gmail';
  if (domain.includes('outlook') || domain.includes('hotmail') || domain.includes('live') || domain.includes('microsoft')) return 'outlook';
  return 'smtp';
}

/* ── Handlers ─────────────────────────────────────────────────────── */

async function listMailboxes(url: URL, supabase: SupabaseClient, org: NetworkOrg) {
  const limit = parseLimit(url);
  const cursor = decodeCursor(url);
  let query = supabase
    .from('email_mailboxes')
    .select(MAILBOX_COLUMNS)
    .eq('organization_id', org.id)
    .order('id', { ascending: true })
    .limit(limit + 1);
  if (cursor) query = query.gt('id', cursor);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const page = paginated((data ?? []) as Row[], limit, 'id');
  return json({ success: true, ...page, data: page.data.map(toMailbox) });
}

async function warmupReport(url: URL, supabase: SupabaseClient, org: NetworkOrg, id: string) {
  const mailbox = await fetchMailbox(supabase, org.id, id);

  const rawDays = url.searchParams.get('days');
  const days = rawDays ? Number.parseInt(rawDays, 10) : DEFAULT_WARMUP_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_WARMUP_DAYS) {
    throw new ApiError(`days must be an integer from 1 to ${MAX_WARMUP_DAYS}`);
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { data: outbound, error: outErr } = await supabase
    .from('email_warmup_sends')
    .select('status, placement, rescued_at, replied_at, is_reply, transport, sent_at, created_at, error')
    .eq('from_mailbox_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (outErr) throw new Error(outErr.message);

  const { count: repliesReceived, error: repErr } = await supabase
    .from('email_warmup_sends')
    .select('id', { count: 'exact', head: true })
    .eq('to_mailbox_id', id)
    .eq('is_reply', true)
    .gte('created_at', since);
  if (repErr) throw new Error(repErr.message);

  // Same definitions as the dashboard's warmup tab (useMailboxWarmup).
  const rows = (outbound ?? []) as Row[];
  const delivered = rows.filter((r) => r.status === 'delivered');
  const inbox = delivered.filter((r) => r.placement === 'inbox').length;
  const junk = delivered.filter((r) => r.placement === 'junk').length;

  return json({
    success: true,
    data: {
      mailbox_id: id,
      warmup_enabled: !!mailbox.warmup_enabled,
      warmup_day: mailbox.warmup_day ?? 0,
      daily_limit: mailbox.daily_limit,
      window_days: days,
      stats: {
        sent: rows.filter((r) => r.status !== 'failed').length,
        delivered: delivered.length,
        inbox,
        junk,
        rescued: rows.filter((r) => r.rescued_at).length,
        replies_sent: rows.filter((r) => r.is_reply && r.status !== 'failed').length,
        replies_received: repliesReceived ?? 0,
        failed: rows.filter((r) => r.status === 'failed').length,
        // Share of verified deliveries that reached the inbox; null until one is checked.
        inbox_rate: inbox + junk > 0 ? inbox / (inbox + junk) : null,
      },
      recent: rows.slice(0, RECENT_SENDS).map((r) => ({
        status: r.status,
        placement: r.placement,
        is_reply: !!r.is_reply,
        rescued_at: r.rescued_at,
        sent_at: r.sent_at,
        error: r.error,
      })),
    },
  });
}

async function connectMailbox(supabase: SupabaseClient, org: NetworkOrg, body: Record<string, unknown>) {
  const email = str(body.email ?? body.email_address).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError('email must be a valid email address');

  const smtp = section(body, 'smtp');
  const imap = section(body, 'imap');
  const creds: SMTPCredentials = {
    smtp_host: str(smtp.host),
    smtp_port: port(smtp.port, 587),
    smtp_username: str(smtp.username) || email,
    smtp_password: typeof smtp.password === 'string' ? smtp.password : '',
    imap_host: str(imap.host),
    imap_port: port(imap.port, 993),
    // Most providers use one login for both; only ask for it twice when they differ.
    imap_username: str(imap.username) || str(smtp.username) || email,
    imap_password: typeof imap.password === 'string' && imap.password
      ? imap.password
      : (typeof smtp.password === 'string' ? smtp.password : ''),
  };
  if (!creds.smtp_host || !creds.smtp_password) {
    throw new ApiError('smtp.host and smtp.password are required');
  }
  if (!creds.imap_host) {
    throw new ApiError('imap.host is required: warmup checks inbox placement and rescues mail from spam over IMAP');
  }

  const warmupEnabled = body.warmup_enabled === undefined ? true : body.warmup_enabled === true;
  if (body.warmup_enabled !== undefined && typeof body.warmup_enabled !== 'boolean') {
    throw new ApiError('warmup_enabled must be a boolean');
  }

  // A plain upsert would turn an existing M365 or Postal mailbox into SMTP and
  // replace its whole metadata (capability probe, pause reasons, Graph ids).
  const { data: existing, error: findErr } = await supabase
    .from('email_mailboxes')
    .select(MAILBOX_COLUMNS)
    .eq('organization_id', org.id)
    .eq('email_address', email)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing && existing.connection_type !== 'smtp') {
    throw new ApiError(
      `${email} is already connected to this organization as a ${existing.connection_type} mailbox (id ${existing.id}).`,
      409,
    );
  }

  await testConnections(creds);
  const encrypted = await encryptCredentials(creds);
  const now = new Date().toISOString();
  const fields = {
    display_name: str(body.display_name) || existing?.display_name || null,
    status: 'ready',
    // See the header: self-hosted installs keep their inbox to themselves.
    imap_connected: !org.network_only,
    warmup_enabled: warmupEnabled,
    metadata: {
      ...(existing?.metadata ?? {}),
      ...credentialMetadata(creds, encrypted),
      network_connected_at: now,
    },
    updated_at: now,
  };

  const { data, error } = existing
    ? await supabase
      .from('email_mailboxes')
      .update({ ...fields, last_error: null })
      .eq('id', existing.id)
      .select(MAILBOX_COLUMNS)
      .single()
    : await supabase
      .from('email_mailboxes')
      // Same starting values as connecting an SMTP mailbox in the dashboard (mailbox-connect).
      .insert({
        ...fields,
        organization_id: org.id,
        email_address: email,
        provider: detectProvider(email),
        connection_type: 'smtp',
        warmup_start_date: null,
        warmup_day: 0,
        daily_limit: 30,
        daily_sent: 0,
        health_score: 1.0,
      })
      .select(MAILBOX_COLUMNS)
      .single();
  if (error) throw new Error(`Failed to save mailbox: ${error.message}`);

  return json({ success: true, data: toMailbox(data) }, existing ? 200 : 201);
}

async function updateMailbox(supabase: SupabaseClient, org: NetworkOrg, id: string, body: Record<string, unknown>) {
  const mailbox = await fetchMailbox(supabase, org.id, id);
  const updates: Record<string, unknown> = {};

  if (body.warmup_enabled !== undefined) {
    if (typeof body.warmup_enabled !== 'boolean') throw new ApiError('warmup_enabled must be a boolean');
    updates.warmup_enabled = body.warmup_enabled;
  }
  if (body.display_name !== undefined) {
    if (body.display_name !== null && typeof body.display_name !== 'string') {
      throw new ApiError('display_name must be a string or null');
    }
    updates.display_name = str(body.display_name) || null;
  }

  const smtp = section(body, 'smtp');
  const imap = section(body, 'imap');
  if (Object.keys(smtp).length || Object.keys(imap).length) {
    if (mailbox.connection_type !== 'smtp') {
      throw new ApiError(`Credentials can only be changed on SMTP mailboxes, not ${mailbox.connection_type}`, 409);
    }
    // Merge with what is stored, so rotating one password does not need the rest resent.
    const existing = await extractSMTPCredentials(mailbox.metadata ?? {});
    const creds: SMTPCredentials = {
      smtp_host: str(smtp.host) || existing?.smtp_host || '',
      smtp_port: port(smtp.port, existing?.smtp_port || 587),
      smtp_username: str(smtp.username) || existing?.smtp_username || '',
      smtp_password: (typeof smtp.password === 'string' && smtp.password) || existing?.smtp_password || '',
      imap_host: str(imap.host) || existing?.imap_host || '',
      imap_port: port(imap.port, existing?.imap_port || 993),
      imap_username: str(imap.username) || existing?.imap_username || '',
      imap_password: (typeof imap.password === 'string' && imap.password) || existing?.imap_password || '',
    };
    if (!creds.smtp_host || !creds.smtp_username || !creds.smtp_password ||
        !creds.imap_host || !creds.imap_username || !creds.imap_password) {
      throw new ApiError('The stored credentials are incomplete; send the full smtp and imap objects');
    }
    await testConnections(creds);
    const encrypted = await encryptCredentials(creds);
    const meta = { ...(mailbox.metadata ?? {}) };
    delete meta.imap_auth_error;
    delete meta.imap_auth_failed_at;
    updates.metadata = { ...meta, ...credentialMetadata(creds, encrypted) };
    updates.last_error = null;
  }

  if (Object.keys(updates).length === 0) {
    throw new ApiError('Supply at least one of: warmup_enabled, display_name, smtp, imap');
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('email_mailboxes')
    .update(updates)
    .eq('organization_id', org.id)
    .eq('id', id)
    .select(MAILBOX_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return json({ success: true, data: toMailbox(data) });
}

async function deleteMailbox(supabase: SupabaseClient, org: NetworkOrg, id: string) {
  // delete_email_mailboxes relies on RLS for scoping, which the service client
  // bypasses, so confirm the mailbox is this org's first.
  await fetchMailbox(supabase, org.id, id);
  const { data, error } = await supabase.rpc('delete_email_mailboxes', { p_ids: [id] });
  if (error) {
    // email_sequence_enrollments.mailbox_id is NO ACTION: a mailbox that ever
    // sent a Cloud sequence cannot be hard-deleted.
    if (error.code === '23503') {
      throw new ApiError('This mailbox has sequence enrollments in ACA Cloud. Turn warmup off with PATCH instead.', 409);
    }
    throw new Error(error.message);
  }
  return json({ success: true, deleted: data ?? 0 });
}

Deno.serve(createResource({
  GET: async ({ url, supabase, caller }) => {
    const org = await requireNetworkOrg(supabase, caller);
    const resource = url.searchParams.get('resource');
    const id = url.searchParams.get('id');
    if (resource === 'mailbox_warmup') {
      return warmupReport(url, supabase, org, requireUuid(id, 'id'));
    }
    if (resource !== 'mailboxes') throw new ApiError('Not found', 404);
    if (id) return json({ success: true, data: toMailbox(await fetchMailbox(supabase, org.id, requireUuid(id, 'id'))) });
    return listMailboxes(url, supabase, org);
  },

  POST: async ({ url, supabase, caller, body }) => {
    const org = await requireNetworkOrg(supabase, caller);
    if (url.searchParams.get('resource') === 'mailboxes' && url.searchParams.get('action') === 'connect') {
      return connectMailbox(supabase, org, body);
    }
    throw new ApiError('Not found. To bring a mailbox into warmup, POST /v1/network/mailboxes/connect.', 404);
  },

  PATCH: async ({ url, supabase, caller, body }) => {
    const org = await requireNetworkOrg(supabase, caller);
    if (url.searchParams.get('resource') !== 'mailboxes') throw new ApiError('Not found', 404);
    return updateMailbox(supabase, org, requireUuid(url.searchParams.get('id'), 'id'), body);
  },

  DELETE: async ({ url, supabase, caller }) => {
    const org = await requireNetworkOrg(supabase, caller);
    if (url.searchParams.get('resource') !== 'mailboxes') throw new ApiError('Not found', 404);
    return deleteMailbox(supabase, org, requireUuid(url.searchParams.get('id'), 'id'));
  },
}, { scope: 'network' }));
