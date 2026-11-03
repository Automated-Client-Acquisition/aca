/**
 * ExecutionEngine
 *
 * Main orchestration class for pipeline stage execution.
 * Uses unified context, stage registry, and provider abstraction.
 *
 * Usage:
 *   const engine = new ExecutionEngine(supabase, supabaseUrl);
 *   const result = await engine.executeStage(output, stageId, configuration, apiKeys);
 */

import type {
  ExecutionContext,
  StageDefinition,
  StageResult,
  PipelineType,
  ProviderRequest,
} from './types.ts';
import { buildExecutionContext, validateContextRequirements } from './ExecutionContext.ts';
import { StageRegistry } from './StageRegistry.ts';
import { renderPromptTemplate } from '../builders/PromptBuilder.ts';
import { ProviderFactory } from '../providers/BaseProvider.ts';
import { OpenRouterProvider } from '../providers/OpenRouterProvider.ts';
import { OpenCodeProvider } from '../providers/OpenCodeProvider.ts';
import { isOpencodeModel, stripOpencodePrefix } from '../llm-client.ts';
import { ReplicateProvider } from '../providers/ReplicateProvider.ts';
import { ElevenLabsProvider } from '../providers/ElevenLabsProvider.ts';
import { OpenAIImageProvider } from '../providers/OpenAIImageProvider.ts';

// Register providers
ProviderFactory.register('openrouter', OpenRouterProvider);
ProviderFactory.register('replicate', ReplicateProvider);
ProviderFactory.register('elevenlabs', ElevenLabsProvider);
ProviderFactory.register('openai_image', OpenAIImageProvider);
ProviderFactory.register('opencode', OpenCodeProvider);

import { OUTPUT_TRANSFORMS } from './OutputTransformers.ts';
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_IMAGE_MODEL, DEFAULT_AUDIO_MODEL, DEFAULT_TEXT_STAGE_MAX_TOKENS, pickStageTextModel } from '../default-models.ts';

/**
 * Custom handler functions registry.
 * These handle stages that need special logic beyond the generic flow.
 */
type CustomHandler = (
  context: ExecutionContext,
  stageDef: StageDefinition,
  engine: ExecutionEngine
) => Promise<StageResult>;

const CUSTOM_HANDLERS: Record<string, CustomHandler> = {};

/** max_tokens for a text stage: its own cap, else the shared default. */
export function stageMaxTokens(stageDef: StageDefinition): number {
  return stageDef.providerConfig.maxTokens ?? DEFAULT_TEXT_STAGE_MAX_TOKENS;
}

/**
 * Reasoning models bill their thinking against max_tokens. When the budget runs
 * out before the answer starts, the reply is empty with finish_reason 'length':
 * say so, instead of handing "" to a parser (or storing an empty post).
 */
export function assertAnswerWithinBudget(
  result: { content?: unknown; finishReason?: string },
  what: string,
  budget: number
): void {
  const empty = result.content == null || (typeof result.content === 'string' && !result.content.trim());
  if (!empty || result.finishReason !== 'length') return;
  throw new Error(
    `${what}: the model used its whole ${budget}-token budget before answering (it reasons first). Try again, or pick a text model that doesn't reason.`
  );
}

/**
 * Register a custom handler for a stage.
 */
export function registerCustomHandler(name: string, handler: CustomHandler): void {
  CUSTOM_HANDLERS[name] = handler;
  console.log(`[ExecutionEngine] Registered custom handler: ${name}`);
}

/**
 * Main execution engine class.
 */
export class ExecutionEngine {
  private supabase: any;
  private supabaseUrl: string;
  private webhookUrl: string;

  constructor(supabase: any, supabaseUrl: string) {
    this.supabase = supabase;
    this.supabaseUrl = supabaseUrl;
    this.webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;
  }

  /**
   * Execute a stage for an output.
   *
   * @param output The content_outputs row
   * @param stageId The stage to execute
   * @param configuration Job/output configuration
   * @param apiKeys Encrypted API keys from org_api_keys
   * @param options Optional parameters for regeneration
   * @returns Stage execution result
   */
  async executeStage(
    output: any,
    stageId: string,
    configuration: any,
    apiKeys: any[],
    options?: {
      regenerateScene?: number;
      customPrompt?: string;
      instructions?: string;
    }
  ): Promise<StageResult> {
    const pipeline = output.pipeline as PipelineType;

    console.log(`[ExecutionEngine] Executing stage: ${pipeline}:${stageId}`);
    if (options?.regenerateScene !== undefined) {
      console.log(`[ExecutionEngine] Regenerating single item: ${options.regenerateScene}`);
    }

    // 1. Get stage definition
    const stageDef = StageRegistry.get(pipeline, stageId);
    if (!stageDef) {
      throw new Error(`No stage definition found for ${pipeline}:${stageId}`);
    }

    // 2. Decrypt API keys
    const decryptedKeys = await this.decryptApiKeys(apiKeys);

    // 3. Build execution context with regeneration params
    const context = buildExecutionContext({
      output,
      stageId,
      configuration,
      decryptedApiKeys: decryptedKeys,
      regenerateScene: options?.regenerateScene,
      customPrompt: options?.customPrompt,
      instructions: options?.instructions,
    });

    // 4. Validate requirements
    const validation = validateContextRequirements(context, stageDef.requires);
    if (!validation.valid) {
      console.warn(
        `[ExecutionEngine] Missing requirements for ${stageId}: ${validation.missing.join(', ')}`
      );
      // Continue anyway - some requirements are soft
    }

    // 5. Check for custom handler
    if (stageDef.customHandler && CUSTOM_HANDLERS[stageDef.customHandler]) {
      console.log(`[ExecutionEngine] Using custom handler: ${stageDef.customHandler}`);
      return CUSTOM_HANDLERS[stageDef.customHandler](context, stageDef, this);
    }

    // 6. Execute based on stage type
    let result: StageResult;

    switch (stageDef.type) {
      case 'text':
        result = await this.executeTextStage(context, stageDef);
        assertAnswerWithinBudget(result, `Stage ${stageId}`, stageMaxTokens(stageDef));
        break;

      case 'image':
        result = await this.executeImageStage(context, stageDef);
        break;

      case 'audio':
        result = await this.executeAudioStage(context, stageDef);
        break;

      case 'video':
        result = await this.executeVideoStage(context, stageDef);
        break;

      default:
        throw new Error(`Unknown stage type: ${stageDef.type}`);
    }

    // 7. Apply output transform if specified
    if (stageDef.outputTransform && OUTPUT_TRANSFORMS[stageDef.outputTransform]) {
      try {
        result.content = OUTPUT_TRANSFORMS[stageDef.outputTransform](result.content, context);
      } catch (transformError) {
        console.error(`[ExecutionEngine] Output transform '${stageDef.outputTransform}' failed for ${stageId}:`, transformError);
        const cutOff = result.finishReason === 'length' ? ' (the reply hit its token budget and was cut off)' : '';
        throw new Error(`Output transform failed for stage ${stageId}${cutOff}: ${transformError instanceof Error ? transformError.message : 'Unknown error'}`);
      }
    }

    console.log(`[ExecutionEngine] Stage ${stageId} completed:`, {
      status: result.status,
      predictionId: result.predictionId,
      contentType: typeof result.content,
    });

    return result;
  }

  /**
   * Execute a text generation stage.
   * For blog_article pipeline with 6+ sections, uses per-section generation
   * to prevent content repetition in long articles.
   *
   * Public so custom handlers (the carousel plan/content handlers) can reuse the
   * exact same model choice, key handling and provider routing as a plain text
   * stage. `renderedPrompt` lets a handler pass prompts it already rendered
   * (with extra context, or with retry notes appended) instead of re-rendering
   * the stage's template.
   */
  async executeTextStage(
    context: ExecutionContext,
    stageDef: StageDefinition,
    renderedPrompt?: { system: string; user: string }
  ): Promise<StageResult> {
    // OpenCode Go models (opencode: prefix) run on the org's OpenCode key
    // — the OpenRouter key check below doesn't apply to them.
    const requestedModel = pickStageTextModel(stageDef.providerConfig.model, context.modelConfig.textLlm?.modelId);
    if (isOpencodeModel(requestedModel)) {
      return this.executeOpencodeTextStage(context, stageDef, requestedModel, renderedPrompt);
    }

    const apiKey = context.apiKeys.openrouter;
    if (!apiKey) {
      throw new Error('OpenRouter API key not configured');
    }

    // Check if this is a blog article that needs per-section generation
    const isBlogArticleStage = context.pipeline === 'blog_article' && stageDef.id === 'article';
    const outlineData = context.previousStageOutputs.outline;
    const outlineSections = outlineData?.sections || [];
    const needsPerSectionGeneration = isBlogArticleStage && outlineSections.length >= 6;

    if (needsPerSectionGeneration) {
      console.log(`[ExecutionEngine] Long blog article detected (${outlineSections.length} sections). Using per-section generation for story consistency.`);
      return this.executePerSectionArticle(context, stageDef, outlineData);
    }

    // Standard single-call generation
    const provider = new OpenRouterProvider(apiKey, {
      referer: this.supabaseUrl,
    });
    if (!renderedPrompt && !stageDef.promptTemplate) {
      throw new Error(`Stage ${stageDef.id} has no prompt template`);
    }

    const { system, user } = renderedPrompt ?? renderPromptTemplate(stageDef.promptTemplate!, context);

    // Extract screenshot images for vision-capable stages (e.g. presenter_video director, video_remix director)
    const screenshots =
      context.previousStageOutputs?.web_capture?.screenshots ||
      context.previousStageOutputs?.video_ingest?.screenshots;
    const visionImages = screenshots?.length
      ? screenshots.map((s: { url: string }) => ({ url: s.url, detail: 'auto' as const }))
      : undefined;

    if (visionImages?.length) {
      console.log(`[ExecutionEngine] Attaching ${visionImages.length} screenshot images for vision`);
    }

    const request: ProviderRequest = {
      prompt: user,
      systemPrompt: system,
      model: pickStageTextModel(stageDef.providerConfig.model, context.modelConfig.textLlm?.modelId),
      images: visionImages,
      config: {
        temperature: stageDef.providerConfig.temperature,
        maxTokens: stageMaxTokens(stageDef),
      },
    };

    const response = await provider.execute(request);

    return {
      content: response.content,
      text: typeof response.content === 'string' ? response.content : undefined,
      model: response.model,
      usage: response.usage,
      cost: response.cost,
      status: 'completed',
      finishReason: response.finishReason,
    };
  }

  /**
   * Execute a text generation stage on OpenCode Go.
   * Same flow as executeTextStage but through the OpenCodeProvider —
   * per-section blog articles keep their continuity loop via the shared
   * executePerSectionArticle (whose provider is chosen the same way).
   */
  private async executeOpencodeTextStage(
    context: ExecutionContext,
    stageDef: StageDefinition,
    requestedModel: string,
    renderedPrompt?: { system: string; user: string }
  ): Promise<StageResult> {
    const opencodeKey = context.apiKeys.opencode;
    if (!opencodeKey) {
      throw new Error('OpenCode Go API key not configured. Add one in Settings → API Keys.');
    }

    // Blog articles with 6+ sections keep the per-section continuity loop
    const isBlogArticleStage = context.pipeline === 'blog_article' && stageDef.id === 'article';
    const outlineData = context.previousStageOutputs.outline;
    const outlineSections = outlineData?.sections || [];
    if (isBlogArticleStage && outlineSections.length >= 6) {
      console.log(`[ExecutionEngine] Long blog article on OpenCode (${outlineSections.length} sections). Using per-section generation.`);
      return this.executePerSectionArticle(context, stageDef, outlineData);
    }

    if (!renderedPrompt && !stageDef.promptTemplate) {
      throw new Error(`Stage ${stageDef.id} has no prompt template`);
    }

    const provider = new OpenCodeProvider(opencodeKey, {
      sessionId: `aca-${context.organizationId}`,
    });

    const { system, user } = renderedPrompt ?? renderPromptTemplate(stageDef.promptTemplate!, context);

    // Vision images (screenshots) attach the same way as on OpenRouter
    const screenshots =
      context.previousStageOutputs?.web_capture?.screenshots ||
      context.previousStageOutputs?.video_ingest?.screenshots;
    const visionImages = screenshots?.length
      ? screenshots.map((s: { url: string }) => ({ url: s.url, detail: 'auto' as const }))
      : undefined;

    const request: ProviderRequest = {
      prompt: user,
      systemPrompt: system,
      model: stripOpencodePrefix(requestedModel),
      images: visionImages,
      config: {
        temperature: stageDef.providerConfig.temperature,
        maxTokens: stageMaxTokens(stageDef),
      },
    };

    const response = await provider.execute(request);

    return {
      content: response.content,
      text: typeof response.content === 'string' ? response.content : undefined,
      model: response.model,
      usage: response.usage,
      cost: response.cost,
      status: 'completed',
      finishReason: response.finishReason,
    };
  }

  /**
   * Execute per-section article generation for long blog articles.
   * Passes full article content between sections to prevent repetition.
   */
  private async executePerSectionArticle(
    context: ExecutionContext,
    stageDef: StageDefinition,
    outlineData: any
  ): Promise<StageResult> {
    // Route on the same model string as executeTextStage: opencode: models
    // use the org's OpenCode key, everything else OpenRouter.
    const requestedModel = pickStageTextModel(stageDef.providerConfig.model, context.modelConfig.textLlm?.modelId);
    const provider = isOpencodeModel(requestedModel)
      ? new OpenCodeProvider(context.apiKeys.opencode, {
          sessionId: `aca-${context.organizationId}`,
        })
      : new OpenRouterProvider(context.apiKeys.openrouter, {
          referer: this.supabaseUrl,
        });

    const sections = outlineData.sections || [];
    const articleTitle = outlineData.title || 'Untitled Article';
    let fullArticle = '';
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let totalCost = 0;
    const MAX_ARTICLE_CHARS = 100000;

    // Build brand/product context
    let storyContext = '';
    if (context.brandVoice?.tone) {
      storyContext += `Tone: ${context.brandVoice.tone}\n`;
    }
    if (context.brandVoice?.writingStyle) {
      storyContext += `Writing Style: ${context.brandVoice.writingStyle}\n`;
    }
    if (context.product?.name) {
      storyContext += `Product to mention naturally: ${context.product.name}\n`;
    }

    console.log(`[ExecutionEngine] Generating ${sections.length} sections for blog article`);

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const isIntro = i === 0 || section.heading?.toLowerCase().includes('introduction');
      const isConclusion = i === sections.length - 1 || section.heading?.toLowerCase().includes('conclusion');

      // Build context from previous sections - PASS FULL ARTICLE for continuity
      let previousContent: string;
      if (fullArticle.length === 0) {
        previousContent = '';
      } else if (fullArticle.length <= MAX_ARTICLE_CHARS) {
        previousContent = `\n\n=== ARTICLE SO FAR (read carefully before continuing) ===\n${fullArticle}\n=== END OF EXISTING CONTENT ===`;
      } else {
        const recentContent = fullArticle.slice(-50000);
        previousContent = `\n\n=== ARTICLE SO FAR ===
[Earlier sections established the foundation]

RECENT CONTENT (read carefully):
...${recentContent}
=== END OF EXISTING CONTENT ===`;
      }

      const sectionPrompt = `Write the "${section.heading}" section of a blog article.

SECTION DETAILS:
- Heading: ${section.heading}
- Key points to cover: ${(section.key_points || []).join(', ')}
- This is section ${i + 1} of ${sections.length}
${isIntro ? '- This is the INTRODUCTION' : ''}
${isConclusion ? '- This is the CONCLUSION' : ''}

ARTICLE CONTEXT:
- Title: "${articleTitle}"
- Topic: ${context.ideaContext}
${previousContent}

CONTINUITY REQUIREMENTS:
- Read the existing content above before writing
- DO NOT repeat arguments, examples, or statistics already made
- Continue the established tone and style

Use ## for the section heading. Output ONLY the section content.`;

      // Build system prompt from brand voice only - no hardcoded style instructions
      let systemPrompt = 'You are writing one section of a blog article.';
      if (storyContext) {
        systemPrompt += `\n\n${storyContext}`;
      }

      console.log(`[ExecutionEngine] Generating section ${i + 1}/${sections.length}: "${section.heading}"`);

      const request: ProviderRequest = {
        prompt: sectionPrompt,
        systemPrompt,
        model: pickStageTextModel(stageDef.providerConfig.model, context.modelConfig.textLlm?.modelId),
        config: {
          temperature: stageDef.providerConfig.temperature || 0.7,
          // A section is ~300-600 words; the rest is room for a reasoning model
          // to think first (at 1500 it could come back empty).
          maxTokens: DEFAULT_TEXT_STAGE_MAX_TOKENS,
        },
      };

      const response = await provider.execute(request);
      assertAnswerWithinBudget(response, `Article section "${section.heading}"`, DEFAULT_TEXT_STAGE_MAX_TOKENS);
      const sectionContent = typeof response.content === 'string' ? response.content : '';

      // Accumulate article content
      fullArticle += (fullArticle ? '\n\n' : '') + sectionContent;

      // Accumulate usage stats
      if (response.usage) {
        totalUsage.prompt_tokens += response.usage.prompt_tokens || 0;
        totalUsage.completion_tokens += response.usage.completion_tokens || 0;
        totalUsage.total_tokens += response.usage.total_tokens || 0;
      }
      if (response.cost) {
        totalCost += response.cost;
      }
    }

    console.log(`[ExecutionEngine] Blog article complete. Total length: ${fullArticle.length} chars`);

    return {
      content: fullArticle,
      text: fullArticle,
      model: pickStageTextModel(stageDef.providerConfig.model, context.modelConfig.textLlm?.modelId),
      usage: totalUsage,
      cost: totalCost,
      status: 'completed',
    };
  }

  /**
   * Execute an image generation stage.
   */
  private async executeImageStage(
    context: ExecutionContext,
    stageDef: StageDefinition
  ): Promise<StageResult> {
    const apiKey = context.apiKeys.replicate;
    if (!apiKey) {
      throw new Error('Replicate API key not configured');
    }

    // Create provider
    const provider = new ReplicateProvider(apiKey, {
      webhookUrl: this.webhookUrl,
    });

    // Get the prompt - for image stages, we need to get it from previous stage
    let prompt = '';
    if (stageDef.requires.previousStages?.length) {
      const prevStageId = stageDef.requires.previousStages[0];
      const prevData = context.previousStageOutputs[prevStageId];
      // This depends on the specific stage - carousel_slides needs slide prompts
      prompt = prevData?.prompt || prevData?.text || '';
    }

    // Build request
    const request: ProviderRequest = {
      prompt,
      model: stageDef.providerConfig.model || DEFAULT_IMAGE_MODEL,
      referenceImages: context.referenceImages,
      config: {
        aspectRatio:
          stageDef.providerConfig.aspectRatio || context.visualStyle.aspectRatio || '1:1',
        useReferenceImage: stageDef.providerConfig.useReferenceImage,
        referenceStrength: stageDef.providerConfig.referenceStrength || 0.6,
      },
    };

    // Execute
    const response = await provider.execute(request);

    return {
      content: response.content,
      model: response.model,
      predictionId: response.predictionId,
      status: response.status || 'pending',
    };
  }

  /**
   * Execute an audio generation stage.
   */
  private async executeAudioStage(
    context: ExecutionContext,
    stageDef: StageDefinition
  ): Promise<StageResult> {
    const apiKey = context.apiKeys.elevenlabs;
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Create provider
    const provider = new ElevenLabsProvider(apiKey);

    // Get text from previous stage (script narration)
    let text = '';
    if (stageDef.requires.previousStages?.length) {
      const prevStageId = stageDef.requires.previousStages[0];
      const prevData = context.previousStageOutputs[prevStageId];

      // Combine all scene narrations
      if (prevData?.scenes) {
        text = prevData.scenes.map((s: any) => s.narration).join(' ');
      } else {
        text = prevData?.text || prevData?.content || '';
      }
    }

    // Build request
    const request: ProviderRequest = {
      prompt: text,
      model: stageDef.providerConfig.model || DEFAULT_AUDIO_MODEL,
      config: {
        voiceId: stageDef.providerConfig.voiceId || context.modelConfig.audioLlm?.voiceId,
      },
    };

    // Execute
    const response = await provider.execute(request);

    // Upload audio to storage
    const audioData = response.content as ArrayBuffer;
    const fileName = `voice_${context.outputId}_${Date.now()}.mp3`;
    const publicUrl = await ElevenLabsProvider.uploadToStorage(this.supabase, audioData, fileName);

    return {
      content: { audio_url: publicUrl, duration_ms: audioData.byteLength / 16 }, // Rough estimate
      model: response.model,
      cost: response.cost,
      status: 'completed',
    };
  }

  /**
   * Execute a video generation stage.
   */
  private async executeVideoStage(
    context: ExecutionContext,
    stageDef: StageDefinition
  ): Promise<StageResult> {
    // Video stages typically need custom handlers due to complexity
    throw new Error(
      `Video stage ${stageDef.id} requires a custom handler. ` +
      `Register one with: registerCustomHandler('${stageDef.customHandler || stageDef.id}', handler)`
    );
  }

  /**
   * Decrypt API keys.
   */
  private async decryptApiKeys(
    apiKeys: Array<{ provider: string; key_encrypted: string }>
  ): Promise<Record<string, string>> {
    const decrypted: Record<string, string> = {};

    for (const key of apiKeys) {
      try {
        decrypted[key.provider] = await this.decryptApiKey(key.key_encrypted);
      } catch (error) {
        console.error(`Failed to decrypt ${key.provider} key:`, error);
      }
    }

    return decrypted;
  }

  /**
   * Decrypt a single API key using AES-GCM.
   * Matches the legacy decryptApiKey in execute-stage/index.ts.
   */
  private async decryptApiKey(encryptedKey: string): Promise<string> {
    const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKeyHex) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    try {
      const keyBytes = new Uint8Array(
        encryptionKeyHex.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
      );

      const encryptedData = Uint8Array.from(atob(encryptedKey), (c: string) => c.charCodeAt(0));
      const iv = encryptedData.slice(0, 12);
      const ciphertext = encryptedData.slice(12);

      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'AES-GCM' },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      throw new Error('Failed to decrypt API key');
    }
  }

  /**
   * Get the Supabase client (for custom handlers that need it).
   */
  getSupabase(): any {
    return this.supabase;
  }

  /**
   * Get the webhook URL (for async providers).
   */
  getWebhookUrl(): string {
    return this.webhookUrl;
  }
}

/**
 * Create an execution engine instance.
 */
export function createExecutionEngine(supabase: any, supabaseUrl: string): ExecutionEngine {
  return new ExecutionEngine(supabase, supabaseUrl);
}

export default ExecutionEngine;
