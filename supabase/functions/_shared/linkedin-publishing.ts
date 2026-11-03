import { Buffer } from 'node:buffer';
import type { UnipileClient } from './unipile-client.ts';
import { stageText } from './stage-text.ts';
import { splitFollowUpComment } from './follow-up-comment.ts';

export interface LinkedInPublishContent {
  caption: string;
  images?: string[];
  videoUrl?: string;
  followUpComment?: string;
}

export class LinkedInPublishValidationError extends Error {
  readonly status = 400;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }

/** Resolve saved edits before the original generated text. */
export function buildLinkedInContent(output: { data?: unknown; stage_data?: unknown; pipeline?: string }): LinkedInPublishContent {
  const data = record(output.data);
  const stages = record(output.stage_data);
  const final = record(stages.final);
  const image = record(stages.image);
  const video = record(stages.video);
  const composition = record(stages.composition);
  const videoPipeline = /video|heygen/.test(output.pipeline || '');
  let caption = videoPipeline
    ? stageText(stages.post_caption) || text(final.caption) || text(data.caption) || text(data.text) || text(data.title) ||
      stageText(stages.script) || stageText(stages.outline) || stageText(stages.variables)
    : stageText(stages.caption) || text(final.caption) || text(data.caption) || text(data.text) || text(data.content) || text(data.title);
  if (output.pipeline === 'twitter_thread' && !caption) {
    const raw = stageText(stages.thread_tweets);
    try {
      const parsed: unknown = JSON.parse(raw);
      const tweets = Array.isArray(parsed) ? parsed : record(parsed).tweets;
      caption = Array.isArray(tweets) ? text(record(tweets[0]).text) : raw;
    } catch { caption = raw; }
  }
  const videoUrl = image.media_type === 'video'
    ? text(image.video_url) || text(image.url)
    : text(composition.video_url) || text(composition.url) || text(video.video_url) || text(video.url) ||
      text(final.video_url) || (videoPipeline ? text(final.url) : '') || text(data.videoUrl) || text(data.video_url);
  const slides = record(stages.carousel_slides).slides;
  const images = Array.isArray(slides) ? slides.map((slide) => text(record(slide).image_url)).filter(Boolean)
    : Array.isArray(data.images) ? data.images.map((item) => text(item) || text(record(item).url)).filter(Boolean)
    : [text(image.url) || text(image.image_url) || text(data.imageUrl) || text(data.image_url)].filter(Boolean);
  return normalizeLinkedInContent({ caption, ...(videoUrl ? { videoUrl } : { images }), followUpComment: text(data.followUpComment) || undefined });
}

export function normalizeLinkedInContent(value: unknown): LinkedInPublishContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LinkedInPublishValidationError('Invalid LinkedIn content');
  const input = value as Record<string, unknown>;
  if (typeof input.caption !== 'string') throw new LinkedInPublishValidationError('LinkedIn caption must be text');
  if (input.images !== undefined && (!Array.isArray(input.images) || input.images.some((url) => typeof url !== 'string'))) {
    throw new LinkedInPublishValidationError('LinkedIn images must be an array of URLs');
  }
  for (const key of ['videoUrl', 'followUpComment']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new LinkedInPublishValidationError(`Invalid ${key}`);
  }
  const split = splitFollowUpComment(input.caption);
  const videoUrl = (input.videoUrl as string | undefined) || undefined;
  // Video compositions also retain their storyboard images; the final video is the published asset.
  const images = videoUrl ? [] : (input.images as string[] | undefined) || [];
  const caption = split.caption.trim();
  const followUpComment = ((input.followUpComment as string | undefined) || split.followUpComment)?.trim();
  if (!caption && !images.length && !videoUrl) throw new LinkedInPublishValidationError('LinkedIn post needs text or media');
  if (caption.length > 3000) throw new LinkedInPublishValidationError('LinkedIn posts are limited to 3,000 characters');
  if (followUpComment && followUpComment.length > 1250) throw new LinkedInPublishValidationError('LinkedIn comments are limited to 1,250 characters');
  if (images.length > 20) throw new LinkedInPublishValidationError('LinkedIn posts support at most 20 images');
  for (const url of [...images, ...(videoUrl ? [videoUrl] : [])]) assertPublicMediaUrl(url);
  return { caption, images, ...(videoUrl ? { videoUrl } : {}), ...(followUpComment ? { followUpComment } : {}) };
}

export function isPublicMediaAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.includes(':')) {
    // Global IPv6 unicast only; IPv4-mapped, loopback and ULA/link-local addresses fail closed.
    let canonical: string;
    try { canonical = new URL(`http://[${host}]`).hostname.slice(1, -1); } catch { return false; }
    const [first, second] = canonical.split(':').map((part) => parseInt(part || '0', 16));
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff &&
      !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  const bytes = host.split('.').map(Number);
  if (bytes.length !== 4 || bytes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = bytes;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
}

export function assertPublicMediaUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new LinkedInPublishValidationError('Invalid media URL'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
    (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
    ((/^[\d.]+$/.test(host) || host.includes(':')) && !isPublicMediaAddress(host))) {
    throw new LinkedInPublishValidationError('Media must use a public HTTP(S) URL');
  }
  return url;
}

async function resolvePublicAddresses(host: string): Promise<string[]> {
  const results = await Promise.all(['A', 'AAAA'].map(async (type) => {
    const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new LinkedInPublishValidationError('Could not verify media host');
    const result = record(await response.json());
    if (result.Status !== 0) throw new LinkedInPublishValidationError('Could not verify media host');
    return (Array.isArray(result.Answer) ? result.Answer : []).map(record)
      .filter((answer) => answer.type === 1 || answer.type === 28).map((answer) => text(answer.data));
  }));
  return results.flat();
}

/** Reject private hosts and every redirect; stream with a hard size limit instead of unbounded blob(). */
export async function downloadLinkedInMedia(
  rawUrl: string,
  kind: 'image' | 'video',
  fetcher: typeof fetch = fetch,
  resolver: (host: string) => Promise<string[]> = resolvePublicAddresses,
): Promise<[string, Buffer]> {
  const url = assertPublicMediaUrl(rawUrl);
  const addresses = /^[\d.]+$/.test(url.hostname) ? [url.hostname] : await resolver(url.hostname);
  if (!addresses.length || addresses.some((ip) => !isPublicMediaAddress(ip))) throw new LinkedInPublishValidationError('Media host resolves to a private or reserved address');
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new LinkedInPublishValidationError('Could not download media (redirects are not supported)');
  }
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith(`${kind}/`) || mime === 'image/svg+xml') {
    await response.body?.cancel();
    throw new LinkedInPublishValidationError(`Expected ${kind} media`);
  }
  const limit = (kind === 'image' ? 10 : 100) * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new LinkedInPublishValidationError(`${kind} media is too large`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new LinkedInPublishValidationError('Empty media response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new LinkedInPublishValidationError(`${kind} media is too large`);
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel(); }
  if (!bytes) throw new LinkedInPublishValidationError('Empty media response');
  const ext = mime.split('/')[1].replace(/[^a-z0-9]/g, '') || (kind === 'image' ? 'jpg' : 'mp4');
  return [`${kind}.${ext}`, Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), bytes)];
}

export type PublishingClient = { users: Pick<UnipileClient['users'], 'createPost' | 'getPost' | 'sendPostComment'> };
export interface LinkedInPublishResult { post_id?: string; post_url?: string; warning?: string }

export async function publishLinkedInPost(
  client: PublishingClient,
  accountId: string,
  organizationId: string | undefined,
  content: LinkedInPublishContent,
  onPublished: (result: LinkedInPublishResult) => Promise<void>,
  download = downloadLinkedInMedia,
): Promise<LinkedInPublishResult> {
  const attachments: [string, Buffer][] = [];
  let totalBytes = 0;
  for (const url of content.images || []) {
    const attachment = await download(url, 'image');
    totalBytes += attachment[1].byteLength;
    if (totalBytes > 100 * 1024 * 1024) throw new LinkedInPublishValidationError('Combined image media is too large');
    attachments.push(attachment);
  }
  if (content.videoUrl) attachments.push(await download(content.videoUrl, 'video'));
  const options = organizationId ? { extra_params: { as_organization: organizationId } } : undefined;
  // SDK 1.x only forwards as_organization through extra_params, not the input object.
  const created = await client.users.createPost({ account_id: accountId, text: content.caption, ...(attachments.length ? { attachments } : {}) }, options) as unknown as Record<string, unknown>;
  const result: LinkedInPublishResult = {};
  const id = created.post_id || created.id;
  if (typeof id === 'string' && id) result.post_id = id;
  if (typeof created.url === 'string') result.post_url = created.url;
  const warnings: string[] = [];
  // Everything after primary success is best effort. A failed comment must never cause a retry of the post.
  try { await onPublished(result); } catch { warnings.push('Post published, but ACA could not save its publication record.'); }
  let socialId = typeof created.social_id === 'string' ? created.social_id : undefined;
  if (result.post_id) {
    try {
      const post = await client.users.getPost({ account_id: accountId, post_id: result.post_id }) as unknown as Record<string, unknown>;
      socialId = typeof post.social_id === 'string' ? post.social_id : socialId;
      const postUrl = post.share_url || post.url;
      if (typeof postUrl === 'string') result.post_url = postUrl;
    } catch { /* A failed optional lookup does not invalidate the successful publication. */ }
  }
  if (content.followUpComment) {
    if (!socialId) warnings.push('Post published, but its comment identifier was unavailable; add the first comment manually.');
    else {
      try {
        await client.users.sendPostComment({ account_id: accountId, post_id: socialId, text: content.followUpComment }, options);
      } catch { warnings.push('Post published, but the first comment failed; add it manually.'); }
    }
  }
  if (warnings.length) result.warning = warnings.join(' ');
  return result;
}
