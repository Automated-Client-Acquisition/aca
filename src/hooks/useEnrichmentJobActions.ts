import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Hook to cancel a pending enrichment job
 */
export function useCancelEnrichmentJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("enrichment_jobs")
        .update({ status: "skipped", error_message: "Cancelled by user" })
        .eq("id", jobId)
        .eq("status", "pending"); // Can only cancel pending jobs

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["enrichment-job-stats"] });
      toast.success("Enrichment job cancelled");
    },
    onError: (error) => {
      console.error("Failed to cancel job:", error);
      toast.error("Failed to cancel enrichment job");
    },
  });
}

/**
 * Hook to retry a failed enrichment job
 */
export function useRetryEnrichmentJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from("enrichment_jobs")
        .update({
          status: "pending",
          error_message: null,
          attempts: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("status", "failed");

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["enrichment-job-stats"] });
      toast.success("Job queued for retry");
    },
    onError: (error) => {
      console.error("Failed to retry job:", error);
      toast.error("Failed to retry enrichment job");
    },
  });
}

/**
 * Hook to retry all failed jobs
 */
export function useRetryAllFailedJobs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("enrichment_jobs")
        .update({
          status: "pending",
          error_message: null,
          attempts: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", currentOrganization.id)
        .eq("status", "failed")
        .select("id");

      if (error) throw error;

      return data?.length || 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["enrichment-job-stats"] });
      if (count > 0) {
        toast.success(`Retrying ${count} failed jobs`);
      } else {
        toast.info("No failed jobs to retry");
      }
    },
    onError: (error) => {
      console.error("Failed to retry jobs:", error);
      toast.error("Failed to retry failed jobs");
    },
  });
}

/**
 * Hook to cancel all pending jobs
 */
export function useCancelAllPendingJobs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async () => {
      if (!currentOrganization) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("enrichment_jobs")
        .update({
          status: "skipped",
          error_message: "Cancelled by user",
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", currentOrganization.id)
        .eq("status", "pending")
        .select("id");

      if (error) throw error;

      return data?.length || 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["enrichment-job-stats"] });
      if (count > 0) {
        toast.success(`Cancelled ${count} pending jobs`);
      } else {
        toast.info("No pending jobs to cancel");
      }
    },
    onError: (error) => {
      console.error("Failed to cancel jobs:", error);
      toast.error("Failed to cancel pending jobs");
    },
  });
}

/**
 * Hook to clear completed jobs older than a specified time
 */
export function useClearCompletedJobs() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (olderThanDays: number = 7) => {
      if (!currentOrganization) throw new Error("No organization selected");

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const { data, error } = await supabase
        .from("enrichment_jobs")
        .delete()
        .eq("organization_id", currentOrganization.id)
        .in("status", ["completed", "skipped"])
        .lt("updated_at", cutoffDate.toISOString())
        .select("id");

      if (error) throw error;

      return data?.length || 0;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["enrichment-job-stats"] });
      if (count > 0) {
        toast.success(`Cleared ${count} old completed jobs`);
      } else {
        toast.info("No old completed jobs to clear");
      }
    },
    onError: (error) => {
      console.error("Failed to clear jobs:", error);
      toast.error("Failed to clear completed jobs");
    },
  });
}

/**
 * Hook to update job priority
 */
export function useUpdateJobPriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, priority }: { jobId: string; priority: number }) => {
      const { error } = await supabase
        .from("enrichment_jobs")
        .update({ priority, updated_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["enrichment-jobs"] });
      toast.success("Job priority updated");
    },
    onError: (error) => {
      console.error("Failed to update priority:", error);
      toast.error("Failed to update job priority");
    },
  });
}

/**
 * Hook to get enrichment jobs with pagination
 */
export function useEnrichmentJobsPaginated(
  status: "pending" | "processing" | "completed" | "failed" | "all" = "all",
  page: number = 1,
  pageSize: number = 20
) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-jobs-paginated", currentOrganization?.id, status, page, pageSize],
    queryFn: async () => {
      if (!currentOrganization) return { jobs: [], total: 0 };

      // Build query
      let query = supabase
        .from("enrichment_jobs")
        .select(
          `
          *,
          contact:crm_contacts (
            id,
            display_name,
            avatar_url,
            primary_email,
            primary_phone,
            company
          )
        `,
          { count: "exact" }
        )
        .eq("organization_id", currentOrganization.id);

      if (status !== "all") {
        query = query.eq("status", status);
      }

      // Order and paginate
      query = query
        .order("priority", { ascending: true })
        .order("created_at", { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      return {
        jobs: data || [],
        total: count || 0,
      };
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Hook to get recent enrichment history
 */
export function useEnrichmentHistoryRecent(limit: number = 50) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["enrichment-history-recent", currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("enrichment_history")
        .select(
          `
          *,
          contact:crm_contacts (
            id,
            display_name,
            avatar_url,
            primary_email,
            primary_phone
          )
        `
        )
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    },
    enabled: !!currentOrganization,
  });
}
