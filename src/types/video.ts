/**
 * Unified Video Pipeline Types
 *
 * Single VideoConfig replaces PresenterVideoConfigValues, VideoRemixConfigValues,
 * and the old VideoConfig (totalDuration/aspectRatio). All video creation modes
 * are handled through this one config.
 */

// ============= VIDEO CONFIG =============

export type VideoSource = 'url' | 'upload_video' | 'upload_images' | 'prompt_only';
export type NarrationMode = 'generate' | 'rewrite';
export type RewriteStyle = 'polish' | 'shorten' | 'expand' | 'react' | 'translate' | 'custom';
export type VoiceMode = 'voiceover' | 'avatar' | 'keep_original' | 'none';
export type LipSyncProvider = 'elevenlabs' | 'heygen' | 'sync_labs';
export type ImageMode = 'ai_generated' | 'none';
export type BRollStyle = 'stock' | 'ai_generated';
export type VideoOrientation = 'portrait' | 'landscape';
export type VideoAspectRatio = '9:16' | '16:9' | '1:1' | '4:5';

export interface VideoConfig {
  // Source material
  source: VideoSource;
  sourceUrl?: string;              // For 'url' mode
  uploadedVideoUrl?: string;       // For 'upload_video' mode
  uploadedImageUrls?: string[];    // For 'upload_images' mode

  // Narration
  narrationMode: NarrationMode;
  rewriteStyle?: RewriteStyle;
  targetLanguage?: string;
  customRewriteInstructions?: string;
  targetDuration?: number;         // seconds, for outline stage

  // Voice
  voiceMode: VoiceMode;
  lipSyncProvider?: LipSyncProvider;
  avatarPhotoUrl?: string;
  heygenAvatarId?: string;
  removeBackground?: boolean;      // Remove avatar background

  // Images
  imageMode: ImageMode;

  // B-Roll
  bRollEnabled: boolean;
  bRollStyle?: BRollStyle;

  // Presentation
  orientation: VideoOrientation;
  aspectRatio?: VideoAspectRatio;
  subtitleStyle: string;           // e.g. 'tiktok_bounce', 'big_center', 'karaoke', 'minimal'
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;  // 0-1
  transitionType?: string;         // e.g. 'crossfade', 'cut_hard', 'slide_left'
}

// ============= DEFAULT CONFIG =============

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  source: 'prompt_only',
  narrationMode: 'generate',
  voiceMode: 'voiceover',
  imageMode: 'none',
  bRollEnabled: false,
  orientation: 'portrait',
  subtitleStyle: 'tiktok_bounce',
  targetDuration: 60,
};

// ============= STAGE RESOLUTION =============

/**
 * Dynamically resolve which stages run for a given VideoConfig.
 * This is the frontend mirror of the backend resolveVideoStages().
 */
export function resolveVideoStages(config: VideoConfig): string[] {
  const stages: string[] = [];

  // Source stage
  if (config.source === 'url') stages.push('web_capture');
  if (config.source === 'upload_video') {
    stages.push('video_ingest');
    stages.push('transcribe');
  }
  // 'upload_images' and 'prompt_only' have no source stage

  // Narration stage
  if (config.narrationMode === 'rewrite') {
    stages.push('rewrite');
  } else {
    stages.push('outline');
  }

  // Voice stage
  if (config.voiceMode === 'voiceover' || config.voiceMode === 'avatar') {
    stages.push('voiceover');
  }

  // Director (always)
  stages.push('director');

  // B-Roll (optional)
  if (config.bRollEnabled) {
    stages.push('b_roll');
  }

  // AI Images (optional)
  if (config.imageMode === 'ai_generated') {
    stages.push('images');
  }

  // Composition (always)
  stages.push('composition');

  return stages;
}

// ============= STAGE LABELS =============

export const VIDEO_STAGE_LABELS: Record<string, string> = {
  web_capture: 'Web Capture',
  video_ingest: 'Video Import',
  transcribe: 'Transcription',
  outline: 'Narration Script',
  rewrite: 'Script Rewrite',
  voiceover: 'Voice & Audio',
  director: 'Shot List',
  b_roll: 'B-Roll',
  images: 'Scene Images',
  composition: 'Final Video',
};

// ============= VALIDATION =============

/**
 * Validate a VideoConfig for completeness.
 * Returns array of error messages (empty = valid).
 */
export function validateVideoConfig(config: VideoConfig): string[] {
  const errors: string[] = [];

  // Source validation
  if (config.source === 'url' && !config.sourceUrl) {
    errors.push('URL is required when source is "From URL"');
  }
  if (config.source === 'upload_video' && !config.uploadedVideoUrl) {
    errors.push('Video upload is required when source is "From Video"');
  }
  if (config.source === 'upload_images' && (!config.uploadedImageUrls || config.uploadedImageUrls.length === 0)) {
    errors.push('At least one image is required when source is "From Images"');
  }

  // Narration validation
  if (config.narrationMode === 'rewrite' && config.source !== 'upload_video') {
    errors.push('Rewrite mode requires an uploaded video with existing audio');
  }
  if (config.narrationMode === 'rewrite' && config.rewriteStyle === 'translate' && !config.targetLanguage) {
    errors.push('Target language is required for translation');
  }

  // Voice validation
  if (config.voiceMode === 'keep_original' && config.source !== 'upload_video') {
    errors.push('"Keep Original" voice is only available with uploaded video');
  }
  if (config.voiceMode === 'avatar' && !config.lipSyncProvider) {
    errors.push('Avatar provider is required when using AI Avatar voice');
  }

  return errors;
}
