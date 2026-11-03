/**
 * Microsoft Graph Sender Module
 *
 * Sends email for M365 mailboxes via the Graph `sendMail` API using an
 * app-only (client_credentials) token — NOT SMTP basic auth. This mirrors the
 * inbound side (imap-poller/graph-poller.ts), which already polls M365 inboxes
 * over Graph with the same single app, targeting each tenant by GUID. Moving
 * outbound to Graph makes sending symmetric with receiving and removes the
 * per-mailbox SMTP password — the source of the 535 / password-drift instability.
 *
 * We send a full RFC-5322 MIME message (built with nodemailer's MailComposer)
 * via `POST /users/{userId}/sendMail` with a base64 body. Raw MIME — rather than
 * Graph's `message` JSON — preserves standard headers Graph's internetMessageHeaders
 * rejects (List-Unsubscribe, In-Reply-To, References) and lets us mint our own
 * Message-Id for sequence threading, matching what the SMTP path returns.
 *
 * Rollout safety: when Graph cannot send for an app-level reason (no Mail.Send
 * consent, access policy, mailbox not REST-enabled), we return `fallbackToSmtp:
 * true` so the caller retries over SMTP. That makes adopting Graph strictly
 * non-regressive — worst case it behaves exactly like the old SMTP-only path.
 */

import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { randomUUID } from 'node:crypto';
import type { SMTPErrorCategory } from './smtp-client.js';

const LOGIN_URL = 'https://login.microsoftonline.com';
const GRAPH_URL = 'https://graph.microsoft.com/v1.0';

export interface GraphSendParams {
  /** Azure AD tenant GUID (from m365_tenants.tenant_id). */
  tenantId: string;
  /** The M365 user object id of the sending mailbox (metadata.m365_user_id). */
  userId: string;
  from_name: string;
  from_email: string;
  to_email: string;
  subject: string;
  html?: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  headers?: Record<string, string>;
  in_reply_to?: string;
  references?: string[];
}

/** Same shape as SMTPSendResult, plus a fallback signal for the dispatcher. */
export interface GraphSendResult {
  success: boolean;
  message_id: string;
  error?: string;
  error_category?: SMTPErrorCategory;
  /**
   * True only when NOTHING was sent AND the cause is app-level (so SMTP might
   * succeed where Graph couldn't). Never set on a recipient bounce or a
   * transient 5xx/429 — falling back there could double-send.
   */
  fallbackToSmtp?: boolean;
}

// ============================================================================
// Token cache (one client_credentials call per tenant, reused until expiry)
// ============================================================================

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

async function getGraphToken(tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId);
  // 60s skew buffer so we never send with a token about to expire mid-flight.
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const clientId = process.env.M365_APP_CLIENT_ID;
  const clientSecret = process.env.M365_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('M365_APP_CLIENT_ID and M365_APP_CLIENT_SECRET env vars are required');
  }

  const res = await fetch(`${LOGIN_URL}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(`Graph token failed: ${data.error_description || data.error || JSON.stringify(data).slice(0, 200)}`);
  }

  tokenCache.set(tenantId, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}

// ============================================================================
// MIME building
// ============================================================================

function buildMime(params: GraphSendParams, messageId: string): Promise<Buffer> {
  const composer = new MailComposer({
    from: params.from_name ? `"${params.from_name}" <${params.from_email}>` : params.from_email,
    to: params.to_email,
    subject: params.subject,
    html: params.html,
    text: params.text,
    cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
    bcc: params.bcc && params.bcc.length > 0 ? params.bcc : undefined,
    inReplyTo: params.in_reply_to,
    references: params.references && params.references.length > 0 ? params.references.join(' ') : undefined,
    messageId,
    headers: params.headers && Object.keys(params.headers).length > 0 ? params.headers : undefined,
  });

  return new Promise((resolve, reject) => {
    composer.compile().build((err: Error | null, message: Buffer) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

// ============================================================================
// Send
// ============================================================================

export async function sendEmailViaGraph(params: GraphSendParams): Promise<GraphSendResult> {
  // Mint our own Message-Id so follow-up steps thread (In-Reply-To / References)
  // exactly as SMTP does — Graph's sendMail does not return the internetMessageId.
  const domain = params.from_email.split('@')[1] || 'localhost';
  const messageId = `<${randomUUID()}@${domain}>`;

  let mime: Buffer;
  try {
    mime = await buildMime(params, messageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MIME build failed';
    return { success: false, message_id: '', error: `Graph MIME error: ${message}`, error_category: 'soft_bounce' };
  }

  let token: string;
  try {
    token = await getGraphToken(params.tenantId);
  } catch (error) {
    // App/tenant token failure (bad client creds, missing consent, tenant
    // outage). Nothing was sent and SMTP might work → fall back.
    const message = error instanceof Error ? error.message : 'token error';
    console.error(`[Graph] Token error for tenant ${params.tenantId}: ${message}`);
    return { success: false, message_id: '', error: `Graph token error: ${message}`, error_category: 'network_error', fallbackToSmtp: true };
  }

  try {
    const res = await fetch(`${GRAPH_URL}/users/${encodeURIComponent(params.userId)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
      // Graph accepts a base64-encoded RFC-5322 MIME message as the raw body.
      body: mime.toString('base64'),
    });

    if (res.status === 202) {
      return { success: true, message_id: messageId };
    }

    const errText = await res.text();
    const { category, fallback } = classifyGraphError(res.status, errText);
    console.error(`[Graph] sendMail failed [${category}${fallback ? '/fallback' : ''}] ${res.status}: ${params.from_email} -> ${params.to_email}: ${errText.slice(0, 300)}`);
    return { success: false, message_id: '', error: `Graph ${res.status}: ${errText.slice(0, 300)}`, error_category: category, fallbackToSmtp: fallback };
  } catch (error) {
    // Network error talking to Graph. Don't fall back (the POST may have been
    // received) — let it retry next cycle.
    const message = error instanceof Error ? error.message : 'Graph request failed';
    console.error(`[Graph] Network error: ${params.from_email} -> ${params.to_email}: ${message}`);
    return { success: false, message_id: '', error: `Graph network error: ${message}`, error_category: 'network_error' };
  }
}

/**
 * Classify a Graph error → (SMTP error category, should-we-fall-back-to-SMTP).
 * fallback=true ONLY when nothing was sent and the cause is app/mailbox-level
 * (SMTP is a viable alternative). Recipient bounces and transient 5xx/429 never
 * fall back — that would risk a double-send.
 */
function classifyGraphError(status: number, errText: string): { category: SMTPErrorCategory; fallback: boolean } {
  const msg = errText.toLowerCase();

  // Recipient problems → bounce, no fallback (don't re-send to a bad address).
  if (
    msg.includes('errorinvalidrecipients') ||
    msg.includes('errorrecipientnotfound') ||
    msg.includes('invalid recipients') ||
    msg.includes('unable to send to recipients')
  ) {
    return { category: 'hard_bounce', fallback: false };
  }

  // Throttling → transient, no fallback (retry next cycle).
  if (status === 429 || msg.includes('throttl') || msg.includes('too many requests') || msg.includes('quota')) {
    return { category: 'rate_limited', fallback: false };
  }

  // This specific mailbox can't send via Graph (not REST-enabled / disabled) —
  // SMTP may still work, so fall back.
  if (
    msg.includes('mailboxnotenabledforrestapi') ||
    msg.includes('errornonexistentmailbox') ||
    msg.includes('mailbox is disabled') ||
    msg.includes('inactivemailbox') ||
    (status === 404 && msg.includes('resourcenotfound'))
  ) {
    return { category: 'network_error', fallback: true };
  }

  // App-level / access-policy auth (no Mail.Send consent, access policy excludes
  // mailbox). Nothing sent → fall back to SMTP. Categorized network_error so it
  // is treated as transient, never disconnecting the mailbox.
  if (status === 401 || status === 403) {
    return { category: 'network_error', fallback: true };
  }

  // Server-side / transient → retry, no fallback (avoid double-send).
  if (status >= 500 || msg.includes('service unavailable') || msg.includes('try again')) {
    return { category: 'network_error', fallback: false };
  }

  return { category: 'soft_bounce', fallback: false };
}
