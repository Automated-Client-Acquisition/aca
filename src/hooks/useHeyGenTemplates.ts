import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "@/hooks/useApiKeys";
import { useAuth } from "@/contexts/AuthContext";

export interface HeyGenTemplate {
  template_id: string;
  name: string;
  thumbnail_image_url?: string;
  aspect_ratio?: string;
}

export function useHeyGenTemplates() {
  const { currentOrganization } = useAuth();
  const { data: apiKeys } = useApiKeys();
  const hasHeyGenKey = apiKeys?.some(k => k.provider === 'heygen' && k.is_valid);

  return useQuery({
    queryKey: ["heygen-templates", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('heygen-manage-avatar', {
        body: { action: 'list-templates', organizationId: currentOrganization!.id },
      });
      if (error) throw error;
      return (data?.templates || []) as HeyGenTemplate[];
    },
    staleTime: 1000 * 60 * 5,
    enabled: !!hasHeyGenKey && !!currentOrganization,
  });
}
