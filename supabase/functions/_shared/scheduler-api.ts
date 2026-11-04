/**
 * The Social Scheduler as an API: one implementation behind both MCP servers (mcp, mcp-v1)
 * and the REST resource /v1/scheduler (api-scheduler), so all three behave like the app.
 *
 * A post is a set of publish_queue rows, one per account, sharing a post_group_id; the
 * process-publish-queue cron publishes rows whose time has come. These functions mirror
 * the app's own actions (src/hooks/useScheduler.ts) and its platform rules
 * (src/lib/scheduler.ts: keep RULES and the checks below in sync with PLATFORM_RULES and
 * validatePost).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { APP_URL } from './site-config.ts';

export class SchedulerError extends Error {
  constructor(message: string, readonly status = 400, readonly details?: unknown) {
    super(message);
    this.name = 'SchedulerError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EDITABLE = ['draft', 'pending', 'failed'];
const MIN_GAP_MS = 90 * 60_000;
const DAY = 86400_000;

// ---------------------------------------------------------------------------
// Platform rules (what decides whether a post can go out)
// ---------------------------------------------------------------------------

interface Rule {
  label: string;
  limit: number;
  maxImages: number;
  multiImage: boolean;
  needsMedia?: boolean;
  maxHashtags?: number;
  firstComment: boolean;
  stories?: boolean;
}

const RULES: Record<string, Rule> = {
  linkedin: { label: 'LinkedIn', limit: 3000, maxImages: 20, multiImage: true, firstComment: true },
  twitter: { label: 'X', limit: 280, maxImages: 4, multiImage: true, firstComment: false },
  instagram: { label: 'Instagram', limit: 2200, maxImages: 10, multiImage: true, needsMedia: true, maxHashtags: 30, firstComment: true, stories: true },
  facebook: { label: 'Facebook', limit: 63206, maxImages: 10, multiImage: true, firstComment: true, stories: true },
  tiktok: { label: 'TikTok', limit: 2200, maxImages: 1, multiImage: false, needsMedia: true, firstComment: false },
  youtube: { label: 'YouTube', limit: 5000, maxImages: 1, multiImage: false, needsMedia: true, firstComment: false },
  google: { label: 'Google Business', limit: 1500, maxImages: 1, multiImage: false, firstComment: false },
  pinterest: { label: 'Pinterest', limit: 500, maxImages: 1, multiImage: false, needsMedia: true, firstComment: false },
  threads: { label: 'Threads', limit: 500, maxImages: 10, multiImage: true, firstComment: false },
  bluesky: { label: 'Bluesky', limit: 300, maxImages: 4, multiImage: true, firstComment: false },
};
const FALLBACK: Rule = { label: 'Social', limit: 2200, maxImages: 4, multiImage: true, firstComment: false };

export function normPlatform(platform: unknown): string {
  const p = String(platform || '').toLowerCase();
  if (p === 'x') return 'twitter';
  if (p === 'google_business' || p === 'gmb' || p === 'googlebusiness') return 'google';
  return p;
}
const ruleFor = (platform: unknown) => RULES[normPlatform(platform)] ?? FALLBACK;

const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|ai|app|dev|me|ly|gg|tv|xyz|info|biz|us|uk|fr|de|eu|ca|au)\b(?:\/[^\s]*)?/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const graphemes = (text: string) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);

/** Caption length as the platform counts it (X: links 23, emoji and CJK 2; Bluesky: graphemes). */
export function captionLength(platform: string, text: string): number {
  const p = normPlatform(platform);
  if (p === 'bluesky') return graphemes(text).length;
  if (p !== 'twitter') return text.length;
  let length = 0;
  let index = 0;
  const urls = [...text.matchAll(URL_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  let u = 0;
  for (const seg of graphemes(text)) {
    if (u < urls.length && index >= urls[u].start && index < urls[u].end) {
      if (index === urls[u].start) length += 23;
      if (index + seg.length >= urls[u].end) u++;
    } else if (EMOJI_RE.test(seg)) {
      length += 2;
    } else {
      let w = 0;
      for (const ch of seg) {
        const cp = ch.codePointAt(0) ?? 0;
        w += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2;
      }
      length += Math.min(w, 2);
    }
    index += seg.length;
  }
  return length;
}

const countHashtags = (text: string) => (text.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;

export interface PostIssue { platform: string; message: string }

/** What would make the post fail on a platform (the composer's red errors). */
export function checkPost(platforms: string[], captions: Record<string, string>, media: { images: string[]; video?: string | null }): PostIssue[] {
  const issues: PostIssue[] = [];
  const hasMedia = media.images.length > 0 || !!media.video;
  for (const p of platforms) {
    const rule = ruleFor(p);
    const text = captions[p] ?? '';
    const add = (message: string) => issues.push({ platform: p, message });
    if (!text.trim() && !hasMedia) add(`${rule.label}: write something or add a picture or video`);
    const length = captionLength(p, text);
    if (length > rule.limit) add(`${rule.label}: ${length - rule.limit} characters over the ${rule.limit} limit`);
    if (rule.maxHashtags && countHashtags(text) > rule.maxHashtags) add(`${rule.label} allows at most ${rule.maxHashtags} hashtags`);
    if (rule.needsMedia && !hasMedia) add(`${rule.label} needs a picture or video`);
    if (media.images.length > 1 && !rule.multiImage && normPlatform(p) === 'tiktok') add('TikTok takes one video or one picture. Several pictures fail.');
    else if (media.images.length > rule.maxImages && rule.multiImage && normPlatform(p) !== 'twitter') add(`${rule.label} takes up to ${rule.maxImages} pictures`);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Calling ACA's own functions (as the platform, on behalf of one organization)
// ---------------------------------------------------------------------------

async function callFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(150_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok && !data?.error) throw new SchedulerError(`${name} failed (${res.status})`, 502);
  return data;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface SchedulerAccount {
  id: string;
  platform: string;
  name: string;
  username: string | null;
  /** zernio: the org's own Zernio key · linkedin_native: Unipile · ghl: GHL Social Planner · x: ACA's X publisher */
  provider: 'zernio' | 'linkedin_native' | 'ghl' | 'x';
  kind: string | null;
  avatar_url: string | null;
  active: boolean;
}

const handleOf = (s: unknown) => String(s ?? '').trim().replace(/^@/, '').toLowerCase();

/**
 * Every account the org can post to, as the Scheduler offers them. A GHL copy of an account
 * also connected through Zernio is left out (posting to both would publish twice);
 * `replaced_by` maps such an id to the Zernio account that takes its place.
 */
export async function listSchedulerAccounts(supabase: SupabaseClient, orgId: string): Promise<{
  accounts: SchedulerAccount[];
  replaced_by: Record<string, string>;
  notes: string[];
}> {
  const notes: string[] = [];
  const [direct, ghl, x] = await Promise.all([
    callFunction('scheduler-destinations', { organization_id: orgId }).catch((e) => ({ success: false, error: String(e?.message ?? e) })),
    callFunction('fetch-ghl-accounts', { organizationId: orgId }).catch(() => null),
    supabase.from('twitter_accounts').select('id, name, twitter_handle, profile_image_url, is_active, is_valid').eq('organization_id', orgId),
  ]);

  const accounts: SchedulerAccount[] = [];
  for (const d of Array.isArray(direct?.destinations) ? direct.destinations : []) {
    accounts.push({
      id: d.id,
      platform: normPlatform(d.platform || 'linkedin'),
      name: d.name,
      username: d.username ?? null,
      provider: d.provider === 'zernio' ? 'zernio' : 'linkedin_native',
      kind: d.kind ?? null,
      avatar_url: d.avatar_url ?? null,
      active: true,
    });
  }
  if (direct && direct.success === false) notes.push(`Direct accounts could not be listed: ${direct.error}`);
  if (direct?.zernio && direct.zernio.key === false) notes.push('No Zernio API key: add one in Settings › API keys to post to Instagram, Facebook, TikTok and more without GHL.');

  for (const g of Array.isArray(ghl?.accounts) ? ghl.accounts : []) {
    accounts.push({
      id: g.id,
      platform: normPlatform(g.type || g.platform),
      name: g.name || g.displayName || 'GHL account',
      username: g.username ?? null,
      provider: 'ghl',
      kind: null,
      avatar_url: g.profileImage ?? null,
      active: g.isActive !== false,
    });
  }
  for (const t of x.data ?? []) {
    accounts.push({
      id: t.id,
      platform: 'twitter',
      name: t.name,
      username: t.twitter_handle ?? null,
      provider: 'x',
      kind: null,
      avatar_url: t.profile_image_url ?? null,
      active: t.is_active !== false && t.is_valid !== false,
    });
  }

  // Hide GHL twins of Zernio accounts (same channel, same handle or name).
  const keys = (a: SchedulerAccount) => [a.username, a.name].map(handleOf).filter(Boolean).map((h) => `${a.platform}:${h}`);
  const zernio = new Map<string, string>();
  for (const a of accounts) if (a.provider === 'zernio') for (const k of keys(a)) zernio.set(k, a.id);
  const replaced: Record<string, string> = {};
  for (const a of accounts) {
    if (a.provider !== 'ghl') continue;
    const twin = keys(a).map((k) => zernio.get(k)).find(Boolean);
    if (twin) replaced[a.id] = twin;
  }
  return {
    accounts: accounts.filter((a) => !replaced[a.id] && a.platform !== 'wordpress'),
    replaced_by: replaced,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

// Only the output fields a post needs (never the whole stage_data: video outputs keep
// full compositions there).
const ROW_SELECT = `
  id, organization_id, autopilot_id, output_id, account_id, platform, scheduled_for, status, attempts,
  last_error, published_at, source, post_group_id, agent_rationale, publish_content, created_at,
  autopilot:autopilots!publish_queue_autopilot_id_fkey (name),
  output:content_outputs!publish_queue_output_id_fkey (
    id, source, d_title:data->title, d_text:data->text, d_caption:data->caption, d_image_url:data->image_url,
    s_caption:stage_data->caption, s_post_caption:stage_data->post_caption, s_final:stage_data->final,
    s_image:stage_data->image, s_slides:stage_data->carousel_slides->slides, s_video:stage_data->video, s_comp:stage_data->composition
  )`;

type Row = Record<string, any>;

function outputContent(o: any): { caption: string; images: string[]; video: string | null } {
  if (!o) return { caption: '', images: [], video: null };
  const text = (stage: any) => (typeof stage?.content === 'string' && stage.content) || (typeof stage?.text === 'string' && stage.text) || '';
  const caption = text(o.s_caption) || text(o.s_post_caption) || o.s_final?.caption || o.d_text || o.d_caption || o.d_title || '';
  const images: string[] = [];
  let video: string | null = null;
  if (o.s_image?.media_type === 'video') video = o.s_image.video_url || o.s_image.url || null;
  else if (o.s_image?.url || o.s_image?.image_url) images.push(o.s_image.url || o.s_image.image_url);
  for (const slide of Array.isArray(o.s_slides) ? o.s_slides : []) if (slide?.image_url) images.push(slide.image_url);
  video = video || o.s_final?.video_url || o.s_final?.url || o.s_video?.video_url || o.s_video?.url || o.s_comp?.video_url || o.s_comp?.url || null;
  if (!images.length && !video && o.d_image_url) images.push(o.d_image_url);
  return { caption: String(caption || ''), images, video };
}

/** What a row publishes: its own content when set (exact, blank caption included), else the output's. */
function rowContent(row: Row): { caption: string; images: string[]; video: string | null } {
  const base = outputContent(row.output);
  const pc = row.publish_content;
  if (!pc) return base;
  const hasMedia = Array.isArray(pc.images) || !!pc.videoUrl;
  return {
    caption: typeof pc.caption === 'string' ? pc.caption : base.caption,
    images: hasMedia ? (pc.images ?? []) : base.images,
    video: hasMedia ? (pc.videoUrl || null) : base.video,
  };
}

const groupKey = (row: Row) => row.post_group_id ?? (row.output_id ? `${row.output_id}|${row.scheduled_for}` : row.id);
const STATUS_RANK: Record<string, number> = { failed: 5, publishing: 4, draft: 3, pending: 2, published: 1 };
/** The API's word for a status: "scheduled" for the queue's "pending". */
const apiStatus = (s: string) => (s === 'pending' ? 'scheduled' : s);
const dbStatus = (s: string) => (s === 'scheduled' ? 'pending' : s);

const STAT_KEYS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'views', 'clicks'] as const;

function rowStats(m: any) {
  if (!m) return null;
  return {
    status: m.status as string,
    ...Object.fromEntries(STAT_KEYS.map((k) => [k, m[k] ?? 0])),
    engagement_rate: m.engagement_rate === null || m.engagement_rate === undefined ? null : Number(m.engagement_rate),
    post_url: m.post_url ?? null,
    updated_at: m.fetched_at ?? null,
    error: m.status === 'synced' ? null : (m.last_error ?? null),
  } as Record<string, any>;
}

function summarize(stats: Array<Record<string, any>>) {
  if (!stats.length) return null;
  const counted = stats.filter((s) => s.status === 'synced' || s.status === 'pending');
  const total = Object.fromEntries(STAT_KEYS.map((k) => [k, counted.reduce((n, s) => n + (s[k] ?? 0), 0)])) as Record<string, number>;
  const interactions = total.likes + total.comments + total.shares + total.saves;
  const basis = counted.reduce((n, s) => n + (s.impressions || s.reach || s.views || 0), 0);
  const rank: Record<string, number> = { synced: 4, pending: 3, no_access: 2, error: 1, unavailable: 0 };
  const status = stats.reduce((acc, s) => (rank[s.status] > rank[acc] ? s.status : acc), stats[0].status);
  return {
    status,
    ...total,
    interactions,
    engagement_rate: !basis && !interactions ? null : stats.length === 1 ? stats[0].engagement_rate : basis ? Math.round((interactions / basis) * 10000) / 100 : null,
    post_url: stats.find((s) => s.post_url)?.post_url ?? null,
    updated_at: stats.map((s) => s.updated_at).filter(Boolean).sort().pop() ?? null,
    note: status === 'no_access' ? "The Zernio plan doesn't include analytics." : status === 'pending' && !interactions && !basis ? 'The platform is still counting.' : null,
  };
}

/** A post as the API returns it. */
function toPost(rows: Row[], statsByQueue: Map<string, any>) {
  rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const status = rows.reduce((acc, r) => (STATUS_RANK[r.status] > STATUS_RANK[acc] ? r.status : acc), rows[0].status);
  const first = rows.find((r) => r.status === status) ?? rows[0];
  const content = rowContent(first);
  const captions: Record<string, string> = {};
  for (const r of rows) captions[normPlatform(r.platform)] = rowContent(r).caption;
  const destinations = rows.map((r) => ({
    id: r.id,
    account_id: r.account_id,
    platform: normPlatform(r.platform),
    status: apiStatus(r.status),
    scheduled_for: r.scheduled_for,
    published_at: r.published_at,
    error: r.status === 'failed' ? r.last_error : null,
    stats: rowStats(statsByQueue.get(r.id)),
  }));
  const origin = first.source || (first.autopilot_id ? 'autopilot' : first.output?.source === 'manual' ? 'manual' : 'agent');
  return {
    id: first.post_group_id ?? rows[0].id,
    status: apiStatus(status),
    origin,
    title: String(first.output?.d_title || content.caption.split('\n').find((l: string) => l.trim()) || 'Untitled post').slice(0, 140),
    caption: content.caption,
    captions,
    media: { images: content.images, video: content.video },
    format: rows.some((r) => r.publish_content?.postType === 'story') ? 'story' : 'feed',
    first_comment: first.publish_content?.followUpComment ?? null,
    scheduled_for: first.scheduled_for,
    published_at: status === 'published' ? first.published_at : null,
    autopilot: first.autopilot?.name ?? null,
    rationale: first.agent_rationale ?? null,
    error: rows.find((r) => r.status === 'failed')?.last_error ?? null,
    editable: rows.some((r) => EDITABLE.includes(r.status)),
    destinations,
    stats: summarize(destinations.map((d) => d.stats).filter(Boolean) as Array<Record<string, any>>),
  };
}
export type SchedulerPost = ReturnType<typeof toPost>;

async function statsFor(supabase: SupabaseClient, rows: Row[]): Promise<Map<string, any>> {
  const ids = rows.filter((r) => r.status === 'published' && String(r.account_id).startsWith('zernio:')).map((r) => r.id);
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('social_post_metrics')
      .select('queue_id, status, impressions, reach, likes, comments, shares, saves, views, clicks, engagement_rate, post_url, fetched_at, last_error')
      .in('queue_id', ids.slice(i, i + 200));
    for (const m of data ?? []) out.set(m.queue_id, m);
  }
  return out;
}

function groupRows(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r]);
  return [...groups.values()];
}

function isoOrThrow(value: unknown, field: string): Date {
  const d = new Date(String(value));
  if (typeof value !== 'string' || !Number.isFinite(d.getTime())) throw new SchedulerError(`${field} must be an ISO 8601 date-time`);
  return d;
}

/** Posts in a window, soonest first. Default: the last 7 days and the next 30. */
export async function listSchedulerPosts(supabase: SupabaseClient, orgId: string, opts: {
  from?: unknown; to?: unknown; status?: unknown; platform?: unknown; limit?: unknown;
} = {}) {
  const from = opts.from ? isoOrThrow(opts.from, 'from') : new Date(Date.now() - 7 * DAY);
  const to = opts.to ? isoOrThrow(opts.to, 'to') : new Date(Date.now() + 30 * DAY);
  if (to <= from) throw new SchedulerError('to must be after from');
  if (to.getTime() - from.getTime() > 120 * DAY) throw new SchedulerError('The window can span at most 120 days');
  const statuses = (Array.isArray(opts.status) ? opts.status : typeof opts.status === 'string' ? opts.status.split(',') : [])
    .map((s) => dbStatus(String(s).trim())).filter((s) => ['draft', 'pending', 'publishing', 'published', 'failed'].includes(s));
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);

  let q = supabase.from('publish_queue').select(ROW_SELECT)
    .eq('organization_id', orgId)
    .gte('scheduled_for', from.toISOString())
    .lte('scheduled_for', to.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(2000);
  if (statuses.length) q = q.in('status', statuses);
  const { data, error } = await q;
  if (error) throw new SchedulerError(error.message, 500);
  const rows = (data ?? []) as Row[];
  const stats = await statsFor(supabase, rows);
  const platform = opts.platform ? normPlatform(opts.platform) : null;
  const posts = groupRows(rows)
    .map((g) => toPost(g, stats))
    .filter((p) => !platform || p.destinations.some((d) => d.platform === platform))
    .sort((a, b) => new Date(a.published_at ?? a.scheduled_for).getTime() - new Date(b.published_at ?? b.scheduled_for).getTime());
  return { from: from.toISOString(), to: to.toISOString(), total: posts.length, posts: posts.slice(0, limit), truncated: posts.length > limit };
}

/** A post's rows, by its id (post_group_id) or the id of any of its rows. */
async function loadRows(supabase: SupabaseClient, orgId: string, id: unknown): Promise<Row[]> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new SchedulerError('id must be a post id (UUID)');
  const byGroup = await supabase.from('publish_queue').select(ROW_SELECT).eq('organization_id', orgId).eq('post_group_id', id);
  if (byGroup.error) throw new SchedulerError(byGroup.error.message, 500);
  if (byGroup.data?.length) return byGroup.data as Row[];
  const { data: row, error } = await supabase.from('publish_queue').select(ROW_SELECT).eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new SchedulerError(error.message, 500);
  if (!row) throw new SchedulerError('Post not found', 404);
  const r = row as Row;
  if (r.post_group_id) return loadRows(supabase, orgId, r.post_group_id);
  if (!r.output_id) return [r];
  const { data: siblings } = await supabase.from('publish_queue').select(ROW_SELECT)
    .eq('organization_id', orgId).eq('output_id', r.output_id).eq('scheduled_for', r.scheduled_for).is('post_group_id', null);
  return (siblings?.length ? siblings : [r]) as Row[];
}

export async function getSchedulerPost(supabase: SupabaseClient, orgId: string, id: unknown, opts: { history?: boolean } = {}) {
  const rows = await loadRows(supabase, orgId, id);
  const post = toPost(rows, await statsFor(supabase, rows));
  if (!opts.history || !post.stats) return post;
  const { data: metrics } = await supabase.from('social_post_metrics').select('id, queue_id').in('queue_id', rows.map((r) => r.id));
  const { data: snaps } = await supabase.from('social_post_metric_snapshots')
    .select('metric_id, captured_at, impressions, reach, likes, comments, shares, saves, views, clicks, engagement_rate')
    .in('metric_id', (metrics ?? []).map((m: any) => m.id))
    .order('captured_at', { ascending: true }).limit(500);
  const queueOf = new Map((metrics ?? []).map((m: any) => [m.id, m.queue_id]));
  return { ...post, history: (snaps ?? []).map((s: any) => ({ destination_id: queueOf.get(s.metric_id), ...s, metric_id: undefined })) };
}

export interface PostInput {
  accounts?: unknown;
  caption?: unknown;
  captions?: unknown;
  images?: unknown;
  video?: unknown;
  first_comment?: unknown;
  format?: unknown;
  scheduled_for?: unknown;
  publish_now?: unknown;
  status?: unknown;
  title?: unknown;
}

function readMedia(input: PostInput): { images: string[]; video: string | null } | null {
  if (input.images === undefined && input.video === undefined) return null;
  const images = (Array.isArray(input.images) ? input.images : []).map(String);
  const video = typeof input.video === 'string' && input.video ? input.video : null;
  for (const url of [...images, ...(video ? [video] : [])]) {
    if (!/^https:\/\//i.test(url)) throw new SchedulerError(`Media must be public https URLs: ${url.slice(0, 80)}`);
  }
  if (images.length > 20) throw new SchedulerError('At most 20 pictures');
  if (images.length && video) throw new SchedulerError('Send pictures or one video, not both');
  return { images, video };
}

function readCaptions(input: PostInput): { caption: string | null; captions: Record<string, string> } {
  const caption = typeof input.caption === 'string' ? input.caption : null;
  const captions: Record<string, string> = {};
  if (input.captions && typeof input.captions === 'object' && !Array.isArray(input.captions)) {
    for (const [k, v] of Object.entries(input.captions as Record<string, unknown>)) if (typeof v === 'string') captions[normPlatform(k)] = v;
  }
  return { caption, captions };
}

/** What one row publishes on its platform (the app's contentFor). */
function contentFor(platform: string, caption: string, media: { images: string[]; video: string | null }, firstComment: string | null, story: boolean) {
  const rule = ruleFor(platform);
  return {
    caption,
    images: media.video ? [] : media.images.slice(0, rule.multiImage ? rule.maxImages : 1),
    ...(media.video ? { videoUrl: media.video } : {}),
    ...(firstComment?.trim() ? { followUpComment: firstComment.trim() } : {}),
    ...(story && rule.stories ? { postType: 'story' } : {}),
  };
}

function readTime(input: PostInput, fallback: Date | null): Date {
  if (input.publish_now === true) return new Date();
  if (input.scheduled_for === undefined || input.scheduled_for === null) {
    if (fallback) return fallback;
    throw new SchedulerError('Give scheduled_for (ISO 8601) or publish_now: true');
  }
  const at = isoOrThrow(input.scheduled_for, 'scheduled_for');
  if (at.getTime() < Date.now() - 5 * 60_000) throw new SchedulerError('scheduled_for is in the past. Use publish_now: true to post right away.');
  if (at.getTime() > Date.now() + 365 * DAY) throw new SchedulerError('scheduled_for is more than a year away');
  return at;
}

/** Account ids → accounts the org can post to. A hidden GHL twin is swapped for its Zernio account. */
async function resolveAccounts(supabase: SupabaseClient, orgId: string, ids: unknown): Promise<{ targets: SchedulerAccount[]; notes: string[] }> {
  const wanted = (Array.isArray(ids) ? ids : typeof ids === 'string' ? [ids] : []).map(String).filter(Boolean);
  if (!wanted.length) throw new SchedulerError('accounts is required: account ids from list_scheduler_accounts (GET /v1/scheduler/accounts)');
  if (wanted.length > 30) throw new SchedulerError('At most 30 accounts per post');
  const { accounts, replaced_by } = await listSchedulerAccounts(supabase, orgId);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const notes: string[] = [];
  const targets: SchedulerAccount[] = [];
  for (const id of wanted) {
    const swapped = replaced_by[id];
    const account = byId.get(swapped ?? id);
    if (!account) throw new SchedulerError(`Unknown account ${id}. List them with list_scheduler_accounts (GET /v1/scheduler/accounts).`, 404);
    if (swapped) notes.push(`${account.name} (${account.platform}) goes out through Zernio, not its GHL copy.`);
    if (!targets.some((t) => t.id === account.id)) targets.push(account);
  }
  return { targets, notes };
}

/** Create a post on one or more accounts: scheduled (default) or a draft to review. */
export async function createSchedulerPost(supabase: SupabaseClient, orgId: string, input: PostInput, createdBy: string | null = null) {
  const { targets, notes } = await resolveAccounts(supabase, orgId, input.accounts);
  const media = readMedia(input) ?? { images: [], video: null };
  const { caption, captions } = readCaptions(input);
  const textFor = (p: string) => captions[p] ?? caption ?? '';
  const platforms = [...new Set(targets.map((t) => t.platform))];
  const draft = input.status === 'draft';
  const issues = checkPost(platforms, Object.fromEntries(platforms.map((p) => [p, textFor(p)])), media);
  if (issues.length && !draft) throw new SchedulerError(`The post can't go out as it is: ${issues.map((i) => i.message).join('; ')}`, 422, { issues });
  const at = readTime(input, draft ? new Date(Date.now() + DAY) : null);
  const story = input.format === 'story';
  const firstComment = typeof input.first_comment === 'string' ? input.first_comment : null;
  const primary = textFor(platforms[0]);
  const kind = media.video ? 'video' : media.images.length > 1 ? 'carousel' : media.images.length ? 'image' : 'text';

  const { data: output, error: outputError } = await supabase.from('content_outputs').insert({
    organization_id: orgId,
    pipeline: 'social_media_post',
    type: kind,
    status: 'approved',
    source: 'manual',
    data: { title: (typeof input.title === 'string' && input.title) || primary.split('\n')[0].slice(0, 120), text: primary, scheduler: true },
    stage_data: { caption: { content: primary }, ...(media.images[0] ? { image: { url: media.images[0] } } : {}) },
  }).select('id').single();
  if (outputError || !output) throw new SchedulerError(outputError?.message ?? 'Could not create the post', 500);

  const groupId = crypto.randomUUID();
  const { error } = await supabase.from('publish_queue').insert(targets.map((t) => ({
    organization_id: orgId,
    output_id: output.id,
    account_id: t.id,
    platform: t.platform,
    scheduled_for: at.toISOString(),
    status: draft ? 'draft' : 'pending',
    source: 'manual',
    post_group_id: groupId,
    created_by: createdBy,
    publish_content: contentFor(t.platform, textFor(t.platform), media, firstComment, story),
  })));
  if (error) throw new SchedulerError(error.message, 500);
  const post = await getSchedulerPost(supabase, orgId, groupId);
  return { post, issues, notes };
}

/** Edit a post that hasn't gone out: time, text, media, first comment, format, accounts, draft/scheduled. */
export async function updateSchedulerPost(supabase: SupabaseClient, orgId: string, id: unknown, input: PostInput) {
  const rows = await loadRows(supabase, orgId, id);
  const editable = rows.filter((r) => EDITABLE.includes(r.status));
  if (!editable.length) throw new SchedulerError('This post has already gone out and can no longer be edited', 409);
  const groupId = rows[0].post_group_id ?? crypto.randomUUID();
  const media = readMedia(input);
  const { caption, captions } = readCaptions(input);
  const firstComment = input.first_comment === undefined ? undefined : typeof input.first_comment === 'string' ? input.first_comment : null;
  const status = input.status === 'draft' ? 'draft' : input.status === 'scheduled' ? 'pending' : null;
  const timeGiven = input.publish_now === true || input.scheduled_for !== undefined;
  const at = timeGiven ? readTime(input, null) : null;

  // Accounts: replace the set when given.
  let keep = editable;
  let added: SchedulerAccount[] = [];
  const notes: string[] = [];
  if (input.accounts !== undefined) {
    const resolved = await resolveAccounts(supabase, orgId, input.accounts);
    notes.push(...resolved.notes);
    const ids = new Set(resolved.targets.map((t) => t.id));
    keep = editable.filter((r) => ids.has(r.account_id));
    const existing = new Set(rows.map((r) => r.account_id));
    added = resolved.targets.filter((t) => !existing.has(t.id));
  }
  const removed = editable.filter((r) => !keep.includes(r));

  // The post as it would be after the edit, checked like the app does before it schedules.
  const next = (r: Row | null, platform: string) => {
    const current = r ? rowContent(r) : rowContent(keep[0] ?? editable[0]);
    const m = media ?? { images: current.images, video: current.video };
    const text = captions[platform] ?? caption ?? current.caption;
    const fc = firstComment === undefined ? (r ?? editable[0]).publish_content?.followUpComment ?? null : firstComment;
    const story = input.format === undefined ? (r ?? editable[0]).publish_content?.postType === 'story' : input.format === 'story';
    return { media: m, text, content: contentFor(platform, text, m, fc, story) };
  };
  const planned = [...keep.map((r) => ({ r, platform: normPlatform(r.platform) })), ...added.map((a) => ({ r: null, platform: a.platform }))];
  if (!planned.length) throw new SchedulerError('A post needs at least one account. To remove it, delete it.');
  const finalStatus = status ?? (keep.some((r) => r.status === 'draft') && !added.length ? 'draft' : 'pending');
  if (finalStatus === 'pending') {
    const issues = planned.flatMap(({ r, platform }) => {
      const n = next(r, platform);
      return checkPost([platform], { [platform]: n.text }, n.media);
    });
    if (issues.length) throw new SchedulerError(`The post can't go out as it is: ${issues.map((i) => i.message).join('; ')}`, 422, { issues });
  }

  for (const r of keep) {
    const n = next(r, normPlatform(r.platform));
    const patch: Record<string, unknown> = { post_group_id: groupId, publish_content: n.content, status: finalStatus };
    if (at) patch.scheduled_for = at.toISOString();
    if (r.status === 'failed') Object.assign(patch, { attempts: 0, last_error: null });
    const { error } = await supabase.from('publish_queue').update(patch).eq('id', r.id).eq('organization_id', orgId).in('status', EDITABLE);
    if (error) throw new SchedulerError(error.message, 500);
  }
  if (removed.length) {
    const { error } = await supabase.from('publish_queue').delete().in('id', removed.map((r) => r.id)).eq('organization_id', orgId).in('status', EDITABLE);
    if (error) throw new SchedulerError(error.message, 500);
  }
  if (added.length) {
    const template = editable[0];
    const { error } = await supabase.from('publish_queue').insert(added.map((a) => ({
      organization_id: orgId,
      output_id: template.output_id,
      autopilot_id: template.autopilot_id,
      account_id: a.id,
      platform: a.platform,
      scheduled_for: (at ?? new Date(template.scheduled_for)).toISOString(),
      status: finalStatus,
      source: template.source ?? (template.autopilot_id ? 'autopilot' : 'manual'),
      post_group_id: groupId,
      publish_content: next(null, a.platform).content,
    })));
    if (error) throw new SchedulerError(error.message, 500);
  }
  return { post: await getSchedulerPost(supabase, orgId, groupId), notes };
}

/** Remove a post's unsent rows. What already went out stays as the record. */
export async function deleteSchedulerPost(supabase: SupabaseClient, orgId: string, id: unknown) {
  const rows = await loadRows(supabase, orgId, id);
  const ids = rows.filter((r) => EDITABLE.includes(r.status)).map((r) => r.id);
  if (!ids.length) throw new SchedulerError('This post has already gone out; there is nothing to remove', 409);
  const { error } = await supabase.from('publish_queue').delete().in('id', ids).eq('organization_id', orgId).in('status', EDITABLE);
  if (error) throw new SchedulerError(error.message, 500);
  return { deleted: true, removed_destinations: ids.length, kept_published: rows.length - ids.length };
}

async function setRows(supabase: SupabaseClient, orgId: string, ids: string[], patch: Record<string, unknown>, from: string[]) {
  if (!ids.length) return 0;
  const { data, error } = await supabase.from('publish_queue').update(patch).in('id', ids).eq('organization_id', orgId).in('status', from).select('id');
  if (error) throw new SchedulerError(error.message, 500);
  return (data ?? []).length;
}

/**
 * Drafts and agent proposals → scheduled. Past times move to 5 minutes from now, 90 minutes
 * apart per account. A draft that would fail (Instagram with no picture…) stays a draft.
 */
export async function approveSchedulerPosts(supabase: SupabaseClient, orgId: string, ids: unknown) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).slice(0, 50);
  if (!list.length) throw new SchedulerError('ids is required');
  const soon = Date.now() + 5 * 60_000;
  const nextFree = new Map<string, number>();
  const approved: string[] = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  const posts = await Promise.all(list.map((id) => loadRows(supabase, orgId, id).then((rows) => ({ id, rows })).catch((e) => ({ id, error: e as Error }))));
  const ready = posts.filter((p): p is { id: string; rows: Row[] } => 'rows' in p)
    .sort((a, b) => new Date(a.rows[0].scheduled_for).getTime() - new Date(b.rows[0].scheduled_for).getTime());
  for (const p of posts) if ('error' in p) blocked.push({ id: p.id, reason: p.error.message });
  for (const { id, rows } of ready) {
    const drafts = rows.filter((r) => r.status === 'draft');
    if (!drafts.length) { blocked.push({ id, reason: 'Not a draft' }); continue; }
    const platforms = [...new Set(drafts.map((r) => normPlatform(r.platform)))];
    const content = rowContent(drafts[0]);
    const issues = checkPost(platforms, Object.fromEntries(drafts.map((r) => [normPlatform(r.platform), rowContent(r).caption])), content);
    if (issues.length) { blocked.push({ id, reason: issues[0].message }); continue; }
    const patch: Record<string, unknown> = { status: 'pending' };
    if (new Date(drafts[0].scheduled_for).getTime() < soon) {
      const accountIds = drafts.map((r) => r.account_id);
      const at = Math.max(soon, ...accountIds.map((a) => nextFree.get(a) ?? 0));
      for (const a of accountIds) nextFree.set(a, at + MIN_GAP_MS);
      patch.scheduled_for = new Date(at).toISOString();
    }
    if (await setRows(supabase, orgId, drafts.map((r) => r.id), patch, ['draft'])) approved.push(id);
  }
  return { approved, blocked };
}

/** Failed → back in the queue now (out within 5 minutes). */
export async function retrySchedulerPost(supabase: SupabaseClient, orgId: string, id: unknown) {
  const rows = await loadRows(supabase, orgId, id);
  const failed = rows.filter((r) => r.status === 'failed').map((r) => r.id);
  if (!failed.length) throw new SchedulerError('Nothing to retry: no destination of this post failed', 409);
  const n = await setRows(supabase, orgId, failed, { status: 'pending', attempts: 0, last_error: null, scheduled_for: new Date().toISOString() }, ['failed']);
  return { retried_destinations: n, post: await getSchedulerPost(supabase, orgId, id) };
}

/** Draft, scheduled or failed → out at the next queue run (every 5 minutes). */
export async function publishSchedulerPostNow(supabase: SupabaseClient, orgId: string, id: unknown) {
  const rows = await loadRows(supabase, orgId, id);
  const editable = rows.filter((r) => EDITABLE.includes(r.status));
  if (!editable.length) throw new SchedulerError('This post has already gone out', 409);
  const platforms = [...new Set(editable.map((r) => normPlatform(r.platform)))];
  const issues = checkPost(platforms, Object.fromEntries(editable.map((r) => [normPlatform(r.platform), rowContent(r).caption])), rowContent(editable[0]));
  if (issues.length) throw new SchedulerError(`The post can't go out as it is: ${issues.map((i) => i.message).join('; ')}`, 422, { issues });
  const n = await setRows(supabase, orgId, editable.map((r) => r.id), { status: 'pending', attempts: 0, last_error: null, scheduled_for: new Date().toISOString() }, EDITABLE);
  return { queued_destinations: n, note: 'Goes out at the next queue run, within 5 minutes.', post: await getSchedulerPost(supabase, orgId, id) };
}

// ---------------------------------------------------------------------------
// Agent, stats, connecting accounts
// ---------------------------------------------------------------------------

/** The scheduling agent writes draft proposals into free, high-engagement slots. Approve them to schedule. */
export async function planSchedulerPosts(supabase: SupabaseClient, orgId: string, input: {
  instruction?: unknown; accounts?: unknown; range_start?: unknown; range_end?: unknown; timezone?: unknown; brand_voice_id?: unknown; product_id?: unknown;
}) {
  const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
  if (!instruction) throw new SchedulerError('instruction is required, e.g. "Plan 5 LinkedIn posts for next week about our new feature"');
  const { accounts, replaced_by } = await listSchedulerAccounts(supabase, orgId);
  const wanted = Array.isArray(input.accounts) && input.accounts.length ? new Set(input.accounts.map((id) => replaced_by[String(id)] ?? String(id))) : null;
  const targets = accounts.filter((a) => a.active && (!wanted || wanted.has(a.id))).slice(0, 30);
  if (!targets.length) throw new SchedulerError('No account to plan for. Connect one first (connect_social_account) or check the account ids.');
  const result = await callFunction('scheduler-agent', {
    action: 'plan',
    organization_id: orgId,
    instruction,
    range_start: typeof input.range_start === 'string' ? input.range_start : undefined,
    range_end: typeof input.range_end === 'string' ? input.range_end : undefined,
    timezone: typeof input.timezone === 'string' ? input.timezone : 'UTC',
    brand_voice_id: typeof input.brand_voice_id === 'string' ? input.brand_voice_id : undefined,
    product_id: typeof input.product_id === 'string' ? input.product_id : undefined,
    accounts: targets.map((a) => ({ id: a.id, platform: a.platform, name: a.name })),
  });
  if (!result?.success) throw new SchedulerError(result?.error || 'The agent could not build a plan', 422);
  const posts = await Promise.all((result.group_ids ?? []).map((g: string) => getSchedulerPost(supabase, orgId, g).catch(() => null)));
  return {
    summary: result.summary,
    proposals: posts.filter(Boolean),
    next_step: 'These are drafts. Review them, add pictures where a platform needs one, then approve_scheduled_posts (POST /v1/scheduler/posts/approve) to schedule.',
  };
}

/** A published post's stats; refresh reads the latest from the platform first. */
export async function getSchedulerPostStats(supabase: SupabaseClient, orgId: string, id: unknown, opts: { refresh?: boolean } = {}) {
  const rows = await loadRows(supabase, orgId, id);
  const published = rows.filter((r) => r.status === 'published' && String(r.account_id).startsWith('zernio:'));
  if (!published.length) {
    const status = rows.some((r) => r.status === 'published') ? 'not_measured' : 'not_published';
    return {
      id,
      stats: null,
      note: status === 'not_published'
        ? "This post hasn't gone out yet."
        : 'Stats are read through Zernio; this post went out another way (GHL, native LinkedIn or X), so there are none.',
    };
  }
  if (opts.refresh) {
    const res = await callFunction('refresh-post-metrics', { organization_id: orgId, queue_ids: published.map((r) => r.id) });
    if (!res?.success) throw new SchedulerError(res?.error || 'Could not refresh the stats', 502);
  }
  const post = await getSchedulerPost(supabase, orgId, id, { history: true }) as any;
  return { id: post.id, stats: post.stats, destinations: post.destinations.map((d: any) => ({ id: d.id, account_id: d.account_id, platform: d.platform, stats: d.stats })), history: post.history ?? [] };
}

/** A sign-in link that connects a social account through the org's Zernio key. */
export async function connectSchedulerAccount(orgId: string, platform: unknown) {
  const p = normPlatform(platform);
  if (p === 'linkedin') {
    return { connect_url: `${APP_URL}/settings?tab=senders`, note: 'LinkedIn connects natively from Settings › Senders.' };
  }
  const res = await callFunction('zernio-connect', { organization_id: orgId, platform: p });
  if (!res?.success) {
    throw new SchedulerError(res?.code === 'no_key' ? 'Add a Zernio API key in Settings › API keys first.' : (res?.error || 'Could not start the connection'), res?.code === 'no_key' ? 409 : 502);
  }
  return { connect_url: res.auth_url, note: 'Open this link to sign in to the platform. The account then shows in list_scheduler_accounts.' };
}
