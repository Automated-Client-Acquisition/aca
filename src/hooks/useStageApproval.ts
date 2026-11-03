import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface StageApprovalParams {
  outputId: string;
  stageId: string;
  action: 'approve' | 'regenerate';
  notes?: string;
  jobId?: string; // For scoped cache invalidation
}

export function useStageApproval() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, action, notes }: StageApprovalParams) => {
      const { data: { user } } = await supabase.auth.getUser();
      
      const { data, error } = await supabase.functions.invoke('approve-stage', {
        body: { 
          output_id: outputId, 
          stage_id: stageId, 
          action,
          notes,
          user_id: user?.id
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate relevant queries to refresh UI - scoped to jobId if available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.invalidateQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        // Fallback to broad invalidation for backwards compatibility
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
        queryClient.invalidateQueries({ queryKey: ['generation-job'] });
      }

      // Show appropriate toast based on action
      if (variables.action === 'approve') {
        if (data.next_stage) {
          toast.success(`Stage approved. Executing next stage: ${data.next_stage}`);
        } else {
          toast.success('All stages completed! Content ready for final review.');
        }
      } else if (variables.action === 'regenerate') {
        toast.info('Regenerating stage. This may take a moment...');
      }
    },
    onError: (error) => {
      console.error('Stage approval error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process stage action');
    }
  });
}
