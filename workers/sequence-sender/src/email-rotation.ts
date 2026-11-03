/**
 * Email Rotation Module
 *
 * Weighted round-robin mailbox selection with health filtering
 * and circuit breaker logic.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

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
  sending_domain_id?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface RotationOptions {
  providerFilter?: string | null;
  excludeMailboxId?: string | null;
  mailboxIds?: string[] | null;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
// How many CONSECUTIVE auth failures before a mailbox is disconnected. A single
// 535 is often transient on M365 (throttling disguised as auth, or password
// propagation lag right after a reset) — disconnecting on the first one
// permanently benches a healthy mailbox until a human/heal intervenes. Require a
// sustained run instead, so transient blips self-recover on the next cycle.
const AUTH_ERROR_DISCONNECT_THRESHOLD = 3;

// PostgREST caps a GET response at 1000 rows by default and a long `?id=in.(…)`
// URL eventually trips proxy URL-length limits. A sequence's mailbox pool can be
// far larger than that (e.g. 900 mailboxes), so we must NOT collapse the pool to
// an arbitrary prefix — doing so silently strands every mailbox past the cutoff
// (the classic "first 200 get hammered, the rest sit idle, everything else skips
// no_mailbox_available" bug). Instead, fan the id list out over bounded `.in()`
// chunks and merge, so the WHOLE configured pool is always considered.
const MAILBOX_IN_CHUNK = 150;

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

  const blockedIds = new Set<string>();
  for (let i = 0; i < domainIds.length; i += MAILBOX_IN_CHUNK) {
    const chunk = domainIds.slice(i, i + MAILBOX_IN_CHUNK);
    const { data, error } = await supabase
      .from('blocked_sending_domains')
      .select('id')
      .in('id', chunk);

    if (error) {
      // Fail open: a lookup failure must not halt all sending. Rotation applies
      // no mailbox-level bounce filter (bounces belong to the list, see
      // sequence-bounce-guard), so a burned domain relies on its mailboxes
      // being paused domain_not_sendable.
      console.error('[Rotation] Sendable-domain lookup failed, proceeding unfiltered:', error.message);
      return mailboxes;
    }
    for (const row of data ?? []) blockedIds.add(row.id);
  }

  if (blockedIds.size === 0) return mailboxes;

  const kept = mailboxes.filter((m) => !m.sending_domain_id || !blockedIds.has(m.sending_domain_id));

  if (kept.length !== mailboxes.length) {
    console.warn(
      `[Rotation] Excluded ${mailboxes.length - kept.length} mailbox(es) on ${blockedIds.size} non-sendable domain(s)`
    );
  }

  return kept;
}

/**
 * Fetch eligible mailbox rows for a pool of arbitrary size by chunking the
 * `.in('id', …)` filter. `buildBaseQuery` must return a FRESH PostgREST builder
 * (select + base filters) on every call — a builder can't be reused after await.
 * When `mailboxIds` is null/empty the pool is org-wide (single query), preserving
 * the previous behavior.
 */
async function fetchMailboxRows(
  buildBaseQuery: () => any,
  mailboxIds: string[] | null | undefined
): Promise<any[] | null> {
  if (!mailboxIds || mailboxIds.length === 0) {
    const { data, error } = await buildBaseQuery();
    if (error) {
      console.error('[Rotation] Failed to fetch mailboxes:', error.message);
      return null;
    }
    return data || [];
  }

  const merged: any[] = [];
  for (let i = 0; i < mailboxIds.length; i += MAILBOX_IN_CHUNK) {
    const chunk = mailboxIds.slice(i, i + MAILBOX_IN_CHUNK);
    const { data, error } = await buildBaseQuery().in('id', chunk);
    if (error) {
      console.error('[Rotation] Failed to fetch mailbox chunk:', error.message);
      continue;
    }
    if (data) merged.push(...data);
  }
  return merged;
}

export async function selectMailbox(
  supabase: SupabaseClient,
  organizationId: string,
  opts: RotationOptions = {}
): Promise<MailboxCandidate | null> {
  const buildBaseQuery = () => {
    let query = supabase
      .from('email_mailboxes')
      .select('id, email_address, provider, connection_type, health_score, daily_sent, daily_limit, last_send_at, metadata, sending_domain_id, display_name, first_name, last_name')
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .eq('imap_connected', true)
      .gte('health_score', 0.5);

    if (opts.providerFilter) {
      query = query.eq('provider', opts.providerFilter);
    }

    if (opts.excludeMailboxId) {
      query = query.neq('id', opts.excludeMailboxId);
    }

    return query;
  };

  const mailboxes = await fetchMailboxRows(buildBaseQuery, opts.mailboxIds);

  if (mailboxes === null) {
    return null;
  }

  if (mailboxes.length === 0) {
    return null;
  }

  const sendable = await filterNonSendableDomains(supabase, mailboxes);

  const available = sendable.filter(
    (m: any) => m.daily_sent < m.daily_limit
  ) as MailboxCandidate[];

  if (available.length === 0) {
    return null;
  }

  return weightedSelect(available);
}

export async function getMailboxCandidates(
  supabase: SupabaseClient,
  organizationId: string,
  opts: RotationOptions & { hypersendMode?: boolean } = {}
): Promise<MailboxCandidate[]> {
  const buildBaseQuery = () => {
    let query = supabase
      .from('email_mailboxes')
      .select('id, email_address, provider, connection_type, health_score, daily_sent, daily_limit, last_send_at, metadata, bounce_rate, sending_domain_id, display_name, first_name, last_name')
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .eq('imap_connected', true)
      .gte('health_score', 0.5);

    if (opts.providerFilter) {
      query = query.eq('provider', opts.providerFilter);
    }

    if (opts.excludeMailboxId) {
      query = query.neq('id', opts.excludeMailboxId);
    }

    return query;
  };

  const mailboxes = await fetchMailboxRows(buildBaseQuery, opts.mailboxIds);

  if (!mailboxes || mailboxes.length === 0) {
    return [];
  }

  const sendable = await filterNonSendableDomains(supabase, mailboxes);

  const available = sendable.filter((m: any) => {
    if (opts.hypersendMode && m.health_score > 0.80 && (m.bounce_rate ?? 0) < 0.05) {
      return m.daily_sent < m.daily_limit * 3;
    }
    return m.daily_sent < m.daily_limit;
  }) as MailboxCandidate[];

  return available;
}

/**
 * Count mailboxes in the pool that are ready AND IMAP-connected, ignoring the
 * daily-limit / health / bounce filters. Used only on the no-mailbox failure
 * path to tell a genuinely empty or disconnected pool (actionable — the user
 * must connect or assign a mailbox) apart from one that's merely throttled for
 * now (transient — every mailbox is over its daily limit or health-filtered).
 */
export async function countReadyMailboxes(
  supabase: SupabaseClient,
  organizationId: string,
  mailboxIds: string[] | null
): Promise<number> {
  // No pool restriction → a single exact count over the org is enough.
  if (!mailboxIds || mailboxIds.length === 0) {
    const { count, error } = await supabase
      .from('email_mailboxes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .eq('imap_connected', true);

    if (error) {
      console.error('[Rotation] Failed to count ready mailboxes:', error.message);
      return 0;
    }
    return count ?? 0;
  }

  // Pool-restricted: chunk the id filter so the full pool is counted, not just a
  // 200-id prefix. This only decides assigned_mailbox_missing (pool empty) vs
  // no_mailbox_available (pool merely throttled), so a fetched-and-counted set is
  // fine and stays within PostgREST limits.
  let total = 0;
  for (let i = 0; i < mailboxIds.length; i += MAILBOX_IN_CHUNK) {
    const chunk = mailboxIds.slice(i, i + MAILBOX_IN_CHUNK);
    const { count, error } = await supabase
      .from('email_mailboxes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      .eq('imap_connected', true)
      .in('id', chunk);

    if (error) {
      console.error('[Rotation] Failed to count ready mailbox chunk:', error.message);
      continue;
    }
    total += count ?? 0;
  }

  return total;
}

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

export type ErrorCategory = import('./smtp-client.js').SMTPErrorCategory;

/** Atomically add one to a mailbox's daily_sent (service-role RPC). */
async function bumpDailySent(supabase: SupabaseClient, mailboxId: string): Promise<void> {
  const { error } = await supabase.rpc('increment_mailbox_daily_sent', { p_mailbox_id: mailboxId });
  if (error) console.error('[Rotation] Failed to increment daily_sent:', error.message);
}

export async function recordSendResult(
  supabase: SupabaseClient,
  mailboxId: string,
  success: boolean,
  errorMessage?: string,
  errorCategory?: ErrorCategory,
  opts?: { graphPrimary?: boolean }
): Promise<{ disconnected?: boolean }> {
  const { data: mailbox, error: fetchError } = await supabase
    .from('email_mailboxes')
    .select('metadata, email_address')
    .eq('id', mailboxId)
    .single();

  if (fetchError || !mailbox) {
    console.error('[Rotation] Failed to fetch mailbox for result recording:', fetchError?.message);
    return {};
  }

  const metadata = mailbox.metadata || {};
  const consecutiveErrors = metadata.consecutive_errors || 0;

  // daily_sent is bumped atomically by bumpDailySent() wherever this update is
  // written, so concurrent sends on one mailbox no longer lose counts.
  const update: Record<string, any> = {
    last_send_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const consecutiveAuthErrors = metadata.consecutive_auth_errors || 0;

  if (success) {
    // Clear the error on a good send. `last_error` was previously write-only, so
    // a single 535 in August still rendered as "Last SMTP Error" months and
    // thousands of successful sends later — 220 mailboxes were showing one, 208
    // of which had sent fine in the last 7 days. The field must mean "the last
    // thing that actually went wrong", not "the last thing that ever did".
    update.last_error = null;
    update.metadata = {
      ...metadata,
      consecutive_errors: 0,
      consecutive_auth_errors: 0,
      smtp_fallback_error: null,
    };
  } else if (errorCategory === 'reputation_block' || errorCategory === 'content_block' || errorCategory === 'hard_bounce' || errorCategory === 'soft_bounce' || errorCategory === 'unknown') {
    // Receiver/list evidence does not establish a broken sender transport.
    // Keep the diagnostic without counting it toward auth/transport holds or
    // consuming a successful-send quota for an SMTP refusal.
    await supabase.from('email_mailboxes').update({
      last_error: errorMessage || 'Receiver rejected the message',
      updated_at: new Date().toISOString(),
    }).eq('id', mailboxId);
    return {};
  } else if (opts?.graphPrimary && errorCategory === 'auth_error') {
    // Graph-PRIMARY mailbox that hit an SMTP auth failure (535). These M365
    // mailboxes send via Graph (app-only); their per-mailbox SMTP password is
    // expected to be drifted — that is the whole reason Graph exists. SMTP is
    // only ever a fallback bridge (transient Graph blip: token-cache flush after
    // a restart, consent-propagation lag, 403-as-throttle, 504) OR a transient
    // direct attempt when the per-process tenant lookup momentarily failed right
    // after a restart. Either way a 535 is NOT evidence the mailbox is bad, so
    // it must not count toward the auth-error disconnect or the circuit-breaker
    // pause — that would bench a healthy Graph sender for a stale password.
    // Record the error for visibility and let it ride Graph again next cycle. Do
    // NOT touch the consecutive counters (a real Graph success resets them) or
    // daily_sent (nothing went out). Non-auth failures (real bounces, throttling)
    // still fall through to the normal handling below.
    // Record it as FALLBACK health, not as the mailbox's last error. By this
    // branch's own reasoning a 535 here is a non-event — the mailbox sends over
    // Graph and its SMTP password is expected to be drifted — so surfacing it as
    // "Last SMTP Error" on a healthy, sending mailbox is just alarming noise.
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_set: {
        smtp_fallback_error: errorMessage || 'SMTP auth failed on Graph-primary mailbox (transient)',
        smtp_fallback_error_at: new Date().toISOString(),
      },
      p_unset: [],
    });
    await supabase
      .from('email_mailboxes')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', mailboxId);
    return {};
  } else {
    const newErrors = consecutiveErrors + 1;
    update.metadata = { ...metadata, consecutive_errors: newErrors };
    update.last_error = errorMessage || 'Send failed (unknown error)';

    // Auth errors: disconnect only after a SUSTAINED run of consecutive auth
    // failures, not on the first 535. M365 535s are frequently transient
    // (throttling, or password-propagation lag right after a reset), and an
    // immediate disconnect turns a momentary blip into a permanent outage that
    // needs manual intervention. Count them; bench the mailbox only once it's
    // clearly persistent.
    if (errorCategory === 'auth_error') {
      const newAuthErrors = consecutiveAuthErrors + 1;
      update.metadata = { ...update.metadata, consecutive_auth_errors: newAuthErrors };

      if (newAuthErrors >= AUTH_ERROR_DISCONNECT_THRESHOLD) {
        console.warn(`[Rotation] Persistent auth failure for ${mailbox.email_address || mailboxId} (${newAuthErrors} consecutive) — marking disconnected`);
        update.status = 'disconnected';
        update.metadata = {
          ...update.metadata,
          disconnected_reason: 'auth_error',
          disconnected_at: new Date().toISOString(),
          disconnected_error: errorMessage || 'SMTP authentication failed',
        };

        await bumpDailySent(supabase, mailboxId);
        await supabase.from('email_mailboxes').update(update).eq('id', mailboxId);
        return { disconnected: true };
      }

      // Below threshold: record the failure and retry on the next cycle.
      console.warn(`[Rotation] Auth failure ${newAuthErrors}/${AUTH_ERROR_DISCONNECT_THRESHOLD} for ${mailbox.email_address || mailboxId} — will retry`);
      await bumpDailySent(supabase, mailboxId);
      await supabase.from('email_mailboxes').update(update).eq('id', mailboxId);
      return {};
    }

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

    // Circuit breaker: TRANSPORT failure count (SMTP/Graph rejected the send
    // outright), not a bounce count — the mailbox itself is broken, so the
    // mailbox is the right object to pause.
    if (newErrors >= CIRCUIT_BREAKER_THRESHOLD) {
      console.warn(`[Rotation] Circuit breaker triggered for mailbox ${mailboxId} (${newErrors} consecutive errors)`);
      update.status = 'paused';
      update.metadata = {
        ...update.metadata,
        paused_reason: 'circuit_breaker',
        paused_at: new Date().toISOString(),
      };
    }

    // NOTE: deliberately NO bounce-based mailbox pause. Bounce rate belongs to
    // the LIST, not the mailbox: rotation spreads a bad list across the pool, so
    // a per-mailbox bounce guard pauses healthy inboxes one at a time while the
    // list that caused it keeps feeding. Aggregate bounce rate is evaluated per
    // sequence by `sequence-bounce-guard`, which pauses the sequence.
    // Keep this in sync with supabase/functions/_shared/email-rotation.ts.
  }

  await bumpDailySent(supabase, mailboxId);
  const { error: updateError } = await supabase
    .from('email_mailboxes')
    .update(update)
    .eq('id', mailboxId);

  if (updateError) {
    console.error('[Rotation] Failed to record send result:', updateError.message);
  }

  return {};
}

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
