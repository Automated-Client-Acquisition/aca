/**
 * SMTP Client Module
 *
 * Sends emails via SMTP using nodemailer.
 * Tests IMAP connections via imapflow.
 * Handles credential encryption/decryption for secure storage in metadata.
 */

import { createTransport } from "npm:nodemailer@^6";
import { ImapFlow } from "npm:imapflow@^1.0";
import { Buffer } from "node:buffer";
import {
  classifyDeliveryFailure,
  type DeliveryErrorCategory,
} from "./m365-trace.ts";

// ============================================================================
// Types
// ============================================================================

export interface SMTPCredentials {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_email?: string; // ACS: explicit From address (differs from auth username)
  imap_host?: string;
  imap_port?: number;
  imap_username?: string;
  imap_password?: string;
}

export interface SMTPSendParams {
  credentials: SMTPCredentials;
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
  send_log_id?: string; // Used to generate a traceable Message-ID for inbound threading
  attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>;
}

export type SMTPErrorCategory = DeliveryErrorCategory | "network_error";

export interface SMTPSendResult {
  success: boolean;
  message_id: string;
  error?: string;
  error_category?: SMTPErrorCategory;
}

// ============================================================================
// SMTP Sending
// ============================================================================

/**
 * Send an email via SMTP using the provided credentials.
 */
export async function sendEmailViaSMTP(
  params: SMTPSendParams,
): Promise<SMTPSendResult> {
  const {
    credentials,
    from_name,
    from_email,
    to_email,
    subject,
    html,
    text,
    cc,
    bcc,
    headers,
    in_reply_to,
    references,
    send_log_id,
    attachments,
  } = params;

  try {
    // ACS uses verified Microsoft TLS certs; self-hosted Postfix may use self-signed
    const isAcs = credentials.smtp_host === "smtp.azurecomm.net";

    const transporter = createTransport({
      host: credentials.smtp_host,
      port: credentials.smtp_port,
      secure: credentials.smtp_port === 465,
      auth: {
        user: credentials.smtp_username,
        pass: credentials.smtp_password,
      },
      tls: {
        rejectUnauthorized: isAcs, // true for ACS (Microsoft certs), false for self-hosted
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const mailOptions: Record<string, unknown> = {
      from: from_name ? `"${from_name}" <${from_email}>` : from_email,
      to: to_email,
      subject,
    };

    // Generate a deterministic Message-ID for inbound reply threading
    // Format: <{send_log_id}@{domain}> — enables reliable In-Reply-To matching
    if (send_log_id) {
      const domain = from_email.split("@")[1] || "aca.email";
      mailOptions.messageId = `<${send_log_id}@${domain}>`;
    }

    if (html) mailOptions.html = html;
    if (text) mailOptions.text = text;
    if (cc && cc.length > 0) mailOptions.cc = cc;
    if (bcc && bcc.length > 0) mailOptions.bcc = bcc;
    if (in_reply_to) mailOptions.inReplyTo = in_reply_to;
    if (references && references.length > 0) {
      mailOptions.references = references.join(" ");
    }

    if (headers && Object.keys(headers).length > 0) {
      mailOptions.headers = headers;
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content),
        contentType: att.contentType,
      }));
    }

    // Watchdog: nodemailer's socketTimeout doesn't reliably fire under Deno's
    // shim, so a dead Office365 SMTP socket can hang sendMail() forever — which
    // strands the caller's send_log row in 'sending' until the edge function is
    // killed. Race the send against a hard 20s cap (just above the 15s socket
    // timeout) so the call always settles and the caller can finalize the row.
    const SEND_WATCHDOG_MS = 20000;
    let watchdogId: number | undefined;
    const info = await Promise.race([
      transporter.sendMail(mailOptions),
      new Promise<never>((_, reject) => {
        watchdogId = setTimeout(
          () =>
            reject(
              new Error(
                `SMTP send watchdog: connection timeout, no response after ${SEND_WATCHDOG_MS}ms`,
              ),
            ),
          SEND_WATCHDOG_MS,
        ) as unknown as number;
      }),
    ]).finally(() => {
      if (watchdogId !== undefined) clearTimeout(watchdogId);
      try {
        transporter.close();
      } catch { /* best-effort socket teardown */ }
    });

    // Return the actual Message-ID (either our deterministic one or server-assigned)
    const messageId = info.messageId ||
      (send_log_id
        ? `${send_log_id}@${from_email.split("@")[1] || "aca.email"}`
        : `smtp_${crypto.randomUUID()}`);

    return {
      success: true,
      message_id: messageId.replace(/^<|>$/g, ""), // Strip angle brackets for storage
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown SMTP error";
    const category = categorizeSmtpError(message);
    console.error(
      `[SMTP] Send failed [${category}]: ${from_email} -> ${to_email}:`,
      message,
    );
    return {
      success: false,
      message_id: "",
      error: message,
      error_category: category,
    };
  }
}

/**
 * Categorize an SMTP error message into a structured category.
 * A generic SMTP 5xx is intentionally not called a bounce. It can mean a
 * bad recipient, a domain-reputation block, content policy, or another remote
 * failure. Only recipient-specific diagnostics become `hard_bounce`.
 */
function categorizeSmtpError(errorMessage: string): SMTPErrorCategory {
  const msg = errorMessage.toLowerCase();

  // Network errors — connection failures
  if (
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("ehostunreach") ||
    msg.includes("connection timeout") ||
    msg.includes("connection closed") ||
    msg.includes("socket hang up") ||
    msg.includes("getaddrinfo")
  ) {
    return "network_error";
  }

  return classifyDeliveryFailure(errorMessage).category;
}

/**
 * Test an SMTP connection by verifying the transport.
 */
export async function testSMTPConnection(
  credentials: SMTPCredentials,
): Promise<{ success: boolean; error?: string }> {
  try {
    const transporter = createTransport({
      host: credentials.smtp_host,
      port: credentials.smtp_port,
      secure: credentials.smtp_port === 465,
      auth: {
        user: credentials.smtp_username,
        pass: credentials.smtp_password,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    await transporter.verify();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Connection failed";
    return { success: false, error: message };
  }
}

/**
 * Test an IMAP connection by connecting, logging in, and disconnecting.
 */
export async function testIMAPConnection(
  credentials: SMTPCredentials,
): Promise<{ success: boolean; error?: string }> {
  if (
    !credentials.imap_host || !credentials.imap_username ||
    !credentials.imap_password
  ) {
    return {
      success: false,
      error: "Missing IMAP credentials (host, username, password)",
    };
  }

  const client = new ImapFlow({
    host: credentials.imap_host,
    port: credentials.imap_port || 993,
    secure: true,
    auth: {
      user: credentials.imap_username,
      pass: credentials.imap_password,
    },
    logger: false,
    tls: {
      rejectUnauthorized: false,
    },
  });

  try {
    const connectResult = await Promise.race([
      (async () => {
        await client.connect();
        // Don't call logout() — Outlook drops the TLS connection without close_notify
        // which causes Deno event loop errors. Just close the socket directly.
        client.close();
        return { success: true as const };
      })(),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(
          () =>
            resolve({
              success: false,
              error: "IMAP connection timed out (15s)",
            }),
          15000,
        )
      ),
    ]);
    return connectResult;
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "IMAP connection failed";
    // Real auth failures: imapflow sets authenticationFailed=true on the error object.
    // Never treat those as success even if the message string also says "Command failed".
    const isAuthFailure =
      (error as { authenticationFailed?: boolean })?.authenticationFailed ===
        true;
    if (isAuthFailure) {
      return {
        success: false,
        error: "IMAP authentication failed — check username and password",
      };
    }
    // Treat Outlook's abrupt TLS close as success — connection and auth worked.
    if (
      message.includes("UnexpectedEof") ||
      message.includes("unexpected eof") ||
      message.includes("peer closed connection") ||
      message === "Command failed"
    ) {
      return { success: true };
    }
    return { success: false, error: message };
  }
}

// ============================================================================
// Credential Encryption (delegates to shared encryption module)
// ============================================================================

import { decryptJSON, encryptJSON } from "./encryption.ts";

/**
 * Encrypt SMTP credentials for storage in metadata.
 */
export async function encryptCredentials(
  creds: SMTPCredentials,
): Promise<string> {
  return encryptJSON(creds);
}

/**
 * Decrypt SMTP credentials from stored metadata.
 */
export async function decryptCredentials(
  encrypted: string,
): Promise<SMTPCredentials> {
  return decryptJSON<SMTPCredentials>(encrypted);
}

/**
 * Extract and decrypt SMTP credentials from mailbox metadata.
 * Returns null if credentials are missing or decryption fails.
 */
export async function extractSMTPCredentials(
  metadata: Record<string, unknown>,
): Promise<SMTPCredentials | null> {
  try {
    const encrypted = metadata?.smtp_credentials as string;
    if (!encrypted) return null;
    return await decryptCredentials(encrypted);
  } catch (error) {
    console.error("[SMTP] Failed to extract credentials:", error);
    return null;
  }
}

export type SMTPCredentialsExtractionFailure =
  | "missing_credentials"
  | "decryption_failed";

export type SMTPCredentialsExtractionResult =
  | { ok: true; creds: SMTPCredentials }
  | { ok: false; reason: SMTPCredentialsExtractionFailure };

/**
 * Variant of extractSMTPCredentials that distinguishes "no credentials present"
 * from "credentials present but undecryptable". Used by the export edge function
 * so the UI can tell the user which mailboxes need re-connecting and why.
 */
export async function extractSMTPCredentialsWithReason(
  metadata: Record<string, unknown>,
): Promise<SMTPCredentialsExtractionResult> {
  const encrypted = metadata?.smtp_credentials;
  if (!encrypted || typeof encrypted !== "string") {
    return { ok: false, reason: "missing_credentials" };
  }
  try {
    const creds = await decryptCredentials(encrypted);
    return { ok: true, creds };
  } catch (error) {
    console.error("[SMTP] Failed to decrypt credentials:", error);
    return { ok: false, reason: "decryption_failed" };
  }
}
