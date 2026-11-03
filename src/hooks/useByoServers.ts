import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type {
  ByoServer,
  ByoServerIp,
  CreateByoServerInput,
  EmailMailbox,
  EmailSendingDomain,
  InfraByoJob,
} from "@/types/email";

// ============================================================================
// Queries
// ============================================================================

export function useByoServers() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-servers", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("byo_servers")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ByoServer[];
    },
    enabled: !!currentOrganization,
  });
}

export function useByoServer(id: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-server", id, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization || !id) return null;
      const { data, error } = await supabase
        .from("byo_servers")
        .select("*")
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();
      if (error) throw error;
      return data as ByoServer | null;
    },
    enabled: !!currentOrganization && !!id,
  });
}

/**
 * All BYO IPs across all servers for the current organization. Used by the top
 * level dashboard stats; per-server detail uses useByoServerIps below.
 */
export function useAllByoIps() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-server-ips", "all", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("byo_server_ips")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ByoServerIp[];
    },
    enabled: !!currentOrganization,
  });
}

export function useByoServerIps(serverId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-server-ips", serverId, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization || !serverId) return [];
      const { data, error } = await supabase
        .from("byo_server_ips")
        .select("*")
        .eq("server_id", serverId)
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ByoServerIp[];
    },
    enabled: !!currentOrganization && !!serverId,
  });
}

export interface UseByoServerJobsOptions {
  limit?: number;
  status?: InfraByoJob["status"];
  targetKind?: InfraByoJob["target_kind"];
  targetId?: string;
}

export function useByoServerJobs(options: UseByoServerJobsOptions = {}) {
  const { currentOrganization } = useAuth();
  const { limit = 50, status, targetKind, targetId } = options;
  return useQuery({
    queryKey: ["infra-byo-jobs", currentOrganization?.id, limit, status, targetKind, targetId],
    queryFn: async () => {
      if (!currentOrganization) return [];
      let query = supabase
        .from("infra_byo_jobs")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);
      if (targetKind) query = query.eq("target_kind", targetKind);
      if (targetId) query = query.eq("target_id", targetId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as InfraByoJob[];
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Single job by id with realtime updates. Used by the wizard step 3 to
 * stream the connect job's log column live.
 */
export function useByoJob(jobId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);

  const queryKey = ["infra-byo-job", jobId, currentOrganization?.id];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!currentOrganization || !jobId) return null;
      const { data, error } = await supabase
        .from("infra_byo_jobs")
        .select("*")
        .eq("id", jobId)
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();
      if (error) throw error;
      return data as InfraByoJob | null;
    },
    enabled: !!currentOrganization && !!jobId,
    refetchInterval: (q) => {
      const data = q.state.data as InfraByoJob | null;
      // Keep polling while running/pending; stop once terminal.
      if (!data) return 1500;
      if (data.status === "running" || data.status === "pending") return 1500;
      return false;
    },
  });

  // Realtime subscription so log/status updates feel instant. The 1.5s
  // polling above is a fallback if Realtime isn't connected.
  const orgId = currentOrganization?.id;
  useEffect(() => {
    if (!jobId || !orgId) return;
    const channel = supabase
      .channel(`infra-byo-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "infra_byo_jobs", filter: `id=eq.${jobId}` },
        () => {
          setTick((t) => t + 1);
          queryClient.invalidateQueries({ queryKey: ["infra-byo-job", jobId, orgId] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, orgId, queryClient]);

  // tick is consumed only as a dependency tracker; suppress unused warning
  void tick;

  return query;
}

// ============================================================================
// Mutations
// ============================================================================

export interface ConnectByoServerResult {
  success: boolean;
  server: ByoServer;
  public_key: string;
  fingerprint: string;
  install_command: string;
}

/**
 * Step 1 of the wizard: create the row + generate keypair.
 */
export function useCreateByoServer() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateByoServerInput): Promise<ConnectByoServerResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const payload = {
        organization_id: currentOrganization.id,
        name: input.name,
        hostname: input.hostname,
        ssh_host: input.ssh_host,
        ssh_port: input.ssh_port,
        ssh_username: input.ssh_username,
        provider_hint: input.provider_hint,
      };
      const { data, error } = await supabase.functions.invoke("infra-byo-server-connect", {
        body: payload,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to create server");
      return data as ConnectByoServerResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface ValidateByoServerResult {
  success: boolean;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

/**
 * Step 3 of the wizard: enqueue the connect job for the deployer.
 */
export function useValidateByoServer() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (serverId: string): Promise<ValidateByoServerResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-server-validate", {
        body: { organization_id: currentOrganization.id, server_id: serverId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to enqueue validation");
      return data as ValidateByoServerResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface DeployByoServerResult {
  success: boolean;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

/**
 * Phase 3 step 4: trigger deploy_base after a server has passed `connect`.
 */
export function useDeployByoServer() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (serverId: string): Promise<DeployByoServerResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-server-deploy", {
        body: { organization_id: currentOrganization.id, server_id: serverId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to enqueue deploy");
      return data as DeployByoServerResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * BYO sending domains attached to one server (or all of them if serverId is null).
 * Stays in sync with the existing email-sending-domains query so the M365 view
 * sees the same updates.
 */
export function useByoDomains(serverId?: string | null) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-domains", serverId ?? null, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      let q = supabase
        .from("email_sending_domains")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .eq("infra_type", "byo")
        .order("created_at", { ascending: false });
      if (serverId) q = q.eq("byo_server_id", serverId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmailSendingDomain[];
    },
    enabled: !!currentOrganization,
  });
}

export interface ProvisionByoDomainInput {
  server_id: string;
  domain: string;
  dkim_selector?: string;
  dmarc_email?: string;
}

export interface ProvisionByoDomainResult {
  success: boolean;
  domain_id: string;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

export function useProvisionByoDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: ProvisionByoDomainInput): Promise<ProvisionByoDomainResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-domain-provision", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to provision domain");
      return data as ProvisionByoDomainResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-domains"] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface VerifyByoDomainResult {
  success: boolean;
  dns_status: string;
  spf_verified: boolean;
  dkim_verified: boolean;
  dmarc_verified: boolean;
}

export function useVerifyByoDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (domainId: string): Promise<VerifyByoDomainResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-domain-verify", {
        body: { organization_id: currentOrganization.id, domain_id: domainId },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to verify DNS");
      return data as VerifyByoDomainResult;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["byo-domains"] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      if (data.dns_status === "verified") {
        toast.success("All DNS records verified.");
      } else if (data.dkim_verified && data.spf_verified) {
        toast.info("SPF + DKIM verified, waiting on DMARC.");
      } else {
        toast.info("DNS not fully propagated yet — try again in a few minutes.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * Mailboxes attached to a BYO sending domain. Backed by the same email_mailboxes
 * table the existing pipeline already operates on, filtered by sending_domain_id.
 */
export function useByoMailboxes(domainId: string | null | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["byo-mailboxes", domainId, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization || !domainId) return [];
      const { data, error } = await supabase
        .from("email_mailboxes")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .eq("sending_domain_id", domainId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EmailMailbox[];
    },
    enabled: !!currentOrganization && !!domainId,
  });
}

export interface ProvisionByoMailboxInput {
  domain_id: string;
  username: string;        // local part
  display_name: string;
  daily_limit?: number;
}

export interface ProvisionByoMailboxResult {
  success: boolean;
  mailbox_id: string;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

export function useProvisionByoMailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: ProvisionByoMailboxInput): Promise<ProvisionByoMailboxResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-mailbox-provision", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to provision mailbox");
      return data as ProvisionByoMailboxResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-mailboxes"] });
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface AttachByoIpInput {
  server_id: string;
  ip_address: string;
  ptr_record?: string;
  domain_id?: string | null;
  helo_name?: string;
}

export interface AttachByoIpResult {
  success: boolean;
  ip_id: string;
  job_id?: string;
  status: InfraByoJob["status"] | "active";
  reused: boolean;
}

export function useAttachByoIp() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: AttachByoIpInput): Promise<AttachByoIpResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-ip-attach", {
        body: { organization_id: currentOrganization.id, ...input, domain_id: input.domain_id ?? null },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to attach IP");
      return data as AttachByoIpResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface BulkAttachByoIpInput {
  server_id: string;
  cidr: string;
  domain_id?: string | null;
  helo_name?: string;
  exclude?: string[];
}

export interface BulkAttachByoIpResult {
  success: boolean;
  cidr: string;
  expanded_count: number;
  attempted_count: number;
  skipped_existing_count: number;
  enqueued_count: number;
  failed_count: number;
  enqueued: Array<{ ip_address: string; ip_id: string; job_id: string }>;
  failed: Array<{ ip_address: string; error: string }>;
}

export function useBulkAttachByoIp() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: BulkAttachByoIpInput): Promise<BulkAttachByoIpResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-ip-bulk-attach", {
        body: { organization_id: currentOrganization.id, ...input, domain_id: input.domain_id ?? null },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Bulk attach failed");
      return data as BulkAttachByoIpResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface DetachByoIpResult {
  success: boolean;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

export function useDetachByoIp() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { ip_id: string; delete_after?: boolean }): Promise<DetachByoIpResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-ip-detach", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to detach IP");
      return data as DetachByoIpResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useAssignByoIpToDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { ip_id: string; domain_id: string | null }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-ip-assign-domain", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to assign domain");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      queryClient.invalidateQueries({ queryKey: ["byo-domains"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface RecheckBlocklistInput {
  ip_id: string;
}

export function useRecheckByoBlocklist() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: RecheckBlocklistInput) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-blacklist-check", {
        body: { organization_id: currentOrganization.id, ip_id: input.ip_id },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to recheck blocklist");
      return data as { success: boolean; checked: number; listed: number; cleared: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["byo-server-ips"] });
      if (data.listed > 0) {
        toast.warning(`IP listed on ${data.listed} blocklist${data.listed > 1 ? "s" : ""}`);
      } else if (data.cleared > 0) {
        toast.success("IP cleared from all blocklists");
      } else {
        toast.success("IP is clean");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

// ============================================================================
// Phase 7: test-send, install TLS, deprovision
// ============================================================================

export interface TestSendByoMailboxInput {
  mailbox_id: string;
  recipient: string;
}

export interface TestSendByoMailboxResult {
  success: boolean;
  error?: string;
  error_category?: string;
  message_id?: string;
}

export function useTestSendByoMailbox() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: TestSendByoMailboxInput): Promise<TestSendByoMailboxResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-test-send", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      return data as TestSendByoMailboxResult;
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface InstallTlsResult {
  success: boolean;
  job_id: string;
  status: InfraByoJob["status"];
  reused: boolean;
}

export function useInstallByoTls() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { server_id: string; admin_email: string }): Promise<InstallTlsResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-install-tls", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to enqueue TLS install");
      return data as InstallTlsResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export interface DeprovisionByoInput {
  target_kind: "mailbox" | "domain" | "server";
  mailbox_id?: string;
  domain_id?: string;
  server_id?: string;
  delete_maildir?: boolean;
  delete_keys?: boolean;
}

export interface DeprovisionByoResult {
  success: boolean;
  job_id?: string;
  status?: InfraByoJob["status"];
  reused?: boolean;
  note?: string;
}

export function useDeprovisionByo() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: DeprovisionByoInput): Promise<DeprovisionByoResult> => {
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const { data, error } = await supabase.functions.invoke("infra-byo-deprovision", {
        body: { organization_id: currentOrganization.id, ...input },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Failed to enqueue deprovision");
      return data as DeprovisionByoResult;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["byo-domains"] });
      queryClient.invalidateQueries({ queryKey: ["byo-mailboxes"] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["infra-byo-jobs", currentOrganization?.id] });
      const what = vars.target_kind;
      toast.success(`${what.charAt(0).toUpperCase() + what.slice(1)} teardown enqueued`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

export function useDeleteByoServer() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("byo_servers")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization?.id ?? "");
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["byo-servers", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Server removed");
    },
    onError: (error: Error) => toast.error(`Failed to remove server: ${error.message}`),
  });
}
