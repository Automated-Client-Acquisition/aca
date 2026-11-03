/**
 * Custom Handler: Carousel Slides Stage
 *
 * Handles image generation for Instagram carousel slides.
 * This is a custom handler because:
 * - Generates multiple images (one per slide)
 * - Supports single slide regeneration
 * - Complex prompt building with visual style
 * - Reference image handling
 *
 * Uses OpenRouterImageProvider (synchronous) instead of the old ReplicateProvider
 * (async/webhook). Images are generated and uploaded immediately; the stage
 * returns status: 'completed' with real image_url values.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { OpenRouterImageProvider, DEFAULT_OPENROUTER_IMAGE_MODEL } from '../../providers/OpenRouterImageProvider.ts';

// Concurrency limit — keeps OpenRouter rate limits comfortable
const IMAGE_CONCURRENCY = 3;

// Aspect ratio mapping
const ASPECT_RATIO_MAP: Record<string, string> = {
  landscape: '16:9',
  portrait: '9:16',
  square: '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
};

/**
 * Build visual style suffix for image prompts.
 */
function buildVisualStyleSuffix(context: ExecutionContext): string {
  const parts: string[] = [];

  // Color palette
  if (context.brandVoice?.colorPalette?.length) {
    const colors = context.brandVoice.colorPalette;
    if (typeof colors[0] === 'string') {
      parts.push(`Color scheme: ${colors.join(', ')}`);
    }
  }

  // Font/typography style
  if (context.brandVoice?.fontStyle) {
    parts.push(`Typography: ${context.brandVoice.fontStyle}`);
  }

  // Visual mood
  if (context.visualStyle.mood) {
    parts.push(`Mood: ${context.visualStyle.mood}`);
  }

  // Style preset
  if (context.visualStyle.stylePreset) {
    parts.push(`Style: ${context.visualStyle.stylePreset}`);
  }

  return parts.length > 0 ? `. ${parts.join('. ')}.` : '';
}

/**
 * Build the full image prompt for a carousel slide.
 */
function buildSlidePrompt(
  slidePrompt: string,
  visualStyleSuffix: string,
  slideNumber: number,
  context: ExecutionContext,
  visualStorySummary?: string
): string {
  let prompt = slidePrompt;

  // Add slide context
  prompt = `Instagram carousel slide ${slideNumber}: ${prompt}`;

  // Add visual story coherence context
  if (visualStorySummary) {
    prompt = `[Visual Theme: ${visualStorySummary}] ${prompt}`;
  }

  // Add visual style
  if (visualStyleSuffix) {
    prompt += visualStyleSuffix;
  }

  // Add character consistency if available
  if (context.character?.visualDescription) {
    prompt += ` Character: ${context.character.visualDescription}.`;
  }

  return prompt;
}

/**
 * Process a batch of items in parallel with a concurrency ceiling.
 */
async function processBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<any>
): Promise<Array<{ index: number; result?: any; error?: Error }>> {
  const results: Array<{ index: number; result?: any; error?: Error }> = [];

  for (let start = 0; start < items.length; start += concurrency) {
    const batch = items.slice(start, start + concurrency);
    const settled = await Promise.allSettled(
      batch.map((item, batchIndex) => fn(item, start + batchIndex))
    );

    for (let i = 0; i < settled.length; i++) {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        results.push({ index: start + i, result: s.value });
      } else {
        results.push({ index: start + i, error: s.reason });
      }
    }
  }

  return results;
}

/**
 * Execute carousel slides generation.
 * Supports both full regeneration and single slide regeneration via context.regenerateScene.
 */
export async function executeCarouselSlidesHandler(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[CarouselSlidesHandler] Starting carousel slides generation...');
  console.log('[CarouselSlidesHandler] Reference images:', {
    count: context.referenceImages.length,
    images: context.referenceImages,
    modelConfig: context.modelConfig.imageLlm,
  });
  console.log('[CarouselSlidesHandler] Regeneration context:', {
    regenerateScene: context.regenerateScene,
    hasCustomPrompt: !!context.customPrompt,
    hasInstructions: !!context.instructions,
  });

  const supabase = engine.getSupabase();

  // Get OpenRouter API key
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  // Check for single slide regeneration
  if (context.regenerateScene !== undefined) {
    console.log(`[CarouselSlidesHandler] Single slide regeneration: slide ${context.regenerateScene}`);
    return regenerateSingleSlide(context, stageDef, engine);
  }

  // Get slide content from previous stage
  const carouselContent = context.previousStageOutputs.carousel_content;
  const slides = carouselContent?.slides || carouselContent?.scenes || [];

  if (!slides.length) {
    throw new Error('No slide content found from carousel_content stage');
  }

  console.log(`[CarouselSlidesHandler] Generating images for ${slides.length} slides`);

  // Get visual story summary if available
  const visualStorySummary = carouselContent?.visual_story_summary || '';
  if (visualStorySummary) {
    console.log(`[CarouselSlidesHandler] Visual story context: ${visualStorySummary.substring(0, 100)}...`);
  }

  // Build visual style
  const visualStyleSuffix = buildVisualStyleSuffix(context);
  console.log('[CarouselSlidesHandler] Visual style:', visualStyleSuffix);

  // Get model config
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;

  // Get aspect ratio
  const aspectRatio =
    ASPECT_RATIO_MAP[context.visualStyle.aspectRatio] ||
    context.visualStyle.aspectRatio ||
    '1:1';

  // Create OpenRouter image provider
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  // Generate images in parallel (with concurrency limit)
  const slideResults: Array<{
    slide_number: number;
    image_url: string | null;
    prompt: string;
    type: string;
    status: 'completed' | 'failed';
    error?: string;
  }> = [];

  const batchResults = await processBatch(slides, IMAGE_CONCURRENCY, async (slide: any) => {
    const slideNumber = slide.slide_number || slide.scene;
    const slidePrompt = slide.prompt || slide.image_prompt || '';

    if (!slidePrompt) {
      console.warn(`[CarouselSlidesHandler] Slide ${slideNumber} has no prompt, skipping`);
      return {
        slide_number: slideNumber,
        image_url: null,
        prompt: '',
        type: slide.type || 'content',
        status: 'failed' as const,
        error: 'No prompt available',
      };
    }

    // Build full prompt
    const fullPrompt = buildSlidePrompt(slidePrompt, visualStyleSuffix, slideNumber, context, visualStorySummary);

    console.log(`[CarouselSlidesHandler] Slide ${slideNumber} prompt:`, fullPrompt.substring(0, 100) + '...');

    // Generate and upload via OpenRouter (synchronous)
    const fileName = `carousel_${context.outputId}_slide_${slideNumber}_${Date.now()}.jpg`;
    const imageUrl = await provider.generateAndUpload(supabase, fullPrompt, modelId, {
      aspectRatio,
      fileName,
      referenceImages: context.referenceImages,
    });

    console.log(`[CarouselSlidesHandler] Slide ${slideNumber} image uploaded:`, imageUrl);

    return {
      slide_number: slideNumber,
      image_url: imageUrl,
      prompt: fullPrompt,
      type: slide.type || 'content',
      status: 'completed' as const,
    };
  });

  // Collect results
  for (const batchResult of batchResults) {
    const slide = slides[batchResult.index];
    const slideNumber = slide?.slide_number || slide?.scene || batchResult.index + 1;

    if (batchResult.result) {
      slideResults.push(batchResult.result);
    } else {
      const errorMessage = batchResult.error?.message || 'Unknown error';
      console.error(`[CarouselSlidesHandler] Slide ${slideNumber} failed:`, errorMessage);
      slideResults.push({
        slide_number: slideNumber,
        image_url: null,
        prompt: '',
        type: slide?.type || 'content',
        status: 'failed',
        error: errorMessage,
      });
    }
  }

  // Build result summary
  const completedCount = slideResults.filter((s) => s.status === 'completed').length;
  const failedCount = slideResults.filter((s) => s.status === 'failed').length;

  console.log(
    `[CarouselSlidesHandler] Completed ${completedCount} images, ${failedCount} failed`
  );

  return {
    content: {
      slides: slideResults.map((s) => ({
        slide_number: s.slide_number,
        image_url: s.image_url,
        prompt: s.prompt,
        type: s.type,
        status: s.status,
        ...(s.error ? { error: s.error } : {}),
      })),
      style: {
        aspectRatio,
        visualStyleSuffix,
      },
      model: modelId,
      completed_count: completedCount,
      failed_count: failedCount,
    },
    model: modelId,
    status: completedCount > 0 ? 'completed' : 'failed',
  };
}

/**
 * Regenerate a single slide image.
 * Used when context.regenerateScene is set.
 */
async function regenerateSingleSlide(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  const slideNumber = context.regenerateScene!;
  console.log(`[regenerateSingleSlide] Regenerating slide ${slideNumber}`);

  const supabase = engine.getSupabase();

  // Get OpenRouter API key
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  // Get existing slides from stage data
  const existingSlides = context.previousStageOutputs.carousel_slides?.slides || [];

  // Get the original prompt for this slide from carousel_content stage
  const carouselContent = context.previousStageOutputs.carousel_content;
  const slideContent = (carouselContent?.slides || carouselContent?.scenes || [])
    .find((s: any) => (s.slide_number || s.scene) === slideNumber);

  if (!slideContent && !context.customPrompt) {
    throw new Error(`Slide ${slideNumber} not found in carousel_content stage`);
  }

  // Build visual style
  const visualStyleSuffix = buildVisualStyleSuffix(context);

  // Get model config
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;

  // Get aspect ratio
  const aspectRatio =
    ASPECT_RATIO_MAP[context.visualStyle.aspectRatio] ||
    context.visualStyle.aspectRatio ||
    '1:1';

  // Determine the prompt to use
  let slidePrompt: string;
  if (context.customPrompt) {
    slidePrompt = context.customPrompt;
  } else {
    slidePrompt = slideContent?.prompt || slideContent?.image_prompt || '';
  }

  // Get visual story summary
  const visualStorySummary = carouselContent?.visual_story_summary || '';

  // Build the full prompt
  let fullPrompt = buildSlidePrompt(slidePrompt, visualStyleSuffix, slideNumber, context, visualStorySummary);

  // If instructions are provided, append them
  if (context.instructions && context.instructions.trim()) {
    fullPrompt = `${fullPrompt}. Additional instructions: ${context.instructions}`;
  }

  console.log(`[regenerateSingleSlide] Prompt for slide ${slideNumber}:`, fullPrompt.substring(0, 100) + '...');

  // Create OpenRouter image provider
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  try {
    // Generate and upload synchronously
    const fileName = `carousel_${context.outputId}_slide_${slideNumber}_regen_${Date.now()}.jpg`;
    const imageUrl = await provider.generateAndUpload(supabase, fullPrompt, modelId, {
      aspectRatio,
      fileName,
      referenceImages: context.referenceImages,
    });

    console.log(`[regenerateSingleSlide] Successfully regenerated slide ${slideNumber}:`, imageUrl);

    // Update the slide's image_url in stage_data immediately
    const { data: output } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();

    const currentStageData = output?.stage_data || {};
    const currentSlides = currentStageData.carousel_slides?.slides || existingSlides;
    const updatedSlides = currentSlides.map((s: any) =>
      s.slide_number === slideNumber
        ? {
            ...s,
            status: 'completed',
            image_url: imageUrl,
            prompt: fullPrompt,
          }
        : s
    );

    await supabase.from('content_outputs').update({
      stage_data: {
        ...currentStageData,
        carousel_slides: {
          ...currentStageData.carousel_slides,
          slides: updatedSlides,
        },
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
        style: {
          aspectRatio,
          visualStyleSuffix,
        },
        model: modelId,
        is_single_regeneration: true,
      },
      model: modelId,
      status: 'completed',
    };
  } catch (error) {
    console.error(`[regenerateSingleSlide] Error regenerating slide ${slideNumber}:`, error);
    return {
      content: {
        slides: [{
          slide_number: slideNumber,
          image_url: null,
          prompt: fullPrompt,
          type: slideContent?.type || 'content',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        }],
        is_single_regeneration: true,
      },
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default executeCarouselSlidesHandler;
