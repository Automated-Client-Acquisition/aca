import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";
import type { PipelineId } from "@/types/pipeline";

type PromptTemplate = Database["public"]["Tables"]["prompt_library"]["Row"];

export type PromptType = 'text' | 'image' | 'director';

interface UsePromptTemplatesOptions {
  promptType?: PromptType;
  pipelineType?: PipelineId | null;
  scenario?: string | null;
}

export function usePromptTemplates(
  promptTypeOrOptions: PromptType | UsePromptTemplatesOptions = 'text'
) {
  // Handle both old signature (just promptType) and new options object
  const options: UsePromptTemplatesOptions = typeof promptTypeOrOptions === 'string'
    ? { promptType: promptTypeOrOptions }
    : promptTypeOrOptions;

  const { promptType = 'text', pipelineType, scenario } = options;
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["prompt-templates", promptType, pipelineType, scenario, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      let query = supabase
        .from("prompt_library")
        .select("*")
        .eq("prompt_type", promptType)
        .or(`is_public.eq.true,is_preset.eq.true,organization_id.eq.${currentOrganization.id}`);

      // Apply pipeline filter if provided
      if (pipelineType) {
        query = query.eq("pipeline_type", pipelineType);
      }

      // Apply scenario filter if provided
      if (scenario) {
        query = query.eq("scenario", scenario);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data as PromptTemplate[];
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Get unique scenarios for a given pipeline type
 */
export function usePromptScenarios(pipelineType: PipelineId | null, promptType: PromptType = 'text') {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["prompt-scenarios", pipelineType, promptType, currentOrganization?.id],
    queryFn: async () => {
      if (!pipelineType || !currentOrganization) return [];

      const { data, error } = await supabase
        .from("prompt_library")
        .select("scenario")
        .eq("prompt_type", promptType)
        .eq("pipeline_type", pipelineType)
        .or(`is_public.eq.true,is_preset.eq.true,organization_id.eq.${currentOrganization.id}`)
        .not("scenario", "is", null);

      if (error) throw error;

      // Extract unique scenarios
      const scenarios = [...new Set(data?.map(d => d.scenario).filter(Boolean))] as string[];
      return scenarios;
    },
    enabled: !!pipelineType && !!currentOrganization,
  });
}
