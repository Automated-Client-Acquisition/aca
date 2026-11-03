import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface SearchTerm {
  id: string;
  search_term: string;
  platform: string;
  tags: string[] | null;
  notes: string | null;
  total_results: number | null;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
  organization_id: string;
  converted_ideas_count?: number;
}

export function useSearchTerms() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  const { data: searchTerms, isLoading, error } = useQuery({
    queryKey: ["research-search-terms", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_search_terms")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as SearchTerm[];
    },
    enabled: !!currentOrganization,
  });

  const deleteSearchTerm = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization selected");
      const { error } = await supabase
        .from("research_search_terms")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-search-terms"] });
      toast.success("Search term deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete search term: ${error.message}`);
    },
  });

  const deleteBulkSearchTerms = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error("No organization selected");
      await chunkedMutate(ids, (chunk) =>
        supabase.from("research_search_terms").delete().in("id", chunk).eq("organization_id", currentOrganization.id)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["research-search-terms"] });
      toast.success(`Successfully deleted ${ids.length} search term${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete search terms: ${error.message}`);
    },
  });

  return {
    searchTerms: searchTerms || [],
    isLoading,
    error,
    deleteSearchTerm: (id: string) => deleteSearchTerm.mutate(id),
    deleteBulkSearchTerms: (ids: string[]) => deleteBulkSearchTerms.mutate(ids),
    isDeleting: deleteSearchTerm.isPending,
    isDeletingBulk: deleteBulkSearchTerms.isPending,
  };
}
