import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const ENQUEUE_CHUNK_SIZE = 1_000;
const ENQUEUE_CONCURRENCY = 4;

type LeadListProcessingContactsInput = {
  listId: string;
  contactIds: string[];
};

type ProcessingPolicySummary = {
  id: string;
  enabled: boolean;
  approved_destination_type: "none" | "email_sequence" | "linkedin_campaign";
  approved_destination_id: string | null;
  destinationName?: string | null;
};

type PolicySummaryResult = Promise<{
  data: ProcessingPolicySummary | null;
  error: { message: string } | null;
}>;

interface PolicySummaryQuery {
  select(columns: string): PolicySummaryQuery;
  eq(column: string, value: string): PolicySummaryQuery;
  maybeSingle(): PolicySummaryResult;
}

interface ProcessingPolicyDatabase {
  from(table: "lead_list_processing_policies"): PolicySummaryQuery;
}

type ProcessingStatusRow = {
  item_status: "pending" | "processing" | "retry" | "completed" | "rejected" | "failed" | "canceled";
  item_stage: string;
  failure_category: string | null;
  recovery_exhausted: boolean;
  item_count: number | string;
  latest_updated_at: string;
  policy_paused_at: string | null;
};

export type LeadListProcessingStatus = {
  total: number;
  pending: number;
  processing: number;
  retrying: number;
  completed: number;
  rejected: number;
  failed: number;
  failedNoData: number;
  failedRetryable: number;
  failedTransientExhausted: number;
  failedOther: number;
  canceled: number;
  finished: number;
  progress: number;
  hasWork: boolean;
  isActive: boolean;
  isPaused: boolean;
  activeStage: string | null;
  activeStageKey: string | null;
  hasWaitingEmailWork: boolean;
  updatedAt: string | null;
  /** In-flight items per stage (waiting = pending + retry). Keys are item stages
   *  ("queued", "analyzing_icp", …) so the UI can show where work actually sits
   *  instead of implying everything is at the busiest stage. */
  stageCounts: Record<string, { working: number; waiting: number }>;
};

type ProcessingProviderStatusRow = {
  provider: string;
  chain_position: number | string;
  key_configured: boolean;
  key_valid: boolean;
  provider_plan: string | null;
  attempt_count: number | string;
  running_count: number | string;
  found_count: number | string;
  not_found_count: number | string;
  skipped_count: number | string;
  failed_count: number | string;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  daily_request_count: number | null;
  daily_cap: number | null;
  daily_found_count: number | string;
};

export type LeadListProcessingProviderStatus = {
  provider: string;
  chainPosition: number;
  keyConfigured: boolean;
  keyValid: boolean;
  providerPlan: string | null;
  attempts: number;
  running: number;
  found: number;
  notFound: number;
  skipped: number;
  failed: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  dailyRequests: number | null;
  dailyCap: number | null;
  dailyFound: number;
};

type ProviderFairnessRow = {
  provider: string;
  active_lists: number | string;
  list_waiting: number | string;
};

export type LeadListProcessingProviderFairness = {
  provider: string;
  activeLists: number;
  listWaiting: number;
};

type LlmKeyStatusRow = {
  provider: string;
  model: string | null;
  key_configured: boolean;
  key_valid: boolean;
  health_status: string | null;
  health_reason: string | null;
  health_message: string | null;
  health_checked_at: string | null;
};

export type LeadListProcessingLlmKeyStatus = {
  provider: string;
  model: string | null;
  keyConfigured: boolean;
  keyValid: boolean;
  healthStatus: string | null;
  healthReason: string | null;
  healthMessage: string | null;
  healthCheckedAt: string | null;
};

type OperationalMetricsRow = {
  total_people: number | string;
  contacts_with_email: number | string;
  valid_emails: number | string;
  verified_emails: number | string;
  email_searches_total: number | string;
  email_found_total: number | string;
  ready_contacts: number | string;
  active_contacts: number | string;
  completed_last_five_minutes: number | string;
  stage_order: string[] | null;
  stage_icp_enabled: boolean;
  stage_find_email_enabled: boolean;
  stage_verify_email_enabled: boolean;
  cleared_icp: number | string;
  cleared_verify_email: number | string;
  cleared_find_email: number | string;
  enrolled: number | string;
  no_email_searched: number | string;
  no_email_unsearched: number | string;
  analysis_reused: number | string;
  analysis_ran: number | string;
};

export type LeadListProcessingOperationalMetrics = {
  totalPeople: number;
  contactsWithEmail: number;
  validEmails: number;
  verifiedEmails: number;
  emailSearchesTotal: number;
  emailFoundTotal: number;
  readyContacts: number;
  activeContacts: number;
  completedLastFiveMinutes: number;
  /** The list's configured pipeline order (subset of icp/find_email/verify_email/enroll). */
  stageOrder: string[];
  stageIcpEnabled: boolean;
  stageFindEmailEnabled: boolean;
  stageVerifyEmailEnabled: boolean;
  /** Per-stage outcomes (NOT monotonic): clearedIcp = moved past ICP scoring;
   *  clearedVerifyEmail = emails the verifier returned as valid;
   *  clearedFindEmail = contacts where a data provider found an email;
   *  enrolled = finished every stage. */
  clearedIcp: number;
  clearedVerifyEmail: number;
  clearedFindEmail: number;
  enrolled: number;
  /** Contacts still without an email, split by whether a provider actually
   *  searched (found/not_found outcome or a stamped MoltSets attempt) versus
   *  never searched at all (typically no personal /in/ LinkedIn URL). */
  noEmailSearched: number;
  noEmailUnsearched: number;
  /** Contacts whose ICP stage reused a stored company analysis instead of
   *  re-crawling the site and re-running the LLM, versus those that paid for a
   *  fresh one. */
  analysisReused: number;
  analysisRan: number;
};

const STAGE_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  analyzing_icp: "Analyzing ICP fit",
  finding_email: "Finding work emails",
  verifying_email: "Verifying deliverability",
  replacement_email_found: "Routing recovered contacts",
  writing_message: "Writing personalized emails",
  enrolling: "Adding contacts to the destination",
  completed: "Completed",
  rejected: "Routing unresolved contacts",
  failed: "Retrying provider errors",
  canceled: "Canceled",
};

export function useLeadListProcessingPolicySummary(listId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-processing-policy-summary", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async () => {
      const db = supabase as unknown as ProcessingPolicyDatabase;
      const { data, error } = await db.from("lead_list_processing_policies")
        .select("id, enabled, approved_destination_type, approved_destination_id")
        .eq("organization_id", currentOrganization!.id)
        .eq("lead_list_id", listId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.approved_destination_id || data.approved_destination_type === "none") return data;
      const table = data.approved_destination_type === "email_sequence" ? "email_sequences" : "linkedin_campaigns";
      const destination = await supabase.from(table).select("name")
        .eq("id", data.approved_destination_id)
        .eq("organization_id", currentOrganization!.id).maybeSingle();
      if (destination.error) throw destination.error;
      return { ...data, destinationName: destination.data?.name ?? null };
    },
  });
}

export function useLeadListProcessingStatus(listId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-processing-status", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async (): Promise<LeadListProcessingStatus | null> => {
      const { data, error } = await supabase.rpc(
        "get_lead_list_processing_status" as never,
        { p_list_id: listId } as never,
      );
      if (error) throw error;

      const rows = (data ?? []) as ProcessingStatusRow[];
      if (!rows.length) return null;

      const countStatus = (status: ProcessingStatusRow["item_status"]) => rows
        .filter((row) => row.item_status === status)
        .reduce((sum, row) => sum + Number(row.item_count), 0);
      const pending = countStatus("pending");
      const processing = countStatus("processing");
      const retrying = countStatus("retry");
      const completed = countStatus("completed");
      const rejected = countStatus("rejected");
      const failed = countStatus("failed");
      const failedNoData = rows
        .filter((row) => row.item_status === "failed" && row.failure_category === "no_source_data")
        .reduce((sum, row) => sum + Number(row.item_count), 0);
      const failedRetryable = rows
        .filter((row) => row.item_status === "failed" && row.failure_category === "transient")
        .reduce((sum, row) => sum + Number(row.item_count), 0);
      const failedTransientExhausted = rows
        .filter((row) => row.item_status === "failed" && row.failure_category === "transient" && row.recovery_exhausted)
        .reduce((sum, row) => sum + Number(row.item_count), 0);
      const failedOther = failed - failedNoData - failedRetryable;
      const canceled = countStatus("canceled");
      const total = rows.reduce((sum, row) => sum + Number(row.item_count), 0);
      // Provider/worker failures still need intervention and must not inflate
      // successful workflow progress.
      const finished = completed + rejected + canceled + failedNoData;
      const isPaused = rows.some((row) => !!row.policy_paused_at);
      const hasWork = pending + processing + retrying > 0;
      const activeRows = rows
        .filter((row) => row.item_status === "processing")
        .sort((a, b) => Number(b.item_count) - Number(a.item_count));
      const waitingRows = rows
        .filter((row) => ["pending", "retry"].includes(row.item_status) && row.item_stage !== "queued")
        .sort((a, b) => Number(b.item_count) - Number(a.item_count));
      const activeStageKey = activeRows[0]?.item_stage ?? waitingRows[0]?.item_stage ?? (pending ? "queued" : null);
      const hasWaitingEmailWork = rows.some((row) => (
        ["pending", "retry", "processing"].includes(row.item_status)
        && ["finding_email", "replacement_email_found"].includes(row.item_stage)
      ));
      const updatedAt = rows.reduce<string | null>((latest, row) => (
        !latest || new Date(row.latest_updated_at) > new Date(latest) ? row.latest_updated_at : latest
      ), null);
      const stageCounts: Record<string, { working: number; waiting: number }> = {};
      for (const row of rows) {
        if (!["pending", "retry", "processing"].includes(row.item_status)) continue;
        const bucket = stageCounts[row.item_stage] ?? (stageCounts[row.item_stage] = { working: 0, waiting: 0 });
        if (row.item_status === "processing") bucket.working += Number(row.item_count);
        else bucket.waiting += Number(row.item_count);
      }

      return {
        total,
        pending,
        processing,
        retrying,
        completed,
        rejected,
        failed,
        failedNoData,
        failedRetryable,
        failedTransientExhausted,
        failedOther,
        canceled,
        finished,
        progress: total ? Math.round((finished / total) * 1_000) / 10 : 0,
        hasWork,
        isActive: hasWork && !isPaused,
        isPaused,
        activeStage: activeStageKey ? STAGE_LABELS[activeStageKey] ?? activeStageKey : null,
        activeStageKey,
        hasWaitingEmailWork,
        updatedAt,
        stageCounts,
      };
    },
    refetchInterval: (query) => query.state.data?.hasWork ? 3_000 : 30_000,
    staleTime: 2_000,
  });
}

export function useLeadListProcessingProviderStatus(listId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-processing-provider-status", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async (): Promise<LeadListProcessingProviderStatus[]> => {
      const { data, error } = await supabase.rpc(
        "get_lead_list_processing_provider_status" as never,
        { p_list_id: listId } as never,
      );
      if (error) throw error;

      return ((data ?? []) as ProcessingProviderStatusRow[]).map((row) => ({
        provider: row.provider,
        chainPosition: Number(row.chain_position),
        keyConfigured: row.key_configured,
        keyValid: row.key_valid,
        providerPlan: row.provider_plan,
        attempts: Number(row.attempt_count),
        running: Number(row.running_count),
        found: Number(row.found_count),
        notFound: Number(row.not_found_count),
        skipped: Number(row.skipped_count),
        failed: Number(row.failed_count),
        lastAttemptAt: row.last_attempt_at,
        lastSuccessAt: row.last_success_at,
        lastError: row.last_error,
        dailyRequests: row.daily_request_count === null ? null : Number(row.daily_request_count),
        dailyCap: row.daily_cap === null ? null : Number(row.daily_cap),
        dailyFound: Number(row.daily_found_count),
      }));
    },
    refetchInterval: (query) => query.state.data?.some((provider) => provider.running > 0) ? 3_000 : 15_000,
    staleTime: 2_000,
  });
}

export function useLeadListProcessingProviderFairness(listId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-processing-provider-fairness", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async (): Promise<LeadListProcessingProviderFairness[]> => {
      const { data, error } = await supabase.rpc(
        "get_lead_list_processing_provider_fairness" as never,
        { p_list_id: listId } as never,
      );
      if (error) throw error;
      return ((data ?? []) as ProviderFairnessRow[]).map((row) => ({
        provider: row.provider,
        activeLists: Number(row.active_lists),
        listWaiting: Number(row.list_waiting),
      }));
    },
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
}

export function useLeadListProcessingLlmKeyStatus(listId?: string) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-processing-llm-key-status", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async (): Promise<LeadListProcessingLlmKeyStatus | null> => {
      const { data, error } = await supabase.rpc(
        "get_lead_list_processing_llm_key_status" as never,
        { p_list_id: listId } as never,
      );
      if (error) throw error;
      const row = (data ?? [])[0] as LlmKeyStatusRow | undefined;
      if (!row) return null;
      return {
        provider: row.provider,
        model: row.model,
        keyConfigured: row.key_configured,
        keyValid: row.key_valid,
        healthStatus: row.health_status,
        healthReason: row.health_reason,
        healthMessage: row.health_message,
        healthCheckedAt: row.health_checked_at,
      };
    },
    refetchInterval: 10_000,
    staleTime: 2_000,
  });
}

export function useLeadListProcessingOperationalMetrics(listId?: string) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["lead-list-processing-operational-metrics", currentOrganization?.id, listId],
    enabled: !!currentOrganization?.id && !!listId,
    queryFn: async (): Promise<LeadListProcessingOperationalMetrics | null> => {
      const { data, error } = await supabase.rpc("get_lead_list_processing_operational_metrics" as never, { p_list_id: listId } as never);
      if (error) throw error;
      const row = (data ?? [])[0] as OperationalMetricsRow | undefined;
      return row ? {
        totalPeople: Number(row.total_people),
        contactsWithEmail: Number(row.contacts_with_email),
        validEmails: Number(row.valid_emails), verifiedEmails: Number(row.verified_emails),
        emailSearchesTotal: Number(row.email_searches_total),
        emailFoundTotal: Number(row.email_found_total),
        readyContacts: Number(row.ready_contacts), activeContacts: Number(row.active_contacts),
        completedLastFiveMinutes: Number(row.completed_last_five_minutes),
        stageOrder: row.stage_order ?? ["icp", "find_email", "verify_email", "enroll"],
        stageIcpEnabled: row.stage_icp_enabled,
        stageFindEmailEnabled: row.stage_find_email_enabled,
        stageVerifyEmailEnabled: row.stage_verify_email_enabled,
        clearedIcp: Number(row.cleared_icp),
        clearedVerifyEmail: Number(row.cleared_verify_email),
        clearedFindEmail: Number(row.cleared_find_email),
        enrolled: Number(row.enrolled),
        noEmailSearched: Number(row.no_email_searched ?? 0),
        noEmailUnsearched: Number(row.no_email_unsearched ?? 0),
        analysisReused: Number(row.analysis_reused ?? 0),
        analysisRan: Number(row.analysis_ran ?? 0),
      } : null;
    },
    retry: false,
    refetchInterval: 10_000,
    staleTime: 2_000,
  });
}

type ListProcessingControlFunction =
  | "pause_lead_list_processing"
  | "resume_lead_list_processing"
  | "cancel_lead_list_processing_run"
  | "reset_lead_list_processing_run"
  | "restart_canceled_lead_processing_run"
  | "retry_failed_lead_list_processing_run"
  | "route_lead_list_processing_no_source_data";

function useListProcessingControl(functionName: ListProcessingControlFunction, dispatchAfter = false) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId }: { listId: string }) => {
      const { data, error } = await supabase.rpc(functionName as never, { p_list_id: listId } as never);
      if (error) throw error;

      if (dispatchAfter) {
        void supabase.functions.invoke("process-lead-list-processing", {
          body: { listId, limit: 10, fanout: 10 },
        });
      }

      return { affected: Number(data ?? 0) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-status"] });
      // The run dashboard is backed by a separate query from the status
      // control. Resetting (or restarting) a run must refresh both together;
      // otherwise the old funnel values remain visible until the next poll.
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-operational-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-fairness"] });
    },
  });
}

export function usePauseLeadListProcessing() {
  return useListProcessingControl("pause_lead_list_processing");
}

export function useResumeLeadListProcessing() {
  return useListProcessingControl("resume_lead_list_processing", true);
}

export function useCancelLeadListProcessingRun() {
  return useListProcessingControl("cancel_lead_list_processing_run");
}

export function useResetLeadListProcessingRun() {
  // No dispatchAfter: a reset leaves the policy paused (see the RPC) so the
  // operator has to explicitly hit Resume before the fresh run starts.
  return useListProcessingControl("reset_lead_list_processing_run");
}

export function useRestartCanceledLeadListProcessingRun() {
  return useListProcessingControl("restart_canceled_lead_processing_run", true);
}

export function useRetryFailedLeadListProcessingRun() {
  return useListProcessingControl("retry_failed_lead_list_processing_run", true);
}

export function useRouteNoSourceDataLeadListProcessing() {
  return useListProcessingControl("route_lead_list_processing_no_source_data");
}

async function runContactRpc(
  functionName: "enqueue_lead_list_processing_contacts" | "cancel_lead_list_processing_contacts",
  { listId, contactIds }: LeadListProcessingContactsInput,
) {
  let affected = 0;
  const chunks: string[][] = [];

  for (let index = 0; index < contactIds.length; index += ENQUEUE_CHUNK_SIZE) {
    chunks.push(contactIds.slice(index, index + ENQUEUE_CHUNK_SIZE));
  }

  for (let index = 0; index < chunks.length; index += ENQUEUE_CONCURRENCY) {
    const batch = chunks.slice(index, index + ENQUEUE_CONCURRENCY);
    const results = await Promise.all(batch.map((chunk) => supabase.rpc(
      functionName as never,
      { p_list_id: listId, p_contact_ids: chunk } as never,
    )));

    for (const { data, error } of results) {
      if (error) throw error;
      affected += Number(data ?? 0);
    }
  }

  return affected;
}

export function useRunLeadListProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LeadListProcessingContactsInput) => {
      const queued = await runContactRpc("enqueue_lead_list_processing_contacts", input);

      // Cron provides durable recovery; the dispatcher starts isolated provider-bound workers.
      void supabase.functions.invoke("process-lead-list-processing", {
        body: { listId: input.listId, limit: 10, fanout: 10 },
      });

      return { queued };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-fairness"] });
    },
  });
}

export function useStartLeadListProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string) => {
      const { data, error } = await supabase.rpc(
        "enqueue_lead_list_processing_all" as never,
        { p_list_id: listId } as never,
      );
      if (error) throw error;
      const queued = Number(data ?? 0);

      // Cron provides durable recovery; the dispatcher starts isolated provider-bound workers.
      void supabase.functions.invoke("process-lead-list-processing", {
        body: { listId, limit: 10, fanout: 10 },
      });

      return { queued };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-fairness"] });
    },
  });
}

export function useStopLeadListProcessing() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: LeadListProcessingContactsInput) => ({
      stopped: await runContactRpc("cancel_lead_list_processing_contacts", input),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-status"] });
      queryClient.invalidateQueries({ queryKey: ["lead-list-processing-provider-status"] });
    },
  });
}

/**
 * - running: actively processing right now, unpaused.
 * - paused: policy is paused/disabled AND there's still work it hasn't
 *   gotten to (either items still queued, or fewer items were ever created
 *   than the list has members) — resuming/enabling would pick it back up.
 * - stalled: policy is enabled and not paused, but nothing is queued or
 *   running right now even though coverage is incomplete — e.g. a policy
 *   that was created but whose initial enqueue never ran. Distinct from
 *   "paused" because nobody explicitly turned it off; distinct from
 *   "running" because nothing is actually happening.
 * - idle: no policy at all (never run), or every list member has been
 *   through the pipeline (completed/rejected/failed/canceled) and nothing
 *   is left queued — genuinely done.
 */
export type LeadListWorkflowState = "running" | "paused" | "stalled" | "idle";

export type LeadListWorkflowStatus = {
  leadListId: string;
  totalCount: number;
  pendingCount: number;
  processingCount: number;
  isPausedOrDisabled: boolean;
  updatedAt: string | null;
};

type OrgWorkflowStatusRow = {
  lead_list_id: string;
  policy_enabled: boolean;
  policy_paused_at: string | null;
  total_count: number | string;
  pending_count: number | string;
  processing_count: number | string;
  latest_updated_at: string | null;
};

/**
 * Derives the Workflow badge state for one list. `leadCount` is the list's
 * own member count (from `lead_lists.lead_count`) — compared against how
 * many processing items were ever created for it, so a policy that stopped
 * before covering every member reads as "paused"/"stalled", not "idle".
 */
export function deriveLeadListWorkflowState(
  status: LeadListWorkflowStatus | undefined,
  leadCount: number,
): LeadListWorkflowState {
  if (!status) return "idle";
  const hasActiveWork = status.pendingCount + status.processingCount > 0;
  const coverageComplete = status.totalCount >= leadCount;
  if (hasActiveWork) return status.isPausedOrDisabled ? "paused" : "running";
  if (!coverageComplete) return status.isPausedOrDisabled ? "paused" : "stalled";
  return "idle";
}

/**
 * One row per list with an Enrich & enroll policy for this org — used to show
 * a Workflow (Running/Paused/Stalled/Idle) badge on the Lists table without
 * an N+1 useLeadListProcessingStatus call per row. Lists with no policy row
 * (never run) are absent here — deriveLeadListWorkflowState treats that as
 * "idle".
 */
export function useLeadListsWorkflowStatus() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["lead-list-workflow-status", currentOrganization?.id],
    enabled: !!currentOrganization?.id,
    queryFn: async (): Promise<Map<string, LeadListWorkflowStatus>> => {
      const { data, error } = await supabase.rpc(
        "get_org_lead_list_workflow_status" as never,
        { p_org_id: currentOrganization!.id } as never,
      );
      if (error) throw error;

      const rows = (data ?? []) as OrgWorkflowStatusRow[];
      const byListId = new Map<string, LeadListWorkflowStatus>();
      for (const row of rows) {
        byListId.set(row.lead_list_id, {
          leadListId: row.lead_list_id,
          totalCount: Number(row.total_count),
          pendingCount: Number(row.pending_count),
          processingCount: Number(row.processing_count),
          isPausedOrDisabled: !!row.policy_paused_at || !row.policy_enabled,
          updatedAt: row.latest_updated_at,
        });
      }
      return byListId;
    },
    refetchInterval: (query) => {
      const hasActiveWork = query.state.data
        ? Array.from(query.state.data.values()).some((s) => s.pendingCount + s.processingCount > 0)
        : false;
      return hasActiveWork ? 5_000 : 30_000;
    },
    staleTime: 2_000,
  });
}
