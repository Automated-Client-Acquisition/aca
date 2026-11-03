import { PinnedLibraryElements } from "./blueprint";
import { SelectedAiInsights } from "./wizard";

// Selected AI insights for a single variation (one hook or talking point)
export interface GenerationItemAiInsights {
  // Single hook (for separate mode - one output per hook)
  hook?: { text: string; type: string; index: number };
  // Multiple hooks (for combine mode - all selected hooks in one output)
  hooks?: Array<{ text: string; type: string; index: number }>;
  // Single CTA (legacy/separate mode)
  cta?: { text: string; placement: string; type: string } | null;
  // Multiple CTAs (for combine mode - all selected CTAs in one output)
  ctas?: Array<{ text: string; placement: string; type: string; index: number }>;
  talking_points?: string[];
  // Single talking point for variations (when createTalkingPointVariations is true)
  talking_point?: { text: string; index: number };
  script_structure?: {
    opening?: string;
    body?: string;
    climax?: string;
    closing?: string;
  };
  engagement_drivers?: string[];
}

export type ImageUsageMode = 'auto' | 'force_all';

export interface GenerationItem {
  idea_id: string;
  idea_title: string;
  slot_values: Record<string, string>;
  library_elements?: Record<string, any>;
  selected_paths?: Record<string, Record<string, number>>;
  image_inputs?: Record<string, string[]>;
  selected_ai_insights?: GenerationItemAiInsights; // AI insights for this specific variation
  // Direct AI data from idea (for {{ai_talking_points_list}} etc.)
  idea_ai_analysis?: any;
  // Image usage mode: 'auto' follows blueprint variables, 'force_all' includes all selected images
  image_usage_mode?: ImageUsageMode;
}

export interface GenerationJob {
  id: string;
  organization_id: string;
  user_id: string;
  blueprint_id: string;
  content_type: string;
  status: 'queued' | 'processing' | 'review' | 'completed' | 'failed';
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  items: GenerationItem[];
  cost: {
    estimated: number;
    current: number;
  };
  configuration: {
    blueprint_name: string;
    pipeline: string;
    model_config: any;
  };
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
}

export interface ContentOutput {
  id: string;
  job_id: string;
  idea_id: string;
  type: string; // 'text', 'image', 'video', 'audio'
  pipeline: string;
  status: 'generating' | 'review' | 'approved' | 'rejected';
  data: {
    // Polymorphic based on pipeline
    text?: string;
    markdown?: string;
    media_urls?: string[];
    metadata?: Record<string, any>;
  };
  generation_params: Record<string, any>;
  error_message?: string;
}

export interface ManualIdeaRow {
  id: string;
  context: string; // Idea description/context
  freeText?: string; // User-provided free text, resolvable as {{idea_text}}
  sourceUrls?: string; // Reference URLs (newline-separated), resolvable as {{idea_urls}}
  uploadedVideoUrl?: string; // Source video URL for video_remix pipeline
  sourceType?: 'url' | 'upload' | 'prompt_only'; // Source type for presenter_video pipeline
  sourceUrl?: string; // Website URL for presenter_video web capture
}
