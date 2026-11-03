import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TestStorageConnectionParams {
  credentialId: string;
}

export function useTestStorageConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ credentialId }: TestStorageConnectionParams) => {
      const { data, error } = await supabase.functions.invoke('test-storage-credentials', {
        body: { credential_id: credentialId },
      });

      if (error) {
        // Extract the actual error message from the edge function response body
        if (error instanceof FunctionsHttpError) {
          const errorBody = await error.context.json();
          throw new Error(errorBody?.error || 'Storage connection test failed');
        }
        throw error;
      }
      return data;
    },
    onSuccess: (data) => {
      if (data?.valid) {
        toast.success('Storage connection is valid');
        queryClient.invalidateQueries({ queryKey: ['storage-credentials'] });
      } else {
        toast.error(data?.error || 'Storage connection failed');
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to test storage connection';
      toast.error(message);
    },
  });
}
