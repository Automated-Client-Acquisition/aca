import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UpdateOutputTitleParams {
  outputId: string;
  title: string;
  jobId?: string; // For scoped cache invalidation
}

/**
 * Hook to update an output's title
 */
export function useUpdateOutputTitle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, title }: UpdateOutputTitleParams) => {
      // First get current data
      const { data: output, error: fetchError } = await supabase
        .from('content_outputs')
        .select('data')
        .eq('id', outputId)
        .single();

      if (fetchError) throw fetchError;

      // Update data.title
      const currentData = (output.data as any) || {};
      const updatedData = { ...currentData, title };

      const { error } = await supabase
        .from('content_outputs')
        .update({ data: updatedData })
        .eq('id', outputId);

      if (error) throw error;
      return { outputId, title };
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update title: ${error.message}`);
    }
  });
}
