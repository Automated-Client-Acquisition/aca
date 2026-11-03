import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { normalizeEmailEnrollmentResult, type EmailEnrollmentResult } from "@/lib/email-enrollment-result";

/**
 * Audiences (lists or hand-picked contacts) above this size enroll as a
 * background job instead of a
 * browser-driven loop: one enroll-leads page is 2,500 contacts, and anything
 * bigger used to need the tab kept open.
 */
export const BACKGROUND_ENROLL_THRESHOLD = 2500;

export type EmailEnrollmentJobStatus = "pending" | "snapshotting" | "running" | "completed" | "failed" | "cancelled";

export interface EmailEnrollmentJob {
  id: string;
  sequence_id: string;
  status: EmailEnrollmentJobStatus;
  total: number;
  processed: number;
  results: EmailEnrollmentResult;
  error_message: string | null;
  attempts: number;
  created_at: string;
  completed_at: string | null;
}

export const isActiveEnrollmentJob = (job?: Pick<EmailEnrollmentJob, "status"> | null) =>
  !!job && (job.status === "pending" || job.status === "snapshotting" || job.status === "running");

/** The sequence's most recent background enrollment, polled while it runs. */
export function useLatestEmailEnrollmentJob(sequenceId: string | undefined) {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["email-enrollment-job", sequenceId, currentOrganization?.id],
    queryFn: async (): Promise<EmailEnrollmentJob | null> => {
      const { data, error } = await supabase
        .from("email_enrollment_jobs" as never)
        .select("id, sequence_id, status, total, processed, results, error_message, attempts, created_at, completed_at")
        .eq("sequence_id", sequenceId!)
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as unknown as EmailEnrollmentJob;
      return { ...row, results: normalizeEmailEnrollmentResult(row.results) };
    },
    enabled: !!sequenceId && !!currentOrganization,
    refetchInterval: (q) => (isActiveEnrollmentJob(q.state.data) ? 3000 : false),
  });

  // Refresh the enrollment table and counts as pages land, and once at the end.
  const job = query.data;
  const lastProcessed = useRef<number | null>(null);
  useEffect(() => {
    if (!job) return;
    if (lastProcessed.current !== null && lastProcessed.current !== job.processed) {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", job.sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", job.sequence_id] });
      if (!isActiveEnrollmentJob(job)) queryClient.invalidateQueries({ queryKey: ["email-sequences"] });
    }
    lastProcessed.current = job.processed;
  }, [job, queryClient]);

  return query;
}

export function useStartEmailEnrollmentJob() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      sequence_id,
      list_ids,
      contact_ids,
      filters,
      delay_hours,
    }: {
      sequence_id: string;
      list_ids?: string[];
      contact_ids?: string[];
      filters?: Record<string, unknown>;
      delay_hours?: number;
    }) => {
      if (!currentOrganization) throw new Error("No organization");
      const { data, error } = await supabase.functions.invoke("enroll-leads", {
        body: {
          sequenceId: sequence_id,
          organizationId: currentOrganization.id,
          ...(list_ids?.length ? { listIds: list_ids } : { contactIds: contact_ids ?? [] }),
          background: true,
          ...(list_ids?.length === 1 && filters ? { filters } : {}),
          ...(delay_hours ? { delayHours: delay_hours } : {}),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // An older deployment ignores `background` and enrolls synchronously.
      if (!data?.jobId) throw new Error("Background enrollment isn't available yet. Please retry in a minute.");
      return { jobId: data.jobId as string, existing: data.existing === true, sequence_id };
    },
    onSuccess: ({ existing, sequence_id }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-job", sequence_id] });
      if (existing) {
        toast.info("An enrollment is already running for this sequence", {
          description: "Its progress is shown at the top of the sequence page.",
        });
      } else {
        toast.success("Enrollment started", {
          description: "It runs in the background. You can close this page; progress shows on the sequence.",
        });
      }
    },
    onError: (error: Error) => {
      toast.error(`Couldn't start enrollment: ${error.message}`);
    },
  });
}

export function useCancelEmailEnrollmentJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, sequenceId }: { jobId: string; sequenceId: string }) => {
      // @ts-expect-error - RPC exists but not in generated types
      const { data, error } = await supabase.rpc("cancel_email_enrollment_job", { p_job_id: jobId });
      if (error) throw error;
      return { cancelled: data === true, sequenceId };
    },
    onSuccess: ({ cancelled, sequenceId }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-job", sequenceId] });
      if (cancelled) toast.success("Enrollment stopped", { description: "Leads already enrolled stay in the sequence." });
      else toast.info("This enrollment had already finished");
    },
    onError: (error: Error) => {
      toast.error(`Couldn't stop enrollment: ${error.message}`);
    },
  });
}
