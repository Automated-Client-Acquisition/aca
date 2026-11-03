/**
 * MoltSets pacing derived from the provider's own fair-use accounting.
 *
 * The scheduler needs one number: records per minute we may sustainably spend.
 * It used to come from a hardcoded per-plan constant, which only modelled the
 * 5h window and left the rolling 1w budget unenforced (holding the
 * 5h-sustainable rate is ~6.7x the 1w-sustainable rate). get_usage reports
 * remaining + reset for every window, so we ask instead of guessing, and take
 * the min across windows — hold that at every instant and no window can breach,
 * with no burn-down bookkeeping and no plan table to drift.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { MOLTSETS_PLAN_LIMITS, type MoltsetsPlanTier } from './moltsets.ts';

const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1';

/** Short enough that a drained budget is noticed within a minute, long enough
 * that this is ~1 call/min per org rather than one per lookup. */
const FAIR_USE_TTL_MS = 60_000;
/** Plan changes are a human action, but a paid upgrade (e.g. free/tier_27 ->
 * unlimited) must lift the daily cap promptly — at 6h a just-upgraded customer
 * stayed throttled by the old tier's cap for the rest of the day. 30m detects
 * the upgrade within half an hour; get_billing is free on unlimited plans and
 * ~1 token/30m on metered ones (TTL-cached, so once per org, not per lookup). */
const PLAN_TTL_MS = 30 * 60 * 1000;

type FairUse = {
  recordsRemaining5h: number | null;
  recordsReset5h: string | null;
  recordsRemaining1w: number | null;
  recordsReset1w: string | null;
};

type AccountStateRow = {
  plan: string | null;
  plan_unlimited: boolean | null;
  plan_fetched_at: string | null;
  records_remaining_5h: number | null;
  records_reset_5h: string | null;
  records_remaining_1w: number | null;
  records_reset_1w: string | null;
  fair_use_fetched_at: string | null;
};

export type MoltsetsPacing = {
  requestsPerMinute: number;
  dailyCap: number | null;
  /** null => no live budget, scheduler falls back to requestsPerMinute alone. */
  recordsPerMinute: number | null;
  maxRequestsPerMinute: number | null;
  /** Every fair-use window is spent. Callers must not call the provider. */
  exhausted: boolean;
  exhaustedResetAt: string | null;
  /** 'fair_use' = live budget, 'plan_table' = static fallback. */
  source: 'fair_use' | 'plan_table';
};

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** A fair-use "records remaining" reading. MoltSets returns a NEGATIVE sentinel
 * (-1) for the unlimited plan, mirroring token_balance: -1. That is "no limit",
 * NOT "budget spent" — reading it as a real balance makes sustainableRate() see
 * remaining <= 0 and declare the window exhausted, which silently locks an
 * unlimited customer out of enrichment. Map any negative reading to null so it
 * is treated as "no fair-use limit on this window" rather than a drained one. */
const recordsRemaining = (v: unknown): number | null => {
  const n = num(v);
  return n === null || n < 0 ? null : n;
};

/** get_billing/get_usage cost a token on metered plans and nothing on unlimited,
 * so both are on TTLs. Never throws: pacing must degrade, not break enrichment. */
async function post(apiKey: string, tool: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${MOLTSETS_API_BASE}/tools/${tool}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      console.warn(`MoltSets ${tool} returned ${response.status}`);
      return null;
    }
    return await response.json() as Record<string, unknown>;
  } catch (error) {
    console.warn(`MoltSets ${tool} failed:`, (error as Error).message);
    return null;
  }
}

/** The API wraps its payload in `results` and hangs `metadata` off the root,
 * but clients reshape both (the MCP flattens `results` and renames `metadata`
 * to `_metadata`). Read every shape: guessing one silently parses to null, which
 * is indistinguishable from "this account has no fair-use block". */
const unwrap = (payload: Record<string, unknown>): Record<string, unknown> =>
  (payload.results as Record<string, unknown> | undefined) ?? payload;

function metaOf(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const results = payload.results as Record<string, unknown> | undefined;
  return (payload.metadata
    ?? payload._metadata
    ?? results?.metadata
    ?? results?._metadata) as Record<string, unknown> | undefined;
}

function parseFairUse(payload: Record<string, unknown> | null): FairUse | null {
  if (!payload) return null;
  const fu = metaOf(payload)?.fair_use as Record<string, unknown> | undefined;
  if (!fu) return null;
  const parsed: FairUse = {
    recordsRemaining5h: recordsRemaining(fu.records_remaining_5h),
    recordsReset5h: typeof fu.records_reset_5h === 'string' ? fu.records_reset_5h : null,
    recordsRemaining1w: recordsRemaining(fu.records_remaining_1w),
    recordsReset1w: typeof fu.records_reset_1w === 'string' ? fu.records_reset_1w : null,
  };
  // A block with no usable window (absent, or an unlimited -1 sentinel on both)
  // is the same as no block at all — fall back to the plan-table pacing.
  if (parsed.recordsRemaining5h === null && parsed.recordsRemaining1w === null) return null;
  return parsed;
}

/** The account tier the API reports, which outranks the hand-typed key metadata.
 * 'unlimited' is the tokens flag, not the SKU: the $97 subscription with
 * unlimited tokens reports plan 'subscription_97' AND unlimited true, and pacing
 * must follow the flag. Check 997 before 97 — 'subscription_997' contains '97'. */
export function tierFromBilling(plan: string | null, unlimited: boolean | null): MoltsetsPlanTier | null {
  if (unlimited === true) return 'unlimited';
  if (!plan) return null;
  if (plan.includes('997')) return 'tier_997';
  if (plan.includes('97')) return 'tier_97';
  if (plan.includes('27')) return 'tier_27';
  return null;
}

const isStale = (at: string | null, ttlMs: number, now: number) =>
  !at || now - new Date(at).getTime() > ttlMs;

/**
 * Records/min this window can sustain: what's left, spread over the time left.
 * Exact for a fixed window and conservative for a rolling one (which refills as
 * it goes), so it is safe without knowing which MoltSets uses. The 1-minute
 * floor stops a near-reset window from dividing by ~0 and returning infinity.
 */
function sustainableRate(remaining: number | null, resetAt: string | null, now: number): number | null {
  if (remaining === null) return null;
  if (remaining <= 0) return 0;
  if (!resetAt) return null;
  const minutesLeft = Math.max((new Date(resetAt).getTime() - now) / 60_000, 1);
  return remaining / minutesLeft;
}

function fromPlanTable(tier: MoltsetsPlanTier | null): MoltsetsPacing | null {
  const limits = tier ? MOLTSETS_PLAN_LIMITS[tier] : undefined;
  if (!limits) return null;
  return {
    requestsPerMinute: limits.reqPerMin,
    dailyCap: limits.dailyCap,
    recordsPerMinute: limits.recordsPerMin ?? null,
    maxRequestsPerMinute: limits.maxReqPerMin ?? null,
    exhausted: false,
    exhaustedResetAt: null,
    source: 'plan_table',
  };
}

/**
 * Resolve pacing for an org, refreshing the cached MoltSets answers on their
 * TTLs. Returns null only when the tier can't be determined at all (no live
 * billing, no usable metadata label) — the caller should then skip the provider.
 */
export async function resolveMoltsetsPacing(
  supabase: SupabaseClient,
  organizationId: string,
  apiKey: string,
  metadataTier: MoltsetsPlanTier | null,
): Promise<MoltsetsPacing | null> {
  const now = Date.now();

  const { data } = await supabase
    .from('moltsets_account_state')
    .select('plan, plan_unlimited, plan_fetched_at, records_remaining_5h, records_reset_5h, records_remaining_1w, records_reset_1w, fair_use_fetched_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const row = (data ?? null) as AccountStateRow | null;

  const patch: Record<string, unknown> = {};
  let plan = row?.plan ?? null;
  let planUnlimited = row?.plan_unlimited ?? null;

  if (isStale(row?.plan_fetched_at ?? null, PLAN_TTL_MS, now)) {
    const billing = await post(apiKey, 'get_billing', {});
    if (billing) {
      const b = unwrap(billing);
      plan = typeof b.plan === 'string' ? b.plan : null;
      planUnlimited = typeof b.unlimited === 'boolean' ? b.unlimited : null;
      if (plan === null && planUnlimited === null) {
        // 2xx but nothing we recognise: log the shape instead of caching a null
        // that reads as "asked, no plan" and suppresses retries for 6h.
        console.warn('MoltSets get_billing returned an unrecognised shape:', JSON.stringify(billing).slice(0, 400));
      } else {
        patch.plan = plan;
        patch.plan_unlimited = planUnlimited;
        patch.plan_fetched_at = new Date(now).toISOString();
      }
    }
  }

  let fairUse: FairUse | null = row
    ? {
      recordsRemaining5h: row.records_remaining_5h,
      recordsReset5h: row.records_reset_5h,
      recordsRemaining1w: row.records_remaining_1w,
      recordsReset1w: row.records_reset_1w,
    }
    : null;

  if (isStale(row?.fair_use_fetched_at ?? null, FAIR_USE_TTL_MS, now)) {
    const usage = await post(apiKey, 'get_usage', { period: 'today' });
    const fresh = parseFairUse(usage);
    if (!fresh && usage) {
      // Not all plans report fair_use. Log the shape once per TTL so the
      // difference between "no such block" and "parsed it wrong" is visible
      // rather than both collapsing to a silent fallback.
      console.warn('MoltSets get_usage returned no fair_use block:', JSON.stringify(metaOf(usage) ?? usage).slice(0, 400));
    }
    if (fresh) {
      fairUse = fresh;
      patch.records_remaining_5h = fresh.recordsRemaining5h;
      patch.records_reset_5h = fresh.recordsReset5h;
      patch.records_remaining_1w = fresh.recordsRemaining1w;
      patch.records_reset_1w = fresh.recordsReset1w;
      patch.fair_use_fetched_at = new Date(now).toISOString();
    }
  }

  if (Object.keys(patch).length > 0) {
    patch.organization_id = organizationId;
    patch.updated_at = new Date(now).toISOString();
    const { error } = await supabase
      .from('moltsets_account_state')
      .upsert(patch, { onConflict: 'organization_id' });
    // A dropped cache write only costs an extra fetch next tick.
    if (error) console.warn('Could not cache MoltSets account state:', error.message);
  }

  // Live billing outranks the hand-typed label, which is why the label drifted
  // unnoticed in the first place.
  const tier = tierFromBilling(plan, planUnlimited) ?? metadataTier;
  const base = fromPlanTable(tier);
  if (!base) return null;
  if (!fairUse) return base;

  const rate5h = sustainableRate(fairUse.recordsRemaining5h, fairUse.recordsReset5h, now);
  const rate1w = sustainableRate(fairUse.recordsRemaining1w, fairUse.recordsReset1w, now);
  const rates = [rate5h, rate1w].filter((r): r is number => r !== null);
  if (rates.length === 0) return base;

  // Hold the tightest window and every looser one is satisfied for free.
  const recordsPerMinute = Math.min(...rates);
  if (recordsPerMinute <= 0) {
    const resetAt = (rate5h === 0 ? fairUse.recordsReset5h : fairUse.recordsReset1w) ?? null;
    return { ...base, recordsPerMinute: 0, exhausted: true, exhaustedResetAt: resetAt, source: 'fair_use' };
  }

  return {
    ...base,
    recordsPerMinute,
    // Keep the plan's request ceiling: it still bounds the burst a nearly-reset
    // window would otherwise licence.
    maxRequestsPerMinute: base.maxRequestsPerMinute,
    source: 'fair_use',
  };
}
