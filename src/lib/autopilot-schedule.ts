/**
 * Frontend mirror of supabase/functions/_shared/autopilot-schedule.ts, so the
 * Autopilots screens can show the coming posts and set an exact first run.
 * Keep the two in sync.
 */

export type FrequencyUnit = "hour" | "day" | "week";

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
  scheduling_mode: "immediate" | "optimal" | "scheduled";
  timezone: string;
  scheduled_times?: string[] | null;
  scheduled_days?: number[] | null;
  schedule_slots?: ScheduleSlot[] | null;
}

export interface SlotAt {
  at: Date;
  blueprint_id: string | null;
}

export const WEEKDAYS = [
  { id: 1, short: "Mon", long: "Monday" },
  { id: 2, short: "Tue", long: "Tuesday" },
  { id: 3, short: "Wed", long: "Wednesday" },
  { id: 4, short: "Thu", long: "Thursday" },
  { id: 5, short: "Fri", long: "Friday" },
  { id: 6, short: "Sat", long: "Saturday" },
  { id: 0, short: "Sun", long: "Sunday" },
];

export const OPTIMAL_HOURS = [9, 12, 14, 17, 19];

/** How long before its slot a scheduled run starts, so the post is ready on time. */
export const SCHEDULED_LEAD_MS = 60 * 60 * 1000;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Hours to add to UTC to get local time in `timezone` at `at` (DST-aware). */
export function getTimezoneOffset(timezone: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE) / 60;
  } catch {
    return 0;
  }
}

export function zonedTimeToUtc(year: number, month: number, date: number, hours: number, minutes: number, timezone: string): Date {
  const wall = Date.UTC(year, month, date, hours, minutes);
  const first = wall - getTimezoneOffset(timezone, new Date(wall)) * 60 * MINUTE;
  return new Date(wall - getTimezoneOffset(timezone, new Date(first)) * 60 * MINUTE);
}

export function frequencyIntervalMs(frequency: { amount: number; unit: FrequencyUnit }): number {
  switch (frequency?.unit) {
    case "hour":
      return frequency.amount * 60 * MINUTE;
    case "day":
      return frequency.amount * DAY;
    case "week":
      return frequency.amount * 7 * DAY;
    default:
      return DAY;
  }
}

export function snapToOptimalHour(target: Date, timezone: string): Date {
  const tzOffset = getTimezoneOffset(timezone, target);
  const local = new Date(target.getTime() + tzOffset * 60 * MINUTE);
  const slotLocal = new Date(local);
  const optimal = OPTIMAL_HOURS.find((h) => h >= local.getUTCHours());
  if (optimal !== undefined) {
    slotLocal.setUTCHours(optimal, 0, 0, 0);
  } else {
    slotLocal.setUTCDate(slotLocal.getUTCDate() + 1);
    slotLocal.setUTCHours(OPTIMAL_HOURS[0], 0, 0, 0);
  }
  return new Date(slotLocal.getTime() - tzOffset * 60 * MINUTE);
}

export function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function weeklySlots(schedule: AutopilotSchedule): Array<{ day: number; minutes: number; blueprint_id: string | null }> {
  if (schedule.scheduling_mode !== "scheduled") return [];
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

export function nextSlotAfter(schedule: AutopilotSchedule, after: Date): SlotAt | null {
  const slots = weeklySlots(schedule);
  if (slots.length === 0) return null;
  const tz = schedule.timezone || "UTC";
  const local = new Date(after.getTime() + getTimezoneOffset(tz, after) * 60 * MINUTE);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d0 = local.getUTCDate();
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

export function runAtForSlot(slot: Date): Date {
  return new Date(slot.getTime() - SCHEDULED_LEAD_MS);
}

/** next_run_at for a schedule starting now (scheduled: the first slot, an hour early). */
export function firstRunAt(schedule: AutopilotSchedule, now: Date = new Date()): Date {
  if (schedule.scheduling_mode === "scheduled") {
    const next = nextSlotAfter(schedule, now);
    if (next) return runAtForSlot(next.at);
  }
  const target = new Date(now.getTime() + frequencyIntervalMs(schedule.frequency));
  return schedule.scheduling_mode === "optimal" ? snapToOptimalHour(target, schedule.timezone || "UTC") : target;
}

/**
 * When the autopilot will post, from its next run on: weekly slots, or (older
 * interval autopilots) next_run_at and then one interval at a time.
 */
export function projectPosts(schedule: AutopilotSchedule & { next_run_at?: string | null }, until: Date, from: Date = new Date(), max = 80): SlotAt[] {
  if (weeklySlots(schedule).length > 0) {
    return upcomingSlots(schedule, max, from).filter((s) => s.at.getTime() <= until.getTime());
  }
  const out: SlotAt[] = [];
  let at = schedule.next_run_at ? new Date(schedule.next_run_at) : firstRunAt(schedule, from);
  if (at.getTime() < from.getTime()) at = from;
  while (at.getTime() <= until.getTime() && out.length < max) {
    out.push({ at, blueprint_id: null });
    const target = new Date(at.getTime() + frequencyIntervalMs(schedule.frequency));
    at = schedule.scheduling_mode === "optimal" ? snapToOptimalHour(target, schedule.timezone || "UTC") : target;
  }
  return out;
}

/** "Monday, Wednesday and Friday" / "weekday" / "day". */
export function describeDays(days: number[]): string {
  const set = new Set(days);
  if (set.size === 0 || set.size === 7) return "day";
  if (set.size === 5 && !set.has(0) && !set.has(6)) return "weekday";
  const names = WEEKDAYS.filter((d) => set.has(d.id)).map((d) => d.long);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Posts a week on a weekly schedule; 0 for interval autopilots. */
export function postsPerWeek(schedule: AutopilotSchedule): number {
  return weeklySlots(schedule).length;
}

/** Interval autopilots: "Every 6 hours, at a good hour to post". */
export function describeInterval(schedule: AutopilotSchedule): string {
  const { amount = 1, unit = "day" } = schedule.frequency ?? ({} as AutopilotSchedule["frequency"]);
  const every = amount === 1 ? `Every ${unit}` : `Every ${amount} ${unit}s`;
  return schedule.scheduling_mode === "optimal" ? `${every}, at a good hour to post` : every;
}

/** Posts a week for an interval autopilot (approximate). */
export function intervalPostsPerWeek(schedule: AutopilotSchedule): number {
  const ms = frequencyIntervalMs(schedule.frequency);
  return ms > 0 ? (7 * DAY) / ms : 0;
}

/** "Mon, Wed and Fri at 09:00" / "Every day at 12:30 and 19:00" / "6 slots a week". */
export function describeSchedule(schedule: AutopilotSchedule): string {
  if (schedule.scheduling_mode !== "scheduled" || weeklySlots(schedule).length === 0) return describeInterval(schedule);
  const list = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (schedule.schedule_slots?.length) {
    const slots = weeklySlots(schedule);
    const times = [...new Set(slots.map((s) => s.minutes))];
    const days = [...new Set(slots.map((s) => s.day))];
    if (times.length === 1 && slots.length === days.length) {
      const short = WEEKDAYS.filter((d) => days.includes(d.id)).map((d) => d.short);
      return `${days.length === 7 ? "Every day" : list(short)} at ${formatMinutes(times[0])}`;
    }
    return `${slots.length} set times a week`;
  }
  const days = schedule.scheduled_days?.length ? schedule.scheduled_days : [];
  const times = [...(schedule.scheduled_times ?? [])].sort();
  const dayText = days.length === 0 || days.length === 7
    ? "Every day"
    : days.length === 5 && !days.includes(0) && !days.includes(6)
      ? "Weekdays"
      : list(WEEKDAYS.filter((d) => days.includes(d.id)).map((d) => d.short));
  return `${dayText} at ${list(times)}`;
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
