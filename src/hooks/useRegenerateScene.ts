import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RegenerateSceneParams {
  outputId: string;
  stageId: string;
  sceneNumber: number;
  prompt?: string;
  instructions?: string;
  jobId?: string; // For scoped cache invalidation
}

interface RegenerateClipParams {
  outputId: string;
  stageId: string;
  sceneNumber: number;
  jobId?: string; // For scoped cache invalidation
}

export function useRegenerateScene() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, sceneNumber, prompt, instructions }: RegenerateSceneParams) => {
      // Mark scene as regenerating
      const { data: output } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', outputId)
        .single();

      if (!output) throw new Error('Output not found');

      const stageData = (output.stage_data as Record<string, any>) || {};
      const currentStageData = stageData[stageId] || {};
      const scenes = currentStageData.scenes || [];

      const updatedScenes = scenes.map((scene: any) => {
        if (scene.scene_number === sceneNumber) {
          return {
            ...scene,
            status: 'generating',
            prompt: prompt || scene.prompt,
            image_url: null // Clear old image
          };
        }
        return scene;
      });

      const newStageData: Record<string, any> = { ...stageData };
      newStageData[stageId] = {
        ...currentStageData,
        scenes: updatedScenes
      };

      await supabase
        .from('content_outputs')
        .update({ stage_data: newStageData })
        .eq('id', outputId);

      // Trigger regeneration via edge function
      const { data, error } = await supabase.functions.invoke('execute-stage', {
        body: {
          output_id: outputId,
          stage_id: stageId,
          regenerate_scene: sceneNumber,
          custom_prompt: prompt,
          instructions
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      toast.success('Regenerating scene', {
        description: `Scene ${variables.sceneNumber} is being regenerated...`
      });

      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-output', variables.outputId] });
      }
    },
    onError: (error: Error) => {
      toast.error('Regeneration failed', {
        description: error.message
      });
    }
  });
}

export function useRegenerateClip() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, stageId, sceneNumber }: RegenerateClipParams) => {
      // Mark clip as regenerating
      const { data: output } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', outputId)
        .single();

      if (!output) throw new Error('Output not found');

      const stageData = (output.stage_data as Record<string, any>) || {};
      const currentStageData = stageData[stageId] || {};
      const clips = currentStageData.clips || [];

      const updatedClips = clips.map((clip: any) => {
        if (clip.scene_number === sceneNumber) {
          return {
            ...clip,
            status: 'generating',
            video_url: null // Clear old video
          };
        }
        return clip;
      });

      const newStageData: Record<string, any> = { ...stageData };
      newStageData[stageId] = {
        ...currentStageData,
        clips: updatedClips
      };

      await supabase
        .from('content_outputs')
        .update({ stage_data: newStageData })
        .eq('id', outputId);

      // Trigger regeneration via edge function
      const { data, error } = await supabase.functions.invoke('execute-stage', {
        body: { 
          output_id: outputId, 
          stage_id: stageId,
          regenerate_clip: sceneNumber
        }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      toast.success('Regenerating clip', {
        description: `Clip ${variables.sceneNumber} is being regenerated...`
      });

      // Scoped invalidation if jobId available
      if (variables.jobId) {
        queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.jobId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['content-output', variables.outputId] });
      }
    },
    onError: (error: Error) => {
      toast.error('Regeneration failed', {
        description: error.message
      });
    }
  });
}
