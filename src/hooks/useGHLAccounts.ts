import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GHLAccount {
  id: string;
  type: string; // facebook, instagram, linkedin, twitter, etc.
  name: string;
  username?: string;
  profileImage?: string;
  isActive: boolean;
}

export interface GHLAccountsResponse {
  success: boolean;
  accounts: GHLAccount[];
  locationId?: string;
  ghlUserId?: string;
  needsOAuth?: boolean;
  needsReconnect?: boolean;
  error?: string;
}

export function useGHLAccounts() {
  const { user, currentOrganization } = useAuth();

  return useQuery<GHLAccountsResponse>({
    queryKey: ['ghl-accounts', currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) return { success: false, accounts: [] };

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Fetch connected accounts from GHL
      const { data, error } = await supabase.functions.invoke('fetch-ghl-accounts', {
        body: { organizationId: orgId },
      });

      if (error) throw error;
      
      // Handle OAuth not connected gracefully
      if (data && !data.success && data.needsOAuth) {
        return { success: false, accounts: [], needsOAuth: true, error: data.error };
      }
      
      if (data && !data.success && data.needsReconnect) {
        return { success: false, accounts: [], needsReconnect: true, error: data.error };
      }
      
      return data as GHLAccountsResponse;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
}
