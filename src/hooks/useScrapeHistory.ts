import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ScrapeRun {
  run_id: string;
  apify_run_id: string | null;
  organization_id: string;
  creator_id: string | null;
  search_term_id: string | null;
  status: string;
  triggered_at: string;
  completed_at: string | null;
  items_scraped: number | null;
  error_message: string | null;
  metadata: any;
  dataset_id: string | null;
  actor_id: string | null;
  schedule_id: string | null;
  retry_of_run_id: string | null;
  apify_run_url: string | null;
}

export function useScrapeHistory(type: 'creator' | 'search_term', targetId: string) {
  const { currentOrganization } = useAuth();
  const idField = type === 'creator' ? 'creator_id' : 'search_term_id';

  const { data: history, isLoading } = useQuery({
    queryKey: ['scrape-history', currentOrganization?.id, type, targetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_scrape_runs')
        .select('*')
        .eq("organization_id", currentOrganization!.id)
        .eq(idField, targetId)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as ScrapeRun[];
    },
    enabled: !!currentOrganization && !!targetId,
  });

  return {
    history: history || [],
    isLoading,
  };
}
