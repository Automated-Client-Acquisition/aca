/**
 * Microsoft Graph API Mail Poller
 *
 * Polls Microsoft 365 mailboxes via the Graph API instead of IMAP.
 * Used for m365 connection_type mailboxes (shared/unlicensed mailboxes
 * that don't support IMAP Basic Auth but are fully accessible via Graph).
 *
 * Auth model:
 *   - Client credentials flow targeting the customer's tenant
 *   - Requires Mail.ReadWrite application permission on the Azure app
 *   - No per-mailbox credentials needed — uses the m365 tenant's client_id/secret
 *
 * Polling model:
 *   - Uses Graph delta API ($deltaLink) for incremental inbox polling
 *   - On first poll: fetches last 50 messages (catch-up), stores deltaLink
 *   - On subsequent polls: follows deltaLink to get only new messages
 *   - deltaLink stored in email_mailboxes.metadata.graph_delta_link
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { InboundEmailMessage } from './imap-client.js';
import { MAX_ATTACHMENT_BYTES, isAttachedFileType, type RawAttachment } from './attachments.js';

// ============================================================================
// Types
// ============================================================================

export interface GraphMailbox {
  id: string;                    // email_mailboxes.id
  organization_id: string;
  email_address: string;
  display_name: string | null;
  metadata: Record<string, unknown>;
  tenant_id: string;             // Azure AD tenant GUID
  created_at?: string | null;
}

interface GraphMessage {
  id: string;
  internetMessageId: string;
  conversationId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { address: string; name: string } };
  toRecipients: Array<{ emailAddress: { address: string; name: string } }>;
  receivedDateTime: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  isRead: boolean;
  /** True when it has file attachments; inline body images alone don't count. */
  hasAttachments?: boolean;
}

interface GraphTokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

// ============================================================================
// Graph API helpers
// ============================================================================

const tokenCache = new Map<string, GraphTokenCache>();

async function getGraphToken(tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = process.env.M365_APP_CLIENT_ID;
  const clientSecret = process.env.M365_APP_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('M365_APP_CLIENT_ID and M365_APP_CLIENT_SECRET env vars are required');
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Graph token failed: ${data.error_description || data.error || JSON.stringify(data)}`);
  }

  const entry: GraphTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  tokenCache.set(tenantId, entry);
  return entry.token;
}

async function graphGet(token: string, url: string): Promise<any> {
  // A hung request here has no other backstop — pollAll() runs mailboxes
  // sequentially, so one stalled fetch would otherwise block the entire sweep
  // (and the worker heartbeat, which is only written once per outer loop
  // iteration) indefinitely. This bounds the damage to one mailbox's worth of
  // delay instead of 30-40+ minutes across the whole fleet.
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph GET ${url} → ${res.status}: ${body}`);
  }
  return res.json();
}

// Properties we need on every message. Graph's @odata.deltaLink does NOT carry
// the original $select forward, so follow-up delta calls return messages with
// only default fields — from/subject/body come back empty, producing blank CRM
// rows. Graph DOES honor a re-specified $select on a deltaLink, so we re-append
// it to every request (first poll and stored deltaLink alike).
const GRAPH_SELECT =
  'id,internetMessageId,subject,bodyPreview,body,from,toRecipients,receivedDateTime,internetMessageHeaders,isRead,hasAttachments';

function withSelect(url: string): string {
  if (/[?&]\$select=/.test(url)) return url;
  return url + (url.includes('?') ? '&' : '?') + '$select=' + encodeURIComponent(GRAPH_SELECT);
}

/**
 * A message's attached files. Inline body images, attached items/links
 * (itemAttachment, referenceAttachment) and bounce report parts are skipped;
 * bytes are fetched only for files within the size cap.
 */
async function fetchGraphAttachments(tenantId: string, emailAddress: string, messageId: string): Promise<RawAttachment[]> {
  const token = await getGraphToken(tenantId);
  const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(emailAddress)}/messages/${encodeURIComponent(messageId)}/attachments`;
  const data = await graphGet(token, `${base}?$select=id,name,contentType,size,isInline`);
  const files: RawAttachment[] = [];
  for (const a of (data.value || []) as Array<Record<string, any>>) {
    if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
    if (!isAttachedFileType(String(a.contentType || ''))) continue;
    const listedSize = Number(a.size) || 0;
    let content: Buffer | null = null;
    if (listedSize <= MAX_ATTACHMENT_BYTES) {
      const res = await fetch(`${base}/${encodeURIComponent(a.id)}/$value`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`Graph attachment ${a.name} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      content = Buffer.from(await res.arrayBuffer());
    }
    files.push({
      filename: a.name || `attachment-${files.length + 1}`,
      contentType: String(a.contentType || 'application/octet-stream').toLowerCase(),
      size: content?.length ?? listedSize,
      content,
    });
  }
  return files;
}

// ============================================================================
// Graph → InboundEmailMessage transformer
// ============================================================================

function graphMessageToInbound(
  msg: GraphMessage,
  index: number,
  mailbox: Pick<GraphMailbox, 'tenant_id' | 'email_address'>,
): InboundEmailMessage {
  // Extract In-Reply-To and References from internet message headers
  let inReplyTo: string | null = null;
  const references: string[] = [];

  for (const header of msg.internetMessageHeaders || []) {
    const name = header.name.toLowerCase();
    if (name === 'in-reply-to') {
      inReplyTo = header.value.trim().replace(/^<|>$/g, '');
    } else if (name === 'references') {
      references.push(
        ...header.value
          .split(/\s+/)
          .map(r => r.trim().replace(/^<|>$/g, ''))
          .filter(Boolean),
      );
    }
  }

  const cleanMessageId = msg.internetMessageId?.replace(/^<|>$/g, '') || `graph-${msg.id}`;

  const textBody = msg.body?.contentType?.toLowerCase() === 'text'
    ? msg.body.content
    : msg.bodyPreview || '';

  const htmlBody = msg.body?.contentType?.toLowerCase() === 'html'
    ? msg.body.content
    : '';

  return {
    uid: index + 1, // Graph doesn't have UIDs — use index as surrogate for ordering
    message_id: cleanMessageId,
    in_reply_to: inReplyTo,
    references,
    from_email: msg.from?.emailAddress?.address?.toLowerCase() || '',
    from_name: msg.from?.emailAddress?.name || '',
    to_emails: (msg.toRecipients || []).map(r => r.emailAddress.address.toLowerCase()),
    subject: msg.subject || '',
    text_body: textBody,
    html_body: htmlBody,
    date: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
    loadAttachments: msg.hasAttachments
      ? () => fetchGraphAttachments(mailbox.tenant_id, mailbox.email_address, msg.id)
      : undefined,
  };
}

// ============================================================================
// Graph Poller
// ============================================================================

export class GraphMailPoller {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Poll a single m365 mailbox via Graph delta API.
   * Returns new InboundEmailMessage[] since last poll.
   * Updates graph_delta_link in metadata on success.
   */
  async pollMailbox(mailbox: GraphMailbox): Promise<InboundEmailMessage[]> {
    const { email_address, tenant_id, metadata, created_at } = mailbox;

    let token: string;
    try {
      token = await getGraphToken(tenant_id);
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error(`[Graph] Token error for tenant ${tenant_id}: ${errMsg}`);
      await this.trackGraphAuthError(mailbox, errMsg);
      return [];
    }

    const deltaLink = metadata.graph_delta_link as string | undefined;
    const userEncoded = encodeURIComponent(email_address);

    let url: string;
    if (deltaLink) {
      // Re-append $select — a stored deltaLink drops it, which otherwise yields
      // messages with empty from/subject/body (blank CRM rows).
      url = withSelect(deltaLink);
    } else {
      // First poll: fetch last 50 messages (catchup), ordered newest first
      url = `https://graph.microsoft.com/v1.0/users/${userEncoded}/mailFolders/inbox/messages/delta?$select=${encodeURIComponent(GRAPH_SELECT)}&$top=50&$orderby=receivedDateTime desc`;
    }

    const allMessages: GraphMessage[] = [];
    let nextLink: string | null = url;
    let newDeltaLink: string | null = null;

    // Follow @odata.nextLink pages until @odata.deltaLink (end of results)
    while (nextLink) {
      let data: any;
      try {
        data = await graphGet(token, nextLink);
      } catch (err) {
        const msg = (err as Error).message;
        // 404 = mailbox not found (not provisioned yet) — not fatal
        if (msg.includes('404') || msg.includes('ResourceNotFound')) {
          console.warn(`[Graph] Mailbox not found: ${email_address}`);
          return [];
        }
        // 401/403 = consent revoked or token invalid
        if (msg.includes('401') || msg.includes('403')) {
          console.warn(`[Graph] Auth error for ${email_address}: ${msg}`);
          await this.trackGraphAuthError(mailbox, 'Microsoft 365 authorization expired — re-authorize tenant');
          return [];
        }
        throw err;
      }

      const messages = (data.value || []) as GraphMessage[];

      // The delta feed includes change-notifications for already-seen messages
      // (read/flag/move events), which come back as entries with no sender — not
      // new mail. Inserting them created ~3800 blank CRM rows. Keep only entries
      // that have a real sender. As a safety net, if `from` is missing but the
      // entry has an id, try one hydrate-by-id (covers the rare case Graph omits
      // `from` on a genuine new message); if it's still absent, skip it.
      for (const m of messages) {
        if (m.from?.emailAddress?.address) continue;
        const isTombstone = !!(m as any)['@removed'];
        if (isTombstone || !m.id) continue;
        try {
          const full = await graphGet(
            token,
            `https://graph.microsoft.com/v1.0/users/${userEncoded}/messages/${m.id}?$select=${encodeURIComponent(GRAPH_SELECT)}`,
          ) as GraphMessage;
          Object.assign(m, full);
        } catch (err) {
          console.warn(`[Graph] Hydrate failed for message ${m.id} on ${email_address}: ${(err as Error).message}`);
        }
      }

      // Drop entries with no sender — delta change-events / non-messages.
      const realMessages = messages.filter((m) => !!m.from?.emailAddress?.address);
      const dropped = messages.length - realMessages.length;
      if (dropped > 0) {
        console.log(`[Graph] ${email_address}: skipped ${dropped} delta change-event(s) with no sender`);
      }
      allMessages.push(...realMessages);

      if (data['@odata.deltaLink']) {
        newDeltaLink = data['@odata.deltaLink'];
        break;
      }
      nextLink = data['@odata.nextLink'] || null;
    }

    if (!newDeltaLink) {
      // No deltaLink returned — don't update metadata, retry next cycle
      console.warn(`[Graph] No deltaLink returned for ${email_address}`);
    }

    // On first poll (no prior deltaLink), avoid importing old mailbox history,
    // but do not discard test replies that arrived after ACA created the row.
    // This matters when a mailbox was previously skipped because its domain
    // link was missing: by the time Graph polling is repaired, the user's test
    // email may already be waiting in the Inbox.
    const isFirstPoll = !deltaLink;

    if (newDeltaLink) {
      // Mutate ONLY the keys this poller owns, server-side. A full
      // read-modify-write of `metadata` here would clobber any avatar_url (or
      // other key) written concurrently by another flow between our row read and
      // this write — that race reverted freshly generated mailbox avatars on
      // busy M365 orgs. See migration 20260615190000.
      await this.supabase.rpc('apply_mailbox_metadata_patch', {
        p_id: mailbox.id,
        p_set: { graph_delta_link: newDeltaLink },
        p_unset: ['graph_auth_error', 'graph_auth_failed_at', 'graph_auth_fail_count'],
      });

      // Column-only fields are safe to write directly (no metadata blob).
      // Do NOT write `status` here. This poller only reads mailboxes that are
      // already ready/active/warming, so `status: 'ready'` could never revive a
      // disconnected one — it could only overwrite a pause applied while the poll
      // was in flight, silently putting a mailbox whose tenant cannot send back
      // into the sending pool.
      await this.supabase
        .from('email_mailboxes')
        .update({ imap_connected: true })
        .eq('id', mailbox.id);
    }

    // Filter out messages sent by this mailbox itself (outgoing)
    const inbound = allMessages.filter(m =>
      m.from?.emailAddress?.address?.toLowerCase() !== email_address.toLowerCase()
    );

    if (isFirstPoll) {
      const createdAtMs = created_at ? new Date(created_at).getTime() : NaN;
      if (!Number.isFinite(createdAtMs)) {
        console.log(`[Graph] ${email_address}: first poll, stored deltaLink, skipping ${allMessages.length} historical messages`);
        return [];
      }

      // Give a small grace window for clock skew between DB row creation and
      // Exchange receivedDateTime, while still preventing old imported mail
      // from flooding the CRM.
      const cutoffMs = createdAtMs - 5 * 60 * 1000;
      const recentInbound = inbound.filter((m) => {
        const receivedMs = m.receivedDateTime ? new Date(m.receivedDateTime).getTime() : NaN;
        return Number.isFinite(receivedMs) && receivedMs >= cutoffMs;
      });

      console.log(
        `[Graph] ${email_address}: first poll, stored deltaLink, importing ${recentInbound.length}/${allMessages.length} message(s) received after mailbox creation`
      );
      return recentInbound.map((msg, i) => graphMessageToInbound(msg, i, mailbox));
    }

    return inbound.map((msg, i) => graphMessageToInbound(msg, i, mailbox));
  }

  /**
   * Track Graph auth errors in mailbox metadata (mirrors IMAP auth error pattern).
   * After 3 consecutive failures, marks as disconnected.
   */
  private async trackGraphAuthError(mailbox: GraphMailbox, error: string): Promise<void> {
    const prevCount = ((mailbox.metadata as any)?.graph_auth_fail_count as number) || 0;
    const failCount = prevCount + 1;

    const authMeta = {
      graph_auth_error: error,
      graph_auth_failed_at: new Date().toISOString(),
      graph_auth_fail_count: failCount,
    };

    // Patch only the auth-error keys server-side so we don't clobber a
    // concurrently written avatar_url (see apply_mailbox_metadata_patch).
    await this.supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailbox.id,
      p_set: authMeta,
    });

    if (failCount >= 3) {
      console.warn(`[Graph] Marking ${mailbox.email_address} as disconnected after ${failCount} consecutive auth failures`);
      await this.supabase
        .from('email_mailboxes')
        .update({ status: 'disconnected' })
        .eq('id', mailbox.id);
    }

    // Update in-memory metadata so subsequent calls in the same cycle see the new count
    mailbox.metadata = { ...mailbox.metadata, ...authMeta };
  }

  /**
   * Poll all m365 mailboxes for a given organization.
   * Returns map of mailbox_id → new messages.
   */
  /**
   * Messages received in [fromIso, toIso] across all folders (a reply may have
   * been moved since), oldest first, excluding ones the mailbox sent itself.
   * For recovering replies that were fetched but never filed; it doesn't touch
   * the stored deltaLink.
   */
  async fetchMessagesBetween(mailbox: GraphMailbox, fromIso: string, toIso: string): Promise<InboundEmailMessage[]> {
    const token = await getGraphToken(mailbox.tenant_id);
    const userEncoded = encodeURIComponent(mailbox.email_address);
    const self = mailbox.email_address.toLowerCase();
    // Graph wants DateTimeOffset literals without milliseconds.
    const iso = (v: string) => new Date(v).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const filter = encodeURIComponent(`receivedDateTime ge ${iso(fromIso)} and receivedDateTime le ${iso(toIso)}`);
    let url: string | null =
      `https://graph.microsoft.com/v1.0/users/${userEncoded}/messages?$filter=${filter}` +
      `&$orderby=receivedDateTime asc&$top=50&$select=${encodeURIComponent(GRAPH_SELECT)}`;
    const found: GraphMessage[] = [];
    while (url && found.length < 500) {
      const data = await graphGet(token, url);
      for (const m of (data.value || []) as GraphMessage[]) {
        const from = m.from?.emailAddress?.address?.toLowerCase();
        if (from && from !== self) found.push(m);
      }
      url = data['@odata.nextLink'] ?? null;
    }
    return found.map((m, i) => graphMessageToInbound(m, i, mailbox));
  }

  async pollAll(mailboxes: GraphMailbox[]): Promise<Map<string, InboundEmailMessage[]>> {
    const results = new Map<string, InboundEmailMessage[]>();

    for (const mailbox of mailboxes) {
      try {
        const emails = await this.pollMailbox(mailbox);
        if (emails.length > 0) {
          results.set(mailbox.id, emails);
        }
      } catch (err) {
        const errMsg = (err as Error).message;
        console.error(`[Graph] Poll error for ${mailbox.email_address}: ${errMsg}`);
        await this.trackGraphAuthError(mailbox, errMsg);
      }

      // Small delay between mailboxes to avoid Graph rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }
}
