/**
 * Email Warmup Module
 *
 * Manages warmup ramp schedule, daily limit calculation,
 * and promotion/pause decisions for warming mailboxes.
 */

export interface WarmupRampTier {
  maxDay: number;
  dailyLimit: number;
}

/**
 * Warmup ramp schedule (aligned with cold email infrastructure best practices):
 * Day 1-2:   5 emails/day  (initial cautious sends)
 * Day 3-5:   10 emails/day (establishing baseline)
 * Day 6-10:  20 emails/day (building momentum)
 * Day 11-16: 35 emails/day (mid ramp)
 * Day 17-22: 50 emails/day (high ramp)
 * Day 23+:   60 emails/day -> promote to 'ready'
 *
 * Full warmup: ~23 days to reach 60/day production capacity.
 * Per-mailbox config can override these defaults (warmup_max_daily up to 80).
 */
export const WARMUP_RAMP_SCHEDULE: WarmupRampTier[] = [
  { maxDay: 2, dailyLimit: 5 },
  { maxDay: 5, dailyLimit: 10 },
  { maxDay: 10, dailyLimit: 20 },
  { maxDay: 16, dailyLimit: 35 },
  { maxDay: 22, dailyLimit: 50 },
  { maxDay: Infinity, dailyLimit: 60 },
];

export const WARMUP_COMPLETE_DAY = 23;
export const MAX_BOUNCE_RATE = 0.05;
export const MIN_HEALTH_FOR_PROMOTION = 0.7;

/**
 * No reputation decision (burn, pause, or holding back promotion) may rest on a
 * denominator smaller than this. A rate over a handful of sends is noise: 1
 * bounce in 1 send reads as "100%".
 */
export const MIN_SENDS_FOR_REPUTATION_ACTION = 50;

/**
 * Get the daily send limit for a given warmup day.
 */
export function getDailyLimitForWarmupDay(day: number): number {
  for (const tier of WARMUP_RAMP_SCHEDULE) {
    if (day <= tier.maxDay) {
      return tier.dailyLimit;
    }
  }
  return WARMUP_RAMP_SCHEDULE[WARMUP_RAMP_SCHEDULE.length - 1].dailyLimit;
}

/**
 * Calculate warmup day from the warmup start date.
 */
export function calculateWarmupDay(warmupStartDate: string | Date): number {
  const start = new Date(warmupStartDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  return Math.max(1, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
}

/**
 * Determine if a mailbox should be promoted from 'warming' to 'ready'.
 * Requires: warmup day >= 23, health score >= 0.7, and bounce rate < 5% —
 * the bounce check only once `sentCount` reaches MIN_SENDS_FOR_REPUTATION_ACTION.
 * Before that, bounce_rate is lifetime bounced/sent over a few cold sends, and
 * 1 bounce in 1 send held 49 last10legal.com mailboxes in 'warming' for 86 days.
 */
export function shouldPromoteToReady(
  warmupDay: number,
  bounceRate: number,
  healthScore: number,
  sentCount: number
): boolean {
  const bounceBlocks =
    sentCount >= MIN_SENDS_FOR_REPUTATION_ACTION && bounceRate >= MAX_BOUNCE_RATE;
  return (
    warmupDay >= WARMUP_COMPLETE_DAY &&
    !bounceBlocks &&
    healthScore >= MIN_HEALTH_FOR_PROMOTION
  );
}

/**
 * Determine if a mailbox should be auto-paused during warmup
 * due to high bounce rate.
 */
export function shouldAutoPause(bounceRate: number): boolean {
  return bounceRate >= MAX_BOUNCE_RATE;
}

// ============================================================================
// Per-Mailbox Config Support
// ============================================================================

export interface MailboxWarmupConfig {
  warmup_max_daily: number;
  warmup_daily_rampup: number;
  warmup_weekdays_only: boolean;
  warmup_randomize: boolean;
  warmup_randomize_range: number;
}

/**
 * Calculate daily limit using per-mailbox config (linear ramp).
 * Falls back to the hardcoded tier schedule if no config provided.
 */
export function getDailyLimitWithConfig(
  day: number,
  config?: MailboxWarmupConfig | null
): number {
  if (!config) {
    return getDailyLimitForWarmupDay(day);
  }

  let limit = Math.min(day * config.warmup_daily_rampup, config.warmup_max_daily);

  if (config.warmup_randomize && config.warmup_randomize_range > 0) {
    const range = config.warmup_randomize_range;
    const variance = Math.floor(Math.random() * (range * 2 + 1)) - range;
    limit = Math.max(1, limit + variance);
  }

  return limit;
}

/**
 * Calculate total warmup days needed based on config.
 * Adds 3 stabilisation days after reaching max daily.
 */
export function getWarmupCompletionDay(config?: MailboxWarmupConfig | null): number {
  if (!config) {
    return WARMUP_COMPLETE_DAY;
  }
  return Math.ceil(config.warmup_max_daily / config.warmup_daily_rampup) + 3;
}

/**
 * Check if today is a valid send day (Mon-Fri when weekdays only).
 * When timezone is provided, evaluates the day in that timezone instead of server time.
 */
export function isValidSendDay(weekdaysOnly: boolean, timezone?: string): boolean {
  if (!weekdaysOnly) return true;

  if (timezone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    });
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const parts = formatter.formatToParts(new Date());
    const weekdayPart = parts.find((p) => p.type === 'weekday');
    const dayOfWeek = weekdayMap[weekdayPart?.value || 'Mon'] ?? 1;
    return dayOfWeek >= 1 && dayOfWeek <= 5;
  }

  const dayOfWeek = new Date().getDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}
