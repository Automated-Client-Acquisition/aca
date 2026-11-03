import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export type ActivityType =
  | 'contact_created'
  | 'contact_updated'
  | 'stage_changed'
  | 'tag_added'
  | 'tag_removed'
  | 'note_added'
  | 'note_updated'
  | 'message_sent'
  | 'message_received'
  | 'email_opened'
  | 'link_clicked'
  | 'call_made'
  | 'meeting_scheduled'
  | 'deal_won'
  | 'deal_lost'
  | 'sequence_enrolled'
  | 'sequence_completed'
  | 'custom';

export type PerformerType = 'user' | 'system' | 'contact' | 'automation';

export interface CrmActivity {
  id: string;
  organization_id: string;
  contact_id: string;
  activity_type: string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  related_message_id: string | null;
  related_sequence_id: string | null;
  performed_by_type: PerformerType | null;
  performed_by_user_id: string | null;
  created_at: string;
}

export interface ActivityWithContact extends CrmActivity {
  contact?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface CreateActivityInput {
  contact_id: string;
  activity_type: string;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  related_message_id?: string;
  related_sequence_id?: string;
  performed_by_type?: PerformerType;
}

export interface ActivityFilters {
  contact_id?: string;
  activity_types?: string[];
  performer_type?: PerformerType;
  from_date?: string;
  to_date?: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch activities for a specific contact with pagination
 */
export function useContactActivities(
  contactId: string | null,
  options?: { limit?: number; offset?: number }
) {
  const limit = options?.limit || 50;
  const offset = options?.offset || 0;

  return useQuery({
    queryKey: ['crm-contact-activities', contactId, limit, offset],
    queryFn: async () => {
      if (!contactId) throw new Error('No contact ID');

      const { data, error, count } = await supabase
        .from('crm_activities')
        .select('*', { count: 'exact' })
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      return {
        activities: data as CrmActivity[],
        total: count || 0,
        hasMore: (count || 0) > offset + limit,
      };
    },
    enabled: !!contactId,
    staleTime: 30000,
  });
}

/**
 * Infinite query for contact activities (for infinite scroll)
 */
export function useContactActivitiesInfinite(contactId: string | null, pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['crm-contact-activities-infinite', contactId],
    queryFn: async ({ pageParam = 0 }) => {
      if (!contactId) throw new Error('No contact ID');

      const { data, error, count } = await supabase
        .from('crm_activities')
        .select('*', { count: 'exact' })
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + pageSize - 1);

      if (error) throw error;

      return {
        activities: data as CrmActivity[],
        nextOffset: pageParam + pageSize,
        total: count || 0,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (lastPage.activities.length < pageSize) return undefined;
      return lastPage.nextOffset;
    },
    enabled: !!contactId,
  });
}

/**
 * Fetch all activities for the organization with filters
 */
export function useActivities(filters?: ActivityFilters, limit = 100) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-activities', currentOrganization?.id, filters],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      let query = supabase
        .from('crm_activities')
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (filters?.contact_id) {
        query = query.eq('contact_id', filters.contact_id);
      }

      if (filters?.activity_types && filters.activity_types.length > 0) {
        query = query.in('activity_type', filters.activity_types);
      }

      if (filters?.performer_type) {
        query = query.eq('performed_by_type', filters.performer_type);
      }

      if (filters?.from_date) {
        query = query.gte('created_at', filters.from_date);
      }

      if (filters?.to_date) {
        query = query.lte('created_at', filters.to_date);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as ActivityWithContact[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Fetch recent activities across all contacts (activity feed)
 */
export function useActivityFeed(limit = 50) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-activity-feed', currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_activities')
        .select(`
          *,
          contact:crm_contacts(id, display_name, avatar_url)
        `)
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data as ActivityWithContact[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Log a new activity
 */
export function useLogActivity() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateActivityInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_activities')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: input.contact_id,
          activity_type: input.activity_type,
          title: input.title,
          description: input.description || null,
          metadata: input.metadata || {},
          related_message_id: input.related_message_id || null,
          related_sequence_id: input.related_sequence_id || null,
          performed_by_type: input.performed_by_type || 'user',
          performed_by_user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmActivity;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities-infinite', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-activities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-activity-feed'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to log activity');
    },
  });
}

/**
 * Log a stage change activity
 */
export function useLogStageChange() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      fromStageId,
      fromStageName,
      toStageId,
      toStageName,
    }: {
      contactId: string;
      fromStageId: string | null;
      fromStageName: string | null;
      toStageId: string;
      toStageName: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const description = fromStageName
        ? `Moved from "${fromStageName}" to "${toStageName}"`
        : `Added to "${toStageName}"`;

      const { data, error } = await supabase
        .from('crm_activities')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: contactId,
          activity_type: 'stage_changed',
          title: 'Stage changed',
          description,
          metadata: {
            from_stage_id: fromStageId,
            from_stage_name: fromStageName,
            to_stage_id: toStageId,
            to_stage_name: toStageName,
          },
          performed_by_type: 'user',
          performed_by_user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmActivity;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities-infinite', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-activities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-activity-feed'] });
    },
  });
}

/**
 * Log a message activity (sent or received)
 */
export function useLogMessageActivity() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      direction,
      channel,
      preview,
      messageId,
    }: {
      contactId: string;
      direction: 'sent' | 'received';
      channel: string;
      preview?: string;
      messageId?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const activityType = direction === 'sent' ? 'message_sent' : 'message_received';
      const title = direction === 'sent' ? 'Message sent' : 'Message received';

      const { data, error } = await supabase
        .from('crm_activities')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: contactId,
          activity_type: activityType,
          title,
          description: preview || null,
          metadata: { channel },
          related_message_id: messageId || null,
          performed_by_type: direction === 'sent' ? 'user' : 'contact',
          performed_by_user_id: direction === 'sent' ? user.id : null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmActivity;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities-infinite', data.contact_id] });
      queryClient.invalidateQueries({ queryKey: ['crm-activities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-activity-feed'] });
    },
  });
}

/**
 * Get activity counts by type for a date range
 */
export function useActivityStats(fromDate?: string, toDate?: string) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-activity-stats', currentOrganization?.id, fromDate, toDate],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      let query = supabase
        .from('crm_activities')
        .select('activity_type')
        .eq('organization_id', currentOrganization.id);

      if (fromDate) {
        query = query.gte('created_at', fromDate);
      }

      if (toDate) {
        query = query.lte('created_at', toDate);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Count by type
      const countsByType: Record<string, number> = {};
      for (const activity of data || []) {
        countsByType[activity.activity_type] = (countsByType[activity.activity_type] || 0) + 1;
      }

      return {
        total: data?.length || 0,
        byType: countsByType,
      };
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Delete an activity (admin only - generally activities should be immutable)
 */
export function useDeleteActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ activityId, contactId }: { activityId: string; contactId: string }) => {
      const { error } = await supabase
        .from('crm_activities')
        .delete()
        .eq('id', activityId);

      if (error) throw error;
      return contactId;
    },
    onSuccess: (contactId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities', contactId] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities-infinite', contactId] });
      queryClient.invalidateQueries({ queryKey: ['crm-activities'] });
      queryClient.invalidateQueries({ queryKey: ['crm-activity-feed'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete activity');
    },
  });
}
