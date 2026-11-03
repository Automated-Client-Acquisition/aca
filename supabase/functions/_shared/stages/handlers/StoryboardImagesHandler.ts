/**
 * Custom Handler: Storyboard Images Stage
 *
 * Generates scene images for the storyboard_video_longform pipeline using
 * OpenRouterImageProvider instead of the old ReplicateProvider.
 *
 * Key differences from old SceneImagesHandler:
 * - Uses OpenRouter (modalities: ["image"]) instead of Replicate Flux/SDXL
 * - Synchronous response — no webhooks or pending_predictions tracking needed
 * - Immediately uploads each image to Supabase Storage
 * - Returns scene array with completed image_url values (status: 'completed')
 *
 * Why OpenRouter instead of Replicate:
 * - No webhook endpoint required — synchronous base64 response
 * - Model-agnostic: swap flux.2-pro → gemini-2.5-flash-image-preview without code changes
 * - Single API key (same OPENROUTER key used for text generation)
 * - Predictable per-image pricing on OpenRouter dashboard
 * - No cold-start delays (Replicate GPU spin-up removed as a failure point)
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { OpenRouterImageProvider, DEFAULT_OPENROUTER_IMAGE_MODEL } from '../../providers/OpenRouterImageProvider.ts';

// Concurrency limit for parallel image generation
// OpenRouter supports concurrent requests; limit to avoid rate limits
const IMAGE_CONCURRENCY = 3;

/**
 * Build the full image prompt for a storyboard scene.
 * Adds visual style, story coherence context, and quality suffixes.
 */
function buildStoryboardImagePrompt(
  scene: any,
  sceneNumber: number,
  context: ExecutionContext,
  totalScenes: number,
  visualStorySummary?: string,
  aspectRatio?: string,
): string {
  const basePrompt: string = scene.image_prompt || scene.prompt || '';

  if (!basePrompt) {
    console.warn(`[StoryboardImagesHandler] Scene ${sceneNumber} has no image_prompt`);
  }

  // Tell the model the orientation so it composes the scene correctly
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '4:5';
  const orientationHint = isPortrait
    ? 'VERTICAL/PORTRAIT composition (taller than wide). '
    : '';

  let prompt = `${orientationHint}Scene ${sceneNumber} of ${totalScenes} for narrated video: ${basePrompt}`;

  // Add visual story coherence — lock all scenes to the same visual style
  if (visualStorySummary) {
    prompt = `[VISUAL STYLE LOCK — All scenes must match: ${visualStorySummary}] ${prompt}`;
  }

  // Add narration alignment context
  if (scene.narration) {
    const narrationSnippet =
      scene.narration.length > 120
        ? scene.narration.substring(0, 120) + '...'
        : scene.narration;
    prompt += ` Scene visually represents: "${narrationSnippet}"`;
  }

  // Brand color palette
  const palette = context.brandVoice?.colorPalette;
  if (Array.isArray(palette) && palette.length > 0) {
    const colors = (palette as string[]).slice(0, 3).join(', ');
    prompt += ` Color palette: ${colors}.`;
  }

  // Mood
  if (context.visualStyle?.mood) {
    prompt += ` Mood: ${context.visualStyle.mood}.`;
  }

  // Character visual consistency (if specified)
  if (context.character?.visualDescription) {
    prompt += ` Character appearance: ${context.character.visualDescription}.`;
  }

  // Quality suffix — no text in images
  prompt +=
    ' Cinematic quality, professional cinematography, shallow depth of field. ' +
    'NO text, NO words, NO captions, NO watermarks in the image.';

  return prompt;
}

/**
 * Process a batch of scenes in parallel with concurrency limiting.
 */
async function processBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<any>
): Promise<Array<{ index: number; result?: any; error?: Error }>> {
  const results: Array<{ index: number; result?: any; error?: Error }> = [];

  for (let start = 0; start < items.length; start += concurrency) {
    const batch = items.slice(start, start + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, batchIndex) => fn(item, start + batchIndex))
    );

    for (let i = 0; i < batchResults.length; i++) {
      const settled = batchResults[i];
      if (settled.status === 'fulfilled') {
        results.push({ index: start + i, result: settled.value });
      } else {
        results.push({ index: start + i, error: settled.reason });
      }
    }
  }

  return results;
}

/**
 * Execute storyboard image generation using OpenRouter.
 */
export async function executeStoryboardImagesStage(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[StoryboardImagesHandler] Starting storyboard image generation via OpenRouter');

  const supabase = engine.getSupabase();

  // 1. Get OpenRouter API key
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  // 2. Get scenes from previous stage (scenes stage or director shots with image_prompt)
  const scenesData = context.previousStageOutputs.scenes;
  const directorData = context.previousStageOutputs.director;

  let rawScenes: any[] = [];
  let visualStorySummarySource = '';

  if (scenesData?.scenes?.length) {
    // Standard path: scenes stage produced scene descriptions
    rawScenes = scenesData.scenes;
    visualStorySummarySource = scenesData.visual_story_summary || '';
  } else if (directorData?.shots?.length) {
    // Unified pipeline path: director shots contain image_prompt fields
    // Filter to only shots that need image generation
    const shotsWithPrompts = (directorData.shots as any[]).filter(
      (shot: any) => shot.image_prompt && shot.layout === 'scene_image'
    );

    if (shotsWithPrompts.length > 0) {
      rawScenes = shotsWithPrompts.map((shot: any, i: number) => ({
        scene_number: i + 1,
        image_prompt: shot.image_prompt,
        narration: shot.narration || '',
        duration_seconds: shot.duration || 5,
        camera_move: shot.camera?.move || 'ken_burns_slow',
      }));
      console.log(`[StoryboardImagesHandler] Using ${rawScenes.length} image_prompts from director shots`);
    }
  }

  if (!rawScenes.length) {
    throw new Error(
      'Image generation requires either scenes stage output or director shots with image_prompt fields'
    );
  }

  // Sort scenes by scene_number to ensure correct processing order
  const scenes = [...rawScenes].sort((a: any, b: any) => {
    const aNum = a.scene_number || a.scene || 0;
    const bNum = b.scene_number || b.scene || 0;
    return aNum - bNum;
  });

  const totalScenes = scenes.length;
  const visualStorySummary = visualStorySummarySource || scenesData?.visual_story_summary || '';

  console.log('[StoryboardImagesHandler] Generating images for', totalScenes, 'scenes');
  if (visualStorySummary) {
    console.log('[StoryboardImagesHandler] Visual story:', visualStorySummary.substring(0, 100) + '...');
  }

  // 3. Resolve image model
  const modelId: string =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;

  // 4. Resolve aspect ratio
  const aspectRatio: string =
    stageDef.providerConfig.aspectRatio ||
    context.outputConfig?.aspectRatio ||
    context.visualStyle?.aspectRatio ||
    '16:9';

  console.log('[StoryboardImagesHandler] Config:', {
    model: modelId,
    aspect_ratio: aspectRatio,
    concurrency: IMAGE_CONCURRENCY,
  });

  // 5. Create OpenRouter image provider
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  // 6. Generate images in parallel (with concurrency limit)
  const sceneResults: Array<{
    scene_number: number;
    image_url: string | null;
    prompt: string;
    status: 'completed' | 'failed';
    error?: string;
    narration?: string;
    duration_seconds?: number;
    camera_move?: string;
  }> = [];

  const batchResults = await processBatch(scenes, IMAGE_CONCURRENCY, async (scene: any, i: number) => {
    const sceneNumber: number = scene.scene_number || scene.scene || i + 1;

    const fullPrompt = buildStoryboardImagePrompt(
      scene,
      sceneNumber,
      context,
      totalScenes,
      visualStorySummary,
      aspectRatio
    );

    console.log(
      `[StoryboardImagesHandler] Scene ${sceneNumber} prompt:`,
      fullPrompt.substring(0, 120) + '...'
    );

    // Generate image via OpenRouter
    const fileName = `storyboard_${context.outputId}_scene_${sceneNumber}_${Date.now()}.jpg`;

    const imageUrl = await provider.generateAndUpload(
      supabase,
      fullPrompt,
      modelId,
      { aspectRatio, fileName, referenceImages: context.referenceImages }
    );

    console.log(`[StoryboardImagesHandler] Scene ${sceneNumber} image uploaded:`, imageUrl);

    return {
      scene_number: sceneNumber,
      image_url: imageUrl,
      prompt: fullPrompt,
      status: 'completed' as const,
      narration: scene.narration,
      duration_seconds: scene.duration_seconds || 5,
      camera_move: scene.camera_move || 'ken_burns_slow',
    };
  });

  // 7. Collect results
  for (const batchResult of batchResults) {
    const scene = scenes[batchResult.index];
    const sceneNumber = scene?.scene_number || scene?.scene || batchResult.index + 1;

    if (batchResult.result) {
      sceneResults.push(batchResult.result);
    } else {
      const errorMessage = batchResult.error?.message || 'Unknown error';
      console.error(`[StoryboardImagesHandler] Scene ${sceneNumber} failed:`, errorMessage);

      sceneResults.push({
        scene_number: sceneNumber,
        image_url: null,
        prompt: '',
        status: 'failed',
        error: errorMessage,
        narration: scene?.narration,
        duration_seconds: scene?.duration_seconds || 5,
        camera_move: scene?.camera_move || 'ken_burns_slow',
      });
    }
  }

  // Sort results by scene_number for consistent output
  sceneResults.sort((a, b) => a.scene_number - b.scene_number);

  // 8. Build summary
  const completedCount = sceneResults.filter((s) => s.status === 'completed').length;
  const failedCount = sceneResults.filter((s) => s.status === 'failed').length;

  console.log('[StoryboardImagesHandler] Complete:', {
    completed: completedCount,
    failed: failedCount,
    total: totalScenes,
  });

  // Fail if too many scenes failed (more than half)
  if (completedCount === 0) {
    return {
      content: {
        scenes: sceneResults,
        model: modelId,
        aspect_ratio: aspectRatio,
      },
      status: 'failed',
      error: 'All scene image generations failed',
    };
  }

  // 9. Return stage result
  // Status is 'completed' because all images are fully generated and uploaded
  // (unlike the old Replicate flow which returned 'pending' for webhook processing)
  return {
    content: {
      scenes: sceneResults,
      model: modelId,
      aspect_ratio: aspectRatio,
      total_scenes: totalScenes,
      completed_count: completedCount,
      failed_count: failedCount,
      visual_story_summary: visualStorySummary,
    },
    model: modelId,
    status: completedCount > 0 ? 'completed' : 'failed',
  };
}

export default executeStoryboardImagesStage;
