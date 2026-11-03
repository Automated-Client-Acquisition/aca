import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface BulkUpdateParams {
  ids: string[];
  status?: 'generating' | 'review' | 'approved' | 'rejected';
  data?: any;
  jobId?: string; // For scoped cache invalidation
}

export function useBulkUpdateOutputs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, status, data }: BulkUpdateParams) => {
      const updates: any = {};
      if (data !== undefined) updates.data = data;
      if (status !== undefined) updates.status = status;

      const { error } = await supabase
        .from('content_outputs')
        .update(updates)
        .in('id', ids);

      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      if (variables.status) {
        toast.success(`${count} output${count !== 1 ? 's' : ''} ${variables.status === 'approved' ? 'approved' : variables.status === 'rejected' ? 'rejected' : 'updated'}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to update outputs: ${error.message}`);
    }
  });
}
