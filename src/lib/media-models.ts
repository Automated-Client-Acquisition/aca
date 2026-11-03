/**
 * Shared image and video model constants for the video editor chat.
 * Used by ChatPanel for model selection and passed to editor-chat edge function.
 */

export interface MediaModel {
  id: string;
  name: string;
  provider: 'openrouter' | 'replicate';
  recommended?: boolean;
}

export const IMAGE_MODELS: MediaModel[] = [
  { id: 'openai/gpt-5-image', name: 'GPT-5 Image (best text rendering)', provider: 'openrouter', recommended: true },
  { id: 'google/gemini-3-pro-image-preview', name: 'Nano Banana Pro (Gemini 3 Pro Image)', provider: 'openrouter', recommended: true },
  { id: 'google/gemini-3.1-flash-image-preview', name: 'Nano Banana 2 (Gemini 3.1 Flash Image)', provider: 'openrouter' },
  { id: 'google/gemini-2.5-flash-image', name: 'Nano Banana (Gemini 2.5 Flash Image)', provider: 'openrouter' },
  { id: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', provider: 'openrouter' },
  { id: 'openai/gpt-5-image-mini', name: 'GPT-5 Image Mini', provider: 'openrouter' },
  { id: 'bytedance-seed/seedream-4.5', name: 'Seedream 4.5', provider: 'openrouter' },
  { id: 'black-forest-labs/flux-schnell', name: 'FLUX Schnell', provider: 'replicate' },
];

export const VIDEO_MODELS: MediaModel[] = [
  { id: 'google/veo-3.1-fast', name: 'Veo 3.1 Fast', provider: 'replicate', recommended: true },
  { id: 'google/veo-3.1', name: 'Veo 3.1', provider: 'replicate' },
];

export const LLM_MODELS: MediaModel[] = [
  { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', provider: 'openrouter', recommended: true },
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'openrouter' },
  { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', provider: 'openrouter' },
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openrouter' },
  { id: 'google/gemini-2.5-flash-preview', name: 'Gemini 2.5 Flash', provider: 'openrouter' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openrouter' },
  { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', provider: 'openrouter' },
];

export const DEFAULT_LLM_MODEL = 'anthropic/claude-opus-4.6';
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';
export const DEFAULT_VIDEO_MODEL = 'google/veo-3.1-fast';
