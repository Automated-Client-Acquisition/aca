/**
 * Zernio (zernio.com, formerly Late): a unified posting API. Each organization brings its own
 * Zernio API key (api_keys.provider = 'zernio') and connects its social accounts in Zernio;
 * those accounts become Scheduler destinations "zernio:<Zernio account _id>".
 *
 * API: https://zernio.com/api/v1, Bearer sk_… key. Publishing is one POST /v1/posts with
 * publishNow, keyed by an Idempotency-Key so a retried queue row never posts twice.
 */

export const ZERNIO_API = 'https://zernio.com/api/v1';
const DESTINATION_PREFIX = 'zernio:';

/** ACA platform name → Zernio platform name, for every platform the Scheduler posts to. */
const TO_ZERNIO: Record<string, string> = {
  facebook: 'facebook',
  instagram: 'instagram',
  tiktok: 'tiktok',
  youtube: 'youtube',
  linkedin: 'linkedin',
  twitter: 'twitter',
  threads: 'threads',
  pinterest: 'pinterest',
  bluesky: 'bluesky',
  google: 'googlebusiness',
};
const FROM_ZERNIO: Record<string, string> = Object.fromEntries(Object.entries(TO_ZERNIO).map(([aca, z]) => [z, aca]));

export function toZernioPlatform(platform: string | null | undefined): string | null {
  const p = String(platform || '').toLowerCase();
  return TO_ZERNIO[p === 'x' ? 'twitter' : p] ?? null;
}

/** The ACA platform for a Zernio account, or null for accounts the Scheduler can't post to (ads, messaging…). */
export function fromZernioPlatform(platform: string | null | undefined): string | null {
  return FROM_ZERNIO[String(platform || '').toLowerCase()] ?? null;
}

export function createZernioDestination(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw new Error('Invalid Zernio account id');
  return `${DESTINATION_PREFIX}${accountId}`;
}

export function parseZernioDestination(destination: string | null | undefined): string | null {
  if (typeof destination !== 'string' || !destination.startsWith(DESTINATION_PREFIX)) return null;
  const id = destination.slice(DESTINATION_PREFIX.length);
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

export class ZernioError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean, readonly code?: string) {
    super(message);
    this.name = 'ZernioError';
  }
}

type Fetch = typeof fetch;

async function zernioFetch(apiKey: string, path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<{ status: number; body: any }> {
  let res: Response;
  try {
    res = await fetchImpl(`${ZERNIO_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw new ZernioError(`Zernio could not be reached: ${err instanceof Error ? err.message : 'network error'}`, 0, true);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 300) }; }
  if (res.status === 401) throw new ZernioError('Zernio rejected the API key. Update it in Settings › API keys.', 401, false, body?.code);
  if (res.status === 403) throw new ZernioError(body?.error || 'Zernio refused the request for this account', 403, false, body?.code);
  if (res.status === 409) throw new ZernioError('Zernio already published or scheduled this exact post on this account in the last 24 hours', 409, false, body?.code);
  if (res.status === 429) throw new ZernioError(body?.error || 'Zernio rate limit reached', 429, true, body?.code);
  if (res.status >= 500) throw new ZernioError(body?.error || `Zernio error ${res.status}`, res.status, true, body?.code);
  if (res.status >= 400) throw new ZernioError(body?.error || body?.message || `Zernio rejected the request (${res.status})`, res.status, false, body?.code);
  return { status: res.status, body };
}

/** Platforms a person can connect from ACA through Zernio's hosted sign-in (Bluesky needs an app password, not OAuth). */
export const ZERNIO_CONNECT_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'google', 'threads', 'pinterest', 'linkedin', 'twitter'];

/**
 * The organization's Zernio profile (one per organization, found by externalId = organization id),
 * created on first use. The Idempotency-Key makes a retried create return the same profile.
 */
export async function ensureZernioProfile(apiKey: string, organizationId: string, name: string, fetchImpl: Fetch = fetch): Promise<string> {
  const { body } = await zernioFetch(apiKey, `/profiles?externalId=${encodeURIComponent(organizationId)}&includeOverLimit=true`, {}, fetchImpl);
  const existing = (Array.isArray(body?.profiles) ? body.profiles : []).find((p: any) => p?.externalId === organizationId && typeof p._id === 'string');
  if (existing) return existing._id;
  try {
    const { body: created } = await zernioFetch(apiKey, '/profiles', {
      method: 'POST',
      headers: { 'Idempotency-Key': `aca-profile-${organizationId}` },
      // Profile names are unique per Zernio team: suffix the org id so two orgs sharing a
      // parent's key can't collide on the same display name.
      body: JSON.stringify({ name: `${name.slice(0, 60)} (${organizationId.slice(0, 8)})`, externalId: organizationId }),
    }, fetchImpl);
    if (typeof created?.profile?._id === 'string') return created.profile._id;
  } catch (err) {
    // A concurrent create won the race: read it back by externalId.
    if (!(err instanceof ZernioError && err.status === 409)) throw err;
  }
  const { body: again } = await zernioFetch(apiKey, `/profiles?externalId=${encodeURIComponent(organizationId)}&includeOverLimit=true`, {}, fetchImpl);
  const found = (Array.isArray(again?.profiles) ? again.profiles : []).find((p: any) => p?.externalId === organizationId);
  if (!found?._id) throw new ZernioError('Could not create a Zernio profile for this organization', 502, true);
  return found._id;
}

/** Zernio's hosted sign-in link for one platform; Zernio sends the browser back to `redirectUrl`. */
export async function getZernioConnectUrl(apiKey: string, profileId: string, acaPlatform: string, redirectUrl: string, fetchImpl: Fetch = fetch): Promise<string> {
  const platform = toZernioPlatform(acaPlatform);
  if (!platform || !ZERNIO_CONNECT_PLATFORMS.includes(acaPlatform)) throw new ZernioError(`Connecting ${acaPlatform} isn't supported`, 400, false);
  const query = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const { body } = await zernioFetch(apiKey, `/connect/${platform}?${query}`, {}, fetchImpl);
  if (typeof body?.authUrl !== 'string' || !/^https:\/\//.test(body.authUrl)) throw new ZernioError('Zernio returned no sign-in link', 502, true);
  return body.authUrl;
}

export interface ZernioAccount {
  id: string;
  platform: string;
  name: string;
  username?: string;
  avatar_url?: string;
}

export interface ZernioSkipped {
  platform: string;
  name: string;
  reason: 'unsupported_platform' | 'needs_reconnection' | 'inactive' | 'not_enabled';
}

/**
 * Accounts the Scheduler can post to (in ACA platform names), plus every account it left out and
 * why, so "my account doesn't show up" has an answer. Asks for every account, over-limit profiles
 * included, and filters here instead of with Zernio's status/excludeHidden query params.
 */
export async function listZernioAccounts(apiKey: string, fetchImpl: Fetch = fetch): Promise<{ accounts: ZernioAccount[]; skipped: ZernioSkipped[]; total: number }> {
  const { body } = await zernioFetch(apiKey, '/accounts?includeOverLimit=true', {}, fetchImpl);
  const all: any[] = Array.isArray(body?.accounts) ? body.accounts : [];
  const accounts: ZernioAccount[] = [];
  const skipped: ZernioSkipped[] = [];
  for (const a of all) {
    if (typeof a?._id !== 'string') continue;
    const username = typeof a.username === 'string' && a.username ? a.username : undefined;
    const platform = fromZernioPlatform(a.platform);
    const name = (typeof a.displayName === 'string' && a.displayName) || username || `${platform || a.platform || 'Unknown'} account`;
    const reason: ZernioSkipped['reason'] | null = !platform ? 'unsupported_platform'
      : a.needsReconnection === true ? 'needs_reconnection'
      : a.isActive === false ? 'inactive'
      : a.enabled === false ? 'not_enabled'
      : null;
    if (reason) {
      skipped.push({ platform: platform || String(a.platform || 'unknown'), name, reason });
      continue;
    }
    accounts.push({
      id: a._id,
      platform: platform!,
      name,
      ...(username ? { username } : {}),
      ...(typeof a.profilePicture === 'string' && a.profilePicture ? { avatar_url: a.profilePicture } : {}),
    });
  }
  return { accounts, skipped, total: all.length };
}

/** What process-publish-queue hands a publisher: the row's caption and media. */
export interface ZernioContent {
  caption?: string;
  images?: string[];
  videoUrl?: string;
  postType?: string;
  followUpComment?: string;
}

/** The POST /v1/posts body for one queue row on one account. */
export function buildZernioPost(
  acaPlatform: string,
  accountId: string,
  content: ZernioContent,
  metadata: Record<string, string> = {},
): Record<string, unknown> {
  const platform = toZernioPlatform(acaPlatform);
  if (!platform) throw new ZernioError(`Zernio can't publish to ${acaPlatform}`, 400, false);
  const caption = (content.caption || '').trim();
  const images = (content.images || []).filter((u) => typeof u === 'string' && /^https:\/\//.test(u));
  const video = typeof content.videoUrl === 'string' && /^https:\/\//.test(content.videoUrl) ? content.videoUrl : null;
  const mediaItems = video ? [{ type: 'video', url: video }] : images.map((url) => ({ type: 'image', url }));
  if (!caption && mediaItems.length === 0) throw new ZernioError('The post has no text and no media', 400, false);

  const isStory = content.postType === 'story';
  const firstComment = !isStory && content.followUpComment?.trim() ? content.followUpComment.trim().slice(0, 500) : undefined;
  const firstLine = caption.split('\n').find((l) => l.trim())?.trim().slice(0, 100);
  let specific: Record<string, unknown> | undefined;
  switch (platform) {
    case 'instagram':
      specific = { ...(isStory ? { contentType: 'story' } : {}), ...(firstComment ? { firstComment } : {}) };
      break;
    case 'facebook':
      specific = {
        ...(isStory ? { contentType: 'story' } : video && content.postType === 'reel' ? { contentType: 'reel' } : {}),
        ...(firstComment ? { firstComment } : {}),
      };
      break;
    case 'linkedin':
    case 'threads':
      specific = firstComment ? { firstComment } : undefined;
      break;
    case 'youtube':
      specific = { ...(firstLine ? { title: firstLine } : {}), ...(firstComment ? { firstComment } : {}) };
      break;
    case 'pinterest':
      specific = firstLine ? { title: firstLine } : undefined;
      break;
    case 'tiktok':
      // TikTok wants the creator's consent and settings on every post; the person approved
      // this post in the Scheduler, and Zernio checks privacyLevel against the account.
      specific = {
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        allowComment: true,
        ...(video ? { allowDuet: true, allowStitch: true } : {}),
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
        ...(!video && caption.length > 90 ? { description: caption.slice(0, 4000) } : {}),
      };
      break;
  }
  const target: Record<string, unknown> = { platform, accountId };
  if (specific && Object.keys(specific).length) target.platformSpecificData = specific;
  return {
    content: caption,
    ...(mediaItems.length ? { mediaItems } : {}),
    platforms: [target],
    publishNow: true,
    metadata: { source: 'aca', ...metadata },
  };
}

export type ZernioOutcome =
  | { state: 'published'; postId: string; platformPostId?: string; url?: string }
  | { state: 'pending'; postId: string }
  | { state: 'failed'; postId?: string; error: string; retryable: boolean };

const RETRYABLE_CATEGORIES = new Set(['platform_error', 'platform_rate_limit', 'system_error']);

/** One account's verdict from a create or get-post response (201 and 207 are both 2xx). */
export function readZernioOutcome(body: any, accountId: string): ZernioOutcome {
  const post = body?.post ?? body;
  const postId = typeof post?._id === 'string' ? post._id : undefined;
  const entries: any[] = Array.isArray(post?.platforms) ? post.platforms : [];
  const entry = entries.find((p) => (typeof p?.accountId === 'string' ? p.accountId : p?.accountId?._id) === accountId) ?? entries[0];
  const status = String(entry?.status || post?.status || '').toLowerCase();
  if (status === 'published') {
    return { state: 'published', postId: postId || '', platformPostId: entry?.platformPostId || undefined, url: entry?.platformPostUrl || undefined };
  }
  if (status === 'failed' || status === 'cancelled' || status === 'partial') {
    const category = String(entry?.errorCategory || '');
    return {
      state: 'failed',
      postId,
      error: entry?.errorMessage || body?.message || `Zernio marked the post ${status}`,
      retryable: RETRYABLE_CATEGORIES.has(category),
    };
  }
  if (!postId) return { state: 'failed', error: body?.message || 'Zernio returned no post', retryable: true };
  return { state: 'pending', postId };
}

/**
 * Publishes now and waits briefly for a verdict: videos (Reels, TikTok, YouTube) can still be
 * processing when the create call returns. Still pending after the wait → 'pending'.
 */
export async function publishToZernio(
  apiKey: string,
  payload: Record<string, unknown>,
  accountId: string,
  idempotencyKey: string,
  opts: { fetchImpl?: Fetch; waitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ZernioOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const { body } = await zernioFetch(apiKey, '/posts', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(payload),
  }, fetchImpl);
  let outcome = readZernioOutcome(body, accountId);
  const deadline = Date.now() + (opts.waitMs ?? 45_000);
  while (outcome.state === 'pending' && Date.now() < deadline) {
    await sleep(opts.pollMs ?? 5_000);
    const { body: polled } = await zernioFetch(apiKey, `/posts/${encodeURIComponent(outcome.postId)}`, {}, fetchImpl);
    outcome = readZernioOutcome(polled, accountId);
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Post analytics (GET /v1/analytics). Included on Zernio's usage-based plans; legacy plans
// need the Analytics add-on, else 402 analytics_addon_required.
// ---------------------------------------------------------------------------

export interface ZernioPostStats {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  clicks: number;
  /** Zernio's rate: (likes + comments + shares + saves) / first non-zero of impressions, reach, views. */
  engagementRate: number | null;
  /** Platform-specific extras worth keeping (follows, profile views, Reels watch time…). */
  extra: Record<string, unknown>;
}

export type ZernioAnalyticsResult =
  | { state: 'synced' | 'pending'; stats: ZernioPostStats | null; postUrl: string | null; message: string | null }
  | { state: 'no_access' | 'unavailable' | 'error'; message: string };

const count = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(0, Math.round(Number(v))) : 0);
const EXTRA_KEYS = ['follows', 'profileViews', 'reposts', 'igReelsAvgWatchTime', 'reelsSkipRate', 'completionRate', 'videoDurationSeconds', 'lastUpdated'];

/** One account's numbers out of a single-post analytics response (a cross-post lists one entry per account). */
export function readZernioAnalytics(body: any, accountId: string, platformPostId?: string | null): {
  synced: boolean;
  stats: ZernioPostStats | null;
  postUrl: string | null;
  message: string | null;
} {
  const entries: any[] = Array.isArray(body?.platformAnalytics) ? body.platformAnalytics : [];
  const entry =
    entries.find((e) => e?.accountId === accountId) ??
    (platformPostId ? entries.find((e) => e?.platformPostId === platformPostId) : undefined) ??
    (entries.length === 1 ? entries[0] : undefined);
  const a = entry?.analytics ?? body?.analytics;
  const sync = String(entry?.syncStatus ?? body?.syncStatus ?? '').toLowerCase();
  let stats: ZernioPostStats | null = null;
  if (a && typeof a === 'object') {
    const extra: Record<string, unknown> = {};
    for (const k of EXTRA_KEYS) if (a[k] !== undefined && a[k] !== null && a[k] !== 0) extra[k] = a[k];
    const rate = Number(a.engagementRate);
    stats = {
      impressions: count(a.impressions),
      reach: count(a.reach),
      likes: count(a.likes),
      comments: count(a.comments),
      shares: count(a.shares),
      saves: count(a.saves),
      views: count(a.views),
      clicks: count(a.clicks),
      engagementRate: Number.isFinite(rate) ? Math.round(rate * 100) / 100 : null,
      extra,
    };
  }
  return {
    synced: sync === 'synced' || (sync === '' && !!stats),
    stats,
    postUrl: entry?.platformPostUrl ?? body?.platformPostUrl ?? null,
    message: entry?.errorMessage ?? body?.message ?? null,
  };
}

/**
 * Stats for one published post on one account. `postId` may be Zernio's post id or the
 * platform's own id (Zernio resolves either). Rate limits and Zernio outages throw a
 * retryable ZernioError so the caller can stop and try again on its next run.
 */
export async function fetchZernioPostAnalytics(
  apiKey: string,
  postId: string,
  accountId: string,
  fetchImpl: Fetch = fetch,
): Promise<ZernioAnalyticsResult> {
  const query = new URLSearchParams({ postId, accountId });
  try {
    const { status, body } = await zernioFetch(apiKey, `/analytics?${query}`, { signal: AbortSignal.timeout(25_000) }, fetchImpl);
    const read = readZernioAnalytics(body, accountId, postId);
    return { state: status === 202 || !read.synced ? 'pending' : 'synced', stats: read.stats, postUrl: read.postUrl, message: read.message };
  } catch (error) {
    if (!(error instanceof ZernioError) || error.retryable) throw error;
    if (error.status === 402) return { state: 'no_access', message: 'Your Zernio plan does not include analytics. Turn on Analytics in Zernio to see post stats.' };
    if (error.status === 404 || error.status === 424) return { state: 'unavailable', message: error.message };
    return { state: 'error', message: error.message };
  }
}

/**
 * Zernio's own id for a post ACA published, found by listing the account's posts around the
 * publish time: ACA tags every post with its queue row id (metadata.aca_queue_id), and the
 * platform post id is a fallback match. Analytics look-ups by the platform's id can 404 until
 * Zernio has synced the account; by Zernio's id they work from the start. Null when not found.
 */
export async function findZernioPostId(
  apiKey: string,
  match: { accountId: string; queueId: string; platformPostId?: string | null; publishedAt: Date },
  fetchImpl: Fetch = fetch,
): Promise<string | null> {
  const day = 86400_000;
  const query = new URLSearchParams({
    accountId: match.accountId,
    fromDate: new Date(match.publishedAt.getTime() - 2 * day).toISOString(),
    toDate: new Date(match.publishedAt.getTime() + 2 * day).toISOString(),
    fields: 'platforms,metadata',
    limit: '100',
  });
  try {
    const { body } = await zernioFetch(apiKey, `/posts?${query}`, { signal: AbortSignal.timeout(25_000) }, fetchImpl);
    const posts: any[] = Array.isArray(body?.posts) ? body.posts : [];
    const found =
      posts.find((p) => p?.metadata?.aca_queue_id === match.queueId) ??
      (match.platformPostId ? posts.find((p) => (p?.platforms ?? []).some((pl: any) => pl?.platformPostId === match.platformPostId)) : undefined);
    return typeof found?._id === 'string' ? found._id : null;
  } catch (error) {
    if (error instanceof ZernioError && !error.retryable) return null;
    throw error;
  }
}
