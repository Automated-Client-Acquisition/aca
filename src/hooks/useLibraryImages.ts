import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface LibraryImage {
  id: string;
  name: string;
  images: string[];
  tags: string[];
  organization_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export function useLibraryImages() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: libraryImages, isLoading, error } = useQuery({
    queryKey: ["library-images", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("library_images")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as LibraryImage[];
    },
  });

  const createLibraryImage = useMutation({
    mutationFn: async (newLibraryImage: Partial<LibraryImage>) => {
      if (!user) throw new Error('User not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      const { data, error } = await supabase
        .from("library_images")
        .insert([{ ...newLibraryImage, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-images", currentOrganization?.id] });
      toast.success("Images added successfully");
    },
    onError: (error) => {
      toast.error(`Failed to add images: ${error.message}`);
    },
  });

  const updateLibraryImage = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<LibraryImage> }) => {
      const { data, error } = await supabase
        .from("library_images")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-images", currentOrganization?.id] });
      toast.success("Images updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update images: ${error.message}`);
    },
  });

  const deleteLibraryImage = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_images")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-images", currentOrganization?.id] });
      toast.success("Images deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete images: ${error.message}`);
    },
  });

  const deleteBulkLibraryImages = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_images").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["library-images", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} entr${ids.length !== 1 ? "ies" : "y"}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete images: ${error.message}`);
    },
  });

  return {
    libraryImages: libraryImages || [],
    isLoading,
    error,
    createLibraryImage: (data: Partial<LibraryImage>) => createLibraryImage.mutate(data),
    updateLibraryImage: (id: string, updates: Partial<LibraryImage>) =>
      updateLibraryImage.mutate({ id, updates }),
    deleteLibraryImage: (id: string) => deleteLibraryImage.mutate(id),
    deleteBulkLibraryImages: (ids: string[]) => deleteBulkLibraryImages.mutate(ids),
    isCreating: createLibraryImage.isPending,
    isUpdating: updateLibraryImage.isPending,
    isDeleting: deleteLibraryImage.isPending,
    isDeletingBulk: deleteBulkLibraryImages.isPending,
  };
}
