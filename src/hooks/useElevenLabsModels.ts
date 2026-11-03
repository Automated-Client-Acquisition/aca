import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "./useApiKeys";

export interface ElevenLabsModel {
  id: string;
  name: string;
  description?: string;
  canBeFinetuned: boolean;
  canUseStyle: boolean;
  canUseSpeakerBoost: boolean;
  servesProVoices: boolean;
  tokenCostFactor: number;
  languages: string[];
  maxCharactersRequestFreeUser?: number;
  maxCharactersRequestSubscribedUser?: number;
}

export function useElevenLabsModels() {
  const { data: apiKeys } = useApiKeys();
  const hasElevenLabsKey = apiKeys?.some(k => k.provider === 'elevenlabs' && k.is_valid);

  return useQuery({
    queryKey: ['ai-models', 'elevenlabs', 'text-to-speech'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-ai-models', {
        body: { 
          providers: ['elevenlabs'],
          category: 'text-to-speech',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Map database fields to camelCase interface
      const models = (data?.models || []).map((m: any) => {
        const capabilities = m.capabilities || {};
        return {
          id: m.model_id,
          name: m.name,
          description: m.description,
          canBeFinetuned: capabilities.canBeFinetuned || false,
          canUseStyle: capabilities.canUseStyle || false,
          canUseSpeakerBoost: capabilities.canUseSpeakerBoost || false,
          servesProVoices: capabilities.servesProVoices || false,
          tokenCostFactor: capabilities.tokenCostFactor || 1,
          languages: capabilities.languages || [],
        };
      });

      return models as ElevenLabsModel[];
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour (longer since it's from DB)
    enabled: !!hasElevenLabsKey,
  });
}
