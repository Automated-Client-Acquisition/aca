import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useResetStaleScrape() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (runId: string) => {
      // Directly update the status in the database to FAILED
      // This is for runs where the Apify webhook never came through
      const { error } = await supabase
        .from('research_scrape_runs')
        .update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
          error_message: 'Manually reset - webhook not received (check Apify webhook configuration)',
        })
        .eq('run_id', runId)
        .eq('status', 'RUNNING'); // Only reset if still running

      if (error) throw error;
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scrape-runs'] });
      queryClient.invalidateQueries({ queryKey: ['active-scrapes'] });
      queryClient.invalidateQueries({ queryKey: ['scraping-activity'] });
      queryClient.invalidateQueries({ queryKey: ['recent-failures'] });
      toast.success("Scrape reset successfully", {
        description: "The stale scrape has been marked as failed",
        duration: 3000,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to reset scrape", {
        description: error.message,
        duration: 5000,
      });
    },
  });
}

// Hook to reset all stale scrapes at once
export function useResetAllStaleScrapes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (olderThanHours: number = 2) => {
      const cutoffTime = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('research_scrape_runs')
        .update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
          error_message: `Auto-reset - stuck in RUNNING for over ${olderThanHours} hours (check Apify webhook configuration)`,
        })
        .eq('status', 'RUNNING')
        .lt('triggered_at', cutoffTime)
        .select('run_id');

      if (error) throw error;
      return { resetCount: data?.length || 0 };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['scrape-runs'] });
      queryClient.invalidateQueries({ queryKey: ['active-scrapes'] });
      queryClient.invalidateQueries({ queryKey: ['scraping-activity'] });
      queryClient.invalidateQueries({ queryKey: ['recent-failures'] });

      if (result.resetCount > 0) {
        toast.success(`Reset ${result.resetCount} stale scrape(s)`, {
          description: "Stale scrapes have been marked as failed",
          duration: 3000,
        });
      } else {
        toast.info("No stale scrapes to reset", {
          duration: 3000,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Failed to reset stale scrapes", {
        description: error.message,
        duration: 5000,
      });
    },
  });
}
