// Autopilot Types for Automated Content Production Pipeline

export type AutopilotStatus = 'active' | 'paused' | 'archived';
export type SchedulingMode = 'immediate' | 'optimal' | 'scheduled';
export type IdeasSource = 'per_blueprint' | 'shared';
export type VariationMode = 'exact' | 'slight_variation' | 'regenerate';
export type FrequencyUnit = 'hour' | 'day' | 'week';
export type AspectRatio = 'landscape' | 'portrait' | 'square';
export type MediaSource = 'generate' | 'saved_library' | 'mixed';
// Format configuration for video pipelines
export interface AutopilotVideoConfig {
  totalDuration: number;
  sceneDuration?: 4 | 6 | 8 | 12;
  sceneCount?: number;
  aspectRatio: AspectRatio;
  generate_post_caption?: boolean;
}

// Presenter video pipeline configuration
// Creative direction (template type) comes from the blueprint's master_prompt
// Voice/avatar selection comes from pinned Library Character
export interface AutopilotPresenterConfig {
  sourceType?: 'url' | 'upload' | 'prompt_only';
  url?: string; // Default target URL (can be overridden by idea metadata)
  voiceType?: 'heygen_avatar' | 'voiceover' | 'none';
  creativePrompt?: string;
  brief?: string;
  bRollEnabled?: boolean;
  bRollStyle?: 'stock' | 'ai_generated';
  subtitleStyle?: 'tiktok_bounce' | 'big_center' | 'karaoke' | 'minimal';
  orientation?: 'portrait' | 'landscape';
  maxScreenshots?: number;
  backgroundMusicUrl?: string;
}

// Format configuration for visual pipelines (images, carousels)
export interface AutopilotOutputConfig {
  aspectRatio: AspectRatio;
  slideCount?: number; // 2-10 for carousels
  carouselTemplate?: string; // Template ID from carousel-templates registry
}

// Library selection types for autopilot (simplified from manual jobs - no combine/separate modes)
export interface AutopilotLibraryPathSelection {
  included: boolean;
  selectedItems?: string[];  // For array fields like ICP pain points
}

export interface AutopilotLibraryElementConfig {
  paths?: Record<string, AutopilotLibraryPathSelection>;
  selected_images?: string[];  // URLs of reference images to use
}

export interface AutopilotLibrarySelection {
  [libraryTable: string]: {  // e.g., "library_products", "library_brand_voices"
    elements: Record<string, AutopilotLibraryElementConfig>;
  }
}

export interface ContentMixItem {
  blueprint_id: string;
  weight: number; // 0-100, all weights should sum to 100
  enabled: boolean;
  idea_tags?: string[]; // Optional: filter ideas by tags for this blueprint
  library_elements?: AutopilotLibrarySelection; // Optional: library elements for this blueprint
  video_config?: AutopilotVideoConfig; // Optional: video format settings (undefined = use defaults)
  output_config?: AutopilotOutputConfig; // Optional: output format settings (undefined = use defaults)
  presenter_config?: AutopilotPresenterConfig; // Optional: presenter video settings (voice, avatar, template, etc.)
  media_source?: MediaSource; // Optional: where media comes from ('generate' = AI pipeline, 'saved_library' = tag-matched saved content, 'mixed' = configurable ratio)
  media_content_types?: ('image' | 'video')[]; // Optional: which saved content types to match (default: inferred from pipeline)
  saved_library_ratio?: number; // Optional: 0-100, for 'mixed' mode — % chance of using saved content vs generating
  saved_content_tags?: string[]; // Optional: explicit tags to match against library_saved_content.tags (overrides idea tags for saved content matching)
  hook_rotation?: boolean; // Optional: rotate through AI-generated hooks across runs (idea stays in pool until all hooks used)
  skip_image_generation?: boolean; // Optional: skip image generation for social_media_post pipeline (text-only output)
  destination_account_ids?: string[]; // Optional: only post this blueprint to these accounts (default: every destination)
}

/** "Plan each day": one weekly slot. A blueprint_id pins it; otherwise the rotation picks. */
export interface ScheduleSlot {
  day: number; // local weekday, 0 = Sunday … 6 = Saturday
  time: string; // local "HH:MM"
  blueprint_id?: string | null;
}

export interface PublishDestination {
  account_id: string;
  platform: string;
  enabled: boolean;
  post_type?: string;
}

export interface EvergreenConfig {
  enabled: boolean;
  min_age_days: number;
  max_reposts: number;
  variation_mode: VariationMode;
}

export interface FrequencyConfig {
  amount: number;
  unit: FrequencyUnit;
}

export interface Autopilot {
  id: string;
  organization_id: string;
  created_by?: string;
  name: string;
  status: AutopilotStatus;
  /** Why it paused itself (bad key, repeated failures). Cleared on resume. */
  paused_reason?: string | null;
  folder_id?: string | null;

  // Content mix configuration
  content_mix: ContentMixItem[];
  ideas_source: IdeasSource;
  shared_idea_tags?: string[];

  // Frequency & timing
  frequency: FrequencyConfig;
  scheduling_mode: SchedulingMode;
  timezone: string;
  scheduled_times?: string[];
  /** Scheduled mode: local weekdays (0 = Sun … 6 = Sat). Unset = every day. */
  scheduled_days?: number[] | null;
  /** Scheduled mode, plan each day: when non-empty, replaces scheduled_times × scheduled_days. */
  schedule_slots?: ScheduleSlot[] | null;

  // Publishing destinations
  destinations: PublishDestination[];

  // Evergreen settings
  evergreen?: EvergreenConfig;

  // Pool configuration
  pool_mode?: PoolMode;
  auto_reload_pool?: boolean;
  pool_reload_threshold?: number;
  /** Only pick ideas whose guidelines a person approved. */
  only_approved_ideas?: boolean;

  // Tracking
  last_run_at?: string;
  next_run_at?: string;
  total_generated: number;
  total_published: number;

  created_at: string;
  updated_at: string;
}

export interface CreateAutopilotInput {
  name: string;
  content_mix: ContentMixItem[];
  ideas_source?: IdeasSource;
  shared_idea_tags?: string[];
  frequency: FrequencyConfig;
  scheduling_mode?: SchedulingMode;
  timezone?: string;
  scheduled_times?: string[];
  scheduled_days?: number[] | null;
  schedule_slots?: ScheduleSlot[] | null;
  destinations: PublishDestination[];
  evergreen?: EvergreenConfig;
  auto_reload_pool?: boolean;
  only_approved_ideas?: boolean;
  /** Override the first run time (defaults to one frequency interval from now). */
  next_run_at?: string;
}

export interface UpdateAutopilotInput extends Partial<CreateAutopilotInput> {
  id: string;
  status?: AutopilotStatus;
}

// Publish Queue Types
export type PublishQueueStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface PublishQueueItem {
  id: string;
  autopilot_id: string;
  output_id: string;
  account_id: string;
  platform: string;
  scheduled_for: string;
  status: PublishQueueStatus;
  attempts: number;
  last_error?: string;
  published_at?: string;
  is_repost: boolean;
  source_publication_id?: string;
  created_at: string;

  // Joined data
  autopilot?: Pick<Autopilot, 'id' | 'name'>;
  content_output?: {
    id: string;
    data: any;
    stage_data: any;
    pipeline: string;
    job_id?: string;
  };
  // Account info (fetched separately based on platform)
  account?: {
    name: string;
    url?: string;
    avatar_url?: string;
  };
}

// Content Publication Types (for evergreen tracking)
export interface ContentPublication {
  id: string;
  autopilot_id: string;
  output_id: string;
  account_id: string;
  platform: string;
  external_post_id?: string;
  published_at: string;
  repost_count: number;
  last_reposted_at?: string;
  evergreen_eligible: boolean;
  created_at: string;
}

// Automation Log Types
export type AutomationEventType =
  | 'generation_started'
  | 'stage_auto_approved'
  | 'publish_queued'
  | 'published'
  | 'publish_failed'
  | 'evergreen_queued'
  | 'no_ideas_available'
  | 'pool_synced'
  | 'pool_recycled'
  | 'idea_marked_produced';

// Pool mode determines how ideas are selected
export type PoolMode = 'tag_based' | 'explicit' | 'hybrid';

// Status of an idea in the pool
export type IdeaPoolStatus = 'available' | 'in_progress' | 'produced' | 'failed' | 'skipped';

// How an idea was added to the pool
export type IdeaPoolAddedBy = 'manual' | 'tag_sync' | 'import' | 'api';

// Idea pool entry - tracks individual ideas in an autopilot's pool
export interface IdeaPoolEntry {
  id: string;
  autopilot_id: string;
  idea_id: string;
  organization_id: string;
  status: IdeaPoolStatus;
  priority: number;

  // Production tracking
  produced_at?: string;
  output_id?: string;
  job_id?: string;
  blueprint_id?: string;

  // Usage tracking
  attempt_count: number;
  last_attempt_at?: string;
  error_message?: string;

  // Recycling support
  can_recycle: boolean;
  recycle_count: number;
  last_recycled_at?: string;

  // Metadata
  added_by?: IdeaPoolAddedBy;
  metadata?: Record<string, any>;

  created_at: string;
  updated_at: string;

  // Joined data
  idea?: {
    id: string;
    title: string;
    tags?: string[]; // Actual tags from idea_tag_assignments
    content_framework?: string | null;
    emotional_triggers?: string[] | null;
    ai_analysis?: any;
    brand_voice_id?: string | null;
    product_id?: string | null;
    content_angle_id?: string | null;
  };
}

// Pool statistics for an autopilot
export interface AutopilotPoolStats {
  autopilot_id: string;
  autopilot_name: string;
  organization_id: string;
  total_ideas: number;
  available_ideas: number;
  in_progress_ideas: number;
  produced_ideas: number;
  failed_ideas: number;
  skipped_ideas: number;
  completion_percentage: number;
}

export interface AutomationLog {
  id: string;
  autopilot_id: string;
  output_id?: string;
  job_id?: string;
  event_type: AutomationEventType;
  stage_id?: string;
  details?: Record<string, any>;
  created_at: string;
}

// Timezone options for the UI
export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
] as const;

// Frequency presets for the UI
export const FREQUENCY_PRESETS = [
  { label: '1/day', amount: 1, unit: 'day' as FrequencyUnit },
  { label: '2/day', amount: 12, unit: 'hour' as FrequencyUnit },
  { label: '3/day', amount: 8, unit: 'hour' as FrequencyUnit },
  { label: '4/day', amount: 6, unit: 'hour' as FrequencyUnit },
  { label: '6/day', amount: 4, unit: 'hour' as FrequencyUnit },
  { label: '8/day', amount: 3, unit: 'hour' as FrequencyUnit },
  { label: '12/day', amount: 2, unit: 'hour' as FrequencyUnit },
  { label: '3/week', amount: 56, unit: 'hour' as FrequencyUnit },
  { label: '1/week', amount: 1, unit: 'week' as FrequencyUnit },
] as const;

// Pipeline type constants for format configuration
export const VIDEO_PIPELINES = [
  'generative_video_oneshot',
  'ugc_video',
  'storyboard_video_longform',
  'presenter_video',
] as const;

export const LONGFORM_VIDEO_PIPELINES = [
  'storyboard_video_longform',
] as const;

export const VISUAL_PIPELINES = [
  'social_media_post',
  'instagram_carousel',
  'image_only',
] as const;

export const CAROUSEL_PIPELINES = [
  'instagram_carousel',
] as const;

// Pipelines that produce media (eligible for saved content media source)
export const MEDIA_PIPELINES = [
  'social_media_post',
  'instagram_carousel',
  'image_only',
  'generative_video_oneshot',
  'ugc_video',
  'storyboard_video_longform',
  'presenter_video',
  'ugc_heygen',
  'ugc_heygen_template',
] as const;

// Duration presets for video configuration
export const DURATION_PRESETS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 90, label: '1.5 min' },
  { value: 120, label: '2 min' },
  { value: 180, label: '3 min' },
] as const;

export const LONGFORM_DURATION_PRESETS = [
  { value: 30, label: '30s' },
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 180, label: '3 min' },
  { value: 300, label: '5 min' },
  { value: 420, label: '7 min' },
  { value: 600, label: '10 min' },
] as const;

export const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; icon: string }[] = [
  { value: 'landscape', label: 'Landscape', icon: '16:9' },
  { value: 'portrait', label: 'Portrait', icon: '9:16' },
  { value: 'square', label: 'Square', icon: '1:1' },
];

// Default video config values
export const DEFAULT_VIDEO_CONFIG: AutopilotVideoConfig = {
  totalDuration: 60,
  aspectRatio: 'landscape',
};

// Default output config values
export const DEFAULT_OUTPUT_CONFIG: AutopilotOutputConfig = {
  aspectRatio: 'landscape',
};
