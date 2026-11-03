/**
 * Instagram Carousel Pipeline Stage Definitions
 *
 * Stages of the instagram_carousel pipeline (order in execute-stage PIPELINE_STAGES):
 * 1. caption - NOT registered here on purpose: it runs the legacy executeTextStage,
 *    the same call as a social_media_post caption, so the blueprint prompt alone
 *    writes the post (no carousel prompt underneath it)
 * 2. carousel_content - cut that post into slide copy (cover, one slide per point, CTA)
 * 3. carousel_slides - Render branded slide images via Satori + resvg-wasm (synchronous)
 */

import type { StageDefinition } from '../../execution/types.ts';
import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL } from '../../default-models.ts';
import { CONTENT_PROMPT } from '../../carousel/prompts.ts';

// ============= CAROUSEL CONTENT STAGE (the post, cut into slides) =============

export const CAROUSEL_CONTENT_STAGE = defineStage({
  id: 'carousel_content',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['caption'],
  },
  promptTemplate: CONTENT_PROMPT,
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.7,
    // Same budget as the caption stage. Reasoning models (deepseek-v4.1-flash)
    // spend max_tokens on thinking first: at 3500 they came back empty.
    maxTokens: 8192,
  },
  // The handler validates and normalizes the deck (with one retry); the transform
  // is only the fallback if the handler were ever not registered.
  customHandler: 'executeCarouselContentStage',
  outputTransform: 'parseCarouselContent',
});

// ============= CAROUSEL SLIDES STAGE (Template Renderer) =============

export const CAROUSEL_SLIDES_STAGE = defineStage({
  id: 'carousel_slides',
  type: 'image',
  provider: 'template',
  requires: {
    previousStages: ['carousel_content'],
    libraryElements: ['brandVoice'],
  },
  providerConfig: {
    model: 'satori/resvg-wasm',
  },
  isAsync: false,
});

// ============= REGISTER ALL STAGES =============

export function registerInstagramCarouselStages(): void {
  StageRegistry.register('instagram_carousel', CAROUSEL_CONTENT_STAGE);
  StageRegistry.register('instagram_carousel', CAROUSEL_SLIDES_STAGE);

  console.log('[StageDefinitions] Registered instagram_carousel stages');
}

// Auto-register on import
registerInstagramCarouselStages();

export default {
  CAROUSEL_CONTENT_STAGE,
  CAROUSEL_SLIDES_STAGE,
};
