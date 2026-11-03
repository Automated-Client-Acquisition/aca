/**
 * Custom Handler: AI Carousel Slides (GPT-5.5 multiturn)
 *
 * Used by the `instagram_carousel_ai` pipeline. Generates each slide as an
 * AI image via OpenAI's Responses API (image_generation tool). Slide 1 starts
 * a fresh response; each later slide passes the previous slide's response id as
 * previous_response_id, so GPT-5.5 retains the full thread (text + images it
 * already drew) and keeps character/style/composition consistent across the
 * whole deck. This is native multiturn — no manual re-feeding of images.
 *
 * The template-rendered carousel (Satori) lives in the separate
 * `instagram_carousel` pipeline and is handled by execute-stage's
 * template_renderer path. These two never mix.
 */

import { referencesAsText } from '../../image-references.ts';
import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import {
  OpenAIImageProvider,
  DEFAULT_OPENAI_IMAGE_MODEL,
  type GeneratedImage,
  type OpenAIImageOptions,
} from '../../providers/OpenAIImageProvider.ts';

const ASPECT_RATIO_MAP: Record<string, string> = {
  landscape: '16:9',
  // A portrait carousel is a 4:5 feed post, not a 9:16 story.
  portrait: '4:5',
  square: '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
};

// Appended to the prompt on slides that carry the brand logo (cover + CTA) so the
// model reproduces the attached logo instead of inventing one.
const LOGO_PROMPT_SUFFIX =
  ' A brand logo image is attached as a reference. Reproduce the real provided logo small and clean in a consistent corner, like a stamped signature, never the hero element. Do not redraw, restyle, or invent a logo.';

// Logo appears on the cover (first/hook) and the CTA slide only — body slides stay clean.
function isLogoSlide(slide: any, slideNumber: number): boolean {
  return slide?.type === 'cover' || slide?.type === 'cta' || slideNumber === 1;
}

// Blueprint references with roles ride on the first image of a thread (no
// previous response); later slides inherit them through the conversation.
// Role images come first so the numbered instructions match their order.
function withRoleReferences(
  context: ExecutionContext,
  prompt: string,
  logoRefs: string[],
  previousResponseId: string | undefined,
): { prompt: string; referenceImages: string[] | undefined } {
  const roles = context.referenceRoles ?? [];
  const attach = !previousResponseId && roles.length > 0;
  const refs = [...(attach ? roles.flatMap((r) => r.urls) : []), ...logoRefs];
  return {
    prompt: attach ? `${referencesAsText(roles)}\n\n${prompt}` : prompt,
    referenceImages: refs.length ? refs : undefined,
  };
}

function buildVisualStyleSuffix(context: ExecutionContext): string {
  const parts: string[] = [];
  if (context.brandVoice?.colorPalette?.length) {
    const colors = context.brandVoice.colorPalette;
    if (typeof colors[0] === 'string') parts.push(`Color scheme: ${colors.join(', ')}`);
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
  if (isFeedPortrait(context)) prompt += FEED_PORTRAIT_SAFE_AREA;
  return prompt;
}

// OpenAI only draws portrait at 2:3 (1024x1536), and Instagram shows carousel
// posts at 4:5, trimming about 8% off the top and bottom. Keep text clear of it.
const FEED_PORTRAIT_SAFE_AREA =
  ' Canvas: tall 2:3 image that will be shown cropped to 4:5, so the top 8% and bottom 8% get cut off. Keep every word, number, logo and key element inside the central 4:5 area; only background may extend into the top and bottom strips.';

function isFeedPortrait(context: ExecutionContext): boolean {
  const ar = context.visualStyle.aspectRatio;
  return ar === 'portrait' || ar === '4:5' || ar === 'vertical';
}

/**
 * Synthesize an image prompt from a slide's TEXT content (headline/body/type) plus
 * the blueprint's visual style. Used when the carousel_content stage produced text
 * only (no explicit image_prompt) — which is the case for the live legacy content
 * stage. Returns '' only when the slide has no usable text at all.
 *
 * The generated prompt describes a finished, post-ready slide that RENDERS the
 * slide's text, so the AI image is the slide itself (matching how the branded
 * template carousel works). Brand colors are appended separately via
 * buildVisualStyleSuffix, so the blueprint style template only needs to cover
 * composition/mood; any unresolved {{placeholders}} are stripped.
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

  // Blueprint-defined visual style (strip any unresolved {{variables}}).
  const styleTemplate = (context.imagePromptTemplate || '')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (styleTemplate) {
    prompt += ` Visual style: ${styleTemplate}`;
  }

  return prompt;
}

function buildOpenAIOptions(context: ExecutionContext): OpenAIImageOptions {
  const params = (context.modelConfig.imageLlm as any)?.parameters || {};
  return {
    aspectRatio:
      ASPECT_RATIO_MAP[context.visualStyle.aspectRatio] ||
      context.visualStyle.aspectRatio ||
      '1:1',
    quality: params.quality,
    background: params.background,
    outputFormat: params.output_format || params.outputFormat,
  };
}

export async function executeOpenAICarouselSlidesHandler(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  if (context.regenerateScene !== undefined) {
    return regenerateSingleSlide(context, stageDef, engine);
  }
  return executeMultiturn(context, stageDef, engine);
}

async function executeMultiturn(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  console.log('[OpenAICarousel] Starting GPT-5.5 multiturn carousel generation...');

  const supabase = engine.getSupabase();
  const openaiKey = context.apiKeys.openai;
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured. Add it in Settings > API Keys.');
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
    DEFAULT_OPENAI_IMAGE_MODEL;
  const baseOptions = buildOpenAIOptions(context);
  const provider = new OpenAIImageProvider(openaiKey);
  const logo = (context.brandVoice as any)?.logo as string | undefined;

  const aspectRatio = baseOptions.aspectRatio;
  const slideNumOf = (s: any) => s.slide_number ?? s.scene ?? 0;
  const total = slides.length;

  // ── Resume support ──────────────────────────────────────────────────────
  // A 5-slide deck (sequential multiturn) can exceed the edge function's 150s
  // limit. We persist each slide as it's drawn and, when a time budget is hit,
  // return a `partial` result so the content-pipeline worker re-invokes us. On
  // re-invocation we skip already-completed slides and RESUME the multiturn
  // chain from the last completed slide's response_id, preserving consistency.
  const resultsByNumber = new Map<number, any>();
  for (const s of (context.previousStageOutputs.carousel_slides?.slides || [])) {
    if (s && s.image_url && s.status === 'completed') resultsByNumber.set(slideNumOf(s), s);
  }

  // Resume the chain from the highest-numbered completed slide.
  let previousResponseId: string | undefined;
  let resumeFrom = -1;
  for (const s of resultsByNumber.values()) {
    if (s.response_id && slideNumOf(s) > resumeFrom) {
      resumeFrom = slideNumOf(s);
      previousResponseId = s.response_id;
    }
  }

  const orderedResults = () =>
    slides.map((sl: any) => resultsByNumber.get(slideNumOf(sl))).filter(Boolean);

  const buildContent = (extra: Record<string, any> = {}) => {
    const ordered = orderedResults();
    const completed = ordered.filter((s) => s.status === 'completed').length;
    return {
      slides: ordered,
      style: { aspectRatio, visualStyleSuffix },
      model: modelId,
      provider: 'openai',
      completed_count: completed,
      failed_count: ordered.length - completed,
      ...extra,
    };
  };

  // Persist current progress so it survives a timeout and is visible in the UI.
  const persistProgress = async () => {
    const { data: out } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();
    const sd = out?.stage_data || {};
    // Merge any slides a concurrent run finished so we never clobber them
    // (read-modify-write is otherwise last-write-wins and can drop slides).
    for (const s of (sd.carousel_slides?.slides || [])) {
      if (s && s.image_url && s.status === 'completed' && !resultsByNumber.has(slideNumOf(s))) {
        resultsByNumber.set(slideNumOf(s), s);
      }
    }
    const ordered = orderedResults();
    const completed = ordered.filter((s) => s.status === 'completed').length;
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
            provider: 'openai',
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

  // Keep each edge invocation comfortably under the 150s platform limit. When
  // exceeded we hand back a partial result and execute-stage self-chains the next
  // link. ~55s budget ≈ one ~57s slide per invocation, with wide margin.
  const BUDGET_MS = 55_000;
  const startedAt = Date.now();

  const pending = slides.filter((sl: any) => !resultsByNumber.has(slideNumOf(sl)));
  console.log(
    `[OpenAICarousel] ${resultsByNumber.size}/${total} slides already done; ` +
    `generating ${pending.length} more (resuming chain from slide ${resumeFrom})`,
  );

  let processedThisRun = 0;
  for (const slide of pending) {
    // Don't START a new slide once the budget is spent — return partial instead.
    if (processedThisRun >= 1 && Date.now() - startedAt > BUDGET_MS) {
      console.log('[OpenAICarousel] Time budget reached — returning partial for worker continuation');
      return {
        content: buildContent({
          partial: true,
          completed_batches: orderedResults().filter((s) => s.status === 'completed').length,
          total_batches: total,
        }),
        model: modelId,
        status: 'generating',
      };
    }

    const slideNumber = slideNumOf(slide);
    // Prefer an explicit image prompt; otherwise synthesize one from the slide's
    // text content + blueprint style (the live content stage emits text only).
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
    const wantsLogo = isLogoSlide(slide, slideNumber) && !!logo;
    const promptForGen = wantsLogo ? `${fullPrompt}${LOGO_PROMPT_SUFFIX}` : fullPrompt;

    try {
      const withRefs = withRoleReferences(context, promptForGen, wantsLogo ? [logo as string] : [], previousResponseId);
      const image: GeneratedImage = await provider.generate(withRefs.prompt, modelId, {
        ...baseOptions,
        previousResponseId,
        referenceImages: withRefs.referenceImages,
      });

      const fileName = `carousel_${context.outputId}_slide_${slideNumber}_${Date.now()}.png`;
      const imageUrl = await OpenAIImageProvider.uploadBase64ToStorage(
        supabase,
        image.base64,
        fileName,
        image.mimeType,
      );

      if (image.responseId) previousResponseId = image.responseId;

      resultsByNumber.set(slideNumber, {
        slide_number: slideNumber,
        image_url: imageUrl,
        prompt: fullPrompt,
        type: slide.type || 'content',
        status: 'completed',
        response_id: image.responseId,
      });
      console.log(`[OpenAICarousel] Slide ${slideNumber} uploaded:`, imageUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OpenAICarousel] Slide ${slideNumber} failed:`, message);
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
  console.log(`[OpenAICarousel] Regenerating slide ${slideNumber}`);

  const supabase = engine.getSupabase();
  const openaiKey = context.apiKeys.openai;
  if (!openaiKey) {
    throw new Error('OpenAI API key not configured. Add it in Settings > API Keys.');
  }

  const carouselContent = context.previousStageOutputs.carousel_content;
  const slideContent = (carouselContent?.slides || carouselContent?.scenes || [])
    .find((s: any) => (s.slide_number || s.scene) === slideNumber);
  if (!slideContent && !context.customPrompt) {
    throw new Error(`Slide ${slideNumber} not found in carousel_content stage`);
  }

  const existingSlides = context.previousStageOutputs.carousel_slides?.slides || [];
  // Resume the multiturn thread from the slide before this one so the
  // regenerated slide stays consistent. Falls back to a fresh response.
  const priorSlide = existingSlides
    .filter((s: any) => (s.slide_number || 0) < slideNumber && s.response_id)
    .sort((a: any, b: any) => (b.slide_number || 0) - (a.slide_number || 0))[0];
  const previousResponseId: string | undefined = priorSlide?.response_id;

  const visualStyleSuffix = buildVisualStyleSuffix(context);
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENAI_IMAGE_MODEL;
  const options = buildOpenAIOptions(context);

  const slidePrompt =
    context.customPrompt ||
    slideContent?.prompt ||
    slideContent?.image_prompt ||
    synthesizeSlidePromptFromContent(slideContent || {}, context);
  let fullPrompt = buildSlidePrompt(slidePrompt, visualStyleSuffix, slideNumber, context, carouselContent?.visual_story_summary || '');
  if (context.instructions?.trim()) {
    fullPrompt = `${fullPrompt}. Additional instructions: ${context.instructions}`;
  }

  const provider = new OpenAIImageProvider(openaiKey);
  const logo = (context.brandVoice as any)?.logo as string | undefined;
  const wantsLogo = isLogoSlide(slideContent || {}, slideNumber) && !!logo;
  const promptForGen = wantsLogo ? `${fullPrompt}${LOGO_PROMPT_SUFFIX}` : fullPrompt;

  try {
    const withRefs = withRoleReferences(context, promptForGen, wantsLogo ? [logo as string] : [], previousResponseId);
    const image: GeneratedImage = await provider.generate(withRefs.prompt, modelId, {
      ...options,
      previousResponseId,
      referenceImages: withRefs.referenceImages,
    });

    const fileName = `carousel_${context.outputId}_slide_${slideNumber}_regen_${Date.now()}.png`;
    const imageUrl = await OpenAIImageProvider.uploadBase64ToStorage(
      supabase,
      image.base64,
      fileName,
      image.mimeType,
    );

    const { data: output } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();
    const currentStageData = output?.stage_data || {};
    const currentSlides = currentStageData.carousel_slides?.slides || existingSlides;
    const updatedSlides = currentSlides.map((s: any) =>
      s.slide_number === slideNumber
        ? { ...s, status: 'completed', image_url: imageUrl, prompt: fullPrompt, response_id: image.responseId }
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
        style: { aspectRatio: options.aspectRatio, visualStyleSuffix },
        model: modelId,
        provider: 'openai',
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

export default executeOpenAICarouselSlidesHandler;
