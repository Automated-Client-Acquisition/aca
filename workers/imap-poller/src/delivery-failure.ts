/**
 * Delivery-failure classification for inbound NDRs, so a reputation or tenant
 * block (5.7.x) is not treated as a dead recipient.
 *
 * Copied from supabase/functions/_shared/m365-trace.ts (classifyDeliveryFailure and
 * its helpers) and _shared/reply-processing.ts (classifyNdr): this Fly worker
 * cannot import Deno modules. Keep the three in sync when the patterns change.
 */

export type DeliveryErrorCategory =
  | "reputation_block"
  | "tenant_block"
  | "content_block"
  | "hard_bounce"
  | "soft_bounce"
  | "auth_error"
  | "rate_limited"
  | "unknown";

export interface FailureClassification {
  category: DeliveryErrorCategory;
  /** Verbatim remote SMTP response, trimmed and collapsed. Stored as-is. */
  diagnostic: string;
  /** Leading SMTP reply code, e.g. 550. Null when the detail carries none. */
  smtpCode: number | null;
  /** Enhanced status code, e.g. "5.7.1". Null when absent. */
  enhancedCode: string | null;
  /**
   * True when the remote server refused us because of *who is sending*
   * (domain / IP reputation, blocklist) rather than *who we sent to* or what
   * the message said. This is the only signal that should burn a domain.
   */
  isReputationBlock: boolean;
  /**
   * True when Microsoft itself refused to relay because the sending user or the
   * whole tenant is restricted (`5.1.8 bad outbound sender`, `5.7.750`). The
   * remote receiver never saw the message, so this says nothing about a single
   * domain's reputation and must NOT burn one; the fix is on the tenant.
   */
  isTenantBlock: boolean;
}

/**
 * EXO wraps the remote response in a Reason blob:
 *
 *   Reason: [{LED=550 5.7.1 ...};{MSG=};{FQDN=mx.example.com};{IP=1.2.3.4};{LRT=}]
 *
 * LED ("last error detail") is the remote server's verbatim reply and the only
 * field worth keeping. When the blob isn't present the Detail string already IS
 * the response, so fall through to it.
 */
export function extractRemoteResponse(
  detail: string | null | undefined,
): string {
  if (!detail) return "";
  // Two production realities this has to survive, both observed on 2026-08-03:
  //
  //  1. EXO truncates long Detail values and simply STOPS — the `{LED=` opens
  //     and there is no closing brace anywhere in the string. Requiring `}`
  //     made every Gmail reputation rejection fall back to the raw blob and get
  //     stored as `Reason: [{LED=550-5.7.1 ...` with the wrapper attached.
  //     So terminate on `}` OR end-of-string.
  //  2. A Detail can carry several Reason blobs (one per delivery hop) and the
  //     earlier hops routinely have an empty LED, so take the first NON-EMPTY
  //     one rather than the first one.
  const leds = [...detail.matchAll(/\{LED=([^}]*)(?:\}|$)/gi)]
    .map((m) => m[1])
    .filter((v) => v.trim().length > 0);
  const raw = leds.length ? leds[0] : detail;
  const collapsed = collapseSmtpContinuation(raw);
  // EXO's own placeholder for a Fail event that has no remote reply attached.
  // It says nothing about WHY, so it is "no diagnostic", not a diagnostic.
  return GENERIC_EXO_FAILURE.test(collapsed) ? "" : collapsed;
}


const GENERIC_EXO_FAILURE = /^the message was not delivered\.?$/i;


/**
 * Multi-line SMTP replies repeat the code on every line with a `-` continuation
 * marker (`550-5.7.1 foo` / `550-5.7.1 bar` / `550 5.7.1 baz`). Strip the
 * repeats so the stored message reads as one sentence and so keyword matching
 * isn't defeated by a phrase split across a line break.
 */
function collapseSmtpContinuation(raw: string): string {
  return raw
    .replace(/\r\n|\r|\n/g, " ")
    // Drop repeated "550-5.7.1 " / "550-" prefixes after the first one.
    .replace(/(?<=\S)\s+\d{3}-(?:\d\.\d{1,3}\.\d{1,3}\s+)?/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Recipient is permanently gone. Checked FIRST: a dead mailbox is a hard bounce
 * no matter how the remote server phrased it, and must never be mistaken for a
 * reputation problem — otherwise a list full of stale addresses would burn a
 * perfectly healthy domain.
 */
const RECIPIENT_UNKNOWN = [
  /\b5\.1\.(1|10)\b/,
  /user unknown/i,
  /unknown user/i,
  /no such user/i,
  /recipient (address )?(not found|rejected|unknown)/i,
  /mailbox (is )?(unavailable|not found|does not exist)/i,
  /address (does not exist|not found)/i,
  /resolver\.adr\.recipnotfound/i,
  /invalid recipient/i,
  /no such recipient/i,
  // Gmail 550-5.2.1: the account exists but is disabled/abandoned — permanent.
  /account (that )?(you tried to reach )?is (inactive|disabled)/i,
  /unrouteable address/i,
];

/**
 * Exchange Online refused to send at all: the user or tenant is restricted for
 * outbound spam. Checked BEFORE REPUTATION_BLOCK because its wording ("access
 * denied", "has been blocked") overlaps and would be misread as one domain's
 * reputation, burning a single domain for a tenant-wide problem.
 */
const TENANT_BLOCK = [
  /\b5\.1\.8\b/, // "Access denied, bad outbound sender"
  /bad outbound sender/i,
  /\b5\.7\.750\b/, // "Client blocked from sending from unregistered domains"
  /\b5\.7\.501\b/, // "Spam abuse detected from sender"
  /\b5\.7\.705\b/, // "Tenant has exceeded threshold, sending restricted"
  /tenant (has )?exceeded (the )?threshold/i,
  /user (has been )?(blocked|restricted) from sending/i,
  /outbound spam/i,
];

/**
 * The remote server refused us because of sender reputation, not the recipient
 * or the content. This is the signal that burns a domain, so the patterns are
 * deliberately anchored on reputation/blocklist wording rather than the generic
 * word "spam" (which also appears in ordinary content filtering).
 */
const REPUTATION_BLOCK = [
  /reputation/i, // Gmail: "very low reputation of the sending domain"
  /unsolicited/i, // Gmail: "likely unsolicited mail"
  /black ?list|block ?list|blocked list/i,
  /spamhaus|spamcop|barracuda|sorbs|uceprotect|senderscore/i,
  /banned sending ip/i, // Outlook S3150
  /\bs3(14|15)\d\b/i, // Outlook banned-IP suffix codes
  /\b5\.7\.6\d\d\b/, // Outlook "access denied, banned sender/IP" family
  /not accepted from your (ip|server)/i,
  /sending (ip|domain) .*(bad|poor|low)/i,
  /has been blocked/i, // Gmail tail: "the message has been blocked"
  /refused (due )?to (poor|bad) reputation/i,
];

/** Rejected on what the message said, not on who sent it. Does NOT burn a domain. */
const CONTENT_BLOCK = [
  /content(-| )?filter/i,
  /message content/i,
  /high probability of spam/i,
  /\b5\.7\.(1|501|509)\b.*content/i,
  /virus|malware/i,
  /suspicious link/i,
];

/** SPF / DKIM / DMARC alignment refusals — a config problem, not reputation. */
const AUTH_FAILURE = [
  /\bdmarc\b/i,
  /\bdkim\b/i,
  /\bspf\b/i,
  /\b5\.7\.(23|26)\b/,
  /unauthenticated (mail|email)/i,
  /does not pass authentication/i,
];

/** Transient — retry later, never a bounce. */
const TRANSIENT = [
  /throttl/i,
  /rate limit/i,
  /too many (connections|messages|recipients)/i,
  /try again later/i,
  /temporar/i,
  /resources temporarily unavailable/i,
  /\b4\.\d\.\d\b/,
];

/**
 * Classify a remote delivery failure from the trace detail.
 *
 * Order matters and is the whole point:
 *   1. dead recipient  → hard_bounce   (never blame the domain for a bad list)
 *   2. auth failure    → auth_error    (fix DNS, don't burn the domain)
 *   2b. tenant/user outbound restriction → tenant_block (replace/fix the tenant)
 *   3. reputation      → reputation_block
 *   4. content         → content_block
 *   5. transient / 4xx → soft_bounce / rate_limited
 *   6. unclassified    → unknown (keep the evidence, do not poison a lead)
 */
export function classifyDeliveryFailure(
  detail: string | null | undefined,
): FailureClassification {
  const diagnostic = extractRemoteResponse(detail);
  const smtpCode = parseSmtpCode(diagnostic);
  const enhancedCode = diagnostic.match(/\b(\d\.\d{1,3}\.\d{1,3})\b/)?.[1] ??
    null;

  const base = { diagnostic, smtpCode, enhancedCode };

  if (!diagnostic) {
    return {
      ...base,
      category: "unknown",
      isReputationBlock: false,
      isTenantBlock: false,
    };
  }

  if (matchesAny(diagnostic, RECIPIENT_UNKNOWN)) {
    return {
      ...base,
      category: "hard_bounce",
      isReputationBlock: false,
      isTenantBlock: false,
    };
  }

  if (matchesAny(diagnostic, AUTH_FAILURE)) {
    return {
      ...base,
      category: "auth_error",
      isReputationBlock: false,
      isTenantBlock: false,
    };
  }

  if (matchesAny(diagnostic, TENANT_BLOCK)) {
    return {
      ...base,
      category: "tenant_block",
      isReputationBlock: false,
      isTenantBlock: true,
    };
  }

  if (matchesAny(diagnostic, REPUTATION_BLOCK)) {
    // A 4xx reputation deferral is still a reputation signal, but it isn't a
    // bounce — the message may yet be delivered on retry. Only permanent
    // rejections count toward burning a domain.
    const permanent = smtpCode === null ? true : smtpCode >= 500;
    return {
      ...base,
      category: permanent ? "reputation_block" : "soft_bounce",
      isReputationBlock: permanent,
      isTenantBlock: false,
    };
  }

  if (matchesAny(diagnostic, CONTENT_BLOCK)) {
    return {
      ...base,
      category: "content_block",
      isReputationBlock: false,
      isTenantBlock: false,
    };
  }

  if (
    matchesAny(diagnostic, TRANSIENT) ||
    (smtpCode !== null && smtpCode >= 400 && smtpCode < 500)
  ) {
    const rateLimited = /throttl|rate limit|too many/i.test(diagnostic);
    return {
      ...base,
      category: rateLimited ? "rate_limited" : "soft_bounce",
      isReputationBlock: false,
      isTenantBlock: false,
    };
  }

  // A bare 5xx does not establish whether the recipient, our sender identity,
  // or a policy caused the refusal. Keep its exact response, but never call it
  // a recipient bounce without recipient-specific evidence above.
  return {
    ...base,
    category: "unknown",
    isReputationBlock: false,
    isTenantBlock: false,
  };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Leading SMTP reply code. Handles both `550 5.7.1 ...` and the continuation
 * form `550-5.7.1 ...` that Gmail uses for multi-line rejections.
 */
export function parseSmtpCode(text: string): number | null {
  const m = text.match(/(?:^|[^\d.])([45]\d{2})[-\s]/);
  if (m) return Number(m[1]);
  const bare = text.match(/(?:^|[^\d.])([45]\d{2})(?![\d.])/);
  return bare ? Number(bare[1]) : null;
}

// ============================================================================
// Status mapping
// ============================================================================


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
