import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Fetch a single email mailbox by ID (for display in inbox).
 */
export function useEmailMailbox(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-mailbox", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id || !currentOrganization) return null;

      const { data, error } = await supabase
        .from("email_mailboxes")
        .select("id, email_address, display_name, status, provider")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!id && !!currentOrganization,
  });
}
