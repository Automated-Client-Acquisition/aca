import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// ============================================================================
// Types
// ============================================================================

export interface UnifiedMessage {
  message_id: string;
  conversation_id: string;
  channel: string;
  direction: string;
  sender_type: string;
  content: string;
  content_type: string;
  email_subject: string | null;
  attachments: any[];
  ai_generated: boolean;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Fetch all messages across all channels for a given contact via the
 * get_contact_unified_messages RPC. Returns messages ordered newest-first;
 * components should reverse for chronological display.
 */
export function useUnifiedMessages(contactId: string | null, limit?: number) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['unified-messages', currentOrganization?.id, contactId, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_contact_unified_messages', {
        p_contact_id: contactId!,
        p_org_id: currentOrganization!.id,
        p_limit: limit || 100,
      });

      if (error) throw error;
      return (data || []) as UnifiedMessage[];
    },
    enabled: !!currentOrganization && !!contactId,
  });
}
