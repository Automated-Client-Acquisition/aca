import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from "@supabase/supabase-js";
import { useAuth } from "@/contexts/AuthContext";

interface TriggerScrapeParams {
  type: 'creator' | 'search_term';
  targetId: string;
  targetName: string;
  options?: {
    maxItems?: number;
    maxShorts?: number;
    daysBack?: number;
    forceRefresh?: boolean;
    scrapeProfile?: boolean;
    minIntervalMinutes?: number;
  };
}

export function useTriggerScrape() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ type, targetId, options = {} }: TriggerScrapeParams) => {
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase.functions.invoke('trigger-scrape', {
        body: { type, targetId, options, organizationId: currentOrganization.id }
      });

      if (error) {
        // Extract meaningful error message based on error type
        if (error instanceof FunctionsHttpError) {
          const errorBody = await error.context.json();
          throw new Error(errorBody?.error || 'Edge function returned an error');
        } else if (error instanceof FunctionsRelayError) {
          throw new Error(`Network error: ${error.message}`);
        } else if (error instanceof FunctionsFetchError) {
          throw new Error(`Could not reach server: ${error.message}`);
        }
        throw error;
      }
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['scrape-runs'] });
      queryClient.invalidateQueries({ queryKey: ['active-scrapes'] });
      queryClient.invalidateQueries({ queryKey: ['scraping-activity'] });
      if (variables.type === 'creator') {
        queryClient.invalidateQueries({ queryKey: ['scrape-runs', variables.targetId] });
      }

      if (data?.skipped) {
        toast.info("Scrape skipped", {
          description: data.reason ?? `${variables.targetName} was scraped recently.`,
          duration: 5000,
        });
        return;
      }

      toast.success("Scrape initiated", {
        description: `Started scraping ${variables.targetName}`,
        duration: 3000,
      });
    },
    onError: (error: Error, variables) => {
      // Check if this is a missing API key error and provide helpful guidance
      const isMissingApiKey = error.message?.toLowerCase().includes('api key not found');

      toast.error("Failed to start scrape", {
        description: isMissingApiKey
          ? "Please add your Apify API key in Settings → API Keys to enable scraping."
          : error.message,
        duration: isMissingApiKey ? 8000 : 5000,
        action: isMissingApiKey ? {
          label: "Go to Settings",
          onClick: () => window.location.href = "/settings"
        } : undefined,
      });
    },
  });
}
