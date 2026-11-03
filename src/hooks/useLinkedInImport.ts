import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type LinkedInImportType = 'search' | 'sales_nav' | 'recruiter' | 'post_reactors' | 'post_commenters' | 'event_attendees';
export type ImportStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type SearchMode = 'url' | 'parameters';
export type ApiType = 'classic' | 'sales_navigator' | 'recruiter';

export interface LinkedInImportJob {
  id: string;
  organization_id: string;
  type: LinkedInImportType;
  source_url: string;
  account_id: string;
  target_list_id: string;
  status: ImportStatus;
  progress: number;
  total_found: number;
  total_imported: number;
  total_skipped: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface SearchParams {
  category?: 'people' | 'companies' | 'jobs' | 'posts';
  keywords?: string;
  location?: string[];
  industry?: string[];
  network_distance?: string[];
  current_company?: string[];
  past_company?: string[];
  skills?: Array<{ id: string; priority: string }>;
  seniority?: string[];
  tenure?: string[];
}

interface StartImportParams {
  type: LinkedInImportType;
  sourceUrl: string;
  accountId: string;
  targetListId: string;
  maxLeads?: number;
  // New search configuration fields
  searchMode?: SearchMode;
  apiType?: ApiType;
  searchParams?: SearchParams;
  // Legacy fields for post imports
  includeReactors?: boolean;
  includeCommenters?: boolean;
  reactionTypes?: string[];
}

/**
 * Hook to start a LinkedIn import job
 */
export function useStartLinkedInImport() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartImportParams): Promise<LinkedInImportJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Create the import job record
      const { data: job, error: jobError } = await supabase
        .from('linkedin_import_jobs')
        .insert({
          organization_id: currentOrganization.id,
          type: params.type,
          source_url: params.sourceUrl,
          account_id: params.accountId,
          target_list_id: params.targetListId,
          status: 'pending',
          metadata: {
            max_leads: params.maxLeads || 100,
            // New search configuration
            search_mode: params.searchMode || 'url',
            api_type: params.apiType,
            url: params.sourceUrl || undefined,
            search_params: params.searchParams || undefined,
            // Legacy fields for post imports
            include_reactors: params.includeReactors,
            include_commenters: params.includeCommenters,
            reaction_types: params.reactionTypes,
          },
        })
        .select()
        .single();

      if (jobError || !job) {
        throw new Error(`Failed to create import job: ${jobError?.message || 'Unknown error'}`);
      }

      // Determine which edge function to call based on type
      let functionName: string;
      switch (params.type) {
        case 'search':
        case 'sales_nav':
        case 'recruiter':
          functionName = 'linkedin-search-import';
          break;
        case 'post_reactors':
        case 'post_commenters':
          functionName = 'linkedin-post-import';
          break;
        case 'event_attendees':
          functionName = 'linkedin-event-import';
          break;
        default:
          throw new Error(`Unknown import type: ${params.type}`);
      }

      // Trigger the edge function (fire and forget - it will update status)
      supabase.functions.invoke(functionName, {
        body: { jobId: job.id },
      }).catch(error => {
        console.error(`Failed to start import function: ${error.message}`);
      });

      return job as LinkedInImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-import-jobs'] });
    },
  });
}

/**
 * Hook to fetch an import job by ID with polling for progress
 */
export function useLinkedInImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['linkedin-import-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('linkedin_import_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch import job: ${error.message}`);
      }

      return data as LinkedInImportJob;
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
 * Hook to list recent import jobs
 */
export function useLinkedInImportJobs(limit = 10) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['linkedin-import-jobs', currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('linkedin_import_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch import jobs: ${error.message}`);
      }

      return (data || []) as LinkedInImportJob[];
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to cancel an import job
 */
export function useCancelLinkedInImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('linkedin_import_jobs')
        .update({
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .in('status', ['pending', 'running']);

      if (error) {
        throw new Error(`Failed to cancel import: ${error.message}`);
      }
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ['linkedin-import-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['linkedin-import-jobs'] });
    },
  });
}

/**
 * Helper to get human-readable import type name
 */
export function getImportTypeName(type: LinkedInImportType): string {
  switch (type) {
    case 'search':
      return 'LinkedIn Search';
    case 'sales_nav':
      return 'Sales Navigator';
    case 'recruiter':
      return 'LinkedIn Recruiter';
    case 'post_reactors':
      return 'Post Reactors';
    case 'post_commenters':
      return 'Post Commenters';
    case 'event_attendees':
      return 'Event Attendees';
    default:
      return 'LinkedIn Import';
  }
}

/**
 * Helper to get status badge variant
 */
export function getStatusVariant(status: ImportStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
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
