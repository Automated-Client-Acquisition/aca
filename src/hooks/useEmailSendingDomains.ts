import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { EmailSendingDomain, DnsRecord } from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useEmailSendingDomains(subscriptionId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sending-domains", currentOrganization?.id, subscriptionId],
    queryFn: async () => {
      if (!currentOrganization) return [];

      let query = supabase
        .from("email_sending_domains")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (subscriptionId) {
        query = query.eq("subscription_id", subscriptionId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as EmailSendingDomain[];
    },
    enabled: !!currentOrganization,
    refetchInterval: (query) => {
      const domains = query.state.data;
      if (!domains) return false;
      const hasTransitional = domains.some(
        (d) => d.vm_status === "deleting" || d.vm_status === "provisioning"
      );
      return hasTransitional ? 5000 : false;
    },
  });
}

export function useEmailSendingDomain(id: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-sending-domains", currentOrganization?.id, id],
    queryFn: async () => {
      if (!id || !currentOrganization) return null;

      const { data, error } = await supabase
        .from("email_sending_domains")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .single();

      if (error) throw error;
      return data as unknown as EmailSendingDomain;
    },
    enabled: !!id && !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useProvisionDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      subscription_id: string;
      domain: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const data = await invokeEdgeFunction("infra-domain-provision", {
        action: "provision",
        organization_id: currentOrganization.id,
        ...input,
      });

      if (!data.success) {
        throw new Error(data.error || "Failed to provision domain");
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Domain provisioning started. This may take a few minutes.");
    },
    onError: (error: Error) => {
      toast.error(`Provisioning failed: ${error.message}`);
    },
  });
}

export function useDeleteDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domainId: string) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-domain-provision", {
        action: "delete",
        domain_id: domainId,
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success("Domain deletion started");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete domain: ${error.message}`);
    },
  });
}

export function useCheckDomainStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domainId: string) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-domain-provision", {
        action: "status",
        domain_id: domainId,
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
    },
  });
}

export function useVerifyDns() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domainId: string) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-dns-setup", {
        action: "verify",
        domain_id: domainId,
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      if (data.all_verified) {
        toast.success("All DNS records verified");
      } else {
        toast.warning("Some DNS records are not yet verified");
      }
    },
    onError: (error: Error) => {
      toast.error(`DNS verification failed: ${error.message}`);
    },
  });
}

export function useVerifyAcsDns() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domainId: string) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-domain-provision", {
        action: "verify_dns",
        domain_id: domainId,
        organization_id: currentOrganization.id,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      if (data.all_verified) {
        toast.success("All ACS domain verifications passed");
      } else {
        toast.warning("Some ACS verifications are still pending. Ensure DNS records are configured.");
      }
    },
    onError: (error: Error) => {
      toast.error(`ACS DNS verification failed: ${error.message}`);
    },
  });
}

export function useSetupTls() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ domainId, all }: { domainId?: string; all?: boolean }) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-dns-setup", {
        action: "setup-tls",
        domain_id: domainId,
        organization_id: currentOrganization.id,
        all: all || false,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      const succeeded = data.results?.filter((r: { success: boolean }) => r.success).length || 0;
      const failed = data.results?.filter((r: { success: boolean }) => !r.success).length || 0;
      if (failed === 0) {
        toast.success(`TLS configured for ${succeeded} domain${succeeded !== 1 ? "s" : ""}`);
      } else {
        toast.warning(`TLS: ${succeeded} succeeded, ${failed} failed. Check logs for details.`);
      }
    },
    onError: (error: Error) => {
      toast.error(`TLS setup failed: ${error.message}`);
    },
  });
}

export interface MailboxIdentity {
  first_name: string;
  last_name: string;
  job_title?: string;
  bio?: string;
  avatar_url?: string;
  signature_html?: string;
  // Optional overrides
  username?: string;
  display_name?: string;
  password?: string;
}

export function useGenerateIdentities() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      count: number;
      domain: string;
      company_name?: string;
      company_industry?: string;
      locale?: string;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const data = await invokeEdgeFunction("infra-provision-mailboxes", {
        action: "generate_identities",
        organization_id: currentOrganization.id,
        ...input,
      });

      if (!data?.identities) {
        throw new Error(data?.error || "Failed to generate identities");
      }

      return data.identities as Array<{
        first_name: string;
        last_name: string;
        job_title: string;
        bio: string;
      }>;
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate identities: ${error.message}`);
    },
  });
}

export function useGenerateAvatars() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      identities: Array<{ first_name: string; last_name: string; job_title?: string }>;
      onBatchResult?: (avatars: Array<{ index: number; avatar_url: string | null; error?: string }>, done: number, total: number) => void;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      // Split into small batches to avoid edge function CPU time limits
      const BATCH_SIZE = 3;
      const allAvatars: Array<{ index: number; avatar_url: string | null; error?: string }> = [];
      let totalGenerated = 0;
      let totalFailed = 0;

      for (let offset = 0; offset < input.identities.length; offset += BATCH_SIZE) {
        const batch = input.identities.slice(offset, offset + BATCH_SIZE);

        let data: Record<string, unknown> | null = null;
        let invokeError: string | null = null;
        try {
          data = await invokeEdgeFunction("infra-provision-mailboxes", {
            action: "generate_avatars",
            organization_id: currentOrganization.id,
            identities: batch,
          });
        } catch (err) {
          invokeError = err instanceof Error ? err.message : "Avatar generation failed";
        }

        const batchAvatars: Array<{ index: number; avatar_url: string | null; error?: string }> = [];

        if (invokeError || !data) {
          console.error("[useGenerateAvatars] HTTP error:", invokeError);
          for (let j = 0; j < batch.length; j++) {
            batchAvatars.push({ index: offset + j, avatar_url: null, error: invokeError || "Unknown error" });
          }
          totalFailed += batch.length;
        } else {
          const typedData = data as {
            avatars?: Array<{ index: number; avatar_url: string | null; error?: string }>;
            generated?: number;
            failed?: number;
            error?: string;
          };
          console.log("[useGenerateAvatars] Batch response:", JSON.stringify(typedData).substring(0, 500));
          if (!typedData.avatars || !Array.isArray(typedData.avatars)) {
            console.error("[useGenerateAvatars] No avatars in response:", typedData.error || "unknown");
            for (let j = 0; j < batch.length; j++) {
              batchAvatars.push({ index: offset + j, avatar_url: null, error: typedData.error || "No avatars returned" });
            }
            totalFailed += batch.length;
          } else {
            for (const avatar of typedData.avatars) {
              batchAvatars.push({ ...avatar, index: offset + avatar.index });
            }
            totalGenerated += typedData.generated || 0;
            totalFailed += typedData.failed || 0;
          }
        }

        allAvatars.push(...batchAvatars);
        const done = Math.min(offset + BATCH_SIZE, input.identities.length);
        input.onBatchResult?.(batchAvatars, done, input.identities.length);
      }

      return {
        success: true,
        avatars: allAvatars,
        generated: totalGenerated,
        failed: totalFailed,
      };
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate avatars: ${error.message}`);
    },
  });
}

export function useGenerateSignatures() {
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      identities: Array<{ first_name: string; last_name: string; job_title?: string; email?: string; avatar_url?: string }>;
      domain: string;
      company_name?: string;
      company_website?: string;
      style?: "professional" | "modern" | "minimal";
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const data = await invokeEdgeFunction("infra-provision-mailboxes", {
        action: "generate_signatures",
        organization_id: currentOrganization.id,
        ...input,
      });

      if (!data?.signatures) {
        throw new Error(data?.error || "Failed to generate signatures");
      }

      return data as {
        success: boolean;
        signatures: Array<{ index: number; signature_html: string }>;
        generated: number;
      };
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate signatures: ${error.message}`);
    },
  });
}

export function useProvisionMailboxes() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      domain_id: string;
      email_pattern?: string;
      mailboxes: MailboxIdentity[];
      enable_warmup?: boolean;
      onBatchResult?: (created: number, failed: number, total: number) => void;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      // Each mailbox takes ~10s via Azure Run Command.
      // Supabase edge functions have a wall-clock timeout (~150s).
      // Batch into groups of 10 to stay within limits.
      const BATCH_SIZE = 10;
      let totalCreated = 0;
      let totalFailed = 0;
      const allResults: Array<{ username: string; email: string; success: boolean; error?: string }> = [];
      const allMailboxIds: string[] = [];

      for (let offset = 0; offset < input.mailboxes.length; offset += BATCH_SIZE) {
        const batch = input.mailboxes.slice(offset, offset + BATCH_SIZE);

        let data: Record<string, unknown> | null = null;
        try {
          data = await invokeEdgeFunction("infra-provision-mailboxes", {
            action: "provision",
            organization_id: currentOrganization.id,
            domain_id: input.domain_id,
            email_pattern: input.email_pattern,
            mailboxes: batch,
            enable_warmup: input.enable_warmup,
          });
        } catch (err) {
          console.error("[useProvisionMailboxes] Batch error:", err instanceof Error ? err.message : err);
          totalFailed += batch.length;
        }

        if (data) {
          const typedData = data as {
            created?: number;
            failed?: number;
            results?: Array<{ username: string; email: string; success: boolean; error?: string }>;
            mailbox_ids?: string[];
            error?: string;
          };

          if (typedData.error) {
            console.error("[useProvisionMailboxes] Batch error response:", typedData.error);
            totalFailed += batch.length;
          } else {
            totalCreated += typedData.created || 0;
            totalFailed += typedData.failed || 0;
            if (typedData.results) allResults.push(...typedData.results);
            if (typedData.mailbox_ids) allMailboxIds.push(...typedData.mailbox_ids);
          }
        }

        const done = Math.min(offset + BATCH_SIZE, input.mailboxes.length);
        input.onBatchResult?.(totalCreated, totalFailed, done);
      }

      return {
        success: true,
        created: totalCreated,
        failed: totalFailed,
        results: allResults,
        mailbox_ids: allMailboxIds,
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailbox-stats", currentOrganization?.id] });
      const msg = data.failed > 0
        ? `${data.created} mailbox(es) provisioned, ${data.failed} failed`
        : `${data.created} mailbox(es) provisioned`;
      toast.success(msg);
    },
    onError: (error: Error) => {
      toast.error(`Mailbox provisioning failed: ${error.message}`);
    },
  });
}

export function useUpdateDomainConfig() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      domain_id: string;
      action: "update_forwarding" | "update_dmarc_email" | "update_forwarding_email" | "update_catchall";
      [key: string]: unknown;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      return await invokeEdgeFunction("infra-domain-config", {
        organization_id: currentOrganization.id,
        ...input,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Domain configuration updated");
    },
    onError: (error: Error) => {
      toast.error(`Config update failed: ${error.message}`);
    },
  });
}

// ============================================================================
// Replace Burned Domain
// ============================================================================

// ============================================================================
// M365 Domain Hooks
// ============================================================================

export function useProvisionM365Domain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { m365_tenant_id: string; domain: string; auto_push_dns?: boolean }) => {
      const data = await invokeEdgeFunction<{ domain_id: string; dns_records: unknown[]; error?: string }>("infra-domain-provision", {
        action: "provision", organization_id: currentOrganization?.id, ...input,
      });
      if (!data?.domain_id) throw new Error(data?.error || "Failed to provision domain");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Domain provisioned — add DNS records to complete setup");
    },
    onError: (error: Error) => {
      // Structured errors (e.g. DOMAIN_CLAIMED_BY_OTHER_TENANT) are displayed
      // inline by the wizard with title/message/next_steps — skip the toast.
      const details = (error as { details?: Record<string, unknown> }).details;
      if (details && (details.error_title || details.next_steps)) return;
      toast.error(`Provision failed: ${error.message}`);
    },
  });
}

export function useVerifyM365Domain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    // Pass `{ domainId, silent: true }` from background polling so it doesn't toast every tick.
    mutationFn: async (input: string | { domainId: string; silent?: boolean }) => {
      const domainId = typeof input === "string" ? input : input.domainId;
      return await invokeEdgeFunction<{ success: boolean; isVerified: boolean; dkim_verified?: boolean; dns_records?: DnsRecord[] }>("infra-domain-provision", {
        action: "verify_dns", domain_id: domainId, organization_id: currentOrganization?.id,
      });
    },
    onSuccess: (data, input) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      if (typeof input !== "string" && input.silent) return;
      if (data.isVerified && data.dkim_verified) {
        toast.success("Domain fully verified! You can now create mailboxes.");
      } else if (data.isVerified) {
        // The global Sonner default is 2.5s, far too short to read an action item.
        toast.info("Ownership verified. DKIM still pending.", {
          description: "Add the DKIM CNAME records, then verify again.",
          duration: 8000,
        });
      } else {
        toast.warning("DNS records not yet detected. Please wait a few minutes and try again.", { duration: 6000 });
      }
    },
    onError: (error: Error, input) => {
      if (typeof input !== "string" && input.silent) return;
      toast.error(`Verification failed: ${error.message}`);
    },
  });
}

export function useCheckM365DomainStatus() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (domainId: string) => {
      return await invokeEdgeFunction("infra-domain-provision", {
        action: "status", domain_id: domainId, organization_id: currentOrganization?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
    },
  });
}

export interface RepairDkimResponse {
  success: boolean;
  dkim_verified: boolean;
  exo_status: string | null;
  exo_enabled: boolean | null;
  selector1_cname: string | null;
  selector2_cname: string | null;
  dns_records: DnsRecord[];
  note: string;
}

export function useRepairM365Dkim() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (domainId: string) => {
      return await invokeEdgeFunction<RepairDkimResponse>("infra-domain-provision", {
        action: "repair_dkim", domain_id: domainId, organization_id: currentOrganization?.id,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      if (data.dkim_verified) {
        toast.success("DKIM is live — your mail will be signed by Microsoft.");
      } else if (data.exo_status === "CnameMissing") {
        toast.warning("DKIM not yet active. Update the selector CNAMEs at your DNS provider to the values shown, then retry.");
      } else {
        toast.warning(`DKIM not yet active (EXO: ${data.exo_status || "unknown"}).`);
      }
    },
    onError: (error: Error) => toast.error(`DKIM repair failed: ${error.message}`),
  });
}

// ============================================================================
// Replace Burned Domain
// ============================================================================

export function useReplaceBurnedDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      burned_domain_id: string;
      new_domain: string;
      migrate_identities?: boolean;
    }) => {
      if (!currentOrganization) throw new Error("No organization context");

      const data = await invokeEdgeFunction("infra-domain-provision", {
        action: "replace",
        organization_id: currentOrganization.id,
        ...input,
      });

      if (!data?.success) {
        throw new Error(data?.error || "Failed to replace domain");
      }

      return data as {
        success: boolean;
        burned_domain: string;
        new_domain: { id: string; domain: string; vm_status: string };
        mailbox_identities: Array<{
          first_name: string;
          last_name: string;
          job_title: string;
          bio: string;
          avatar_url: string;
          display_name: string;
        }>;
        message: string;
      };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      toast.success(`Replacing ${data.burned_domain} with ${data.new_domain.domain}. ${data.mailbox_identities.length} identities ready for migration.`);
    },
    onError: (error: Error) => {
      toast.error(`Domain replacement failed: ${error.message}`);
    },
  });
}

export interface DomainDeliveryMonitoring {
  domain_id: string;
  days: number;
  window_start: string;
  window_end: string;
  sending_paused_at: string | null;
  sending_pause_reason: string | null;
  sending_paused_by: string | null;
  technically_unusable: boolean;
  recipient_providers: Array<{
    provider: "gmail" | "microsoft" | "yahoo" | "other_consumer" | "unknown";
    attempted: number;
    delivered: number;
    reputation_rejected: number;
    recipient_bounced: number;
    send_failed: number;
    unconfirmed: number;
  }>;
  probes: Array<{
    seed_provider: string;
    attempted: number;
    delivered: number;
    reputation_rejected: number;
    spam: number;
    send_failed: number;
    unconfirmed: number;
  }>;
  gmail_postmaster: {
    recorded_for: string;
    domain_reputation: string | null;
    ip_reputation: string | null;
    spam_rate: number | null;
    dkim_success_ratio: number | null;
    spf_success_ratio: number | null;
    dmarc_success_ratio: number | null;
    delivery_errors: unknown;
  } | null;
}

export function useDomainDeliveryMonitoring(domainId: string, enabled: boolean) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["domain-delivery-monitoring", currentOrganization?.id, domainId, 7],
    queryFn: async () => {
      if (!currentOrganization) throw new Error("No organization context");
      const { data, error } = await supabase.rpc("get_domain_delivery_monitoring", {
        p_domain_id: domainId,
        p_days: 7,
      });
      if (error) throw error;
      return data as unknown as DomainDeliveryMonitoring;
    },
    enabled: enabled && !!currentOrganization,
  });
}

export function useSetSendingDomainPaused() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async ({ domainId, paused, reason }: { domainId: string; paused: boolean; reason?: string }) => {
      if (!currentOrganization) throw new Error("No organization context");
      const { data, error } = await supabase.rpc("set_sending_domain_paused", {
        p_domain_id: domainId,
        p_paused: paused,
        ...(reason?.trim() ? { p_reason: reason.trim() } : {}),
      });
      if (error) throw error;
      return data as unknown as Pick<DomainDeliveryMonitoring, "domain_id" | "sending_paused_at" | "sending_pause_reason" | "sending_paused_by" | "technically_unusable">;
    },
    onSuccess: (data) => {
      const orgId = currentOrganization?.id;
      for (const key of ["email-sending-domains", "email-mailboxes", "email-mailbox-stats", "domain-delivery-monitoring", "email-stats", "email-filtered-stats"]) {
        queryClient.invalidateQueries({ queryKey: [key, orgId] });
      }
      // These keys include organization after the sequence/pagination parameters.
      queryClient.invalidateQueries({ predicate: (query) =>
        ["email-enrollments", "email-enrollment-counts", "email-enrollment-preview", "byo-domains", "byo-mailboxes"].includes(String(query.queryKey[0])) &&
        query.queryKey.includes(orgId)
      });
      toast.success(data.sending_paused_at ? "Domain sending paused" : "Domain sending resumed");
    },
    onError: (error: Error) => toast.error(`Could not update domain sending: ${error.message}`),
  });
}
