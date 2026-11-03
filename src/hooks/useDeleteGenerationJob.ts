import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export function useDeleteGenerationJob() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from('content_generation_jobs')
        .delete()
        .eq('id', id)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-jobs-stats'] });
      toast.success('Job deleted');
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete job: ${error.message}`);
    }
  });
}

export function useBulkDeleteGenerationJobs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error("No organization selected");
      await chunkedMutate(ids, (chunk) =>
        supabase.from('content_generation_jobs').delete().in('id', chunk).eq('organization_id', currentOrganization.id)
      );
      return ids.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-jobs-stats'] });
      toast.success(`${count} job${count > 1 ? 's' : ''} deleted`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete jobs: ${error.message}`);
    }
  });
}
