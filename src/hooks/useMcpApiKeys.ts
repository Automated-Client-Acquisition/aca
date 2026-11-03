import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface McpApiKey {
  id: string;
  organization_id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  permissions: string[];
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  target_organization_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Generate a new API key
 * Format: cf_live_<64 hex chars> or cf_test_<64 hex chars>
 */
export function generateApiKey(isTest = false): string {
  const prefix = isTest ? "cf_test_" : "cf_live_";
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const key = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${key}`;
}

/**
 * Hash an API key using SHA-256 (same as server-side)
 */
export async function hashApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useMcpApiKeys() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["mcp-api-keys", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("api_access_keys")
        .select(`
          id,
          organization_id,
          user_id,
          name,
          key_prefix,
          permissions,
          is_active,
          expires_at,
          last_used_at,
          target_organization_id,
          created_at,
          updated_at
        `)
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as McpApiKey[];
    },
    enabled: !!user && !!currentOrganization,
  });

  const createKey = useMutation({
    mutationFn: async ({
      name,
      permissions = ["admin:*"],
      expiresAt,
      targetOrganizationId,
    }: {
      name: string;
      permissions?: string[];
      expiresAt?: Date | null;
      targetOrganizationId?: string | null;
    }) => {
      if (!user || !currentOrganization) {
        throw new Error("Not authenticated");
      }

      // Generate the full key
      const fullKey = generateApiKey();
      const keyHash = await hashApiKey(fullKey);
      const keyPrefix = fullKey.substring(0, 20) + "..."; // e.g., "cf_live_abcdef123456..."

      // Insert key record
      const { data, error } = await supabase
        .from("api_access_keys")
        .insert({
          organization_id: currentOrganization.id,
          user_id: user.id,
          name,
          key_hash: keyHash,
          key_prefix: keyPrefix,
          permissions,
          is_active: true,
          expires_at: expiresAt?.toISOString() || null,
          target_organization_id: targetOrganizationId || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Return both the record and the full key (only shown once)
      return { key: data, fullKey };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-api-keys", currentOrganization?.id] });
      toast.success("API key created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create API key: ${error.message}`);
    },
  });

  const revokeKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase
        .from("api_access_keys")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", keyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-api-keys", currentOrganization?.id] });
      toast.success("API key revoked");
    },
    onError: (error) => {
      toast.error(`Failed to revoke API key: ${error.message}`);
    },
  });

  const deleteKey = useMutation({
    mutationFn: async (keyId: string) => {
      const { error } = await supabase
        .from("api_access_keys")
        .delete()
        .eq("id", keyId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp-api-keys", currentOrganization?.id] });
      toast.success("API key deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete API key: ${error.message}`);
    },
  });

  return {
    keys: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
    createKey: createKey.mutateAsync,
    revokeKey: revokeKey.mutate,
    deleteKey: deleteKey.mutate,
    isCreating: createKey.isPending,
    isRevoking: revokeKey.isPending,
    isDeleting: deleteKey.isPending,
  };
}
