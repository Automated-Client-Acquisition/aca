import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ConversationWithContact } from "@/hooks/crm/useConversations";

/**
 * Fetches full conversation records for a list of conversation IDs.
 * Used to resolve server-side search results into displayable conversations.
 */
export function useSearchConversations(conversationIds: string[] | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["search-conversations", currentOrganization?.id, conversationIds],
    queryFn: async () => {
      if (!conversationIds?.length) return [];

      const { data, error } = await supabase
        .from("crm_conversations")
        .select(`
          *,
          contact:crm_contacts(
            id, display_name, first_name, last_name, primary_email, primary_phone,
            avatar_url, company, job_title, status
          )
        `)
        .in("id", conversationIds)
        .eq("organization_id", currentOrganization!.id)
        .order("last_message_at", { ascending: false, nullsFirst: false });

      if (error) throw error;
      return data as ConversationWithContact[];
    },
    enabled: !!currentOrganization && !!conversationIds?.length,
    staleTime: 30_000,
  });
}
