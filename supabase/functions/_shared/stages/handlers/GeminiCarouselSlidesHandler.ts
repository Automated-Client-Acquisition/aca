/**
 * Custom Handler: AI Carousel Slides (Gemini / Nano Banana reference-threaded)
 *
 * The OpenRouter/Gemini counterpart to OpenAICarouselSlidesHandler. Gemini image
 * models have no server-side conversation thread (no `previous_response_id`), so
 * cross-slide consistency is achieved by RE-FEEDING prior slides back in as
 * reference images: each slide is conditioned on the cover (global style anchor)
 * and the immediately-previous slide (local continuity), plus any blueprint-level
 * reference images (product/character/brand). A carousel-specific reference
 * instruction tells the model to match style/palette/typography WITHOUT copying
 * the reference slides' text or composition.
 *
 * Because the "thread state" is just the slide image URLs — which we already
 * persist to content_outputs.stage_data — resume-after-timeout is naturally
 * durable (no external response id to expire). Generation is sequential so each
 * slide can see the one before it; a time budget hands back a `partial` result
 * for the content-pipeline worker to continue, mirroring the OpenAI handler.
 *
 * Selected when the blueprint's image_generator provider is OpenRouter (or a
 * `vendor/model` slug). The GPT-5.5 path stays in OpenAICarouselSlidesHandler.
 */

import { ROLE_INSTRUCTION, ROLE_TITLE, type ResolvedReference } from '../../image-references.ts';
import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import {
  OpenRouterImageProvider,
  DEFAULT_OPENROUTER_IMAGE_MODEL,
} from '../../providers/OpenRouterImageProvider.ts';

// Semantic aspect ratio passthrough (OpenRouter maps these to dimensions).
const ASPECT_RATIO_MAP: Record<string, string> = {
  landscape: '16:9',
  portrait: '4:5',
  square: '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
};

// Max reference images to thread per slide. Gemini accepts more, but the
// OpenRouter provider already caps at 4 and a tight set keeps the model focused
// on style continuity rather than collaging prior slides.
const MAX_REFERENCES = 4;

// Logo appears on the cover (first/hook) and the CTA slide only — body slides stay clean.
function isLogoSlide(slide: any, slideNumber: number): boolean {
  return slide?.type === 'cover' || slide?.type === 'cta' || slideNumber === 1;
}

// Appended to the prompt on logo slides so the model reproduces the attached logo.
const LOGO_PROMPT_SUFFIX =
  ' A brand logo image is attached as a reference. Reproduce the real provided logo small and clean ' +
  'in a consistent corner, like a stamped signature, never the hero element. Do not redraw, restyle, ' +
  'or invent a logo.';

// Compose the reference-image preamble from what's actually attached to this slide.
// Counteracts the provider's default "use as composition" preamble.
function buildRefInstruction(hasPriorSlide: boolean, hasLogo: boolean, roles?: ResolvedReference[]): string | undefined {
  const parts: string[] = [];
  if (hasPriorSlide) {
    parts.push(
      'Some reference images are EARLIER SLIDES of this same Instagram carousel. Match their visual ' +
      'style, color palette, typography, and layout so the deck looks like one cohesive set. Do NOT ' +
      "copy their text or composition — render only THIS slide's own text and content.",
    );
  }
  if (hasLogo) {
    parts.push(
      'One reference image is the brand LOGO: reproduce it exactly, small, in a consistent corner like ' +
      'a stamped signature. Do not redraw, restyle, or invent a logo.',
    );
  }
  // Blueprint references with roles (product / person / style).
  if (roles?.length) {
    parts.push(
      'The other reference images are: ' +
      roles.map((r) => `${ROLE_TITLE[r.role]} "${r.label}": ${ROLE_INSTRUCTION[r.role]}`).join(' '),
    );
  }
  return parts.length ? parts.join(' ') : undefined;
}

function buildVisualStyleSuffix(context: ExecutionContext): string {
  const parts: string[] = [];
  const palette = context.brandVoice?.colorPalette;
  if (Array.isArray(palette) && palette.length > 0 && typeof palette[0] === 'string') {
    parts.push(`Color scheme: ${palette.join(', ')}`);
  }
  if (context.brandVoice?.fontStyle) parts.push(`Typography: ${context.brandVoice.fontStyle}`);
  if (context.visualStyle.mood) parts.push(`Mood: ${context.visualStyle.mood}`);
  if (context.visualStyle.stylePreset) parts.push(`Style: ${context.visualStyle.stylePreset}`);
  return parts.length > 0 ? `. ${parts.join('. ')}.` : '';
}

function buildSlidePrompt(
  slidePrompt: string,
  visualStyleSuffix: string,
  slideNumber: number,
  context: ExecutionContext,
  visualStorySummary?: string,
): string {
  let prompt = `Instagram carousel slide ${slideNumber}: ${slidePrompt}`;
  if (visualStorySummary) prompt = `[Visual Theme: ${visualStorySummary}] ${prompt}`;
  if (visualStyleSuffix) prompt += visualStyleSuffix;
  if (context.character?.visualDescription) {
    prompt += ` Character: ${context.character.visualDescription}.`;
  }
  return prompt;
}

/**
 * Synthesize an image prompt from a slide's TEXT content (headline/body/type) plus
 * the blueprint's visual style — used when carousel_content emitted text only.
 * Mirrors the OpenAI handler so both engines behave identically on legacy content.
 */
function synthesizeSlidePromptFromContent(slide: any, context: ExecutionContext): string {
  const headline = (slide.headline || '').trim();
  const body = (slide.body || '').trim();
  const type = slide.type || 'content';
  const ctaButton = (slide.cta_button_text || slide.ctaText || '').trim();

  if (!headline && !body) return '';

  let prompt = `A polished, post-ready Instagram carousel ${type} slide as a single unified composition (NOT a collage).`;
  if (headline) {
    prompt += ` Render the headline text "${headline}" prominently as bold, legible typography.`;
  }
  if (body) {
    prompt += ` Include the supporting text "${body}" in a clearly readable layout.`;
  }
  if (type === 'cta' && ctaButton) {
    prompt += ` Show a clear call-to-action button reading "${ctaButton}".`;
  }

  const styleTemplate = (context.imagePromptTemplate || '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (styleTemplate) {
    prompt += ` Visual style: ${styleTemplate}`;
  }

  return prompt;
}

/** Dedup-preserving order, drop falsy, cap to MAX_REFERENCES. First = highest priority. */
function buildReferenceSet(urls: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

export async function executeGeminiCarouselSlidesHandler(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  if (context.regenerateScene !== undefined) {
    return regenerateSingleSlide(context, stageDef, engine);
  }
  return executeSequential(context, stageDef, engine);
}

async function executeSequential(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  console.log('[GeminiCarousel] Starting Gemini reference-threaded carousel generation...');

  const supabase = engine.getSupabase();
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured. Add it in Settings > API Keys.');
  }

  const carouselContent = context.previousStageOutputs.carousel_content;
  const slides = carouselContent?.slides || carouselContent?.scenes || [];
  if (!slides.length) {
    throw new Error('No slide content found from carousel_content stage');
  }

  const visualStorySummary = carouselContent?.visual_story_summary || '';
  const visualStyleSuffix = buildVisualStyleSuffix(context);
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;
  const aspectRatio =
    ASPECT_RATIO_MAP[context.visualStyle.aspectRatio] ||
    context.visualStyle.aspectRatio ||
    '1:1';
  const logo = (context.brandVoice as any)?.logo as string | undefined;
  // Non-logo brand assets (product/character/brand-style) ride on every slide for
  // consistency; the logo is gated to cover + CTA, so strip it from the general set.
  const otherRefs = (context.referenceImages || []).filter((u) => u !== logo);
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  const slideNumOf = (s: any) => s.slide_number ?? s.scene ?? 0;
  const total = slides.length;

  // ── Resume support ──────────────────────────────────────────────────────
  // Rebuild already-completed slides from persisted stage_data so a re-invoked
  // run skips them and threads off their stored image URLs.
  const resultsByNumber = new Map<number, any>();
  for (const s of (context.previousStageOutputs.carousel_slides?.slides || [])) {
    if (s && s.image_url && s.status === 'completed') resultsByNumber.set(slideNumOf(s), s);
  }

  // Cover = lowest-numbered completed slide; prev = highest-numbered completed slide.
  const completedNums = [...resultsByNumber.keys()].sort((a, b) => a - b);
  let coverUrl: string | undefined = completedNums.length
    ? resultsByNumber.get(completedNums[0])?.image_url
    : undefined;
  let prevUrl: string | undefined = completedNums.length
    ? resultsByNumber.get(completedNums[completedNums.length - 1])?.image_url
    : undefined;

  const orderedResults = () =>
    slides.map((sl: any) => resultsByNumber.get(slideNumOf(sl))).filter(Boolean);

  const buildContent = (extra: Record<string, any> = {}) => {
    const ordered = orderedResults();
    const completed = ordered.filter((s: any) => s.status === 'completed').length;
    return {
      slides: ordered,
      style: { aspectRatio, visualStyleSuffix },
      model: modelId,
      provider: 'openrouter',
      completed_count: completed,
      failed_count: ordered.length - completed,
      ...extra,
    };
  };

  // Persist progress so it survives a timeout and is visible in the UI. Merges any
  // slides a concurrent run finished (read-modify-write is otherwise last-write-wins).
  const persistProgress = async () => {
    const { data: out } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();
    const sd = out?.stage_data || {};
    for (const s of (sd.carousel_slides?.slides || [])) {
      if (s && s.image_url && s.status === 'completed' && !resultsByNumber.has(slideNumOf(s))) {
        resultsByNumber.set(slideNumOf(s), s);
      }
    }
    const ordered = orderedResults();
    const completed = ordered.filter((s: any) => s.status === 'completed').length;
    await supabase
      .from('content_outputs')
      .update({
        status: 'generating',
        stage_data: {
          ...sd,
          carousel_slides: {
            ...(sd.carousel_slides || {}),
            slides: ordered,
            style: { aspectRatio, visualStyleSuffix },
            model: modelId,
            provider: 'openrouter',
            completed_count: completed,
            failed_count: ordered.length - completed,
            completed_batches: completed,
            total_batches: total,
            status: 'generating',
          },
        },
      })
      .eq('id', context.outputId);
  };

  // Keep each edge invocation under the 150s platform limit. Gemini slides are
  // fast (~5-15s), so several fit per run; we check the budget before STARTING a
  // new slide once we've produced at least one this run.
  const BUDGET_MS = 55_000;
  const startedAt = Date.now();

  const pending = slides.filter((sl: any) => !resultsByNumber.has(slideNumOf(sl)));
  console.log(
    `[GeminiCarousel] ${resultsByNumber.size}/${total} slides already done; generating ${pending.length} more`,
  );

  let processedThisRun = 0;
  for (const slide of pending) {
    if (processedThisRun >= 1 && Date.now() - startedAt > BUDGET_MS) {
      console.log('[GeminiCarousel] Time budget reached — returning partial for worker continuation');
      return {
        content: buildContent({
          partial: true,
          completed_batches: orderedResults().filter((s: any) => s.status === 'completed').length,
          total_batches: total,
        }),
        model: modelId,
        status: 'generating',
      };
    }

    const slideNumber = slideNumOf(slide);
    const slidePrompt =
      slide.prompt || slide.image_prompt || synthesizeSlidePromptFromContent(slide, context);
    if (!slidePrompt) {
      resultsByNumber.set(slideNumber, {
        slide_number: slideNumber,
        image_url: null,
        prompt: '',
        type: slide.type || 'content',
        status: 'failed',
        error: 'No prompt available',
      });
      await persistProgress();
      continue;
    }

    const fullPrompt = buildSlidePrompt(slidePrompt, visualStyleSuffix, slideNumber, context, visualStorySummary);
    const logoRef = (isLogoSlide(slide, slideNumber) && logo) ? logo : undefined;
    // Logo first so it survives the 4-image cap on logo slides; never on body slides.
    const references = buildReferenceSet([logoRef, prevUrl, coverUrl, ...otherRefs]);
    const promptForGen = logoRef ? `${fullPrompt}${LOGO_PROMPT_SUFFIX}` : fullPrompt;

    try {
      const fileName = `carousel_${context.outputId}_slide_${slideNumber}_${Date.now()}.jpg`;
      const imageUrl = await provider.generateAndUpload(supabase, promptForGen, modelId, {
        aspectRatio,
        fileName,
        referenceImages: references,
        referenceInstruction: buildRefInstruction(Boolean(prevUrl || coverUrl), !!logoRef, context.referenceRoles),
      });

      resultsByNumber.set(slideNumber, {
        slide_number: slideNumber,
        image_url: imageUrl,
        prompt: fullPrompt,
        type: slide.type || 'content',
        status: 'completed',
      });
      // Thread forward: this slide anchors the next; the first becomes the cover.
      prevUrl = imageUrl;
      if (!coverUrl) coverUrl = imageUrl;
      console.log(`[GeminiCarousel] Slide ${slideNumber} uploaded (${references.length} refs):`, imageUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[GeminiCarousel] Slide ${slideNumber} failed:`, message);
      resultsByNumber.set(slideNumber, {
        slide_number: slideNumber,
        image_url: null,
        prompt: fullPrompt,
        type: slide.type || 'content',
        status: 'failed',
        error: message,
      });
    }

    processedThisRun++;
    await persistProgress();
  }

  const content = buildContent();
  return {
    content,
    model: modelId,
    status: content.completed_count > 0 ? 'completed' : 'failed',
  };
}

async function regenerateSingleSlide(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  const slideNumber = context.regenerateScene!;
  console.log(`[GeminiCarousel] Regenerating slide ${slideNumber}`);

  const supabase = engine.getSupabase();
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured. Add it in Settings > API Keys.');
  }

  const carouselContent = context.previousStageOutputs.carousel_content;
  const slideContent = (carouselContent?.slides || carouselContent?.scenes || [])
    .find((s: any) => (s.slide_number || s.scene) === slideNumber);
  if (!slideContent && !context.customPrompt) {
    throw new Error(`Slide ${slideNumber} not found in carousel_content stage`);
  }

  const existingSlides = context.previousStageOutputs.carousel_slides?.slides || [];
  // Anchor consistency on the cover + the slide immediately before this one.
  const completed = existingSlides.filter((s: any) => s.image_url && s.status === 'completed');
  const coverUrl = completed
    .slice()
    .sort((a: any, b: any) => (a.slide_number || 0) - (b.slide_number || 0))[0]?.image_url;
  const prevUrl = completed
    .filter((s: any) => (s.slide_number || 0) < slideNumber)
    .sort((a: any, b: any) => (b.slide_number || 0) - (a.slide_number || 0))[0]?.image_url;

  const visualStyleSuffix = buildVisualStyleSuffix(context);
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;
  const aspectRatio =
    ASPECT_RATIO_MAP[context.visualStyle.aspectRatio] ||
    context.visualStyle.aspectRatio ||
    '1:1';

  const slidePrompt =
    context.customPrompt ||
    slideContent?.prompt ||
    slideContent?.image_prompt ||
    synthesizeSlidePromptFromContent(slideContent || {}, context);
  let fullPrompt = buildSlidePrompt(slidePrompt, visualStyleSuffix, slideNumber, context, carouselContent?.visual_story_summary || '');
  if (context.instructions?.trim()) {
    fullPrompt = `${fullPrompt}. Additional instructions: ${context.instructions}`;
  }

  const logo = (context.brandVoice as any)?.logo as string | undefined;
  const otherRefs = (context.referenceImages || []).filter((u) => u !== logo);
  const logoRef = (isLogoSlide(slideContent || {}, slideNumber) && logo) ? logo : undefined;
  const references = buildReferenceSet([logoRef, prevUrl, coverUrl, ...otherRefs]);
  const promptForGen = logoRef ? `${fullPrompt}${LOGO_PROMPT_SUFFIX}` : fullPrompt;
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  try {
    const fileName = `carousel_${context.outputId}_slide_${slideNumber}_regen_${Date.now()}.jpg`;
    const imageUrl = await provider.generateAndUpload(supabase, promptForGen, modelId, {
      aspectRatio,
      fileName,
      referenceImages: references,
      referenceInstruction: buildRefInstruction(Boolean(prevUrl || coverUrl), !!logoRef, context.referenceRoles),
    });

    const { data: output } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();
    const currentStageData = output?.stage_data || {};
    const currentSlides = currentStageData.carousel_slides?.slides || existingSlides;
    const updatedSlides = currentSlides.map((s: any) =>
      s.slide_number === slideNumber
        ? { ...s, status: 'completed', image_url: imageUrl, prompt: fullPrompt }
        : s,
    );
    await supabase.from('content_outputs').update({
      stage_data: {
        ...currentStageData,
        carousel_slides: { ...currentStageData.carousel_slides, slides: updatedSlides },
      },
    }).eq('id', context.outputId);

    return {
      content: {
        slides: [{
          slide_number: slideNumber,
          image_url: imageUrl,
          prompt: fullPrompt,
          type: slideContent?.type || 'content',
          status: 'completed',
        }],
        style: { aspectRatio, visualStyleSuffix },
        model: modelId,
        provider: 'openrouter',
        is_single_regeneration: true,
      },
      model: modelId,
      status: 'completed',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: {
        slides: [{
          slide_number: slideNumber,
          image_url: null,
          prompt: fullPrompt,
          type: slideContent?.type || 'content',
          status: 'failed',
          error: message,
        }],
        is_single_regeneration: true,
      },
      status: 'failed',
      error: message,
    };
  }
}

export default executeGeminiCarouselSlidesHandler;
