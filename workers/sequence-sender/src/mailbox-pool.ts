/**
 * Dynamic mailbox pool resolution.
 *
 * A sequence used to carry `settings.mailbox_ids` — a list of mailbox UUIDs
 * frozen at the moment somebody opened the picker. That list decays: mailboxes
 * disconnect, get paused, or land on a domain that stops being sendable, and
 * the pool silently shrinks until every enrollment skips no_mailbox_available
 * while hundreds of healthy inboxes sit idle elsewhere in the org.
 *
 * Auto mode replaces the frozen list with a rule evaluated at send time:
 *
 *   "give me enough healthy inboxes, tagged <tags>, to cover <daily_target>
 *    sends a day"
 *
 * Pools are SHARED — an inbox may serve several active sequences at once, and
 * their sends all draw down the same per-mailbox daily_limit. That is
 * deliberate: exclusivity stranded most of the fleet. Separation between offers
 * is expressed with tags, not with exclusive ownership.
 *
 * `daily_target` is a SIZING HINT, not a cap. It decides how many inboxes to
 * hand to rotation; actual throughput stays governed by each inbox's own
 * daily_limit. Nothing here enforces a per-sequence ceiling.
 *
 * Keep in sync with supabase/functions/_shared/mailbox-pool.ts (the edge twin).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type MailboxSelectionMode = 'manual' | 'auto';
export type TagMatch = 'any' | 'all';

export interface MailboxSelectionConfig {
  mode?: MailboxSelectionMode;
  /** Emails/day this sequence wants to be able to place. Sizing hint only. */
  daily_target?: number | null;
  /** Restrict the pool to mailboxes carrying these tags. Empty = whole fleet. */
  tags?: string[] | null;
  tag_match?: TagMatch;
}

export interface ResolvedPool {
  /** Mailbox ids to hand to rotation. null = "whole org", matching legacy behaviour. */
  mailboxIds: string[] | null;
  /** Sum of daily_limit across the selected mailboxes. */
  capacity: number;
  /** How many mailboxes were eligible before the daily_target cut. */
  eligibleCount: number;
  mode: MailboxSelectionMode;
  /** Set when auto mode could not reach daily_target with the eligible fleet. */
  shortfall?: number;
}

/** PostgREST caps a GET at 1000 rows; orgs run more mailboxes than that. */
const PAGE_SIZE = 1000;
/** Re-resolve at most this often per sequence — the worker loops many enrollments per tick. */
const CACHE_TTL_MS = 60_000;
/** Mirrors the floor rotation itself applies, so the preview can't promise mailboxes rotation will drop. */
const MIN_HEALTH_SCORE = 0.5;
/**
 * A `warmup_enabled` mailbox stays `status='ready'` the whole time it's warming
 * (see 20260803120000_mailbox_warmup_engine.sql) — status alone can't tell rotation
 * "still building reputation." These mirror the platform's existing warmup-complete
 * bar (_shared/email-warmup.ts WARMUP_COMPLETE_DAY / shouldPromoteToReady) so a
 * mailbox "graduates" into the auto pool on the same criteria the rest of the app
 * already treats as done warming, rather than being excluded forever.
 */
const WARMUP_GRADUATION_DAY = 23;
const WARMUP_GRADUATION_HEALTH_SCORE = 0.7;

interface CacheEntry { at: number; pool: ResolvedPool }
const poolCache = new Map<string, CacheEntry>();

function cacheKey(sequenceId: string, cfg: MailboxSelectionConfig): string {
  return `${sequenceId}:${cfg.mode}:${cfg.daily_target ?? ''}:${(cfg.tags ?? []).slice().sort().join(',')}:${cfg.tag_match ?? 'any'}`;
}

/** Drop cached pools for one sequence (or all) — used after settings change. */
export function invalidateMailboxPool(sequenceId?: string): void {
  if (!sequenceId) { poolCache.clear(); return; }
  for (const key of poolCache.keys()) {
    if (key.startsWith(`${sequenceId}:`)) poolCache.delete(key);
  }
}

interface MailboxRow {
  id: string;
  daily_limit: number | null;
  daily_sent: number | null;
  health_score: number | null;
  last_send_at: string | null;
  sending_domain_id: string | null;
  warmup_enabled: boolean | null;
  warmup_day: number | null;
}

/** Still actively building reputation — not yet safe to hand real campaign traffic. */
function isStillWarming(m: MailboxRow): boolean {
  if (!m.warmup_enabled) return false;
  return (m.warmup_day ?? 0) < WARMUP_GRADUATION_DAY || (m.health_score ?? 0) < WARMUP_GRADUATION_HEALTH_SCORE;
}

/** Ids of sending domains that are not currently allowed to send. */
async function blockedDomainIds(supabase: SupabaseClient, organizationId: string): Promise<Set<string>> {
  const blocked = new Set<string>();
  const { data, error } = await supabase
    .from('blocked_sending_domains')
    .select('id')
    .eq('organization_id', organizationId);
  if (error) {
    // Fail OPEN: a view error must not empty every pool in the org. Rotation
    // applies the same filter again before it actually sends.
    console.warn(`[MailboxPool] blocked_sending_domains lookup failed, not filtering: ${error.message}`);
    return blocked;
  }
  for (const row of data ?? []) blocked.add((row as { id: string }).id);
  return blocked;
}

async function fetchEligibleMailboxes(
  supabase: SupabaseClient,
  organizationId: string,
  cfg: MailboxSelectionConfig,
): Promise<MailboxRow[]> {
  const rows: MailboxRow[] = [];

  for (let page = 0; ; page++) {
    let q = supabase
      .from('email_mailboxes')
      .select('id, daily_limit, daily_sent, health_score, last_send_at, sending_domain_id, warmup_enabled, warmup_day')
      .eq('organization_id', organizationId)
      .eq('status', 'ready')
      // Every actual send path filters on `imap_connected` too (email-rotation,
      // the sender's own pre-flight, email-sequence-processor) — for m365 it
      // means "in the Graph polling pool". Without it here the pool counted
      // mailboxes that cannot send toward `capacity`, picked them against a
      // `daily_target`, displacing sendable ones, and rotation then silently
      // skipped them — so the sequence quietly under-delivered its target.
      .eq('imap_connected', true)
      .gte('health_score', MIN_HEALTH_SCORE)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    const tags = (cfg.tags ?? []).filter(Boolean);
    if (tags.length > 0) {
      // `all` = mailbox must carry every tag; `any` = at least one overlaps.
      q = cfg.tag_match === 'all' ? q.contains('tags', tags) : q.overlaps('tags', tags);
    }

    const { data, error } = await q;
    if (error) throw new Error(`mailbox pool query failed: ${error.message}`);

    const batch = (data ?? []) as MailboxRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

/**
 * Resolve the mailbox pool for a sequence.
 *
 * Manual mode returns the configured ids untouched, so existing sequences keep
 * behaving exactly as before.
 */
export async function resolveMailboxPool(
  supabase: SupabaseClient,
  organizationId: string,
  sequenceId: string,
  settings: { mailbox_ids?: string[] | null; mailbox_selection?: MailboxSelectionConfig | null },
): Promise<ResolvedPool> {
  const cfg: MailboxSelectionConfig = settings.mailbox_selection ?? {};
  const mode: MailboxSelectionMode = cfg.mode ?? 'manual';

  if (mode !== 'auto') {
    const ids = settings.mailbox_ids?.length ? settings.mailbox_ids : null;
    return { mailboxIds: ids, capacity: 0, eligibleCount: ids?.length ?? 0, mode: 'manual' };
  }

  const key = cacheKey(sequenceId, cfg);
  const hit = poolCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pool;

  const [rows, blocked] = await Promise.all([
    fetchEligibleMailboxes(supabase, organizationId, cfg),
    blockedDomainIds(supabase, organizationId),
  ]);

  const eligible = rows.filter(
    (m) => (!m.sending_domain_id || !blocked.has(m.sending_domain_id)) && !isStillWarming(m),
  );

  // Healthiest first, then widest headroom — so a target smaller than the fleet
  // picks the best inboxes rather than an arbitrary slice.
  eligible.sort((a, b) => {
    const health = (b.health_score ?? 0) - (a.health_score ?? 0);
    if (health !== 0) return health;
    const headroom = ((b.daily_limit ?? 0) - (b.daily_sent ?? 0)) - ((a.daily_limit ?? 0) - (a.daily_sent ?? 0));
    if (headroom !== 0) return headroom;
    return (a.last_send_at ?? '').localeCompare(b.last_send_at ?? '');
  });

  const target = cfg.daily_target && cfg.daily_target > 0 ? cfg.daily_target : null;

  let selected = eligible;
  let capacity = eligible.reduce((sum, m) => sum + (m.daily_limit ?? 0), 0);

  if (target !== null) {
    const taken: MailboxRow[] = [];
    let running = 0;
    for (const m of eligible) {
      if (running >= target) break;
      taken.push(m);
      running += m.daily_limit ?? 0;
    }
    selected = taken;
    capacity = running;
  }

  const pool: ResolvedPool = {
    mailboxIds: selected.length > 0 ? selected.map((m) => m.id) : null,
    capacity,
    eligibleCount: eligible.length,
    mode: 'auto',
    ...(target !== null && capacity < target ? { shortfall: target - capacity } : {}),
  };

  // An auto pool that resolved to nothing must NOT fall through to "whole org" —
  // that would ignore the operator's tag rule and send from the wrong inboxes.
  if (selected.length === 0) pool.mailboxIds = [];

  poolCache.set(key, { at: Date.now(), pool });
  return pool;
}
