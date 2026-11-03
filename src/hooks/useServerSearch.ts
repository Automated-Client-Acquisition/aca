import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SearchResult {
  conversation_id: string;
  message_id: string;
  content: string;
  email_subject: string | null;
  direction: string;
  created_at: string;
  rank: number;
  contact_name: string;
  contact_email: string | null;
}

export function useServerSearch(query: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["inbox-search", currentOrganization?.id, query],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_inbox_messages", {
        p_org_id: currentOrganization!.id,
        p_query: query,
        p_limit: 50,
      });

      if (error) throw error;
      return (data as SearchResult[]) || [];
    },
    enabled: !!currentOrganization && query.length >= 3,
    staleTime: 30_000,
  });
}
