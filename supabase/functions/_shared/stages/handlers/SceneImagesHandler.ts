/**
 * Custom Handler: Scene Images Stage
 *
 * Handles image generation for video scenes (TikTok, YouTube Shorts).
 * This is a custom handler because:
 * - Generates multiple images (one per scene)
 * - Supports single scene regeneration
 * - Needs to maintain story consistency
 * - Portrait aspect ratio for vertical video
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

/**
 * Build scene image prompt with character, visual consistency, and story coherence.
 * Ensures the image visually represents the narration content (talking point alignment).
 */
function buildScenePrompt(
  scene: any,
  sceneNumber: number,
  context: ExecutionContext,
  totalScenes?: number,
  visualStorySummary?: string
): string {
  // Start with the scene's image prompt
  const sceneImagePrompt = scene.image_prompt || scene.prompt || '';
  console.log(`[buildScenePrompt] Scene ${sceneNumber} raw image_prompt:`, sceneImagePrompt ? sceneImagePrompt.substring(0, 100) : 'EMPTY/MISSING');

  let prompt = sceneImagePrompt;

  // Add scene context with story position
  const scenePosition = totalScenes
    ? `Scene ${sceneNumber} of ${totalScenes}`
    : `Scene ${sceneNumber}`;
  prompt = `${scenePosition} for vertical video: ${prompt}`;

  // Add visual story coherence context with style lock
  if (visualStorySummary) {
    prompt = `[STYLE LOCK — All scenes MUST match this visual style: ${visualStorySummary}] ${prompt}`;
  }

  // Add talking point alignment note if available
  if (scene.talking_point_covered) {
    prompt += ` [This scene visualizes: ${scene.talking_point_covered}]`;
  }

  // Add scene narration context for visual-narrative alignment
  if (scene.narration) {
    const narrationContext = scene.narration.length > 100
      ? scene.narration.substring(0, 100) + '...'
      : scene.narration;
    prompt += ` The image should visually represent: "${narrationContext}"`;
  }

  // Add character consistency
  if (context.character?.visualDescription) {
    prompt += ` The character: ${context.character.visualDescription}.`;
  }

  // Add brand visual style
  if (context.brandVoice?.colorPalette?.length) {
    const colors = context.brandVoice.colorPalette;
    if (typeof colors[0] === 'string') {
      prompt += ` Color palette: ${colors.slice(0, 3).join(', ')}.`;
    }
  }

  // Add mood
  if (context.visualStyle.mood) {
    prompt += ` Mood: ${context.visualStyle.mood}.`;
  }

  // Ensure cinematic quality and no text in images
  prompt += ' Cinematic lighting, professional quality, 9:16 vertical format. NO text, NO captions, NO speech bubbles in the image.';

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
 * Execute scene images generation.
 * Supports both full regeneration and single scene regeneration via context.regenerateScene.
 */
export async function executeSceneImagesHandler(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[SceneImagesHandler] Starting scene images generation...');
  console.log('[SceneImagesHandler] Regeneration context:', {
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

  // Check for single scene regeneration
  if (context.regenerateScene !== undefined) {
    console.log(`[SceneImagesHandler] Single scene regeneration: scene ${context.regenerateScene}`);
    return regenerateSingleScene(context, stageDef, engine);
  }

  // Get scenes from script stage (supports both 'script' and 'scenes' stage outputs)
  const scriptData = context.previousStageOutputs.script || context.previousStageOutputs.scenes;
  const rawScenes = scriptData?.scenes || [];

  // Debug: Log scene data to verify image_prompt is present
  console.log('[SceneImagesHandler] Previous stage outputs keys:', Object.keys(context.previousStageOutputs));
  console.log('[SceneImagesHandler] Script/Scenes data keys:', scriptData ? Object.keys(scriptData) : 'N/A');
  if (rawScenes.length > 0) {
    console.log('[SceneImagesHandler] First scene data:', JSON.stringify(rawScenes[0], null, 2));
    console.log('[SceneImagesHandler] First scene image_prompt:', rawScenes[0]?.image_prompt || 'MISSING');
  }

  if (!rawScenes.length) {
    throw new Error('No scenes found from script stage');
  }

  // Sort scenes by scene_number to ensure correct processing order
  const scenes = [...rawScenes].sort((a: any, b: any) => {
    const aNum = a.scene_number || a.scene || 0;
    const bNum = b.scene_number || b.scene || 0;
    return aNum - bNum;
  });

  // Get visual story summary for coherence
  const visualStorySummary = scriptData?.visual_story_summary || '';
  const totalScenes = scenes.length;

  console.log(`[SceneImagesHandler] Generating images for ${totalScenes} scenes`);
  if (visualStorySummary) {
    console.log(`[SceneImagesHandler] Visual story context: ${visualStorySummary.substring(0, 100)}...`);
  }

  // Get model config
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;

  // Get aspect ratio — priority: outputConfig > visualStyle > default 9:16 for video
  const aspectRatio = context.outputConfig?.aspectRatio || context.visualStyle?.aspectRatio || '9:16';
  console.log(`[SceneImagesHandler] Aspect ratio debug:`, {
    outputConfigAspectRatio: context.outputConfig?.aspectRatio,
    visualStyleAspectRatio: context.visualStyle?.aspectRatio,
    finalAspectRatio: aspectRatio,
  });

  // Create OpenRouter image provider
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  // Generate images in parallel (with concurrency limit)
  const sceneResults: Array<{
    scene_number: number;
    image_url: string | null;
    prompt: string;
    status: 'completed' | 'failed';
    error?: string;
    narration?: string;
    duration_seconds?: number;
  }> = [];

  const batchResults = await processBatch(scenes, IMAGE_CONCURRENCY, async (scene: any, i: number) => {
    const sceneNumber = scene.scene || scene.scene_number || i + 1;

    // Build full prompt with story coherence context
    const fullPrompt = buildScenePrompt(scene, sceneNumber, context, totalScenes, visualStorySummary);

    console.log(`[SceneImagesHandler] Scene ${sceneNumber} prompt:`, fullPrompt.substring(0, 150) + '...');

    // Generate and upload synchronously
    const fileName = `scene_${context.outputId}_scene_${sceneNumber}_${Date.now()}.jpg`;
    const imageUrl = await provider.generateAndUpload(supabase, fullPrompt, modelId, {
      aspectRatio,
      fileName,
      referenceImages: context.referenceImages,
    });

    console.log(`[SceneImagesHandler] Scene ${sceneNumber} image uploaded:`, imageUrl);

    return {
      scene_number: sceneNumber,
      image_url: imageUrl,
      prompt: fullPrompt,
      status: 'completed' as const,
      narration: scene.narration,
      duration_seconds: scene.duration_seconds,
    };
  });

  // Collect results
  for (const batchResult of batchResults) {
    const scene = scenes[batchResult.index];
    const sceneNumber = scene?.scene || scene?.scene_number || batchResult.index + 1;

    if (batchResult.result) {
      sceneResults.push(batchResult.result);
    } else {
      const errorMessage = batchResult.error?.message || 'Unknown error';
      console.error(`[SceneImagesHandler] Scene ${sceneNumber} failed:`, errorMessage);
      sceneResults.push({
        scene_number: sceneNumber,
        image_url: null,
        prompt: '',
        status: 'failed',
        error: errorMessage,
        narration: scene?.narration,
        duration_seconds: scene?.duration_seconds,
      });
    }
  }

  // Build result summary
  const completedCount = sceneResults.filter((s) => s.status === 'completed').length;
  const failedCount = sceneResults.filter((s) => s.status === 'failed').length;

  console.log(
    `[SceneImagesHandler] Completed ${completedCount} images, ${failedCount} failed`
  );

  return {
    content: {
      scenes: sceneResults.map((s) => ({
        scene_number: s.scene_number,
        image_url: s.image_url,
        prompt: s.prompt,
        status: s.status,
        narration: s.narration,
        duration_seconds: s.duration_seconds,
        ...(s.error ? { error: s.error } : {}),
      })),
      model: modelId,
      aspectRatio,
      completed_count: completedCount,
      failed_count: failedCount,
    },
    model: modelId,
    status: completedCount > 0 ? 'completed' : 'failed',
  };
}

/**
 * Regenerate a single scene image.
 * Used when context.regenerateScene is set.
 */
async function regenerateSingleScene(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  const sceneNumber = context.regenerateScene!;
  console.log(`[regenerateSingleScene] Regenerating scene ${sceneNumber}`);

  const supabase = engine.getSupabase();

  // Get OpenRouter API key
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  // Get existing scenes from stage data
  const existingScenes = context.previousStageOutputs.storyboard?.scenes ||
    context.previousStageOutputs.scene_images?.scenes || [];

  // Get the original scene data from script stage
  const scriptData = context.previousStageOutputs.script || context.previousStageOutputs.scenes;
  const scriptScenes = scriptData?.scenes || [];
  const scriptScene = scriptScenes.find((s: any) => (s.scene || s.scene_number) === sceneNumber);

  // Get visual story summary for coherence
  const visualStorySummary = scriptData?.visual_story_summary || '';
  const totalScenes = scriptScenes.length || existingScenes.length;

  if (!scriptScene && !context.customPrompt) {
    throw new Error(`Scene ${sceneNumber} not found in script stage`);
  }

  // Get model config
  const modelId =
    context.modelConfig.imageLlm?.modelId ||
    stageDef.providerConfig.model ||
    DEFAULT_OPENROUTER_IMAGE_MODEL;

  // Get aspect ratio — priority: outputConfig > visualStyle > default 9:16 for video
  const aspectRatio = context.outputConfig?.aspectRatio || context.visualStyle?.aspectRatio || '9:16';
  console.log(`[SceneImagesHandler] Using aspect ratio: ${aspectRatio}`);

  // Determine the prompt to use
  let scenePrompt: string;
  if (context.customPrompt) {
    scenePrompt = context.customPrompt;
  } else {
    scenePrompt = buildScenePrompt(scriptScene, sceneNumber, context, totalScenes, visualStorySummary);
  }

  // If instructions are provided, append them
  if (context.instructions && context.instructions.trim()) {
    scenePrompt = `${scenePrompt}. Additional instructions: ${context.instructions}`;
  }

  console.log(`[regenerateSingleScene] Prompt for scene ${sceneNumber}:`, scenePrompt.substring(0, 100) + '...');

  // Create OpenRouter image provider
  const provider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  try {
    // Generate and upload synchronously
    const fileName = `scene_${context.outputId}_scene_${sceneNumber}_regen_${Date.now()}.jpg`;
    const imageUrl = await provider.generateAndUpload(supabase, scenePrompt, modelId, {
      aspectRatio,
      fileName,
      referenceImages: context.referenceImages,
    });

    console.log(`[regenerateSingleScene] Successfully regenerated scene ${sceneNumber}:`, imageUrl);

    // Update scene's image_url in stage_data immediately
    const { data: output } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', context.outputId)
      .single();

    const currentStageData = output?.stage_data || {};
    const storyboardStageId = currentStageData.storyboard ? 'storyboard' : 'scene_images';
    const currentScenes = currentStageData[storyboardStageId]?.scenes || existingScenes;
    const updatedScenes = currentScenes.map((s: any) =>
      (s.scene_number === sceneNumber || s.scene === sceneNumber)
        ? {
            ...s,
            status: 'completed',
            image_url: imageUrl,
            prompt: scenePrompt,
          }
        : s
    );

    await supabase.from('content_outputs').update({
      stage_data: {
        ...currentStageData,
        [storyboardStageId]: {
          ...currentStageData[storyboardStageId],
          scenes: updatedScenes,
        },
      },
    }).eq('id', context.outputId);

    return {
      content: {
        scenes: [{
          scene_number: sceneNumber,
          image_url: imageUrl,
          prompt: scenePrompt,
          status: 'completed',
          narration: scriptScene?.narration,
        }],
        model: modelId,
        aspectRatio,
        is_single_regeneration: true,
      },
      model: modelId,
      status: 'completed',
    };
  } catch (error) {
    console.error(`[regenerateSingleScene] Error regenerating scene ${sceneNumber}:`, error);
    return {
      content: {
        scenes: [{
          scene_number: sceneNumber,
          image_url: null,
          prompt: scenePrompt,
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

export default executeSceneImagesHandler;
