import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Mutation to trigger subtitle rendering (burns subtitles into video via FFmpeg worker)
 */
export function useRenderSubtitles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, templateId }: { outputId: string; templateId?: string }) => {
      const { data, error } = await supabase.functions.invoke('render-subtitles', {
        body: { output_id: outputId, template_id: templateId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success('Subtitle rendering started');
      queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-job'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to start subtitle rendering: ${error.message}`);
    },
  });
}

/**
 * Mutation to trigger Whisper transcription (generates word-level timestamps from audio)
 */
export function useTranscribeAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId }: { outputId: string }) => {
      const { data, error } = await supabase.functions.invoke('transcribe-audio', {
        body: { output_id: outputId },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success('Transcription started');
      queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-job'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to start transcription: ${error.message}`);
    },
  });
}

/**
 * Save edited subtitle transcription data back to the output
 */
export function useSaveSubtitleEdits() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, transcription }: { outputId: string; transcription: any }) => {
      // Fetch current stage_data first
      const { data: output, error: fetchError } = await supabase
        .from('content_outputs')
        .select('stage_data')
        .eq('id', outputId)
        .single();

      if (fetchError) throw fetchError;

      const stageData = (output as any)?.stage_data || {};

      const { error } = await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...stageData,
            subtitle_transcription: {
              ...stageData.subtitle_transcription,
              ...transcription,
              edited: true,
            },
          },
        })
        .eq('id', outputId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Subtitles saved');
      queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      queryClient.invalidateQueries({ queryKey: ['generation-job'] });
    },
    onError: (error: any) => {
      toast.error(`Failed to save subtitles: ${error.message}`);
    },
  });
}
