/**
 * Shared mailbox fleet: capacity vs demand.
 *
 * Auto-mode sequences all draw from one pool of org mailboxes, and a sequence's
 * daily limit is a ceiling, not a reservation. When the limits of the active
 * sequences add up to more than the fleet can place, the fleet fills early and
 * every remaining lead is skipped as no_mailbox_available. Each sequence then
 * looks stuck on its own. These helpers turn the get_email_fleet_demand RPC
 * into the two numbers that explain it: what the fleet can send, and what the
 * sequences on it ask for.
 */

export interface FleetBucket {
  mailboxes: number;
  /** Sum of daily_limit across eligible mailboxes. */
  capacity: number;
  /** Sends since 00:00 UTC (mailbox counters reset at UTC midnight). */
  sent_today: number;
}

export interface FleetSequenceDemand {
  id: string;
  name: string;
  /** The worker's per-sequence cap. null = no cap. */
  daily_limit: number | null;
  tags: string[];
  tag_match: string;
  sent_today: number;
  /** Active enrollments due within 24h, counted up to the cap. */
  due: number;
  /** min(cap, sent_today + due): what it will try to send today. */
  demand: number;
  pool_capacity: number;
  /** Capacity it shares with the pool being looked at. 0 = no overlap. */
  shared_capacity: number;
}

export interface FleetDemand {
  day_start: string;
  /** Sending domains the sender won't use right now (blocked_sending_domains). */
  blocked_domain_ids: string[];
  fleet: FleetBucket;
  /** The pool for the tags passed in. Equals `fleet` when no tags. */
  pool: FleetBucket;
  /** Active auto-mode sequences, excluding the one passed as p_sequence_id. */
  sequences: FleetSequenceDemand[];
  self: { status: string; sent_today: number; due: number } | null;
}

/**
 * The daily limit the sender enforces for a sequence: a missing key falls back
 * to the worker's DEFAULT_SETTINGS (30); null or 0 means no limit.
 */
export function effectiveDailyLimit(settings: {
  daily_limit?: number | null;
}): number | null {
  if (settings.daily_limit === undefined) return 30;
  return settings.daily_limit && settings.daily_limit > 0
    ? settings.daily_limit
    : null;
}

/**
 * Splitting a fleet evenly across N sequences rounds each limit up, so the
 * total can land a few emails over capacity. Under this share of capacity the
 * numbers are shown without a warning.
 */
export const OVERSUBSCRIBED_TOLERANCE = 0.01;

/** The RPC stops counting the current sequence's due leads here. */
export const SELF_DUE_COUNT_CAP = 25_000;

export interface FleetDemandLine {
  /** null for the sequence being viewed. */
  id: string | null;
  name: string;
  /** Emails/day this sequence takes from the pool. */
  asks: number;
  /** Configured daily limit. null = no limit. */
  limit: number | null;
  /** Set when fewer leads are due than the limit allows. */
  due: number | null;
}

export interface FleetDemandSummary {
  capacity: number;
  asked: number;
  sentToday: number;
  /** asked - capacity, floored at 0. */
  overBy: number;
  /** overBy is more than rounding noise: worth a warning. */
  oversubscribed: boolean;
  /** Everything that adds up to `asked`, largest first. */
  lines: FleetDemandLine[];
}

/**
 * Org-wide view: the whole fleet against every active auto sequence.
 */
export function summarizeFleet(data: FleetDemand): FleetDemandSummary {
  const lines = data.sequences
    .map((s) => toLine(s, s.pool_capacity))
    .filter((l) => l.asks > 0);
  return finish(data.fleet.capacity, data.fleet.sent_today, lines);
}

/**
 * One sequence's view: its own pool, its own ask, and the active sequences
 * that draw from at least one of the same mailboxes.
 *
 * `ownLimit` is the live (possibly unsaved) daily limit. null = no limit,
 * which in practice asks for the whole pool.
 */
export function summarizePool(
  data: FleetDemand,
  ownLimit: number | null,
): FleetDemandSummary {
  const capacity = data.pool.capacity;
  const cap = ownLimit && ownLimit > 0 ? ownLimit : capacity;

  // An active sequence asks for what it has due. A draft or paused one is
  // shown at its full limit: that is what it would ask for once it runs.
  let ownAsk = cap;
  let ownDue: number | null = null;
  const self = data.self;
  if (self?.status === "active" && self.due < SELF_DUE_COUNT_CAP) {
    ownAsk = Math.min(cap, self.sent_today + self.due);
    if (ownAsk < cap) ownDue = self.due;
  }

  const lines = data.sequences
    .filter((s) => s.shared_capacity > 0)
    .map((s) => toLine(s, s.shared_capacity))
    .filter((l) => l.asks > 0);

  if (ownAsk > 0) {
    lines.push({
      id: null,
      name: "This sequence",
      asks: ownAsk,
      limit: ownLimit && ownLimit > 0 ? ownLimit : null,
      due: ownDue,
    });
  }

  return finish(capacity, data.pool.sent_today, lines);
}

function toLine(s: FleetSequenceDemand, reachable: number): FleetDemandLine {
  const cap = s.daily_limit ?? s.pool_capacity;
  return {
    id: s.id,
    name: s.name,
    // A sequence can't take more from this pool than the part of it it reaches.
    asks: Math.min(s.demand, reachable),
    limit: s.daily_limit,
    due: s.demand < cap ? s.due : null,
  };
}

function finish(
  capacity: number,
  sentToday: number,
  lines: FleetDemandLine[],
): FleetDemandSummary {
  lines.sort((a, b) => b.asks - a.asks || a.name.localeCompare(b.name));
  const asked = lines.reduce((sum, l) => sum + l.asks, 0);
  const overBy = Math.max(0, asked - capacity);
  return {
    capacity,
    asked,
    sentToday,
    overBy,
    oversubscribed: overBy > capacity * OVERSUBSCRIBED_TOLERANCE,
    lines,
  };
}
