import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useSetActiveStorage() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (credentialId: string) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Deactivate all credentials for this organization
      const { error: deactivateError } = await supabase
        .from('storage_credentials')
        .update({ is_active: false })
        .eq('organization_id', orgId);

      if (deactivateError) throw deactivateError;

      // Activate the selected credential
      const { data, error } = await supabase
        .from('storage_credentials')
        .update({ is_active: true })
        .eq('id', credentialId)
        .eq('organization_id', orgId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['storage-credentials'] });
      toast.success('Storage set as active');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to set active storage');
    },
  });
}
