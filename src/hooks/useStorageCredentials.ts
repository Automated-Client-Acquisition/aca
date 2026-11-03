import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useStorageCredentials() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    // Use currentOrganization.id which properly handles impersonation
    queryKey: ["storage-credentials", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("storage_credentials")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!currentOrganization,
  });
}
