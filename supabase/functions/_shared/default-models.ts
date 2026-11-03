/**
 * Default Model IDs (single source of truth)
 *
 * Every backend file that needs a fallback model MUST import from here.
 * When a model ID changes or is deprecated on OpenRouter, update this
 * one file instead of hunting through 14+ files.
 *
 * Resolution priority (most backend callsites):
 *   1. User-selected model (node.data.model, explicit param)
 *   2. Org-level default (ai_message_config.defaultModel, modelConfig)
 *   3. These constants (ultimate fallback)
 */

// Fast text LLM — used for reply classification, autopilot drafting,
// contact analysis, message generation, and other real-time AI tasks
export const DEFAULT_FAST_TEXT_MODEL = 'x-ai/grok-4.20';

// Cheap text LLM — used for content generation (articles, carousels)
// where cost matters more than latency. Must be registered in ai_models with
// provider='openrouter' or test-payload-builder fails with a non-2xx and
// dispatch hangs at the text stage with "Payload build failed".
// Paid variant on purpose: OpenRouter withdrew the `:free` one (inactive in
// ai_models since 2026-07-20) and rate-limited it before that — every blueprint
// without a text model fell back to it and failed (104 runs in 90 days).
// The export keeps its old name so existing imports don't churn.
export const DEFAULT_FREE_TEXT_MODEL = 'meta-llama/llama-3.3-70b-instruct';

/**
 * Text model for a pipeline stage. Stage definitions carry
 * DEFAULT_FREE_TEXT_MODEL as a placeholder, and the engine used to prefer it
 * over the blueprint's own model, so the Studio's Quality/model choice was
 * ignored on every new-engine text stage (carousels, video scripts, articles):
 * a Sonnet blueprint ran on llama. The blueprint's choice wins over the
 * placeholder; a stage pinned to a specific other model keeps its pin.
 */
export function pickStageTextModel(stageModel?: string | null, blueprintModel?: string | null): string {
  if (stageModel && stageModel !== DEFAULT_FREE_TEXT_MODEL) return stageModel;
  // The execution engine has no Ollama route (OpenRouter and OpenCode only).
  if (blueprintModel && !blueprintModel.startsWith('ollama:')) return blueprintModel;
  return DEFAULT_FREE_TEXT_MODEL;
}

/**
 * Output budget (max_tokens) for an engine text stage. Because the blueprint's
 * model wins (pickStageTextModel), a stage can land on a reasoning model
 * (deepseek-v4.1-flash, qwen3, o-series) that spends max_tokens on thinking
 * before it writes a word: tight caps (600, 1500, 3500) came back empty with
 * finish_reason 'length'. Not unbounded either: OpenRouter reserves credit for
 * max_tokens, and for the model's whole output ceiling when it is omitted.
 * Same value as execute-stage's DEFAULT_TEXT_MAX_TOKENS for legacy stages.
 */
export const DEFAULT_TEXT_STAGE_MAX_TOKENS = 8192;

// ICP scoring — lightweight JSON classification
export const DEFAULT_SCORER_MODEL = 'anthropic/claude-haiku-4.5';

// Initial AI message generation (higher quality)
export const DEFAULT_QUALITY_TEXT_MODEL = 'anthropic/claude-sonnet-4.5';

// Lead-magnet chatbot (comment-to-DM conversations). Campaigns store their own
// ai_chatbot_model; resolve it through chatbotModel() so a campaign saved with a model
// OpenRouter has since withdrawn (e.g. claude-3.5-sonnet, the old default) still answers.
export const DEFAULT_CHATBOT_MODEL = DEFAULT_QUALITY_TEXT_MODEL;
const RETIRED_CHATBOT_MODELS = new Set([
  'anthropic/claude-3-haiku',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-opus-4',
]);
export function chatbotModel(model?: string | null): string {
  if (!model || RETIRED_CHATBOT_MODELS.has(model)) return DEFAULT_CHATBOT_MODEL;
  return model;
}

// Image generation (Nano Banana Pro — Gemini 3.1 Pro Image)
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview';

// Audio / TTS (ElevenLabs)
export const DEFAULT_AUDIO_MODEL = 'eleven_multilingual_v2';

/**
 * Does the AI-carousel image config route through OpenAI (gpt-5.5 native multiturn)
 * rather than OpenRouter/Gemini? Single source of truth shared by the slide-stage
 * dispatcher and dispatch-generation-job's API-key pre-check so the two can never
 * disagree about which provider a given blueprint will actually use.
 *
 * Rule: explicit `provider` wins; otherwise infer from the model slug (OpenRouter
 * slugs are `vendor/model`, OpenAI image models like `gpt-5.5` have no slash).
 * Nothing pinned -> OpenAI, preserving the pipeline's historical GPT-5.5 default.
 */
export function carouselImageProviderIsOpenAI(
  cfg?: { provider?: string | null; modelId?: string | null; model_id?: string | null } | null,
): boolean {
  if (!cfg) return true;
  const provider = cfg.provider || undefined;
  const model = cfg.modelId || cfg.model_id || '';
  if (provider === 'openai') return true;
  if (provider === 'openrouter') return false;
  if (model.includes('/')) return false; // OpenRouter slug (e.g. google/gemini-...)
  return true; // gpt-5.5 / unknown / unset -> OpenAI multiturn
}
