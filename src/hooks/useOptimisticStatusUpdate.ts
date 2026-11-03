import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export function useOptimisticStatusUpdate(jobId: string | null) {
  const queryClient = useQueryClient();

  const updateOptimistic = useCallback((
    outputId: string, 
    newStatus: 'review' | 'approved' | 'rejected'
  ) => {
    if (!jobId) return;

    // Optimistically update the output in cache
    queryClient.setQueryData(
      ['content-outputs', jobId],
      (old: any[] | undefined) => {
        if (!old) return old;
        return old.map(output => 
          output.id === outputId 
            ? { ...output, status: newStatus }
            : output
        );
      }
    );
  }, [jobId, queryClient]);

  const revertOptimistic = useCallback(() => {
    if (!jobId) return;
    // Invalidate to fetch fresh data if optimistic update fails
    queryClient.invalidateQueries({ queryKey: ['content-outputs', jobId] });
  }, [jobId, queryClient]);

  return {
    updateOptimistic,
    revertOptimistic
  };
}
