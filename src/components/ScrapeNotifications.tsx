import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

export function ScrapeNotifications() {
  const processedIds = useRef(new Set<string>());
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('scrape-notifications')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'research_scrape_runs',
        },
        async (payload) => {
          const scrape = payload.new as any;
          const eventType = payload.eventType;

          // Deduplicate notifications
          const notificationKey = `${scrape.id}-${scrape.status}`;
          if (processedIds.current.has(notificationKey)) return;
          processedIds.current.add(notificationKey);

          // Clean up old processed IDs (keep last 100)
          if (processedIds.current.size > 100) {
            const arr = Array.from(processedIds.current);
            processedIds.current = new Set(arr.slice(-100));
          }

          // Fetch target name from related tables
          let targetName = 'Unknown';
          if (scrape.creator_id) {
            const { data: creator } = await supabase
              .from('research_creators')
              .select('display_name')
              .eq('id', scrape.creator_id)
              .single();
            targetName = creator?.display_name || 'Unknown';
          } else if (scrape.search_term_id) {
            const { data: searchTerm } = await supabase
              .from('research_search_terms')
              .select('search_term')
              .eq('id', scrape.search_term_id)
              .single();
            targetName = searchTerm?.search_term || 'Unknown';
          }

          // Handle different statuses
          if (eventType === 'UPDATE' && scrape.status === 'SUCCEEDED') {
            toast.success('Scrape completed!', {
              id: scrape.id,
              description: `${targetName} • ${scrape.items_scraped || 0} items found`,
              icon: <CheckCircle2 className="h-4 w-4" />,
              duration: 5000,
            });
            // Invalidate caches to refresh table data (avatar, stats, etc.)
            if (scrape.creator_id) {
              queryClient.invalidateQueries({ queryKey: ["research-creators"] });
            }
            if (scrape.search_term_id) {
              queryClient.invalidateQueries({ queryKey: ["search-terms"] });
            }
            queryClient.invalidateQueries({ queryKey: ["active-scrapes"] });
          } else if (eventType === 'UPDATE' && scrape.status === 'FAILED') {
            toast.error('Scrape failed', {
              id: scrape.id,
              description: `${targetName} • ${scrape.error_message || 'Unknown error'}`,
              icon: <XCircle className="h-4 w-4" />,
              duration: 7000,
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
