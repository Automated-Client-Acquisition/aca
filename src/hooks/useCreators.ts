import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface Creator {
  id: string;
  display_name: string;
  platform: string;
  channel_id: string | null;
  channel_url: string | null;
  avatar_url: string | null;
  metadata: any;
  tags: string[] | null;
  notes: string | null;
  total_content_items: number | null;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
  organization_id: string;
  follower_count: number | null;
  following_count: number | null;
  video_count: number | null;
  subscriber_count: number | null;
  view_count: number | null;
  total_likes: number | null;
  description: string | null;
  verified: boolean | null;
}

export function useCreators() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const { data: creators, isLoading, error } = useQuery({
    queryKey: ["research-creators", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_creators")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Creator[];
    },
    enabled: !!currentOrganization,
    refetchInterval: 5000, // Refetch every 5 seconds to catch updates
  });

  const deleteCreator = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("research_creators")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["research-creators"] });
      toast.success("Creator deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete creator: ${error.message}`);
    },
  });

  const deleteBulkCreators = useMutation({
    mutationFn: async (ids: string[]) => {
      await chunkedMutate(ids, (chunk) =>
        supabase.from("research_creators").delete().in("id", chunk)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["research-creators"] });
      toast.success(`Successfully deleted ${ids.length} creator${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete creators: ${error.message}`);
    },
  });

  return {
    creators: creators || [],
    isLoading,
    error,
    deleteCreator: (id: string) => deleteCreator.mutate(id),
    deleteBulkCreators: (ids: string[]) => deleteBulkCreators.mutate(ids),
    isDeleting: deleteCreator.isPending,
    isDeletingBulk: deleteBulkCreators.isPending,
  };
}
