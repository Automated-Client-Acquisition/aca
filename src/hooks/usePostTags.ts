import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PostTag {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export function usePostTags() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const { data: tags, isLoading, error } = useQuery({
    queryKey: ["post-tags", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_tags")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return data as PostTag[];
    },
    enabled: !!currentOrganization,
  });

  const createTag = useMutation({
    mutationFn: async (newTag: Partial<PostTag>) => {
      const { data, error } = await supabase
        .from("post_tags")
        .insert([newTag as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-tags"] });
      toast.success("Tag created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create tag: ${error.message}`);
    },
  });

  const updateTag = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<PostTag> }) => {
      const { data, error } = await supabase
        .from("post_tags")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-tags"] });
      toast.success("Tag updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update tag: ${error.message}`);
    },
  });

  const deleteTag = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("post_tags")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["post-tags"] });
      toast.success("Tag deleted successfully");
    },
    onError: (error) => {
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
