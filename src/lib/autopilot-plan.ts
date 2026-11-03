/**
 * An autopilot as a posting plan: where it posts, when, which blueprints take
 * turns and on which topics. Pure helpers shared by the Autopilots home and the
 * editor: form <-> saved autopilot, and the posts it will make.
 */
import type { Autopilot, ContentMixItem, PublishDestination, ScheduleSlot } from "@/types/autopilot";
import {
  type AutopilotSchedule,
  OPTIMAL_HOURS,
  firstRunAt,
  frequencyIntervalMs,
  projectPosts,
  weeklySlots,
} from "@/lib/autopilot-schedule";
import { predictBlueprints } from "@/lib/content-mix";
import { type MediaKind, mediaKindForPipeline, skipReason } from "@/lib/platform-fit";

export type Posting = "publish" | "draft";
/** interval = older autopilots on "every N hours", kept until switched. */
export type ScheduleKind = "interval" | "times" | "plan";
export type Topics = "shared" | "per";

export interface PlanForm {
  name: string;
  posting: Posting;
  destinations: PublishDestination[];
  scheduleKind: ScheduleKind;
  days: number[];
  times: string[];
  slots: ScheduleSlot[];
  timezone: string;
  /** The whole content_mix (entries with enabled: false are kept but not shown). */
  mix: ContentMixItem[];
  topics: Topics;
  sharedTags: string[];
  recycle: boolean;
  onlyApproved: boolean;
}

/** Colours for blueprints in a mix, by position: distinct in hue and lightness, readable as dots on light and dark. */
export const MIX_COLORS = ["#2F6CA8", "#C2410C", "#15806B", "#8B5CB8", "#A16207", "#BE3A62", "#55606E", "#3F7F2A"];
export const mixColor = (index: number) => MIX_COLORS[index % MIX_COLORS.length];

export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export const isShown = (m: ContentMixItem) => m.enabled !== false;

/**
 * Small whole-number shares for display: 40/30/30 → 4/3/3, 39/20/20/20 → 2/1/1/1.
 * Ratios are all the scheduler uses, so this keeps behaviour (near) identical.
 */
export function toParts(mix: ContentMixItem[]): ContentMixItem[] {
  const weights = mix.filter(isShown).map((m) => Math.max(0, Math.round(m.weight || 0)));
  const positive = weights.filter((w) => w > 0);
  // All zero: the scheduler shares equally.
  if (positive.length === 0) return mix.map((m) => (isShown(m) ? { ...m, weight: 1 } : m));
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = positive.reduce((a, b) => gcd(a, b));
  const reduced = positive.map((w) => w / g);
  const fits = Math.max(...reduced) <= 9;
  const min = Math.min(...positive);
  return mix.map((m) => {
    if (!isShown(m)) return m;
    const w = Math.max(0, Math.round(m.weight || 0));
    if (w === 0) return { ...m, weight: 0 };
    return { ...m, weight: fits ? w / g : Math.min(9, Math.max(1, Math.round(w / min))) };
  });
}

function scheduleKindOf(a: Autopilot): ScheduleKind {
  if (a.scheduling_mode !== "scheduled") return "interval";
  if (a.schedule_slots?.length) return "plan";
  if (a.scheduled_times?.length) return "times";
  return "interval";
}

export function newPlanForm(opts: { blueprintId?: string | null; accountId?: string | null; platform?: string | null } = {}): PlanForm {
  return {
    name: "",
    posting: "publish",
    destinations: opts.accountId ? [{ account_id: opts.accountId, platform: opts.platform || "ghl", enabled: true }] : [],
    scheduleKind: "times",
    days: [1, 3, 5],
    times: ["09:00"],
    slots: [],
    timezone: browserTimezone(),
    mix: opts.blueprintId ? [{ blueprint_id: opts.blueprintId, weight: 1, enabled: true }] : [],
    topics: "shared",
    sharedTags: [],
    recycle: true,
    // New autopilots only post reviewed ideas.
    onlyApproved: true,
  };
}

export function planFormFrom(a: Autopilot): PlanForm {
  const kind = scheduleKindOf(a);
  const shown = (a.content_mix ?? []).filter(isShown);
  // Shared mode with no shared tags falls back to each blueprint's tags in the scheduler.
  const perTags = shown.some((m) => (m.idea_tags ?? []).length > 0);
  const topics: Topics =
    a.ideas_source === "per_blueprint" || (!(a.shared_idea_tags ?? []).length && perTags) ? "per" : "shared";
  const slotDays = [...new Set((a.schedule_slots ?? []).map((s) => s.day))];
  const slotTimes = [...new Set((a.schedule_slots ?? []).map((s) => s.time))].sort();
  return {
    name: a.name,
    posting: (a.destinations ?? []).some((d) => d.enabled) ? "publish" : "draft",
    destinations: a.destinations ?? [],
    scheduleKind: kind,
    days: kind === "times" ? (a.scheduled_days?.length ? [...a.scheduled_days] : [0, 1, 2, 3, 4, 5, 6]) : kind === "plan" ? slotDays : [1, 3, 5],
    times: kind === "times" ? [...(a.scheduled_times ?? [])].sort() : kind === "plan" ? slotTimes : ["09:00"],
    slots: kind === "plan" ? (a.schedule_slots ?? []).map((s) => ({ day: s.day, time: s.time, blueprint_id: s.blueprint_id ?? null })) : [],
    timezone: a.timezone || browserTimezone(),
    mix: toParts(a.content_mix ?? []),
    topics,
    sharedTags: a.shared_idea_tags ?? [],
    recycle: a.auto_reload_pool ?? true,
    onlyApproved: a.only_approved_ideas ?? false,
  };
}

/** Days and times that roughly match an older interval autopilot, for "switch to days and times". */
export function timesForInterval(a: Pick<Autopilot, "frequency">): { days: number[]; times: string[] } {
  const hours = frequencyIntervalMs(a.frequency) / 3_600_000;
  if (hours >= 48) return { days: [1, 3, 5], times: ["09:00"] };
  const perDay = Math.max(1, Math.min(OPTIMAL_HOURS.length, Math.round(24 / Math.max(hours, 1))));
  const spread = perDay === 1 ? [9] : OPTIMAL_HOURS.filter((_, i) => i % Math.ceil(OPTIMAL_HOURS.length / perDay) === 0).slice(0, perDay);
  return { days: [0, 1, 2, 3, 4, 5, 6], times: spread.map((h) => `${String(h).padStart(2, "0")}:00`) };
}

/** Same times on every chosen day, as slots (for switching to "plan each day"). */
export function slotsFromTimes(days: number[], times: string[]): ScheduleSlot[] {
  const out: ScheduleSlot[] = [];
  for (const day of days) for (const time of times) out.push({ day, time, blueprint_id: null });
  return out;
}

/** The schedule fields a form saves (scheduled mode only). */
export function scheduleFields(form: PlanForm): Pick<Autopilot, "scheduling_mode" | "scheduled_times" | "scheduled_days" | "schedule_slots" | "timezone"> {
  if (form.scheduleKind === "plan") {
    return {
      scheduling_mode: "scheduled",
      scheduled_times: [...new Set(form.slots.map((s) => s.time))].sort(),
      scheduled_days: [...new Set(form.slots.map((s) => s.day))].sort(),
      schedule_slots: form.slots.map((s) => ({ day: s.day, time: s.time, blueprint_id: s.blueprint_id || null })),
      timezone: form.timezone,
    };
  }
  return {
    scheduling_mode: "scheduled",
    scheduled_times: [...form.times].sort(),
    scheduled_days: form.days.length === 7 ? null : [...form.days].sort(),
    schedule_slots: null,
    timezone: form.timezone,
  };
}

/** The content_mix a form saves: shared topics with no tags must clear per-blueprint tags (the scheduler falls back to them). */
export function mixToSave(form: PlanForm): ContentMixItem[] {
  return form.mix.map((m) => {
    const next = { ...m };
    if (form.topics === "shared" && form.sharedTags.length === 0) delete next.idea_tags;
    if (!next.destination_account_ids?.length) delete next.destination_account_ids;
    return next;
  });
}

/** A form (or saved autopilot) as the plan the projections read. */
export interface PlanLike extends AutopilotSchedule {
  content_mix: ContentMixItem[];
  destinations: PublishDestination[];
  next_run_at?: string | null;
}

export function formToPlan(form: PlanForm, a: Autopilot | null): PlanLike {
  const base: AutopilotSchedule =
    form.scheduleKind === "interval" && a
      ? { frequency: a.frequency, scheduling_mode: a.scheduling_mode, timezone: a.timezone || form.timezone }
      : { frequency: a?.frequency ?? { amount: 1, unit: "day" }, ...scheduleFields(form) };
  return {
    ...base,
    content_mix: form.mix,
    destinations: form.posting === "publish" ? form.destinations : [],
    next_run_at: form.scheduleKind === "interval" ? a?.next_run_at ?? null : null,
  };
}

export function firstRunFor(form: PlanForm, a: Autopilot | null, now = new Date()): Date {
  return firstRunAt(formToPlan(form, a), now);
}

/** What a blueprint's pieces carry, given its mix entry. */
export function kindOf(blueprint: { pipeline?: string | null; skip_image_generation?: boolean | null } | undefined, entry?: ContentMixItem): MediaKind {
  return mediaKindForPipeline(blueprint?.pipeline, { skipImage: !!(entry?.skip_image_generation ?? blueprint?.skip_image_generation) });
}

/** The accounts a blueprint's piece goes to, and the ones it skips because they can't take it. */
export function routeFor(plan: PlanLike, entry: ContentMixItem | undefined, kind: MediaKind): {
  to: PublishDestination[];
  skipped: Array<{ destination: PublishDestination; reason: string }>;
} {
  const enabled = (plan.destinations ?? []).filter((d) => d.enabled);
  const only = entry?.destination_account_ids?.length ? new Set(entry.destination_account_ids) : null;
  const to: PublishDestination[] = [];
  const skipped: Array<{ destination: PublishDestination; reason: string }> = [];
  for (const d of enabled) {
    if (only && !only.has(d.account_id)) continue;
    const reason = skipReason(d.platform, kind);
    if (reason) skipped.push({ destination: d, reason });
    else to.push(d);
  }
  return { to, skipped };
}

export interface PlannedPost {
  at: Date;
  blueprint_id: string | null;
  pinned: boolean;
  to: PublishDestination[];
  skipped: Array<{ destination: PublishDestination; reason: string }>;
}

/** The posts a plan will make between `from` and `until`, with the blueprint each gets and where it goes. */
export function projectPlan(
  plan: PlanLike,
  opts: {
    from?: Date;
    until: Date;
    history?: string[];
    blueprints: Map<string, { pipeline?: string | null; skip_image_generation?: boolean | null }>;
    max?: number;
  },
): PlannedPost[] {
  const from = opts.from ?? new Date();
  const slots = projectPosts(plan, opts.until, from, opts.max ?? 80);
  const picks = predictBlueprints(plan.content_mix, slots, opts.history ?? []);
  return slots.map((slot, i) => {
    const blueprintId = picks[i]?.blueprint_id ?? null;
    const entry = (plan.content_mix ?? []).find((m) => m.enabled && m.blueprint_id === blueprintId);
    const route = routeFor(plan, entry, kindOf(blueprintId ? opts.blueprints.get(blueprintId) : undefined, entry));
    return { at: slot.at, blueprint_id: blueprintId, pinned: !!picks[i]?.pinned, ...route };
  });
}

/**
 * Posts a week a plan makes. Interval autopilots are counted over a simulated
 * week: "every 6 hours at a good hour" snaps to daytime hours, so it posts
 * about 14 times a week, not 28.
 */
export function plannedPerWeek(plan: AutopilotSchedule, now = new Date()): number {
  const weekly = weeklySlots(plan).length;
  if (weekly > 0) return weekly;
  if (!(frequencyIntervalMs(plan.frequency) > 0)) return 0;
  const { frequency, scheduling_mode, timezone } = plan;
  return projectPosts({ frequency, scheduling_mode, timezone, next_run_at: now.toISOString() }, new Date(now.getTime() + 7 * 86_400_000 - 1), now, 200).length;
}

/** Each shown entry's share of the rotation (0-1) and how many pinned slots a week it has. */
export function shares(form: Pick<PlanForm, "mix" | "slots" | "scheduleKind">): Map<number, { share: number; pinned: number }> {
  const shown = form.mix.map((m, i) => ({ m, i })).filter(({ m }) => isShown(m));
  const total = shown.reduce((n, { m }) => n + Math.max(0, m.weight || 0), 0);
  const out = new Map<number, { share: number; pinned: number }>();
  for (const { m, i } of shown) {
    const pinned = form.scheduleKind === "plan" ? form.slots.filter((s) => s.blueprint_id === m.blueprint_id).length : 0;
    out.set(i, { share: total > 0 ? Math.max(0, m.weight || 0) / total : 1 / shown.length, pinned });
  }
  return out;
}

/** Weekly slots the rotation fills (slots not pinned to a blueprint in the mix). */
export function rotatingPerWeek(form: PlanForm, plan: AutopilotSchedule): number {
  if (form.scheduleKind !== "plan") return plannedPerWeek(plan);
  const inMix = new Set(form.mix.filter(isShown).map((m) => m.blueprint_id));
  return form.slots.filter((s) => !s.blueprint_id || !inMix.has(s.blueprint_id)).length;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Notepad Scribble" / "Notepad Scribble, Billboard and Bookstore, in turn". */
export function describeMix(names: string[]): string {
  if (names.length === 0) return "posts from the blueprints you add";
  if (names.length === 1) return names[0];
  return `${joinNames(names)}, in turn`;
}
