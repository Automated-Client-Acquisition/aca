import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CrmContact, CrmContactIdentity, CrmPipeline, CrmPipelineStage } from "./useContacts";

// ============================================================================
// Types
// ============================================================================

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
  performed_by_type: 'user' | 'system' | 'contact' | 'automation' | null;
  performed_by_user_id: string | null;
  created_at: string;
}

export interface CrmNote {
  id: string;
  organization_id: string;
  contact_id: string;
  content: string;
  mentioned_user_ids: string[];
  is_internal: boolean;
  is_pinned: boolean;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactWithDetails extends CrmContact {
  pipeline: CrmPipeline | null;
  stage: CrmPipelineStage | null;
  identities: CrmContactIdentity[];
  activities: CrmActivity[];
  notes: CrmNote[];
}

export interface AddIdentityInput {
  contact_id: string;
  channel: CrmContactIdentity['channel'];
  platform_user_id: string;
  platform_username?: string;
  platform_profile_url?: string;
  platform_avatar_url?: string;
  platform_metadata?: Record<string, unknown>;
  is_primary?: boolean;
}

export interface AddNoteInput {
  contact_id: string;
  content: string;
  mentioned_user_ids?: string[];
  is_internal?: boolean;
  is_pinned?: boolean;
}

// ============================================================================
// Hooks
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetch a single contact with all related data
 */
export function useContact(contactId: string | null) {
  const { user, currentOrganization } = useAuth();
  const validId = contactId && UUID_RE.test(contactId) ? contactId : null;

  return useQuery({
    queryKey: ['crm-contact', currentOrganization?.id, validId],
    queryFn: async () => {
      if (!validId || !user || !currentOrganization) throw new Error('No contact ID or not authenticated');

      // Fetch contact with pipeline and stage
      const { data: contact, error: contactError } = await supabase
        .from('crm_contacts')
        .select(`
          *,
          pipeline:crm_pipelines(*),
          stage:crm_pipeline_stages(*)
        `)
        .eq('id', validId)
        .eq('organization_id', currentOrganization.id)
        .single();

      if (contactError) throw contactError;

      // Fetch identities
      const { data: identities, error: identitiesError } = await supabase
        .from('crm_contact_identities')
        .select('*')
        .eq('contact_id', validId)
        .order('is_primary', { ascending: false });

      if (identitiesError) throw identitiesError;

      // Fetch recent activities (last 50)
      const { data: activities, error: activitiesError } = await supabase
        .from('crm_activities')
        .select('*')
        .eq('contact_id', validId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (activitiesError) throw activitiesError;

      // Fetch notes
      const { data: notes, error: notesError } = await supabase
        .from('crm_notes')
        .select('*')
        .eq('contact_id', validId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (notesError) throw notesError;

      return {
        ...contact,
        identities: identities || [],
        activities: activities || [],
        notes: notes || [],
      } as ContactWithDetails;
    },
    enabled: !!validId && !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Add a channel identity to a contact
 */
export function useAddContactIdentity() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddIdentityInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // If setting as primary, unset other primaries for this channel
      if (input.is_primary) {
        await supabase
          .from('crm_contact_identities')
          .update({ is_primary: false })
          .eq('contact_id', input.contact_id)
          .eq('channel', input.channel);
      }

      const { data, error } = await supabase
        .from('crm_contact_identities')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: input.contact_id,
          channel: input.channel,
          platform_user_id: input.platform_user_id,
          platform_username: input.platform_username || null,
          platform_profile_url: input.platform_profile_url || null,
          platform_avatar_url: input.platform_avatar_url || null,
          platform_metadata: input.platform_metadata || {},
          is_primary: input.is_primary || false,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmContactIdentity;
    },
    onSuccess: (_, { contact_id }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success('Identity added');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add identity');
    },
  });
}

/**
 * Remove a channel identity from a contact
 */
export function useRemoveContactIdentity() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ identityId, contactId }: { identityId: string; contactId: string }) => {
      if (!currentOrganization) throw new Error('No organization selected');
      const { error } = await supabase
        .from('crm_contact_identities')
        .delete()
        .eq('id', identityId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
      return contactId;
    },
    onSuccess: (contactId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success('Identity removed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove identity');
    },
  });
}

/**
 * Add a note to a contact
 */
export function useAddNote() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddNoteInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_notes')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: input.contact_id,
          content: input.content,
          mentioned_user_ids: input.mentioned_user_ids || [],
          is_internal: input.is_internal ?? true,
          is_pinned: input.is_pinned || false,
          created_by_user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Create activity
      await supabase.from('crm_activities').insert({
        organization_id: currentOrganization.id,
        contact_id: input.contact_id,
        activity_type: 'note_added',
        title: 'Note added',
        description: input.content.substring(0, 100) + (input.content.length > 100 ? '...' : ''),
        performed_by_type: 'user',
        performed_by_user_id: user.id,
      });

      return data as CrmNote;
    },
    onSuccess: (_, { contact_id }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success('Note added');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add note');
    },
  });
}

/**
 * Update a note
 */
export function useUpdateNote() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      noteId,
      contactId,
      content,
      is_pinned,
    }: {
      noteId: string;
      contactId: string;
      content?: string;
      is_pinned?: boolean;
    }) => {
      if (!currentOrganization) throw new Error('No organization selected');
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (content !== undefined) updateData.content = content;
      if (is_pinned !== undefined) updateData.is_pinned = is_pinned;

      const { data, error } = await supabase
        .from('crm_notes')
        .update(updateData)
        .eq('id', noteId)
        .eq('organization_id', currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return { note: data as CrmNote, contactId };
    },
    onSuccess: ({ contactId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update note');
    },
  });
}

/**
 * Delete a note
 */
export function useDeleteNote() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ noteId, contactId }: { noteId: string; contactId: string }) => {
      if (!currentOrganization) throw new Error('No organization selected');
      const { error } = await supabase
        .from('crm_notes')
        .delete()
        .eq('id', noteId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
      return contactId;
    },
    onSuccess: (contactId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      toast.success('Note deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete note');
    },
  });
}

/**
 * Toggle note pinned status
 */
export function useToggleNotePin() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      noteId,
      contactId,
      is_pinned,
    }: {
      noteId: string;
      contactId: string;
      is_pinned: boolean;
    }) => {
      if (!currentOrganization) throw new Error('No organization selected');
      const { error } = await supabase
        .from('crm_notes')
        .update({ is_pinned, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('organization_id', currentOrganization.id);

      if (error) throw error;
      return contactId;
    },
    onSuccess: (contactId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update note');
    },
  });
}

/**
 * Fetch contact activities with pagination
 */
export function useContactActivities(contactId: string | null, limit = 50, offset = 0) {
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
  });
}

/**
 * Log a custom activity
 */
export function useLogActivity() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contactId,
      activityType,
      title,
      description,
      metadata,
    }: {
      contactId: string;
      activityType: string;
      title: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_activities')
        .insert({
          organization_id: currentOrganization.id,
          contact_id: contactId,
          activity_type: activityType,
          title,
          description: description || null,
          metadata: metadata || {},
          performed_by_type: 'user',
          performed_by_user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmActivity;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-activities', data.contact_id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to log activity');
    },
  });
}
