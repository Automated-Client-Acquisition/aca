/**
 * The Scheduler's agent (/scheduler).
 *
 * POST { action: 'plan', organization_id, instruction, timezone, range_start, range_end,
 *        accounts: [{ id, platform, name }], brand_voice_id?, product_id? }
 *   Writes a content plan into the publish queue as proposals (status 'draft',
 *   source 'agent', one post_group_id per post). Nothing goes out until a person
 *   approves it on the calendar (draft → pending).
 *   → { success, summary, created, group_ids }
 *
 * POST { action: 'assist', organization_id, text, instruction, platforms?, count?, brand_voice_id? }
 *   A composer rewrite. With `platforms`, returns one version per platform
 *   ({ variants: { linkedin: "...", twitter: "..." } }); with count > 1, returns
 *   alternatives ({ options: [...] }); otherwise { text }.
 *
 * Slots are computed here, not by the model: the model picks from a list of
 * free best-time slots in the user's timezone, so it can't double-book an
 * account or post at 3am. User-fixable problems answer 200 with success: false
 * (supabase-js drops the body of non-2xx replies).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey, llmChatCompletion } from '../_shared/llm-client.ts';
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';
import { zonedTimeToUtc } from '../_shared/autopilot-schedule.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const PLAN_MODEL = 'anthropic/claude-sonnet-5.5';
const ASSIST_MODEL = 'anthropic/claude-haiku-5.5';
const MAX_PLAN_POSTS = 21;
const MAX_RANGE_DAYS = 31;
/** Two posts to the same account closer than this crowd each other out. */
const MIN_GAP_MS = 90 * 60 * 1000;

// ---------------------------------------------------------------------------
// Platform knowledge. Frontend mirror: src/lib/scheduler.ts (keep in sync).
// ---------------------------------------------------------------------------

const CHAR_LIMITS: Record<string, number> = {
  twitter: 280, x: 280, linkedin: 3000, instagram: 2200, facebook: 63206,
  tiktok: 2200, youtube: 5000, google: 1500, pinterest: 500, threads: 500, bluesky: 300,
};

const PLATFORM_STYLE: Record<string, string> = {
  linkedin: 'LinkedIn: a strong first line before the fold (~200 chars), short paragraphs, a point of view, ends with a question or clear takeaway.',
  twitter: 'X: one sharp idea, 280 characters max (a link counts as 23, an emoji as 2), no thread markers.',
  x: 'X: one sharp idea, 280 characters max (a link counts as 23, an emoji as 2), no thread markers.',
  instagram: 'Instagram: hook in the first 125 characters (the rest hides behind "more"), conversational, line breaks, a call to action. Links are not clickable in captions.',
  facebook: 'Facebook: friendly and conversational, invites comments; the key point within the first 480 characters.',
  tiktok: 'TikTok: a punchy caption under 150 characters that supports a video.',
  youtube: 'YouTube: a description that states what the viewer gets.',
  google: 'Google Business Profile: a local update or offer, plain and specific, 1500 characters max. Never include a phone number (Google rejects the post).',
  pinterest: 'Pinterest: a keyword-rich description, 500 characters max.',
  threads: 'Threads: casual, 500 characters max.',
  bluesky: 'Bluesky: conversational, 300 characters max.',
};

interface BestTimes { hours: number[]; days: number[]; peakDays: number[] }
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const BEST_TIMES: Record<string, BestTimes> = {
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

function normPlatform(p: string): string {
  const k = (p || '').toLowerCase();
  return k === 'x' ? 'twitter' : k === 'google_business' ? 'google' : k;
}
function timesFor(platform: string): BestTimes {
  return BEST_TIMES[normPlatform(platform)] ?? DEFAULT_TIMES;
}

// ---------------------------------------------------------------------------
// Time helpers (all slots are local wall-clock times in the user's timezone)
// ---------------------------------------------------------------------------

function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { year: Number(get('year')), month: Number(get('month')) - 1, day: Number(get('day')), hour: Number(get('hour')) % 24, minute: Number(get('minute')), weekday };
}

const pad = (n: number) => String(n).padStart(2, '0');
function slotLabel(at: Date, timezone: string): string {
  const p = localParts(at, timezone);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseSlot(label: string, timezone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(label || '');
  if (!m) return null;
  const at = zonedTimeToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), timezone);
  return Number.isFinite(at.getTime()) ? at : null;
}

interface Account { id: string; platform: string; name: string }
interface Busy { account_id: string; at: number }

/** Free best-time slots per platform between start and end. */
function freeSlots(platforms: string[], accounts: Account[], busy: Busy[], start: Date, end: Date, timezone: string) {
  const out: Record<string, Array<{ label: string; peak: boolean; at: number }>> = {};
  const earliest = Math.max(start.getTime(), Date.now() + 20 * 60 * 1000);
  for (const platform of platforms) {
    const times = timesFor(platform);
    const accountIds = accounts.filter((a) => normPlatform(a.platform) === platform).map((a) => a.id);
    const slots: Array<{ label: string; peak: boolean; at: number }> = [];
    const first = localParts(new Date(earliest), timezone);
    for (let d = 0; d <= MAX_RANGE_DAYS + 1; d++) {
      const noon = zonedTimeToUtc(first.year, first.month, first.day + d, 12, 0, timezone);
      if (noon.getTime() - 12 * 3600 * 1000 > end.getTime()) break;
      const p = localParts(noon, timezone);
      if (!times.days.includes(p.weekday)) continue;
      for (const h of times.hours) {
        const at = zonedTimeToUtc(p.year, p.month, p.day, h, 0, timezone);
        if (at.getTime() < earliest || at.getTime() > end.getTime()) continue;
        const clash = busy.some((b) => accountIds.includes(b.account_id) && Math.abs(b.at - at.getTime()) < MIN_GAP_MS);
        if (!clash) slots.push({ label: `${slotLabel(at, timezone)} (${DAY_NAMES[p.weekday]})`, peak: times.peakDays.includes(p.weekday), at: at.getTime() });
      }
    }
    // Enough for a full 31-day window at 4 slots a day.
    out[platform] = slots.slice(0, 140);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text clean-up
// ---------------------------------------------------------------------------

/** Drops trailing lines made only of hashtags (unless the brief asked for them) and em dashes. */
function cleanCaption(text: string, keepHashtags: boolean): string {
  let out = normalizeDashes(String(text || '').trim()).replace(/^"([\s\S]*)"$/, '$1');
  if (!keepHashtags) {
    const lines = out.split('\n');
    while (lines.length && /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(lines[lines.length - 1])) lines.pop();
    out = lines.join('\n').trimEnd();
  }
  return out;
}

const URL_RE = /\bhttps?:\/\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|ai|app|dev|me|ly|gg|tv|xyz|info|biz|us|uk|fr|de|eu|ca|au)\b(?:\/[^\s]*)?/gi;

/** Where X's weighted count (links 23, emoji/CJK 2) passes `limit`; null when it fits. */
function xOverflowAt(text: string, limit: number): number | null {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const urls = [...text.matchAll(URL_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  let length = 0;
  let u = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (u < urls.length && index >= urls[u].start && index < urls[u].end) {
      if (index === urls[u].start) length += 23;
      if (index + segment.length >= urls[u].end) u++;
    } else if (/\p{Extended_Pictographic}/u.test(segment)) {
      length += 2;
    } else {
      let w = 0;
      for (const ch of segment) {
        const cp = ch.codePointAt(0) ?? 0;
        w += cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2;
      }
      length += Math.min(w, 2);
    }
    if (length > limit) return index;
  }
  return null;
}

/** Cut to a platform's limit at a sentence or word boundary. */
function fitToLimit(text: string, platform: string): string {
  const p = normPlatform(platform);
  const limit = CHAR_LIMITS[p];
  if (!limit) return text;
  const cut = p === 'twitter' ? xOverflowAt(text, limit) : text.length > limit ? limit : null;
  if (cut === null) return text;
  const slice = text.slice(0, cut);
  const sentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
  if (sentence > cut * 0.6) return slice.slice(0, sentence + 1).trim();
  const word = slice.lastIndexOf(' ');
  return (word > 0 ? slice.slice(0, word) : slice).trim();
}

function parseJson(raw: string): any {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

function friendlyLlmError(message: string): string {
  if (/402|credits/i.test(message)) return 'Your OpenRouter balance is too low. Top it up and try again.';
  if (/401|invalid.*key/i.test(message)) return 'OpenRouter rejected the API key. Update it in Settings > Integrations.';
  if (/timeout|abort/i.test(message)) return 'The agent took too long. Try a smaller request.';
  return 'The agent could not finish. Try again in a moment.';
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function brandContext(supabase: any, orgId: string, brandVoiceId?: string, productId?: string): Promise<string> {
  const parts: string[] = [];
  let voiceQuery = supabase.from('library_brand_voices').select('name, description, tone, style_guidelines').eq('organization_id', orgId);
  voiceQuery = brandVoiceId ? voiceQuery.eq('id', brandVoiceId) : voiceQuery.order('updated_at', { ascending: false });
  const { data: voices } = await voiceQuery.limit(1);
  const voice = voices?.[0];
  if (voice) {
    parts.push(`BRAND VOICE "${voice.name}": ${[voice.description, voice.tone && `Tone: ${voice.tone}`, voice.style_guidelines && `Guidelines: ${String(voice.style_guidelines).slice(0, 1200)}`].filter(Boolean).join('\n')}`);
  }
  let productQuery = supabase.from('library_products').select('name, description, key_benefits').eq('organization_id', orgId);
  productQuery = productId ? productQuery.eq('id', productId) : productQuery.order('updated_at', { ascending: false });
  const { data: products } = await productQuery.limit(productId ? 1 : 3);
  for (const p of products ?? []) {
    const benefits = Array.isArray(p.key_benefits) ? p.key_benefits.slice(0, 5).join('; ') : '';
    parts.push(`PRODUCT "${p.name}": ${String(p.description || '').slice(0, 500)}${benefits ? `\nBenefits: ${benefits}` : ''}`);
  }
  return parts.join('\n\n');
}

// deno-lint-ignore no-explicit-any
/**
 * The org's measured posts from the last 60 days (social_post_metrics, read back through
 * Zernio), best first, plus the weakest when there are enough to compare. Empty when nothing
 * has been measured, so the plan never leans on numbers that don't exist.
 */
async function performanceText(supabase: any, orgId: string, timezone: string): Promise<string> {
  const { data, error } = await supabase.from('social_post_metrics')
    .select('platform, published_at, reach, impressions, views, likes, comments, shares, saves, engagement_rate, queue:publish_queue!social_post_metrics_queue_id_fkey (publish_content, output:content_outputs!publish_queue_output_id_fkey (data))')
    .eq('organization_id', orgId)
    .eq('status', 'synced')
    .gte('published_at', new Date(Date.now() - 60 * 86400_000).toISOString())
    .order('published_at', { ascending: false })
    .limit(80);
  if (error || !data?.length) return '';
  const interactions = (m: any) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
  const ranked = [...data].sort((a: any, b: any) => (Number(b.engagement_rate) || 0) - (Number(a.engagement_rate) || 0) || interactions(b) - interactions(a));
  const line = (m: any) => {
    const content = m.queue?.publish_content ?? {};
    const images = Array.isArray(content.images) ? content.images.length : 0;
    const format = content.postType === 'story' ? 'story' : content.videoUrl ? 'video' : images > 1 ? `carousel of ${images}` : images === 1 ? 'single image' : 'text';
    const at = new Date(m.published_at);
    const p = localParts(at, timezone);
    const caption = String(content.caption || m.queue?.output?.data?.text || m.queue?.output?.data?.title || '').replace(/\s+/g, ' ').slice(0, 110);
    const audience = m.reach || m.impressions || m.views || 0;
    return `- ${DAY_NAMES[p.weekday] ?? ''} ${pad(p.hour)}:${pad(p.minute)} ${m.platform} ${format}: ${m.engagement_rate ?? '?'}% engagement, ${audience} reached, ${m.likes ?? 0} likes, ${m.comments ?? 0} comments, ${m.saves ?? 0} saves. "${caption}"`;
  };
  const best = ranked.slice(0, 8).map(line);
  const worst = ranked.length >= 10 ? ranked.slice(-3).map(line) : [];
  return [
    ...best,
    ...(worst.length ? ['Weakest:', ...worst] : []),
    `(${data.length} measured post${data.length === 1 ? '' : 's'} in the last 60 days${data.length < 5 ? ': too few to be sure, treat as a hint' : ''})`,
  ].join('\n');
}

async function openRouterKey(supabase: any, orgId: string): Promise<string | null> {
  const key = await resolveApiKey(supabase, orgId, 'openrouter');
  return key ? await decryptApiKey(key.key_encrypted) : null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400); }

  const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
  try {
    await assertOrgAccess(req, supabase, orgId);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }

  try {
    if (body.action === 'assist') return await assist(supabase, orgId, body);
    if (body.action === 'plan') return await plan(req, supabase, orgId, body);
    return json({ success: false, error: 'Unknown action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[scheduler-agent]', message);
    return json({ success: false, error: friendlyLlmError(message), detail: message.slice(0, 300) });
  }
});

// deno-lint-ignore no-explicit-any
async function assist(supabase: any, orgId: string, body: Record<string, any>): Promise<Response> {
  const text = String(body.text || '');
  const instruction = String(body.instruction || '').trim().slice(0, 600);
  const platforms: string[] = Array.isArray(body.platforms) ? [...new Set(body.platforms.map((p: unknown) => normPlatform(String(p))))].slice(0, 8) as string[] : [];
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 4);
  if (!text.trim() && !instruction) return json({ success: false, error: 'Write something or say what the post is about.' });
  if (text.length > 20_000) return json({ success: false, error: 'This text is too long to rewrite in one go.' });

  const apiKey = await openRouterKey(supabase, orgId);
  if (!apiKey) return json({ success: false, code: 'MISSING_API_KEY', error: 'The agent needs an OpenRouter API key. Add it in Settings > Integrations.' });

  const brand = await brandContext(supabase, orgId, body.brand_voice_id);
  const keepHashtags = /#\w/.test(text) || /hashtag/i.test(instruction);
  const rules = [
    'You are a senior social media editor. Write in the author\'s voice and language.',
    'Keep facts, numbers, names and links. Never invent statistics or claims.',
    'Do not use em dashes. Do not add a preamble, notes, or quotes around the text.',
    keepHashtags ? 'Keep existing hashtags; add none.' : 'Do not use hashtags.',
    brand ? `\n${brand}` : '',
  ].join('\n');

  const source = text.trim() ? `TEXT:\n${text}` : '(no draft yet: write it from the instruction)';
  let user: string;
  let wantJson = false;
  if (platforms.length) {
    wantJson = true;
    user = `${instruction ? `INSTRUCTION: ${instruction}\n\n` : ''}Rewrite the post natively for each platform below, respecting its style and character limit.\n${platforms.map((p) => `- ${p} (max ${CHAR_LIMITS[p] ?? 2200} chars): ${PLATFORM_STYLE[p] ?? ''}`).join('\n')}\n\n${source}\n\nReturn JSON only: {"variants": {"<platform>": "<text>"}}`;
  } else if (count > 1) {
    wantJson = true;
    user = `INSTRUCTION: ${instruction || 'Write alternative versions'}\nWrite ${count} clearly different versions (different hooks and angles).\n\n${source}\n\nReturn JSON only: {"options": ["...", "..."]}`;
  } else {
    user = `INSTRUCTION: ${instruction || 'Improve it'}\n\n${source}\n\nReturn only the rewritten text.`;
  }

  const result = await llmChatCompletion({
    model: ASSIST_MODEL,
    messages: [{ role: 'system', content: rules }, { role: 'user', content: user }],
    temperature: 0.8,
    max_tokens: 4000,
    openRouterApiKey: apiKey,
    timeoutMs: 55_000,
    ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
  });

  if (!wantJson) {
    const out = cleanCaption(result.content, keepHashtags);
    return out ? json({ success: true, text: out }) : json({ success: false, error: 'The agent returned nothing. Try again.' });
  }
  const parsed = parseJson(result.content);
  if (platforms.length) {
    const variants: Record<string, string> = {};
    for (const p of platforms) {
      const v = parsed?.variants?.[p] ?? parsed?.variants?.[p === 'twitter' ? 'x' : p];
      if (typeof v === 'string' && v.trim()) variants[p] = fitToLimit(cleanCaption(v, keepHashtags), p);
    }
    return Object.keys(variants).length ? json({ success: true, variants }) : json({ success: false, error: 'The agent returned nothing usable. Try again.' });
  }
  const options = (Array.isArray(parsed?.options) ? parsed.options : []).filter((o: unknown) => typeof o === 'string' && o.trim()).map((o: string) => cleanCaption(o, keepHashtags));
  return options.length ? json({ success: true, options }) : json({ success: false, error: 'The agent returned nothing usable. Try again.' });
}

// deno-lint-ignore no-explicit-any
async function plan(req: Request, supabase: any, orgId: string, body: Record<string, any>): Promise<Response> {
  const instruction = String(body.instruction || '').trim().slice(0, 2000);
  if (!instruction) return json({ success: false, error: 'Tell the agent what to plan.' });
  const timezone = typeof body.timezone === 'string' && body.timezone ? body.timezone : 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }); } catch { return json({ success: false, error: 'Unknown timezone' }, 400); }

  const accounts: Account[] = (Array.isArray(body.accounts) ? body.accounts : [])
    .filter((a: any) => a && typeof a.id === 'string' && typeof a.platform === 'string' && normPlatform(a.platform) !== 'wordpress')
    .slice(0, 30)
    .map((a: any) => ({ id: a.id, platform: normPlatform(a.platform), name: String(a.name || a.platform).slice(0, 80) }));
  if (!accounts.length) return json({ success: false, error: 'Connect or pick at least one social account first.' });

  const now = Date.now();
  let start = new Date(typeof body.range_start === 'string' ? body.range_start : now);
  let end = new Date(typeof body.range_end === 'string' ? body.range_end : now + 7 * 86400_000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return json({ success: false, error: 'Pick a valid date range.' }, 400);
  }
  if (start.getTime() < now) start = new Date(now);
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86400_000) end = new Date(start.getTime() + MAX_RANGE_DAYS * 86400_000);
  if (end.getTime() <= start.getTime()) return json({ success: false, error: 'That range is already in the past. Move the calendar forward.' });

  const apiKey = await openRouterKey(supabase, orgId);
  if (!apiKey) return json({ success: false, code: 'MISSING_API_KEY', error: 'The agent needs an OpenRouter API key. Add it in Settings > Integrations.' });

  const caller = await authenticateRequest(req, supabase).catch(() => null);

  // What's already on the calendar, so the plan fits around it.
  const { data: existing } = await supabase.from('publish_queue')
    .select('account_id, platform, scheduled_for, status, publish_content, content_outputs:output_id (data)')
    .eq('organization_id', orgId)
    .in('status', ['draft', 'pending', 'publishing', 'published'])
    .gte('scheduled_for', new Date(start.getTime() - 86400_000).toISOString())
    .lte('scheduled_for', new Date(end.getTime() + 86400_000).toISOString())
    .order('scheduled_for')
    .limit(300);
  const busy: Busy[] = (existing ?? []).map((r: any) => ({ account_id: r.account_id, at: new Date(r.scheduled_for).getTime() }));
  const captionOf = (r: any) => String(r.publish_content?.caption || r.content_outputs?.data?.text || r.content_outputs?.data?.title || '').replace(/\s+/g, ' ').slice(0, 140);
  const calendar = (existing ?? []).slice(0, 60).map((r: any) => `- ${slotLabel(new Date(r.scheduled_for), timezone)} ${r.platform} [${r.status}]: ${captionOf(r)}`).join('\n');

  // Recent posts: the voice to match and the topics not to repeat.
  const { data: recent } = await supabase.from('publish_queue')
    .select('platform, publish_content, content_outputs:output_id (data)')
    .eq('organization_id', orgId).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(12);
  const recentText = (recent ?? []).map((r: any) => `- (${r.platform}) ${captionOf(r)}`).filter((l: string) => l.length > 12).join('\n');

  const performance = await performanceText(supabase, orgId, timezone);

  const { data: ideas } = await supabase.from('content_ideas')
    .select('title').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(25);
  const ideaText = (ideas ?? []).map((i: any) => `- ${String(i.title || '').slice(0, 160)}`).join('\n');

  const brand = await brandContext(supabase, orgId, body.brand_voice_id, body.product_id);
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const slots = freeSlots(platforms, accounts, busy, start, end, timezone);
  const slotText = platforms.map((p) => `${p}: ${slots[p].map((s) => `${s.label}${s.peak ? '*' : ''}`).join(', ') || '(no free slot in this window: plan nothing for this platform)'}`).join('\n');
  const keepHashtags = /hashtag/i.test(instruction);

  const system = [
    'You are the scheduling agent inside a social media scheduler. You plan and write posts that a person will review before they go out.',
    'Rules:',
    '- Write every caption ready to publish, in the brand\'s voice, native to its platform, within its character limit.',
    '- Never invent statistics, customer names, quotes or results. No placeholders like [link] unless the brief gives one.',
    '- Do not use em dashes.',
    keepHashtags ? '- Use a few relevant hashtags where the platform rewards them.' : '- Do not use hashtags.',
    '- Vary hooks and formats (story, how-to, contrarian take, list, question, behind the scenes). Do not repeat recent topics.',
    '- Instagram, TikTok, Pinterest and YouTube need a picture or video, which the person adds before approving: write those captions for a visual and name the visual to use in the rationale (e.g. "Visual: a 9:16 clip of the dashboard").',
    '- Schedule only in the free slots listed (a trailing * marks peak engagement days); prefer peaks; spread posts so no account gets two on the same day unless the brief asks.',
    '- When HOW PAST POSTS DID is given, lean into the formats, hooks, topics and posting times that earned the most engagement and away from what flopped, and say so in the rationale (e.g. "carousels got 3x the saves"). Quote only numbers listed there.',
    `- At most ${MAX_PLAN_POSTS} posts. If the brief gives a number, use it.`,
    'Return JSON only.',
  ].join('\n');

  const user = `BRIEF: ${instruction}

TIMEZONE: ${timezone}. Planning window: ${slotLabel(start, timezone)} to ${slotLabel(end, timezone)}.

ACCOUNTS (use these ids):
${accounts.map((a) => `- ${a.id} | ${a.platform} | ${a.name}`).join('\n')}

PLATFORM STYLE:
${platforms.map((p) => `- ${PLATFORM_STYLE[p] ?? p} (max ${CHAR_LIMITS[p] ?? 2200} chars)`).join('\n')}

FREE SLOTS (local time):
${slotText}

${brand ? `${brand}\n\n` : ''}ALREADY ON THE CALENDAR:
${calendar || '(nothing)'}

RECENTLY PUBLISHED (match the voice, don't repeat the topics):
${recentText || '(nothing yet)'}
${performance ? `\nHOW PAST POSTS DID (read back from the platforms, best first):\n${performance}\n` : ''}
IDEA BANK (use when the brief leaves the topic open):
${ideaText || '(empty)'}

Return:
{"summary": "one or two sentences on the plan and why", "posts": [{"title": "short internal label", "slot": "YYYY-MM-DD HH:MM", "account_ids": ["..."], "captions": {"<platform>": "full caption for that platform"}, "rationale": "why this post, this angle and this slot, in one sentence"}]}
One post can go to several accounts at the same slot; give a caption for each of their platforms.`;

  const result = await llmChatCompletion({
    model: PLAN_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    temperature: 0.8,
    max_tokens: 10000,
    openRouterApiKey: apiKey,
    timeoutMs: 140_000,
    response_format: { type: 'json_object' },
  });
  const parsed = parseJson(result.content);
  const posts: any[] = Array.isArray(parsed?.posts) ? parsed.posts.slice(0, MAX_PLAN_POSTS) : [];
  if (!posts.length) return json({ success: false, error: 'The agent could not build a plan from that brief. Try being more specific.' });

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const groupIds: string[] = [];
  const planned: Busy[] = [];
  for (const post of posts) {
    const targets = (Array.isArray(post.account_ids) ? post.account_ids : []).map((id: unknown) => byId.get(String(id))).filter(Boolean) as Account[];
    if (!targets.length) continue;
    // The model picks from the offered slots, but nothing forces it to: snap its
    // choice to the nearest offered slot of these platforms that is still free
    // for these accounts (in range, at a good hour, not within the gap of another post).
    const wanted = parseSlot(String(post.slot || ''), timezone)?.getTime() ?? start.getTime();
    const clashes = (t: number) => [...busy, ...planned].some((b) => targets.some((a) => a.id === b.account_id) && Math.abs(b.at - t) < MIN_GAP_MS);
    const offered = [...new Set(targets.flatMap((a) => (slots[a.platform] ?? []).map((s) => s.at)))].filter((t) => !clashes(t));
    if (!offered.length) continue;
    const at = new Date(offered.reduce((best, t) => (Math.abs(t - wanted) < Math.abs(best - wanted) ? t : best)));

    const captions: Record<string, string> = {};
    for (const a of targets) {
      const raw = post.captions?.[a.platform] ?? post.captions?.[a.platform === 'twitter' ? 'x' : a.platform] ?? Object.values(post.captions ?? {})[0];
      if (typeof raw === 'string' && raw.trim()) captions[a.platform] = fitToLimit(cleanCaption(raw, keepHashtags), a.platform);
    }
    const primary = captions[targets[0].platform] ?? Object.values(captions)[0];
    if (!primary) continue;

    const title = String(post.title || primary.split('\n')[0]).slice(0, 120);
    const { data: output, error: outputError } = await supabase.from('content_outputs').insert({
      organization_id: orgId,
      pipeline: 'social_media_post',
      type: 'text',
      status: 'approved',
      source: 'agent',
      data: { title, text: primary, scheduler: true },
      stage_data: { caption: { content: primary } },
    }).select('id').single();
    if (outputError || !output) {
      console.error('[scheduler-agent] output insert failed', outputError?.message);
      continue;
    }
    const groupId = crypto.randomUUID();
    const rationale = String(post.rationale || '').slice(0, 400) || null;
    const rows = targets.map((a) => ({
      organization_id: orgId,
      output_id: output.id,
      account_id: a.id,
      platform: a.platform,
      scheduled_for: at.toISOString(),
      status: 'draft',
      source: 'agent',
      post_group_id: groupId,
      agent_rationale: rationale,
      created_by: caller?.user_id ?? null,
      publish_content: { caption: captions[a.platform] ?? primary, images: [] },
    }));
    const { error: queueError } = await supabase.from('publish_queue').insert(rows);
    if (queueError) {
      console.error('[scheduler-agent] queue insert failed', queueError.message);
      continue;
    }
    groupIds.push(groupId);
    for (const a of targets) planned.push({ account_id: a.id, at: at.getTime() });
  }

  if (!groupIds.length) return json({ success: false, error: 'The agent proposed posts, but none fit a free future slot. Try a wider date range.' });
  return json({
    success: true,
    summary: cleanCaption(String(parsed?.summary || ''), true) || `Planned ${groupIds.length} posts.`,
    created: groupIds.length,
    group_ids: groupIds,
    model: result.model,
  });
}
