import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type InboxVisibilityMode = "all" | "assigned_only" | "own_accounts_only";

/**
 * Read the organization's inbox visibility mode.
 * - 'all': everyone sees all conversations (default)
 * - 'assigned_only': members see only conversations assigned to them + unassigned
 * - 'own_accounts_only': members see conversations from their owned accounts + assigned + unassigned
 * Admins/owners always bypass visibility restrictions.
 */
export function useInboxVisibilityMode() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["inbox-visibility-mode", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return "all" as InboxVisibilityMode;

      const { data, error } = await supabase
        .from("organizations")
        .select("inbox_visibility_mode")
        .eq("id", currentOrganization.id)
        .single();

      if (error) throw error;
      return (data?.inbox_visibility_mode || "all") as InboxVisibilityMode;
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Update the organization's inbox visibility mode. Admin/owner only.
 */
export function useUpdateInboxVisibilityMode() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (mode: InboxVisibilityMode) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("organizations")
        .update({ inbox_visibility_mode: mode } as any)
        .eq("id", currentOrganization.id)
        .select("inbox_visibility_mode")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-visibility-mode", currentOrganization?.id] });
      // Conversations may now be filtered differently via RLS
      queryClient.invalidateQueries({ queryKey: ["crm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["crm-conversations-infinite"] });
      queryClient.invalidateQueries({ queryKey: ["crm-unread-count"] });
      toast.success("Inbox visibility mode updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update visibility mode: ${error.message}`);
    },
  });
}
