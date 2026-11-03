import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useApiKeys } from "./useApiKeys";

export interface OllamaModel {
  /** Prefixed model string stored everywhere a model is selected, e.g. `ollama:llama3.3:70b` */
  id: string;
  name: string;
  description?: string;
}

/**
 * Lists the org's Ollama server models (live, via the get-ai-models edge
 * function proxy — keeps the server URL/key out of the browser).
 * Only enabled when the org has an `ollama` API key configured.
 */
export function useOllamaModels() {
  const { currentOrganization } = useAuth();
  const { data: apiKeys, isLoading: isLoadingApiKeys } = useApiKeys();
  const hasOllamaKey = apiKeys?.some((k) => k.provider === "ollama") ?? false;

  const query = useQuery({
    queryKey: ["ollama-models", currentOrganization?.id],
    queryFn: async (): Promise<OllamaModel[]> => {
      const { data, error } = await supabase.functions.invoke("get-ai-models", {
        body: { source: "ollama", organization_id: currentOrganization!.id },
      });
      if (error) throw error;
      return (data?.models || []).map((m: { model_id: string; name: string; description?: string }) => ({
        id: m.model_id,
        name: m.name,
        description: m.description,
      }));
    },
    enabled: !!currentOrganization && hasOllamaKey,
    staleTime: 1000 * 60 * 5, // models on the server change rarely; 5 min cache
  });

  return {
    ...query,
    hasOllamaKey,
    isLoadingApiKeys,
  };
}
