import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface IdeaTag {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch all idea tags from the idea_tags table
 * Used for tag-based filtering in autopilot configurations
 * RLS filters by organization, query key includes org ID to handle org switching/impersonation
 */
export function useIdeaTags() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["idea-tags", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id in addition to RLS
      // This ensures correct data when impersonating another organization
      const { data, error } = await supabase
        .from("idea_tags")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("name", { ascending: true });

      if (error) throw error;
      return data as IdeaTag[];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

/**
 * Hook to get tag names only (for backward compatibility)
 * Returns an array of tag names sorted alphabetically
 */
export function useIdeaTagNames() {
  const { data: tags, ...rest } = useIdeaTags();
  return {
    ...rest,
    data: tags?.map((tag) => tag.name) || [],
  };
}

/**
 * Hook to get ideas count by tag
 * Returns a record mapping tag names to their idea counts
 * Explicitly filters by organization to ensure correct data when impersonating
 */
export function useIdeasCountByTag() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["ideas-count-by-tag", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return {};

      // Filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .select(`
          tag_id,
          idea_tags!inner(name, organization_id)
        `)
        .eq("idea_tags.organization_id", currentOrganization.id);

      if (error) throw error;

      // Count occurrences of each tag name
      const tagCounts: Record<string, number> = {};
      data?.forEach((assignment: any) => {
        const tagName = assignment.idea_tags?.name;
        if (tagName) {
          tagCounts[tagName] = (tagCounts[tagName] || 0) + 1;
        }
      });

      return tagCounts;
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}
