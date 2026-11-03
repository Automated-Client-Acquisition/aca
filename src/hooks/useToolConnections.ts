import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ToolType = "smartlead" | "instantly" | "successai" | "notion";

export interface ToolConnection {
  id: string;
  tool_type: ToolType;
  name: string;
  status: string;
  last_verified_at: string | null;
  default_campaign_id: string | null;
  created_at: string;
}

export interface ToolCampaign {
  id: string | number;
  name: string;
  status?: string;
}

export interface NotionDatabase {
  id: string;
  name: string;
}

/**
 * Hook to fetch tool connections (email tools + Notion) for the current organization
 */
export function useToolConnections(toolType?: ToolType) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-tool-connections", currentOrganization?.id, toolType],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      // GET request with query params
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-tool-connect?organizationId=${currentOrganization.id}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch connections");
      }

      const result = await response.json();
      let connections = result.connections || [];

      // Filter by tool type if specified
      if (toolType) {
        connections = connections.filter(
          (c: ToolConnection) => c.tool_type === toolType
        );
      }

      return connections as ToolConnection[];
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to fetch campaigns for a specific email tool connection
 */
export function useToolCampaigns(connectionId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-tool-campaigns", connectionId],
    queryFn: async () => {
      if (!connectionId || !currentOrganization?.id) return [];

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-tool-connect?organizationId=${currentOrganization.id}&connectionId=${connectionId}&action=campaigns`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch campaigns");
      }

      const result = await response.json();
      return (result.campaigns || []) as ToolCampaign[];
    },
    enabled: !!connectionId && !!currentOrganization?.id,
  });
}

/**
 * Hook to fetch Notion databases for a specific Notion connection
 */
export function useNotionDatabases(connectionId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["notion-databases", connectionId],
    queryFn: async () => {
      if (!connectionId || !currentOrganization?.id) return [];

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-tool-connect?organizationId=${currentOrganization.id}&connectionId=${connectionId}&action=databases`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch Notion databases");
      }

      return (result.databases || []) as NotionDatabase[];
    },
    enabled: !!connectionId && !!currentOrganization?.id,
  });
}

/**
 * Hook to create/update a tool connection
 */
export function useCreateToolConnection() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      toolType,
      name,
      apiKey,
      defaultCampaignId,
    }: {
      toolType: ToolType;
      name: string;
      apiKey: string;
      defaultCampaignId?: string;
    }) => {
      if (!currentOrganization?.id) {
        throw new Error("No organization selected");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-tool-connect`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            organizationId: currentOrganization.id,
            toolType,
            name,
            apiKey,
            defaultCampaignId,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to create connection");
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["email-tool-connections", currentOrganization?.id],
      });
    },
  });
}

/**
 * Hook to delete a tool connection
 */
export function useDeleteToolConnection() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      if (!currentOrganization?.id) {
        throw new Error("No organization selected");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/email-tool-connect?organizationId=${currentOrganization.id}&connectionId=${connectionId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to delete connection");
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["email-tool-connections", currentOrganization?.id],
      });
    },
  });
}
