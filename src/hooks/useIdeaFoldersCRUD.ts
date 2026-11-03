import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useIdeaFolders, type IdeaFolder } from "./useIdeaFolders";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export function useIdeaFoldersCRUD() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: folders, isLoading, error } = useIdeaFolders();

  const createFolder = useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization found");

      const { data, error } = await supabase
        .from("idea_folders")
        .insert([{
          name: name.trim(),
          color: color || "#6366f1",
          organization_id: currentOrganization.id,
        }])
        .select()
        .single();

      if (error) throw error;
      return data as IdeaFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-folders"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-folder"] });
      toast.success("Folder created successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("A folder with this name already exists");
      } else {
        toast.error(`Failed to create folder: ${error.message}`);
      }
    },
  });

  const updateFolder = useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name?: string; color?: string }) => {
      if (!currentOrganization) throw new Error("No organization found");
      const updates: { name?: string; color?: string } = {};
      if (name !== undefined) updates.name = name.trim();
      if (color !== undefined) updates.color = color;

      const { data, error } = await supabase
        .from("idea_folders")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as IdeaFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-folders"] });
      toast.success("Folder updated successfully");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("A folder with this name already exists");
      } else {
        toast.error(`Failed to update folder: ${error.message}`);
      }
    },
  });

  const deleteFolder = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization found");
      const { error } = await supabase
        .from("idea_folders")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["idea-folders"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-folder"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      toast.success("Folder deleted successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete folder: ${error.message}`);
    },
  });

  return {
    folders: folders || [],
    isLoading,
    error,
    createFolder,
    updateFolder,
    deleteFolder,
    isCreating: createFolder.isPending,
    isUpdating: updateFolder.isPending,
    isDeleting: deleteFolder.isPending,
  };
}

/**
 * Hook to move ideas to a folder (or remove from folder)
 */
export function useMoveIdeasToFolder() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ ideaIds, folderId }: { ideaIds: string[]; folderId: string | null }) => {
      if (!currentOrganization) throw new Error("No organization found");
      await chunkedMutate(ideaIds, (chunk) =>
        supabase
          .from("content_ideas")
          .update({ folder_id: folderId })
          .in("id", chunk)
          .eq("organization_id", currentOrganization.id)
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-folder"] });
      const action = variables.folderId ? "moved to folder" : "removed from folder";
      toast.success(`${variables.ideaIds.length} idea(s) ${action}`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to move ideas: ${error.message}`);
    },
  });
}

/**
 * Hook to move a single idea to a folder
 */
export function useUpdateIdeaFolder() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ ideaId, folderId }: { ideaId: string; folderId: string | null }) => {
      if (!currentOrganization) throw new Error("No organization found");
      const { error } = await supabase
        .from("content_ideas")
        .update({ folder_id: folderId })
        .eq("id", ideaId)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-folder"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update folder: ${error.message}`);
    },
  });
}
