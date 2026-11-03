export interface NormalizedCapabilities {
  roles: Record<string, {
    provider_key: string | null;
    type: string;
    required: boolean;
    transform?: TransformRule;
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
  normalized_at?: string;
  schema_version?: string;
}

export interface TransformRule {
  type: 'multiply' | 'divide' | 'enum' | 'computed' | 'boolean_invert' | 'string_template';
  factor?: number;
  values?: string[];
  from?: string[];
  logic?: string;
  template?: string;
}

export interface UserInput {
  // Text inputs
  main_prompt?: string;
  negative_prompt?: string;
  
  // Generation controls
  seed?: number;
  steps?: number;
  guidance?: number;
  
  // Resolution
  aspect_ratio?: string; // "16:9", "1:1", etc.
  resolution_tier?: 'SD' | 'HD' | 'FHD' | 'UHD'; // SD=512, HD=1024, FHD=1920, UHD=2560
  
  // Media inputs (URLs or base64)
  image_input?: string;
  reference_images?: string[];
  video_input?: string;
  audio_input?: string;
  mask_input?: string;
  depth_map?: string;
  pose_input?: string;
  edge_map?: string;
  normal_map?: string;
  style_image?: string;
  control_image?: string;
  lut_image?: string;
  segmentation_map?: string;
  scribble_input?: string;
  lineart_input?: string;
  qr_code_input?: string;
  
  // Additional parameters (provider-specific overrides)
  [key: string]: any;
}

export interface RecipeDefaults {
  seed?: number;
  steps?: number;
  guidance?: number;
  aspect_ratio?: string;
  resolution_tier?: 'SD' | 'HD' | 'FHD' | 'UHD';
  [key: string]: any;
}

export interface BuildPayloadResult {
  payload: Record<string, any>;
  warnings: string[];
  missing_required: string[];
}

export interface AspectRatioDimensions {
  width: number;
  height: number;
}

// Resolution tier base dimensions
export const RESOLUTION_TIERS: Record<string, number> = {
  SD: 512,
  HD: 1024,
  FHD: 1920,
  UHD: 2560,
};

// Common aspect ratios with their numeric values
export const ASPECT_RATIOS: Record<string, { w: number; h: number }> = {
  '1:1': { w: 1, h: 1 },
  '16:9': { w: 16, h: 9 },
  '9:16': { w: 9, h: 16 },
  '4:3': { w: 4, h: 3 },
  '3:4': { w: 3, h: 4 },
  '21:9': { w: 21, h: 9 },
  '9:21': { w: 9, h: 21 },
  '3:2': { w: 3, h: 2 },
  '2:3': { w: 2, h: 3 },
};
