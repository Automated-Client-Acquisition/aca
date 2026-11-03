import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ScrapeRun {
  actor_id: string | null;
  apify_run_url: string | null;
  completed_at: string | null;
  creator_id: string | null;
  dataset_id: string | null;
  error_message: string | null;
  items_scraped: number | null;
  metadata: any;
  organization_id: string;
  retry_of_run_id: string | null;
  run_id: string;
  schedule_id: string | null;
  search_term_id: string | null;
  status: string;
  triggered_at: string;
}

export interface ScrapeSchedule {
  id: string;
  creator_id: string;
  organization_id: string;
  platform: string;
  schedule_type: string | null;
  cron_expression: string | null;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  scrape_config: any;
  consecutive_failures: number | null;
  auto_pause_on_failure: boolean | null;
  description: string | null;
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
}

export function useCreatorScraping(creatorId: string) {
  const { currentOrganization } = useAuth();

  const { data: scrapeRuns, isLoading: runsLoading } = useQuery({
    queryKey: ["scrape-runs", currentOrganization?.id, creatorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_scrape_runs")
        .select("*")
        .eq("creator_id", creatorId)
        .order("triggered_at", { ascending: false })
        .limit(10);

      if (error) throw error;
      return data as ScrapeRun[];
    },
  });

  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: ["scrape-schedules", currentOrganization?.id, creatorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scrape_schedules")
        .select("*")
        .eq("creator_id", creatorId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as ScrapeSchedule[];
    },
  });

  return {
    scrapeRuns: scrapeRuns || [],
    schedules: schedules || [],
    isLoading: runsLoading || schedulesLoading,
  };
}
