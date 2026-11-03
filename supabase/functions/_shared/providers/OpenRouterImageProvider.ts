/**
 * OpenRouter Image Provider
 *
 * Generates images via OpenRouter's unified API using the same endpoint as text generation.
 * Uses `modalities: ["image"]` to request image output.
 * Images are returned as base64 in `message.images[]`.
 *
 * Key advantages over Replicate for image generation:
 * - Synchronous response (no webhook required)
 * - Model-agnostic: swap model field without changing integration code
 * - Single API key (same OPENROUTER key already used for text generation)
 * - Predictable per-image pricing visible on OpenRouter dashboard
 * - Model-specific image_config (aspect_ratio, width, height)
 *
 * Supported models:
 * - google/gemini-3.1-flash-image-preview — Nano Banana Pro (best quality, recommended)
 * - black-forest-labs/flux.2-pro     — highest quality photorealistic
 * - black-forest-labs/flux.2-flex    — faster, lower cost
 * - google/gemini-2.5-flash-image    — Nano Banana (older, cheaper)
 */

import { BaseProvider, ProviderFactory, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';
import { resolveReferenceImagesToDataUrls } from '../image-reference-resolver.ts';

// Default image generation model (Nano Banana Pro)
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

// Supported models — all accept image input for reference-guided generation.
// Note: the provider is model-agnostic and will accept any OpenRouter slug —
// these are just named constants for shared reference.
export const OPENROUTER_IMAGE_MODELS = {
  GEMINI_3_PRO_IMAGE: 'google/gemini-3-pro-image-preview',
  GEMINI_3_1_FLASH: 'google/gemini-3.1-flash-image-preview',
  GEMINI_2_5_FLASH: 'google/gemini-2.5-flash-image',
  GPT_5_IMAGE: 'openai/gpt-5-image',
  GPT_5_IMAGE_MINI: 'openai/gpt-5-image-mini',
} as const;

// Aspect ratio map: semantic names → OpenRouter image_config dimensions
const ASPECT_RATIO_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '4:3': { width: 1280, height: 960 },
  '3:4': { width: 960, height: 1280 },
  '21:9': { width: 2048, height: 878 },
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
  square: { width: 1024, height: 1024 },
};

type OpenRouterMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

interface OpenRouterImageMessage {
  role: 'user';
  content: OpenRouterMessageContent;
}

interface OpenRouterImageResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string | Array<{ type: string; image_url?: { url: string } }>;
      images?: Array<{ type: string; image_url: { url: string } } | string>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  width?: number;
  height?: number;
}

interface StorageBucketClient {
  getBucket(bucket: string): Promise<{ data?: { public?: boolean } | null; error?: { message?: string } | null }>;
  createBucket(bucket: string, options: {
    public: boolean;
    fileSizeLimit?: number;
    allowedMimeTypes?: string[];
  }): Promise<{ error?: { message?: string } | null }>;
  updateBucket(bucket: string, options: { public: boolean }): Promise<{ error?: { message?: string } | null }>;
}

interface SupabaseStorageClient {
  storage: StorageBucketClient;
}

// In-memory cache for model capabilities (survives across requests within the same isolate)
const modelCapabilitiesCache: Map<string, { acceptsImage: boolean; outputsText: boolean; fetchedAt: number }> = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Query OpenRouter's /models endpoint to check if a model accepts image input.
 * Results are cached in-memory per Deno isolate to avoid repeated API calls.
 */
async function getModelCapabilities(modelId: string): Promise<{ acceptsImage: boolean; outputsText: boolean }> {
  const cached = modelCapabilitiesCache.get(modelId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    const res = await fetch(`https://openrouter.ai/api/v1/models/${modelId}`);
    if (res.ok) {
      const data = await res.json();
      const arch = data.architecture || data;
      const inputMods: string[] = arch.input_modalities || [];
      const outputMods: string[] = arch.output_modalities || [];
      const result = {
        acceptsImage: inputMods.includes('image'),
        outputsText: outputMods.includes('text'),
        fetchedAt: Date.now(),
      };
      modelCapabilitiesCache.set(modelId, result);
      console.log(`[OpenRouterImage] Model ${modelId} capabilities:`, { acceptsImage: result.acceptsImage, outputsText: result.outputsText });
      return result;
    }
  } catch (err) {
    console.warn(`[OpenRouterImage] Failed to fetch model capabilities for ${modelId}:`, err);
  }

  // Fallback: assume multimodal (safe default — OpenRouter ignores unsupported content parts)
  return { acceptsImage: true, outputsText: true };
}

export class OpenRouterImageProvider extends BaseProvider {
  private referer: string;
  private appTitle: string;

  constructor(
    apiKey: string,
    options?: {
      baseUrl?: string;
      referer?: string;
      appTitle?: string;
    }
  ) {
    super(apiKey, {
      baseUrl: options?.baseUrl || 'https://openrouter.ai/api/v1',
    });
    this.referer = options?.referer || Deno.env.get('SUPABASE_URL') || '';
    this.appTitle = options?.appTitle || 'ContentAI Studio';
  }

  getProviderName(): string {
    return 'OpenRouterImage';
  }

  isAsync(): boolean {
    return false; // OpenRouter image generation is synchronous
  }

  /**
   * Generate an image from a text prompt.
   * Returns a ProviderResponse with content as a GeneratedImage object.
   */
  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['prompt', 'model']);
    this.logRequest(request);

    return retryWithBackoff(
      async () => {
        const aspectRatio = request.config.aspectRatio || '16:9';
        const dimensions = ASPECT_RATIO_DIMENSIONS[aspectRatio] || { width: 1920, height: 1080 };

        // Build message content — multimodal if reference images are provided
        // and the model accepts image input (checked via OpenRouter models API)
        const effectiveModel = request.model || DEFAULT_OPENROUTER_IMAGE_MODEL;
        const rawReferenceImages = request.referenceImages || [];

        // Check model capabilities at runtime — cached per isolate
        const capabilities = rawReferenceImages.length > 0
          ? await getModelCapabilities(effectiveModel)
          : { acceptsImage: false, outputsText: true };

        // Inline reference images as base64 data URLs so the provider never
        // fetches flaky third-party hosts server-side (a 502 there would 400 the
        // whole generation). References we can't fetch are skipped, not fatal.
        const referenceImages = capabilities.acceptsImage
          ? await resolveReferenceImagesToDataUrls(rawReferenceImages.slice(0, 4))
          : [];
        if (rawReferenceImages.length > 0 && !capabilities.acceptsImage) {
          console.log(`[OpenRouterImage] Skipping ${rawReferenceImages.length} reference image(s) — model ${effectiveModel} does not accept image input`);
        }

        let messageContent: OpenRouterMessageContent;

        if (referenceImages.length > 0) {
          // Multimodal: reference images + text prompt
          const contentParts: Array<
            | { type: 'text'; text: string }
            | { type: 'image_url'; image_url: { url: string } }
          > = [];

          // Add reference images first (up to 4 to stay within token limits)
          for (const imageUrl of referenceImages.slice(0, 4)) {
            contentParts.push({
              type: 'image_url',
              image_url: { url: imageUrl },
            });
          }

          // Add the text prompt with explicit reference instruction. Callers can
          // override the default preamble (e.g. carousels want style/palette/type
          // continuity from prior slides WITHOUT copying their text or composition).
          const referencePreamble =
            request.config?.referenceInstruction ||
            'Use the provided reference image(s) as visual guidance for style, subject, and composition.';
          contentParts.push({
            type: 'text',
            text: `${referencePreamble} ${request.prompt}`,
          });

          messageContent = contentParts;
          console.log(`[OpenRouterImage] Including ${referenceImages.length} reference image(s) in request`);
        } else {
          messageContent = request.prompt;
        }

        const messages: OpenRouterImageMessage[] = [
          { role: 'user', content: messageContent },
        ];

        const body: Record<string, any> = {
          model: effectiveModel,
          messages,
          // Set modalities based on model capabilities
          modalities: capabilities.outputsText ? ['image', 'text'] : ['image'],
          image_config: {
            aspect_ratio: aspectRatio,
            width: dimensions.width,
            height: dimensions.height,
          },
        };

        console.log('[OpenRouterImage] Generating image:', {
          model: effectiveModel,
          modalities: body.modalities,
          aspect_ratio: aspectRatio,
          dimensions,
          prompt_length: request.prompt.length,
          referenceImages: referenceImages.length,
        });

        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': this.referer,
            'X-Title': this.appTitle,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`OpenRouter Image API error ${response.status}: ${errorBody}`);
        }

        const result: OpenRouterImageResponse = await response.json();

        // Extract base64 image from the response.
        // OpenRouter returns images in multiple possible formats:
        //   1. message.images[]: array of { type: 'image_url', image_url: { url: 'data:...' } } or plain base64 strings
        //   2. message.content[]: array of { type: 'image_url', image_url: { url: 'data:...' } }
        //   3. message.content: string data URL 'data:image/png;base64,...'
        const choice = result.choices?.[0];
        const msg = choice?.message;

        let base64Data: string | undefined;
        let mimeType = 'image/png';

        // Helper: extract base64 from a data URL
        const parseDataUrl = (dataUrl: string): { base64: string; mime: string } | null => {
          const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
          return match ? { base64: match[2], mime: match[1] } : null;
        };

        // Helper: extract from an image object { type: 'image_url', image_url: { url: 'data:...' } }
        const extractFromImageObj = (obj: any): boolean => {
          const dataUrl = obj?.image_url?.url || '';
          const parsed = parseDataUrl(dataUrl);
          if (parsed) {
            base64Data = parsed.base64;
            mimeType = parsed.mime;
            return true;
          }
          return false;
        };

        // Path 1: message.images[] (documented OpenRouter format)
        if (msg?.images && Array.isArray(msg.images) && msg.images.length > 0) {
          const first = msg.images[0];
          if (typeof first === 'string') {
            // Raw base64 string
            const parsed = parseDataUrl(first);
            if (parsed) {
              base64Data = parsed.base64;
              mimeType = parsed.mime;
            } else {
              // Assume it's raw base64 without data URL prefix
              base64Data = first;
            }
          } else if (typeof first === 'object') {
            extractFromImageObj(first);
          }
        }

        // Path 2: message.content as array of image objects
        if (!base64Data && Array.isArray(msg?.content)) {
          const imageItem = (msg.content as any[]).find(
            (c: any) => c.type === 'image_url' || c.image_url
          );
          if (imageItem) {
            extractFromImageObj(imageItem);
          }
        }

        // Path 3: message.content as data URL string
        if (!base64Data && typeof msg?.content === 'string' && msg.content.startsWith('data:')) {
          const parsed = parseDataUrl(msg.content);
          if (parsed) {
            base64Data = parsed.base64;
            mimeType = parsed.mime;
          }
        }

        if (!base64Data) {
          throw new Error(
            `OpenRouter image generation returned no images for model ${body.model}. ` +
            `Response: ${JSON.stringify(result).substring(0, 500)}`
          );
        }

        const generatedImage: GeneratedImage = {
          base64: base64Data,
          mimeType,
          width: dimensions.width,
          height: dimensions.height,
        };

        const providerResponse: ProviderResponse = {
          content: generatedImage,
          model: result.model || body.model,
          usage: result.usage
            ? {
                inputTokens: result.usage.prompt_tokens,
                outputTokens: result.usage.completion_tokens,
                totalTokens: result.usage.total_tokens,
              }
            : undefined,
          status: 'completed',
        };

        this.logResponse({
          ...providerResponse,
          content: `[ImageData: base64, ${dimensions.width}x${dimensions.height}]`,
        });

        return providerResponse;
      },
      { maxRetries: 3, operationName: 'OpenRouter image generation' }
    );
  }

  /**
   * Upload a base64 image to Supabase Storage and return the public URL.
   */
  static async uploadBase64ToStorage(
    supabase: any,
    base64: string,
    fileName: string,
    mimeType = 'image/jpeg',
    bucket = 'content-media'
  ): Promise<string> {
    await OpenRouterImageProvider.ensurePublicBucket(supabase, bucket);

    // Decode base64 to bytes
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const { error } = await supabase.storage
      .from(bucket)
      .upload(fileName, bytes, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(`Failed to upload generated image: ${error.message}`);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(bucket).getPublicUrl(fileName);

    return publicUrl;
  }

  private static async ensurePublicBucket(supabase: SupabaseStorageClient, bucket: string): Promise<void> {
    try {
      const { data, error } = await supabase.storage.getBucket(bucket);
      if (error || !data) {
        const { error: createError } = await supabase.storage.createBucket(bucket, {
          public: true,
          fileSizeLimit: 10 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        });
        if (createError && !String(createError.message || '').toLowerCase().includes('already exists')) {
          throw createError;
        }
        return;
      }

      if (data.public !== true) {
        const { error: updateError } = await supabase.storage.updateBucket(bucket, {
          public: true,
        });
        if (updateError) throw updateError;
      }
    } catch (err) {
      throw new Error(`Failed to ensure public storage bucket "${bucket}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Generate an image and immediately upload it to Supabase Storage.
   * Returns the public URL of the uploaded image.
   */
  async generateAndUpload(
    supabase: any,
    prompt: string,
    model: string,
    options: {
      aspectRatio?: string;
      fileName: string;
      bucket?: string;
      referenceImages?: string[];
      /** Override the default reference-image preamble (see execute()). */
      referenceInstruction?: string;
    }
  ): Promise<string> {
    const response = await this.execute({
      prompt,
      model,
      config: {
        aspectRatio: options.aspectRatio || '16:9',
        referenceInstruction: options.referenceInstruction,
      },
      referenceImages: options.referenceImages,
    });

    const generatedImage = response.content as GeneratedImage;
    if (!generatedImage?.base64) {
      throw new Error('Image generation did not return base64 data');
    }

    return OpenRouterImageProvider.uploadBase64ToStorage(
      supabase,
      generatedImage.base64,
      options.fileName,
      generatedImage.mimeType,
      options.bucket
    );
  }
}

// Register with factory
ProviderFactory.register('openrouter_image', OpenRouterImageProvider);

export default OpenRouterImageProvider;
