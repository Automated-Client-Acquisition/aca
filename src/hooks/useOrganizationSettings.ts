import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useOrganizationSettings() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["organization-settings", currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) return null;

      // Use currentOrganization from AuthContext - it already respects impersonation
      // Use maybeSingle() instead of single() to handle organizations without settings yet
      const { data, error } = await supabase
        .from("organization_settings")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!currentOrganization,
  });
}
