import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SceneExclusionParams {
  outputId: string;
  stageId: string;
  sceneNumber: number;
  action: 'exclude' | 'include';
  jobId?: string; // For scoped cache invalidation
}

export function useSceneExclusion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, sceneNumber, action }: SceneExclusionParams) => {
      const { data, error } = await supabase.functions.invoke('approve-scene-item', {
        body: { output_id: outputId, stage_id: stageId, scene_number: sceneNumber, action }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      const actionText = variables.action === 'exclude' ? 'excluded' : 'included';
      toast.success(`Scene ${actionText}`, {
        description: `Scene ${variables.sceneNumber} has been ${actionText}. ${data.ready_count} ready, ${data.excluded_count} excluded.`
      });

      // Refetch to get latest data from backend - scoped if jobId available
      if (variables.jobId) {
        queryClient.refetchQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.refetchQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        queryClient.refetchQueries({ queryKey: ['content-outputs'] });
        queryClient.refetchQueries({ queryKey: ['generation-job'] });
      }
    },
    onError: (error: Error) => {
      toast.error('Action failed', {
        description: error.message
      });
    }
  });
}

export function useClipExclusion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, sceneNumber, action }: SceneExclusionParams) => {
      const { data, error } = await supabase.functions.invoke('approve-clip-item', {
        body: { output_id: outputId, stage_id: stageId, scene_number: sceneNumber, action }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      const actionText = variables.action === 'exclude' ? 'excluded' : 'included';
      toast.success(`Clip ${actionText}`, {
        description: `Clip ${variables.sceneNumber} has been ${actionText}. ${data.ready_count} ready, ${data.excluded_count} excluded.`
      });

      // Refetch to get latest data from backend - scoped if jobId available
      if (variables.jobId) {
        queryClient.refetchQueries({ queryKey: ['content-outputs', variables.jobId] });
        queryClient.refetchQueries({ queryKey: ['generation-job', variables.jobId] });
      } else {
        queryClient.refetchQueries({ queryKey: ['content-outputs'] });
        queryClient.refetchQueries({ queryKey: ['generation-job'] });
      }
    },
    onError: (error: Error) => {
      toast.error('Action failed', {
        description: error.message
      });
    }
  });
}

// Keep old names as aliases for backwards compatibility
export const useSceneApproval = useSceneExclusion;
export const useClipApproval = useClipExclusion;
