import { useQuery } from "@tanstack/react-query";
import { useApiKeys } from "./useApiKeys";

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length?: number;
}

export function useOpenRouterModels() {
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();
  const hasOpenRouterKey = apiKeys?.some((k) => k.provider === "openrouter") ?? false;

  const query = useQuery({
    queryKey: ["openrouter-models"],
    queryFn: async (): Promise<OpenRouterModel[]> => {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) {
        throw new Error("Failed to fetch OpenRouter models");
      }
      const data = await response.json();
      return data.data || [];
    },
    enabled: !!hasOpenRouterKey,
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
  });

  return {
    ...query,
    hasOpenRouterKey,
    isLoadingApiKeys,
  };
}

// Recommended cheap models for bulk operations (sorted by preference)
export const RECOMMENDED_CHEAP_MODELS = [
  'x-ai/grok-4.20',
  'openai/gpt-4o-mini',
  'google/gemini-2.0-flash-001',
  'google/gemini-flash-1.5',
  'anthropic/claude-3-haiku',
  'meta-llama/llama-3.1-8b-instruct',
  // Free Nous Hermes 3 405B via OpenRouter. Last because :free models are
  // rate-limited on OpenRouter and bulk analysis can hit the cap.
  'nousresearch/hermes-3-llama-3.1-405b:free',
];

// Helper to sort models with recommended first, then by price
export function sortModelsForAnalysis(models: OpenRouterModel[]): OpenRouterModel[] {
  return [...models].sort((a, b) => {
    // Recommended models first
    const aRecommended = RECOMMENDED_CHEAP_MODELS.indexOf(a.id);
    const bRecommended = RECOMMENDED_CHEAP_MODELS.indexOf(b.id);

    if (aRecommended !== -1 && bRecommended === -1) return -1;
    if (bRecommended !== -1 && aRecommended === -1) return 1;
    if (aRecommended !== -1 && bRecommended !== -1) return aRecommended - bRecommended;

    // Then sort by price (prompt price)
    const aPrice = parseFloat(a.pricing?.prompt || "999");
    const bPrice = parseFloat(b.pricing?.prompt || "999");
    return aPrice - bPrice;
  });
}
