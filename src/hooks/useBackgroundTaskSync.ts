/**
 * Sync hooks that bridge DB-polled job data into the global background tasks store.
 * Call these from AppLayout so they run globally.
 */
import { useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveCompanyAnalysisJobs } from "@/hooks/useCompanyAnalysisJobs";
import { useActiveEmailSequenceJobs } from "@/hooks/useEmailSequenceJobs";
import { useActiveApifyLeadsImportJobs } from "@/hooks/useApifyLeadsImport";
import { useActiveMailtesterJobs } from "@/hooks/useEmailSequences";
import { backgroundTasks } from "@/hooks/useBackgroundTasks";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function formatMailtesterExtra(job: {
  status: string;
  valid: number;
  invalid: number;
  catch_all: number;
  unknown: number;
  processed: number;
  total: number;
  daily_limit_reached: boolean;
}): string {
  if (job.status === 'queued' && job.processed === 0) {
    return 'Queued · waiting for previous verification to finish';
  }
  const remaining = Math.max(0, job.total - job.processed);
  const parts = [
    `${job.valid.toLocaleString()} valid`,
    `${job.invalid.toLocaleString()} bad`,
  ];
  if (job.catch_all > 0) parts.push(`${job.catch_all.toLocaleString()} catch-all`);
  if (job.unknown > 0) parts.push(`${job.unknown.toLocaleString()} unknown`);
  if (remaining > 0 && (job.status === 'queued' || job.status === 'running')) {
    parts.push(`${remaining.toLocaleString()} queued`);
  }
  if (job.daily_limit_reached) parts.push('daily cap hit');
  return parts.join(' · ');
}

/**
 * Syncs active company_analysis_jobs → background tasks store.
 */
export function useAnalysisJobProgressSync() {
  const { data: activeJobs } = useActiveCompanyAnalysisJobs();
  const queryClient = useQueryClient();

  const cancelJob = useCallback(async (jobId: string, taskId: string) => {
    backgroundTasks.update(taskId, { cancelling: true });
    try {
      const { error } = await supabase
        .from('company_analysis_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .in('status', ['pending', 'running']);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['company-analysis-jobs-active'] });
      toast.success('Analysis job cancelled');
    } catch {
      backgroundTasks.update(taskId, { cancelling: false });
      toast.error('Failed to cancel analysis job');
    }
  }, [queryClient]);

  useEffect(() => {
    if (!activeJobs) return;

    const activeIds = new Set<string>();

    for (const job of activeJobs) {
      const id = `analyze-${job.id}`;
      activeIds.add(id);
      const processed = job.analyzed_count + job.skipped_count + job.failed_count;
      const onCancel = () => cancelJob(job.id, id);

      if (!backgroundTasks.has(id)) {
        backgroundTasks.start({
          id,
          type: "analyze",
          label: "Analyzing companies",
          checked: processed,
          total: job.total_contacts,
          extra: job.current_contact_name || undefined,
          color: "blue",
          onCancel,
        });
      } else {
        backgroundTasks.update(id, {
          checked: processed,
          extra: job.current_contact_name || undefined,
          onCancel,
        });
      }
    }

    // Remove tasks for jobs that completed/failed since last poll
    for (const staleId of backgroundTasks.idsByPrefix("analyze-")) {
      if (!activeIds.has(staleId)) {
        backgroundTasks.finish(staleId);
      }
    }
  }, [activeJobs, cancelJob]);
}

/**
 * Syncs active email_sequence_jobs → background tasks store.
 */
export function useSequenceJobProgressSync() {
  const { data: activeJobs } = useActiveEmailSequenceJobs();
  const queryClient = useQueryClient();

  const cancelJob = useCallback(async (jobId: string, taskId: string) => {
    backgroundTasks.update(taskId, { cancelling: true });
    try {
      const { error } = await supabase
        .from('email_sequence_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .in('status', ['pending', 'running']);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['email-sequence-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['email-sequence-jobs-active'] });
      toast.success('Generation job cancelled');
    } catch {
      backgroundTasks.update(taskId, { cancelling: false });
      toast.error('Failed to cancel generation job');
    }
  }, [queryClient]);

  useEffect(() => {
    if (!activeJobs) return;

    const activeIds = new Set<string>();

    for (const job of activeJobs) {
      const id = `generate-${job.id}`;
      activeIds.add(id);
      const processed = job.generated_count + job.skipped_count + job.failed_count;
      const label = job.job_type === "notion_pages" ? "Generating Notion pages" : "Generating sequences";
      const onCancel = () => cancelJob(job.id, id);

      if (!backgroundTasks.has(id)) {
        backgroundTasks.start({
          id,
          type: "generate",
          label,
          checked: processed,
          total: job.total_contacts,
          extra: job.current_contact_name || undefined,
          color: "violet",
          onCancel,
        });
      } else {
        backgroundTasks.update(id, {
          checked: processed,
          extra: job.current_contact_name || undefined,
          onCancel,
        });
      }
    }

    // Remove tasks for jobs that completed/failed since last poll
    for (const staleId of backgroundTasks.idsByPrefix("generate-")) {
      if (!activeIds.has(staleId)) {
        backgroundTasks.finish(staleId);
      }
    }
  }, [activeJobs, cancelJob]);
}

/**
 * Syncs active apify_leads_import_jobs -> background tasks store.
 */
export function useApifyLeadsImportSync() {
  const { data: activeJobs } = useActiveApifyLeadsImportJobs();
  const queryClient = useQueryClient();

  const cancelJob = useCallback(async (jobId: string, taskId: string) => {
    backgroundTasks.update(taskId, { cancelling: true });
    try {
      const { error } = await supabase
        .from('apify_leads_import_jobs')
        .update({ status: 'cancelled', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .in('status', ['pending', 'running']);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['apify-leads-import-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['apify-leads-import-jobs-active'] });
      queryClient.invalidateQueries({ queryKey: ['lead-lists'] });
      toast.success('Leads import cancelled');
    } catch {
      backgroundTasks.update(taskId, { cancelling: false });
      toast.error('Failed to cancel import');
    }
  }, [queryClient]);

  useEffect(() => {
    if (!activeJobs) return;

    const activeIds = new Set<string>();

    for (const job of activeJobs) {
      const id = `leads-import-${job.id}`;
      activeIds.add(id);
      const processed = job.total_imported + job.total_skipped;
      const onCancel = () => cancelJob(job.id, id);

      if (!backgroundTasks.has(id)) {
        backgroundTasks.start({
          id,
          type: "leads-import",
          label: "Importing leads",
          checked: processed,
          // Denominator must be the full requested count (the import's goal),
          // NOT total_found — which only counts leads found in batches run *so far*.
          // Using total_found made every batch read as 100% mid-run: e.g. after
          // batch 1 of 8, imported+skipped == total_found == 1000, so the bar
          // showed "1000 / 1000 (100%)" while the job was really ~12% done and
          // still chugging through later batches.
          total: job.total_requested || job.total_found,
          color: "emerald",
          onCancel,
        });
      } else {
        backgroundTasks.update(id, {
          checked: processed,
          label: job.total_found > 0
            ? `Importing leads - ${job.total_imported} added`
            : "Importing leads",
          onCancel,
        });
      }
    }

    for (const staleId of backgroundTasks.idsByPrefix("leads-import-")) {
      if (!activeIds.has(staleId)) {
        backgroundTasks.finish(staleId);
        toast.success('Lead import complete');
        queryClient.invalidateQueries({ queryKey: ['lead-lists'] });
      }
    }
  }, [activeJobs, cancelJob, queryClient]);
}

/**
 * Syncs active mailtester_verification_jobs -> background tasks store. This
 * is what makes the verification progress bar reappear on its own after a
 * page reload or navigation, without requiring the user to click Verify
 * Emails again.
 */
export function useMailtesterJobProgressSync() {
  const { data: activeJobs } = useActiveMailtesterJobs();
  const queryClient = useQueryClient();

  const cancelJob = useCallback(async (jobId: string, taskId: string) => {
    backgroundTasks.update(taskId, { cancelling: true });
    try {
      const { error } = await supabase
        .from('mailtester_verification_jobs')
        .update({ status: 'cancelled', pending_emails: [], finished_at: new Date().toISOString() })
        .eq('id', jobId)
        .in('status', ['queued', 'running']);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['mailtester-active-jobs'] });
      queryClient.invalidateQueries({ queryKey: ['mailtester-job', jobId] });
      queryClient.invalidateQueries({ queryKey: ['mailtester-ninja-status'] });
      toast.success('Mailtester job cancelled');
    } catch {
      backgroundTasks.update(taskId, { cancelling: false });
      toast.error('Failed to cancel Mailtester job');
    }
  }, [queryClient]);

  useEffect(() => {
    if (!activeJobs) return;

    const activeIds = new Set<string>();

    for (const job of activeJobs) {
      const id = `mailtester-${job.id}`;
      activeIds.add(id);
      const onCancel = () => cancelJob(job.id, id);
      const label = job.status === 'queued'
        ? 'Organization email verification queue - waiting'
        : 'Organization email verification queue';

      if (!backgroundTasks.has(id)) {
        backgroundTasks.start({
          id,
          type: 'verify',
          label,
          checked: job.processed,
          total: job.total,
          extra: formatMailtesterExtra(job),
          color: 'amber',
          mode: 'growing-queue',
          onCancel,
        });
      } else {
        backgroundTasks.update(id, {
          label,
          checked: job.processed,
          total: job.total,
          extra: formatMailtesterExtra(job),
          mode: 'growing-queue',
          onCancel,
        });
      }
    }

    // Remove tasks for jobs that succeeded/failed/cancelled since last poll
    for (const staleId of backgroundTasks.idsByPrefix('mailtester-')) {
      if (!activeIds.has(staleId)) {
        backgroundTasks.finish(staleId);
        queryClient.invalidateQueries({ queryKey: ['email-verifications'] });
        queryClient.invalidateQueries({ queryKey: ['mailtester-ninja-status'] });
      }
    }
  }, [activeJobs, cancelJob, queryClient]);
}
