import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WordPressTerm {
  id: number;
  name: string;
  slug: string;
  count: number;
  parent?: number;
}

interface WordPressTaxonomies {
  categories: WordPressTerm[];
  tags: WordPressTerm[];
  site_name: string;
}

export function useWordPressTaxonomies(siteId: string | null) {
  return useQuery({
    queryKey: ['wordpress-taxonomies', siteId],
    queryFn: async (): Promise<WordPressTaxonomies | null> => {
      if (!siteId) return null;

      const { data, error } = await supabase.functions.invoke('fetch-wordpress-taxonomies', {
        body: { site_id: siteId }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      return data as WordPressTaxonomies;
    },
    enabled: !!siteId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
  });
}

// Hook to get the default WordPress site for an organization
export function useDefaultWordPressSite(organizationId: string | null) {
  return useQuery({
    queryKey: ['default-wordpress-site', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;

      const { data, error } = await supabase
        .from('wordpress_sites')
        .select('id, name, site_url, is_valid')
        .eq('organization_id', organizationId)
        .eq('is_valid', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data;
    },
    enabled: !!organizationId,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });
}
