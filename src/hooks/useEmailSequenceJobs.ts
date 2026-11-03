import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import type { EmailSequenceConfig } from './useEmailSequences';
import type { EmailSequenceSettings, AutopilotConfig } from '@/types/email';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface InternalEmailSettings {
  // Full settings object (new flow)
  fullSettings?: Partial<EmailSequenceSettings>;
  autopilotConfig?: AutopilotConfig;
  agentProfileId?: string | null;
  // Legacy fields (backwards compat for in-flight jobs)
  dailyLimit?: number;
  openTracking?: boolean;
  clickTracking?: boolean;
  stopOnReply?: boolean;
}

export interface PushConfig {
  toolType: 'smartlead' | 'instantly' | 'successai' | 'internal';
  connectionId?: string;
  externalCampaignId?: string;
  sequenceName?: string;
  mailboxTagFilter?: string[];
  internalSettings?: InternalEmailSettings;
  existingSequenceId?: string;
  createAsDraft?: boolean;
  resolvedSequenceId?: string;
}

export interface NotionConfig {
  enabled: boolean;
  connectionId: string;
  databaseId: string;
  icpThreshold: number;
  productId: string;
  blueprintIds: string[];
  customPrompt?: string;
  force?: boolean;
  model?: string;
  runAnalysisFirst?: boolean;
}

export type JobType = 'email_sequence' | 'notion_pages';

export interface EmailSequenceJob {
  id: string;
  organization_id: string;
  job_type: JobType;
  contact_ids: string[];
  model: string;
  email_count: number;
  generation_config: EmailSequenceConfig & { pushConfig?: PushConfig };
  notion_config: NotionConfig | null;
  status: JobStatus;
  progress: number;
  current_contact_name: string | null;
  total_contacts: number;
  generated_count: number;
  skipped_count: number;
  failed_count: number;
  pushed_count: number;
  notion_generated_count: number;
  notion_skipped_count: number;
  notion_failed_count: number;
  results: Array<{
    contactId: string;
    status: 'success' | 'skipped' | 'failed' | 'pushed';
    sequenceId?: string;
    error?: string;
  }>;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface StartEmailSequenceGenerationParams {
  contactIds: string[];
  emailCount: number;
  model: string;
  config: EmailSequenceConfig;
  pushConfig?: PushConfig;
  notionConfig?: NotionConfig;
}

/**
 * Hook to start a new email sequence generation job
 */
export function useStartEmailSequenceGeneration() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartEmailSequenceGenerationParams): Promise<EmailSequenceJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Build generation config, optionally including push config
      const generationConfig = params.pushConfig
        ? { ...params.config, pushConfig: params.pushConfig }
        : params.config;

      // Create the job record
      const { data: job, error: jobError } = await supabase
        .from('email_sequence_jobs')
        .insert({
          organization_id: currentOrganization.id,
          contact_ids: params.contactIds,
          model: params.model,
          email_count: params.emailCount,
          generation_config: generationConfig,
          notion_config: params.notionConfig || null,
          status: 'pending',
          total_contacts: params.contactIds.length,
        })
        .select()
        .single();

      if (jobError || !job) {
        throw new Error(`Failed to create generation job: ${jobError?.message || 'Unknown error'}`);
      }

      // Fire-and-forget: trigger the edge function
      supabase.functions.invoke('process-email-sequence-job', {
        body: { jobId: job.id },
      }).catch(error => {
        console.error(`Failed to start email sequence job: ${error.message}`);
      });

      return job as EmailSequenceJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-sequence-jobs'] });
    },
  });
}

/**
 * Hook to fetch a single email sequence job with polling.
 */
export function useEmailSequenceJob(jobId: string | null) {
  return useQuery({
    queryKey: ['email-sequence-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('email_sequence_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch generation job: ${error.message}`);
      }

      return data as EmailSequenceJob;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'pending' || data?.status === 'running') {
        return 2000;
      }
      return false;
    },
  });
}

/**
 * Hook to watch for job completion and show toast notifications
 */
export function useWatchEmailSequenceJobCompletion(jobId: string | null) {
  const queryClient = useQueryClient();
  const hasShownToast = useRef(false);

  const { data: job } = useEmailSequenceJob(jobId);

  useEffect(() => {
    if (!jobId) {
      hasShownToast.current = false;
      return;
    }

    if (job && !hasShownToast.current) {
      const isNotionJob = job.job_type === 'notion_pages';

      if (job.status === 'completed') {
        hasShownToast.current = true;

        let message: string;

        if (isNotionJob) {
          // Notion pages job
          if (job.generated_count > 0) {
            message = `Generated ${job.generated_count} Notion page${job.generated_count !== 1 ? 's' : ''}` +
              (job.skipped_count > 0 ? ` (${job.skipped_count} skipped)` : '') +
              (job.failed_count > 0 ? ` (${job.failed_count} failed)` : '');
          } else if (job.skipped_count > 0) {
            message = `All ${job.skipped_count} contacts skipped (below ICP threshold)`;
          } else {
            message = 'Notion page generation completed';
          }
        } else {
          // Email sequence job
          const hasPush = job.pushed_count > 0;
          const toolName = job.generation_config?.pushConfig?.toolType === 'smartlead' ? 'SmartLead'
            : job.generation_config?.pushConfig?.toolType === 'instantly' ? 'Instantly'
            : job.generation_config?.pushConfig?.toolType === 'successai' ? 'Success.ai'
            : job.generation_config?.pushConfig?.toolType === 'internal' ? 'Internal Email Engine'
            : null;

          if (hasPush) {
            const pushVerb = job.generation_config?.pushConfig?.toolType === 'internal' ? 'enrolled' : 'pushed';
            message = `Generated ${job.generated_count} sequences, ${pushVerb} ${job.pushed_count} to ${toolName}` +
              (job.failed_count > 0 ? ` (${job.failed_count} failed)` : '');
          } else if (job.generated_count > 0) {
            message = `Generated ${job.generated_count} email sequences` +
              (job.skipped_count > 0 ? ` (${job.skipped_count} skipped)` : '') +
              (job.failed_count > 0 ? ` (${job.failed_count} failed)` : '');
          } else if (job.skipped_count > 0) {
            message = `All ${job.skipped_count} contacts skipped — run Company Analysis first`;
          } else {
            message = 'Generation completed';
          }

          // Append Notion results if Notion was enabled
          const hasNotionConfig = job.notion_config?.enabled;
          if (hasNotionConfig) {
            const ng = job.notion_generated_count || 0;
            const ns = job.notion_skipped_count || 0;
            const nf = job.notion_failed_count || 0;
            if (ng > 0) {
              message += ` · ${ng} Notion page${ng !== 1 ? 's' : ''} created`;
              if (nf > 0) message += ` (${nf} failed)`;
            } else if (ns > 0 && nf === 0) {
              message += ' · No Notion pages — all contacts below ICP threshold';
            } else if (nf > 0) {
              message += ` · Notion pages failed (${nf})`;
            } else {
              message += ' · No Notion pages generated';
            }
          }
        }

        const resolvedSeqId = job.generation_config?.pushConfig?.resolvedSequenceId;
        const isDraft = job.generation_config?.pushConfig?.createAsDraft;

        if (resolvedSeqId && isDraft) {
          toast.success(message, {
            action: {
              label: 'Open in Builder',
              onClick: () => { window.location.href = `/email/sequences/${resolvedSeqId}`; },
            },
            duration: 10000,
          });
        } else {
          toast.success(message);
        }

        queryClient.invalidateQueries({ queryKey: ['contact-email-sequences'] });
        queryClient.invalidateQueries({ queryKey: ['sequence-generation-preview'] });
        queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
        queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
        queryClient.invalidateQueries({ queryKey: ['email-sequences'] });
      } else if (job.status === 'failed') {
        hasShownToast.current = true;
        const label = isNotionJob ? 'Notion page generation' : 'Sequence generation';
        toast.error(`${label} failed: ${job.error_message || 'Unknown error'}`);
      } else if (job.status === 'cancelled') {
        hasShownToast.current = true;
        const label = isNotionJob ? 'Notion page generation' : 'Sequence generation';
        toast.info(`${label} was cancelled`);
      }
    }
  }, [job, jobId, queryClient]);

  return { job };
}

/**
 * Hook to fetch all active (pending/running) email sequence jobs for the org.
 * Polls every 5 seconds so the global progress bar stays up to date.
 */
export function useActiveEmailSequenceJobs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['email-sequence-jobs-active', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('email_sequence_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to fetch active sequence jobs: ${error.message}`);

      const jobs = (data || []) as EmailSequenceJob[];

      // Filter out very old jobs that are likely orphaned (24h hard cap).
      return jobs.filter((j) => {
        const startTime = j.started_at || j.created_at;
        return Date.now() - new Date(startTime).getTime() <= 24 * 60 * 60 * 1000;
      });
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: 5000,
  });
}

export interface StartNotionPagesGenerationParams {
  contactIds: string[];
  notionConfig: NotionConfig;
}

/**
 * Hook to start a standalone Notion pages generation job
 */
export function useStartNotionPagesGeneration() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartNotionPagesGenerationParams): Promise<EmailSequenceJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Create the job record with job_type = 'notion_pages'
      const { data: job, error: jobError } = await supabase
        .from('email_sequence_jobs')
        .insert({
          organization_id: currentOrganization.id,
          job_type: 'notion_pages',
          contact_ids: params.contactIds,
          model: 'n/a',
          email_count: 0,
          generation_config: {},
          notion_config: params.notionConfig,
          status: 'pending',
          total_contacts: params.contactIds.length,
        })
        .select()
        .single();

      if (jobError || !job) {
        throw new Error(`Failed to create Notion pages job: ${jobError?.message || 'Unknown error'}`);
      }

      // Fire-and-forget: trigger the batch edge function
      supabase.functions.invoke('batch-generate-notion-pages', {
        body: { jobId: job.id },
      }).catch(error => {
        console.error(`Failed to start Notion pages job: ${error.message}`);
      });

      return job as EmailSequenceJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-sequence-jobs'] });
    },
  });
}

/**
 * Hook to cancel an email sequence generation job
 */
export function useCancelEmailSequenceJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('email_sequence_jobs')
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
      queryClient.invalidateQueries({ queryKey: ['email-sequence-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['email-sequence-jobs'] });
      toast.success('Generation job cancelled');
    },
    onError: (error) => {
      toast.error(`Failed to cancel job: ${error.message}`);
    },
  });
}
