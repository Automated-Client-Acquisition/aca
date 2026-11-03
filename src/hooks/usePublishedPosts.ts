import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PublishedPost {
  id: string;
  content_output_id: string;
  platform: string;
  platform_account_id: string;
  platform_account_name: string | null;
  ghl_post_id: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  status: 'pending' | 'scheduled' | 'published' | 'failed';
  error_message: string | null;
  created_at: string;
}

export function usePublishedPosts(contentOutputId: string | undefined) {
  const query = useQuery({
    queryKey: ['published-posts', contentOutputId],
    queryFn: async () => {
      if (!contentOutputId) return [];

      const { data, error } = await supabase
        .from('ghl_published_posts')
        .select('*')
        .eq('content_output_id', contentOutputId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PublishedPost[];
    },
    enabled: !!contentOutputId,
  });

  return query;
}
