import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useRecheckApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("recheck-api-key", {
        body: { id },
      });
      if (error) throw error;
      return data as { valid: boolean; error: string | null };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      if (data.valid) {
        toast.success("Key re-checked — it's valid again");
      } else {
        toast.error(data.error || "Still blocked");
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to recheck API key");
    },
  });
}
