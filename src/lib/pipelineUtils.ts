// Pipeline classification constants and helpers
// Used to determine which configuration panels to show for each blueprint
import { PipelineId } from '@/types/pipeline';
import { PIPELINE_STAGES } from '@/types/pipelineStages';

// Pipelines that need video configuration (duration, scenes, aspect ratio)
export const VIDEO_PIPELINES = [
  'generative_video_oneshot',
  'ugc_video',
  'ugc_heygen',
  'ugc_heygen_template',
  'storyboard_video_longform',
  'presenter_video',
  'video_remix',
  'video',
] as const;

// Long-form pipelines that need extended duration options (5-10 min)
export const LONGFORM_VIDEO_PIPELINES = [
  'storyboard_video_longform',
] as const;

// Pipelines that generate visual content but don't need full video config
// (just aspect ratio) - rich_article excluded as it always uses landscape
export const VISUAL_PIPELINES = [
  'social_media_post',
  'instagram_carousel',
  'image_only',
] as const;

// Carousel pipelines that need slide count configuration
export const CAROUSEL_PIPELINES = [
  'instagram_carousel',
] as const;

// Pipelines that require TTS (voice) configuration
export const TTS_PIPELINES = [
  'ugc_video',
  'storyboard_video_longform',
  'presenter_video',
  'video_remix',
  'video',
] as const;

// Helper functions
export function isVideoPipeline(pipeline?: string | null): boolean {
  return !!pipeline && VIDEO_PIPELINES.includes(pipeline as typeof VIDEO_PIPELINES[number]);
}

export function isLongformVideoPipeline(pipeline?: string | null): boolean {
  return !!pipeline && LONGFORM_VIDEO_PIPELINES.includes(pipeline as typeof LONGFORM_VIDEO_PIPELINES[number]);
}

export function isVisualPipeline(pipeline?: string | null): boolean {
  return !!pipeline && VISUAL_PIPELINES.includes(pipeline as typeof VISUAL_PIPELINES[number]);
}

export function isCarouselPipeline(pipeline?: string | null): boolean {
  return !!pipeline && CAROUSEL_PIPELINES.includes(pipeline as typeof CAROUSEL_PIPELINES[number]);
}

export function requiresTTS(pipeline?: string | null): boolean {
  return !!pipeline && TTS_PIPELINES.includes(pipeline as typeof TTS_PIPELINES[number]);
}

// Returns true if the pipeline requires configuration options
export function requiresConfiguration(pipeline?: string | null): boolean {
  return isVideoPipeline(pipeline) || isVisualPipeline(pipeline);
}

// Stage type to human-readable output label
const STAGE_TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  audio: 'Voiceover',
  script: 'Script',
  image_gallery: 'Scene Images',
  video_gallery: 'Video Clips',
  text_gallery: 'Text Content',
  carousel_gallery: 'Carousel Slides',
  carousel_style: 'Carousel Style',
  scene_gallery: 'Scene Breakdown',
  audio_gallery: 'Audio Segments',
  custom: 'Custom',
};

export interface PipelineOutputSummary {
  shortLabel: string;
  stageFlow: { id: string; label: string; type: string; modelType?: string }[];
  hasVoiceover: boolean;
  hasImages: boolean;
  hasVideo: boolean;
}

/**
 * Returns a human-readable summary of what a pipeline produces,
 * derived from PIPELINE_STAGES.
 */
export function getPipelineOutputSummary(pipeline: PipelineId): PipelineOutputSummary {
  const stages = PIPELINE_STAGES[pipeline] || [];

  const hasVoiceover = stages.some(s => s.type === 'audio' || s.modelType === 'tts');
  const hasImages = stages.some(s =>
    s.type === 'image' || s.type === 'image_gallery' || s.type === 'carousel_gallery'
  );
  const hasVideo = stages.some(s =>
    s.type === 'video' || s.type === 'video_gallery' || s.modelType === 'world_simulator'
  );
  const hasCarousel = stages.some(s => s.type === 'carousel_gallery');
  const hasText = stages.some(s => s.type === 'text' || s.type === 'script');

  // Build short label
  let shortLabel: string;
  if (hasCarousel) {
    shortLabel = 'Carousel slides';
  } else if (hasVideo && hasVoiceover) {
    shortLabel = 'Video with voiceover';
  } else if (hasVideo) {
    shortLabel = 'Video';
  } else if (hasImages && hasText) {
    shortLabel = 'Image post with caption';
  } else if (hasImages) {
    shortLabel = 'Image';
  } else if (hasText) {
    shortLabel = 'Text content';
  } else {
    shortLabel = 'Content';
  }

  const stageFlow = stages.map(s => ({
    id: s.id,
    label: s.label,
    type: STAGE_TYPE_LABELS[s.type] || s.type,
    modelType: s.modelType,
  }));

  return { shortLabel, stageFlow, hasVoiceover, hasImages, hasVideo };
}

export interface PipelineLibraryNeed {
  table: string;
  reason: string;
  required: boolean;
}

/**
 * Returns library tables the pipeline itself benefits from,
 * independent of prompt variable references.
 * E.g., TTS pipelines benefit from library_characters (for voice selection).
 */
export function getPipelineLibraryNeeds(pipeline?: string | null): PipelineLibraryNeed[] {
  const needs: PipelineLibraryNeed[] = [];

  if (requiresTTS(pipeline)) {
    needs.push({
      table: 'library_characters',
      reason: 'Select a character to set the voiceover voice',
      required: false,
    });
  }

  // HeyGen pipelines require a character with HeyGen avatar configured
  if (pipeline === 'ugc_heygen') {
    needs.push({
      table: 'library_characters',
      reason: 'Select a character with a HeyGen avatar and voice configured',
      required: true,
    });
  }

  return needs;
}
