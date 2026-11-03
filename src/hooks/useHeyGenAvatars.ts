import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useAuth } from "@/contexts/AuthContext";

export interface HeyGenAvatar {
  avatar_id: string;
  name: string;
  gender?: string;
  language?: string;
  preview_image_url?: string;
  preview_video_url?: string;
  default_voice_id?: string;
  avatar_type: 'public' | 'private' | 'talking_photo';
}

export function useHeyGenAvatars() {
  const { currentOrganization } = useAuth();
  const { data: apiKeys } = useApiKeys();
  const hasHeyGenKey = apiKeys?.some(k => k.provider === 'heygen' && k.is_valid);

  return useQuery({
    queryKey: ["heygen-avatars", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('heygen-manage-avatar', {
        body: { action: 'list-avatars', organizationId: currentOrganization!.id },
      });
      if (error) {
        // Extract actual error message from the Response object in error.context
        let message = 'Failed to load avatars';
        try {
          if (error.context) {
            const body = await error.context.json();
            message = body?.detail || body?.error || message;
          }
        } catch { /* ignore parse errors */ }
        console.error('HeyGen avatars error:', message);
        throw new Error(message);
      }
      return (data?.avatars || []) as HeyGenAvatar[];
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!hasHeyGenKey && !!currentOrganization,
  });
}
