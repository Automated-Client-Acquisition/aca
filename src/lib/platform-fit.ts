/**
 * Frontend mirror of supabase/functions/_shared/platform-fit.ts: which accounts
 * can take which kind of piece. approve-stage skips the rest; the editor warns.
 * Keep the two in sync.
 */

export type MediaKind = "text" | "image" | "video" | "article";

const VIDEO_PIPELINES = new Set([
  "video",
  "presenter_video",
  "video_remix",
  "generative_video_oneshot",
  "ugc_video",
  "ugc_heygen",
  "ugc_heygen_template",
  "storyboard_video_longform",
]);
const IMAGE_PIPELINES = new Set(["social_media_post", "instagram_carousel", "instagram_carousel_ai", "image_only"]);

export function mediaKindForPipeline(pipeline: string | null | undefined, opts: { skipImage?: boolean } = {}): MediaKind {
  const p = String(pipeline || "");
  if (p === "rich_article") return "article";
  if (VIDEO_PIPELINES.has(p)) return "video";
  if (p === "social_media_post" && opts.skipImage) return "text";
  if (IMAGE_PIPELINES.has(p)) return "image";
  return "text";
}

const NEEDS: Record<string, { accepts: MediaKind[]; needs: string }> = {
  instagram: { accepts: ["image", "video"], needs: "a picture or video" },
  // Only rules prod outcomes back up: GHL posts a single picture to TikTok as a photo
  // post (328 published) and to YouTube (60 published), so those need no video.
  tiktok: { accepts: ["image", "video"], needs: "a picture or video" },
};

const LABELS: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok" };

/**
 * Why an account can't take this kind of piece, or null when it can. Articles
 * only go to WordPress sites, and WordPress only takes articles.
 */
export function skipReason(platform: string | null | undefined, kind: MediaKind): string | null {
  const key = String(platform || "").toLowerCase();
  if (key === "wordpress") return kind === "article" ? null : "WordPress sites only take articles";
  if (kind === "article") return "Articles only publish to a WordPress site";
  const rule = NEEDS[key];
  if (!rule || rule.accepts.includes(kind)) return null;
  return `${LABELS[key] ?? key} needs ${rule.needs}`;
}

export function platformAccepts(platform: string | null | undefined, kind: MediaKind): boolean {
  return skipReason(platform, kind) === null;
}

export function platformNeeds(platform: string | null | undefined): string | null {
  const key = String(platform || "").toLowerCase();
  const rule = NEEDS[key];
  return rule ? `${LABELS[key] ?? key} needs ${rule.needs}` : null;
}

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = { text: "text only", image: "pictures", video: "videos", article: "articles" };
