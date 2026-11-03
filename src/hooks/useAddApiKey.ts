import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface AddApiKeyParams {
  provider: string;
  apiKey: string;
  capability?: string;
  dsnUrl?: string;
  secondaryKey?: string;
  plan?: 'starter' | 'growth' | 'pro' | 'ultimate' | 'tier_27' | 'tier_97' | 'tier_997' | 'standard' | 'gtm_unlimited';
  requestsPerMinute?: number;
}

export function useAddApiKey() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ provider, apiKey, capability, dsnUrl, secondaryKey, plan, requestsPerMinute }: AddApiKeyParams) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      // Use currentOrganization from AuthContext - it already respects impersonation
      const orgId = currentOrganization.id;

      // Validate API key via edge function
      const { data: validation, error: validationError } = await supabase.functions.invoke(
        'validate-api-key',
        {
          body: { provider, apiKey, dsnUrl, secondaryKey },
        }
      );

      if (validationError) throw validationError;

      if (!validation?.valid) {
        throw new Error(validation?.error || 'Invalid API key');
      }

      // Build metadata for provider-specific config
      const metadata: Record<string, unknown> = {};
      if (dsnUrl) metadata.dsn_url = dsnUrl;
      if (validation.encryptedSecondaryKey) metadata.secondary_key_encrypted = validation.encryptedSecondaryKey;
      if (plan && ['mailtester_ninja', 'moltsets', 'prospeo', 'quickenrich'].includes(provider)) metadata.plan = plan;
      if (provider === 'apollo' && requestsPerMinute) metadata.requests_per_minute = requestsPerMinute;

      // Store in database with encrypted key. The validator can file a key under a more specific
      // provider (a Unipile key with no endpoint is a v2 key: 'unipile_v2').
      const { data, error } = await supabase
        .from('api_keys')
        .insert({
          provider: validation.provider || provider,
          key_encrypted: validation.encryptedKey,
          // Ollama self-hosted may have no key; hint at the server host instead
          key_hint: apiKey
            ? apiKey.slice(-4).padStart(Math.min(apiKey.length, 20), '•')
            : (provider === 'ollama' && dsnUrl ? new URL(dsnUrl).host : '••••'),
          is_valid: true,
          capability: capability || null,
          organization_id: orgId,
          metadata,
          // Store expiration date if provided (e.g., Apify keys expire after 90 days)
          expires_at: validation.expiresAt || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Store HeyGen webhook endpoint details for signature verification
      if (provider === 'heygen' && validation.webhookEndpointId && validation.webhookSecret) {
        await supabase
          .from('heygen_webhook_endpoints')
          .upsert({
            organization_id: orgId,
            endpoint_id: validation.webhookEndpointId,
            secret: validation.webhookSecret,
            status: 'enabled',
            events: ['avatar_video.success', 'avatar_video.fail', 'photo_avatar_train.success', 'photo_avatar_train.fail'],
          }, { onConflict: 'organization_id' });
      }

      // Return data with models if OpenRouter
      return {
        ...data,
        models: provider === 'openrouter' || provider === 'ollama' ? validation.models : undefined,
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      queryClient.invalidateQueries({ queryKey: ['enrichment-providers'] });
      toast.success('API key added successfully');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add API key');
    },
  });
}
