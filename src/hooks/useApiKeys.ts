import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useApiKeys() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    // Use currentOrganization.id which properly handles impersonation
    queryKey: ["api-keys", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!currentOrganization,
    // Refetch when the user returns to the tab so the nightly
    // validate-openrouter-keys cron's is_valid flip surfaces in the UI
    // instead of users staring at a stale green "Valid" badge.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}
