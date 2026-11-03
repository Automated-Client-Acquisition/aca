/**
 * Dynamic mailbox pool resolution (edge twin).
 *
 * EXACT MIRROR of workers/sequence-sender/src/mailbox-pool.ts. The Fly worker is
 * the live sender; this edge processor is the fallback path. They have diverged
 * before (spintax shipped literal braces for months because only one twin was
 * patched), so any change here must be made in both files.
 *
 * A sequence used to carry `settings.mailbox_ids` — a list frozen when somebody
 * opened the picker. That list decays as mailboxes disconnect or get paused,
 * until every enrollment skips no_mailbox_available while healthy inboxes sit
 * idle. Auto mode re-derives the pool from tags + health at send time.
 *
 * Pools are SHARED (an inbox may serve several sequences, all drawing down the
 * same daily_limit) and `daily_target` is a SIZING HINT, not a cap.
 */

// deno-lint-ignore-file no-explicit-any

export type MailboxSelectionMode = 'manual' | 'auto';
export type TagMatch = 'any' | 'all';

export interface MailboxSelectionConfig {
  mode?: MailboxSelectionMode;
  daily_target?: number | null;
  tags?: string[] | null;
  tag_match?: TagMatch;
}

export interface ResolvedPool {
  mailboxIds: string[] | null;
  capacity: number;
  eligibleCount: number;
  mode: MailboxSelectionMode;
  shortfall?: number;
}

const PAGE_SIZE = 1000;
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

async function blockedDomainIds(supabase: any, organizationId: string): Promise<Set<string>> {
  const blocked = new Set<string>();
  const { data, error } = await supabase
    .from('blocked_sending_domains')
    .select('id')
    .eq('organization_id', organizationId);
  if (error) {
    // Fail OPEN — a view error must not empty every pool in the org. Rotation
    // applies the same filter again before it actually sends.
    console.warn(`[MailboxPool] blocked_sending_domains lookup failed, not filtering: ${error.message}`);
    return blocked;
  }
  for (const row of data ?? []) blocked.add(row.id as string);
  return blocked;
}

async function fetchEligibleMailboxes(
  supabase: any,
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

export async function resolveMailboxPool(
  supabase: any,
  organizationId: string,
  _sequenceId: string,
  settings: { mailbox_ids?: string[] | null; mailbox_selection?: MailboxSelectionConfig | null },
): Promise<ResolvedPool> {
  const cfg: MailboxSelectionConfig = settings.mailbox_selection ?? {};
  const mode: MailboxSelectionMode = cfg.mode ?? 'manual';

  if (mode !== 'auto') {
    const ids = settings.mailbox_ids?.length ? settings.mailbox_ids : null;
    return { mailboxIds: ids, capacity: 0, eligibleCount: ids?.length ?? 0, mode: 'manual' };
  }

  const [rows, blocked] = await Promise.all([
    fetchEligibleMailboxes(supabase, organizationId, cfg),
    blockedDomainIds(supabase, organizationId),
  ]);

  const eligible = rows.filter(
    (m) => (!m.sending_domain_id || !blocked.has(m.sending_domain_id)) && !isStillWarming(m),
  );

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
    // An auto pool that resolved to nothing must NOT fall through to "whole org"
    // — that would ignore the operator's tag rule and send from wrong inboxes.
    mailboxIds: selected.length > 0 ? selected.map((m) => m.id) : [],
    capacity,
    eligibleCount: eligible.length,
    mode: 'auto',
    ...(target !== null && capacity < target ? { shortfall: target - capacity } : {}),
  };

  return pool;
}
