import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import type { SearchTermFormData } from "@/lib/validations";
import { useAuth } from "@/contexts/AuthContext";

export function useCreateSearchTerm() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (data: SearchTermFormData) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization?.id) throw new Error("No organization selected");
      const organizationId = currentOrganization.id;

      // Insert search term
      const { data: searchTerm, error } = await supabase
        .from("research_search_terms")
        .insert({
          id: crypto.randomUUID(),
          search_term: data.searchTerm,
          platform: data.platform,
          tags: data.tags || null,
          notes: data.notes || null,
          organization_id: organizationId,
        })
        .select()
        .single();

      if (error) throw error;

      if (data.scrapeImmediately) {
        try {
          const { data: scrapeResult, error: scrapeError } = await supabase.functions.invoke('trigger-scrape', {
            body: {
              type: 'search_term',
              targetId: searchTerm.id,
              organizationId,
              options: {
                maxItems: data.maxResults || 50,
              }
            }
          });
          if (scrapeError) throw scrapeError;
          if (scrapeResult?.error || scrapeResult?.success === false) {
            throw new Error(scrapeResult.error || scrapeResult.message || 'Scraping could not be started');
          }
          if (scrapeResult?.skipped) {
            toast({
              title: "Search term added; scrape skipped",
              description: scrapeResult.reason || "You can start a scrape from the search term's details.",
            });
          } else {
            toast({
              title: "Search term added and scrape started!",
              description: `"${searchTerm.search_term}" is being searched on ${searchTerm.platform}.`,
            });
          }
        } catch (error) {
          console.error('[Create Search Term] Failed to trigger scrape:', error);
          toast({
            title: "Search term added, but scraping could not start",
            description: `${error instanceof Error ? error.message : 'Please try scraping again'} You can retry from the search term's details.`,
            variant: "destructive",
          });
        }
      }

      return searchTerm;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["research-search-terms"] });
      
      if (!variables.scrapeImmediately) {
        toast({
          title: "Search term added successfully!",
          description: `"${data.search_term}" has been added to your search terms.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to add search term",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
