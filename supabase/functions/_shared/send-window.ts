/**
 * First-send scheduling, shared by every path that creates an email sequence
 * enrollment.
 *
 * Lived inline in enroll-leads (itself "mirrored from push-to-zapmail"). A third
 * copy for duplicate-email-sequence would have guaranteed drift, so the one
 * implementation lives here.
 */

export const SCHEDULING_DEFAULTS = {
  send_window: { start: '08:00', end: '18:00' },
  timezone: 'America/New_York',
  skip_weekends: true,
};

/** Gap between consecutive leads when a bulk enrollment is staggered. */
export const DEFAULT_STAGGER_MS = 60_000;

export function calculateInitialSendTime(settings: Record<string, unknown>): Date {
  const merged = { ...SCHEDULING_DEFAULTS, ...settings };
  const tz = (merged.timezone as string) || 'America/New_York';
  const sendWindow = merged.send_window as { start: string; end: string } | undefined;
  const skipWeekends = merged.skip_weekends as boolean;

  if (!sendWindow) return new Date();

  const now = new Date();
  const [startH, startM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const localHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const localMin = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = dayMap[weekday] ?? 1;
  const localMinOfDay = localHour * 60 + localMin;

  const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
  const isWithinWindow = localMinOfDay >= windowStartMin && localMinOfDay < windowEndMin;

  if (isWithinWindow && !(skipWeekends && isWeekendDay)) {
    return new Date(now.getTime() + Math.random() * 5 * 60 * 1000);
  }

  let target = new Date(now.getTime());
  if (localMinOfDay >= windowEndMin || (skipWeekends && isWeekendDay)) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  for (let i = 0; i < 7; i++) {
    const targetParts = formatter.formatToParts(target);
    const targetWeekday = targetParts.find(p => p.type === 'weekday')?.value || 'Mon';
    const targetDow = dayMap[targetWeekday] ?? 1;

    if (skipWeekends && (targetDow === 0 || targetDow === 6)) {
      target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      continue;
    }

    const dateStr = dateFormatter.format(target);
    const localDateTimeStr = `${dateStr}T${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}:00`;
    const utcStr = target.toLocaleString('en-US', { timeZone: 'UTC' });
    const localStr = target.toLocaleString('en-US', { timeZone: tz });
    const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

    const windowStartUtc = new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
    return new Date(windowStartUtc.getTime() + Math.random() * 15 * 60 * 1000);
  }

  return new Date();
}

function localParts(date: Date, tz: string): { minOfDay: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(date);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { minOfDay: h * 60 + m, dayOfWeek: dayMap[weekday] ?? 1 };
}

function atLocalTime(date: Date, hour: number, minute: number, tz: string): Date {
  const dateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
  const localDateTimeStr = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const offsetMs = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
    - new Date(date.toLocaleString('en-US', { timeZone: tz })).getTime();
  return new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
}

/**
 * Move a candidate time forward into the sequence's send window, rolling to the
 * next eligible day when it lands after the window closes or on a skipped weekend.
 *
 * Deliberately has NO random jitter, unlike calculateInitialSendTime and
 * reschedule-enrollments. staggerSendTimes feeds its own output back in, so jitter
 * would let a later lead land before an earlier one and break the strictly
 * increasing order the sender's FIFO claim depends on. Only ever moves forward.
 */
export function adjustToSendWindow(candidate: Date, settings: Record<string, unknown>): Date {
  const merged = { ...SCHEDULING_DEFAULTS, ...settings };
  const tz = (merged.timezone as string) || 'America/New_York';
  const sendWindow = merged.send_window as { start: string; end: string } | undefined;
  if (!sendWindow) return candidate;

  const skipWeekends = merged.skip_weekends as boolean;
  const [startH, startM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;

  let adjusted = new Date(candidate.getTime());
  // Bounded: at most one roll per day plus a full weekend skip.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { minOfDay, dayOfWeek } = localParts(adjusted, tz);

    if (skipWeekends && (dayOfWeek === 0 || dayOfWeek === 6)) {
      const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
      adjusted = atLocalTime(
        new Date(adjusted.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000), startH, startM, tz,
      );
      continue;
    }
    if (minOfDay < windowStartMin) return atLocalTime(adjusted, startH, startM, tz);
    if (minOfDay >= windowEndMin) {
      adjusted = atLocalTime(new Date(adjusted.getTime() + 24 * 60 * 60 * 1000), startH, startM, tz);
      continue;
    }
    return adjusted;
  }
  return adjusted;
}

/**
 * Spread `count` enrollments across the send window, `stepMs` apart, rolling into
 * following days once a day's window is full.
 *
 * Used by the duplicate path, where every lead would otherwise be inserted with one
 * identical next_send_at — a full ORDER BY next_send_at tie, so the sender's FIFO
 * claim returns an arbitrary slice of the pool on every poll instead of a stable
 * order. Output is strictly increasing.
 */
export function staggerSendTimes(
  count: number,
  settings: Record<string, unknown>,
  startAt: Date,
  stepMs: number = DEFAULT_STAGGER_MS,
): Date[] {
  const out: Date[] = [];
  let cursor = adjustToSendWindow(startAt, settings);
  for (let i = 0; i < count; i++) {
    out.push(cursor);
    cursor = adjustToSendWindow(new Date(cursor.getTime() + stepMs), settings);
  }
  return out;
}
