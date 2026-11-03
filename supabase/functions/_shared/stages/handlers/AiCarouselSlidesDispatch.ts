/**
 * Dispatcher: AI Carousel Slides
 *
 * The `instagram_carousel_ai` slide stage points here. It routes to the right
 * image engine based on the blueprint's image_generator provider:
 *   - OpenAI (gpt-5.5)  -> OpenAICarouselSlidesHandler  (native multiturn thread)
 *   - OpenRouter/Gemini -> GeminiCarouselSlidesHandler   (reference-threaded slides)
 *
 * The routing predicate (carouselImageProviderIsOpenAI) is shared with
 * dispatch-generation-job's API-key pre-check so the key it demands always
 * matches the engine that actually runs. GPT-5.5 is the default when nothing is
 * pinned, preserving the pipeline's original behavior.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { carouselImageProviderIsOpenAI } from '../../default-models.ts';
import { executeOpenAICarouselSlidesHandler } from './OpenAICarouselSlidesHandler.ts';
import { executeGeminiCarouselSlidesHandler } from './GeminiCarouselSlidesHandler.ts';

export async function executeAiCarouselSlidesStage(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine,
): Promise<StageResult> {
  const imageCfg = context.modelConfig.imageLlm;
  const useOpenAI = carouselImageProviderIsOpenAI(imageCfg);
  console.log(
    `[AiCarouselSlides] Routing to ${useOpenAI ? 'OpenAI (gpt-5.5 multiturn)' : 'Gemini (OpenRouter)'} ` +
    `— provider=${imageCfg?.provider ?? '(unset)'} model=${imageCfg?.modelId ?? '(unset)'}`,
  );
  return useOpenAI
    ? executeOpenAICarouselSlidesHandler(context, stageDef, engine)
    : executeGeminiCarouselSlidesHandler(context, stageDef, engine);
}

export default executeAiCarouselSlidesStage;
