import { PipelineId, ModelType } from './pipeline';

export type StageType = 'text' | 'image' | 'video' | 'audio' | 'script' | 'image_gallery' | 'video_gallery' | 'text_gallery' | 'carousel_gallery' | 'carousel_style' | 'scene_gallery' | 'audio_gallery' | 'custom' | 'composite';

export interface StageConfig {
  id: string;
  label: string;
  type: StageType;
  required: boolean;  // false = optional (like image for rich_article)
  approvable: boolean; // true = user can approve/reject this stage independently
  modelType?: ModelType | 'assembly'; // Which model category to use for this stage (or assembly for stitching)
  inputFrom?: string[]; // Which previous stages provide input
  outputFormat?: 'text' | 'url' | 'urls' | 'text_array'; // Expected output format
}

export const PIPELINE_STAGES: Record<PipelineId, StageConfig[]> = {
  rich_article: [
    { id: 'text', label: 'Article Content', type: 'text', required: true, approvable: false, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'image', label: 'Featured Image', type: 'image', required: false, approvable: false, modelType: 'image_generator', inputFrom: ['text'], outputFormat: 'url' }
  ],
  video_script: [
    { id: 'text', label: 'Script', type: 'text', required: true, approvable: false, modelType: 'text_llm', outputFormat: 'text' }
  ],
  // Stored as {"tweets":[{"text"}]} JSON (see src/lib/thread-text.ts).
  twitter_thread: [
    { id: 'thread_tweets', label: 'Thread', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' }
  ],
  social_media_post: [
    { id: 'caption', label: 'Caption', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'image_prompt', label: 'Image Prompt', type: 'text', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['caption'], outputFormat: 'text' },
    { id: 'image', label: 'Visual', type: 'image', required: true, approvable: true, modelType: 'image_generator', inputFrom: ['image_prompt'], outputFormat: 'url' }
  ],
  instagram_carousel: [
    { id: 'caption', label: 'Post Caption', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', label: 'Slide Content', type: 'text_gallery', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['caption'], outputFormat: 'text_array' },
    { id: 'carousel_slides', label: 'Carousel Slides', type: 'carousel_gallery', required: true, approvable: true, modelType: 'image_generator', inputFrom: ['carousel_content'], outputFormat: 'urls' },
  ],
  instagram_carousel_ai: [
    { id: 'caption', label: 'Post Caption', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'carousel_content', label: 'Slide Content', type: 'text_gallery', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['caption'], outputFormat: 'text_array' },
    { id: 'carousel_slides', label: 'AI Carousel Slides', type: 'carousel_gallery', required: true, approvable: true, modelType: 'image_generator', inputFrom: ['carousel_content'], outputFormat: 'urls' },
  ],
  image_only: [
    { id: 'image', label: 'Generated Image', type: 'image', required: true, approvable: true, modelType: 'image_generator', outputFormat: 'url' },
  ],
  ugc_video: [
    { id: 'script', label: 'Script', type: 'script', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'voice', label: 'Voice Over', type: 'audio', required: true, approvable: true, modelType: 'tts', inputFrom: ['script'], outputFormat: 'url' },
    { id: 'video', label: 'Final Video', type: 'video', required: true, approvable: true, modelType: 'face_swap', inputFrom: ['voice'], outputFormat: 'url' }
  ],
  ugc_heygen: [
    { id: 'script', label: 'Script', type: 'script', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', label: 'Avatar Video', type: 'video', required: true, approvable: true, modelType: 'heygen_video', inputFrom: ['script'], outputFormat: 'url' }
  ],
  ugc_heygen_template: [
    { id: 'variables', label: 'Template Variables', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'video', label: 'Template Video', type: 'video', required: true, approvable: true, modelType: 'heygen_template', inputFrom: ['variables'], outputFormat: 'url' }
  ],
  generative_video_oneshot: [
    { id: 'scene_prompts', label: 'Scene Prompts', type: 'text_gallery', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text_array' },
    { id: 'clips', label: 'Video Clips', type: 'video_gallery', required: true, approvable: true, modelType: 'world_simulator', inputFrom: ['scene_prompts'], outputFormat: 'urls' },
    { id: 'final', label: 'Final Assembly', type: 'video', required: true, approvable: true, modelType: 'assembly', inputFrom: ['clips'], outputFormat: 'url' }
  ],
  storyboard_video_longform: [
    { id: 'outline', label: 'Narrative Outline', type: 'text', required: true, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'full_voiceover', label: 'Voiceover', type: 'audio', required: true, approvable: true, modelType: 'tts', inputFrom: ['outline'], outputFormat: 'url' },
    { id: 'scenes', label: 'Scene Breakdown', type: 'scene_gallery', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['outline', 'full_voiceover'], outputFormat: 'text_array' },
    { id: 'storyboard', label: 'Storyboard Images', type: 'image_gallery', required: true, approvable: true, modelType: 'image_generator', inputFrom: ['scenes'], outputFormat: 'urls' },
    { id: 'final', label: 'Final Video', type: 'video', required: true, approvable: true, modelType: 'assembly', inputFrom: ['storyboard', 'full_voiceover', 'scenes'], outputFormat: 'url' }
  ],
  presenter_video: [
    { id: 'web_capture', label: 'Web Capture', type: 'composite', required: true, approvable: false, modelType: 'assembly', outputFormat: 'urls' },
    { id: 'director', label: 'Shot List', type: 'text', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['web_capture'], outputFormat: 'text' },
    { id: 'voice_avatar', label: 'Voice & Avatar', type: 'audio', required: true, approvable: false, modelType: 'tts', inputFrom: ['director'], outputFormat: 'url' },
    { id: 'composition', label: 'Final Video', type: 'video', required: true, approvable: false, modelType: 'assembly', inputFrom: ['web_capture', 'director', 'voice_avatar'], outputFormat: 'url' },
  ],
  video_remix: [
    { id: 'video_ingest', label: 'Video Import', type: 'composite', required: true, approvable: false, modelType: 'assembly', outputFormat: 'urls' },
    { id: 'transcribe', label: 'Transcription', type: 'composite', required: true, approvable: true, modelType: 'tts', inputFrom: ['video_ingest'], outputFormat: 'text' },
    { id: 'rewrite', label: 'Script Rewrite', type: 'text', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['transcribe'], outputFormat: 'text' },
    { id: 'director', label: 'Shot List', type: 'text', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['video_ingest', 'rewrite', 'transcribe'], outputFormat: 'text' },
    { id: 'voice_avatar', label: 'Voice & Avatar', type: 'audio', required: false, approvable: false, modelType: 'tts', inputFrom: ['rewrite'], outputFormat: 'url' },
    { id: 'composition', label: 'Final Video', type: 'video', required: true, approvable: false, modelType: 'assembly', inputFrom: ['video_ingest', 'director', 'voice_avatar'], outputFormat: 'url' },
  ],
  // Unified video pipeline — stages are dynamic based on VideoConfig.
  // This is a superset placeholder; actual stages are resolved at dispatch time
  // and stored in generation_params.pipeline_stages. The frontend reads from there.
  video: [
    { id: 'web_capture', label: 'Web Capture', type: 'composite', required: false, approvable: false, modelType: 'assembly', outputFormat: 'urls' },
    { id: 'video_ingest', label: 'Video Import', type: 'composite', required: false, approvable: false, modelType: 'assembly', outputFormat: 'urls' },
    { id: 'transcribe', label: 'Transcription', type: 'composite', required: false, approvable: true, modelType: 'tts', inputFrom: ['video_ingest'], outputFormat: 'text' },
    { id: 'outline', label: 'Narration Script', type: 'text', required: false, approvable: true, modelType: 'text_llm', outputFormat: 'text' },
    { id: 'rewrite', label: 'Script Rewrite', type: 'text', required: false, approvable: true, modelType: 'text_llm', inputFrom: ['transcribe'], outputFormat: 'text' },
    { id: 'voiceover', label: 'Voice & Audio', type: 'audio', required: false, approvable: false, modelType: 'tts', inputFrom: ['outline', 'rewrite'], outputFormat: 'url' },
    { id: 'director', label: 'Shot List', type: 'text', required: true, approvable: true, modelType: 'text_llm', inputFrom: ['outline', 'rewrite', 'voiceover'], outputFormat: 'text' },
    { id: 'b_roll', label: 'B-Roll', type: 'composite', required: false, approvable: false, modelType: 'assembly', inputFrom: ['director'], outputFormat: 'urls' },
    { id: 'images', label: 'Scene Images', type: 'image_gallery', required: false, approvable: true, modelType: 'image_generator', inputFrom: ['director'], outputFormat: 'urls' },
    { id: 'composition', label: 'Final Video', type: 'video', required: true, approvable: false, modelType: 'assembly', inputFrom: ['director', 'voiceover', 'images', 'b_roll'], outputFormat: 'url' },
  ],
};

// Helper functions
export function getPipelineStages(pipeline: PipelineId): StageConfig[] {
  return PIPELINE_STAGES[pipeline] || [];
}

export function isMultiStagePipeline(pipeline: PipelineId): boolean {
  const stages = getPipelineStages(pipeline);
  return stages.some(stage => stage.approvable);
}

export function getOptionalStages(pipeline: PipelineId): StageConfig[] {
  return getPipelineStages(pipeline).filter(stage => !stage.required);
}

export function getRequiredStages(pipeline: PipelineId): StageConfig[] {
  return getPipelineStages(pipeline).filter(stage => stage.required);
}
