import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useBlueprintFolders, type BlueprintFolder } from "./useBlueprintFolders";

export function useBlueprintFoldersCRUD() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: folders, isLoading, error } = useBlueprintFolders();

  const createFolder = useMutation({
    mutationFn: async ({ name, color }: { name: string; color?: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization found");

      const { data, error } = await supabase
        .from("blueprint_folders")
        .insert([{
          name: name.trim(),
          color: color || "#6366f1",
          organization_id: currentOrganization.id,
        }])
        .select()
        .single();

      if (error) throw error;
      return data as BlueprintFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprint-folders"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints-count-by-folder"] });
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
        .from("blueprint_folders")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as BlueprintFolder;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprint-folders"] });
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
        .from("blueprint_folders")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprint-folders"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints-count-by-folder"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints"] });
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

export function useUpdateBlueprintFolder() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ blueprintId, folderId }: { blueprintId: string; folderId: string | null }) => {
      if (!currentOrganization) throw new Error("No organization found");
      const { error } = await supabase
        .from("blueprints")
        .update({ folder_id: folderId })
        .eq("id", blueprintId)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blueprints"] });
      queryClient.invalidateQueries({ queryKey: ["blueprints-count-by-folder"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update folder: ${error.message}`);
    },
  });
}
