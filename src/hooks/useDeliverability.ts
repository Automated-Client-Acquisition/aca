import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Postmaster Tools (Google) — Phase 8.2.1
// ============================================================================

export interface PostmasterTokenRow {
  id: string;
  organization_id: string;
  account_email: string | null;
  status: "connected" | "revoked" | "error";
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function usePostmasterStatus() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["postmaster-status", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return null;
      const { data, error } = await supabase
        .from("postmaster_oauth_tokens")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();
      if (error) throw error;
      return data as PostmasterTokenRow | null;
    },
    enabled: !!currentOrganization,
  });
}

export function useConnectPostmaster() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (): Promise<{ auth_url: string }> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-postmaster-oauth-init", {
        body: { organization_id: currentOrganization.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to start OAuth");
      return { auth_url: data.auth_url as string };
    },
    onSuccess: ({ auth_url }) => {
      const popup = window.open(auth_url, "postmaster_oauth", "width=520,height=700");
      const handler = (event: MessageEvent) => {
        if (event.data?.type === "postmaster_connect") {
          popup?.close();
          window.removeEventListener("message", handler);
          queryClient.invalidateQueries({ queryKey: ["postmaster-status", currentOrganization?.id] });
          if (event.data.status === "success") {
            toast.success(`Connected as ${event.data.accountEmail || "your Google account"}`);
          } else {
            toast.error("Connection failed — see the popup for details.");
          }
        }
      };
      window.addEventListener("message", handler);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDisconnectPostmaster() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-postmaster-disconnect", {
        body: { organization_id: currentOrganization.id },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["postmaster-status", currentOrganization?.id] });
      toast.success("Postmaster Tools disconnected.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface DomainReputationRow {
  id: string;
  domain_id: string;
  recorded_for: string;
  ip_reputation: string | null;
  domain_reputation: "BAD" | "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | string | null;
  spam_rate: number | null;
  dkim_success_ratio: number | null;
  spf_success_ratio: number | null;
  dmarc_success_ratio: number | null;
}

/**
 * Last 30 days of Postmaster Tools reputation snapshots for a domain.
 */
export function useDomainReputation(domainId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["domain-reputation", domainId, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization || !domainId) return [];
      const { data, error } = await supabase
        .from("email_domain_reputation_log")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .eq("domain_id", domainId)
        .order("recorded_for", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as DomainReputationRow[];
    },
    enabled: !!currentOrganization && !!domainId,
  });
}

// ============================================================================
// Microsoft SNDS — Phase 8.2.2
// ============================================================================

export interface SndsLinks {
  snds_url: string;
  jmrp_url: string;
  snds_dashboard_url: string;
}

export function useGetSndsLinks() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      server_id: string;
      ip_range_start: string;
      ip_range_end: string;
      contact_email: string;
    }): Promise<SndsLinks> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-snds-configure", {
        body: { organization_id: currentOrganization.id, action: "links", ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to build SNDS links");
      return data as SndsLinks;
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useSetSndsDataUrl() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { server_id: string; snds_data_url: string; jmrp_complaint_email?: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-snds-configure", {
        body: { organization_id: currentOrganization.id, action: "set_data_url", ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to save SNDS URL");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers"] });
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      toast.success("SNDS data feed saved. First poll runs within 6 hours.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ============================================================================
// DMARC reports — Phase 8.2.3
// ============================================================================

export interface DmarcReportRow {
  id: string;
  domain_id: string | null;
  org_name: string;
  report_id: string;
  policy_domain: string;
  policy_p: string | null;
  total_messages: number;
  spf_pass_count: number;
  dkim_pass_count: number;
  dmarc_pass_count: number;
  alignment_failures: Array<{ source_ip: string; count: number; spf_aligned: boolean; dkim_aligned: boolean }>;
  report_date_range_begin: string;
  report_date_range_end: string;
  ingested_at: string;
}

export function useDmarcReports(domainId?: string | null) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["dmarc-reports", domainId ?? null, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      let q = supabase
        .from("email_dmarc_reports")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("report_date_range_end", { ascending: false })
        .limit(50);
      if (domainId) q = q.eq("domain_id", domainId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DmarcReportRow[];
    },
    enabled: !!currentOrganization,
  });
}

// ============================================================================
// Combined deliverability summary for the email-infra dashboard tile
// ============================================================================

export interface DeliverabilityMetrics {
  postmaster_connected: boolean;
  postmaster_account: string | null;
  domains_total: number;
  domains_healthy: number;
  domains_warning: number;
  domains_burned: number;
  ips_with_snds: number;
  ips_red: number;
  ips_yellow: number;
  ips_green: number;
  recent_dmarc_reports_30d: number;
  recent_dmarc_alignment_failures_30d: number;
}

export function useDeliverabilityMetrics() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const orgId = currentOrganization?.id;

  // Refresh whenever any of the underlying queries invalidate.
  useEffect(() => {
    return () => {
      // no-op cleanup
      void queryClient;
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["deliverability-metrics", orgId],
    queryFn: async (): Promise<DeliverabilityMetrics> => {
      if (!orgId) {
        return {
          postmaster_connected: false, postmaster_account: null,
          domains_total: 0, domains_healthy: 0, domains_warning: 0, domains_burned: 0,
          ips_with_snds: 0, ips_red: 0, ips_yellow: 0, ips_green: 0,
          recent_dmarc_reports_30d: 0, recent_dmarc_alignment_failures_30d: 0,
        };
      }

      const [tokens, domains, ips, dmarc] = await Promise.all([
        supabase.from("postmaster_oauth_tokens").select("status, account_email").eq("organization_id", orgId).maybeSingle(),
        supabase.from("email_sending_domains").select("domain_health").eq("organization_id", orgId).eq("infra_type", "byo"),
        supabase.from("byo_server_ips").select("snds_last_status, snds_registered_at").eq("organization_id", orgId),
        supabase.from("email_dmarc_reports")
          .select("alignment_failures")
          .eq("organization_id", orgId)
          .gte("ingested_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      ]);

      const domainList = (domains.data ?? []) as Array<{ domain_health: string | null }>;
      const ipList = (ips.data ?? []) as Array<{ snds_last_status: string | null; snds_registered_at: string | null }>;
      const dmarcList = (dmarc.data ?? []) as Array<{ alignment_failures: Array<unknown> | null }>;

      return {
        postmaster_connected: tokens.data?.status === "connected",
        postmaster_account: (tokens.data?.account_email as string | null) ?? null,
        domains_total: domainList.length,
        domains_healthy: domainList.filter((d) => d.domain_health === "healthy" || d.domain_health === "no_data").length,
        domains_warning: domainList.filter((d) => d.domain_health === "warning").length,
        domains_burned: domainList.filter((d) => d.domain_health === "burned").length,
        ips_with_snds: ipList.filter((i) => i.snds_registered_at).length,
        ips_red: ipList.filter((i) => i.snds_last_status === "red").length,
        ips_yellow: ipList.filter((i) => i.snds_last_status === "yellow").length,
        ips_green: ipList.filter((i) => i.snds_last_status === "green").length,
        recent_dmarc_reports_30d: dmarcList.length,
        recent_dmarc_alignment_failures_30d: dmarcList.reduce((sum, r) => sum + (r.alignment_failures?.length ?? 0), 0),
      };
    },
    enabled: !!orgId,
    refetchInterval: 5 * 60 * 1000, // 5 min
  });
}
