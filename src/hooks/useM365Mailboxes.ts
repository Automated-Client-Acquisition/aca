import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/supabase-functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useEffect, useRef } from "react";

export type MailboxProvisioningJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface MailboxProvisioningJob {
  id: string;
  organization_id: string;
  domain_id: string;
  status: MailboxProvisioningJobStatus;
  total: number;
  created_count: number;
  failed_count: number;
  processed_index: number;
  current_username: string | null;
  mailboxes: Array<{ username: string; display_name: string; avatar_url?: string }>;
  errors: Array<{ username: string; error: string }>;
  created_mailbox_ids: string[];
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================================
// Mutations
// ============================================================================

export function useCreateM365Mailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      domain_id: string;
      username: string;
      display_name: string;
      avatar_url?: string;
    }) => {
      const data = await invokeEdgeFunction<{ success: boolean; error?: string; mailbox: unknown }>("infra-mailbox-provision", {
        action: "create",
        organization_id: currentOrganization?.id,
        ...input,
      });
      if (!data?.success) throw new Error(data?.error || "Failed to create mailbox");
      return data.mailbox;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Mailbox created");
    },
    onError: (error: Error) => toast.error(`Failed to create mailbox: ${error.message}`),
  });
}

/**
 * Start an async bulk provisioning job. Returns immediately with the job id;
 * the edge function processes mailboxes in the background and updates the
 * mailbox_provisioning_jobs row as it progresses. Use useMailboxProvisioningJob
 * to poll for progress.
 */
export function useStartBulkCreateM365Mailboxes() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      domain_id: string;
      mailboxes: Array<{ username: string; display_name: string; avatar_url?: string }>;
      generate_avatars?: boolean;
    }): Promise<{ job_id: string }> => {
      const data = await invokeEdgeFunction<{ success: boolean; error?: string; job_id: string }>(
        "infra-mailbox-provision",
        {
          action: "bulk_create_async",
          organization_id: currentOrganization?.id,
          domain_id: input.domain_id,
          mailboxes: input.mailboxes,
          generate_avatars: input.generate_avatars ?? false,
        }
      );
      if (!data?.success || !data.job_id) {
        throw new Error(data?.error || "Failed to start provisioning job");
      }
      return { job_id: data.job_id };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-provisioning-jobs", currentOrganization?.id] });
    },
    onError: (error: Error) => toast.error(`Bulk create failed: ${error.message}`),
  });
}

/** Poll a single provisioning job. Stops polling when terminal. */
export function useMailboxProvisioningJob(jobId: string | null) {
  return useQuery({
    queryKey: ["mailbox-provisioning-job", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("mailbox_provisioning_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error) throw new Error(`Failed to fetch provisioning job: ${error.message}`);
      return data as unknown as MailboxProvisioningJob;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "pending" || data?.status === "running") return 2000;
      return false;
    },
  });
}

/** Active (running or pending) provisioning job for a specific domain, if any. */
export function useActiveMailboxProvisioningJob(domainId: string | undefined) {
  return useQuery({
    queryKey: ["mailbox-provisioning-job-active", domainId],
    queryFn: async () => {
      if (!domainId) return null;
      const { data, error } = await supabase
        .from("mailbox_provisioning_jobs")
        .select("*")
        .eq("domain_id", domainId)
        .in("status", ["pending", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`Failed to fetch active job: ${error.message}`);
      return (data as unknown as MailboxProvisioningJob | null) ?? null;
    },
    enabled: !!domainId,
    refetchInterval: (query) => (query.state.data ? 2000 : 10_000),
  });
}

/** Cancel an in-flight provisioning job. */
export function useCancelMailboxProvisioningJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("mailbox_provisioning_jobs")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", jobId)
        .in("status", ["pending", "running"]);
      if (error) throw new Error(`Failed to cancel job: ${error.message}`);
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ["mailbox-provisioning-job", jobId] });
      queryClient.invalidateQueries({ queryKey: ["mailbox-provisioning-job-active"] });
      toast.info("Provisioning cancelled");
    },
    onError: (error: Error) => toast.error(`Failed to cancel: ${error.message}`),
  });
}

/**
 * Show a toast when a job reaches a terminal state and refresh mailbox lists.
 * onComplete fires only once per job id.
 */
export function useWatchMailboxProvisioningCompletion(
  jobId: string | null,
  onComplete?: (job: MailboxProvisioningJob) => void
) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: job } = useMailboxProvisioningJob(jobId);
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      notifiedRef.current = null;
      return;
    }
    if (!job || notifiedRef.current === job.id) return;
    if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") return;

    notifiedRef.current = job.id;

    if (job.status === "completed") {
      if (job.created_count > 0) {
        const failedPart = job.failed_count > 0 ? ` (${job.failed_count} failed)` : "";
        toast.success(`${job.created_count} mailbox${job.created_count !== 1 ? "es" : ""} created${failedPart}`);
      } else if (job.failed_count > 0) {
        toast.error(`All ${job.failed_count} mailbox${job.failed_count !== 1 ? "es" : ""} failed`);
      }
    } else if (job.status === "failed") {
      toast.error(`Provisioning failed: ${job.error_message || "Unknown error"}`);
    }

    queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
    queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
    onComplete?.(job);
  }, [job, jobId, queryClient, currentOrganization?.id, onComplete]);

  return { job };
}

// ============================================================================
// Avatar Sync Jobs
// ============================================================================

export type MailboxAvatarSyncJobStatus = "pending" | "running" | "completed" | "failed";

export interface MailboxAvatarSyncJob {
  id: string;
  organization_id: string;
  status: MailboxAvatarSyncJobStatus;
  total: number;
  processed_index: number;
  synced_count: number;
  current_email: string | null;
  mailbox_ids: string[];
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ email: string; error: string }>;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Start an async job pushing each selected mailbox's stored avatar_url to
 * Microsoft 365 as its Graph profile photo. Returns immediately with the job
 * id; the edge function processes mailboxes in chunks in the background and
 * updates the mailbox_avatar_sync_jobs row as it progresses. Non-M365
 * mailboxes are reported back as skipped rather than treated as failures —
 * there's no external photo store to push to for those. Use
 * useMailboxAvatarSyncJob to poll for progress.
 */
export function useStartMailboxAvatarSyncJob() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (input: { mailboxIds: string[] }): Promise<{ job_id: string }> => {
      const data = await invokeEdgeFunction<{ success: boolean; error?: string; job_id: string }>(
        "infra-mailbox-provision",
        {
          action: "bulk_sync_avatars_async",
          organization_id: currentOrganization?.id,
          mailbox_ids: input.mailboxIds,
        }
      );
      if (!data?.success || !data.job_id) {
        throw new Error(data?.error || "Failed to start Microsoft 365 avatar sync");
      }
      return { job_id: data.job_id };
    },
    onError: (error: Error) => toast.error(`Microsoft 365 avatar sync failed: ${error.message}`),
  });
}

/** Poll a single avatar sync job. Stops polling when terminal. */
export function useMailboxAvatarSyncJob(jobId: string | null) {
  return useQuery({
    queryKey: ["mailbox-avatar-sync-job", jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase
        .from("mailbox_avatar_sync_jobs")
        .select("*")
        .eq("id", jobId)
        .single();
      if (error) throw new Error(`Failed to fetch avatar sync job: ${error.message}`);
      return data as unknown as MailboxAvatarSyncJob;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "pending" || data?.status === "running") return 2000;
      return false;
    },
  });
}

/**
 * Show a toast when an avatar sync job reaches a terminal state and refresh
 * the mailbox list. onComplete fires only once per job id.
 */
export function useWatchMailboxAvatarSyncCompletion(
  jobId: string | null,
  onComplete?: (job: MailboxAvatarSyncJob) => void
) {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: job } = useMailboxAvatarSyncJob(jobId);
  const notifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      notifiedRef.current = null;
      return;
    }
    if (!job || notifiedRef.current === job.id) return;
    if (job.status !== "completed" && job.status !== "failed") return;

    notifiedRef.current = job.id;

    if (job.status === "completed") {
      const syncedCount = job.synced_count;
      const skippedCount = job.skipped.length;
      const errorCount = job.errors.length;

      if (syncedCount > 0) {
        toast.success(`Synced to Microsoft 365 for ${syncedCount} mailbox${syncedCount !== 1 ? "es" : ""}`);
      }
      if (skippedCount > 0 || errorCount > 0) {
        const parts: string[] = [];
        if (skippedCount > 0) parts.push(`${skippedCount} not on Microsoft 365`);
        if (errorCount > 0) parts.push(`${errorCount} failed`);
        toast.warning(`Skipped: ${parts.join(", ")}`);
      }
    } else {
      toast.error("Microsoft 365 avatar sync failed");
    }

    queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
    onComplete?.(job);
  }, [job, jobId, queryClient, currentOrganization?.id, onComplete]);

  return { job };
}

export function useRepairM365MailboxCredentials() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      const data = await invokeEdgeFunction<{ success: boolean; error?: string; status?: string }>(
        "infra-mailbox-provision",
        {
          action: "repair_credentials",
          mailbox_id: mailboxId,
          organization_id: currentOrganization?.id,
        }
      );
      if (!data?.success) throw new Error(data?.error || "Repair failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      if (data.status === "ready") {
        toast.success("Credentials repaired — mailbox is ready");
      } else {
        toast.warning("Credentials regenerated, but SMTP test still failing. Will auto-retest.");
      }
    },
    onError: (error: Error) => toast.error(`Repair failed: ${error.message}`),
  });
}

export function useDeleteM365Mailbox() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async (mailboxId: string) => {
      return await invokeEdgeFunction("infra-mailbox-provision", {
        action: "delete",
        mailbox_id: mailboxId,
        organization_id: currentOrganization?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-mailboxes", currentOrganization?.id] });
      queryClient.invalidateQueries({ queryKey: ["email-sending-domains", currentOrganization?.id] });
      toast.success("Mailbox deleted");
    },
    onError: (error: Error) => toast.error(`Failed to delete mailbox: ${error.message}`),
  });
}
