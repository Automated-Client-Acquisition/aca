import type { EmailMailbox, MailboxStatus } from "@/types/email";

/**
 * Derived mailbox status used for display.
 *
 * A mailbox with `status === 'ready'` but `imap_connected === false` cannot
 * actually send: the sender worker, enroll-leads, email-rotation and
 * email-sequence-processor all gate on `status = 'ready' AND imap_connected = true`
 * (for m365, `imap_connected = true` means "in the Graph polling pool"). Such a
 * mailbox must NOT read as plain "Ready" — it surfaces as `connection_issue`.
 */
export type DerivedMailboxStatus = MailboxStatus | "connection_issue";

export interface MailboxStatusInfo {
  /** Display status, distinguishing the silent "ready but disconnected" case. */
  derived: DerivedMailboxStatus;
  /**
   * True when the mailbox should be excluded from / flagged in the selectable
   * pool because it won't send (disconnected, burned, paused, or ready-but-not-connected).
   */
  unhealthy: boolean;
  /** Human-readable reason when unhealthy, else undefined. */
  reason?: string;
}

/** The send-gating rule, in one place: a ready mailbox needs a live connection. */
export function isReadyButDisconnected(
  mailbox: Pick<EmailMailbox, "status" | "imap_connected">
): boolean {
  return mailbox.status === "ready" && !mailbox.imap_connected;
}

/**
 * Map a mailbox to its display status. Pass an object whose `imap_connected` is
 * known; when it's unknown, default it to `true` so the raw status passes through.
 */
export function getDerivedMailboxStatus(
  mailbox: Pick<EmailMailbox, "status" | "imap_connected">
): DerivedMailboxStatus {
  return isReadyButDisconnected(mailbox) ? "connection_issue" : mailbox.status;
}


/**
 * Why is this mailbox paused? Every writer of `status='paused'` records a
 * `metadata.paused_reason`, so a pause is never an unexplained grey pill.
 *
 * Bounce-derived reasons are LEGACY: per-mailbox bounce pausing was removed on
 * 2026-09-16 because bounce rate describes the list, not the inbox. Aggregate
 * bounces now pause the sequence. The old labels stay so historical rows read
 * honestly, and the backfill releases them.
 */
export function describePauseReason(pausedReason: string | null | undefined): string {
  switch (pausedReason) {
    case "manual":
      return "Paused by you";
    case "domain_paused":
      return "Domain sending paused";
    case "domain_not_sendable":
      return "Domain sending hold — review domain monitoring";
    case "circuit_breaker":
      return "Send errors — retrying after cooldown";
    case "spam_complaints":
      return "Spam complaints";
    case "tenant_mail_send_missing":
      return "Tenant can't send — needs Microsoft admin consent";
    case "tenant_outbound_blocked":
      return "Tenant blocked by Microsoft — replace the tenant";
    case "domain_moving":
      return "Moving to a new tenant";
    // ---- legacy, no longer written ----
    case "bounce_spike":
      return "Bounce spike (legacy — bounces no longer pause inboxes)";
    case "low_engagement":
      return "Low engagement (legacy — now throttles instead)";
    case null:
    case undefined:
      return "Paused (reason not recorded)";
    default:
      return "Paused";
  }
}

/**
 * Canonical "is this mailbox usable, and if not why" check. Centralizes the
 * logic that previously lived (and drifted) across the mailbox picker surfaces.
 */
export function getMailboxStatusInfo(mailbox: EmailMailbox): MailboxStatusInfo {
  const meta = (mailbox.metadata as Record<string, unknown> | null) ?? null;

  if (mailbox.status === "disconnected") {
    const reason = meta?.disconnected_reason;
    const label =
      reason === "auth_error"
        ? "Auth failed"
        : reason === "smtp_test_failed"
        ? "SMTP failed"
        : reason === "imap_test_failed"
        ? "IMAP failed"
        : "Disconnected";
    return { derived: "disconnected", unhealthy: true, reason: label };
  }

  if (mailbox.status === "burned") {
    return { derived: "burned", unhealthy: true, reason: "Burned" };
  }

  if (isReadyButDisconnected(mailbox)) {
    return { derived: "connection_issue", unhealthy: true, reason: "Reconnect needed" };
  }

  if (mailbox.status === "paused") {
    const reason = describePauseReason(
      typeof meta?.paused_reason === "string" ? meta.paused_reason : null
    );
    return { derived: "paused", unhealthy: true, reason };
  }

  // warming and ready+connected are healthy / selectable
  return { derived: mailbox.status, unhealthy: false };
}

/** Convenience: would this mailbox be skipped when sending? */
export function isMailboxUnhealthy(mailbox: EmailMailbox): boolean {
  return getMailboxStatusInfo(mailbox).unhealthy;
}

/**
 * A `warmup_enabled` mailbox stays `status='ready'` (fully sendable) the whole
 * time it's warming in the background mesh — status alone can't tell you it's
 * still building reputation. These mirror the platform's existing warmup-complete
 * bar (`_shared/email-warmup.ts` WARMUP_COMPLETE_DAY / shouldPromoteToReady), and
 * MUST be kept in sync with WARMUP_GRADUATION_DAY / WARMUP_GRADUATION_HEALTH_SCORE
 * in workers/sequence-sender/src/mailbox-pool.ts and its edge twin
 * supabase/functions/_shared/mailbox-pool.ts — those decide what the sender
 * actually pulls into an auto pool; this is only the display copy of that rule.
 */
export const WARMUP_GRADUATION_DAY = 23;
export const WARMUP_GRADUATION_HEALTH_SCORE = 0.7;
/** MIN_HEALTH_SCORE in the same two files: rotation's own floor. */
export const MIN_POOL_HEALTH_SCORE = 0.5;

/** Still actively building reputation — excluded from auto-selected sending pools. */
export function isStillWarming(
  mailbox: Pick<EmailMailbox, "warmup_enabled" | "warmup_day" | "health_score">
): boolean {
  if (!mailbox.warmup_enabled) return false;
  return (
    (mailbox.warmup_day ?? 0) < WARMUP_GRADUATION_DAY ||
    (mailbox.health_score ?? 0) < WARMUP_GRADUATION_HEALTH_SCORE
  );
}
