/**
 * Instagram Carousel (AI Images) Pipeline — instagram_carousel_ai
 *
 * Same caption as the template carousel (the blueprint prompt via the legacy
 * text path, not registered here), but the slide images are
 * AI-generated via GPT-5.5 native multiturn (Responses API) instead of branded
 * Satori templates. Each slide is threaded to the previous one so characters and
 * style stay consistent across the deck.
 *
 * Unlike the template carousel (which renders headline/body text directly), the
 * AI image handler needs an IMAGE PROMPT per slide. So this pipeline uses its own
 * content stage (CAROUSEL_CONTENT_AI_STAGE) that emits both the slide text
 * (headline/body) AND an `image_prompt` per slide, built from the blueprint's
 * visual style ({{imagePromptTemplate}}). Without that prompt the slide handler
 * fails every slide with "No prompt available".
 *
 * Stages:
 * 1. caption          - the blueprint prompt's post (legacy executeTextStage)
 * 2. carousel_content - slide text content + per-slide image_prompt
 * 3. carousel_slides  - AI image per slide via OpenAICarouselSlidesHandler
 */

import { StageRegistry, defineStage } from '../../execution/StageRegistry.ts';
import { DEFAULT_FREE_TEXT_MODEL } from '../../default-models.ts';
import { CONTENT_AI_PROMPT } from '../../carousel/prompts.ts';
import { DEFAULT_OPENAI_IMAGE_MODEL } from '../../providers/OpenAIImageProvider.ts';

// ============= CAROUSEL CONTENT STAGE (AI variant, also emits image_prompt) =============
// Cuts the post into slides like the template carousel's content stage, but every slide
// also carries an `image_prompt` for the AI image handler. The handler validates
// the deck and fills in a basic prompt for any slide the model skipped.
export const CAROUSEL_CONTENT_AI_STAGE = defineStage({
  id: 'carousel_content',
  type: 'text',
  provider: 'openrouter',
  requires: {
    previousStages: ['caption'],
  },
  promptTemplate: CONTENT_AI_PROMPT,
  providerConfig: {
    model: DEFAULT_FREE_TEXT_MODEL,
    temperature: 0.7,
    // Room for a reasoning model to think and still answer (see instagram_carousel.ts).
    maxTokens: 8192,
  },
  customHandler: 'executeCarouselContentStage',
  outputTransform: 'parseCarouselContent',
});

// AI slide image stage — dispatches by the blueprint's image_generator provider:
// OpenAI (gpt-5.5 native multiturn) or OpenRouter/Gemini (reference-threaded).
export const AI_CAROUSEL_SLIDES_STAGE = defineStage({
  id: 'carousel_slides',
  type: 'image',
  provider: 'openai_image',
  requires: {
    previousStages: ['carousel_content'],
    libraryElements: ['brandVoice'],
  },
  providerConfig: {
    model: DEFAULT_OPENAI_IMAGE_MODEL,
  },
  isAsync: false,
  customHandler: 'executeAiCarouselSlidesStage',
});

export function registerInstagramCarouselAiStages(): void {
  // The caption runs on the legacy text path; the AI content stage also emits image_prompt.
  StageRegistry.register('instagram_carousel_ai', CAROUSEL_CONTENT_AI_STAGE);
  StageRegistry.register('instagram_carousel_ai', AI_CAROUSEL_SLIDES_STAGE);

  console.log('[StageDefinitions] Registered instagram_carousel_ai stages');
}

registerInstagramCarouselAiStages();

export default {
  CAROUSEL_CONTENT_AI_STAGE,
  AI_CAROUSEL_SLIDES_STAGE,
};
