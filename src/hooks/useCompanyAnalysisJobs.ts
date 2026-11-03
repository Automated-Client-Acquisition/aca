import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface CompanyAnalysisJob {
  id: string;
  organization_id: string;
  contact_ids: string[];
  model: string;
  unipile_account_id: string | null;
  product_context: {
    name?: string;
    description?: string;
    benefits?: string[];
  };
  product_id: string | null;
  include_already_analyzed: boolean;
  status: JobStatus;
  progress: number;
  current_contact_name: string | null;
  total_contacts: number;
  analyzed_count: number;
  skipped_count: number;
  failed_count: number;
  results: Array<{
    contactId: string;
    status: 'success' | 'skipped' | 'failed';
    error?: string;
  }>;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface StartCompanyAnalysisParams {
  contactIds: string[];
  model: string;
  unipileAccountId?: string;
  productContext?: {
    name?: string;
    description?: string;
    benefits?: string[];
  };
  productId?: string;
  icpIds?: string[];
  includeAlreadyAnalyzed?: boolean;
}

// Max time a job can be running/pending before we consider it stuck.
// Jobs process ~5 contacts per batch every ~45s, so a 1000-contact job takes ~2.5 hours.
// Set to 4 hours to give plenty of headroom.
const STUCK_JOB_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// Track which jobs we've already cleaned up to avoid repeat writes
const failedJobIds = new Set<string>();

/**
 * Mark a stuck job as failed and reset orphaned analyzing contacts.
 * Runs once per stuck job (deduplicated via failedJobIds set).
 */
async function failStuckJob(job: CompanyAnalysisJob): Promise<void> {
  if (failedJobIds.has(job.id)) return;
  failedJobIds.add(job.id);

  const elapsed = Math.round(
    (Date.now() - new Date(job.started_at || job.created_at).getTime()) / 60000
  );
  console.warn(`Job ${job.id} appears stuck (${elapsed}min), marking as failed`);

  // Mark job as failed (only if still running/pending to avoid race)
  await supabase
    .from('company_analysis_jobs')
    .update({
      status: 'failed',
      error_message: `Job timed out after ${elapsed} minutes. ${job.analyzed_count || 0} contacts were analyzed. You can retry.`,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .in('status', ['running', 'pending']);

  // Only reset contacts that are actually stuck in 'analyzing' for this job.
  // Use the results array to find which contacts were being processed (not yet resolved).
  const resolvedIds = new Set((job.results || []).map(r => r.contactId));
  const possiblyStuck = job.contact_ids.filter(id => !resolvedIds.has(id));

  if (possiblyStuck.length > 0) {
    // Chunk to avoid URL length limits — only update contacts actually in 'analyzing' state
    for (let i = 0; i < possiblyStuck.length; i += 200) {
      const chunk = possiblyStuck.slice(i, i + 200);
      await supabase
        .from('crm_contacts')
        .update({ ai_analysis_status: 'not_analyzed' })
        .in('id', chunk)
        .eq('ai_analysis_status', 'analyzing');
    }
  }
}

/**
 * Hook to start a new company analysis job
 */
export function useStartCompanyAnalysis() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartCompanyAnalysisParams): Promise<CompanyAnalysisJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Create the job record
      const { data: job, error: jobError } = await supabase
        .from('company_analysis_jobs')
        .insert({
          organization_id: currentOrganization.id,
          contact_ids: params.contactIds,
          model: params.model,
          unipile_account_id: params.unipileAccountId || null,
          product_context: params.productContext || {},
          product_id: params.productId || null,
          icp_ids: params.icpIds?.length ? params.icpIds : null,
          include_already_analyzed: params.includeAlreadyAnalyzed || false,
          status: 'pending',
          total_contacts: params.contactIds.length,
        })
        .select()
        .single();

      if (jobError || !job) {
        throw new Error(`Failed to create analysis job: ${jobError?.message || 'Unknown error'}`);
      }

      // Fire-and-forget: trigger the edge function. invoke() sends the signed-in
      // user's JWT, which the function needs to check access to the job's org.
      // We don't need the response.
      supabase.functions.invoke('process-company-analysis-job', {
        body: { jobId: job.id },
      }).catch(() => {
        // Silently ignore — the job is already created in DB.
        // If the function didn't start, the stuck-job detector will catch it.
      });

      return job as CompanyAnalysisJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs-active'] });
    },
  });
}

/**
 * Hook to fetch a single company analysis job with polling.
 * Stuck job detection is handled via useEffect (not in queryFn).
 */
export function useCompanyAnalysisJob(jobId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['company-analysis-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('company_analysis_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch analysis job: ${error.message}`);
      }

      return data as CompanyAnalysisJob;
    },
    enabled: !!jobId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.status === 'pending' || data?.status === 'running') {
        return 2000;
      }
      return false;
    },
  });

  // Detect stuck jobs outside queryFn to avoid side effects during reads
  useEffect(() => {
    const job = query.data;
    if (!job || (job.status !== 'running' && job.status !== 'pending')) return;

    const startTime = job.started_at || job.created_at;
    const elapsed = Date.now() - new Date(startTime).getTime();
    if (elapsed <= STUCK_JOB_THRESHOLD_MS) return;

    failStuckJob(job).then(() => {
      queryClient.invalidateQueries({ queryKey: ['company-analysis-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs-active'] });
    });
  }, [query.data, jobId, queryClient]);

  return query;
}

/**
 * Hook to list recent company analysis jobs
 */
export function useCompanyAnalysisJobs(limit = 10) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['company-analysis-jobs', currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('company_analysis_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch analysis jobs: ${error.message}`);
      }

      return (data || []) as CompanyAnalysisJob[];
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to get active (running or pending) company analysis jobs.
 * Pure read — stuck job cleanup is handled in useEffect, not queryFn.
 */
export function useActiveCompanyAnalysisJobs() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['company-analysis-jobs-active', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('company_analysis_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch active jobs: ${error.message}`);
      }

      return (data || []) as CompanyAnalysisJob[];
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: 5000,
  });

  // Detect and fail stuck jobs outside queryFn
  useEffect(() => {
    const jobs = query.data;
    if (!jobs || jobs.length === 0) return;

    const stuckJobs = jobs.filter(job => {
      const startTime = job.started_at || job.created_at;
      return Date.now() - new Date(startTime).getTime() > STUCK_JOB_THRESHOLD_MS;
    });

    if (stuckJobs.length === 0) return;

    Promise.all(stuckJobs.map(failStuckJob)).then(() => {
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs-active'] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs'] });
    });
  }, [query.data, queryClient]);

  return query;
}

/**
 * Hook to cancel a company analysis job
 */
export function useCancelCompanyAnalysis() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('company_analysis_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .in('status', ['pending', 'running']);

      if (error) {
        throw new Error(`Failed to cancel job: ${error.message}`);
      }
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['company-analysis-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs-active'] });
      toast.success('Analysis job cancelled');
    },
    onError: (error) => {
      toast.error(`Failed to cancel job: ${error.message}`);
    },
  });
}

/**
 * Hook to watch for job completion and show toast notifications
 */
export function useWatchJobCompletion(jobId: string | null) {
  const queryClient = useQueryClient();
  const hasShownToast = useRef(false);

  const { data: job } = useCompanyAnalysisJob(jobId);

  useEffect(() => {
    if (!jobId) {
      hasShownToast.current = false;
      return;
    }

    if (job && !hasShownToast.current) {
      if (job.status === 'completed') {
        hasShownToast.current = true;

        const message = job.analyzed_count > 0
          ? `Analyzed ${job.analyzed_count} companies` +
            (job.skipped_count > 0 ? ` (${job.skipped_count} skipped)` : '') +
            (job.failed_count > 0 ? ` (${job.failed_count} failed)` : '')
          : job.skipped_count > 0
            ? `All ${job.skipped_count} contacts skipped - no website or LinkedIn URL available`
            : 'Analysis completed';

        toast.success(message);

        queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
        queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
      } else if (job.status === 'failed') {
        hasShownToast.current = true;
        toast.error(`Analysis failed: ${job.error_message || 'Unknown error'}`);
      } else if (job.status === 'cancelled') {
        hasShownToast.current = true;
        toast.info('Analysis job was cancelled');
      }
    }
  }, [job, jobId, queryClient]);

  return { job };
}

/**
 * Hook to get status badge variant for a job
 */
export function getJobStatusVariant(status: JobStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'running':
    case 'pending':
      return 'secondary';
    case 'failed':
      return 'destructive';
    case 'cancelled':
      return 'outline';
    default:
      return 'secondary';
  }
}
