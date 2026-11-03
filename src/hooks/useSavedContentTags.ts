import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Fetches all distinct tags from library_saved_content for the current organization.
 * Returns a sorted array of unique tag strings.
 */
export function useSavedContentTags() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["saved-content-tags", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("library_saved_content")
        .select("tags")
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;

      // Flatten all tags arrays and deduplicate
      const allTags = (data || []).flatMap((row) => row.tags || []);
      return [...new Set(allTags)].sort();
    },
    enabled: !!currentOrganization,
  });
}
