import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface DeleteOutputParams {
  id: string;
  jobId?: string; // For scoped cache invalidation
}

export function useDeleteContentOutput() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id }: DeleteOutputParams) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from('content_outputs')
        .delete()
        .eq('id', id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      toast.success('Output deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete output: ${error.message}`);
    }
  });
}
