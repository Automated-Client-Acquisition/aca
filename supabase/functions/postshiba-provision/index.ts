/**
 * postshiba-provision
 *
 * Sets up sending domains and sender identities on an org's PostShiba connection.
 * A PostShiba domain is an email_sending_domains row with infra_type='postshiba'.
 * Actions:
 *   - add_domain:    create the sending domain under the org's tenant and store its
 *                    DKIM / return-path / DMARC records (pushed by
 *                    dns-cloudflare-push-records, or published by hand)
 *   - verify:        re-check the domain; once PostShiba has verified it, create the
 *                    catch-all reply inbox and add its MX record; then check the MX
 *   - remove_domain: disable the inbox, delete the domain in PostShiba, park the senders
 *   - add_senders:   insert email_mailboxes rows that send over the tenant's SMTP credential
 *   - set_daily_volume: mode 'auto' (default for every domain): the cluster's daily cap
 *                    shared across its auto domains, at most senders x sender_cap each
 *                    (postshiba_rebalance_cluster); or mode 'manual' with the domain's own
 *                    emails a day. Either way postshiba_rebalance_domain splits the
 *                    domain's volume across its senders (DB functions; triggers rerun them)
 *   - domain_candidates: the org's Cloudflare zones that add_domain would accept
 *   - replay_inbound: re-send the inbox's stored replies through postshiba-inbound
 *
 * The inbox is created at verify time because PostShiba refuses an inbox host that is
 * not under a verified sending domain, or that already has MX. A domain's senders
 * are sendable (imap_connected) only while it can both receive replies and report
 * bounces: PostShiba approved it, its reply MX resolves, and the connection's
 * events webhook is registered (see sendingReady). Each PostShiba write counts against 60 provisioning writes an hour per key,
 * so verify reads first and only forces a check when something is still pending.
 * `force: false` never forces one: it reads the results of PostShiba's own
 * re-checks (30s, 2m and 5m after a miss), for the page's automatic follow-ups.
 * Plan: tasks/postshiba-integration-2026-10-22.md.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue, decryptValue } from '../_shared/encryption.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { checkFeatureAccess } from '../_shared/featureAccess.ts';
import { encryptCredentials } from '../_shared/smtp-client.ts';
import { resolveMx, verifyDnsRecord } from '../_shared/dns-utils.ts';
import { createCloudflareClient } from '../_shared/cloudflare-client.ts';
import { capsuleSignatureHeaders } from '../_shared/postshiba-webhook.ts';
import {
  createPostShibaClient,
  describePostShibaError,
  PostShibaError,
  type PostShibaInbox,
  type PostShibaSendingDomain,
} from '../_shared/postshiba-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Where PostShiba receives mail for domain-bound inboxes. */
const POSTSHIBA_INBOUND_MX = 'inbound.postshiba.com';
const DEFAULT_SMTP_HOST = 'smtp.postshiba.com';
const DEFAULT_SMTP_PORT = 587;
const MAX_SENDERS_PER_CALL = 100;
/** Only for the per-sender limit the previous page version sends. */
const MAX_DAILY_LIMIT = 500;
const MAX_DOMAIN_VOLUME_FALLBACK = 100_000;

const INFRA_LABELS: Record<string, string> = {
  m365: 'a Microsoft 365',
  acs: 'an Azure Communication Services',
  byo: 'a bring-your-own-server',
  postal: 'a Postal',
};

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const LOCAL_PART_RE = /^[a-z0-9](?:[a-z0-9._+-]{0,62}[a-z0-9])?$/;

const DOMAIN_COLUMNS =
  'id, organization_id, domain, infra_type, dns_records, dns_status, dkim_verified, dmarc_verified, mx_verified, ' +
  'dkim_selector, dns_managed, cloudflare_zone_id, mailbox_count, last_dns_check_at, created_at, ' +
  'postshiba_connection_id, postshiba_domain_id, postshiba_sending_allowed, postshiba_return_path_verified, ' +
  'postshiba_inbox_id, postshiba_inbox_host, postshiba_inbox_mx_status, postshiba_inbox_token, postshiba_last_error, ' +
  'postshiba_inbox_secret_encrypted, ' +
  'postshiba_daily_volume, postshiba_volume_mode, postshiba_sender_cap';

type DnsRecord = { type: 'CNAME' | 'TXT' | 'MX'; name: string; value: string; ttl: number; priority?: number; description: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// deno-lint-ignore no-explicit-any
function publicDomain(row: any) {
  return {
    id: row.id,
    domain: row.domain,
    dns_records: row.dns_records ?? [],
    dns_status: row.dns_status,
    dns_managed: row.dns_managed,
    dkim_verified: row.dkim_verified,
    dmarc_verified: row.dmarc_verified,
    return_path_verified: row.postshiba_return_path_verified,
    sending_allowed: row.postshiba_sending_allowed,
    inbox_created: !!row.postshiba_inbox_id,
    inbox_host: row.postshiba_inbox_host,
    inbox_mx_status: row.postshiba_inbox_mx_status,
    mx_verified: row.mx_verified,
    mailbox_count: row.mailbox_count,
    last_dns_check_at: row.last_dns_check_at,
    last_error: row.postshiba_last_error,
    daily_volume: row.postshiba_daily_volume ?? null,
    volume_mode: row.postshiba_volume_mode ?? 'auto',
    sender_cap: row.postshiba_sender_cap ?? 500,
    created_at: row.created_at,
  };
}

/** PostShiba's per-record statuses read "pending" until DNS checks out. */
function isVerified(status: string | null | undefined): boolean {
  return ['verified', 'valid', 'active', 'ok', 'passed'].includes((status ?? '').toLowerCase());
}

function normalizeDomain(input: unknown): string {
  return typeof input === 'string'
    ? input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '')
    : '';
}

function sendingRecords(sd: PostShibaSendingDomain): DnsRecord[] {
  const records: DnsRecord[] = [];
  if (!sd.dkim_manual && sd.dkim_cname_host && sd.dkim_cname_target) {
    records.push({ type: 'CNAME', name: sd.dkim_cname_host, value: sd.dkim_cname_target, ttl: 3600, description: 'PostShiba DKIM' });
  }
  if (sd.return_path_host && sd.return_path_target) {
    records.push({ type: 'CNAME', name: sd.return_path_host, value: sd.return_path_target, ttl: 3600, description: 'PostShiba return path (bounces, SPF alignment)' });
  }
  if (sd.dmarc_host && sd.dmarc_record) {
    records.push({ type: 'TXT', name: sd.dmarc_host, value: sd.dmarc_record, ttl: 3600, description: 'DMARC' });
  }
  return records;
}

function sendingDomainColumns(sd: PostShibaSendingDomain) {
  return {
    dkim_selector: sd.dkim_selector,
    dkim_verified: isVerified(sd.dkim_status),
    dmarc_verified: isVerified(sd.dmarc_status),
    postshiba_return_path_verified: isVerified(sd.return_path_status),
    postshiba_sending_allowed: !!sd.sending_allowed && !sd.suspended,
  };
}

function parseSmtpEndpoint(endpoint: string | null): { host: string; port: number } {
  const [host, port] = (endpoint ?? '').split(':');
  const parsedPort = parseInt(port ?? '', 10);
  return {
    host: host || DEFAULT_SMTP_HOST,
    port: Number.isFinite(parsedPort) ? parsedPort : DEFAULT_SMTP_PORT,
  };
}

// deno-lint-ignore no-explicit-any
async function clientFor(connection: any) {
  return createPostShibaClient(await decryptValue(connection.api_key_encrypted), connection.team_id);
}

// deno-lint-ignore no-explicit-any
async function loadDomain(supabase: SupabaseClient, organizationId: string, domainId: unknown): Promise<any | null> {
  if (typeof domainId !== 'string' || !domainId) return null;
  const { data, error } = await supabase
    .from('email_sending_domains')
    .select(DOMAIN_COLUMNS)
    .eq('id', domainId)
    .eq('organization_id', organizationId)
    .eq('infra_type', 'postshiba')
    .maybeSingle();
  if (error) throw new Error(`Domain lookup failed: ${error.message}`);
  return data;
}

// deno-lint-ignore no-explicit-any
async function addDomain(supabase: SupabaseClient, connection: any, rawDomain: unknown) {
  const organizationId = connection.organization_id;
  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN_RE.test(domain)) {
    return json({ error: 'Enter a domain like acme-mail.com.', error_code: 'invalid_domain' }, 400);
  }

  const { data: existingRow } = await supabase
    .from('email_sending_domains')
    .select(DOMAIN_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('domain', domain)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const existing = existingRow as any;
  if (existing && existing.infra_type !== 'postshiba') {
    return json({
      error: `${domain} is already set up in ACA as ${INFRA_LABELS[existing.infra_type] ?? `a ${existing.infra_type}`} domain. Remove it there first, or use another domain.`,
      error_code: 'domain_in_use',
    }, 409);
  }
  if (existing?.postshiba_domain_id) return json({ ok: true, domain: publicDomain(existing) });

  // Replies land on a catch-all inbox at the domain itself, so the domain must not
  // already receive mail somewhere else (PostShiba also refuses a host with MX).
  const { count: otherMailboxes } = await supabase
    .from('email_mailboxes')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .neq('connection_type', 'postshiba')
    .ilike('email_address', `%@${domain}`); // DOMAIN_RE admits no LIKE wildcards
  if (otherMailboxes) {
    return json({
      error: `${domain} already has ${otherMailboxes} mailbox${otherMailboxes === 1 ? '' : 'es'} in ACA. Use a domain dedicated to PostShiba.`,
      error_code: 'domain_in_use',
    }, 409);
  }
  const mx = await resolveMx(domain);
  const foreignMx = mx.filter((host) => host !== POSTSHIBA_INBOUND_MX);
  if (foreignMx.length > 0) {
    return json({
      error: `${domain} already receives mail at ${foreignMx[0]}, so replies would go there instead of ACA. Use a domain with no mailboxes, or remove its MX records first.`,
      error_code: 'domain_has_mx',
    }, 409);
  }

  const client = await clientFor(connection);
  let sd: PostShibaSendingDomain;
  try {
    sd = await client.createSendingDomain(domain, connection.tenant_id);
  } catch (err) {
    // A retry after a failed save: the domain already exists under this tenant.
    if (!(err instanceof PostShibaError) || err.status !== 422) throw err;
    const found = (await client.listSendingDomains()).find((d) => d.name === domain);
    if (!found) throw err;
    if (found.tenant_id !== connection.tenant_id) {
      return json({ error: `${domain} belongs to another tenant in this PostShiba team.`, error_code: 'domain_in_use' }, 409);
    }
    sd = found;
  }

  const row = {
    organization_id: organizationId,
    domain,
    infra_type: 'postshiba',
    vm_status: null,
    dns_status: 'pending',
    dns_records: sendingRecords(sd),
    ...sendingDomainColumns(sd),
    postshiba_connection_id: connection.id,
    postshiba_domain_id: sd.id,
    postshiba_inbox_token: existing?.postshiba_inbox_token ?? crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    postshiba_last_error: sd.last_verification_error,
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await supabase
    .from('email_sending_domains')
    .upsert(row, { onConflict: 'organization_id,domain' })
    .select(DOMAIN_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to save domain: ${error.message}`);
  return json({ ok: true, domain: publicDomain(saved) });
}

// deno-lint-ignore no-explicit-any
async function createReplyInbox(client: ReturnType<typeof createPostShibaClient>, connection: any, row: any) {
  const inbox: PostShibaInbox = await client.createInbox({
    name: `ACA replies ${row.domain}`,
    local_part: '*',
    host: row.domain,
    webhook_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/postshiba-inbound/${row.postshiba_inbox_token}`,
    tenant_id: connection.tenant_id,
  });
  if (!inbox.webhook_secret) {
    throw new Error('PostShiba did not return the webhook secret for the new inbox.');
  }
  const mxRecord: DnsRecord = {
    type: 'MX',
    name: inbox.host,
    value: inbox.mx_target || POSTSHIBA_INBOUND_MX,
    priority: 10,
    ttl: 3600,
    description: 'PostShiba catch-all reply inbox',
  };
  const records = ((row.dns_records ?? []) as DnsRecord[]).filter((r) => r.type !== 'MX');
  return {
    postshiba_inbox_id: inbox.id,
    postshiba_inbox_host: inbox.host,
    postshiba_inbox_mx_status: inbox.mx_status,
    postshiba_inbox_secret_encrypted: await encryptValue(inbox.webhook_secret),
    dns_records: [...records, mxRecord],
  };
}

// deno-lint-ignore no-explicit-any
async function verify(supabase: SupabaseClient, connection: any, row: any, force: boolean) {
  const client = await clientFor(connection);
  // deno-lint-ignore no-explicit-any
  const update: Record<string, any> = { last_dns_check_at: new Date().toISOString() };
  const errors: string[] = [];
  let dnsChanged = false;

  let sd = await client.getSendingDomain(row.postshiba_domain_id);
  if (!sd.sending_allowed && force) sd = await client.verifySendingDomain(row.postshiba_domain_id);
  Object.assign(update, sendingDomainColumns(sd));
  if (sd.suspended) errors.push('PostShiba has suspended this domain.');
  else if (sd.last_verification_error) errors.push(sd.last_verification_error);

  let inboxId = row.postshiba_inbox_id as string | null;
  let inboxHost = row.postshiba_inbox_host as string | null;
  let mxStatus = row.postshiba_inbox_mx_status as string | null;
  let mxTarget = POSTSHIBA_INBOUND_MX;

  if (!inboxId && update.postshiba_sending_allowed) {
    try {
      const inbox = await createReplyInbox(client, connection, row);
      Object.assign(update, inbox);
      inboxId = inbox.postshiba_inbox_id;
      inboxHost = inbox.postshiba_inbox_host;
      mxStatus = inbox.postshiba_inbox_mx_status;
      mxTarget = inbox.dns_records.find((r) => r.type === 'MX')?.value ?? mxTarget;
      dnsChanged = true;
    } catch (err) {
      if (!(err instanceof PostShibaError) || err.status !== 422) throw err;
      errors.push(`Reply inbox: ${describePostShibaError(err).error}`);
    }
  } else if (inboxId) {
    let inbox = await client.getInbox(inboxId);
    if (force && !isVerified(inbox.mx_status) && inbox.mx_status !== 'not_required') inbox = await client.verifyInbox(inboxId);
    mxStatus = inbox.mx_status;
    update.postshiba_inbox_mx_status = mxStatus;
    mxTarget = ((row.dns_records ?? []) as DnsRecord[]).find((r) => r.type === 'MX')?.value ?? mxTarget;
  }

  let mxVerified = false;
  if (inboxId && inboxHost && !dnsChanged) {
    const check = await verifyDnsRecord({ type: 'MX', name: inboxHost, value: mxTarget, priority: 10 });
    mxVerified = check.ok || isVerified(mxStatus);
    if (!mxVerified) errors.push(`MX for ${inboxHost} does not point to ${mxTarget} yet.`);
  }
  update.mx_verified = mxVerified;
  update.dns_status = update.postshiba_sending_allowed && mxVerified ? 'verified' : 'pending';
  update.postshiba_last_error = errors.length ? errors.join(' ') : null;

  const { data: saved, error } = await supabase
    .from('email_sending_domains')
    .update(update)
    .eq('id', row.id)
    .select(DOMAIN_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to save verification: ${error.message}`);
  await setDomainSending(supabase, row.id, sendingReady(connection, saved));
  // dns_changed: the MX record was just added, so push DNS again (or publish it by hand).
  return json({ ok: true, dns_changed: dnsChanged, domain: publicDomain(saved) });
}

/**
 * Re-deliver replies PostShiba still holds (it keeps them 168 hours) through
 * postshiba-inbound, signed with the inbox secret exactly like PostShiba's own
 * webhook. For recovering replies that were accepted but not filed. The
 * worker dedupes on Message-ID, so replaying an already-filed reply is a no-op
 * (it only adds attachments the filed copy is missing). The list omits
 * attachment bytes, so a message with attachments is re-read in full.
 */
// deno-lint-ignore no-explicit-any
async function replayInbound(connection: any, row: any) {
  if (!row.postshiba_inbox_id || !row.postshiba_inbox_secret_encrypted || !row.postshiba_inbox_token) {
    return json({ error: 'This domain has no reply inbox yet.', error_code: 'no_inbox' }, 400);
  }
  const client = await clientFor(connection);
  const messages = await client.listInboundMessages(row.postshiba_inbox_id);
  const secret = await decryptValue(row.postshiba_inbox_secret_encrypted);
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/postshiba-inbound/${row.postshiba_inbox_token}`;

  const results: Array<{ id: unknown; status: number }> = [];
  for (const listed of messages) {
    const message = Array.isArray(listed.attachments) && listed.attachments.length > 0
      ? await client.getInboundMessage(row.postshiba_inbox_id, String(listed.id))
      : listed;
    const body = JSON.stringify(message);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await capsuleSignatureHeaders(body, secret)) },
      body,
    });
    results.push({ id: message.id, status: res.status });
  }
  return json({ ok: results.every((r) => r.status < 300), replayed: results });
}

/**
 * Whether a domain's senders may send: PostShiba approved the domain, its reply
 * MX resolves (so replies reach postshiba-inbound), and the connection's events
 * webhook is registered (so bounces and complaints reach postshiba-events).
 */
// deno-lint-ignore no-explicit-any
function sendingReady(connection: any, domain: any): boolean {
  return connection.status === 'active' &&
    !!connection.events_webhook_id &&
    !!domain.postshiba_sending_allowed &&
    !!domain.mx_verified;
}

/** Turn a domain's PostShiba senders' sending on or off (imap_connected gates every send path). */
async function setDomainSending(supabase: SupabaseClient, domainId: string, ready: boolean) {
  const { error } = await supabase
    .from('email_mailboxes')
    .update({ imap_connected: ready, updated_at: new Date().toISOString() })
    .eq('sending_domain_id', domainId)
    .eq('connection_type', 'postshiba')
    .neq('imap_connected', ready);
  if (error) throw new Error(`Failed to update senders: ${error.message}`);
}

// deno-lint-ignore no-explicit-any
async function removeDomain(supabase: SupabaseClient, connection: any | null, row: any) {
  if (connection && (row.postshiba_inbox_id || row.postshiba_domain_id)) {
    const client = await clientFor(connection);
    const ignoreGone = (err: unknown) => {
      if (!(err instanceof PostShibaError) || err.status !== 404) throw err;
    };
    // A live inbox blocks deleting its domain.
    if (row.postshiba_inbox_id) await client.disableInbox(row.postshiba_inbox_id).catch(ignoreGone);
    if (row.postshiba_domain_id) await client.deleteSendingDomain(row.postshiba_domain_id).catch(ignoreGone);
  }

  // Park the senders: they keep their history but can no longer send.
  await supabase
    .from('email_mailboxes')
    .update({ status: 'disconnected', imap_connected: false, updated_at: new Date().toISOString() })
    .eq('organization_id', row.organization_id)
    .eq('sending_domain_id', row.id)
    .eq('connection_type', 'postshiba');

  const { error } = await supabase.from('email_sending_domains').delete().eq('id', row.id);
  if (error) throw new Error(`Failed to remove domain: ${error.message}`);
  return json({ ok: true });
}

// deno-lint-ignore no-explicit-any
// deno-lint-ignore no-explicit-any
function maxDomainVolume(connection: any): number {
  return connection.emails_per_day > 0 ? connection.emails_per_day : MAX_DOMAIN_VOLUME_FALLBACK;
}

/** A domain's daily volume from the request, or an error response. */
// deno-lint-ignore no-explicit-any
function readDailyVolume(connection: any, raw: unknown): number | Response {
  const volume = Number(raw);
  const max = maxDomainVolume(connection);
  if (!Number.isInteger(volume) || volume < 1 || volume > max) {
    return json({
      error: `Enter a whole number of emails a day from 1 to ${max.toLocaleString('en-US')} (your cluster's daily limit).`,
      error_code: 'invalid_daily_volume',
    }, 400);
  }
  return volume;
}

// deno-lint-ignore no-explicit-any
async function setDailyVolume(supabase: SupabaseClient, connection: any, row: any, body: Record<string, unknown>) {
  // deno-lint-ignore no-explicit-any
  let update: Record<string, any>;
  if (body.mode === 'auto') {
    // The cluster rebalance (trg_postshiba_rebalance_on_domain_settings) sets the volume.
    update = { postshiba_volume_mode: 'auto' };
    if (body.sender_cap !== undefined && body.sender_cap !== null && body.sender_cap !== '') {
      const cap = Number(body.sender_cap);
      const max = maxDomainVolume(connection);
      if (!Number.isInteger(cap) || cap < 1 || cap > max) {
        return json({
          error: `Enter a whole number of emails a sender a day from 1 to ${max.toLocaleString('en-US')}.`,
          error_code: 'invalid_sender_cap',
        }, 400);
      }
      update.postshiba_sender_cap = cap;
    }
  } else {
    const volume = readDailyVolume(connection, body.daily_volume);
    if (volume instanceof Response) return volume;
    // trg_postshiba_rebalance_on_volume splits it across the senders.
    update = { postshiba_volume_mode: 'manual', postshiba_daily_volume: volume };
  }
  const { data: saved, error } = await supabase
    .from('email_sending_domains')
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select(DOMAIN_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to save the daily volume: ${error.message}`);
  return json({ ok: true, domain: publicDomain(saved) });
}

// deno-lint-ignore no-explicit-any
async function addSenders(supabase: SupabaseClient, connection: any, row: any, body: Record<string, unknown>) {
  // The domain's daily volume, split across all its senders. An auto domain's
  // volume comes from the cluster rebalance below, so a volume sent with the
  // senders is ignored. The previous page version sends a per-sender
  // daily_limit instead; that is honoured only while a manual domain has no volume yet.
  const auto = (row.postshiba_volume_mode ?? 'auto') === 'auto';
  let volume: number | null = row.postshiba_daily_volume ?? null;
  let legacyLimit: number | null = null;
  if (auto) {
    // set below by postshiba_rebalance_for_domain
  } else if (body.daily_volume !== undefined && body.daily_volume !== null && body.daily_volume !== '') {
    const read = readDailyVolume(connection, body.daily_volume);
    if (read instanceof Response) return read;
    volume = read;
  } else if (volume === null && body.daily_limit !== undefined) {
    const dailyLimit = Number(body.daily_limit);
    if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
      return json({ error: `daily_limit must be a whole number from 1 to ${MAX_DAILY_LIMIT}.`, error_code: 'invalid_daily_limit' }, 400);
    }
    legacyLimit = dailyLimit;
  } else if (volume === null) {
    return json({ error: 'Set how many emails a day this domain sends.', error_code: 'invalid_daily_volume' }, 400);
  }

  const input = Array.isArray(body.senders) ? body.senders : [];
  if (input.length === 0 || input.length > MAX_SENDERS_PER_CALL) {
    return json({ error: `Add between 1 and ${MAX_SENDERS_PER_CALL} senders at a time.`, error_code: 'invalid_senders' }, 400);
  }

  const senders = new Map<string, { first_name: string; last_name: string; email: string }>();
  for (const raw of input) {
    // deno-lint-ignore no-explicit-any
    const s = (raw ?? {}) as any;
    const firstName = typeof s.first_name === 'string' ? s.first_name.trim() : '';
    const lastName = typeof s.last_name === 'string' ? s.last_name.trim() : '';
    const localPart = typeof s.local_part === 'string' ? s.local_part.trim().toLowerCase() : '';
    if (!firstName) return json({ error: 'Every sender needs a first name.', error_code: 'invalid_senders' }, 400);
    if (!LOCAL_PART_RE.test(localPart) || localPart.includes('..')) {
      return json({ error: `"${localPart}" is not a valid address before the @.`, error_code: 'invalid_senders' }, 400);
    }
    const email = `${localPart}@${row.domain}`;
    senders.set(email, { first_name: firstName, last_name: lastName, email });
  }

  // Never take over an address that already belongs to another kind of mailbox.
  const emails = [...senders.keys()];
  const { data: taken } = await supabase
    .from('email_mailboxes')
    .select('email_address, connection_type')
    .eq('organization_id', row.organization_id)
    .in('email_address', emails);
  const skipped = (taken ?? []).filter((m) => m.connection_type !== 'postshiba').map((m) => m.email_address);
  const toSave = emails.filter((e) => !skipped.includes(e));
  if (toSave.length === 0) {
    return json({ error: 'Those addresses already exist in ACA as other mailboxes.', error_code: 'senders_in_use', skipped }, 409);
  }

  const smtp = parseSmtpEndpoint(connection.smtp_endpoint);
  const smtpPassword = await decryptValue(connection.smtp_password_encrypted);
  const now = new Date().toISOString();
  const rows = await Promise.all(toSave.map(async (email) => {
    const s = senders.get(email)!;
    return {
      organization_id: row.organization_id,
      email_address: email,
      display_name: [s.first_name, s.last_name].filter(Boolean).join(' '),
      first_name: s.first_name,
      last_name: s.last_name || null,
      provider: 'postshiba',
      connection_type: 'postshiba',
      sending_domain_id: row.id,
      status: 'ready',
      warmup_enabled: false,
      warmup_start_date: null,
      warmup_day: 0,
      // postshiba_rebalance_for_domain sets each share below.
      // Mirrored into the baseline and warmup ceiling so the nightly engagement
      // reset and the warmup tick converge on it instead of replacing it.
      daily_limit: legacyLimit ?? 0,
      daily_limit_baseline: legacyLimit ?? 0,
      warmup_max_daily: legacyLimit ?? 0,
      daily_sent: 0,
      health_score: 1.0,
      // Sendable only while the domain can receive replies and report bounces.
      imap_connected: sendingReady(connection, row),
      metadata: {
        smtp_credentials: await encryptCredentials({
          smtp_host: smtp.host,
          smtp_port: smtp.port,
          smtp_username: connection.smtp_username,
          smtp_password: smtpPassword,
        }),
        smtp_host: smtp.host,
        smtp_port: smtp.port,
        postshiba: { tenant_id: connection.tenant_id, sending_domain_id: row.postshiba_domain_id },
      },
      updated_at: now,
    };
  }));

  const { data: upserted, error } = await supabase
    .from('email_mailboxes')
    .upsert(rows, { onConflict: 'organization_id,email_address' })
    .select('id');
  if (error) throw new Error(`Failed to save senders: ${error.message}`);

  const { count } = await supabase
    .from('email_mailboxes')
    .select('id', { count: 'exact', head: true })
    .eq('sending_domain_id', row.id)
    .eq('connection_type', 'postshiba');
  await supabase
    .from('email_sending_domains')
    .update({ mailbox_count: count ?? 0, ...(!auto && volume !== null ? { postshiba_daily_volume: volume } : {}) })
    .eq('id', row.id);
  // New senders add capacity: reshare the cluster (auto domains) and split each
  // domain's volume across every sender, old and new (a no-op where shares match).
  const { error: splitErr } = await supabase.rpc('postshiba_rebalance_for_domain', { p_domain_id: row.id });
  if (splitErr) throw new Error(`Failed to split the daily volume: ${splitErr.message}`);
  if (auto) {
    const { data: fresh } = await supabase.from('email_sending_domains').select('postshiba_daily_volume').eq('id', row.id).single();
    volume = fresh?.postshiba_daily_volume ?? null;
  }

  const { data: saved } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, display_name, daily_limit, status')
    .in('id', (upserted ?? []).map((m: { id: string }) => m.id));

  // clamp_mailbox_daily_limit can lower a per-sender limit if a PostShiba ceiling
  // is ever set in mailbox_daily_ceilings (the org cap does not apply to PostShiba).
  const capped = legacyLimit !== null && (saved ?? []).some((m) => m.daily_limit < legacyLimit!);
  return json({ ok: true, senders: saved ?? [], skipped, capped, daily_volume: volume });
}

type CandidateExclusion = 'zone_not_active' | 'in_aca' | 'has_mailboxes' | 'receives_mail';

/**
 * The org's Cloudflare zones that add_domain would accept: active, not already
 * a sending domain in ACA, no ACA mailboxes on them and no MX elsewhere. Same
 * rules as add_domain, so picking one never fails those checks. Reads only.
 */
async function domainCandidates(supabase: SupabaseClient, organizationId: string) {
  const { data: provider } = await supabase
    .from('dns_providers')
    .select('api_token_encrypted, account_id')
    .eq('organization_id', organizationId)
    .eq('provider', 'cloudflare')
    .maybeSingle();
  if (!provider) return json({ ok: true, cloudflare_connected: false, candidates: [], excluded: [] });

  const client = createCloudflareClient(await decryptValue(provider.api_token_encrypted));
  const zones = await client.listZones({ accountId: provider.account_id ?? undefined });
  const { data: existing } = await supabase
    .from('email_sending_domains')
    .select('domain')
    .eq('organization_id', organizationId);
  const inAca = new Set((existing ?? []).map((d: { domain: string }) => d.domain.toLowerCase()));

  const check = async (name: string, status: string): Promise<{ domain: string; reason: CandidateExclusion | null }> => {
    const domain = name.toLowerCase();
    if (status !== 'active') return { domain, reason: 'zone_not_active' };
    if (inAca.has(domain)) return { domain, reason: 'in_aca' };
    const { count } = await supabase
      .from('email_mailboxes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .neq('connection_type', 'postshiba')
      .ilike('email_address', `%@${domain}`); // zone names admit no LIKE wildcards
    if (count) return { domain, reason: 'has_mailboxes' };
    const foreignMx = (await resolveMx(domain)).filter((host) => host !== POSTSHIBA_INBOUND_MX);
    return { domain, reason: foreignMx.length ? 'receives_mail' : null };
  };

  // Ten DNS lookups at a time keeps large accounts quick without flooding the resolver.
  const results: Array<{ domain: string; reason: CandidateExclusion | null }> = [];
  for (let i = 0; i < zones.length; i += 10) {
    results.push(...await Promise.all(zones.slice(i, i + 10).map((z) => check(z.name, z.status))));
  }

  return json({
    ok: true,
    cloudflare_connected: true,
    candidates: results.filter((r) => !r.reason).map((r) => r.domain).sort(),
    excluded: results.filter((r) => r.reason).sort((a, b) => a.domain.localeCompare(b.domain)),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, organization_id } = body as { action?: string; organization_id?: string };
    if (!organization_id) return json({ error: 'organization_id is required' }, 400);

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const feature = await checkFeatureAccess(supabase, organization_id, 'postshiba');
    if (!feature.allowed) {
      return json({ error: 'PostShiba is not enabled for this organization yet.', error_code: 'feature_disabled' }, 403);
    }

    const { data: connection, error: connErr } = await supabase
      .from('postshiba_connections')
      .select('*')
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (connErr) throw new Error(`Failed to read connection: ${connErr.message}`);

    if (action === 'domain_candidates') return await domainCandidates(supabase, organization_id);

    if (action === 'remove_domain') {
      const row = await loadDomain(supabase, organization_id, body.domain_id);
      if (!row) return json({ error: 'Domain not found', error_code: 'not_found' }, 404);
      // Without a connection there is nothing left to clean up in PostShiba.
      return await removeDomain(supabase, connection, row);
    }

    if (!connection) {
      return json({ error: 'Connect a PostShiba team first.', error_code: 'not_connected' }, 400);
    }
    if (connection.status !== 'active') {
      return json({ error: connection.last_error || `The PostShiba connection is ${connection.status}.`, error_code: 'connection_inactive' }, 400);
    }

    if (action === 'add_domain') return await addDomain(supabase, connection, body.domain);

    if (action === 'verify' || action === 'add_senders' || action === 'set_daily_volume' || action === 'replay_inbound') {
      const row = await loadDomain(supabase, organization_id, body.domain_id);
      if (!row) return json({ error: 'Domain not found', error_code: 'not_found' }, 404);
      if (row.postshiba_connection_id !== connection.id) {
        return json({ error: 'This domain was set up on a different PostShiba connection. Remove it and add it again.', error_code: 'connection_mismatch' }, 409);
      }
      if (action === 'set_daily_volume') return await setDailyVolume(supabase, connection, row, body);
      if (action === 'replay_inbound') return await replayInbound(connection, row);
      return action === 'verify'
        ? await verify(supabase, connection, row, body.force !== false)
        : await addSenders(supabase, connection, row, body);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err instanceof PostShibaError) {
      const described = describePostShibaError(err);
      return json({ error: described.error, error_code: described.error_code }, described.status);
    }
    console.error('[postshiba-provision] unhandled:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
