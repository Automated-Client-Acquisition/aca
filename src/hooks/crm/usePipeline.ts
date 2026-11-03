import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CrmPipeline, CrmPipelineStage } from "./useContacts";

// ============================================================================
// Types
// ============================================================================

export interface PipelineWithStages extends CrmPipeline {
  stages: CrmPipelineStage[];
  contact_count?: number;
}

export interface CreatePipelineInput {
  name: string;
  description?: string;
  color?: string;
  is_default?: boolean;
}

export interface UpdatePipelineInput extends Partial<CreatePipelineInput> {
  id: string;
}

export interface CreateStageInput {
  pipeline_id: string;
  name: string;
  description?: string;
  stage_order: number;
  stage_type?: 'new' | 'active' | 'won' | 'lost';
  color?: string;
  expected_days?: number;
  win_probability?: number | null;
}

export interface UpdateStageInput extends Partial<Omit<CreateStageInput, 'pipeline_id'>> {
  id: string;
}

// ============================================================================
// Pipeline Hooks
// ============================================================================

/**
 * Fetch all pipelines for the organization with stages
 */
export function usePipelines() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-pipelines', currentOrganization?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      // Fetch pipelines
      const { data: pipelines, error: pipelinesError } = await supabase
        .from('crm_pipelines')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true });

      if (pipelinesError) throw pipelinesError;

      // Fetch stages for all pipelines
      const { data: stages, error: stagesError } = await supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('stage_order', { ascending: true });

      if (stagesError) throw stagesError;

      // Fetch contact counts per pipeline
      const { data: contactCounts, error: countsError } = await supabase
        .from('crm_contacts')
        .select('pipeline_id')
        .eq('organization_id', currentOrganization.id)
        .eq('status', 'active');

      if (countsError) throw countsError;

      // Count contacts per pipeline
      const countsByPipeline: Record<string, number> = {};
      for (const contact of contactCounts || []) {
        if (contact.pipeline_id) {
          countsByPipeline[contact.pipeline_id] = (countsByPipeline[contact.pipeline_id] || 0) + 1;
        }
      }

      // Combine pipelines with their stages and counts
      const pipelinesWithStages: PipelineWithStages[] = (pipelines || []).map(pipeline => ({
        ...pipeline,
        stages: (stages || []).filter(s => s.pipeline_id === pipeline.id),
        contact_count: countsByPipeline[pipeline.id] || 0,
      }));

      return pipelinesWithStages;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Fetch a single pipeline with stages
 */
export function usePipeline(pipelineId: string | null) {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-pipeline', currentOrganization?.id, pipelineId],
    queryFn: async () => {
      if (!pipelineId || !user) throw new Error('No pipeline ID or not authenticated');

      const { data: pipeline, error: pipelineError } = await supabase
        .from('crm_pipelines')
        .select('*')
        .eq('id', pipelineId)
        .single();

      if (pipelineError) throw pipelineError;

      const { data: stages, error: stagesError } = await supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('stage_order', { ascending: true });

      if (stagesError) throw stagesError;

      return {
        ...pipeline,
        stages: stages || [],
      } as PipelineWithStages;
    },
    enabled: !!pipelineId && !!user,
    staleTime: 60000,
  });
}

/**
 * Get the default pipeline
 */
export function useDefaultPipeline() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-default-pipeline', currentOrganization?.id],
    queryFn: async () => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_pipelines')
        .select(`
          *,
          stages:crm_pipeline_stages(*)
        `)
        .eq('organization_id', currentOrganization.id)
        .eq('is_default', true)
        .single();

      if (error) {
        // No default pipeline, try to get or create one
        const { data: anyPipeline } = await supabase
          .from('crm_pipelines')
          .select(`
            *,
            stages:crm_pipeline_stages(*)
          `)
          .eq('organization_id', currentOrganization.id)
          .limit(1)
          .single();

        if (anyPipeline) {
          return anyPipeline as PipelineWithStages;
        }

        // Create default pipeline
        const { data: newPipelineId } = await supabase
          .rpc('create_default_pipeline_for_org', { p_org_id: currentOrganization.id });

        if (newPipelineId) {
          const { data: newPipeline } = await supabase
            .from('crm_pipelines')
            .select(`
              *,
              stages:crm_pipeline_stages(*)
            `)
            .eq('id', newPipelineId)
            .single();

          return newPipeline as PipelineWithStages;
        }

        throw new Error('Could not get or create default pipeline');
      }

      return {
        ...data,
        stages: (data.stages || []).sort((a: CrmPipelineStage, b: CrmPipelineStage) => a.stage_order - b.stage_order),
      } as PipelineWithStages;
    },
    enabled: !!user && !!currentOrganization,
    staleTime: 60000,
  });
}

/**
 * Create a new pipeline
 */
export function useCreatePipeline() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreatePipelineInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_pipelines')
        .insert({
          organization_id: currentOrganization.id,
          name: input.name,
          description: input.description || null,
          color: input.color || '#6366f1',
          is_default: input.is_default || false,
        })
        .select()
        .single();

      if (error) throw error;
      return data as CrmPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      toast.success('Pipeline created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create pipeline');
    },
  });
}

/**
 * Update a pipeline
 */
export function useUpdatePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdatePipelineInput) => {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.is_default !== undefined) updateData.is_default = input.is_default;

      const { data, error } = await supabase
        .from('crm_pipelines')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmPipeline;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      toast.success('Pipeline updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update pipeline');
    },
  });
}

/**
 * Delete a pipeline
 */
export function useDeletePipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('crm_pipelines')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Pipeline deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete pipeline');
    },
  });
}

// ============================================================================
// Stage Hooks
// ============================================================================

/**
 * Fetch stages for a pipeline
 */
export function usePipelineStages(pipelineId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['crm-pipeline-stages', currentOrganization?.id, pipelineId],
    queryFn: async () => {
      if (!pipelineId) throw new Error('No pipeline ID');

      const { data, error } = await supabase
        .from('crm_pipeline_stages')
        .select('*')
        .eq('pipeline_id', pipelineId)
        .order('stage_order', { ascending: true });

      if (error) throw error;
      return data as CrmPipelineStage[];
    },
    enabled: !!pipelineId,
    staleTime: 60000,
  });
}

/**
 * Create a new stage
 */
export function useCreateStage() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateStageInput) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization selected');

      const { data, error } = await supabase
        .from('crm_pipeline_stages')
        .insert({
          organization_id: currentOrganization.id,
          pipeline_id: input.pipeline_id,
          name: input.name,
          description: input.description || null,
          stage_order: input.stage_order,
          stage_type: input.stage_type || 'active',
          color: input.color || '#6366f1',
          expected_days: input.expected_days || null,
          win_probability: input.win_probability ?? null,
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as CrmPipelineStage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      toast.success('Stage created');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to create stage');
    },
  });
}

/**
 * Update a stage
 */
export function useUpdateStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: UpdateStageInput) => {
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.stage_order !== undefined) updateData.stage_order = input.stage_order;
      if (input.stage_type !== undefined) updateData.stage_type = input.stage_type;
      if (input.color !== undefined) updateData.color = input.color;
      if (input.expected_days !== undefined) updateData.expected_days = input.expected_days;
      if (input.win_probability !== undefined) updateData.win_probability = input.win_probability;

      const { data, error } = await supabase
        .from('crm_pipeline_stages')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as CrmPipelineStage;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      toast.success('Stage updated');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update stage');
    },
  });
}

/**
 * Delete a stage
 */
export function useDeleteStage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, pipelineId }: { id: string; pipelineId: string }) => {
      const { error } = await supabase
        .from('crm_pipeline_stages')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return pipelineId;
    },
    onSuccess: (pipelineId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
      toast.success('Stage deleted');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete stage');
    },
  });
}

/**
 * Reorder stages within a pipeline
 */
export function useReorderStages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipelineId,
      stageIds,
    }: {
      pipelineId: string;
      stageIds: string[];
    }) => {
      // Update each stage with its new order
      for (let i = 0; i < stageIds.length; i++) {
        const { error } = await supabase
          .from('crm_pipeline_stages')
          .update({ stage_order: i + 1, updated_at: new Date().toISOString() })
          .eq('id', stageIds[i]);

        if (error) throw error;
      }

      return pipelineId;
    },
    onSuccess: (pipelineId) => {
      queryClient.invalidateQueries({ queryKey: ['crm-pipelines'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline'] });
      queryClient.invalidateQueries({ queryKey: ['crm-pipeline-stages'] });
      queryClient.invalidateQueries({ queryKey: ['crm-default-pipeline'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder stages');
    },
  });
}
