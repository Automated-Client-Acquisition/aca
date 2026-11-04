/**
 * When to read a published post's stats again. Numbers move fast on day one and settle
 * within a month: hourly for the first 24 h, daily for the first week, weekly to 30 days,
 * then never. A post the platform hasn't counted yet is retried hourly in its first week;
 * a post Zernio can't read (no analytics on the plan, a key problem) is retried daily.
 */
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export type MetricsState = 'pending' | 'synced' | 'no_access' | 'unavailable' | 'error';

export function nextMetricsFetch(publishedAt: Date | null, state: MetricsState, now: Date = new Date()): Date | null {
  const age = publishedAt ? now.getTime() - publishedAt.getTime() : 0;
  if (age >= 30 * DAY) return null;
  const at = (ms: number) => new Date(now.getTime() + ms);
  if (state === 'pending') return at(age < 7 * DAY ? HOUR : DAY);
  if (state !== 'synced') return at(DAY);
  if (age < DAY) return at(HOUR);
  if (age < 7 * DAY) return at(DAY);
  return at(7 * DAY);
}
