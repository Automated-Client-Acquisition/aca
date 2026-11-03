import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type AutopilotQueueStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface AutopilotQueueItem {
  id: string;
  organization_id: string;
  conversation_id: string;
  contact_id: string;
  draft_message: string;
  draft_subject: string | null;
  trigger_intent: string;
  trigger_message_id: string | null;
  status: AutopilotQueueStatus;
  approved_by: string | null;
  approved_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  conversation?: { contact: { name: string | null } | null } | null;
}

export interface ApproveAutopilotInput {
  queueItemId: string;
  action: 'approve' | 'reject';
  editedMessage?: string;
}

export interface ApproveAutopilotResult {
  success: boolean;
  action: string;
  messageId?: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all pending autopilot queue items for the organization.
 * Polls every 30 seconds for new items.
 */
export function useAutopilotQueue() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['autopilot-queue', currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inbox_autopilot_queue')
        .select('*')
        .eq('organization_id', currentOrganization!.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AutopilotQueueItem[];
    },
    enabled: !!currentOrganization,
    refetchInterval: 30000,
    retry: false,
  });
}

/**
 * Fetch the count of pending autopilot queue items.
 * Lighter query suitable for badge counters.
 */
export function useAutopilotQueueCount() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['autopilot-queue-count', currentOrganization?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('inbox_autopilot_queue')
        .select('id', { count: 'exact' })
        .eq('organization_id', currentOrganization!.id)
        .eq('status', 'pending');

      if (error) throw error;
      return count || 0;
    },
    enabled: !!currentOrganization,
    refetchInterval: 30000,
    staleTime: 15000,
    retry: false,
  });
}

/**
 * Fetch pending autopilot items for a specific conversation.
 */
export function useConversationAutopilotItems(conversationId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['autopilot-queue-conversation', currentOrganization?.id, conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inbox_autopilot_queue')
        .select('*')
        .eq('organization_id', currentOrganization!.id)
        .eq('conversation_id', conversationId!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AutopilotQueueItem[];
    },
    enabled: !!currentOrganization && !!conversationId,
    retry: false,
  });
}

/**
 * Approve or reject an autopilot queue item.
 * Calls the inbox-autopilot-action edge function which handles
 * message creation, sending, and conversation updates.
 */
export function useApproveAutopilotItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: ApproveAutopilotInput): Promise<ApproveAutopilotResult> => {
      const { data, error, response } = await supabase.functions.invoke('inbox-autopilot-action', {
        body: input,
      });

      if (error) {
        // On non-2xx, read the actual JSON body from the response
        if (response) {
          const status = response.status;
          let body: Record<string, unknown> = {};
          try { body = await response.json(); } catch { /* ignore */ }
          if (status === 409) {
            // Item was already processed — not a real error
            return { success: true, action: input.action, _conflict: true } as any;
          }
          throw new Error((body.error as string) || `Failed to ${input.action} autopilot item`);
        }
        throw new Error(error.message || `Failed to ${input.action} autopilot item`);
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      return data as ApproveAutopilotResult;
    },
    onSuccess: (result, input) => {
      // Invalidate autopilot-specific caches
      queryClient.invalidateQueries({ queryKey: ['autopilot-queue'] });
      queryClient.invalidateQueries({ queryKey: ['autopilot-queue-count'] });
      queryClient.invalidateQueries({ queryKey: ['autopilot-queue-conversation'] });
      // Only invalidate messages/conversations if we actually sent a message
      if (input.action === 'approve') {
        queryClient.invalidateQueries({ queryKey: ['crm-messages'] });
        queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      }
      if ((result as any)._conflict) {
        toast.info('This item was already processed');
      } else {
        toast.success(
          input.action === 'approve'
            ? 'Message approved and sent'
            : 'Draft rejected'
        );
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to process autopilot item');
    },
  });
}
