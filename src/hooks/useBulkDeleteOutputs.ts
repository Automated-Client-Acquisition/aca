import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedIn } from "@/hooks/crm/useContacts";

interface BulkDeleteParams {
  ids: string[];
  jobId?: string; // For scoped cache invalidation
}

export function useBulkDeleteOutputs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ ids }: BulkDeleteParams) => {
      if (!currentOrganization) throw new Error("No organization selected");
      await chunkedIn(ids, (chunk) =>
        supabase
          .from('content_outputs')
          .delete()
          .in('id', chunk)
          .eq('organization_id', currentOrganization.id)
          .select('id')
      );

      return ids.length;
    },
    onSuccess: (count, variables) => {
      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      }
      toast.success(`${count} output${count !== 1 ? 's' : ''} deleted`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete outputs: ${error.message}`);
    }
  });
}
