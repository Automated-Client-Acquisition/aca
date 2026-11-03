import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { AzureTenant } from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useAzureTenants() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["azure-tenants", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("azure_tenants")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as unknown as AzureTenant[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

interface ValidateTenantResult {
  success: boolean;
  error?: string;
  tenant_id: string;
  app_display_name?: string;
}

export function useValidateAzureTenant() {
  return useMutation({
    mutationFn: async (input: {
      tenant_id: string;
      client_id: string;
      client_secret: string;
    }): Promise<ValidateTenantResult> => {
      const response = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "validate", ...input },
      });

      if (response.error) {
        // Supabase wraps 4xx bodies in response.context — extract the real Azure error
        const body = response.error.context
          ? await response.error.context.json().catch(() => null)
          : null;
        const detail = body?.error || response.error.message || "Validation failed";
        throw new Error(detail);
      }

      if (!response.data?.success) {
        throw new Error(response.data?.error || "Azure tenant validation failed");
      }

      return response.data as ValidateTenantResult;
    },
    onError: (error: Error) => {
      toast.error(`Tenant validation failed: ${error.message}`);
    },
  });
}

export function useConnectAzureTenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      tenant_id: string;
      client_id: string;
      client_secret: string;
      display_name?: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const response = await supabase.functions.invoke("infra-tenant-connect", {
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
        throw new Error(response.data.error || "Failed to connect tenant");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-tenants", currentOrganization?.id] });
      toast.success("Azure tenant connected");
    },
    onError: (error: Error) => {
      toast.error(`Failed to connect tenant: ${error.message}`);
    },
  });
}

export function useDisconnectAzureTenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "disconnect", id },
      });

      if (response.error) {
        throw new Error(response.error.message || "Disconnect failed");
      }

      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-tenants", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["azure-subscriptions", currentOrganization?.id] });
      toast.success("Azure tenant deleted");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete tenant: ${error.message}`);
    },
  });
}

export function useRefreshAzureTenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "refresh", id },
      });

      if (response.error) {
        throw new Error(response.error.message || "Refresh failed");
      }

      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["azure-tenants", currentOrganization?.id] });
      if (data.success) {
        toast.success("Tenant credentials validated");
      } else {
        toast.error(`Tenant validation failed: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Refresh failed: ${error.message}`);
    },
  });
}

export function useUpdateAzureTenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: { id: string; display_name?: string }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { id, ...updates } = input;
      const { error } = await supabase
        .from("azure_tenants")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["azure-tenants", currentOrganization?.id] });
      toast.success("Tenant updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`);
    },
  });
}
