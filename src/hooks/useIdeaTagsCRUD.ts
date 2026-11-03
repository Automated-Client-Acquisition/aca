import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface IdeaTag {
  id: string;
  organization_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function useIdeaTagsCRUD() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  const { data: tags, isLoading, error } = useQuery({
    queryKey: ["idea-tags", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("idea_tags")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("name", { ascending: true });

      if (error) throw error;
      return data as IdeaTag[];
    },
    enabled: !!currentOrganization,
  });

  const createTag = useMutation({
    mutationFn: async (name: string) => {
      if (!currentOrganization?.id) throw new Error("No organization found");

      const { data, error } = await supabase
        .from("idea_tags")
        .insert([{ name: name.trim(), organization_id: currentOrganization.id }])
        .select()
        .single();

      if (error) throw error;
      return data as IdeaTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-tags"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      toast.success("Tag created successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("A tag with this name already exists");
      } else {
        toast.error(`Failed to create tag: ${error.message}`);
      }
    },
  });

  const updateTag = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { data, error } = await supabase
        .from("idea_tags")
        .update({ name: name.trim() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as IdeaTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-tags"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      toast.success("Tag updated successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("A tag with this name already exists");
      } else {
        toast.error(`Failed to update tag: ${error.message}`);
      }
    },
  });

  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("idea_tags")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-tags"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments"] });
      toast.success("Tag deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete tag: ${error.message}`);
    },
  });

  return {
    tags: tags || [],
    isLoading,
    error,
    createTag,
    updateTag,
    deleteTag,
    isCreating: createTag.isPending,
    isUpdating: updateTag.isPending,
    isDeleting: deleteTag.isPending,
  };
}

/**
 * Hook to get count of ideas for each tag
 * Explicitly filters by organization_id to ensure correct data when impersonating
 */
export function useIdeasCountByTag() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["ideas-count-by-tag", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return {};

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .select(`
          tag_id,
          idea_tags!inner(id, name, organization_id)
        `)
        .eq("idea_tags.organization_id", currentOrganization.id);

      if (error) throw error;

      const tagCounts: Record<string, number> = {};
      data?.forEach((assignment: any) => {
        const tagId = assignment.tag_id;
        if (tagId) {
          tagCounts[tagId] = (tagCounts[tagId] || 0) + 1;
        }
      });
      return tagCounts;
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}
