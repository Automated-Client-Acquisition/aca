import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TriggerAssemblyParams {
  outputId: string;
  stageId?: string; // Which stage to trigger (defaults to 'final')
  jobId?: string; // For scoped cache invalidation
}

export function useTriggerAssembly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId }: TriggerAssemblyParams) => {
      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: outputId,
          stage_id: stageId || 'final',
          user_id: user?.id
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.invalidateQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
        queryClient.invalidateQueries({ queryKey: ['generation-job'] });
      }

      toast.success('Starting final video assembly...');
    },
    onError: (error) => {
      console.error('Assembly trigger error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to start assembly');
    }
  });
}
