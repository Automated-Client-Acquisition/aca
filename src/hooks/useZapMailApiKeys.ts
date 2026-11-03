import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { ZapMailApiKey } from "@/types/email";

/**
 * Fetch ZapMail API keys from the shared api_keys table (provider='zapmail').
 * Key management (add/delete) uses the standard useAddApiKey/useDeleteApiKey hooks.
 */
export function useZapMailApiKeys() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["api-keys", "zapmail", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("api_keys")
        .select("id, organization_id, key_hint, is_valid, metadata, created_at, updated_at")
        .eq("organization_id", currentOrganization.id)
        .eq("provider", "zapmail")
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Map api_keys rows to ZapMailApiKey shape
      return (data || []).map((row: any): ZapMailApiKey => ({
        id: row.id,
        organization_id: row.organization_id,
        name: row.metadata?.zapmail_name || row.key_hint || "ZapMail Key",
        key_hint: row.key_hint,
        is_valid: row.is_valid,
        workspace_ids: row.metadata?.workspace_ids || [],
        last_validated_at: null,
        last_sync_at: row.metadata?.last_sync_at || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));
    },
    enabled: !!currentOrganization,
  });
}

export function useListWorkspaces() {
  return useMutation({
    mutationFn: async (input: { key_id: string }) => {
      const response = await supabase.functions.invoke("zapmail-connect", {
        body: {
          action: "list_workspaces",
          key_id: input.key_id,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Failed to list workspaces");
      }
      if (!response.data.success) {
        throw new Error(response.data.error || "Failed to list workspaces");
      }

      return response.data.workspaces as Array<{
        id: string;
        name: string;
        domainCount: string;
        mailboxCount: string;
      }>;
    },
    onError: (error: Error) => {
      toast.error(`Failed to list workspaces: ${error.message}`);
    },
  });
}

export function useImportFromStoredKey() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      key_id: string;
      workspace_id?: string;
      workspace_name?: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const response = await supabase.functions.invoke("zapmail-connect", {
        body: {
          key_id: input.key_id,
          organization_id: currentOrganization.id,
          workspace_id: input.workspace_id,
          workspace_name: input.workspace_name,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Import failed");
      }

      return response.data as {
        imported: number;
        updated: number;
        skipped: number;
        mailboxes: Array<{ email: string; status: string }>;
        errors: string[];
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["email-mailboxes", currentOrganization?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["email-mailbox-stats", currentOrganization?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["api-keys"],
      });
      if (data.imported > 0) {
        toast.success(
          `${data.imported} mailbox${data.imported !== 1 ? "es" : ""} imported`
        );
      } else {
        toast.info("No new mailboxes to import");
      }
    },
    onError: (error: Error) => {
      toast.error(`Import failed: ${error.message}`);
    },
  });
}
