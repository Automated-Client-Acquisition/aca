import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { interleaveReferenceImageGroups } from "../_shared/autopilot-reference-merge.ts";

// Unified execution engine imports (Phase 4 migration)
import { createExecutionEngine, StageRegistry } from '../_shared/execution/index.ts';
import { isOllamaModel, stripOllamaPrefix, OLLAMA_CLOUD_BASE_URL, OLLAMA_NO_KEY_SENTINEL } from '../_shared/llm-client.ts';
// Auto-register stage definitions
import '../_shared/stages/definitions/index.ts';

import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_IMAGE_MODEL } from '../_shared/default-models.ts';
import { handleOpenRouterCreditsError } from '../_shared/openrouter-credits.ts';
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';
import { resolveReferenceImagesToDataUrls } from '../_shared/image-reference-resolver.ts';
import { OPENROUTER_IMAGES_URL, snapAspectRatio, supportedAspectRatios, usesOpenRouterImagesApi } from '../_shared/openrouter-images-api.ts';
import { buildLabeledReferenceContent, buildReferenceParts, describeStyleReference, hasRoleReferences, referencesAsText, referencesBriefForPromptWriter, resolveRoleReferences, resolveRequiredReferenceImages, withReferenceRequirements, type ContentPart, type ResolvedReference } from '../_shared/image-references.ts';
import { loadRecentPieces, recentImagesBrief } from '../_shared/recent-pieces.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { splitThreadTweets, threadContent } from '../_shared/thread-tweets.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { OpenAIImageProvider, DEFAULT_OPENAI_IMAGE_MODEL } from '../_shared/providers/OpenAIImageProvider.ts';

// Feature flag for new execution engine — enabled by default, disable with env var set to 'false'
const USE_NEW_ENGINE = Deno.env.get('USE_NEW_EXECUTION_ENGINE') !== 'false';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default timeout for API calls (60 seconds)
const API_TIMEOUT_MS = 60000;

/**
 * Fetch with timeout - wraps fetch with AbortController to prevent hanging requests
 * @param url The URL to fetch
 * @param options Fetch options
 * @param timeoutMs Timeout in milliseconds (default: 60000)
 */

// ── Provider-routed text-LLM target ─────────────────────────────────
// Blueprint text models may run on the org's Ollama server (model ids carry
// the `ollama:` prefix). This resolves the chat-completions URL, auth headers
// and the provider-native model id from the org's already-loaded api_keys rows.
interface StageTextLlmTarget {
  url: string;
  headers: Record<string, string>;
  modelId: string;
  provider: 'ollama' | 'openrouter';
}

async function resolveStageTextLlm(
  // deno-lint-ignore no-explicit-any
  apiKeys: any[],
  rawModelId: string,
  openRouterDecryptedKey: string,
): Promise<StageTextLlmTarget> {
  if (isOllamaModel(rawModelId)) {
    const row = apiKeys.find((k: { provider: string }) => k.provider === 'ollama');
    if (!row) throw new Error('Ollama is not configured for this organization. Add it in Settings > API Keys.');
    const base = ((row.metadata?.dsn_url as string) || OLLAMA_CLOUD_BASE_URL).replace(/\/+$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const key = await decryptApiKey(row.key_encrypted);
      if (key && key !== OLLAMA_NO_KEY_SENTINEL) headers['Authorization'] = `Bearer ${key}`;
    } catch { /* self-hosted server without auth */ }
    return { url: `${base}/v1/chat/completions`, headers, modelId: stripOllamaPrefix(rawModelId), provider: 'ollama' };
  }
  return {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { 'Authorization': `Bearer ${openRouterDecryptedKey}`, 'Content-Type': 'application/json' },
    modelId: rawModelId,
    provider: 'openrouter',
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Helper to get brand data (supports 'library_brand_voices', 'brand', and legacy 'brand_voice' keys)
function getBrandVoice(libraryElements: Record<string, any>): any {
  const bvData = libraryElements.library_brand_voices || libraryElements.brand || libraryElements.brand_voice;
  if (!bvData) return null;
  return Array.isArray(bvData) ? bvData[0] : bvData;
}

// Helper to get character data from library elements
function getCharacter(libraryElements: Record<string, any>): any {
  // Try multiple keys: library_characters (from wizard), character (from some pipelines)
  const charData = libraryElements.library_characters || libraryElements.character;
  if (!charData) return null;
  return Array.isArray(charData) ? charData[0] : charData;
}

// Date variables — resolved at generation time so content references correct dates
function getDateVariables(): Record<string, string> {
  const now = new Date();
  return {
    current_year: String(now.getFullYear()),
    current_month: now.toLocaleString('en-US', { month: 'long' }),
    current_month_short: now.toLocaleString('en-US', { month: 'short' }),
    current_month_number: String(now.getMonth() + 1).padStart(2, '0'),
    current_date: now.toISOString().split('T')[0],
    current_quarter: `Q${Math.ceil((now.getMonth() + 1) / 3)}`,
  };
}

// Replace {{current_year}}, {{current_month}}, etc. in a template string
function resolveDateVariables(text: string): string {
  const vars = getDateVariables();
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    text = text.replace(regex, value);
  }
  return text;
}

// Helper to extract voice_id from a character's voice configuration
// Characters store voice in either:
// - voice_selection: direct ElevenLabs voice_id string (e.g., "CwhRBWXzGAHq8TQ4Fs17")
// - voice_config: JSON object { provider: "elevenlabs", voice_id: "...", voice_name: "..." }
function getVoiceIdFromCharacter(libraryElements: Record<string, any>): string | null {
  const character = getCharacter(libraryElements);
  if (!character) return null;

  // First check voice_selection (preferred, it's the direct voice_id)
  if (character.voice_selection && typeof character.voice_selection === 'string') {
    console.log(`[getVoiceIdFromCharacter] Using voice_selection: ${character.voice_selection}`);
    return character.voice_selection;
  }

  // Then check voice_config object
  if (character.voice_config) {
    const config = typeof character.voice_config === 'string'
      ? JSON.parse(character.voice_config)
      : character.voice_config;
    if (config.voice_id) {
      console.log(`[getVoiceIdFromCharacter] Using voice_config.voice_id: ${config.voice_id}`);
      return config.voice_id;
    }
  }

  return null;
}

// ============= PAYLOAD BUILDER INFRASTRUCTURE =============

interface NormalizedCapabilities {
  roles: Record<string, {
    provider_key: string | null;
    type: string;
    required: boolean;
    transform?: any;
    accepts?: string[];
  }>;
  input_types: string[];
  output_types: string[];
  supports_pipelines: string[];
  parameter_constraints?: Record<string, {
    min?: number;
    max?: number;
    default?: any;
  }>;
}

interface UserInput {
  main_prompt?: string;
  negative_prompt?: string;
  seed?: number;
  steps?: number;
  guidance?: number;
  aspect_ratio?: string;
  resolution_tier?: 'SD' | 'HD' | 'FHD' | 'UHD';
  seconds?: number;
  resolution?: string;
  image_input?: string | string[];  // Can be single image URL or array of URLs
  reference_images?: string[];       // Deprecated - use image_input instead
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
};

// Convert friendly aspect ratio names to actual ratios for API calls
const ASPECT_RATIO_MAP: Record<string, string> = {
  'landscape': '16:9',
  'portrait': '9:16',
  'square': '1:1',
  // Allow actual ratios to pass through unchanged
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  // Instagram carousel specific ratios
  '4:5': '4:5',
};

/**
 * Extract reference images from library elements and explicit image inputs.
 * Collects product images and character reference images for image generation.
 *
 * Note: imageInputs keys can be either full table names (library_products, library_characters)
 * or shorthand names (product, character) depending on the source.
 *
 * @param imageInputs - Selected images from wizard by library type
 * @param libraryElements - Library element data
 * @param imageUsageMode - 'auto' (default) uses existing logic, 'force_all' includes all selected images
 */
function extractReferenceImages(
  imageInputs: Record<string, string[]>,
  libraryElements: Record<string, any>,
  imageUsageMode?: 'auto' | 'force_all'
): string[] {
  let referenceImages: string[] = [];

  // If force_all mode, return ALL images from imageInputs regardless of other logic
  if (imageUsageMode === 'force_all') {
    console.log(`[extractReferenceImages] force_all mode - including all selected images`);
    const imageGroups: string[][] = [];
    for (const [key, images] of Object.entries(imageInputs || {})) {
      if (Array.isArray(images) && images.length > 0) {
        imageGroups.push(images);
        console.log(`[extractReferenceImages] force_all: Added ${images.length} images from ${key}`);
      }
    }
    referenceImages = interleaveReferenceImageGroups(imageGroups);
    console.log(`[extractReferenceImages] force_all mode total: ${referenceImages.length} images`);
    return referenceImages;
  }

  // Default 'auto' mode: use existing priority-based logic

  // Priority 1: Explicitly selected images in wizard (imageInputs)
  // Handle both full table names (library_products) and shorthand names (product)
  const productImages = imageInputs?.library_products || imageInputs?.product || [];
  const characterImages = imageInputs?.library_characters || imageInputs?.character || [];
  const brandImages = imageInputs?.library_brand_voices || imageInputs?.brand || [];
  const libraryImages = imageInputs?.library_images || imageInputs?.images || [];
  const icpImages = imageInputs?.library_icps || imageInputs?.icp || [];
  const blockImages = imageInputs?.library_blocks || imageInputs?.block || [];

  const explicitImageGroups = [
    productImages,
    characterImages,
    brandImages,
    libraryImages,
    icpImages,
    blockImages,
  ];
  referenceImages = interleaveReferenceImageGroups(explicitImageGroups);

  if (productImages.length > 0) console.log(`[extractReferenceImages] Found ${productImages.length} product images from imageInputs`);
  if (characterImages.length > 0) console.log(`[extractReferenceImages] Found ${characterImages.length} character images from imageInputs`);
  if (brandImages.length > 0) console.log(`[extractReferenceImages] Found ${brandImages.length} brand images from imageInputs`);
  if (libraryImages.length > 0) console.log(`[extractReferenceImages] Found ${libraryImages.length} library images from imageInputs`);
  if (icpImages.length > 0) console.log(`[extractReferenceImages] Found ${icpImages.length} ICP images from imageInputs`);
  if (blockImages.length > 0) console.log(`[extractReferenceImages] Found ${blockImages.length} block images from imageInputs`);

  // Priority 2: Fall back to library element images if no explicit selection
  if (referenceImages.length === 0) {
    console.log(`[extractReferenceImages] No explicit images, falling back to library elements`);

    // Check product images (handle both key formats)
    const product = libraryElements?.library_products || libraryElements?.product;
    if (product) {
      const prod = Array.isArray(product) ? product[0] : product;
      if (prod?.images?.length > 0) {
        referenceImages = [...referenceImages, ...prod.images];
        console.log(`[extractReferenceImages] Found ${prod.images.length} images from product library element`);
      }
    }

    // Check character reference images (handle both key formats)
    const character = libraryElements?.library_characters || libraryElements?.character;
    if (character) {
      const char = Array.isArray(character) ? character[0] : character;
      if (char?.reference_images?.length > 0) {
        referenceImages = [...referenceImages, ...char.reference_images];
        console.log(`[extractReferenceImages] Found ${char.reference_images.length} images from character library element`);
      }
    }

    // Check brand reference images and logo (handle both key formats)
    const brand = libraryElements?.library_brand_voices || libraryElements?.brand;
    if (brand) {
      const b = Array.isArray(brand) ? brand[0] : brand;
      // Add reference images if available
      if (b?.reference_images?.length > 0) {
        referenceImages = [...referenceImages, ...b.reference_images];
        console.log(`[extractReferenceImages] Found ${b.reference_images.length} images from brand library element`);
      }
      // Also include brand logo as a reference image
      if (b?.logo && typeof b.logo === 'string') {
        referenceImages = [...referenceImages, b.logo];
        console.log(`[extractReferenceImages] Found brand logo from library element`);
      }
    }

    // Check library image images (handle both key formats)
    const libraryImageElement = libraryElements?.library_images || libraryElements?.images;
    if (libraryImageElement) {
      const li = Array.isArray(libraryImageElement) ? libraryImageElement[0] : libraryImageElement;
      if (li?.images?.length > 0) {
        referenceImages = [...referenceImages, ...li.images];
        console.log(`[extractReferenceImages] Found ${li.images.length} images from library_images element`);
      }
    }

    // Check ICP reference images (handle both key formats)
    const icp = libraryElements?.library_icps || libraryElements?.icp;
    if (icp) {
      const i = Array.isArray(icp) ? icp[0] : icp;
      if (i?.reference_images?.length > 0) {
        referenceImages = [...referenceImages, ...i.reference_images];
        console.log(`[extractReferenceImages] Found ${i.reference_images.length} images from ICP library element`);
      }
    }

    // Check block images (handle both key formats)
    const block = libraryElements?.library_blocks || libraryElements?.block;
    if (block) {
      const bl = Array.isArray(block) ? block[0] : block;
      if (bl?.images?.length > 0) {
        referenceImages = [...referenceImages, ...bl.images];
        console.log(`[extractReferenceImages] Found ${bl.images.length} images from block library element`);
      }
    }
  }

  if (referenceImages.length > 0) {
    console.log(`[extractReferenceImages] Total: ${referenceImages.length} reference images:`, referenceImages.slice(0, 3), referenceImages.length > 3 ? `... and ${referenceImages.length - 3} more` : '');
  } else {
    console.log(`[extractReferenceImages] No reference images found. imageInputs keys:`, Object.keys(imageInputs || {}), 'libraryElements keys:', Object.keys(libraryElements || {}));
  }

  return referenceImages;
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

function computeDimensions(aspectRatio?: string, resolutionTier: string = 'HD') {
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

/**
 * Fix typical AI typography issues in any string.
 * This is applied to all text content including inside JSON structures.
 */
function fixAITypography(text: string): string {
  if (!text) return text;

  // Dashes go through the shared rule so published content reads the same way
  // outbound copy does. A bare hyphen ("It works - try it") was its own tell.
  return normalizeDashes(text)
    // Replace smart double quotes with straight quotes
    .replace(/[""]/g, '"')
    // Replace smart single quotes/apostrophes with straight quotes
    .replace(/['']/g, "'")
    // Replace ellipsis character with three dots
    .replace(/…/g, '...');
}

/**
 * Clean LLM output by removing markdown formatting elements.
 * This ensures content is ready for direct posting to social media platforms.
 *
 * Removes:
 * - Markdown headers (# ## ###)
 * - Bold/italic markers (** * __ _)
 * - Code blocks (``` `)
 * - Blockquotes (>)
 * - Horizontal rules (--- ***)
 * - Link syntax [text](url)
 * - Informational prefixes like "Here's..." or "Caption:"
 */
function cleanTextOutput(content: string): string {
  if (!content) return content;

  let cleaned = content;

  // Remove markdown code blocks (```...```)
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`...`)
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Remove markdown headers (# ## ### etc.)
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Remove bold markers (**text** or __text__)
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
  cleaned = cleaned.replace(/__([^_]+)__/g, '$1');

  // Remove italic markers (*text* or _text_) - be careful not to affect asterisks/underscores in other contexts
  cleaned = cleaned.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1');
  cleaned = cleaned.replace(/(?<!_)_(?!_)([^_]+)(?<!_)_(?!_)/g, '$1');

  // Remove blockquotes (> )
  cleaned = cleaned.replace(/^>\s*/gm, '');

  // Remove horizontal rules (---, ***, ___)
  cleaned = cleaned.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove markdown links but keep text: [text](url) -> text
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Remove common LLM prefixes/meta-commentary
  const prefixPatterns = [
    /^(?:Here(?:'s| is) (?:a |the |your )?(?:caption|post|content)[:\s]*)/im,
    /^(?:Caption[:\s]*)/im,
    /^(?:Post[:\s]*)/im,
    /^(?:Social media (?:post|caption)[:\s]*)/im,
    /^(?:Output[:\s]*)/im,
  ];

  for (const pattern of prefixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove trailing notes/explanations (common patterns)
  const suffixPatterns = [
    /\n+(?:---|\*\*\*)\n+[\s\S]*$/,
    /\n+(?:Note|Notes|Explanation|Tips?)[:\s][\s\S]*$/i,
    /\n+(?:Let me know|Hope this helps|Feel free)[\s\S]*$/i,
  ];

  for (const pattern of suffixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Clean up excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  // Fix AI typography issues
  cleaned = fixAITypography(cleaned);

  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * A preset look (quote card, editorial photo...) for prompts no writer sees:
 * image_only prompts and blueprint image-prompt templates. Skipped when the
 * prompt already has it (image blueprints compiled before looks existed).
 */
function withPresetLook(prompt: string, output: any): string {
  if (output?.generation_params?.look?.kind !== 'preset') return prompt;
  const direction = String(output.generation_params?.model_config?.image_style_direction || '').trim();
  if (!direction || prompt.includes(direction)) return prompt;
  return `${prompt}\n\nStyle: ${direction}`;
}

/**
 * A blueprint's own image_prompt goes to the image model verbatim, and a
 * template that says "include the full text, don't fix the item count" makes a
 * 5-point list run off the bottom of a landscape frame. Tell the model the
 * canvas is fixed and that fitting beats completeness. Skipped when the
 * template already speaks about the frame.
 */
function withCanvasFit(prompt: string, configuration: any, output: any): string {
  if (/safe margin|inside the frame|within the frame/i.test(prompt)) return prompt;
  const aspect = String(
    output?.generation_params?.model_config?.image_generator?.parameters?.aspect_ratio
      || configuration?.model_config?.image_generator?.parameters?.aspect_ratio
      || '',
  ).trim();
  const [w, h] = aspect.split(':').map(Number);
  const shape = w > 0 && h > 0 ? (w > h ? 'landscape' : w < h ? 'portrait' : 'square') : '';
  const canvas = shape ? `a single fixed ${shape} ${aspect} canvas` : 'a single fixed canvas';
  return `${prompt}\n\nCANVAS AND FIT (overrides any instruction above to include every point in full): the image is ${canvas}. Keep every headline, number and line of text completely inside the frame with a safe margin of about 6% on all four sides; nothing may touch, bleed past or be cut off by any edge, especially the bottom. Decide the layout for the space available: a headline plus at most 4 items, each condensed to a short label of 6 words or fewer. If the source has more points, keep the strongest and drop the rest rather than shrinking text or running past the frame.`;
}

/**
 * Extract text content from stage payloads with compatibility for both keys.
 * Some stages persist generated text in `content`, others in `text`.
 */
function getStageText(stageData: any): string {
  if (!stageData) return '';

  if (typeof stageData.content === 'string' && stageData.content.trim()) {
    return stageData.content;
  }

  if (typeof stageData.text === 'string' && stageData.text.trim()) {
    return stageData.text;
  }

  return '';
}

async function ensureModelSchema(
  supabase: any,
  provider: string,
  modelId: string,
  stageType: 'text_llm' | 'image_generator' | 'image_to_video' | 'world_simulator' | 'tts'
): Promise<NormalizedCapabilities | null> {
  console.log(`🔍 Checking for ${provider}/${modelId} schema in database...`);

  // Query the database for curated model schema
  const { data: model, error } = await supabase
    .from('ai_models')
    .select('display_name, normalized_capabilities, is_curated')
    .eq('provider', provider)
    .eq('model_id', modelId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error(`Database error looking up model: ${error.message}`);
  }

  // If found and has normalized capabilities, use it
  if (model?.normalized_capabilities) {
    const curatedLabel = model.is_curated ? '(curated)' : '';
    console.log(`✅ Using database schema for ${model.display_name || modelId} ${curatedLabel}`);
    return model.normalized_capabilities as NormalizedCapabilities;
  }

  // For media generation stages - REQUIRE curated schema
  const mediaStages = ['image_generator', 'image_to_video', 'world_simulator'];
  if (mediaStages.includes(stageType)) {
    console.error(`❌ Model ${provider}/${modelId} not found in curated models!`);
    console.error(`📋 Please add this model to the ai_models table with normalized_capabilities`);
    throw new Error(`Model ${provider}/${modelId} is not supported. Only curated models with schemas are allowed for ${stageType} generation.`);
  }

  // For text_llm and tts - allow working with defaults (simpler parameter needs)
  console.warn(`⚠️ No schema found for ${provider}/${modelId}, using defaults`);
  return null;
}

// ============= END PAYLOAD BUILDER INFRASTRUCTURE =============

// ============= ASYNC MEDIA GENERATION HELPER =============

/**
 * Start a Replicate prediction with webhook for async completion
 * Stores prediction_id in generation_params.pending_predictions for webhook lookup
 */
async function startReplicatePrediction(
  supabase: any,
  outputId: string,
  decryptedKey: string,
  modelId: string,
  payload: Record<string, any>,
  trackingInfo: {
    stage_id: string;
    item_type: 'image' | 'clip' | 'video' | 'assembly' | 'carousel_slide';
    scene_number?: number;
    item_index?: number;
    extra_data?: Record<string, any>;
  }
): Promise<{ prediction_id: string }> {
  // Hard guard: never bill Replicate when the blueprint picked another provider.
  // Refunds + customer trust cost more than the extra round-trip here.
  const { data: outputForGuard } = await supabase
    .from('content_outputs')
    .select('generation_params')
    .eq('id', outputId)
    .single();

  const gp = outputForGuard?.generation_params || {};
  const modelConfig = gp.configuration?.model_config || gp.model_config || {};

  const providerConfigKey =
    trackingInfo.item_type === 'image' || trackingInfo.item_type === 'carousel_slide'
      ? 'image_generator'
      : trackingInfo.item_type === 'clip' || trackingInfo.item_type === 'video'
      ? 'video_generator'
      : null;

  if (providerConfigKey) {
    const requestedProvider = modelConfig[providerConfigKey]?.provider;
    if (requestedProvider && requestedProvider !== 'replicate') {
      const msg = `Refusing to call Replicate: blueprint requests ${providerConfigKey}.provider="${requestedProvider}" (output ${outputId}, stage ${trackingInfo.stage_id}, item ${trackingInfo.item_type}).`;
      console.error(`🛑 [provider-guard] ${msg}`);
      throw new Error(msg);
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;

  console.log(`🚀 Starting async prediction for ${trackingInfo.item_type} with webhook`);

  // Determine API endpoint based on model identifier format
  // Model identifiers (owner/name) use /models/{owner}/{name}/predictions
  // SHA256 version hashes use /predictions with version field
  const isModelIdentifier = modelId.includes('/') && !modelId.match(/^[a-f0-9]{64}$/);
  const apiEndpoint = isModelIdentifier
    ? `https://api.replicate.com/v1/models/${modelId}/predictions`
    : 'https://api.replicate.com/v1/predictions';

  console.log(`📡 Using endpoint: ${apiEndpoint} (isModelIdentifier: ${isModelIdentifier})`);

  // Build request body - only include version for SHA256 hashes
  const requestBody: Record<string, any> = {
    input: payload,
    webhook: webhookUrl,
    webhook_events_filter: ["completed"]
  };

  if (!isModelIdentifier) {
    requestBody.version = modelId;
  }

  // Start prediction WITH webhook
  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${decryptedKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Replicate API error ${response.status}: ${errorBody}`);
  }
  
  const prediction = await response.json();
  console.log(`✓ Prediction started: ${prediction.id}`);
  
  // Store prediction for webhook lookup
  const { data: output } = await supabase
    .from('content_outputs')
    .select('generation_params')
    .eq('id', outputId)
    .single();
  
  // Drop any stale entries for the same (stage_id, scene_number) before appending.
  // Without this, retries from reset-stuck-outputs append a new prediction_id each
  // run while leaving the old ones in place, so polling iterates dead IDs forever.
  // Storyboard scenes legitimately have one entry per scene_number, so we key on
  // both fields rather than stage_id alone.
  const pendingPredictions = (output?.generation_params?.pending_predictions || [])
    .filter((p: any) =>
      p.stage_id !== trackingInfo.stage_id ||
      (p.scene_number ?? null) !== (trackingInfo.scene_number ?? null)
    );
  pendingPredictions.push({
    prediction_id: prediction.id,
    ...trackingInfo,
    started_at: new Date().toISOString()
  });
  
  await supabase.from('content_outputs').update({
    generation_params: {
      ...output?.generation_params,
      pending_predictions: pendingPredictions
    }
  }).eq('id', outputId);
  
  console.log(`✓ Tracking stored for prediction ${prediction.id}`);
  
  return { prediction_id: prediction.id };
}

// ============= END ASYNC HELPER =============

// ============= OPENROUTER IMAGE GENERATION HELPER =============

/**
 * Generate an image via OpenRouter's image modality and upload to Supabase Storage.
 * Returns the public URL of the uploaded image and cost estimate.
 * This is a synchronous operation — no webhooks needed.
 */
async function generateImageViaOpenRouter(
  supabase: any,
  outputId: string,
  openrouterApiKey: string,
  modelId: string,
  prompt: string,
  options: {
    aspectRatio?: string;
    supabaseUrl: string;
    sceneName?: string;
    referenceImages?: string[];
    /** Role-labelled references (blueprint image_references). Takes precedence over referenceImages. */
    labeledReferences?: ResolvedReference[];
    /** The style reference in words (describeStyleReference), repeated after the prompt. */
    styleReference?: string;
    /** Image API only: the blueprint's image_generator.parameters.background. */
    background?: string;
  }
): Promise<{ url: string; model: string; cost: number }> {
  const rawReferenceImages = options.labeledReferences?.length ? [] : (options.referenceImages || []).slice(0, 4);

  // Inline reference images as base64 data URLs so the provider never fetches
  // flaky third-party hosts server-side (a 502 there would 400 the whole
  // generation). References we can't fetch are skipped rather than fatal.
  const referenceImages = rawReferenceImages.length > 0
    ? await resolveReferenceImagesToDataUrls(rawReferenceImages)
    : [];

  // OpenAI image models ignore image_config.aspect_ratio on chat/completions and
  // always return 1024x1024, so they go through the Image API, which honours it.
  const imagesApi = usesOpenRouterImagesApi(modelId);
  let requestUrl = 'https://openrouter.ai/api/v1/chat/completions';
  let requestBody: Record<string, unknown>;

  if (imagesApi) {
    // The Image API takes images and prompt separately, so role-labelled
    // references go in as numbered text (groups that can't be fetched dropped,
    // so the numbering matches the images actually sent).
    let inputReferences = referenceImages;
    let imagePrompt = referenceImages.length > 0
      ? `Use the provided reference image(s) as visual guidance for style, subject, and composition. ${prompt}`
      : prompt;
    if (options.labeledReferences?.length) {
      const resolved = await resolveRequiredReferenceImages(options.labeledReferences);
      inputReferences = resolved.flatMap((r) => r.urls);
      imagePrompt = withReferenceRequirements(`${referencesAsText(resolved, options.styleReference)}\n\n${prompt}`, resolved, options.styleReference);
      console.log(`[generateImageViaOpenRouter] Including ${inputReferences.length} role-labelled reference image(s): ${resolved.map((r) => `${r.role}:${r.label}`).join(', ')}`);
    }
    const aspectRatio = options.aspectRatio
      ? snapAspectRatio(options.aspectRatio, await supportedAspectRatios(modelId))
      : undefined;
    console.log(`[generateImageViaOpenRouter] Image API for ${modelId}, aspect ratio ${options.aspectRatio ?? 'unset'} -> ${aspectRatio ?? 'unset'}`);
    requestUrl = OPENROUTER_IMAGES_URL;
    requestBody = {
      model: modelId,
      prompt: imagePrompt,
      ...(aspectRatio && { aspect_ratio: aspectRatio }),
      // Left on auto, the model cuts "paper" styles out onto transparency,
      // which shows as black or white gaps once posted.
      background: options.background || 'opaque',
      ...(inputReferences.length > 0 && {
        input_references: inputReferences.map((url) => ({ type: 'image_url', image_url: { url } })),
      }),
    };
  } else {
    // Build multimodal content when reference images are provided
    type ContentPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };
    let messageContent: string | ContentPart[] = referenceImages.length > 0
      ? [
          ...referenceImages.map(url => ({ type: 'image_url' as const, image_url: { url } })),
          { type: 'text' as const, text: `Use the provided reference image(s) as visual guidance for style, subject, and composition. ${prompt}` },
        ]
      : prompt;
    // Role-labelled references: each group is introduced by what it's for
    // (exact product / keep this face / match this look) before its images.
    if (options.labeledReferences?.length) {
      const labeled = await buildLabeledReferenceContent(options.labeledReferences, prompt, options.styleReference);
      messageContent = labeled.content;
      console.log(`[generateImageViaOpenRouter] Including ${labeled.imageCount} role-labelled reference image(s): ${options.labeledReferences.map((r) => `${r.role}:${r.label}`).join(', ')}`);
    }
    requestBody = {
      model: modelId,
      messages: [{ role: 'user', content: messageContent }],
      // Gemini models output both text+image; dedicated image models (Flux, etc.) output image only
      modalities: modelId.startsWith('google/') ? ['image', 'text'] : ['image'],
      ...(options.aspectRatio && {
        image_config: { aspect_ratio: options.aspectRatio },
      }),
    };
  }

  if (rawReferenceImages.length > 0) {
    const skipped = rawReferenceImages.length - referenceImages.length;
    console.log(`[generateImageViaOpenRouter] Including ${referenceImages.length} reference image(s) in request${skipped > 0 ? ` (${skipped} skipped — could not fetch)` : ''}`);
  }

  // Use fetchWithTimeout to prevent hanging when OpenRouter is slow/unresponsive.
  // Without this, the Edge Function hits Supabase's hard timeout and outputs stay stuck in 'generating' forever.
  // OpenAI models take a median ~80s at 1024x1024 and longer for landscape/portrait,
  // so 90s cut them off and retried (paying twice); they get 150s.
  const IMAGE_TIMEOUT_MS = imagesApi ? 150000 : 90000;
  const response = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': options.supabaseUrl,
      'X-Title': 'ContentAI Studio',
    },
    body: JSON.stringify(requestBody),
  }, IMAGE_TIMEOUT_MS);

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 402) {
      // Look up the output's org so we can flag the OpenRouter api_keys row as invalid
      const { data: outputRow } = await supabase
        .from('content_outputs')
        .select('organization_id')
        .eq('id', outputId)
        .maybeSingle();
      const creditMessage = await handleOpenRouterCreditsError(supabase, outputRow?.organization_id, 402, errorText);
      throw new Error(`OpenRouter: ${creditMessage || 'insufficient credits'}`);
    }
    throw new Error(`OpenRouter image generation error ${response.status}: ${errorText}`);
  }

  const result = await response.json();

  // Extract base64 image from response
  const msg = result.choices?.[0]?.message;
  const responseContent = msg?.content;
  let base64Data: string | undefined;
  let mimeType = 'image/png';

  // Helper: parse a data URL into base64 + mime
  const parseDataUrl = (dataUrl: string): { base64: string; mime: string } | null => {
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    return match ? { base64: match[2], mime: match[1] } : null;
  };

  // Helper: extract image data from an image object ({ type: 'image_url', image_url: { url: 'data:...' } })
  const extractFromImageObj = (obj: any): boolean => {
    const dataUrl = obj?.image_url?.url || '';
    const parsed = parseDataUrl(dataUrl);
    if (parsed) { base64Data = parsed.base64; mimeType = parsed.mime; return true; }
    return false;
  };

  // Image API: data[].b64_json
  if (imagesApi) {
    const first = result.data?.[0];
    if (typeof first?.b64_json === 'string') {
      const parsed = parseDataUrl(first.b64_json);
      base64Data = parsed ? parsed.base64 : first.b64_json;
      mimeType = parsed?.mime || first.media_type || 'image/png';
    }
    if (!base64Data) {
      throw new Error(`No image data in OpenRouter Image API response: ${JSON.stringify(result).substring(0, 300)}`);
    }
  }

  // Path 1: message.images[] (OpenRouter documented format for image-only models like Flux)
  if (msg?.images && Array.isArray(msg.images) && msg.images.length > 0) {
    const first = msg.images[0];
    if (typeof first === 'string') {
      const parsed = parseDataUrl(first);
      if (parsed) { base64Data = parsed.base64; mimeType = parsed.mime; }
      else { base64Data = first; } // raw base64 without data URL prefix
    } else if (typeof first === 'object') {
      extractFromImageObj(first);
    }
  }

  // Path 2: message.content as array of image objects (some models)
  if (!base64Data && Array.isArray(responseContent)) {
    const imageItem = responseContent.find((c: any) => c.type === 'image_url' || c.image_url);
    if (imageItem) { extractFromImageObj(imageItem); }
  }

  // Path 3: message.content as data URL string
  if (!base64Data && typeof responseContent === 'string' && responseContent.startsWith('data:')) {
    const parsed = parseDataUrl(responseContent);
    if (parsed) { base64Data = parsed.base64; mimeType = parsed.mime; }
  }

  if (!base64Data) {
    throw new Error(`No image data in OpenRouter response. Content type: ${typeof responseContent}, images: ${JSON.stringify(msg?.images)?.substring(0, 200)}, choices: ${JSON.stringify(result.choices).substring(0, 300)}`);
  }

  // Upload to Supabase Storage
  const ext = mimeType.split('/')[1] || 'png';
  const sceneName = options.sceneName || 'image';
  const fileName = `${outputId}/${sceneName}_${Date.now()}.${ext}`;
  const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

  const { error: uploadError } = await supabase.storage
    .from('content-media')
    .upload(fileName, imageBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload image to storage: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('content-media')
    .getPublicUrl(fileName);

  // The Image API reports the real cost; chat gets a rough estimate from image tokens.
  const cost = typeof result.usage?.cost === 'number' && imagesApi
    ? result.usage.cost
    : result.usage?.total_tokens
      ? (result.usage.total_tokens / 1000) * 0.01
      : 0;

  return {
    url: publicUrl,
    model: modelId,
    cost,
  };
}

// ============= END OPENROUTER IMAGE GENERATION HELPER =============

// ============= VISUAL CONTEXT BUILDER =============

/**
 * Build visual context description from library elements
 * Converts library elements into AI-readable character/visual descriptions
 */
function buildVisualContext(libraryElements: Record<string, any>, imageInputs?: Record<string, string[]>): string {
  let context = '';
  
  if (libraryElements.character) {
    // Handle both array and object formats
    const char = Array.isArray(libraryElements.character) 
      ? libraryElements.character[0] 
      : libraryElements.character;
    
    if (char) {
      context += `\n=== CHARACTER (must appear in every scene) ===\n`;
      context += `Name: ${char.name}\n`;
      if (char.description) {
        context += `Description: ${char.description}\n`;
      }
      if (char.visual_style) {
        context += `Visual Style: ${char.visual_style}\n`;
      }
      if (char.physical_traits) {
        context += `Physical Traits: ${char.physical_traits}\n`;
      }
      
      // Check reference_images from character data OR imageInputs
      const refImages = char.reference_images || imageInputs?.character || [];
      if (refImages.length > 0) {
        context += `Reference Images: ${refImages.length} provided - character should match reference image exactly\n`;
        context += `Reference Image URL: ${refImages[0]}\n`;
      }
    }
  }
  
  const bvVisual = getBrandVoice(libraryElements);
  if (bvVisual) {
    context += `\n=== BRAND VISUAL STYLE ===\n`;
    context += `Brand: ${bvVisual.name}\n`;
    if (bvVisual.visual_style) {
      context += `Visual Style: ${bvVisual.visual_style}\n`;
    }
    if (bvVisual.description) {
      context += `Brand Character: ${bvVisual.description}\n`;
    }
  }
  
  if (libraryElements.product) {
    const prod = Array.isArray(libraryElements.product) 
      ? libraryElements.product[0] 
      : libraryElements.product;
    
    if (prod) {
      context += `\n=== PRODUCT CONTEXT ===\n`;
      context += `Product: ${prod.name}\n`;
      if (prod.description) {
        const shortDesc = prod.description.length > 200 ? prod.description.substring(0, 200) + '...' : prod.description;
        context += `Description: ${shortDesc}\n`;
      }
    }
  }
  
  return context;
}

// ============= END VISUAL CONTEXT BUILDER =============

// ============= STORY CONTEXT BUILDER =============

/**
 * Build story context from library elements
 * Extracts talking points, tone, and audience resonance for dialogue
 */
function buildStoryContext(libraryElements: Record<string, any>, ideaContext?: string): string {
  let context = '';
  
  // === PRIMARY: Idea/Topic is the CORE story ===
  if (ideaContext) {
    context += `\n=== MAIN TOPIC (CHARACTER MUST DISCUSS THIS) ===\n`;
    context += `${ideaContext}\n`;
    context += `⚠️ This is the PRIMARY subject matter. Every scene's dialogue must relate to this topic.\n`;
  }
  
  // Product talking points
  if (libraryElements.product) {
    const prod = Array.isArray(libraryElements.product) 
      ? libraryElements.product[0] : libraryElements.product;
    if (prod) {
      context += `\n=== PRODUCT TO DISCUSS ===\n`;
      context += `Product: ${prod.name}\n`;
      if (prod.key_benefits?.length) {
        context += `Key Benefits to Highlight: ${prod.key_benefits.join(', ')}\n`;
      }
      if (prod.features?.length) {
        context += `Features to Explain: ${prod.features.slice(0, 5).join(', ')}\n`;
      }
    }
  }
  
  // Brand voice/tone
  const bvTone = getBrandVoice(libraryElements);
  if (bvTone) {
    context += `\n=== SPEAKING STYLE ===\n`;
    if (bvTone.tone) context += `Tone: ${bvTone.tone}\n`;
    if (bvTone.style_guidelines) context += `Style: ${bvTone.style_guidelines}\n`;
  }
  
  // ICP pain points and desires
  if (libraryElements.icp) {
    const icp = Array.isArray(libraryElements.icp) 
      ? libraryElements.icp[0] : libraryElements.icp;
    if (icp) {
      context += `\n=== AUDIENCE RESONANCE ===\n`;
      if (icp.pain_points?.length) {
        context += `Pain Points to Address: ${icp.pain_points.slice(0, 3).join(', ')}\n`;
      }
      if (icp.desires?.length) {
        context += `Desires to Fulfill: ${icp.desires.slice(0, 3).join(', ')}\n`;
      }
      if (icp.language_style) {
        context += `Speak in: ${icp.language_style}\n`;
      }
    }
  }
  
  return context;
}

// ============= END STORY CONTEXT BUILDER =============

// ============= TALKING POINTS EXTRACTOR =============
/**
 * Extracts talking points from generation params.
 * This is used across all pipelines to inject key talking points into prompts.
 * Priority order:
 * 1. selected_ai_insights.talking_points (user-selected combined points)
 * 2. selected_ai_insights.talking_point.text (single point for variations)
 * 3. key_talking_points (direct array from generation params)
 * 4. idea_ai_analysis.key_talking_points or talking_points (fallback to AI analysis)
 */
function extractTalkingPoints(generationParams: any): string[] {
  if (!generationParams) return [];

  const selectedAiInsights = generationParams.selected_ai_insights || {};
  const ideaAiAnalysis = generationParams.idea_ai_analysis;
  const directKeyTalkingPoints = generationParams.key_talking_points;

  // Parse AI analysis if string
  let parsedAiAnalysis: any = null;
  if (ideaAiAnalysis) {
    try {
      parsedAiAnalysis = typeof ideaAiAnalysis === 'string' ? JSON.parse(ideaAiAnalysis) : ideaAiAnalysis;
    } catch (e) {
      console.log('[extractTalkingPoints] Failed to parse AI analysis');
    }
  }

  // Priority order for talking points sources
  if (selectedAiInsights.talking_points && Array.isArray(selectedAiInsights.talking_points) && selectedAiInsights.talking_points.length > 0) {
    return selectedAiInsights.talking_points;
  }
  if (selectedAiInsights.talking_point && selectedAiInsights.talking_point.text) {
    return [selectedAiInsights.talking_point.text];
  }
  if (directKeyTalkingPoints && Array.isArray(directKeyTalkingPoints) && directKeyTalkingPoints.length > 0) {
    return directKeyTalkingPoints;
  }
  if (parsedAiAnalysis?.key_talking_points && Array.isArray(parsedAiAnalysis.key_talking_points) && parsedAiAnalysis.key_talking_points.length > 0) {
    return parsedAiAnalysis.key_talking_points;
  }
  if (parsedAiAnalysis?.talking_points && Array.isArray(parsedAiAnalysis.talking_points) && parsedAiAnalysis.talking_points.length > 0) {
    return parsedAiAnalysis.talking_points;
  }

  return [];
}

/** The prompt already contains the talking points (any of them, word for word). */
function promptCarriesTalkingPoints(prompt: string, talkingPoints: string[]): boolean {
  const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  const p = norm(prompt);
  return talkingPoints.some((tp) => typeof tp === 'string' && norm(tp).length >= 12 && p.includes(norm(tp)));
}

/**
 * Builds a prompt section for talking points
 */
function buildTalkingPointsSection(talkingPoints: string[], format: 'brief' | 'detailed' = 'brief'): string {
  if (talkingPoints.length === 0) return '';

  if (format === 'detailed') {
    return `\n## KEY TALKING POINTS TO INCORPORATE
Your content MUST address these key points:
${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Make sure each point is naturally woven into the content.\n`;
  }

  return `\n## KEY TALKING POINTS
Include these points in your content:
${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`;
}
// ============= END TALKING POINTS EXTRACTOR =============

// ============= CTA CONTEXT EXTRACTOR =============
/**
 * Extracts CTA context from generation params for carousel content generation.
 * Sources (priority order):
 * 1. selected_ai_insights.ctas (multiple, combine mode)
 * 2. selected_ai_insights.cta (single CTA)
 * 3. idea_ai_analysis.ctas (fallback to full AI analysis)
 * 4. library_elements.block (library CTA block — additional source)
 */
function extractCtaContext(generationParams: any): {
  aiCtas: string[];
  aiCtaPlacement: string;
  blockCta: string;
  blockCtaName: string;
} {
  const result = {
    aiCtas: [] as string[],
    aiCtaPlacement: '',
    blockCta: '',
    blockCtaName: '',
  };

  if (!generationParams) return result;

  const selectedAiInsights = generationParams.selected_ai_insights || {};
  const ideaAiAnalysis = generationParams.idea_ai_analysis;
  const libraryElements = generationParams.library_elements || {};

  // Parse AI analysis if string
  let parsedAiAnalysis: any = null;
  if (ideaAiAnalysis) {
    try {
      parsedAiAnalysis = typeof ideaAiAnalysis === 'string' ? JSON.parse(ideaAiAnalysis) : ideaAiAnalysis;
    } catch {
      // ignore parse errors
    }
  }

  // AI CTAs — priority: selected insights > full analysis
  if (selectedAiInsights.ctas?.length) {
    result.aiCtas = selectedAiInsights.ctas.map((c: any) => c.text).filter(Boolean);
    result.aiCtaPlacement = selectedAiInsights.ctas[0]?.placement || '';
  } else if (selectedAiInsights.cta?.text) {
    result.aiCtas = [selectedAiInsights.cta.text];
    result.aiCtaPlacement = selectedAiInsights.cta.placement || '';
  } else if (parsedAiAnalysis?.ctas?.length) {
    result.aiCtas = parsedAiAnalysis.ctas.map((c: any) => c.text).filter(Boolean);
    result.aiCtaPlacement = parsedAiAnalysis.ctas[0]?.placement || '';
  }

  // Library block CTA
  const block = libraryElements.block;
  if (block?.content && (block.block_type === 'cta' || !block.block_type)) {
    result.blockCta = block.content;
    result.blockCtaName = block.name || '';
  }

  return result;
}
// ============= END CTA CONTEXT EXTRACTOR =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Hoisted so the outer catch block can see them. Previously `const`-scoped
  // inside the try, which meant the catch's DB error-write silently no-op'd
  // (ReferenceError caught + ignored by the inner try at "typeof output_id").
  // Result: any thrown stage error left the row stuck in 'generating' until
  // the 10-min watchdog wrote a generic "auto-reset" message, masking real
  // errors like OpenRouter 401s.
  let output_id: string | undefined;
  let stage_id: string | undefined;
  try {
    const parsed = await req.json();
    output_id = parsed.output_id;
    stage_id = parsed.stage_id;
    const { regenerate_clip, regenerate_scene, custom_prompt, instructions } = parsed;

    if (!output_id || !stage_id) {
      throw new Error('output_id and stage_id are required');
    }

    if (regenerate_clip !== undefined) {
      console.log(`🔄 Regenerating single clip: ${regenerate_clip}`);
    }
    if (regenerate_scene !== undefined) {
      console.log(`🔄 Regenerating single scene: ${regenerate_scene}`);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Executing stage ${stage_id} for output ${output_id}`);

    // Fetch the output with job, blueprint, and idea (for AI analysis)
    const { data: output, error: outputError } = await supabase
      .from('content_outputs')
      .select('*, content_generation_jobs!inner(*, blueprints(*)), content_ideas(ai_analysis)')
      .eq('id', output_id)
      .single();

    if (outputError || !output) {
      throw new Error(`Output not found: ${outputError?.message}`);
    }

    // verify_jwt=false: without this anyone with an output id could run LLM/image/video
    // stages on the org's API keys.
    try {
      await assertOrgAccess(req, supabase, output.content_generation_jobs?.organization_id);
    } catch (authErr) {
      output_id = undefined; // don't let the outer catch write an error onto someone else's output
      return unauthorized(authErr, corsHeaders);
    }

    const job = output.content_generation_jobs;
    const blueprint = job.blueprints;
    const pipeline = output.pipeline;
    const configuration = job.configuration;

    // ============= SAVED LIBRARY SKIP =============
    // If this stage was pre-populated with saved content, skip execution and auto-advance
    const existingStageData = output.stage_data?.[stage_id];
    if (existingStageData?.source === 'saved_library') {
      console.log(`📎 [Saved Content] Stage ${stage_id} pre-populated with saved content — skipping execution`);

      // Auto-approve and advance to next stage (same logic as autopilot auto-approve),
      // in the background so this response doesn't wait for the rest of the pipeline.
      const advance = (async () => {
        try {
          const { error: approveError } = await supabase.functions.invoke('approve-stage', {
            body: {
              output_id: output_id,
              stage_id: stage_id,
              action: 'approve',
              is_automated: true,
              autopilot_id: output.autopilot_id ?? null,
            }
          });

          if (approveError) {
            console.error(`[Saved Content] Auto-approve failed for ${stage_id}:`, approveError);
          } else {
            console.log(`📎 [Saved Content] Auto-approved stage ${stage_id}, advancing pipeline`);
          }
        } catch (err) {
          console.error(`[Saved Content] Error auto-approving stage ${stage_id}:`, err);
        }
      })();
      const savedEdgeRuntime = (globalThis as any).EdgeRuntime;
      if (savedEdgeRuntime?.waitUntil) {
        savedEdgeRuntime.waitUntil(advance);
      } else {
        await advance;
      }

      return new Response(
        JSON.stringify({
          success: true,
          skipped: true,
          message: `Stage ${stage_id} skipped — using saved content from library`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get organization's API keys
    const { data: apiKeys, error: apiKeysError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('organization_id', job.organization_id);

    if (apiKeysError || !apiKeys || apiKeys.length === 0) {
      throw new Error('No API keys configured for organization');
    }

    // Determine stage config from pipeline
    const stageConfig = getStageConfig(pipeline, stage_id);
    if (!stageConfig) {
      throw new Error(`Stage ${stage_id} not found in pipeline ${pipeline}`);
    }

    console.log(`Stage config:`, stageConfig);

    // ============= WORKER DELEGATION FOR LONG-RUNNING STAGES =============
    // For stages with multi-step loops (batched scenes, per-slide prompts, etc.),
    // delegate to the Fly.io content-pipeline worker which drives the continuation
    // loop automatically. The worker calls execute-stage back with an Authorization
    // header (service_role key) — we detect this to avoid infinite delegation.
    const contentPipelineWorkerUrl = Deno.env.get('CONTENT_PIPELINE_WORKER_URL');
    const isCalledByWorker = req.headers.get('x-content-worker') === 'true' && isServiceRoleRequest(req);
    const isSingleRegeneration = regenerate_scene !== undefined || regenerate_clip !== undefined;

    const isLongRunningStage = !isSingleRegeneration && (
      // Enhanced scenes — batched LLM for 15+ scenes (has partial resumption)
      stageConfig.outputFormat === 'scene_array'
      // Video pipeline composition — calls editor-chat for Remotion code gen (needs >2min)
      || (pipeline === 'video' && stage_id === 'composition')
    );

    if (isLongRunningStage && !isCalledByWorker && contentPipelineWorkerUrl) {
      console.log(`[WORKER DELEGATION] Delegating long-running stage ${stage_id} to content-pipeline worker`);

      // Update status so UI shows progress immediately
      await supabase
        .from('content_outputs')
        .update({ current_stage: stage_id, status: 'generating' })
        .eq('id', output_id);

      // Fire-and-forget: kick off worker, don't wait for completion
      try {
        const controller = new AbortController();
        const delegationTimeout = setTimeout(() => controller.abort(), 10_000);

        fetch(`${contentPipelineWorkerUrl}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ output_id, stage_id, regenerate_clip, regenerate_scene, custom_prompt, instructions }),
          signal: controller.signal,
        }).then(async (workerRes) => {
          clearTimeout(delegationTimeout);
          if (!workerRes.ok) {
            console.error(`[WORKER DELEGATION] Worker returned ${workerRes.status}`);
          }
        }).catch((err) => {
          clearTimeout(delegationTimeout);
          // AbortError is fine — worker is processing in the background
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            console.error('[WORKER DELEGATION] Worker request failed:', err.message);
          }
        });

        console.log(`[WORKER DELEGATION] Worker notified, returning immediately`);
        return new Response(
          JSON.stringify({ success: true, delegated: true, message: `Stage ${stage_id} delegated to content-pipeline worker` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (delegationError) {
        console.warn('[WORKER DELEGATION] Failed to reach worker, executing locally:', delegationError);
        // Fall through to execute locally
      }
    }

    // Update output status to processing this stage
    await supabase
      .from('content_outputs')
      .update({
        current_stage: stage_id,
        status: 'generating'
      })
      .eq('id', output_id);

    // Execute stage based on model type
    let stageResult: any;

    console.log(`About to execute stage with modelType: ${stageConfig.modelType}, outputFormat: ${stageConfig.outputFormat}`);

    // ============= NEW ENGINE ADAPTER (Phase 4) =============
    // Check if the new execution engine should handle this stage
    // For the unified 'video' pipeline, always use the new engine (all stages are registered there)
    const registryHasStage = StageRegistry.has(pipeline, stage_id);
    // carousel_content has no legacy copy any more: it always runs on the engine.
    const engineOnly = pipeline === 'video' || stage_id === 'carousel_content';
    const useNewEngine = (engineOnly || USE_NEW_ENGINE) && registryHasStage;

    console.log(`[ENGINE CHECK] pipeline=${pipeline} stage=${stage_id} USE_NEW_ENGINE=${USE_NEW_ENGINE} registryHas=${registryHasStage} -> useNewEngine=${useNewEngine}`);

    if (useNewEngine) {
      console.log(`[NEW ENGINE] Using unified execution engine for ${pipeline}:${stage_id}`);

      try {
        const engine = createExecutionEngine(supabase, supabaseUrl);
        const result = await engine.executeStage(output, stage_id, configuration, apiKeys, {
          regenerateScene: regenerate_scene,
          customPrompt: custom_prompt,
          instructions: instructions,
        });

        // Convert to legacy format for compatibility
        // For stages with object content (e.g. carousel_content with slides array),
        // flatten the content into the root so downstream consumers find data at expected paths
        // (e.g. stage_data.carousel_content.slides instead of stage_data.carousel_content.content.slides)
        const contentIsObject = result.content && typeof result.content === 'object' && !Array.isArray(result.content);
        stageResult = {
          ...(contentIsObject ? result.content : { content: result.content }),
          text: result.text,
          model: result.model,
          usage: result.usage,
          cost: result.cost,
          prediction_id: result.predictionId,
        };

        console.log(`[NEW ENGINE] Stage ${stage_id} completed successfully`);
      } catch (engineError) {
        console.error(`[NEW ENGINE] Error for ${pipeline}:${stage_id}:`, engineError);
        // Engine-only stages (the unified video pipeline, carousel slide copy) have no
        // legacy handler to fall through to.
        if (engineOnly) {
          throw engineError;
        }
        // For other pipelines, fall through to legacy switch statement
      }
    }

    // Legacy execution path (or fallback if new engine fails)
    if (!stageResult) {
    switch (stageConfig.modelType) {
      case 'text_llm':
        if (stage_id === 'scene_prompts' || stageConfig.outputFormat === 'text_array') {
          // Video scene prompts stage
          console.log('Detected scene_prompts/text_array stage, calling executeScenePromptsStage...');
          stageResult = await executeScenePromptsStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, supabaseUrl, regenerate_scene, custom_prompt);
          console.log('executeScenePromptsStage completed, result:', stageResult);
        } else if (stageConfig.outputFormat === 'scene_array') {
          // Enhanced slideshow video scenes stage - generates structured scenes with narration, image_prompt, i2v settings
          console.log('Detected scene_array stage, calling executeEnhancedScenesStage...');
          stageResult = await executeEnhancedScenesStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, supabaseUrl, regenerate_scene, custom_prompt);
          console.log('executeEnhancedScenesStage completed, result:', stageResult);
        } else if (stage_id === 'image_prompt') {
          console.log('Detected image_prompt stage, calling executeImagePromptStage...');
          stageResult = await executeImagePromptStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, supabaseUrl);
        } else if (stageConfig.outputFormat === 'thread_array') {
          // X thread: write it like any text stage, then split into posts in the
          // JSON shape approve-stage and process-publish-queue read.
          const written = await executeTextStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, supabaseUrl, custom_prompt, instructions);
          const tweets = splitThreadTweets(String(written?.content ?? ''));
          if (tweets.length === 0) throw new Error('Thread: the model returned no posts.');
          stageResult = { ...written, content: threadContent(String(written.content)), tweet_count: tweets.length };
          console.log(`[thread] Split into ${tweets.length} posts`);
        } else {
          // Includes the carousel caption: the blueprint prompt, sent exactly as for a social post.
          console.log('Regular text stage, calling executeTextStage...');
          stageResult = await executeTextStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, supabaseUrl, custom_prompt, instructions);
        }
        break;
      case 'tts':
        // Check which TTS stage type this is
        if (stage_id === 'full_voiceover') {
          // Single TTS for entire script (storyboard_video_longform)
          console.log('Detected full_voiceover stage, calling executeFullVoiceoverStage...');
          stageResult = await executeFullVoiceoverStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        } else if (stage_id === 'voice_segments') {
          // Legacy: Per-scene TTS segments
          console.log('Detected voice_segments stage, calling executeVoiceSegmentsStage...');
          stageResult = await executeVoiceSegmentsStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, regenerate_scene);
        } else {
          stageResult = await executeTTSStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        }
        break;
      case 'template_renderer': {
        // Delegate carousel rendering to Fly.io worker
        // NOTE: Local WASM execution crashes edge functions with "unreachable" — always use worker
        const carouselWorkerUrl = Deno.env.get('CAROUSEL_RENDERER_WORKER_URL');
        const isCalledByCarouselWorker = req.headers.get('x-carousel-worker') === 'true';

        if (!carouselWorkerUrl) {
          throw new Error('CAROUSEL_RENDERER_WORKER_URL not configured — carousel rendering requires the Fly.io worker');
        }

        if (isCalledByCarouselWorker) {
          // Called by the worker itself (shouldn't happen, but prevent loops)
          throw new Error('Carousel worker called execute-stage for template_renderer — infinite loop prevented');
        }

        console.log(`[CAROUSEL DELEGATION] Delegating ${stage_id} to carousel-renderer worker`);

        // Update status so UI shows progress
        await supabase
          .from('content_outputs')
          .update({ current_stage: stage_id, status: 'generating' })
          .eq('id', output_id);

        // Await worker response with timeout
        const controller = new AbortController();
        const delegationTimeout = setTimeout(() => controller.abort(), 120_000); // 2 min for rendering

        try {
          const workerRes = await fetch(`${carouselWorkerUrl}/render`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              output_id,
              stage_id,
              regenerate_slide: regenerate_scene,
            }),
            signal: controller.signal,
          });
          clearTimeout(delegationTimeout);

          if (workerRes.ok) {
            const workerResult = await workerRes.json();
            console.log(`[CAROUSEL DELEGATION] Worker completed: ${workerResult.slides} slides in ${workerResult.elapsed_ms}ms`);

            // Worker updates stage_data and status directly — return success
            return new Response(
              JSON.stringify({ success: true, delegated: true, message: `Carousel rendered: ${workerResult.slides} slides` }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          } else {
            const errText = await workerRes.text().catch(() => 'unknown');
            throw new Error(`Carousel worker returned ${workerRes.status}: ${errText}`);
          }
        } catch (delegationError: any) {
          clearTimeout(delegationTimeout);
          const isAbort = delegationError instanceof DOMException && delegationError.name === 'AbortError';
          const errMsg = isAbort ? 'Carousel rendering timed out (120s)' : `Carousel rendering failed: ${delegationError.message}`;
          console.error(`[CAROUSEL DELEGATION] ${errMsg}`);
          throw new Error(errMsg);
        }
      }
      case 'image_generator':
        stageResult = await executeImageStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, regenerate_scene, custom_prompt, instructions);
        break;
      case 'image_to_video':
        stageResult = await executeI2VStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, regenerate_clip);
        break;
      case 'world_simulator':
        stageResult = await executeWorldSimStage(output, stage_id, stageConfig, configuration, apiKeys, supabase, regenerate_clip);
        break;
      case 'face_swap':
        stageResult = await executeFaceSwapStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        break;
      case 'heygen_video':
        stageResult = await executeHeyGenVideoStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        break;
      case 'heygen_template':
        stageResult = await executeHeyGenTemplateStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        break;
      case 'assembly':
        stageResult = await executeAssemblyStage(output, stage_id, stageConfig, configuration, apiKeys, supabase);
        break;
      case 'config':
        // Config stages (like carousel_style) just store user-provided config
        // The style should have been set via generation_params before this stage executes
        stageResult = await executeConfigStage(output, stage_id, stageConfig);
        break;
      default:
        throw new Error(`Unknown model type: ${stageConfig.modelType}`);
    }
    } // End of if (!stageResult) - legacy execution path

    // Get current stage_data
    const currentStageData = output.stage_data || {};
    
    // Calculate cumulative cost
    const previousCost = output.generation_cost || 0;
    const stageCost = stageResult.cost || 0;
    const totalCost = previousCost + stageCost;
    
    // Check if this is an async media stage or a partial generation (scenes batching)
    const isAsyncStage = ['image_generator', 'image_to_video', 'world_simulator', 'assembly', 'heygen_video', 'heygen_template'].includes(stageConfig.modelType);
    const isPartialGeneration = stageResult.partial === true; // Scene generation that needs continuation
    const isGenerating = stageResult.status === 'generating' || isPartialGeneration;
    
    // Update output with stage result
    const updatedStageData = {
      ...currentStageData,
      [stage_id]: {
        ...stageResult,
        status: (isAsyncStage || isPartialGeneration) && isGenerating ? 'generating' : 'awaiting_approval',
        completed_at: (isAsyncStage || isPartialGeneration) && isGenerating ? undefined : new Date().toISOString()
      }
    };

    await supabase
      .from('content_outputs')
      .update({
        stage_data: updatedStageData,
        status: (isAsyncStage || isPartialGeneration) && isGenerating ? 'generating' : 'review',
        generation_cost: totalCost,
        // A stage just succeeded, so any earlier error (a timed-out trigger, a failed attempt) is stale.
        error_message: null
      })
      .eq('id', output_id);

    console.log(`✓ Stage ${stage_id} completed successfully`);

    // Auto-approve synchronous stages for autopilot jobs OR jobs with auto_approve_all enabled
    // (Async stages are auto-approved in generation-completion-webhook)
    // Don't auto-approve partial generations - they need to continue first
    const isSyncComplete = (!isAsyncStage && !isPartialGeneration) || !isGenerating;
    const shouldAutoApprove = output.autopilot_id || output.generation_params?.auto_approve_all;

    if (isSyncComplete && shouldAutoApprove) {
      // Approving triggers the next stage, which triggers the next approval,
      // and so on. Awaiting that here made every caller wait for the whole
      // rest of the pipeline, so long runs (image models, references) hit the
      // 150s gateway timeout mid-chain. Respond now; approve in the background.
      const autoApprove = async () => {
        const autoApproveSource = output.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
        console.log(`🤖 [${autoApproveSource}] Auto-approving synchronous stage ${stage_id} for output ${output_id}`);

        try {
          // Invoke approve-stage function
          const { error: approveError } = await supabase.functions.invoke('approve-stage', {
            body: {
              output_id: output_id,
              stage_id: stage_id,
              action: 'approve',
              is_automated: true,
              autopilot_id: output.autopilot_id
            }
          });

          if (approveError) {
            console.error(`❌ [${autoApproveSource}] Auto-approval failed:`, approveError);
            // Log the failure (only for autopilot jobs)
            if (output.autopilot_id) {
              await supabase.from('automation_logs').insert({
                autopilot_id: output.autopilot_id,
                output_id: output_id,
                job_id: output.job_id,
                event_type: 'auto_approval_failed',
                stage_id: stage_id,
                details: { error: approveError.message || 'Unknown error' }
              });
            }
          } else {
            console.log(`✅ [${autoApproveSource}] Stage ${stage_id} auto-approved`);
            // Log the success (only for autopilot jobs)
            if (output.autopilot_id) {
              await supabase.from('automation_logs').insert({
                autopilot_id: output.autopilot_id,
                output_id: output_id,
                job_id: output.job_id,
                event_type: 'stage_auto_approved',
                stage_id: stage_id,
                details: {}
              });
            }
          }
        } catch (autoApproveError) {
          console.error(`❌ [${autoApproveSource}] Auto-approval exception:`, autoApproveError);
        }
      };
      const pending = autoApprove();
      const edgeRuntime = (globalThis as any).EdgeRuntime;
      if (edgeRuntime?.waitUntil) {
        edgeRuntime.waitUntil(pending);
      } else {
        await pending;
      }
    }

    return new Response(
      JSON.stringify({ success: true, result: stageResult }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error executing stage:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // CRITICAL: Update database status so user sees what failed
    // Without this, jobs hang indefinitely at "generating" status
    try {
      // Re-create supabase client if needed (may not be in scope if error occurred early)
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const errorSupabase = createClient(supabaseUrl, supabaseServiceKey);

      // output_id and stage_id are hoisted above the try block so they're
      // accessible here even when the error happens after JSON parse.
      const errorOutputId = output_id;
      const errorStageId = stage_id;

      if (errorOutputId && errorStageId) {
        const { data: currentOutput } = await errorSupabase
          .from('content_outputs')
          .select('stage_data')
          .eq('id', errorOutputId)
          .single();

        const currentStageData = currentOutput?.stage_data || {};

        await errorSupabase
          .from('content_outputs')
          .update({
            status: 'failed',
            error_message: errorMessage,
            stage_data: {
              ...currentStageData,
              [errorStageId]: {
                ...currentStageData[errorStageId],
                status: 'failed',
                error: errorMessage,
                failed_at: new Date().toISOString()
              }
            }
          })
          .eq('id', errorOutputId);

        console.log(`✅ Updated output ${errorOutputId} status to 'failed' with error: ${errorMessage}`);

        // Sync job progress so the job status reflects the failed output
        try {
          const { data: outputRow } = await errorSupabase
            .from('content_outputs')
            .select('job_id')
            .eq('id', errorOutputId)
            .single();

          if (outputRow?.job_id) {
            await errorSupabase.rpc('sync_job_progress', { p_job_id: outputRow.job_id });
            console.log(`Synced job progress for job ${outputRow.job_id} after output failure`);
          }
        } catch (syncErr) {
          console.error('Failed to sync job progress after output failure:', syncErr);
        }
      } else {
        console.warn('Could not update database - output_id or stage_id not available');
      }
    } catch (dbError) {
      console.error('Failed to update database with error status:', dbError);
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Pipeline stage configurations (matching frontend types)
const PIPELINE_STAGES: Record<string, any[]> = {
  ugc_video: [
    { id: 'script', modelType: 'text_llm' },
    { id: 'voice', modelType: 'tts', inputFrom: ['script'] },
    { id: 'video', modelType: 'face_swap', inputFrom: ['voice'] }
  ],
  generative_video_oneshot: [
    { id: 'scene_prompts', modelType: 'text_llm', outputFormat: 'text_array' },
    { id: 'clips', modelType: 'world_simulator', inputFrom: ['scene_prompts'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['clips'] }
  ],
  storyboard_video_longform: [
    { id: 'outline', modelType: 'text_llm' },
    { id: 'full_voiceover', modelType: 'tts', inputFrom: ['outline'] },  // Single TTS for entire script - determines scene count
    { id: 'scenes', modelType: 'text_llm', outputFormat: 'scene_array', inputFrom: ['outline', 'full_voiceover'] },
    { id: 'storyboard', modelType: 'image_generator', inputFrom: ['scenes'] },
    { id: 'clips', modelType: 'image_to_video', inputFrom: ['storyboard'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['clips', 'full_voiceover'] }
  ],
  instagram_carousel: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', modelType: 'text_llm', outputFormat: 'text_array', inputFrom: ['caption'] },
    { id: 'carousel_slides', modelType: 'template_renderer', inputFrom: ['carousel_content'] },
  ],
  instagram_carousel_ai: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', modelType: 'text_llm', outputFormat: 'text_array', inputFrom: ['caption'] },
    { id: 'carousel_slides', modelType: 'image_generator', inputFrom: ['carousel_content'] },
  ],
  social_media_post: [
    { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'image_prompt', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['caption'] },
    { id: 'image', modelType: 'image_generator', inputFrom: ['image_prompt'] }
  ],
  image_only: [
    { id: 'image', modelType: 'image_generator', outputFormat: 'url' }
  ],
  // X thread: one text step; content is stored as {"tweets":[{"text"}]} for publishing.
  twitter_thread: [
    { id: 'thread_tweets', modelType: 'text_llm', outputFormat: 'thread_array' }
  ],
  ugc_heygen: [
    { id: 'script', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', modelType: 'heygen_video', inputFrom: ['script'] }
  ],
  ugc_heygen_template: [
    { id: 'variables', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', modelType: 'heygen_template', inputFrom: ['variables'] }
  ],
  // Unified video pipeline — all stages handled by new execution engine (Phase 4)
  video: [
    { id: 'web_capture', modelType: 'assembly' },
    { id: 'video_ingest', modelType: 'assembly' },
    { id: 'transcribe', modelType: 'tts' },
    { id: 'outline', modelType: 'text_llm' },
    { id: 'rewrite', modelType: 'text_llm' },
    { id: 'voiceover', modelType: 'tts' },
    { id: 'director', modelType: 'text_llm' },
    { id: 'b_roll', modelType: 'assembly' },
    { id: 'images', modelType: 'image_generator' },
    { id: 'composition', modelType: 'assembly' },
    { id: 'post_caption', modelType: 'text_llm' },
  ],
};

function getStageConfig(pipeline: string, stageId: string) {
  const stages = PIPELINE_STAGES[pipeline];
  return stages?.find(s => s.id === stageId);
}

// ============= CONFIG STAGE (for carousel_style) =============
async function executeConfigStage(
  output: any,
  stageId: string,
  stageConfig: any
): Promise<any> {
  console.log(`Executing config stage: ${stageId}`);

  // For carousel_style, the config is set in generation_params.carousel_style
  if (stageId === 'carousel_style') {
    const carouselStyle = output.generation_params?.carousel_style;

    if (!carouselStyle) {
      // Return a default style if not provided
      return {
        style: {
          template: 'professional',
          aspectRatio: '1:1',
          palette: {
            primary: '#2563eb',
            secondary: '#3b82f6',
            background: '#f8fafc',
            text: '#1e293b',
            textMuted: '#64748b',
          },
          accentStyle: 'solid',
          fontStyle: 'sans-serif',
          visualStyle: 'professional corporate design, clean lines, trustworthy appearance',
          moodKeywords: ['professional', 'trustworthy', 'corporate'],
        },
        status: 'approved',
        cost: 0
      };
    }

    return {
      style: carouselStyle,
      status: 'approved',
      cost: 0
    };
  }

  // Generic config stage - just return what's in generation_params
  return {
    config: output.generation_params?.[stageId] || {},
    status: 'approved',
    cost: 0
  };
}

// ============= CAROUSEL IMAGE PROMPT BUILDERS =============

/**
 * Build visual style suffix for carousel slides.
 * This creates a consistent visual theme that's appended AFTER the scene prompt.
 *
 * Note: styleGuidelines is intentionally NOT included here - it contains writing style
 * guidelines (tone, voice, etc.) which are not relevant for image generation.
 * Only visual style properties should be included.
 */
function buildCarouselVisualStyleSuffix(style: any): string {
  if (!style) return '';

  const { palette, template, accentStyle, fontStyle, visualStyle, moodKeywords } = style;

  const parts: string[] = [];

  // Template/design style
  if (template) {
    parts.push(`${template} design style`);
  }

  // Color palette - handle different structures
  if (palette) {
    if (palette.primary && palette.secondary && palette.background) {
      // Full palette object
      parts.push(`color palette: ${palette.primary} primary, ${palette.secondary} accent, ${palette.background} background`);
    } else if (palette.primary || palette.secondary) {
      // Partial palette
      const colors = [palette.primary, palette.secondary, palette.background, palette.accent].filter(Boolean);
      if (colors.length > 0) {
        parts.push(`color palette: ${colors.join(', ')}`);
      }
    } else if (palette.description) {
      // String description
      parts.push(`color palette: ${palette.description}`);
    } else if (typeof palette === 'string') {
      parts.push(`color palette: ${palette}`);
    }
  }

  // Typography
  if (fontStyle) {
    parts.push(`${fontStyle} typography`);
  }

  // Accent style
  if (accentStyle) {
    parts.push(`${accentStyle} accent elements`);
  }

  // Visual style description
  if (visualStyle) {
    parts.push(visualStyle);
  }

  // Mood keywords
  if (moodKeywords && Array.isArray(moodKeywords) && moodKeywords.length > 0) {
    parts.push(...moodKeywords.map((k: string) => `${k} aesthetic`));
  }

  return parts.length > 0 ? `Style: ${parts.join(', ')}` : '';
}

/**
 * Build context for variable substitution in carousel image prompts.
 * This extracts relevant data from generation_params and library_elements.
 */
function buildCarouselPromptContext(
  output: any,
  configuration: any
): Record<string, string> {
  const context: Record<string, string> = {};
  const libraryElements = configuration?.library_elements || output.generation_params?.library_elements || {};
  const imageInputs = output.generation_params?.image_inputs || {};

  // Idea/topic context
  const ideaContext = output.generation_params?.idea_context || '';
  context.idea = ideaContext;
  context.context = ideaContext;
  context.topic = ideaContext;
  context.title = ideaContext;

  // Brand voice (can be stored as 'brand', 'library_brand_voices', or 'brand_voice')
  const brandVoice = libraryElements.brand || libraryElements.library_brand_voices || libraryElements.brand_voice;
  if (brandVoice) {
    context.brand = brandVoice.name || '';
    context.brand_name = brandVoice.name || '';
    context.brand_voice = brandVoice.description || '';
    context.brand_tone = brandVoice.tone || '';
    context.brand_style_guidelines = brandVoice.style_guidelines || '';
    // Visual Identity - support both underscore and dot notation for templates
    const colorPalette = typeof brandVoice.color_palette === 'object'
      ? JSON.stringify(brandVoice.color_palette)
      : (brandVoice.color_palette || '');
    context.brand_visual_template = brandVoice.visual_template || '';
    context.brand_color_palette = colorPalette;
    context['brand.color_palette'] = colorPalette;  // Dot notation support
    context.brand_font_style = brandVoice.font_style || '';
    context['brand.font_style'] = brandVoice.font_style || '';  // Dot notation support
    context.brand_accent_style = brandVoice.accent_style || '';
    context['brand.accent_style'] = brandVoice.accent_style || '';  // Dot notation support
    context.brand_visual_style_description = brandVoice.visual_style_description || '';
    context['brand.visual_style'] = brandVoice.visual_style_description || '';  // Dot notation support
    context.brand_mood_keywords = Array.isArray(brandVoice.mood_keywords)
      ? brandVoice.mood_keywords.join(', ')
      : (brandVoice.mood_keywords || '');
  }

  // Character
  const char = Array.isArray(libraryElements.character)
    ? libraryElements.character[0]
    : libraryElements.character;
  if (char) {
    context.character = char.name || '';
    context.character_name = char.name || '';
    context.character_description = char.description || '';
    context.character_visual_style = char.visual_style || '';
    context.character_physical_traits = char.physical_traits || '';

    // Reference images
    const charRefImages = imageInputs?.library_characters || imageInputs?.character || char.reference_images || [];
    if (charRefImages.length > 0) {
      context.character_reference_image = charRefImages[0];
    }
  }

  // Product
  const prod = Array.isArray(libraryElements.product)
    ? libraryElements.product[0]
    : libraryElements.product;
  if (prod) {
    context.product = prod.name || '';
    context.product_name = prod.name || '';
    context.product_description = prod.description || '';
  }

  // AI Insights variables - populated from idea's ai_analysis or key_talking_points
  const ideaAiAnalysis = output.generation_params?.idea_ai_analysis;
  const selectedAiInsights = output.generation_params?.selected_ai_insights;

  // Get key_talking_points directly from generation_params (stored separately from ai_analysis)
  const directKeyTalkingPoints = output.generation_params?.key_talking_points;

  // Parse AI analysis if it's a string
  let parsedAiAnalysis: any = null;
  if (ideaAiAnalysis) {
    try {
      parsedAiAnalysis = typeof ideaAiAnalysis === 'string'
        ? JSON.parse(ideaAiAnalysis)
        : ideaAiAnalysis;
    } catch {
      parsedAiAnalysis = null;
    }
  }

  // Build AI insight context - from parsedAiAnalysis or direct fields
  if (parsedAiAnalysis || directKeyTalkingPoints) {
    // Hooks
    const hooks = parsedAiAnalysis?.hooks || [];
    if (hooks.length > 0) {
      context.ai_hooks = hooks.map((h: any, i: number) => `${i + 1}. "${h.text}" (${h.type})`).join('\n');
      context.ai_hooks_list = hooks.map((h: any) => h.text).join(' | ');
      context.ai_hook = hooks[0]?.text || '';
      context.ai_hook_type = hooks[0]?.type || '';
    }

    // CTAs
    const ctas = parsedAiAnalysis?.ctas || [];
    if (ctas.length > 0) {
      context.ai_ctas = ctas.map((c: any, i: number) => `${i + 1}. "${c.text}" (${c.placement || c.type})`).join('\n');
      context.ai_ctas_list = ctas.map((c: any) => c.text).join(' | ');
      context.ai_cta = ctas[0]?.text || '';
      context.ai_cta_placement = ctas[0]?.placement || '';
      context.ai_cta_type = ctas[0]?.type || '';
    }

    // Talking points - check multiple sources
    const talkingPoints = directKeyTalkingPoints
      || parsedAiAnalysis?.key_talking_points
      || parsedAiAnalysis?.talking_points
      || [];
    if (talkingPoints.length > 0) {
      context.ai_talking_points = talkingPoints.map((p: string) => `• ${p}`).join('\n');
      context.ai_talking_points_list = talkingPoints.join(', ');
    }

    // Script structure
    const ss = parsedAiAnalysis?.script_structure;
    if (ss) {
      context.ai_script_opening = ss.opening || '';
      context.ai_script_body = ss.body || '';
      context.ai_script_climax = ss.climax || '';
      context.ai_script_closing = ss.closing || '';
      const structureParts = [];
      if (ss.opening) structureParts.push(`Opening: ${ss.opening}`);
      if (ss.body) structureParts.push(`Body: ${ss.body}`);
      if (ss.climax) structureParts.push(`Climax: ${ss.climax}`);
      if (ss.closing) structureParts.push(`Closing: ${ss.closing}`);
      context.ai_script_structure = structureParts.join('\n');
    }

    // Engagement drivers
    const engagementDrivers = parsedAiAnalysis?.engagement_drivers || [];
    if (engagementDrivers.length > 0) {
      context.ai_engagement_drivers = engagementDrivers.map((d: string) => `• ${d}`).join('\n');
      context.ai_engagement_drivers_list = engagementDrivers.join(', ');
    }
  }

  // Override with selected insights if present (user-selected specific hook/CTA for this output)
  if (selectedAiInsights) {
    if (selectedAiInsights.hook) {
      context.ai_hook = selectedAiInsights.hook.text || '';
      context.ai_hook_type = selectedAiInsights.hook.type || '';
    }
    if (selectedAiInsights.cta) {
      context.ai_cta = selectedAiInsights.cta.text || '';
      context.ai_cta_placement = selectedAiInsights.cta.placement || '';
      context.ai_cta_type = selectedAiInsights.cta.type || '';
    }
    if (selectedAiInsights.talking_points?.length) {
      context.ai_talking_points = selectedAiInsights.talking_points.map((p: string) => `• ${p}`).join('\n');
      context.ai_talking_points_list = selectedAiInsights.talking_points.join(', ');
    }
    // Single talking point for variations
    if (selectedAiInsights.talking_point) {
      context.ai_talking_point = selectedAiInsights.talking_point.text || '';
    }
    if (selectedAiInsights.script_structure) {
      const ss = selectedAiInsights.script_structure;
      context.ai_script_structure = [
        ss.opening ? `Opening: ${ss.opening}` : '',
        ss.body ? `Body: ${ss.body}` : '',
        ss.climax ? `Climax: ${ss.climax}` : '',
        ss.closing ? `Closing: ${ss.closing}` : ''
      ].filter(Boolean).join('\n\n');
      context.ai_script_opening = ss.opening || '';
      context.ai_script_body = ss.body || '';
      context.ai_script_climax = ss.climax || '';
      context.ai_script_closing = ss.closing || '';
    }
    if (selectedAiInsights.engagement_drivers?.length) {
      context.ai_engagement_drivers = selectedAiInsights.engagement_drivers.map((d: string) => `• ${d}`).join('\n');
      context.ai_engagement_drivers_list = selectedAiInsights.engagement_drivers.join(', ');
    }
  }

  // Block (visual style blocks from library)
  const block = libraryElements.block;
  if (block) {
    context.block = block.content || block.name || '';
    context['block.content'] = block.content || '';
    context['block.name'] = block.name || '';
    context['block.block_type'] = block.block_type || '';
    // Also support underscore notation
    context.block_content = block.content || '';
    context.block_name = block.name || '';
    context.block_type = block.block_type || '';
  }

  return context;
}

/**
 * Build the complete image prompt for a carousel slide.
 * Structure: [Anti-collage] + [Master Image Prompt OR Visual Style] + [Scene Prompt] + [Quality markers]
 *
 * NOTE: We prioritize master prompt (from blueprint) if available.
 * If master prompt already contains style info, we skip the visualStyleSuffix to avoid duplication.
 *
 * @param masterPrompt - The image_prompt template from blueprint (optional)
 * @param scenePrompt - The specific slide/scene description
 * @param visualStyleSuffix - The visual style from carousel_style (fallback if no master prompt)
 * @param slideNumber - The slide number (used for logging only, NOT included in prompt)
 * @param context - Context object for variable substitution in master prompt
 */
function buildCarouselSlideImagePrompt(
  masterPrompt: string | undefined,
  scenePrompt: string,
  visualStyleSuffix: string,
  slideNumber: number,
  context: Record<string, string> = {}
): string {
  const parts: string[] = [];

  // CRITICAL: Start with single-slide instruction to prevent collage generation
  parts.push('Single Instagram carousel slide, one unified composition, NOT a collage, NOT multiple panels, NOT a grid layout');

  // 1. Master Image Prompt (from blueprint) with variable substitution
  // If master prompt exists, it takes precedence and we skip visualStyleSuffix to avoid duplication
  let hasMasterStyle = false;
  if (masterPrompt) {
    let resolvedMaster = masterPrompt;
    // Substitute variables like {{character}}, {{brand}}, {{ai_talking_points_list}}, etc.
    // Only replace if the context has a value for that variable
    for (const [key, value] of Object.entries(context)) {
      if (value) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
        resolvedMaster = resolvedMaster.replace(regex, value);
      }
    }
    // Remove any remaining unsubstituted variables (only if they have no value)
    resolvedMaster = resolvedMaster.replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim();
    if (resolvedMaster) {
      parts.push(resolvedMaster);
      // Check if master prompt already has style indicators
      hasMasterStyle = /style|palette|color|font|design/i.test(resolvedMaster);
    }
  }

  // 2. Scene/Slide specific prompt (without "Slide N:" prefix - AI generates one image at a time)
  // Clean the scene prompt - remove any "Slide X:" prefix if it exists in the scene prompt itself
  const cleanedScenePrompt = scenePrompt.replace(/^Slide\s*\d+\s*[:.]?\s*/i, '').trim();
  if (cleanedScenePrompt) {
    parts.push(cleanedScenePrompt);
  }

  // 3. Visual Style Theme ONLY if no master prompt style exists (to avoid duplication)
  if (visualStyleSuffix && !hasMasterStyle) {
    parts.push(visualStyleSuffix);
  }

  // Add quality markers with anti-collage reinforcement
  parts.push('professional social media quality, single focal point, clean composition');

  return parts.join('. ');
}


async function executeScenePromptsStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  supabaseUrl: string,
  regenerate_scene?: number,
  custom_prompt?: string
): Promise<any> {
  console.log('[executeScenePromptsStage] Function called, starting execution...');
  console.log('[executeScenePromptsStage] Output ID:', output.id);
  console.log('[executeScenePromptsStage] Generation params:', JSON.stringify(output.generation_params));
  
  return await retryWithBackoff(async () => {
    console.log('[executeScenePromptsStage] Inside retryWithBackoff function');
    
    const openRouterKey = apiKeys.find(k => k.provider === 'openrouter');
    if (!openRouterKey && !apiKeys.find((k: { provider: string }) => k.provider === 'ollama')) {
      throw new Error('OpenRouter API key not configured');
    }
    console.log('[executeScenePromptsStage] Found OpenRouter key');

    const decryptedKey = openRouterKey ? await decryptApiKey(openRouterKey.key_encrypted) : '';
    console.log('[executeScenePromptsStage] Key decrypted successfully');
    
    const rawTextModelId = configuration?.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL;
    const llmTarget = await resolveStageTextLlm(apiKeys, rawTextModelId, decryptedKey);
    const modelId = llmTarget.modelId;
    console.log('[executeScenePromptsStage] Using model:', modelId);
    
    // Check if this is a single scene regeneration
    if (regenerate_scene !== undefined) {
      console.log(`[executeScenePromptsStage] Regenerating single scene: ${regenerate_scene}`);
      
      // Get existing scenes
      const existingScenes = output.stage_data?.scene_prompts?.scenes || [];
      const targetScene = existingScenes.find((s: any) => s.scene === regenerate_scene);
      
      if (!targetScene) {
        throw new Error(`Scene ${regenerate_scene} not found`);
      }
      
      // Get video config for constraints - prioritize I2V model config for actual clip duration
      const videoConfig = configuration?.video_config || { sceneCount: 4, sceneDuration: 8, totalDuration: 30 };
      const i2vSeconds = configuration?.model_config?.image_to_video?.parameters?.seconds;
      const sceneDuration = i2vSeconds || videoConfig.sceneDuration;
      const wordsPerScene = Math.floor(sceneDuration * 2.5);
      
      // Get context
      const masterPrompt = custom_prompt || output.generation_params?.prompt || '';
      const ideaContext = output.generation_params?.idea_context || '';
      const libraryElements = output.generation_params?.library_elements || {};
      const imageInputs = output.generation_params?.image_inputs || {};
      const visualContext = buildVisualContext(libraryElements, imageInputs);
      const storyContext = buildStoryContext(libraryElements, ideaContext);
      
      // Build system prompt for single scene regeneration
      const systemPrompt = `You are regenerating scene ${regenerate_scene} for a video.
Each scene is ${sceneDuration} seconds long.

${visualContext ? `🎭 CHARACTER (from reference image):
${visualContext}
The video model will use the reference image - just describe actions and dialogue.
` : ''}

📣 STORY & DIALOGUE CONTEXT:
${storyContext}

BRIEF & STYLE:
${masterPrompt}

⏱️ DIALOGUE LENGTH CONSTRAINT:
- This scene is ONLY ${sceneDuration} seconds
- At natural speaking pace (~130 words/min), this scene can fit MAXIMUM ${wordsPerScene} words of spoken dialogue
- Keep dialogue PUNCHY and CONCISE

⚠️ CRITICAL REQUIREMENTS:
1. Scene MUST include DIALOGUE - what the character is SAYING
2. Dialogue must DIRECTLY discuss: "${ideaContext}"
3. Combine: SETTING + ACTION + WHAT THEY'RE SAYING
4. Dialogue must be BRIEF (~${wordsPerScene} words max)
5. AVOID all-caps words in dialogue

OUTPUT: Single scene prompt with natural dialogue.`;

      const response = await fetchWithTimeout(llmTarget.url, {
        method: 'POST',
        headers: {
          ...llmTarget.headers,
          'HTTP-Referer': supabaseUrl,
          'X-Title': 'ContentAI Studio'
        },
        body: JSON.stringify({
          max_tokens: DEFAULT_TEXT_MAX_TOKENS,
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Regenerate scene ${regenerate_scene} with a fresh, compelling prompt.` }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const newPrompt = result.choices?.[0]?.message?.content || '';
      const cost = calculateOpenRouterCost(result.usage, modelId);
      
      // Update only the target scene in the existing scenes array
      const updatedScenes = existingScenes.map((s: any) => 
        s.scene === regenerate_scene 
          ? { ...s, prompt: newPrompt, status: 'pending' }
          : s
      );
      
      console.log(`[executeScenePromptsStage] Single scene regenerated. Cost: $${cost.toFixed(4)}`);
      
      return {
        scenes: updatedScenes,
        model: result.model,
        usage: result.usage,
        cost
      };
    }
    
    // Get video configuration from job configuration or use default
    // Prioritize I2V model config for actual clip duration
    const videoConfig = configuration?.video_config || { sceneCount: 4, sceneDuration: 8, totalDuration: 30 };
    const i2vSeconds = configuration?.model_config?.image_to_video?.parameters?.seconds;
    const sceneCount = videoConfig.sceneCount;
    const sceneDuration = i2vSeconds || videoConfig.sceneDuration;
    const totalDuration = videoConfig.totalDuration;
    console.log(`[executeScenePromptsStage] Video config: ${sceneCount} scenes, ${sceneDuration}s per scene, ${totalDuration}s total`);
    
    // Get master prompt and idea context
    const masterPrompt = output.generation_params?.prompt || '';
    const ideaContext = output.generation_params?.idea_context || '';
    console.log('[executeScenePromptsStage] Master prompt length:', masterPrompt.length);
    console.log('[executeScenePromptsStage] Idea context:', ideaContext);
    
    // Get library elements and build visual context
    const libraryElements = output.generation_params?.library_elements || {};
    const imageInputs = output.generation_params?.image_inputs || {};
    const visualContext = buildVisualContext(libraryElements, imageInputs);
    const storyContext = buildStoryContext(libraryElements, ideaContext);
    console.log('[executeScenePromptsStage] Visual context built:', visualContext ? 'YES' : 'NO');
    console.log('[executeScenePromptsStage] Story context built:', storyContext ? 'YES' : 'NO');

    // Extract talking points
    const talkingPoints = extractTalkingPoints(output.generation_params);
    const talkingPointsSection = talkingPoints.length > 0
      ? `\n📝 KEY TALKING POINTS (distribute across scenes):\n${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\nEach scene should cover at least one talking point.\n`
      : '';
    console.log(`[executeScenePromptsStage] Found ${talkingPoints.length} talking points`);

    // Calculate dialogue length constraints
    const wordsPerScene = Math.floor(sceneDuration * 2.2); // ~2.2 words/second speaking pace (conservative)

    // Build system prompt for scene generation
    const systemPrompt = `You are generating scene prompts for a ${totalDuration}s video with ${sceneCount} scenes.
Each scene is ${sceneDuration} seconds long.

${visualContext ? `🎭 CHARACTER (from reference image):
${visualContext}
The video model will use the reference image - just describe actions and dialogue.
` : ''}

📣 STORY & DIALOGUE CONTEXT:
${storyContext}
${talkingPointsSection}
BRIEF & STYLE:
${masterPrompt}

⏱️ DIALOGUE LENGTH CONSTRAINT:
- Each scene is ONLY ${sceneDuration} seconds
- At natural speaking pace (~130 words/min), each scene can fit MAXIMUM ${wordsPerScene} words of spoken dialogue
- Keep dialogue PUNCHY and CONCISE - no rambling
- One clear point per scene, not multiple concepts

⚠️ CRITICAL REQUIREMENTS - READ CAREFULLY:
1. EVERY scene MUST include DIALOGUE - what the character is SAYING about the topic
2. The dialogue must DIRECTLY discuss the main topic: "${ideaContext}"
3. DO NOT write visual-only prompts - this is NOT a silent film
4. Scene prompts combine: SETTING + ACTION + WHAT THEY'RE SAYING
5. Dialogue must be BRIEF ENOUGH to speak in ${sceneDuration} seconds (~${wordsPerScene} words max)
6. AVOID all-caps words in dialogue - write naturally as people speak (e.g., "Triple P System" not "TRIPLE P SYSTEM")

✅ CORRECT FORMAT (with brief dialogue for ${sceneDuration}s):
Scene 1: "the man sits in his modern office, he says 'cold email isn't dead - most people just do it wrong'"
Scene 2: "he leans forward gesturing, explaining 'the secret is the Triple P System - personalize, provide value, persist'"
Scene 3: "close-up as he points at screen, he reveals 'this approach generated two million dollars in just six months'"
Scene 4: "he smiles at camera, encouraging 'start with step one today - you got this'"

❌ WRONG (too long for ${sceneDuration}s):
Scene 1: "the man sits explaining the entire history of cold email marketing and why traditional approaches fail in today's environment and what we need to do differently..."

❌ WRONG (all-caps words that TTS will spell out):
Scene 1: "he explains the TRIPLE P SYSTEM and why EVERYONE needs this NOW"

OUTPUT FORMAT - RESPOND WITH ONLY VALID JSON, NO OTHER TEXT:
Return a JSON object with a "scenes" array. Each scene has "scene" (number) and "prompt" (string) keys.
Example: {"scenes": [{"scene": 1, "prompt": "..."}, {"scene": 2, "prompt": "..."}]}
DO NOT include any markdown, explanations, or text outside the JSON.
Each prompt MUST describe what they're SAYING (~${wordsPerScene} words max).`;

    console.log('[executeScenePromptsStage] System prompt built, making API call to OpenRouter...');

    const response = await fetchWithTimeout(llmTarget.url, {
      method: 'POST',
      headers: {
        ...llmTarget.headers,
        'HTTP-Referer': supabaseUrl,
        'X-Title': 'ContentAI Studio'
      },
      body: JSON.stringify({
        max_tokens: DEFAULT_TEXT_MAX_TOKENS,
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate ${sceneCount} scene prompts for this video concept.` }
        ],
        response_format: { type: "json_object" }
      })
    });

    console.log('[executeScenePromptsStage] API response received, status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[executeScenePromptsStage] API error response:', errorText);
      throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[executeScenePromptsStage] Response parsed, extracting content...');
    
    const content = result.choices?.[0]?.message?.content || '{}';
    console.log('[executeScenePromptsStage] Content length:', content.length);
    
      // Parse JSON response with robust extraction
      let scenePrompts: any[];
      try {
        let cleanContent = content.trim();

        // Normalize special characters that LLMs often produce
        cleanContent = normalizeDashes(cleanContent)
          .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // smart double quotes → regular
          .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes → regular
          .replace(/\u2026/g, '...')  // ellipsis → three dots
          .replace(/[\u00A0]/g, ' ');  // non-breaking space → regular space

        // Try multiple extraction strategies
        let parsed: any = null;

        // Strategy 1: Strip markdown code blocks and try direct parse
        let jsonContent = cleanContent;
        if (jsonContent.includes('```')) {
          // Extract content from code blocks (handle multiple formats)
          const codeBlockMatch = jsonContent.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            jsonContent = codeBlockMatch[1].trim();
          }
        }

        try {
          parsed = JSON.parse(jsonContent);
        } catch (e) {
          // Strategy 2: Find JSON object boundaries in the response
          const jsonObjectMatch = cleanContent.match(/\{[\s\S]*"scenes"[\s\S]*\}/);
          if (jsonObjectMatch) {
            try {
              parsed = JSON.parse(jsonObjectMatch[0]);
            } catch (e2) {
              // Try to fix common issues
            }
          }

          // Strategy 3: Find JSON array boundaries
          if (!parsed) {
            const jsonArrayMatch = cleanContent.match(/\[[\s\S]*\{[\s\S]*"scene"[\s\S]*\}[\s\S]*\]/);
            if (jsonArrayMatch) {
              try {
                parsed = JSON.parse(jsonArrayMatch[0]);
              } catch (e3) {
                // Continue to final error
              }
            }
          }
        }

        if (!parsed) {
          console.error('[executeScenePromptsStage] Could not extract JSON from response. First 500 chars:', cleanContent.substring(0, 500));
          throw new Error('Could not extract valid JSON from LLM response');
        }

        scenePrompts = parsed.scenes || parsed;

        // Validate structure
        if (!Array.isArray(scenePrompts) || scenePrompts.length === 0) {
          console.error('[executeScenePromptsStage] Invalid structure, parsed:', parsed);
          throw new Error('Invalid scene prompts structure - expected non-empty array');
        }
        console.log(`[executeScenePromptsStage] Successfully parsed ${scenePrompts.length} scene prompts`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[executeScenePromptsStage] Parse error:', message);
        console.error('[executeScenePromptsStage] Raw content preview:', content.substring(0, 300));
        throw new Error(`Failed to parse scene prompts: ${message}`);
      }
    
    const cost = calculateOpenRouterCost(result.usage, modelId);

    console.log(`[executeScenePromptsStage] Scene prompts generation complete. Generated ${scenePrompts.length} scenes. Cost: $${cost.toFixed(4)}`);

    return {
      scenes: scenePrompts,
      model: result.model,
      usage: result.usage,
      cost
    };
  }, 'Scene prompts generation');
}

// ============= ENHANCED SCENES STAGE (for storyboard_video_longform) =============
// Generates structured scenes with narration, image_prompt, i2v_prompt, i2v_motion_type, and duration
async function executeEnhancedScenesStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  supabaseUrl: string,
  regenerate_scene?: number,
  custom_prompt?: string
): Promise<any> {
  console.log('[executeEnhancedScenesStage] Starting enhanced scene breakdown...');

  // Track start time for timeout management
  const generationStartTime = Date.now();
  const MAX_EXECUTION_MS = 110000; // 110s safety margin (Supabase timeout is 150s)

  return await retryWithBackoff(async () => {
    const openRouterKey = apiKeys.find((k: any) => k.provider === 'openrouter');
    if (!openRouterKey && !apiKeys.find((k: { provider: string }) => k.provider === 'ollama')) {
      throw new Error('OpenRouter API key not configured');
    }
    const decryptedKey = openRouterKey ? await decryptApiKey(openRouterKey.key_encrypted) : '';
    const rawTextModelId = configuration?.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL;
    const llmTarget = await resolveStageTextLlm(apiKeys, rawTextModelId, decryptedKey);
    const modelId = llmTarget.modelId;

    // Get outline from previous stage (for storyboard_video_longform)
    // CHANGED: Always extract prose narration - scene count is determined by voiceover duration, not outline structure
    const outlineData = output.stage_data?.outline;
    let narrativeContent = ''; // Prose narrative for scene breakdown

    if (outlineData?.scenes && Array.isArray(outlineData.scenes)) {
      // Structured format: join all scene narrations into prose
      narrativeContent = outlineData.scenes
        .sort((a: any, b: any) => (a.scene_number || 0) - (b.scene_number || 0))
        .map((s: any) => s.narration || s.text || '')
        .filter((text: string) => text.trim())
        .join('\n\n');
      console.log(`[executeEnhancedScenesStage] Extracted prose from ${outlineData.scenes.length} structured scenes (${narrativeContent.length} chars)`);
    } else if (outlineData?.content) {
      // Try to parse JSON from content string
      try {
        const parsed = JSON.parse(outlineData.content);
        if (parsed.scenes && Array.isArray(parsed.scenes)) {
          // Structured format in content: join all scene narrations into prose
          narrativeContent = parsed.scenes
            .sort((a: any, b: any) => (a.scene_number || 0) - (b.scene_number || 0))
            .map((s: any) => s.narration || s.text || '')
            .filter((text: string) => text.trim())
            .join('\n\n');
          console.log(`[executeEnhancedScenesStage] Extracted prose from JSON content: ${parsed.scenes.length} scenes (${narrativeContent.length} chars)`);
        } else {
          // Plain prose narrative
          narrativeContent = outlineData.content;
          console.log('[executeEnhancedScenesStage] Using prose narrative content');
        }
      } catch {
        // Not JSON, treat as prose narrative
        narrativeContent = outlineData.content;
        console.log('[executeEnhancedScenesStage] Using prose narrative content (not JSON)');
      }
    } else if (output.stage_data?.narrative?.content) {
      // Legacy narrative stage support
      narrativeContent = output.stage_data.narrative.content;
      console.log('[executeEnhancedScenesStage] Using legacy narrative stage content');
    }

    if (!narrativeContent) {
      throw new Error('No outline content found. Expected prose narrative or structured scenes with narration.');
    }

    // Video configuration - support both totalDuration (new) and targetDuration (legacy)
    const videoConfig = output.generation_params?.video_config || {};

    // NEW: Use audio duration from full_voiceover stage to determine scene count
    // This ensures video duration matches narration length
    const voiceoverData = output.stage_data?.full_voiceover;

    // Always use 5s clips for consistent scene pacing
    const sceneDuration = 5;
    let sceneCount: number;
    let targetDuration: number;

    if (voiceoverData?.duration && voiceoverData?.recommended_scene_count) {
      // Use voiceover-driven scene count (preferred - audio duration is source of truth)
      sceneCount = voiceoverData.recommended_scene_count;
      targetDuration = voiceoverData.duration;
      console.log(`[executeEnhancedScenesStage] Using voiceover-driven scene count: ${sceneCount} scenes for ${targetDuration}s audio`);
    } else {
      // Fallback: calculate from user's target duration (voiceover hasn't run yet)
      targetDuration = videoConfig.totalDuration || 30;
      sceneCount = Math.ceil(targetDuration / sceneDuration);
      console.log(`[executeEnhancedScenesStage] Calculated scene count: ${sceneCount} scenes (${targetDuration}s / ${sceneDuration}s per scene)`);
    }

    // Hard cap: never exceed scene count implied by user's requested duration
    const userRequestedDuration = videoConfig.totalDuration;
    if (userRequestedDuration && sceneCount > Math.ceil(userRequestedDuration / sceneDuration)) {
      const maxScenes = Math.ceil(userRequestedDuration / sceneDuration);
      console.warn(`[executeEnhancedScenesStage] Scene count ${sceneCount} exceeds user-requested duration cap (${userRequestedDuration}s → max ${maxScenes} scenes). Capping.`);
      sceneCount = maxScenes;
    }

    console.log(`[executeEnhancedScenesStage] Video config: ${sceneCount} scenes, ${sceneDuration}s per scene, ${targetDuration}s total`);

    // If regenerating a single scene, handle differently
    if (regenerate_scene !== undefined) {
      console.log(`[executeEnhancedScenesStage] Regenerating single scene: ${regenerate_scene}`);
      const existingScenes = output.stage_data?.scenes?.scenes || [];
      const sceneToRegenerate = existingScenes.find((s: any) => s.scene_number === regenerate_scene);

      if (!sceneToRegenerate) {
        throw new Error(`Scene ${regenerate_scene} not found`);
      }

      // Get visual story summary from full generation for consistency
      const visualStorySummary = output.stage_data?.scenes?.visual_story_summary || '';

      // Get adjacent scenes for continuity
      const previousScene = existingScenes.find((s: any) => s.scene_number === regenerate_scene - 1);
      const nextScene = existingScenes.find((s: any) => s.scene_number === regenerate_scene + 1);

      // Get library elements (only present if selected at blueprint level)
      const libraryElements = output.generation_params?.library_elements || {};
      const brandVoice = getBrandVoice(libraryElements);
      const character = getCharacter(libraryElements);

      // Get talking point this scene covers
      const talkingPointCovered = sceneToRegenerate.talking_point_covered || '';

      console.log(`[executeEnhancedScenesStage] Single scene context: visual_story=${!!visualStorySummary}, prev=${!!previousScene}, next=${!!nextScene}, brand=${!!brandVoice?.tone}, char=${!!character?.speaking_style}`);

      const regeneratePrompt = custom_prompt || `Regenerate scene ${regenerate_scene} with different creative choices while maintaining the same narrative context.`;

      // Build context sections (only if data is available from blueprint selection)
      const visualStorySection = visualStorySummary
        ? `=== VISUAL STORY CONTEXT ===\n${visualStorySummary}\n\n`
        : '';

      const previousSceneSection = previousScene
        ? `=== PREVIOUS SCENE (for continuity) ===\nScene ${previousScene.scene_number}: "${previousScene.narration?.substring(0, 100)}..."\nImage: ${previousScene.image_prompt?.substring(0, 100)}...\n\n`
        : '';

      const nextSceneSection = nextScene
        ? `=== NEXT SCENE (for continuity) ===\nScene ${nextScene.scene_number}: "${nextScene.narration?.substring(0, 100)}..."\nImage: ${nextScene.image_prompt?.substring(0, 100)}...\n\n`
        : '';

      const characterSection = (character?.speaking_style || character?.overall_tone)
        ? `=== CHARACTER VOICE (maintain consistency) ===\nSpeaking Style: ${character.speaking_style || 'natural'}\nTone: ${character.overall_tone || 'conversational'}\n\n`
        : '';

      const brandSection = brandVoice?.tone
        ? `=== BRAND TONE ===\nTone: ${brandVoice.tone}\n${brandVoice.style_guidelines ? `Style: ${brandVoice.style_guidelines}\n` : ''}\n`
        : '';

      const storyRoleSection = talkingPointCovered
        ? `=== STORY ROLE ===\nThis scene covers: ${talkingPointCovered}\n\n`
        : '';

      const singleSceneSystemPrompt = `You are regenerating a single scene for a documentary video.
Maintain consistency with the established visual story and narrative flow.

${visualStorySection}${previousSceneSection}${nextSceneSection}${characterSection}${brandSection}${storyRoleSection}The scene should have:
1. narration: Voiceover text (MAXIMUM ${Math.floor(sceneDuration * 2.2)} words for ${sceneDuration} seconds - STRICT LIMIT)
2. image_prompt: Detailed visual description (50-100 words) - MUST connect visually to adjacent scenes
3. i2v_prompt: Short camera motion description (5-15 words like "slow zoom in on subject")
4. i2v_motion_type: One of: static, zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, parallax
5. duration_seconds: ${sceneDuration}

Output ONLY valid JSON:
{
  "scene_number": ${regenerate_scene},
  "narration": "...",
  "image_prompt": "...",
  "i2v_prompt": "...",
  "i2v_motion_type": "zoom_in",
  "duration_seconds": ${sceneDuration}
}`;

      const response = await fetch(llmTarget.url, {
        method: 'POST',
        headers: {
          ...llmTarget.headers,
          'HTTP-Referer': supabaseUrl,
        },
        body: JSON.stringify({
          max_tokens: DEFAULT_TEXT_MAX_TOKENS,
          model: modelId,
          messages: [
            { role: 'system', content: singleSceneSystemPrompt },
            { role: 'user', content: `Regenerate scene ${regenerate_scene}.\n\nCURRENT SCENE TO IMPROVE:\nNarration: ${sceneToRegenerate.narration}\nImage prompt: ${sceneToRegenerate.image_prompt}\n\nINSTRUCTIONS: ${regeneratePrompt}\n\nMaintain visual and narrative continuity with adjacent scenes.` }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      let regeneratedScene;
      try {
        regeneratedScene = JSON.parse(content);
      } catch (e) {
        throw new Error('Failed to parse regenerated scene JSON');
      }

      // Update the scene in existing scenes array
      const updatedScenes = existingScenes.map((s: any) =>
        s.scene_number === regenerate_scene
          ? { ...regeneratedScene, status: 'pending' }
          : s
      );

      const cost = calculateOpenRouterCost(result.usage, modelId);

      return {
        scenes: updatedScenes,
        model: modelId,
        usage: result.usage,
        cost
      };
    }

    // Get context from library elements
    const libraryElements = output.generation_params?.library_elements || {};
    const brandVoice = getBrandVoice(libraryElements);
    const product = libraryElements.product ? (Array.isArray(libraryElements.product) ? libraryElements.product[0] : libraryElements.product) : null;
    const character = libraryElements.character ? (Array.isArray(libraryElements.character) ? libraryElements.character[0] : libraryElements.character) : null;

    // Extract story adherence elements: hook, talking points, CTA
    const selectedAiInsights = output.generation_params?.selected_ai_insights || {};

    // Hook for scene 1
    const hook = selectedAiInsights.hook?.text || '';
    const hookSection = hook
      ? `\nHOOK (Scene 1 opening): "${hook}"\n`
      : '';

    // Talking points distributed across scenes
    const talkingPoints = extractTalkingPoints(output.generation_params);
    const talkingPointsSection = talkingPoints.length > 0
      ? `\nKey Talking Points (incorporate into narration, distribute across scenes):\n${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`
      : '';

    // CTA for final scene
    const cta = selectedAiInsights.cta?.text || '';
    const ctaSection = cta
      ? `\nCTA (Final scene closing): "${cta}"\n`
      : '';

    // Script structure for narrative flow
    const scriptStructure = selectedAiInsights.script_structure;
    const scriptStructureSection = scriptStructure
      ? `\nNarrative Flow Guidelines:
- Opening: ${scriptStructure.opening || 'Hook the audience'}
- Body: ${scriptStructure.body || 'Deliver key content'}
- Climax: ${scriptStructure.climax || 'Emotional peak'}
- Closing: ${scriptStructure.closing || 'Clear call to action'}\n`
      : '';

    console.log(`[executeEnhancedScenesStage] Story adherence: hook=${!!hook}, ${talkingPoints.length} talking points, cta=${!!cta}, structure=${!!scriptStructure}`);

    // Get blueprint's image_prompt template if available
    const imagePromptTemplate = configuration?.image_prompt || output.generation_params?.image_prompt;

    console.log('[executeEnhancedScenesStage] DEBUG - configuration?.image_prompt:', configuration?.image_prompt ? configuration.image_prompt.substring(0, 300) : 'UNDEFINED');
    console.log('[executeEnhancedScenesStage] DEBUG - output.generation_params?.image_prompt:', output.generation_params?.image_prompt ? output.generation_params.image_prompt.substring(0, 300) : 'UNDEFINED');
    console.log('[executeEnhancedScenesStage] DEBUG - Final imagePromptTemplate length:', imagePromptTemplate?.length || 0);

    // Build visual style context from library elements
    let visualContext = '';

    // Add blueprint's image prompt template as primary visual guidance
    if (imagePromptTemplate) {
      // Substitute variables in the template with library element values and slot values
      let resolvedTemplate = imagePromptTemplate;

      // Get slot_values for idea/topic/title/context variables
      const slotValues = output.generation_params?.slot_values || {};
      // Inject date variables (won't overwrite if user explicitly set them)
      const dateVars = getDateVariables();
      for (const [k, v] of Object.entries(dateVars)) {
        if (!slotValues[k]) slotValues[k] = v;
      }
      const ideaContext = output.generation_params?.idea_context || '';

      // Replace slot value variables (topic, title, idea, context, description, etc.)
      for (const [key, value] of Object.entries(slotValues)) {
        if (typeof value === 'string') {
          const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
          resolvedTemplate = resolvedTemplate.replace(regex, value);
        }
      }

      // Replace library element variables (e.g., {{block.content}}, {{block.name}})
      // These come from library_elements in generation_params when user selects a library item in a slot
      const libraryElementsFromParams = output.generation_params?.library_elements || {};
      console.log('[executeEnhancedScenesStage] Library elements for template resolution:', Object.keys(libraryElementsFromParams));
      console.log('[executeEnhancedScenesStage] Template before library element resolution:', resolvedTemplate.substring(0, 200));

      // Debug: Check what placeholders exist in the template
      const placeholdersBeforeResolution = resolvedTemplate.match(/\{\{[^}]+\}\}/g) || [];
      console.log('[executeEnhancedScenesStage] Placeholders to resolve:', placeholdersBeforeResolution);

      for (const [elementKey, elementData] of Object.entries(libraryElementsFromParams)) {
        console.log(`[executeEnhancedScenesStage] Processing library element '${elementKey}':`,
          elementData ? (typeof elementData === 'object' ? Object.keys(elementData as object) : typeof elementData) : 'null/undefined');

        if (elementData && typeof elementData === 'object') {
          // Replace each property of the library element
          for (const [propKey, propValue] of Object.entries(elementData as Record<string, any>)) {
            if (typeof propValue === 'string') {
              const placeholder = `{{${elementKey}.${propKey}}}`;
              const regex = new RegExp(`\\{\\{${elementKey}\\.${propKey}\\}\\}`, 'gi');
              const beforeReplace = resolvedTemplate;
              resolvedTemplate = resolvedTemplate.replace(regex, propValue);
              if (beforeReplace !== resolvedTemplate) {
                console.log(`[executeEnhancedScenesStage] ✅ Replaced ${placeholder} with ${propValue.length} chars`);
              }
            }
          }
          // Also support simple {{element}} replacement with element.name or element.content
          const simpleValue = (elementData as any).content || (elementData as any).name || '';
          if (simpleValue) {
            const regex = new RegExp(`\\{\\{${elementKey}\\}\\}`, 'gi');
            resolvedTemplate = resolvedTemplate.replace(regex, simpleValue);
          }
        }
      }

      // Also replace common aliases that may not be in slot_values
      resolvedTemplate = resolvedTemplate.replace(/\{\{idea\}\}/gi, slotValues.idea || ideaContext);
      resolvedTemplate = resolvedTemplate.replace(/\{\{context\}\}/gi, slotValues.context || ideaContext);
      resolvedTemplate = resolvedTemplate.replace(/\{\{title\}\}/gi, slotValues.title || ideaContext);
      resolvedTemplate = resolvedTemplate.replace(/\{\{topic\}\}/gi, slotValues.topic || ideaContext);

      // Replace library element variables
      if (brandVoice?.name) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand_voice\.name\}\}/gi, brandVoice.name);
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand\.name\}\}/gi, brandVoice.name);
      }
      if (brandVoice?.visual_style) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand_voice\.visual_style\}\}/gi, brandVoice.visual_style);
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand\.visual_style\}\}/gi, brandVoice.visual_style);
      }
      if (brandVoice?.tone) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand_voice\.tone\}\}/gi, brandVoice.tone);
        resolvedTemplate = resolvedTemplate.replace(/\{\{brand\.tone\}\}/gi, brandVoice.tone);
      }
      if (product?.name) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{product\.name\}\}/gi, product.name);
      }
      if (product?.description) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{product\.description\}\}/gi, product.description);
      }
      if (character?.name) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{character\.name\}\}/gi, character.name);
      }
      if (character?.visual_style) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{character\.visual_style\}\}/gi, character.visual_style);
      }
      if (character?.visual_description) {
        resolvedTemplate = resolvedTemplate.replace(/\{\{character\.visual_description\}\}/gi, character.visual_description);
      }

      // Explicit block handling (visual style blocks from library)
      // This is a failsafe in case the generic loop above didn't catch it
      const blockElement = libraryElementsFromParams.block;
      if (blockElement) {
        console.log('[executeEnhancedScenesStage] Explicit block handling - block element found:', Object.keys(blockElement));
        if (blockElement.content) {
          const beforeBlockReplace = resolvedTemplate;
          resolvedTemplate = resolvedTemplate.replace(/\{\{block\.content\}\}/gi, blockElement.content);
          if (beforeBlockReplace !== resolvedTemplate) {
            console.log(`[executeEnhancedScenesStage] ✅ Explicit block.content replacement successful (${blockElement.content.length} chars)`);
          } else {
            console.log('[executeEnhancedScenesStage] ⚠️ block.content replacement had no effect - placeholder may already be resolved or not present');
          }
        }
        if (blockElement.name) {
          resolvedTemplate = resolvedTemplate.replace(/\{\{block\.name\}\}/gi, blockElement.name);
        }
        if (blockElement.block_type) {
          resolvedTemplate = resolvedTemplate.replace(/\{\{block\.block_type\}\}/gi, blockElement.block_type);
        }
      }

      // Log before stripping placeholders to see what wasn't resolved
      const unresolvedPlaceholders = resolvedTemplate.match(/\{\{[^}]+\}\}/g);
      if (unresolvedPlaceholders && unresolvedPlaceholders.length > 0) {
        console.log('[executeEnhancedScenesStage] WARNING - Unresolved placeholders being stripped:', unresolvedPlaceholders);
      }

      // Clean up any remaining unresolved placeholders
      resolvedTemplate = resolvedTemplate.replace(/\{\{[^}]+\}\}/g, '');

      visualContext = `Image Style Template (IMPORTANT - use this as the foundation for all image prompts):\n${resolvedTemplate}`;
      console.log('[executeEnhancedScenesStage] RESOLVED image_prompt template:', resolvedTemplate.substring(0, 500) + '...');
    }

    // Add brand voice visual style
    if (brandVoice?.visual_style) {
      visualContext += `${visualContext ? '\n\n' : ''}Visual Style Guidelines: ${brandVoice.visual_style}`;
    }

    // Add product focus
    if (product?.name) {
      visualContext += `${visualContext ? '\n' : ''}Product Focus: ${product.name}${product.description ? ` - ${product.description}` : ''}`;
    }

    // Add character description if available
    if (character?.visual_description) {
      visualContext += `${visualContext ? '\n' : ''}Character Description: ${character.visual_description}`;
    }

    // ========================================================================
    // Break down narrative prose into scenes based on voiceover duration
    // Scene count is ALWAYS determined by voiceover audio duration / 5s per clip
    // ========================================================================
    console.log('[executeEnhancedScenesStage] Breaking down narrative prose into scenes');

    // Build system prompt for structured output
    const systemPrompt = `You are a documentary production assistant. Break down narratives into production-ready scenes.

AUDIO/VISUAL SEPARATION (CRITICAL):
- "narration" = ALL spoken content (will be converted to TTS voiceover by ElevenLabs)
- "image_prompt" = VISUAL ONLY description for image generation (NO text, NO speech, NO captions)
- "i2v_prompt" = Camera motion description (the I2V model creates SILENT video clips)
- Final video assembly combines: TTS audio + silent video clips

VISUAL STORY COHERENCE (CRITICAL):
First, design a UNIFIED VISUAL STORY that spans all scenes:
1. Establish a consistent visual world/setting for the entire video
2. Plan how the story progresses visually from hook → talking points → CTA
3. Ensure visual continuity - scenes should feel like parts of ONE story, not disconnected images
4. Each scene's image_prompt must:
   - Visually represent what the narration is discussing (talking point alignment)
   - Connect to previous and next scenes (story flow)
   - Maintain consistent style, setting, and character appearance

STYLE CONSISTENCY RULE (OVERRIDES ALL OTHER VISUAL DECISIONS):
- Scene 1 establishes the visual genre, color grading, and art direction for ALL scenes
- Every subsequent scene MUST match Scene 1's visual style exactly
- If Scene 1 is photorealistic → ALL scenes are photorealistic
- If Scene 1 is illustration → ALL scenes are illustration
- NEVER mix visual styles (e.g., don't switch from photorealistic to cartoon mid-video)
- Maintain consistent color grading, lighting direction, and composition style throughout

STORY STRUCTURE TO VISUAL MAPPING:
- Scene 1 (HOOK): Attention-grabbing visual that sets up the story premise
- Middle scenes (TALKING POINTS): Each image shows the concept being discussed
- Final scene (CTA): Action-oriented visual that reinforces the call-to-action

For EACH scene, provide:
1. narration: Exact voiceover text (MAXIMUM ${Math.floor(sceneDuration * 2.2)} words for ${sceneDuration} seconds - STRICT LIMIT, narration MUST fit in scene duration)
2. image_prompt: Detailed VISUAL description that MATCHES narration content (50-100 words - NO TEXT IN IMAGES)
3. talking_point_covered: Which story element this scene covers (hook/talking_point_N/cta)
4. i2v_prompt: Short camera motion description (5-15 words like "slow zoom in on subject")
5. i2v_motion_type: One of: static, zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, parallax
6. duration_seconds: ALWAYS ${sceneDuration} seconds (fixed clip duration for I2V model)

Motion type guidelines:
- static: Minimal movement, good for text overlays or still moments
- zoom_in: Creates intimacy, draws attention to details
- zoom_out: Reveals context, establishes scope
- pan_left/right: Follows action, explores horizontal space
- pan_up/down: Reveals vertical elements, dramatic reveals
- parallax: 2.5D effect, adds depth to static images

${visualContext ? `\nVisual Guidelines:\n${visualContext}` : ''}

Output ONLY valid JSON matching this exact structure:
{
  "visual_story_summary": "Brief description of the unified visual narrative across all scenes",
  "scenes": [
    {
      "scene_number": 1,
      "narration": "...",
      "image_prompt": "...",
      "talking_point_covered": "hook",
      "i2v_prompt": "...",
      "i2v_motion_type": "zoom_in",
      "duration_seconds": ${sceneDuration}
    }
  ],
  "total_estimated_duration": ${targetDuration},
  "total_narration_words": 0
}`;

    const userPrompt = `Create ${sceneCount} scenes for a ${Math.floor(targetDuration/60)} minute ${targetDuration % 60 > 0 ? `${targetDuration % 60} second` : ''} documentary.

NARRATIVE OUTLINE:
${narrativeContent}

=== STORY ADHERENCE REQUIREMENTS ===
${hookSection}${talkingPointsSection}${ctaSection}${scriptStructureSection}

=== VISUAL STORY PLANNING ===
Before generating individual scenes, plan a UNIFIED VISUAL NARRATIVE:
1. What is the visual "world" or setting for this story?
2. How will the visuals progress from hook → content → CTA?
3. What visual elements will create continuity across scenes?

Requirements:
- Generate exactly ${sceneCount} scenes as parts of ONE cohesive visual story
- Total duration: approximately ${targetDuration} seconds
- Scene duration: EXACTLY ${sceneDuration} seconds per scene (fixed for I2V model)
- Vary motion types for visual interest (don't use the same motion for consecutive scenes)
- Ensure narration flows naturally between scenes
- Each image_prompt MUST visually represent its corresponding talking point/hook/CTA
- Images should tell the same story as narration - visual and audio must be aligned
- Include emotional pacing (build tension, moments of calm, climaxes)
- CRITICAL: All spoken content goes in "narration" field only (for TTS voiceover)
- CRITICAL: "image_prompt" is for SILENT image generation (NO text, NO speech bubbles, NO captions in images)`;

    // === BATCHED GENERATION FOR LONG VIDEOS ===
    // For story consistency in long-form content (15+ scenes), split into batches
    // Each batch maintains continuity via visual_story_summary and previous scenes
    const BATCH_SIZE = 12; // Optimal for LLM context and story coherence
    const needsBatching = sceneCount > 15;

    if (needsBatching) {
      console.log(`[executeEnhancedScenesStage] Long video detected (${sceneCount} scenes). Using batched generation for story consistency.`);
    }

    // Helper function to generate a single batch of scenes
    async function generateBatch(
      batchNumber: number,
      startScene: number,
      endScene: number,
      visualStorySummary: string | null,
      previousScenes: any[],
      coveredTalkingPoints: string[],
      allNarrations: string[]  // Full narration text from all previous scenes
    ): Promise<{ scenes: any[], visualStorySummary: string, usage: any }> {
      const batchSceneCount = endScene - startScene + 1;
      const isFirstBatch = batchNumber === 1;
      const isLastBatch = endScene >= sceneCount;

      // Determine which story elements this batch should cover
      let batchStoryElements = '';
      if (isFirstBatch) {
        batchStoryElements = `This is the OPENING batch. Must include:\n- Scene 1: HOOK - "${hook || 'Attention-grabbing opening'}"\n`;
        // Assign first portion of talking points
        const pointsForBatch = talkingPoints.slice(0, Math.ceil(talkingPoints.length / Math.ceil(sceneCount / BATCH_SIZE)));
        if (pointsForBatch.length > 0) {
          batchStoryElements += `- Cover talking points: ${pointsForBatch.map((p, i) => `${i + 1}. ${p}`).join(', ')}\n`;
        }
      } else if (isLastBatch) {
        batchStoryElements = `This is the FINAL batch. Must include:\n- Final scene: CTA - "${cta || 'Strong call to action'}"\n`;
        // Remaining talking points not yet covered
        const remainingPoints = talkingPoints.filter(p => !coveredTalkingPoints.includes(p));
        if (remainingPoints.length > 0) {
          batchStoryElements += `- Cover remaining talking points: ${remainingPoints.map((p, i) => `${i + 1}. ${p}`).join(', ')}\n`;
        }
      } else {
        // Middle batch - assign next portion of talking points
        const totalBatches = Math.ceil(sceneCount / BATCH_SIZE);
        const batchIndex = batchNumber - 1;
        const pointsPerBatch = Math.ceil(talkingPoints.length / totalBatches);
        const pointsForBatch = talkingPoints.slice(batchIndex * pointsPerBatch, (batchIndex + 1) * pointsPerBatch);
        if (pointsForBatch.length > 0) {
          batchStoryElements = `This is batch ${batchNumber}. Cover these talking points:\n${pointsForBatch.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`;
        }
      }

      // Build continuity context from previous batch - PASS FULL NARRATIONS
      let continuityContext = '';
      if (!isFirstBatch) {
        // Build full narration context so LLM knows exactly what was already said
        const fullNarrationContext = allNarrations.join('\n\n');

        // Check if we need to truncate for very long videos (context limit ~100k tokens)
        // Average narration ~50 words = ~65 tokens, so 1000 scenes = ~65k tokens
        const MAX_NARRATION_CHARS = 150000; // Safe limit for most models

        let narrationSection: string;
        if (allNarrations.length === 0) {
          narrationSection = '';
        } else if (fullNarrationContext.length > MAX_NARRATION_CHARS) {
          // Keep last 50 scenes in full, summarize earlier ones
          const recentNarrations = allNarrations.slice(-50).join('\n\n');
          const earlierCount = allNarrations.length - 50;
          narrationSection = `[Scenes 1-${earlierCount} established the story foundation - ${earlierCount} scenes covering: ${coveredTalkingPoints.slice(0, earlierCount).join(', ')}]

RECENT NARRATION (last 50 scenes - read carefully):
${recentNarrations}`;
        } else {
          narrationSection = `ALL NARRATION WRITTEN SO FAR:
${fullNarrationContext}`;
        }

        continuityContext = `\n=== STORY SO FAR (read carefully before continuing) ===
VISUAL WORLD: ${visualStorySummary}

${narrationSection}
=== END OF EXISTING NARRATION ===

LAST 2 SCENES (for direct visual/audio continuity):
${previousScenes.map(s => `Scene ${s.scene_number}:\nNarration: "${s.narration}"\nVisual: ${s.image_prompt}`).join('\n\n')}
`;
      }

      // Batch-specific system prompt
      const batchSystemPrompt = isFirstBatch
        ? systemPrompt  // First batch gets full system prompt with visual story planning
        : `You are continuing scene generation for a documentary video.
MAINTAIN CONSISTENCY with the established visual story and narrative flow.

${visualStorySummary ? `ESTABLISHED VISUAL WORLD:\n${visualStorySummary}\n` : ''}

For EACH scene, provide:
1. narration: Voiceover text (MAXIMUM ${Math.floor(sceneDuration * 2.2)} words for ${sceneDuration} seconds - STRICT LIMIT)
2. image_prompt: Detailed VISUAL description that MATCHES narration (50-100 words - NO TEXT IN IMAGES)
3. talking_point_covered: Which story element this scene covers (talking_point_N/cta)
4. i2v_prompt: Short camera motion description (5-15 words)
5. i2v_motion_type: One of: static, zoom_in, zoom_out, pan_left, pan_right, pan_up, pan_down, parallax
6. duration_seconds: ALWAYS ${sceneDuration} seconds (fixed clip duration)

${visualContext ? `Visual Guidelines:\n${visualContext}` : ''}

Output ONLY valid JSON:
{
  "scenes": [
    {
      "scene_number": ${startScene},
      "narration": "...",
      "image_prompt": "...",
      "talking_point_covered": "...",
      "i2v_prompt": "...",
      "i2v_motion_type": "...",
      "duration_seconds": ${sceneDuration}
    }
  ]
}`;

      // Batch-specific user prompt
      const batchUserPrompt = isFirstBatch
        ? userPrompt  // First batch gets full user prompt
        : `Continue generating scenes ${startScene}-${endScene} for the documentary.
${continuityContext}

${batchStoryElements}

NARRATIVE OUTLINE (full story for reference):
${narrativeContent.substring(0, 2000)}...

CRITICAL REQUIREMENTS:
- Read ALL existing narration above before writing
- DO NOT repeat arguments, examples, statistics, or phrases already said
- Each scene must ADVANCE the story with NEW information
- If referencing earlier content, BUILD on it - don't rephrase it
- Generate scenes ${startScene} through ${endScene} (${batchSceneCount} scenes)
- MAINTAIN visual continuity with previous scenes
- Continue the established tone and visual world
- Each scene ~${sceneDuration} seconds
- Vary motion types for visual interest`;

      console.log(`[executeEnhancedScenesStage] Generating batch ${batchNumber}: scenes ${startScene}-${endScene}`);

      const response = await fetch(llmTarget.url, {
        method: 'POST',
        headers: {
          ...llmTarget.headers,
          'HTTP-Referer': supabaseUrl,
        },
        body: JSON.stringify({
          max_tokens: DEFAULT_TEXT_MAX_TOKENS,
          model: modelId,
          messages: [
            { role: 'system', content: batchSystemPrompt },
            { role: 'user', content: batchUserPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[executeEnhancedScenesStage] Batch ${batchNumber} API error:`, errorText);
        throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      // Parse response (same parsing logic as before)
      let batchData;
      try {
        let cleanContent = content
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/\u2026/g, '...')
          .replace(/[\u00A0]/g, ' ')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');

        const jsonMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          cleanContent = jsonMatch[1].trim();
        }

        if (!cleanContent.trim().startsWith('{')) {
          const jsonStart = cleanContent.indexOf('{');
          const jsonEnd = cleanContent.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
          }
        }

        cleanContent = cleanContent.replace(/,(\s*[}\]])/g, '$1');
        cleanContent = cleanContent.replace(/\\n/g, ' ');
        batchData = JSON.parse(cleanContent);
      } catch (e) {
        console.error(`[executeEnhancedScenesStage] Batch ${batchNumber} JSON parse error:`, e);
        throw new Error(`Failed to parse batch ${batchNumber} JSON`);
      }

      // Normalize scenes with correct scene numbers
      const batchScenes = (batchData.scenes || []).map((scene: any, index: number) => ({
        scene_number: startScene + index,
        narration: scene.narration || '',
        image_prompt: scene.image_prompt || '',
        talking_point_covered: scene.talking_point_covered || '',
        i2v_prompt: scene.i2v_prompt || 'subtle slow zoom',
        i2v_motion_type: validateMotionType(scene.i2v_motion_type),
        duration_seconds: sceneDuration, // Always fixed 5s clips for I2V model
        status: 'pending'
      }));

      console.log(`[executeEnhancedScenesStage] Batch ${batchNumber} generated ${batchScenes.length} scenes`);

      return {
        scenes: batchScenes,
        visualStorySummary: batchData.visual_story_summary || visualStorySummary || '',
        usage: result.usage
      };
    }

    // === EXECUTE GENERATION (batched or single) ===
    let allScenes: any[] = [];
    let visualStorySummary = '';
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    if (needsBatching) {
      // BATCHED GENERATION for long videos
      const totalBatches = Math.ceil(sceneCount / BATCH_SIZE);
      let coveredTalkingPoints: string[] = [];
      let allNarrations: string[] = [];  // Full narration text from every scene for continuity
      let startBatch = 1;

      // Check for existing partial progress to resume from
      const existingScenes = output.stage_data?.scenes;
      if (existingScenes?.completed_batches && existingScenes?.scenes?.length > 0 && existingScenes?.status === 'generating') {
        allScenes = existingScenes.scenes;
        visualStorySummary = existingScenes.visual_story_summary || '';
        startBatch = existingScenes.completed_batches + 1;
        // Rebuild narrations and talking points from existing scenes
        allNarrations = allScenes.map((s: any) => `Scene ${s.scene_number}: ${s.narration}`);
        coveredTalkingPoints = existingScenes.covered_talking_points || allScenes.map((s: any) => s.talking_point_covered).filter(Boolean);
        console.log(`[executeEnhancedScenesStage] Resuming from batch ${startBatch}/${totalBatches}, ${allScenes.length} scenes already generated`);
      }

      for (let batchNum = startBatch; batchNum <= totalBatches; batchNum++) {
        const startScene = (batchNum - 1) * BATCH_SIZE + 1;
        const endScene = Math.min(batchNum * BATCH_SIZE, sceneCount);

        // Get last 2 scenes from previous batch for continuity
        const previousScenes = allScenes.slice(-2);

        const batchResult = await generateBatch(
          batchNum,
          startScene,
          endScene,
          visualStorySummary,
          previousScenes,
          coveredTalkingPoints,
          allNarrations  // Pass all narrations for context
        );

        // Deduplicate scenes by scene_number before merging
        // This prevents duplicates when LLM generates overlapping scene numbers
        // or when resumption logic re-generates some scenes
        const existingSceneNumbers = new Set(allScenes.map((s: any) => s.scene_number));
        const newUniqueScenes = batchResult.scenes.filter((s: any) => !existingSceneNumbers.has(s.scene_number));

        if (newUniqueScenes.length < batchResult.scenes.length) {
          const duplicateCount = batchResult.scenes.length - newUniqueScenes.length;
          const duplicateNumbers = batchResult.scenes
            .filter((s: any) => existingSceneNumbers.has(s.scene_number))
            .map((s: any) => s.scene_number);
          console.log(`[executeEnhancedScenesStage] ⚠️ Filtered ${duplicateCount} duplicate scenes: ${duplicateNumbers.join(', ')}`);
        }

        allScenes.push(...newUniqueScenes);

        // First batch establishes the visual story summary
        if (batchNum === 1) {
          visualStorySummary = batchResult.visualStorySummary;
        }

        // Track covered talking points for next batch
        batchResult.scenes.forEach((s: any) => {
          if (s.talking_point_covered && !coveredTalkingPoints.includes(s.talking_point_covered)) {
            coveredTalkingPoints.push(s.talking_point_covered);
          }
        });

        // Accumulate full narrations for next batch context
        batchResult.scenes.forEach((s: any) => {
          allNarrations.push(`Scene ${s.scene_number}: ${s.narration}`);
        });

        // Accumulate usage
        if (batchResult.usage) {
          totalUsage.prompt_tokens += batchResult.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += batchResult.usage.completion_tokens || 0;
          totalUsage.total_tokens += batchResult.usage.total_tokens || 0;
        }

        console.log(`[executeEnhancedScenesStage] Batch ${batchNum}/${totalBatches} complete. Total scenes: ${allScenes.length}, narrations: ${allNarrations.length}`);

        // Save progress after each batch to enable resumption
        await supabase.from('content_outputs').update({
          stage_data: {
            ...output.stage_data,
            scenes: {
              status: 'generating',
              scenes: allScenes,
              completed_batches: batchNum,
              total_batches: totalBatches,
              visual_story_summary: visualStorySummary,
              covered_talking_points: coveredTalkingPoints
            }
          },
          updated_at: new Date().toISOString()
        }).eq('id', output.id);

        // Check if we're approaching timeout - return early to allow re-invocation
        const elapsedMs = Date.now() - generationStartTime;
        if (elapsedMs > MAX_EXECUTION_MS && batchNum < totalBatches) {
          console.log(`[executeEnhancedScenesStage] Approaching timeout after ${elapsedMs}ms. Returning for continuation (${batchNum}/${totalBatches} batches complete).`);
          return {
            status: 'generating',
            partial: true,
            scenes: allScenes,
            completed_batches: batchNum,
            total_batches: totalBatches,
            visual_story_summary: visualStorySummary,
            message: `Generated ${allScenes.length}/${sceneCount} scenes. Continuing...`
          };
        }
      }
    } else {
      // SINGLE GENERATION for shorter videos (original behavior)
      console.log('[executeEnhancedScenesStage] Making API call to OpenRouter...');

      const response = await fetch(llmTarget.url, {
        method: 'POST',
        headers: {
          ...llmTarget.headers,
          'HTTP-Referer': supabaseUrl,
        },
        body: JSON.stringify({
          max_tokens: DEFAULT_TEXT_MAX_TOKENS,
          model: modelId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[executeEnhancedScenesStage] API error:', errorText);
        throw new Error(`OpenRouter error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;

      console.log('[executeEnhancedScenesStage] Parsing response...');
      console.log('[executeEnhancedScenesStage] Raw content (first 500 chars):', content?.substring(0, 500));

      // Parse JSON response with robust extraction
      let scenesData;
      try {
        let cleanContent = content
          .replace(/[\u201C\u201D]/g, '"')
          .replace(/[\u2018\u2019]/g, "'")
          .replace(/\u2026/g, '...')
          .replace(/[\u00A0]/g, ' ')
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n');

        const jsonMatch = cleanContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
          console.log('[executeEnhancedScenesStage] Found JSON in code block');
          cleanContent = jsonMatch[1].trim();
        }

        if (!cleanContent.trim().startsWith('{')) {
          const jsonStart = cleanContent.indexOf('{');
          const jsonEnd = cleanContent.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            console.log('[executeEnhancedScenesStage] Extracting JSON from position', jsonStart, 'to', jsonEnd);
            cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
          }
        }

        cleanContent = cleanContent.replace(/,(\s*[}\]])/g, '$1');
        cleanContent = cleanContent.replace(/\\n/g, ' ');
        scenesData = JSON.parse(cleanContent);
      } catch (e) {
        console.error('[executeEnhancedScenesStage] JSON parse error:', e);
        console.error('[executeEnhancedScenesStage] Content that failed to parse:', content?.substring(0, 1000));

        try {
          const scenesArrayMatch = content.match(/"scenes"\s*:\s*\[([\s\S]*?)\]/);
          if (scenesArrayMatch) {
            console.log('[executeEnhancedScenesStage] Attempting manual scenes array extraction...');
            const scenesArrayContent = '[' + scenesArrayMatch[1] + ']';
            const cleanedArray = scenesArrayContent
              .replace(/[\u201C\u201D]/g, '"')
              .replace(/[\u2018\u2019]/g, "'")
              .replace(/,(\s*[}\]])/g, '$1');
            const scenes = JSON.parse(cleanedArray);
            scenesData = { scenes };
            console.log('[executeEnhancedScenesStage] Manual extraction succeeded with', scenes.length, 'scenes');
          } else {
            throw new Error('Failed to parse scene breakdown JSON');
          }
        } catch (e2) {
          console.error('[executeEnhancedScenesStage] Manual extraction also failed:', e2);
          throw new Error('Failed to parse scene breakdown JSON');
        }
      }

      // Parse scenes and sort by scene_number to ensure correct ordering
      // LLM may return scenes out of order - sorting guarantees array index matches scene sequence
      const parsedScenes = (scenesData.scenes || []).map((scene: any, index: number) => ({
        scene_number: scene.scene_number || index + 1,
        narration: scene.narration || '',
        image_prompt: scene.image_prompt || '',
        talking_point_covered: scene.talking_point_covered || '',
        i2v_prompt: scene.i2v_prompt || 'subtle slow zoom',
        i2v_motion_type: validateMotionType(scene.i2v_motion_type),
        duration_seconds: sceneDuration, // Always fixed 5s clips for I2V model
        status: 'pending'
      }));

      // Sort by scene_number to ensure correct sequential order
      allScenes = parsedScenes.sort((a: any, b: any) => a.scene_number - b.scene_number);

      console.log(`[executeEnhancedScenesStage] Sorted ${allScenes.length} scenes by scene_number`);

      visualStorySummary = scenesData.visual_story_summary || '';
      totalUsage = result.usage;
    }

    if (allScenes.length === 0) {
      throw new Error('No scenes generated');
    }

    // Validate scene count matches voiceover duration
    // If LLM generated fewer scenes than needed, the video will be shorter than the audio
    if (allScenes.length < sceneCount) {
      console.warn(`[executeEnhancedScenesStage] ⚠️ SCENE COUNT MISMATCH: Generated ${allScenes.length} scenes but need ${sceneCount} to match ${targetDuration}s audio`);
      console.warn(`[executeEnhancedScenesStage] Video will be ${allScenes.length * sceneDuration}s but audio is ${targetDuration}s - audio will be cut off!`);

      // Calculate the shortfall
      const videoDuration = allScenes.length * sceneDuration;
      const audioShortfall = targetDuration - videoDuration;

      // If shortfall is significant (>4s), we should warn but continue
      // The alternative would be to retry, but that adds cost and delay
      if (audioShortfall > 4) {
        console.error(`[executeEnhancedScenesStage] ❌ CRITICAL: ${audioShortfall.toFixed(1)}s of audio will be lost. Consider regenerating scenes.`);
      }
    }

    const cost = calculateOpenRouterCost(totalUsage, modelId);
    const totalDuration = allScenes.reduce((sum: number, s: any) => sum + s.duration_seconds, 0);
    const totalWords = allScenes.reduce((sum: number, s: any) => sum + (s.narration?.split(/\s+/).length || 0), 0);

    console.log(`[executeEnhancedScenesStage] Generated ${allScenes.length} scenes, ${totalDuration}s total, ${totalWords} words. Cost: $${cost.toFixed(4)}`);

    // Validate narration lengths against scene durations
    const validation = validateNarrationLengths(allScenes);
    if (!validation.valid) {
      console.warn(`[executeEnhancedScenesStage] ⚠️ NARRATION LENGTH WARNINGS - ${validation.issues.length} scenes have narration that may be too long:`);
      for (const issue of validation.issues) {
        console.warn(`  Scene ${issue.scene}: ${issue.words} words (max ${issue.maxWords} for ${issue.duration}s) - ~${issue.overflow}s overflow`);
      }
    }

    return {
      scenes: allScenes,
      visual_story_summary: visualStorySummary,
      total_estimated_duration: totalDuration,
      total_narration_words: totalWords,
      narration_validation: validation, // Include validation results in output
      model: modelId,
      usage: totalUsage,
      cost
    };
  }, 'Enhanced scenes generation');
}

// Helper to validate narration lengths against scene durations
// Returns issues where narration is too long for the scene
function validateNarrationLengths(scenes: any[]): {
  valid: boolean;
  issues: Array<{ scene: number; words: number; maxWords: number; duration: number; overflow: number }>;
} {
  const WORDS_PER_SECOND = 2.2; // Conservative speaking pace
  const issues: Array<{ scene: number; words: number; maxWords: number; duration: number; overflow: number }> = [];

  for (const scene of scenes) {
    const wordCount = (scene.narration || '').split(/\s+/).filter(Boolean).length;
    const duration = scene.duration_seconds || 8;
    const maxWords = Math.floor(duration * WORDS_PER_SECOND);

    if (wordCount > maxWords) {
      const estimatedDuration = wordCount / WORDS_PER_SECOND;
      const overflow = estimatedDuration - duration;
      issues.push({
        scene: scene.scene_number,
        words: wordCount,
        maxWords,
        duration,
        overflow: Math.round(overflow * 10) / 10 // Round to 1 decimal
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

// Helper to validate motion type
function validateMotionType(motionType?: string): string {
  const validTypes = ['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down', 'parallax'];
  if (motionType && validTypes.includes(motionType)) {
    return motionType;
  }
  return 'static';
}

// Helper to map motion type to motion_bucket_id for I2V models
function getMotionBucketId(motionType?: string): number {
  const motionMap: Record<string, number> = {
    'static': 10,
    'zoom_in': 80,
    'zoom_out': 80,
    'pan_left': 100,
    'pan_right': 100,
    'pan_up': 90,
    'pan_down': 90,
    'parallax': 127
  };
  return motionMap[motionType || 'static'] || 50;
}

async function executeTextStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  supabaseUrl: string,
  customPrompt?: string,
  instructions?: string
): Promise<any> {
  console.log('Executing text stage...');
  if (customPrompt) {
    console.log(`Custom prompt provided: ${customPrompt.substring(0, 100)}...`);
  }
  if (instructions) {
    console.log(`Instructions provided: ${instructions.substring(0, 100)}...`);
  }

  return await retryWithBackoff(async () => {
    const openRouterKey = apiKeys.find(k => k.provider === 'openrouter');
    if (!openRouterKey && !apiKeys.find((k: { provider: string }) => k.provider === 'ollama')) {
      throw new Error('OpenRouter API key not configured');
    }

    const decryptedKey = openRouterKey ? await decryptApiKey(openRouterKey.key_encrypted) : '';
    const rawTextModelId = configuration?.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL;
    const llmTarget = await resolveStageTextLlm(apiKeys, rawTextModelId, decryptedKey);
    const modelId = llmTarget.modelId;
    const llmParams = configuration?.model_config?.text_llm?.parameters || {};

    // Get prompt - use custom prompt if provided, otherwise use original from generation_params
    let prompt = customPrompt || output.generation_params?.prompt || 'Generate content based on the provided context.';

    // Resolve date variables in the master prompt (e.g., {{current_year}} → 2026)
    prompt = resolveDateVariables(prompt);

    // If instructions are provided without a custom prompt, build a regeneration prompt
    if (instructions && instructions.trim() && !customPrompt) {
      const existingContent = getStageText(output.stage_data?.[stageId]) || '';
      prompt = `You are regenerating content based on user feedback.

ORIGINAL PROMPT/CONTEXT:
${output.generation_params?.prompt || ''}

CURRENT CONTENT TO MODIFY:
${existingContent}

USER INSTRUCTIONS FOR CHANGES:
${instructions}

Please regenerate the content following the user's instructions while maintaining the overall context, tone, and purpose. Output only the regenerated content without any additional commentary or explanation.`;
    }

    // Extract talking points
    const talkingPoints = extractTalkingPoints(output.generation_params);

    // === LONG ARTICLE DETECTION ===
    // Check if this is an article stage with outline that needs per-section generation
    const outlineData = output.stage_data?.outline;
    const isArticleStage = stageId === 'article' && outlineData;
    const outlineSections = outlineData?.sections || [];
    const needsPerSectionGeneration = isArticleStage &&
      (outlineSections.length >= 6 || talkingPoints.length >= 5);

    if (needsPerSectionGeneration) {
      console.log(`[executeTextStage] Long article detected (${outlineSections.length} sections, ${talkingPoints.length} talking points). Using per-section generation for story consistency.`);

      // Distribute talking points across sections (excluding intro and conclusion)
      const contentSections = outlineSections.filter((s: any) =>
        !s.heading?.toLowerCase().includes('introduction') &&
        !s.heading?.toLowerCase().includes('conclusion')
      );

      // Smart talking point distribution: cycle through them so later sections still get guidance
      const getTalkingPointsForSection = (sectionIndex: number): string[] => {
        if (talkingPoints.length === 0) return [];
        // Cycle through talking points so later sections still get guidance
        const pointIndex = sectionIndex % talkingPoints.length;
        return [
          talkingPoints[pointIndex],
          talkingPoints[(pointIndex + 1) % talkingPoints.length]
        ].filter((p, i, arr) => arr.indexOf(p) === i); // dedupe if list is short
      };

      // Generate each section sequentially for narrative flow
      let fullArticle = '';
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let totalCost = 0;

      // Maximum chars to pass for very long articles (safe limit for most models)
      const MAX_ARTICLE_CHARS = 100000;

      for (let i = 0; i < outlineSections.length; i++) {
        const section = outlineSections[i];
        const isIntro = section.heading?.toLowerCase().includes('introduction');
        const isConclusion = section.heading?.toLowerCase().includes('conclusion');

        // Determine which talking points this section should cover (using cycling)
        let sectionTalkingPoints: string[] = [];
        if (!isIntro && !isConclusion) {
          const contentIndex = contentSections.findIndex((s: any) => s.heading === section.heading);
          if (contentIndex >= 0) {
            sectionTalkingPoints = getTalkingPointsForSection(contentIndex);
          }
        }

        // Build context from previous sections - PASS FULL ARTICLE for continuity
        let previousContent: string;
        if (fullArticle.length === 0) {
          previousContent = '';
        } else if (fullArticle.length <= MAX_ARTICLE_CHARS) {
          // Pass full article
          previousContent = `\n\n=== ARTICLE SO FAR (read this carefully before continuing) ===\n${fullArticle}\n=== END OF EXISTING CONTENT ===`;
        } else {
          // Very long article - keep recent content in full
          const recentContent = fullArticle.slice(-50000); // Last ~50k chars
          previousContent = `\n\n=== ARTICLE SO FAR ===
[Earlier sections established the foundation]

RECENT CONTENT (read carefully):
...${recentContent}
=== END OF EXISTING CONTENT ===`;
        }

        const sectionPrompt = `Write the "${section.heading}" section of the article.

SECTION DETAILS:
- Heading: ${section.heading}
- Key points from outline: ${(section.key_points || []).join(', ')}
${sectionTalkingPoints.length > 0 ? `- Talking points to incorporate: ${sectionTalkingPoints.join('; ')}` : ''}

ARTICLE CONTEXT:
- Title: ${outlineData?.title || 'Untitled'}
- This is section ${i + 1} of ${outlineSections.length}
${isIntro ? '- This is the INTRODUCTION' : ''}
${isConclusion ? '- This is the CONCLUSION' : ''}
${previousContent}

CONTINUITY REQUIREMENTS:
- Read the existing content above before writing
- DO NOT repeat arguments, examples, or statistics already made
- Continue the established tone and style

Use ## for the section heading. Output ONLY the section content.`;

        // Get brand voice for system prompt if available
        const libraryElements = output.generation_params?.library_elements || {};
        const brandVoice = getBrandVoice(libraryElements);
        let sectionSystemPrompt = 'You are writing a section of a long-form article.';
        if (brandVoice?.tone) {
          sectionSystemPrompt += `\n\nTone: ${brandVoice.tone}`;
        }
        if (brandVoice?.style_guidelines) {
          sectionSystemPrompt += `\nStyle: ${brandVoice.style_guidelines}`;
        }

        // Use streaming to prevent edge function timeouts on slow models
        const sectionResult = await streamOpenRouterCompletion(llmTarget, {
          model: modelId,
          messages: [
            { role: 'system', content: sectionSystemPrompt },
            { role: 'user', content: sectionPrompt }
          ],
          temperature: 0.7
        }, supabaseUrl);

        let sectionContent = sectionResult.content;
        sectionContent = fixAITypography(sectionContent);

        fullArticle += (fullArticle.length > 0 ? '\n\n' : '') + sectionContent;

        // Accumulate usage
        if (sectionResult.usage) {
          totalUsage.prompt_tokens += sectionResult.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += sectionResult.usage.completion_tokens || 0;
          totalUsage.total_tokens += sectionResult.usage.total_tokens || 0;
        }
        totalCost += sectionResult.cost;

        console.log(`[executeTextStage] Section ${i + 1}/${outlineSections.length} "${section.heading}" complete`);
      }

      console.log(`[executeTextStage] Long article complete (streamed). ${outlineSections.length} sections, ${fullArticle.split(/\s+/).length} words. Cost: $${totalCost.toFixed(4)}`);

      return {
        content: fullArticle,
        model: modelId,
        usage: totalUsage,
        cost: totalCost
      };
    }

    // === LONG VIDEO SCRIPT DETECTION ===
    // For video_script pipeline with many talking points, generate in sections to prevent repetition
    const pipelineId = output.pipeline || '';
    const isVideoScript = pipelineId === 'video_script' || stageId === 'script';
    const needsScriptSectioning = isVideoScript && talkingPoints.length >= 5;

    if (needsScriptSectioning) {
      console.log(`[executeTextStage] Long video script detected (${talkingPoints.length} talking points). Using per-section generation for story consistency.`);

      // Generate script in sections: intro, one section per talking point, conclusion
      const sections: Array<{ type: string; name: string; talkingPoint?: string }> = [
        { type: 'intro', name: 'Hook & Introduction' },
        ...talkingPoints.map((tp, i) => ({ type: 'body', name: `Section ${i + 1}`, talkingPoint: tp })),
        { type: 'conclusion', name: 'Conclusion & CTA' }
      ];

      let fullScript = '';
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let totalCost = 0;
      const MAX_SCRIPT_CHARS = 100000;

      // Get context
      const ideaContext = output.generation_params?.idea_context || '';
      const libraryElements = output.generation_params?.library_elements || {};
      const storyContext = buildStoryContext(libraryElements, ideaContext);

      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const isIntro = section.type === 'intro';
        const isConclusion = section.type === 'conclusion';

        // Build context from previous sections - PASS FULL SCRIPT for continuity
        let previousContent: string;
        if (fullScript.length === 0) {
          previousContent = '';
        } else if (fullScript.length <= MAX_SCRIPT_CHARS) {
          previousContent = `\n\n=== SCRIPT SO FAR (read carefully before continuing) ===\n${fullScript}\n=== END OF EXISTING CONTENT ===`;
        } else {
          const recentContent = fullScript.slice(-50000);
          previousContent = `\n\n=== SCRIPT SO FAR ===
[Earlier sections established the foundation]

RECENT CONTENT (read carefully):
...${recentContent}
=== END OF EXISTING CONTENT ===`;
        }

        const sectionPrompt = `Write the "${section.name}" section of this video script.

SECTION DETAILS:
- Section: ${section.name} (${i + 1} of ${sections.length})
${section.talkingPoint ? `- Key talking point to cover: ${section.talkingPoint}` : ''}
${isIntro ? '- This is the INTRODUCTION' : ''}
${isConclusion ? '- This is the CONCLUSION' : ''}

STORY CONTEXT:
${storyContext}

ORIGINAL BRIEF:
${prompt}
${previousContent}

CONTINUITY REQUIREMENTS:
- Read the existing script above CAREFULLY before writing
- DO NOT repeat arguments, examples, statistics, or phrases already used
- Each section must advance the narrative with NEW information
- Continue the tone and style established in previous sections

Output ONLY the section content, ready to be spoken. No formatting markers or section headers.`;

        // Build system prompt from brand voice only
        const brandVoice = getBrandVoice(libraryElements);
        let systemPromptContent = `You are writing a section of a video script.`;

        if (brandVoice?.tone) {
          systemPromptContent += `\n\nTONE: ${brandVoice.tone}`;
        }
        if (brandVoice?.style_guidelines) {
          systemPromptContent += `\nSTYLE: ${brandVoice.style_guidelines}`;
        }

        // Use streaming to prevent edge function timeouts on slow models
        const sectionResult = await streamOpenRouterCompletion(llmTarget, {
          model: modelId,
          messages: [
            { role: 'system', content: systemPromptContent },
            { role: 'user', content: sectionPrompt }
          ],
          temperature: 0.7
        }, supabaseUrl);

        let sectionContent = sectionResult.content;
        sectionContent = fixAITypography(sectionContent);

        fullScript += (fullScript.length > 0 ? '\n\n' : '') + sectionContent;

        if (sectionResult.usage) {
          totalUsage.prompt_tokens += sectionResult.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += sectionResult.usage.completion_tokens || 0;
          totalUsage.total_tokens += sectionResult.usage.total_tokens || 0;
        }
        totalCost += sectionResult.cost;

        console.log(`[executeTextStage] Script section ${i + 1}/${sections.length} "${section.name}" complete`);
      }

      console.log(`[executeTextStage] Long video script complete (streamed). ${sections.length} sections, ${fullScript.split(/\s+/).length} words. Cost: $${totalCost.toFixed(4)}`);

      return {
        content: fullScript,
        model: modelId,
        usage: totalUsage,
        cost: totalCost
      };
    }

    // === STANDARD GENERATION (short articles and other text content) ===
    // The blueprint prompt is the prompt. Talking points are only added for prompts
    // that don't carry them already (e.g. via {{ai_talking_points}}), never twice.
    if (talkingPoints.length > 0 && !promptCarriesTalkingPoints(prompt, talkingPoints)) {
      const talkingPointsSection = `\n\n## KEY TALKING POINTS TO INCORPORATE\nMake sure your content addresses these key points:\n${talkingPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n`;
      prompt = prompt + talkingPointsSection;
      console.log(`[executeTextStage] Injected ${talkingPoints.length} talking points into prompt`);
    }

    // === DURATION CONSTRAINT FOR OUTLINE STAGE ===
    // For storyboard_video_longform outline stage, constrain narration length to target duration
    const videoConfig = output.generation_params?.video_config;
    const isOutlineStage = stageId === 'outline';
    if (isOutlineStage && videoConfig?.totalDuration) {
      const targetDuration = videoConfig.totalDuration;
      // Estimate: ~2.5 words per second for natural speaking pace
      const targetWordCount = Math.round(targetDuration * 2.5);
      const durationConstraint = `\n\n## VIDEO DURATION CONSTRAINT (STRICT)
This narration will be converted to voiceover for a ${targetDuration} second video.
STRICTLY limit your narration to ${targetWordCount} words MAXIMUM. DO NOT exceed ${targetWordCount} words under any circumstances.
Count your words carefully. The voiceover must fit within ${targetDuration} seconds at ~2.5 words/second.
${targetDuration <= 30 ? 'This is a SHORT video. Be concise and punchy — every word must earn its place.' : ''}
${targetDuration >= 120 ? 'You have time to develop the narrative fully.' : ''}`;
      prompt = prompt + durationConstraint;
      console.log(`[executeTextStage] Added duration constraint: ${targetDuration}s, ~${targetWordCount} words`);
    }

    // Build semantic input for payload builder
    const semanticInput: UserInput = {
      main_prompt: prompt,
      temperature: llmParams.temperature,
      top_p: llmParams.top_p,
      max_tokens: llmParams.max_tokens,
      response_format: llmParams.response_format
    };

    const capabilities = await ensureModelSchema(supabase, 'openrouter', modelId, 'text_llm');

    // System message to ensure clean text output without markdown formatting for all pipelines
    const cleanOutputSystemMessage = {
      role: 'system',
      content: `You are generating content that will be used directly without editing.

CRITICAL OUTPUT RULES:
- Output ONLY the requested content itself - nothing else
- Do NOT use any markdown formatting (no **, __, #, >, \`, etc.)
- Do NOT include headers, titles, or labels like "Here's your content:" or "Output:"
- Do NOT add explanatory notes, tips, or meta-commentary
- Do NOT wrap the output in quotes
- The output must be ready to use immediately as-is

Start your response with the actual content immediately.`
    };

    let requestBody: Record<string, any>;
    if (capabilities) {
      const result = buildPayload(capabilities, semanticInput);
      if (result.warnings.length > 0) {
        console.warn('Payload builder warnings:', result.warnings);
      }
      // OpenRouter expects messages array, payload builder should have created it
      requestBody = { model: modelId, ...result.payload };

      // Prepend system message to ensure clean output
      if (Array.isArray(requestBody.messages)) {
        requestBody.messages = [cleanOutputSystemMessage, ...requestBody.messages];
      }
    } else {
      console.warn(`Schema not available for openrouter/${modelId}, using basic parameters`);
      requestBody = { model: modelId, messages: [cleanOutputSystemMessage, { role: 'user', content: prompt }] };
    }

    console.log(`Built LLM payload:`, JSON.stringify(requestBody, null, 2));

    // Use streaming to prevent edge function timeouts on slow models
    const streamResult = await streamOpenRouterCompletion(llmTarget, requestBody, supabaseUrl);
    let content = streamResult.content;
    const cost = streamResult.cost;

    console.log(`Text generation complete (streamed). Tokens: ${streamResult.usage?.total_tokens}, Cost: $${cost.toFixed(4)}`);

    // First, fix AI typography issues in the raw content (works on both plain text and JSON strings)
    // This fixes em-dashes, smart quotes, etc. inside JSON string values
    content = fixAITypography(content);

    // Extract JSON from code blocks if present (LLMs often wrap JSON in ```json...```)
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      const extractedContent = codeBlockMatch[1].trim();
      // Check if extracted content is JSON
      if (extractedContent.startsWith('{') || extractedContent.startsWith('[')) {
        console.log('Extracted JSON from code block');
        content = extractedContent;
      }
    }

    // Then clean markdown from text output to ensure content is ready for direct use
    // Skip markdown cleaning for JSON responses to preserve structure
    const isJsonResponse = content.trim().startsWith('{') || content.trim().startsWith('[');
    if (!isJsonResponse) {
      const originalLength = content.length;
      content = cleanTextOutput(content);
      if (originalLength !== content.length) {
        console.log(`Cleaned text output: ${originalLength} -> ${content.length} chars`);
      }
    } else {
      console.log('JSON response detected, skipping markdown cleanup to preserve structure');
    }

    return {
      content,
      model: streamResult.model,
      usage: streamResult.usage,
      cost
    };
  }, 'Text generation');
}

/**
 * Execute image prompt stage - generates a detailed image generation prompt
 * based on the caption and library elements (brand voice, character, product)
 *
 * If the blueprint has an image_prompt template, use that with variable substitution
 * instead of auto-generating one.
 */
/**
 * Image-prompt writers ask for ~150 words, but reasoning models (deepseek v4,
 * qwen3, o-series…) spend max_tokens on thinking first. A 300-token cap came
 * back empty, the empty prompt was "approved", and the image model was then
 * handed the post's copywriting brief instead (job b3d90b4d, 2026-09-26).
 */
const PROMPT_WRITER_MAX_TOKENS = 2000;

/** The model's answer, or an error that says why there wasn't one. */
function requireLlmText(result: any, what: string): string {
  const content = String(result?.choices?.[0]?.message?.content ?? '').trim();
  if (content) return content;
  const finish = result?.choices?.[0]?.finish_reason;
  throw new Error(
    finish === 'length'
      ? `${what}: the model used its whole token budget before answering (it reasons first). Try again, or pick a text model that doesn't reason.`
      : `${what}: the model returned an empty answer.`,
  );
}

async function executeImagePromptStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  supabaseUrl: string
): Promise<any> {
  console.log('Executing image prompt stage...');

  // Get caption from the previous stage
  const captionStageData = output.stage_data?.caption;
  const caption = getStageText(captionStageData);

  if (!caption) {
    throw new Error('Caption content not found from previous stage');
  }

  // Check if blueprint has a custom image_prompt template
  const imagePromptTemplate = configuration?.image_prompt || output.generation_params?.image_prompt;

  if (imagePromptTemplate) {
    console.log('Using custom image_prompt template from blueprint');

    // Get library elements for variable substitution
    const libraryElements = configuration?.library_elements || output.generation_params?.library_elements || {};

    // Build context for variable substitution (includes AI analysis from idea)
    // Check generation_params.idea_ai_analysis first (where it's actually stored), then fallback to content_ideas.ai_analysis
    const ideaAiAnalysis = output.generation_params?.idea_ai_analysis || output.content_ideas?.ai_analysis;
    const context = buildPromptContext(output, configuration, libraryElements, caption, ideaAiAnalysis);

    // Substitute variables in the template (case-insensitive for consistency)
    let imagePrompt = imagePromptTemplate;
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      imagePrompt = imagePrompt.replace(regex, String(value || ''));
    }

    // Clean up any unreplaced variables
    imagePrompt = imagePrompt.replace(/\{\{[^}]+\}\}/g, '').trim();
    imagePrompt = withPresetLook(imagePrompt, output);
    imagePrompt = withCanvasFit(imagePrompt, configuration, output);
    const refConfig = output.generation_params?.model_config || configuration?.model_config;
    const templateRefs = hasRoleReferences(refConfig) ? resolveRoleReferences(refConfig, libraryElements, { required: true }) : [];
    imagePrompt = withReferenceRequirements(imagePrompt, templateRefs);

    console.log(`Custom image prompt generated (${imagePrompt.length} chars): ${imagePrompt.slice(0, 100)}...`);

    return {
      content: imagePrompt,
      model: 'template',
      usage: null,
      cost: 0
    };
  }

  // Autopilot pieces: the last images' prompts, so this picture differs.
  const recentPieces = await loadRecentPieces(supabase, output);

  // Fall back to auto-generating image prompt using LLM
  return await retryWithBackoff(async () => {
    const openRouterKey = apiKeys.find(k => k.provider === 'openrouter');
    if (!openRouterKey && !apiKeys.find((k: { provider: string }) => k.provider === 'ollama')) {
      throw new Error('OpenRouter API key not configured');
    }

    const decryptedKey = openRouterKey ? await decryptApiKey(openRouterKey.key_encrypted) : '';
    const rawTextModelId = configuration?.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL;
    const llmTarget = await resolveStageTextLlm(apiKeys, rawTextModelId, decryptedKey);
    const modelId = llmTarget.modelId;
    const llmParams = configuration?.model_config?.text_llm?.parameters || {};

    // Get library elements for visual context
    const libraryElements = configuration?.library_elements || output.generation_params?.library_elements || {};

    // Build visual context from library elements
    const visualContext = buildImagePromptVisualContext(libraryElements);

    // References the image model will get. The writer gets the same labelled
    // pictures attached, so it writes the scene in the style reference's real
    // look instead of inventing one (a detailed description in another style
    // beats the reference at the image model). A writer that can't take images
    // gets the look described in words instead.
    const promptRefConfig = output.generation_params?.model_config || configuration?.model_config;
    const writerRefs = hasRoleReferences(promptRefConfig) ? resolveRoleReferences(promptRefConfig, libraryElements) : [];
    const hasStyleRef = writerRefs.some((r) => r.role === 'style');
    // "Recreate this image": the plan lists changes to the base image instead of a new scene.
    const hasRemake = writerRefs.some((r) => r.role === 'remake');
    const hasPersonRef = writerRefs.some((r) => r.role === 'person');

    // Blueprint Studio "Look → Image style" (e.g. quote card, editorial photo).
    // The piece's own model_config first: it carries the look picked for it.
    const styleDirection = String(
      output.generation_params?.model_config?.image_style_direction
        || configuration?.model_config?.image_style_direction
        || '',
    ).trim();
    const recentImages = hasRemake ? '' : recentImagesBrief(recentPieces, { keepStyle: hasStyleRef || !!styleDirection });

    const buildRemakePrompt = (referenceBrief: string) => `Based on this social media caption:
"${caption}"

The image will be a remake of the BASE reference image. Everything about it stays: layout, framing, pose, lighting, colours, typography and design. Write ONLY what changes for this post, as one instruction that starts with "Recreate the base image exactly, with these changes:".

Include:
- the new on-image headline text for this post (at most 6 words, in quotes), if the base image has headline text
- what any screen, document, product or props should show so they fit this post
- ${hasPersonRef ? 'replace the person with the person from the person reference (their face, hair and identity), keeping the same pose and expression' : 'keep the person exactly as they are'}
${referenceBrief ? `\n${referenceBrief}\n` : ''}
Do not describe a new scene or a different style. Output only the instruction, at most 120 words, no explanations.`;

    const buildWriterPrompt = (referenceBrief: string) => hasRemake ? buildRemakePrompt(referenceBrief) : `Based on this social media caption:
"${caption}"

Generate a single, detailed image generation prompt (max 150 words) that would create an engaging visual for this post.

${hasStyleRef
  ? `VISUAL STYLE: set by the style reference (see below). Brand notes, only where they don't conflict with it:\n${visualContext}`
  : `VISUAL STYLE REQUIREMENTS:\n${visualContext}`}
${styleDirection && !hasStyleRef ? `\nIMAGE STYLE (follow this closely; it overrides generic style choices):\n${styleDirection}\n` : ''}${referenceBrief ? `\n${referenceBrief}\n` : ''}${recentImages}
IMPORTANT INSTRUCTIONS:
- Output ONLY the image prompt itself, starting with "A..." or "An..."
- Do NOT provide multiple options or alternatives
- Do NOT include any explanations or meta-text
- ${hasStyleRef ? "Focus on: subject and composition, told in the style reference's look" : 'Focus on: composition, subject, lighting, color palette, mood, and style'}
- Make it specific and detailed enough for an AI image generator
- Ensure brand/character consistency based on the visual requirements above`;

    const capabilities = await ensureModelSchema(supabase, 'openrouter', modelId, 'text_llm');

    const buildRequestBody = (prompt: string, refParts: ContentPart[]): Record<string, any> => {
      const semanticInput: UserInput = {
        main_prompt: prompt,
        temperature: llmParams.temperature ?? 0.7,
        top_p: llmParams.top_p,
        max_tokens: PROMPT_WRITER_MAX_TOKENS
      };
      let body: Record<string, any>;
      if (capabilities) {
        const built = buildPayload(capabilities, semanticInput);
        if (built.warnings.length > 0) console.warn('Payload builder warnings:', built.warnings);
        body = { model: modelId, ...built.payload };
      } else {
        console.warn(`Schema not available for openrouter/${modelId}, using basic parameters`);
        body = { model: modelId, messages: [{ role: 'user', content: prompt }] };
      }
      if (refParts.length) {
        // Pictures first, then the instructions, in the user turn.
        const messages: any[] = Array.isArray(body.messages) ? [...body.messages] : [];
        const lastUser = messages.map((m) => m?.role).lastIndexOf('user');
        const text = lastUser >= 0 && typeof messages[lastUser].content === 'string' ? messages[lastUser].content : prompt;
        const content = [...refParts, { type: 'text', text }];
        if (lastUser >= 0) messages[lastUser] = { ...messages[lastUser], content };
        else messages.push({ role: 'user', content });
        body.messages = messages;
        delete body.prompt;
      }
      return body;
    };

    const callWriter = (body: Record<string, any>) => fetch(llmTarget.url, {
      method: 'POST',
      headers: {
        ...llmTarget.headers,
        'HTTP-Referer': supabaseUrl,
        'X-Title': 'ContentAI Studio'
      },
      body: JSON.stringify(body)
    });

    console.log(`Generating image prompt based on caption (${caption.length} chars)`);

    let response: Response | null = null;
    let referencesSeen = false;
    let styleReference = '';

    // 1. With the reference pictures attached.
    if (writerRefs.length && llmTarget.provider === 'openrouter') {
      const { parts, imageCount } = await buildReferenceParts(writerRefs);
      if (imageCount > 0) {
        const attempt = await callWriter(buildRequestBody(buildWriterPrompt(referencesBriefForPromptWriter(writerRefs, '', { imagesAttached: true })), parts));
        if (attempt.ok) {
          response = attempt;
          referencesSeen = true;
          console.log(`[image_prompt] Writer saw ${imageCount} reference image(s)`);
        } else {
          const errorBody = await attempt.text();
          // Models without image input: OpenRouter answers 404 "No endpoints found that support image input" (or a 400).
          if ((attempt.status === 404 || attempt.status === 400) && /image|modalit|vision|multimodal/i.test(errorBody)) {
            console.warn(`[image_prompt] ${modelId} can't take images; describing the references in words instead`);
          } else {
            console.error(`OpenRouter API error (${attempt.status}):`, errorBody);
            throw new Error(`OpenRouter API error ${attempt.status}: ${errorBody}`);
          }
        }
      }
    }

    // 2. Text only: the style reference / base image described in words.
    if (!response) {
      if (hasStyleRef || hasRemake) {
        // A look saved with its description needs no vision call (no base image to describe).
        const savedLook = !hasRemake ? String(promptRefConfig?.look_style_description || '').trim() : '';
        styleReference = savedLook || await describeStyleReference(writerRefs, decryptedKey);
        console.log(`[image_prompt] Style reference described: ${styleReference ? styleReference.slice(0, 160) : '(no description)'}`);
      }
      const brief = writerRefs.length ? referencesBriefForPromptWriter(writerRefs, styleReference) : '';
      response = await callWriter(buildRequestBody(buildWriterPrompt(brief), []));
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`OpenRouter API error (${response.status}):`, errorBody);
        throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
      }
    }

    const result = await response.json();
    // Throws on an empty answer so retryWithBackoff tries again, and the stage
    // fails with a reason instead of passing an empty prompt downstream.
    let content = requireLlmText(result, 'Image prompt');
    const cost = calculateOpenRouterCost(result.usage, modelId);

    // Clean up the image prompt (remove any preamble or multiple options)
    content = cleanupImagePrompt(content);
    if (!content.trim()) throw new Error('Image prompt: nothing usable was left after cleanup.');

    console.log(`Image prompt generation complete. Prompt: ${content.slice(0, 100)}...`);

    return {
      content,
      model: result.model,
      usage: result.usage,
      cost,
      // The image stage skips describing the style again when the writer saw it,
      // and reuses the words when it didn't.
      ...(referencesSeen ? { references_seen: true } : {}),
      ...(styleReference ? { style_reference: styleReference } : {}),
    };
  }, 'Image prompt generation');
}

/**
 * Build visual context from library elements for image prompt generation (social media)
 */
function buildImagePromptVisualContext(libraryElements: Record<string, any>): string {
  const parts: string[] = [];

  // Brand Voice visual style
  const bv = getBrandVoice(libraryElements);
  if (bv) {
    if (bv.visual_style) parts.push(`Brand Visual Style: ${bv.visual_style}`);
    if (bv.style_guidelines) parts.push(`Style Guidelines: ${bv.style_guidelines}`);
    if (bv.tone) parts.push(`Tone: ${bv.tone}`);
  }

  // Character visual details
  const char = Array.isArray(libraryElements.character)
    ? libraryElements.character[0]
    : libraryElements.character;
  if (char) {
    if (char.name) parts.push(`Character Name: ${char.name}`);
    if (char.visual_style) parts.push(`Character Style: ${char.visual_style}`);
    if (char.physical_traits) parts.push(`Character Appearance: ${char.physical_traits}`);
    if (char.typical_clothing) parts.push(`Clothing: ${char.typical_clothing}`);
  }

  // Product visual context
  const prod = Array.isArray(libraryElements.product)
    ? libraryElements.product[0]
    : libraryElements.product;
  if (prod) {
    if (prod.name) parts.push(`Product: ${prod.name}`);
    if (prod.visual_style) parts.push(`Product Style: ${prod.visual_style}`);
  }

  return parts.length > 0
    ? parts.join('\n')
    : 'Professional and engaging visual style appropriate for social media';
}

/**
 * Build context for variable substitution in image_prompt templates
 * Supports variables: {{idea}}, {{caption}}, {{context}}, {{brand}}, {{character}}, {{product}}, etc.
 * Also includes reference image URLs for products and characters.
 */
function buildPromptContext(
  output: any,
  configuration: any,
  libraryElements: Record<string, any>,
  caption: string,
  ideaAiAnalysis?: any
): Record<string, string> {
  const context: Record<string, string> = {};

  // Date variables — resolved at generation time
  Object.assign(context, getDateVariables());

  // Get image_inputs from generation_params (selected reference images from wizard)
  const imageInputs = output.generation_params?.image_inputs || {};

  // Get slot_values from generation_params (all template variables from idea)
  const slotValues = output.generation_params?.slot_values || {};

  // Core content variables - start with slot_values as base
  for (const [key, value] of Object.entries(slotValues)) {
    if (typeof value === 'string') {
      context[key] = value;
    }
  }

  // Override/add specific variables
  context.caption = caption;
  // idea_context is stored as a string directly, not as an object
  const ideaContext = output.generation_params?.idea_context || '';
  context.idea = slotValues.idea || ideaContext;
  context.context = slotValues.context || ideaContext;
  context.idea_context = ideaContext;
  context.title = slotValues.title || ideaContext;
  context.topic = slotValues.topic || ideaContext;

  // Brand voice variables
  const bvContext = getBrandVoice(libraryElements);
  if (bvContext) {
    context.brand = bvContext.name || '';
    context.brand_name = bvContext.name || '';
    context.brand_voice = bvContext.description || bvContext.voice_characteristics || '';
    context.brand_visual_style = bvContext.visual_style || '';
    context.brand_tone = bvContext.tone || '';
    context.brand_style_guidelines = bvContext.style_guidelines || '';
    // Visual Identity
    context.brand_visual_template = bvContext.visual_template || '';
    context.brand_color_palette = typeof bvContext.color_palette === 'object'
      ? JSON.stringify(bvContext.color_palette)
      : (bvContext.color_palette || '');
    context.brand_font_style = bvContext.font_style || '';
    context.brand_accent_style = bvContext.accent_style || '';
    context.brand_visual_style_description = bvContext.visual_style_description || '';
    context.brand_mood_keywords = Array.isArray(bvContext.mood_keywords)
      ? bvContext.mood_keywords.join(', ')
      : (bvContext.mood_keywords || '');
  }

  // Character variables (including reference images)
  // Support both 'library_characters' (from wizard) and 'character' (legacy) keys
  const charData = libraryElements.library_characters || libraryElements.character;
  const char = Array.isArray(charData) ? charData[0] : charData;
  if (char) {
    context.character = char.name || '';
    context.character_name = char.name || '';
    context.character_description = char.description || '';
    context.character_visual_style = char.visual_style || '';
    context.character_physical_traits = char.physical_traits || '';
    context.character_clothing = char.typical_clothing || '';
    context.character_personality = char.personality || '';

    // Reference images - from wizard selection first, then fall back to character data
    const charRefImages = imageInputs?.library_characters || imageInputs?.character || char.reference_images || [];
    if (charRefImages.length > 0) {
      context.character_reference_image = charRefImages[0];
      context.character_reference_images = charRefImages.join(', ');
    }
  }

  // Product variables (including images)
  // Support both 'library_products' (from wizard) and 'product' (legacy) keys
  const prodData = libraryElements.library_products || libraryElements.product;
  const prod = Array.isArray(prodData) ? prodData[0] : prodData;
  if (prod) {
    context.product = prod.name || '';
    context.product_name = prod.name || '';
    context.product_description = prod.description || '';
    context.product_visual_style = prod.visual_style || '';
    context.product_benefits = Array.isArray(prod.key_benefits) ? prod.key_benefits.join(', ') : '';
    context.product_features = Array.isArray(prod.features) ? prod.features.join(', ') : '';

    // Product images - from wizard selection first, then fall back to product data
    const productImages = imageInputs?.library_products || imageInputs?.product || prod.images || [];
    if (productImages.length > 0) {
      context.product_image = productImages[0];
      context.product_images = productImages.join(', ');
    }
  }

  // ICP variables
  // Support both 'library_icps' (from wizard) and 'icp' (legacy) keys
  const icpData = libraryElements.library_icps || libraryElements.icp;
  const icp = Array.isArray(icpData) ? icpData[0] : icpData;
  if (icp) {
    context.icp = icp.name || '';
    context.icp_name = icp.name || '';
    context.target_audience = icp.description || icp.demographics || '';
    context.audience_pain_points = Array.isArray(icp.pain_points) ? icp.pain_points.join(', ') : '';
  }

  // AI Insights variables - populated from idea's ai_analysis
  // Parse AI analysis if it's a string
  const parsedAiAnalysis = typeof ideaAiAnalysis === 'string'
    ? JSON.parse(ideaAiAnalysis)
    : ideaAiAnalysis;

  if (parsedAiAnalysis) {
    // All hooks as formatted text
    const hooks = parsedAiAnalysis.hooks || [];
    if (hooks.length > 0) {
      context.ai_hooks = hooks.map((h: any, i: number) => `${i + 1}. "${h.text}" (${h.type})`).join('\n');
      context.ai_hooks_list = hooks.map((h: any) => h.text).join(' | ');
      // First hook as default
      context.ai_hook = hooks[0]?.text || '';
      context.ai_hook_type = hooks[0]?.type || '';
    }

    // All CTAs as formatted text
    const ctas = parsedAiAnalysis.ctas || [];
    if (ctas.length > 0) {
      context.ai_ctas = ctas.map((c: any, i: number) => `${i + 1}. "${c.text}" (${c.placement || c.type})`).join('\n');
      context.ai_ctas_list = ctas.map((c: any) => c.text).join(' | ');
      // First CTA as default
      context.ai_cta = ctas[0]?.text || '';
      context.ai_cta_placement = ctas[0]?.placement || '';
      context.ai_cta_type = ctas[0]?.type || '';
    }

    // Talking points
    const talkingPoints = parsedAiAnalysis.key_talking_points || parsedAiAnalysis.talking_points || [];
    if (talkingPoints.length > 0) {
      context.ai_talking_points = talkingPoints.map((p: string) => `• ${p}`).join('\n');
      context.ai_talking_points_list = talkingPoints.join(', ');
    }

    // Script structure
    const ss = parsedAiAnalysis.script_structure;
    if (ss) {
      context.ai_script_opening = ss.opening || '';
      context.ai_script_body = ss.body || '';
      context.ai_script_climax = ss.climax || '';
      context.ai_script_closing = ss.closing || '';
      const structureParts = [];
      if (ss.opening) structureParts.push(`Opening: ${ss.opening}`);
      if (ss.body) structureParts.push(`Body: ${ss.body}`);
      if (ss.climax) structureParts.push(`Climax: ${ss.climax}`);
      if (ss.closing) structureParts.push(`Closing: ${ss.closing}`);
      context.ai_script_structure = structureParts.join('\n');
    }

    // Engagement drivers
    const engagementDrivers = parsedAiAnalysis.engagement_drivers || [];
    if (engagementDrivers.length > 0) {
      context.ai_engagement_drivers = engagementDrivers.map((d: string) => `• ${d}`).join('\n');
      context.ai_engagement_drivers_list = engagementDrivers.join(', ');
    }
  }

  // Override with selected insights if this is a variation (specific hook/CTA selected for this output)
  const selectedInsights = output.generation_params?.selected_ai_insights;
  if (selectedInsights) {
    // Override hook if selected
    if (selectedInsights.hook) {
      context.ai_hook = selectedInsights.hook.text || '';
      context.ai_hook_type = selectedInsights.hook.type || '';
    }

    // Override CTA if selected
    if (selectedInsights.cta) {
      context.ai_cta = selectedInsights.cta.text || '';
      context.ai_cta_placement = selectedInsights.cta.placement || '';
      context.ai_cta_type = selectedInsights.cta.type || '';
    }

    // Override talking points if provided
    if (selectedInsights.talking_points?.length) {
      context.ai_talking_points = selectedInsights.talking_points.map((p: string) => `• ${p}`).join('\n');
      context.ai_talking_points_list = selectedInsights.talking_points.join(', ');
    }

    // Single talking point for variations
    if (selectedInsights.talking_point) {
      context.ai_talking_point = selectedInsights.talking_point.text || '';
    }

    // Override script structure if provided
    if (selectedInsights.script_structure) {
      const ss = selectedInsights.script_structure;
      context.ai_script_structure = [
        ss.opening ? `Opening: ${ss.opening}` : '',
        ss.body ? `Body: ${ss.body}` : '',
        ss.climax ? `Climax: ${ss.climax}` : '',
        ss.closing ? `Closing: ${ss.closing}` : ''
      ].filter(Boolean).join('\n\n');
      context.ai_script_opening = ss.opening || '';
      context.ai_script_body = ss.body || '';
      context.ai_script_climax = ss.climax || '';
      context.ai_script_closing = ss.closing || '';
    }

    // Override engagement drivers if provided
    if (selectedInsights.engagement_drivers?.length) {
      context.ai_engagement_drivers = selectedInsights.engagement_drivers.map((d: string) => `• ${d}`).join('\n');
      context.ai_engagement_drivers_list = selectedInsights.engagement_drivers.join(', ');
    }
  }

  return context;
}

/**
 * Clean up an image prompt that may contain multiple options or explanatory text
 */
function cleanupImagePrompt(rawPrompt: string): string {
  let prompt = rawPrompt.trim();

  // If it contains multiple options, extract just the first quoted prompt
  if (prompt.includes('Option 1') || prompt.includes('**Option') || prompt.includes('Here are')) {
    const firstPromptMatch = prompt.match(/"([^"]{30,})"/);
    if (firstPromptMatch) {
      return firstPromptMatch[1].trim();
    }
  }

  // Remove common prefixes that indicate explanatory text
  prompt = prompt
    .replace(/^Here are.*?:\s*/i, '')
    .replace(/^\*\*Option \d.*?\*\*:?\s*/i, '')
    .replace(/^Option \d.*?:\s*/i, '')
    .replace(/^Image prompt:?\s*/i, '')
    .trim();

  // If it starts with a quote, extract the quoted content
  if (prompt.startsWith('"') && prompt.includes('"', 1)) {
    const quoted = prompt.match(/^"([^"]+)"/);
    if (quoted) {
      return quoted[1].trim();
    }
  }

  return prompt;
}

async function executeTTSStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('Executing TTS stage...');
  
  return await retryWithBackoff(async () => {
    const elevenLabsKey = apiKeys.find(k => k.provider === 'elevenlabs');
    if (!elevenLabsKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const decryptedKey = await decryptApiKey(elevenLabsKey.key_encrypted);
    
    // Get text content from input stage
    const inputStage = stageConfig.inputFrom?.[0];
    let scriptContent = '';
    
    if (!inputStage) {
      throw new Error('No input stage specified for TTS');
    }
    
    const inputStageData = output.stage_data?.[inputStage];
    
    if (!inputStageData) {
      throw new Error(`Input stage data not found: ${inputStage}`);
    }
    
    // Handle different input types
    if (inputStage === 'scenes' && inputStageData.scenes) {
      // Enhanced scenes pipeline - extract narration from each scene
      const scenes = inputStageData.scenes || [];
      // Only use ready/approved scenes and extract the narration field (exclude failed/excluded)
      const approvedScenes = scenes.filter((s: any) =>
        (s.status === 'ready' || s.status === 'approved' || !s.status) &&
        s.status !== 'excluded' && s.status !== 'failed'
      );
      if (approvedScenes.length === 0) {
        throw new Error('No ready scenes found. Please wait for scenes to complete before generating voiceover.');
      }
      scriptContent = approvedScenes
        .sort((a: any, b: any) => a.scene_number - b.scene_number)
        .map((scene: any) => scene.narration || scene.prompt)
        .join('\n\n');

      console.log(`Generated voiceover script from ${approvedScenes.length} enhanced scene narrations`);
    } else if (inputStageData.content) {
      // Direct script content
      scriptContent = inputStageData.content;
    } else {
      throw new Error(`No valid text content found in stage: ${inputStage}`);
    }
    
    if (!scriptContent || scriptContent.trim().length === 0) {
      throw new Error('Script content is empty');
    }

    // Get library elements and check for character voice
    const libraryElements = output.generation_params?.library_elements || {};
    const characterVoiceId = getVoiceIdFromCharacter(libraryElements);

    // Get TTS configuration - priority: character voice > blueprint parameters.voice_id > blueprint voice_id > default
    const ttsConfig = configuration?.model_config?.tts || {};
    const blueprintVoiceId = ttsConfig.parameters?.voice_id || ttsConfig.voice_id;
    const voiceId = characterVoiceId || blueprintVoiceId || 'EXAVITQu4vr4xnSDxMaL';
    const ttsModelId = ttsConfig.model_id || 'eleven_multilingual_v2';
    const ttsParams = ttsConfig.parameters || {};

    console.log(`Generating TTS with voice ${voiceId}${characterVoiceId ? ' (from character)' : blueprintVoiceId ? ' (from blueprint)' : ' (default)'}, model ${ttsModelId}, ${scriptContent.length} characters`);

    // Validate voice ID exists before attempting TTS (fail fast with actionable error)
    const voiceValidation = await validateElevenLabsVoice(decryptedKey, voiceId);
    if (!voiceValidation.valid) {
      throw new Error(voiceValidation.error);
    }
    console.log(`[executeTTSStage] Voice validated: ${voiceValidation.voiceName}`);

    // Check ElevenLabs subscription status before attempting TTS
    // ElevenLabs returns character_count = USED, character_limit = total ceiling.
    // Remaining = character_limit - character_count. Don't treat character_count as remaining.
    const subscriptionInfo = await checkElevenLabsSubscription(decryptedKey);
    const characterCount = scriptContent.length;
    const remaining = (subscriptionInfo.character_limit !== null && subscriptionInfo.character_count !== null)
      ? subscriptionInfo.character_limit - subscriptionInfo.character_count
      : null;
    console.log(`[executeTTSStage] ElevenLabs subscription: tier=${subscriptionInfo.tier}, used=${subscriptionInfo.character_count}/${subscriptionInfo.character_limit}, remaining=${remaining}`);

    // BLOCK if script exceeds remaining quota for the billing cycle.
    // Skip when we can't compute remaining — let ElevenLabs be the source of truth.
    if (remaining !== null && characterCount > remaining) {
      throw new Error(
        `ElevenLabs quota exceeded: Your script requires ${characterCount} characters but you only have ${remaining} characters remaining. ` +
        `Please upgrade your ElevenLabs plan to continue: https://try.elevenlabs.io/content-farming-pricing-page`
      );
    }

    // Build semantic input for payload builder
    const semanticInput: UserInput = {
      text: scriptContent,
      voice_id: voiceId,
      model_id: ttsModelId,
      stability: ttsParams.stability,
      similarity_boost: ttsParams.similarity_boost,
      style: ttsParams.style,
      use_speaker_boost: ttsParams.use_speaker_boost
    };

    const capabilities = await ensureModelSchema(supabase, 'elevenlabs', ttsModelId, 'tts');
    
    let requestBody: Record<string, any>;
    if (capabilities) {
      const result = buildPayload(capabilities, semanticInput);
      if (result.warnings.length > 0) {
        console.warn('Payload builder warnings:', result.warnings);
      }
      requestBody = result.payload;
    } else {
      console.warn(`Schema not available for elevenlabs/${ttsModelId}, using basic parameters`);
      requestBody = { text: scriptContent, model_id: ttsModelId };
    }

    console.log(`Built TTS payload:`, JSON.stringify(requestBody, null, 2));

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': decryptedKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`ElevenLabs API error (${response.status}):`, errorBody);
      // Parse ElevenLabs error for actionable user feedback
      const elevenLabsError = parseElevenLabsError(response.status, errorBody, ttsModelId, voiceId);
      throw new Error(elevenLabsError);
    }

    const audioBlob = await response.arrayBuffer();
    
    // Upload to storage
    const fileName = `voice_${output.id}_${Date.now()}.mp3`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('content-media')
      .upload(fileName, audioBlob, {
        contentType: 'audio/mpeg'
      });

    if (uploadError) {
      throw new Error(`Failed to upload audio: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('content-media')
      .getPublicUrl(fileName);

    const cost = calculateElevenLabsCost(characterCount);
    const duration = Math.ceil(characterCount / 15); // ~15 chars/second

    console.log(`TTS generation complete. Characters: ${characterCount}, Duration: ~${duration}s, Cost: $${cost.toFixed(4)}`);

    return {
      url: publicUrl,
      audio_url: publicUrl, // Provide both for compatibility
      duration,
      voice_id: voiceId,
      model_id: ttsModelId,
      character_count: characterCount,
      script_text: scriptContent.substring(0, 200) + (scriptContent.length > 200 ? '...' : ''),
      cost,
      status: 'awaiting_approval'
    };
  }, 'TTS generation');
}

/**
 * Extract narration text from outline content that may include scene labels and visual descriptions.
 * Handles formats like:
 *   SCENE 1: Title
 *   Voiceover: The actual narration text here...
 *   Visual description: ...
 *   Key point: ...
 *
 * Returns ONLY the voiceover/narration text, suitable for TTS.
 */
function extractNarrationFromText(content: string): string {
  // Check if content has labeled voiceover lines (e.g., "Voiceover: text")
  const voiceoverPattern = /(?:Voiceover|Narration|VO|Script):\s*([^\n]+(?:\n(?!(?:SCENE|Visual|Key point|Image|Description|Shot|Camera|Music|Sound|Audio|Transition|CTA|Call to action)[^\n]*:)[^\n]+)*)/gi;
  const voiceoverMatches = content.matchAll(voiceoverPattern);
  const voiceoverTexts: string[] = [];

  for (const match of voiceoverMatches) {
    const text = match[1].trim();
    if (text) {
      voiceoverTexts.push(text);
    }
  }

  if (voiceoverTexts.length > 0) {
    const extracted = voiceoverTexts.join(' ');
    console.log(`[extractNarrationFromText] Extracted ${voiceoverTexts.length} voiceover segments (${extracted.split(/\s+/).length} words)`);
    return extracted;
  }

  // Fallback: If no labeled voiceover lines, check for scene-based format without labels
  // Try to extract text that's NOT a label (Visual description, Key point, etc.)
  const lines = content.split('\n');
  const narrationLines: string[] = [];
  const labelPatterns = /^(SCENE\s*\d*|Visual|Key point|Image|Description|Shot|Camera|Music|Sound|Audio|Transition|CTA|Call to action|Hook|Context|Core|Examples|Demo|Results)[:\s]/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !labelPatterns.test(trimmed)) {
      narrationLines.push(trimmed);
    }
  }

  if (narrationLines.length > 0) {
    const extracted = narrationLines.join(' ');
    console.log(`[extractNarrationFromText] Fallback: extracted ${narrationLines.length} lines (${extracted.split(/\s+/).length} words)`);
    return extracted;
  }

  // Last resort: return original content (will likely produce poor TTS)
  console.warn(`[extractNarrationFromText] Could not extract narration, using raw content`);
  return content;
}

/**
 * Execute full voiceover stage - generates a SINGLE TTS audio for the entire script
 * Used for storyboard_video_longform to avoid per-scene sync issues
 * The audio duration determines how many video scenes/clips we need
 */
async function executeFullVoiceoverStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('[executeFullVoiceoverStage] Starting full voiceover generation...');

  return await retryWithBackoff(async () => {
    const elevenLabsKey = apiKeys.find(k => k.provider === 'elevenlabs');
    if (!elevenLabsKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const decryptedKey = await decryptApiKey(elevenLabsKey.key_encrypted);

    // Get outline data from input stage
    const outlineData = output.stage_data?.outline;
    if (!outlineData) {
      throw new Error('No outline data found for full voiceover generation');
    }

    // Extract the full narration script from outline
    // Support multiple formats: structured JSON, labeled text, or prose narrative
    let fullScript = '';

    if (outlineData.scenes && Array.isArray(outlineData.scenes)) {
      // Structured format: join all scene narrations
      fullScript = outlineData.scenes
        .sort((a: any, b: any) => (a.scene_number || 0) - (b.scene_number || 0))
        .map((s: any) => s.narration || s.text || '')
        .filter((text: string) => text.trim())
        .join('\n\n');
      console.log(`[executeFullVoiceoverStage] Extracted narration from ${outlineData.scenes.length} structured scenes`);
    } else if (outlineData.content) {
      // Try parsing JSON from content string
      try {
        const parsed = JSON.parse(outlineData.content);
        if (parsed.scenes && Array.isArray(parsed.scenes)) {
          fullScript = parsed.scenes
            .sort((a: any, b: any) => (a.scene_number || 0) - (b.scene_number || 0))
            .map((s: any) => s.narration || s.text || '')
            .filter((text: string) => text.trim())
            .join('\n\n');
          console.log(`[executeFullVoiceoverStage] Parsed narration from JSON content: ${parsed.scenes.length} scenes`);
        } else {
          // Plain prose narrative (JSON but no scenes array)
          fullScript = extractNarrationFromText(outlineData.content);
          console.log('[executeFullVoiceoverStage] Using prose narrative content from JSON');
        }
      } catch {
        // Not JSON - check if it's labeled scene format (SCENE X: ... Voiceover: ...)
        fullScript = extractNarrationFromText(outlineData.content);
        console.log('[executeFullVoiceoverStage] Extracted narration from text content');
      }
    }

    if (!fullScript.trim()) {
      throw new Error('No narration content found in outline for TTS generation');
    }

    const wordCount = fullScript.split(/\s+/).filter(Boolean).length;
    const characterCount = fullScript.length;
    console.log(`[executeFullVoiceoverStage] Full script: ${wordCount} words, ${characterCount} characters`);

    // Get library elements and check for character voice
    const libraryElements = output.generation_params?.library_elements || {};
    const characterVoiceId = getVoiceIdFromCharacter(libraryElements);

    // Get TTS configuration - priority: character voice > blueprint parameters.voice_id > blueprint voice_id > default
    const ttsConfig = configuration?.model_config?.tts || {};
    const blueprintVoiceId = ttsConfig.parameters?.voice_id || ttsConfig.voice_id;
    const voiceId = characterVoiceId || blueprintVoiceId || 'EXAVITQu4vr4xnSDxMaL';
    const ttsModelId = ttsConfig.model_id || 'eleven_multilingual_v2';
    const ttsParams = ttsConfig.parameters || {};

    console.log(`[executeFullVoiceoverStage] Using voice ${voiceId}${characterVoiceId ? ' (from character)' : blueprintVoiceId ? ' (from blueprint)' : ' (default)'}`);

    // Validate voice ID exists before attempting TTS (fail fast with actionable error)
    const voiceValidation = await validateElevenLabsVoice(decryptedKey, voiceId);
    if (!voiceValidation.valid) {
      throw new Error(voiceValidation.error);
    }
    console.log(`[executeFullVoiceoverStage] Voice validated: ${voiceValidation.voiceName}`);

    // Check ElevenLabs subscription status before attempting TTS
    // ElevenLabs returns character_count = USED, character_limit = total ceiling.
    // Remaining = character_limit - character_count. Don't treat character_count as remaining.
    const subscriptionInfo = await checkElevenLabsSubscription(decryptedKey);
    const remaining = (subscriptionInfo.character_limit !== null && subscriptionInfo.character_count !== null)
      ? subscriptionInfo.character_limit - subscriptionInfo.character_count
      : null;
    console.log(`[executeFullVoiceoverStage] ElevenLabs subscription: tier=${subscriptionInfo.tier}, used=${subscriptionInfo.character_count}/${subscriptionInfo.character_limit}, remaining=${remaining}`);

    // BLOCK if script exceeds remaining quota for the billing cycle.
    // Skip when we can't compute remaining — let ElevenLabs be the source of truth.
    if (remaining !== null && characterCount > remaining) {
      throw new Error(
        `ElevenLabs quota exceeded: Your script requires ${characterCount} characters but you only have ${remaining} characters remaining. ` +
        `Please upgrade your ElevenLabs plan to continue: https://try.elevenlabs.io/content-farming-pricing-page`
      );
    }

    // Generate TTS for full script
    const requestBody = {
      text: fullScript,
      model_id: ttsModelId,
      voice_settings: {
        stability: ttsParams.stability ?? 0.5,
        similarity_boost: ttsParams.similarity_boost ?? 0.75,
        style: ttsParams.style ?? 0,
        use_speaker_boost: ttsParams.use_speaker_boost ?? true
      }
    };

    // Use with-timestamps endpoint to get character-level alignment for subtitles
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`, {
      method: 'POST',
      headers: {
        'xi-api-key': decryptedKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      // Parse ElevenLabs error for actionable feedback
      const elevenLabsError = parseElevenLabsError(response.status, errorBody, ttsModelId, voiceId);
      throw new Error(elevenLabsError);
    }

    // with-timestamps returns JSON: { audio_base64, alignment, normalized_alignment }
    const ttsResult = await response.json();
    const audioBase64 = ttsResult.audio_base64;
    const alignment = ttsResult.alignment; // { characters, character_start_times_seconds, character_end_times_seconds }

    // Decode base64 audio to ArrayBuffer
    const binaryString = atob(audioBase64);
    const audioBytes = binaryString.length;
    const audioArray = new Uint8Array(audioBytes);
    for (let i = 0; i < audioBytes; i++) {
      audioArray[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = audioArray.buffer;

    // Build word-level timestamps from character alignment
    let wordTimestamps: Array<{ word: string; start: number; end: number }> = [];
    if (alignment?.characters && alignment.character_start_times_seconds && alignment.character_end_times_seconds) {
      wordTimestamps = buildWordTimestampsFromAlignment(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds
      );
      console.log(`[executeFullVoiceoverStage] Built ${wordTimestamps.length} word timestamps from ElevenLabs alignment`);
    }

    // Calculate actual duration — prefer alignment end time (accurate), fall back to file size estimate
    let actualDuration: number;
    if (wordTimestamps.length > 0) {
      // Use the last word's end time from ElevenLabs alignment (most accurate)
      actualDuration = Math.round(wordTimestamps[wordTimestamps.length - 1].end * 10) / 10;
      console.log(`[executeFullVoiceoverStage] Duration from alignment: ${actualDuration}s`);
    } else if (alignment?.character_end_times_seconds?.length > 0) {
      // Use raw character alignment end time
      actualDuration = Math.round(alignment.character_end_times_seconds[alignment.character_end_times_seconds.length - 1] * 10) / 10;
      console.log(`[executeFullVoiceoverStage] Duration from character alignment: ${actualDuration}s`);
    } else {
      // Fallback: estimate from MP3 file size (assumes ~128kbps CBR)
      actualDuration = Math.round((audioBytes / 16000) * 10) / 10;
      console.log(`[executeFullVoiceoverStage] Duration estimated from file size: ${actualDuration}s (may be inaccurate)`);
    }

    // Upload to storage
    const fileName = `full_voiceover_${output.id}_${Date.now()}.mp3`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('content-media')
      .upload(fileName, audioBlob, {
        contentType: 'audio/mpeg'
      });

    if (uploadError) {
      throw new Error(`Failed to upload voiceover audio: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('content-media')
      .getPublicUrl(fileName);

    const cost = calculateElevenLabsCost(characterCount);
    const estimatedDuration = Math.ceil(characterCount / 15); // Fallback estimate

    // Use actual duration, fall back to character-count estimate if too small
    const duration = actualDuration > 0.5 ? actualDuration : estimatedDuration;

    // Calculate recommended scene count based on audio duration
    // Always use 5s clips for consistent scene pacing
    const CLIP_DURATION = 5;
    const recommendedSceneCount = Math.ceil(duration / CLIP_DURATION);

    console.log(`[executeFullVoiceoverStage] Generated voiceover: ${duration}s duration, recommending ${recommendedSceneCount} scenes (${CLIP_DURATION}s each)`);

    return {
      audio_url: publicUrl,
      duration,
      actual_duration: actualDuration,
      character_count: characterCount,
      word_count: wordCount,
      voice_id: voiceId,
      model_id: ttsModelId,
      cost,
      recommended_scene_count: recommendedSceneCount,
      clip_duration: CLIP_DURATION,
      script: fullScript,
      word_timestamps: wordTimestamps.length > 0 ? wordTimestamps : undefined,
      status: 'ready'
    };
  }, 'Full voiceover generation');
}

/**
 * Build word-level timestamps from ElevenLabs character-level alignment data.
 * Groups characters into words by splitting on spaces/newlines.
 */
function buildWordTimestampsFromAlignment(
  characters: string[],
  startTimes: number[],
  endTimes: number[]
): Array<{ word: string; start: number; end: number }> {
  const words: Array<{ word: string; start: number; end: number }> = [];
  let currentWord = '';
  let wordStart = -1;
  let wordEnd = 0;

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i];
    const isWhitespace = char === ' ' || char === '\n' || char === '\r' || char === '\t';

    if (isWhitespace) {
      // End of word
      if (currentWord.trim()) {
        words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
      }
      currentWord = '';
      wordStart = -1;
    } else {
      if (wordStart < 0) {
        wordStart = startTimes[i];
      }
      wordEnd = endTimes[i];
      currentWord += char;
    }
  }

  // Push last word
  if (currentWord.trim()) {
    words.push({ word: currentWord.trim(), start: wordStart, end: wordEnd });
  }

  return words;
}

/**
 * Execute voice segments stage - generates per-scene TTS for longform storyboard videos
 * Each scene gets its own audio file for precise sync and individual retakes
 * @deprecated Use executeFullVoiceoverStage for new implementations
 */
async function executeVoiceSegmentsStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  regenerate_segment?: number
): Promise<any> {
  console.log('[executeVoiceSegmentsStage] Starting per-scene voice generation...');

  return await retryWithBackoff(async () => {
    const elevenLabsKey = apiKeys.find(k => k.provider === 'elevenlabs');
    if (!elevenLabsKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    const decryptedKey = await decryptApiKey(elevenLabsKey.key_encrypted);

    // Get scenes from input stage (scenes stage has narration text)
    const inputStage = stageConfig.inputFrom?.[0];
    if (!inputStage) {
      throw new Error('No input stage specified for voice segments');
    }

    const inputStageData = output.stage_data?.[inputStage];
    if (!inputStageData || !inputStageData.scenes) {
      throw new Error(`No scenes found in input stage: ${inputStage}`);
    }

    const scenes = inputStageData.scenes || [];

    // For storyboard_video_longform, check storyboard approval status instead of scenes
    // The scenes stage has narration, but storyboard has the user-approved images
    const storyboardData = output.stage_data?.storyboard;
    const storyboardScenes = storyboardData?.scenes || [];

    // Get approval status from storyboard if available, otherwise fall back to scenes
    // Accept both 'ready' (auto-approved after generation) and 'approved' (manually approved) statuses
    // Exclude 'excluded' and 'failed' scenes
    let approvedSceneNumbers: number[] = [];
    if (storyboardScenes.length > 0) {
      approvedSceneNumbers = storyboardScenes
        .filter((s: any) => s.status === 'ready' || s.status === 'approved' || !s.status)
        .filter((s: any) => s.status !== 'excluded' && s.status !== 'failed')
        .map((s: any) => s.scene_number);
      console.log(`[executeVoiceSegmentsStage] Found ${approvedSceneNumbers.length} ready/approved scenes from storyboard`);
    } else {
      // Fallback: check scenes stage directly
      approvedSceneNumbers = scenes
        .filter((s: any) => s.status === 'ready' || s.status === 'approved' || !s.status)
        .filter((s: any) => s.status !== 'excluded' && s.status !== 'failed')
        .map((s: any) => s.scene_number);
      console.log(`[executeVoiceSegmentsStage] Found ${approvedSceneNumbers.length} ready/approved scenes from scenes stage`);
    }

    if (approvedSceneNumbers.length === 0) {
      throw new Error('No ready scenes found. Please wait for storyboard images to complete before generating voice segments.');
    }

    // Filter scenes to only include approved ones (by scene_number)
    const approvedScenes = scenes.filter((s: any) => approvedSceneNumbers.includes(s.scene_number));

    console.log(`[executeVoiceSegmentsStage] Processing ${approvedScenes.length} scenes for voice generation`);

    // Get library elements and check for character voice
    const libraryElements = output.generation_params?.library_elements || {};
    const characterVoiceId = getVoiceIdFromCharacter(libraryElements);

    // Get TTS configuration - priority: character voice > blueprint parameters.voice_id > blueprint voice_id > default
    const ttsConfig = configuration?.model_config?.tts || {};
    const blueprintVoiceId = ttsConfig.parameters?.voice_id || ttsConfig.voice_id;
    const voiceId = characterVoiceId || blueprintVoiceId || 'EXAVITQu4vr4xnSDxMaL';
    const ttsModelId = ttsConfig.model_id || 'eleven_multilingual_v2';
    const ttsParams = ttsConfig.parameters || {};

    console.log(`[executeVoiceSegmentsStage] Using voice ${voiceId}${characterVoiceId ? ' (from character)' : blueprintVoiceId ? ' (from blueprint)' : ' (default)'}`);

    // Get existing segments if regenerating single segment
    const existingSegments = output.stage_data?.[stageId]?.segments || [];

    // If regenerating a single segment, only process that one
    if (regenerate_segment !== undefined && regenerate_segment !== null) {
      console.log(`[executeVoiceSegmentsStage] Regenerating single segment: ${regenerate_segment}`);

      const targetScene = approvedScenes.find((s: any) => s.scene_number === regenerate_segment);
      if (!targetScene) {
        throw new Error(`Scene ${regenerate_segment} not found or not approved`);
      }

      const narration = targetScene.narration || targetScene.prompt || '';
      if (!narration.trim()) {
        throw new Error(`Scene ${regenerate_segment} has no narration text`);
      }

      // Generate TTS for single segment
      const segment = await generateSingleVoiceSegment(
        decryptedKey,
        voiceId,
        ttsModelId,
        ttsParams,
        narration,
        regenerate_segment,
        output.id,
        supabase
      );

      // Merge with existing segments
      const updatedSegments = existingSegments.map((s: any) =>
        s.scene_number === regenerate_segment ? segment : s
      );

      // If segment didn't exist before, add it
      if (!existingSegments.find((s: any) => s.scene_number === regenerate_segment)) {
        updatedSegments.push(segment);
        updatedSegments.sort((a: any, b: any) => a.scene_number - b.scene_number);
      }

      const totalDuration = updatedSegments.reduce((sum: number, s: any) => sum + (s.duration || 0), 0);
      const totalCharacters = updatedSegments.reduce((sum: number, s: any) => sum + (s.character_count || 0), 0);
      const totalCost = updatedSegments.reduce((sum: number, s: any) => sum + (s.cost || 0), 0);

      return {
        segments: updatedSegments,
        total_duration: totalDuration,
        total_characters: totalCharacters,
        voice_id: voiceId,
        model_id: ttsModelId,
        cost: totalCost,
        status: 'awaiting_approval'
      };
    }

    // Generate all segments
    console.log(`[executeVoiceSegmentsStage] Generating ${approvedScenes.length} voice segments...`);

    const segments: any[] = [];
    let totalCost = 0;

    // Sort scenes by scene_number
    const sortedScenes = [...approvedScenes].sort((a: any, b: any) => a.scene_number - b.scene_number);

    for (const scene of sortedScenes) {
      const narration = scene.narration || scene.prompt || '';
      if (!narration.trim()) {
        console.warn(`[executeVoiceSegmentsStage] Scene ${scene.scene_number} has no narration, skipping`);
        continue;
      }

      try {
        const segment = await generateSingleVoiceSegment(
          decryptedKey,
          voiceId,
          ttsModelId,
          ttsParams,
          narration,
          scene.scene_number,
          output.id,
          supabase
        );

        // Add scene duration for comparison
        segment.scene_duration = scene.duration_seconds || 8;

        segments.push(segment);
        totalCost += segment.cost || 0;

        // Check if audio duration exceeds scene duration
        const overflow = segment.duration - segment.scene_duration;
        if (overflow > 0.5) {
          console.warn(`[executeVoiceSegmentsStage] ⚠️ Scene ${scene.scene_number} OVERFLOW: audio ${segment.duration}s > scene ${segment.scene_duration}s (${overflow.toFixed(1)}s too long)`);
        }

        console.log(`[executeVoiceSegmentsStage] Scene ${scene.scene_number} complete: ${segment.duration}s audio / ${segment.scene_duration}s scene, ${segment.character_count} chars`);

        // Small delay between API calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[executeVoiceSegmentsStage] Error generating segment for scene ${scene.scene_number}:`, error);
        // Add failed segment placeholder
        segments.push({
          scene_number: scene.scene_number,
          audio_url: null,
          duration: 0,
          character_count: narration.length,
          status: 'failed',
          error: (error as Error).message
        });
      }
    }

    const totalDuration = segments.reduce((sum, s) => sum + (s.duration || 0), 0);
    const totalCharacters = segments.reduce((sum, s) => sum + (s.character_count || 0), 0);

    // Calculate overflow stats
    const overflowSegments = segments.filter(s => s.duration > (s.scene_duration || 8) + 0.5);
    const totalOverflow = overflowSegments.reduce((sum, s) => sum + (s.duration - (s.scene_duration || 8)), 0);

    console.log(`[executeVoiceSegmentsStage] Complete: ${segments.length} segments, ${totalDuration}s total, ${totalCharacters} chars, $${totalCost.toFixed(4)}`);

    if (overflowSegments.length > 0) {
      console.warn(`[executeVoiceSegmentsStage] ⚠️ ${overflowSegments.length} segments exceed scene duration by total ${totalOverflow.toFixed(1)}s - narration may be cut off`);
    }

    return {
      segments,
      total_duration: totalDuration,
      total_characters: totalCharacters,
      voice_id: voiceId,
      model_id: ttsModelId,
      cost: totalCost,
      status: 'awaiting_approval'
    };
  }, 'Voice segments generation');
}

/**
 * Generate a single voice segment for a scene
 */
async function generateSingleVoiceSegment(
  apiKey: string,
  voiceId: string,
  modelId: string,
  params: any,
  narration: string,
  sceneNumber: number,
  outputId: string,
  supabase: any
): Promise<any> {
  const requestBody = {
    text: narration,
    model_id: modelId,
    voice_settings: {
      stability: params.stability ?? 0.5,
      similarity_boost: params.similarity_boost ?? 0.75,
      style: params.style ?? 0,
      use_speaker_boost: params.use_speaker_boost ?? true
    }
  };

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${errorBody}`);
  }

  const audioBlob = await response.arrayBuffer();

  // Calculate actual duration from MP3 file size
  // ElevenLabs uses 128kbps MP3 by default: duration = bytes / (128000/8) = bytes / 16000
  const audioBytes = audioBlob.byteLength;
  const actualDuration = Math.round((audioBytes / 16000) * 10) / 10; // Round to 1 decimal

  // Upload to storage with scene-specific filename
  const fileName = `voice_segment_${outputId}_scene${sceneNumber}_${Date.now()}.mp3`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('content-media')
    .upload(fileName, audioBlob, {
      contentType: 'audio/mpeg'
    });

  if (uploadError) {
    throw new Error(`Failed to upload audio segment: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from('content-media')
    .getPublicUrl(fileName);

  const characterCount = narration.length;
  const wordCount = narration.split(/\s+/).filter(Boolean).length;
  const cost = calculateElevenLabsCost(characterCount);
  const estimatedDuration = Math.ceil(characterCount / 15); // Fallback estimate

  // Use actual duration from file size, fall back to estimate if too small (likely corrupted)
  const duration = actualDuration > 0.5 ? actualDuration : estimatedDuration;

  return {
    scene_number: sceneNumber,
    audio_url: publicUrl,
    duration,
    actual_duration: actualDuration,
    character_count: characterCount,
    word_count: wordCount,
    cost,
    status: 'pending'
  };
}

/**
 * Regenerate a single storyboard image with optional custom prompt and instructions
 */
async function regenerateSingleStoryboardImage(
  output: any,
  stageId: string,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  decryptedKey: string,
  sceneNumber: number,
  customPrompt?: string,
  instructions?: string
): Promise<any> {
  console.log(`[regenerateSingleStoryboardImage] Regenerating scene ${sceneNumber}`);
  console.log(`[regenerateSingleStoryboardImage] Custom prompt: ${customPrompt?.substring(0, 50)}...`);
  console.log(`[regenerateSingleStoryboardImage] Instructions: ${instructions || 'none'}`);

  // Get existing storyboard scenes
  const existingScenes = output.stage_data?.storyboard?.scenes || [];
  const targetScene = existingScenes.find((s: any) => s.scene_number === sceneNumber);

  if (!targetScene) {
    throw new Error(`Scene ${sceneNumber} not found in storyboard`);
  }

  // Determine the prompt to use
  let finalPrompt = customPrompt || targetScene.prompt;

  // If instructions provided, modify the prompt to include them
  if (instructions && instructions.trim()) {
    // Append instructions to the prompt for the AI model to follow
    finalPrompt = `${finalPrompt}\n\nAdditional instructions: ${instructions}`;
    console.log(`[regenerateSingleStoryboardImage] Final prompt with instructions: ${finalPrompt.substring(0, 100)}...`);
  }

  const modelId = configuration?.model_config?.image_generator?.model_id || 'black-forest-labs/flux-schnell';

  // Build payload
  const imageParams = configuration?.model_config?.image_generator?.parameters || {};
  const imageInputs = output.generation_params?.image_inputs || {};
  const libraryElements = output.generation_params?.library_elements || {};

  // Extract aspect ratio - output_config (user selection) takes priority over video_config defaults
  // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
  const videoConfig = output.generation_params?.video_config;
  const outputConfig = output.generation_params?.output_config;
  const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
    || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
    || imageParams.aspect_ratio;
  const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;

  const semanticInput: UserInput = {
    main_prompt: finalPrompt,
    ...(aspectRatio && { aspect_ratio: aspectRatio }),
    resolution_tier: imageParams.resolution_tier || 'HD',
    steps: imageParams.steps,
    guidance: imageParams.guidance_scale,
    seed: imageParams.seed,
    negative_prompt: imageParams.negative_prompt
  };

  // Extract reference images
  let referenceImages: string[] = [];
  if (imageInputs.character?.length > 0) {
    referenceImages = imageInputs.character;
  } else if (libraryElements.character) {
    const char = Array.isArray(libraryElements.character)
      ? libraryElements.character[0]
      : libraryElements.character;
    if (char?.reference_images?.length > 0) {
      referenceImages = char.reference_images;
    }
  }

  if (referenceImages.length > 0) {
    semanticInput.image_input = referenceImages;
    console.log(`[regenerateSingleStoryboardImage] Using reference images: ${referenceImages.join(', ')}`);
  }

  const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_generator');

  let payload: Record<string, any>;
  if (capabilities) {
    const result = buildPayload(capabilities, semanticInput);
    if (result.warnings.length > 0) {
      console.warn('Payload builder warnings:', result.warnings);
    }
    payload = result.payload;
  } else {
    payload = {
      prompt: finalPrompt,
      num_outputs: 1
    };
  }

  console.log(`[regenerateSingleStoryboardImage] Built image payload:`, JSON.stringify(payload, null, 2));

  // Start async prediction with webhook
  const startPrediction = async () => {
    return await startReplicatePrediction(
      supabase,
      output.id,
      decryptedKey,
      modelId,
      payload,
      {
        stage_id: stageId,
        item_type: 'image',
        scene_number: sceneNumber,
        extra_data: { prompt: finalPrompt, original_prompt: targetScene.prompt, instructions }
      }
    );
  };

  const { prediction_id } = await retryWithBackoff(
    startPrediction,
    `Image scene ${sceneNumber} regeneration`,
    5
  );

  // Update the scene in the existing array with generating status
  const updatedScenes = existingScenes.map((s: any) =>
    s.scene_number === sceneNumber
      ? {
          ...s,
          prompt: customPrompt || s.prompt, // Keep original prompt unless custom provided
          prediction_id,
          status: 'generating',
          image_url: null, // Clear old image while regenerating
          started_at: new Date().toISOString()
        }
      : s
  );

  console.log(`[regenerateSingleStoryboardImage] Scene ${sceneNumber} regeneration started. Prediction ID: ${prediction_id}`);

  return {
    scenes: updatedScenes,
    model: modelId,
    started_at: new Date().toISOString(),
    cost: 0,
    status: 'generating'
  };
}

// ============= CAROUSEL SLIDE PROMPTS STAGE =============
// Uses the blueprint's image_prompt template to generate individual image prompts for each slide
// This is the "prompt of a prompt" - ensures consistent style across all slides
async function executeCarouselSlidePromptsStage(
  output: any,
  _stageId: string,
  _stageConfig: any,
  configuration: any,
  apiKeys: any[],
  _supabase: any,
  supabaseUrl: string,
  regenerate_scene?: number,
  custom_prompt?: string
): Promise<any> {
  console.log('[executeCarouselSlidePromptsStage] Generating image prompts for carousel slides...');

  return await retryWithBackoff(async () => {
    const openRouterKey = apiKeys.find((k: any) => k.provider === 'openrouter');
    if (!openRouterKey && !apiKeys.find((k: { provider: string }) => k.provider === 'ollama')) {
      throw new Error('OpenRouter API key not configured');
    }

    const decryptedKey = openRouterKey ? await decryptApiKey(openRouterKey.key_encrypted) : '';
    const rawTextModelId = configuration?.model_config?.text_llm?.model_id || DEFAULT_FREE_TEXT_MODEL;
    const llmTarget = await resolveStageTextLlm(apiKeys, rawTextModelId, decryptedKey);
    const modelId = llmTarget.modelId;

    // Get the IMAGE PROMPT template from blueprint - this is the key template for generating slide prompts
    const imagePromptTemplate = configuration?.image_prompt || output.generation_params?.image_prompt || '';

    console.log('[executeCarouselSlidePromptsStage] DEBUG - configuration?.image_prompt:', configuration?.image_prompt ? configuration.image_prompt.substring(0, 300) : 'UNDEFINED');
    console.log('[executeCarouselSlidePromptsStage] DEBUG - output.generation_params?.image_prompt:', output.generation_params?.image_prompt ? output.generation_params.image_prompt.substring(0, 300) : 'UNDEFINED');
    console.log('[executeCarouselSlidePromptsStage] DEBUG - Final imagePromptTemplate length:', imagePromptTemplate?.length || 0);
    console.log('[executeCarouselSlidePromptsStage] DEBUG - Final imagePromptTemplate:', imagePromptTemplate ? imagePromptTemplate.substring(0, 500) : 'EMPTY');

    if (!imagePromptTemplate) {
      console.log('[executeCarouselSlidePromptsStage] No image_prompt template found in blueprint, using fallback');
    } else {
      console.log('[executeCarouselSlidePromptsStage] Using image_prompt template:', imagePromptTemplate.substring(0, 100));
    }

    // Get slide content from carousel_content stage (text only: headline, body)
    const slideContent = output.stage_data?.carousel_content?.slides || [];
    if (!slideContent.length) {
      throw new Error('No slide content found - carousel_slide_prompts requires carousel_content stage to complete first');
    }

    // Get the caption for context
    const captionText = output.stage_data?.caption?.text || output.stage_data?.caption?.content || '';

    // Get library elements for variable substitution
    const libraryElements = output.generation_params?.library_elements || {};
    console.log('[executeCarouselSlidePromptsStage] DEBUG - libraryElements keys:', Object.keys(libraryElements));
    console.log('[executeCarouselSlidePromptsStage] DEBUG - has brand:', !!libraryElements.brand);
    console.log('[executeCarouselSlidePromptsStage] DEBUG - brand color_palette:', libraryElements.brand?.color_palette);
    console.log('[executeCarouselSlidePromptsStage] DEBUG - brand font_style:', libraryElements.brand?.font_style);
    console.log('[executeCarouselSlidePromptsStage] DEBUG - brand accent_style:', libraryElements.brand?.accent_style);

    // Build context for variable substitution in the image prompt template
    const promptContext: Record<string, string> = {};

    // Extract character info - support both flat keys and nested paths like {{character.visual_style}}
    const characterElement = libraryElements.library_characters || libraryElements.character || libraryElements.characters;
    if (characterElement) {
      const char = Array.isArray(characterElement) ? characterElement[0] : characterElement;
      if (char?.name) promptContext.character = char.name;
      if (char?.description) promptContext.character_description = char.description;
      // Support nested paths for character properties
      if (char?.visual_style) promptContext['character.visual_style'] = char.visual_style;
      if (char?.visual_description) promptContext['character.visual_description'] = char.visual_description;
    }

    // Extract brand info - support both flat keys and nested paths like {{brand.color_palette}}
    const brandVoice = libraryElements.library_brand_voices || libraryElements.brand_voice || libraryElements.brand;
    const brand = Array.isArray(brandVoice) ? brandVoice[0] : brandVoice;
    if (brand) {
      if (brand.name) promptContext.brand = brand.name;
      if (brand.visual_style_description) promptContext.visual_style = brand.visual_style_description;
      if (brand.color_palette) {
        const colorStr = typeof brand.color_palette === 'string'
          ? brand.color_palette
          : JSON.stringify(brand.color_palette);
        promptContext.colors = colorStr;
        // Also support nested path {{brand.color_palette}}
        promptContext['brand.color_palette'] = colorStr;
      }
      // Support nested paths for brand properties
      if (brand.font_style) promptContext['brand.font_style'] = brand.font_style;
      if (brand.accent_style) promptContext['brand.accent_style'] = brand.accent_style;
      if (brand.visual_style_description) promptContext['brand.visual_style'] = brand.visual_style_description;
    }

    // Extract product info
    const productElement = libraryElements.library_products || libraryElements.product || libraryElements.products;
    if (productElement) {
      const product = Array.isArray(productElement) ? productElement[0] : productElement;
      if (product?.name) promptContext.product = product.name;
      if (product?.description) promptContext.product_description = product.description;
    }

    // Extract AI talking points if available
    const aiInsights = output.generation_params?.ai_insights || libraryElements.ai_talking_points;
    if (aiInsights) {
      const points = Array.isArray(aiInsights) ? aiInsights : [aiInsights];
      promptContext.ai_talking_points_list = points.join(', ');
    }

    // Get idea context
    const idea = output.generation_params?.idea || output.idea;
    if (idea?.title) promptContext.idea_title = idea.title;
    if (idea?.description) promptContext.idea_description = idea.description;

    console.log('[executeCarouselSlidePromptsStage] Variable context keys:', Object.keys(promptContext));
    console.log('[executeCarouselSlidePromptsStage] Variable context brand.color_palette:', promptContext['brand.color_palette']);
    console.log('[executeCarouselSlidePromptsStage] Variable context brand.font_style:', promptContext['brand.font_style']);
    console.log('[executeCarouselSlidePromptsStage] Variable context brand.accent_style:', promptContext['brand.accent_style']);

    // Handle single slide regeneration
    if (regenerate_scene !== undefined) {
      console.log(`[executeCarouselSlidePromptsStage] Regenerating prompt for slide ${regenerate_scene}`);

      const existingPrompts = output.stage_data?.carousel_slide_prompts?.slides || [];
      const targetSlide = slideContent.find((s: any) => s.slide_number === regenerate_scene);

      if (!targetSlide) {
        throw new Error(`Slide ${regenerate_scene} not found in carousel_content`);
      }

      // Generate single prompt
      const singlePrompt = await generateSingleSlidePrompt(
        llmTarget,
        supabaseUrl,
        imagePromptTemplate,
        targetSlide,
        promptContext,
        captionText,
        slideContent.length,
        custom_prompt
      );

      // Update just this slide in the existing prompts
      const updatedPrompts = existingPrompts.map((s: any) =>
        s.slide_number === regenerate_scene
          ? { ...s, prompt: singlePrompt.prompt, status: 'pending' }  // Reset to pending for re-approval
          : s
      );

      return {
        slides: updatedPrompts,
        slideCount: updatedPrompts.length,
        model: modelId,
        cost: singlePrompt.cost,
        status: 'completed'
      };
    }

    // Generate prompts for all slides
    const slides: any[] = [];
    let totalCost = 0;

    for (const slide of slideContent) {
      const slideNumber = slide.slide_number;
      console.log(`[executeCarouselSlidePromptsStage] Generating prompt for slide ${slideNumber}: "${slide.headline}"`);

      const result = await generateSingleSlidePrompt(
        llmTarget,
        supabaseUrl,
        imagePromptTemplate,
        slide,
        promptContext,
        captionText,
        slideContent.length
      );

      slides.push({
        slide_number: slideNumber,
        type: slide.type,
        headline: slide.headline,
        body: slide.body,
        prompt: result.prompt,
        status: 'pending'  // Pending so user can review and approve before image generation
      });

      totalCost += result.cost;
    }

    console.log(`[executeCarouselSlidePromptsStage] Generated ${slides.length} image prompts, total cost: $${totalCost.toFixed(4)}`);

    return {
      slides,
      slideCount: slides.length,
      model: modelId,
      cost: totalCost,
      status: 'completed'
    };
  }, 'executeCarouselSlidePromptsStage');
}

// Helper function to generate a single slide's image prompt using the image_prompt template
async function generateSingleSlidePrompt(
  llmTarget: StageTextLlmTarget,
  supabaseUrl: string,
  imagePromptTemplate: string,
  slide: any,
  context: Record<string, string>,
  captionText: string,
  totalSlides: number,
  customPrompt?: string
): Promise<{ prompt: string; cost: number }> {

  // If custom prompt provided, use it directly
  if (customPrompt) {
    return { prompt: customPrompt, cost: 0 };
  }

  // Resolve variables in the image prompt template
  let resolvedTemplate = imagePromptTemplate;
  for (const [key, value] of Object.entries(context)) {
    if (value) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      resolvedTemplate = resolvedTemplate.replace(regex, value);
    }
  }
  // Remove any unsubstituted variables
  resolvedTemplate = resolvedTemplate.replace(/\{\{[^}]+\}\}/g, '').replace(/\s+/g, ' ').trim();

  // Extract color palette from resolved template if it contains color info
  const colorMatch = resolvedTemplate.match(/Color palette:\s*({[^}]+}|[^\n]+)/i);
  const fontMatch = resolvedTemplate.match(/Brand font:\s*([^\n]+)/i);
  const accentMatch = resolvedTemplate.match(/Brand accent style:\s*([^\n]+)/i);

  const colorPalette = colorMatch ? colorMatch[1].trim() : (context.colors || '');
  const fontStyle = fontMatch ? fontMatch[1].trim() : '';
  const accentStyle = accentMatch ? accentMatch[1].trim() : '';

  // Build explicit style instructions
  let styleInstructions = '';
  if (colorPalette) {
    styleInstructions += `\nCOLOR PALETTE (MUST USE): ${colorPalette}`;
  }
  if (fontStyle) {
    styleInstructions += `\nFONT STYLE: ${fontStyle}`;
  }
  if (accentStyle) {
    styleInstructions += `\nACCENT STYLE: ${accentStyle}`;
  }
  if (context.visual_style) {
    styleInstructions += `\nVISUAL STYLE: ${context.visual_style}`;
  }

  // Build the prompt generation request
  const systemPrompt = `You are an expert at writing detailed image prompts for AI image generators (like Flux, DALL-E, Midjourney).

Your task: Generate ONE detailed image prompt for slide ${slide.slide_number} of a ${totalSlides}-slide Instagram carousel.

SLIDE CONTEXT:
- Slide Type: ${slide.type} (${slide.type === 'cover' ? 'attention-grabbing hook' : slide.type === 'cta' ? 'call-to-action' : 'informational content'})
- Headline: "${slide.headline}"
${slide.body ? `- Body Text: "${slide.body}"` : ''}

OVERALL STORY (from caption):
"""
${captionText.substring(0, 500)}
"""
${styleInstructions}
${resolvedTemplate && !styleInstructions ? `
VISUAL STYLE GUIDE (from brand template):
"""
${resolvedTemplate}
"""` : ''}

CRITICAL RULES:
1. Output ONLY the image prompt text - no explanations, no JSON, no markdown
2. Describe ONE SINGLE unified image - NOT a collage, NOT multiple panels, NOT a grid
3. Include text overlay instruction: "with text overlay: ${slide.headline}"
4. Keep the composition clean with ONE focal point
5. Match the mood and message of the slide content
6. Ensure visual consistency with the overall carousel theme
7. ${colorPalette ? `USE THE EXACT COLORS from the palette: ${colorPalette}` : 'Be specific about colors'}
8. Prompt should be 50-100 words - concise and focused`;

  const response = await fetch(llmTarget.url, {
    method: 'POST',
    headers: {
      ...llmTarget.headers,
      'HTTP-Referer': supabaseUrl,
      'X-Title': 'ContentAI Studio'
    },
    body: JSON.stringify({
      model: llmTarget.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate the image prompt for slide ${slide.slide_number} now. Output only the prompt text.` }
      ],
      max_tokens: PROMPT_WRITER_MAX_TOKENS
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  let prompt = requireLlmText(result, `Slide ${slide.slide_number} image prompt`);
  const cost = calculateOpenRouterCost(result.usage, llmTarget.modelId);

  // Clean up the prompt
  prompt = prompt.trim();
  // Remove any markdown formatting if present
  prompt = prompt.replace(/^["']|["']$/g, '').trim();

  // Ensure we have anti-collage prefix
  if (!prompt.toLowerCase().includes('single') && !prompt.toLowerCase().includes('one composition')) {
    prompt = `Single Instagram carousel slide, one unified composition. ${prompt}`;
  }

  return { prompt, cost };
}

// ============= TEMPLATE RENDERER STAGE (Carousel Slides via Satori + resvg) =============
async function executeTemplateRendererStage(
  output: any,
  _stageId: string,
  _stageConfig: any,
  _configuration: any,
  supabase: any,
  regenerate_slide?: number
): Promise<any> {
  console.log('[TemplateRenderer] Starting carousel slide rendering...');

  // Import the carousel-slide-renderer module
  const { renderSlide, renderAllSlides } = await import('../_shared/carousel-slide-renderer.ts');

  // Get slide content from carousel_content stage
  const slideContentData = output.stage_data?.carousel_content?.slides || output.stage_data?.carousel_content?.scenes || [];
  if (!slideContentData.length) {
    throw new Error('No slide content found - carousel_slides requires carousel_content stage to complete first');
  }

  // Extract brand voice for styling
  const libraryElements = output.generation_params?.library_elements || {};
  const brandVoice = libraryElements.library_brand_voices || libraryElements.brand_voice || libraryElements.brand;

  // Build CarouselStyle from brand voice
  const carouselStyle: any = {};
  if (brandVoice) {
    console.log('[TemplateRenderer] Using brand voice for style:', brandVoice.name);
    const colorPalette = brandVoice.color_palette;
    if (colorPalette) {
      let parsed = colorPalette;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      if (parsed) {
        if (Array.isArray(parsed)) {
          // Array format: map positionally to named fields
          carouselStyle.palette = {
            primary: parsed[0] || undefined,
            secondary: parsed[1] || undefined,
            background: parsed[2] || undefined,
            text: parsed[3] || undefined,
            accent: parsed[4] || parsed[1] || undefined,
          };
          console.log('[TemplateRenderer] Mapped array palette:', carouselStyle.palette);
        } else if (typeof parsed === 'object') {
          // Object format: use directly (supports {primary, secondary, background, text, textMuted})
          carouselStyle.palette = {
            primary: parsed.primary,
            secondary: parsed.secondary,
            background: parsed.background,
            text: parsed.text,
            accent: parsed.accent || parsed.secondary,
          };
          console.log('[TemplateRenderer] Using object palette:', carouselStyle.palette);
        }
      }
    }
    carouselStyle.fontStyle = brandVoice.font_style;
    carouselStyle.accentStyle = brandVoice.accent_style;
    carouselStyle.visualTemplate = brandVoice.visual_template;

    // Resolve template key: output_config > brand voice visual_template > 'classic'
    const outputConfig = output.generation_params?.output_config || {};
    carouselStyle.template = outputConfig.carouselTemplate
      || brandVoice.visual_template
      || 'classic';

    if (brandVoice.logos?.length > 0) {
      carouselStyle.logo = brandVoice.logos[0];
    } else if (brandVoice.logo) {
      carouselStyle.logo = brandVoice.logo;
    }
  }

  // Ensure template is always resolved, even without brand voice
  if (!carouselStyle.template) {
    const outputConfig = output.generation_params?.output_config || {};
    carouselStyle.template = outputConfig.carouselTemplate || 'classic';
  }

  // Apply custom palette overrides from blueprint output_config
  {
    const oc = output.generation_params?.output_config || {};
    if (oc.customPalette) {
      const cp = oc.customPalette;
      console.log('[TemplateRenderer] Applying custom palette overrides');
      carouselStyle.palette = {
        ...(carouselStyle.palette || {}),
        ...(cp.primary && { primary: cp.primary }),
        ...(cp.secondary && { secondary: cp.secondary }),
        ...(cp.background && { background: cp.background }),
        ...(cp.text && { text: cp.text }),
        ...(cp.accent && { accent: cp.accent }),
      };
    }
    if (oc.backgroundImageUrl) {
      carouselStyle.backgroundImage = oc.backgroundImageUrl;
    }
  }

  // Resolve aspect ratio → width/height for renderer
  const outputConfigForAR = output.generation_params?.output_config || {};
  const carouselStyleAR = output.generation_params?.carousel_style?.aspectRatio;
  const arRaw = outputConfigForAR.aspectRatio || carouselStyleAR || 'square';
  const arDims: Record<string, { w: number; h: number }> = {
    'square': { w: 1080, h: 1080 },
    '1:1': { w: 1080, h: 1080 },
    'portrait': { w: 1080, h: 1350 },
    '4:5': { w: 1080, h: 1350 },
    'story': { w: 1080, h: 1920 },
    'reel': { w: 1080, h: 1920 },
    '9:16': { w: 1080, h: 1920 },
    'landscape': { w: 1080, h: 1080 }, // carousel landscape → square fallback
  };
  const dims = arDims[arRaw] || { w: 1080, h: 1080 };
  const renderOptions = { width: dims.w, height: dims.h };
  console.log(`[TemplateRenderer] Aspect ratio: ${arRaw} → ${dims.w}x${dims.h}`);

  // Handle single slide regeneration
  if (regenerate_slide !== undefined) {
    console.log(`[TemplateRenderer] Regenerating single slide: ${regenerate_slide}`);
    const targetSlide = slideContentData.find((s: any) => (s.slide_number || s.scene) === regenerate_slide);
    if (!targetSlide) {
      throw new Error(`Slide ${regenerate_slide} not found in carousel_content`);
    }

    const slideInput = {
      slide_number: targetSlide.slide_number || targetSlide.scene,
      type: targetSlide.type || 'content',
      headline: targetSlide.headline || '',
      body: targetSlide.body || '',
    };

    const png = await renderSlide(slideInput, carouselStyle, slideContentData.length, renderOptions);
    const fileName = `carousel_${output.id}_slide_${regenerate_slide}_${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('content-media')
      .upload(fileName, png, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      throw new Error(`Failed to upload slide ${regenerate_slide}: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
    console.log(`[TemplateRenderer] Slide ${regenerate_slide} uploaded: ${publicUrl}`);

    // Merge into existing slides
    const existingSlides = output.stage_data?.carousel_slides?.slides || [];
    const updatedSlides = existingSlides.map((s: any) =>
      s.slide_number === regenerate_slide
        ? { ...s, image_url: publicUrl, status: 'completed', regenerated_at: new Date().toISOString() }
        : s
    );

    return {
      slides: updatedSlides,
      style: carouselStyle,
      model: 'satori/resvg-wasm',
      status: 'awaiting_approval',
      cost: 0,
    };
  }

  // Full render: generate all slides
  console.log(`[TemplateRenderer] Rendering ${slideContentData.length} slides...`);

  const slideInputs = slideContentData.map((s: any) => ({
    slide_number: s.slide_number || s.scene,
    type: s.type || 'content',
    headline: s.headline || '',
    body: s.body || '',
  }));

  const rendered = await renderAllSlides(slideInputs, carouselStyle, renderOptions);

  // Upload all PNGs to Supabase storage
  const slides = [];
  for (const { slide_number, png } of rendered) {
    const fileName = `carousel_${output.id}_slide_${slide_number}_${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from('content-media')
      .upload(fileName, png, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.error(`[TemplateRenderer] Failed to upload slide ${slide_number}:`, uploadError);
      slides.push({
        slide_number,
        type: slideContentData.find((s: any) => (s.slide_number || s.scene) === slide_number)?.type || 'content',
        headline: slideContentData.find((s: any) => (s.slide_number || s.scene) === slide_number)?.headline || '',
        body: slideContentData.find((s: any) => (s.slide_number || s.scene) === slide_number)?.body || '',
        status: 'rejected',
        error: uploadError.message,
      });
      continue;
    }

    const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
    console.log(`[TemplateRenderer] Slide ${slide_number} uploaded (${png.length} bytes): ${publicUrl}`);

    const sourceSlide = slideContentData.find((s: any) => (s.slide_number || s.scene) === slide_number);
    slides.push({
      slide_number,
      type: sourceSlide?.type || 'content',
      headline: sourceSlide?.headline || '',
      body: sourceSlide?.body || '',
      image_url: publicUrl,
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
  }

  console.log(`[TemplateRenderer] All ${slides.length} slides rendered and uploaded`);

  return {
    slides,
    style: carouselStyle,
    slideCount: slides.length,
    model: 'satori/resvg-wasm',
    started_at: new Date().toISOString(),
    cost: 0,
    status: 'awaiting_approval',
  };
}

// ============= CAROUSEL SLIDES STAGE (LEGACY - Replicate/Flux) =============
async function executeCarouselSlidesStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  decryptedKey: string,
  regenerate_slide?: number,
  custom_prompt?: string,
  instructions?: string
): Promise<any> {
  console.log('Executing carousel slides generation stage...');

  // Get visual style from brand voice library element (which contains visual identity fields)
  const libraryElements = output.generation_params?.library_elements || {};

  // Brand voice is stored under different keys depending on how it was passed
  const brandVoice = libraryElements.library_brand_voices || libraryElements.brand_voice || libraryElements.brand;

  // Build style object from brand voice visual identity fields
  const carouselStyle: any = {};
  if (brandVoice) {
    console.log('Found brand voice for carousel style:', brandVoice.name);

    // color_palette can be object with primary/secondary/background or a string
    const colorPalette = brandVoice.color_palette;
    if (colorPalette) {
      if (typeof colorPalette === 'object') {
        carouselStyle.palette = colorPalette;
      } else {
        // If it's a string, try to parse it
        try {
          carouselStyle.palette = JSON.parse(colorPalette);
        } catch {
          carouselStyle.palette = { description: colorPalette };
        }
      }
    }

    carouselStyle.fontStyle = brandVoice.font_style;
    carouselStyle.accentStyle = brandVoice.accent_style;
    carouselStyle.visualStyle = brandVoice.visual_style_description || brandVoice.visual_style;
    carouselStyle.moodKeywords = brandVoice.mood_keywords;
    carouselStyle.template = brandVoice.visual_template || 'professional';
  }

  // Also check output_config for aspect ratio
  const outputConfig = output.generation_params?.output_config || {};
  carouselStyle.aspectRatio = outputConfig.aspectRatio || '1:1';

  // Apply custom palette overrides from blueprint output_config
  if (outputConfig.customPalette) {
    const cp = outputConfig.customPalette;
    console.log('[CarouselSlides] Applying custom palette overrides');
    carouselStyle.palette = {
      ...(carouselStyle.palette || {}),
      ...(cp.primary && { primary: cp.primary }),
      ...(cp.secondary && { secondary: cp.secondary }),
      ...(cp.background && { background: cp.background }),
      ...(cp.text && { text: cp.text }),
      ...(cp.accent && { accent: cp.accent }),
    };
  }
  if (outputConfig.backgroundImageUrl) {
    carouselStyle.backgroundImage = outputConfig.backgroundImageUrl;
  }

  const visualStyleSuffix = buildCarouselVisualStyleSuffix(carouselStyle);
  console.log('Carousel visual style suffix:', visualStyleSuffix);

  // Build context for variable substitution (still needed for any runtime additions)
  const promptContext = buildCarouselPromptContext(output, configuration);

  // Get slide prompts from carousel_slide_prompts stage (NEW: prompts are pre-generated with image_prompt template)
  // Fall back to carousel_content for backwards compatibility with existing jobs
  console.log('[executeCarouselSlidesStage] stage_data keys:', Object.keys(output.stage_data || {}));
  console.log('[executeCarouselSlidesStage] carousel_slide_prompts data:', JSON.stringify(output.stage_data?.carousel_slide_prompts, null, 2)?.substring(0, 500));
  console.log('[executeCarouselSlidesStage] carousel_content data:', JSON.stringify(output.stage_data?.carousel_content, null, 2)?.substring(0, 500));

  const slidePromptData = output.stage_data?.carousel_slide_prompts?.slides || [];
  const slideContentData = output.stage_data?.carousel_content?.slides || output.stage_data?.carousel_content?.scenes || [];

  console.log(`[executeCarouselSlidesStage] slidePromptData count: ${slidePromptData.length}`);
  console.log(`[executeCarouselSlidesStage] slideContentData count: ${slideContentData.length}`);

  // Use slide_prompts if available (new flow), otherwise fall back to carousel_content (old flow)
  const slideContent = slidePromptData.length > 0 ? slidePromptData : slideContentData;

  if (!slideContent.length) {
    throw new Error('No slide content found for carousel generation - ensure carousel_slide_prompts stage completed');
  }

  console.log(`[executeCarouselSlidesStage] Using ${slidePromptData.length > 0 ? 'carousel_slide_prompts' : 'carousel_content (legacy)'} for image prompts, ${slideContent.length} slides to process`);

  // Handle single slide regeneration
  if (regenerate_slide !== undefined) {
    console.log(`🔄 Regenerating single carousel slide: ${regenerate_slide}`);
    const existingSlides = output.stage_data?.carousel_slides?.slides || [];
    // Support both slide_number and scene properties
    const targetSlide = slideContent.find((s: any) => (s.slide_number || s.scene) === regenerate_slide);

    if (!targetSlide) {
      throw new Error(`Slide ${regenerate_slide} not found`);
    }

    // Build the final prompt using master prompt + scene prompt + visual style
    // NEW: Use the pre-generated prompt from carousel_slide_prompts stage
    // The prompt is already fully resolved with variables and styled
    let finalPrompt: string;
    if (custom_prompt) {
      // For custom prompts, add anti-collage prefix and visual style
      finalPrompt = `Single Instagram carousel slide, one unified composition, NOT a collage. ${custom_prompt}`;
      if (visualStyleSuffix) {
        finalPrompt = `${finalPrompt}. ${visualStyleSuffix}`;
      }
    } else {
      // Use the pre-generated prompt directly (already includes style and variables)
      finalPrompt = targetSlide.prompt || `Single Instagram carousel slide ${regenerate_slide}, clean composition`;
      // Only add visual style if the prompt doesn't already have style indicators
      if (visualStyleSuffix && !finalPrompt.toLowerCase().includes('style')) {
        finalPrompt = `${finalPrompt}. ${visualStyleSuffix}`;
      }
    }

    if (instructions && instructions.trim()) {
      finalPrompt = `${finalPrompt}. Additional instructions: ${instructions}`;
    }

    const modelId = configuration?.model_config?.image_generator?.model_id || 'black-forest-labs/flux-schnell';
    const imageParams = configuration?.model_config?.image_generator?.parameters || {};

    // Extract reference images from generation_params
    // Check multiple possible keys for both image_inputs and library_elements
    const regenImageInputs = output.generation_params?.image_inputs || {};

    const referenceImages = extractReferenceImages(regenImageInputs, libraryElements);

    if (referenceImages.length > 0) {
      console.log(`Using reference image(s) for slide regeneration:`, referenceImages);
    } else {
      console.log('No reference images found for slide regeneration');
    }

    // Determine aspect ratio from carousel style
    const carouselAspectRatio = carouselStyle.aspectRatio || '1:1';
    const aspectRatio = ASPECT_RATIO_MAP[carouselAspectRatio] || carouselAspectRatio;

    const semanticInput: UserInput = {
      main_prompt: finalPrompt,
      aspect_ratio: aspectRatio,
      resolution_tier: imageParams.resolution_tier || 'HD',
      steps: imageParams.steps,
      guidance: imageParams.guidance_scale,
    };

    // Add reference images as image_input array (model expects array, not single string)
    if (referenceImages.length > 0) {
      semanticInput.image_input = referenceImages;
    }

    const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_generator');

    let payload: Record<string, any>;
    if (capabilities) {
      const result = buildPayload(capabilities, semanticInput);
      payload = result.payload;
    } else {
      payload = { prompt: finalPrompt, num_outputs: 1 };
    }

    console.log(`Built carousel slide ${regenerate_slide} regeneration payload:`, JSON.stringify(payload, null, 2));

    const { prediction_id } = await startReplicatePrediction(
      supabase,
      output.id,
      decryptedKey,
      modelId,
      payload,
      {
        stage_id: stageId,
        item_type: 'carousel_slide',
        scene_number: regenerate_slide,
        extra_data: { prompt: finalPrompt, slide_type: targetSlide.type }
      }
    );

    const updatedSlides = existingSlides.map((s: any) =>
      s.slide_number === regenerate_slide
        ? { ...s, prediction_id, status: 'generating', image_url: null, started_at: new Date().toISOString() }
        : s
    );

    return {
      slides: updatedSlides,
      style: carouselStyle,
      model: modelId,
      status: 'generating',
      cost: 0
    };
  }

  // Generate all slides
  const slides = [];
  const modelId = configuration?.model_config?.image_generator?.model_id || 'black-forest-labs/flux-schnell';
  const imageParams = configuration?.model_config?.image_generator?.parameters || {};
  const carouselAspectRatio = carouselStyle.aspectRatio || '1:1';
  const aspectRatio = ASPECT_RATIO_MAP[carouselAspectRatio] || carouselAspectRatio;

  // Extract reference images from generation_params
  // Check multiple possible keys for both image_inputs and library_elements
  const imageInputs = output.generation_params?.image_inputs || {};

  const referenceImages = extractReferenceImages(imageInputs, libraryElements);

  if (referenceImages.length > 0) {
    console.log(`Using reference image(s) for carousel slides:`, referenceImages);
  } else {
    console.log('No reference images found for carousel slides - story consistency may vary');
  }

  for (const slide of slideContent) {
    // Support both slide_number and scene properties
    const slideNumber = slide.slide_number || slide.scene;
    console.log(`Generating image for carousel slide ${slideNumber}:`, slide.prompt?.substring(0, 50));

    try {
      // NEW: Use the pre-generated prompt from carousel_slide_prompts stage directly
      // The prompt is already fully resolved with variables and styled from the image_prompt template
      let slidePrompt = slide.prompt || `Single Instagram carousel slide ${slideNumber}, clean composition`;

      // Only add visual style if the prompt doesn't already have style indicators
      if (visualStyleSuffix && !slidePrompt.toLowerCase().includes('style')) {
        slidePrompt = `${slidePrompt}. ${visualStyleSuffix}`;
      }

      console.log(`Carousel slide ${slideNumber} final prompt:`, slidePrompt.substring(0, 200));

      const semanticInput: UserInput = {
        main_prompt: slidePrompt,
        aspect_ratio: aspectRatio,
        resolution_tier: imageParams.resolution_tier || 'HD',
        steps: imageParams.steps,
        guidance: imageParams.guidance_scale,
      };

      // Add reference images as image_input array (model expects array, not single string)
      if (referenceImages.length > 0) {
        semanticInput.image_input = referenceImages;
      }

      const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_generator');

      let payload: Record<string, any>;
      if (capabilities) {
        const result = buildPayload(capabilities, semanticInput);
        payload = result.payload;
      } else {
        payload = { prompt: slidePrompt, num_outputs: 1 };
      }

      console.log(`Built carousel slide ${slideNumber} payload:`, JSON.stringify(payload, null, 2));

      const { prediction_id } = await startReplicatePrediction(
        supabase,
        output.id,
        decryptedKey,
        modelId,
        payload,
        {
          stage_id: stageId,
          item_type: 'carousel_slide',
          scene_number: slideNumber,
          extra_data: {
            prompt: slidePrompt,
            slide_type: slide.type,
            headline: slide.headline,
            body: slide.body
          }
        }
      );

      slides.push({
        slide_number: slideNumber,
        type: slide.type || 'content',
        headline: slide.headline,
        body: slide.body,
        ctaText: slide.ctaText,
        prompt: slidePrompt,
        prediction_id,
        status: 'generating',
        started_at: new Date().toISOString()
      });
    } catch (error: any) {
      console.error(`Error generating carousel slide ${slideNumber}:`, error);
      slides.push({
        slide_number: slideNumber,
        type: slide.type || 'content',
        headline: slide.headline,
        body: slide.body,
        prompt: slide.prompt,
        status: 'rejected',
        error: error.message
      });
    }
  }

  return {
    slides,
    style: carouselStyle,
    slideCount: slides.length,
    model: modelId,
    started_at: new Date().toISOString(),
    cost: 0,
    status: 'generating'
  };
}

async function executeImageStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  regenerate_scene?: number,
  custom_prompt?: string,
  instructions?: string
): Promise<any> {
  console.log('Executing image generation stage...');

  return await retryWithBackoff(async () => {
    const replicateKey = apiKeys.find(k => k.provider === 'replicate');
    // Replicate key is required for Replicate path, but optional when OpenRouter/OpenAI is primary provider.
    // Same default as the provider pick below: no image model configured → OpenRouter.
    const configuredImageGen = configuration?.model_config?.image_generator;
    const primaryImageProvider = configuredImageGen?.provider || (configuredImageGen?.model_id ? 'replicate' : 'openrouter');
    if (!replicateKey && primaryImageProvider !== 'openrouter' && primaryImageProvider !== 'openai') {
      throw new Error('Replicate API key not configured');
    }

    const decryptedKey = replicateKey ? await decryptApiKey(replicateKey.key_encrypted) : null;

    // Check if this is a carousel_slides stage (Instagram carousel)
    // Support both new flow (inputFrom carousel_slide_prompts) and legacy flow (inputFrom carousel_content)
    if (stageId === 'carousel_slides' && (stageConfig.inputFrom?.includes('carousel_slide_prompts') || stageConfig.inputFrom?.includes('carousel_content'))) {
      console.log('Generating carousel slide images');
      return await executeCarouselSlidesStage(
        output, stageId, stageConfig, configuration, apiKeys, supabase, decryptedKey,
        regenerate_scene, custom_prompt, instructions
      );
    }

    // Check if this is a storyboard stage (array-based image generation)
    // Supports scenes input from storyboard_video_longform
    if (stageId === 'storyboard' && (stageConfig.inputFrom?.includes('scene_prompts') || stageConfig.inputFrom?.includes('scenes'))) {
      // Handle single scene regeneration
      if (regenerate_scene !== undefined) {
        console.log(`🔄 Regenerating single storyboard scene: ${regenerate_scene}`);
        return await regenerateSingleStoryboardImage(
          output, stageId, configuration, apiKeys, supabase, decryptedKey,
          regenerate_scene, custom_prompt, instructions
        );
      }

      console.log('Generating storyboard images for multiple scenes');

      // Check for enhanced scenes first, then fall back to scene_prompts
      const enhancedScenes = output.stage_data?.scenes?.scenes || [];
      const legacyScenePrompts = output.stage_data?.scene_prompts?.scenes || [];
      const isEnhancedPipeline = enhancedScenes.length > 0 && stageConfig.inputFrom?.includes('scenes');

      // Normalize scenes to common format and sort by scene number
      // Sorting ensures scenes are processed in correct order regardless of how LLM returned them
      const scenePrompts = isEnhancedPipeline
        ? enhancedScenes.map((s: any) => ({
            scene: s.scene_number,
            prompt: s.image_prompt || s.prompt, // Use image_prompt for enhanced, fall back to prompt
            status: s.status
          })).sort((a: any, b: any) => (a.scene || 0) - (b.scene || 0))
        : [...legacyScenePrompts].sort((a: any, b: any) => (a.scene || 0) - (b.scene || 0));

      if (!scenePrompts.length) {
        throw new Error('No scene prompts found for storyboard generation');
      }

      console.log(`[storyboard] Processing ${scenePrompts.length} scenes (sorted by scene number)`);
      console.log(`[storyboard] Scene order: ${scenePrompts.map((s: any) => s.scene).join(', ')}`);

      // Check if the scenes STAGE is approved (not individual items)
      // When user approves the whole scenes stage, we process all scenes
      const scenesStageStatus = output.stage_data?.scenes?.status;
      const isStageApproved = scenesStageStatus === 'approved';

      // For enhanced pipeline:
      // - If stage is approved, process all non-excluded scenes
      // - Otherwise, only process individually approved scenes (for selective regeneration)
      // - Always skip excluded/failed scenes
      const excludedScenes = scenePrompts.filter((s: any) => s.status === 'excluded' || s.status === 'failed');
      const availableScenes = scenePrompts.filter((s: any) => s.status !== 'excluded' && s.status !== 'failed');

      if (excludedScenes.length > 0) {
        const excludedNumbers = excludedScenes.map((s: any) => s.scene || s.scene_number).join(', ');
        console.log(`⚠️ Skipping excluded/failed scenes: ${excludedNumbers}`);
      }

      const scenesToProcess = isEnhancedPipeline
        ? (isStageApproved
            ? availableScenes // Process all non-excluded when stage is approved
            : availableScenes.filter((s: any) => s.status === 'ready' || s.status === 'approved' || !s.status))
        : availableScenes;

      if (isEnhancedPipeline && scenesToProcess.length === 0) {
        throw new Error('No ready scenes found. Please wait for scenes to complete before generating storyboard.');
      }

      console.log(`Processing ${scenesToProcess.length} scenes for storyboard (stage status: ${scenesStageStatus}, ${excludedScenes.length} excluded)`)

      const scenes = [];
      const modelId = configuration?.model_config?.image_generator?.model_id || 'black-forest-labs/flux-schnell';

      // Get blueprint's image_prompt template and library elements for prompt enhancement
      const imagePromptTemplate = configuration?.image_prompt || output.generation_params?.image_prompt;
      const libraryElements = output.generation_params?.library_elements || {};

      // Build style suffix from blueprint template if available
      let styleSuffix = '';
      if (imagePromptTemplate) {
        // Resolve variables in template
        const brandVoice = getBrandVoice(libraryElements);
        const product = libraryElements.product ? (Array.isArray(libraryElements.product) ? libraryElements.product[0] : libraryElements.product) : null;
        const character = libraryElements.character ? (Array.isArray(libraryElements.character) ? libraryElements.character[0] : libraryElements.character) : null;
        const block = libraryElements.block;

        styleSuffix = imagePromptTemplate;
        if (brandVoice?.name) styleSuffix = styleSuffix.replace(/\{\{brand_voice\.name\}\}/gi, brandVoice.name);
        if (brandVoice?.visual_style) styleSuffix = styleSuffix.replace(/\{\{brand_voice\.visual_style\}\}/gi, brandVoice.visual_style);
        if (brandVoice?.tone) styleSuffix = styleSuffix.replace(/\{\{brand_voice\.tone\}\}/gi, brandVoice.tone);
        if (product?.name) styleSuffix = styleSuffix.replace(/\{\{product\.name\}\}/gi, product.name);
        if (product?.description) styleSuffix = styleSuffix.replace(/\{\{product\.description\}\}/gi, product.description);
        if (character?.name) styleSuffix = styleSuffix.replace(/\{\{character\.name\}\}/gi, character.name);
        if (character?.visual_description) styleSuffix = styleSuffix.replace(/\{\{character\.visual_description\}\}/gi, character.visual_description);
        // Handle block library elements (visual style blocks)
        if (block?.content) {
          styleSuffix = styleSuffix.replace(/\{\{block\.content\}\}/gi, block.content);
          console.log(`[storyboard] Resolved {{block.content}} with ${block.content.length} chars`);
        }
        if (block?.name) styleSuffix = styleSuffix.replace(/\{\{block\.name\}\}/gi, block.name);
        styleSuffix = styleSuffix.replace(/\{\{[^}]+\}\}/g, ''); // Clean unresolved placeholders

        console.log(`Using image_prompt template style suffix: ${styleSuffix.substring(0, 100)}...`);
      }

      // Generate image for each scene prompt
      for (const scenePrompt of scenesToProcess) {
        // Combine scene prompt with style suffix if available
        // Note: styleSuffix already includes "Style: " prefix from buildCarouselVisualStyleSuffix()
        const finalPrompt = styleSuffix
          ? `${scenePrompt.prompt}. ${styleSuffix}`
          : scenePrompt.prompt;

        console.log(`Generating image for scene ${scenePrompt.scene}:`, finalPrompt.substring(0, 200));

        try {
          // Build payload using payload builder
          const imageParams = configuration?.model_config?.image_generator?.parameters || {};

          // Get reference images from generation_params
          const imageInputs = output.generation_params?.image_inputs || {};

          // Extract aspect ratio - output_config (user selection) takes priority over video_config defaults
          // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
          const videoConfig = output.generation_params?.video_config;
          const outputConfig = output.generation_params?.output_config;
          const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
            || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
            || imageParams.aspect_ratio;
          const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;
          console.log(`[storyboard] Aspect ratio debug: outputConfig=${outputConfig?.aspectRatio || outputConfig?.aspect_ratio}, videoConfig=${videoConfig?.aspectRatio || videoConfig?.aspect_ratio}, raw=${rawAspectRatio}, mapped=${aspectRatio}`);

          const semanticInput: UserInput = {
            main_prompt: finalPrompt,
            ...(aspectRatio && { aspect_ratio: aspectRatio }),
            resolution_tier: imageParams.resolution_tier || 'HD',
            steps: imageParams.steps,
            guidance: imageParams.guidance_scale,
            seed: imageParams.seed,
            negative_prompt: imageParams.negative_prompt
          };
          
          // Extract reference images - check both imageInputs AND library_elements
          const referenceImages = extractReferenceImages(imageInputs, libraryElements);
          
          // Add reference images as image_input array (some models like nano-banana-pro expect array)
          if (referenceImages.length > 0) {
            semanticInput.image_input = referenceImages;
            console.log(`Using reference images: ${referenceImages.join(', ')}`);
          }

          const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_generator');

          let payload: Record<string, any>;
          if (capabilities) {
            const result = buildPayload(capabilities, semanticInput);
            if (result.warnings.length > 0) {
              console.warn('Payload builder warnings:', result.warnings);
            }
            payload = result.payload;
          } else {
            // Fallback to basic parameters if schema not available
            payload = {
              prompt: scenePrompt.prompt,
              num_outputs: 1
            };
          }

          console.log(`Built image payload:`, JSON.stringify(payload, null, 2));

          // Start async prediction with webhook - retry on 502 errors
          const startPrediction = async () => {
            return await startReplicatePrediction(
              supabase,
              output.id,
              decryptedKey,
              modelId,
              payload,
              {
                stage_id: stageId,
                item_type: 'image',
                scene_number: scenePrompt.scene,
                extra_data: { prompt: scenePrompt.prompt }
              }
            );
          };

          const { prediction_id } = await retryWithBackoff(
            startPrediction,
            `Image scene ${scenePrompt.scene}`,
            5 // More retries for 502 errors
          );

          // Add to scenes array with generating status
          scenes.push({
            scene_number: scenePrompt.scene,
            prompt: scenePrompt.prompt,
            prediction_id,
            status: 'generating',
            is_uploaded: false
          });
        } catch (error: any) {
          console.error(`Error generating scene ${scenePrompt.scene}:`, error);
          scenes.push({
            scene_number: scenePrompt.scene,
            prompt: scenePrompt.prompt,
            status: 'rejected',
            error: error.message
          });
        }
      }

      // All predictions started - webhook will update with results
      const estimatedCost = calculateReplicateCost(modelId, 'image') * scenes.length;
      console.log(`Storyboard generation started. ${scenes.length} scenes queued, estimated cost: $${estimatedCost.toFixed(4)}`);

      return {
        scenes,
        model: modelId,
        started_at: new Date().toISOString(),
        cost: 0, // Cost will be calculated when webhook completes
        status: 'generating'
      };
    }

    // Single image generation
    let prompt = '';
    const pipeline = output.pipeline || configuration?.pipeline;

    // Use custom_prompt if provided (for regeneration), otherwise get from stage data
    if (custom_prompt) {
      prompt = custom_prompt;
      console.log(`[image] Using custom prompt for regeneration: ${prompt.substring(0, 200)}...`);
    } else if (pipeline === 'image_only') {
      // For image_only pipeline, use the resolved image_prompt directly
      // The image_prompt should have variables already resolved by dispatch-generation-job
      prompt = output.generation_params?.resolved_image_prompt ||
               output.generation_params?.image_prompt ||
               configuration?.image_prompt || '';
      if (prompt) prompt = withPresetLook(prompt, output);
      console.log(`[image_only] Using resolved image prompt: ${prompt.substring(0, 200)}...`);
    } else if (stageConfig.inputFrom?.length) {
      // Standard behavior: get prompt from previous stage
      const inputStage = stageConfig.inputFrom[0];
      prompt = getStageText(output.stage_data?.[inputStage]);
    }

    if (!prompt) {
      // generation_params.prompt is the post's writing brief, not a picture:
      // image models given it write the post as text and return no image.
      // Describe the post instead; image_only's prompt is already a picture.
      const caption = getStageText(output.stage_data?.caption);
      prompt = pipeline === 'image_only'
        ? output.generation_params?.prompt || 'A beautiful image'
        : caption
          ? `An engaging, on-brand image to go with this social media post. Show the idea visually; do not reproduce the post's text.\n\nPost:\n${caption.slice(0, 1500)}`
          : 'A clean, professional image for a social media post';
      console.warn(`[image] No image prompt from ${stageConfig.inputFrom?.[0] ?? 'previous stage'}; using a caption-based description`);
    }

    // Apply instructions if provided (for regeneration)
    if (instructions && instructions.trim()) {
      prompt = `${prompt}\n\nAdditional instructions: ${instructions.trim()}`;
      console.log(`[image] Applied regeneration instructions to prompt`);
    }

    // No image model on the blueprint → the platform default on OpenRouter (the
    // key social posts already require). It used to be Replicate flux-schnell,
    // which failed on most workspaces (no Replicate credit): 105 of 118 such
    // runs failed in 90 days. A model_id without a provider keeps the legacy
    // Replicate assumption.
    const configuredImage = configuration?.model_config?.image_generator;
    const modelId = configuredImage?.model_id || DEFAULT_IMAGE_MODEL;
    const imageProvider = configuredImage?.provider || (configuredImage?.model_id ? 'replicate' : 'openrouter');

    // Build payload using payload builder
    const imageParams = configuredImage?.parameters || {};

    // Reference images. Blueprints with image_references (role mode) send exactly
    // those, labelled by role; others keep the legacy library-image extraction.
    const imageInputs = output.generation_params?.image_inputs || {};
    const libraryElements = output.generation_params?.library_elements || {};
    const imageUsageMode = output.generation_params?.image_usage_mode;
    const refModelConfig = output.generation_params?.model_config || configuration?.model_config;
    const roleMode = hasRoleReferences(refModelConfig);
    const roleReferences: ResolvedReference[] = roleMode ? resolveRoleReferences(refModelConfig, libraryElements, { required: true }) : [];
    const referenceImages = roleMode
      ? roleReferences.flatMap((r) => r.urls)
      : extractReferenceImages(imageInputs, libraryElements, imageUsageMode);
    // The style reference in words, so the closing instruction backs the image
    // up: reuse the image-plan stage's description, or describe it now
    // (template image prompts, image_only, regenerations).
    let styleReference = '';
    if (roleReferences.some((r) => r.role === 'style' || r.role === 'remake')) {
      styleReference = String(output.stage_data?.image_prompt?.style_reference || '');
      // A look saved with its description (no base image to describe) needs no vision call.
      if (!styleReference && !roleReferences.some((r) => r.role === 'remake')) {
        styleReference = String(refModelConfig?.look_style_description || '').trim();
      }
      // The plan was written looking at the reference, so its words already carry the look.
      const planSawReferences = !custom_prompt && output.stage_data?.image_prompt?.references_seen === true;
      const orKey = !styleReference && !planSawReferences ? apiKeys.find((k: { provider: string }) => k.provider === 'openrouter') : null;
      if (orKey) styleReference = await describeStyleReference(roleReferences, await decryptApiKey(orKey.key_encrypted));
    }
    // Providers without interleaved image+text get the role instructions in the prompt.
    const promptWithReferenceRoles = roleReferences.length ? withReferenceRequirements(`${referencesAsText(roleReferences, styleReference)}\n\n${prompt}`, roleReferences, styleReference) : prompt;

    // Extract aspect ratio. Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats.
    const videoConfig = output.generation_params?.video_config;
    const outputConfig = output.generation_params?.output_config;

    // Priority: blueprint's own image_generator.parameters.aspect_ratio (an explicit,
    // deliberate per-blueprint choice) > output_config/video_config (the wizard's generic
    // Output Format step, which defaults to "landscape" on every run whether or not anyone
    // actually chose it — it must not silently clobber a blueprint that configured its own
    // image aspect ratio, e.g. a reference-image-reproduction blueprint set to 4:3).
    const rawAspectRatio = imageParams.aspect_ratio
      || outputConfig?.aspectRatio || outputConfig?.aspect_ratio
      || videoConfig?.aspectRatio || videoConfig?.aspect_ratio;

    console.log(`📐 [Image Stage] outputConfig:`, JSON.stringify(outputConfig));
    console.log(`📐 [Image Stage] videoConfig:`, JSON.stringify(videoConfig));
    console.log(`📐 [Image Stage] rawAspectRatio:`, rawAspectRatio);
    const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;
    console.log(`📐 [Image Stage] final aspectRatio:`, aspectRatio);

    // OpenRouter path: synchronous image generation (no webhook needed)
    // When the blueprint explicitly requests OpenRouter we must NOT silently fall back to
    // Replicate — that would charge a paid provider the user did not opt in to.
    if (imageProvider === 'openrouter') {
      const openRouterKey = apiKeys.find(k => k.provider === 'openrouter');
      if (!openRouterKey) {
        throw new Error('OpenRouter API key is required for this blueprint (image_generator.provider="openrouter"). Please add an OpenRouter key in Settings > API Keys.');
      }

      const decryptedOpenRouterKey = await decryptApiKey(openRouterKey.key_encrypted);
      const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';

      console.log(`[image] Using OpenRouter provider for model ${modelId}`);
      const result = await generateImageViaOpenRouter(
        supabase,
        output.id,
        decryptedOpenRouterKey,
        modelId,
        prompt,
        {
          aspectRatio,
          supabaseUrl,
          referenceImages,
          labeledReferences: roleReferences,
          styleReference,
          background: imageParams.background,
        }
      );

      return {
        url: result.url,
        image_url: result.url,
        prompt,
        model: result.model,
        cost: result.cost,
        status: 'awaiting_approval',
        ...(styleReference ? { style_reference: styleReference } : {}),
      };
    }

    // Direct OpenAI path: synchronous image generation via the Responses API
    // (image_generation tool). No webhook needed — same shape as the OpenRouter
    // branch above. Real aspect-ratio control (unlike OpenRouter's chat-completions
    // route for image models, which doesn't honor an aspect_ratio parameter at all).
    if (imageProvider === 'openai') {
      const openaiKey = apiKeys.find(k => k.provider === 'openai');
      if (!openaiKey) {
        throw new Error('OpenAI API key is required for this blueprint (image_generator.provider="openai"). Please add an OpenAI key in Settings > API Keys.');
      }

      const decryptedOpenAIKey = await decryptApiKey(openaiKey.key_encrypted);
      const openaiModelId = modelId || DEFAULT_OPENAI_IMAGE_MODEL;

      console.log(`[image] Using OpenAI provider for model ${openaiModelId}`);
      const provider = new OpenAIImageProvider(decryptedOpenAIKey);
      const image = await provider.generate(promptWithReferenceRoles, openaiModelId, {
        aspectRatio,
        quality: imageParams.quality,
        background: imageParams.background,
        outputFormat: imageParams.output_format,
        referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
      });

      const fileName = `${output.id}/image_${Date.now()}.${(imageParams.output_format || 'png')}`;
      const url = await OpenAIImageProvider.uploadBase64ToStorage(
        supabase,
        image.base64,
        fileName,
        image.mimeType,
      );

      return {
        url,
        image_url: url,
        prompt,
        model: openaiModelId,
        // OpenAI doesn't return per-call cost in the Responses API response;
        // this is a rough estimate for display purposes only.
        cost: 0.07,
        status: 'awaiting_approval',
      };
    }

    // Replicate path: async prediction with webhook
    if (!decryptedKey) {
      throw new Error('Replicate API key not configured');
    }

    const replicateModelId = modelId;

    const semanticInput: UserInput = {
      main_prompt: promptWithReferenceRoles,
      ...(aspectRatio && { aspect_ratio: aspectRatio }),
      resolution_tier: imageParams.resolution_tier || 'HD',
      steps: imageParams.steps,
      guidance: imageParams.guidance_scale,
      seed: imageParams.seed,
      negative_prompt: imageParams.negative_prompt
    };

    // Add reference images using correct semantic key (image_input, not reference_images)
    // Models define image_input in their normalized_capabilities.roles
    if (referenceImages.length > 0) {
      semanticInput.image_input = referenceImages;
    }

    const capabilities = await ensureModelSchema(supabase, 'replicate', replicateModelId, 'image_generator');

    let payload: Record<string, any>;
    if (capabilities) {
      const result = buildPayload(capabilities, semanticInput);
      if (result.warnings.length > 0) {
        console.warn('Payload builder warnings:', result.warnings);
      }
      payload = result.payload;
    } else {
      // Fallback to basic parameters if schema not available
      console.warn(`Schema not available for replicate/${replicateModelId}, using basic parameters`);
      payload = {
        prompt: prompt,
        num_outputs: 1
      };
    }

    console.log(`Built image payload:`, JSON.stringify(payload, null, 2));

    // Start async prediction with webhook - retry on 502 errors
    const startPrediction = async () => {
      return await startReplicatePrediction(
        supabase,
        output.id,
        decryptedKey,
        replicateModelId,
        payload,
        {
          stage_id: stageId,
          item_type: 'image',
          extra_data: { prompt }
        }
      );
    };

    const { prediction_id } = await retryWithBackoff(
      startPrediction,
      'Single image generation',
      5 // More retries for 502 errors
    );

    console.log(`Single image generation started. Prediction ID: ${prediction_id}`);

    return {
      prediction_id,
      prompt,
      model: modelId,
      status: 'generating',
      cost: 0 // Cost calculated on webhook completion
    };
  }, 'Image generation');
}

async function executeI2VStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  regenerate_clip?: number
): Promise<any> {
  console.log('Executing image-to-video stage...');
  
  return await retryWithBackoff(async () => {
    const replicateKey = apiKeys.find(k => k.provider === 'replicate');
    if (!replicateKey) {
      throw new Error('Replicate API key not configured');
    }

    const decryptedKey = await decryptApiKey(replicateKey.key_encrypted);
    
    // Check if this is a clips stage with storyboard scenes (array-based video generation)
    if (stageId === 'clips' && stageConfig.inputFrom?.includes('storyboard')) {
      console.log('Generating video clips for storyboard scenes');
      const storyboardData = output.stage_data?.storyboard || {};
      const scenes = storyboardData.scenes || [];
      
      if (!scenes.length) {
        throw new Error('No storyboard scenes found for clip generation');
      }

      // If regenerating a single clip, use the existing clip's source_image
      // (storyboard scene may have been cleared/reset, but clip keeps source_image)
      let scenesToProcess = scenes;
      if (regenerate_clip !== undefined) {
        console.log(`🔄 Regenerating single clip: ${regenerate_clip}`);

        // First, check if we have an existing clip with source_image
        const existingClip = (output.stage_data?.clips?.clips || []).find(
          (c: any) => c.scene_number === regenerate_clip
        );

        if (existingClip?.source_image) {
          // Use existing clip's source_image instead of storyboard scene
          console.log(`Using existing clip's source_image: ${existingClip.source_image}`);
          const storyboardScene = scenes.find((s: any) => s.scene_number === regenerate_clip);
          scenesToProcess = [{
            ...storyboardScene,
            scene_number: regenerate_clip,
            image_url: existingClip.source_image,
            prompt: existingClip.prompt || storyboardScene?.prompt
          }];
        } else {
          // Fall back to storyboard scene
          scenesToProcess = scenes.filter((s: any) => s.scene_number === regenerate_clip);

          if (scenesToProcess.length === 0) {
            throw new Error(`Scene ${regenerate_clip} not found`);
          }
        }
      } else {
        // Filter out excluded/failed scenes and check for pending ones
        // Accept both 'ready' (auto-approved after generation) and 'approved' (manually approved) statuses
        const excludedScenes = scenes.filter((s: any) => s.status === 'excluded' || s.status === 'failed');
        const readyScenes = scenes.filter((s: any) => s.status === 'ready' || s.status === 'approved');
        const generatingScenes = scenes.filter((s: any) => s.status === 'generating');

        if (excludedScenes.length > 0) {
          const excludedNumbers = excludedScenes.map((s: any) => s.scene_number).join(', ');
          console.log(`⚠️ Skipping excluded/failed scenes: ${excludedNumbers}`);
        }

        if (readyScenes.length === 0) {
          throw new Error('No ready scenes available for clip generation');
        }

        if (generatingScenes.length > 0) {
          throw new Error(`Cannot generate clips: ${generatingScenes.length} scenes still generating. Wait for storyboard images to complete.`);
        }

        // Only process ready/approved scenes
        scenesToProcess = readyScenes;
      }

      // Get existing clips if regenerating (preserve other clips)
      const existingClips = output.stage_data?.clips?.clips || [];
      const clips = regenerate_clip !== undefined ? [...existingClips] : [];
      
      const modelId = configuration?.model_config?.image_to_video?.model_id || 'kwaivgi/kling-v2.5-turbo-pro';
      const sceneDuration = output.generation_params?.video_config?.sceneDuration || 5;

      // Get enhanced scenes data if available
      const enhancedScenesData = output.stage_data?.scenes?.scenes || [];

      // Get voice segments data - we'll use actual TTS duration to set clip duration
      // This ensures video clips match narration length instead of cutting off audio
      const voiceSegmentsData = output.stage_data?.voice_segments?.segments || [];

      // Generate video clip for each scene in scenesToProcess
      for (const scene of scenesToProcess) {
        // Skip scenes without images (ready/approved but image generation failed or not yet complete)
        if (!scene.image_url) {
          console.log(`Skipping scene ${scene.scene_number}: no image available`);
          continue;
        }

        console.log(`Generating clip for scene ${scene.scene_number}:`, scene.image_url);

        // Look up enhanced scene config for motion parameters
        const enhancedSceneConfig = enhancedScenesData.find((s: any) => s.scene_number === scene.scene_number);
        const hasEnhancedConfig = !!enhancedSceneConfig;

        // Look up voice segment for this scene to get actual TTS duration
        const voiceSegment = voiceSegmentsData.find((s: any) => s.scene_number === scene.scene_number);

        try {
          // Build payload using payload builder
          const i2vParams = configuration?.model_config?.image_to_video?.parameters || {};

          // Extract reference images from library elements (products and characters)
          const imageInputs = output.generation_params?.image_inputs || {};
          const libraryElements = output.generation_params?.library_elements || {};
          const imageUsageMode = output.generation_params?.image_usage_mode;
          const referenceImages = extractReferenceImages(imageInputs, libraryElements, imageUsageMode);

          // Extract aspect ratio for I2V models that support it
          // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
          const videoConfig = output.generation_params?.video_config;
          const outputConfig = output.generation_params?.output_config;
          const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
            || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
            || i2vParams.aspect_ratio;
          const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;
          console.log(`[I2V] Aspect ratio debug: outputConfig=${outputConfig?.aspectRatio || outputConfig?.aspect_ratio}, videoConfig=${videoConfig?.aspectRatio || videoConfig?.aspect_ratio}, raw=${rawAspectRatio}, mapped=${aspectRatio}`);

          // Clip duration priority:
          // 1. Voice segment actual_duration (ensures video matches narration length)
          // 2. Enhanced scene duration_seconds (LLM-generated estimate)
          // 3. Full voiceover clip_duration (Wan 2.5 supports 5 or 10s)
          // 4. I2V model parameters
          // 5. Default scene duration (10s for Wan 2.5 compatibility)
          const voiceDuration = voiceSegment?.duration || voiceSegment?.actual_duration;
          const fullVoiceoverDuration = output.stage_data?.full_voiceover?.clip_duration;
          const clipDuration = voiceDuration || enhancedSceneConfig?.duration_seconds || fullVoiceoverDuration || i2vParams.seconds || sceneDuration;

          if (voiceDuration) {
            console.log(`Scene ${scene.scene_number}: Using voice segment duration ${voiceDuration}s for clip`);
          }
          const motionBucketId = hasEnhancedConfig
            ? getMotionBucketId(enhancedSceneConfig.i2v_motion_type)
            : (i2vParams.motion_bucket_id || 50);

          const semanticInput: UserInput = {
            image_input: scene.image_url,
            seconds: clipDuration,
            fps: i2vParams.fps,
            motion_bucket_id: motionBucketId,
            // Include aspect ratio for I2V models that support it
            ...(aspectRatio && { aspect_ratio: aspectRatio }),
            // Include i2v_prompt for models that support prompt-based motion
            ...(enhancedSceneConfig?.i2v_prompt && { main_prompt: enhancedSceneConfig.i2v_prompt }),
            // Prevent speech/talking and loud noises in generated video clips - voiceover is added separately
            negative_prompt: 'speech, talking, moving lips, mouth movement, dialogue, singing, speaking, conversation, lip sync, loud noises, screaming, shouting, yelling, explosions, gunshots'
          };

          if (hasEnhancedConfig) {
            console.log(`Using enhanced scene config: motion_type=${enhancedSceneConfig.i2v_motion_type}, motion_bucket_id=${motionBucketId}, duration=${clipDuration}s`);
          }

          // For I2V, if we have reference images, use the first one as the source image
          if (referenceImages.length > 0 && !scene.image_url) {
            semanticInput.image_input = referenceImages[0];
            console.log(`Using reference image for I2V: ${referenceImages[0]}`);
          }

          const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_to_video');

          const result = buildPayload(capabilities!, semanticInput);
          if (result.warnings.length > 0) {
            console.warn('Payload builder warnings:', result.warnings);
          }
          const payload = result.payload;

          console.log(`Built I2V payload:`, JSON.stringify(payload, null, 2));

          // Start async prediction with webhook - retry on 502 errors
          const startPrediction = async () => {
            return await startReplicatePrediction(
              supabase,
              output.id,
              decryptedKey,
              modelId,
              payload,
              {
                stage_id: stageId,
                item_type: 'clip',
                scene_number: scene.scene_number,
                extra_data: {
                  prompt: scene.prompt,
                  source_image: scene.image_url,
                  duration: clipDuration
                }
              }
            );
          };

          const { prediction_id } = await retryWithBackoff(
            startPrediction,
            `I2V clip ${scene.scene_number}`,
            5 // More retries for 502 errors
          );

          // Build clip data with enhanced config if available
          const clipData = {
            scene_number: scene.scene_number,
            prediction_id,
            source_image: scene.image_url,
            duration: clipDuration,
            status: 'generating',
            prompt: scene.prompt,
            // Include enhanced motion data if available
            ...(hasEnhancedConfig && {
              i2v_motion_type: enhancedSceneConfig.i2v_motion_type,
              i2v_prompt: enhancedSceneConfig.i2v_prompt
            })
          };

          // If regenerating, replace the existing clip; otherwise add new
          if (regenerate_clip !== undefined) {
            const clipIndex = clips.findIndex((c: any) => c.scene_number === scene.scene_number);
            if (clipIndex >= 0) {
              clips[clipIndex] = clipData;
            } else {
              clips.push(clipData);
            }
          } else {
            clips.push(clipData);
          }
        } catch (error: any) {
          console.error(`Error generating clip for scene ${scene.scene_number}:`, error);
          
          if (regenerate_clip !== undefined) {
            const clipIndex = clips.findIndex((c: any) => c.scene_number === scene.scene_number);
            if (clipIndex >= 0) {
              clips[clipIndex] = {
                scene_number: scene.scene_number,
                source_image: scene.image_url,
                status: 'failed',
                error: error.message,
                prompt: scene.prompt
              };
            } else {
              clips.push({
                scene_number: scene.scene_number,
                source_image: scene.image_url,
                status: 'failed',
                error: error.message,
                prompt: scene.prompt
              });
            }
          } else {
            clips.push({
              scene_number: scene.scene_number,
              source_image: scene.image_url,
              status: 'failed',
              error: error.message,
              prompt: scene.prompt
            });
          }
        }
      }

      // All predictions started - webhook will update with results
      const newClipsCount = scenesToProcess.length;
      const estimatedCost = calculateReplicateCost(modelId, 'video') * newClipsCount;
      console.log(`I2V clip generation started. ${newClipsCount} clip(s) queued, estimated cost: $${estimatedCost.toFixed(4)}`);

      return {
        clips,
        model: modelId,
        started_at: new Date().toISOString(),
        cost: 0, // Cost calculated on webhook completion
        status: 'generating'
      };
    }

    // Single video generation (legacy behavior)
    const imageStage = stageConfig.inputFrom?.[0] || 'storyboard';
    const imageUrl = output.stage_data?.[imageStage]?.url;
    
    if (!imageUrl) {
      throw new Error(`Image not found in stage: ${imageStage}`);
    }

    const modelId = configuration?.model_config?.image_to_video?.model_id || 'kwaivgi/kling-v2.5-turbo-pro';

    // Build payload using payload builder
    const i2vParams = configuration?.model_config?.image_to_video?.parameters || {};

    // Extract reference images from library elements (products and characters)
    const imageInputs = output.generation_params?.image_inputs || {};
    const libraryElements = output.generation_params?.library_elements || {};
    const imageUsageMode = output.generation_params?.image_usage_mode;
    const referenceImages = extractReferenceImages(imageInputs, libraryElements, imageUsageMode);

    // Extract aspect ratio for I2V models that support it
    // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
    const videoConfig = output.generation_params?.video_config;
    const outputConfig = output.generation_params?.output_config;
    const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
      || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
      || i2vParams.aspect_ratio;
    const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;
    console.log(`[I2V single] Aspect ratio debug: outputConfig=${outputConfig?.aspectRatio || outputConfig?.aspect_ratio}, videoConfig=${videoConfig?.aspectRatio || videoConfig?.aspect_ratio}, raw=${rawAspectRatio}, mapped=${aspectRatio}`);

    const semanticInput: UserInput = {
      image_input: imageUrl,
      seconds: i2vParams.seconds || 3,
      fps: i2vParams.fps,
      motion_bucket_id: i2vParams.motion_bucket_id,
      ...(aspectRatio && { aspect_ratio: aspectRatio })
    };

    // For I2V, if we have reference images and no source image, use reference image
    if (referenceImages.length > 0 && !imageUrl) {
      semanticInput.image_input = referenceImages[0];
      console.log(`Using reference image for I2V: ${referenceImages[0]}`);
    }

    const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'image_to_video');

    const result = buildPayload(capabilities!, semanticInput);
    if (result.warnings.length > 0) {
      console.warn('Payload builder warnings:', result.warnings);
    }
    const payload = result.payload;

    console.log(`Built I2V payload:`, JSON.stringify(payload, null, 2));

    // Start async prediction with webhook - retry on 502 errors
    const startPrediction = async () => {
      return await startReplicatePrediction(
        supabase,
        output.id,
        decryptedKey,
        modelId,
        payload,
        {
          stage_id: stageId,
          item_type: 'video',
          extra_data: { source_image: imageUrl }
        }
      );
    };

    const { prediction_id } = await retryWithBackoff(
      startPrediction,
      'I2V single video',
      5 // More retries for 502 errors
    );

    console.log(`Single I2V generation started. Prediction ID: ${prediction_id}`);

    return {
      prediction_id,
      source_image: imageUrl,
      model: modelId,
      status: 'generating',
      cost: 0
    };
  }, 'Image-to-video generation');
}

async function executeWorldSimStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any,
  regenerate_clip?: number
): Promise<any> {
  console.log('Executing world simulator stage (Veo 3 / Sora 2)...');
  
  return await retryWithBackoff(async () => {
    const replicateKey = apiKeys.find(k => k.provider === 'replicate');
    if (!replicateKey) {
      throw new Error('Replicate API key not configured');
    }

    const decryptedKey = await decryptApiKey(replicateKey.key_encrypted);
    const modelId = configuration?.model_config?.world_simulator?.model_id || 'minimax/video-01';
    const sceneDuration = configuration?.scene_duration || 8;
    
    // Check if this is multi-scene generation (clips stage with scene_prompts input)
    if (stageId === 'clips' && stageConfig.inputFrom?.includes('scene_prompts')) {
      console.log('Generating multiple video clips from scene prompts using world simulator');
      
      const scenePromptsData = output.stage_data?.scene_prompts;
      if (!scenePromptsData || !scenePromptsData.scenes) {
        throw new Error('Scene prompts data not found');
      }
      
      const scenes = scenePromptsData.scenes || [];
      
      // If regenerating a single clip, filter to only that scene
      let scenesToProcess: any[];
      if (regenerate_clip !== undefined) {
        console.log(`🔄 Regenerating single clip: ${regenerate_clip}`);
        scenesToProcess = scenes.filter((s: any) => s.scene === regenerate_clip);
        
        if (scenesToProcess.length === 0) {
          throw new Error(`Scene ${regenerate_clip} not found`);
        }
      } else {
        // When generating all, only process ready/approved scenes (exclude failed/excluded)
        scenesToProcess = scenes.filter((s: any) =>
          (s.status === 'ready' || s.status === 'approved' || !s.status) &&
          s.status !== 'excluded' && s.status !== 'failed'
        );

        if (scenesToProcess.length === 0) {
          throw new Error('No ready scene prompts found for video generation');
        }
      }
      
      console.log(`Generating ${scenesToProcess.length} video clip(s) from scene prompts`);
      
      // Build capabilities once (shared across all scenes)
      const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'world_simulator');
      
      // Get existing clips if regenerating (preserve other clips)
      const existingClips = regenerate_clip !== undefined 
        ? (output.stage_data?.clips?.clips || [])
        : [];
      
      // Prepare all prediction requests in parallel (no sequential retries)
      // NOTE: We start predictions WITHOUT adding to pending_predictions to avoid race condition
      const predictionPromises = scenesToProcess.map(async (scene: any) => {
        try {
          console.log(`Preparing clip ${scene.scene} with prompt: ${scene.prompt.substring(0, 50)}...`);
          
          // Build payload using payload builder
          const worldSimParams = configuration?.model_config?.world_simulator?.parameters || {};

          // Get reference images from generation_params
          const imageInputs = output.generation_params?.image_inputs || {};
          const libraryElements = output.generation_params?.library_elements || {};

          // Extract aspect ratio - output_config (user selection) takes priority over video_config defaults
          // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
          const videoConfig = output.generation_params?.video_config;
          const outputConfig = output.generation_params?.output_config;
          const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
            || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
            || worldSimParams.aspect_ratio;
          const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;

          const semanticInput: UserInput = {
            main_prompt: scene.prompt,
            seconds: worldSimParams.seconds || sceneDuration,
            ...(aspectRatio && { aspect_ratio: aspectRatio }),
            resolution: worldSimParams.resolution || '1080p',
            ...(worldSimParams.input_reference && { image_input: worldSimParams.input_reference })
          };
          
          // Extract reference images - check both imageInputs AND library_elements
          let referenceImages: string[] = [];
          if (imageInputs.character?.length > 0) {
            referenceImages = imageInputs.character;
          } else if (libraryElements.character) {
            const char = Array.isArray(libraryElements.character) 
              ? libraryElements.character[0] 
              : libraryElements.character;
            if (char?.reference_images?.length > 0) {
              referenceImages = char.reference_images;
            }
          }
          
          // Add reference image as image_input (maps to input_reference for Sora/Veo)
          // Note: Sora/Veo only accept single image, not array
          if (referenceImages.length > 0) {
            semanticInput.image_input = referenceImages[0];
            console.log(`Using reference image: ${referenceImages[0]}`);
          }

          const { payload, missing_required, warnings } = buildPayload(capabilities!, semanticInput);

          if (missing_required.length > 0) {
            throw new Error(`Missing required parameters: ${missing_required.join(', ')}`);
          }

          if (warnings.length > 0) {
            console.warn('Payload builder warnings:', warnings);
          }

          console.log(`Built payload for ${modelId}:`, JSON.stringify(payload, null, 2));

          // Start Replicate prediction directly without database tracking
          // We'll add all predictions to pending_predictions in one atomic operation after
          const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
          const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;
          
          const startPrediction = async () => {
            const response = await fetch('https://api.replicate.com/v1/predictions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${decryptedKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                version: modelId,
                input: payload,
                webhook: webhookUrl,
                webhook_events_filter: ["completed"]
              })
            });
            
            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(`Replicate API error ${response.status}: ${errorBody}`);
            }
            
            return await response.json();
          };
          
          const prediction = await retryWithBackoff(
            startPrediction,
            `World simulator clip ${scene.scene}`,
            2 // Reduced to 2 attempts (1 initial + 1 retry) to prevent timeout
          );

          console.log(`✓ Prediction started: ${prediction.id}`);

          return {
            scene_number: scene.scene,
            prediction_id: prediction.id,
            prompt: scene.prompt,
            duration: sceneDuration,
            status: 'generating',
            model: modelId
          };
        } catch (error: any) {
          console.error(`Error generating clip for scene ${scene.scene}:`, error);
          return {
            scene_number: scene.scene,
            prompt: scene.prompt,
            status: 'failed',
            error: error.message
          };
        }
      });
      
      // Execute all predictions in parallel and wait for all to settle
      const results = await Promise.allSettled(predictionPromises);
      
      // Extract new clips from results (both successful and failed)
      const newClips = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        } else {
          // Promise itself rejected (shouldn't happen with try/catch above, but defensive)
          return {
            scene_number: scenesToProcess[index].scene,
            prompt: scenesToProcess[index].prompt,
            status: 'failed',
            error: result.reason?.message || 'Unknown error'
          };
        }
      });
      
      // If regenerating, merge with existing clips; otherwise use new clips
      let clips: any[];
      if (regenerate_clip !== undefined) {
        // Replace the regenerated clip in the existing array
        clips = existingClips.map((existingClip: any) => {
          const regeneratedClip = newClips.find((c: any) => c.scene_number === existingClip.scene_number);
          return regeneratedClip || existingClip;
        });
        
        // Add new clip if it didn't exist before
        const newClipNotInExisting = newClips.find(
          (c: any) => !existingClips.some((ec: any) => ec.scene_number === c.scene_number)
        );
        if (newClipNotInExisting) {
          clips.push(newClipNotInExisting);
        }
      } else {
        clips = newClips;
      }
      
      // Now add prediction IDs to pending_predictions in one atomic update
      // Only add NEW predictions (from newClips, not merged existing clips)
      const successfulPredictions = newClips
        .filter(clip => clip.prediction_id)
        .map(clip => ({
          prediction_id: clip.prediction_id,
          stage_id: stageId,
          item_type: 'clip' as const,
          scene_number: clip.scene_number,
          extra_data: {
            prompt: clip.prompt,
            duration: sceneDuration,
            model: modelId
          },
          started_at: new Date().toISOString()
        }));
      
      if (successfulPredictions.length > 0) {
        // Fetch current generation_params and append all predictions at once
        const { data: currentOutput } = await supabase
          .from('content_outputs')
          .select('generation_params')
          .eq('id', output.id)
          .single();
        
        const existingPending = currentOutput?.generation_params?.pending_predictions || [];
        
        await supabase.from('content_outputs').update({
          generation_params: {
            ...currentOutput?.generation_params,
            pending_predictions: [...existingPending, ...successfulPredictions]
          }
        }).eq('id', output.id);
        
        console.log(`✓ Added ${successfulPredictions.length} predictions to tracking array`);
      }

      // All predictions started - webhook will update with results
      const newClipsCount = scenesToProcess.length;
      const estimatedCost = calculateReplicateCost(modelId, 'world_simulator') * newClipsCount;
      console.log(`World simulator clips generation started. ${newClipsCount} clip(s) queued, estimated cost: $${estimatedCost.toFixed(4)}`);

      return {
        clips,
        model: modelId,
        started_at: new Date().toISOString(),
        cost: 0, // Cost calculated on webhook completion
        status: 'generating'
      };
    }
    
    // Single video generation (legacy behavior)
    const scriptStage = stageConfig.inputFrom?.[0] || 'script';
    const scriptContent = output.stage_data?.[scriptStage]?.content;
    
    if (!scriptContent) {
      throw new Error(`Script content not found in stage: ${scriptStage}`);
    }

    console.log(`Generating single video with prompt: ${scriptContent.substring(0, 50)}...`);

    // Build payload using payload builder
    const worldSimParams = configuration?.model_config?.world_simulator?.parameters || {};

    // Extract reference images from library elements (products and characters)
    const imageInputs = output.generation_params?.image_inputs || {};
    const libraryElements = output.generation_params?.library_elements || {};
    const imageUsageMode = output.generation_params?.image_usage_mode;
    const referenceImages = extractReferenceImages(imageInputs, libraryElements, imageUsageMode);

    // Extract aspect ratio - output_config (user selection) takes priority over video_config defaults
    // Support both camelCase (wizard UI) and snake_case (MCP/autopilot) formats
    const videoConfig = output.generation_params?.video_config;
    const outputConfig = output.generation_params?.output_config;
    const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
      || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
      || worldSimParams.aspect_ratio;
    const aspectRatio = rawAspectRatio ? (ASPECT_RATIO_MAP[rawAspectRatio] || rawAspectRatio) : undefined;

    const semanticInput: UserInput = {
      main_prompt: scriptContent,
      seconds: worldSimParams.seconds || sceneDuration,
      ...(aspectRatio && { aspect_ratio: aspectRatio }),
      resolution: worldSimParams.resolution || '1080p',
      ...(worldSimParams.input_reference && { image_input: worldSimParams.input_reference })
    };

    // Add reference image as image_input (maps to input_reference for Sora/Veo)
    // Note: World simulators typically accept single image, use first reference
    if (referenceImages.length > 0 && !worldSimParams.input_reference) {
      semanticInput.image_input = referenceImages[0];
      console.log(`Using reference image for world sim: ${referenceImages[0]}`);
    }

    const capabilities = await ensureModelSchema(supabase, 'replicate', modelId, 'world_simulator');

    const { payload, missing_required, warnings } = buildPayload(capabilities!, semanticInput);

    if (missing_required.length > 0) {
      throw new Error(`Missing required parameters: ${missing_required.join(', ')}`);
    }

    if (warnings.length > 0) {
      console.warn('Payload builder warnings:', warnings);
    }

    console.log(`Built payload for ${modelId}:`, JSON.stringify(payload, null, 2));

    // Start async prediction with webhook - retry on 502 errors
    const startPrediction = async () => {
      return await startReplicatePrediction(
        supabase,
        output.id,
        decryptedKey,
        modelId,
        payload,
        {
          stage_id: stageId,
          item_type: 'video',
          extra_data: {
            prompt: scriptContent,
            duration: sceneDuration,
            model: modelId
          }
        }
      );
    };

    const { prediction_id } = await retryWithBackoff(
      startPrediction,
      'World simulator single video',
      7 // Increased retries for world sim (higher failure rate)
    );

    console.log(`Single world simulator video started. Prediction ID: ${prediction_id}`);

    return {
      prediction_id,
      prompt: scriptContent,
      duration: sceneDuration,
      model: modelId,
      status: 'generating',
      cost: 0
    };
  }, 'World simulator generation');
}

async function executeFaceSwapStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('Executing face swap stage (HeyGen-style avatar)...');

  // This would integrate with HeyGen or similar face swap service
  // For now, returning placeholder
  throw new Error('Face swap not yet implemented - requires HeyGen integration');
}

/**
 * Execute HeyGen avatar video stage
 * Takes approved script from previous stage, sends to HeyGen v2 video generate API
 * with character's avatar_id and voice_id. Uses callback_id for webhook correlation.
 */
async function executeHeyGenVideoStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('Executing HeyGen avatar video stage...');

  // Get HeyGen API key
  const heygenKeyRecord = apiKeys.find((k: any) => k.provider === 'heygen');
  if (!heygenKeyRecord) {
    throw new Error('HeyGen API key not configured. Add it in Settings → Integrations.');
  }
  const heygenApiKey = await decryptApiKey(heygenKeyRecord.key_encrypted);

  // Get script from previous stage
  const scriptStageId = stageConfig.inputFrom?.[0] || 'script';
  const scriptContent = output.stage_data?.[scriptStageId]?.content;
  if (!scriptContent) {
    throw new Error(`Script not found in stage_data.${scriptStageId}. Approve the script first.`);
  }

  // Extract character from library elements
  const libraryElements = configuration?.library_elements || output.generation_params?.library_elements || {};
  const characterData = libraryElements.library_characters || libraryElements.character || libraryElements.characters;
  const character = Array.isArray(characterData) ? characterData[0] : characterData;

  if (!character) {
    throw new Error('No character configured. Select a character with HeyGen avatar in blueprint settings.');
  }

  const avatarId = character.heygen_avatar_id;
  const voiceId = character.heygen_voice_id;

  if (!avatarId) {
    throw new Error(`Character "${character.name}" has no HeyGen avatar configured. Go to Asset Library → Characters → HeyGen tab.`);
  }
  if (!voiceId) {
    throw new Error(`Character "${character.name}" has no HeyGen voice configured. Go to Asset Library → Characters → HeyGen tab.`);
  }

  // Determine aspect ratio / dimensions
  const videoConfig = output.generation_params?.video_config || configuration?.video_config || {};
  const outputConfig = output.generation_params?.output_config || configuration?.output_config || {};
  const aspectRatio = outputConfig.aspectRatio || outputConfig.aspect_ratio || videoConfig.aspectRatio || videoConfig.aspect_ratio || '16:9';

  const dimensionMap: Record<string, { width: number; height: number }> = {
    '16:9': { width: 1920, height: 1080 },
    '9:16': { width: 1080, height: 1920 },
    '1:1': { width: 1080, height: 1080 },
  };
  const dimension = dimensionMap[aspectRatio] || dimensionMap['16:9'];

  // Get background config from character's heygen_config if available
  const heygenConfig = character.heygen_config || {};
  const background = heygenConfig.background || { type: 'color', color: '#000000' };

  // HeyGen API limit: input_text must be < 5,000 characters per request.
  // For long scripts, split into chunks and generate multiple videos to stitch later.
  const HEYGEN_MAX_CHARS = 4800; // Leave 200 char margin for safety
  const scriptChunks = splitScriptIntoChunks(scriptContent, HEYGEN_MAX_CHARS);
  const isMultiSegment = scriptChunks.length > 1;

  if (isMultiSegment) {
    console.log(`Script is ${scriptContent.length} chars — splitting into ${scriptChunks.length} segments for HeyGen`);
  }

  console.log(`HeyGen video request: avatar=${avatarId}, voice=${voiceId}, dimension=${dimension.width}x${dimension.height}, segments=${scriptChunks.length}`);

  // Fire HeyGen API call(s) — one per chunk
  const pendingItems: any[] = [];
  const videoIds: string[] = [];

  for (let i = 0; i < scriptChunks.length; i++) {
    const chunk = scriptChunks[i];
    // callback_id format: outputId:stageId for single, outputId:stageId:segmentIndex for multi
    const callbackId = isMultiSegment ? `${output.id}:${stageId}:${i}` : `${output.id}:${stageId}`;

    const requestBody = {
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: avatarId,
          avatar_style: heygenConfig.avatar_style || 'normal',
        },
        voice: {
          type: 'text',
          input_text: chunk,
          voice_id: voiceId,
        },
        background,
      }],
      dimension,
      callback_id: callbackId,
      test: false,
      caption: false,
      title: isMultiSegment
        ? `${output.title || 'UGC Video'} (Part ${i + 1}/${scriptChunks.length})`
        : (output.title || 'UGC Video'),
    };

    const response = await fetch('https://api.heygen.com/v2/video/generate', {
      method: 'POST',
      headers: {
        'X-Api-Key': heygenApiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorBody: any;
      try { errorBody = await response.json(); } catch { errorBody = { message: `HTTP ${response.status}` }; }
      throw new Error(errorBody?.error?.message || errorBody?.message || `HeyGen API error: ${response.status} (segment ${i + 1}/${scriptChunks.length})`);
    }

    const result = await response.json();
    const videoId = result.data?.video_id;

    if (!videoId) {
      throw new Error(`HeyGen did not return a video_id for segment ${i + 1}`);
    }

    console.log(`✓ HeyGen segment ${i + 1}/${scriptChunks.length} started: ${videoId} (${chunk.length} chars)`);
    videoIds.push(videoId);

    pendingItems.push({
      prediction_id: videoId,
      stage_id: stageId,
      item_type: 'heygen_video',
      extra_data: {
        avatar_id: avatarId,
        voice_id: voiceId,
        callback_id: callbackId,
        segment_index: isMultiSegment ? i : undefined,
        total_segments: isMultiSegment ? scriptChunks.length : undefined,
      },
      started_at: new Date().toISOString(),
    });
  }

  // Store all pending predictions
  const { data: currentOutput } = await supabase
    .from('content_outputs')
    .select('generation_params')
    .eq('id', output.id)
    .single();

  const existingPredictions = currentOutput?.generation_params?.pending_predictions || [];

  await supabase.from('content_outputs').update({
    generation_params: {
      ...currentOutput?.generation_params,
      pending_predictions: [...existingPredictions, ...pendingItems],
      // Multi-segment metadata for webhook to use during assembly
      ...(isMultiSegment ? {
        heygen_multi_segment: {
          total_segments: scriptChunks.length,
          segment_video_urls: new Array(scriptChunks.length).fill(null), // Filled by webhook as segments complete
        },
      } : {}),
    },
  }).eq('id', output.id);

  console.log(`✓ Tracking stored for ${videoIds.length} HeyGen video(s)`);

  return {
    heygen_video_id: isMultiSegment ? videoIds : videoIds[0],
    callback_id: isMultiSegment ? `${output.id}:${stageId}:multi` : `${output.id}:${stageId}`,
    model: 'heygen-avatar-v2',
    segments: scriptChunks.length,
    started_at: new Date().toISOString(),
    cost: 0,
    status: 'generating',
  };
}

/**
 * Split a script into chunks that fit within HeyGen's character limit.
 * Splits at sentence boundaries (. ! ?) to avoid cutting mid-sentence.
 * Falls back to paragraph boundaries first, then sentence boundaries.
 */
function splitScriptIntoChunks(script: string, maxChars: number): string[] {
  if (script.length <= maxChars) {
    return [script];
  }

  const chunks: string[] = [];
  let remaining = script.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining.trim());
      break;
    }

    // Find a good split point within the limit
    let splitAt = -1;

    // Try paragraph break first (double newline)
    const paragraphBreak = remaining.lastIndexOf('\n\n', maxChars);
    if (paragraphBreak > maxChars * 0.3) {
      splitAt = paragraphBreak;
    }

    // Try sentence boundary (. ! ? followed by space or newline)
    if (splitAt === -1) {
      for (let i = maxChars; i > maxChars * 0.3; i--) {
        const char = remaining[i - 1];
        const nextChar = remaining[i];
        if ((char === '.' || char === '!' || char === '?') && (nextChar === ' ' || nextChar === '\n')) {
          splitAt = i;
          break;
        }
      }
    }

    // Last resort: split at last space
    if (splitAt === -1) {
      splitAt = remaining.lastIndexOf(' ', maxChars);
    }

    // Absolute last resort: hard cut
    if (splitAt <= 0) {
      splitAt = maxChars;
    }

    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }

  return chunks;
}

/**
 * Execute HeyGen template video stage
 * Takes LLM-generated template variable values, sends to HeyGen template generate API.
 * Uses callback_id for webhook correlation.
 */
async function executeHeyGenTemplateStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('Executing HeyGen template video stage...');

  // Get HeyGen API key
  const heygenKeyRecord = apiKeys.find((k: any) => k.provider === 'heygen');
  if (!heygenKeyRecord) {
    throw new Error('HeyGen API key not configured. Add it in Settings → Integrations.');
  }
  const heygenApiKey = await decryptApiKey(heygenKeyRecord.key_encrypted);

  // Get template variables from previous stage
  const variablesStageId = stageConfig.inputFrom?.[0] || 'variables';
  const variablesContent = output.stage_data?.[variablesStageId]?.content;
  if (!variablesContent) {
    throw new Error(`Template variables not found in stage_data.${variablesStageId}. Approve the variables first.`);
  }

  // Parse variables - LLM should output JSON
  let variables: Record<string, any>;
  try {
    variables = typeof variablesContent === 'string' ? JSON.parse(variablesContent) : variablesContent;
  } catch {
    throw new Error('Failed to parse template variables as JSON. The LLM output must be valid JSON.');
  }

  // Get template ID from generation params
  const generationParams = output.generation_params || {};
  const templateId = generationParams.heygen_template_id || configuration?.heygen_template_id;
  if (!templateId) {
    throw new Error('No HeyGen template_id configured in generation params.');
  }

  // Build callback_id for webhook correlation
  const callbackId = `${output.id}:${stageId}`;

  console.log(`HeyGen template request: template=${templateId}, variables=${Object.keys(variables).length}`);

  // Call HeyGen template generate API
  const response = await fetch(`https://api.heygen.com/v2/template/${templateId}/generate`, {
    method: 'POST',
    headers: {
      'X-Api-Key': heygenApiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      variables,
      callback_id: callbackId,
      test: false,
      caption: false,
      title: output.title || 'Template Video',
    }),
  });

  if (!response.ok) {
    let errorBody: any;
    try { errorBody = await response.json(); } catch { errorBody = { message: `HTTP ${response.status}` }; }
    throw new Error(errorBody?.error?.message || errorBody?.message || `HeyGen API error: ${response.status}`);
  }

  const result = await response.json();
  const videoId = result.data?.video_id;

  if (!videoId) {
    throw new Error('HeyGen did not return a video_id');
  }

  console.log(`✓ HeyGen template video generation started: ${videoId}`);

  // Store in pending_predictions for webhook lookup
  const { data: currentOutput } = await supabase
    .from('content_outputs')
    .select('generation_params')
    .eq('id', output.id)
    .single();

  const pendingPredictions = currentOutput?.generation_params?.pending_predictions || [];
  pendingPredictions.push({
    prediction_id: videoId,
    stage_id: stageId,
    item_type: 'heygen_template',
    extra_data: {
      template_id: templateId,
      callback_id: callbackId,
    },
    started_at: new Date().toISOString(),
  });

  await supabase.from('content_outputs').update({
    generation_params: {
      ...currentOutput?.generation_params,
      pending_predictions: pendingPredictions,
    },
  }).eq('id', output.id);

  console.log(`✓ Tracking stored for HeyGen template video ${videoId}`);

  return {
    heygen_video_id: videoId,
    callback_id: callbackId,
    template_id: templateId,
    model: 'heygen-template-v2',
    started_at: new Date().toISOString(),
    cost: 0,
    status: 'generating',
  };
}

async function executeAssemblyStage(
  output: any,
  stageId: string,
  stageConfig: any,
  configuration: any,
  apiKeys: any[],
  supabase: any
): Promise<any> {
  console.log('Executing video assembly stage...');

  return await retryWithBackoff(async () => {
    const stageData = output.stage_data || {};
    const clipsData = stageData.clips;
    const voiceData = stageData.voice;
    const voiceSegmentsData = stageData.voice_segments;
    const fullVoiceoverData = stageData.full_voiceover; // Single voiceover for entire video

    if (!clipsData || !clipsData.clips) {
      throw new Error('No clips data found for assembly');
    }

    const clips = clipsData.clips || [];

    // Filter clips by status: ready/approved, excluded/failed, and generating
    // Accept both 'ready' (auto-approved after generation) and 'approved' (manually approved) statuses
    const readyClips = clips.filter((c: any) => c.status === 'ready' || c.status === 'approved');
    const excludedClips = clips.filter((c: any) => c.status === 'excluded' || c.status === 'failed');
    const generatingClips = clips.filter((c: any) => c.status === 'generating');

    console.log(`Found ${clips.length} clips: ${readyClips.length} ready/approved, ${excludedClips.length} excluded/failed, ${generatingClips.length} generating`);

    // Validate we have at least some ready clips
    if (readyClips.length === 0) {
      throw new Error('No ready clips available for assembly');
    }

    // Only block on generating clips (not excluded/failed ones)
    if (generatingClips.length > 0) {
      throw new Error(`Cannot assemble: ${generatingClips.length} clips still generating. Wait for clips to complete.`);
    }

    // Log which scenes are being excluded
    if (excludedClips.length > 0) {
      const excludedScenes = excludedClips.map((c: any) => c.scene_number).join(', ');
      console.log(`⚠️ Excluding scenes from assembly: ${excludedScenes}`);
    }

    // Sort ready clips by scene_number for proper order
    const sortedClips = [...readyClips].sort((a: any, b: any) =>
      (a.scene_number || 0) - (b.scene_number || 0)
    );

    // Extract clip URLs
    const clipUrls = sortedClips.map((c: any) => c.video_url).filter(Boolean);
    if (clipUrls.length === 0) {
      throw new Error('No video URLs available for assembly');
    }

    console.log('Clip URLs for assembly:', clipUrls);

    // Determine audio mode: per-scene segments or single audio file
    let audioUrl: string | null = null;
    let audioSegments: any[] | null = null;

    if (voiceSegmentsData?.segments && voiceSegmentsData.segments.length > 0) {
      // Per-scene audio segments (longform storyboard pipeline)
      // Get the scene numbers of ready clips so we only include matching audio
      const readySceneNumbers = new Set(sortedClips.map((c: any) => c.scene_number));

      // Accept ready, approved, or pending segments (exclude excluded/failed)
      const readySegments = voiceSegmentsData.segments.filter((s: any) =>
        (s.status === 'ready' || s.status === 'approved' || s.status === 'pending' || !s.status) &&
        s.status !== 'excluded' && s.status !== 'failed' &&
        readySceneNumbers.has(s.scene_number) // Only include audio for ready clips
      );

      if (readySegments.length === 0) {
        throw new Error('No ready voice segments available for assembly');
      }

      // Sort segments by scene_number and build audio segments array
      const sortedSegments = [...readySegments].sort((a: any, b: any) =>
        a.scene_number - b.scene_number
      );

      // Build per-clip audio mapping for precise sync (only for approved clips)
      audioSegments = sortedClips.map((clip: any) => {
        const matchingSegment = sortedSegments.find((s: any) =>
          s.scene_number === clip.scene_number
        );
        return {
          scene_number: clip.scene_number,
          audio_url: matchingSegment?.audio_url || null,
          duration: matchingSegment?.duration || 0
        };
      });

      console.log(`Using ${audioSegments.length} per-scene audio segments for assembly (excluding ${excludedClips.length} scenes)`);
    } else if (fullVoiceoverData?.audio_url) {
      // Single voiceover for entire video (storyboard_video_longform with full_voiceover stage)
      audioUrl = fullVoiceoverData.audio_url;
      console.log(`Using full_voiceover audio for assembly: ${audioUrl}, duration: ${fullVoiceoverData.duration}s, clip_duration: ${fullVoiceoverData.clip_duration}s`);
    } else if (voiceData?.url) {
      // Single audio file (legacy/simple pipelines)
      audioUrl = voiceData.url;
      console.log('Using single audio file for assembly');
    }

    // Call the assemble-video edge function
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const videoRendererUrl = Deno.env.get('VIDEO_RENDERER_URL'); // e.g. https://aca-video-renderer.fly.dev
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    // Get aspect ratio for resolution enforcement
    const videoConfig = output.generation_params?.video_config;
    const outputConfig = output.generation_params?.output_config;
    const aspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio
      || videoConfig?.aspectRatio || videoConfig?.aspect_ratio
      || 'landscape';

    // Get caption style from blueprint config
    const captionStyle = configuration?.model_config?.caption_style || 'hormozi';

    // ── Remotion renderer (preferred) ──
    // When VIDEO_RENDERER_URL is configured, use Remotion for high-quality
    // composition with transitions, animated captions, and proper audio sync.
    if (videoRendererUrl && audioUrl) {
      console.log(`[executeAssemblyStage] Using Remotion renderer at ${videoRendererUrl}`);

      // Build clip data with durations for Remotion
      const remotionClips = sortedClips.map((c: any) => ({
        scene_number: c.scene_number,
        video_url: c.video_url,
        duration: c.duration || fullVoiceoverData?.clip_duration || 5,
      }));

      const remotionPayload = {
        output_id: output.id,
        organization_id: output.organization_id,
        clips: remotionClips,
        audio_url: audioUrl,
        word_timestamps: fullVoiceoverData?.word_timestamps || [],
        aspect_ratio: aspectRatio,
        caption_style: captionStyle,
        brand: output.generation_params?.brand || {},
        supabase_url: supabaseUrl,
        supabase_key: serviceKey,
        encryption_key: encryptionKey,
      };

      try {
        const remotionResponse = await fetch(`${videoRendererUrl}/render`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remotionPayload),
        });

        if (remotionResponse.ok) {
          console.log(`[executeAssemblyStage] Remotion render started for ${output.id}`);
          return {
            clips_count: clipUrls.length,
            renderer: 'remotion',
            caption_style: captionStyle,
            cost: 0,
            status: 'generating',
            started_at: new Date().toISOString(),
          };
        }

        // Remotion configured but unavailable — fail loudly. Silently failing over to
        // Replicate would charge a paid provider the user didn't opt into.
        const errorText = await remotionResponse.text();
        throw new Error(`Remotion renderer unavailable (${remotionResponse.status}): ${errorText}. Refusing to fall back to Replicate.`);
      } catch (err: any) {
        if (err?.message?.startsWith('Remotion renderer unavailable')) throw err;
        throw new Error(`Remotion renderer unreachable: ${err?.message || err}. Refusing to fall back to Replicate.`);
      }
    }

    // ── Replicate path (used only when VIDEO_RENDERER_URL is not configured) ──

    const assemblyPayload: any = {
      clips: clipUrls,
      transition: 'cut', // Simple cuts for longform, crossfade for shorter videos
      output_id: output.id,
      organization_id: output.organization_id,
      aspect_ratio: aspectRatio
    };

    // Add audio based on mode
    if (audioSegments) {
      assemblyPayload.audio_segments = audioSegments;
      assemblyPayload.sync_mode = 'per_clip'; // Tell assembler to sync audio per clip
    } else if (audioUrl) {
      assemblyPayload.audio_url = audioUrl;
      assemblyPayload.sync_mode = 'single'; // Tell assembler to overlay single voiceover
      // Pass audio duration and clip duration for looping calculation
      if (fullVoiceoverData?.duration) {
        assemblyPayload.audio_duration = fullVoiceoverData.duration;
      }
      if (fullVoiceoverData?.clip_duration) {
        assemblyPayload.clip_duration = fullVoiceoverData.clip_duration;
      }
      console.log(`[executeAssemblyStage] Using single voiceover mode for assembly (audio_duration: ${fullVoiceoverData?.duration}s, clip_duration: ${fullVoiceoverData?.clip_duration}s)`);
    }

    const assemblyResponse = await fetch(`${supabaseUrl}/functions/v1/assemble-video`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assemblyPayload)
    });

    if (!assemblyResponse.ok) {
      const errorText = await assemblyResponse.text();
      throw new Error(`Assembly failed: ${assemblyResponse.status} - ${errorText}`);
    }

    const assemblyResult = await assemblyResponse.json();

    console.log('Assembly result:', assemblyResult);

    return {
      video_url: assemblyResult.video_url,
      duration: assemblyResult.duration,
      clips_count: clipUrls.length,
      audio_segments_count: audioSegments?.length || 0,
      prediction_id: assemblyResult.prediction_id,
      cost: assemblyResult.cost || 0,
      status: 'generating', // Keep status as generating so webhook can find output
      completed_at: new Date().toISOString()
    };
  }, 'Video assembly');
}

/**
 * Output budget for text stages when the blueprint's model parameters don't set
 * `max_tokens`.
 *
 * OpenRouter's affordability check reserves credit for `max_tokens` — and when the
 * field is omitted it reserves the model's ENTIRE max output budget instead
 * (Claude Sonnet 4.6 = 65536 tokens ≈ $0.98 at $15/M). A blueprint that leaves
 * max_tokens unset therefore demands ~$1 of OpenRouter credit for a 500-token post
 * and 402s the whole job the moment the balance drops below that, even though the
 * generation itself costs cents. Always send an explicit budget; 8192 tokens is far
 * more than any single stage emits (long articles/scripts are generated per section).
 */
const DEFAULT_TEXT_MAX_TOKENS = 8192;

/**
 * Stream an OpenRouter chat completion using SSE.
 * Keeps the connection alive as long as tokens are flowing, preventing edge function timeouts.
 * Returns the same shape as a non-streaming response for drop-in replacement.
 */
async function streamOpenRouterCompletion(
  llmTarget: StageTextLlmTarget,
  requestBody: Record<string, any>,
  supabaseUrl: string
): Promise<{ content: string; model: string; usage: any; cost: number }> {
  const modelId = llmTarget.modelId;
  // Hard caps so a stuck/unknown model can't hang the edge function forever.
  // The watchdog only resets at 10 min, so we need to fail well before then.
  const CONNECT_TIMEOUT_MS = 90_000;     // time to first response headers
  const IDLE_TIMEOUT_MS = 45_000;        // max gap between SSE chunks once streaming
  const TOTAL_TIMEOUT_MS = 5 * 60_000;   // absolute ceiling for the whole call

  const controller = new AbortController();
  const totalTimeoutId = setTimeout(() => controller.abort('total_timeout'), TOTAL_TIMEOUT_MS);
  const connectTimeoutId = setTimeout(() => controller.abort('connect_timeout'), CONNECT_TIMEOUT_MS);

  let response: Response;
  let preReadErrorBody: string | null = null;

  const sendRequest = (payload: Record<string, any>) => fetch(llmTarget.url, {
    method: 'POST',
    headers: {
      ...llmTarget.headers,
      'HTTP-Referer': supabaseUrl,
      'X-Title': 'ContentAI Studio'
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });

  // Always send an explicit max_tokens — see DEFAULT_TEXT_MAX_TOKENS above.
  const body: Record<string, any> = { ...requestBody, stream: true };
  if (body.max_tokens === undefined || body.max_tokens === null) {
    body.max_tokens = DEFAULT_TEXT_MAX_TOKENS;
  }

  try {
    response = await sendRequest(body);

    // Models with a smaller output ceiling reject an oversized budget with HTTP 400.
    // Honour the ceiling OpenRouter reports rather than failing the stage.
    if (!response.ok && response.status === 400 && body.max_tokens === DEFAULT_TEXT_MAX_TOKENS) {
      const probe = await response.text();
      if (/max_tokens/i.test(probe)) {
        const ceiling = Number(probe.match(/at most (\d+)\s+(?:completion\s+)?tokens/i)?.[1] || 0);
        console.warn(`[streamOpenRouterCompletion] ${modelId} rejected max_tokens=${body.max_tokens}${ceiling ? ` (ceiling ${ceiling})` : ''} — retrying with ${ceiling > 0 ? ceiling : 'the provider default'}`);
        if (ceiling > 0) {
          response = await sendRequest({ ...body, max_tokens: ceiling });
        } else {
          const withoutBudget = { ...body };
          delete withoutBudget.max_tokens;
          response = await sendRequest(withoutBudget);
        }
        if (!response.ok) preReadErrorBody = await response.text();
      } else {
        preReadErrorBody = probe;
      }
    }
  } catch (err) {
    clearTimeout(totalTimeoutId);
    clearTimeout(connectTimeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`OpenRouter request timed out before response (model=${modelId}, after ${CONNECT_TIMEOUT_MS}ms). The model slug may be invalid or the provider unreachable.`);
    }
    throw err;
  }
  clearTimeout(connectTimeoutId);

  if (!response.ok) {
    clearTimeout(totalTimeoutId);
    const errorBody = preReadErrorBody ?? await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let content = '';
  let model = modelId;
  let usage: any = null;
  let buffer = '';

  try {
    while (true) {
      // Inter-chunk idle watchdog: if no bytes arrive for IDLE_TIMEOUT_MS, abort.
      // Without this, a model that 200s the SSE but never emits data hangs the
      // edge function until the platform kills it, leaving the row stuck.
      const idleAbort = new AbortController();
      const idleTimeoutId = setTimeout(() => idleAbort.abort('idle_timeout'), IDLE_TIMEOUT_MS);

      const readResult = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleAbort.signal.addEventListener('abort', () => {
            reject(new Error(`OpenRouter stream idle for ${IDLE_TIMEOUT_MS}ms (model=${modelId}). Aborting — model may be unreachable.`));
          });
        }),
      ]);
      clearTimeout(idleTimeoutId);

      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
          }
          if (chunk.model) {
            model = chunk.model;
          }
          // OpenRouter sends usage in the final chunk
          if (chunk.usage) {
            usage = chunk.usage;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }
  } finally {
    clearTimeout(totalTimeoutId);
    try { reader.releaseLock(); } catch { /* already released */ }
  }

  // Estimate usage if not provided in stream
  if (!usage) {
    const estimatedTokens = Math.ceil(content.length / 4);
    usage = { prompt_tokens: 0, completion_tokens: estimatedTokens, total_tokens: estimatedTokens };
    console.log(`[streamOpenRouterCompletion] Usage not in stream, estimated ${estimatedTokens} tokens`);
  }

  const cost = calculateOpenRouterCost(usage, modelId);
  console.log(`[streamOpenRouterCompletion] Stream complete. ${content.length} chars, ${usage.total_tokens} tokens, $${cost.toFixed(4)}`);

  return { content, model, usage, cost };
}

// Retry logic with exponential backoff - smart handling for 502 errors
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operationName: string,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`${operationName} - Attempt ${attempt + 1}/${maxRetries}`);
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errorMessage = lastError?.message || '';

      // Check for non-retryable errors (user configuration issues, not transient failures)
      const lowerMessage = errorMessage.toLowerCase();
      const isCreditError =
        errorMessage.includes('402') ||
        lowerMessage.includes('requires more credits') ||
        lowerMessage.includes('insufficient credits') ||
        lowerMessage.includes('out of credits');
      const isNonRetryableError =
        errorMessage.includes('model not found') ||
        errorMessage.includes('model_not_found') ||
        errorMessage.includes('voice not found') ||
        errorMessage.includes('voice_not_found') ||
        errorMessage.includes('unusual activity') ||
        errorMessage.includes('Free Tier usage disabled') ||
        errorMessage.includes('quota exceeded') ||
        errorMessage.includes('authentication failed') ||
        errorMessage.includes('API key') ||
        errorMessage.includes('does not represent a valid image') ||
        // Billing failures never clear by retrying: the OpenRouter account can't cover
        // the request. Failing immediately keeps the real message ("add credits or
        // lower max_tokens") in the job error instead of three identical attempts.
        isCreditError ||
        (errorMessage.includes('401') && !errorMessage.includes('502'));

      if (isNonRetryableError) {
        console.error(`${operationName} - Non-retryable error detected, failing immediately:`, errorMessage);
        throw lastError; // Don't retry configuration/subscription issues
      }

      // Check if it's a 502 Bad Gateway error (transient Replicate issue)
      const is502Error = errorMessage.includes('502') || errorMessage.includes('Bad Gateway');

      // Check if it's a 429 Rate Limit error (transient, needs longer backoff)
      const is429Error = errorMessage.includes('429') || errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('too many requests');

      if (is502Error) {
        console.error(`🚨 Replicate 502 Bad Gateway detected on attempt ${attempt + 1}/${maxRetries}`);
      } else if (is429Error) {
        console.error(`🚨 Replicate 429 Rate Limit detected on attempt ${attempt + 1}/${maxRetries}`);
      } else {
        console.error(`${operationName} - Attempt ${attempt + 1} failed:`, error);
      }

      if (attempt < maxRetries - 1) {
        // Use longer delays for transient errors
        // 429 rate limits: 5s base (5s, 10s, 20s)
        // 502 gateway issues: 3s base (3s, 6s, 12s)
        // Other errors: 1s base (1s, 2s, 4s)
        const baseDelay = is429Error ? 5000 : is502Error ? 3000 : 1000;
        const delay = Math.pow(2, attempt) * baseDelay;
        const reason = is429Error ? 'rate limit - backing off' : is502Error ? 'Replicate API gateway issue' : 'error';
        console.log(`Retrying in ${delay / 1000}s... (${reason})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxRetries} attempts: ${lastError?.message}`);
}

// Cost calculation helpers
function calculateOpenRouterCost(usage: any, modelId: string): number {
  const tokensUsed = usage?.total_tokens || 0;
  
  // Pricing per million tokens (approximate)
  const pricingMap: Record<string, number> = {
    'google/gemini-3-flash-preview': 0.003,
    'meta-llama/llama-3.1-8b-instruct:free': 0,
    'anthropic/claude-3-haiku': 0.25,
    'anthropic/claude-3-sonnet': 3.0,
    'openai/gpt-4o': 5.0,
    'openai/gpt-4o-mini': 0.15,
  };
  
  const costPerMToken = pricingMap[modelId] || 0.10;
  return (tokensUsed / 1000000) * costPerMToken;
}

function calculateElevenLabsCost(characterCount: number): number {
  // ElevenLabs pricing: ~$0.30 per 1000 characters
  return (characterCount / 1000) * 0.30;
}

/**
 * Check ElevenLabs subscription status and remaining quota
 */
async function checkElevenLabsSubscription(apiKey: string): Promise<{
  tier: string;
  character_count: number | null;
  character_limit: number | null;
  status: string;
}> {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[checkElevenLabsSubscription] Failed to get subscription: ${response.status} - ${errorBody}`);
      return { tier: 'unknown', character_count: null, character_limit: null, status: 'error' };
    }

    const data = await response.json();
    return {
      tier: data.tier || 'free',
      character_count: data.character_count ?? null,
      character_limit: data.character_limit ?? null,
      status: data.status || 'active',
    };
  } catch (error) {
    console.error('[checkElevenLabsSubscription] Error:', error);
    return { tier: 'unknown', character_count: null, character_limit: null, status: 'error' };
  }
}

/**
 * Validate that an ElevenLabs voice ID exists and is accessible
 * Call this before attempting TTS to fail fast with actionable error messages
 */
async function validateElevenLabsVoice(apiKey: string, voiceId: string): Promise<{
  valid: boolean;
  error?: string;
  voiceName?: string;
}> {
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          valid: false,
          error: `ElevenLabs voice "${voiceId}" not found. This voice may have been deleted or is not accessible with your subscription. Please select a different voice in your character settings or blueprint configuration.`
        };
      }
      if (response.status === 401) {
        return {
          valid: false,
          error: `ElevenLabs authentication failed while validating voice. Your API key may be invalid or expired. Please check your ElevenLabs API key in Settings > API Keys.`
        };
      }
      const errorBody = await response.text();
      return {
        valid: false,
        error: `Failed to validate ElevenLabs voice: ${response.status} - ${errorBody}`
      };
    }

    const data = await response.json();
    return {
      valid: true,
      voiceName: data.name
    };
  } catch (error) {
    return {
      valid: false,
      error: `Voice validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Parse ElevenLabs API errors and return actionable user-facing messages
 */
function parseElevenLabsError(status: number, errorBody: string, modelId: string, voiceId: string): string {
  try {
    const parsed = JSON.parse(errorBody);
    const detail = parsed.detail;

    if (typeof detail === 'object' && detail !== null) {
      const errorStatus = detail.status;
      const message = detail.message || '';

      // Model not found - invalid or deprecated model ID
      if (errorStatus === 'model_not_found') {
        return `ElevenLabs model "${modelId}" not found. This model may be deprecated or require a paid subscription. ` +
          `Please update your TTS settings to use a valid model like "eleven_multilingual_v2" or "eleven_turbo_v2_5". ` +
          `Go to Settings > Blueprints to update the model configuration.`;
      }

      // Voice not found - invalid voice ID or cloned voice no longer accessible
      if (errorStatus === 'voice_not_found' || message.includes('voice') && message.includes('not found')) {
        return `ElevenLabs voice "${voiceId}" not found. This voice may have been deleted or is not accessible with your current subscription. ` +
          `Please select a different voice in your character settings or blueprint configuration.`;
      }

      // Free tier blocked/abuse detection
      if (errorStatus === 'detected_unusual_activity' || message.includes('unusual activity') || message.includes('Free Tier usage disabled')) {
        return `ElevenLabs free tier blocked: Your account has been flagged for unusual activity. ` +
          `Even if your dashboard shows available credits, ElevenLabs is rejecting API requests. ` +
          `To continue generating audio, please upgrade to a paid subscription: https://try.elevenlabs.io/content-farming-pricing-page`;
      }

      // Quota exceeded
      if (errorStatus === 'quota_exceeded' || message.includes('quota') || message.includes('limit')) {
        return `ElevenLabs quota exceeded: You've used all your available credits. ` +
          `Please upgrade your ElevenLabs plan to continue: https://try.elevenlabs.io/content-farming-pricing-page`;
      }

      // Invalid API key
      if (status === 401 && !message.includes('unusual activity')) {
        return `ElevenLabs authentication failed: Your API key may be invalid or expired. ` +
          `Please check your ElevenLabs API key in Settings > API Keys.`;
      }

      // Return the original message if we can't parse it
      return `ElevenLabs error: ${message || errorBody}`;
    }

    // Handle string detail
    if (typeof detail === 'string') {
      return `ElevenLabs error: ${detail}`;
    }
  } catch {
    // JSON parsing failed, return raw error
  }

  // Fallback for non-JSON errors
  return `ElevenLabs API error ${status}: ${errorBody}`;
}

function calculateReplicateCost(modelId: string, type: 'image' | 'video' | 'world_simulator'): number {
  // Replicate pricing varies by model - these are approximate
  const pricingMap: Record<string, number> = {
    'image': 0.02, // ~$0.02 per image
    'video': 0.15, // ~$0.15 per video clip
    'world_simulator': 0.25, // ~$0.25 per video
  };
  
  return pricingMap[type] || 0.10;
}

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
