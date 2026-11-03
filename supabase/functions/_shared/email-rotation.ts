/**
 * Email Rotation Module
 *
 * Weighted round-robin mailbox selection with health filtering
 * and circuit breaker logic.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import type { SMTPErrorCategory } from "./smtp-client.ts";

export interface MailboxCandidate {
  id: string;
  email_address: string;
  provider: string | null;
  connection_type: string | null;
  health_score: number;
  daily_sent: number;
  daily_limit: number;
  last_send_at: string | null;
  metadata: Record<string, any>;
  bounce_rate?: number;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  sending_domain_id?: string | null;
}

export interface RotationOptions {
  providerFilter?: string | null;
  excludeMailboxId?: string | null;
  mailboxIds?: string[] | null;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;

/**
 * Warmup graduation bar — MUST stay in sync with WARMUP_GRADUATION_DAY /
 * WARMUP_GRADUATION_HEALTH_SCORE in mailbox-pool.ts (both twins) and
 * WARMUP_COMPLETE_DAY / MIN_HEALTH_FOR_PROMOTION in _shared/email-warmup.ts.
 * A `warmup_enabled` mailbox keeps `status='ready'` while it warms, so every
 * send path must check this explicitly — status alone can't tell "still
 * building reputation".
 */
export const WARMUP_GRADUATION_DAY = 23;
export const WARMUP_GRADUATION_HEALTH_SCORE = 0.7;

/** Still building reputation — must not carry real campaign traffic. */
export function isMailboxStillWarming(m: {
  warmup_enabled?: boolean | null;
  warmup_day?: number | null;
  health_score?: number | null;
}): boolean {
  if (!m.warmup_enabled) return false;
  return (
    (m.warmup_day ?? 0) < WARMUP_GRADUATION_DAY ||
    (m.health_score ?? 0) < WARMUP_GRADUATION_HEALTH_SCORE
  );
}

/**
 * Respect the domain's explicit sending controls. The database view owns the
 * predicate shared with mailbox guards and operator pause/resume controls.
 * Reputation observations are reported separately and never implicitly stop
 * every receiver provider. Keep the worker and edge twin in sync.
 */
async function filterNonSendableDomains<T extends { sending_domain_id?: string | null }>(
  supabase: SupabaseClient,
  mailboxes: T[]
): Promise<T[]> {
  const domainIds = [...new Set(
    mailboxes.map((m) => m.sending_domain_id).filter((id): id is string => !!id)
  )];

  if (domainIds.length === 0) return mailboxes;

  const { data: blocked, error } = await supabase
    .from('blocked_sending_domains')
    .select('id')
    .in('id', domainIds);

  if (error) {
    // Fail open: a lookup failure must not stop all sending. Rotation applies
    // no mailbox-level bounce filter (bounces belong to the list, see
    // sequence-bounce-guard), so a burned domain relies on its mailboxes
    // being paused domain_not_sendable.
    console.error('[Rotation] Sendable-domain lookup failed, proceeding unfiltered:', error.message);
    return mailboxes;
  }

  if (!blocked?.length) return mailboxes;

  const blockedIds = new Set(blocked.map((d) => d.id));
  const kept = mailboxes.filter((m) => !m.sending_domain_id || !blockedIds.has(m.sending_domain_id));

  if (kept.length !== mailboxes.length) {
    console.warn(
      `[Rotation] Excluded ${mailboxes.length - kept.length} mailbox(es) on ${blockedIds.size} non-sendable domain(s)`
    );
  }

  return kept;
}

/**
 * Select the best mailbox for sending using weighted round-robin.
 *
 * 1. Fetch ready mailboxes with remaining daily quota
 * 2. Filter out unhealthy (bounce > 5%, health < 0.5)
 * 3. Apply optional provider filter and exclusions
 * 4. Weighted random selection by health_score
 */
export async function selectMailbox(
  supabase: SupabaseClient,
  organizationId: string,
  opts: RotationOptions = {}
): Promise<MailboxCandidate | null> {
  let query = supabase
    .from('email_mailboxes')
    .select('id, email_address, provider, connection_type, health_score, daily_sent, daily_limit, last_send_at, metadata, display_name, first_name, last_name, sending_domain_id')
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .eq('imap_connected', true)
    .gte('health_score', 0.5);

  if (opts.mailboxIds && opts.mailboxIds.length > 0) {
    query = query.in('id', opts.mailboxIds);
  }

  if (opts.providerFilter) {
    query = query.eq('provider', opts.providerFilter);
  }

  if (opts.excludeMailboxId) {
    query = query.neq('id', opts.excludeMailboxId);
  }

  const { data: mailboxes, error } = await query;

  if (error) {
    console.error('[Rotation] Failed to fetch mailboxes:', error.message);
    return null;
  }

  if (!mailboxes || mailboxes.length === 0) {
    return null;
  }

  const sendable = await filterNonSendableDomains(supabase, mailboxes);

  // Filter to those with remaining daily quota
  const available = sendable.filter(
    (m: any) => m.daily_sent < m.daily_limit
  ) as MailboxCandidate[];

  if (available.length === 0) {
    return null;
  }

  // Weighted random selection by health_score
  return weightedSelect(available);
}

/**
 * Get filtered mailbox candidates without selecting one.
 * Used when the caller needs to apply additional reordering (e.g., SISR)
 * before final selection.
 */
export async function getMailboxCandidates(
  supabase: SupabaseClient,
  organizationId: string,
  opts: RotationOptions & { hypersendMode?: boolean } = {}
): Promise<MailboxCandidate[]> {
  let query = supabase
    .from('email_mailboxes')
    .select('id, email_address, provider, connection_type, health_score, daily_sent, daily_limit, last_send_at, metadata, bounce_rate, display_name, first_name, last_name, sending_domain_id')
    .eq('organization_id', organizationId)
    .eq('status', 'ready')
    .eq('imap_connected', true)
    .gte('health_score', 0.5);

  if (opts.mailboxIds && opts.mailboxIds.length > 0) {
    query = query.in('id', opts.mailboxIds);
  }

  if (opts.providerFilter) {
    query = query.eq('provider', opts.providerFilter);
  }

  if (opts.excludeMailboxId) {
    query = query.neq('id', opts.excludeMailboxId);
  }

  const { data: mailboxes, error } = await query;

  if (error) {
    console.error('[Rotation] Failed to fetch mailbox candidates:', error.message);
    return [];
  }

  if (!mailboxes || mailboxes.length === 0) {
    return [];
  }

  const sendable = await filterNonSendableDomains(supabase, mailboxes);

  // Filter to those with remaining daily quota
  // Hypersend mode: 3x daily_limit for high-health mailboxes
  const available = sendable.filter((m: any) => {
    if (opts.hypersendMode && m.health_score > 0.80 && (m.bounce_rate ?? 0) < 0.05) {
      return m.daily_sent < m.daily_limit * 3;
    }
    return m.daily_sent < m.daily_limit;
  }) as MailboxCandidate[];

  return available;
}

/**
 * Weighted random selection: higher health_score = more likely to be picked.
 */
export function weightedSelect(candidates: MailboxCandidate[]): MailboxCandidate {
  const totalWeight = candidates.reduce((sum, m) => sum + m.health_score, 0);

  if (totalWeight === 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  let random = Math.random() * totalWeight;
  for (const candidate of candidates) {
    random -= candidate.health_score;
    if (random <= 0) return candidate;
  }

  return candidates[0];
}

/**
 * Record the result of a send attempt on a mailbox.
 * Increments daily_sent, tracks consecutive errors for circuit breaker.
 */
export async function recordSendResult(
  supabase: SupabaseClient,
  mailboxId: string,
  success: boolean,
  errorMessage?: string,
  errorCategory?: SMTPErrorCategory
): Promise<void> {
  // Fetch current state
  const { data: mailbox, error: fetchError } = await supabase
    .from('email_mailboxes')
    .select('metadata')
    .eq('id', mailboxId)
    .single();

  if (fetchError || !mailbox) {
    console.error('[Rotation] Failed to fetch mailbox for result recording:', fetchError?.message);
    return;
  }

  const metadata = mailbox.metadata || {};
  const consecutiveErrors = metadata.consecutive_errors || 0;

  // daily_sent is bumped atomically just before this update is written, so
  // concurrent sends on one mailbox no longer lose counts.
  const update: Record<string, any> = {
    last_send_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Track ONLY the metadata keys we want to set, not the full blob.
  // We apply them via the merge_mailbox_metadata RPC after the column update so
  // that concurrent writers (heal jobs, IMAP poller, infra-mailbox-provision)
  // can't have their own metadata updates clobbered by our stale snapshot —
  // and so that our updates can't clobber theirs (notably smtp_credentials).
  const metadataMerge: Record<string, unknown> = {};

  if (success) {
    // See the worker fork: `last_error` must not be write-only, or a long-healed
    // failure keeps rendering as the mailbox's current state.
    update.last_error = null;
    metadataMerge.consecutive_errors = 0;
    metadataMerge.smtp_fallback_error = null;
  } else if (!errorCategory || !['auth_error', 'network_error', 'rate_limited', 'tenant_block'].includes(errorCategory)) {
    // Receiver/list diagnostics are observations, not broken sender transport.
    // Webhook bounces without a transport category likewise cannot bench it.
    await supabase.from('email_mailboxes').update({
      last_error: errorMessage || 'Receiver rejected the message',
      updated_at: new Date().toISOString(),
    }).eq('id', mailboxId);
    return;
  } else {
    const newErrors = consecutiveErrors + 1;
    metadataMerge.consecutive_errors = newErrors;
    update.last_error = errorMessage || 'Send failed (unknown error)';

    // Recalculate bounce rate from actual send_log data
    const { count: totalSent } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailboxId)
      .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced']);

    const { count: totalBounced } = await supabase
      .from('email_send_log')
      .select('id', { count: 'exact', head: true })
      .eq('mailbox_id', mailboxId)
      .eq('status', 'bounced');

    if (totalSent && totalSent > 0) {
      update.bounce_rate = (totalBounced || 0) / totalSent;
    }

    // Circuit breaker: auto-pause after threshold.
    // This is a TRANSPORT failure count (SMTP/Graph rejected the send outright),
    // not a bounce count — it means this mailbox is broken, so pausing the
    // mailbox is the right object to act on.
    if (newErrors >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[Rotation] Circuit breaker triggered for mailbox ${mailboxId} (${newErrors} consecutive errors)`);
      update.status = 'paused';
      metadataMerge.paused_reason = 'circuit_breaker';
      metadataMerge.paused_at = new Date().toISOString();
    }

    // NOTE: there is deliberately NO bounce-based mailbox pause here.
    // Bounce rate is a property of the LIST being sent, not of the mailbox.
    // Rotation sprays a bad list across the whole pool, so a per-mailbox bounce
    // guard pauses healthy inboxes one by one while the list that caused it
    // keeps feeding. Aggregate bounce rate is evaluated per sequence by the
    // `sequence-bounce-guard` function, which pauses the sequence instead.
    // `bounce_rate` above is still maintained as a display/diagnostic metric.
  }

  const { error: bumpError } = await supabase.rpc('increment_mailbox_daily_sent', { p_mailbox_id: mailboxId });
  if (bumpError) console.error('[Rotation] Failed to increment daily_sent:', bumpError.message);

  const { error: updateError } = await supabase
    .from('email_mailboxes')
    .update(update)
    .eq('id', mailboxId);

  if (updateError) {
    console.error('[Rotation] Failed to record send result:', updateError.message);
  }

  if (Object.keys(metadataMerge).length > 0) {
    const { error: mergeError } = await supabase.rpc('merge_mailbox_metadata', {
      p_id: mailboxId,
      p_merge: metadataMerge,
    });
    if (mergeError) {
      console.error('[Rotation] Failed to merge mailbox metadata:', mergeError.message);
    }
  }
}

/**
 * Check if a mailbox has hit the circuit breaker threshold.
 */
export async function checkCircuitBreaker(
  supabase: SupabaseClient,
  mailboxId: string
): Promise<boolean> {
  const { data: mailbox, error } = await supabase
    .from('email_mailboxes')
    .select('metadata')
    .eq('id', mailboxId)
    .single();

  if (error || !mailbox) return false;

  const consecutiveErrors = (mailbox.metadata as any)?.consecutive_errors || 0;
  return consecutiveErrors >= CIRCUIT_BREAKER_THRESHOLD;
}

/**
 * Reset daily sent counters for all mailboxes where the reset date is before today.
 */
export async function resetDailyCounters(supabase: SupabaseClient): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('email_mailboxes')
    .update({
      daily_sent: 0,
      daily_sent_reset_at: today,
      updated_at: new Date().toISOString(),
    })
    .lt('daily_sent_reset_at', today)
    .select('id');

  if (error) {
    console.error('[Rotation] Failed to reset daily counters:', error.message);
    return 0;
  }

  return data?.length || 0;
}
