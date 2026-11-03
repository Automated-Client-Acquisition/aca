import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery, keepPreviousData } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CrmContact } from "./useContacts";
import { chunkedMutate } from "./useContacts";

// ============================================================================
// Types
// ============================================================================

export type ConversationChannel = 'linkedin' | 'instagram' | 'email' | 'whatsapp' | 'telegram' | 'sms' | 'messenger' | 'twitter';
export type ConversationStatus = 'open' | 'snoozed' | 'closed' | 'archived';
export type AssignedToType = 'unassigned' | 'user' | 'ai' | 'automation';

export interface CrmConversation {
  id: string;
  organization_id: string;
  contact_id: string;
  channel: ConversationChannel;
  channel_account_id: string | null;
  external_conversation_id: string | null;
  external_participant_id: string | null;
  status: ConversationStatus;
  snoozed_until: string | null;
  assigned_to_user_id: string | null;
  assigned_to_type: AssignedToType;
  ai_enabled: boolean;
  ai_paused_until: string | null;
  ai_context: Record<string, unknown>;
  human_takeover_at: string | null;
  human_takeover_reason: string | null;
  message_count: number;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_subject?: string | null;
  last_message_direction: 'inbound' | 'outbound' | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // SMTP email mailbox (for outreach email conversations)
  mailbox_id: string | null;
  // AI-classified lead intent (interested, not_interested, etc.)
  lead_intent: string | null;
  // Smart inbox triage priority (computed by DB trigger)
  priority_score: number;
  // Deal momentum signals
  momentum_score: number;
  momentum_trend: 'rising' | 'stable' | 'falling' | 'cold';
  // Smart snooze context
  snooze_type: 'timed' | 'until_reply' | 'until_ooo_ends' | 'until_meeting' | 'until_timezone_morning';
  snooze_context: Record<string, unknown>;
  // Response time SLA
  avg_response_time_ms: number | null;
  sla_status: 'ok' | 'warning' | 'breached';
  // System/automated conversation (bounces, noreply, DMARC, notifications)
  is_system: boolean;
  // Gmail-style inbox: true if conversation has ever received an inbound message
  has_inbound_message: boolean;
  // True if conversation has ever had an outbound message (for Sent tab)
  has_outbound_message: boolean;
}

export interface ConversationWithContact extends CrmConversation {
  contact: CrmContact | null;
}

export interface ConversationFilters {
  status?: ConversationStatus | ConversationStatus[];
  channel?: ConversationChannel | ConversationChannel[];
  assigned_to_user_id?: string | null;
  assigned_to_type?: AssignedToType;
  has_unread?: boolean;
  ai_enabled?: boolean;
  search?: string;
  lead_intent?: string | string[];
  sort_by?: 'last_message_at' | 'priority_score' | 'momentum_score';
  exclude_keywords?: string[];
  direction_filter?: 'sent_only' | 'inbox';
}

// OTP / login-code emails are actionable, time-sensitive mail the user needs
// to see — mirrors the carve-out in supabase/functions/_shared/reply-processing.ts
// so a keyword exclusion like "noreply" (which legitimately matches many OTP
// senders) never hides a login code.
const OTP_SUBJECT_PATTERNS = [
  /\bone[- ]?time (login |use )?(code|password|pin)\b/i,
  /\b(login|security|verification|authentication) code\b/i,
  /\byour (code|pin) is\b/i,
  /\bOTP\b/,
  /\b2fa code\b/i,
];

/**
 * Check if a conversation matches any user-defined exclusion keywords.
 * Checks message preview, email subject, contact name, and contact email (case-insensitive).
 */
export function matchesExclusionKeywords(
  conv: ConversationWithContact,
  keywords: string[],
): boolean {
  if (keywords.length === 0) return false;
  if (OTP_SUBJECT_PATTERNS.some(p => p.test(conv.last_message_subject || ''))) return false;
  const haystack = [
    conv.last_message_preview,
    conv.last_message_subject,
    conv.contact?.display_name,
    conv.contact?.primary_email,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return keywords.some(kw => haystack.includes(kw.toLowerCase()));
}

export interface CreateConversationInput {
  contact_id: string;
  channel: ConversationChannel;
  channel_account_id?: string;
  external_conversation_id?: string;
  external_participant_id?: string;
  status?: ConversationStatus;
  ai_enabled?: boolean;
}

export interface UpdateConversationInput {
  id: string;
  status?: ConversationStatus;
  snoozed_until?: string | null;
  assigned_to_user_id?: string | null;
  assigned_to_type?: AssignedToType;
  ai_enabled?: boolean;
  ai_paused_until?: string | null;
  ai_context?: Record<string, unknown>;
  human_takeover_at?: string | null;
  human_takeover_reason?: string | null;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Subscribe to realtime conversation updates (new messages, status changes).
 * Invalidates conversation list and unread count caches.
 */
export function useConversationsRealtime() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();
  const orgId = currentOrganization?.id;

  useEffect(() => {
    if (!orgId) return;

    const channel = supabase
      .channel(`crm-conversations-rt-${orgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'crm_conversations',
          filter: `organization_id=eq.${orgId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
          queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
          queryClient.invalidateQueries({ queryKey: ['crm-unread-count'] });
          queryClient.invalidateQueries({ queryKey: ['crm-sent-count'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, queryClient]);
}

/**
 * Fetch conversations with filters and pagination
 */
export function useConversations(filters?: ConversationFilters, limit = 50) {
  const { user, currentOrganization } = useAuth();

  // Subscribe to realtime updates for conversations
  useConversationsRealtime();

  return useQuery({
    queryKey: ['crm-conversations', filters, currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      let query = supabase
        .from('crm_conversations')
        .select(`
          *,
          contact:crm_contacts(
            id, display_name, first_name, last_name, primary_email, primary_phone,
            avatar_url, company, job_title, status
          )
        `)
        .eq('organization_id', currentOrganization.id)
        .eq('is_system', false)
        .order(
          filters?.sort_by === 'priority_score' ? 'priority_score' :
          filters?.sort_by === 'momentum_score' ? 'momentum_score' :
          'last_message_at',
          { ascending: false, nullsFirst: false }
        )
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

      if (filters?.assigned_to_user_id !== undefined) {
        if (filters.assigned_to_user_id === null) {
          query = query.is('assigned_to_user_id', null);
        } else if (filters.assigned_to_user_id === 'mine') {
          query = query.eq('assigned_to_user_id', user!.id);
        } else {
          query = query.eq('assigned_to_user_id', filters.assigned_to_user_id);
        }
      }

      if (filters?.assigned_to_type) {
        query = query.eq('assigned_to_type', filters.assigned_to_type);
      }

      if (filters?.has_unread) {
        query = query.gt('unread_count', 0);
      }

      if (filters?.ai_enabled !== undefined) {
        query = query.eq('ai_enabled', filters.ai_enabled);
      }

      if (filters?.lead_intent) {
        if (Array.isArray(filters.lead_intent)) {
          query = query.in('lead_intent', filters.lead_intent);
        } else {
          query = query.eq('lead_intent', filters.lead_intent);
        }
      }

      if (filters?.direction_filter === 'sent_only') {
        query = query.filter('has_outbound_message', 'eq', true);
      } else if (filters?.direction_filter === 'inbox') {
        query = query.filter('has_inbound_message', 'eq', true);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Filter by search if provided (client-side for now)
      let results = data as ConversationWithContact[];
      if (filters?.search) {
        const search = filters.search.toLowerCase();
        results = results.filter(conv =>
          conv.contact?.display_name?.toLowerCase().includes(search) ||
          conv.contact?.primary_email?.toLowerCase().includes(search) ||
          conv.last_message_preview?.toLowerCase().includes(search)
        );
      }

      // Exclude conversations matching user-defined keywords (warmup, DMARC, etc.)
      if (filters?.exclude_keywords?.length) {
        results = results.filter(conv => !matchesExclusionKeywords(conv, filters.exclude_keywords!));
      }
      return results;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

interface ConversationsPage {
  conversations: ConversationWithContact[];
  nextOffset: number;
  /** Exact match count for the filtered set. Only populated on page 0. */
  total: number;
  /** Rows returned by Postgres before client-side exclusion — drives pagination. */
  rawPageSize: number;
}

/**
 * Infinite query for conversations (inbox-style pagination)
 */
export function useConversationsInfinite(filters?: ConversationFilters, pageSize = 20) {
  const { user, currentOrganization } = useAuth();

  // Subscribe to realtime updates
  useConversationsRealtime();

  // Preview/contact-field keywords are applied client-side and stay out of the
  // query key. Full-body matches are persisted by the database as is_system and
  // are excluded by the query itself.
  const {
    exclude_keywords: excludeKeywords,
    ...dbFilters
  } = filters ?? {};

  const selectExcluded = useCallback(
    (data: InfiniteData<ConversationsPage, number>): InfiniteData<ConversationsPage, number> => {
      if (!excludeKeywords?.length) return data;
      return {
        ...data,
        pages: data.pages.map((page) => {
          let conversations = page.conversations;
          if (excludeKeywords?.length) {
            conversations = conversations.filter(
              (conv) => !matchesExclusionKeywords(conv, excludeKeywords),
            );
          }
          return conversations === page.conversations ? page : { ...page, conversations };
        }),
      };
    },
    [excludeKeywords],
  );

  return useInfiniteQuery({
    queryKey: ['crm-conversations-infinite', dbFilters, currentOrganization?.id],
    select: selectExcluded,
    queryFn: async ({ pageParam = 0 }) => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      // Only page 0 carries the exact count — it is a full COUNT(*) over the filtered
      // set (~220ms here) and only pages[0].total is ever read.
      const countOption = pageParam === 0 ? { count: 'exact' as const } : undefined;

      let query = supabase
        .from('crm_conversations')
        .select(`
          *,
          contact:crm_contacts(
            id, display_name, first_name, last_name, primary_email, primary_phone,
            avatar_url, company, job_title, status
          )
        `, countOption)
        .eq('organization_id', currentOrganization.id)
        .eq('is_system', false)
        .order(
          filters?.sort_by === 'priority_score' ? 'priority_score' :
          filters?.sort_by === 'momentum_score' ? 'momentum_score' :
          'last_message_at',
          { ascending: false, nullsFirst: false }
        )
        .range(pageParam, pageParam + pageSize - 1);

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

      if (filters?.assigned_to_user_id !== undefined) {
        if (filters.assigned_to_user_id === null) {
          query = query.is('assigned_to_user_id', null);
        } else if (filters.assigned_to_user_id === 'mine') {
          query = query.eq('assigned_to_user_id', user!.id);
        } else {
          query = query.eq('assigned_to_user_id', filters.assigned_to_user_id);
        }
      }

      if (filters?.assigned_to_type) {
        query = query.eq('assigned_to_type', filters.assigned_to_type);
      }

      if (filters?.has_unread) {
        query = query.gt('unread_count', 0);
      }

      if (filters?.ai_enabled !== undefined) {
        query = query.eq('ai_enabled', filters.ai_enabled);
      }

      if (filters?.lead_intent) {
        if (Array.isArray(filters.lead_intent)) {
          query = query.in('lead_intent', filters.lead_intent);
        } else {
          query = query.eq('lead_intent', filters.lead_intent);
        }
      }

      if (filters?.direction_filter === 'sent_only') {
        query = query.filter('has_outbound_message', 'eq', true);
      } else if (filters?.direction_filter === 'inbox') {
        query = query.filter('has_inbound_message', 'eq', true);
      }

      const { data, error, count } = await query;

      if (error) throw error;

      const rows = data as ConversationWithContact[];

      // Keyword/ID exclusion happens in `select` so it does not re-key this query.
      return {
        conversations: rows,
        nextOffset: pageParam + pageSize,
        total: count || 0,
        rawPageSize: rows.length,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      // Use raw DB page size (before client-side keyword exclusion) to decide pagination
      if (lastPage.rawPageSize < pageSize) return undefined;
      return lastPage.nextOffset;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Fetch ALL conversation IDs matching the given filters (no pagination).
 * Used by "Select All" to get the full set of matching IDs for batch actions.
 * Only enabled when explicitly requested (enabled param).
 */
export function useAllMatchingConversationIds(
  filters: ConversationFilters | undefined,
  enabled: boolean,
) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-conversation-ids-all', filters, currentOrganization?.id],
    queryFn: async () => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      let query = supabase
        .from('crm_conversations')
        .select('id, last_message_preview, last_message_subject, contact:crm_contacts(display_name, primary_email)')
        .eq('organization_id', currentOrganization.id)
        .eq('is_system', false);

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
      if (filters?.assigned_to_user_id !== undefined) {
        if (filters.assigned_to_user_id === null) {
          query = query.is('assigned_to_user_id', null);
        } else if (filters.assigned_to_user_id === 'mine') {
          query = query.eq('assigned_to_user_id', user.id);
        } else {
          query = query.eq('assigned_to_user_id', filters.assigned_to_user_id);
        }
      }
      if (filters?.assigned_to_type) {
        query = query.eq('assigned_to_type', filters.assigned_to_type);
      }
      if (filters?.has_unread) {
        query = query.gt('unread_count', 0);
      }
      if (filters?.ai_enabled !== undefined) {
        query = query.eq('ai_enabled', filters.ai_enabled);
      }
      if (filters?.lead_intent) {
        if (Array.isArray(filters.lead_intent)) {
          query = query.in('lead_intent', filters.lead_intent);
        } else {
          query = query.eq('lead_intent', filters.lead_intent);
        }
      }
      if (filters?.direction_filter === 'sent_only') {
        query = query.filter('has_outbound_message', 'eq', true);
      } else if (filters?.direction_filter === 'inbox') {
        query = query.filter('has_inbound_message', 'eq', true);
      }

      // Supabase has a 1000-row default limit; override with a large limit
      query = query.limit(10000);

      const { data, error } = await query;
      if (error) throw error;

      let ids = (data || []).map((row: any) => row.id as string);

      // Apply client-side keyword exclusion (same as infinite query)
      if (filters?.exclude_keywords?.length) {
        const keywords = filters.exclude_keywords;
        ids = (data || []).filter((row: any) => {
          const haystack = [
            row.last_message_preview,
            row.last_message_subject,
            row.contact?.display_name,
            row.contact?.primary_email,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return !keywords.some(kw => haystack.includes(kw.toLowerCase()));
        }).map((row: any) => row.id as string);
      }

      return ids;
    },
    enabled: enabled && !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Fetch conversations by a set of IDs (used for favorites tab).
 * Returns all matching conversations in a single non-paginated query.
 */
export function useFavoriteConversations(
  favoriteIds: Set<string> | undefined,
  enabled: boolean,
  filters?: Pick<ConversationFilters, 'status' | 'channel' | 'exclude_keywords'>,
) {
  const { user, currentOrganization } = useAuth();
  const ids = favoriteIds ? Array.from(favoriteIds) : [];
  // Stabilize query key: sort IDs so identical sets produce the same key
  const stableIds = useMemo(() => [...ids].sort(), [ids.join(',')]);

  return useQuery({
    queryKey: ['crm-conversations-favorites', stableIds, filters, currentOrganization?.id],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      if (!user || !currentOrganization || ids.length === 0) return [];

      let query = supabase
        .from('crm_conversations')
        .select(`
          *,
          contact:crm_contacts(
            id, display_name, first_name, last_name, primary_email, primary_phone,
            avatar_url, company, job_title, status
          )
        `)
        .eq('organization_id', currentOrganization.id)
        .in('id', ids)
        .order('last_message_at', { ascending: false, nullsFirst: false });

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

      const { data, error } = await query;
      if (error) throw error;

      let results = data as ConversationWithContact[];

      if (filters?.exclude_keywords?.length) {
        results = results.filter(conv => !matchesExclusionKeywords(conv, filters.exclude_keywords!));
      }
      return results;
    },
    enabled: enabled && !!user && !!currentOrganization && ids.length > 0,
    staleTime: 30000,
  });
}

/**
 * Fetch a single conversation with contact details
 */
export function useConversation(conversationId: string | null) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-conversation', conversationId, currentOrganization?.id],
    queryFn: async () => {
      if (!conversationId || !user) throw new Error('No conversation ID or not authenticated');

      const { data, error } = await supabase
        .from('crm_conversations')
        .select(`
          *,
          contact:crm_contacts(
            *,
            identities:crm_contact_identities(*)
          )
        `)
        .eq('id', conversationId)
        .eq('organization_id', currentOrganization!.id)
        .single();

      if (error) throw error;
      return data as ConversationWithContact;
    },
    enabled: !!conversationId && !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get conversations for a specific contact
 */
export function useContactConversations(contactId: string | null) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-contact-conversations', contactId, currentOrganization?.id],
    queryFn: async () => {
      if (!contactId || !user) throw new Error('No contact ID or not authenticated');

      const { data, error } = await supabase
        .from('crm_conversations')
        .select('*')
        .eq('contact_id', contactId)
        .eq('organization_id', currentOrganization!.id)
        .order('last_message_at', { ascending: false });

      if (error) throw error;
      return data as CrmConversation[];
    },
    enabled: !!contactId && !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Get unread conversation count.
 * Accepts the same status filter used by the inbox list so the badge
 * matches what the user actually sees (e.g. excludes closed/archived).
 */
export function useUnreadConversationCount(
  statusFilter?: ConversationStatus | ConversationStatus[],
  options?: {
    excludeSent?: boolean;
  },
) {
  const { user, currentOrganization } = useAuth();
  const excludeSent = options?.excludeSent ?? false;

  return useQuery({
    queryKey: [
      'crm-unread-count',
      currentOrganization?.id,
      statusFilter,
      excludeSent,
    ],
    queryFn: async () => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      let query = supabase
        .from('crm_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', currentOrganization.id)
        .eq('is_system', false)
        .gt('unread_count', 0);

      if (statusFilter) {
        if (Array.isArray(statusFilter)) {
          query = query.in('status', statusFilter);
        } else {
          query = query.eq('status', statusFilter);
        }
      }

      // Match inbox "Received" tab: only conversations that have received an inbound message
      if (excludeSent) {
        query = query.filter('has_inbound_message', 'eq', true);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Get count of conversations with at least one outbound message.
 * Used for the "Sent" tab badge in the inbox.
 */
export function useSentConversationCount(
  statusFilter?: ConversationStatus | ConversationStatus[],
) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-sent-count', currentOrganization?.id, statusFilter],
    queryFn: async () => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      let query = supabase
        .from('crm_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', currentOrganization.id)
        .eq('is_system', false)
        .filter('has_outbound_message', 'eq', true);

      if (statusFilter) {
        if (Array.isArray(statusFilter)) {
          query = query.in('status', statusFilter);
        } else {
          query = query.eq('status', statusFilter);
        }
      }

      const { count, error } = await query;

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

/**
 * Create a new conversation
 */
export function useCreateConversation() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateConversationInput) => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('crm_conversations')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: input.contact_id,
          channel: input.channel,
          channel_account_id: input.channel_account_id || null,
          external_conversation_id: input.external_conversation_id || null,
          external_participant_id: input.external_participant_id || null,
          status: input.status || 'open',
          ai_enabled: input.ai_enabled || false,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-conversations', data.contact_id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create conversation');
    },
  });
}

/**
 * Update a conversation
 */
export function useUpdateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateConversationInput) => {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.status !== undefined) updateData.status = input.status;
      if (input.snoozed_until !== undefined) updateData.snoozed_until = input.snoozed_until;
      if (input.assigned_to_user_id !== undefined) updateData.assigned_to_user_id = input.assigned_to_user_id;
      if (input.assigned_to_type !== undefined) updateData.assigned_to_type = input.assigned_to_type;
      if (input.ai_enabled !== undefined) updateData.ai_enabled = input.ai_enabled;
      if (input.ai_paused_until !== undefined) updateData.ai_paused_until = input.ai_paused_until;
      if (input.ai_context !== undefined) updateData.ai_context = input.ai_context;
      if (input.human_takeover_at !== undefined) updateData.human_takeover_at = input.human_takeover_at;
      if (input.human_takeover_reason !== undefined) updateData.human_takeover_reason = input.human_takeover_reason;

      const { data, error } = await supabase
        .from('crm_conversations')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-conversations', data.contact_id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update conversation');
    },
  });
}

/**
 * Mark conversation as read
 */
export function useMarkConversationRead() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      if (!user) throw new Error('Not authenticated');

      // Call the database function
      const { error } = await supabase.rpc('mark_conversation_read', {
        p_conversation_id: conversationId,
        p_user_id: user.id,
      });

      if (error) throw error;
      return conversationId;
    },
    onSuccess: (conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['crm-unread-count'] });
    },
  });
}

/**
 * Close a conversation
 */
export function useCloseConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await supabase
        .from('crm_conversations')
        .update({
          status: 'closed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      toast.success('Conversation closed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to close conversation');
    },
  });
}

/**
 * Reopen a conversation
 */
export function useReopenConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { data, error } = await supabase
        .from('crm_conversations')
        .update({
          status: 'open',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      toast.success('Conversation reopened');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reopen conversation');
    },
  });
}

/**
 * Snooze a conversation
 */
export function useSnoozeConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, until, snoozeType, snoozeContext }: {
      conversationId: string;
      until?: string;
      snoozeType?: 'timed' | 'until_reply' | 'until_ooo_ends' | 'until_meeting' | 'until_timezone_morning';
      snoozeContext?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase
        .from('crm_conversations')
        .update({
          status: 'snoozed',
          snoozed_until: until || null,
          snooze_type: snoozeType || 'timed',
          snooze_context: snoozeContext || {},
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      toast.success('Conversation snoozed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to snooze conversation');
    },
  });
}

/**
 * Assign conversation to user
 */
export function useAssignConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      userId,
      type = 'user',
    }: {
      conversationId: string;
      userId: string | null;
      type?: AssignedToType;
    }) => {
      const { data, error } = await supabase
        .from('crm_conversations')
        .update({
          assigned_to_user_id: userId,
          assigned_to_type: userId ? type : 'unassigned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      toast.success(data.assigned_to_user_id ? 'Conversation assigned' : 'Conversation unassigned');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to assign conversation');
    },
  });
}

/**
 * Toggle AI handling for conversation.
 * When enabling, loads config from: profileId → org default profile → hardcoded defaults.
 */
export function useToggleConversationAI() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      enabled,
      profileId,
    }: {
      conversationId: string;
      enabled: boolean;
      profileId?: string;
    }) => {
      const updateData: Record<string, unknown> = {
        ai_enabled: enabled,
        updated_at: new Date().toISOString(),
      };

      // If enabling AI, set assigned_to_type and load autopilot config
      if (enabled) {
        updateData.assigned_to_type = 'ai';
        updateData.human_takeover_at = null;
        updateData.human_takeover_reason = null;

        // Reset autopilot state so the agent starts fresh (prevents stuck escalation)
        updateData.autopilot_state = {
          phase: 'greeting',
          turn_count: 0,
          last_autopilot_at: null,
          escalation_reason: null,
        };

        // Default config (fallback)
        let autopilotConfig: Record<string, unknown> = {
          enabled: true,
          rules: [
            { intent: 'interested', action: 'auto_reply' },
            { intent: 'neutral', action: 'auto_reply' },
            { intent: 'out_of_office', action: 'auto_followup_after_return' },
            { intent: 'not_interested', action: 'auto_reply' },
          ],
          require_approval: true,
          max_auto_replies: 10,
        };

        // Fetch existing metadata and profile to preserve all agent settings
        const { data: existing } = await supabase
          .from('crm_conversations')
          .select('metadata, agent_profile_id')
          .eq('id', conversationId)
          .single();

        const existingMetadata = (existing?.metadata || {}) as Record<string, unknown>;
        const existingConfig = (existingMetadata.autopilot_config || null) as Record<string, unknown> | null;
        const existingProfileId = (existing as any)?.agent_profile_id as string | null;

        let resolvedProfileId: string | null = profileId || existingProfileId || null;

        // If the conversation already has a saved config, restore it as-is (just re-enable).
        // This preserves ALL settings: calendar, timezone, rules, limits, knowledge base, etc.
        if (existingConfig && Object.keys(existingConfig).length > 1) {
          autopilotConfig = { ...existingConfig, enabled: true };
        } else if (resolvedProfileId) {
          // No saved config — load from the linked or specified profile
          const { data: profile } = await supabase
            .from('ai_agent_profiles')
            .select('config')
            .eq('id', resolvedProfileId)
            .single();
          if (profile?.config) {
            autopilotConfig = { ...(profile.config as Record<string, unknown>), enabled: true };
          }
        } else if (user && currentOrganization) {
          // Fall back to org's default profile
          const { data: defaultProfile } = await supabase
            .from('ai_agent_profiles')
            .select('id, config')
            .eq('organization_id', currentOrganization.id)
            .eq('is_default', true)
            .maybeSingle();
          if (defaultProfile?.config) {
            autopilotConfig = { ...(defaultProfile.config as Record<string, unknown>), enabled: true };
            resolvedProfileId = defaultProfile.id;
          }
        }

        updateData.metadata = {
          ...existingMetadata,
          autopilot_config: autopilotConfig,
        };
        updateData.agent_profile_id = resolvedProfileId;
      } else {
        // Human takeover — keep agent_profile_id so re-enabling restores the same profile
        updateData.human_takeover_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('crm_conversations')
        .update(updateData)
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as CrmConversation;
    },
    onMutate: async ({ conversationId, enabled }) => {
      // Optimistically update the conversation in the infinite cache
      await queryClient.cancelQueries({ queryKey: ['crm-conversations-infinite'] });

      const updateConversation = (old: any) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            conversations: page.conversations.map((c: any) =>
              c.id === conversationId ? { ...c, ai_enabled: enabled } : c
            ),
          })),
        };
      };

      // Patch all matching infinite query caches
      queryClient.setQueriesData(
        { queryKey: ['crm-conversations-infinite'] },
        updateConversation,
      );

      // Also patch single conversation cache
      queryClient.setQueriesData(
        { queryKey: ['crm-conversation', conversationId] },
        (old: any) => old ? { ...old, ai_enabled: enabled } : old,
      );
    },
    onSuccess: (data) => {
      // Background refetch to sync full server state
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      toast.success(data.ai_enabled ? 'AI handling enabled' : 'Human takeover activated');

      // When enabling AI, trigger autopilot on the latest message so a draft is generated
      if (data.ai_enabled) {
        supabase.functions.invoke('inbox-autopilot-trigger', {
          body: { conversationId: data.id },
        }).then(() => {
          // Refresh the autopilot queue so the draft appears
          queryClient.invalidateQueries({ queryKey: ['autopilot-queue-conversation'] });
        }).catch((err) => {
          console.warn('Autopilot trigger failed:', err);
        });
      }
    },
    onError: (error) => {
      // Revert optimistic update by refetching
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      toast.error(error instanceof Error ? error.message : 'Failed to toggle AI handling');
    },
  });
}

/**
 * Update agent profile and config on a conversation.
 * Used when the user changes the agent profile or settings in the Agent Panel.
 */
export function useUpdateConversationAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      profileId,
      config,
    }: {
      conversationId: string;
      profileId: string | null;
      config: Record<string, unknown>;
    }) => {
      // Fetch existing metadata to merge
      const { data: existing } = await supabase
        .from('crm_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .single();

      const existingMetadata = (existing?.metadata || {}) as Record<string, unknown>;

      const { data, error } = await supabase
        .from('crm_conversations')
        .update({
          agent_profile_id: profileId,
          metadata: {
            ...existingMetadata,
            autopilot_config: config,
          } as any,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as CrmConversation;
    },
    onMutate: async ({ conversationId, profileId, config }) => {
      await queryClient.cancelQueries({ queryKey: ['crm-conversations-infinite'] });

      queryClient.setQueriesData(
        { queryKey: ['crm-conversations-infinite'] },
        (old: any) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              conversations: page.conversations.map((c: any) =>
                c.id === conversationId
                  ? {
                      ...c,
                      agent_profile_id: profileId,
                      metadata: { ...(c.metadata || {}), autopilot_config: config },
                    }
                  : c
              ),
            })),
          };
        },
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      queryClient.invalidateQueries({ queryKey: ['autopilot-queue-conversation'] });
      toast.success('Agent settings saved');
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      toast.error(error instanceof Error ? error.message : 'Failed to save agent settings');
    },
  });
}

/**
 * Get or create conversation for contact-channel pair
 */
export function useGetOrCreateConversation() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      channel,
      channelAccountId,
      externalConversationId,
      externalParticipantId,
    }: {
      contactId: string;
      channel: ConversationChannel;
      channelAccountId?: string;
      externalConversationId?: string;
      externalParticipantId?: string;
    }) => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      // Call the database function
      const { data, error } = await supabase.rpc('get_or_create_conversation', {
        p_org_id: currentOrganization.id,
        p_contact_id: contactId,
        p_channel: channel,
        p_channel_account_id: channelAccountId || null,
        p_external_conversation_id: externalConversationId || null,
        p_external_participant_id: externalParticipantId || null,
      });

      if (error) throw error;

      // Fetch the full conversation
      const { data: conversation, error: fetchError } = await supabase
        .from('crm_conversations')
        .select('*')
        .eq('id', data)
        .single();

      if (fetchError) throw fetchError;
      return conversation as CrmConversation;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversation', data.id] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-conversations', data.contact_id] });
    },
  });
}

/**
 * Result type for starting a conversation
 */
export interface StartConversationResult {
  success: boolean;
  conversationId?: string;
  error?: 'no_linkedin_identity' | 'no_channel_account' | 'not_connected' | 'unknown';
  errorMessage?: string;
  isConnection?: boolean;
}

/**
 * Input for starting a conversation
 */
export interface StartConversationInput {
  contact: CrmContact;
  channel?: ConversationChannel;
  channelAccountId?: string;
}

/**
 * Hook to start a conversation with a contact
 * Handles finding/creating conversations and provides feedback about messaging capability
 */
export function useStartConversation() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contact,
      channel = 'linkedin',
      channelAccountId,
    }: StartConversationInput): Promise<StartConversationResult> => {
      if (!user || !currentOrganization) throw new Error('Not authenticated');

      // For LinkedIn, find the contact's LinkedIn identity
      if (channel === 'linkedin') {
        // Check if contact has identities loaded
        const identities = contact.identities || [];
        const linkedinIdentity = identities.find(
          (identity) => identity.channel === 'linkedin'
        );

        if (!linkedinIdentity) {
          return {
            success: false,
            error: 'no_linkedin_identity',
            errorMessage: 'This contact does not have a LinkedIn profile linked.',
            isConnection: contact.is_linkedin_connection,
          };
        }

        // If no channel account ID provided, we need to get the default LinkedIn account
        let effectiveChannelAccountId = channelAccountId;
        if (!effectiveChannelAccountId) {
          // Fetch the first available LinkedIn account for this org
          const { data: accounts, error: accountError } = await supabase
            .from('unipile_accounts')
            .select('id')
            .eq('organization_id', currentOrganization.id)
            .eq('provider', 'LINKEDIN')
            .eq('status', 'connected')
            .limit(1);

          if (accountError) throw accountError;

          if (!accounts || accounts.length === 0) {
            return {
              success: false,
              error: 'no_channel_account',
              errorMessage: 'No LinkedIn account connected. Please connect a LinkedIn account first.',
              isConnection: contact.is_linkedin_connection,
            };
          }

          effectiveChannelAccountId = accounts[0].id;
        }

        // Get or create conversation
        const { data: conversationId, error: convError } = await supabase.rpc(
          'get_or_create_conversation',
          {
            p_org_id: currentOrganization.id,
            p_contact_id: contact.id,
            p_channel: channel,
            p_channel_account_id: effectiveChannelAccountId,
            p_external_conversation_id: null, // Will be populated when message is sent
            p_external_participant_id: linkedinIdentity.platform_user_id,
          }
        );

        if (convError) throw convError;

        return {
          success: true,
          conversationId: conversationId as string,
          isConnection: contact.is_linkedin_connection,
        };
      }

      // For other channels, similar logic would apply
      // For now, return an error for unsupported channels
      return {
        success: false,
        error: 'unknown',
        errorMessage: `Channel ${channel} is not yet supported for direct messaging.`,
      };
    },
    onSuccess: (result) => {
      if (result.success && result.conversationId) {
        queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      }
    },
  });
}

/**
 * Delete a conversation and all its messages
 */
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      // Delete all messages first
      const { error: msgError } = await supabase
        .from('crm_messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (msgError) throw msgError;

      const { error } = await supabase
        .from('crm_conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;
      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['crm-unread-count'] });
      toast.success('Conversation deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete conversation');
    },
  });
}

/**
 * Batch conversation actions — bypasses per-item mutation hooks
 * to avoid N individual toast notifications. Shows a single summary toast.
 */
export function useBatchConversationActions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
    queryClient.invalidateQueries({ queryKey: ['crm-conversations-infinite'] });
    queryClient.invalidateQueries({ queryKey: ['crm-unread-count'] });
  };

  const batchClose = async (ids: string[]) => {
    try {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from('crm_conversations')
          .update({ status: 'closed', updated_at: new Date().toISOString() })
          .in('id', chunk)
      );
      invalidateAll();
      toast.success(`${ids.length} conversation${ids.length !== 1 ? 's' : ''} closed`);
    } catch {
      toast.error('Failed to close conversations');
    }
  };

  const batchSnooze = async (ids: string[], until: string) => {
    try {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from('crm_conversations')
          .update({
            status: 'snoozed',
            snoozed_until: until,
            snooze_type: 'timed',
            snooze_context: {},
            updated_at: new Date().toISOString(),
          })
          .in('id', chunk)
      );
      invalidateAll();
      toast.success(`${ids.length} conversation${ids.length !== 1 ? 's' : ''} snoozed`);
    } catch {
      toast.error('Failed to snooze conversations');
    }
  };

  const batchMarkRead = async (ids: string[]) => {
    if (!user) return;
    try {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from('crm_conversations')
          .update({ unread_count: 0, updated_at: new Date().toISOString() })
          .in('id', chunk)
      );
      invalidateAll();
      toast.success(`${ids.length} conversation${ids.length !== 1 ? 's' : ''} marked as read`);
    } catch {
      toast.error('Failed to mark conversations as read');
    }
  };

  const batchMute = async (ids: string[]) => {
    if (!user) return;
    const results = await Promise.allSettled(
      ids.map(async (conversationId) => {
        const { data: current } = await supabase
          .from('conversation_preferences')
          .select('is_muted')
          .eq('conversation_id', conversationId)
          .eq('user_id', user.id)
          .maybeSingle();

        return supabase
          .from('conversation_preferences')
          .upsert(
            {
              conversation_id: conversationId,
              user_id: user.id,
              is_muted: !current?.is_muted,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'conversation_id,user_id' }
          );
      })
    );

    queryClient.invalidateQueries({ queryKey: ['conversation-preferences'] });
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`Failed to mute ${failed} conversation${failed !== 1 ? 's' : ''}`);
    } else {
      toast.success(`${ids.length} conversation${ids.length !== 1 ? 's' : ''} muted`);
    }
  };

  const batchDelete = async (ids: string[]) => {
    // Delete messages first for each conversation, then the conversations
    const msgResults = await Promise.allSettled(
      ids.map((id) =>
        supabase.from('crm_messages').delete().eq('conversation_id', id)
      )
    );

    const msgFailed = msgResults.filter((r) => r.status === 'rejected').length;
    if (msgFailed > 0) {
      toast.error('Failed to delete some conversation messages');
      return;
    }

    try {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from('crm_conversations')
          .delete()
          .in('id', chunk)
      );
      invalidateAll();
      toast.success(`${ids.length} conversation${ids.length !== 1 ? 's' : ''} deleted`);
    } catch {
      toast.error('Failed to delete conversations');
    }
  };

  return { batchClose, batchSnooze, batchMarkRead, batchMute, batchDelete };
}
