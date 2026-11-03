import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type ModelType = 'llm' | 'image_generator' | 'tts' | 'world_simulator';

interface UpdateDefaultModelParams {
  modelType: ModelType;
  model: string;
}

export function useUpdateDefaultModels() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ modelType, model }: UpdateDefaultModelParams) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Map modelType to database column
      const columnMap: Record<ModelType, string> = {
        llm: 'default_llm_model',
        image_generator: 'default_image_generator_model',
        tts: 'default_tts_model',
        world_simulator: 'default_world_simulator_model',
      };

      const updateData: any = {
        [columnMap[modelType]]: model,
      };

      const { data, error } = await supabase
        .from('organization_settings')
        .update(updateData)
        .eq('organization_id', orgId)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("No organization settings row to update");
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['organization-settings'] });
      const labels: Record<ModelType, string> = {
        llm: 'LLM',
        image_generator: 'Image Generator',
        tts: 'Text-to-Speech',
        world_simulator: 'Text-to-Video',
      };
      toast.success(`Default ${labels[variables.modelType]} model updated`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update default model');
    },
  });
}
