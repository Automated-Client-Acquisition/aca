// ============================================================================
// Autopilot run scheduling
//
// Pure, side-effect-free scheduling logic shared by process-autopilots and the
// MCP. Frontend mirror: src/lib/autopilot-schedule.ts (keep the two in sync).
//
// Two orthogonal axes drive when an interval autopilot runs next:
//   - frequency       → the CADENCE (how often). e.g. 1/day, 2/day, 3/week.
//   - scheduling_mode → the time-of-day ALIGNMENT (when within the day).
//
// Scheduled mode instead posts in weekly slots: either the same times on the
// chosen days (scheduled_times × scheduled_days), or one list of {day, time}
// slots (schedule_slots, "plan each day"), where a slot can pin a blueprint.
// A scheduled run starts SCHEDULED_LEAD_MS before its slot so the piece is
// ready to post at the slot time (approve-stage holds it until then).
// ============================================================================

export type FrequencyUnit = 'hour' | 'day' | 'week';

export interface ScheduleSlot {
  /** Local weekday, 0 = Sunday … 6 = Saturday. */
  day: number;
  /** Local "HH:MM". */
  time: string;
  /** Always run this blueprint in this slot; null/absent = next in the rotation. */
  blueprint_id?: string | null;
}

export interface AutopilotSchedule {
  frequency: { amount: number; unit: FrequencyUnit };
  scheduling_mode: 'immediate' | 'optimal' | 'scheduled';
  timezone: string;
  scheduled_times?: string[] | null;
  /** Scheduled mode only: local weekdays to post on (0 = Sunday … 6 = Saturday). Empty/unset = every day. */
  scheduled_days?: number[] | null;
  /** Scheduled mode only: when non-empty, these slots replace scheduled_times × scheduled_days. */
  schedule_slots?: ScheduleSlot[] | null;
}

export interface SlotAt {
  at: Date;
  blueprint_id: string | null;
}

// High-engagement posting hours (local time) used by optimal mode.
export const OPTIMAL_HOURS = [9, 12, 14, 17, 19];

/** How long before its slot a scheduled run starts, so the post is ready on time. */
export const SCHEDULED_LEAD_MS = 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * Hours to ADD to UTC to get local time in `timezone` at `at` (DST-aware for
 * that instant). Negative for the Americas, positive for Europe/Asia.
 */
export function getTimezoneOffset(timezone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE) / 60;
  } catch {
    return 0; // Fallback to UTC for invalid timezones
  }
}

/** The UTC instant of a local wall-clock time in `timezone` (month 0-based; date may overflow). */
export function zonedTimeToUtc(year: number, month: number, date: number, hours: number, minutes: number, timezone: string): Date {
  const wall = Date.UTC(year, month, date, hours, minutes);
  const first = wall - getTimezoneOffset(timezone, new Date(wall)) * 60 * MINUTE;
  // Second pass: the offset at the real instant can differ across a DST change.
  return new Date(wall - getTimezoneOffset(timezone, new Date(first)) * 60 * MINUTE);
}

/**
 * Convert a frequency config into a millisecond interval — the cadence, i.e.
 * how long to wait between runs. This is the source of truth for "how often"
 * in every mode except `scheduled` (which derives cadence from its slots).
 */
export function frequencyIntervalMs(frequency: { amount: number; unit: FrequencyUnit }): number {
  switch (frequency.unit) {
    case 'hour':
      return frequency.amount * 60 * 60 * 1000;
    case 'day':
      return frequency.amount * DAY;
    case 'week':
      return frequency.amount * 7 * DAY;
    default:
      return DAY; // Default to 1 day
  }
}

/**
 * Snap a target instant FORWARD to the nearest high-engagement ("optimal") hour
 * at or after it, in the given timezone. Lets optimal mode align a
 * frequency-derived run time to a good posting hour without changing cadence.
 */
export function snapToOptimalHour(target: Date, timezone: string): Date {
  const tzOffset = getTimezoneOffset(timezone, target); // hours to add to UTC to get local time

  const local = new Date(target.getTime() + tzOffset * 60 * MINUTE);
  const slotLocal = new Date(local);

  const optimal = OPTIMAL_HOURS.find((h) => h >= local.getUTCHours());
  if (optimal !== undefined) {
    slotLocal.setUTCHours(optimal, 0, 0, 0);
  } else {
    // Past the last optimal hour for that local day → first slot the next day.
    slotLocal.setUTCDate(slotLocal.getUTCDate() + 1);
    slotLocal.setUTCHours(OPTIMAL_HOURS[0], 0, 0, 0);
  }

  return new Date(slotLocal.getTime() - tzOffset * 60 * MINUTE);
}

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The autopilot's week as {day, minutes, blueprint_id}: its schedule_slots, or
 * the same times on every chosen day. Empty when it isn't on a weekly schedule.
 */
export function weeklySlots(schedule: AutopilotSchedule): Array<{ day: number; minutes: number; blueprint_id: string | null }> {
  if (schedule.scheduling_mode !== 'scheduled') return [];
  const out: Array<{ day: number; minutes: number; blueprint_id: string | null }> = [];
  if (schedule.schedule_slots?.length) {
    for (const s of schedule.schedule_slots) {
      const minutes = parseTime(s?.time);
      if (minutes === null || !(s.day >= 0 && s.day <= 6)) continue;
      out.push({ day: s.day, minutes, blueprint_id: s.blueprint_id || null });
    }
  } else if (schedule.scheduled_times?.length) {
    const days = schedule.scheduled_days?.length ? [...new Set(schedule.scheduled_days)] : [0, 1, 2, 3, 4, 5, 6];
    for (const day of days) {
      for (const t of schedule.scheduled_times) {
        const minutes = parseTime(t);
        if (minutes !== null) out.push({ day, minutes, blueprint_id: null });
      }
    }
  }
  return out.sort((a, b) => a.day - b.day || a.minutes - b.minutes);
}

/** The first weekly slot strictly after `after`, in the autopilot's timezone; null when it has none. */
export function nextSlotAfter(schedule: AutopilotSchedule, after: Date): SlotAt | null {
  const slots = weeklySlots(schedule);
  if (slots.length === 0) return null;
  const tz = schedule.timezone || 'UTC';
  const local = new Date(after.getTime() + getTimezoneOffset(tz, after) * 60 * MINUTE);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d0 = local.getUTCDate();
  // Start a day early so a DST edge never skips a slot; 9 days covers a full week after it.
  for (let d = -1; d <= 8; d++) {
    const weekday = new Date(Date.UTC(y, m, d0 + d)).getUTCDay();
    for (const s of slots) {
      if (s.day !== weekday) continue;
      const at = zonedTimeToUtc(y, m, d0 + d, Math.floor(s.minutes / 60), s.minutes % 60, tz);
      if (at.getTime() > after.getTime()) return { at, blueprint_id: s.blueprint_id };
    }
  }
  return null;
}

/** The next `count` slots after `from`. */
export function upcomingSlots(schedule: AutopilotSchedule, count: number, from: Date = new Date()): SlotAt[] {
  const out: SlotAt[] = [];
  let cursor = from;
  while (out.length < count) {
    const next = nextSlotAfter(schedule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next.at;
  }
  return out;
}

/**
 * The slot a due scheduled run is for. Runs are set SCHEDULED_LEAD_MS ahead of
 * their slot; older next_run_at values (set before the lead existed, or by an
 * interval) belong to the first slot at or after them.
 */
export function slotForRun(schedule: AutopilotSchedule, nextRunAt: Date): SlotAt | null {
  const target = nextRunAt.getTime() + SCHEDULED_LEAD_MS;
  const led = nextSlotAfter(schedule, new Date(target - MINUTE));
  if (led && Math.abs(led.at.getTime() - target) < MINUTE) return led;
  return nextSlotAfter(schedule, new Date(nextRunAt.getTime() - MINUTE));
}

/** When the run for `slot` starts. */
export function runAtForSlot(slot: Date): Date {
  return new Date(slot.getTime() - SCHEDULED_LEAD_MS);
}

/**
 * Calculate the next run time (next_run_at) for an autopilot.
 *
 * `frequency` sets the cadence and `scheduling_mode` sets the time-of-day
 * alignment — they are orthogonal:
 *   - scheduled: the next weekly slot, started SCHEDULED_LEAD_MS early. After a
 *                run, pass the slot it served as `currentSlot` so a slot that is
 *                closer than the lead isn't skipped.
 *   - optimal:   wait one frequency interval, then snap forward to an
 *                engagement hour — "1/day optimal" posts once a day at a good
 *                hour, not at every optimal hour
 *   - immediate: wait one frequency interval and run (no time-of-day alignment)
 *
 * @param now Injectable "current time" so callers/tests are deterministic.
 */
export function calculateNextRun(autopilot: AutopilotSchedule, now: Date = new Date(), currentSlot: Date | null = null): Date {
  if (autopilot.scheduling_mode === 'scheduled' && weeklySlots(autopilot).length > 0) {
    const after = currentSlot && currentSlot.getTime() > now.getTime() ? currentSlot : now;
    const next = nextSlotAfter(autopilot, after);
    // Unreachable with a valid slot; fall back to one day out.
    return next ? runAtForSlot(next.at) : new Date(now.getTime() + DAY);
  }

  // Both optimal and immediate modes take their cadence from `frequency`.
  const target = new Date(now.getTime() + frequencyIntervalMs(autopilot.frequency));

  // Optimal mode: keep the cadence, but align the run to an engagement hour.
  if (autopilot.scheduling_mode === 'optimal') {
    return snapToOptimalHour(target, autopilot.timezone);
  }

  // Immediate mode (default): run as soon as the frequency interval elapses.
  return target;
}
