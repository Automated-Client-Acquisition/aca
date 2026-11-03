// Reverse-engineer 1-5 scraped posts into a reusable blueprint.
//
// Each post gets a teardown (reused if already analyzed), then one LLM pass
// abstracts the shared formula into a blueprint whose prompts only use
// variables the generation pipeline resolves (_shared/blueprint-variables.ts).
// Saved tagged "reverse-engineered" and opened in the editor for review. Not
// is_active=false: the app hides inactive blueprints everywhere (no UI to
// re-activate), and a blueprint only runs when someone picks it anyway.
//
// Body: { content_ids: string[] (1-5), pipeline?: string, name?: string }
// Returns: { blueprint_id, name, pipeline }

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { ensureTeardown, loadPosts, parseJsonObject, resolveTeardownLlm, type LlmTarget } from '../_shared/content-teardown.ts';
import { llmChatCompletion } from '../_shared/llm-client.ts';
import {
  deriveSlots,
  describeVariablesForPrompt,
  findSingleBracePlaceholders,
  findUnbalancedSections,
  findUnknownVariables,
} from '../_shared/blueprint-variables.ts';
import { DEFAULT_IMAGE_MODEL, DEFAULT_QUALITY_TEXT_MODEL } from '../_shared/default-models.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// What master_prompt drives in each pipeline — the pipeline's own stages handle
// output formatting, so the blueprint describes content, not JSON shapes.
const PIPELINE_GUIDE: Record<string, { label: string; guide: string; usesImagePrompt: boolean; usesDirectorPrompt: boolean }> = {
  social_media_post: {
    label: 'Social Media Post (caption + one generated image)',
    guide: 'master_prompt instructs a writer to produce the post text/caption. image_prompt describes the single accompanying image.',
    usesImagePrompt: true,
    usesDirectorPrompt: false,
  },
  rich_article: {
    label: 'Rich Article (long-form text)',
    guide: 'master_prompt instructs a writer to produce a long-form piece (article, newsletter, LinkedIn long post).',
    usesImagePrompt: false,
    usesDirectorPrompt: false,
  },
  twitter_thread: {
    label: 'X / Twitter thread',
    guide: 'master_prompt instructs a writer to produce a multi-tweet thread; describe what each tweet in the sequence does.',
    usesImagePrompt: false,
    usesDirectorPrompt: false,
  },
  instagram_carousel: {
    label: 'Instagram Carousel (text slides on branded templates)',
    guide: 'master_prompt instructs a writer to produce slide-by-slide copy (cover slide, content slides, CTA slide). Design comes from the brand template, so do not describe visuals.',
    usesImagePrompt: false,
    usesDirectorPrompt: false,
  },
  instagram_carousel_ai: {
    label: 'Instagram Carousel (each slide an AI image)',
    guide: 'master_prompt instructs a writer to produce slide-by-slide copy. image_prompt describes the consistent visual style every slide image shares.',
    usesImagePrompt: true,
    usesDirectorPrompt: false,
  },
  video: {
    label: 'Video (AI narration + visuals)',
    guide: 'master_prompt instructs a scriptwriter to produce the spoken narration, beat by beat with rough timings. director_prompt gives visual/editing direction (pacing, on-screen text, shot types). Use {{video_duration}} for length.',
    usesImagePrompt: false,
    usesDirectorPrompt: true,
  },
};

function suggestPipeline(posts: any[]): string {
  const p = posts[0];
  const format = p.ai_analysis?.format;
  if (['youtube', 'youtube-shorts', 'tiktok'].includes(p.platform)) return 'video';
  if (p.platform === 'instagram') {
    if (p.transcript || ['talking_head', 'voiceover_broll', 'screen_recording', 'tutorial'].includes(format)) return 'video';
    return format === 'carousel' ? 'instagram_carousel_ai' : 'social_media_post';
  }
  if (p.platform === 'twitter') return format === 'thread' ? 'twitter_thread' : 'social_media_post';
  return 'social_media_post';
}

/** Inherit the org's model choices from its latest blueprint on the same pipeline. */
async function resolveModelConfig(supabase: SupabaseClient, orgId: string, pipeline: string) {
  const { data } = await supabase
    .from('blueprints')
    .select('model_config')
    .eq('organization_id', orgId)
    .eq('pipeline', pipeline)
    .not('model_config', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.model_config && Object.keys(data.model_config).length > 0) return data.model_config;

  const config: Record<string, unknown> = {
    text_llm: { model_id: DEFAULT_QUALITY_TEXT_MODEL, provider: 'openrouter', parameters: {} },
  };
  if (PIPELINE_GUIDE[pipeline]?.usesImagePrompt) {
    config.image_generator = { model_id: DEFAULT_IMAGE_MODEL, provider: 'openrouter', parameters: {} };
  }
  if (pipeline === 'video') {
    config.tts = { model_id: 'eleven_v3', provider: 'elevenlabs', parameters: {} };
    config.video_config_defaults = {
      source: 'prompt_only',
      imageMode: 'ai_generated',
      voiceMode: 'voiceover',
      orientation: 'portrait',
      subtitleStyle: 'tiktok_bounce',
    };
  }
  return config;
}

function buildSystemPrompt(pipeline: string): string {
  const p = PIPELINE_GUIDE[pipeline];
  return `You turn teardowns of high-performing posts into a reusable content BLUEPRINT for an AI content generator.

A blueprint is a prompt template. At generation time the user supplies a NEW idea (a different topic, their own brand, product and audience), the template's {{variables}} are filled in, and the result is sent to a writer model. The blueprint must reproduce the FORMULA of the source posts — hook style, beat structure, pacing, voice, CTA mechanics, visual treatment — while every specific (the source topic, names, numbers, the creator's product/story) becomes a variable.

TARGET PIPELINE: ${p.label}
${p.guide}

AVAILABLE VARIABLES — use ONLY these, spelled exactly, with double braces:
${describeVariablesForPrompt()}

RULES
1. Always build the piece around {{topic}}. Use {{ai_hook}}, {{ai_talking_points}} and {{ai_cta}} where the formula has a hook, body points and a CTA — tell the writer to adapt them into the formula, not to paste them.
2. Every library you reference (brand/character/product/icp) outside its own section (rule 3) becomes a REQUIRED pick when someone generates with this blueprint; one referenced only inside its own section stays optional. Reference one only when the formula depends on it: {{brand.tone}}/{{brand.style_guidelines}} for voice and {{icp.pain_points}}/{{icp.language_style}} for audience are usually worth it; product only if the formula is product-centric; character only for persona-driven content.
3. Use plain {{variable}} substitution. For lines that only make sense when an optional library element is selected, wrap them in a section on one of its listed variables: {{#product.name}}Show how {{product.name}} solves this.{{/product.name}} renders only when a product is selected, {{^product.name}}...{{/product.name}} only when none is. Section names must be listed variables; no loops. Never invent new variables, never use single braces, never leave [placeholders] or <placeholders> for the user to fill.
4. Never copy the source topic, the creator's name, their product, their specific numbers, or any people, companies, studies or tools they mention into any prompt. Short structural examples are fine if clearly marked as examples of the pattern and free of those specifics.
4b. Proof and credibility beats must draw on what the generation receives ({{ai_talking_points}}, {{idea_text}}, {{product.*}}). Never instruct the writer to cite studies, statistics, case studies, quotes or results it wasn't given. master_prompt must include this line verbatim: "NEVER FABRICATE: do not invent statistics, studies, quotes, client names, case-study results or personal anecdotes that were not provided above. If no real proof point is available, drop that beat rather than making one up."
5. Write master_prompt as direct instructions to the writer: goal, the beat-by-beat structure with what each beat must accomplish (and target length/timing), hook rules, voice and pacing rules, CTA rules, and things to avoid. Be specific enough that two different topics come out recognisably in the same format.
6. Do not specify an output JSON format — the pipeline handles formatting.
${p.usesImagePrompt ? '7. image_prompt: describe the visual treatment observed in the source (composition, subject, text overlay style, palette, mood) as a reusable style that adapts to {{topic}}.' : '7. image_prompt: return null.'}
${p.usesDirectorPrompt ? '8. director_prompt: visual and editing direction for the video (shot types, on-screen text, cut rhythm, pattern interrupts).' : '8. director_prompt: return null.'}

Return ONLY JSON:
{
  "name": "short blueprint name describing the format, e.g. 'Contrarian lesson carousel'",
  "description": "1-2 sentences: what this blueprint produces and the formula it follows",
  "master_prompt": "...",
  "image_prompt": "..." or null,
  "director_prompt": "..." or null,
  "tags": ["3-6 lowercase tags describing format/style"]
}`;
}

function describePosts(posts: any[], teardowns: Record<string, unknown>[]): string {
  return posts.map((p, i) => {
    const e = p.engagement || {};
    return `### SOURCE POST ${i + 1} (${p.platform}, by ${p.author_handle || p.author_name || 'unknown'}; views ${e.viewCount ?? 'n/a'}, likes ${e.likeCount ?? 'n/a'}, comments ${e.commentCount ?? 'n/a'})
TEARDOWN:
${JSON.stringify({ ...teardowns[i], _meta: undefined }, null, 2)}

${p.transcript ? `TRANSCRIPT (excerpt):\n${String(p.transcript).slice(0, 4000)}` : `POST TEXT:\n${String(p.description || p.title || '').slice(0, 4000)}`}`;
  }).join('\n\n');
}

async function synthesize(llm: LlmTarget, pipeline: string, posts: any[], teardowns: Record<string, unknown>[]) {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: buildSystemPrompt(pipeline) },
    {
      role: 'user',
      content: `${posts.length > 1 ? `Extract the formula these ${posts.length} posts share (ignore what is unique to one post).` : 'Extract the formula of this post.'}\n\n${describePosts(posts, teardowns)}`,
    },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await llmChatCompletion({
      model: llm.model,
      openRouterApiKey: llm.openRouterApiKey,
      messages,
      temperature: 0.4,
      max_tokens: 6000,
      timeoutMs: 120_000,
    });
    const draft = parseJsonObject(result.content);
    const guide = PIPELINE_GUIDE[pipeline];
    draft.image_prompt = guide.usesImagePrompt ? draft.image_prompt || null : null;
    draft.director_prompt = guide.usesDirectorPrompt ? draft.director_prompt || null : null;

    const problems: string[] = [];
    if (!draft.master_prompt || typeof draft.master_prompt !== 'string') problems.push('master_prompt is missing.');
    const unknown = findUnknownVariables(draft.master_prompt, draft.image_prompt, draft.director_prompt);
    if (unknown.length) problems.push(`These variables do not exist: ${unknown.join(', ')}. Use only the listed variables.`);
    const unbalanced = findUnbalancedSections(draft.master_prompt, draft.image_prompt, draft.director_prompt);
    if (unbalanced.length) problems.push(`These section tags are not closed/opened correctly: ${unbalanced.join(', ')}. Every {{#x}} or {{^x}} needs a matching {{/x}}.`);
    const singles = findSingleBracePlaceholders(draft.master_prompt, draft.image_prompt, draft.director_prompt);
    if (singles.length) problems.push(`Single-brace placeholders never resolve: ${singles.join(', ')}. Use {{double braces}} with a listed variable.`);
    if (draft.master_prompt && !/\{\{\s*topic\s*\}\}/.test(draft.master_prompt)) problems.push('master_prompt must use {{topic}}.');

    if (problems.length === 0) return draft;
    console.warn(`[reverse-engineer-blueprint] attempt ${attempt + 1} rejected:`, problems);
    messages.push(
      { role: 'assistant', content: result.content },
      { role: 'user', content: `Fix these problems and return the full JSON again:\n- ${problems.join('\n- ')}` },
    );
  }
  throw new Error('Could not produce a blueprint that only uses supported variables. Try again.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let body: { content_ids?: string[]; pipeline?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const ids = body.content_ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 5) {
    return json({ error: 'Select between 1 and 5 posts' }, 400);
  }
  if (body.pipeline && !PIPELINE_GUIDE[body.pipeline]) {
    return json({ error: `Unsupported pipeline: ${body.pipeline}` }, 400);
  }

  try {
    const posts = await loadPosts(supabase, ids);
    if (posts.length === 0) return json({ error: 'Content not found' }, 404);
    const orgIds = [...new Set(posts.map((p) => p.organization_id))];
    if (orgIds.length > 1) return json({ error: 'Posts belong to different organizations' }, 400);
    const orgId = orgIds[0];

    let userId: string | null = null;
    try {
      await assertOrgAccess(req, supabase, orgId);
      if (!isServiceRoleRequest(req)) userId = (await authenticateRequest(req, supabase)).user_id;
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }

    const llm = await resolveTeardownLlm(supabase, orgId);
    const teardowns = await Promise.all(posts.map((p) => ensureTeardown(supabase, llm, p)));
    posts.forEach((p, i) => (p.ai_analysis = teardowns[i]));

    const pipeline = body.pipeline || suggestPipeline(posts);
    const draft = await synthesize(llm, pipeline, posts, teardowns);

    const creators = [...new Set(posts.map((p) => p.author_handle || p.author_name).filter(Boolean))];
    const tags = [...new Set([
      'reverse-engineered',
      ...(Array.isArray(draft.tags) ? draft.tags.map((t: unknown) => String(t).toLowerCase()) : []),
      ...posts.map((p) => p.platform),
    ])].slice(0, 10);

    const baseName = body.name?.trim() || draft.name || 'Reverse-engineered blueprint';
    const modelConfig = await resolveModelConfig(supabase, orgId, pipeline);
    const insertBlueprint = (name: string) => supabase
      .from('blueprints')
      .insert({
        organization_id: orgId,
        created_by: userId,
        name,
        description: draft.description || null,
        pipeline,
        master_prompt: draft.master_prompt,
        image_prompt: draft.image_prompt,
        director_prompt: draft.director_prompt,
        model_config: modelConfig,
        structure: {
          slots: deriveSlots(draft.master_prompt, draft.image_prompt, draft.director_prompt),
          source: {
            type: 'reverse_engineered',
            content_ids: posts.map((p) => p.id),
            creators,
            urls: posts.map((p) => p.url),
            created_at: new Date().toISOString(),
          },
        },
        tags,
        is_active: true,
      })
      .select('id, name, pipeline')
      .single();

    // Names are unique per org (blueprints_organization_name_unique): suffix on collision.
    let { data: blueprint, error } = await insertBlueprint(baseName);
    for (let n = 2; error?.code === '23505' && n <= 20; n++) {
      ({ data: blueprint, error } = await insertBlueprint(`${baseName} (${n})`));
    }
    if (error || !blueprint) throw new Error(`Failed to save blueprint: ${error?.message}`);

    return json({ blueprint_id: blueprint.id, name: blueprint.name, pipeline: blueprint.pipeline });
  } catch (err) {
    console.error('[reverse-engineer-blueprint]', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
