import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "./useApiKeys";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
  preview_url?: string; // URL to preview audio sample
}

export function useElevenLabsVoices() {
  const { data: apiKeys } = useApiKeys();
  const hasElevenLabsKey = apiKeys?.some(k => k.provider === 'elevenlabs' && k.is_valid);

  return useQuery({
    queryKey: ["elevenlabs-voices"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('fetch-elevenlabs-voices');

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return (data?.voices || []) as ElevenLabsVoice[];
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    enabled: !!hasElevenLabsKey, // Only fetch when ElevenLabs API key exists
  });
}
