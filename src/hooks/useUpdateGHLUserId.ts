import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export function useUpdateGHLUserId() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (userId: string) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { error } = await supabase
        .from('ghl_oauth_tokens')
        .update({ ghl_user_id: userId })
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ghl-accounts', currentOrganization?.id] });
      toast.success('GHL User ID saved successfully');
    },
    onError: (error) => {
      console.error('Failed to save GHL User ID:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save User ID');
    },
  });
}
