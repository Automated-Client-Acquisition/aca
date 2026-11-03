import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface TestApiKeyParams {
  provider: string;
  apiKey: string;
}

export function useTestApiKey() {
  return useMutation({
    mutationFn: async ({ provider, apiKey }: TestApiKeyParams) => {
      const { data, error } = await supabase.functions.invoke('validate-api-key', {
        body: { provider, apiKey },
      });

      if (error) throw error;

      return data;
    },
    onSuccess: (data) => {
      if (data?.valid) {
        toast.success('API key is valid');
      } else {
        toast.error(data?.error || 'API key is invalid');
      }
    },
    onError: () => {
      toast.error('Failed to test API key');
    },
  });
}
