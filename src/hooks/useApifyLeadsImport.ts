import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ApifyLeadsImportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export interface BatchInfo {
  batch_index: number;
  apify_run_id: string;
  status: string;
  leads_found: number;
  leads_imported: number;
  leads_skipped: number;
  error?: string;
}

export interface ApifyLeadsImportJob {
  id: string;
  organization_id: string;
  target_list_id: string;
  search_config: ApifyLeadsSearchConfig;
  total_requested: number;
  batch_size: number;
  batches: BatchInfo[];
  status: ApifyLeadsImportStatus;
  progress: number;
  total_found: number;
  total_imported: number;
  total_skipped: number;
  current_batch: number;
  total_batches: number;
  estimated_cost_usd: number;
  error_message: string | null;
  schedule_id: string | null;
  is_scheduled_run: boolean;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface ApifyLeadsSearchConfig {
  contact_job_title?: string[];
  contact_not_job_title?: string[];
  contact_location?: string[];
  contact_not_location?: string[];
  contact_city?: string[];
  contact_not_city?: string[];
  seniority_level?: string[];
  functional_level?: string[];
  email_status?: string[];
  company_domain?: string[];
  company_industry?: string[];
  company_not_industry?: string[];
  company_keywords?: string[];
  company_not_keywords?: string[];
  size?: string[];
  min_revenue?: string;
  max_revenue?: string;
  funding?: string[];
}

export interface StartApifyImportParams {
  listName?: string;
  listId?: string;
  searchConfig: ApifyLeadsSearchConfig;
  totalRequested: number;
  batchSize?: number;
}

/**
 * Hook to start an Apify Leads Finder import job
 */
export function useStartApifyLeadsImport() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartApifyImportParams): Promise<ApifyLeadsImportJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      let targetListId = params.listId;

      // Create a lead list if no listId provided
      if (!targetListId) {
        const { data: list, error: listError } = await supabase
          .from('lead_lists')
          .insert({
            organization_id: currentOrganization.id,
            name: params.listName || `Apify Import - ${new Date().toLocaleDateString()}`,
            source_type: 'apify_leads_finder',
          })
          .select()
          .single();

        if (listError || !list) {
          throw new Error(`Failed to create lead list: ${listError?.message || 'Unknown error'}`);
        }

        targetListId = list.id;
      }

      const batchSize = params.batchSize || 2500;
      const totalBatches = Math.ceil(params.totalRequested / batchSize);

      // Create the import job record
      const { data: job, error: jobError } = await supabase
        .from('apify_leads_import_jobs')
        .insert({
          organization_id: currentOrganization.id,
          target_list_id: targetListId,
          search_config: params.searchConfig,
          total_requested: params.totalRequested,
          batch_size: batchSize,
          total_batches: totalBatches,
          status: 'pending',
          estimated_cost_usd: (params.totalRequested / 1000) * 1.5,
        })
        .select()
        .single();

      if (jobError || !job) {
        throw new Error(`Failed to create import job: ${jobError?.message || 'Unknown error'}`);
      }

      // Trigger the edge function (fire and forget - it will update status)
      supabase.functions.invoke('apify-leads-import', {
        body: { jobId: job.id },
      }).catch(error => {
        console.error(`Failed to start Apify import function: ${error.message}`);
      });

      return job as ApifyLeadsImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apify-leads-import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['lead-lists'] });
    },
  });
}

/**
 * Hook to fetch an Apify import job by ID with polling for progress
 */
export function useApifyLeadsImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['apify-leads-import-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('apify_leads_import_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch import job: ${error.message}`);
      }

      return data as ApifyLeadsImportJob;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll while job is pending or running
      if (data?.status === 'pending' || data?.status === 'running') {
        return 2000; // Poll every 2 seconds
      }
      return false; // Stop polling when complete
    },
  });
}

/**
 * Hook to list recent Apify import jobs
 */
export function useApifyLeadsImportJobs(limit = 10) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['apify-leads-import-jobs', currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('apify_leads_import_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch import jobs: ${error.message}`);
      }

      return (data || []) as ApifyLeadsImportJob[];
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to fetch active (pending/running) Apify import jobs for background task bar
 */
export function useActiveApifyLeadsImportJobs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['apify-leads-import-jobs-active', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('apify_leads_import_jobs')
        .select('id, status, total_requested, total_found, total_imported, total_skipped, progress')
        .eq('organization_id', currentOrganization.id)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as Pick<ApifyLeadsImportJob, 'id' | 'status' | 'total_requested' | 'total_found' | 'total_imported' | 'total_skipped' | 'progress'>[];
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: 5000,
  });
}

/**
 * Hook to cancel an Apify import job
 */
export function useCancelApifyLeadsImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('apify_leads_import_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .in('status', ['pending', 'running', 'paused']);

      if (error) {
        throw new Error(`Failed to cancel import: ${error.message}`);
      }
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['apify-leads-import-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['apify-leads-import-jobs'] });
    },
  });
}
