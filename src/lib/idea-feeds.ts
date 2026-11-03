import { formatDistanceToNowStrict } from "date-fns";

/**
 * Which ideas feed which autopilot, and how much fuel each autopilot has left.
 *
 * Autopilots pick ideas by tag (see pickUnusedIdea in process-autopilots and
 * autopilot_feed_entries in 20260927120000_idea_autopilot_fuel.sql): a shared
 * autopilot with shared tags uses those, otherwise each content-mix entry uses
 * its own idea_tags, and an entry with no usable tag takes any idea. The Ideas
 * page shows that link as "feeds" so nobody has to match tag names by hand.
 */

export interface FuelEntry {
  blueprint_id: string | null;
  tags: string[];
  /** No usable tag: this entry takes any idea. */
  draws_from_all: boolean;
}

export interface AutopilotFuel {
  autopilot_id: string;
  name: string;
  status: string;
  paused_reason: string | null;
  entries: FuelEntry[];
  feed_tags: string[];
  draws_from_all: boolean;
  matching_ideas: number;
  /** Matching ideas this autopilot has never turned into content. */
  fresh_ideas: number;
  posts_per_day: number | null;
  runway_days: number | null;
  recycles: boolean;
  last_output_at: string | null;
  /** First "no ideas available" since its last successful start. */
  starving_since: string | null;
  starved_runs_7d: number;
  /** Ideas its tags match that "Only post approved ideas" holds back. */
  awaiting_review: number;
}

export interface IdeaUsage {
  idea_id: string;
  used_count: number;
  last_used_at: string | null;
  autopilot_ids: string[];
}

export type FuelState = "no_match" | "review" | "out" | "missed" | "repeating" | "low" | "ok" | "paused";

/**
 * Auto-reload waits this long before an idea can post again (IDEA_REPEAT_COOLDOWN
 * in supabase/functions/_shared/content-mix.ts).
 */
export const IDEA_REPEAT_COOLDOWN_DAYS = 14;

/** Fewer days of new ideas than this is worth a warning. */
export const LOW_RUNWAY_DAYS = 7;

/** `ignorePause`: judge the ideas alone, e.g. on the autopilot's own page where the pause is already shown. */
export function fuelState(f: AutopilotFuel, { ignorePause = false }: { ignorePause?: boolean } = {}): FuelState {
  if (f.status !== "active" && !ignorePause) return "paused";
  // Out of ideas it may post, with more waiting on approval: approving is the fix.
  const waiting = (f.awaiting_review ?? 0) > 0;
  if (f.matching_ideas === 0) return waiting ? "review" : "no_match";
  if (f.starving_since) return f.fresh_ideas > 0 ? "missed" : waiting ? "review" : "out";
  if (f.fresh_ideas === 0) return waiting ? "review" : f.recycles ? "repeating" : "out";
  if (f.runway_days !== null && f.runway_days < LOW_RUNWAY_DAYS) return "low";
  return "ok";
}

/** Needs the user to add or assign ideas. */
export function needsIdeas(state: FuelState): boolean {
  return state === "no_match" || state === "review" || state === "out" || state === "repeating" || state === "low";
}

/** Where to send someone to fix it: the review queue when approval is what's missing. */
export function fuelAction(autopilotId: string, state: FuelState): { href: string; cta: string } {
  return state === "review"
    ? { href: `/ideas?feed=${autopilotId}&view=review`, cta: "Review ideas" }
    : { href: `/ideas?pick=${autopilotId}`, cta: "Give it ideas" };
}

export const FUEL_DOT: Record<FuelState, string> = {
  no_match: "bg-destructive",
  review: "bg-amber-500",
  out: "bg-destructive",
  missed: "bg-amber-500",
  repeating: "bg-amber-500",
  low: "bg-amber-500",
  ok: "bg-emerald-500",
  paused: "bg-muted-foreground/40",
};

export function formatRunway(days: number | null): string | null {
  if (days === null) return null;
  if (days < 1) return "under a day";
  if (days > 60) return "2+ months";
  const d = Math.round(days);
  return `${d} day${d === 1 ? "" : "s"}`;
}

export function listTags(tags: string[], max = 3): string {
  const quoted = tags.slice(0, max).map((t) => `"${t}"`);
  const rest = tags.length - max;
  return rest > 0 ? `${quoted.join(", ")} and ${rest} more` : quoted.join(tags.length === 2 ? " or " : ", ");
}

const lower = (s: string) => s.trim().toLowerCase();

/**
 * Autopilots an idea with these tags feeds. `viaTag` is false when the
 * autopilot takes any idea (it would use this one without a tag).
 */
export function autopilotsFedBy(
  ideaTagNames: string[],
  fuel: AutopilotFuel[],
  /** Autopilots this idea was removed from: they never use it, whatever its tags. */
  excludedAutopilotIds?: Set<string>,
): Array<{ fuel: AutopilotFuel; viaTag: boolean }> {
  const tags = new Set(ideaTagNames.map(lower));
  const out: Array<{ fuel: AutopilotFuel; viaTag: boolean }> = [];
  for (const f of fuel) {
    if (excludedAutopilotIds?.has(f.autopilot_id)) continue;
    const tagged = f.entries.some((e) => !e.draws_from_all && e.tags.some((t) => tags.has(lower(t))));
    if (tagged) out.push({ fuel: f, viaTag: true });
    else if (f.draws_from_all) out.push({ fuel: f, viaTag: false });
  }
  return out;
}

/** One way to make an idea feed an autopilot: give it `tagName`. */
export interface FeedTarget {
  key: string;
  autopilotId: string;
  autopilotName: string;
  tagName: string;
  /** Content-mix blueprints this tag reaches (per-blueprint autopilots differ per entry). */
  blueprintIds: string[];
  /** The autopilot as a whole has one feed (shared tags or a single tagged entry). */
  whole: boolean;
}

export interface FeedOption {
  target: FeedTarget;
  fuel: AutopilotFuel;
  /** "MYC LinkedIn" or "MYC LinkedIn · Carousel" when the autopilot splits ideas per blueprint. */
  label: string;
}

/** "Don't assign" in pickers that create ideas. */
export const NO_FEED = "__none__";

export function findFeedOption(options: FeedOption[], key: string): FeedOption | undefined {
  return key === NO_FEED ? undefined : options.find((o) => o.target.key === key);
}

/**
 * The tags to add so an idea reaches each tagged part of an autopilot. Only
 * existing tags are offered: creating a tag an entry names but nobody has
 * would switch that entry from "any idea" to "only this idea".
 */
export function feedTargets(f: AutopilotFuel, existingTagNames: string[]): FeedTarget[] {
  const existing = new Map(existingTagNames.map((n) => [lower(n), n]));
  const byTag = new Map<string, FeedTarget>();
  for (const e of f.entries) {
    if (e.draws_from_all) continue;
    const tag = e.tags.map((t) => existing.get(lower(t))).find(Boolean);
    if (!tag) continue;
    const key = `${f.autopilot_id}:${lower(tag)}`;
    const target = byTag.get(key) ?? {
      key,
      autopilotId: f.autopilot_id,
      autopilotName: f.name,
      tagName: tag,
      blueprintIds: [],
      whole: false,
    };
    if (e.blueprint_id && !target.blueprintIds.includes(e.blueprint_id)) target.blueprintIds.push(e.blueprint_id);
    byTag.set(key, target);
  }
  const targets = [...byTag.values()];
  const taggedEntries = f.entries.filter((e) => !e.draws_from_all).length;
  for (const t of targets) t.whole = targets.length === 1 && t.blueprintIds.length >= taggedEntries;
  return targets;
}

/** Case-insensitive duplicate titles: normalised title -> number of ideas with it. */
export function duplicateTitleCounts(titles: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of titles) {
    const k = normaliseTitle(t);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function normaliseTitle(title: string): string {
  return (title ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function fuelHeadline(f: AutopilotFuel, state: FuelState): string {
  const runway = formatRunway(f.runway_days);
  switch (state) {
    case "no_match":
      return "No ideas to post";
    case "review":
      return "Waiting on idea approval";
    case "out":
      return "Out of new ideas";
    case "missed":
      return "Missed its last runs";
    case "repeating":
      return "Repeating old ideas";
    case "low":
    case "ok":
      return `${f.fresh_ideas} new idea${f.fresh_ideas === 1 ? "" : "s"}${runway ? ` · about ${runway}` : ""}`;
    case "paused":
      return "Paused";
  }
}

export function fuelDetail(f: AutopilotFuel, state: FuelState): string {
  const source = f.draws_from_all
    ? "Uses any idea"
    : `Uses ideas tagged ${listTags(f.feed_tags, 2)}`;
  switch (state) {
    case "no_match":
      return f.feed_tags.length > 0
        ? `No idea is tagged ${listTags(f.feed_tags, 2)} yet.`
        : "There are no ideas in this workspace yet.";
    case "out":
      return `All ${f.matching_ideas} of its ideas are used${f.starving_since ? `. Nothing posted for ${formatDistanceToNowStrict(new Date(f.starving_since))}` : ""}.`;
    case "missed":
      return `${f.fresh_ideas} unused ideas match it now, so its next run can pick one up.`;
    case "review": {
      const n = f.awaiting_review;
      const ideas = `${n} idea${n === 1 ? "" : "s"}`;
      return f.matching_ideas === 0
        ? `None of its ideas are approved yet. ${ideas} need${n === 1 ? "s" : ""} review.`
        : `Its ${f.matching_ideas} approved idea${f.matching_ideas === 1 ? " is" : "s are"} used. ${ideas} still need${n === 1 ? "s" : ""} review.`;
    }
    case "repeating":
      return `All ${f.matching_ideas} ideas are used, so it's posting them again, each at most once every ${IDEA_REPEAT_COOLDOWN_DAYS} days.`;
    default:
      return f.awaiting_review > 0 ? `${source}. ${f.awaiting_review} more need review.` : `${source}.`;
  }
}
