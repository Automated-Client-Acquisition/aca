import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ============================================================================
// Types
// ============================================================================

export interface LeadScoringRule {
  id: string;
  organization_id: string;
  rule_name: string;
  rule_type: 'engagement' | 'profile' | 'behavior' | 'source' | 'custom';
  description: string | null;
  conditions: ScoringCondition[];
  points: number;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScoringCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' |
    'greater_than' | 'less_than' | 'is_null' | 'is_not_null' | 'is_true' | 'is_false';
  value?: string | number | boolean;
}

export interface CreateScoringRuleInput {
  rule_name: string;
  rule_type: LeadScoringRule['rule_type'];
  description?: string;
  conditions: ScoringCondition[];
  points: number;
  priority?: number;
  is_active?: boolean;
}

export interface UpdateScoringRuleInput extends Partial<CreateScoringRuleInput> {
  id: string;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch all scoring rules for the organization
 */
export function useLeadScoringRules() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['lead-scoring-rules', currentOrganization?.id],
    queryFn: async (): Promise<LeadScoringRule[]> => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []) as LeadScoringRule[];
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Create default scoring rules for an organization
 */
export function useCreateDefaultScoringRules() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { error } = await supabase.rpc('create_default_scoring_rules', {
        p_org_id: currentOrganization.id,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-scoring-rules'] });
      toast.success('Default scoring rules created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create rules');
    },
  });
}

/**
 * Create a new scoring rule
 */
export function useCreateScoringRule() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateScoringRuleInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .insert({
          organization_id: currentOrganization.id,
          rule_name: input.rule_name,
          rule_type: input.rule_type,
          description: input.description || null,
          conditions: input.conditions,
          points: input.points,
          priority: input.priority ?? 0,
          is_active: input.is_active ?? true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as LeadScoringRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-scoring-rules'] });
      toast.success('Scoring rule created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create rule');
    },
  });
}

/**
 * Update a scoring rule
 */
export function useUpdateScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateScoringRuleInput) => {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.rule_name !== undefined) updateData.rule_name = input.rule_name;
      if (input.rule_type !== undefined) updateData.rule_type = input.rule_type;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.conditions !== undefined) updateData.conditions = input.conditions;
      if (input.points !== undefined) updateData.points = input.points;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.is_active !== undefined) updateData.is_active = input.is_active;

      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as LeadScoringRule;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-scoring-rules'] });
      toast.success('Scoring rule updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update rule');
    },
  });
}

/**
 * Delete a scoring rule
 */
export function useDeleteScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('lead_scoring_rules')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-scoring-rules'] });
      toast.success('Scoring rule deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete rule');
    },
  });
}

/**
 * Toggle scoring rule active status
 */
export function useToggleScoringRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from('lead_scoring_rules')
        .update({
          is_active,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as LeadScoringRule;
    },
    onSuccess: (_, { is_active }) => {
      queryClient.invalidateQueries({ queryKey: ['lead-scoring-rules'] });
      toast.success(is_active ? 'Rule enabled' : 'Rule disabled');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update rule');
    },
  });
}

/**
 * Calculate lead score based on rules
 * This is a client-side helper for preview purposes.
 * Actual scoring happens server-side.
 */
export function calculateLeadScore(
  lead: {
    status: string;
    commenter_profile_url?: string | null;
    commenter_headline?: string | null;
    commenter_avatar_url?: string | null;
    dm_read_at?: string | null;
    is_connected?: boolean;
    response_time_minutes?: number | null;
  },
  rules: LeadScoringRule[]
): { score: number; breakdown: Record<string, number> } {
  let totalScore = 0;
  const breakdown: Record<string, number> = {};

  const activeRules = rules
    .filter(r => r.is_active)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of activeRules) {
    const matches = rule.conditions.every(condition => {
      const fieldValue = (lead as Record<string, unknown>)[condition.field];

      switch (condition.operator) {
        case 'equals':
          return fieldValue === condition.value;
        case 'not_equals':
          return fieldValue !== condition.value;
        case 'is_null':
          return fieldValue === null || fieldValue === undefined;
        case 'is_not_null':
          return fieldValue !== null && fieldValue !== undefined;
        case 'is_true':
          return fieldValue === true;
        case 'is_false':
          return fieldValue === false;
        case 'greater_than':
          return typeof fieldValue === 'number' && fieldValue > (condition.value as number);
        case 'less_than':
          return typeof fieldValue === 'number' && fieldValue < (condition.value as number);
        case 'contains':
          return typeof fieldValue === 'string' &&
            fieldValue.toLowerCase().includes((condition.value as string).toLowerCase());
        case 'not_contains':
          return typeof fieldValue !== 'string' ||
            !fieldValue.toLowerCase().includes((condition.value as string).toLowerCase());
        default:
          return false;
      }
    });

    if (matches) {
      totalScore += rule.points;
      breakdown[rule.rule_name] = rule.points;
    }
  }

  return { score: totalScore, breakdown };
}
