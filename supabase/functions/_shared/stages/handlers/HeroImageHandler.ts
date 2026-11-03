/**
 * HeroImageHandler
 *
 * Custom handler for blog article hero image generation.
 * Generates an image prompt from the article outline, then submits to OpenRouter
 * for synchronous generation and immediate upload to Supabase Storage.
 *
 * Flow:
 * 1. Get outline from previous stage
 * 2. Generate image prompt from outline title/topic via OpenRouter text LLM
 * 3. Apply visual style from brand voice
 * 4. Generate image via OpenRouterImageProvider (synchronous — no webhook needed)
 * 5. Return completed stage result with image_url
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';
import { OpenRouterImageProvider, DEFAULT_OPENROUTER_IMAGE_MODEL } from '../../providers/OpenRouterImageProvider.ts';
import { OpenRouterProvider } from '../../providers/OpenRouterProvider.ts';
import { DEFAULT_FREE_TEXT_MODEL } from '../../default-models.ts';

export async function executeHeroImageHandler(
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[HeroImageHandler] Starting hero image generation');

  const supabase = engine.getSupabase();

  // 1. Get outline data from previous stage
  const outlineData = context.previousStageOutputs['outline'];
  if (!outlineData) {
    throw new Error('Hero image stage requires outline stage to be completed first');
  }

  const articleTitle = outlineData.title || outlineData.content?.title || '';
  const metaDescription = outlineData.meta_description || outlineData.content?.meta_description || '';

  console.log('[HeroImageHandler] Generating prompt for article:', articleTitle);

  // 2. Generate image prompt using LLM
  const openrouterKey = context.apiKeys.openrouter;
  if (!openrouterKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const promptGenerator = new OpenRouterProvider(openrouterKey, {});

  const systemPrompt = `You are an expert at creating image prompts for blog hero images.
Generate a detailed, visually compelling prompt for an AI image generator.

Guidelines:
- The image should be eye-catching and relevant to the article topic
- Use professional, editorial photography style by default
- Include lighting, composition, and mood details
- Do NOT include any text or words in the image
- Keep it appropriate for a professional blog
- Output ONLY the image prompt, nothing else`;

  const userPrompt = `Create an image prompt for a blog hero image.

Article Title: ${articleTitle}
${metaDescription ? `Description: ${metaDescription}` : ''}
Topic: ${context.ideaContext}

${context.brandVoice?.visualDescription ? `Brand visual style: ${context.brandVoice.visualDescription}` : ''}`;

  const promptResponse = await promptGenerator.execute({
    prompt: userPrompt,
    systemPrompt,
    model: DEFAULT_FREE_TEXT_MODEL,
    config: {
      temperature: 0.8,
      maxTokens: 500,
    },
  });

  let imagePrompt = typeof promptResponse.content === 'string'
    ? promptResponse.content
    : promptResponse.content?.text || '';

  // 3. Apply visual style suffix from brand voice
  if (context.brandVoice?.colorPalette?.length) {
    const colors = context.brandVoice.colorPalette.slice(0, 3).join(', ');
    imagePrompt += ` Color palette featuring ${colors}.`;
  }

  // Add quality suffix
  imagePrompt += ' Professional photography, high quality, editorial style, 8k resolution.';

  console.log('[HeroImageHandler] Generated prompt:', imagePrompt.substring(0, 100) + '...');

  // 4. Generate image via OpenRouter (synchronous)
  const aspectRatio = stageDef.providerConfig.aspectRatio || '16:9';
  const model = stageDef.providerConfig.model || DEFAULT_OPENROUTER_IMAGE_MODEL;

  const imageProvider = new OpenRouterImageProvider(openrouterKey, {
    referer: Deno.env.get('SUPABASE_URL') || '',
  });

  const fileName = `hero_${context.outputId}_${Date.now()}.jpg`;
  const imageUrl = await imageProvider.generateAndUpload(supabase, imagePrompt, model, {
    aspectRatio,
    fileName,
    referenceImages: context.referenceImages,
  });

  console.log('[HeroImageHandler] Hero image uploaded:', imageUrl);

  // 5. Return completed stage result — no pending_predictions tracking needed
  return {
    content: {
      prompt: imagePrompt,
      model,
      aspect_ratio: aspectRatio,
      image_url: imageUrl,
    },
    model,
    status: 'completed',
  };
}

export default executeHeroImageHandler;
