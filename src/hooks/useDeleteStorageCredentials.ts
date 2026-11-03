import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useDeleteStorageCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("storage_credentials")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storage-credentials"] });
      toast.success("Storage credentials deleted successfully");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete storage credentials");
    },
  });
}
