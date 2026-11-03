import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";

// ============================================================================
// Types
// ============================================================================

export type QueueStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled' | 'rate_limited';
export type QueueSourceType = 'manual' | 'sequence' | 'rule' | 'ai_response' | 'campaign';

export interface CrmMessageQueueItem {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  contact_id: string;
  channel: string;
  channel_account_id: string | null;
  recipient_identity_id: string | null;
  recipient_external_id: string;
  recipient_display_name: string | null;
  content: string;
  content_type: string;
  attachments: unknown[];
  email_subject: string | null;
  email_cc: string[] | null;
  email_bcc: string[] | null;
  sender_type: string;
  sender_user_id: string | null;
  source_type: QueueSourceType | null;
  source_id: string | null;
  scheduled_for: string;
  priority: number;
  status: QueueStatus;
  attempts: number;
  max_attempts: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  error_message: string | null;
  error_code: string | null;
  error_details: Record<string, unknown> | null;
  sent_at: string | null;
  external_message_id: string | null;
  message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface QueueItemWithContact extends CrmMessageQueueItem {
  contact?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface QueueFilters {
  status?: QueueStatus | QueueStatus[];
  channel?: string | string[];
  source_type?: QueueSourceType;
  from_date?: string;
  to_date?: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch message queue items with filters
 */
export function useMessageQueue(filters?: QueueFilters, limit = 100) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-message-queue', filters, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      let query = supabase
        .from('crm_message_queue')
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq('organization_id', currentOrganization.id)
        .order('scheduled_for', { ascending: true })
        .limit(limit);

      // Apply filters
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          query = query.in('status', filters.status);
        } else {
          query = query.eq('status', filters.status);
        }
      }

      if (filters?.channel) {
        if (Array.isArray(filters.channel)) {
          query = query.in('channel', filters.channel);
        } else {
          query = query.eq('channel', filters.channel);
        }
      }

      if (filters?.source_type) {
        query = query.eq('source_type', filters.source_type);
      }

      if (filters?.from_date) {
        query = query.gte('scheduled_for', filters.from_date);
      }

      if (filters?.to_date) {
        query = query.lte('scheduled_for', filters.to_date);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as QueueItemWithContact[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get pending queue items count
 */
export function usePendingQueueCount() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-queue-pending-count', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { count, error } = await supabase
        .from('crm_message_queue')
        .select('id', { count: 'exact' })
        .eq('organization_id', currentOrganization.id)
        .eq('status', 'pending');

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

/**
 * Get failed queue items that can be retried
 */
export function useFailedQueueItems() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-queue-failed', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_message_queue')
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq('organization_id', currentOrganization.id)
        .eq('status', 'failed')
        .order('last_attempt_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as QueueItemWithContact[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get queue item by ID
 */
export function useQueueItem(itemId: string | null) {
  return useQuery({
    queryKey: ['crm-queue-item', itemId],
    queryFn: async () => {
      if (!itemId) throw new Error('No item ID');

      const { data, error } = await supabase
        .from('crm_message_queue')
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq('id', itemId)
        .single();

      if (error) throw error;
      return data as QueueItemWithContact;
    },
    enabled: !!itemId,
  });
}

/**
 * Cancel a queued message
 */
export function useCancelQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data, error } = await supabase
        .from('crm_message_queue')
        .update({
          status: 'cancelled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('status', 'pending') // Can only cancel pending items
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessageQueueItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-pending-count'] });
      toast.success('Message cancelled');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel message');
    },
  });
}

/**
 * Retry a failed queue item
 */
export function useRetryQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { data, error } = await supabase
        .from('crm_message_queue')
        .update({
          status: 'pending',
          attempts: 0,
          error_message: null,
          error_code: null,
          error_details: null,
          next_retry_at: null,
          scheduled_for: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessageQueueItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-failed'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-pending-count'] });
      toast.success('Message queued for retry');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to retry message');
    },
  });
}

/**
 * Bulk cancel pending messages
 */
export function useBulkCancelQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemIds: string[]) => {
      await chunkedMutate(itemIds, (chunk) =>
        supabase
          .from('crm_message_queue')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString(),
          })
          .in('id', chunk)
          .eq('status', 'pending')
      );
      return itemIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-pending-count'] });
      toast.success(`${count} message${count === 1 ? '' : 's'} cancelled`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to cancel messages');
    },
  });
}

/**
 * Bulk retry failed messages
 */
export function useBulkRetryQueue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemIds: string[]) => {
      await chunkedMutate(itemIds, (chunk) =>
        supabase
          .from('crm_message_queue')
          .update({
            status: 'pending',
            attempts: 0,
            error_message: null,
            error_code: null,
            error_details: null,
            next_retry_at: null,
            scheduled_for: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .in('id', chunk)
      );
      return itemIds.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-failed'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-pending-count'] });
      toast.success(`${count} message${count === 1 ? '' : 's'} queued for retry`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to retry messages');
    },
  });
}

/**
 * Delete a queue item (only cancelled or failed items)
 */
export function useDeleteQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('crm_message_queue')
        .delete()
        .eq('id', itemId)
        .in('status', ['cancelled', 'failed']);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      queryClient.invalidateQueries({ queryKey: ['crm-queue-failed'] });
      toast.success('Queue item deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete queue item');
    },
  });
}

/**
 * Get queue stats (for dashboard)
 */
export function useQueueStats() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-queue-stats', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_message_queue')
        .select('status, channel')
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;

      const stats = {
        total: data?.length || 0,
        byStatus: {} as Record<string, number>,
        byChannel: {} as Record<string, number>,
      };

      for (const item of data || []) {
        stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1;
        stats.byChannel[item.channel] = (stats.byChannel[item.channel] || 0) + 1;
      }

      return stats;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Reschedule a pending queue item
 */
export function useRescheduleQueueItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, scheduledFor }: { itemId: string; scheduledFor: string }) => {
      const { data, error } = await supabase
        .from('crm_message_queue')
        .update({
          scheduled_for: scheduledFor,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('status', 'pending')
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessageQueueItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      toast.success('Message rescheduled');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reschedule message');
    },
  });
}

/**
 * Update queue item priority
 */
export function useUpdateQueuePriority() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, priority }: { itemId: string; priority: number }) => {
      const { data, error } = await supabase
        .from('crm_message_queue')
        .update({
          priority,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .eq('status', 'pending')
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessageQueueItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update priority');
    },
  });
}
