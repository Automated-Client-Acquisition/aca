import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ParallelExecutionParams {
  outputId: string;
  stageIds: string[];
  customPrompts?: Record<string, string>;
  jobId?: string; // For scoped cache invalidation
}

export function useParallelStageExecution() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageIds, customPrompts }: ParallelExecutionParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('execute-parallel-stages', {
        body: { 
          output_id: outputId, 
          stage_ids: stageIds,
          custom_prompts: customPrompts,
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

      toast.success(`Executing ${variables.stageIds.length} stages in parallel`);
    },
    onError: (error) => {
      console.error('Parallel execution error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to execute stages in parallel');
    }
  });
}
