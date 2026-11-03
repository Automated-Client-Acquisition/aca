import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";

type GenerationJob = Database['public']['Tables']['content_generation_jobs']['Row'];

export type SortOption = "date_desc" | "date_asc" | "name_asc" | "name_desc";
export type DateRangeOption = "all" | "today" | "week" | "month";

interface UseGenerationJobsOptions {
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: SortOption;
  dateRange?: DateRangeOption;
}

function getDateRangeFilter(dateRange: DateRangeOption): Date | null {
  const now = new Date();
  switch (dateRange) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "week": {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return weekAgo;
    }
    case "month": {
      const monthAgo = new Date(now);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return monthAgo;
    }
    default:
      return null;
  }
}

export function useGenerationJobs(options: UseGenerationJobsOptions = {}) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const {
    status,
    page = 1,
    pageSize = 20,
    sortBy = "date_desc",
    dateRange = "all"
  } = options;

  const query = useQuery({
    queryKey: ['generation-jobs', status, page, pageSize, sortBy, dateRange, currentOrganization?.id],
    queryFn: async () => {
      // Determine sort column and direction
      const sortColumn = sortBy.startsWith("name") ? "name" : "created_at";
      const ascending = sortBy.endsWith("_asc");

      let query = supabase
        .from('content_generation_jobs')
        .select('*', { count: 'exact' })
        .eq('organization_id', currentOrganization!.id)
        .order(sortColumn, { ascending, nullsFirst: false });

      if (status) {
        query = query.eq('status', status);
      }

      // Apply date range filter
      const dateFilter = getDateRangeFilter(dateRange);
      if (dateFilter) {
        query = query.gte('created_at', dateFilter.toISOString());
      }

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;

      if (error) throw error;
      return {
        jobs: data as GenerationJob[],
        totalCount: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize)
      };
    },
    enabled: !!currentOrganization,
  });

  // Set up real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel('generation-jobs-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'content_generation_jobs',
        },
        (payload) => {
          console.log('Job update received:', payload);
          queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
          queryClient.invalidateQueries({ queryKey: ['generation-jobs-stats'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}

// Hook to get job stats (counts by status) - used for filter badges
export function useGenerationJobStats() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['generation-jobs-stats', currentOrganization?.id],
    queryFn: async () => {
      // Use head-only exact counts instead of pulling every row into the client.
      // PostgREST caps a normal select at its max-rows limit (1000), which would
      // freeze these counts at 1000 for any org with more than 1000 jobs.
      const baseCount = (status?: string) => {
        let q = supabase
          .from('content_generation_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', currentOrganization!.id);
        if (status) q = q.eq('status', status);
        return q;
      };

      const [total, processing, completed, failed, queued] = await Promise.all([
        baseCount(),
        baseCount('processing'),
        baseCount('completed'),
        baseCount('failed'),
        baseCount('queued'),
      ]);

      const firstError = total.error || processing.error || completed.error || failed.error || queued.error;
      if (firstError) throw firstError;

      return {
        total: total.count || 0,
        processing: processing.count || 0,
        completed: completed.count || 0,
        failed: failed.count || 0,
        queued: queued.count || 0,
      };
    },
    enabled: !!currentOrganization,
  });
}

/**
 * Hook to retry a failed or stuck job by re-dispatching it.
 * Resets job status to 'queued' and invokes dispatch-generation-job.
 */
export function useRetryJobDispatch() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      // First, reset job status to 'queued' and clear error
      const { error: resetError } = await supabase
        .from('content_generation_jobs')
        .update({
          status: 'queued',
          error: null,
          started_at: null,
          completed_at: null,
        })
        .eq('id', jobId)
        .eq('organization_id', currentOrganization.id);

      if (resetError) {
        throw new Error(`Failed to reset job: ${resetError.message}`);
      }

      // Delete existing outputs so dispatch creates fresh ones (prevents duplicates)
      const { error: deleteError } = await supabase
        .from('content_outputs')
        .delete()
        .eq('job_id', jobId);

      if (deleteError) {
        console.error('Failed to clean up existing outputs:', deleteError.message);
        // Don't throw — dispatch will still work, just may create duplicates
      }

      // Reset job progress to 0
      await supabase
        .from('content_generation_jobs')
        .update({ progress: 0 })
        .eq('id', jobId)
        .eq('organization_id', currentOrganization.id);

      // Then dispatch again
      const { data, error: dispatchError } = await supabase.functions.invoke(
        'dispatch-generation-job',
        { body: { job_id: jobId } }
      );

      if (dispatchError) {
        // Update job with the new error
        await supabase.from('content_generation_jobs')
          .update({
            status: 'failed',
            error: `Retry failed: ${dispatchError.message}`
          })
          .eq('id', jobId)
          .eq('organization_id', currentOrganization.id);
        throw new Error(`Dispatch failed: ${dispatchError.message}`);
      }

      if (data && !data.success) {
        await supabase.from('content_generation_jobs')
          .update({
            status: 'failed',
            error: `Retry failed: ${data.error || 'Unknown error'}`
          })
          .eq('id', jobId)
          .eq('organization_id', currentOrganization.id);
        throw new Error(data.error || 'Dispatch failed');
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-jobs-stats'] });
      toast.success('Job retry initiated successfully');
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['generation-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-jobs-stats'] });
      toast.error(error instanceof Error ? error.message : 'Failed to retry job');
    },
  });
}
