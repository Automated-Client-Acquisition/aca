import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useAuth } from "@/contexts/AuthContext";

export interface HeyGenVoice {
  voice_id: string;
  name: string;
  gender?: string;
  language?: string;
  preview_audio?: string;
}

export function useHeyGenVoices() {
  const { currentOrganization } = useAuth();
  const { data: apiKeys } = useApiKeys();
  const hasHeyGenKey = apiKeys?.some(k => k.provider === 'heygen' && k.is_valid);

  return useQuery({
    queryKey: ["heygen-voices", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('heygen-manage-avatar', {
        body: { action: 'list-voices', organizationId: currentOrganization!.id },
      });
      if (error) {
        let message = 'Failed to load voices';
        try {
          if (error.context) {
            const body = await error.context.json();
            message = body?.detail || body?.error || message;
          }
        } catch { /* ignore parse errors */ }
        console.error('HeyGen voices error:', message);
        throw new Error(message);
      }
      return (data?.voices || []) as HeyGenVoice[];
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!hasHeyGenKey && !!currentOrganization,
  });
}
