/**
 * SMTP Client Module
 *
 * Sends emails via SMTP using nodemailer.
 * Credential decryption delegated to crypto module.
 */

import { createTransport } from 'nodemailer';
import { randomUUID } from 'node:crypto';
export { extractSMTPCredentials, type SMTPCredentials } from './crypto.js';

// ============================================================================
// Types
// ============================================================================

export interface SMTPSendParams {
  credentials: {
    smtp_host: string;
    smtp_port: number;
    smtp_username: string;
    smtp_password: string;
  };
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
  /** Our own Message-ID (with angle brackets); nodemailer generates one otherwise. */
  message_id?: string;
  /** Socket inactivity timeout; default 15 s. */
  socket_timeout_ms?: number;
}

export type SMTPErrorCategory = 'hard_bounce' | 'soft_bounce' | 'auth_error' | 'rate_limited' | 'network_error' | 'reputation_block' | 'content_block' | 'tenant_block' | 'unknown';

export interface SMTPSendResult {
  success: boolean;
  message_id: string;
  error?: string;
  error_category?: SMTPErrorCategory;
  /** The SMTP exchange timed out: the server may still have accepted the message. */
  timed_out?: boolean;
}

// ============================================================================
// SMTP Sending
// ============================================================================

export async function sendEmailViaSMTP(params: SMTPSendParams): Promise<SMTPSendResult> {
  const { credentials, from_name, from_email, to_email, subject, html, text, cc, bcc, headers, in_reply_to, references, message_id, socket_timeout_ms } = params;

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
      socketTimeout: socket_timeout_ms ?? 15000,
    });

    const mailOptions: Record<string, unknown> = {
      from: from_name ? `"${from_name}" <${from_email}>` : from_email,
      to: to_email,
      subject,
    };

    if (html) mailOptions.html = html;
    if (text) mailOptions.text = text;
    if (cc && cc.length > 0) mailOptions.cc = cc;
    if (bcc && bcc.length > 0) mailOptions.bcc = bcc;
    if (message_id) mailOptions.messageId = message_id;
    if (in_reply_to) mailOptions.inReplyTo = in_reply_to;
    if (references && references.length > 0) mailOptions.references = references.join(' ');

    if (headers && Object.keys(headers).length > 0) {
      mailOptions.headers = headers;
    }

    const info = await transporter.sendMail(mailOptions);

    return {
      success: true,
      message_id: info.messageId || `smtp_${randomUUID()}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SMTP error';
    const category = categorizeSmtpError(message);
    console.error(`[SMTP] Send failed [${category}]: ${from_email} -> ${to_email}:`, message);
    const code = (error as { code?: string } | null)?.code;
    return {
      success: false,
      message_id: '',
      error: message,
      error_category: category,
      timed_out: code === 'ETIMEDOUT' || /\btime ?out\b/i.test(message),
    };
  }
}

export function categorizeSmtpError(errorMessage: string): SMTPErrorCategory {
  const msg = errorMessage.toLowerCase();

  // Keep recipient/reputation/content distinctions aligned with the edge
  // m365-trace classifier. A bare 550 does not prove a dead recipient.
  if (/\b5\.1\.(1|10)\b/.test(msg) ||
      msg.includes('mailbox not found') ||
      msg.includes('user unknown') ||
      msg.includes('unknown user') ||
      msg.includes('no such user') ||
      msg.includes('no such recipient') ||
      msg.includes('unrouteable address') ||
      // Gmail 550-5.2.1: the account exists but is disabled/abandoned — permanent.
      /account (that )?(you tried to reach )?is (inactive|disabled)/.test(msg) ||
      /recipient (address )?(not found|unknown)|invalid recipient|resolver\.adr\.recipnotfound/.test(msg) ||
      /mailbox (is )?(unavailable|does not exist)|address (does not exist|not found)/.test(msg)) {
    return 'hard_bounce';
  }

  if (/\b535\b/.test(msg) ||
      msg.includes('authentication failed') ||
      msg.includes('invalid login') ||
      msg.includes('username and password not accepted') ||
      msg.includes('bad credentials') ||
      msg.includes('login failed') ||
      msg.includes('auth') && msg.includes('fail')) {
    return 'auth_error';
  }

  if (/\b5\.(1\.8|7\.(750|501|705))\b|bad outbound sender|outbound spam|tenant (has )?exceeded (the )?threshold|user (has been )?(blocked|restricted) from sending/.test(msg)) {
    return 'tenant_block';
  }

  if (/reputation|unsolicited|black ?list|block ?list|blocked list|spamhaus|spamcop|barracuda|sorbs|uceprotect|senderscore|banned sending ip|\bs3(14|15)\d\b|\b5\.7\.6\d\d\b|not accepted from your (ip|server)|sending (ip|domain) .*(bad|poor|low)|has been blocked/.test(msg)) {
    // Temporary receiver reputation deferrals also must not become recipient
    // bounces or transport circuit-breaker failures.
    return 'reputation_block';
  }

  if (/content[- ]?filter|message content|high probability of spam|virus|malware|suspicious link/.test(msg)) {
    return 'content_block';
  }

  if (msg.includes('too many messages') ||
      msg.includes('too many connections') ||
      msg.includes('rate limit') ||
      msg.includes('throttl') ||
      msg.includes('sending quota') ||
      msg.includes('daily limit') ||
      msg.includes('message rate') ||
      (/\b(421|429)\b/.test(msg) && (msg.includes('too many') || msg.includes('rate')))) {
    return 'rate_limited';
  }

  if (msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('ehostunreach') ||
      msg.includes('connection timeout') ||
      msg.includes('connection closed') ||
      msg.includes('socket hang up') ||
      msg.includes('getaddrinfo')) {
    return 'network_error';
  }

  if (/\b(421|450|451|452)\b/.test(msg) ||
      msg.includes('try again later') ||
      msg.includes('try again') ||
      msg.includes('mailbox full') ||
      msg.includes('quota exceeded') ||
      msg.includes('over quota') ||
      msg.includes('temporary failure') ||
      msg.includes('temporarily rejected') ||
      msg.includes('service unavailable')) {
    return 'soft_bounce';
  }

  return 'unknown';
}
