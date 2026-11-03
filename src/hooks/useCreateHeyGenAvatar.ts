import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export function useCreateHeyGenAvatar() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (characterId: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data, error } = await supabase.functions.invoke('heygen-manage-avatar', {
        body: { action: 'create-avatar', characterId, organizationId: currentOrganization.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      toast.success("HeyGen avatar training started. This may take a few minutes.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create HeyGen avatar");
    },
  });
}

export function useCheckHeyGenTraining() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (characterId: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data, error } = await supabase.functions.invoke('heygen-manage-avatar', {
        body: { action: 'check-training', characterId, organizationId: currentOrganization.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { status: string; avatarId?: string; progress?: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["characters"] });
      if (data.status === 'ready') {
        toast.success("HeyGen avatar is ready to use!");
      } else if (data.status === 'failed') {
        toast.error("HeyGen avatar training failed. Try again with a different image.");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to check training status");
    },
  });
}
