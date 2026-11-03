/**
 * Unified Pipeline Execution Types
 *
 * This module defines the core types for the unified pipeline execution engine.
 * All types here are the canonical source of truth for execution context and stage definitions.
 */

// ============= LIBRARY ELEMENT TYPES =============

export interface BrandVoice {
  id?: string;
  name: string;
  tone?: string;
  vocabulary?: string[];
  writingStyle?: string;
  // Visual identity
  colorPalette?: string[] | {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
  fontStyle?: string;
  logo?: string;
  logos?: string[];
  referenceImages?: string[];
  // Visual template and style
  visualTemplate?: string;
  accentStyle?: string;
  visualIdentity?: {
    color_palette?: string[] | Record<string, string>;
    font_style?: string;
    mood?: string;
    reference_images?: string[];
    visual_template?: string;
    accent_style?: string;
  };
}

export interface Character {
  id?: string;
  name: string;
  description?: string;
  visualDescription?: string;
  personality?: string;
  referenceImageUrl?: string;
  referenceImages?: string[];
  // Detailed visual attributes for image generation
  visual_style?: string;
  gender?: string;
  build?: string;
  ethnicity?: string;
  hair_description?: string;
  typical_clothing?: string;
  age_range?: string;
  // HeyGen avatar video fields
  heygen_avatar_id?: string;
  heygen_voice_id?: string;
  heygen_config?: Record<string, any>;
  // ElevenLabs voice fields (canonical voice source)
  voice_selection?: string;
  voice_config?: Record<string, any>;
}

export interface Product {
  id?: string;
  name: string;
  description?: string;
  features?: string[];
  benefits?: string[];
  images?: string[];
  targetAudience?: string;
}

export interface Creator {
  id?: string;
  name: string;
  niche?: string;
  style?: string;
  avatarUrl?: string;
  bio?: string;
}

export interface ICP {
  id?: string;
  name: string;
  summary?: string;
  description?: string;
  painPoints?: string[];
  goals?: string[];
  demographics?: Record<string, any>;
}

export interface SearchTerm {
  id?: string;
  term: string;
  intent?: string;
  context?: string;
}

// ============= VISUAL STYLE TYPES =============

export interface VisualStyle {
  aspectRatio: string;
  colorPalette: string[];
  fontStyle: string;
  stylePreset?: string;
  mood?: string;
  referenceImages: string[];
}

// ============= MODEL CONFIG TYPES =============

export interface ModelConfig {
  textLlm?: {
    modelId: string;
    temperature?: number;
    maxTokens?: number;
  };
  imageLlm?: {
    modelId: string;
    provider?: string;
  };
  audioLlm?: {
    modelId: string;
    voiceId?: string;
  };
  videoLlm?: {
    modelId: string;
  };

  /**
   * Overrides for standard pipeline prompts.
   * Key matches stageId (e.g. 'script', 'caption', 'carousel_content').
   */
  promptOverrides?: Record<string, {
    system?: string;
    user?: string;
  }>;
}

// ============= AI INSIGHTS TYPES =============

export interface AIInsights {
  // Single hook - the attention-grabbing opening (for separate mode or backwards compat)
  hook?: {
    text: string;
    type?: string;
    index?: number;
  };
  // Multiple hooks - for combine mode where all selected hooks are in one output
  hooks?: Array<{
    text: string;
    type?: string;
    index?: number;
  }>;
  // Single CTA (for separate mode or backwards compat)
  cta?: {
    text: string;
    type?: string;
    placement?: string;
  };
  // Multiple CTAs - for combine mode where all selected CTAs are in one output
  ctas?: Array<{
    text: string;
    type?: string;
    placement?: string;
    index?: number;
  }>;
  // Talking points for story adherence - the key messages to cover
  talking_points?: string[];
  // Single talking point (for variations)
  talking_point?: {
    text: string;
    index?: number;
  };
  // Script structure for narrative flow
  script_structure?: {
    opening?: string;
    body?: string;
    climax?: string;
    closing?: string;
  };
  // Engagement drivers for emotional connection
  engagement_drivers?: string[];
}

// ============= EXECUTION CONTEXT =============

export interface ExecutionContext {
  // Core identifiers
  outputId: string;
  stageId: string;
  pipeline: string;
  jobId: string;
  organizationId: string;

  // Regeneration context (for single item regeneration)
  regenerateScene?: number;
  customPrompt?: string;
  instructions?: string;

  // Normalized library elements (single source of truth)
  brandVoice: BrandVoice | null;
  character: Character | null;
  product: Product | null;
  creator: Creator | null;
  icp: ICP | null;
  searchTerm: SearchTerm | null;

  // Content context
  ideaContext: string;
  /** User-provided free text from idea, resolvable as {{idea_text}} */
  ideaText: string;
  idea_text: string;
  /** Reference URLs from idea (newline-separated), resolvable as {{idea_urls}} */
  ideaUrls: string;
  idea_urls: string;
  masterPrompt: string;
  imagePromptTemplate?: string;
  directorPrompt?: string;
  previousStageOutputs: Record<string, any>;

  // AI-generated insights from wizard
  aiInsights: AIInsights | null;

  // Output configuration from wizard
  outputConfig: {
    slideCount?: number;
    /** Carousels: slideCount minus the cover and the CTA slide (min 1). */
    valueSlideCount?: number;
    sceneCount?: number;
    duration?: number;
    aspectRatio?: string;
    stylePreset?: string;
    /** Carousels: the blueprint's CTA instruction (not necessarily button-sized). */
    ctaButtonText?: string;
  };

  // Visual configuration
  visualStyle: VisualStyle;
  referenceImages: string[];
  /** Role-labelled references (blueprint image_references); when set, referenceImages is their flattened urls. */
  referenceRoles?: import('../image-references.ts').ResolvedReference[];

  // Model configuration
  modelConfig: ModelConfig;

  // Decrypted API keys by provider
  apiKeys: Record<string, string>;

  // Computed flags for template conditionals
  /** True when lip-sync avatar video is expected (avatar photo/ID configured) */
  hasAvatarVideo: boolean;
  /** True when sourceType === 'upload' and video_ingest output exists */
  hasVideoFrames: boolean;
  /** True when sourceType === 'prompt_only' (no source stage) */
  isPromptOnly: boolean;
  /** True when bRollEnabled in presenter config */
  hasBRoll: boolean;

  // Unified video pipeline flags
  /** True when web_capture output exists (URL source) */
  hasScreenshots?: boolean;
  /** True when upload_images source with uploaded image URLs */
  hasUploadedImages?: boolean;
  /** True when images stage output exists (AI-generated storyboard images) */
  hasStoryboardImages?: boolean;
  /** True when outline stage output exists */
  hasOutline?: boolean;
  /** True when rewrite stage output exists */
  hasRewrite?: boolean;
  /** True when transcribe stage output exists */
  hasTranscript?: boolean;
  /** True when imageMode is 'ai_generated' */
  imageMode_ai_generated?: boolean;

  // Video remix template variables (populated from remix_config)
  /** Rewrite style name for {{rewriteStyle}} */
  rewriteStyle?: string;
  /** Target language for {{targetLanguage}} */
  targetLanguage?: string;
  /** Custom rewrite instructions for {{customRewriteInstructions}} */
  customRewriteInstructions?: string;
  /** Creative prompt from blueprint for {{creativePrompt}} */
  creativePrompt?: string;
  /** Boolean flags for rewrite mode conditionals */
  isPolish?: boolean;
  isShorten?: boolean;
  isExpand?: boolean;
  isReact?: boolean;
  isTranslate?: boolean;
  isCustom?: boolean;
  /** Visual style for remix: 'remix' or 'enhance' */
  visualStyleMode?: string;
  /** True when remix visual_style === 'remix' (full creative re-editing) */
  isRemixStyle?: boolean;
  /** True when remix visual_style === 'enhance' (light polish, preserve order) */
  isEnhanceStyle?: boolean;

  // Aspect ratio orientation flags
  /** True when aspect ratio is portrait (9:16 or 4:5) */
  isPortrait?: boolean;
  /** True when aspect ratio is landscape (16:9) */
  isLandscape?: boolean;

  // System date variables (computed at job execution time)
  /** Today's date formatted as "Month D, YYYY" e.g. "March 3, 2026" */
  date?: string;

  // Raw data for edge cases
  rawGenerationParams: Record<string, any>;
  rawConfiguration: Record<string, any>;

  // Dynamic slot values and flat AI insight variables
  // These are injected at runtime from slot_values and applyAiInsightsToContext
  [key: string]: any;
}

// ============= STAGE DEFINITION TYPES =============

export type StageType = 'text' | 'image' | 'audio' | 'video' | 'composite';
export type ProviderType = 'openrouter' | 'replicate' | 'elevenlabs' | 'creativeflow' | 'fal' | 'heygen' | 'remotion' | 'web_capture' | 'pexels' | 'video_ingest';

export interface StageRequirements {
  /** Previous stages whose output this stage needs */
  previousStages?: string[];
  /** Library elements this stage uses */
  libraryElements?: ('brandVoice' | 'character' | 'product' | 'creator' | 'icp' | 'searchTerm')[];
  /** Context fields this stage needs */
  contextFields?: ('ideaContext' | 'masterPrompt' | 'visualStyle' | 'referenceImages')[];
}

export interface PromptTemplate {
  /** System prompt template (supports {{variable}} syntax) */
  system: string;
  /** User prompt template */
  user: string;
  /** Variables to inject from context */
  variables?: string[];
}

export interface ProviderConfig {
  /** Model ID to use */
  model?: string;
  /** For text models */
  temperature?: number;
  maxTokens?: number;
  /** For image models */
  aspectRatio?: string;
  useReferenceImage?: boolean;
  referenceStrength?: number;
  /** For audio models */
  voiceId?: string;
  /** For video models */
  duration?: number;
}

export interface StageDefinition {
  /** Unique stage identifier */
  id: string;
  /** Stage type determines which provider category to use */
  type: StageType;
  /** Which provider handles this stage */
  provider: ProviderType;
  /** What this stage requires from context */
  requires: StageRequirements;
  /** Prompt template for text/prompt-based stages */
  promptTemplate?: PromptTemplate;
  /** Provider-specific configuration */
  providerConfig: ProviderConfig;
  /** Optional output transformation function name (for complex outputs) */
  outputTransform?: string;
  /** Whether this stage is async (uses webhooks) */
  isAsync?: boolean;
  /** Custom handler name if not using generic execution */
  customHandler?: string;
}

// ============= PROVIDER TYPES =============

export interface ProviderRequest {
  prompt: string;
  systemPrompt?: string;
  model: string;
  referenceImages?: string[];
  /** Vision images to include in the user message (OpenAI content-part format) */
  images?: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }>;
  config: Record<string, any>;
  webhookUrl?: string;
  metadata?: Record<string, any>;
}

export interface ProviderResponse {
  content: any;
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  cost?: number;
  predictionId?: string;
  status?: 'completed' | 'pending' | 'failed';
  /** Chat completion finish_reason ('stop', 'length', ...) for text providers. */
  finishReason?: string;
}

// ============= STAGE RESULT TYPES =============

export interface StageResult {
  content: any;
  text?: string;
  model?: string;
  usage?: Record<string, number>;
  cost?: number;
  predictionId?: string;
  status: 'completed' | 'pending' | 'failed' | 'generating';
  error?: string;
  /** Text stages: the provider's finish_reason. 'length' = max_tokens ran out. */
  finishReason?: string;
}

// ============= PIPELINE TYPES =============

export type PipelineType =
  | 'rich_article'
  | 'social_media_post'
  | 'instagram_carousel'
  | 'instagram_carousel_ai'
  | 'image_only'
  | 'ugc_video'
  | 'ugc_heygen'
  | 'ugc_heygen_template'
  | 'generative_video_oneshot'
  | 'video_script'
  | 'storyboard_video_longform'
  | 'presenter_video'
  | 'video_remix'
  | 'video';

export interface PipelineDefinition {
  id: PipelineType;
  name: string;
  stages: string[];
  description?: string;
}
