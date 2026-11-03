import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedIn } from "@/hooks/crm/useContacts";

// ============================================================================
// Types
// ============================================================================

export interface CrmTag {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmContactTag {
  id: string;
  contact_id: string;
  tag_id: string;
  created_at: string;
}

export interface TagWithCount extends CrmTag {
  contact_count: number;
}

export interface CreateTagInput {
  name: string;
  color?: string;
  description?: string;
}

export interface UpdateTagInput extends Partial<CreateTagInput> {
  id: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all tags for the organization with contact counts
 */
export function useTags() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-tags', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      // Fetch tags
      const { data: tags, error: tagsError } = await supabase
        .from('crm_tags')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('name', { ascending: true });

      if (tagsError) throw tagsError;

      // Fetch contact counts per tag
      const { data: contactTags, error: countsError } = await supabase
        .from('crm_contact_tags')
        .select('tag_id')
        .eq('organization_id', currentOrganization.id);

      if (countsError) throw countsError;

      // Count contacts per tag
      const countsByTag: Record<string, number> = {};
      for (const ct of contactTags || []) {
        countsByTag[ct.tag_id] = (countsByTag[ct.tag_id] || 0) + 1;
      }

      // Combine tags with counts
      const tagsWithCounts: TagWithCount[] = (tags || []).map(tag => ({
        ...tag,
        contact_count: countsByTag[tag.id] || 0,
      }));

      return tagsWithCounts;
    },
    enabled: !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Fetch a single tag
 */
export function useTag(tagId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-tag', currentOrganization?.id, tagId],
    queryFn: async () => {
      if (!tagId) throw new Error('No tag ID');

      const { data, error } = await supabase
        .from('crm_tags')
        .select('*')
        .eq('id', tagId)
        .single();

      if (error) throw error;
      return data as CrmTag;
    },
    enabled: !!tagId,
    staleTime: 60000,
  });
}

/**
 * Search tags by name
 */
export function useSearchTags(searchTerm: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-tags-search', searchTerm, currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_tags')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .ilike('name', `%${searchTerm}%`)
        .order('name', { ascending: true })
        .limit(20);

      if (error) throw error;
      return data as CrmTag[];
    },
    enabled: !!currentOrganization && searchTerm.length > 0,
    staleTime: 30000,
  });
}

/**
 * Create a new tag
 */
export function useCreateTag() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTagInput) => {
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_tags')
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          color: input.color || '#6366f1',
          description: input.description || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      toast.success('Tag created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create tag');
    },
  });
}

/**
 * Update a tag
 */
export function useUpdateTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateTagInput) => {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.description !== undefined) updateData.description = input.description;

      const { data, error } = await supabase
        .from('crm_tags')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmTag;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['crm-tag'] });
      toast.success('Tag updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update tag');
    },
  });
}

/**
 * Delete a tag
 */
export function useDeleteTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('crm_tags')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Tag deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete tag');
    },
  });
}

/**
 * Get tags for a specific contact
 */
export function useContactTags(contactId: string | null) {
  return useQuery({
    queryKey: ['crm-contact-tags', contactId],
    queryFn: async () => {
      if (!contactId) throw new Error('No contact ID');

      const { data, error } = await supabase
        .from('crm_contact_tags')
        .select(`
          *,
          tag:crm_tags(*)
        `)
        .eq('contact_id', contactId);

      if (error) throw error;

      // Extract just the tags
      return (data || []).map(ct => ct.tag) as CrmTag[];
    },
    enabled: !!contactId,
    staleTime: 30000,
  });
}

/**
 * Get contacts for a specific tag
 */
export function useTagContacts(tagId: string | null) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-tag-contacts', currentOrganization?.id, tagId],
    queryFn: async () => {
      if (!tagId || !user) throw new Error('No tag ID or not authenticated');

      const { data, error } = await supabase
        .from('crm_contact_tags')
        .select('contact_id')
        .eq('tag_id', tagId);

      if (error) throw error;

      return (data || []).map(ct => ct.contact_id);
    },
    enabled: !!tagId && !!user,
  });
}

/**
 * Bulk add tag to multiple contacts
 */
export function useBulkAddTag() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tagId,
      contactIds,
    }: {
      tagId: string;
      contactIds: string[];
    }) => {
      if (!currentOrganization) throw new Error('No organization selected');

      // Create contact-tag associations (upsert to avoid duplicates)
      const associations = contactIds.map(contactId => ({
        organization_id: currentOrganization.id,
        contact_id: contactId,
        tag_id: tagId,
      }));

      const { error } = await supabase
        .from('crm_contact_tags')
        .upsert(associations, {
          onConflict: 'contact_id,tag_id',
          ignoreDuplicates: true,
        });

      if (error) throw error;
      return { tagId, contactIds };
    },
    onSuccess: ({ contactIds }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-tags'] });
      toast.success(`Tag added to ${contactIds.length} contact${contactIds.length === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add tag');
    },
  });
}

/**
 * Bulk remove tag from multiple contacts
 */
export function useBulkRemoveTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tagId,
      contactIds,
    }: {
      tagId: string;
      contactIds: string[];
    }) => {
      await chunkedIn(contactIds, (chunk) =>
        supabase
          .from('crm_contact_tags')
          .delete()
          .eq('tag_id', tagId)
          .in('contact_id', chunk)
          .select('contact_id')
      );

      return { tagId, contactIds };
    },
    onSuccess: ({ contactIds }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-tags'] });
      toast.success(`Tag removed from ${contactIds.length} contact${contactIds.length === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove tag');
    },
  });
}

/**
 * Create tag and add to contacts in one operation
 */
export function useCreateTagAndAssign() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      tag,
      contactIds,
    }: {
      tag: CreateTagInput;
      contactIds: string[];
    }) => {
      if (!currentOrganization) throw new Error('No organization selected');

      // Create the tag
      const { data: newTag, error: tagError } = await supabase
        .from('crm_tags')
        .insert({
          organization_id: currentOrganization.id,
          name: tag.name,
          color: tag.color || '#6366f1',
          description: tag.description || null,
        })
        .select()
        .single();

      if (tagError) throw tagError;

      // Assign to contacts if any
      if (contactIds.length > 0) {
        const associations = contactIds.map(contactId => ({
          organization_id: currentOrganization.id,
          contact_id: contactId,
          tag_id: newTag.id,
        }));

        const { error: assignError } = await supabase
          .from('crm_contact_tags')
          .insert(associations);

        if (assignError) throw assignError;
      }

      return { tag: newTag as CrmTag, contactIds };
    },
    onSuccess: ({ contactIds }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-tags'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contact-tags'] });
      toast.success('Tag created and assigned');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create and assign tag');
    },
  });
}
