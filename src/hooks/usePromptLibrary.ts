import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import type { Database, Json } from "@/integrations/supabase/types";
import type { PipelineId } from "@/types/pipeline";

export type PromptTemplate = Database["public"]["Tables"]["prompt_library"]["Row"];
export type PromptTemplateInsert = Database["public"]["Tables"]["prompt_library"]["Insert"];
export type PromptTemplateUpdate = Database["public"]["Tables"]["prompt_library"]["Update"];

export type PromptType = 'text' | 'image';

interface UsePromptLibraryOptions {
  promptType?: PromptType | null;
  pipelineType?: PipelineId | null;
  scenario?: string | null;
  includePresets?: boolean;
}

export function usePromptLibrary(options: UsePromptLibraryOptions = {}) {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();
  const { promptType, pipelineType, scenario, includePresets = true } = options;

  const { data: prompts, isLoading, error } = useQuery({
    queryKey: ["prompt-library", currentOrganization?.id, promptType, pipelineType, scenario, includePresets],
    queryFn: async () => {
      if (!currentOrganization) return [];

      let query = supabase
        .from("prompt_library")
        .select("*");

      // Filter by prompt type if provided
      if (promptType) {
        query = query.eq("prompt_type", promptType);
      }

      // Apply pipeline filter if provided
      if (pipelineType) {
        query = query.eq("pipeline_type", pipelineType);
      }

      // Apply scenario filter if provided
      if (scenario) {
        query = query.eq("scenario", scenario);
      }

      // Include org-specific, public, and optionally preset prompts
      if (includePresets) {
        query = query.or(`is_public.eq.true,is_preset.eq.true,organization_id.eq.${currentOrganization.id}`);
      } else {
        query = query.or(`is_public.eq.true,organization_id.eq.${currentOrganization.id}`);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data as PromptTemplate[];
    },
    enabled: !!currentOrganization,
  });

  const createPrompt = useMutation({
    mutationFn: async (newPrompt: Omit<PromptTemplateInsert, "organization_id">) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("prompt_library")
        .insert([{
          ...newPrompt,
          organization_id: currentOrganization.id,
          created_by: user.id,
          is_public: false,
          is_preset: false,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      toast.success("Prompt template created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create prompt: ${error.message}`);
    },
  });

  const updatePrompt = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: PromptTemplateUpdate }) => {
      const { data, error } = await supabase
        .from("prompt_library")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      toast.success("Prompt template updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update prompt: ${error.message}`);
    },
  });

  const deletePrompt = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("prompt_library")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      toast.success("Prompt template deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete prompt: ${error.message}`);
    },
  });

  const deleteBulkPrompts = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("prompt_library").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      toast.success(`Successfully deleted ${ids.length} prompt${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete prompts: ${error.message}`);
    },
  });

  const duplicatePrompt = useMutation({
    mutationFn: async (prompt: PromptTemplate) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("prompt_library")
        .insert([{
          name: `${prompt.name} (Copy)`,
          description: prompt.description,
          prompt_content: prompt.prompt_content,
          prompt_type: prompt.prompt_type,
          category: prompt.category,
          pipeline_type: prompt.pipeline_type,
          scenario: prompt.scenario,
          content_types: prompt.content_types,
          goals: prompt.goals,
          variables: prompt.variables,
          organization_id: currentOrganization.id,
          created_by: user.id,
          is_public: false,
          is_preset: false,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      toast.success("Prompt template duplicated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to duplicate prompt: ${error.message}`);
    },
  });

  return {
    prompts: prompts || [],
    isLoading,
    error,
    createPrompt: (data: Omit<PromptTemplateInsert, "organization_id">) => createPrompt.mutateAsync(data),
    updatePrompt: (id: string, updates: PromptTemplateUpdate) =>
      updatePrompt.mutate({ id, updates }),
    deletePrompt: (id: string) => deletePrompt.mutate(id),
    deleteBulkPrompts: (ids: string[]) => deleteBulkPrompts.mutate(ids),
    duplicatePrompt: (prompt: PromptTemplate) => duplicatePrompt.mutate(prompt),
    isCreating: createPrompt.isPending,
    isUpdating: updatePrompt.isPending,
    isDeleting: deletePrompt.isPending,
    isDeletingBulk: deleteBulkPrompts.isPending,
    isDuplicating: duplicatePrompt.isPending,
  };
}

/**
 * Get unique scenarios for filtering
 */
export function usePromptScenarios(pipelineType?: PipelineId | null, promptType?: PromptType | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["prompt-scenarios", currentOrganization?.id, pipelineType, promptType],
    queryFn: async () => {
      if (!currentOrganization) return [];

      let query = supabase
        .from("prompt_library")
        .select("scenario")
        .or(`is_public.eq.true,is_preset.eq.true,organization_id.eq.${currentOrganization.id}`)
        .not("scenario", "is", null);

      if (promptType) {
        query = query.eq("prompt_type", promptType);
      }

      if (pipelineType) {
        query = query.eq("pipeline_type", pipelineType);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Extract unique scenarios
      const scenarios = [...new Set(data?.map(d => d.scenario).filter(Boolean))] as string[];
      return scenarios;
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Get unique categories for filtering
 */
export function usePromptCategories() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["prompt-categories", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("prompt_library")
        .select("category")
        .or(`is_public.eq.true,is_preset.eq.true,organization_id.eq.${currentOrganization.id}`)
        .not("category", "is", null);

      if (error) throw error;

      // Extract unique categories
      const categories = [...new Set(data?.map(d => d.category).filter(Boolean))] as string[];
      return categories;
    },
    enabled: !!currentOrganization,
  });
}

export type BlueprintUsage = {
  id: string;
  name: string;
  pipeline: string | null;
  usageType: 'master_prompt' | 'image_prompt';
};

/**
 * Get blueprints that use a specific prompt template
 */
export function useBlueprintsUsingPrompt(promptId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["blueprints-using-prompt", currentOrganization?.id, promptId],
    queryFn: async (): Promise<BlueprintUsage[]> => {
      if (!promptId || !currentOrganization) return [];

      // Query blueprints that reference this prompt as master_prompt or image_prompt
      const { data, error } = await supabase
        .from("blueprints")
        .select("id, name, pipeline, master_prompt_template_id, image_prompt_template_id")
        .eq("organization_id", currentOrganization.id)
        .or(`master_prompt_template_id.eq.${promptId},image_prompt_template_id.eq.${promptId}`);

      if (error) throw error;

      // Map to usage objects with type information
      const usages: BlueprintUsage[] = [];
      for (const bp of data || []) {
        if (bp.master_prompt_template_id === promptId) {
          usages.push({
            id: bp.id,
            name: bp.name,
            pipeline: bp.pipeline,
            usageType: 'master_prompt',
          });
        }
        if (bp.image_prompt_template_id === promptId) {
          usages.push({
            id: bp.id,
            name: bp.name,
            pipeline: bp.pipeline,
            usageType: 'image_prompt',
          });
        }
      }

      return usages;
    },
    enabled: !!promptId && !!currentOrganization,
  });
}
