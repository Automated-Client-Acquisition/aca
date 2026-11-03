/**
 * Which accounts can take which kind of piece. An autopilot posts every piece
 * to each of its accounts, so a text-only post bound for Instagram or TikTok,
 * or an article bound for LinkedIn, would be queued and then rejected (or post
 * raw HTML). approve-stage skips those accounts instead, and the editor warns
 * before it happens.
 *
 * Frontend mirror: src/lib/platform-fit.ts (keep the two in sync).
 */

export type MediaKind = 'text' | 'image' | 'video' | 'article';

const VIDEO_PIPELINES = new Set([
  'video',
  'presenter_video',
  'video_remix',
  'generative_video_oneshot',
  'ugc_video',
  'ugc_heygen',
  'ugc_heygen_template',
  'storyboard_video_longform',
]);
const IMAGE_PIPELINES = new Set(['social_media_post', 'instagram_carousel', 'instagram_carousel_ai', 'image_only']);

/** What a blueprint's pieces carry, before it runs. */
export function mediaKindForPipeline(pipeline: string | null | undefined, opts: { skipImage?: boolean } = {}): MediaKind {
  const p = String(pipeline || '');
  if (p === 'rich_article') return 'article';
  if (VIDEO_PIPELINES.has(p)) return 'video';
  if (p === 'social_media_post' && opts.skipImage) return 'text';
  if (IMAGE_PIPELINES.has(p)) return 'image';
  return 'text';
}

/** What a finished piece actually carries (a social post can come back with a saved video, or no image). */
export function mediaKindForOutput(output: { pipeline?: string | null; stage_data?: any }): MediaKind {
  const pipeline = String(output?.pipeline || '');
  const stage = output?.stage_data || {};
  if (pipeline === 'social_media_post') {
    if (stage.image?.media_type === 'video' && (stage.image?.video_url || stage.image?.url)) return 'video';
    return stage.image?.url || stage.image?.image_url ? 'image' : 'text';
  }
  return mediaKindForPipeline(pipeline);
}

/** Destination platform ids are lower case ("instagram", "tiktok", "google", "twitter"). */
const NEEDS: Record<string, { accepts: MediaKind[]; needs: string }> = {
  instagram: { accepts: ['image', 'video'], needs: 'a picture or video' },
  // Only rules prod outcomes back up: GHL posts a single picture to TikTok as a photo
  // post (328 published) and to YouTube (60 published), so those need no video.
  tiktok: { accepts: ['image', 'video'], needs: 'a picture or video' },
};

const LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

/**
 * Why an account can't take this kind of piece, or null when it can. Articles
 * only go to WordPress sites, and WordPress only takes articles.
 */
export function skipReason(platform: string | null | undefined, kind: MediaKind): string | null {
  const key = String(platform || '').toLowerCase();
  if (key === 'wordpress') return kind === 'article' ? null : 'WordPress sites only take articles';
  if (kind === 'article') return 'Articles only publish to a WordPress site';
  const rule = NEEDS[key];
  if (!rule || rule.accepts.includes(kind)) return null;
  return `${LABELS[key] ?? key} needs ${rule.needs}`;
}

export function platformAccepts(platform: string | null | undefined, kind: MediaKind): boolean {
  return skipReason(platform, kind) === null;
}

/** "Instagram needs a picture or video", or null when the platform takes anything. */
export function platformNeeds(platform: string | null | undefined): string | null {
  const key = String(platform || '').toLowerCase();
  const rule = NEEDS[key];
  return rule ? `${LABELS[key] ?? key} needs ${rule.needs}` : null;
}
