import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface GenerateContentAnglesParams {
  product_id?: string;
  idea_id?: string;
  count?: number;
}

export function useGenerateContentAngles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ product_id, idea_id, count = 3 }: GenerateContentAnglesParams) => {
      toast.loading('Starting content angle generation...', { id: 'content-angles-gen' });

      const { data, error } = await supabase.functions.invoke('generate-content-angles', {
        body: { product_id, idea_id, count }
      });

      if (error) throw error;

      return data;
    },
    onSuccess: () => {
      toast.dismiss('content-angles-gen');
      queryClient.invalidateQueries({ queryKey: ['content-angles'] });
      toast.info('Content angle generation started. This may take a minute...');
    },
    onError: (error) => {
      toast.dismiss('content-angles-gen');
      toast.error(error instanceof Error ? error.message : 'Failed to start generation');
    },
  });
}
