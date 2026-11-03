import { useQuery } from "@tanstack/react-query";
import { useApiKeys } from "./useApiKeys";

export interface AlibabaModel {
  /** Prefixed model string stored everywhere a model is selected, e.g. `alibaba:qwen-max` */
  id: string;
  name: string;
  description?: string;
}

/**
 * Alibaba Cloud DashScope's catalog is small and slow-changing, and (unlike
 * OpenRouter) has no public unauthenticated models-list endpoint — so this is
 * a curated static list rather than a live fetch. Update by hand as new Qwen
 * models ship (same maintenance pattern as RECOMMENDED_CHEAP_MODELS in
 * src/lib/llm-models.ts).
 */
const ALIBABA_MODELS: AlibabaModel[] = [
  { id: "alibaba:qwen-max", name: "Qwen Max", description: "Alibaba's flagship reasoning model" },
  { id: "alibaba:qwen-plus", name: "Qwen Plus", description: "Balanced cost/performance" },
  { id: "alibaba:qwen-flash", name: "Qwen Flash", description: "Fast, cheapest tier" },
  { id: "alibaba:qwen-turbo", name: "Qwen Turbo", description: "Low-latency, low-cost" },
  { id: "alibaba:qwen-vl-max", name: "Qwen VL Max", description: "Vision-language, flagship" },
  { id: "alibaba:qwen-vl-plus", name: "Qwen VL Plus", description: "Vision-language, balanced" },
  { id: "alibaba:qwen3-coder-plus", name: "Qwen3 Coder Plus", description: "Code-specialized" },
];

/**
 * Static Alibaba/DashScope model catalog, gated on the org having an
 * `alibaba` API key configured. No network call — mirrors useOllamaModels'
 * return shape so it drops into the same merge points (LlmModelSelect,
 * useLLMModels, ModelSelector, ModelSettings).
 */
export function useAlibabaModels() {
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();
  const hasAlibabaKey = apiKeys?.some((k) => k.provider === "alibaba") ?? false;

  const query = useQuery({
    queryKey: ["alibaba-models"],
    queryFn: async (): Promise<AlibabaModel[]> => ALIBABA_MODELS,
    enabled: hasAlibabaKey,
    staleTime: Infinity,
  });

  return {
    ...query,
    hasAlibabaKey,
    isLoadingApiKeys,
  };
}
