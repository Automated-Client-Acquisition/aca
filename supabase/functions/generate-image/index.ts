import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Convert friendly aspect ratio names to actual ratios for API calls
const ASPECT_RATIO_MAP: Record<string, string> = {
  'landscape': '16:9',
  'portrait': '9:16',
  'square': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
};

// ============= PAYLOAD BUILDER TYPES =============
interface NormalizedCapabilities {
  roles: Record<string, {
    provider_key: string | null;
    required?: boolean;
    transform?: any;
    type?: string; // e.g., "string", "array", "integer", "uri", etc.
  }>;
  parameter_constraints?: Record<string, any>;
}

interface UserInput {
  main_prompt: string;
  aspect_ratio?: string;
  resolution_tier?: string;
  steps?: number;
  guidance?: number;
  seed?: number;
  negative_prompt?: string;
  image_input?: string;
}

// ============= PAYLOAD BUILDER INFRASTRUCTURE =============
// Copied from execute-stage for consistency

const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1344, height: 768 },
  '9:16': { width: 768, height: 1344 },
  '4:3': { width: 1152, height: 896 },
  '3:4': { width: 896, height: 1152 },
  '3:2': { width: 1216, height: 832 },
  '2:3': { width: 832, height: 1216 },
};

function computeDimensions(aspectRatio: string | undefined, tier: string = 'HD') {
  if (!aspectRatio) return null;
  const base = ASPECT_DIMENSIONS[aspectRatio];
  if (!base) return null;
  const scale = tier === '4K' ? 2 : tier === 'SD' ? 0.5 : 1;
  return {
    width: Math.round(base.width * scale),
    height: Math.round(base.height * scale),
  };
}

function applyTransform(value: any, transform: any, fullInput: UserInput): any {
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
      if (transform.from && transform.values) {
        const fromIndex = transform.from.indexOf(value);
        if (fromIndex !== -1 && fromIndex < transform.values.length) {
          return transform.values[fromIndex];
        }
        if (transform.values.includes(value)) {
          return value;
        }
        return transform.values[0];
      }
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

function applyConstraints(value: any, constraints: any, key: string, warnings: string[]): any {
  if (constraints.min !== undefined && typeof value === 'number' && value < constraints.min) {
    warnings.push(`${key} clamped from ${value} to min ${constraints.min}`);
    return constraints.min;
  }
  if (constraints.max !== undefined && typeof value === 'number' && value > constraints.max) {
    warnings.push(`${key} clamped from ${value} to max ${constraints.max}`);
    return constraints.max;
  }
  if (constraints.enum && !constraints.enum.includes(value)) {
    warnings.push(`${key} value "${value}" not in allowed enum, using first value`);
    return constraints.enum[0];
  }
  return value;
}

function buildPayload(
  normalizedCapabilities: NormalizedCapabilities,
  userInput: UserInput,
  recipeDefaults: Record<string, any> = {}
) {
  const payload: Record<string, any> = {};
  const warnings: string[] = [];
  const missing_required: string[] = [];

  const mergedInput = { ...recipeDefaults, ...userInput };

  for (const [semanticRole, roleConfig] of Object.entries(normalizedCapabilities.roles)) {
    const { provider_key, required, transform, type } = roleConfig;

    if (provider_key === null) continue;

    let value = (mergedInput as any)[semanticRole];

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

    // Handle array types - wrap single value in array if needed
    if (type === 'array' && value !== undefined && value !== null && !Array.isArray(value)) {
      value = [value];
      console.log(`📦 Wrapped ${semanticRole} in array for model compatibility`);
    }

    payload[provider_key] = value;
  }

  return { payload, warnings, missing_required };
}

async function ensureModelSchema(
  supabase: any,
  provider: string,
  modelId: string
): Promise<NormalizedCapabilities | null> {
  console.log(`🔍 Checking for ${provider}/${modelId} schema in database...`);

  const { data: model, error } = await supabase
    .from('ai_models')
    .select('display_name, normalized_capabilities, is_curated')
    .eq('provider', provider)
    .eq('model_id', modelId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error(`Database error looking up model: ${error.message}`);
  }

  if (model?.normalized_capabilities) {
    const curatedLabel = model.is_curated ? '(curated)' : '';
    console.log(`✅ Using database schema for ${model.display_name || modelId} ${curatedLabel}`);
    return model.normalized_capabilities as NormalizedCapabilities;
  }

  console.error(`❌ Model ${provider}/${modelId} not found in curated models!`);
  throw new Error(`Model ${provider}/${modelId} is not supported. Only curated models with schemas are allowed for image generation.`);
}

// ============= END PAYLOAD BUILDER INFRASTRUCTURE =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    console.log('🔵 STEP 1: Parsing request body...');
    const body = await req.json();
    console.log('🔵 STEP 1.1: Request body parsed:', JSON.stringify(body));
    const { output_id, prompt, instructions, aspect_ratio, organization_id, reference_image } = body;

    if (!output_id || !prompt) {
      throw new Error('output_id and prompt are required');
    }
    console.log('🔵 STEP 2: Validated required fields - output_id:', output_id);

    // Combine prompt with instructions if provided
    let finalPrompt = prompt;
    if (instructions && instructions.trim()) {
      finalPrompt = `${prompt}\n\nAdditional instructions: ${instructions.trim()}`;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`🎨 Starting async image generation for output ${output_id}`);
    console.log(`📝 Prompt: ${finalPrompt.slice(0, 100)}...`);

    // Get the output with job configuration to find organization_id and model config
    console.log('🔵 STEP 3: Fetching output from database...');
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*, content_generation_jobs!inner(organization_id, configuration)')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      console.error('🔴 STEP 3 FAILED: Output lookup error:', outputError?.message);
      throw new Error(`Output not found: ${outputError?.message}`);
    }
    console.log('🔵 STEP 3 OK: Output found, pipeline:', output.pipeline);

    // The service-role client spends the output's org's Replicate key, so the org
    // comes from the output's job (never the body) and the caller must be able to
    // access it (a valid anon-key JWT alone is not enough). The body org is ignored:
    // useGenerateImage sends the user's home org, not the org they are working in.
    const orgId = output.content_generation_jobs.organization_id;
    try {
      await assertOrgAccess(req, supabase, orgId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }
    const jobConfig = output.content_generation_jobs.configuration || {};

    // Verify storage credentials exist before starting generation
    console.log('🔵 STEP 4: Checking storage credentials for org:', orgId);
    const { data: storageCredentials, error: storageError } = await supabase
      .from('storage_credentials')
      .select('id')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .single();

    if (!storageCredentials) {
      console.error('🔴 STEP 4 FAILED: No storage credentials. Error:', storageError?.message);
      throw new Error('No active storage credentials found. Please configure cloud storage in Settings before generating images.');
    }
    console.log('🔵 STEP 4 OK: Storage credentials found');

    // Get organization's Replicate API key
    console.log('🔵 STEP 5: Fetching Replicate API key...');
    const { data: apiKeys, error: apiKeysError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('organization_id', orgId)
      .eq('provider', 'replicate');

    if (apiKeysError || !apiKeys || apiKeys.length === 0) {
      console.error('🔴 STEP 5 FAILED: No Replicate API key. Error:', apiKeysError?.message);
      throw new Error('Replicate API key not configured for organization');
    }
    console.log('🔵 STEP 5 OK: Replicate API key found');

    console.log('🔵 STEP 6: Decrypting API key...');
    const replicateKey = apiKeys[0];
    const decryptedKey = await decryptApiKey(replicateKey.key_encrypted);
    console.log('🔵 STEP 6 OK: API key decrypted');

    // Get model from blueprint configuration, fallback to flux-schnell
    const modelId = jobConfig?.model_config?.image_generator?.model_id || 'black-forest-labs/flux-schnell';
    const imageParams = jobConfig?.model_config?.image_generator?.parameters || {};
    console.log(`🤖 Using model: ${modelId}`);

    // Mark output as generating
    const currentData = output.data || {};
    const currentStageDataEarly = output.stage_data || {};

    // For image_only pipeline, update stage_data.image; otherwise update data.image_status
    if (output.pipeline === 'image_only') {
      await supabase
        .from('content_outputs')
        .update({
          status: 'generating',
          stage_data: {
            ...currentStageDataEarly,
            image: {
              ...currentStageDataEarly.image,
              status: 'generating',
              prompt: finalPrompt,
              started_at: new Date().toISOString()
            }
          }
        })
        .eq('id', output_id);
    } else {
      await supabase
        .from('content_outputs')
        .update({
          data: {
            ...currentData,
            image_status: 'generating',
            image_prompt: finalPrompt
          }
        })
        .eq('id', output_id);
    }

    // Create webhook URL
    const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;

    // Determine API endpoint based on model identifier format
    const isModelIdentifier = modelId.includes('/') && !modelId.match(/^[a-f0-9]{64}$/);
    const apiEndpoint = isModelIdentifier
      ? `https://api.replicate.com/v1/models/${modelId}/predictions`
      : 'https://api.replicate.com/v1/predictions';

    console.log(`🚀 Starting async prediction with webhook via ${apiEndpoint}`);

    // Resolve reference image - from request, imageParams, or generation_params
    const generationParams = output.generation_params || {};

    // Resolve aspect ratio - check output_config from generation_params for image_only pipeline
    const outputConfig = generationParams.output_config || {};
    const resolvedAspectRatio = ASPECT_RATIO_MAP[aspect_ratio]
      || aspect_ratio
      || ASPECT_RATIO_MAP[outputConfig.aspectRatio]
      || outputConfig.aspectRatio
      || imageParams.aspect_ratio
      || '16:9';

    console.log(`📐 Using aspect ratio: ${resolvedAspectRatio}`);

    // Build payload using the curated model schema
    console.log('🔵 STEP 7: Loading model schema for', modelId);
    const capabilities = await ensureModelSchema(supabase, 'replicate', modelId);
    console.log('🔵 STEP 7 OK: Model schema loaded');

    // image_inputs is Record<string, string[]> - get the first image from any category
    const imageInputs = generationParams.image_inputs || {};
    const firstImageInput = Object.values(imageInputs).flat()[0] || null;

    const resolvedReferenceImage = reference_image
      || imageParams.reference_image
      || firstImageInput
      || null;

    if (resolvedReferenceImage) {
      console.log(`🖼️ Using reference image: ${resolvedReferenceImage.slice(0, 80)}...`);
    }

    const semanticInput: UserInput = {
      main_prompt: finalPrompt,
      aspect_ratio: resolvedAspectRatio,
      resolution_tier: imageParams.resolution_tier || 'HD',
      ...(imageParams.steps && { steps: imageParams.steps }),
      ...(imageParams.guidance_scale && { guidance: imageParams.guidance_scale }),
      ...(imageParams.seed && { seed: imageParams.seed }),
      ...(imageParams.negative_prompt && { negative_prompt: imageParams.negative_prompt }),
      ...(resolvedReferenceImage && { image_input: resolvedReferenceImage }),
    };

    let inputParams: Record<string, any>;
    if (capabilities) {
      const result = buildPayload(capabilities, semanticInput);
      if (result.warnings.length > 0) {
        console.warn('Payload builder warnings:', result.warnings);
      }
      inputParams = result.payload;
    } else {
      // Fallback for uncurated models (shouldn't happen due to ensureModelSchema throw)
      inputParams = {
        prompt: finalPrompt,
        num_outputs: 1,
        aspect_ratio: resolvedAspectRatio,
      };
    }

    console.log(`📦 Built payload:`, JSON.stringify(inputParams));

    const requestBody: any = {
      input: inputParams,
      webhook: webhookUrl,
      webhook_events_filter: ["completed"]
    };

    // Only add version field if it's a SHA256 hash (for /predictions endpoint)
    if (!isModelIdentifier) {
      requestBody.version = modelId;
    }

    console.log('🔵 STEP 8: Calling Replicate API...');
    const createResponse = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=5'
      },
      body: JSON.stringify(requestBody)
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error('🔴 STEP 8 FAILED: Replicate API returned', createResponse.status, errorText);
      throw new Error(`Replicate API error: ${createResponse.status} - ${errorText}`);
    }

    const prediction = await createResponse.json();
    console.log('🔵 STEP 8 OK: Prediction started:', prediction.id);

    // Store prediction for webhook lookup
    // For image_only pipeline, use 'image' stage; otherwise use 'manual_image'
    const stageId = output.pipeline === 'image_only' ? 'image' : 'manual_image';
    const currentGenerationParams = output.generation_params || {};
    const pendingPredictions = currentGenerationParams.pending_predictions || [];

    pendingPredictions.push({
      prediction_id: prediction.id,
      stage_id: stageId,
      item_type: 'image',
      started_at: new Date().toISOString()
    });

    // Update stage_data to track this generation
    // IMPORTANT: Preserve existing stage data (url, image_url, metrics, etc.)
    // so the frontend can still show the existing image while regenerating
    const currentStageData = output.stage_data || {};
    const existingStageInfo = currentStageData[stageId] || {};
    const updatedStageData = {
      ...currentStageData,
      [stageId]: {
        ...existingStageInfo, // Preserve existing url, image_url, metrics, etc.
        status: 'generating',
        prompt: finalPrompt,
        started_at: new Date().toISOString(),
        prediction_id: prediction.id
      }
    };

    await supabase.from('content_outputs').update({
      status: 'generating',
      generation_params: {
        ...currentGenerationParams,
        pending_predictions: pendingPredictions
      },
      stage_data: updatedStageData
    }).eq('id', output_id);

    console.log(`✅ Prediction ${prediction.id} queued - webhook will handle completion`);

    return new Response(
      JSON.stringify({
        success: true,
        status: 'processing',
        prediction_id: prediction.id,
        message: 'Image generation started. Results will be delivered via webhook.',
        output_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('❌ Image generation error:', errorMessage);
    console.error('Stack trace:', errorStack);

    // Return 200 with error in body so frontend can display the actual error message
    // (500 status causes Supabase client to throw before reading the body)
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        error_details: errorStack
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY');

  if (!encryptionKeyHex) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  try {
    const keyBytes = new Uint8Array(
      encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    const encryptedData = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);

    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}
