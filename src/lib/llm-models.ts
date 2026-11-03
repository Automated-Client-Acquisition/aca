/**
 * Shared LLM model utilities for campaign message generation.
 * Uses OpenRouter API to fetch available models dynamically.
 */

import { useMemo } from "react";
import { useOpenRouterModels, type OpenRouterModel } from "@/hooks/useOpenRouterModels";
import { useOllamaModels } from "@/hooks/useOllamaModels";
import { useAlibabaModels } from "@/hooks/useAlibabaModels";

export const DEFAULT_LLM_TEMPERATURE = 0.7;

/** Default model pre-selected in UI dialogs. Keep in sync with backend default-models.ts */
export const DEFAULT_LLM_MODEL = "x-ai/grok-4.20";

/** Models pinned to the top of the list */
const RECOMMENDED_MESSAGE_MODELS = [
  "anthropic/claude-sonnet-4.5",
  "x-ai/grok-4.20",
  "openai/gpt-4o",
  "google/gemini-2.5-flash-preview",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
  // Free Nous Hermes 3 405B via OpenRouter ($0, 131K ctx). Great for testing;
  // OpenRouter rate-limits :free models, so not ideal for high-volume runs.
  "nousresearch/hermes-3-llama-3.1-405b:free",
];

export interface LLMModelOption {
  id: string;
  name: string;
  description?: string;
  recommended?: boolean;
}

/**
 * Hook that returns available LLM models fetched from OpenRouter, plus the
 * org's Ollama models and Alibaba/DashScope models (ids carry the `ollama:`/
 * `alibaba:` prefix the backend routes on). Filters to text-capable models
 * and pins recommended ones at top.
 */
export function useLLMModels() {
  const { data: models, isLoading, hasOpenRouterKey } = useOpenRouterModels();
  const { data: ollamaModels, hasOllamaKey } = useOllamaModels();
  const { data: alibabaModels, hasAlibabaKey } = useAlibabaModels();

  const options = useMemo((): LLMModelOption[] => {
    // Ollama/Alibaba models listed first so they're easy to spot in flat dropdowns
    const ollamaOptions: LLMModelOption[] = (ollamaModels || []).map((m) => ({
      id: m.id,
      name: `${m.name} (Ollama)`,
      description: m.description,
    }));
    const alibabaOptions: LLMModelOption[] = (alibabaModels || []).map((m) => ({
      id: m.id,
      name: `${m.name} (Alibaba)`,
      description: m.description,
    }));
    const directProviderOptions = [...ollamaOptions, ...alibabaOptions];

    if (!models || models.length === 0) return directProviderOptions;

    // Filter to models that look like text LLMs (exclude image/audio/video models)
    const textModels = models.filter((m) => {
      const id = m.id.toLowerCase();
      return (
        !id.includes("image") &&
        !id.includes("dall-e") &&
        !id.includes("stable-diffusion") &&
        !id.includes("flux") &&
        !id.includes("whisper") &&
        !id.includes("tts") &&
        !id.includes("audio") &&
        !id.includes("video") &&
        !id.includes("moderation") &&
        !id.includes("embedding")
      );
    });

    // Sort: recommended first, then by price
    const sorted = [...textModels].sort((a, b) => {
      const aIdx = RECOMMENDED_MESSAGE_MODELS.indexOf(a.id);
      const bIdx = RECOMMENDED_MESSAGE_MODELS.indexOf(b.id);

      if (aIdx !== -1 && bIdx === -1) return -1;
      if (bIdx !== -1 && aIdx === -1) return 1;
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;

      const aPrice = parseFloat(a.pricing?.prompt || "999");
      const bPrice = parseFloat(b.pricing?.prompt || "999");
      return aPrice - bPrice;
    });

    return [
      ...directProviderOptions,
      ...sorted.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        recommended: RECOMMENDED_MESSAGE_MODELS.includes(m.id),
      })),
    ];
  }, [models, ollamaModels, alibabaModels]);

  return { models: options, isLoading, hasOpenRouterKey, hasOllamaKey, hasAlibabaKey };
}
