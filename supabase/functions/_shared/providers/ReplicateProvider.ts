/**
 * Replicate Provider
 *
 * Handles image, video, and other model generation via Replicate API.
 * Uses webhooks for async completion notification.
 *
 * IMPORTANT: This provider uses the model schema system from `ai_models` table
 * to correctly transform semantic inputs (like `image_input`) to provider-specific
 * parameters. When a supabase client is provided, it will look up the model's
 * `normalized_capabilities` and use `buildPayload()` for proper transformation.
 */

import { BaseProvider, ProviderFactory, retryWithBackoff } from './BaseProvider.ts';
import type { ProviderRequest, ProviderResponse } from '../execution/types.ts';
import {
  ensureModelSchema,
  buildPayload,
  type NormalizedCapabilities,
  type SemanticInput,
} from './ModelSchemaService.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

// Common Replicate models
export const REPLICATE_MODELS = {
  // Image generation
  FLUX_PRO: 'black-forest-labs/flux-1.1-pro',
  FLUX_SCHNELL: 'black-forest-labs/flux-schnell',
  SDXL: 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc',

  // Video generation
  KLING: 'fofr/kling:9f62eb52f77d66c155c5c06d37d1f8c569f11a60038f0bd92efef25d5c2a4fbb',
  MINIMAX: 'minimax/video-01',

  // Audio
  MUSIC_GEN: 'meta/musicgen:melody-large',
} as const;

interface ReplicatePrediction {
  id: string;
  model: string;
  version: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  input: Record<string, any>;
  output: any;
  error: string | null;
  urls: {
    get: string;
    cancel: string;
  };
  metrics?: {
    predict_time?: number;
  };
}

export class ReplicateProvider extends BaseProvider {
  private supabase: SupabaseClient | null = null;
  private modelCapabilitiesCache: Map<string, NormalizedCapabilities> = new Map();

  constructor(
    apiKey: string,
    options?: {
      baseUrl?: string;
      webhookUrl?: string;
      supabase?: SupabaseClient;
    }
  ) {
    super(apiKey, {
      baseUrl: options?.baseUrl || 'https://api.replicate.com/v1',
      webhookUrl: options?.webhookUrl,
    });
    this.supabase = options?.supabase || null;
  }

  getProviderName(): string {
    return 'Replicate';
  }

  isAsync(): boolean {
    return true; // Replicate uses webhooks for completion
  }

  async execute(request: ProviderRequest): Promise<ProviderResponse> {
    this.validateRequest(request, ['model']);
    this.logRequest(request);

    return retryWithBackoff(
      async () => {
        // Build input payload - use model schema if available
        const input = await this.buildInputWithSchema(request);

        // Determine API endpoint based on model identifier format
        // Model identifiers (owner/name) use /models/{owner}/{name}/predictions
        // SHA256 version hashes use /predictions with version field
        const isModelIdentifier =
          request.model.includes('/') && !request.model.match(/^[a-f0-9]{64}$/);

        const apiEndpoint = isModelIdentifier
          ? `${this.baseUrl}/models/${request.model}/predictions`
          : `${this.baseUrl}/predictions`;

        console.log(
          `[Replicate] Using endpoint: ${apiEndpoint} (isModelIdentifier: ${isModelIdentifier})`
        );
        console.log(`[Replicate] Final input payload:`, JSON.stringify(input, null, 2));

        // Build request body
        const requestBody: Record<string, any> = {
          input,
        };

        // Add webhook if available
        if (this.webhookUrl) {
          requestBody.webhook = this.webhookUrl;
          requestBody.webhook_events_filter = ['completed'];
        }

        // Add version for SHA256 hashes
        if (!isModelIdentifier) {
          requestBody.version = request.model;
        }

        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new Error(`Replicate API error ${response.status}: ${errorBody}`);
        }

        const prediction: ReplicatePrediction = await response.json();

        const providerResponse: ProviderResponse = {
          content: prediction.output,
          model: prediction.model || request.model,
          predictionId: prediction.id,
          status: prediction.status === 'succeeded' ? 'completed' : 'pending',
        };

        this.logResponse(providerResponse);
        return providerResponse;
      },
      { maxRetries: 5, initialDelay: 2000, maxDelay: 60000, operationName: 'Replicate prediction' }
    );
  }

  /**
   * Get model capabilities from database, with caching.
   */
  private async getModelCapabilities(modelId: string): Promise<NormalizedCapabilities | null> {
    // Check cache first
    if (this.modelCapabilitiesCache.has(modelId)) {
      return this.modelCapabilitiesCache.get(modelId)!;
    }

    // Need supabase client to look up schema
    if (!this.supabase) {
      console.log(`[Replicate] No supabase client, skipping model schema lookup`);
      return null;
    }

    try {
      const capabilities = await ensureModelSchema(
        this.supabase,
        'replicate',
        modelId,
        'image_generator'
      );

      if (capabilities) {
        this.modelCapabilitiesCache.set(modelId, capabilities);
      }

      return capabilities;
    } catch (error) {
      // Log but don't throw - we'll fall back to hardcoded logic
      console.error(`[Replicate] Error getting model schema:`, error);
      return null;
    }
  }

  /**
   * Build input payload using model schema if available.
   * Falls back to hardcoded logic if no schema found.
   */
  private async buildInputWithSchema(request: ProviderRequest): Promise<Record<string, any>> {
    // Try to get model capabilities
    const capabilities = await this.getModelCapabilities(request.model);

    if (capabilities) {
      console.log(`[Replicate] Using model schema for ${request.model}`);

      // Build semantic input
      const semanticInput: SemanticInput = {
        main_prompt: request.prompt,
        prompt: request.prompt,
        aspect_ratio: this.normalizeAspectRatio(request.config.aspectRatio || '1:1'),
      };

      // Add reference images as image_input (semantic key)
      if (request.referenceImages?.length && request.config.useReferenceImage) {
        // Use array format - buildPayload will transform to correct provider key
        semanticInput.image_input = request.referenceImages;
        console.log(`[Replicate] Adding ${request.referenceImages.length} reference images as image_input`);
      }

      // Add other semantic parameters
      if (request.config.negativePrompt) {
        semanticInput.negative_prompt = request.config.negativePrompt;
      }
      if (request.config.seed !== undefined) {
        semanticInput.seed = request.config.seed;
      }
      if (request.config.steps) {
        semanticInput.steps = request.config.steps;
      }
      if (request.config.guidance) {
        semanticInput.guidance = request.config.guidance;
      }

      // Build payload using model schema
      const { payload, warnings, missing_required } = buildPayload(capabilities, semanticInput);

      if (warnings.length > 0) {
        console.warn(`[Replicate] Payload warnings:`, warnings);
      }
      if (missing_required.length > 0) {
        console.warn(`[Replicate] Missing required params:`, missing_required);
      }

      console.log(`[Replicate] Schema-built payload:`, JSON.stringify(payload, null, 2));
      return payload;
    }

    // Fallback to hardcoded logic
    console.log(`[Replicate] No model schema, using fallback buildInput`);
    return this.buildInput(request);
  }

  /**
   * Check the status of an async prediction.
   */
  async checkStatus(predictionId: string): Promise<ProviderResponse> {
    const response = await fetch(`${this.baseUrl}/predictions/${predictionId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Replicate status check error ${response.status}: ${errorBody}`);
    }

    const prediction: ReplicatePrediction = await response.json();

    return {
      content: prediction.output,
      model: prediction.model,
      predictionId: prediction.id,
      status:
        prediction.status === 'succeeded'
          ? 'completed'
          : prediction.status === 'failed' || prediction.status === 'canceled'
          ? 'failed'
          : 'pending',
    };
  }

  /**
   * Cancel an async prediction.
   */
  async cancel(predictionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/predictions/${predictionId}/cancel`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Replicate cancel error ${response.status}: ${errorBody}`);
    }
  }

  /**
   * Build input payload for Replicate models.
   * Handles different input formats for different models.
   */
  private buildInput(request: ProviderRequest): Record<string, any> {
    const input: Record<string, any> = {};

    // Prompt
    if (request.prompt) {
      input.prompt = request.prompt;
    }

    // Aspect ratio
    if (request.config.aspectRatio) {
      input.aspect_ratio = this.normalizeAspectRatio(request.config.aspectRatio);
    }

    // Reference images - handle different model input formats
    if (request.referenceImages?.length && request.config.useReferenceImage) {
      const model = request.model.toLowerCase();

      // Models that use image_input (array) - e.g., google/nano-banana-pro
      if (model.includes('nano-banana') || model.includes('imagen') || request.config.useImageInputArray) {
        input.image_input = request.referenceImages;
      }
      // Models that use subject_image - e.g., some LoRA models
      else if (model.includes('lora') || model.includes('dreambooth') || request.config.useSubjectImage) {
        input.subject_image = request.referenceImages[0];
        if (request.referenceImages.length > 1) {
          input.subject_images = request.referenceImages;
        }
      }
      // Models that use control_image
      else if (request.config.useControlImage) {
        input.control_image = request.referenceImages[0];
      }
      // Default: Flux-style image_prompt (single image + strength)
      else {
        input.image_prompt = request.referenceImages[0];
        input.image_prompt_strength = request.config.referenceStrength || 0.6;
      }

      console.log(`[Replicate] Reference images for ${request.model}:`, {
        count: request.referenceImages.length,
        inputKey: Object.keys(input).find(k => k.includes('image')),
      });
    }

    // Image input for image-to-video
    if (request.config.imageInput) {
      input.image = request.config.imageInput;
      // Also set as start_image for Kling
      input.start_image = request.config.imageInput;
    }

    // Duration for video
    if (request.config.duration) {
      input.duration = request.config.duration;
    }

    // Negative prompt
    if (request.config.negativePrompt) {
      input.negative_prompt = request.config.negativePrompt;
    }

    // Seed for reproducibility
    if (request.config.seed !== undefined) {
      input.seed = request.config.seed;
    }

    // Steps for diffusion models
    if (request.config.steps) {
      input.num_inference_steps = request.config.steps;
    }

    // Guidance scale
    if (request.config.guidance) {
      input.guidance_scale = request.config.guidance;
    }

    // Output format
    if (request.config.outputFormat) {
      input.output_format = request.config.outputFormat;
    }

    // Model-specific parameters from config - these override defaults
    if (request.config.modelParams) {
      Object.assign(input, request.config.modelParams);
    }

    return input;
  }

  /**
   * Normalize aspect ratio to Replicate format.
   */
  private normalizeAspectRatio(ratio: string): string {
    const normalized: Record<string, string> = {
      landscape: '16:9',
      portrait: '9:16',
      square: '1:1',
      // Pass through standard ratios
      '16:9': '16:9',
      '9:16': '9:16',
      '1:1': '1:1',
      '4:5': '4:5',
      '4:3': '4:3',
      '3:4': '3:4',
      '21:9': '21:9',
    };

    return normalized[ratio] || ratio;
  }

  /**
   * Create a batch of predictions for multiple prompts.
   */
  async executeBatch(
    requests: ProviderRequest[]
  ): Promise<{ predictionIds: string[]; errors: string[] }> {
    const predictionIds: string[] = [];
    const errors: string[] = [];

    // Execute in parallel with concurrency limit
    const CONCURRENCY = 5;
    for (let i = 0; i < requests.length; i += CONCURRENCY) {
      const batch = requests.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map((req) => this.execute(req)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled' && result.value.predictionId) {
          predictionIds.push(result.value.predictionId);
        } else {
          const error =
            result.status === 'rejected' ? result.reason.message : 'No prediction ID returned';
          errors.push(`Request ${i + j}: ${error}`);
          predictionIds.push(''); // Placeholder to maintain index alignment
        }
      }
    }

    return { predictionIds, errors };
  }

  /**
   * Calculate estimated cost for a Replicate prediction.
   * Note: Actual costs may vary based on compute time.
   */
  static estimateCost(model: string, computeSeconds: number = 10): number {
    // Approximate costs per second for different GPU types
    const gpuCosts: Record<string, number> = {
      'cpu': 0.0001,
      'gpu-t4': 0.00055,
      'gpu-a40-small': 0.00115,
      'gpu-a40-large': 0.0023,
      'gpu-a100': 0.0023,
    };

    // Default to A40 small for most models
    const costPerSecond = gpuCosts['gpu-a40-small'];
    return costPerSecond * computeSeconds;
  }
}

// Register with factory
ProviderFactory.register('replicate', ReplicateProvider);

export default ReplicateProvider;
