/**
 * IMAP Client Module (Node.js port)
 *
 * Connects to IMAP mailboxes and fetches new emails since a given UID.
 * Includes a persistent connection pool with IDLE-based push notifications.
 */

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { fromParsedAttachments, type RawAttachment } from './attachments.js';
import { EventEmitter } from 'node:events';

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
  /** Already-stored attachments in crm_messages.attachments' shape (pushed replies only). */
  attachments?: Record<string, unknown>[];
  /** Polled mail: the attached files, fetched and stored only if the message is filed. */
  loadAttachments?: () => Promise<RawAttachment[]>;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse email body from raw RFC822 source using mailparser.
 * Handles all MIME formats: nested multipart, charset encodings,
 * quoted-printable, base64, multipart/report, etc.
 */
async function parseBodyFromSource(
  source: Buffer | Uint8Array | string,
): Promise<{ text: string; html: string; attachments: RawAttachment[] }> {
  try {
    const buf = typeof source === 'string' ? Buffer.from(source) : Buffer.from(source);
    const parsed = await simpleParser(buf);
    const isReport = (parsed.headers.get('content-type') as { value?: string } | undefined)?.value === 'multipart/report';
    return {
      text: parsed.text || '',
      html: typeof parsed.html === 'string' ? parsed.html : '',
      attachments: fromParsedAttachments(parsed.attachments, isReport),
    };
  } catch (err) {
    console.error('[IMAP] mailparser failed, falling back to manual parse:', (err as Error).message);
    // Fallback: try naive extraction so we don't lose everything
    return parseBodyFromSourceFallback(source);
  }
}

/** Lightweight fallback for when mailparser fails */
function parseBodyFromSourceFallback(source: Buffer | Uint8Array | string): { text: string; html: string; attachments: RawAttachment[] } {
  const raw = typeof source === 'string' ? source : Buffer.from(source).toString('utf-8');
  const headerEnd = raw.indexOf('\r\n\r\n');
  if (headerEnd === -1) return { text: '', html: '', attachments: [] };
  const body = raw.substring(headerEnd + 4).trim();
  const contentType = raw.match(/^content-type:\s*([^\r\n]+)/im)?.[1]?.toLowerCase() || '';
  if (contentType.includes('text/html')) {
    return { text: '', html: body, attachments: [] };
  }
  return { text: body, html: '', attachments: [] };
}

function parseReferencesFromSource(source: Buffer | Uint8Array | string): string[] {
  const raw = typeof source === 'string' ? source : Buffer.from(source).toString('utf-8');

  const match = raw.match(/^references:\s*(.+?)(?=\r?\n[^\s]|\r?\n\r?\n)/ims);
  if (!match) return [];

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

export async function fetchNewEmails(
  credentials: IMAPCredentials,
  sinceUid: number,
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
  } as any);

  // Prevent unhandled 'error' events from crashing the process
  client.on('error', (err: Error) => {
    console.error('[IMAP] Async error event:', err.message);
  });

  const messages: InboundEmailMessage[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const mailboxStatus = client.mailbox;
      if (!mailboxStatus || !mailboxStatus.exists || mailboxStatus.exists === 0) {
        return [];
      }

      let range: string;
      if (sinceUid > 0) {
        range = `${sinceUid + 1}:*`;
      } else {
        const startUid = Math.max(1, (mailboxStatus.uidNext || 1) - 50);
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
          const fromEmail = (fromAddr as any)?.address?.toLowerCase() || '';
          const fromName = (fromAddr as any)?.name || '';

          const toEmails = (env.to || [])
            .map((addr: any) => addr.address?.toLowerCase())
            .filter(Boolean) as string[];

          const { text, html, attachments } = message.source
            ? await parseBodyFromSource(message.source)
            : { text: '', html: '', attachments: [] };

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
            loadAttachments: attachments.length ? async () => attachments : undefined,
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
    try { client.close(); } catch { /* ignore */ }
    throw error;
  }

  messages.sort((a, b) => a.uid - b.uid);
  return messages;
}

// ============================================================================
// Spam/Junk Folder Scanning
// ============================================================================

const SPAM_FOLDER_NAMES = [
  'Junk', 'Spam', '[Gmail]/Spam', 'INBOX.Junk',
  'INBOX.Spam', 'Junk E-mail', 'Bulk Mail',
];

export async function fetchSpamFolderEmails(
  credentials: IMAPCredentials,
  sinceUid: number,
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
  } as any);

  // Prevent unhandled 'error' events from crashing the process
  client.on('error', (err: Error) => {
    console.error('[IMAP] Spam scan async error event:', err.message);
  });

  try {
    await client.connect();

    const mailboxes = await client.list();
    const spamFolder = mailboxes.find((mb: any) =>
      SPAM_FOLDER_NAMES.some((name) =>
        mb.path.toLowerCase() === name.toLowerCase() ||
        mb.specialUse === '\\Junk',
      ),
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
            .filter(Boolean) as string[];

          const { text, html, attachments } = message.source
            ? await parseBodyFromSource(message.source)
            : { text: '', html: '', attachments: [] };

          const refs = message.source
            ? parseReferencesFromSource(message.source)
            : [];

          messages.push({
            uid: message.uid,
            message_id: env.messageId || '',
            in_reply_to: env.inReplyTo || null,
            references: refs,
            from_email: (fromAddr as any)?.address?.toLowerCase() || '',
            from_name: (fromAddr as any)?.name || '',
            to_emails: toEmails,
            subject: env.subject || '(no subject)',
            text_body: text,
            html_body: html,
            loadAttachments: attachments.length ? async () => attachments : undefined,
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
    try { client.close(); } catch { /* ignore */ }
    return null;
  }
}

// ============================================================================
// Connection Pool — Persistent IDLE-based connections
// ============================================================================

// 'auth_failed' is recoverable: pool sync retries when (a) the mailbox's
// stored credentials have changed since the failure, or (b) AUTH_RETRY_MS
// has elapsed since the last attempt. 'dead' is reserved for connections
// removed from the DB and pending teardown.
export type ConnectionState = 'connecting' | 'idle' | 'fetching' | 'reconnecting' | 'auth_failed' | 'dead';

// Retry an auth-failed connection after this long, even if creds appear
// unchanged. Catches cases where Dovecot's password file rotated server-side
// without the encrypted-creds blob in Postgres changing visibly.
const AUTH_RETRY_MS = 30 * 60 * 1000;

export interface ManagedConnection {
  mailboxId: string;
  orgId: string;
  emailAddress: string;
  client: ImapFlow | null;
  credentials: IMAPCredentials;
  state: ConnectionState;
  lastUid: number;
  lastJunkUid: number;
  reconnectAttempts: number;
  reconnectTimer: NodeJS.Timeout | null;
  spamFolderPath: string | null;
  metadata: Record<string, any>;
  pendingFetch: boolean;
  // Set when state transitions to 'auth_failed'. Used by sync() to decide
  // when to retry: either creds changed in DB, or AUTH_RETRY_MS elapsed.
  authFailedAt: number | null;
}

export interface MailboxRecord {
  id: string;
  organization_id: string;
  email_address: string;
  display_name: string | null;
  metadata: Record<string, any>;
  imap_connected: boolean;
}

export interface PoolStats {
  total: number;
  connecting: number;
  idle: number;
  fetching: number;
  reconnecting: number;
  dead: number;
}

export interface SyncResult {
  added: number;
  removed: number;
  active: number;
}

type NewEmailsHandler = (
  mailboxId: string,
  emails: InboundEmailMessage[],
  conn: ManagedConnection,
) => Promise<void>;

type AuthFailureHandler = (
  mailboxId: string,
  conn: ManagedConnection,
  error: any,
) => Promise<void>;

// Called when a previously auth_failed connection recovers — handler clears
// the persisted failure markers so the 3-fail threshold doesn't trip on the
// next unrelated blip.
type AuthRecoveryHandler = (
  mailboxId: string,
  conn: ManagedConnection,
) => Promise<void>;

/**
 * Fetches emails from an already-connected ImapFlow client.
 * Shared logic used by both the initial fetch and the exists-event handler.
 */
export async function fetchFromClient(
  client: ImapFlow,
  sinceUid: number,
): Promise<InboundEmailMessage[]> {
  const messages: InboundEmailMessage[] = [];

  const lock = await client.getMailboxLock('INBOX');
  try {
    const mailboxStatus = client.mailbox;
    if (!mailboxStatus || !mailboxStatus.exists || mailboxStatus.exists === 0) {
      return [];
    }

    let range: string;
    if (sinceUid > 0) {
      range = `${sinceUid + 1}:*`;
    } else {
      const startUid = Math.max(1, (mailboxStatus.uidNext || 1) - 50);
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
        const fromEmail = (fromAddr as any)?.address?.toLowerCase() || '';
        const fromName = (fromAddr as any)?.name || '';

        const toEmails = (env.to || [])
          .map((addr: any) => addr.address?.toLowerCase())
          .filter(Boolean) as string[];

        const { text, html, attachments } = message.source
          ? await parseBodyFromSource(message.source)
          : { text: '', html: '', attachments: [] };

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
          loadAttachments: attachments.length ? async () => attachments : undefined,
          date: env.date ? new Date(env.date) : null,
        });
      } catch (parseErr) {
        console.error(`[Pool] Failed to parse message UID ${message.uid}:`, parseErr);
      }
    }
  } finally {
    lock.release();
  }

  messages.sort((a, b) => a.uid - b.uid);
  return messages;
}

const MAX_RECONNECT_ATTEMPTS = 10;
const STAGGER_BATCH_SIZE = 10;
const STAGGER_DELAY_MS = 1000;

export class ImapConnectionPool extends EventEmitter {
  private connections = new Map<string, ManagedConnection>();
  private onNewEmails: NewEmailsHandler;
  private onAuthFailure: AuthFailureHandler;
  private onAuthFailureReset?: AuthRecoveryHandler;
  private shuttingDown = false;
  private maxConnections: number;

  constructor(opts: {
    onNewEmails: NewEmailsHandler;
    onAuthFailure: AuthFailureHandler;
    onAuthFailureReset?: AuthRecoveryHandler;
    maxConnections?: number;
  }) {
    super();
    this.onNewEmails = opts.onNewEmails;
    this.onAuthFailure = opts.onAuthFailure;
    this.onAuthFailureReset = opts.onAuthFailureReset;
    this.maxConnections = opts.maxConnections || 250;
  }

  // --------------------------------------------------------------------------
  // Sync pool with DB state
  // --------------------------------------------------------------------------

  async sync(
    mailboxes: MailboxRecord[],
    extractCredentials: (metadata: Record<string, any>, mailbox: MailboxRecord) => IMAPCredentials | null | Promise<IMAPCredentials | null>,
  ): Promise<SyncResult> {
    const dbIds = new Set(mailboxes.map((m) => m.id));
    const dbById = new Map(mailboxes.map((m) => [m.id, m]));
    let added = 0;
    let removed = 0;
    let retried = 0;

    // Remove connections no longer in DB
    for (const [id, conn] of this.connections) {
      if (!dbIds.has(id)) {
        await this.removeConnection(id);
        removed++;
      }
    }

    // Retry auth_failed connections: re-extract creds from latest mailbox row.
    // If creds changed (mailbox was reprovisioned, key rotated, password reset)
    // OR the AUTH_RETRY_MS cooldown elapsed, attempt to reconnect.
    for (const [id, conn] of this.connections) {
      if (conn.state !== 'auth_failed') continue;
      const mb = dbById.get(id);
      if (!mb) continue;
      const newCreds = await extractCredentials(mb.metadata || {}, mb);
      if (!newCreds?.imap_host || !newCreds?.imap_username || !newCreds?.imap_password) continue;

      const credsChanged =
        newCreds.imap_password !== conn.credentials.imap_password ||
        newCreds.imap_username !== conn.credentials.imap_username ||
        newCreds.imap_host !== conn.credentials.imap_host;
      const cooldownElapsed = conn.authFailedAt !== null &&
        Date.now() - conn.authFailedAt > AUTH_RETRY_MS;

      if (!credsChanged && !cooldownElapsed) continue;

      console.log(
        `[Pool] ${conn.emailAddress} retrying auth (${credsChanged ? 'creds changed' : 'cooldown elapsed'})`,
      );
      conn.credentials = newCreds;
      conn.state = 'connecting';
      conn.authFailedAt = null;
      conn.reconnectAttempts = 0;
      try {
        await this.connectAndIdle(conn);
        retried++;
      } catch (err: any) {
        if (err.authenticationFailed) {
          conn.state = 'auth_failed';
          conn.authFailedAt = Date.now();
        } else {
          this.scheduleReconnect(conn);
        }
      }
    }

    // Add new connections (staggered)
    const toAdd: { mailbox: MailboxRecord; creds: IMAPCredentials }[] = [];
    for (const mb of mailboxes) {
      if (this.connections.has(mb.id)) continue;
      if (this.connections.size >= this.maxConnections) {
        console.warn(`[Pool] Max connections (${this.maxConnections}) reached, skipping ${mb.email_address}`);
        break;
      }
      const creds = await extractCredentials(mb.metadata || {}, mb);
      if (!creds || !creds.imap_host || !creds.imap_username || !creds.imap_password) continue;
      toAdd.push({ mailbox: mb, creds });
    }

    // Stagger additions in batches
    for (let i = 0; i < toAdd.length; i += STAGGER_BATCH_SIZE) {
      const batch = toAdd.slice(i, i + STAGGER_BATCH_SIZE);
      await Promise.allSettled(
        batch.map(({ mailbox, creds }) => this.addConnection(mailbox, creds)),
      );
      added += batch.length;
      if (i + STAGGER_BATCH_SIZE < toAdd.length && !this.shuttingDown) {
        await new Promise((r) => setTimeout(r, STAGGER_DELAY_MS));
      }
    }

    if (retried > 0) {
      console.log(`[Pool] Retried ${retried} auth_failed connections`);
    }
    return { added, removed, active: this.connections.size };
  }

  // --------------------------------------------------------------------------
  // Add a single connection
  // --------------------------------------------------------------------------

  async addConnection(mailbox: MailboxRecord, credentials: IMAPCredentials): Promise<void> {
    const conn: ManagedConnection = {
      mailboxId: mailbox.id,
      orgId: mailbox.organization_id,
      emailAddress: mailbox.email_address,
      client: null,
      credentials,
      state: 'connecting',
      lastUid: (mailbox.metadata?.last_imap_uid as number) || 0,
      lastJunkUid: (mailbox.metadata?.last_junk_uid as number) || 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
      spamFolderPath: null,
      metadata: mailbox.metadata || {},
      pendingFetch: false,
      authFailedAt: null,
    };

    this.connections.set(mailbox.id, conn);

    try {
      await this.connectAndIdle(conn);
    } catch (err: any) {
      console.error(`[Pool] Initial connection failed for ${conn.emailAddress}:`, err.message);
      // Auth failures stay in the pool as 'auth_failed'. sync() will retry
      // when creds change or AUTH_RETRY_MS elapses, instead of giving up.
      if (err.authenticationFailed) {
        conn.state = 'auth_failed';
        conn.authFailedAt = Date.now();
        await this.onAuthFailure(conn.mailboxId, conn, err);
        return;
      }
      // Schedule reconnect for transient failures
      this.scheduleReconnect(conn);
    }
  }

  // --------------------------------------------------------------------------
  // Core: connect, initial fetch, enter IDLE
  // --------------------------------------------------------------------------

  private async connectAndIdle(conn: ManagedConnection): Promise<void> {
    conn.state = 'connecting';

    const client = new ImapFlow({
      host: conn.credentials.imap_host,
      port: conn.credentials.imap_port || 993,
      secure: true,
      auth: {
        user: conn.credentials.imap_username,
        pass: conn.credentials.imap_password,
      },
      logger: false,
      disableAutoIdle: true,
      maxIdleTime: 2 * 60 * 1000, // restart IDLE every 2 min (app-level keepalive)
      greetingTimeout: 15000,
      socketTimeout: 10 * 60 * 1000, // 10 min — must be much longer than maxIdleTime
      tls: {
        rejectUnauthorized: false,
      },
    } as any);

    // Prevent unhandled 'error' from crashing process
    client.on('error', (err: Error) => {
      // Socket timeouts during IDLE are expected — ImapFlow recovers via NOOP → re-IDLE
      if (err.message === 'Socket timeout') return;
      console.error(`[Pool] ${conn.emailAddress} error event:`, err.message);
    });

    // Handle connection close → reconnect
    client.on('close', () => {
      if (this.shuttingDown) return;
      if (conn.state === 'dead') return;
      console.warn(`[Pool] ${conn.emailAddress} connection closed`);
      conn.client = null;
      this.scheduleReconnect(conn);
    });

    // Handle new mail via IDLE
    client.on('exists', (data: { path: string; count: number; prevCount: number }) => {
      if (this.shuttingDown) return;
      if (data.path !== 'INBOX') return;
      console.log(`[Pool] ${conn.emailAddress} exists event: ${data.prevCount} → ${data.count}`);
      this.handleExistsEvent(conn);
    });

    conn.client = client;
    await client.connect();
    conn.reconnectAttempts = 0;
    // Successful auth — clear any leftover failure markers so the next
    // transient blip doesn't tip a recovered mailbox over the 3-fail threshold.
    if (conn.metadata?.imap_auth_fail_count || conn.metadata?.imap_auth_error) {
      conn.metadata = {
        ...conn.metadata,
        imap_auth_fail_count: 0,
        imap_auth_error: null,
        imap_auth_failed_at: null,
      };
      this.onAuthFailureReset?.(conn.mailboxId, conn).catch(() => {});
    }

    // Initial fetch
    const emails = await fetchFromClient(client, conn.lastUid);
    if (emails.length > 0) {
      const highestUid = emails[emails.length - 1].uid;
      try {
        await this.onNewEmails(conn.mailboxId, emails, conn);
      } catch (err) {
        console.error(`[Pool] ${conn.emailAddress} initial fetch handler error:`, err);
      }
      conn.lastUid = highestUid;
    }

    // Enter IDLE
    conn.state = 'idle';
    client.idle().catch((err: Error) => {
      console.error(`[Pool] ${conn.emailAddress} idle error:`, err.message);
    });
  }

  // --------------------------------------------------------------------------
  // Handle 'exists' event — fetch new emails
  // --------------------------------------------------------------------------

  private async handleExistsEvent(conn: ManagedConnection): Promise<void> {
    if (conn.state === 'fetching') {
      conn.pendingFetch = true;
      return;
    }
    if (!conn.client || !conn.client.usable) return;

    conn.state = 'fetching';

    try {
      do {
        conn.pendingFetch = false;

        const emails = await fetchFromClient(conn.client, conn.lastUid);
        if (emails.length > 0) {
          const highestUid = emails[emails.length - 1].uid;
          try {
            await this.onNewEmails(conn.mailboxId, emails, conn);
          } catch (err) {
            console.error(`[Pool] ${conn.emailAddress} exists handler error:`, err);
          }
          conn.lastUid = highestUid;
        }
      } while (conn.pendingFetch && conn.client?.usable);

      // Re-enter IDLE
      if (conn.client?.usable) {
        conn.state = 'idle';
        conn.client.idle().catch((err: Error) => {
          console.error(`[Pool] ${conn.emailAddress} re-idle error:`, err.message);
        });
      }
    } catch (err) {
      console.error(`[Pool] ${conn.emailAddress} fetch error during exists:`, err);
      // Connection may be corrupted — close and reconnect cleanly
      if (conn.client) {
        conn.client.removeAllListeners();
        try { conn.client.close(); } catch { /* ignore */ }
        conn.client = null;
      }
      this.scheduleReconnect(conn);
    }
  }

  // --------------------------------------------------------------------------
  // Reconnection with exponential backoff
  // --------------------------------------------------------------------------

  private scheduleReconnect(conn: ManagedConnection): void {
    if (this.shuttingDown) return;
    if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);

    conn.reconnectAttempts++;

    if (conn.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(`[Pool] ${conn.emailAddress} exceeded max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}), removing from pool`);
      conn.state = 'dead';
      this.removeConnection(conn.mailboxId).catch(() => {});
      return;
    }

    conn.state = 'reconnecting';
    const baseDelay = Math.min(Math.pow(2, conn.reconnectAttempts) * 1000, 60000);
    const jitter = Math.random() * 500;
    const delay = baseDelay + jitter;

    console.log(`[Pool] ${conn.emailAddress} reconnecting in ${Math.round(delay)}ms (attempt ${conn.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

    conn.reconnectTimer = setTimeout(async () => {
      conn.reconnectTimer = null;
      if (this.shuttingDown) return;

      // Close stale client if any
      if (conn.client) {
        conn.client.removeAllListeners();
        try { conn.client.close(); } catch { /* ignore */ }
        conn.client = null;
      }

      try {
        await this.connectAndIdle(conn);
        console.log(`[Pool] ${conn.emailAddress} reconnected successfully`);
      } catch (err: any) {
        console.error(`[Pool] ${conn.emailAddress} reconnect failed:`, err.message);
        if (err.authenticationFailed) {
          conn.state = 'auth_failed';
          conn.authFailedAt = Date.now();
          await this.onAuthFailure(conn.mailboxId, conn, err);
          return;
        }
        this.scheduleReconnect(conn);
      }
    }, delay);
  }

  // --------------------------------------------------------------------------
  // Backfill — rewind lastUid and re-scan recent messages
  // --------------------------------------------------------------------------

  async backfillAll(rewindBy: number = 200): Promise<{ connections: number; fetched: number; errors: number }> {
    let connections = 0;
    let fetched = 0;
    let errors = 0;

    for (const [, conn] of this.connections) {
      if (this.shuttingDown) break;
      if (conn.state !== 'idle' || !conn.client?.usable) continue;

      const originalUid = conn.lastUid;
      const rewindedUid = Math.max(0, originalUid - rewindBy);

      try {
        conn.state = 'fetching';
        connections++;
        const emails = await fetchFromClient(conn.client, rewindedUid);
        if (emails.length > 0) {
          const highestUid = emails[emails.length - 1].uid;
          await this.onNewEmails(conn.mailboxId, emails, conn);
          conn.lastUid = Math.max(originalUid, highestUid);
          fetched += emails.length;
          console.log(`[Pool] Backfill ${conn.emailAddress}: rewound ${originalUid} → ${rewindedUid}, found ${emails.length} emails`);
        }
        if (conn.client?.usable) {
          conn.state = 'idle';
          conn.client.idle().catch(() => {});
        }
      } catch (err) {
        errors++;
        console.error(`[Pool] Backfill ${conn.emailAddress} error:`, err);
      }
    }

    return { connections, fetched, errors };
  }

  // --------------------------------------------------------------------------
  // Periodic catch-up fetch — polls all idle connections for missed emails
  // --------------------------------------------------------------------------

  async periodicFetchAll(): Promise<{ fetched: number; errors: number }> {
    let fetched = 0;
    let errors = 0;

    for (const [, conn] of this.connections) {
      if (this.shuttingDown) break;
      if (conn.state !== 'idle' || !conn.client?.usable) continue;

      try {
        conn.state = 'fetching';
        const emails = await fetchFromClient(conn.client, conn.lastUid);
        if (emails.length > 0) {
          const highestUid = emails[emails.length - 1].uid;
          await this.onNewEmails(conn.mailboxId, emails, conn);
          conn.lastUid = highestUid;
          fetched += emails.length;
        }
        // Re-enter IDLE
        if (conn.client?.usable) {
          conn.state = 'idle';
          conn.client.idle().catch(() => {});
        }
      } catch {
        errors++;
        // Don't trigger reconnect — let normal error/close handlers deal with it
      }
    }

    return { fetched, errors };
  }

  // --------------------------------------------------------------------------
  // Remove a single connection
  // --------------------------------------------------------------------------

  async removeConnection(mailboxId: string): Promise<void> {
    const conn = this.connections.get(mailboxId);
    if (!conn) return;

    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }

    if (conn.client) {
      conn.client.removeAllListeners();
      try { await conn.client.logout(); } catch { /* ignore */ }
      try { conn.client.close(); } catch { /* ignore */ }
      conn.client = null;
    }

    this.connections.delete(mailboxId);
  }

  // --------------------------------------------------------------------------
  // Spam folder scanning (periodic, on all active connections)
  // --------------------------------------------------------------------------

  async scanAllSpamFolders(): Promise<{ scanned: number; errors: number }> {
    let scanned = 0;
    let errors = 0;

    for (const [, conn] of this.connections) {
      if (this.shuttingDown) break;
      if (conn.state !== 'idle' || !conn.client?.usable) continue;

      try {
        const result = await this.scanSpamForConnection(conn);
        if (result) scanned++;
      } catch {
        errors++;
      }
    }

    return { scanned, errors };
  }

  private async scanSpamForConnection(
    conn: ManagedConnection,
  ): Promise<boolean> {
    if (!conn.client?.usable) return false;

    // Discover spam folder path on first scan
    if (conn.spamFolderPath === null) {
      try {
        const mailboxes = await conn.client.list();
        const spam = mailboxes.find((mb: any) =>
          SPAM_FOLDER_NAMES.some((name) =>
            mb.path.toLowerCase() === name.toLowerCase() ||
            mb.specialUse === '\\Junk',
          ),
        );
        conn.spamFolderPath = spam?.path || '';
      } catch {
        conn.spamFolderPath = '';
      }
    }

    if (!conn.spamFolderPath) return false;

    const messages: InboundEmailMessage[] = [];
    const lock = await conn.client.getMailboxLock(conn.spamFolderPath);
    try {
      const mailboxStatus = conn.client.mailbox;
      if (!mailboxStatus || !mailboxStatus.exists || mailboxStatus.exists === 0) {
        return false;
      }

      let range: string;
      if (conn.lastJunkUid > 0) {
        range = `${conn.lastJunkUid + 1}:*`;
      } else {
        const startUid = Math.max(1, (mailboxStatus.uidNext || 1) - 20);
        range = `${startUid}:*`;
      }

      for await (const message of conn.client.fetch(range, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        if (message.uid <= conn.lastJunkUid) continue;

        try {
          const env = message.envelope;
          if (!env) continue;

          const fromAddr = env.from?.[0];
          const toEmails = (env.to || [])
            .map((addr: any) => addr.address?.toLowerCase())
            .filter(Boolean) as string[];

          const { text, html, attachments } = message.source
            ? await parseBodyFromSource(message.source)
            : { text: '', html: '', attachments: [] };

          const refs = message.source
            ? parseReferencesFromSource(message.source)
            : [];

          messages.push({
            uid: message.uid,
            message_id: env.messageId || '',
            in_reply_to: env.inReplyTo || null,
            references: refs,
            from_email: (fromAddr as any)?.address?.toLowerCase() || '',
            from_name: (fromAddr as any)?.name || '',
            to_emails: toEmails,
            subject: env.subject || '(no subject)',
            text_body: text,
            html_body: html,
            loadAttachments: attachments.length ? async () => attachments : undefined,
            date: env.date ? new Date(env.date) : null,
          });
        } catch { /* skip unparseable */ }
      }
    } finally {
      lock.release();
    }

    // Switch back to INBOX and re-IDLE
    const inboxLock = await conn.client.getMailboxLock('INBOX');
    inboxLock.release();

    if (conn.client.usable) {
      conn.state = 'idle';
      conn.client.idle().catch(() => {});
    }

    // Update lastJunkUid
    if (messages.length > 0) {
      const highest = messages[messages.length - 1].uid;
      if (highest > conn.lastJunkUid) conn.lastJunkUid = highest;
    }

    // Emit spam emails for processing
    if (messages.length > 0) {
      this.emit('spam', conn.mailboxId, conn.spamFolderPath, messages, conn);
    }

    return messages.length > 0;
  }

  // --------------------------------------------------------------------------
  // Graceful shutdown
  // --------------------------------------------------------------------------

  async shutdown(timeoutMs = 10000): Promise<void> {
    this.shuttingDown = true;
    console.log(`[Pool] Shutting down ${this.connections.size} connections...`);

    const logoutPromises: Promise<void>[] = [];

    for (const [, conn] of this.connections) {
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      if (conn.client) {
        conn.client.removeAllListeners();
        logoutPromises.push(
          conn.client.logout().catch(() => {
            try { conn.client?.close(); } catch { /* ignore */ }
          }),
        );
      }
    }

    // Wait for all logouts with a hard timeout
    await Promise.race([
      Promise.allSettled(logoutPromises),
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ]);

    this.connections.clear();
    console.log('[Pool] All connections closed');
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  getStats(): PoolStats {
    let connecting = 0, idle = 0, fetching = 0, reconnecting = 0, dead = 0;
    for (const [, conn] of this.connections) {
      switch (conn.state) {
        case 'connecting': connecting++; break;
        case 'idle': idle++; break;
        case 'fetching': fetching++; break;
        case 'reconnecting': reconnecting++; break;
        case 'dead': dead++; break;
      }
    }
    return { total: this.connections.size, connecting, idle, fetching, reconnecting, dead };
  }

  getConnectionDetails(): Array<{
    mailboxId: string;
    email: string;
    state: ConnectionState;
    lastUid: number;
    reconnectAttempts: number;
  }> {
    const details: Array<{
      mailboxId: string;
      email: string;
      state: ConnectionState;
      lastUid: number;
      reconnectAttempts: number;
    }> = [];
    for (const [, conn] of this.connections) {
      details.push({
        mailboxId: conn.mailboxId,
        email: conn.emailAddress,
        state: conn.state,
        lastUid: conn.lastUid,
        reconnectAttempts: conn.reconnectAttempts,
      });
    }
    return details;
  }

  getConnection(mailboxId: string): ManagedConnection | undefined {
    return this.connections.get(mailboxId);
  }
}
