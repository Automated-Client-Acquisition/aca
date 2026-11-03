import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useEffect, useRef } from 'react';
import type { FieldMapping } from '@/components/lead-import/CSVFieldMapper';

export type CSVImportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SkipReasons {
  missing_linkedin_url?: number;
  missing_identifier?: number;
  invalid_linkedin_url?: number;
  duplicates_updated?: number;
}

export interface CSVImportJob {
  id: string;
  organization_id: string;
  target_list_id: string;
  filename: string;
  file_path: string | null;
  total_rows: number;
  status: CSVImportJobStatus;
  progress: number;
  current_row: number;
  imported_count: number;
  skipped_count: number;
  failed_count: number;
  skip_reasons: SkipReasons | null;
  error_message: string | null;
  field_mappings: FieldMapping[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
}

export interface StartCSVImportParams {
  targetListId: string;
  filename: string;
  fieldMappings: FieldMapping[];
  csvFile: File; // Now accepts the actual file instead of parsed data
  totalRows: number;
}

/**
 * Hook to start a new CSV import job (file-based)
 *
 * 1. Uploads CSV file to Supabase Storage
 * 2. Creates job record with file path
 * 3. Triggers edge function to process
 */
export function useStartCSVImport() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: StartCSVImportParams): Promise<CSVImportJob> => {
      if (!currentOrganization?.id) {
        throw new Error('No organization selected');
      }

      // Generate a unique file path: org_id/timestamp_filename.csv
      const timestamp = Date.now();
      const safeName = params.filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = `${currentOrganization.id}/${timestamp}_${safeName}`;

      console.log('[CSV Import] Uploading file to storage:', filePath);
      console.log('[CSV Import] File size:', params.csvFile.size, 'bytes');

      // Use resumable upload for large files (bypasses standard upload limit)
      // TUS protocol supports files up to the bucket limit (500MB)
      const { error: uploadError } = await supabase.storage
        .from('csv-imports')
        .upload(filePath, params.csvFile, {
          contentType: 'text/csv',
          upsert: false,
          duplex: 'half', // Required for streaming uploads
        });

      if (uploadError) {
        console.error('[CSV Import] Upload failed:', uploadError);

        // If standard upload fails due to size, provide helpful message
        if (uploadError.message.includes('exceeded the maximum allowed size')) {
          throw new Error(
            `CSV file is too large for direct upload. Please contact support or split your file into smaller chunks.`
          );
        }
        throw new Error(`Failed to upload CSV file: ${uploadError.message}`);
      }

      console.log('[CSV Import] File uploaded, creating job record...');

      // Create the job record with file path (no csv_data)
      const { data: job, error: jobError } = await supabase
        .from('csv_import_jobs')
        .insert({
          organization_id: currentOrganization.id,
          target_list_id: params.targetListId,
          filename: params.filename,
          file_path: filePath,
          total_rows: params.totalRows,
          field_mappings: params.fieldMappings,
          status: 'pending',
        })
        .select()
        .single();

      if (jobError || !job) {
        console.error('[CSV Import] Failed to create job:', jobError);
        // Clean up uploaded file
        await supabase.storage.from('csv-imports').remove([filePath]);
        throw new Error(`Failed to create import job: ${jobError?.message || 'Unknown error'}`);
      }

      console.log('[CSV Import] Job created:', job.id);

      // Fire-and-forget: trigger the edge function
      console.log('[CSV Import] Triggering edge function...');
      supabase.functions.invoke('process-csv-import', {
        body: { jobId: job.id },
      }).then(result => {
        console.log('[CSV Import] Edge function response:', result);
      }).catch(error => {
        console.error('[CSV Import] Edge function error:', error);
      });

      return job as unknown as CSVImportJob;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['csv-import-jobs'] });
    },
  });
}

/**
 * Hook to fetch a single CSV import job with polling
 */
export function useCSVImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['csv-import-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;

      const { data, error } = await supabase
        .from('csv_import_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        throw new Error(`Failed to fetch import job: ${error.message}`);
      }

      return data as unknown as CSVImportJob;
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
 * Hook to list recent CSV import jobs
 */
export function useCSVImportJobs(limit = 10) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['csv-import-jobs', currentOrganization?.id, limit],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('csv_import_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Failed to fetch import jobs: ${error.message}`);
      }

      return (data || []) as unknown as CSVImportJob[];
    },
    enabled: !!currentOrganization?.id,
  });
}

/**
 * Hook to get active (running or pending) CSV import jobs
 */
export function useActiveCSVImportJobs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ['csv-import-jobs-active', currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) return [];

      const { data, error } = await supabase
        .from('csv_import_jobs')
        .select('*')
        .eq('organization_id', currentOrganization.id)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to fetch active import jobs: ${error.message}`);
      }

      return (data || []) as unknown as CSVImportJob[];
    },
    enabled: !!currentOrganization?.id,
    refetchInterval: 5000, // Poll every 5 seconds for active jobs
  });
}

/**
 * Hook to get active (running or pending) CSV import job for a specific list
 */
export function useActiveCSVImportJobForList(listId: string | undefined) {
  return useQuery({
    queryKey: ['csv-import-job-for-list', listId],
    queryFn: async () => {
      if (!listId) return null;

      const { data, error } = await supabase
        .from('csv_import_jobs')
        .select('*')
        .eq('target_list_id', listId)
        .in('status', ['pending', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to fetch import job: ${error.message}`);
      }

      return data as unknown as CSVImportJob | null;
    },
    enabled: !!listId,
    refetchInterval: (query) => {
      // Poll every 3 seconds if there's an active job
      if (query.state.data) {
        return 3000;
      }
      // Poll every 30 seconds otherwise to check for new jobs
      return 30000;
    },
  });
}

/**
 * Hook to cancel a CSV import job
 */
export function useCancelCSVImport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase
        .from('csv_import_jobs')
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
      queryClient.invalidateQueries({ queryKey: ['csv-import-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['csv-import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['csv-import-jobs-active'] });
      toast.success('Import cancelled');
    },
    onError: (error) => {
      toast.error(`Failed to cancel import: ${error.message}`);
    },
  });
}

/**
 * Hook to watch for job completion and show toast notifications
 */
export function useWatchCSVImportCompletion(jobId: string | null, onComplete?: () => void) {
  const queryClient = useQueryClient();
  const hasShownToast = useRef(false);

  const { data: job } = useCSVImportJob(jobId);

  useEffect(() => {
    // Reset toast flag when job changes
    if (!jobId) {
      hasShownToast.current = false;
      return;
    }

    // Show completion toast only once
    if (job && !hasShownToast.current) {
      if (job.status === 'completed') {
        hasShownToast.current = true;

        const message = job.imported_count > 0
          ? `Imported ${job.imported_count} contacts` +
            (job.skipped_count > 0 ? ` (${job.skipped_count} skipped)` : '') +
            (job.failed_count > 0 ? ` (${job.failed_count} failed)` : '')
          : job.skipped_count > 0
            ? `All ${job.skipped_count} contacts skipped - no LinkedIn URL`
            : 'Import completed';

        toast.success(message);

        // Invalidate contact and list queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['crm-contacts'] });
        queryClient.invalidateQueries({ queryKey: ['lead-list-members'] });
        queryClient.invalidateQueries({ queryKey: ['lead-lists'] });

        onComplete?.();
      } else if (job.status === 'failed') {
        hasShownToast.current = true;
        toast.error(`Import failed: ${job.error_message || 'Unknown error'}`);
      } else if (job.status === 'cancelled') {
        hasShownToast.current = true;
        toast.info('Import was cancelled');
      }
    }
  }, [job, jobId, queryClient, onComplete]);

  return { job };
}
