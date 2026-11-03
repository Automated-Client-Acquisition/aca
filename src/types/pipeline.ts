import { FileText, Image, Video, Film, FileCode, LayoutGrid, MonitorPlay, Shuffle, Clapperboard } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PipelineId =
  | 'rich_article'
  | 'social_media_post'
  | 'instagram_carousel'
  | 'instagram_carousel_ai'
  | 'image_only'
  | 'ugc_video'
  | 'generative_video_oneshot'
  | 'video_script'
  | 'storyboard_video_longform'
  | 'presenter_video'
  | 'video_remix'
  | 'video'
  | '3d_product_video'
  | 'twitter_thread';

export type ModelType =
  | 'text_llm'
  | 'image_generator'
  | 'tts'
  | 'face_swap'
  | 'world_simulator'
  | 'video_generator'
  | 'character_image_generator'
  | 'lip_sync'
  | 'assembly'
;

export type PipelineStatus = 'available' | 'coming_soon';

export interface Pipeline {
  id: PipelineId;
  name: string;
  description: string;
  icon: LucideIcon;
  requiredModels: ModelType[];
  optionalModels?: ModelType[];
  status?: PipelineStatus;
  /** Hidden pipelines are kept for existing jobs/blueprints but not shown in new blueprint creation */
  hidden?: boolean;
}

export const PIPELINES: Pipeline[] = [
  {
    id: 'rich_article',
    name: 'Rich Article',
    description: 'Blogs, Newsletters, X Threads - Long-form text with optional images',
    icon: FileText,
    requiredModels: ['text_llm'],
    optionalModels: ['image_generator'],
  },
  {
    id: 'social_media_post',
    name: 'Social Media Post',
    description: 'Instagram, LinkedIn, X - Visual package with caption and hashtags',
    icon: Image,
    requiredModels: ['image_generator', 'text_llm'],
  },
  {
    id: 'image_only',
    name: 'Image Only',
    description: 'Generate images directly from a prompt template - No text generation, just visual output',
    icon: Image,
    requiredModels: ['image_generator'],
  },
  {
    id: 'video',
    name: 'Video',
    description: 'AI-powered video from any source — URLs, uploaded videos, images, or text. Supports remix, translation, avatars, AI images, and B-roll',
    icon: Clapperboard,
    requiredModels: ['text_llm', 'tts'],
    optionalModels: ['image_generator'],
    hidden: true,
  },
  {
    id: 'instagram_carousel',
    name: 'Instagram Carousel (Branded Templates)',
    description: 'Multi-slide carousel rendered from your branded templates - colors, fonts, and layout from your brand voice. Fast and on-brand.',
    icon: LayoutGrid,
    requiredModels: ['text_llm'],
  },
  {
    id: 'instagram_carousel_ai',
    name: 'Instagram Carousel (AI Images)',
    description: 'Multi-slide carousel where each slide is an AI-generated image. Choose your image model: GPT-5.5 (native multiturn) or Gemini / Nano Banana (cheaper, reference-threaded) — both keep characters and style consistent across the whole deck.',
    icon: LayoutGrid,
    requiredModels: ['text_llm', 'image_generator'],
  },
  {
    id: 'twitter_thread',
    name: 'X / Twitter Thread',
    description: 'Generate a multi-tweet thread for X — AI writes each tweet and they are chained automatically',
    icon: FileText,
    requiredModels: ['text_llm'],
  },
  // ── Legacy pipelines (hidden from new creation, kept for existing jobs) ──
  {
    id: 'generative_video_oneshot',
    name: 'Generative Video: One-Shot',
    description: 'High-end World Simulation (Sora 2 / Veo) - Video, audio, physics in one pass',
    icon: Video,
    requiredModels: ['text_llm', 'world_simulator'],
    hidden: true,
  },
  {
    id: 'video_script',
    name: 'Video Script',
    description: 'Pre-Production - Formatted text for human production teams',
    icon: FileCode,
    requiredModels: ['text_llm'],
    hidden: true,
  },
  {
    id: 'presenter_video',
    name: 'Presenter Video',
    description: 'Replaced by Video pipeline — AI avatar narrates over web content',
    icon: MonitorPlay,
    requiredModels: ['text_llm', 'tts'],
    hidden: true,
  },
  {
    id: 'storyboard_video_longform',
    name: 'Long-Form Storyboard Video',
    description: 'Replaced by Video pipeline — Extended videos with animated scenes and narration',
    icon: Film,
    requiredModels: ['text_llm', 'image_generator', 'tts'],
    hidden: true,
  },
  {
    id: 'video_remix',
    name: 'Video Remix',
    description: 'Replaced by Video pipeline — Import and remix videos with AI',
    icon: Shuffle,
    requiredModels: ['text_llm', 'tts'],
    hidden: true,
  },
];

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  text_llm: 'Text LLM',
  image_generator: 'Image Generator',
  tts: 'Text-to-Speech',
  face_swap: 'Face Swap',
  world_simulator: 'World Simulator',
  video_generator: 'Video Generator',
  character_image_generator: 'Character Image Generator',
  lip_sync: 'Lip Sync',
  assembly: 'Video Assembly',
};
