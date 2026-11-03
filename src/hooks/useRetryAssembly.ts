import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface RetryAssemblyParams {
  outputId: string;
  stageId?: string; // Which stage to retry (defaults to 'final')
  jobId?: string; // For scoped cache invalidation
}

export const useRetryAssembly = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId }: RetryAssemblyParams) => {
      const { data, error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: outputId,
          stage_id: stageId || 'final'
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async (_, variables) => {
      toast.success('Assembly restarted');

      // Refetch queries to update UI - scoped if jobId available
      if (variables.jobId) {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['content-outputs', variables.jobId] }),
          queryClient.refetchQueries({ queryKey: ['generation-job', variables.jobId] })
        ]);
      } else {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ['content-outputs'] }),
          queryClient.refetchQueries({ queryKey: ['generation-job'] })
        ]);
      }
    },
    onError: (error: Error) => {
      console.error('Failed to retry assembly:', error);
      toast.error(`Failed to retry assembly: ${error.message}`);
    }
  });
};
