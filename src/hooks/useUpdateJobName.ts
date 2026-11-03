import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UpdateJobNameParams {
  jobId: string;
  name: string;
}

/**
 * Hook to update a job's name
 */
export function useUpdateJobName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, name }: UpdateJobNameParams) => {
      const { error } = await supabase
        .from('content_generation_jobs')
        .update({ name })
        .eq('id', jobId);

      if (error) throw error;
      return { jobId, name };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-job'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update job name: ${error.message}`);
    }
  });
}
