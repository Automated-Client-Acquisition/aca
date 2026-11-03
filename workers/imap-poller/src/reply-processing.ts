/**
 * Reply Processing Module (Node.js port)
 *
 * Shared logic for processing inbound email replies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Auto-Reply Detection
// ============================================================================

const AUTO_REPLY_PATTERNS = [
  /out of office/i, /out-of-office/i, /on vacation/i, /on leave/i,
  /automatic reply/i, /auto[- ]?reply/i, /auto[- ]?respond/i,
  /autoreply/i, /auto[- ]?generated/i, /i am currently out/i,
  /i('m| am) away/i, /currently unavailable/i,
  /will be out of the office/i, /away from (?:my )?(?:email|desk)/i,
  /limited access to email/i, /delayed response/i,
  /returning on/i, /back in the office/i,
  /thank you for your (?:email|message)/i, /this is an automated/i,
  /do not reply to this/i, /noreply/i, /no-reply/i,
];

const OUT_OF_OFFICE_PATTERNS = [
  /out of (?:the )?office/i, /out-of-office/i,
  /\bon (?:an?\s+)?(?:(?:annual|maternity|parental|medical|sick)\s+)?(?:vacation|leave|holiday|pto)\b/i,
  /i(?:'m| am) (?:currently )?(?:away|out|off)/i,
  /will be (?:back|returning) (?:on|in)/i,
  /away from (?:(?:my )?(?:email|desk|computer)|(?:the )?office)/i,
  /limited access to email/i, /back in the office/i,
];

const BOUNCE_FROM_PATTERNS = [
  /^mailer-daemon@/i, /^postmaster@/i,
  /^mail-daemon@/i, /^maildelivery@/i,
  // Exchange NDRs come from MicrosoftExchange<guid>@<tenant> addresses
  /microsoftexchange/i,
];

const BOUNCE_SUBJECT_PATTERNS = [
  /delivery (?:status |has )?(?:notification|failed|failure)/i,
  /undeliverable/i, /undelivered mail/i, /returned mail/i,
  /mail delivery (?:failed|subsystem|error)/i,
  /failure notice/i, /delivery problem/i,
  /message not delivered/i, /could not be delivered/i,
  /recipient rejected/i, /address rejected/i,
  /user unknown/i, /mailbox (?:not found|unavailable|full)/i,
  /permanent failure/i,
];

const BOUNCE_FROM_NAME_PATTERNS = [
  /^mail delivery subsystem$/i,
  /^mail delivery system$/i,
  /^mailer-daemon$/i,
  /^postmaster$/i,
];

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

export function detectAutoReply(subject?: string, body?: string): boolean {
  const textToCheck = `${subject || ''} ${body || ''}`;
  for (const pattern of AUTO_REPLY_PATTERNS) {
    if (pattern.test(textToCheck)) return true;
  }
  return false;
}

export function detectOutOfOffice(subject?: string, body?: string): boolean {
  const textToCheck = `${subject || ''} ${body || ''}`;
  return OUT_OF_OFFICE_PATTERNS.some((pattern) => pattern.test(textToCheck));
}

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
    const b64Tag = Buffer.from(warmupTag).toString('base64').replace(/=+$/, '');
    if (textToCheck.includes(b64Tag)) return true;
    const b64Reversed = Buffer.from(reversedTag).toString('base64').replace(/=+$/, '');
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

/**
 * Detect system/automated emails that should not appear in the inbox
 * or affect priority/response time stats. Covers bounces, noreply addresses,
 * notification services, and DMARC reports.
 */
export function isSystemEmail(fromEmail?: string, subject?: string): boolean {
  const email = (fromEmail || '').toLowerCase();

  for (const p of SYSTEM_EMAIL_PATTERNS) {
    if (p.test(email)) return true;
  }
  for (const p of SYSTEM_DOMAIN_PATTERNS) {
    if (p.test(email)) return true;
  }
  for (const p of SYSTEM_SUBJECT_PATTERNS) {
    if (p.test(subject || '')) return true;
  }

  // Bounces are also system emails
  return detectBounce(fromEmail, undefined, subject);
}

// ============================================================================
// Enrollment Processing
// ============================================================================

export async function processReplyForEnrollment(
  supabase: SupabaseClient,
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

  if (!enrollment) return { paused, companyStopped };

  const { data: sequence } = await supabase
    .from('email_sequences')
    .select('settings')
    .eq('id', enrollment.sequence_id)
    .single();

  const settings = (sequence?.settings as Record<string, any>) || {};

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

    if (settings.stop_company_on_reply) {
      const domain = fromEmail.split('@')[1]?.toLowerCase();
      if (domain) {
        companyStopped = await stopCompanyEnrollments(
          supabase, sendLogEntry.sequence_id, domain, enrollment.id,
        );
      }
    }
  }

  return { paused, companyStopped };
}

export async function processReplyForConversationEnrollments(
  supabase: SupabaseClient,
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

async function stopCompanyEnrollments(
  supabase: SupabaseClient,
  sequenceId: string,
  domain: string,
  excludeEnrollmentId: string,
): Promise<number> {
  const { data: otherEnrollments } = await supabase
    .from('email_sequence_enrollments')
    .select(`id, leads:lead_id (email)`)
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
    }
  }

  return stoppedCount;
}
