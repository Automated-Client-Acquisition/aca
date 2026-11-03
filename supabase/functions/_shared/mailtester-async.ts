/**
 * Shared helpers for the Mailtester Ninja async pipeline.
 *
 * Two callers:
 *   - mailtester-verify-kickoff: heuristic + cache pre-pass, enqueue survivors
 *   - mailtester-verify-worker:  drains pending_emails at the plan's RPS
 *
 * Persistence and per-address mapping live in _shared/list-verifier.ts so the
 * sync path and async path agree on cache shape and status mapping.
 */

import {
  MAILTESTER_PLAN_LIMITS,
  type MailtesterNinjaPlan,
  type SupabaseServiceClient,
  type VerificationStatus,
} from './list-verifier.ts';

export const PLAN_TICK_BUDGET = 60; // worker runs once a minute

/** How many addresses one cron tick should attempt for a given plan. */
export function emailsPerTick(plan: MailtesterNinjaPlan): number {
  return Math.max(1, Math.floor(MAILTESTER_PLAN_LIMITS[plan].rps * PLAN_TICK_BUDGET));
}

export function intervalMsForPlan(plan: MailtesterNinjaPlan): number {
  return Math.max(1, Math.ceil(1000 / MAILTESTER_PLAN_LIMITS[plan].rps));
}

/**
 * Returns how many Mailtester verifications the org has used today (UTC).
 * Counts rows in email_address_verifications — one row = one billed call —
 * but EXCLUDES timeout rows: a timeout means the endpoint never returned a
 * result, so it isn't a billable verification and must not consume the daily
 * budget. Only real endpoint responses (valid/invalid/catch-all, and genuine
 * response-`unknown`s) count.
 */
export async function getMailtesterUsedToday(
  supabase: SupabaseServiceClient,
  organizationId: string,
): Promise<number> {
  const startUtc = new Date();
  startUtc.setUTCHours(0, 0, 0, 0);
  const startIso = startUtc.toISOString();
  const [{ count: total }, { count: timeouts }] = await Promise.all([
    supabase
      .from('email_address_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('provider', 'mailtester_ninja')
      .gte('verified_at', startIso),
    supabase
      .from('email_address_verifications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('provider', 'mailtester_ninja')
      .gte('verified_at', startIso)
      .eq('raw_response->>reason', 'timeout'),
  ]);
  return Math.max(0, (total ?? 0) - (timeouts ?? 0));
}

/**
 * Tick stats produced by the worker so the job row can be updated atomically.
 */
export interface WorkerTickStats {
  processed: number;
  valid: number;
  invalid: number;
  catch_all: number;
  unknown: number;
  daily_limit_reached: boolean;
}

export function emptyTickStats(): WorkerTickStats {
  return {
    processed: 0,
    valid: 0,
    invalid: 0,
    catch_all: 0,
    unknown: 0,
    daily_limit_reached: false,
  };
}

export function bumpTickStats(stats: WorkerTickStats, status: VerificationStatus): void {
  stats.processed += 1;
  switch (status) {
    case 'valid':
      stats.valid += 1;
      break;
    case 'invalid':
    case 'disposable':
      stats.invalid += 1;
      break;
    case 'catch_all':
      stats.catch_all += 1;
      break;
    default:
      stats.unknown += 1;
  }
}
