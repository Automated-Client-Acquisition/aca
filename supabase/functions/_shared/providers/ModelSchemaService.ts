/**
 * Model Schema Service
 *
 * Provides model schema lookup and payload building functionality.
 * This is the canonical way to transform semantic inputs to provider-specific payloads.
 *
 * The flow:
 * 1. Look up model in `ai_models` table to get `normalized_capabilities`
 * 2. Use `buildPayload()` to transform semantic keys (image_input, aspect_ratio)
 *    to provider-specific keys based on the model's schema
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

// ============= TYPES =============

export interface NormalizedCapabilities {
  roles: Record<
    string,
    {
      provider_key: string | null;
      type: string;
      required: boolean;
      transform?: Transform;
      accepts?: string[];
    }
  >;
  input_types: string[];
  output_types: string[];
  supports_pipelines: string[];
  parameter_constraints?: Record<
    string,
    {
      min?: number;
      max?: number;
      default?: any;
    }
  >;
}

export interface Transform {
  type: 'multiply' | 'divide' | 'enum' | 'boolean_invert';
  factor?: number;
  from?: any[];
  values?: any[];
}

export interface SemanticInput {
  main_prompt?: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  guidance?: number;
  aspect_ratio?: string;
  resolution_tier?: 'SD' | 'HD' | 'FHD' | 'UHD';
  seconds?: number;
  resolution?: string;
  image_input?: string | string[]; // Can be single image URL or array of URLs
  video_input?: string;
  audio_input?: string;
  text?: string;
  voice_id?: string;
  model_id?: string;
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  response_format?: any;
  [key: string]: any;
}

export interface BuildPayloadResult {
  payload: Record<string, any>;
  warnings: string[];
  missing_required: string[];
}

// ============= CONSTANTS =============

const RESOLUTION_TIERS: Record<string, number> = {
  SD: 512,
  HD: 1024,
  FHD: 1920,
  UHD: 2560,
};

const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '4:3': { w: 4, h: 3 },
  '3:4': { w: 3, h: 4 },
  '21:9': { w: 21, h: 9 },
  '3:2': { w: 3, h: 2 },
  '2:3': { w: 2, h: 3 },
  '4:5': { w: 4, h: 5 },
  '5:4': { w: 5, h: 4 },
};

// ============= HELPER FUNCTIONS =============

function computeDimensions(
  aspectRatio?: string,
  resolutionTier: string = 'HD'
): { width: number; height: number } | null {
  if (!aspectRatio) return null;
  const ratio = ASPECT_RATIOS[aspectRatio];
  if (!ratio) return null;
  const baseSize = RESOLUTION_TIERS[resolutionTier] || RESOLUTION_TIERS.HD;

  if (ratio.w >= ratio.h) {
    const width = baseSize;
    const height = Math.round((baseSize * ratio.h) / ratio.w);
    return { width, height };
  } else {
    const height = baseSize;
    const width = Math.round((baseSize * ratio.w) / ratio.h);
    return { width, height };
  }
}

function applyTransform(value: any, transform: Transform, fullInput: SemanticInput): any {
  switch (transform.type) {
    case 'multiply':
      if (typeof value === 'number' && transform.factor) {
        return value * transform.factor;
      }
      throw new Error('Multiply requires numeric value and factor');
    case 'divide':
      if (typeof value === 'number' && transform.factor) {
        return value / transform.factor;
      }
      throw new Error('Divide requires numeric value and factor');
    case 'enum':
      // If transform has 'from' array, map from those values to 'values' array
      if (transform.from && transform.values) {
        const fromIndex = transform.from.indexOf(value);
        if (fromIndex !== -1 && fromIndex < transform.values.length) {
          return transform.values[fromIndex];
        }
        // Value not in 'from' array, check if it's already a valid output value
        if (transform.values.includes(value)) {
          return value;
        }
        // Fallback to first value
        return transform.values[0];
      }
      // Simple enum validation (no mapping)
      if (transform.values && !transform.values.includes(value)) {
        return transform.values[0];
      }
      return value;
    case 'boolean_invert':
      return !value;
    default:
      return value;
  }
}

function applyConstraints(
  value: any,
  constraints: { min?: number; max?: number; default?: any },
  paramName: string,
  warnings: string[]
): any {
  if (typeof value === 'number') {
    if (constraints.min !== undefined && value < constraints.min) {
      warnings.push(`${paramName} below minimum, clamping to ${constraints.min}`);
      return constraints.min;
    }
    if (constraints.max !== undefined && value > constraints.max) {
      warnings.push(`${paramName} above maximum, clamping to ${constraints.max}`);
      return constraints.max;
    }
  }
  return value;
}

// ============= MAIN FUNCTIONS =============

/**
 * Build provider-specific payload from semantic input using model capabilities.
 *
 * This transforms semantic keys like `image_input` and `aspect_ratio` to
 * the provider-specific keys defined in the model's normalized_capabilities.
 */
export function buildPayload(
  normalizedCapabilities: NormalizedCapabilities,
  userInput: SemanticInput,
  recipeDefaults: Record<string, any> = {}
): BuildPayloadResult {
  const payload: Record<string, any> = {};
  const warnings: string[] = [];
  const missing_required: string[] = [];

  const mergedInput = { ...recipeDefaults, ...userInput };

  // Also check 'prompt' as alias for 'main_prompt'
  if (mergedInput.prompt && !mergedInput.main_prompt) {
    mergedInput.main_prompt = mergedInput.prompt;
  }

  for (const [semanticRole, roleConfig] of Object.entries(normalizedCapabilities.roles)) {
    const { provider_key, required, transform } = roleConfig;

    if (provider_key === null) continue;

    let value = mergedInput[semanticRole];

    // Compute dimensions for resolution_tier
    if (semanticRole === 'resolution_tier' && !value) {
      const dimensions = computeDimensions(
        mergedInput.aspect_ratio,
        mergedInput.resolution_tier || 'HD'
      );
      if (dimensions) {
        payload.width = dimensions.width;
        payload.height = dimensions.height;
      }
      continue;
    }

    if (required && (value === undefined || value === null)) {
      missing_required.push(semanticRole);
      continue;
    }

    if (value === undefined || value === null) continue;

    // Apply transforms
    if (transform) {
      try {
        value = applyTransform(value, transform, mergedInput);
      } catch (error) {
        warnings.push(`Transform failed for ${semanticRole}: ${error}`);
        continue;
      }
    }

    // Apply constraints
    if (normalizedCapabilities.parameter_constraints?.[semanticRole]) {
      const constraints = normalizedCapabilities.parameter_constraints[semanticRole];
      value = applyConstraints(value, constraints, semanticRole, warnings);
    }

    // Special case for OpenRouter/LLM chat messages format
    if (provider_key === 'messages' && typeof value === 'string') {
      payload[provider_key] = [{ role: 'user', content: value }];
    } else {
      payload[provider_key] = value;
    }
  }

  return { payload, warnings, missing_required };
}

/**
 * Look up model schema from database.
 *
 * For image/video generation, a curated schema is required.
 * For text/TTS, defaults are used if no schema found.
 */
export async function ensureModelSchema(
  supabase: SupabaseClient,
  provider: string,
  modelId: string,
  stageType: 'text_llm' | 'image_generator' | 'image_to_video' | 'world_simulator' | 'tts'
): Promise<NormalizedCapabilities | null> {
  console.log(`[ModelSchemaService] Looking up ${provider}/${modelId} schema...`);

  // Query the database for curated model schema
  const { data: model, error } = await supabase
    .from('ai_models')
    .select('display_name, normalized_capabilities, is_curated')
    .eq('provider', provider)
    .eq('model_id', modelId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error(`[ModelSchemaService] Database error: ${error.message}`);
  }

  // If found and has normalized capabilities, use it
  if (model?.normalized_capabilities) {
    const curatedLabel = model.is_curated ? '(curated)' : '';
    console.log(
      `[ModelSchemaService] ✅ Found schema for ${model.display_name || modelId} ${curatedLabel}`
    );
    return model.normalized_capabilities as NormalizedCapabilities;
  }

  // For media generation stages - REQUIRE curated schema
  const mediaStages = ['image_generator', 'image_to_video', 'world_simulator'];
  if (mediaStages.includes(stageType)) {
    console.error(`[ModelSchemaService] ❌ Model ${provider}/${modelId} not found in curated models!`);
    console.error(`[ModelSchemaService] Please add this model to ai_models table with normalized_capabilities`);
    throw new Error(
      `Model ${provider}/${modelId} is not supported. Only curated models with schemas are allowed for ${stageType} generation.`
    );
  }

  // For text_llm and tts - allow working with defaults
  console.warn(`[ModelSchemaService] ⚠️ No schema found for ${provider}/${modelId}, using defaults`);
  return null;
}

/**
 * Get the provider key for a semantic role from model capabilities.
 * Returns null if the role doesn't exist or has no provider key.
 */
export function getProviderKey(
  capabilities: NormalizedCapabilities,
  semanticRole: string
): string | null {
  return capabilities.roles[semanticRole]?.provider_key ?? null;
}

/**
 * Check if a model supports a specific semantic role.
 */
export function supportsRole(
  capabilities: NormalizedCapabilities,
  semanticRole: string
): boolean {
  return semanticRole in capabilities.roles && capabilities.roles[semanticRole].provider_key !== null;
}

export default {
  buildPayload,
  ensureModelSchema,
  getProviderKey,
  supportsRole,
};
