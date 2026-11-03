import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type MessageDirection = 'inbound' | 'outbound';
export type MessageSenderType = 'contact' | 'user' | 'ai' | 'automation' | 'system';
export type MessageContentType = 'text' | 'html' | 'markdown' | 'rich';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'bounced';

export interface MessageAttachment {
  type: string;
  /** Public URL. Empty for files stored in a private bucket (storageBucket/storagePath). */
  url: string;
  filename: string;
  size?: number;
  mimeType?: string;
  /** Inbound reply attachments live in the private inbox-attachments bucket. */
  storageBucket?: string;
  storagePath?: string;
  /** Set when an inbound file couldn't be kept: 'no_content' or 'too_large'. */
  unavailable?: string;
}

/**
 * The URL to show an attachment at. Files in a private bucket get a signed URL
 * (valid an hour, re-signed before it lapses); documents are signed as downloads
 * so a sent file never renders as a page. Null while signing or if it failed.
 */
export function useAttachmentUrl(attachment: MessageAttachment) {
  const { storageBucket, storagePath } = attachment;
  const asDownload = (attachment.type || "file") === "file";
  const signed = useQuery({
    queryKey: ["attachment-url", storageBucket, storagePath, asDownload],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(storageBucket!)
        .createSignedUrl(storagePath!, 3600, asDownload ? { download: attachment.filename || true } : undefined);
      if (error) throw error;
      return data.signedUrl;
    },
    enabled: !attachment.url && !!storageBucket && !!storagePath,
    staleTime: 50 * 60 * 1000,
    retry: 1,
  });
  return attachment.url || signed.data || null;
}

export interface CrmMessage {
  id: string;
  organization_id: string;
  conversation_id: string;
  contact_id: string;
  direction: MessageDirection;
  sender_type: MessageSenderType;
  sender_user_id: string | null;
  content: string;
  content_type: MessageContentType;
  attachments: MessageAttachment[];
  external_message_id: string | null;
  external_thread_id: string | null;
  email_subject: string | null;
  email_from: string | null;
  email_to: string[] | null;
  email_cc: string[] | null;
  email_bcc: string[] | null;
  email_headers: Record<string, unknown>;
  status: MessageStatus;
  status_updated_at: string;
  error_message: string | null;
  delivered_at: string | null;
  read_at: string | null;
  clicked_at: string | null;
  ai_generated: boolean;
  ai_model: string | null;
  ai_prompt_tokens: number | null;
  ai_completion_tokens: number | null;
  reply_to_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SendMessageInput {
  conversation_id: string;
  contact_id: string;
  content: string;
  content_type?: MessageContentType;
  attachments?: MessageAttachment[];
  email_subject?: string;
  email_cc?: string[];
  email_bcc?: string[];
  reply_to_message_id?: string;
  sender_type?: MessageSenderType;
  ai_generated?: boolean;
  ai_model?: string;
  // Required for sending (from conversation)
  channel: string;
  channel_account_id?: string | null;
  recipient_external_id: string; // external_participant_id from conversation
  recipient_display_name?: string;
  external_conversation_id?: string | null; // For replies to existing chats
  lead_magnet_delivery?: boolean;
}

export interface LeadMagnetRecoveryContext {
  status: 'ready' | 'not_configured' | 'source_not_found' | 'ambiguous';
  sourceSequenceId?: string;
  sourceSequenceName?: string;
  ruleId?: string;
  targetSequenceId?: string;
  targetSequenceName?: string;
  delayHours?: number;
  message?: string;
}

export interface LeadMagnetRecoveryResult {
  requested: boolean;
  status: 'enrolled' | 'already_active' | 'failed';
  sequenceId: string;
  sequenceName?: string;
  enrollmentId?: string;
  warning?: string;
}

export interface SendMessageResult {
  message: CrmMessage;
  leadMagnetRecovery?: LeadMagnetRecoveryResult;
}

export interface QueueMessageInput {
  contact_id: string;
  channel: string;
  recipient_external_id: string;
  content: string;
  conversation_id?: string;
  channel_account_id?: string;
  recipient_identity_id?: string;
  recipient_display_name?: string;
  content_type?: MessageContentType;
  attachments?: MessageAttachment[];
  email_subject?: string;
  email_cc?: string[];
  email_bcc?: string[];
  sender_type?: MessageSenderType;
  source_type?: 'manual' | 'sequence' | 'rule' | 'ai_response' | 'campaign';
  source_id?: string;
  scheduled_for?: string;
  priority?: number;
}

export function useLeadMagnetRecoveryContext(conversationId?: string, enabled = true) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['lead-magnet-recovery-context', currentOrganization?.id, conversationId],
    queryFn: async (): Promise<LeadMagnetRecoveryContext> => {
      const { data, error } = await supabase.functions.invoke('crm-send-message', {
        body: {
          action: 'resolve_lead_magnet_context',
          conversation_id: conversationId,
        },
      });
      if (error) throw error;
      if (!data?.success || !data.context) {
        throw new Error(data?.error || 'Could not resolve this conversation’s campaign');
      }
      return data.context as LeadMagnetRecoveryContext;
    },
    enabled: enabled && !!currentOrganization && !!conversationId,
    staleTime: 30_000,
    retry: 1,
  });
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Subscribe to realtime message inserts for a conversation.
 * Invalidates the messages query cache when a new message arrives.
 */
export function useMessagesRealtime(conversationId: string | null) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`crm-messages-rt-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'crm_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['crm-messages', conversationId] });
          queryClient.invalidateQueries({ queryKey: ['crm-messages-infinite', conversationId] });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'crm_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['crm-messages', conversationId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}

/**
 * Fetch messages for a conversation with pagination
 */
function compareMessageTimestamps(a: string, b: string): number {
  const milliseconds = new Date(a).getTime() - new Date(b).getTime();
  if (milliseconds) return milliseconds;
  // PostgreSQL keeps microseconds; Date truncates the fractional digits after milliseconds.
  const remainder = (value: string) => Number((value.match(/\.(\d+)/)?.[1] || "").slice(3).padEnd(6, '0'));
  return remainder(a) - remainder(b);
}

export function useMessages(conversationId: string | null, limit = 50, offset = 0) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['crm-messages', conversationId, limit, offset, currentOrganization?.id];

  useMessagesRealtime(conversationId);

  return useQuery({
    queryKey,
    queryFn: async () => {
      if (!conversationId) throw new Error('No conversation ID');
      const previous = queryClient.getQueryData<{ messages: CrmMessage[] }>(queryKey);
      const previousOldest = previous?.messages.filter((message) => !message.id.startsWith('optimistic-')).at(-1);
      const fresh: CrmMessage[] = [];
      let total = 0;

      // Keep individual reads below the REST row cap, including in very long threads.
      for (let pageOffset = offset; pageOffset < offset + limit; pageOffset += 500) {
        const { data, error, count } = await supabase
          .from('crm_messages')
          .select('*', { count: 'exact' })
          .eq('conversation_id', conversationId)
          .eq('organization_id', currentOrganization!.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(pageOffset, Math.min(pageOffset + 499, offset + limit - 1));
        if (error) throw error;
        total = count || 0;
        fresh.push(...(data as unknown as CrmMessage[]));
        if (data.length < Math.min(500, offset + limit - pageOffset)) break;
      }

      const fetchedOldest = fresh.at(-1);
      const boundaryOrder = previousOldest && fetchedOldest && compareMessageTimestamps(previousOldest.created_at, fetchedOldest.created_at);
      if (offset === 0 && previousOldest && fetchedOldest &&
        (boundaryOrder < 0 || (boundaryOrder === 0 && previousOldest.id < fetchedOldest.id))) {
        // New arrivals must not evict messages already being read. Refresh the gap
        // from the server rather than retaining stale edited/deleted cache objects.
        for (let gapOffset = 0; ; gapOffset += 500) {
          const { data, error } = await supabase
            .from('crm_messages')
            .select('*')
            .eq('conversation_id', conversationId)
            .eq('organization_id', currentOrganization!.id)
            .gte('created_at', previousOldest.created_at)
            .lte('created_at', fetchedOldest.created_at)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(gapOffset, gapOffset + 499);
          if (error) throw error;
          fresh.push(...(data as unknown as CrmMessage[]));
          if (data.length < 500) break;
        }
      }

      const messages = Array.from(new Map(fresh.map((message) => [message.id, message])).values())
        .sort((a, b) => compareMessageTimestamps(b.created_at, a.created_at) || b.id.localeCompare(a.id));
      return { messages, total, hasMore: total > offset + messages.length };
    },
    enabled: !!conversationId && !!currentOrganization,
    staleTime: 10000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === conversationId && previousQuery?.queryKey[4] === currentOrganization?.id
        ? previous : undefined,
  });
}

/**
 * Infinite query for messages (chat-style infinite scroll)
 */
export function useMessagesInfinite(conversationId: string | null, pageSize = 30) {
  const { currentOrganization } = useAuth();

  return useInfiniteQuery({
    queryKey: ['crm-messages-infinite', conversationId, currentOrganization?.id],
    queryFn: async ({ pageParam = 0 }) => {
      if (!conversationId) throw new Error('No conversation ID');

      const { data, error, count } = await supabase
        .from('crm_messages')
        .select('*', { count: 'exact' })
        .eq('conversation_id', conversationId)
        .eq('organization_id', currentOrganization!.id)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + pageSize - 1);

      if (error) throw error;

      return {
        messages: (data as CrmMessage[]).reverse(), // Oldest first within page
        nextOffset: pageParam + pageSize,
        total: count || 0,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.messages.length < pageSize) return undefined;
      return lastPage.nextOffset;
    },
    enabled: !!conversationId && !!currentOrganization,
  });
}

/**
 * Fetch a single message
 */
export function useMessage(messageId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-message', messageId, currentOrganization?.id],
    queryFn: async () => {
      if (!messageId) throw new Error('No message ID');

      const { data, error } = await supabase
        .from('crm_messages')
        .select('*')
        .eq('id', messageId)
        .eq('organization_id', currentOrganization!.id)
        .single();

      if (error) throw error;
      return data as CrmMessage;
    },
    enabled: !!messageId && !!currentOrganization,
  });
}

/**
 * Search messages across conversations
 */
export function useSearchMessages(searchTerm: string, limit = 50) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-messages-search', searchTerm, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization || !searchTerm) throw new Error('No organization selected or no search term');

      const { data, error } = await supabase
        .from('crm_messages')
        .select(`
          *,
          conversation:crm_conversations(
            id, channel,
            contact:crm_contacts(id, display_name, avatar_url)
          )
        `)
        .eq('organization_id', currentOrganization.id)
        .ilike('content', `%${searchTerm}%`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    },
    enabled: !!user && !!currentOrganization && searchTerm.length > 2,
    staleTime: 30000,
  });
}

/**
 * Send a message immediately via edge function (synchronous send)
 */
export function useSendMessage() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: SendMessageInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!input.recipient_external_id) {
        throw new Error('Cannot send message: no recipient identifier available for this conversation');
      }
      // channel_account_id not required for SMTP email conversations (they use mailbox_id)
      if (!input.channel_account_id && input.channel !== 'email') {
        throw new Error('Cannot send message: no channel account configured for this conversation');
      }

      // Get the current session for auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('No valid session');
      }

      // Call the edge function for immediate send
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-send-message`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            conversation_id: input.conversation_id,
            contact_id: input.contact_id,
            channel: input.channel,
            channel_account_id: input.channel_account_id,
            recipient_external_id: input.recipient_external_id,
            recipient_display_name: input.recipient_display_name,
            external_conversation_id: input.external_conversation_id,
            content: input.content,
            content_type: input.content_type || 'text',
            attachments: input.attachments,
            email_subject: input.email_subject,
            email_cc: input.email_cc,
            email_bcc: input.email_bcc,
            lead_magnet_delivery: input.lead_magnet_delivery,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to send message');
      }

      return {
        message: result.message as CrmMessage,
        leadMagnetRecovery: result.leadMagnetRecovery as LeadMagnetRecoveryResult | undefined,
      } satisfies SendMessageResult;
    },
    onMutate: async (input) => {
      // Optimistic update: show the message instantly in the thread
      const conversationId = input.conversation_id;

      // Cancel outgoing refetches so they don't overwrite optimistic data
      await queryClient.cancelQueries({ queryKey: ['crm-messages', conversationId] });

      // Build an optimistic message object
      const optimisticMessage: CrmMessage = {
        id: `optimistic-${Date.now()}`,
        organization_id: currentOrganization?.id || '',
        conversation_id: conversationId,
        contact_id: input.contact_id,
        direction: 'outbound',
        sender_type: 'user',
        sender_user_id: user?.id || null,
        content: input.content,
        content_type: (input.content_type || 'text') as MessageContentType,
        attachments: input.attachments || [],
        external_message_id: null,
        external_thread_id: null,
        email_subject: input.email_subject || null,
        email_from: null,
        email_to: null,
        email_cc: input.email_cc || null,
        email_bcc: input.email_bcc || null,
        email_headers: {},
        status: 'sending',
        status_updated_at: new Date().toISOString(),
        error_message: null,
        delivered_at: null,
        read_at: null,
        clicked_at: null,
        ai_generated: false,
        ai_model: null,
        ai_prompt_tokens: null,
        ai_completion_tokens: null,
        reply_to_message_id: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Snapshot all matching query caches so we can rollback
      const queryFilter = { queryKey: ['crm-messages', conversationId], exact: false };
      const previousQueries = queryClient.getQueriesData<{ messages: CrmMessage[]; total: number; hasMore: boolean }>(queryFilter);

      // Append the optimistic message to every matching query cache
      queryClient.setQueriesData<{ messages: CrmMessage[]; total: number; hasMore: boolean }>(
        queryFilter,
        (old) => {
          if (!old) return old;
          return {
            ...old,
            messages: [optimisticMessage, ...old.messages],
            total: old.total + 1,
          };
        }
      );

      return { previousQueries, conversationId };
    },
    onSuccess: (data, _input, context) => {
      // Replace optimistic data with real server data
      const conversationId = context?.conversationId || data.message.conversation_id;
      queryClient.invalidateQueries({ queryKey: ['crm-messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-messages-infinite', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['contact-enrollments', _input.contact_id] });
    },
    onError: (error, _input, context) => {
      // Rollback optimistic update on failure
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
    },
  });
}

/**
 * Queue a message for sending (through the message queue)
 */
export function useQueueMessage() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: QueueMessageInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Call the database function to queue the message
      const { data, error } = await supabase.rpc('queue_crm_message', {
        p_org_id: currentOrganization.id,
        p_contact_id: input.contact_id,
        p_channel: input.channel,
        p_recipient_external_id: input.recipient_external_id,
        p_content: input.content,
        p_channel_account_id: input.channel_account_id || null,
        p_conversation_id: input.conversation_id || null,
        p_recipient_identity_id: input.recipient_identity_id || null,
        p_recipient_display_name: input.recipient_display_name || null,
        p_content_type: input.content_type || 'text',
        p_attachments: JSON.stringify(input.attachments || []),
        p_email_subject: input.email_subject || null,
        p_email_cc: input.email_cc || null,
        p_email_bcc: input.email_bcc || null,
        p_sender_type: input.sender_type || 'user',
        p_sender_user_id: user.id,
        p_source_type: input.source_type || 'manual',
        p_source_id: input.source_id || null,
        p_scheduled_for: input.scheduled_for || new Date().toISOString(),
        p_priority: input.priority || 0,
        p_metadata: '{}',
      });

      if (error) throw error;
      return data as string; // Returns queue item ID
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ['crm-message-queue'] });
      if (input.conversation_id) {
        queryClient.invalidateQueries({ queryKey: ['crm-messages', input.conversation_id] });
      }
      toast.success('Message queued for sending');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to queue message');
    },
  });
}

/**
 * Record an inbound message (from webhook/polling)
 */
export function useRecordInboundMessage() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      contactId,
      content,
      externalMessageId,
      contentType = 'text',
      attachments = [],
      emailSubject,
      emailFrom,
      emailTo,
      emailCc,
      metadata = {},
    }: {
      conversationId: string;
      contactId: string;
      content: string;
      externalMessageId?: string;
      contentType?: MessageContentType;
      attachments?: MessageAttachment[];
      emailSubject?: string;
      emailFrom?: string;
      emailTo?: string[];
      emailCc?: string[];
      metadata?: Record<string, unknown>;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_messages')
        .insert({
          organization_id: currentOrganization.id,
          conversation_id: conversationId,
          contact_id: contactId,
          direction: 'inbound',
          sender_type: 'contact',
          content,
          content_type: contentType,
          attachments,
          external_message_id: externalMessageId || null,
          email_subject: emailSubject || null,
          email_from: emailFrom || null,
          email_to: emailTo || null,
          email_cc: emailCc || null,
          status: 'delivered',
          delivered_at: new Date().toISOString(),
          metadata,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-messages', data.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-messages-infinite', data.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-unread-count'] });
    },
  });
}

/**
 * Update message status
 */
export function useUpdateMessageStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      status,
      errorMessage,
      deliveredAt,
      readAt,
      clickedAt,
    }: {
      messageId: string;
      status: MessageStatus;
      errorMessage?: string;
      deliveredAt?: string;
      readAt?: string;
      clickedAt?: string;
    }) => {
      const updateData: Record<string, unknown> = {
        status,
        status_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (errorMessage !== undefined) updateData.error_message = errorMessage;
      if (deliveredAt) updateData.delivered_at = deliveredAt;
      if (readAt) updateData.read_at = readAt;
      if (clickedAt) updateData.clicked_at = clickedAt;

      const { data, error } = await supabase
        .from('crm_messages')
        .update(updateData)
        .eq('id', messageId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmMessage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-messages', data.conversation_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-message', data.id] });
    },
  });
}

/**
 * Delete a message (soft delete by marking as deleted, or hard delete)
 */
export function useDeleteMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ messageId, conversationId }: { messageId: string; conversationId: string }) => {
      const { error } = await supabase
        .from('crm_messages')
        .delete()
        .eq('id', messageId);

      if (error) throw error;
      return conversationId;
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-messages-infinite', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      toast.success('Message deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete message');
    },
  });
}

/**
 * Get message counts by status for analytics
 */
export function useMessageStats(conversationId?: string, fromDate?: string, toDate?: string) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-message-stats', conversationId, fromDate, toDate, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      let query = supabase
        .from('crm_messages')
        .select('direction, status, ai_generated')
        .eq('organization_id', currentOrganization.id);

      if (conversationId) {
        query = query.eq('conversation_id', conversationId);
      }

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Calculate stats
      const stats = {
        total: data?.length || 0,
        inbound: 0,
        outbound: 0,
        ai_generated: 0,
        byStatus: {} as Record<string, number>,
      };

      for (const msg of data || []) {
        if (msg.direction === 'inbound') stats.inbound++;
        if (msg.direction === 'outbound') stats.outbound++;
        if (msg.ai_generated) stats.ai_generated++;
        stats.byStatus[msg.status] = (stats.byStatus[msg.status] || 0) + 1;
      }

      return stats;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}
