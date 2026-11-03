import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface IdeaFolder {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Hook to fetch all idea folders from the idea_folders table
 * RLS filters by organization, query key includes org ID to handle org switching/impersonation
 */
export function useIdeaFolders() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["idea-folders", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("idea_folders")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;
      return data as IdeaFolder[];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to get ideas count by folder
 * Returns a record mapping folder IDs to their idea counts, plus uncategorized count
 */
export function useIdeasCountByFolder() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["ideas-count-by-folder", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return { folders: {} as Record<string, number>, uncategorized: 0 };

      // Get all ideas with their folder_id
      const { data, error } = await supabase
        .from("content_ideas")
        .select("folder_id")
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;

      const folderCounts: Record<string, number> = {};
      let uncategorized = 0;

      data?.forEach((idea: { folder_id: string | null }) => {
        if (idea.folder_id) {
          folderCounts[idea.folder_id] = (folderCounts[idea.folder_id] || 0) + 1;
        } else {
          uncategorized++;
        }
      });

      return {
        folders: folderCounts,
        uncategorized,
      };
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}
