import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

interface ActiveScrape {
  run_id: string;
  status: string;
  creator_id: string | null;
  search_term_id: string | null;
  actor_id: string;
  triggered_at: string;
  items_scraped: number | null;
}

interface UseActiveScrapsesOptions {
  targetType?: 'creator' | 'search_term';
  targetId?: string;
}

export function useActiveScrapes(options?: UseActiveScrapsesOptions) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['active-scrapes', currentOrganization?.id, options?.targetType, options?.targetId],
    queryFn: async () => {
      let query = supabase
        .from('research_scrape_runs')
        .select('*')
        .in('status', ['RUNNING', 'PROCESSING'])
        .order('triggered_at', { ascending: false });

      if (options?.targetType === 'creator' && options?.targetId) {
        query = query.eq('creator_id', options.targetId);
      } else if (options?.targetType === 'search_term' && options?.targetId) {
        query = query.eq('search_term_id', options.targetId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    },
    refetchInterval: 10000, // Fallback polling every 10s
    enabled: !!currentOrganization,
  });

  // Subscribe to realtime changes
  useEffect(() => {
    const channel = supabase
      .channel('active-scrapes-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'research_scrape_runs',
        },
        (payload) => {
          // Invalidate query to refetch
          queryClient.invalidateQueries({ queryKey: ['active-scrapes'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, currentOrganization?.id]);

  return {
    activeScrapes: query.data || [],
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
