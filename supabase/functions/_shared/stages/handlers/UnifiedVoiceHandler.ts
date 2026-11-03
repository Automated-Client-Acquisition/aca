/**
 * Custom Handler: Unified Voice Stage
 *
 * Routes voice generation for the unified `video` pipeline based on VideoConfig.
 * Voice runs AFTER the director — reads narration from director.full_script or director.shots.
 *
 * Routing logic:
 * - If imageMode === 'ai_generated' (storyboard flow): delegates to StoryboardVoiceoverHandler
 *   (produces section_segments needed for image timing alignment)
 * - Otherwise: delegates to PresenterVoiceHandler (standard TTS + optional avatar)
 *
 * Script source (priority):
 * - director.full_script (new director-first architecture)
 * - rewrite.text (rewrite mode)
 * - outline.sections (backward compat with old jobs)
 *
 * This handler is a thin router — all actual TTS/avatar logic lives in the existing handlers.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { executeStoryboardVoiceoverStage } from './StoryboardVoiceoverHandler.ts';
import { executeVoiceAvatarStage } from './PresenterVoiceHandler.ts';

/**
 * Execute unified voice stage for the video pipeline.
 *
 * Routes to StoryboardVoiceoverHandler when imageMode=ai_generated
 * (needs section_segments for precise image timing), otherwise to
 * PresenterVoiceHandler (standard TTS + optional avatar).
 */
export async function executeUnifiedVoiceStage(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  console.log('[UnifiedVoiceHandler] Starting unified voice stage');

  const rawConfig = context.rawConfiguration || {};
  const rawParams = context.rawGenerationParams || {};
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};

  const imageMode: string = videoConfig.imageMode || videoConfig.image_mode || 'none';

  console.log('[UnifiedVoiceHandler] Routing decision:', {
    imageMode,
    hasDirector: !!context.previousStageOutputs.director,
    hasRewrite: !!context.previousStageOutputs.rewrite,
    hasOutline: !!context.previousStageOutputs.outline,
  });

  if (imageMode === 'ai_generated') {
    // Storyboard flow: needs section_segments for image timing
    // StoryboardVoiceoverHandler reads from director.shots or outline.sections (backward compat)
    console.log('[UnifiedVoiceHandler] Routing to StoryboardVoiceoverHandler (ai_generated images need section segments)');
    return executeStoryboardVoiceoverStage(context, stageDef, engine);
  }

  // Standard flow: TTS + optional avatar
  // PresenterVoiceHandler reads from director.full_script or rewrite/outline (backward compat)
  console.log('[UnifiedVoiceHandler] Routing to PresenterVoiceHandler (standard TTS + optional avatar)');
  return executeVoiceAvatarStage(context, stageDef, engine);
}

export default executeUnifiedVoiceStage;
