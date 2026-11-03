import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useCheckPredictionStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (outputId: string) => {
      const { data, error } = await supabase.functions.invoke('check-prediction-status', {
        body: { output_id: outputId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.refetchQueries({ queryKey: ['content-outputs'] });
      queryClient.refetchQueries({ queryKey: ['generation-job'] });
      
      if (data.updated > 0) {
        toast.success(`Updated ${data.updated} prediction(s)`, {
          description: 'Status refreshed from Replicate'
        });
      } else {
        toast.info('All predictions are still processing');
      }
    },
    onError: (error) => {
      console.error('Failed to check prediction status:', error);
      toast.error('Failed to refresh status');
    }
  });
}
