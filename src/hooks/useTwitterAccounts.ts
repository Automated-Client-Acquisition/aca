import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TwitterAccount {
  id: string;
  name: string;
  twitter_handle: string | null;
  twitter_user_id: string | null;
  profile_image_url: string | null;
  is_active: boolean;
  is_valid: boolean;
  last_tested_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export function useTwitterAccounts() {
  const { currentOrganization } = useAuth();

  return useQuery<TwitterAccount[]>({
    queryKey: ["twitter-accounts", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("twitter_accounts")
        .select("id, name, twitter_handle, twitter_user_id, profile_image_url, is_active, is_valid, last_tested_at, error_message, created_at, updated_at")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching Twitter accounts:", error);
        return [];
      }

      return data || [];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDeleteTwitterAccount() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase
        .from("twitter_accounts")
        .delete()
        .eq("id", accountId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["twitter-accounts", currentOrganization?.id] });
    },
  });
}
