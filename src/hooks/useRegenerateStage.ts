import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RegenerateStageParams {
  outputId: string;
  stageId: string;
  preserveDownstream?: boolean;
  customPrompt?: string;
  jobId?: string; // For scoped cache invalidation
}

export function useRegenerateStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, preserveDownstream = false, customPrompt }: RegenerateStageParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Call approve-stage with regenerate action
      const { data, error } = await supabase.functions.invoke('approve-stage', {
        body: { 
          output_id: outputId, 
          stage_id: stageId, 
          action: 'regenerate',
          preserve_downstream: preserveDownstream,
          custom_prompt: customPrompt,
          user_id: user?.id
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.invalidateQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
        queryClient.invalidateQueries({ queryKey: ['generation-job'] });
      }

      if (variables.preserveDownstream) {
        toast.info('Regenerating stage while preserving downstream stages...');
      } else {
        toast.info('Regenerating stage. Downstream stages will need re-approval.');
      }
    },
    onError: (error) => {
      console.error('Stage regeneration error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to regenerate stage');
    }
  });
}
