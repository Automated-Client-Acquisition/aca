import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { M365Tenant } from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useM365Tenants() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["m365-tenants", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("m365_tenants")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as M365Tenant[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useInitiateM365Consent() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      onmicrosoft_domain: string;
      display_name?: string;
      admin_email?: string;
      admin_password?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: {
          action: "initiate_consent",
          organization_id: currentOrganization?.id,
          ...input,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to initiate consent");
      return data as { tenant_id: string; azure_tenant_id: string; consent_url: string; status: string };
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useValidateM365Tenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "validate", id },
      });
      if (error) throw new Error(error.message);
      return data as { success: boolean; status: string; tenant_display_name?: string; security_defaults_enabled?: boolean; exo_consent_granted?: boolean; consent_url?: string; warnings?: string[]; error?: string; code?: string };
    },
    onSuccess: (data) => {
      // Always invalidate — `infra-tenant-connect` updates the tenant row even
      // when it returns `success: false` (e.g. EXO token still propagating but
      // consent flags were just set by the callback). Skipping invalidation on
      // failure leaves the UI showing stale `exo_consent_granted=false` after a
      // successful re-consent, which makes mailbox creation look blocked.
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
      if (data.success) {
        toast.success("M365 tenant connected successfully");
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDisconnectM365Tenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "disconnect", id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Tenant disconnected");
    },
    onError: (error: Error) => toast.error(`Failed to disconnect: ${error.message}`),
  });
}

export function useBulkConnectM365Tenants() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (tenants: Array<{ onmicrosoft_domain: string; display_name?: string; admin_email?: string; admin_password?: string }>) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: {
          action: "bulk_connect",
          organization_id: currentOrganization?.id,
          tenants,
        },
      });
      if (error) throw new Error(error.message);
      return data as { success: boolean; connected: number; failed: number; results: Array<{ domain: string; success: boolean; tenant_id?: string; display_name?: string; error?: string }> };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
      if (data.connected > 0) toast.success(`${data.connected} tenant${data.connected !== 1 ? "s" : ""} connected`);
      if (data.failed > 0) toast.error(`${data.failed} tenant${data.failed !== 1 ? "s" : ""} failed`);
    },
    onError: (error: Error) => toast.error(`Bulk import failed: ${error.message}`),
  });
}

export function useInitiateExoConsent() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "initiate_exo_consent", id },
      });
      if (error) throw new Error(error.message);
      if (!data?.consent_url) throw new Error(data?.error || "Failed to get consent URL");
      return data as { consent_url: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(`Failed to initiate Exchange consent: ${error.message}`),
  });
}

export function useRefreshM365Tenant() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("infra-tenant-connect", {
        body: { action: "refresh", id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["m365-tenants", currentOrganization?.id] });
      toast.success("Tenant refreshed");
    },
    onError: (error: Error) => toast.error(`Refresh failed: ${error.message}`),
  });
}
