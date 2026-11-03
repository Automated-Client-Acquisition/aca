import type { BlueprintContext } from '@/lib/blueprint-context';
import type { BlueprintBrief } from '@/lib/blueprint-brief';

export type SlotType = 'text' | 'library_element';

export type LibraryElementType =
  | 'library_brand_voices'
  | 'library_characters'
  | 'library_blocks'
  | 'library_products'
  | 'library_icps'
  | 'library_images';

export interface BlueprintSlot {
  key: string;
  type: SlotType;
  label?: string;
  library_table?: LibraryElementType;
  required?: boolean;
}

export interface ImageInputConfig {
  parameter_name: string;        // e.g., "image_input", "reference_image"
  source: string;                 // e.g., "product.images", "character.reference_images"
  selection_mode: 'single' | 'multiple';  // Single URL string or array of URLs
  required?: boolean;
}

export interface ModelConfig {
  provider: 'openrouter' | 'replicate' | 'elevenlabs' | 'openai' | 'ollama' | 'alibaba';
  model_id: string;
  parameters: Record<string, any>;
  image_inputs?: ImageInputConfig[];  // NEW: Define which params receive images
}

export interface BlueprintModelConfig {
  text_llm?: ModelConfig;
  image_generator?: ModelConfig;
  tts?: ModelConfig;
  world_simulator?: ModelConfig;
  // Legacy support
  provider?: 'openrouter' | 'replicate';
  model_id?: string;
  parameters?: Record<string, any>;

  // Prompt overrides
  prompt_overrides?: Record<string, {
    system?: string;
    user?: string;
  }>;

  // Carousel settings (instagram_carousel pipeline)
  carousel_template?: string;     // Template ID from carousel-templates registry
  carousel_slide_count?: number;  // Number of slides (2-10)
  carousel_custom_palette?: {     // Override brand voice colors for this blueprint
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
  carousel_background_image?: string; // Public URL for custom background image
  carousel_handle?: string;       // @handle shown in the header of every slide (template carousels)

  // Subtitle settings (video pipelines with TTS)
  subtitles_enabled?: boolean;    // Enable burnt-in subtitles
  subtitle_template?: string;     // Template ID from caption-style-templates registry

  // Video remix creative direction (stored on blueprint, not per-job config)
  remix_rewrite_style?: 'polish' | 'shorten' | 'expand' | 'react' | 'translate' | 'custom';
  remix_visual_style?: 'remix' | 'enhance';
  remix_template_type?: string;
  remix_target_language?: string;
  remix_custom_rewrite_instructions?: string;

  // Presenter video default source type
  presenter_default_source_type?: string;

  // Unified video pipeline defaults (stored on blueprint, merged with DEFAULT_VIDEO_CONFIG in wizard)
  video_config_defaults?: Partial<{
    source: string;
    narrationMode: string;
    voiceMode: string;
    imageMode: string;
    bRollEnabled: boolean;
    bRollStyle: string;
    orientation: string;
    subtitleStyle: string;
    targetDuration: number;
    generate_post_caption: boolean;
  }>;
}

export interface BlueprintStructure {
  slots: BlueprintSlot[];
}

export interface Blueprint {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  master_prompt: string;
  image_prompt?: string; // Separate prompt template for image generation stages
  director_prompt?: string; // Separate prompt template for video director creative direction
  skip_image_generation?: boolean; // When true, skip image stages entirely (text-only output; social_media_post only)
  structure: BlueprintStructure;
  model_config: BlueprintModelConfig;
  pipeline?: string;
  tags?: string[];
  reference_image_libraries?: LibraryElementType[]; // Library types for reference image selection (no prompt variables required)
  brief?: BlueprintBrief | null; // Studio brief; compiled into master_prompt on save
  context?: BlueprintContext | null; // Brand/audience/product/person usage; null = legacy prompt-slot inference
  is_public?: boolean;
  is_active?: boolean;
  is_master?: boolean;
  usage_count?: number;
  version?: number;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface CreateBlueprintInput {
  name: string;
  description?: string;
  pipeline?: string;
  folder_id?: string | null;
  master_prompt: string;
  image_prompt?: string; // Separate prompt template for image generation stages
  director_prompt?: string; // Separate prompt template for video director creative direction
  skip_image_generation?: boolean; // When true, skip image stages entirely (text-only output; social_media_post only)
  structure: BlueprintStructure;
  model_config: BlueprintModelConfig;
  tags?: string[];
  reference_image_libraries?: LibraryElementType[]; // Library types for reference image selection (no prompt variables required)
  brief?: BlueprintBrief | null;
  context?: BlueprintContext | null;
}

export interface UpdateBlueprintInput extends Partial<CreateBlueprintInput> {
  id: string;
}

// Nested data selection support - with granular array item selection
export interface NestedPathSelection {
  [fieldKey: string]: {
    included: boolean;
    selectedItems?: string[]; // Selected items from array fields
    combinationMode?: 'combine' | 'separate'; // How to handle multiple selected items
  };
}

export interface LibraryElementSelection {
  [elementId: string]: {
    paths?: NestedPathSelection;
    selected_images?: string[]; // URLs of selected images for visual libraries
    image_combination_mode?: 'combine' | 'separate'; // Per-element image combination mode
    selected_heygen_profiles?: string[]; // IDs of selected HeyGen avatar profiles for explosion
  };
}

export interface PinnedLibraryElements {
  [libraryTable: string]: {
    combination_mode: 'combine' | 'separate';
    image_combination_mode?: 'combine' | 'separate'; // Independent mode for reference images
    elements: LibraryElementSelection;
  };
}
