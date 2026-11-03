/**
 * Pure functions for per-MX concurrency ramp.
 *
 * Rules:
 *  - On any 421 (rate limit) → halve current concurrency (min 1).
 *  - On 10 consecutive 250s → double current concurrency (cap at max).
 *  - Anything else is a no-op; the caller is expected to clear the streak.
 */

export type SmtpResponseKind = 'ok' | 'rate_limited' | 'error';

export interface RampHistoryEntry {
  kind: SmtpResponseKind;
  ts: number;
}

export interface RampResult {
  next: number;
  consecutiveOk: number;
}

export function nextConcurrency(
  current: number,
  max: number,
  consecutiveOk: number,
  latest: SmtpResponseKind,
): RampResult {
  if (latest === 'rate_limited') {
    return { next: Math.max(1, Math.floor(current / 2)), consecutiveOk: 0 };
  }
  if (latest === 'ok') {
    const streak = consecutiveOk + 1;
    if (streak >= 10) {
      return { next: Math.min(max, current * 2), consecutiveOk: 0 };
    }
    return { next: current, consecutiveOk: streak };
  }
  // error or other — reset the streak but don't touch concurrency.
  return { next: current, consecutiveOk: 0 };
}
