import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApiKeys } from "./useApiKeys";

export interface ImageModel {
  id: string;
  modelId: string;
  name: string;
  displayName: string;
  owner: string;
  description: string | null;
  categories: string[];
  runCount: number;
  coverImage: string | null;
}

/** @deprecated Use ImageModel instead */
export type ReplicateModel = ImageModel;

export function useImageModels(category?: 'text-to-image' | 'image-to-video' | 'text-to-video') {
  const { data: apiKeys } = useApiKeys();
  const hasOpenRouterKey = apiKeys?.some(k => k.provider === 'openrouter' && k.is_valid);

  return useQuery({
    queryKey: ['ai-models', 'openrouter', category],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-ai-models', {
        body: {
          providers: ['openrouter'],
          category,
          // Video models require curated (has normalized_capabilities for execute-stage)
          curated_only: true,
          limit: 50,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Map database fields to camelCase interface
      const models = (data?.models || []).map((m: any) => ({
        id: m.id,
        modelId: m.model_id,
        name: m.name,
        displayName: m.display_name,
        owner: m.owner || '',
        description: m.description,
        categories: m.categories || [],
        runCount: m.run_count || 0,
        coverImage: m.cover_image_url,
      }));

      return models as ImageModel[];
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    enabled: !!hasOpenRouterKey,
  });
}

/** @deprecated Use useImageModels instead */
export const useReplicateModels = useImageModels;
