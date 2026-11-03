import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import type {
  SavedContent,
  SavedContentType,
  CreateSavedContentInput,
  UpdateSavedContentInput,
  SavedContentData
} from "@/types/savedContent";

export function useSavedContent(contentType?: SavedContentType) {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: savedContent, isLoading, error } = useQuery({
    queryKey: contentType
      ? ["library-saved-content", currentOrganization?.id, contentType]
      : ["library-saved-content", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      let query = supabase
        .from("library_saved_content")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (contentType) {
        query = query.eq("content_type", contentType);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data.map(item => ({
        ...item,
        content: item.content as SavedContentData,
        linked_brand_voice_ids: item.linked_brand_voice_ids || [],
        linked_character_ids: item.linked_character_ids || [],
        linked_product_ids: item.linked_product_ids || [],
        linked_icp_ids: item.linked_icp_ids || [],
        tags: item.tags || [],
        is_favorite: item.is_favorite || false,
        usage_count: item.usage_count || 0,
      })) as SavedContent[];
    },
  });

  const createSavedContent = useMutation({
    mutationFn: async (input: CreateSavedContentInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_saved_content")
        .insert([{
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description,
          content_type: input.content_type,
          content: input.content,
          source_output_id: input.source_output_id,
          source_job_id: input.source_job_id,
          source_stage: input.source_stage,
          linked_brand_voice_ids: input.linked_brand_voice_ids || [],
          linked_character_ids: input.linked_character_ids || [],
          linked_product_ids: input.linked_product_ids || [],
          linked_icp_ids: input.linked_icp_ids || [],
          tags: input.tags || [],
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-saved-content", currentOrganization?.id] });
      toast.success("Content saved to library");
    },
    onError: (error) => {
      toast.error(`Failed to save content: ${error.message}`);
    },
  });

  const updateSavedContent = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateSavedContentInput }) => {
      const { data, error } = await supabase
        .from("library_saved_content")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-saved-content", currentOrganization?.id] });
      toast.success("Saved content updated");
    },
    onError: (error) => {
      toast.error(`Failed to update saved content: ${error.message}`);
    },
  });

  const deleteSavedContent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_saved_content")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-saved-content", currentOrganization?.id] });
      toast.success("Saved content deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete saved content: ${error.message}`);
    },
  });

  const deleteBulkSavedContent = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_saved_content").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["library-saved-content", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete items: ${error.message}`);
    },
  });

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const { data, error } = await supabase
        .from("library_saved_content")
        .update({ is_favorite: isFavorite })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { isFavorite }) => {
      queryClient.invalidateQueries({ queryKey: ["library-saved-content", currentOrganization?.id] });
      toast.success(isFavorite ? "Added to favorites" : "Removed from favorites");
    },
    onError: (error) => {
      toast.error(`Failed to update favorite: ${error.message}`);
    },
  });

  return {
    savedContent: savedContent || [],
    isLoading,
    error,
    createSavedContent: (data: CreateSavedContentInput) => createSavedContent.mutateAsync(data),
    updateSavedContent: (id: string, updates: UpdateSavedContentInput) =>
      updateSavedContent.mutate({ id, updates }),
    deleteSavedContent: (id: string) => deleteSavedContent.mutate(id),
    deleteBulkSavedContent: (ids: string[]) => deleteBulkSavedContent.mutate(ids),
    toggleFavorite: (id: string, isFavorite: boolean) => toggleFavorite.mutate({ id, isFavorite }),
    isCreating: createSavedContent.isPending,
    isUpdating: updateSavedContent.isPending,
    isDeleting: deleteSavedContent.isPending,
    isDeletingBulk: deleteBulkSavedContent.isPending,
  };
}
