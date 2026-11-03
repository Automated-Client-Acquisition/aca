import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { DEFAULT_FREE_TEXT_MODEL, carouselImageProviderIsOpenAI } from '../_shared/default-models.ts';
import { isOllamaModel, stripOllamaPrefix, OLLAMA_CLOUD_BASE_URL, OLLAMA_NO_KEY_SENTINEL } from '../_shared/llm-client.ts';
import { transformLibraryKeys, resolvePrompt, type GenerationItemAiInsights } from '../_shared/prompt-resolver.ts';
import { resolvePresenterStages } from '../_shared/stages/definitions/presenter_video.ts';
import { resolveRemixStages } from '../_shared/stages/definitions/video_remix.ts';
import { resolveVideoStages } from '../_shared/stages/definitions/video.ts';
import { handleOpenRouterCreditsError } from '../_shared/openrouter-credits.ts';
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { fillLibraryElements, loadWorkspaceDefaults, type BlueprintContext, type LibraryKind } from '../_shared/library-defaults.ts';
import { recentReferencePicks, rotateReferences, rotatesReferences, tablesNeededByReferences, type ReferencePicks } from '../_shared/image-references.ts';
import { applyLook, getImageLooks, lookMode, pickLooks, pieceLook, recentLookIds, type ImageLook } from '../_shared/image-looks.ts';
import { resolveOutputConfig } from '../_shared/blueprint-output-config.ts';
import { queueForPublish } from '../_shared/autopilot-publish.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


// Output budget for text calls when the blueprint doesn't set max_tokens.
// OpenRouter's affordability check reserves credit for max_tokens — or, when the field
// is omitted, for the model's ENTIRE max output budget (Claude Sonnet 4.6 = 65536
// tokens ≈ $0.98). Omitting it therefore demands ~$1 of credit for a request that
// actually costs cents, and 402s the job as soon as the balance dips below that.
const DEFAULT_TEXT_MAX_TOKENS = 8192;

// Pipeline stage definitions (synced with execute-stage)
const PIPELINE_STAGES: Record<string, Array<{ id: string; modelType: string; outputFormat?: string; inputFrom?: string[] }>> = {
  ugc_video: [
    { id: 'script', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'voice', modelType: 'tts', inputFrom: ['script'] },
    { id: 'video', modelType: 'face_swap', inputFrom: ['script', 'voice'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['video', 'voice'] }
  ],
  generative_video_oneshot: [
    { id: 'scene_prompts', modelType: 'text_llm', outputFormat: 'text_array' },
    { id: 'clips', modelType: 'world_simulator', inputFrom: ['scene_prompts'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['clips'] }
  ],
  storyboard_video_longform: [
    { id: 'outline', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'full_voiceover', modelType: 'tts', inputFrom: ['outline'] },
    { id: 'scenes', modelType: 'text_llm', outputFormat: 'scene_array', inputFrom: ['outline', 'full_voiceover'] },
    { id: 'storyboard', modelType: 'image_generator', inputFrom: ['scenes'] },
    { id: 'final', modelType: 'assembly', inputFrom: ['storyboard', 'full_voiceover', 'scenes'] }
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
  presenter_video: [
    { id: 'web_capture', modelType: 'assembly', outputFormat: 'urls' },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['web_capture'] },
    { id: 'voice_avatar', modelType: 'tts', inputFrom: ['director'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['web_capture', 'director', 'voice_avatar'] },
  ],
  video_remix: [
    { id: 'video_ingest', modelType: 'assembly', outputFormat: 'urls' },
    { id: 'transcribe', modelType: 'tts', inputFrom: ['video_ingest'] },
    { id: 'rewrite', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['transcribe'] },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['video_ingest', 'rewrite', 'transcribe'] },
    { id: 'voice_avatar', modelType: 'tts', inputFrom: ['rewrite'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['video_ingest', 'director', 'voice_avatar'] },
  ],
  video_script: [
    { id: 'text', modelType: 'text_llm', outputFormat: 'text' },
  ],
  video: [
    // Default stages — dynamically resolved by resolveVideoStages at dispatch time
    { id: 'outline', modelType: 'text_llm', outputFormat: 'text' },
    { id: 'voiceover', modelType: 'tts', inputFrom: ['outline'] },
    { id: 'director', modelType: 'text_llm', outputFormat: 'text', inputFrom: ['outline', 'voiceover'] },
    { id: 'composition', modelType: 'assembly', inputFrom: ['director', 'voiceover'] },
  ],
};

/**
 * Get the first stage ID for a given pipeline
 */
function getFirstStageId(pipeline: string): string {
  const stages = PIPELINE_STAGES[pipeline];
  if (!stages || stages.length === 0) {
    return 'script'; // Fallback for simple text-only pipelines
  }
  return stages[0].id;
}

// Carousel style types
interface CarouselColorPalette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  textMuted: string;
}

interface CarouselStyleConfig {
  template: 'minimal' | 'bold' | 'elegant' | 'playful' | 'professional';
  palette: CarouselColorPalette;
  fontStyle: 'sans-serif' | 'serif' | 'display' | 'handwritten';
  accentStyle: 'gradient' | 'solid' | 'outline' | 'glow';
  aspectRatio: '1:1' | '4:5' | '9:16';
  visualStyle?: string;
  moodKeywords?: string[];
  styleGuidelines?: string;
}

// Default palettes based on tone keywords
const TONE_PALETTE_MAP: Record<string, Partial<CarouselColorPalette>> = {
  professional: { primary: '#2563eb', secondary: '#3b82f6', background: '#f8fafc', text: '#1e293b', textMuted: '#64748b' },
  bold: { primary: '#ff3366', secondary: '#6633ff', background: '#0a0a0a', text: '#ffffff', textMuted: '#cccccc' },
  elegant: { primary: '#c9a962', secondary: '#2c3e50', background: '#f8f6f3', text: '#2c3e50', textMuted: '#7f8c8d' },
  playful: { primary: '#ff6b6b', secondary: '#4ecdc4', background: '#fff9db', text: '#2d3436', textMuted: '#636e72' },
  minimal: { primary: '#1a1a1a', secondary: '#666666', background: '#ffffff', text: '#1a1a1a', textMuted: '#888888' },
  friendly: { primary: '#22c55e', secondary: '#16a34a', background: '#f0fdf4', text: '#166534', textMuted: '#4ade80' },
  luxury: { primary: '#d4af37', secondary: '#1a1a1a', background: '#0a0a0a', text: '#ffffff', textMuted: '#a3a3a3' },
  casual: { primary: '#3b82f6', secondary: '#60a5fa', background: '#f8fafc', text: '#1e293b', textMuted: '#94a3b8' },
};

const DEFAULT_CAROUSEL_PALETTE: CarouselColorPalette = {
  primary: '#2563eb',
  secondary: '#3b82f6',
  background: '#f8fafc',
  text: '#1e293b',
  textMuted: '#64748b',
};

// Template-based visual style presets (for auto-populating when brand voice has template but no explicit visualStyle)
const TEMPLATE_STYLE_PRESETS: Record<string, { visualStyle: string; moodKeywords: string[] }> = {
  minimal: {
    visualStyle: 'minimalist clean design, lots of whitespace, simple shapes',
    moodKeywords: ['clean', 'modern', 'simple'],
  },
  bold: {
    visualStyle: 'bold high-contrast design, vibrant colors, strong typography',
    moodKeywords: ['energetic', 'bold', 'attention-grabbing'],
  },
  elegant: {
    visualStyle: 'elegant sophisticated design, muted tones, refined aesthetic',
    moodKeywords: ['luxury', 'sophisticated', 'premium'],
  },
  playful: {
    visualStyle: 'playful fun design, rounded shapes, bright cheerful colors',
    moodKeywords: ['fun', 'friendly', 'approachable'],
  },
  professional: {
    visualStyle: 'professional corporate design, clean lines, trustworthy appearance',
    moodKeywords: ['professional', 'trustworthy', 'corporate'],
  },
};

/**
 * Build carousel style configuration from brand voice visual styling
 * Falls back to tone-based defaults if visual styling is not set
 */
function buildCarouselStyleFromBrandVoice(
  brandVoice: any,
  outputConfig?: any
): CarouselStyleConfig {
  // Map output config aspect ratio to carousel format
  const mapAspectRatio = (ar?: string): '1:1' | '4:5' | '9:16' => {
    if (!ar) return '1:1';
    // Handle direct formats
    if (ar === '4:5') return '4:5';
    if (ar === '9:16') return '9:16';
    if (ar === '1:1') return '1:1';
    // Handle named formats
    if (ar === 'square') return '1:1';
    if (ar === 'portrait' || ar === 'vertical') return '4:5';
    if (ar === 'story' || ar === 'reel') return '9:16';
    // Default to square for carousels
    return '1:1';
  };

  // Start with defaults
  let style: CarouselStyleConfig = {
    template: 'professional',
    palette: { ...DEFAULT_CAROUSEL_PALETTE },
    fontStyle: 'sans-serif',
    accentStyle: 'solid',
    aspectRatio: mapAspectRatio(outputConfig?.aspectRatio),
    visualStyle: 'professional corporate design, clean lines, trustworthy appearance',
    moodKeywords: ['professional', 'trustworthy', 'corporate'],
  };

  if (!brandVoice) {
    return style;
  }

  // Check if brand voice has visual styling
  const hasVisualStyling = brandVoice.visual_template ||
                          brandVoice.color_palette ||
                          brandVoice.font_style ||
                          brandVoice.accent_style;

  if (hasVisualStyling) {
    // Use brand voice visual styling
    console.log('Using brand voice visual styling for carousel');

    style.template = brandVoice.visual_template || 'professional';

    if (brandVoice.color_palette) {
      style.palette = {
        primary: brandVoice.color_palette.primary || DEFAULT_CAROUSEL_PALETTE.primary,
        secondary: brandVoice.color_palette.secondary || DEFAULT_CAROUSEL_PALETTE.secondary,
        background: brandVoice.color_palette.background || DEFAULT_CAROUSEL_PALETTE.background,
        text: brandVoice.color_palette.text || DEFAULT_CAROUSEL_PALETTE.text,
        textMuted: brandVoice.color_palette.textMuted || DEFAULT_CAROUSEL_PALETTE.textMuted,
      };
    }

    style.fontStyle = brandVoice.font_style || 'sans-serif';
    style.accentStyle = brandVoice.accent_style || 'solid';

    // Use explicit values if set, otherwise fall back to template-based presets
    const templatePreset = TEMPLATE_STYLE_PRESETS[style.template] || TEMPLATE_STYLE_PRESETS.professional;
    style.visualStyle = brandVoice.visual_style_description || templatePreset.visualStyle;
    style.moodKeywords = brandVoice.mood_keywords?.length > 0 ? brandVoice.mood_keywords : templatePreset.moodKeywords;

    if (brandVoice.style_guidelines) {
      style.styleGuidelines = brandVoice.style_guidelines;
    }
  } else if (brandVoice.tone) {
    // Fall back to tone-based defaults
    console.log(`Using tone-based carousel style for: ${brandVoice.tone}`);

    const toneLower = brandVoice.tone.toLowerCase();

    // Find matching tone palette and set template
    for (const [key, palette] of Object.entries(TONE_PALETTE_MAP)) {
      if (toneLower.includes(key)) {
        style.palette = { ...DEFAULT_CAROUSEL_PALETTE, ...palette };
        style.template = key as any;
        // Also set visualStyle from template preset
        const templatePreset = TEMPLATE_STYLE_PRESETS[key];
        if (templatePreset) {
          style.visualStyle = templatePreset.visualStyle;
          style.moodKeywords = templatePreset.moodKeywords;
        }
        break;
      }
    }

    // If no template preset matched, set mood keywords from tone
    if (!style.visualStyle || style.visualStyle === 'professional corporate design, clean lines, trustworthy appearance') {
      style.moodKeywords = brandVoice.tone.split(/[,&]/).map((t: string) => t.trim().toLowerCase());
    }

    // Include style guidelines if available
    if (brandVoice.style_guidelines) {
      style.styleGuidelines = brandVoice.style_guidelines;
    }
  }

  // Apply custom palette overrides from blueprint output_config
  if (outputConfig?.customPalette) {
    const cp = outputConfig.customPalette;
    console.log('Applying custom palette overrides from blueprint');
    if (cp.primary) style.palette.primary = cp.primary;
    if (cp.secondary) style.palette.secondary = cp.secondary;
    if (cp.background) style.palette.background = cp.background;
    if (cp.text) style.palette.text = cp.text;
    if (cp.accent) style.palette.textMuted = cp.accent;
  }

  return style;
}


interface GenerationItem {
  idea_id: string;
  idea_title: string;
  slot_values: Record<string, string>;
  library_elements?: Record<string, any>;
  selected_paths?: Record<string, Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>>;
  image_inputs?: Record<string, string[]>;
  selected_ai_insights?: GenerationItemAiInsights;
  // Direct AI data from idea (for {{ai_talking_points_list}} etc. in image prompts)
  idea_ai_analysis?: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Hoisted so the outer catch block can mark the job failed. Previously
  // re-read via req.clone().json() in the catch, which silently fails
  // because req.json() at the top of the try already consumed the body —
  // resulting in jobs stuck at status='processing' forever.
  let job_id: string | undefined;
  try {
    const parsed = await req.json();
    job_id = parsed.job_id;

    if (!job_id) {
      throw new Error('job_id is required');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch the job
    const { data: job, error: jobError } = await supabase
      .from('content_generation_jobs')
      .select('*, blueprints(*)')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    // verify_jwt=false: without this anyone with a job id could run it on the org's API keys.
    try {
      await assertOrgAccess(req, supabase, job.organization_id);
    } catch (authErr) {
      job_id = undefined; // don't let the outer catch mark someone else's job failed
      return unauthorized(authErr, corsHeaders);
    }

    if (job.status !== 'queued') {
      throw new Error(`Job ${job_id} is not in queued status`);
    }

    console.log(`Starting dispatch for job ${job_id} with ${job.items?.length || 0} items`);

    // Update job to processing
    await supabase
      .from('content_generation_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString()
      })
      .eq('id', job_id);

    // Get organization's API keys
    const { data: apiKeys, error: apiKeysError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('organization_id', job.organization_id);

    if (apiKeysError || !apiKeys || apiKeys.length === 0) {
      throw new Error('No API keys configured for organization. Please add API keys in Settings > API Keys.');
    }

    const items = (job.items as any[] || []) as GenerationItem[];
    const dbBlueprint = job.blueprints;
    const configuration = job.configuration as any;
    const pipelineFromConfig = configuration?.pipeline || dbBlueprint?.pipeline;

    // Validate required API keys for pipeline type BEFORE processing.
    // Throw a tagged error so the catch block can return a 400 with a structured
    // { code, provider, message } payload — the frontend detects the code and
    // pops the right dialog. We distinguish MISSING_API_KEY (no row) from
    // INVALID_API_KEY (row exists but is_valid=false) because the remediation
    // and the user's mental model are different: "missing" → add; "invalid"
    // → rotate. Conflating them sends users to a screen where the key already
    // shows up, leaving them stuck (see Dan's bug report).
    const missingKey = (provider: string, message: string) => {
      const err: any = new Error(message);
      err.code = 'MISSING_API_KEY';
      err.provider = provider;
      err.userFacing = true;
      return err;
    };
    const invalidKey = (provider: string, message: string) => {
      const err: any = new Error(message);
      err.code = 'INVALID_API_KEY';
      err.provider = provider;
      err.userFacing = true;
      return err;
    };
    const PROVIDER_DISPLAY: Record<string, string> = {
      openrouter: 'OpenRouter',
      ollama: 'Ollama',
      replicate: 'Replicate',
      elevenlabs: 'ElevenLabs',
      heygen: 'HeyGen',
      openai: 'OpenAI',
    };
    // Centralized check: ensures a usable (present AND is_valid !== false) key
    // exists, and throws the precise error for whichever case fails.
    const requireUsableKey = (provider: string, context: string, settingsPath = 'Settings > API Keys') => {
      const label = PROVIDER_DISPLAY[provider] ?? provider;
      const row = apiKeys.find((k: any) => k.provider === provider);
      if (!row) {
        throw missingKey(provider, `${label} API key is required ${context}. Please add it in ${settingsPath}.`);
      }
      if (row.is_valid === false) {
        throw invalidKey(
          provider,
          `Your ${label} API key was flagged as invalid (last checked ${row.last_validated ?? 'recently'}). The key may have been revoked or rotated on ${label}'s side. Please update it in ${settingsPath}.`,
        );
      }
      return row;
    };

    const videoPipelines = ['ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video'];
    const textPipelines = ['social_media_post', 'instagram_carousel', 'instagram_carousel_ai', 'video_script', 'rich_article', 'twitter_thread'];
    const requiresOpenRouter = videoPipelines.includes(pipelineFromConfig) || textPipelines.includes(pipelineFromConfig);

    if (requiresOpenRouter) {
      // When the blueprint's text model runs on Ollama, an Ollama key satisfies
      // the text-generation requirement for text pipelines (image/video stages
      // below still demand their own providers).
      const mergedMcPre = {
        ...((job.blueprints || {}).model_config || {}),
        ...(((configuration?.blueprint || {}) as any).model_config || {}),
      } as Record<string, any>;
      const textCfgPre = mergedMcPre.text_llm || {};
      const textUsesOllama = textCfgPre.provider === 'ollama' || String(textCfgPre.model_id || '').startsWith('ollama:');
      if (textUsesOllama && textPipelines.includes(pipelineFromConfig)) {
        requireUsableKey('ollama', `for ${pipelineFromConfig} pipeline (Ollama text model)`);
        console.log('✓ Ollama key found for text generation');
      } else {
        requireUsableKey('openrouter', `for ${pipelineFromConfig} pipeline`);
        console.log('✓ OpenRouter API key found for text generation');
      }
    }

    // AI carousel slides: GPT-5.5 (OpenAI) or Gemini/Nano Banana (OpenRouter),
    // chosen per blueprint via the image_generator provider. Only the GPT-5.5 path
    // needs an OpenAI key; the Gemini path runs through OpenRouter (already required
    // above). Uses the same predicate as the slide-stage dispatcher so the key we
    // demand matches the engine that will actually run.
    if (pipelineFromConfig === 'instagram_carousel_ai') {
      const mergedMc = {
        ...((job.blueprints || {}).model_config || {}),
        ...(((configuration?.blueprint || {}) as any).model_config || {}),
      } as Record<string, any>;
      const imgCfg = mergedMc.image_generator || mergedMc.image_llm;
      if (carouselImageProviderIsOpenAI(imgCfg)) {
        requireUsableKey('openai', 'for the AI Carousel pipeline (GPT-5.5 slide images)');
        console.log('✓ OpenAI API key found for AI carousel image generation (GPT-5.5)');
      } else {
        console.log('✓ AI carousel uses OpenRouter/Gemini for slide images — OpenAI key not required');
      }
    }

    // Image generation now uses OpenRouter (modalities: ['image']) for all image pipelines
    // Only ugc_video (face_swap) and generative_video_oneshot (world_simulator) still need Replicate
    const requiresReplicate = ['ugc_video', 'generative_video_oneshot'].includes(pipelineFromConfig);
    if (requiresReplicate) {
      requireUsableKey('replicate', `for ${pipelineFromConfig} pipeline (video generation)`);
      console.log('✓ Replicate API key found for video generation');
    }

    // Image-only pipelines need OpenRouter for image generation (via modalities: ['image'])
    const requiresOpenRouterImage = ['image_only', 'social_media_post', 'rich_article'].includes(pipelineFromConfig);
    if (requiresOpenRouterImage && !requiresOpenRouter) {
      requireUsableKey('openrouter', `for ${pipelineFromConfig} pipeline (image generation)`);
      console.log('✓ OpenRouter API key found for image generation');
    }

    // TTS requires ElevenLabs for video pipelines with voice
    const requiresElevenLabs = ['ugc_video', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video'].includes(pipelineFromConfig);
    if (requiresElevenLabs) {
      const elevenLabsKey = apiKeys.find((k: any) => k.provider === 'elevenlabs');
      if (!elevenLabsKey) {
        console.warn('⚠️ ElevenLabs API key not found - TTS stages may fail');
        // Don't throw here as some video pipelines might not need TTS
      } else if (elevenLabsKey.is_valid === false) {
        console.warn('⚠️ ElevenLabs API key is flagged invalid - TTS stages may fail');
      } else {
        console.log('✓ ElevenLabs API key found for TTS');
      }
    }

    // HeyGen pipelines require HeyGen API key
    const requiresHeyGen = ['ugc_heygen', 'ugc_heygen_template'].includes(pipelineFromConfig);
    if (requiresHeyGen) {
      requireUsableKey('heygen', 'for HeyGen video pipelines', 'Settings > Integrations');
      console.log('✓ HeyGen API key found for avatar video generation');
    }

    // Image/video pipelines also need at least one active storage credential
    // so generated assets have a place to land. Catch this BEFORE any item runs
    // so the user isn't left with a stuck job and a consumed credit.
    {
      const NON_TEXT_PIPELINES = new Set([
        'social_media_post', 'instagram_carousel', 'instagram_carousel_ai', 'rich_article', 'image_only',
        'ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot',
        'storyboard_video_longform', 'presenter_video', 'video_remix', 'video',
      ]);
      if (NON_TEXT_PIPELINES.has(pipelineFromConfig)) {
        const { count: storageCount } = await supabase
          .from('storage_credentials')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', job.organization_id)
          .eq('is_active', true);
        if (!storageCount || storageCount === 0) {
          throw missingKey(
            'storage',
            'Cloud Storage is required to save generated content. Please configure storage in Settings > Storage.'
          );
        }
      }
    }

    // If the blueprint pins an explicit `provider` on any model_config entry
    // and that provider needs an API key, validate it up-front. We trust the
    // blueprint's declared provider rather than ai_models (which can register
    // a model under a single provider even when ACA actually routes it through
    // a different one). This catches the case where a blueprint pins a
    // provider the org doesn't have a key for.
    {
      const KEYED_PROVIDERS = new Set(['openrouter', 'replicate', 'elevenlabs', 'heygen', 'openai']);
      const PROVIDER_LABELS: Record<string, string> = {
        openrouter: 'OpenRouter',
        replicate: 'Replicate',
        elevenlabs: 'ElevenLabs',
        heygen: 'HeyGen',
        openai: 'OpenAI',
      };
      const dbBlueprintForCheck = job.blueprints || {};
      const cfgBlueprintForCheck = (configuration?.blueprint || {}) as Record<string, any>;
      const mergedModelConfig = {
        ...(dbBlueprintForCheck.model_config || {}),
        ...(cfgBlueprintForCheck.model_config || {}),
      } as Record<string, any>;

      // Blueprints ship a full model_config (tts, heygen_*, ...) even when the
      // pipeline never runs those stages. A text/image pipeline must not demand
      // an ElevenLabs or HeyGen key just because the blueprint carries a default
      // voice/avatar model. Slots not listed here are always checked.
      const SLOT_PIPELINES: Record<string, string[]> = {
        tts: ['ugc_video', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video'],
        heygen_video: ['ugc_heygen', 'ugc_heygen_template'],
        heygen_template: ['ugc_heygen', 'ugc_heygen_template'],
      };

      const declaredProviders = new Set<string>();
      for (const [slot, cfgValue] of Object.entries(mergedModelConfig)) {
        const slotPipelines = SLOT_PIPELINES[slot];
        if (slotPipelines && !slotPipelines.includes(pipelineFromConfig)) continue;
        if (cfgValue && typeof cfgValue === 'object') {
          const declared = (cfgValue as any).provider;
          if (typeof declared === 'string' && KEYED_PROVIDERS.has(declared)) {
            declaredProviders.add(declared);
          }
        }
      }

      for (const provider of declaredProviders) {
        const label = PROVIDER_LABELS[provider] || provider;
        const row = apiKeys.find((k: any) => k.provider === provider);
        if (!row) {
          throw missingKey(
            provider,
            `${label} API key is required by this blueprint's model configuration. Please add it in Settings > API Keys.`,
          );
        }
        if (row.is_valid === false) {
          throw invalidKey(
            provider,
            `Your ${label} API key (required by this blueprint's model configuration) was flagged as invalid (last checked ${row.last_validated ?? 'recently'}). The key may have been revoked or rotated on ${label}'s side. Please update it in Settings > API Keys.`,
          );
        }
      }
    }

    // Merge database blueprint with configuration.blueprint to use custom prompts if provided
    // configuration.blueprint contains customized master_prompt and image_prompt from the wizard
    const blueprint = {
      ...dbBlueprint,
      ...configuration?.blueprint,
    };

    // Log if custom prompts are being used
    if (configuration?.blueprint?.master_prompt && configuration.blueprint.master_prompt !== dbBlueprint?.master_prompt) {
      console.log('📝 Using custom master_prompt from wizard (different from blueprint)');
    }
    if (configuration?.blueprint?.image_prompt && configuration.blueprint.image_prompt !== dbBlueprint?.image_prompt) {
      console.log('🖼️ Using custom image_prompt from wizard (different from blueprint)');
    }

    const pipeline = configuration?.pipeline || blueprint?.pipeline;

    console.log(`Processing ${items.length} items for pipeline: ${pipeline}`);
    // Log pipeline-specific config
    const carouselPipelines = ['instagram_carousel', 'instagram_carousel_ai'];
    if (videoPipelines.includes(pipeline)) {
      console.log(`📐 Video config:`, JSON.stringify(configuration?.video_config));
    } else if (carouselPipelines.includes(pipeline)) {
      console.log(`📐 Carousel config:`, JSON.stringify(configuration?.output_config));
    }
    console.log(`📐 Output config:`, JSON.stringify(configuration?.output_config));

    // Check if this is a multi-stage pipeline
    const multiStagePipelines = ['ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video', 'instagram_carousel', 'instagram_carousel_ai', 'social_media_post', 'image_only', 'video_script', 'twitter_thread'];
    const isMultiStage = multiStagePipelines.includes(pipeline);

    // Process items synchronously (create outputs) but trigger stage execution async
    // This ensures outputs are created before returning, then execute-stage handles async via webhooks
    const results = await processAllItems(
      items,
      job_id,
      job.organization_id,
      blueprint,           // Use merged blueprint with custom prompts
      configuration,
      pipeline,
      apiKeys,
      supabase,
      supabaseUrl,
      isMultiStage,
      job.blueprint_id,    // Pass blueprint_id for output tracking
      job.autopilot_id     // Pass autopilot_id for autopilot tracking
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: `Job ${job_id} dispatched successfully`,
        items_count: items.length,
        outputs_created: results?.outputs_created || 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as any)?.code;
    const errorProvider = (error as any)?.provider;
    const isUserFacing = (error as any)?.userFacing === true;
    console.error('Error dispatching job:', errorMessage);

    // Try to mark the job as failed so user can see the error.
    // job_id is hoisted above the try block so it's accessible here even
    // when the error happens after the JSON parse.
    try {
      if (job_id) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        await supabase.from('content_generation_jobs')
          .update({
            status: 'failed',
            error: errorMessage,
            completed_at: new Date().toISOString()
          })
          .eq('id', job_id);
        console.log(`Marked job ${job_id} as failed`);
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }

    // 4xx for user-actionable errors (missing API key, bad input) so the
    // frontend can distinguish "user needs to fix something" from "server
    // crashed and the user can't do anything". Server-side bugs stay 500.
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
        ...(errorCode ? { code: errorCode } : {}),
        ...(errorProvider ? { provider: errorProvider } : {}),
      }),
      {
        status: isUserFacing ? 400 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Increment job progress with retry logic for race condition handling
 */
async function incrementProgressWithRetry(
  supabase: any,
  jobId: string,
  incrementCompleted: boolean,
  incrementFailed: boolean,
  maxRetries = 3
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { error } = await supabase.rpc('increment_job_progress', {
      p_job_id: jobId,
      p_increment_completed: incrementCompleted,
      p_increment_failed: incrementFailed
    });

    if (!error) {
      return; // Success
    }

    console.warn(`Progress increment failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);
    
    if (attempt < maxRetries - 1) {
      // Exponential backoff: 100ms, 200ms, 400ms
      await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
    }
  }
  
  console.error(`Failed to increment progress after ${maxRetries} retries. Syncing from actual outputs...`);
  
  // Final fallback: sync from actual content_outputs
  const { error: syncError } = await supabase.rpc('sync_job_progress', { p_job_id: jobId });
  if (syncError) {
    console.error('Failed to sync progress from outputs:', syncError);
  }
}

/**
 * Process all generation items - creates outputs and triggers first stage
 * Returns result object with count of outputs created
 */
async function processAllItems(
  items: GenerationItem[],
  jobId: string,
  organizationId: string,
  blueprint: any,
  configuration: any,
  pipeline: string,
  apiKeys: any[],
  supabase: any,
  supabaseUrl: string,
  isMultiStage: boolean = false,
  blueprintId?: string,
  autopilotId?: string
): Promise<{ outputs_created: number; errors: number }> {
  let outputsCreated = 0;
  let errors = 0;
  // Brand Kit defaults, loaded once per job on first use.
  let workspaceDefaults: Partial<Record<LibraryKind, string>> | undefined;

  // Looks: one per piece, rotating across this autopilot's (or blueprint's)
  // recent pieces unless the run forces one. See _shared/image-looks.ts.
  const baseModelConfig = configuration?.model_config || blueprint?.model_config;
  // Blueprint Look settings (shape, template, slide count, CTA, handle) under
  // the caller's output_config, so autopilot/MCP/API carousels match manual runs.
  const outputConfig = resolveOutputConfig(pipeline, baseModelConfig, configuration?.output_config);
  let pieceLooks: ImageLook[] = [];
  if (getImageLooks(baseModelConfig).length > 0) {
    const forcedLookId = configuration?.look_id || null;
    const needsHistory = !forcedLookId && lookMode(baseModelConfig) === 'rotate';
    const recent = needsHistory ? await recentLookIds(supabase, { autopilotId, blueprintId }) : [];
    pieceLooks = pickLooks(baseModelConfig, items.length, recent, forcedLookId);
    console.log(`🎨 [Looks] ${pieceLooks.map((l) => l.label).join(', ')} (recent: ${recent.slice(0, 5).join(', ') || 'none'})`);
  }
  // Reference photos set to rotate: one per piece, least recently used first,
  // over the same history scope as looks. See _shared/image-references.ts.
  const recentPicks: ReferencePicks[] = rotatesReferences(baseModelConfig)
    ? await recentReferencePicks(supabase, { autopilotId, blueprintId })
    : [];

  try {
    // Process each item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Enrich item with idea data if idea_id is present but ai_analysis/title are missing
      // This handles the case where jobs are created via API/MCP without frontend enrichment
      let ideaBrandVoiceId: string | null = null;
      let ideaProductId: string | null = null;
      let guidelinesApproved = false;
      // The idea's notes are where its facts live, so every run gets them as
      // {{idea_text}} (autopilot and API/MCP jobs used to leave them out), and
      // approved guidelines reach the writing prompt (resolvePrompt).
      const needsIdeaText = item.slot_values?.idea_text === undefined;
      if (item.idea_id) {
        console.log(`[Idea Enrichment] Fetching idea data for item ${i} (idea_id: ${item.idea_id})`);
        const { data: ideaData, error: ideaError } = await supabase
          .from('content_ideas')
          .select('title, ai_analysis, brand_voice_id, product_id, free_text, guidelines_approved_at')
          .eq('id', item.idea_id)
          .single();

        if (ideaData && !ideaError) {
          guidelinesApproved = !!ideaData.guidelines_approved_at;
          if (!item.idea_ai_analysis) {
            item.idea_ai_analysis = ideaData.ai_analysis;
            ideaBrandVoiceId = ideaData.brand_voice_id;
            ideaProductId = ideaData.product_id;
            if (!item.idea_title || item.idea_title === 'Content 1') {
              item.idea_title = ideaData.title;
            }
          }
          if (needsIdeaText && typeof ideaData.free_text === 'string' && ideaData.free_text.trim()) {
            item.slot_values = { ...(item.slot_values || {}), idea_text: ideaData.free_text.trim() };
          }
          console.log(`[Idea Enrichment] Enriched: title="${ideaData.title}", ai_analysis=${!!ideaData.ai_analysis}, talking_points=${(ideaData.ai_analysis as any)?.talking_points?.length || 0}, notes=${!!item.slot_values?.idea_text}, brand_voice=${ideaBrandVoiceId || 'none'}, product=${ideaProductId || 'none'}`);
        } else {
          console.warn(`[Idea Enrichment] Failed to fetch idea ${item.idea_id}: ${ideaError?.message || 'not found'}`);
        }
      }

      // Fill library elements the caller didn't supply: blueprint context
      // (always/relevant), missing required slots, and — when nothing at all was
      // supplied (API/MCP) — every slot. Source order: blueprint pin → idea link →
      // workspace default (Brand Kit) → most recently updated. See library-defaults.ts.
      const librarySlots = (blueprint?.structure?.slots || []).filter((s: any) => s.type === 'library_element' && s.library_table);
      if (librarySlots.length > 0 || blueprint?.context || tablesNeededByReferences(configuration?.model_config || blueprint?.model_config).length > 0) {
        try {
          workspaceDefaults ??= await loadWorkspaceDefaults(supabase, organizationId);
          const { elements, filled } = await fillLibraryElements(supabase, {
            organizationId,
            existing: item.library_elements,
            slots: librarySlots,
            context: blueprint?.context as BlueprintContext | null,
            ideaBrandVoiceId,
            ideaProductId,
            workspaceDefaults,
            forceTables: tablesNeededByReferences(configuration?.model_config || blueprint?.model_config),
          });
          item.library_elements = elements;
          for (const [table, how] of Object.entries(filled)) {
            console.log(`[Library Enrichment] ${table}: ${how}`);
          }
        } catch (libErr) {
          console.warn('[Library Enrichment] Failed, continuing with supplied elements:', libErr);
        }
      }

      try {
        // Transform library element keys from full table names to shorthand
        const transformedLibraryElements = transformLibraryKeys(item.library_elements || {});

        // Merge video config variables into slot_values for template resolution
        // This allows blueprints to use {{scene_count}}, {{video_duration}}, {{scene_duration}}
        const videoConfig = configuration?.video_config || {};

        // Debug: Log raw video_config from configuration
        console.log(`[Video Config Debug] Raw configuration.video_config:`, JSON.stringify(configuration?.video_config));
        console.log(`[Video Config Debug] videoConfig after fallback:`, JSON.stringify(videoConfig));
        console.log(`[Video Config Debug] item.slot_values:`, JSON.stringify(item.slot_values));

        // Scene count and scene duration are now calculated dynamically in execute-stage
        // based on actual voiceover duration. We only pass totalDuration from video_config.
        const now = new Date();
        // Build default slot values from idea title — these are overridden by explicit slot_values
        const ideaTitle = item.idea_title || '';
        const defaultSlotValues: Record<string, string> = {};
        if (ideaTitle) {
          defaultSlotValues.idea = ideaTitle;
          defaultSlotValues.title = ideaTitle;
          defaultSlotValues.topic = ideaTitle;
          defaultSlotValues.context = ideaTitle;
        }

        const enhancedSlotValues = {
          ...defaultSlotValues, // Defaults from idea title (overridden by explicit slot_values)
          ...item.slot_values, // Explicit slot values from user/frontend take priority
          scene_count: '[Calculated from voiceover]', // Will be set by execute-stage after voiceover
          video_duration: String(videoConfig.totalDuration || 60),
          video_duration_minutes: String(Math.floor((videoConfig.totalDuration || 60) / 60)),
          scene_duration: '5', // Always 5s clips now
          // Date/time variables
          current_year: String(now.getFullYear()),
          current_month: now.toLocaleString('en-US', { month: 'long' }),
          current_month_short: now.toLocaleString('en-US', { month: 'short' }),
          current_month_number: String(now.getMonth() + 1).padStart(2, '0'),
          current_date: now.toISOString().split('T')[0],
          current_quarter: `Q${Math.ceil((now.getMonth() + 1) / 3)}`,
        };

        console.log(`[Video Config Debug] enhancedSlotValues FINAL:`, JSON.stringify(enhancedSlotValues));

        console.log(`[Video Config] Resolved values: scene_count=${enhancedSlotValues.scene_count}, video_duration=${enhancedSlotValues.video_duration}s, video_duration_minutes=${enhancedSlotValues.video_duration_minutes}m, scene_duration=${enhancedSlotValues.scene_duration}s`);

        // Resolve variables in prompt with selected paths and AI insights
        const resolvedPrompt = resolvePrompt(
          blueprint.master_prompt || '',
          enhancedSlotValues,
          transformedLibraryElements,
          item.selected_paths,
          item.selected_ai_insights,
          item.idea_ai_analysis,
          { appendGuidelines: pipeline !== 'image_only', guidelinesApproved },
        );

        // Resolve director prompt template (video creative direction)
        const resolvedDirectorPrompt = blueprint?.director_prompt
          ? resolvePrompt(blueprint.director_prompt, enhancedSlotValues, transformedLibraryElements, item.selected_paths, item.selected_ai_insights, item.idea_ai_analysis)
          : undefined;

        console.log(`Dispatching item ${i + 1}/${items.length}: ${item.idea_title}`);
        if (item.selected_ai_insights && Object.keys(item.selected_ai_insights).length > 0) {
          console.log(`  - Using AI insights:`, Object.keys(item.selected_ai_insights).join(', '));
        }

        // Log enhanced slot values for debugging
        console.log(`[Enhanced Slot Values] Keys: ${Object.keys(enhancedSlotValues).join(', ')}`);
        console.log(`[Enhanced Slot Values] scene_count=${enhancedSlotValues.scene_count}, video_duration=${enhancedSlotValues.video_duration}, scene_duration=${enhancedSlotValues.scene_duration}`);

        const rotated = rotateReferences(
          pieceLooks[i] ? applyLook(baseModelConfig, pieceLooks[i]) : baseModelConfig,
          transformedLibraryElements,
          recentPicks,
        );
        if (Object.keys(rotated.picks).length > 0) {
          recentPicks.unshift(rotated.picks);
          console.log(`🔁 [References] ${Object.entries(rotated.picks).map(([role, url]) => `${role}: ${String(url).split('/').pop()}`).join(', ')}`);
        }

        // Dispatch based on pipeline type
        if (isMultiStage) {
          await dispatchMultiStageGeneration({
            jobId: jobId,
            itemIndex: i,
            ideaId: item.idea_id,
            ideaTitle: item.idea_title,
            pipeline: pipeline || 'text',
            prompt: resolvedPrompt,
            modelConfig: rotated.modelConfig,
            look: pieceLooks[i] ? pieceLook(pieceLooks[i]) : undefined,
            referencePicks: rotated.picks,
            libraryElements: transformedLibraryElements,
            selectedPaths: item.selected_paths,
            imageInputs: item.image_inputs || {},
            imagePrompt: blueprint?.image_prompt, // Pass blueprint image_prompt template
            directorPrompt: resolvedDirectorPrompt, // Pass resolved director prompt for video creative direction
            videoConfig: configuration?.video_config, // Pass video config from job configuration
            // Copy per item: dispatch resolves {{vars}} in ctaButtonText in place.
            outputConfig: outputConfig ? { ...outputConfig } : undefined,
            selectedAiInsights: item.selected_ai_insights, // Pass AI insights for this variation
            ideaAiAnalysis: item.idea_ai_analysis, // Pass full AI analysis for {{ai_*}} variables
            autoApproveAll: configuration?.auto_approve_all, // Auto-approve all stages
            slotValues: enhancedSlotValues, // Pass slot values with video config for template resolution
            presenterConfig: configuration?.presenter_config || configuration?.remix_config, // Presenter/Remix pipeline config
            apiKeys,
            supabase,
            supabaseUrl,
            organizationId,
            blueprintId,
            autopilotId,
            savedContent: configuration?.saved_content,
            skipImageGeneration: configuration?.skip_image_generation ?? blueprint?.skip_image_generation,
          });
        } else {
          await dispatchGeneration({
            jobId: jobId,
            itemIndex: i,
            ideaId: item.idea_id,
            ideaTitle: item.idea_title,
            pipeline: pipeline || 'text',
            prompt: resolvedPrompt,
            modelConfig: rotated.modelConfig,
            look: pieceLooks[i] ? pieceLook(pieceLooks[i]) : undefined,
            referencePicks: rotated.picks,
            libraryElements: transformedLibraryElements,
            selectedPaths: item.selected_paths,
            imageInputs: item.image_inputs || {},
            imagePrompt: blueprint?.image_prompt, // Pass blueprint image_prompt template
            directorPrompt: resolvedDirectorPrompt, // Pass resolved director prompt for video creative direction
            videoConfig: configuration?.video_config, // Pass video config from job configuration
            // Copy per item: dispatch resolves {{vars}} in ctaButtonText in place.
            outputConfig: outputConfig ? { ...outputConfig } : undefined,
            selectedAiInsights: item.selected_ai_insights, // Pass AI insights for this variation
            ideaAiAnalysis: item.idea_ai_analysis, // Pass full AI analysis for {{ai_*}} variables
            autoApproveAll: configuration?.auto_approve_all, // Auto-approve all stages
            slotValues: enhancedSlotValues, // Pass slot values with video config for template resolution
            apiKeys,
            supabase,
            supabaseUrl,
            organizationId,
            blueprintId,
            autopilotId,
            savedContent: configuration?.saved_content,
            skipImageGeneration: configuration?.skip_image_generation ?? blueprint?.skip_image_generation,
          });
        }

        outputsCreated++;

        // Small stagger between fire-and-forget dispatches to avoid hammering LLM APIs simultaneously
        if (i < items.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (itemError) {
        console.error(`Error processing item ${i}:`, itemError);
        errors++;

        // Create failed output record. Use status='failed' (not 'review') so the
        // UI doesn't surface dispatch errors as "Needs Review" — there's nothing
        // to review when the payload couldn't even be built.
        const { error: insertError } = await supabase.from('content_outputs').insert({
          job_id: jobId,
          idea_id: item.idea_id,
          blueprint_id: blueprintId,
          autopilot_id: autopilotId,
          type: 'text',
          pipeline: pipeline || 'text',
          status: 'failed',
          error_message: itemError instanceof Error ? itemError.message : 'Unknown error',
          organization_id: organizationId,
          data: {},
          generation_params: {}
        });
        if (insertError) {
          console.error(`Failed to insert error output record for item ${i}:`, insertError.message);
        }

        // Update job progress atomically with retry
        await incrementProgressWithRetry(supabase, jobId, false, true);
      }
    }

    // Defense-in-depth: always run sync_job_progress after the items loop so
    // the parent job's status/completed_at reflects the actual output state,
    // even if every item hard-failed and increment_job_progress only bumped counters.
    const { error: syncError } = await supabase.rpc('sync_job_progress', { p_job_id: jobId });
    if (syncError) {
      console.error(`Failed to sync job progress after dispatch loop:`, syncError);
    }

    console.log(`Job ${jobId} dispatched: ${outputsCreated} outputs created, ${errors} errors`);
    return { outputs_created: outputsCreated, errors };
  } catch (error) {
    console.error('Processing error:', error);

    // Mark job as failed
    await supabase
      .from('content_generation_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', jobId);

    return { outputs_created: outputsCreated, errors: errors + 1 };
  }
}


/**
 * Build payload using normalized schema and payload builder
 * Now with lazy schema loading
 */
async function buildModelPayload(
  supabase: any,
  provider: string,
  modelId: string,
  userInput: Record<string, any>
): Promise<{ success: boolean; payload?: any; error?: string; missing_required?: string[] }> {
  console.log(`[Payload Builder] Building for ${provider}/${modelId}`);

  try {
    // Use test-payload-builder function which now has lazy loading built-in
    // It will fetch and normalize the schema automatically if not cached
    const { data, error } = await supabase.functions.invoke('test-payload-builder', {
      body: { provider, model_id: modelId, user_input: userInput }
    });

    if (error || !data?.success) {
      console.error('[Payload Builder] Error:', error || data?.error);
      return {
        success: false,
        error: data?.error || error?.message || 'Payload build failed',
        missing_required: data?.missing_required
      };
    }

    console.log('[Payload Builder] ✓ Success');
    return { success: true, payload: data.payload };
  } catch (err) {
    console.error('[Payload Builder] Exception:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

interface DispatchParams {
  jobId: string;
  itemIndex: number;
  ideaId: string;
  ideaTitle: string;
  pipeline: string;
  prompt: string;
  modelConfig: any;
  libraryElements: Record<string, any>;
  selectedPaths?: Record<string, Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>>;
  imageInputs?: Record<string, string[]>;
  imagePrompt?: string; // Blueprint image_prompt template for image generation stages
  directorPrompt?: string; // Resolved director prompt for video creative direction
  videoConfig?: any; // Video configuration (aspect ratio, duration, scene count)
  outputConfig?: any; // Output configuration for non-video visual pipelines (aspect ratio)
  selectedAiInsights?: GenerationItemAiInsights; // AI insights selected for this item (hook, CTA, etc.)
  ideaAiAnalysis?: any; // Full AI analysis from idea (for {{ai_*}} variables in prompts)
  autoApproveAll?: boolean; // Auto-approve all pipeline stages without manual review
  slotValues?: Record<string, string>; // Slot values from idea (topic, title, description, etc.)
  presenterConfig?: any; // Presenter video pipeline config (sourceType, bRollEnabled, voiceType)
  apiKeys: any[];
  supabase: any;
  supabaseUrl: string;
  organizationId: string;
  blueprintId?: string;  // For tracking which blueprint generated this output
  autopilotId?: string;  // For tracking autopilot-generated outputs
  savedContent?: { items: Array<{ id: string; content_type: string; url: string }>; for_carousel: boolean } | null;
  skipImageGeneration?: boolean; // Skip image generation stages (text-only output)
  look?: { id: string; label: string; kind: string }; // The look this piece uses (image-looks.ts)
  referencePicks?: ReferencePicks; // The photo each rotating reference role gave this piece (image-references.ts)
}

async function dispatchGeneration(params: DispatchParams) {
  const {
    jobId,
    itemIndex,
    ideaId,
    ideaTitle,
    pipeline,
    prompt,
    modelConfig,
    libraryElements,
    selectedPaths,
    imageInputs,
    apiKeys,
    supabase,
    supabaseUrl,
    organizationId,
    blueprintId,
    autopilotId
  } = params;

  // Determine provider and model from config first — Ollama models route to
  // the org's Ollama server and don't need an OpenRouter key.
  const rawModelId = modelConfig?.text_llm?.model_id || modelConfig?.model_id || DEFAULT_FREE_TEXT_MODEL;
  const provider = isOllamaModel(rawModelId) ? 'ollama' : (modelConfig?.provider || 'openrouter');
  const usingOllamaText = provider === 'ollama';
  const modelIdToUse = usingOllamaText ? stripOllamaPrefix(rawModelId) : rawModelId;

  // Resolve the chat endpoint + credentials for the chosen provider
  let chatUrl = 'https://openrouter.ai/api/v1/chat/completions';
  const chatHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'HTTP-Referer': supabaseUrl,
    'X-Title': 'ContentAI Studio',
  };
  if (usingOllamaText) {
    const ollamaKeyRow = apiKeys.find(k => k.provider === 'ollama');
    if (!ollamaKeyRow) {
      throw new Error('Ollama is not configured for this organization. Add it in Settings > API Keys.');
    }
    const ollamaBase = ((ollamaKeyRow.metadata?.dsn_url as string) || OLLAMA_CLOUD_BASE_URL).replace(/\/+$/, '');
    chatUrl = `${ollamaBase}/v1/chat/completions`;
    try {
      const ollamaKey = await decryptApiKey(ollamaKeyRow.key_encrypted);
      if (ollamaKey && ollamaKey !== OLLAMA_NO_KEY_SENTINEL) chatHeaders['Authorization'] = `Bearer ${ollamaKey}`;
    } catch (err) {
      console.warn('Failed to decrypt Ollama key, proceeding without auth:', err);
    }
  }
  // OpenRouter key is still used for auxiliary calls (AI title, image prompt) —
  // decrypt it when present even when the main text model runs on Ollama.
  const openRouterKeyRow = apiKeys.find(k => k.provider === 'openrouter');
  if (!usingOllamaText && !openRouterKeyRow) {
    throw new Error('OpenRouter API key not configured');
  }
  const openRouterDecryptedKey = openRouterKeyRow ? await decryptApiKey(openRouterKeyRow.key_encrypted) : '';
  if (!usingOllamaText) {
    chatHeaders['Authorization'] = `Bearer ${openRouterDecryptedKey}`;
  }

  // For now, implement text generation (can expand to other pipelines later)
  const webhookUrl = `${supabaseUrl}/functions/v1/generation-completion-webhook`;

  console.log(`Calling ${usingOllamaText ? 'Ollama' : 'OpenRouter'} for item: ${ideaTitle}`);

  // Determine prompt wrapper based on pipeline type
  const isRichArticle = pipeline === 'rich_article';
  const isSocialMedia = pipeline === 'social_media_post';

  let finalPrompt = prompt;
  if (isRichArticle) {
    finalPrompt = wrapPromptForRichArticle(prompt, libraryElements);
  } else if (isSocialMedia) {
    finalPrompt = wrapPromptForImagePromptGeneration(prompt, libraryElements);
  }

  // Prepare user input for payload builder
  const userInput: Record<string, any> = {
    main_prompt: finalPrompt,
    ...libraryElements,
  };

  // Add model config parameters
  if (modelConfig?.text_llm?.parameters) {
    Object.assign(userInput, modelConfig.text_llm.parameters);
  }

  // Add image inputs if present
  if (imageInputs && Object.keys(imageInputs).length > 0) {
    for (const [path, urls] of Object.entries(imageInputs)) {
      const paramName = path.split('.').pop() || 'reference_images';
      userInput[paramName] = urls.length === 1 ? urls[0] : urls;
    }
  }

  let generatedText = '';
  let resultMetadata: any = {};

  // Build the OpenRouter chat-completions payload directly. We previously
  // delegated to a `test-payload-builder` edge function for schema-driven
  // payload construction, but that function isn't deployed on this project,
  // so every text dispatch threw "Payload build failed: Edge Function returned
  // a non-2xx status code" and the job hung. For OpenRouter chat-completions,
  // a plain { model, messages, ...optional params } body is all that's
  // required, so build it inline.
  const requestBody: Record<string, any> = {
    model: modelIdToUse,
    messages: [
      { role: 'user', content: finalPrompt },
    ],
  };

  // Forward any user-tuned model parameters (temperature, max_tokens, etc.)
  // straight through. OpenRouter accepts the same surface as the OpenAI API.
  if (modelConfig?.text_llm?.parameters && typeof modelConfig.text_llm.parameters === 'object') {
    for (const [k, v] of Object.entries(modelConfig.text_llm.parameters)) {
      if (k !== 'main_prompt' && v !== undefined && v !== null) {
        requestBody[k] = v;
      }
    }
  }

  // Always send an explicit budget — see DEFAULT_TEXT_MAX_TOKENS above.
  if (requestBody.max_tokens === undefined || requestBody.max_tokens === null) {
    requestBody.max_tokens = DEFAULT_TEXT_MAX_TOKENS;
  }

  // Call provider API (OpenRouter for now) with retry logic
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ OpenRouter API error for ${ideaTitle} (attempt ${attempt}): ${response.status} - ${errorText}`);

        // 402 = insufficient OpenRouter credits. Flag the api_keys row as
        // invalid + short-circuit retries — no point retrying a billing error.
        if (response.status === 402) {
          const creditMessage = await handleOpenRouterCreditsError(supabase, organizationId, 402, errorText);
          throw new Error(`OpenRouter: ${creditMessage || 'insufficient credits'}`);
        }

        // Don't retry on client errors (4xx) except rate limiting (429)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        if (attempt === MAX_RETRIES) {
          throw new Error(`OpenRouter API error after ${MAX_RETRIES} attempts: ${response.status} - ${errorText}`);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }

      const result = await response.json();
      generatedText = result.choices?.[0]?.message?.content || '';
      resultMetadata = {
        model: result.model,
        usage: result.usage
      };
      console.log(`✓ Generated ${generatedText.length} characters for ${ideaTitle}`);
      break; // Success, exit retry loop

    } catch (fetchError) {
      console.error(`❌ Fetch error for ${ideaTitle} (attempt ${attempt}):`, fetchError);

      if (attempt === MAX_RETRIES) {
        throw fetchError;
      }

      // Wait before retrying on connection errors
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }

  // Generate descriptive title
  const fallbackTitle = generateOutputTitle(ideaTitle);

  // Build variant context for filtering
  const variantContext: any = {};
  if (libraryElements.brand_voice?.name) {
    variantContext.brand_voice = libraryElements.brand_voice.name;
  }
  if (libraryElements.content_angle?.name) {
    variantContext.angle = libraryElements.content_angle.name;
  }
  if (libraryElements.product?.name) {
    variantContext.product = libraryElements.product.name;
  }
  if (libraryElements.character?.name) {
    variantContext.character = libraryElements.character.name;
  }

  // Parse response based on pipeline type
  let outputData: any;

  if (isRichArticle) {
    // Parse rich article with full SEO metadata
    const parsed = parseRichArticleResponse(generatedText, libraryElements, fallbackTitle);
    console.log(`✓ Parsed rich article: "${parsed.title}" (${parsed.content.length} chars)`);

    outputData = {
      title: parsed.title,
      text: parsed.content,
      image_prompt: parsed.imagePrompt,
      seo: parsed.seo,
      metadata: {
        ...resultMetadata,
        ...parsed.metadata,
        word_count: parsed.content.replace(/<[^>]*>/g, '').trim().split(/\s+/).length,
        variant_context: variantContext
      }
    };
  } else if (isSocialMedia) {
    // Parse social media post with caption and image prompt
    const parsed = parseCaptionWithImagePrompt(generatedText, libraryElements);
    console.log(`✓ Parsed caption (${parsed.caption.length} chars) and image prompt (${parsed.imagePrompt.length} chars)`);

    outputData = {
      title: fallbackTitle,
      text: parsed.caption,
      image_prompt: parsed.imagePrompt,
      metadata: {
        ...resultMetadata,
        character_count: parsed.caption.length,
        variant_context: variantContext
      }
    };
  } else {
    // Other pipelines - generate image prompt separately
    const imagePrompt = await generateImagePrompt(generatedText, libraryElements, openRouterDecryptedKey, supabaseUrl);

    outputData = {
      title: fallbackTitle,
      text: generatedText,
      image_prompt: imagePrompt,
      metadata: {
        ...resultMetadata,
        character_count: generatedText.length,
        variant_context: variantContext
      }
    };
  }

  // Store the output
  const { data: insertedOutput, error: insertError } = await supabase.from('content_outputs').insert({
    job_id: jobId,
    idea_id: ideaId,
    blueprint_id: blueprintId,
    autopilot_id: autopilotId,
    type: 'text',
    pipeline: pipeline,
    status: 'review',
    data: outputData,
    generation_params: {
      prompt,
      model_config: modelConfig,
      ...(params.look ? { look: params.look } : {}),
      ...(params.referencePicks && Object.keys(params.referencePicks).length > 0 ? { reference_picks: params.referencePicks } : {}),
      variant_context: variantContext,
      image_prompt: params.imagePrompt, // Pass blueprint image_prompt template if set
      director_prompt: params.directorPrompt, // Pass resolved director prompt for video creative direction
      library_elements: libraryElements,
      selected_ai_insights: params.selectedAiInsights, // AI insights for this variation (hook, CTA, etc.)
      idea_ai_analysis: params.ideaAiAnalysis, // Full AI analysis for {{ai_*}} variables in prompts
      auto_approve_all: params.autoApproveAll || false // Auto-approve all stages
    },
    organization_id: organizationId
  }).select('id').single();

  if (insertError) {
    console.error('Failed to save output:', insertError);
    throw insertError;
  }

  // Generate AI title (must await in Deno edge functions)
  // Skip for rich_article - the title is already parsed from the LLM's JSON response
  if (!isRichArticle) {
    try {
      await generateAiOutputTitle({
        outputId: insertedOutput.id,
        ideaTitle,
        pipeline,
        libraryElements,
        supabase,
        supabaseUrl,
        openRouterKey: openRouterDecryptedKey // Reuse already-decrypted key
      });
    } catch (err) {
      console.warn('[AI Title] Generation failed:', err);
      // Don't fail the whole operation if AI title fails
    }
  }

  // Update job progress atomically with retry
  await incrementProgressWithRetry(supabase, jobId, true, false);

  // One-shot pipelines (articles) finish here and never pass through approve-stage,
  // where staged pipelines get queued for publishing, so an autopilot's articles
  // were made but never posted. Queue them the same way.
  if (autopilotId) {
    await queueForPublish(supabase, autopilotId, insertedOutput.id, jobId);
  }
}

/**
 * Generate descriptive fallback title for output
 * Used immediately while AI title generation runs in background
 */
function generateOutputTitle(ideaTitle: string): string {
  return ideaTitle;
}

/**
 * Generate AI-powered title for a content output
 * Updates the output's data.title field with a meaningful, descriptive title
 */
async function generateAiOutputTitle(params: {
  outputId: string;
  ideaTitle: string;
  pipeline: string;
  libraryElements: Record<string, any>;
  supabase: any;
  supabaseUrl: string;
  openRouterKey: string;
}): Promise<void> {
  const { outputId, ideaTitle, pipeline, libraryElements, supabase, supabaseUrl, openRouterKey } = params;

  try {
    console.log(`[AI Title] Generating title for output ${outputId}`);

    // Build context for title generation
    const contextParts: string[] = [];

    // Pipeline type label
    const PIPELINE_LABELS: Record<string, string> = {
      'social_media_post': 'Social Post',
      'instagram_carousel': 'Instagram Carousel',
      'instagram_carousel_ai': 'Instagram Carousel (AI)',
      'generative_video': 'AI Video',
      'generative_video_oneshot': 'AI Video',
      'ugc_video': 'UGC Video',
      'storyboard_video_longform': 'Longform Video',
      'presenter_video': 'Presenter Video',
      'video_remix': 'Video Remix',
      'video': 'Video',
      'talking_head': 'Talking Head Video',
      'image_only': 'Image',
      'blog_post': 'Blog Post',
      'article': 'Article',
      'rich_article': 'Rich Article',
    };
    const pipelineLabel = PIPELINE_LABELS[pipeline] || pipeline.replace(/_/g, ' ');
    contextParts.push(`Content Type: ${pipelineLabel}`);

    // Topic/Idea
    if (ideaTitle) {
      contextParts.push(`Topic: ${ideaTitle}`);
    }

    // Brand voice
    const brandVoice = Array.isArray(libraryElements.brand)
      ? libraryElements.brand[0]
      : (libraryElements.brand || libraryElements.brand_voice);
    if (brandVoice?.name) {
      contextParts.push(`Brand Voice: ${brandVoice.name}`);
    }

    // Product
    const product = Array.isArray(libraryElements.product)
      ? libraryElements.product[0]
      : libraryElements.product;
    if (product?.name) {
      contextParts.push(`Product: ${product.name}`);
    }

    // Character (for UGC videos)
    const character = Array.isArray(libraryElements.character)
      ? libraryElements.character[0]
      : libraryElements.character;
    if (character?.name) {
      contextParts.push(`Character: ${character.name}`);
    }

    // Build prompt
    const systemPrompt = `You are a helpful assistant that generates concise, descriptive titles for content pieces.

Generate a single title that is:
- 3-10 words maximum
- Descriptive and specific to the content
- Professional and engaging
- NOT generic (avoid "Social Post", "Video 1", etc.)
- Captures the essence of what this specific piece is about

Good examples:
- "Morning Coffee Routine for Busy Professionals"
- "5 Quick Fitness Tips with Sarah"
- "TechPro X1 Product Launch Announcement"
- "Summer Sale Instagram Carousel"
- "Customer Success: How Jane Doubled Her Revenue"

Bad examples (too generic):
- "Social Media Post"
- "Video Content"
- "Instagram Post 1"
- "Marketing Content"

Return ONLY the title, nothing else. No quotes, no explanation.`;

    const userPrompt = `Generate a descriptive title for this content piece:

${contextParts.join('\n')}

Title:`;

    // Call OpenRouter with a fast model
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': supabaseUrl,
        'X-Title': 'ContentAI Studio',
      },
      body: JSON.stringify({
        model: DEFAULT_FREE_TEXT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 50,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      console.warn(`[AI Title] OpenRouter error for ${outputId}, keeping fallback title`);
      return;
    }

    const result = await response.json();
    let generatedTitle = result.choices?.[0]?.message?.content?.trim() || '';

    // Clean up - remove quotes if present
    generatedTitle = generatedTitle.replace(/^["']|["']$/g, '').trim();

    // Truncate if too long
    if (generatedTitle.length > 100) {
      generatedTitle = generatedTitle.slice(0, 97) + '...';
    }

    // Skip update if empty or too generic
    if (!generatedTitle || generatedTitle.length < 5) {
      console.warn(`[AI Title] Generated title too short for ${outputId}, keeping fallback`);
      return;
    }

    // Fetch current output data and update title
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('data')
      .eq('id', outputId)
      .single();

    if (fetchError) {
      console.error(`[AI Title] Failed to fetch output ${outputId}:`, fetchError);
      return;
    }

    const currentData = (output.data as any) || {};
    const updatedData = { ...currentData, title: generatedTitle };

    const { error: updateError } = await supabase
      .from('content_outputs')
      .update({ data: updatedData })
      .eq('id', outputId);

    if (updateError) {
      console.error(`[AI Title] Failed to update output ${outputId}:`, updateError);
      return;
    }

    console.log(`[AI Title] ✓ Generated title for ${outputId}: "${generatedTitle}"`);
  } catch (error) {
    console.warn(`[AI Title] Error generating title for ${outputId}:`, error);
    // Don't throw - title generation is non-critical
  }
}

/**
 * Generate image prompt suggestion using AI
 * @deprecated For social_media_post, image prompts are now generated inline with
 * the caption using the user's configured model. This function is kept as fallback
 * for other pipelines (like rich_article).
 */
async function generateImagePrompt(
  postText: string,
  libraryElements: Record<string, any>,
  apiKey: string,
  supabaseUrl: string
): Promise<string> {
  try {
    const brandStyle = libraryElements.brand_voice?.visual_style || 
                      libraryElements.product?.visual_style || 
                      'professional and engaging';

    const promptText = `Based on this social media post:
"${postText.slice(0, 500)}"

And brand visual style: ${brandStyle}

Generate a concise DALL-E style image prompt (max 150 words) that would create an engaging visual for this post. Focus on the main theme and emotion.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': supabaseUrl,
        'X-Title': 'ContentAI Studio'
      },
      body: JSON.stringify({
        model: DEFAULT_FREE_TEXT_MODEL,
        messages: [{ role: 'user', content: promptText }],
        max_tokens: 200
      })
    });

    if (!response.ok) {
      console.warn('Failed to generate image prompt, using fallback');
      return 'An engaging image that represents the content theme';
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content?.trim() || 'An engaging image that represents the content theme';
  } catch (error) {
    console.warn('Error generating image prompt:', error);
    return 'An engaging image that represents the content theme';
  }
}

/**
 * Build visual context from library elements for image prompt generation
 */
function buildImagePromptContext(libraryElements: Record<string, any>): string {
  const parts: string[] = [];

  // Brand Voice visual style
  const bv = Array.isArray(libraryElements.brand_voice)
    ? libraryElements.brand_voice[0]
    : libraryElements.brand_voice;
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
    if (char.visual_style) parts.push(`Character Style: ${char.visual_style}`);
    if (char.physical_traits) parts.push(`Character Appearance: ${char.physical_traits}`);
    if (char.typical_clothing) parts.push(`Clothing: ${char.typical_clothing}`);
  }

  // Product visual context
  const prod = Array.isArray(libraryElements.product)
    ? libraryElements.product[0]
    : libraryElements.product;
  if (prod) {
    if (prod.visual_style) parts.push(`Product Style: ${prod.visual_style}`);
    if (prod.name) parts.push(`Product: ${prod.name}`);
  }

  return parts.length > 0
    ? parts.join('\n')
    : 'professional and engaging visual style';
}

interface ParsedCaptionResponse {
  caption: string;
  imagePrompt: string;
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

/**
 * Parse LLM response that contains both caption and image prompt as JSON
 */
function parseCaptionWithImagePrompt(
  rawResponse: string,
  libraryElements: Record<string, any>
): ParsedCaptionResponse {
  const brandStyle = libraryElements.brand_voice?.visual_style ||
                    libraryElements.product?.visual_style ||
                    'professional and engaging';

  let caption = rawResponse;
  let imagePrompt = 'An engaging image that represents the content theme';

  try {
    let jsonText = rawResponse.trim();
    // Handle markdown code blocks
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Normalize special characters that LLMs often produce
    jsonText = normalizeDashes(jsonText)
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // smart double quotes → regular
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes → regular
      .replace(/\u2026/g, '...')  // ellipsis → three dots
      .replace(/[\u00A0]/g, ' ');  // non-breaking space → regular space

    const parsed = JSON.parse(jsonText);

    if (parsed.caption && typeof parsed.caption === 'string') {
      caption = parsed.caption.trim();
    }
    if (parsed.image_prompt && typeof parsed.image_prompt === 'string') {
      imagePrompt = cleanupImagePrompt(parsed.image_prompt);
    } else {
      imagePrompt = `A ${brandStyle} visual representing: ${caption.slice(0, 100)}`;
    }
  } catch (e) {
    console.warn('JSON parsing failed for caption response, using raw text as caption');
    if (caption.length > 50) {
      imagePrompt = `A ${brandStyle} visual for social media about: ${caption.slice(0, 100)}...`;
    }
  }

  return { caption, imagePrompt };
}

/**
 * Wrap the user's prompt to request both caption and image prompt in JSON format
 */
function wrapPromptForImagePromptGeneration(
  resolvedPrompt: string,
  libraryElements: Record<string, any>
): string {
  const visualContext = buildImagePromptContext(libraryElements);

  return `${resolvedPrompt}

---
CRITICAL RESPONSE FORMAT REQUIREMENT:
You MUST respond with ONLY valid JSON. No markdown, no explanations, no options to choose from.
Output exactly this structure:
{
  "caption": "Your complete generated content here",
  "image_prompt": "A single detailed image generation prompt (max 150 words)"
}

IMPORTANT: Generate exactly ONE image_prompt - NOT multiple options or alternatives.
Do NOT include phrases like "Here are a few options" or "Option 1/2/3".
The image_prompt should be a single, ready-to-use prompt starting with descriptive text like "A..." or "An...".

VISUAL STYLE GUIDELINES FOR IMAGE PROMPT:
${visualContext}

The image_prompt must incorporate the visual style guidelines above for brand consistency.
Include: composition, lighting, color palette, mood, and style matching the brand.`;
}

/**
 * Wrap the user's prompt for rich article generation with SEO metadata
 */
function wrapPromptForRichArticle(
  resolvedPrompt: string,
  libraryElements: Record<string, any>
): string {
  const visualContext = buildImagePromptContext(libraryElements);
  const brandVoice = libraryElements.brand_voice?.tone || 'professional and engaging';

  return `${resolvedPrompt}

---
CRITICAL RESPONSE FORMAT REQUIREMENT:
You MUST respond with ONLY valid JSON. No markdown code blocks, no explanations.

Generate a complete, SEO-optimized article with proper HTML formatting.

Output exactly this JSON structure:
{
  "title": "The article display title (engaging, descriptive)",
  "content": "The full article content with HTML formatting (see formatting rules below)",
  "seo": {
    "meta_title": "SEO-optimized title (max 60 characters, include focus keyword)",
    "meta_description": "Compelling meta description (max 155 characters, include focus keyword, call to action)",
    "slug": "url-friendly-slug-with-keywords",
    "focus_keyword": "primary target keyword for SEO"
  },
  "metadata": {
    "excerpt": "2-3 sentence article summary for previews",
    "categories": ["Primary Category"],
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
    "featured_image_alt": "Descriptive alt text for the featured image (include keywords naturally)"
  },
  "image_prompt": "A detailed prompt for generating the featured image (landscape format, max 150 words)"
}

ARTICLE CONTENT FORMATTING RULES:
1. Use proper HTML heading hierarchy: <h2> for main sections, <h3> for subsections (no <h1> - that's the title)
2. Wrap paragraphs in <p> tags
3. Use <strong> for emphasis and important keywords
4. Use <ul>/<ol> and <li> for lists
5. Use <blockquote> for notable quotes or callouts
6. Keep paragraphs concise (3-4 sentences max)
7. Include 4-6 main sections with clear headings
8. Write in a ${brandVoice} tone

SEO BEST PRACTICES:
- Include the focus keyword in: title, first paragraph, at least one H2, meta description, slug
- Use related keywords and synonyms naturally throughout
- Write for humans first, search engines second
- Aim for 800-1500 words of valuable content
- End with a clear call-to-action or conclusion

VISUAL STYLE GUIDELINES FOR IMAGE PROMPT:
${visualContext}

The featured image should be landscape format (16:9), visually compelling, and relevant to the article topic.`;
}

/**
 * Parse rich article response with SEO metadata
 */
interface ParsedRichArticleResponse {
  title: string;
  content: string;
  seo: {
    meta_title: string;
    meta_description: string;
    slug: string;
    focus_keyword: string;
  };
  metadata: {
    excerpt: string;
    categories: string[];
    tags: string[];
    featured_image_alt: string;
  };
  imagePrompt: string;
}

function parseRichArticleResponse(
  rawResponse: string,
  libraryElements: Record<string, any>,
  fallbackTitle: string
): ParsedRichArticleResponse {
  const brandStyle = libraryElements.brand_voice?.visual_style ||
                    libraryElements.product?.visual_style ||
                    'professional and engaging';

  // Default response structure
  const defaultResponse: ParsedRichArticleResponse = {
    title: fallbackTitle,
    content: rawResponse,
    seo: {
      meta_title: '',
      meta_description: '',
      slug: '',
      focus_keyword: '',
    },
    metadata: {
      excerpt: '',
      categories: [],
      tags: [],
      featured_image_alt: '',
    },
    imagePrompt: `A ${brandStyle} landscape image representing: ${fallbackTitle}`,
  };

  try {
    let jsonText = rawResponse.trim();

    // Handle markdown code blocks
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    // Remove BOM and zero-width characters that can break parsing
    jsonText = jsonText.replace(/[\uFEFF\u200B-\u200D\u2060]/g, '');

    // Try parsing as-is first (best case: LLM returned clean JSON)
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (firstError) {
      console.log('[parseRichArticle] First parse failed, attempting character normalization...');
      console.log('[parseRichArticle] First 200 chars:', jsonText.substring(0, 200));
      console.log('[parseRichArticle] Error:', firstError);

      // Normalize special characters that LLMs often produce
      // Em-dashes, en-dashes, ellipsis, and non-breaking spaces are safe to replace globally
      let normalizedText = normalizeDashes(jsonText)
        .replace(/\u2026/g, '...')  // ellipsis → three dots
        .replace(/[\u00A0]/g, ' '); // non-breaking space → regular space

      // Smart quotes need special handling - they should become escaped quotes inside JSON strings
      // Replace smart double quotes with escaped regular double quotes
      normalizedText = normalizedText
        .replace(/[\u201C\u201D\u201E\u201F]/g, '\\"')  // smart double quotes → escaped quote
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'");   // smart single quotes → apostrophe (safe)

      try {
        parsed = JSON.parse(normalizedText);
      } catch (secondError) {
        console.log('[parseRichArticle] Second parse failed, trying without smart quote escaping...');

        // The smart quote replacement might have over-escaped if they were already proper
        // Try again with just the safe replacements
        normalizedText = normalizeDashes(jsonText)
          //
          .replace(/\u2026/g, '...')
          .replace(/[\u00A0]/g, ' ')
          .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // Just replace smart quotes with regular (might work if they're structural)
          .replace(/[\u2018\u2019\u201A\u201B]/g, "'");

        try {
          parsed = JSON.parse(normalizedText);
        } catch (thirdError) {
          console.log('[parseRichArticle] Third parse failed, attempting to extract JSON object...');

          // Last resort: try to find the JSON object boundaries and extract it
          const jsonStartIdx = jsonText.indexOf('{');
          const jsonEndIdx = jsonText.lastIndexOf('}');
          if (jsonStartIdx !== -1 && jsonEndIdx > jsonStartIdx) {
            const extractedJson = jsonText.substring(jsonStartIdx, jsonEndIdx + 1);
            parsed = JSON.parse(extractedJson);
          } else {
            throw thirdError;
          }
        }
      }
    }

    return {
      title: parsed.title || fallbackTitle,
      content: parsed.content || rawResponse,
      seo: {
        meta_title: parsed.seo?.meta_title || '',
        meta_description: parsed.seo?.meta_description || '',
        slug: parsed.seo?.slug || generateSlug(parsed.title || fallbackTitle),
        focus_keyword: parsed.seo?.focus_keyword || '',
      },
      metadata: {
        excerpt: parsed.metadata?.excerpt || '',
        categories: Array.isArray(parsed.metadata?.categories) ? parsed.metadata.categories : [],
        tags: Array.isArray(parsed.metadata?.tags) ? parsed.metadata.tags : [],
        featured_image_alt: parsed.metadata?.featured_image_alt || parsed.title || fallbackTitle,
      },
      imagePrompt: cleanupImagePrompt(parsed.image_prompt) || defaultResponse.imagePrompt,
    };
  } catch (e) {
    console.error('[parseRichArticle] All parsing attempts failed:', e);
    console.error('[parseRichArticle] Raw response length:', rawResponse.length);
    console.error('[parseRichArticle] First 500 chars:', rawResponse.substring(0, 500));
    console.error('[parseRichArticle] Last 200 chars:', rawResponse.substring(rawResponse.length - 200));

    // Try to extract title from content if it looks like HTML
    let extractedTitle = fallbackTitle;
    const h1Match = rawResponse.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) {
      extractedTitle = h1Match[1].replace(/<[^>]*>/g, '').trim();
    }

    // Check if the raw response looks like valid JSON that we just couldn't parse
    // In that case, the content field would be inside the JSON, not the whole response
    if (rawResponse.trim().startsWith('{') && rawResponse.trim().endsWith('}')) {
      console.warn('[parseRichArticle] Response looks like JSON but failed to parse - returning raw JSON as content for debugging');
    }

    return {
      ...defaultResponse,
      title: extractedTitle,
      content: rawResponse,
    };
  }
}

/**
 * Generate a URL-friendly slug from title
 */
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with dashes
    .replace(/-+/g, '-') // Replace multiple dashes
    .substring(0, 60) // Limit length
    .replace(/-$/, ''); // Remove trailing dash
}

/**
 * Dispatch multi-stage generation (video pipelines)
 */
async function dispatchMultiStageGeneration(params: DispatchParams) {
  const {
    jobId,
    itemIndex,
    ideaId,
    ideaTitle,
    pipeline,
    prompt,
    modelConfig,
    libraryElements,
    selectedPaths,
    imageInputs,
    videoConfig,
    outputConfig,
    apiKeys,
    supabase,
    supabaseUrl,
    organizationId,
    blueprintId,
    autopilotId
  } = params;

  // Idempotency guard: skip if an output already exists for this job+item_index.
  // We use item_index (stored in generation_params) instead of idea_id because
  // content explosion can create multiple outputs with the same idea_id (different library element variants).
  const { data: existingOutputs } = await supabase
    .from('content_outputs')
    .select('id')
    .eq('job_id', jobId)
    .eq('generation_params->>item_index', String(itemIndex))
    .limit(1);

  if (existingOutputs && existingOutputs.length > 0) {
    console.log(`⚠️ Output already exists for job ${jobId} / item ${itemIndex} — skipping to prevent duplicates`);
    return;
  }

  console.log(`Creating multi-stage output for: ${ideaTitle}`);
  console.log(`📐 videoConfig from params:`, JSON.stringify(videoConfig));
  console.log(`📐 videoConfig.aspectRatio:`, videoConfig?.aspectRatio);
  console.log(`📐 outputConfig from params:`, JSON.stringify(outputConfig));
  console.log(`📐 slotValues:`, JSON.stringify(params.slotValues));
  console.log(`📐 slotValues has scene_count:`, params.slotValues?.scene_count);

  // Check if this is a video pipeline - video pipelines use video_config for aspect ratio, not output_config
  const videoPipelines = ['ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot', 'storyboard_video_longform', 'presenter_video', 'video_remix', 'video'];
  const isVideoPipeline = videoPipelines.includes(pipeline);

  // Generate descriptive title
  const title = generateOutputTitle(ideaTitle);
  
  // Build variant context for filtering
  const variantContext: any = {};
  if (libraryElements.brand_voice?.name) {
    variantContext.brand_voice = libraryElements.brand_voice.name;
  }
  if (libraryElements.content_angle?.name) {
    variantContext.angle = libraryElements.content_angle.name;
  }
  if (libraryElements.product?.name) {
    variantContext.product = libraryElements.product.name;
  }
  if (libraryElements.character?.name) {
    variantContext.character = libraryElements.character.name;
  }

  // Dynamically determine the first stage based on pipeline
  // For presenter_video, resolve stages from presenter config (sourceType, bRollEnabled, voiceType)
  // Merge per-item source_type from slotValues so prompt_only items skip web_capture
  let firstStageId: string;
  if (pipeline === 'presenter_video' && params.presenterConfig) {
    const perItemConfig = {
      ...params.presenterConfig,
      source_type: params.slotValues?.source_type || params.presenterConfig?.source_type,
    };
    const resolvedStages = resolvePresenterStages(perItemConfig);
    firstStageId = resolvedStages[0] || 'director';

    // Override PIPELINE_STAGES for this request so saved content pre-population works
    PIPELINE_STAGES.presenter_video = resolvedStages.map((id, i) => ({
      id,
      modelType: id === 'director' ? 'text_llm' : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedStages[i - 1]] } : {}),
    }));

    console.log(`Pipeline presenter_video resolved stages: [${resolvedStages.join(', ')}]`);
  } else if (pipeline === 'video_remix' && params.presenterConfig) {
    // video_remix uses presenterConfig (stored as remix_config in configuration) for dynamic stage resolution
    const resolvedStages = resolveRemixStages(params.presenterConfig);
    firstStageId = resolvedStages[0] || 'video_ingest';

    PIPELINE_STAGES.video_remix = resolvedStages.map((id, i) => ({
      id,
      modelType: id === 'director' || id === 'rewrite' ? 'text_llm' : id === 'transcribe' ? 'tts' : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedStages[i - 1]] } : {}),
    }));

    console.log(`Pipeline video_remix resolved stages: [${resolvedStages.join(', ')}]`);
  } else if (pipeline === 'video') {
    // Unified video pipeline — resolve stages from video_config
    // Fallback to blueprint defaults when no explicit video_config provided
    if (!params.videoConfig) {
      const bpDefaults = modelConfig?.video_config_defaults || {};
      const legacySource = modelConfig?.presenter_default_source_type;
      params.videoConfig = {
        source: legacySource || 'prompt_only',
        ...bpDefaults,
      };
      console.log('[dispatch] No explicit video_config — using blueprint defaults:', JSON.stringify(params.videoConfig));
    }
    // Smart source detection: override source if per-idea slot values indicate a different source
    const effectiveVideoConfig = { ...params.videoConfig };
    if (params.slotValues?.uploaded_video_url && (!effectiveVideoConfig.source || effectiveVideoConfig.source === 'prompt_only')) {
      effectiveVideoConfig.source = 'upload_video';
      effectiveVideoConfig.uploaded_video_url = params.slotValues.uploaded_video_url;
      console.log('[dispatch] Smart source override: slot_values has uploaded_video_url, switching source to upload_video');
    }
    if (params.slotValues?.source_url && (!effectiveVideoConfig.source || effectiveVideoConfig.source === 'prompt_only')) {
      effectiveVideoConfig.source = 'url';
      effectiveVideoConfig.source_url = params.slotValues.source_url;
      console.log('[dispatch] Smart source override: slot_values has source_url, switching source to url');
    }
    const resolvedStages = resolveVideoStages(effectiveVideoConfig);
    // Update params.videoConfig so generation_params gets the corrected source
    params.videoConfig = effectiveVideoConfig;
    firstStageId = resolvedStages[0] || 'outline';

    PIPELINE_STAGES.video = resolvedStages.map((id, i) => ({
      id,
      modelType: ['director', 'outline', 'rewrite', 'post_caption'].includes(id) ? 'text_llm'
        : ['voiceover'].includes(id) ? 'tts'
        : ['images'].includes(id) ? 'image_generator'
        : 'assembly',
      ...(i > 0 ? { inputFrom: [resolvedStages[i - 1]] } : {}),
    }));

    // Store resolved stages so frontend and approve-stage can use them
    (params as any)._resolvedVideoStages = resolvedStages;

    console.log(`Pipeline video resolved stages: [${resolvedStages.join(', ')}]`);
  } else {
    firstStageId = getFirstStageId(pipeline);
  }

  // If skip_image_generation is set for social_media_post, reduce to caption-only
  if (params.skipImageGeneration && pipeline === 'social_media_post') {
    PIPELINE_STAGES.social_media_post = [
      { id: 'caption', modelType: 'text_llm', outputFormat: 'text' },
    ];
    firstStageId = 'caption';
    console.log(`🚫 [skip_image_generation] social_media_post reduced to caption-only`);
  }

  console.log(`Pipeline ${pipeline} starts with stage: ${firstStageId}`);

  // Determine output type based on pipeline
  const outputType = (pipeline === 'instagram_carousel' || pipeline === 'instagram_carousel_ai') ? 'carousel' :
                     pipeline === 'social_media_post' ? 'text' :
                     pipeline === 'video_script' ? 'text' :
                     pipeline === 'rich_article' ? 'text' :
                     pipeline === 'twitter_thread' ? 'text' :
                     pipeline === 'image_only' ? 'image' :
                     ['ugc_heygen', 'ugc_heygen_template'].includes(pipeline) ? 'video' : 'video';

  // Resolve the image_prompt template for all pipelines that have one
  // This ensures {{character.*}}, {{product.*}}, etc. variables are resolved for display
  let resolvedImagePrompt: string | undefined;
  if (params.imagePrompt) {
    // Use slot values from params, with fallbacks for idea/context/title
    const imageSlotValues = {
      idea: ideaTitle,
      context: ideaTitle,
      title: ideaTitle,
      ...params.slotValues, // Include all slot values (topic, description, etc.)
    };
    // Resolve variables in the image_prompt template
    resolvedImagePrompt = resolvePrompt(
      params.imagePrompt,
      imageSlotValues,
      libraryElements,
      params.selectedPaths,
      params.selectedAiInsights,
      params.ideaAiAnalysis,
    );
    console.log(`[${pipeline}] Resolved image prompt template: ${resolvedImagePrompt.substring(0, 200)}...`);
  }

  // Build carousel style from brand voice for instagram_carousel pipeline
  let carouselStyle: CarouselStyleConfig | undefined;
  if (pipeline === 'instagram_carousel') {
    // Extract brand voice (handle both 'brand' and legacy 'brand_voice' keys, array or single object)
    const brandData = libraryElements.brand || libraryElements.brand_voice;
    const brandVoice = Array.isArray(brandData) ? brandData[0] : brandData;

    console.log('📐 Brand voice for carousel style:', brandVoice ? `${brandVoice.name} (has visual: ${!!brandVoice.visual_template})` : 'none');
    carouselStyle = buildCarouselStyleFromBrandVoice(brandVoice, outputConfig);
    console.log('📐 Built carousel_style from brand voice:', JSON.stringify(carouselStyle));

    // Resolve {{variables}} in ctaButtonText if present
    if (outputConfig?.ctaButtonText && outputConfig.ctaButtonText.includes('{{')) {
      outputConfig.ctaButtonText = resolvePrompt(
        outputConfig.ctaButtonText,
        params.slotValues || {},
        libraryElements,
        selectedPaths,
        params.selectedAiInsights,
        params.ideaAiAnalysis
      );
      console.log('📐 Resolved ctaButtonText:', outputConfig.ctaButtonText);
    }
  }

  // Build initial stage_data (may be pre-populated with saved content)
  const initialStageData: Record<string, any> = {};
  const savedContent = params.savedContent;
  if (savedContent && savedContent.items.length > 0) {
    const firstItem = savedContent.items[0];
    if (savedContent.for_carousel) {
      // Carousel: pre-populate carousel_slides with saved images
      initialStageData.carousel_slides = {
        slides: savedContent.items.map(item => ({
          image_url: item.url,
          saved_content_id: item.id,
        })),
        source: 'saved_library',
      };
      console.log(`📎 [Saved Content] Pre-populated carousel_slides with ${savedContent.items.length} saved images`);
    } else if (firstItem.content_type === 'video') {
      // Video: pre-populate all media stages
      const videoPipelinesForSaved = ['ugc_video', 'ugc_heygen', 'ugc_heygen_template', 'generative_video_oneshot', 'storyboard_video_longform', 'presenter_video', 'video_remix'];
      if (videoPipelinesForSaved.includes(pipeline)) {
        // Pre-populate all non-text stages for video pipelines
        const stages = PIPELINE_STAGES[pipeline] || [];
        for (const stage of stages) {
          if (stage.modelType !== 'text_llm') {
            initialStageData[stage.id] = { source: 'saved_library' };
          }
        }
        // Set the final stage with the actual video URL
        const finalStageId = stages[stages.length - 1]?.id || 'final';
        initialStageData[finalStageId] = {
          video_url: firstItem.url,
          url: firstItem.url,
          source: 'saved_library',
          saved_content_id: firstItem.id,
        };
        console.log(`📎 [Saved Content] Pre-populated video stages with saved video URL`);
      } else if (pipeline === 'social_media_post') {
        // Native video on a social post: skip the image-generation stages and
        // carry the saved video through the `image` stage. The publisher
        // (process-publish-queue) detects media_type === 'video' and emits it
        // as a videoUrl, which push-to-ghl publishes as a reel/video post.
        initialStageData.image_prompt = { text: '[saved content]', source: 'saved_library' };
        initialStageData.image = {
          url: firstItem.url,
          video_url: firstItem.url,
          media_type: 'video',
          source: 'saved_library',
          saved_content_id: firstItem.id,
        };
        console.log(`📎 [Saved Content] Pre-populated social_media_post with saved video`);
      }
    } else if (firstItem.content_type === 'image') {
      // Image: pre-populate image stages
      if (pipeline === 'social_media_post') {
        initialStageData.image_prompt = { text: '[saved content]', source: 'saved_library' };
        initialStageData.image = {
          url: firstItem.url,
          image_url: firstItem.url,
          source: 'saved_library',
          saved_content_id: firstItem.id,
        };
        console.log(`📎 [Saved Content] Pre-populated image + image_prompt with saved image`);
      } else if (pipeline === 'image_only') {
        initialStageData.image = {
          url: firstItem.url,
          image_url: firstItem.url,
          source: 'saved_library',
          saved_content_id: firstItem.id,
        };
        console.log(`📎 [Saved Content] Pre-populated image with saved image`);
      }
    }
  }

  // For image_only with saved content: output is already complete
  const isImageOnlyWithSaved = pipeline === 'image_only' && initialStageData.image?.source === 'saved_library';

  // Create output record with correct first stage as current
  const { data: output, error: insertError } = await supabase
    .from('content_outputs')
    .insert({
      job_id: jobId,
      idea_id: ideaId,
      blueprint_id: blueprintId,
      autopilot_id: autopilotId,
      type: outputType,
      pipeline: pipeline,
      status: isImageOnlyWithSaved ? 'completed' : 'generating',
      current_stage: isImageOnlyWithSaved ? 'image' : firstStageId,
      stage_data: initialStageData,
      data: {
        title,
        metadata: {
          variant_context: variantContext
        }
      },
      generation_params: {
        prompt,
        model_config: modelConfig,
        ...(params.look ? { look: params.look } : {}),
        ...(params.referencePicks && Object.keys(params.referencePicks).length > 0 ? { reference_picks: params.referencePicks } : {}),
        idea_context: ideaTitle, // Pass idea as context for scene generation
        slot_values: params.slotValues, // All slot values (topic, title, description, etc.) for template resolution
        // For unified 'video' pipeline, use videoConfig from config step + per-idea slot overrides
        video_config: pipeline === 'video' ? {
          ...(params.videoConfig || videoConfig || { totalDuration: 60, aspectRatio: 'landscape' }),
          // Per-idea source overrides from slot_values
          url: params.slotValues?.source_url || params.videoConfig?.url || params.videoConfig?.sourceUrl || videoConfig?.url,
          source_type: params.slotValues?.source_type || params.videoConfig?.source || videoConfig?.source_type,
          uploaded_video_url: params.slotValues?.uploaded_video_url || params.videoConfig?.uploaded_video_url || params.videoConfig?.uploadedVideoUrl || videoConfig?.uploaded_video_url,
          brief: params.slotValues?.idea || params.videoConfig?.brief || videoConfig?.brief,
        } : (videoConfig || {
          totalDuration: 60,
          aspectRatio: 'landscape'
        }),
        // For unified video pipeline: store resolved stage IDs so frontend + approve-stage can use them
        pipeline_stages: (params as any)._resolvedVideoStages || undefined,
        // For video pipelines, DON'T set output_config.aspectRatio - use video_config instead
        // output_config is for non-video visual pipelines (images, carousels)
        output_config: isVideoPipeline ? undefined : (outputConfig || {
          aspectRatio: 'landscape'
        }),
        carousel_style: carouselStyle, // Pre-populated from brand voice for instagram_carousel
        variant_context: variantContext,
        library_elements: libraryElements, // Pass library elements for visual context
        image_inputs: imageInputs || {},   // Pass selected reference images
        image_prompt: params.imagePrompt,  // Pass blueprint image_prompt template if set
        director_prompt: params.directorPrompt, // Pass resolved director prompt for video creative direction
        resolved_image_prompt: resolvedImagePrompt, // For image_only: pre-resolved prompt ready for generation
        selected_ai_insights: params.selectedAiInsights, // AI insights for this variation (hook, CTA, etc.)
        idea_ai_analysis: params.ideaAiAnalysis, // Full AI analysis for {{ai_*}} variables in prompts
        item_index: itemIndex, // Used for idempotency: prevents duplicate outputs on re-dispatch
        auto_approve_all: params.autoApproveAll || false, // Auto-approve all stages
        presenter_config: pipeline === 'presenter_video' ? {
          ...params.presenterConfig,
          // Per-idea source URL overrides from slot_values (fallback to global config)
          url: params.slotValues?.source_url || params.presenterConfig?.url,
          source_type: params.slotValues?.source_type || params.presenterConfig?.source_type,
          uploaded_video_url: params.slotValues?.uploaded_video_url || params.presenterConfig?.uploaded_video_url,
          brief: params.slotValues?.idea || params.presenterConfig?.brief,
        } : undefined,
        remix_config: pipeline === 'video_remix' ? {
          ...params.presenterConfig,
          // Per-idea overrides from slot_values
          uploaded_video_url: params.slotValues?.uploaded_video_url || params.presenterConfig?.uploaded_video_url,
          source_type: params.slotValues?.source_type || 'upload',
        } : undefined,
      },
      organization_id: organizationId
    })
    .select()
    .single();

  if (insertError) {
    console.error('Failed to create output:', insertError);
    throw insertError;
  }

  console.log(`✓ Created multi-stage output ${output.id}, executing first stage: ${firstStageId}`);

  // Generate AI title (must await in Deno edge functions)
  const openRouterKey = apiKeys.find(k => k.provider === 'openrouter');
  if (openRouterKey) {
    try {
      const decryptedKey = await decryptApiKey(openRouterKey.key_encrypted);
      await generateAiOutputTitle({
        outputId: output.id,
        ideaTitle,
        pipeline,
        libraryElements,
        supabase,
        supabaseUrl,
        openRouterKey: decryptedKey
      });
    } catch (err) {
      console.warn('[AI Title] Generation failed:', err);
      // Don't fail the whole operation if AI title fails
    }
  }

  // Skip first stage invocation if output is already complete (image_only with saved content)
  if (isImageOnlyWithSaved) {
    console.log(`📎 [Saved Content] image_only pipeline fully satisfied by saved content — skipping stage execution`);
  } else {
    // Fire-and-forget: trigger first stage without awaiting completion.
    // This is critical for explosion jobs (multiple items) — awaiting each stage
    // would cause the dispatch function to time out before all items are dispatched.
    // execute-stage handles its own error recording and status updates.
    const stageUrl = `${supabaseUrl}/functions/v1/execute-stage`;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    console.log(`🚀 [dispatch] Fire-and-forget execute-stage for output ${output.id}, stage ${firstStageId}`);
    const stageFetch = fetch(stageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        output_id: output.id,
        stage_id: firstStageId,
      }),
    }).catch(err => {
      console.error(`[dispatch-generation-job] Fire-and-forget execute-stage failed for output ${output.id}:`, err);
    });
    // EdgeRuntime.waitUntil ensures the fetch is not dropped when this function returns its response.
    // Without this, Deno may kill in-flight background requests as soon as the HTTP response is sent.
    try { (globalThis as any).EdgeRuntime?.waitUntil(stageFetch); } catch (_) { /* not available in all environments */ }
  }

  // Update job progress atomically with retry
  await incrementProgressWithRetry(supabase, jobId, false, false); // Don't count as completed yet
}

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encryptionKeyHex = Deno.env.get('ENCRYPTION_KEY');
  
  if (!encryptionKeyHex) {
    throw new Error('ENCRYPTION_KEY not configured');
  }

  try {
    // Convert hex key to bytes
    const keyBytes = new Uint8Array(
      encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    // Decode the base64 encrypted data
    const encryptedData = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and ciphertext
    const iv = encryptedData.slice(0, 12);
    const ciphertext = encryptedData.slice(12);

    // Import the key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    // Convert to string
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}
