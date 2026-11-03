/**
 * ExecutionContext Builder
 *
 * Unified data extraction for all pipeline stages.
 * This is the SINGLE SOURCE OF TRUTH for extracting context data.
 *
 * All library element extraction handles multiple key formats:
 * - Full table names: library_brand_voices, library_characters, library_products
 * - Shorthand names: brand, brand_voice, character, product
 * - Legacy names: brandVoice, etc.
 */

import type {
  ExecutionContext,
  BrandVoice,
  Character,
  Product,
  Creator,
  ICP,
  SearchTerm,
  VisualStyle,
  ModelConfig,
  AIInsights,
} from './types.ts';
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_IMAGE_MODEL } from '../default-models.ts';
import { resolveAiInsightVars } from '../ai-insights.ts';
import { hasRoleReferences, resolveRoleReferences } from '../image-references.ts';

// ============= HELPER FUNCTIONS =============

/**
 * Safely extract first element from array or return value if not array
 */
function unwrapArray<T>(value: T | T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

/**
 * Check multiple keys for a value in an object
 */
function getFromMultipleKeys<T>(
  obj: Record<string, any>,
  keys: string[]
): T | null {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return unwrapArray(obj[key]) as T;
    }
  }
  return null;
}

// ============= LIBRARY ELEMENT EXTRACTORS =============

/**
 * Extract brand voice from library elements.
 * Checks: library_brand_voices, brand_voice, brand, brandVoice
 */
export function extractBrandVoice(
  libraryElements: Record<string, any>
): BrandVoice | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_brand_voices',
    'brand_voice',
    'brand',
    'brandVoice',
  ]);

  if (!raw) return null;

  // Normalize to BrandVoice interface
  return {
    id: raw.id,
    name: raw.name || '',
    tone: raw.tone || '',
    vocabulary: raw.vocabulary || [],
    writingStyle: raw.writing_style || raw.writingStyle || '',
    // Visual identity - check multiple structures
    colorPalette:
      raw.color_palette ||
      raw.colorPalette ||
      raw.visual_identity?.color_palette ||
      [],
    fontStyle:
      raw.font_style ||
      raw.fontStyle ||
      raw.visual_identity?.font_style ||
      '',
    logo: raw.logo || (raw.logos?.length ? raw.logos[0] : ''),
    logos: raw.logos || (raw.logo ? [raw.logo] : []),
    referenceImages:
      raw.reference_images ||
      raw.referenceImages ||
      raw.visual_identity?.reference_images ||
      raw.logos ||
      [],
    // Visual template and accent style for image generation
    visualTemplate:
      raw.visual_template ||
      raw.visualTemplate ||
      raw.visual_identity?.visual_template ||
      '',
    accentStyle:
      raw.accent_style ||
      raw.accentStyle ||
      raw.visual_identity?.accent_style ||
      '',
    visualIdentity: raw.visual_identity || {},
  };
}

/**
 * Extract character from library elements.
 * Checks: library_characters, character, characters
 */
export function extractCharacter(
  libraryElements: Record<string, any>
): Character | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_characters',
    'character',
    'characters',
  ]);

  if (!raw) return null;

  return {
    id: raw.id,
    name: raw.name || '',
    description: raw.description || '',
    visualDescription: raw.visual_description || raw.visualDescription || '',
    personality: raw.personality || '',
    referenceImageUrl:
      raw.reference_image_url ||
      raw.referenceImageUrl ||
      raw.image_url ||
      '',
    referenceImages: raw.reference_images || raw.referenceImages || [],
    // Detailed visual attributes for image generation
    visual_style: raw.visual_style || '',
    gender: raw.gender || '',
    build: raw.build || '',
    ethnicity: raw.ethnicity || '',
    hair_description: raw.hair_description || raw.hair || '',
    typical_clothing: raw.typical_clothing || raw.clothing || '',
    age_range: raw.age_range || raw.age || '',
    // HeyGen avatar video fields
    heygen_avatar_id: raw.heygen_avatar_id || '',
    heygen_voice_id: raw.heygen_voice_id || '',
    heygen_config: raw.heygen_config || null,
    // ElevenLabs voice fields (canonical voice source)
    voice_selection: raw.voice_selection || '',
    voice_config: raw.voice_config || null,
  };
}

/**
 * Extract product from library elements.
 * Checks: library_products, product, products
 */
export function extractProduct(
  libraryElements: Record<string, any>
): Product | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_products',
    'product',
    'products',
  ]);

  if (!raw) return null;

  return {
    id: raw.id,
    name: raw.name || '',
    description: raw.description || '',
    features: raw.features || [],
    benefits: raw.benefits || [],
    images: raw.images || [],
    targetAudience: raw.target_audience || raw.targetAudience || '',
  };
}

/**
 * Extract creator from library elements.
 * Checks: library_creators, creator, creators
 */
export function extractCreator(
  libraryElements: Record<string, any>
): Creator | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_creators',
    'creator',
    'creators',
  ]);

  if (!raw) return null;

  return {
    id: raw.id,
    name: raw.name || '',
    niche: raw.niche || '',
    style: raw.style || '',
    avatarUrl: raw.avatar_url || raw.avatarUrl || '',
    bio: raw.bio || '',
  };
}

/**
 * Extract ICP from library elements.
 * Checks: library_icps, icp, icps
 */
export function extractICP(
  libraryElements: Record<string, any>
): ICP | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_icps',
    'icp',
    'icps',
  ]);

  if (!raw) return null;

  return {
    id: raw.id,
    name: raw.name || '',
    summary: raw.summary || '',
    description: raw.description || '',
    painPoints: raw.pain_points || raw.painPoints || [],
    goals: raw.goals || [],
    demographics: raw.demographics || {},
  };
}

/**
 * Extract search term from library elements.
 * Checks: library_search_terms, search_term, searchTerm
 */
export function extractSearchTerm(
  libraryElements: Record<string, any>
): SearchTerm | null {
  const raw = getFromMultipleKeys<any>(libraryElements, [
    'library_search_terms',
    'search_term',
    'searchTerm',
    'search_terms',
  ]);

  if (!raw) return null;

  return {
    id: raw.id,
    term: raw.term || raw.keyword || '',
    intent: raw.intent || '',
    context: raw.context || '',
  };
}

// ============= AI INSIGHTS EXTRACTION =============

/**
 * Extract AI insights from generation params.
 * These come from the wizard's AI insights selection.
 * Includes hooks, talking points, CTA, script structure, and engagement drivers
 * for story adherence throughout the generation pipeline.
 */
export function extractAIInsights(
  generationParams: Record<string, any>
): AIInsights | null {
  const raw = generationParams.selected_ai_insights ||
    generationParams.ai_insights ||
    generationParams.aiInsights ||
    null;

  if (!raw) return null;

  return {
    // Single hook for story opening (separate mode or backwards compat)
    hook: raw.hook || null,
    // Multiple hooks for combine mode (all selected hooks in one output)
    hooks: raw.hooks || null,
    // Single CTA (separate mode or backwards compat)
    cta: raw.cta || null,
    // Multiple CTAs for combine mode (all selected CTAs in one output)
    ctas: raw.ctas || null,
    // Talking points for story adherence - key messages to cover
    talking_points: raw.talking_points || [],
    // Single talking point (for variation-based generation)
    talking_point: raw.talking_point || null,
    // Script structure for narrative flow
    script_structure: raw.script_structure || null,
    // Engagement drivers for emotional connection
    engagement_drivers: raw.engagement_drivers || [],
  };
}

// ============= REFERENCE IMAGE EXTRACTION =============

/**
 * Extract ALL reference images from all possible sources.
 * This aggregates images from:
 * - Explicit image_inputs from wizard
 * - Character reference images
 * - Product images
 * - Creator avatars
 * - Brand reference images and logos
 */
export function extractAllReferenceImages(
  libraryElements: Record<string, any>,
  imageInputs?: Record<string, string[]>
): string[] {
  const images: string[] = [];

  // Priority 1: Explicitly selected images from wizard (imageInputs)
  if (imageInputs) {
    // Handle both full table names and shorthand names
    const productImages = imageInputs.library_products || imageInputs.product || [];
    const characterImages = imageInputs.library_characters || imageInputs.character || [];
    const brandImages = imageInputs.library_brand_voices || imageInputs.brand || [];

    images.push(...productImages, ...characterImages, ...brandImages);
  }

  // Priority 2: If no explicit images, extract from library elements
  if (images.length === 0) {
    // Character reference images
    const character = extractCharacter(libraryElements);
    if (character?.referenceImageUrl) {
      images.push(character.referenceImageUrl);
    }
    if (character?.referenceImages?.length) {
      images.push(...character.referenceImages);
    }

    // Product images
    const product = extractProduct(libraryElements);
    if (product?.images?.length) {
      images.push(...product.images);
    }

    // Creator avatar
    const creator = extractCreator(libraryElements);
    if (creator?.avatarUrl) {
      images.push(creator.avatarUrl);
    }

    // Brand reference images and logo
    const brandVoice = extractBrandVoice(libraryElements);
    if (brandVoice?.referenceImages?.length) {
      images.push(...brandVoice.referenceImages);
    }
    if (brandVoice?.logo) {
      images.push(brandVoice.logo);
    }
  }

  // Also check for explicit reference_images array
  if (libraryElements.reference_images) {
    images.push(...libraryElements.reference_images);
  }

  // Deduplicate and filter out empty strings
  return [...new Set(images.filter(Boolean))];
}

// ============= ASPECT RATIO MAPPING =============

/**
 * Map friendly aspect ratio names to actual ratios.
 * Supports: landscape, portrait, square + pass-through for actual ratios
 */
const ASPECT_RATIO_MAP: Record<string, string> = {
  'landscape': '16:9',
  'portrait': '9:16',
  'square': '1:1',
  // Pass-through for actual ratios
  '16:9': '16:9',
  '9:16': '9:16',
  '1:1': '1:1',
  '4:5': '4:5',
  '4:3': '4:3',
  '3:2': '3:2',
};

/**
 * Convert aspect ratio (friendly name or actual ratio) to the numeric format.
 */
export function normalizeAspectRatio(ratio: string | undefined, defaultRatio = '1:1'): string {
  if (!ratio) return defaultRatio;
  return ASPECT_RATIO_MAP[ratio] || ratio;
}

// ============= VISUAL STYLE BUILDER =============

/**
 * Build visual style from brand voice and output configuration.
 */
export function buildVisualStyle(
  brandVoice: BrandVoice | null,
  outputConfig: Record<string, any>
): VisualStyle {
  const rawAspectRatio = outputConfig?.aspectRatio || outputConfig?.aspect_ratio;
  const aspectRatio = normalizeAspectRatio(rawAspectRatio, '1:1');

  return {
    aspectRatio,
    colorPalette: brandVoice?.colorPalette || [],
    fontStyle: brandVoice?.fontStyle || '',
    stylePreset: outputConfig?.stylePreset || outputConfig?.style_preset || 'modern',
    mood: brandVoice?.visualIdentity?.mood || '',
    referenceImages: brandVoice?.referenceImages || [],
  };
}

// ============= MODEL CONFIG EXTRACTION =============

/**
 * Extract model configuration from configuration object.
 */
export function extractModelConfig(configuration: Record<string, any>): ModelConfig {
  const modelConfig = configuration?.model_config || {};

  // Blueprint uses image_generator/tts/world_simulator; fall back to legacy image_llm/audio_llm/video_llm
  const imageConfig = modelConfig.image_generator || modelConfig.image_llm;
  const audioConfig = modelConfig.tts || modelConfig.audio_llm;
  const videoConfig = modelConfig.world_simulator || modelConfig.video_llm;

  return {
    textLlm: modelConfig.text_llm
      ? {
          modelId: modelConfig.text_llm.model_id || DEFAULT_FREE_TEXT_MODEL,
          temperature: modelConfig.text_llm.temperature,
          maxTokens: modelConfig.text_llm.max_tokens,
        }
      : undefined,
    imageLlm: imageConfig
      ? {
          modelId: imageConfig.model_id || DEFAULT_IMAGE_MODEL,
          provider: imageConfig.provider,
        }
      : undefined,
    audioLlm: audioConfig
      ? {
          modelId: audioConfig.model_id,
          voiceId: audioConfig.voice_id || audioConfig.parameters?.voice_id,
        }
      : undefined,
    videoLlm: videoConfig
      ? {
          modelId: videoConfig.model_id,
        }
      : undefined,
  };
}

// ============= VOICE ID RESOLUTION =============

const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Bella

/**
 * Resolve the ElevenLabs voice ID from execution context.
 * Characters are the canonical voice source. Blueprint TTS config is a fallback.
 *
 * Priority:
 *   1. character.voice_selection (direct ElevenLabs voice_id)
 *   2. character.voice_config.voice_id (legacy JSON config)
 *   3. character.heygen_voice_id (HeyGen voice, also works with ElevenLabs TTS)
 *   4. modelConfig.audioLlm.voiceId (blueprint-level fallback)
 *   5. Default Bella voice
 */
export function resolveVoiceId(context: ExecutionContext): string {
  // 1. Character voice_selection (preferred — direct ElevenLabs voice_id)
  if (context.character?.voice_selection) {
    console.log(`[resolveVoiceId] Using character.voice_selection: ${context.character.voice_selection}`);
    return context.character.voice_selection;
  }

  // 2. Character voice_config.voice_id (legacy JSON)
  if (context.character?.voice_config) {
    const config = typeof context.character.voice_config === 'string'
      ? JSON.parse(context.character.voice_config as string)
      : context.character.voice_config;
    if (config?.voice_id) {
      console.log(`[resolveVoiceId] Using character.voice_config.voice_id: ${config.voice_id}`);
      return config.voice_id;
    }
  }

  // 3. Character heygen_voice_id
  if (context.character?.heygen_voice_id) {
    console.log(`[resolveVoiceId] Using character.heygen_voice_id: ${context.character.heygen_voice_id}`);
    return context.character.heygen_voice_id;
  }

  // 4. Blueprint-level fallback
  if (context.modelConfig.audioLlm?.voiceId) {
    console.log(`[resolveVoiceId] Using modelConfig.audioLlm.voiceId (blueprint fallback): ${context.modelConfig.audioLlm.voiceId}`);
    return context.modelConfig.audioLlm.voiceId;
  }

  // 5. System default
  console.log(`[resolveVoiceId] Using default voice: ${DEFAULT_VOICE_ID}`);
  return DEFAULT_VOICE_ID;
}

// ============= IDEA CONTEXT EXTRACTION =============

/**
 * Extract idea context from various possible locations.
 */
export function extractIdeaContext(output: Record<string, any>): string {
  const generationParams = output.generation_params || {};

  // Check multiple locations for idea context
  return (
    generationParams.idea_context ||
    generationParams.slot_values?.idea ||
    generationParams.slot_values?.context ||
    generationParams.slot_values?.topic ||
    output.data?.idea ||
    ''
  );
}

// ============= MAIN CONTEXT BUILDER =============

export interface BuildContextOptions {
  output: Record<string, any>;
  stageId: string;
  configuration: Record<string, any>;
  decryptedApiKeys: Record<string, string>;
  // Optional regeneration parameters
  regenerateScene?: number;
  customPrompt?: string;
  instructions?: string;
}

/**
 * Build the complete ExecutionContext from output and configuration.
 * This is the main entry point for context building.
 */
export function buildExecutionContext(options: BuildContextOptions): ExecutionContext {
  const { output, stageId, configuration, decryptedApiKeys, regenerateScene, customPrompt, instructions } = options;

  const generationParams = output.generation_params || {};
  const libraryElements =
    configuration?.library_elements ||
    generationParams.library_elements ||
    {};
  const imageInputs = generationParams.image_inputs || {};
  const videoConfig = generationParams.video_config || configuration?.video_config || {};
  const outputConfig = generationParams.output_config || configuration?.output_config || {};

  // For video pipelines, aspect ratio can be in video_config
  // Priority: output_config (user explicit selection) > video_config > defaults
  const rawAspectRatio = outputConfig.aspectRatio || outputConfig.aspect_ratio ||
                         videoConfig.aspectRatio || videoConfig.aspect_ratio;
  // Normalize 'portrait' -> '9:16', 'landscape' -> '16:9', etc.
  const aspectRatioFromConfig = normalizeAspectRatio(rawAspectRatio);

  // Extract all library elements using unified extractors
  const brandVoice = extractBrandVoice(libraryElements);
  const character = extractCharacter(libraryElements);
  const product = extractProduct(libraryElements);
  const creator = extractCreator(libraryElements);
  const icp = extractICP(libraryElements);
  const searchTerm = extractSearchTerm(libraryElements);

  // Build derived data - pass aspect ratio from combined config sources
  const configWithAspectRatio = { ...outputConfig, aspectRatio: aspectRatioFromConfig };
  const visualStyle = buildVisualStyle(brandVoice, configWithAspectRatio);
  // Role mode (blueprint image_references): exactly those images, labelled by role.
  const refModelConfig = generationParams.model_config || configuration?.model_config;
  const referenceRoles = hasRoleReferences(refModelConfig)
    ? resolveRoleReferences(refModelConfig, libraryElements)
    : undefined;
  const referenceImages = referenceRoles
    ? referenceRoles.flatMap((r) => r.urls)
    : extractAllReferenceImages(libraryElements, imageInputs);
  const modelConfig = extractModelConfig(configuration);
  const ideaContext = extractIdeaContext(output);
  const aiInsights = extractAIInsights(generationParams);

  // Debug logging for reference images
  console.log('[ExecutionContext] Reference image extraction:', {
    imageInputsKeys: Object.keys(imageInputs),
    imageInputsValues: imageInputs,
    extractedCount: referenceImages.length,
    extractedImages: referenceImages,
  });

  // Compute whether avatar video will be available.
  // Priority: 1) explicit avatar_type='none' → false
  //           2) voice_avatar already ran → check actual output
  //           3) predict from configuration
  const avatarType: string = configuration?.avatar_type || generationParams.avatar_type || '';
  const stageData = output.stage_data || {};
  const voiceAvatarOutput = stageData.voice_avatar;
  let hasAvatarVideo: boolean;

  if (avatarType === 'none') {
    // User explicitly chose voiceover-only — no avatar video
    hasAvatarVideo = false;
  } else if (voiceAvatarOutput) {
    // voice_avatar already ran — use actual result
    hasAvatarVideo = !!voiceAvatarOutput.avatar_video_url;
  } else {
    // Predict from configuration (director runs before voice_avatar)
    const lipSyncProvider: string = configuration?.lip_sync_provider || generationParams.lip_sync_provider || 'elevenlabs';
    const hasAvatarPhotoForElevenLabs =
      !!(configuration?.avatar_photo_url || generationParams.avatar_photo_url ||
         character?.referenceImageUrl || character?.referenceImages?.length);
    const hasHeyGenAvatar = !!(character?.heygen_avatar_id || configuration?.heygen_avatar_id || generationParams.heygen_avatar_id);
    const hasBaseVideoForSyncLabs = !!(configuration?.base_avatar_video_url || generationParams.base_avatar_video_url);

    hasAvatarVideo =
      (lipSyncProvider === 'elevenlabs' && hasAvatarPhotoForElevenLabs) ||
      (lipSyncProvider === 'heygen' && hasHeyGenAvatar) ||
      (lipSyncProvider === 'sync_labs' && hasBaseVideoForSyncLabs);
  }

  // Compute presenter pipeline source flags
  const presenterConfig = generationParams.presenter_config || configuration?.presenter_config || {};
  const sourceType: string = presenterConfig.sourceType || presenterConfig.source_type || '';

  // Unified video pipeline flags (also check videoConfigObj for the new pipeline)
  const videoConfigObj = generationParams.video_config || configuration?.video_config || {};

  const hasVideoFrames: boolean =
    (sourceType === 'upload' || videoConfigObj.source === 'upload_video' || videoConfigObj.source === 'record')
    && !!stageData.video_ingest;

  const isPromptOnly: boolean =
    sourceType === 'prompt_only' || videoConfigObj.source === 'prompt_only';

  const hasBRoll: boolean =
    presenterConfig.bRollEnabled === true || presenterConfig.b_roll_enabled === true ||
    videoConfigObj.bRollEnabled === true || videoConfigObj.b_roll_enabled === true;

  const hasScreenshots: boolean = !!stageData.web_capture;
  const hasUploadedImages: boolean =
    (videoConfigObj.source === 'upload_images') &&
    !!((videoConfigObj.uploadedImageUrls || videoConfigObj.uploaded_image_urls || []).length);
  const hasStoryboardImages: boolean = !!stageData.images;
  const hasOutline: boolean = !!stageData.outline;
  const hasRewrite: boolean = !!stageData.rewrite;
  const hasTranscript: boolean = !!stageData.transcribe;
  const imageMode_ai_generated: boolean =
    (videoConfigObj.imageMode || videoConfigObj.image_mode) === 'ai_generated';

  // Video remix/rewrite template variables — extract from remix_config, video_config, or blueprint model_config
  const remixConfig = configuration?.remix_config || generationParams.remix_config || {};
  const rewriteStyle: string = remixConfig.rewrite_style || remixConfig.rewriteStyle || videoConfigObj.rewrite_style || videoConfigObj.rewriteStyle || 'polish';
  const targetLanguage: string = remixConfig.target_language || remixConfig.targetLanguage || videoConfigObj.target_language || videoConfigObj.targetLanguage || '';
  const customRewriteInstructions: string = remixConfig.custom_rewrite_instructions || remixConfig.customRewriteInstructions || videoConfigObj.custom_rewrite_instructions || videoConfigObj.customRewriteInstructions || '';
  const creativePrompt: string = remixConfig.creative_prompt || remixConfig.creativePrompt || videoConfigObj.creative_prompt || videoConfigObj.creativePrompt || generationParams.creative_prompt || '';

  const context: ExecutionContext = {
    // Core identifiers
    outputId: output.id,
    stageId,
    pipeline: output.pipeline,
    jobId: output.job_id,
    organizationId: output.organization_id || generationParams.organization_id || '',

    // Regeneration context (for single item regeneration)
    regenerateScene,
    customPrompt,
    instructions,

    // Normalized library elements
    brandVoice,
    character,
    product,
    creator,
    icp,
    searchTerm,

    // Content context
    ideaContext,
    ideaText: generationParams.slot_values?.idea_text || '',
    idea_text: generationParams.slot_values?.idea_text || '',
    ideaUrls: generationParams.slot_values?.idea_urls || '',
    idea_urls: generationParams.slot_values?.idea_urls || '',
    masterPrompt: generationParams.prompt || '',
    imagePromptTemplate: generationParams.image_prompt || generationParams.imagePrompt || '',
    directorPrompt: generationParams.director_prompt || generationParams.directorPrompt || '',
    previousStageOutputs: output.stage_data || {},

    // AI-generated insights from wizard
    aiInsights,

    // Output configuration - includes aspect ratio from video_config for video pipelines
    outputConfig: {
      slideCount: outputConfig.slideCount || outputConfig.slide_count,
      // Carousels: how many slides carry a takeaway (all but the cover and the CTA).
      // Computed here so prompts state the exact number and the model never does arithmetic.
      valueSlideCount: Math.max(1, Number(outputConfig.slideCount || outputConfig.slide_count || 5) - 2),
      sceneCount: outputConfig.sceneCount || outputConfig.scene_count || videoConfig.sceneCount,
      duration: outputConfig.duration || videoConfig.totalDuration || videoConfig.targetDuration || videoConfig.target_duration,
      aspectRatio: aspectRatioFromConfig, // Uses priority: output_config > video_config
      stylePreset: outputConfig.stylePreset || outputConfig.style_preset,
      ctaButtonText: outputConfig.ctaButtonText || outputConfig.cta_button_text || '',
    },

    // Visual configuration
    visualStyle,
    referenceImages,
    referenceRoles,

    // Model configuration
    modelConfig,

    // API keys
    apiKeys: decryptedApiKeys,

    // Computed flags for template conditionals
    hasAvatarVideo,
    hasVideoFrames,
    isPromptOnly,
    hasBRoll,

    // Unified video pipeline flags
    hasScreenshots,
    hasUploadedImages,
    hasStoryboardImages,
    hasOutline,
    hasRewrite,
    hasTranscript,
    imageMode_ai_generated,

    // Video remix template variables
    rewriteStyle,
    targetLanguage,
    customRewriteInstructions,
    creativePrompt,
    isPolish: rewriteStyle === 'polish',
    isShorten: rewriteStyle === 'shorten',
    isExpand: rewriteStyle === 'expand',
    isReact: rewriteStyle === 'react',
    isTranslate: rewriteStyle === 'translate',
    isCustom: rewriteStyle === 'custom',

    // Video remix visual style flags
    visualStyleMode: remixConfig.visual_style || remixConfig.visualStyle || 'remix',
    isRemixStyle: (remixConfig.visual_style || remixConfig.visualStyle || 'remix') === 'remix',
    isEnhanceStyle: (remixConfig.visual_style || remixConfig.visualStyle || 'remix') === 'enhance',

    // Aspect ratio orientation flags (for template conditionals)
    isPortrait: aspectRatioFromConfig === '9:16' || aspectRatioFromConfig === '4:5',
    isLandscape: aspectRatioFromConfig === '16:9',

    // System date variables (computed at job execution time)
    date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),

    // Raw data for edge cases
    rawGenerationParams: generationParams,
    rawConfiguration: configuration,
  };

  // ============= INJECT SLOT VALUES =============
  // Spread all slot_values onto the context so {{idea}}, {{context}}, {{title}},
  // {{topic}}, {{description}}, and any custom blueprint slot variables resolve correctly.
  // This mirrors the legacy buildPromptContext behavior.
  const slotValues = generationParams.slot_values || {};
  for (const [key, value] of Object.entries(slotValues)) {
    if (typeof value === 'string' && !(key in context)) {
      (context as any)[key] = value;
    }
  }

  // Ensure common aliases always resolve (with fallbacks to ideaContext)
  if (!(context as any).idea) (context as any).idea = slotValues.idea || ideaContext;
  if (!(context as any).context) (context as any).context = slotValues.context || ideaContext;
  if (!(context as any).title) (context as any).title = slotValues.title || ideaContext;
  if (!(context as any).topic) (context as any).topic = slotValues.topic || ideaContext;
  if (!(context as any).description) (context as any).description = slotValues.description || ideaContext;

  // ============= INJECT FLAT LIBRARY ELEMENT VARIABLES =============
  // Templates use {{brand}}, {{brand_name}}, {{character_name}}, {{product_name}} etc.
  // The structured objects (brandVoice, character, product) support dot-notation access
  // (e.g. {{brandVoice.name}}) but flat variables need explicit injection.
  if (brandVoice) {
    (context as any).brand = brandVoice.name || '';
    (context as any).brand_name = brandVoice.name || '';
    (context as any).brand_tone = brandVoice.tone || '';
    (context as any).brand_writing_style = brandVoice.writingStyle || '';
  }
  if (character) {
    // Note: context.character is the structured Character object for dot-notation access.
    // Flat {{character}} in templates should resolve to the name string.
    (context as any).character_name = character.name || '';
    (context as any).character_description = character.description || '';
    (context as any).character_visual_description = character.visualDescription || '';
  }
  if (product) {
    // Note: context.product is the structured Product object for dot-notation access.
    // Flat {{product}} in templates should resolve to the name string.
    (context as any).product_name = product.name || '';
    (context as any).product_description = product.description || '';
  }
  if (creator) {
    (context as any).creator_name = creator.name || '';
  }
  if (icp) {
    (context as any).icp_name = icp.name || '';
    (context as any).target_audience = icp.description || '';
    (context as any).audience_pain_points = Array.isArray(icp.painPoints) ? icp.painPoints.join(', ') : '';
  }

  // ============= INJECT FLAT AI INSIGHT VARIABLES =============
  // Templates use {{ai_hook}}, {{ai_talking_points}}, {{ai_cta}} etc. as top-level flat keys.
  // resolveAiInsightVars returns a flat map of all ai_* variables.
  const aiVars = resolveAiInsightVars(
    generationParams.idea_ai_analysis,
    generationParams.selected_ai_insights,
  );
  for (const [key, value] of Object.entries(aiVars)) {
    (context as any)[key] = value;
  }

  // Log context summary for debugging
  console.log('[ExecutionContext] Built context:', {
    outputId: context.outputId,
    stageId: context.stageId,
    pipeline: context.pipeline,
    hasBrandVoice: !!context.brandVoice,
    hasCharacter: !!context.character,
    hasProduct: !!context.product,
    hasAIInsights: !!context.aiInsights,
    referenceImageCount: context.referenceImages.length,
    ideaContextLength: context.ideaContext.length,
    hasApiKeys: Object.keys(context.apiKeys).length,
    // Regeneration context
    regenerateScene: context.regenerateScene,
    hasCustomPrompt: !!context.customPrompt,
    hasInstructions: !!context.instructions,
    // Avatar video availability
    hasAvatarVideo: context.hasAvatarVideo,
    // Presenter pipeline flags
    hasVideoFrames: context.hasVideoFrames,
    isPromptOnly: context.isPromptOnly,
    hasBRoll: context.hasBRoll,
    // Aspect ratio debugging
    rawAspectRatio: rawAspectRatio,
    normalizedAspectRatio: aspectRatioFromConfig,
    outputConfigAspectRatio: context.outputConfig.aspectRatio,
    visualStyleAspectRatio: context.visualStyle.aspectRatio,
    // Injected flat variables
    slotValueKeys: Object.keys(slotValues),
    aiVarKeys: Object.keys(aiVars),
    injectedIdea: (context as any).idea?.substring?.(0, 50) || '',
  });

  // Log detailed AI insights if present
  if (context.aiInsights) {
    console.log('[ExecutionContext] AI Insights:', {
      hasHook: !!context.aiInsights.hook,
      hooksCount: context.aiInsights.hooks?.length || 0,
      hasCta: !!context.aiInsights.cta,
      ctasCount: context.aiInsights.ctas?.length || 0,
      talkingPointsCount: context.aiInsights.talking_points?.length || 0,
      hasSingleTalkingPoint: !!context.aiInsights.talking_point,
      hasScriptStructure: !!context.aiInsights.script_structure,
      engagementDriversCount: context.aiInsights.engagement_drivers?.length || 0,
    });
  }

  return context;
}

// ============= UTILITY FUNCTIONS =============

/**
 * Get a nested property from context using dot notation.
 * Example: getContextValue(context, 'brandVoice.tone')
 */
export function getContextValue(context: ExecutionContext, path: string): any {
  const keys = path.split('.');
  let value: any = context;

  for (const key of keys) {
    if (value === null || value === undefined) return undefined;
    value = value[key];
  }

  return value;
}

/**
 * Check if context has required library elements for a stage.
 */
export function validateContextRequirements(
  context: ExecutionContext,
  requirements: {
    libraryElements?: string[];
    contextFields?: string[];
    previousStages?: string[];
  }
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  // Check library elements
  if (requirements.libraryElements) {
    for (const element of requirements.libraryElements) {
      const value = getContextValue(context, element);
      if (!value) {
        missing.push(`libraryElement:${element}`);
      }
    }
  }

  // Check context fields
  if (requirements.contextFields) {
    for (const field of requirements.contextFields) {
      const value = getContextValue(context, field);
      if (!value || (typeof value === 'string' && !value.trim())) {
        missing.push(`contextField:${field}`);
      }
    }
  }

  // Check previous stages
  if (requirements.previousStages) {
    for (const stageId of requirements.previousStages) {
      if (!context.previousStageOutputs[stageId]) {
        missing.push(`previousStage:${stageId}`);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
