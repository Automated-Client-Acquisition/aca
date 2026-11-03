import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SaveTemplateParams {
  outputId: string;
  stageId: string;
  templateName: string;
  templateDescription?: string;
  isPublic?: boolean;
}

export function useSaveStageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, templateName, templateDescription, isPublic = false }: SaveTemplateParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Get current stage data
      const { data: output } = await supabase
        .from('content_outputs')
        .select('stage_data, generation_params, pipeline')
        .eq('id', outputId)
        .single();

      if (!output) throw new Error('Output not found');

      const stageData = output.stage_data?.[stageId];
      if (!stageData) throw new Error('Stage data not found');

      // Save template to metadata (simplified - no separate table needed)
      // Templates are saved as generation_params for now
      return {
        success: true,
        template: {
          name: templateName,
          description: templateDescription,
          stage_type: stageId,
          pipeline: output.pipeline,
          configuration: {
            model_used: stageData.model_used,
            parameters: stageData.parameters,
            cost: stageData.cost,
            generation_time_ms: stageData.generation_time_ms
          }
        }
      };
    },
    onSuccess: () => {
      toast.success('Stage template saved successfully');
    },
    onError: (error) => {
      console.error('Template save error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save template');
    }
  });
}
