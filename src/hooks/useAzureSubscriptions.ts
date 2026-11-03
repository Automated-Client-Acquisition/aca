import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { AzureSubscription } from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useAzureSubscriptions() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["azure-subscriptions", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("azure_subscriptions")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as AzureSubscription[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

interface ValidateResult {
  success: boolean;
  error?: string;
  subscription?: {
    id: string;
    name: string;
    state: string;
    tenant_id: string;
  };
  available_regions?: Array<{ name: string; displayName: string }>;
}

export function useValidateAzureSubscription() {
  return useMutation({
    mutationFn: async (input: {
      subscription_id: string;
      azure_tenant_id?: string;
      tenant_id?: string;
      client_id?: string;
      client_secret?: string;
    }): Promise<ValidateResult> => {
      const response = await supabase.functions.invoke("infra-subscription-connect", {
        body: { action: "validate", ...input },
      });

      if (response.error) {
        const body = response.error.context
          ? await response.error.context.json().catch(() => null)
          : null;
        const detail = body?.error || response.error.message || "Validation failed";
        throw new Error(detail);
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || "Azure validation failed");
      }

      return response.data as ValidateResult;
    },
    onError: (error: Error) => {
      toast.error(`Azure validation failed: ${error.message}`);
    },
  });
}

export function useConnectAzureSubscription() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      subscription_id: string;
      azure_tenant_id?: string;
      tenant_id?: string;
      client_id?: string;
      client_secret?: string;
      region?: string;
      display_name?: string;
      resource_group?: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const response = await supabase.functions.invoke("infra-subscription-connect", {
        body: {
          action: "connect",
          organization_id: currentOrganization.id,
          ...input,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || "Connection failed");
      }

      if (!response.data.success) {
        throw new Error(response.data.error || "Failed to connect subscription");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-subscriptions", currentOrganization?.id] });
      toast.success("Azure subscription connected");
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect: ${error.message}`);
    },
  });
}

export function useDisconnectAzureSubscription() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await supabase.functions.invoke("infra-subscription-connect", {
        body: { action: "disconnect", id },
      });

      if (response.error) {
        throw new Error(response.error.message || "Disconnect failed");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-subscriptions", currentOrganization?.id] });
      toast.success("Azure subscription deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete subscription: ${error.message}`);
    },
  });
}

export function useUpdateAzureSubscription() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: { id: string; region?: string; resource_group?: string }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { id, ...updates } = input;
      const { error } = await supabase
        .from("azure_subscriptions")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-subscriptions", currentOrganization?.id] });
      toast.success("Subscription updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });
}

export function useRefreshAzureSubscription() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await supabase.functions.invoke("infra-subscription-connect", {
        body: { action: "refresh", id },
      });

      if (response.error) {
        throw new Error(response.error.message || "Refresh failed");
      }

      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["azure-subscriptions", currentOrganization?.id] });
      if (data.success) {
        toast.success("Subscription validated");
      } else {
        toast.error(`Subscription validation failed: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Refresh failed: ${error.message}`);
    },
  });
}
