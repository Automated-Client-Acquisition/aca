import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CombinedTag {
  name: string;
  sources: ("saved_content" | "ideas")[];
}

/**
 * Fetches tags from both library_saved_content and idea_tags,
 * merges them into a deduplicated list with source indicators.
 * Used by the SavedContentTagSelector so users can pick from both tag pools.
 */
export function useCombinedContentTags() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["combined-content-tags", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Fetch both tag sources in parallel
      const [savedContentResult, ideaTagsResult] = await Promise.all([
        supabase
          .from("library_saved_content")
          .select("tags")
          .eq("organization_id", currentOrganization.id),
        supabase
          .from("idea_tags")
          .select("name")
          .eq("organization_id", currentOrganization.id)
          .order("name", { ascending: true }),
      ]);

      // Collect saved content tags
      const savedContentTags = new Set<string>();
      if (!savedContentResult.error && savedContentResult.data) {
        for (const row of savedContentResult.data) {
          for (const tag of row.tags || []) {
            savedContentTags.add(tag);
          }
        }
      }

      // Collect idea tags
      const ideaTags = new Set<string>();
      if (!ideaTagsResult.error && ideaTagsResult.data) {
        for (const row of ideaTagsResult.data) {
          ideaTags.add(row.name);
        }
      }

      // Merge into combined list with source indicators
      const allTagNames = new Set([...savedContentTags, ...ideaTags]);
      const combined: CombinedTag[] = [];

      for (const name of allTagNames) {
        const sources: ("saved_content" | "ideas")[] = [];
        if (savedContentTags.has(name)) sources.push("saved_content");
        if (ideaTags.has(name)) sources.push("ideas");
        combined.push({ name, sources });
      }

      return combined.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!currentOrganization,
  });
}
