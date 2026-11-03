/**
 * IMAP Client Module
 *
 * Connects to IMAP mailboxes and fetches new emails since a given UID.
 * Uses imapflow for connection and envelope-based parsing (no mailparser dependency).
 */

import { ImapFlow } from 'npm:imapflow@^1.0';

// ============================================================================
// Types
// ============================================================================

export interface IMAPCredentials {
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
}

export interface InboundEmailMessage {
  uid: number;
  message_id: string;
  in_reply_to: string | null;
  references: string[];
  from_email: string;
  from_name: string;
  to_emails: string[];
  subject: string;
  text_body: string;
  html_body: string;
  date: Date | null;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract email body text from a raw email source using recursive MIME parsing.
 * Handles nested multipart (e.g. multipart/mixed > multipart/alternative > text/plain + text/html).
 */
function parseBodyFromSource(source: Buffer | Uint8Array | string): { text: string; html: string } {
  const raw = typeof source === 'string' ? source : new TextDecoder().decode(source);
  return parseMimePart(raw);
}

/**
 * Recursively parse a MIME part, descending into nested multipart boundaries.
 */
function parseMimePart(raw: string): { text: string; html: string } {
  // Look for a boundary in this part's headers
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split(`--${boundary}`);

    let text = '';
    let html = '';

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;

      const headers = part.substring(0, headerEnd).toLowerCase();
      const body = part.substring(headerEnd + 4).replace(/--\s*$/, '').trim();

      // Recurse into nested multipart parts
      if (headers.includes('multipart/')) {
        const nested = parseMimePart(part);
        if (!text && nested.text) text = nested.text;
        if (!html && nested.html) html = nested.html;
      } else if (!text && headers.includes('text/plain')) {
        text = decodeTransferEncoding(body, headers);
      } else if (!html && headers.includes('text/html')) {
        html = decodeTransferEncoding(body, headers);
      }
    }

    return { text, html };
  }

  // Not multipart — check content type
  const contentType = raw.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.toLowerCase() || '';
  const headerEnd = raw.indexOf('\r\n\r\n');
  const body = headerEnd > -1 ? raw.substring(headerEnd + 4) : raw;

  if (contentType.includes('text/html')) {
    return { text: '', html: body.trim() };
  }

  return { text: body.trim(), html: '' };
}

/**
 * Decode content based on Content-Transfer-Encoding header.
 * Also handles charset conversion (e.g. charset=utf-8).
 */
function decodeTransferEncoding(body: string, headers: string): string {
  if (headers.includes('quoted-printable')) {
    return decodeQuotedPrintableUtf8(body);
  }
  if (headers.includes('base64')) {
    return decodeBase64Body(body);
  }
  return body;
}

/**
 * Decode a base64-encoded email body to UTF-8 string.
 * Handles common edge cases: CRLF line wrapping, padding issues, stray chars.
 */
function decodeBase64Body(body: string): string {
  try {
    // Strip all whitespace (base64 in emails is line-wrapped at 76 chars)
    let cleaned = body.replace(/[\s\r\n]+/g, '');
    // Remove any non-base64 characters that might have leaked in
    cleaned = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
    // Fix missing padding
    const remainder = cleaned.length % 4;
    if (remainder === 2) cleaned += '==';
    else if (remainder === 3) cleaned += '=';

    const binaryStr = atob(cleaned);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    // Last resort: try chunked decoding (process in smaller blocks)
    try {
      const cleaned = body.replace(/[\s\r\n]+/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
      const chunkSize = 4096;
      const allBytes: number[] = [];
      for (let i = 0; i < cleaned.length; i += chunkSize) {
        let chunk = cleaned.substring(i, i + chunkSize);
        const rem = chunk.length % 4;
        if (rem === 2) chunk += '==';
        else if (rem === 3) chunk += '=';
        const bin = atob(chunk);
        for (let j = 0; j < bin.length; j++) allBytes.push(bin.charCodeAt(j));
      }
      return new TextDecoder('utf-8').decode(new Uint8Array(allBytes));
    } catch {
      // Absolute fallback — return body but log the failure
      console.error('[IMAP] Failed to decode base64 body, returning raw content');
      return body;
    }
  }
}

/**
 * Decode quoted-printable encoded string, properly handling UTF-8 byte sequences.
 * QP encodes UTF-8 bytes individually (e.g. é = =C3=A9), so we must decode
 * the bytes first, then interpret the result as UTF-8.
 */
function decodeQuotedPrintableUtf8(str: string): string {
  // Remove soft line breaks
  const cleaned = str.replace(/=\r?\n/g, '');

  // Convert QP-encoded bytes to a Uint8Array, preserving ASCII as-is
  const bytes: number[] = [];
  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i] === '=' && i + 2 < cleaned.length) {
      const hex = cleaned.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
        continue;
      }
    }
    bytes.push(cleaned.charCodeAt(i));
    i++;
  }

  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

/**
 * Parse References header value into array of message IDs.
 */
function parseReferencesFromSource(source: Buffer | Uint8Array | string): string[] {
  const raw = typeof source === 'string' ? source : new TextDecoder().decode(source);

  // Match the References header (may span multiple lines)
  const match = raw.match(/^references:\s*(.+?)(?=\r?\n[^\s]|\r?\n\r?\n)/ims);
  if (!match) return [];

  // Extract all <message-id> values
  const refs: string[] = [];
  const idRegex = /<([^>]+)>/g;
  let m;
  while ((m = idRegex.exec(match[1])) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

// ============================================================================
// Fetch New Emails
// ============================================================================

/**
 * Connect to an IMAP mailbox and fetch emails newer than `sinceUid`.
 * Returns parsed InboundEmailMessage[] ordered by UID ascending.
 *
 * If sinceUid is 0, fetches the last 50 emails to avoid a huge initial sync.
 */
export async function fetchNewEmails(
  credentials: IMAPCredentials,
  sinceUid: number
): Promise<InboundEmailMessage[]> {
  const client = new ImapFlow({
    host: credentials.imap_host,
    port: credentials.imap_port || 993,
    secure: true,
    auth: {
      user: credentials.imap_username,
      pass: credentials.imap_password,
    },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
    },
  });

  const messages: InboundEmailMessage[] = [];

  try {
    console.log(`[IMAP] Connecting to ${credentials.imap_host}:${credentials.imap_port || 993}...`);
    await client.connect();
    console.log('[IMAP] Connected successfully');

    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailboxStatus = client.mailbox;
      if (!mailboxStatus || !mailboxStatus.exists || mailboxStatus.exists === 0) {
        return [];
      }

      // Build UID range
      let range: string;
      if (sinceUid > 0) {
        range = `${sinceUid + 1}:*`;
      } else {
        // First sync: only fetch last 50 messages
        const startUid = Math.max(1, (mailboxStatus.uidNext || 1) - 50);
        range = `${startUid}:*`;
      }

      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        // Skip if we somehow got the sinceUid itself
        if (message.uid <= sinceUid) continue;

        try {
          const env = message.envelope;
          if (!env) continue;

          // Extract from address
          const fromAddr = env.from?.[0];
          const fromEmail = fromAddr?.address?.toLowerCase() || '';
          const fromName = fromAddr?.name || '';

          // Extract to addresses
          const toEmails = (env.to || [])
            .map((addr: any) => addr.address?.toLowerCase())
            .filter(Boolean);

          // Parse body from raw source
          const { text, html } = message.source
            ? parseBodyFromSource(message.source)
            : { text: '', html: '' };

          // Parse References header from raw source (not in envelope)
          const refs = message.source
            ? parseReferencesFromSource(message.source)
            : [];

          messages.push({
            uid: message.uid,
            message_id: env.messageId || '',
            in_reply_to: env.inReplyTo || null,
            references: refs,
            from_email: fromEmail,
            from_name: fromName,
            to_emails: toEmails,
            subject: env.subject || '(no subject)',
            text_body: text,
            html_body: html,
            date: env.date ? new Date(env.date) : null,
          });
        } catch (parseErr) {
          console.error(`[IMAP] Failed to parse message UID ${message.uid}:`, parseErr);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error('[IMAP] Connection error:', error);
    // Try to disconnect cleanly
    try { await client.logout(); } catch { /* ignore */ }
    throw error;
  }

  // Sort by UID ascending
  messages.sort((a, b) => a.uid - b.uid);
  return messages;
}

// ============================================================================
// Spam/Junk Folder Scanning
// ============================================================================

/** Common spam/junk folder names across providers */
const SPAM_FOLDER_NAMES = [
  'Junk',
  'Spam',
  '[Gmail]/Spam',
  'INBOX.Junk',
  'INBOX.Spam',
  'Junk E-mail',
  'Bulk Mail',
];

/**
 * Fetch emails from spam/junk folders since a given UID.
 * Tries common folder names and returns emails from the first one that works.
 * Returns the folder name that was used (for UID tracking) and the emails.
 */
export async function fetchSpamFolderEmails(
  credentials: IMAPCredentials,
  sinceUid: number
): Promise<{ folder: string; emails: InboundEmailMessage[] } | null> {
  const client = new ImapFlow({
    host: credentials.imap_host,
    port: credentials.imap_port || 993,
    secure: true,
    auth: {
      user: credentials.imap_username,
      pass: credentials.imap_password,
    },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    await client.connect();

    // List available mailboxes to find the spam folder
    const mailboxes = await client.list();
    const spamFolder = mailboxes.find((mb: any) =>
      SPAM_FOLDER_NAMES.some(name =>
        mb.path.toLowerCase() === name.toLowerCase() ||
        mb.specialUse === '\\Junk'
      )
    );

    if (!spamFolder) {
      await client.logout();
      return null;
    }

    const messages: InboundEmailMessage[] = [];
    const lock = await client.getMailboxLock(spamFolder.path);

    try {
      const mailboxStatus = client.mailbox;
      if (!mailboxStatus || !mailboxStatus.exists || mailboxStatus.exists === 0) {
        return { folder: spamFolder.path, emails: [] };
      }

      let range: string;
      if (sinceUid > 0) {
        range = `${sinceUid + 1}:*`;
      } else {
        // First scan: only check last 20 messages
        const startUid = Math.max(1, (mailboxStatus.uidNext || 1) - 20);
        range = `${startUid}:*`;
      }

      for await (const message of client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        if (message.uid <= sinceUid) continue;

        try {
          const env = message.envelope;
          if (!env) continue;

          const fromAddr = env.from?.[0];
          const toEmails = (env.to || [])
            .map((addr: any) => addr.address?.toLowerCase())
            .filter(Boolean);

          const { text, html } = message.source
            ? parseBodyFromSource(message.source)
            : { text: '', html: '' };

          const refs = message.source
            ? parseReferencesFromSource(message.source)
            : [];

          messages.push({
            uid: message.uid,
            message_id: env.messageId || '',
            in_reply_to: env.inReplyTo || null,
            references: refs,
            from_email: fromAddr?.address?.toLowerCase() || '',
            from_name: fromAddr?.name || '',
            to_emails: toEmails,
            subject: env.subject || '(no subject)',
            text_body: text,
            html_body: html,
            date: env.date ? new Date(env.date) : null,
          });
        } catch (parseErr) {
          console.error(`[IMAP] Failed to parse spam folder message UID ${message.uid}:`, parseErr);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();

    messages.sort((a, b) => a.uid - b.uid);
    return { folder: spamFolder.path, emails: messages };
  } catch (error) {
    console.error('[IMAP] Spam folder scan error:', error);
    try { await client.logout(); } catch { /* ignore */ }
    return null;
  }
}

// ============================================================================
// Warmup placement detection + spam rescue
// ============================================================================

export type WarmupPlacement = 'inbox' | 'junk' | 'missing';

export interface WarmupLocateResult {
  placement: WarmupPlacement;
  /** True when the message was found in Junk and successfully moved to INBOX. */
  rescued: boolean;
  error?: string;
}

/**
 * Locate a warmup message in a recipient mailbox, report where it landed, and —
 * when it landed in Junk — move it to the Inbox and mark it read.
 *
 * This is the IMAP counterpart to findWarmupMessage/moveMessageToInbox in
 * m365-client.ts, used for mailboxes with no resolvable M365 tenant (the `google`
 * estate) and as the fallback for M365 tenants that have not consented the Graph
 * Mail.ReadWrite app role.
 *
 * Inbox-vs-Junk placement is the only honest measure of whether warmup is
 * working; the Junk->Inbox move plus \Seen is the "not spam" signal that actually
 * rebuilds sending-domain reputation. Sending alone does neither.
 */
export async function locateAndRescueWarmup(
  credentials: IMAPCredentials,
  opts: { fromAddress: string; subject: string; since: Date },
): Promise<WarmupLocateResult> {
  // A hung IMAP call cannot be interrupted by closing the socket, so the deadline
  // is raced against the whole lookup and names the step that was in flight. The
  // caller's own timeout only says "timed out", which cannot tell a slow login
  // from a slow SEARCH.
  const state = { step: 'connect' };
  let timer: number | undefined;
  const stall = new Promise<WarmupLocateResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ placement: 'missing', rescued: false, error: `imap stalled at step=${state.step}` }),
      17000,
    );
  });
  try {
    return await Promise.race([locateAndRescueWarmupInner(credentials, opts, state), stall]);
  } finally {
    clearTimeout(timer);
  }
}

async function locateAndRescueWarmupInner(
  credentials: IMAPCredentials,
  opts: { fromAddress: string; subject: string; since: Date },
  state: { step: string },
): Promise<WarmupLocateResult> {
  const client = new ImapFlow({
    host: credentials.imap_host,
    port: credentials.imap_port || 993,
    secure: true,
    auth: { user: credentials.imap_username, pass: credentials.imap_password },
    logger: false,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    state.step = 'list';

    const mailboxes = await client.list();
    state.step = 'lock';
    const junkPath = mailboxes.find((mb: any) =>
      SPAM_FOLDER_NAMES.some((name) => mb.path.toLowerCase() === name.toLowerCase()) ||
      mb.specialUse === '\\Junk'
    )?.path;

    // Junk first: a hit there is the actionable case, and checking it before the
    // Inbox avoids a race where our own rescue moves the message mid-scan.
    const searchOrder: Array<{ path: string; placement: WarmupPlacement }> = [];
    if (junkPath) searchOrder.push({ path: junkPath, placement: 'junk' });
    searchOrder.push({ path: 'INBOX', placement: 'inbox' });

    for (const folder of searchOrder) {
      let lock;
      state.step = `lock:${folder.path}`;
      try {
        lock = await client.getMailboxLock(folder.path);
      } catch {
        continue; // folder vanished or is not selectable
      }

      try {
        // SUBJECT is matched server-side. Fetching envelopes to confirm the subject
        // client-side hung in the Supabase edge runtime: SEARCH returned, then the
        // fetch iterator never completed (fine under Node). IMAP SUBJECT is a
        // substring match, which is enough — warmup subjects are distinct phrases.
        state.step = `search:${folder.path}`;
        const uids = await client.search(
          { from: opts.fromAddress, since: opts.since, subject: opts.subject.trim() },
          { uid: true },
        );
        if (!uids || uids.length === 0) continue;
        const uid = String(uids[uids.length - 1]);

        state.step = `flag:${folder.path}`;
        try {
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
        } catch { /* read flag is a bonus, not worth failing the check */ }
        if (folder.placement === 'inbox') return { placement: 'inbox', rescued: false };

        state.step = `move:${folder.path}`;
        try {
          await client.messageMove(uid, 'INBOX', { uid: true });
          return { placement: 'junk', rescued: true };
        } catch (moveErr) {
          return {
            placement: 'junk',
            rescued: false,
            error: moveErr instanceof Error ? moveErr.message : String(moveErr),
          };
        }
      } finally {
        lock.release();
      }
    }

    return { placement: 'missing', rescued: false };
  } catch (error) {
    // imapflow collapses most failures into a bare "Command failed", which is
    // useless for diagnosis — the first Gmail warmup placement check failed six
    // times with exactly that and no way to tell auth failure from a disabled
    // IMAP account from a TLS teardown. Pull out every field imapflow actually
    // carries so the ledger records something actionable.
    const e = error as {
      message?: string;
      code?: string;
      authenticationFailed?: boolean;
      responseText?: string;
      serverResponseCode?: string;
    };
    const parts = [
      e?.message || String(error),
      e?.code ? `code=${e.code}` : '',
      e?.serverResponseCode ? `server=${e.serverResponseCode}` : '',
      e?.authenticationFailed ? 'authFailed=true' : '',
      e?.responseText ? `resp=${String(e.responseText).slice(0, 120)}` : '',
    ].filter(Boolean);

    return {
      placement: 'missing',
      rescued: false,
      error: parts.join(' | '),
    };
  } finally {
    try { await client.logout(); } catch { /* ignore */ }
  }
}
