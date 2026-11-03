import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface UpdateApiKeyParams {
  id: string;
  apiKey?: string;
  provider: string;
  plan?: 'starter' | 'growth' | 'pro' | 'ultimate' | 'tier_27' | 'tier_97' | 'tier_997' | 'standard' | 'gtm_unlimited';
}

export function useUpdateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, apiKey, provider, plan }: UpdateApiKeyParams) => {
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      let models: unknown;

      // Only re-validate against the provider when the key itself is being rotated
      if (apiKey) {
        const { data: validation, error: validationError } = await supabase.functions.invoke(
          'validate-api-key',
          {
            body: { provider, apiKey },
          }
        );

        if (validationError) throw validationError;

        if (!validation?.valid) {
          throw new Error(validation?.error || 'Invalid API key');
        }

        update.key_encrypted = validation.encryptedKey;
        update.key_hint = apiKey.slice(-4).padStart(Math.min(apiKey.length, 20), '•');
        update.is_valid = true;
        // Update expiration date if provided (e.g., Apify keys expire after 90 days)
        update.expires_at = validation.expiresAt || null;
        models = provider === 'openrouter' ? validation.models : undefined;
      }

      // Plan changes only adjust rate-limit/cap metadata — no re-validation needed,
      // the worker functions read metadata.plan live on each run.
      if (plan && ['mailtester_ninja', 'moltsets', 'prospeo', 'quickenrich'].includes(provider)) {
        const { data: existing, error: fetchError } = await supabase
          .from('api_keys')
          .select('metadata')
          .eq('id', id)
          .single();

        if (fetchError) throw fetchError;

        update.metadata = {
          ...(existing?.metadata as Record<string, unknown> | null),
          plan,
        };
      }

      // Update in database
      const { data, error } = await supabase
        .from('api_keys')
        .update(update)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return { ...data, models };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['enrichment-providers'] });
      toast.success('API key updated successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update API key');
    },
  });
}
