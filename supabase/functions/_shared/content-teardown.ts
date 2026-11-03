/**
 * Content teardown — reverse-engineers WHY a scraped post works (format, hook,
 * beat-by-beat structure, CTA, voice, visuals) into research_content.ai_analysis.
 * The teardown is the input for reverse-engineer-blueprint.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { resolveApiKey } from './resolve-api-key.ts';
import { decryptApiKey, llmChatCompletion, isOllamaModel, isAlibabaModel } from './llm-client.ts';
import { DEFAULT_QUALITY_TEXT_MODEL } from './default-models.ts';

export const TEARDOWN_VERSION = 1;
const MAX_TRANSCRIPT_CHARS = 24_000;

export interface LlmTarget {
  model: string;
  openRouterApiKey?: string;
  /** Only vision-capable when we pick the model ourselves (OpenRouter). */
  supportsVision: boolean;
}

/**
 * Teardowns need a strong model: use the quality default on the org's
 * OpenRouter key; fall back to the org's own default model (Ollama/Alibaba orgs).
 */
export async function resolveTeardownLlm(supabase: SupabaseClient, orgId: string): Promise<LlmTarget> {
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('default_llm_model')
    .eq('organization_id', orgId)
    .maybeSingle();
  const orgModel: string | null = settings?.default_llm_model || null;

  if (orgModel && (isOllamaModel(orgModel) || isAlibabaModel(orgModel))) {
    return { model: orgModel, supportsVision: false };
  }
  const key = await resolveApiKey(supabase, orgId, 'openrouter');
  if (!key) throw new Error('Add an OpenRouter API key in Settings to analyze content.');
  return {
    model: DEFAULT_QUALITY_TEXT_MODEL,
    openRouterApiKey: await decryptApiKey(key.key_encrypted),
    supportsVision: true,
  };
}

/** Parse a JSON object out of an LLM reply (tolerates ```json fences / prose). */
export function parseJsonObject(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(body.slice(start, end + 1));
}

function formatSeconds(s: number | null | undefined): string {
  if (!s) return 'unknown';
  return s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}

const TEARDOWN_SYSTEM = `You are a content strategist who reverse-engineers high-performing social content so it can be reproduced as a repeatable formula.

Analyze the post you're given — its transcript/text, caption, engagement, and (if attached) its thumbnail/cover image — and return ONLY a JSON object with this shape:

{
  "format": "talking_head | voiceover_broll | screen_recording | tutorial | listicle | story | text_post | thread | carousel | image_post | meme | other",
  "summary": "one sentence: what the post is",
  "topic": "the specific subject of this post",
  "hook": { "text": "the exact opening line(s)", "type": "curiosity | contrarian | bold_claim | question | story | statistic | pain_point | result | other", "why_it_works": "..." },
  "structure": [ { "beat": "Hook", "purpose": "what this beat does for the viewer", "what_happens": "what is said/shown", "approx_seconds": 5 } ],
  "talking_points": ["..."],
  "ctas": [ { "text": "...", "type": "comment | follow | dm | link | save | share | subscribe | buy | other", "placement": "start | middle | end" } ],
  "engagement_drivers": ["psychological triggers / reasons people engaged"],
  "voice": "tone, point of view, sentence style, vocabulary level",
  "pacing": "rhythm, length of beats, cuts, pattern interrupts",
  "visual_style": "what's on screen / on the image: framing, text overlays, colors, layout, subject (say 'none' for pure text)",
  "audience": "who this is for",
  "why_it_worked": "2-3 sentences on the core mechanism",
  "formula": "the reusable pattern in one or two sentences, with the specifics abstracted away (e.g. 'Contrarian claim about X → 3 counter-intuitive lessons from personal failure → comment-keyword CTA')"
}

Rules:
- Quote the hook verbatim from the transcript/text when there is one.
- "structure" must cover the whole piece in order, 3-10 beats. approx_seconds only for video, else null.
- Be concrete; no generic marketing filler.`;

export interface TeardownInput {
  platform: string;
  title: string | null;
  description: string | null;
  transcript: string | null;
  thumbnail_url: string | null;
  /** Extra images (carousel slides, pasted post images); first 4 are sent. */
  image_urls?: string[];
  duration_seconds: number | null;
  engagement: any;
  author_name: string | null;
  published_at: string | null;
}

export interface TeardownOptions {
  /** Org ICPs/products (loadOrgFitContext) — adds a 0-10 "fit" rating to the teardown. */
  fitContext?: string | null;
  /** Marks teardowns produced by trending-auto-analyze (daily quota accounting). */
  auto?: boolean;
}

function fitInstructions(fitContext: string): string {
  return `

ALSO rate how worth copying this post is for the business below, and add to the JSON:
  "fit": { "score": 0-10, "reason": "one sentence" }
Score the TOPIC and the FORMAT together: 10 = its audience overlaps our ICPs and the format would work for our products; 5 = adjacent audience or only the format transfers; 0 = unrelated audience and a format we can't use.

OUR BUSINESS:
${fitContext}`;
}

/**
 * Compact summary of the org's ICPs and products for fit scoring, or null
 * when the org hasn't defined any (fit is then skipped).
 */
export async function loadOrgFitContext(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const [{ data: icps }, { data: products }] = await Promise.all([
    supabase
      .from('library_icps')
      .select('name, summary, description, pain_points, target_industries')
      .eq('organization_id', orgId)
      .limit(5),
    supabase
      .from('library_products')
      .select('name, description, key_benefits')
      .eq('organization_id', orgId)
      .limit(5),
  ]);
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 5).join('; ') : typeof v === 'string' ? v : '');
  const lines = [
    ...(icps || []).map((i) =>
      `- Audience "${i.name}": ${String(i.summary || i.description || '').slice(0, 300)}${list(i.pain_points) ? ` | pains: ${list(i.pain_points)}` : ''}${list(i.target_industries) ? ` | industries: ${list(i.target_industries)}` : ''}`),
    ...(products || []).map((p) =>
      `- Product "${p.name}": ${String(p.description || '').slice(0, 300)}${list(p.key_benefits) ? ` | benefits: ${list(p.key_benefits)}` : ''}`),
  ];
  return lines.length ? lines.join('\n').slice(0, 3000) : null;
}

export async function runTeardown(llm: LlmTarget, post: TeardownInput, opts: TeardownOptions = {}): Promise<Record<string, unknown>> {
  const transcript = post.transcript
    ? post.transcript.slice(0, MAX_TRANSCRIPT_CHARS) + (post.transcript.length > MAX_TRANSCRIPT_CHARS ? '\n[truncated]' : '')
    : null;
  const e = post.engagement || {};
  const userText = [
    `PLATFORM: ${post.platform}`,
    `AUTHOR: ${post.author_name || 'unknown'}`,
    `DURATION: ${formatSeconds(post.duration_seconds)}`,
    `ENGAGEMENT: views ${e.viewCount ?? 'n/a'}, likes ${e.likeCount ?? 'n/a'}, comments ${e.commentCount ?? 'n/a'}, shares ${e.shareCount ?? 'n/a'}`,
    post.title ? `TITLE: ${post.title}` : null,
    post.description ? `CAPTION / POST TEXT:\n${post.description.slice(0, 6000)}` : null,
    transcript ? `TRANSCRIPT:\n${transcript}` : 'TRANSCRIPT: none (analyze from the caption/text and image)',
  ].filter(Boolean).join('\n\n');

  const images = [...new Set([post.thumbnail_url, ...(post.image_urls || [])].filter((u): u is string => !!u))].slice(0, 4);
  const content: unknown = llm.supportsVision && images.length
    ? [
        { type: 'text', text: userText },
        ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
      ]
    : userText;

  const call = (msgContent: unknown) =>
    llmChatCompletion({
      model: llm.model,
      openRouterApiKey: llm.openRouterApiKey,
      messages: [
        { role: 'system', content: TEARDOWN_SYSTEM + (opts.fitContext ? fitInstructions(opts.fitContext) : '') },
        { role: 'user', content: msgContent },
      ],
      temperature: 0.3,
      max_tokens: 4000,
      timeoutMs: 90_000,
    });

  let result;
  try {
    result = await call(content);
  } catch (err) {
    // Scraped CDN images expire; retry text-only rather than failing the teardown.
    if (typeof content !== 'string' && /image|url|fetch|400/i.test(String(err))) {
      result = await call(userText);
    } else {
      throw err;
    }
  }

  const teardown = parseJsonObject(result.content);
  return {
    ...teardown,
    _meta: { version: TEARDOWN_VERSION, model: result.model, analyzed_at: new Date().toISOString(), ...(opts.auto ? { auto: true } : {}) },
  };
}

const POST_FIELDS =
  'id, organization_id, platform, title, description, transcript, transcript_preview, thumbnail_url, platform_data, duration_seconds, engagement, author_name, author_handle, published_at, url, ai_analysis, analyzed_at';

export async function loadPosts(supabase: SupabaseClient, ids: string[]) {
  const { data, error } = await supabase.from('research_content').select(POST_FIELDS).in('id', ids);
  if (error) throw new Error(error.message);
  return data || [];
}

/** Analyze a post (unless already analyzed and !force) and persist the teardown. */
export async function ensureTeardown(
  supabase: SupabaseClient,
  llm: LlmTarget,
  post: any,
  force = false,
  opts: TeardownOptions = {},
): Promise<Record<string, unknown>> {
  if (!force && post.analyzed_at && post.ai_analysis?._meta?.version === TEARDOWN_VERSION) return post.ai_analysis;

  const teardown = await runTeardown(llm, {
    ...post,
    transcript: post.transcript || post.transcript_preview,
    image_urls: Array.isArray(post.platform_data?.images) ? post.platform_data.images : [],
  }, opts);
  const { error } = await supabase
    .from('research_content')
    .update({ ai_analysis: teardown, analyzed_at: new Date().toISOString() })
    .eq('id', post.id);
  if (error) throw new Error(`Failed to save analysis: ${error.message}`);
  return teardown;
}
