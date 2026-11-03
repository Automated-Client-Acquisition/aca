import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RollbackStageParams {
  outputId: string;
  stageId: string;
  versionId: string;
  resetDownstream?: boolean;
  jobId?: string; // For scoped cache invalidation
}

export function useRollbackStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, versionId, resetDownstream = true }: RollbackStageParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('rollback-stage', {
        body: { 
          output_id: outputId, 
          stage_id: stageId,
          version_id: versionId,
          reset_downstream: resetDownstream,
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
      queryClient.invalidateQueries({ queryKey: ['stage-history', variables.outputId, variables.stageId] });

      toast.success('Stage rolled back successfully');
    },
    onError: (error) => {
      console.error('Stage rollback error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to rollback stage');
    }
  });
}
