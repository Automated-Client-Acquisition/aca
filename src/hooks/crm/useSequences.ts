import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { ConversationChannel } from "./useConversations";

// ============================================================================
// Types
// ============================================================================

export type SequenceStepType = 'message' | 'email' | 'wait' | 'condition' | 'action';
export type DelayUnit = 'minutes' | 'hours' | 'days' | 'weeks';
export type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'exited' | 'failed';
export type SequenceStatus = 'active' | 'paused' | 'draft';
export type StepType = SequenceStepType;

export interface SequenceSettings {
  exit_on_reply?: boolean;
  exit_on_click?: boolean;
  exit_on_open?: boolean;
  business_hours_only?: boolean;
  timezone?: string;
  daily_send_limit?: number;
}

export interface CrmSequence {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  channel: ConversationChannel;
  channel_account_id: string | null;
  is_active: boolean;
  is_archived: boolean;
  settings: SequenceSettings;
  total_enrolled: number;
  total_completed: number;
  total_replied: number;
  total_bounced: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Computed properties for UI compatibility
  status?: SequenceStatus;
  enrolled_count?: number;
}

export interface SequenceStep {
  id: string;
  sequence_id: string;
  position: number;
  step_type: SequenceStepType;
  delay_amount: number;
  delay_unit: DelayUnit;
  subject: string | null;
  content: string | null;
  content_type: 'text' | 'html' | 'markdown';
  template_id: string | null;
  condition_type: string | null;
  condition_config: Record<string, unknown>;
  action_type: string | null;
  action_config: Record<string, unknown>;
  variants: Array<{
    id: string;
    content: string;
    subject?: string;
    weight: number;
  }>;
  total_sent: number;
  total_opened: number;
  total_clicked: number;
  total_replied: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SequenceWithSteps extends CrmSequence {
  steps: SequenceStep[];
}

export interface SequenceEnrollment {
  id: string;
  organization_id: string;
  sequence_id: string;
  contact_id: string;
  status: EnrollmentStatus;
  exit_reason: string | null;
  current_step_id: string | null;
  current_step_position: number;
  next_step_at: string | null;
  conversation_id: string | null;
  steps_completed: number;
  messages_sent: number;
  messages_opened: number;
  messages_clicked: number;
  enrolled_by: string | null;
  enrolled_at: string;
  completed_at: string | null;
  exited_at: string | null;
  paused_at: string | null;
}

export interface CreateSequenceInput {
  name: string;
  description?: string;
  channel?: ConversationChannel;
  channel_account_id?: string;
  settings?: SequenceSettings;
}

export interface UpdateSequenceInput {
  id: string;
  name?: string;
  description?: string;
  channel?: ConversationChannel;
  channel_account_id?: string | null;
  is_active?: boolean;
  settings?: SequenceSettings;
}

export interface CreateStepInput {
  sequence_id: string;
  position?: number;
  step_type: SequenceStepType;
  delay_amount?: number;
  delay_unit?: DelayUnit;
  subject?: string;
  content?: string;
  content_type?: 'text' | 'html' | 'markdown';
  template_id?: string;
  condition_type?: string;
  condition_config?: Record<string, unknown>;
  action_type?: string;
  action_config?: Record<string, unknown>;
}

export interface UpdateStepInput {
  id: string;
  position?: number;
  step_type?: SequenceStepType;
  delay_amount?: number;
  delay_unit?: DelayUnit;
  subject?: string | null;
  content?: string | null;
  content_type?: 'text' | 'html' | 'markdown';
  template_id?: string | null;
  condition_type?: string | null;
  condition_config?: Record<string, unknown>;
  action_type?: string | null;
  action_config?: Record<string, unknown>;
  is_active?: boolean;
}

// ============================================================================
// Hooks
// ============================================================================

export interface SequenceFilters {
  status?: SequenceStatus;
  includeArchived?: boolean;
}

/**
 * Fetch all sequences for the organization
 */
export function useSequences(filters?: SequenceFilters) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-sequences', filters, currentOrganization?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      let query = supabase
        .from('crm_sequences')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false });

      if (!filters?.includeArchived) {
        query = query.eq('is_archived', false);
      }

      if (filters?.status === 'active') {
        query = query.eq('is_active', true);
      } else if (filters?.status === 'paused') {
        query = query.eq('is_active', false);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Add computed properties for UI compatibility
      return (data || []).map(seq => ({
        ...seq,
        status: seq.is_active ? 'active' : 'paused',
        enrolled_count: seq.total_enrolled,
      })) as CrmSequence[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 30000,
  });
}

/**
 * Fetch a single sequence with all its steps
 */
export function useSequence(sequenceId: string | null) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['crm-sequence', sequenceId],
    queryFn: async () => {
      if (!sequenceId || !user) throw new Error('No sequence ID or not authenticated');

      const { data: sequence, error: seqError } = await supabase
        .from('crm_sequences')
        .select('*')
        .eq('id', sequenceId)
        .single();

      if (seqError) throw seqError;

      const { data: steps, error: stepsError } = await supabase
        .from('crm_sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('position', { ascending: true });

      if (stepsError) throw stepsError;

      return {
        ...sequence,
        steps: steps || [],
      } as SequenceWithSteps;
    },
    enabled: !!sequenceId && !!user,
    staleTime: 30000,
  });
}

/**
 * Create a new sequence
 */
export function useCreateSequence() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateSequenceInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_sequences')
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description || null,
          channel: input.channel || 'linkedin',
          channel_account_id: input.channel_account_id || null,
          settings: input.settings || {},
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmSequence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequences'] });
      toast.success('Sequence created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create sequence');
    },
  });
}

/**
 * Update a sequence
 */
export function useUpdateSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateSequenceInput) => {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.channel !== undefined) updateData.channel = input.channel;
      if (input.channel_account_id !== undefined) updateData.channel_account_id = input.channel_account_id;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;
      if (input.settings !== undefined) updateData.settings = input.settings;

      const { data, error } = await supabase
        .from('crm_sequences')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmSequence;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', data.id] });
      toast.success('Sequence updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update sequence');
    },
  });
}

/**
 * Delete (archive) a sequence
 */
export function useDeleteSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sequenceId: string) => {
      const { error } = await supabase
        .from('crm_sequences')
        .update({ is_archived: true, is_active: false })
        .eq('id', sequenceId);

      if (error) throw error;
      return sequenceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequences'] });
      toast.success('Sequence archived');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to archive sequence');
    },
  });
}

/**
 * Toggle sequence active status
 */
export function useToggleSequenceStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from('crm_sequences')
        .update({ is_active })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmSequence;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequences'] });
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', data.id] });
      toast.success(data.is_active ? 'Sequence activated' : 'Sequence paused');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to toggle sequence status');
    },
  });
}

// ============================================================================
// Step Hooks
// ============================================================================

/**
 * Create a new step
 */
export function useCreateStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateStepInput) => {
      // Get max position if not provided
      let position = input.position;
      if (position === undefined) {
        const { data: existing } = await supabase
          .from('crm_sequence_steps')
          .select('position')
          .eq('sequence_id', input.sequence_id)
          .order('position', { ascending: false })
          .limit(1);

        position = (existing?.[0]?.position ?? -1) + 1;
      }

      const { data, error } = await supabase
        .from('crm_sequence_steps')
        .insert({
          sequence_id: input.sequence_id,
          position,
          step_type: input.step_type,
          delay_amount: input.delay_amount || 0,
          delay_unit: input.delay_unit || 'days',
          subject: input.subject || null,
          content: input.content || null,
          content_type: input.content_type || 'text',
          template_id: input.template_id || null,
          condition_type: input.condition_type || null,
          condition_config: input.condition_config || {},
          action_type: input.action_type || null,
          action_config: input.action_config || {},
        })
        .select()
        .single();

      if (error) throw error;
      return data as SequenceStep;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', data.sequence_id] });
      toast.success('Step added');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add step');
    },
  });
}

/**
 * Update a step
 */
export function useUpdateStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateStepInput) => {
      const updateData: Record<string, unknown> = {};

      if (input.position !== undefined) updateData.position = input.position;
      if (input.step_type !== undefined) updateData.step_type = input.step_type;
      if (input.delay_amount !== undefined) updateData.delay_amount = input.delay_amount;
      if (input.delay_unit !== undefined) updateData.delay_unit = input.delay_unit;
      if (input.subject !== undefined) updateData.subject = input.subject;
      if (input.content !== undefined) updateData.content = input.content;
      if (input.content_type !== undefined) updateData.content_type = input.content_type;
      if (input.template_id !== undefined) updateData.template_id = input.template_id;
      if (input.condition_type !== undefined) updateData.condition_type = input.condition_type;
      if (input.condition_config !== undefined) updateData.condition_config = input.condition_config;
      if (input.action_type !== undefined) updateData.action_type = input.action_type;
      if (input.action_config !== undefined) updateData.action_config = input.action_config;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;

      const { data, error } = await supabase
        .from('crm_sequence_steps')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as SequenceStep;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', data.sequence_id] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update step');
    },
  });
}

/**
 * Delete a step
 */
export function useDeleteStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ stepId, sequenceId }: { stepId: string; sequenceId: string }) => {
      const { error } = await supabase
        .from('crm_sequence_steps')
        .delete()
        .eq('id', stepId);

      if (error) throw error;
      return sequenceId;
    },
    onSuccess: (sequenceId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', sequenceId] });
      toast.success('Step deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete step');
    },
  });
}

/**
 * Reorder steps
 */
export function useReorderSteps() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sequenceId,
      stepIds,
    }: {
      sequenceId: string;
      stepIds: string[];
    }) => {
      // Update positions for each step
      const updates = stepIds.map((id, index) =>
        supabase
          .from('crm_sequence_steps')
          .update({ position: index })
          .eq('id', id)
      );

      await Promise.all(updates);
      return sequenceId;
    },
    onSuccess: (sequenceId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', sequenceId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder steps');
    },
  });
}

// ============================================================================
// Enrollment Hooks
// ============================================================================

/**
 * Fetch enrollments for a sequence
 */
export function useSequenceEnrollments(sequenceId: string | null, status?: EnrollmentStatus) {
  return useQuery({
    queryKey: ['crm-sequence-enrollments', sequenceId, status],
    queryFn: async () => {
      if (!sequenceId) throw new Error('No sequence ID');

      let query = supabase
        .from('crm_sequence_enrollments')
        .select(`
          *,
          contact:crm_contacts(id, display_name, primary_email, avatar_url)
        `)
        .eq('sequence_id', sequenceId)
        .order('enrolled_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data;
    },
    enabled: !!sequenceId,
    staleTime: 30000,
  });
}

/**
 * Enroll a contact in a sequence
 */
export function useEnrollInSequence() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sequenceId,
      contactId,
      conversationId,
    }: {
      sequenceId: string;
      contactId: string;
      conversationId?: string;
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase.rpc('enroll_in_sequence', {
        p_org_id: currentOrganization.id,
        p_sequence_id: sequenceId,
        p_contact_id: contactId,
        p_enrolled_by: user.id,
        p_conversation_id: conversationId || null,
      });

      if (error) throw error;
      return data as string;
    },
    onSuccess: (_, { sequenceId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', sequenceId] });
      queryClient.invalidateQueries({ queryKey: ['crm-sequence-enrollments', sequenceId] });
      toast.success('Contact enrolled in sequence');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to enroll contact');
    },
  });
}

/**
 * Pause/resume an enrollment
 */
export function useToggleEnrollmentPause() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      enrollmentId,
      paused,
    }: {
      enrollmentId: string;
      paused: boolean;
    }) => {
      const updateData: Record<string, unknown> = {
        status: paused ? 'paused' : 'active',
        paused_at: paused ? new Date().toISOString() : null,
      };

      const { data, error } = await supabase
        .from('crm_sequence_enrollments')
        .update(updateData)
        .eq('id', enrollmentId)
        .select()
        .single();

      if (error) throw error;
      return data as SequenceEnrollment;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence-enrollments', data.sequence_id] });
      toast.success(data.status === 'paused' ? 'Enrollment paused' : 'Enrollment resumed');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update enrollment');
    },
  });
}

/**
 * Remove a contact from a sequence
 */
export function useRemoveFromSequence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { data, error } = await supabase.rpc('exit_sequence_enrollment', {
        p_enrollment_id: enrollmentId,
        p_reason: 'manual',
      });

      if (error) throw error;
      return enrollmentId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence-enrollments'] });
      toast.success('Contact removed from sequence');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to remove contact');
    },
  });
}

// ============================================================================
// Additional Hooks & Utilities
// ============================================================================

export type SequenceLog = {
  id: string;
  enrollment_id: string;
  step_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

export interface SequenceWithStats extends CrmSequence {
  steps_count: number;
  active_enrollments: number;
  open_rate: number;
  reply_rate: number;
}

export type StepInput = CreateStepInput;

/**
 * Duplicate a sequence
 */
export function useDuplicateSequence() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sequenceId: string) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Fetch original sequence
      const { data: original, error: fetchError } = await supabase
        .from('crm_sequences')
        .select('*')
        .eq('id', sequenceId)
        .single();

      if (fetchError) throw fetchError;

      // Fetch original steps
      const { data: originalSteps, error: stepsError } = await supabase
        .from('crm_sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('position', { ascending: true });

      if (stepsError) throw stepsError;

      // Create new sequence
      const { data: newSequence, error: createError } = await supabase
        .from('crm_sequences')
        .insert({
          organization_id: currentOrganization.id,
          name: `${original.name} (Copy)`,
          description: original.description,
          channel: original.channel,
          channel_account_id: original.channel_account_id,
          settings: original.settings,
          is_active: false,
          created_by: user.id,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Copy steps if any exist
      if (originalSteps && originalSteps.length > 0) {
        const newSteps = originalSteps.map(step => ({
          sequence_id: newSequence.id,
          position: step.position,
          step_type: step.step_type,
          delay_amount: step.delay_amount,
          delay_unit: step.delay_unit,
          subject: step.subject,
          content: step.content,
          content_type: step.content_type,
          template_id: step.template_id,
          condition_type: step.condition_type,
          condition_config: step.condition_config,
          action_type: step.action_type,
          action_config: step.action_config,
          variants: step.variants,
          is_active: step.is_active,
        }));

        const { error: insertError } = await supabase
          .from('crm_sequence_steps')
          .insert(newSteps);

        if (insertError) throw insertError;
      }

      return newSequence as CrmSequence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequences'] });
      toast.success('Sequence duplicated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to duplicate sequence');
    },
  });
}

/**
 * Get sequence stats
 */
export function useSequenceStats(sequenceId: string | null) {
  return useQuery({
    queryKey: ['crm-sequence-stats', sequenceId],
    queryFn: async () => {
      if (!sequenceId) throw new Error('No sequence ID');

      const { data, error } = await supabase
        .from('crm_sequences')
        .select('total_enrolled, total_completed, total_replied, total_bounced')
        .eq('id', sequenceId)
        .single();

      if (error) throw error;

      const total = data.total_enrolled || 1;
      return {
        total_enrolled: data.total_enrolled || 0,
        total_completed: data.total_completed || 0,
        total_replied: data.total_replied || 0,
        total_bounced: data.total_bounced || 0,
        completion_rate: Math.round((data.total_completed / total) * 100),
        reply_rate: Math.round((data.total_replied / total) * 100),
        bounce_rate: Math.round((data.total_bounced / total) * 100),
      };
    },
    enabled: !!sequenceId,
    staleTime: 30000,
  });
}

/**
 * Get contact's enrollments across all sequences
 */
export function useContactEnrollments(contactId: string | null) {
  return useQuery({
    queryKey: ['crm-contact-enrollments', contactId],
    queryFn: async () => {
      if (!contactId) throw new Error('No contact ID');

      const { data, error } = await supabase
        .from('crm_sequence_enrollments')
        .select(`
          *,
          sequence:crm_sequences(id, name, channel)
        `)
        .eq('contact_id', contactId)
        .order('enrolled_at', { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!contactId,
    staleTime: 30000,
  });
}

/**
 * Bulk enroll contacts in a sequence
 */
export function useBulkEnroll() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sequenceId,
      contactIds,
    }: {
      sequenceId: string;
      contactIds: string[];
    }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      let enrolled = 0;

      for (const contactId of contactIds) {
        try {
          await supabase.rpc('enroll_in_sequence', {
            p_org_id: currentOrganization.id,
            p_sequence_id: sequenceId,
            p_contact_id: contactId,
            p_enrolled_by: user.id,
            p_conversation_id: null,
          });
          enrolled++;
        } catch {
          // Continue with other contacts if one fails
          console.error(`Failed to enroll contact ${contactId}`);
        }
      }

      return { enrolled, total: contactIds.length };
    },
    onSuccess: ({ enrolled, total }, { sequenceId }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-sequence', sequenceId] });
      queryClient.invalidateQueries({ queryKey: ['crm-sequence-enrollments', sequenceId] });
      toast.success(`Enrolled ${enrolled} of ${total} contacts`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to enroll contacts');
    },
  });
}

/**
 * Get enrollment logs
 */
export function useEnrollmentLogs(enrollmentId: string | null) {
  return useQuery({
    queryKey: ['crm-enrollment-logs', enrollmentId],
    queryFn: async () => {
      if (!enrollmentId) throw new Error('No enrollment ID');

      const { data, error } = await supabase
        .from('crm_sequence_enrollment_logs')
        .select('*')
        .eq('enrollment_id', enrollmentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as SequenceLog[];
    },
    enabled: !!enrollmentId,
    staleTime: 30000,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getStepTypeLabel(stepType: SequenceStepType): string {
  const labels: Record<SequenceStepType, string> = {
    message: 'Send Message',
    email: 'Send Email',
    wait: 'Wait',
    condition: 'Condition',
    action: 'Action',
  };
  return labels[stepType] || stepType;
}

export function getStepIcon(stepType: SequenceStepType): string {
  const icons: Record<SequenceStepType, string> = {
    message: 'MessageSquare',
    email: 'Mail',
    wait: 'Clock',
    condition: 'GitBranch',
    action: 'Zap',
  };
  return icons[stepType] || 'Circle';
}

export function getEnrollmentStatusLabel(status: EnrollmentStatus): string {
  const labels: Record<EnrollmentStatus, string> = {
    active: 'Active',
    paused: 'Paused',
    completed: 'Completed',
    exited: 'Exited',
    failed: 'Failed',
  };
  return labels[status] || status;
}
