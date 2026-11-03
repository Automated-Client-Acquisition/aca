/**
 * Reply Processing Module (shared)
 *
 * Shared logic for processing inbound email replies.
 * Used by both email-reply-matcher (webhook) and email-imap-poller (cron).
 */

import {
  classifyDeliveryFailure,
  type FailureClassification,
} from './m365-trace.ts';

// ============================================================================
// Auto-Reply Detection
// ============================================================================

const AUTO_REPLY_PATTERNS = [
  /out of office/i,
  /out-of-office/i,
  /on vacation/i,
  /on leave/i,
  /automatic reply/i,
  /auto[- ]?reply/i,
  /auto[- ]?respond/i,
  /autoreply/i,
  /auto[- ]?generated/i,
  /i am currently out/i,
  /i('m| am) away/i,
  /currently unavailable/i,
  /will be out of the office/i,
  /away from (?:my )?(?:email|desk)/i,
  /limited access to email/i,
  /delayed response/i,
  /returning on/i,
  /back in the office/i,
  /thank you for your (?:email|message)/i,
  /this is an automated/i,
  /do not reply to this/i,
  /noreply/i,
  /no-reply/i,
];

const OUT_OF_OFFICE_PATTERNS = [
  /out of (?:the )?office/i,
  /out-of-office/i,
  /\bon (?:an?\s+)?(?:(?:annual|maternity|parental|medical|sick)\s+)?(?:vacation|leave|holiday|pto)\b/i,
  /i(?:'m| am) (?:currently )?(?:away|out|off)/i,
  /will be (?:back|returning) (?:on|in)/i,
  /away from (?:(?:my )?(?:email|desk|computer)|(?:the )?office)/i,
  /limited access to email/i,
  /back in the office/i,
];

const BOUNCE_FROM_PATTERNS = [
  /^mailer-daemon@/i,
  /^postmaster@/i,
  /^mail-daemon@/i,
  /^maildelivery@/i,
  // Exchange NDRs come from MicrosoftExchange<guid>@<tenant> addresses
  /microsoftexchange/i,
];

const BOUNCE_SUBJECT_PATTERNS = [
  /delivery (?:status |has )?(?:notification|failed|failure)/i,
  /undeliverable/i,
  /undelivered mail/i,
  /returned mail/i,
  /mail delivery (?:failed|subsystem|error)/i,
  /failure notice/i,
  /delivery problem/i,
  /message not delivered/i,
  /could not be delivered/i,
  /recipient rejected/i,
  /address rejected/i,
  /user unknown/i,
  /mailbox (?:not found|unavailable|full)/i,
  /permanent failure/i,
];

const BOUNCE_FROM_NAME_PATTERNS = [
  /^mail delivery subsystem$/i,
  /^mail delivery system$/i,
  /^mailer-daemon$/i,
  /^postmaster$/i,
];

/**
 * Detect if an email is a bounce / NDR (non-delivery report).
 */
export function detectBounce(fromEmail?: string, fromName?: string, subject?: string): boolean {
  const email = (fromEmail || '').toLowerCase();
  for (const p of BOUNCE_FROM_PATTERNS) {
    if (p.test(email)) return true;
  }
  const name = (fromName || '').trim();
  for (const p of BOUNCE_FROM_NAME_PATTERNS) {
    if (p.test(name)) return true;
  }
  const subj = subject || '';
  for (const p of BOUNCE_SUBJECT_PATTERNS) {
    if (p.test(subj)) return true;
  }
  return false;
}

/**
 * What an inbound NDR means for the send it bounced, decided from the remote
 * server's diagnostic in the NDR body rather than from the fact that an NDR
 * arrived. Shares classifyDeliveryFailure with the M365 trace reconciler so both
 * paths agree on what a bounce is.
 *
 * Only a dead recipient (5.1.x and friends) suppresses the lead. A 5.7.x
 * reputation/tenant block is our sending identity being refused — the address
 * is fine — and a temporary failure may still be delivered on retry, so neither
 * may kill the enrollment or mark the lead bounced.
 */
export interface NdrOutcome {
  classification: FailureClassification;
  /** email_send_log.status to write. */
  sendLogStatus: 'bounced' | 'blocked' | 'spam' | 'failed';
  /** Stop the enrollment and mark the lead/contact bounced. */
  suppressRecipient: boolean;
}

// NDR bodies quote the original message below the diagnostic; only the head is
// evidence, and our own copy must not feed the keyword matchers.
const NDR_DIAGNOSTIC_CHARS = 4000;

export function classifyNdr(subject?: string, body?: string): NdrOutcome {
  const text = `${subject || ''}\n${(body || '').slice(0, NDR_DIAGNOSTIC_CHARS)}`;
  const classification = classifyDeliveryFailure(text);
  const { category } = classification;

  const sendLogStatus = category === 'hard_bounce'
    ? 'bounced'
    : classification.isReputationBlock || classification.isTenantBlock
    ? 'blocked'
    : category === 'content_block'
    ? 'spam'
    : 'failed';

  return {
    classification,
    sendLogStatus,
    suppressRecipient: category === 'hard_bounce',
  };
}

/**
 * Detect if an email is an auto-reply / out-of-office response.
 */
export function detectAutoReply(subject?: string, body?: string): boolean {
  const textToCheck = `${subject || ''} ${body || ''}`;
  for (const pattern of AUTO_REPLY_PATTERNS) {
    if (pattern.test(textToCheck)) {
      return true;
    }
  }
  return false;
}

/** Detect a temporary absence without conflating it with generic receipts/ticketing replies. */
export function detectOutOfOffice(subject?: string, body?: string): boolean {
  const textToCheck = `${subject || ''} ${body || ''}`;
  return OUT_OF_OFFICE_PATTERNS.some((pattern) => pattern.test(textToCheck));
}

/**
 * Resume on the next business day at 09:00 UTC after a parsed return date.
 * With no reliable date, wait seven business days instead of pausing forever.
 */
export function calculateOOOResumeAt(parsedReturnDate: Date | null, now = new Date()): Date {
  const resume = new Date(parsedReturnDate || now);
  let businessDaysToAdd = parsedReturnDate ? 1 : 7;

  while (businessDaysToAdd > 0) {
    resume.setUTCDate(resume.getUTCDate() + 1);
    const day = resume.getUTCDay();
    if (day !== 0 && day !== 6) businessDaysToAdd--;
  }

  resume.setUTCHours(9, 0, 0, 0);
  return resume;
}

/**
 * Detect warmup emails by looking for the warmup tag in the email body.
 * Matches either the per-message wm_ reference or the legacy tag (default: "smartlead-warmup"), which may appear as plaintext or base64-encoded.
 */
export function detectWarmup(body?: string, htmlBody?: string, warmupTag = 'smartlead-warmup'): boolean {
  const textToCheck = `${body || ''} ${htmlBody || ''}`;
  // Per-message reference (wm_ + 24 hex) written by buildWarmupMessage/Reply. Varies
  // every send, so there is no constant string for a spam filter to learn.
  if (/\bwm_[0-9a-f]{24}\b/.test(textToCheck)) return true;
  const reversedTag = warmupTag.split('-').reverse().join('-');
  // Plaintext check (both tag and reversed form)
  if (textToCheck.includes(warmupTag) || textToCheck.includes(reversedTag)) return true;
  // Strip quoted-printable soft breaks and re-check
  const stripped = textToCheck.replace(/=\r?\n/g, '');
  if (stripped.includes(warmupTag) || stripped.includes(reversedTag)) return true;
  // Base64-encoded variants
  try {
    const b64Tag = btoa(warmupTag).replace(/=+$/, '');
    if (textToCheck.includes(b64Tag)) return true;
    const b64Reversed = btoa(reversedTag).replace(/=+$/, '');
    if (textToCheck.includes(b64Reversed)) return true;
  } catch { /* ignore */ }
  return false;
}

// ============================================================================
// System Email Detection
// ============================================================================

const SYSTEM_EMAIL_PATTERNS = [
  // Bounce / delivery
  /^mailer-daemon@/i, /^postmaster@/i,
  /^mail-daemon@/i, /^maildelivery@/i,
  /^bounce[s-]?@/i,
  // No-reply variants
  /^noreply@/i, /^no-reply@/i, /^noreply-/i,
  /^no_reply@/i, /^donotreply@/i, /^do-not-reply@/i,
  // Notification / transactional prefixes
  /^notifications?@/i, /^notify@/i,
  /^updates?@/i, /^alerts?@/i,
  /^newsletter@/i, /^marketing@/i, /^digest@/i, /^news@/i,
  /^billing@/i, /^invoice@/i, /^receipts?@/i,
  /^security@/i, /^verify@/i, /^verification@/i,
  /^confirm@/i, /^confirmation@/i,
  /^automat(?:ed|ion)@/i, /^system@/i,
  /^unsubscribe@/i,
];

const SYSTEM_DOMAIN_PATTERNS = [
  // Social / big tech
  /@linkedin\.com$/i, /@facebookmail\.com$/i,
  /@google\.com$/i, /@googlemail\.com$/i,
  /@accounts\.google\.com$/i,
  /@youtube\.com$/i, /@twitter\.com$/i, /@x\.com$/i,
  // Payment / e-commerce
  /@stripe\.com$/i, /@paypal\.com$/i, /@shopify\.com$/i,
  // Transactional email platforms
  /@sendgrid\.net$/i, /@mandrillapp\.com$/i,
  /@amazonses\.com$/i, /@postmarkapp\.com$/i,
  /@mailgun\.org$/i, /@mailchimp\.com$/i,
  // Dev tools
  /@github\.com$/i, /@gitlab\.com$/i,
  /@atlassian\.com$/i, /@slack\.com$/i, /@notion\.so$/i,
  /@vercel\.com$/i, /@netlify\.com$/i,
  /@fly\.io$/i, /@heroku\.com$/i,
  // Cloud / SaaS
  /@aws\.amazon\.com$/i,
  /@hubspot\.com$/i, /@salesforce\.com$/i,
  /@intercom\.io$/i, /@zendesk\.com$/i,
  /@calendly\.com$/i, /@zoom\.us$/i,
  /@docusign\.net$/i,
  /@supabase\.io$/i, /@supabase\.com$/i,
];

const SYSTEM_SUBJECT_PATTERNS = [
  /report domain:/i, /report-id/i, /dmarc.*aggregate/i,
  /password reset/i, /reset your password/i,
  /verify your email/i, /confirm your email/i,
  /security alert/i, /verification code/i,
  /two[- ]?factor/i, /\b2fa\b/i,
  /sign[- ]?in .* new device/i,
];

// OTP / login-code emails are actionable, time-sensitive mail the user needs
// to see — checked before every other rule below so they're never suppressed
// even though they come from noreply@/security@ senders and otherwise match
// SYSTEM_SUBJECT_PATTERNS like "verification code" or "2fa".
const OTP_SUBJECT_PATTERNS = [
  /\bone[- ]?time (login |use )?(code|password|pin)\b/i,
  /\b(login|security|verification|authentication) code\b/i,
  /\byour (code|pin) is\b/i,
  /\bOTP\b/,
  /\b2fa code\b/i,
];

/**
 * Detect system/automated emails that should not appear in the inbox
 * or affect priority/response time stats.
 */
export function isSystemEmail(fromEmail?: string, subject?: string): boolean {
  const email = (fromEmail || '').toLowerCase();
  const subjectText = subject || '';

  if (OTP_SUBJECT_PATTERNS.some((p) => p.test(subjectText))) {
    return false;
  }

  for (const p of SYSTEM_EMAIL_PATTERNS) {
    if (p.test(email)) return true;
  }
  for (const p of SYSTEM_DOMAIN_PATTERNS) {
    if (p.test(email)) return true;
  }
  for (const p of SYSTEM_SUBJECT_PATTERNS) {
    if (p.test(subjectText)) return true;
  }

  return detectBounce(fromEmail, undefined, subjectText);
}

// ============================================================================
// Enrollment Processing
// ============================================================================

/**
 * Process a reply for a specific send_log entry — pause/complete enrollment,
 * handle auto-replies, and optionally stop company-level enrollments.
 */
export async function processReplyForEnrollment(
  supabase: any,
  sendLogEntry: {
    id: string;
    sequence_id: string;
    lead_id: string;
    organization_id: string;
  },
  fromEmail: string,
  isAutoReply: boolean,
  disposition?: {
    isOutOfOffice?: boolean;
    resumeAt?: Date;
    conversationId?: string;
  },
): Promise<{ paused: boolean; companyStopped: number }> {
  const nowISO = new Date().toISOString();
  let paused = false;
  let companyStopped = 0;

  if (!sendLogEntry.sequence_id || !sendLogEntry.lead_id) {
    return { paused, companyStopped };
  }

  const { data: enrollment } = await supabase
    .from('email_sequence_enrollments')
    .select('id, sequence_id, status, pause_reason, resume_at, metadata')
    .eq('sequence_id', sendLogEntry.sequence_id)
    .eq('lead_id', sendLogEntry.lead_id)
    .in('status', ['active', 'paused'])
    .single();

  if (!enrollment) {
    return { paused, companyStopped };
  }

  // Load sequence settings
  const { data: sequence } = await supabase
    .from('email_sequences')
    .select('settings')
    .eq('id', enrollment.sequence_id)
    .single();

  const settings = sequence?.settings || {};

  const isOOO = disposition?.isOutOfOffice === true;
  const isProtectedManualPause = enrollment.status === 'paused' && enrollment.pause_reason !== 'out_of_office';

  if (isOOO) {
    if (isProtectedManualPause) return { paused, companyStopped };

    const requestedResumeAt = disposition?.resumeAt || calculateOOOResumeAt(null);
    const existingResumeAt = enrollment.resume_at ? new Date(enrollment.resume_at) : null;
    const resumeAt = existingResumeAt && existingResumeAt > requestedResumeAt
      ? existingResumeAt
      : requestedResumeAt;
    await supabase
      .from('email_sequence_enrollments')
      .update({
        status: 'paused',
        pause_reason: 'out_of_office',
        resume_at: resumeAt.toISOString(),
        paused_by_conversation_id: disposition?.conversationId || null,
        metadata: {
          ...((enrollment.metadata as Record<string, unknown>) || {}),
          ooo_detected_at: nowISO,
          ooo_return_date: resumeAt.toISOString(),
        },
        updated_at: nowISO,
      })
      .eq('id', enrollment.id)
      .in('status', ['active', 'paused']);
    paused = true;
    console.log(`[Reply Processing] OOO detected, paused enrollment ${enrollment.id} until ${resumeAt.toISOString()}`);
  } else if (isAutoReply) {
    if (enrollment.status !== 'active') return { paused, companyStopped };
    if (settings.stop_on_auto_reply !== false) {
      await supabase
        .from('email_sequence_enrollments')
        .update({ status: 'paused', pause_reason: 'auto_reply', resume_at: null, updated_at: nowISO })
        .eq('id', enrollment.id);
      paused = true;
      console.log(`[Reply Processing] Auto-reply detected, paused enrollment ${enrollment.id}`);
    }
  } else {
    if (isProtectedManualPause) return { paused, companyStopped };
    // Real reply
    if (settings.stop_on_reply !== false) {
      await supabase
        .from('email_sequence_enrollments')
        .update({
          status: 'replied',
          pause_reason: null,
          resume_at: null,
          paused_by_conversation_id: null,
          updated_at: nowISO,
        })
        .eq('id', enrollment.id);
      paused = true;
      console.log(`[Reply Processing] Reply detected, completed enrollment ${enrollment.id}`);
    }

    // Company-level stop
    if (settings.stop_company_on_reply) {
      const domain = fromEmail.split('@')[1]?.toLowerCase();
      if (domain) {
        companyStopped = await stopCompanyEnrollments(
          supabase,
          sendLogEntry.sequence_id,
          domain,
          enrollment.id
        );
      }
    }
  }

  return { paused, companyStopped };
}

/**
 * Apply an inbound disposition to continuation enrollments anchored to a CRM
 * conversation. This covers replies to a manual fulfillment email before the
 * first automated follow-up has produced its own sequence send-log entry.
 */
export async function processReplyForConversationEnrollments(
  supabase: any,
  input: {
    organizationId: string;
    conversationId: string;
    fromEmail: string;
    isAutoReply: boolean;
    isOutOfOffice: boolean;
    resumeAt?: Date;
  },
): Promise<number> {
  const { data: enrollments, error } = await supabase
    .from('email_sequence_enrollments')
    .select('id, sequence_id, lead_id, email_sequences!inner(organization_id)')
    .in('status', ['active', 'paused'])
    .eq('email_sequences.organization_id', input.organizationId)
    .filter('metadata->>continue_from_conversation_id', 'eq', input.conversationId);

  if (error || !enrollments?.length) return 0;

  let processed = 0;
  for (const enrollment of enrollments) {
    await processReplyForEnrollment(
      supabase,
      {
        id: enrollment.id,
        sequence_id: enrollment.sequence_id,
        lead_id: enrollment.lead_id,
        organization_id: input.organizationId,
      },
      input.fromEmail,
      input.isAutoReply,
      {
        isOutOfOffice: input.isOutOfOffice,
        resumeAt: input.resumeAt,
        conversationId: input.conversationId,
      },
    );
    processed++;
  }

  return processed;
}

// ============================================================================
// Company-Level Stop
// ============================================================================

/**
 * Stop all active enrollments for leads with the same company domain,
 * excluding the enrollment that triggered the stop.
 */
export async function stopCompanyEnrollments(
  supabase: any,
  sequenceId: string,
  domain: string,
  excludeEnrollmentId: string
): Promise<number> {
  const { data: otherEnrollments } = await supabase
    .from('email_sequence_enrollments')
    .select(`
      id,
      leads:lead_id (email)
    `)
    .eq('sequence_id', sequenceId)
    .eq('status', 'active')
    .neq('id', excludeEnrollmentId);

  if (!otherEnrollments || otherEnrollments.length === 0) return 0;

  let stoppedCount = 0;
  const nowISO = new Date().toISOString();

  for (const enrollment of otherEnrollments) {
    const leadEmail = (enrollment as any).leads?.email;
    if (!leadEmail) continue;

    const leadDomain = leadEmail.split('@')[1]?.toLowerCase();
    if (leadDomain === domain) {
      await supabase
        .from('email_sequence_enrollments')
        .update({
          status: 'paused',
          pause_reason: 'company_reply',
          resume_at: null,
          updated_at: nowISO,
        })
        .eq('id', enrollment.id);

      stoppedCount++;
      console.log(`[Reply Processing] Company-stopped enrollment ${enrollment.id} (domain: ${domain})`);
    }
  }

  return stoppedCount;
}
