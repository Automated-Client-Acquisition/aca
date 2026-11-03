import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GenerateCaptionParams {
  outputId: string;
  ideaContext?: string;
  scenePrompts?: any[];
  libraryContext?: any;
  instructions?: string;
}

export function useGenerateVideoCaption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: GenerateCaptionParams) => {
      const { data, error } = await supabase.functions.invoke('generate-video-caption', {
        body: params
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      toast.success('Caption generated successfully');
      queryClient.invalidateQueries({ queryKey: ['content-outputs', variables.outputId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to generate caption');
    }
  });
}
