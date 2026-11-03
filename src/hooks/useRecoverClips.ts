import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useRecoverClips() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ outputId, predictionIds }: { outputId: string; predictionIds: string[] }) => {
      const { data, error } = await supabase.functions.invoke("manual-clip-recovery", {
        body: { outputId, predictionIds },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: async (_, { outputId }) => {
      toast.success("Clips recovered successfully");
      await queryClient.refetchQueries({ queryKey: ["content-outputs", outputId] });
      await queryClient.refetchQueries({ queryKey: ["generation-job"] });
    },
    onError: (error: Error) => {
      console.error("Recovery error:", error);
      toast.error(`Recovery failed: ${error.message}`);
    },
  });
}