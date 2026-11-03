import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Check if a registrar is connected for the current org
// ============================================================================

export function useRegistrarProvider() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["registrar-provider", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("provider")
        .eq("organization_id", currentOrganization!.id)
        .eq("provider", "porkbun")
        .eq("is_valid", true)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      return data[0].provider as "porkbun";
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ============================================================================
// Fetch domains from connected registrar
// ============================================================================

export function useRegistrarDomains() {
  const { currentOrganization } = useAuth();
  const { data: registrarProvider } = useRegistrarProvider();

  return useQuery({
    queryKey: ["registrar-domains", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("registrar-dns", {
        body: {
          action: "list_domains",
          organization_id: currentOrganization!.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return {
        domains: data.domains as { domain: string; expiry: string; status: string }[],
        provider: data.provider as string,
      };
    },
    enabled: !!currentOrganization && !!registrarProvider,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// ============================================================================
// Push DNS records to registrar
// ============================================================================

export function usePushDnsToRegistrar() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ domainId }: { domainId: string }) => {
      const { data, error } = await supabase.functions.invoke("registrar-dns", {
        body: {
          action: "push_dns_records",
          organization_id: currentOrganization!.id,
          domain_id: domainId,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data as {
        success: boolean;
        results: { record: { type: string; name: string }; success: boolean; error?: string }[];
        summary: string;
        provider: string;
      };
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.summary);
      } else {
        toast.warning(data.summary);
      }
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to push DNS records");
    },
  });
}

// ============================================================================
// URL Forwarding
// ============================================================================

export function useUrlForwarding(domain: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["url-forwarding", currentOrganization?.id, domain],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("registrar-dns", {
        body: {
          action: "get_url_forwarding",
          organization_id: currentOrganization!.id,
          domain,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return {
        forwards: data.forwards as { id?: string; subdomain?: string; url: string; type: string }[],
        provider: data.provider as string,
      };
    },
    enabled: !!currentOrganization && !!domain,
    staleTime: 2 * 60 * 1000,
  });
}

export function useSetUrlForwarding() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      domain,
      url,
      type,
      subdomain,
    }: {
      domain: string;
      url: string;
      type?: string;
      subdomain?: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("registrar-dns", {
        body: {
          action: "set_url_forwarding",
          organization_id: currentOrganization!.id,
          domain,
          forwarding_url: url,
          forwarding_type: type || "redirect_301",
          forwarding_subdomain: subdomain || "",
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: (_, variables) => {
      toast.success(`URL forwarding set for ${variables.domain}`);
      queryClient.invalidateQueries({ queryKey: ["url-forwarding"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to set URL forwarding");
    },
  });
}

export function useDeleteUrlForwarding() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ domain }: { domain: string }) => {
      const { data, error } = await supabase.functions.invoke("registrar-dns", {
        body: {
          action: "delete_url_forwarding",
          organization_id: currentOrganization!.id,
          domain,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data;
    },
    onSuccess: (_, variables) => {
      toast.success(`URL forwarding removed for ${variables.domain}`);
      queryClient.invalidateQueries({ queryKey: ["url-forwarding"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to remove URL forwarding");
    },
  });
}
