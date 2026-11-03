import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export type BlockType = 'hook' | 'angle' | 'cta' | 'story_element' | 'visual_style';

export interface Block {
  id: string;
  organization_id: string;
  block_type: BlockType;
  name: string | null;
  content: string;
  tags: string[] | null;
  usage_count: number | null;
  created_at: string;
  updated_at: string;
}

export function useBlocks(blockType?: BlockType) {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: blocks, isLoading, error } = useQuery({
    queryKey: blockType
      ? ["library-blocks", currentOrganization?.id, blockType]
      : ["library-blocks", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      let query = supabase
        .from("library_blocks")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (blockType) {
        query = query.eq("block_type", blockType);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Block[];
    },
  });

  const createBlock = useMutation({
    mutationFn: async (newBlock: Partial<Block>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("library_blocks")
        .insert([{ ...newBlock, organization_id: currentOrganization.id } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-blocks", currentOrganization?.id] });
      toast.success("Block created successfully");
    },
    onError: (error) => {
      toast.error(`Failed to create block: ${error.message}`);
    },
  });

  const updateBlock = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Block> }) => {
      const { data, error } = await supabase
        .from("library_blocks")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-blocks", currentOrganization?.id] });
      toast.success("Block updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update block: ${error.message}`);
    },
  });

  const deleteBlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("library_blocks")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["library-blocks", currentOrganization?.id] });
      toast.success("Block deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete block: ${error.message}`);
    },
  });

  const deleteBulkBlocks = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("library_blocks").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["library-blocks", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} block${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete blocks: ${error.message}`);
    },
  });

  return {
    blocks: blocks || [],
    isLoading,
    error,
    createBlock: (data: Partial<Block>) => createBlock.mutate(data),
    updateBlock: (id: string, updates: Partial<Block>) => updateBlock.mutate({ id, updates }),
    deleteBlock: (id: string) => deleteBlock.mutate(id),
    deleteBulkBlocks: (ids: string[]) => deleteBulkBlocks.mutate(ids),
    isCreating: createBlock.isPending,
    isUpdating: updateBlock.isPending,
    isDeleting: deleteBlock.isPending,
    isDeletingBulk: deleteBulkBlocks.isPending,
  };
}
