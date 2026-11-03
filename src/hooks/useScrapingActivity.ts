import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";
import { subHours } from "date-fns";

interface ScrapingActivity {
  activeScrapes: number;
  activeSchedulesCount: number;
  nextScheduledRun: string | null;
  recentCompletions: number;
}

export function useScrapingActivity() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['scraping-activity'],
    queryFn: async () => {
      // Count active scrapes (gracefully handle if table has no RLS policy)
      const { count: activeScrapes, error: activeError } = await supabase
        .from('research_scrape_runs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['RUNNING', 'PROCESSING']);

      // Count active scrape schedules
      const { count: activeCreatorSchedules } = await supabase
        .from('scrape_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Count active search schedules
      const { count: activeSearchSchedules } = await supabase
        .from('search_schedules')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Get next scheduled run (earliest from both tables)
      const { data: nextCreatorRun } = await supabase
        .from('scrape_schedules')
        .select('next_run_at')
        .eq('is_active', true)
        .order('next_run_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: nextSearchRun } = await supabase
        .from('search_schedules')
        .select('next_run_at')
        .eq('is_active', true)
        .order('next_run_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      let nextScheduledRun: string | null = null;
      if (nextCreatorRun && nextSearchRun) {
        nextScheduledRun = new Date(nextCreatorRun.next_run_at) < new Date(nextSearchRun.next_run_at)
          ? nextCreatorRun.next_run_at
          : nextSearchRun.next_run_at;
      } else if (nextCreatorRun) {
        nextScheduledRun = nextCreatorRun.next_run_at;
      } else if (nextSearchRun) {
        nextScheduledRun = nextSearchRun.next_run_at;
      }

      // Count recent completions (last 24h) — skip if active scrapes query failed (table issue)
      let recentCompletions = 0;
      if (!activeError) {
        const { count } = await supabase
          .from('research_scrape_runs')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'SUCCEEDED')
          .gte('completed_at', subHours(new Date(), 24).toISOString());
        recentCompletions = count || 0;
      }

      return {
        activeScrapes: activeError ? 0 : (activeScrapes || 0),
        activeSchedulesCount: (activeCreatorSchedules || 0) + (activeSearchSchedules || 0),
        nextScheduledRun,
        recentCompletions,
      } as ScrapingActivity;
    },
    // Remove refetchInterval - rely on real-time subscription instead
    // Real-time updates will invalidate queries automatically
  });

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel('scraping-activity-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'research_scrape_runs',
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['scraping-activity'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    ...query.data,
    isLoading: query.isLoading,
  };
}
