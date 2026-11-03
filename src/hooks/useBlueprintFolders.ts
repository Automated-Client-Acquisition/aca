import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface BlueprintFolder {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function useBlueprintFolders() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["blueprint-folders", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("blueprint_folders")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw error;
      return data as BlueprintFolder[];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBlueprintsCountByFolder() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["blueprints-count-by-folder", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return { folders: {} as Record<string, number>, uncategorized: 0 };

      const { data, error } = await supabase
        .from("blueprints")
        .select("folder_id")
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;

      const folderCounts: Record<string, number> = {};
      let uncategorized = 0;

      data?.forEach((bp: { folder_id: string | null }) => {
        if (bp.folder_id) {
          folderCounts[bp.folder_id] = (folderCounts[bp.folder_id] || 0) + 1;
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
