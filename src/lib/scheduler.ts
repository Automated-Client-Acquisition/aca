/**
 * Social Scheduler (/scheduler): platform rules, best posting times, slot
 * finding, grouping queue rows into posts, and the briefing's insights.
 *
 * Backend mirror for CHAR_LIMITS and BEST_TIMES:
 * supabase/functions/scheduler-agent/index.ts (keep the two in sync).
 */
import { addDays, addMinutes, differenceInCalendarDays, format, isSameDay, startOfDay } from "date-fns";

export type SchedulerStatus = "draft" | "pending" | "publishing" | "published" | "failed";
export type SchedulerOrigin = "autopilot" | "manual" | "agent";

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

/**
 * What each channel accepts through ACA's publishers (GHL for most, our own X
 * publisher for X). Limits come from each platform's publishing API, not its
 * app (Instagram's app takes 20 carousel items, its API 10), plus what prod
 * failures taught us (TikTok via GHL rejects several pictures:
 * "doesn't support multi media formats").
 */
export interface PlatformRule {
  label: string;
  /** Max caption length (X counts weighted characters, Bluesky graphemes). */
  limit: number;
  /** Characters shown before "…see more" in the feed. */
  fold: number;
  /** Most pictures one post can carry. */
  maxImages: number;
  /** false: more than one picture fails or gets dropped. */
  multiImage: boolean;
  /** Needs a picture or video to post at all. */
  needsMedia?: boolean;
  /** Video length window in seconds; `strict` = the API rejects outside it. */
  video?: { min: number; max: number; strict: boolean };
  /** Picture aspect range (width / height) the API accepts. */
  imageRatio?: { min: number; max: number };
  /** Largest picture / video the publisher takes, in MB. */
  maxImageMB?: number;
  maxVideoMB?: number;
  maxHashtags?: number;
  maxMentions?: number;
  /** Posts the first comment right after publishing. */
  firstComment: boolean;
  /** Can post as a Story. */
  stories?: boolean;
  /** One line on the formats that work best. */
  specs: string;
  /** Brand color (hex), for dots and preview accents. */
  color: string;
}

export const PLATFORM_RULES: Record<string, PlatformRule> = {
  linkedin: {
    label: "LinkedIn", limit: 3000, fold: 210, maxImages: 20, multiImage: true,
    video: { min: 3, max: 15 * 60, strict: true }, maxVideoMB: 5000, firstComment: true,
    specs: "3,000 characters, about 210 show before “see more”. Pictures 1080×1350 (4:5) or 1200×627. Several pictures post as a swipeable PDF carousel through GHL, or a multi-image post on native accounts (50 MB max). Video 3 s to 15 min.",
    color: "#0A66C2",
  },
  twitter: {
    label: "X", limit: 280, fold: 280, maxImages: 4, multiImage: true,
    video: { min: 0.5, max: 140, strict: true }, maxImageMB: 5, maxVideoMB: 512, firstComment: false,
    specs: "280 characters (links count as 23, emoji as 2). Up to 4 pictures (16:9 or 1:1, 5 MB each) or one video up to 2 min 20 s.",
    color: "#111111",
  },
  instagram: {
    label: "Instagram", limit: 2200, fold: 125, maxImages: 10, multiImage: true, needsMedia: true,
    video: { min: 3, max: 15 * 60, strict: true }, imageRatio: { min: 0.8, max: 1.91 }, maxImageMB: 8,
    maxHashtags: 30, maxMentions: 20, firstComment: true, stories: true,
    specs: "Needs a picture or video. Pictures 4:5 to 1.91:1 (1080×1350 fills the feed), up to 10 in a carousel. Videos post as Reels: 9:16, 3 s to 15 min. 2,200 characters, 125 show before “more”, 30 hashtags max.",
    color: "#E4405F",
  },
  facebook: {
    label: "Facebook", limit: 63206, fold: 480, maxImages: 10, multiImage: true,
    video: { min: 3, max: 240 * 60, strict: false }, firstComment: true, stories: true,
    specs: "Pictures 1080×1350 (4:5) or 1:1, up to 10. Videos post as Reels (9:16 fills the screen). About 480 characters show before “See more”.",
    color: "#1877F2",
  },
  tiktok: {
    label: "TikTok", limit: 2200, fold: 100, maxImages: 1, multiImage: false, needsMedia: true,
    video: { min: 3, max: 10 * 60, strict: true },
    firstComment: false,
    specs: "One video (9:16, 3 s to 10 min) or one picture as a photo post. Several pictures fail. 2,200 characters.",
    color: "#111111",
  },
  youtube: {
    label: "YouTube", limit: 5000, fold: 120, maxImages: 1, multiImage: false, needsMedia: true,
    video: { min: 1, max: 3 * 60, strict: false }, firstComment: false,
    specs: "Videos post as Shorts: vertical 9:16, up to 3 min. 5,000 characters of description.",
    color: "#FF0000",
  },
  google: {
    label: "Google Business", limit: 1500, fold: 300, maxImages: 1, multiImage: false,
    video: { min: 1, max: 30, strict: true }, maxImageMB: 5, maxVideoMB: 75, firstComment: false,
    specs: "1,500 characters, no phone numbers in the text. One picture (1200×900, 4:3) or a video up to 30 s.",
    color: "#4285F4",
  },
  pinterest: {
    label: "Pinterest", limit: 500, fold: 100, maxImages: 1, multiImage: false, needsMedia: true,
    video: { min: 4, max: 15 * 60, strict: true }, firstComment: false,
    specs: "Needs one picture or video. 1000×1500 (2:3) pins perform best. 500 characters.",
    color: "#E60023",
  },
  threads: {
    label: "Threads", limit: 500, fold: 500, maxImages: 10, multiImage: true,
    video: { min: 0, max: 5 * 60, strict: true }, firstComment: false,
    specs: "500 characters. Up to 10 pictures, or one video up to 5 min.",
    color: "#111111",
  },
  bluesky: {
    label: "Bluesky", limit: 300, fold: 300, maxImages: 4, multiImage: true,
    video: { min: 0, max: 3 * 60, strict: true }, firstComment: false,
    specs: "300 characters. Up to 4 pictures, or one video up to 3 min.",
    color: "#1185FE",
  },
};

const FALLBACK_RULE: PlatformRule = {
  label: "Social", limit: 2200, fold: 200, maxImages: 4, multiImage: true, firstComment: false,
  specs: "", color: "#64748b",
};

// ---------------------------------------------------------------------------
// Caption length the way each platform counts it
// ---------------------------------------------------------------------------

const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|ai|app|dev|me|ly|gg|tv|xyz|info|biz|us|uk|fr|de|eu|ca|au)\b(?:\/[^\s]*)?/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  return Array.from(text);
}

/** X's weight for one grapheme: Latin and common punctuation 1, emoji and CJK 2. */
function xWeight(seg: string): number {
  if (EMOJI_RE.test(seg)) return 2;
  let w = 0;
  for (const ch of seg) {
    const cp = ch.codePointAt(0) ?? 0;
    w += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2;
  }
  return Math.min(w, 2);
}

/**
 * X's weighted length (twitter-text v3): every link counts as 23, emoji and
 * CJK as 2. Also returns where the text crosses `limit`, for highlighting.
 */
export function xMeasure(text: string, limit = 280): { length: number; overflowAt: number | null } {
  let length = 0;
  let overflowAt: number | null = null;
  let index = 0;
  const urls = [...text.matchAll(URL_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  let u = 0;
  for (const seg of graphemes(text)) {
    if (u < urls.length && index >= urls[u].start && index < urls[u].end) {
      if (index === urls[u].start) length += 23;
      if (index + seg.length >= urls[u].end) u++;
    } else {
      length += xWeight(seg);
    }
    if (overflowAt === null && length > limit) overflowAt = index;
    index += seg.length;
  }
  return { length, overflowAt };
}

/** Caption length as the platform counts it. */
export function captionLength(platform: string, text: string): number {
  const p = normPlatform(platform);
  if (p === "twitter") return xMeasure(text).length;
  if (p === "bluesky") return graphemes(text).length;
  return text.length;
}

export function countHashtags(text: string): number {
  return (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export function countMentions(text: string): number {
  return (text.match(/(^|\s)@[\w.]+/g) ?? []).length;
}

/** A phone number in the text (9 to 15 digits), not a date like 2026-11-05. */
export function hasPhoneNumber(text: string): boolean {
  for (const m of text.matchAll(/\+?\(?\d[\d\s().-]{6,}\d/g)) {
    const digits = m[0].replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15 && !/^\d{4}-\d{2}-\d{2}/.test(m[0])) return true;
  }
  return false;
}

/** A destination ACA publishes to without GHL: LinkedIn through Unipile, or the org's own Zernio account. */
export function isNativeDestination(account: { id: string; metadata?: Record<string, unknown> }): boolean {
  return account.metadata?.native === true || account.id.startsWith("unipile:") || account.id.startsWith("zernio:");
}

type TwinCandidate = { id: string; type?: string; platform: string; name: string; username?: string; metadata?: Record<string, unknown> };

/**
 * GHL's Social Planner still lists accounts the org has also connected through
 * Zernio, and picking both posts twice. The GHL copy is left out of what can be
 * picked (same channel, same handle or name). `replacedBy` maps each hidden GHL
 * id to the Zernio account that takes its place.
 */
export function withoutGhlTwins<T extends TwinCandidate>(accounts: T[]): { offered: T[]; replacedBy: Map<string, string> } {
  const handle = (s?: string) => (s ?? "").trim().replace(/^@/, "").toLowerCase();
  const keys = (a: T) => [a.username, a.name].map(handle).filter(Boolean).map((h) => `${normPlatform(a.platform)}:${h}`);

  const zernio = new Map<string, string>();
  for (const a of accounts) {
    if (a.id.startsWith("zernio:")) for (const k of keys(a)) zernio.set(k, a.id);
  }
  const replacedBy = new Map<string, string>();
  if (zernio.size) {
    for (const a of accounts) {
      if (a.type !== "social" || isNativeDestination(a)) continue;
      const twin = keys(a).map((k) => zernio.get(k)).find(Boolean);
      if (twin) replacedBy.set(a.id, twin);
    }
  }
  return { offered: replacedBy.size ? accounts.filter((a) => !replacedBy.has(a.id)) : accounts, replacedBy };
}

/** Media cap for one native LinkedIn post (Unipile v2 takes it as base64 JSON). */
export const NATIVE_LINKEDIN_MAX_MB = 50;

export function normPlatform(platform: string | null | undefined): string {
  const p = String(platform || "").toLowerCase();
  if (p === "x") return "twitter";
  if (p === "google_business" || p === "gmb") return "google";
  return p;
}

export function ruleFor(platform: string | null | undefined): PlatformRule {
  return PLATFORM_RULES[normPlatform(platform)] ?? { ...FALLBACK_RULE, label: platform ? String(platform) : FALLBACK_RULE.label };
}

/** Platforms the composer can post to (WordPress takes articles, not posts). */
export function isSocialPlatform(platform: string | null | undefined): boolean {
  return normPlatform(platform) !== "wordpress";
}

// ---------------------------------------------------------------------------
// Best times (local hours). Aggregated from public engagement studies; a
// starting point, not a promise.
// ---------------------------------------------------------------------------

interface BestTimes { hours: number[]; days: number[]; peakDays: number[] }
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

export const BEST_TIMES: Record<string, BestTimes> = {
  linkedin: { hours: [8, 10, 12, 17], days: WEEKDAYS, peakDays: [2, 3, 4] },
  twitter: { hours: [9, 12, 15, 18], days: ALL_DAYS, peakDays: [2, 3, 4] },
  instagram: { hours: [11, 13, 19], days: ALL_DAYS, peakDays: [1, 2, 3] },
  facebook: { hours: [9, 13, 16], days: ALL_DAYS, peakDays: [2, 3, 4] },
  tiktok: { hours: [12, 16, 19, 21], days: ALL_DAYS, peakDays: [2, 4, 5] },
  youtube: { hours: [15, 17, 20], days: ALL_DAYS, peakDays: [4, 5, 6] },
  google: { hours: [9, 12], days: [1, 2, 3, 4, 5, 6], peakDays: [2, 3] },
  pinterest: { hours: [14, 20, 21], days: ALL_DAYS, peakDays: [5, 6] },
  threads: { hours: [11, 13, 19], days: ALL_DAYS, peakDays: [1, 2, 3] },
};
const DEFAULT_TIMES: BestTimes = { hours: [9, 12, 17], days: WEEKDAYS, peakDays: [2, 3, 4] };

function timesFor(platform: string): BestTimes {
  return BEST_TIMES[normPlatform(platform)] ?? DEFAULT_TIMES;
}

/** 0..1: how good a local day/hour is for a platform. */
export function slotScore(platform: string, weekday: number, hour: number): number {
  const t = timesFor(platform);
  if (!t.days.includes(weekday)) return 0;
  if (t.hours.includes(hour)) return t.peakDays.includes(weekday) ? 1 : 0.7;
  if (t.hours.some((h) => Math.abs(h - hour) === 1)) return 0.3;
  return 0;
}

/** Average score across platforms (the composer posts one time to all of them). */
export function multiScore(platforms: string[], weekday: number, hour: number): number {
  const list = platforms.length ? platforms : ["linkedin", "instagram", "facebook", "twitter"];
  return list.reduce((s, p) => s + slotScore(p, weekday, hour), 0) / list.length;
}

export function scoreLabel(score: number): string | null {
  if (score >= 0.85) return "Peak time";
  if (score >= 0.6) return "Good time";
  return null;
}

// ---------------------------------------------------------------------------
// Queue rows → posts
// ---------------------------------------------------------------------------

export interface PublishContent {
  caption?: string;
  images?: string[];
  videoUrl?: string;
  followUpComment?: string;
  /** "story" on Instagram/Facebook rows; otherwise derived from the media. */
  postType?: string;
}

export interface SchedulerRow {
  id: string;
  organization_id: string | null;
  autopilot_id: string | null;
  output_id: string | null;
  account_id: string;
  platform: string | null;
  scheduled_for: string;
  status: SchedulerStatus;
  attempts: number | null;
  last_error: string | null;
  published_at: string | null;
  is_repost: boolean | null;
  source: SchedulerOrigin | null;
  post_group_id: string | null;
  agent_rationale: string | null;
  publish_content: PublishContent | null;
  created_at: string;
  autopilot?: { id: string; name: string } | null;
  // content_outputs.data / stage_data are free-form JSON written by every pipeline.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output?: { id: string; data: any; stage_data: any; pipeline: string; job_id: string | null; source: string | null } | null;
}

export interface Media { images: string[]; video?: string }

export interface SchedulerPost {
  key: string;
  rows: SchedulerRow[];
  at: Date;
  status: SchedulerStatus;
  origin: SchedulerOrigin;
  caption: string;
  /** Per platform caption when the rows differ. */
  captions: Record<string, string>;
  media: Media;
  title: string;
  autopilotName?: string;
  rationale?: string;
  platforms: string[];
  error?: string;
  pipeline?: string;
  jobId?: string | null;
  format: PostFormat;
  /** Engagement read back from the platform (Zernio posts only), once published. */
  stats?: PostStats;
}

// ============================================================================
// Post stats (social_post_metrics, filled by refresh-post-metrics)
// ============================================================================

export type StatsStatus = "pending" | "synced" | "no_access" | "unavailable" | "error";

export interface StatCounts {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  clicks: number;
}

/** One published row's numbers (one post on one account). */
export interface RowStats extends StatCounts {
  id: string;
  queueId: string;
  accountId: string;
  platform: string;
  status: StatsStatus;
  engagementRate: number | null;
  postUrl: string | null;
  fetchedAt: string | null;
  error: string | null;
}

/** A post's numbers across every account it went to. */
export interface PostStats extends StatCounts {
  status: StatsStatus;
  engagementRate: number | null;
  /** Likes, comments, shares and saves. */
  interactions: number;
  postUrl: string | null;
  fetchedAt: string | null;
  error: string | null;
  rows: RowStats[];
}

const COUNT_KEYS: Array<keyof StatCounts> = ["impressions", "reach", "likes", "comments", "shares", "saves", "views", "clicks"];
const STATS_STATUS_RANK: Record<StatsStatus, number> = { synced: 4, pending: 3, no_access: 2, error: 1, unavailable: 0 };

export const interactionsOf = (s: StatCounts) => s.likes + s.comments + s.shares + s.saves;

/** Sums the accounts; the rate is interactions over the summed reach basis (impressions, else reach, else views). */
export function summarizeStats(rows: RowStats[]): PostStats {
  const total = Object.fromEntries(COUNT_KEYS.map((k) => [k, rows.reduce((n, r) => n + (r.status === "synced" || r.status === "pending" ? r[k] : 0), 0)])) as unknown as StatCounts;
  const counted = rows.filter((r) => r.status === "synced" || r.status === "pending");
  const basis = counted.reduce((n, r) => n + (r.impressions || r.reach || r.views), 0);
  const interactions = interactionsOf(total);
  const status = rows.reduce<StatsStatus>((acc, r) => (STATS_STATUS_RANK[r.status] > STATS_STATUS_RANK[acc] ? r.status : acc), rows[0]?.status ?? "pending");
  const fetched = rows.map((r) => r.fetchedAt).filter(Boolean).sort() as string[];
  return {
    ...total,
    status,
    interactions,
    // No rate before anyone has seen it: 0% would read as a flop, not "not counted yet".
    engagementRate: !basis && !interactions ? null : rows.length === 1 ? rows[0].engagementRate : basis ? Math.round((interactions / basis) * 10000) / 100 : null,
    postUrl: rows.find((r) => r.postUrl)?.postUrl ?? null,
    fetchedAt: fetched[fetched.length - 1] ?? null,
    error: rows.find((r) => r.status !== "synced" && r.error)?.error ?? null,
    rows,
  };
}

/** Puts each published post's numbers on it. */
export function attachStats(posts: SchedulerPost[], byQueueId: Map<string, RowStats>): SchedulerPost[] {
  if (!byQueueId.size) return posts;
  return posts.map((p) => {
    const rows = p.rows.map((r) => byQueueId.get(r.id)).filter(Boolean) as RowStats[];
    return rows.length ? { ...p, stats: summarizeStats(rows) } : p;
  });
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
/** 1234 → "1.2K". */
export const formatCount = (n: number) => compact.format(n);

/** What an output would publish, mirroring process-publish-queue's buildPublishContent. */
export function outputPreview(output: SchedulerRow["output"]): { caption: string; media: Media } {
  if (!output) return { caption: "", media: { images: [] } };
  const d = output.data || {};
  const s = output.stage_data || {};
  const text = (stage: { content?: unknown; text?: unknown } | undefined) =>
    (typeof stage?.content === "string" && stage.content) || (typeof stage?.text === "string" && stage.text) || "";
  const caption =
    text(s.caption) || text(s.post_caption) || s.final?.caption || d.text || d.caption || d.title || text(s.script) || "";
  const images: string[] = [];
  let video: string | undefined;
  if (s.image?.media_type === "video") video = s.image.video_url || s.image.url;
  else if (s.image?.url || s.image?.image_url) images.push(s.image.url || s.image.image_url);
  for (const slide of s.carousel_slides?.slides || []) if (slide?.image_url) images.push(slide.image_url);
  video = video || s.final?.video_url || s.final?.url || s.video?.video_url || s.video?.url || s.composition?.video_url || s.composition?.url || undefined;
  if (!images.length && !video && d.image_url) images.push(d.image_url);
  return { caption: String(caption || ""), media: { images, video } };
}

function rowContent(row: SchedulerRow): { caption: string; media: Media } {
  const base = outputPreview(row.output);
  const pc = row.publish_content;
  if (!pc) return base;
  const hasMedia = Array.isArray(pc.images) || !!pc.videoUrl;
  return {
    // The row's own caption is exact, blank included (process-publish-queue does the same).
    caption: typeof pc.caption === "string" ? pc.caption : base.caption,
    media: hasMedia ? { images: pc.images ?? [], video: pc.videoUrl || undefined } : base.media,
  };
}

const STATUS_RANK: Record<SchedulerStatus, number> = { failed: 5, publishing: 4, draft: 3, pending: 2, published: 1 };

export function originOf(row: SchedulerRow): SchedulerOrigin {
  if (row.source) return row.source;
  if (row.autopilot_id) return "autopilot";
  return row.output?.source === "manual" ? "manual" : "agent";
}

export function groupKey(row: SchedulerRow): string {
  return row.post_group_id ?? (row.output_id ? `${row.output_id}|${row.scheduled_for}` : row.id);
}

export function groupRows(rows: SchedulerRow[]): SchedulerPost[] {
  const groups = new Map<string, SchedulerRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const posts: SchedulerPost[] = [];
  for (const [key, list] of groups) {
    const status = list.reduce<SchedulerStatus>((acc, r) => (STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc), list[0].status);
    // The row that sets the status speaks for the group: after a partial
    // failure the failed row (maybe moved since) is the one still to act on.
    const first = list.find((r) => r.status === status) ?? list[0];
    // A group that published shows where it went out; everything else where it's planned.
    const when = status === "published" && first.published_at ? first.published_at : first.scheduled_for;
    const { caption, media } = rowContent(first);
    const captions: Record<string, string> = {};
    for (const r of list) captions[normPlatform(r.platform)] = rowContent(r).caption;
    const title = (first.output?.data?.title as string) || caption.split("\n").find((l) => l.trim()) || "Untitled post";
    posts.push({
      key,
      rows: list,
      at: new Date(when),
      status,
      origin: originOf(first),
      caption,
      captions,
      media,
      title: title.slice(0, 140),
      autopilotName: first.autopilot?.name,
      rationale: first.agent_rationale ?? undefined,
      platforms: [...new Set(list.map((r) => normPlatform(r.platform)))],
      error: list.find((r) => r.status === "failed")?.last_error ?? undefined,
      pipeline: first.output?.pipeline,
      jobId: first.output?.job_id ?? null,
      format: list.some((r) => r.publish_content?.postType === "story") ? "story" : "feed",
    });
  }
  return posts.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function statusLabel(post: Pick<SchedulerPost, "status" | "origin">): string {
  if (post.status === "draft") return post.origin === "agent" ? "Proposal" : "Draft";
  if (post.status === "pending") return "Scheduled";
  if (post.status === "publishing") return "Publishing";
  if (post.status === "published") return "Published";
  return "Failed";
}

export function isEditable(post: Pick<SchedulerPost, "status">): boolean {
  return post.status === "draft" || post.status === "pending" || post.status === "failed";
}

// ---------------------------------------------------------------------------
// Slot finding
// ---------------------------------------------------------------------------

/** Two posts to the same account closer than this crowd each other out. */
export const MIN_GAP_MINUTES = 90;

export interface SlotSuggestion { at: Date; score: number; label: string }

/**
 * The next good free times for these platforms/accounts, best first within
 * the soonest days. `busy` holds existing posts (account id + time).
 */
export function suggestSlots(opts: {
  platforms: string[];
  accountIds: string[];
  busy: Array<{ account_id: string; at: Date }>;
  from?: Date;
  days?: number;
  count?: number;
  minScore?: number;
}): SlotSuggestion[] {
  const from = opts.from ?? addMinutes(new Date(), 15);
  const days = opts.days ?? 14;
  const minScore = opts.minScore ?? 0.6;
  const busy = opts.busy.filter((b) => opts.accountIds.length === 0 || opts.accountIds.includes(b.account_id));
  const hours = new Set<number>();
  for (const p of opts.platforms.length ? opts.platforms : ["linkedin", "instagram", "facebook"]) timesFor(p).hours.forEach((h) => hours.add(h));
  const out: SlotSuggestion[] = [];
  for (let d = 0; d < days && out.length < (opts.count ?? 3); d++) {
    const day = addDays(startOfDay(from), d);
    const candidates = [...hours]
      .sort((a, b) => a - b)
      .map((h) => {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, 0);
        return { at, score: multiScore(opts.platforms, at.getDay(), h) };
      })
      .filter(({ at, score }) => at > from && score >= minScore)
      .filter(({ at }) => !busy.some((b) => Math.abs(b.at.getTime() - at.getTime()) < MIN_GAP_MINUTES * 60_000))
      .sort((a, b) => b.score - a.score || a.at.getTime() - b.at.getTime());
    // At most two suggestions per day, so the picks spread across days.
    for (const c of candidates.slice(0, 2)) {
      if (out.length >= (opts.count ?? 3)) break;
      out.push({ ...c, label: slotDayLabel(c.at) });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function slotDayLabel(at: Date, now = new Date()): string {
  const diff = differenceInCalendarDays(at, now);
  const time = format(at, "HH:mm");
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Tomorrow ${time}`;
  if (diff < 7) return `${format(at, "EEE")} ${time}`;
  return format(at, "EEE d MMM, HH:mm");
}

// ---------------------------------------------------------------------------
// Briefing insights
// ---------------------------------------------------------------------------

export type InsightTone = "danger" | "warning" | "info" | "success";
export type InsightAction = "review_failed" | "approve_drafts" | "plan_gap" | "compose" | "connect" | "open_ideas";

/** An active autopilot whose runs stopped producing posts, and why. */
export interface StalledAutopilot {
  id: string;
  name: string;
  reason: "no_ideas" | "approval_failed";
  /** Last time it published in the past week, if it did. */
  lastPosted?: Date;
}

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail?: string;
  action?: { kind: InsightAction; label: string; payload?: { days?: string[] } };
  secondary?: { kind: InsightAction; label: string };
}

export function buildInsights(opts: {
  posts: SchedulerPost[];
  rangeStart: Date;
  rangeEnd: Date;
  accountCount: number;
  failedRecent: SchedulerPost[];
  draftsAhead: SchedulerPost[];
  /** Upcoming autopilot runs; a stalled one won't produce a post. */
  projections?: Array<{ at: Date; stalled?: string }>;
  stalled?: StalledAutopilot[];
  now?: Date;
}): Insight[] {
  const now = opts.now ?? new Date();
  const out: Insight[] = [];
  const weekdaysAhead = (): string[] => {
    const days: string[] = [];
    for (let d = startOfDay(now); d <= addDays(startOfDay(now), 7); d = addDays(d, 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6 && addDays(d, 1) > now) days.push(format(d, "yyyy-MM-dd"));
    }
    return days;
  };
  if (opts.stalled?.length) {
    const s = opts.stalled;
    const names = s.map((a) => a.name.split(" · ")[0]);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    const allNoIdeas = s.every((a) => a.reason === "no_ideas");
    out.push({
      id: "stalled",
      tone: "danger",
      title: s.length === 1
        ? `${names[0]} is stuck: ${s[0].reason === "no_ideas" ? "out of ideas" : "approval keeps failing"}`
        : `${s.length} autopilots are ${allNoIdeas ? "out of ideas" : "stuck"}`,
      detail: `${list} ${s.length === 1 ? "has" : "have"} runs on the calendar that won't post. ${allNoIdeas ? "Add ideas to their pools, or let the agent write this week's posts." : "Check their last runs, or let the agent write this week's posts."}`,
      action: { kind: "plan_gap", label: "Let the agent cover this week", payload: { days: weekdaysAhead() } },
      secondary: allNoIdeas ? { kind: "open_ideas", label: "Add ideas" } : undefined,
    });
  }
  if (opts.accountCount === 0) {
    out.push({
      id: "connect",
      tone: "warning",
      title: "No social accounts connected",
      detail: "Connect LinkedIn, Instagram, Facebook, X or TikTok to start scheduling.",
      action: { kind: "connect", label: "Connect accounts" },
    });
  }
  if (opts.failedRecent.length) {
    const reasons = [...new Set(opts.failedRecent.map((p) => p.error).filter(Boolean))].slice(0, 2);
    out.push({
      id: "failed",
      tone: "danger",
      title: `${opts.failedRecent.length} post${opts.failedRecent.length > 1 ? "s" : ""} failed in the last 2 weeks`,
      detail: reasons.length ? reasons.map((r) => shortError(r!)).join(" · ") : undefined,
      action: { kind: "review_failed", label: "Review failures" },
    });
  }
  const proposals = opts.draftsAhead.filter((p) => p.origin === "agent");
  const drafts = opts.draftsAhead.filter((p) => p.origin !== "agent");
  if (proposals.length) {
    out.push({
      id: "proposals",
      tone: "info",
      title: `${proposals.length} agent proposal${proposals.length > 1 ? "s" : ""} waiting for you`,
      detail: "Nothing goes out until you approve it.",
      action: { kind: "approve_drafts", label: "Review proposals" },
    });
  }
  if (drafts.length) {
    out.push({
      id: "drafts",
      tone: "info",
      title: `${drafts.length} draft${drafts.length > 1 ? "s" : ""} not scheduled yet`,
      detail: "Drafts sit on the calendar but never publish on their own.",
    });
  }
  // Empty weekdays in the next 7 days of the visible range: consistency is a
  // weekly habit, and a month of gaps is a nag, not a nudge.
  const upcoming = opts.posts.filter((p) => p.status !== "failed");
  const emptyDays: Date[] = [];
  const gapEnd = new Date(Math.min(opts.rangeEnd.getTime(), addDays(startOfDay(now), 7).getTime()));
  for (let d = startOfDay(now > opts.rangeStart ? now : opts.rangeStart); d <= gapEnd; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const healthyRun = (opts.projections ?? []).some((pr) => !pr.stalled && isSameDay(pr.at, d));
    if (!upcoming.some((p) => isSameDay(p.at, d)) && !healthyRun) emptyDays.push(d);
  }
  // The stuck-autopilot alert already offers to cover the week; one offer is enough.
  if (emptyDays.length && opts.accountCount > 0 && !opts.stalled?.length) {
    const names = emptyDays.slice(0, 4).map((d) => format(d, "EEE d"));
    out.push({
      id: "gaps",
      tone: "warning",
      title: `${emptyDays.length} empty weekday${emptyDays.length > 1 ? "s" : ""} in the next 7 days`,
      detail: `${names.join(", ")}${emptyDays.length > 4 ? "…" : ""}. Consistency beats volume.`,
      action: {
        kind: "plan_gap",
        label: "Let the agent fill them",
        payload: { days: emptyDays.map((d) => format(d, "yyyy-MM-dd")) },
      },
    });
  }
  // Clumps: 3+ posts within 3 hours on the same platform.
  const byPlatform = new Map<string, Date[]>();
  for (const p of upcoming.filter((p) => p.at > now)) for (const pl of p.platforms) byPlatform.set(pl, [...(byPlatform.get(pl) ?? []), p.at]);
  for (const [pl, times] of byPlatform) {
    const sorted = times.sort((a, b) => a.getTime() - b.getTime());
    for (let i = 0; i + 2 < sorted.length; i++) {
      if (sorted[i + 2].getTime() - sorted[i].getTime() <= 3 * 3600_000) {
        out.push({
          id: `clump-${pl}`,
          tone: "warning",
          title: `${ruleFor(pl).label} posts are bunched up`,
          detail: `3 posts within 3 hours on ${format(sorted[i], "EEE d")}. Spread them so each gets its own reach.`,
        });
        break;
      }
    }
  }
  if (!out.length) {
    out.push({ id: "ok", tone: "success", title: "You're all set", detail: "Every weekday has a post and nothing needs attention." });
  }
  return out;
}

/** Upstream errors are long and technical; keep the part a person can act on. */
export function shortError(error: string): string {
  const e = error.replace(/^(Push to GHL failed|Publish to \w+ failed):\s*/i, "");
  if (/multi media formats/i.test(e)) return "TikTok takes one video or one picture, not several";
  if (/needs? a video|requires? a video/i.test(e)) return "Needs a video";
  if (/requires a Pro plan/i.test(e)) return "Publishing needs a Pro plan";
  if (/Location is not active/i.test(e)) return "LeadConnector location is inactive. Reconnect it in Settings";
  if (/402|credits/i.test(e)) return "Out of API credits";
  if (/token|unauthori[sz]ed|401|403|auth failed|credentials|reconnect/i.test(e)) return "Account needs reconnecting";
  if (/non-2xx/i.test(e)) return "The channel rejected the post";
  if (/media|image/i.test(e) && /required|missing/i.test(e)) return "Needs a picture or video";
  return e.length > 90 ? `${e.slice(0, 87)}…` : e;
}

// ---------------------------------------------------------------------------
// Validation (composer)
// ---------------------------------------------------------------------------

/** "error" blocks scheduling, "warning" may fail or look wrong, "info" says how it will post. */
export interface ComposerIssue { platform: string; level: "error" | "warning" | "info"; message: string }

/** Measured on upload or read from the file in the browser. */
export interface MediaMeta { width?: number; height?: number; duration?: number; bytes?: number }

export type PostFormat = "feed" | "story";

/** Platforms where "Story" is a real format through our publisher. */
export function supportsStory(platform: string): boolean {
  return !!ruleFor(platform).stories;
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
}

function ratioLabel(r: number): string {
  const known: Array<[number, string]> = [[9 / 16, "9:16"], [4 / 5, "4:5"], [1, "1:1"], [4 / 3, "4:3"], [1.91, "1.91:1"], [16 / 9, "16:9"], [2 / 3, "2:3"], [3 / 4, "3:4"]];
  const hit = known.find(([v]) => Math.abs(v - r) < 0.02);
  return hit ? hit[1] : `${r.toFixed(2)}:1`;
}

export function validatePost(opts: {
  platforms: string[];
  captions: Record<string, string>;
  media: Media;
  meta?: Record<string, MediaMeta>;
  format?: PostFormat;
  firstComment?: string;
  /** How the selected LinkedIn accounts publish: GHL, native (Unipile), or a mix. */
  linkedinRoute?: "ghl" | "native" | "both";
}): ComposerIssue[] {
  const issues: ComposerIssue[] = [];
  const { media } = opts;
  const meta = opts.meta ?? {};
  const images = media.images;
  const video = media.video;
  const hasMedia = images.length > 0 || !!video;
  const videoMeta = video ? meta[video] : undefined;
  const story = opts.format === "story";

  for (const p of opts.platforms) {
    const rule = ruleFor(p);
    const name = rule.label;
    const text = opts.captions[p] ?? "";
    const add = (level: ComposerIssue["level"], message: string) => issues.push({ platform: p, level, message });
    const asStory = story && !!rule.stories;

    // Text
    if (!text.trim() && !hasMedia) add("error", `${name}: write something or add a picture or video`);
    const length = captionLength(p, text);
    if (length > rule.limit) add("error", `${name}: ${(length - rule.limit).toLocaleString()} characters over the ${rule.limit.toLocaleString()} limit`);
    if (rule.maxHashtags && countHashtags(text) > rule.maxHashtags) add("error", `${name} allows at most ${rule.maxHashtags} hashtags (this has ${countHashtags(text)})`);
    if (rule.maxMentions && countMentions(text) > rule.maxMentions) add("warning", `${name} allows at most ${rule.maxMentions} @mentions`);
    if (normPlatform(p) === "google" && hasPhoneNumber(text)) add("warning", "Google Business rejects posts with a phone number in the text. Use the Call button on your profile instead.");

    // Media presence and count
    if (rule.needsMedia && !hasMedia) add("error", `${name} needs a picture or video`);
    if (images.length > 1 && !rule.multiImage) {
      if (normPlatform(p) === "tiktok") add("error", "TikTok takes one video or one picture. Several pictures fail.");
      else add("warning", `${name} posts one picture. Only the first goes out.`);
    } else if (images.length > rule.maxImages) {
      add(normPlatform(p) === "twitter" ? "warning" : "error", `${name} takes up to ${rule.maxImages} pictures (this has ${images.length})${normPlatform(p) === "twitter" ? ". Only the first 4 go out." : ""}`);
    }

    // Video length and size
    if (video && rule.video && videoMeta?.duration) {
      const d = videoMeta.duration;
      if (d > rule.video.max || d < rule.video.min) {
        const window = `${fmtDuration(rule.video.min)} to ${fmtDuration(rule.video.max)}`;
        add(rule.video.strict ? "error" : "warning", `${name} takes videos from ${window}; this one is ${fmtDuration(d)}`);
      }
      if (asStory && d > 60) add("warning", `${name} Stories cut videos at 60 s`);
    }
    if (video && rule.maxVideoMB && videoMeta?.bytes && videoMeta.bytes > rule.maxVideoMB * 1024 * 1024) {
      add("error", `${name} takes videos up to ${rule.maxVideoMB.toLocaleString()} MB`);
    }

    // Native LinkedIn sends media inline, so one post's media is capped.
    if (normPlatform(p) === "linkedin" && (opts.linkedinRoute === "native" || opts.linkedinRoute === "both")) {
      const known = [...images, ...(video ? [video] : [])].map((u) => meta[u]?.bytes ?? 0);
      const total = known.reduce((a, b) => a + b, 0);
      if (total > NATIVE_LINKEDIN_MAX_MB * 1024 * 1024) add("error", `Native LinkedIn takes up to ${NATIVE_LINKEDIN_MAX_MB} MB of media per post (this is ${(total / 1024 / 1024).toFixed(0)} MB)`);
    }

    // Picture shape and size
    for (const url of images.slice(0, rule.multiImage ? rule.maxImages : 1)) {
      const m = meta[url];
      if (!m) continue;
      if (rule.maxImageMB && m.bytes && m.bytes > rule.maxImageMB * 1024 * 1024) {
        add("warning", `${name} takes pictures up to ${rule.maxImageMB} MB; one is ${(m.bytes / 1024 / 1024).toFixed(1)} MB`);
        break;
      }
      if (rule.imageRatio && !asStory && m.width && m.height) {
        const r = m.width / m.height;
        if (r < rule.imageRatio.min - 0.01 || r > rule.imageRatio.max + 0.01) {
          add("warning", `${name} feed takes pictures from 4:5 to 1.91:1; this one is ${ratioLabel(r)} and may be rejected or cropped`);
          break;
        }
      }
    }
    if (video && videoMeta?.width && videoMeta.height && ["tiktok", "youtube"].includes(normPlatform(p)) && videoMeta.width > videoMeta.height) {
      add("warning", `${name} is vertical: a landscape video shows with bars. 9:16 fills the screen.`);
    }

    // How it will actually post
    if (asStory) {
      add("info", `${name}: posts as a Story. Stories don't show the caption.`);
    } else if (video) {
      const n = normPlatform(p);
      if (n === "instagram" || n === "facebook") add("info", `${name}: the video posts as a Reel`);
      if (n === "youtube") add("info", "YouTube: the video posts as a Short");
      if (n === "instagram" && videoMeta?.width && videoMeta.height && videoMeta.width >= videoMeta.height) {
        add("warning", "Instagram Reels are vertical: 9:16 fills the screen, landscape shows with bars.");
      }
    } else if (images.length > 1) {
      const n = normPlatform(p);
      if (n === "linkedin") {
        const route = opts.linkedinRoute ?? "ghl";
        if (route !== "native") add("info", `LinkedIn${route === "both" ? " (GHL accounts)" : ""}: several pictures post as a swipeable PDF carousel`);
        if (route !== "ghl") add("info", `LinkedIn${route === "both" ? " (native accounts)" : ""}: several pictures post as a multi-image post`);
      }
      if (n === "instagram" || n === "facebook") add("info", `${name}: posts as a carousel`);
    } else if (images.length === 1 && normPlatform(p) === "tiktok") {
      add("info", "TikTok: the picture posts as a photo post");
    }
    if (story && !rule.stories && hasMedia) add("info", `${name} has no Stories: posts as a normal post`);
  }

  if (opts.firstComment?.trim()) {
    const without = opts.platforms.filter((p) => !ruleFor(p).firstComment).map((p) => ruleFor(p).label);
    if (without.length) issues.push({ platform: "", level: "info", message: `First comment goes to LinkedIn, Facebook and Instagram only, not ${without.join(", ")}` });
    if (opts.platforms.some((p) => normPlatform(p) === "linkedin") && opts.firstComment.length > 1250) {
      issues.push({ platform: "linkedin", level: "warning", message: "LinkedIn comments are capped at 1,250 characters" });
    }
  }
  return issues;
}

/** Width, height, duration of a picture or video URL, read by the browser. */
export function probeMedia(url: string, kind: "image" | "video"): Promise<MediaMeta> {
  return new Promise((resolve) => {
    const done = (m: MediaMeta) => resolve(m);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
      return;
    }
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration: Number.isFinite(v.duration) ? v.duration : undefined });
    v.onerror = () => done({});
    v.src = url;
  });
}
