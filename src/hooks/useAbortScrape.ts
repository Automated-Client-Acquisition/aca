import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useAbortScrape() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (runId: string) => {
      const { data, error } = await supabase.functions.invoke('abort-scrape', {
        body: { runId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scrape-runs'] });
      queryClient.invalidateQueries({ queryKey: ['active-scrapes'] });
      queryClient.invalidateQueries({ queryKey: ['scraping-activity'] });
      toast.success("Scrape aborted successfully", {
        duration: 3000,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to abort scrape", {
        description: error.message,
        duration: 5000,
      });
    },
  });
}
