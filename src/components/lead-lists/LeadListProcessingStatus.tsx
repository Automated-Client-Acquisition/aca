import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Database,
  FileJson,
  Gauge,
  KeyRound,
  Loader2,
  MailCheck,
  Pause,
  Play,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Target,
  Users,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  useActiveMailtesterJobs,
  useRecentFailedMailtesterJobs,
  useCancelMailtesterJob,
  type MailtesterJob,
} from "@/hooks/useEmailSequences";
import {
  useCancelLeadListProcessingRun,
  type LeadListProcessingProviderStatus,
  useLeadListProcessingProviderStatus,
  useLeadListProcessingLlmKeyStatus,
  useLeadListProcessingOperationalMetrics,
  type LeadListProcessingOperationalMetrics,
  useLeadListProcessingStatus,
  usePauseLeadListProcessing,
  useResetLeadListProcessingRun,
  useRestartCanceledLeadListProcessingRun,
  useResumeLeadListProcessing,
  useRetryFailedLeadListProcessingRun,
  useRouteNoSourceDataLeadListProcessing,
} from "@/hooks/useLeadListProcessing";

type AnalysisFilter = "not_analyzed" | "failed" | "no_data";

type LeadListProcessingStatusProps = {
  listId: string;
  onConfigure?: () => void;
  onShowFilter?: (filter: AnalysisFilter) => void;
  onDownloadRawJson?: () => void;
  downloadingRawJson?: boolean;
};

function verificationOutcomeLabel(count: number, label: string, processed: number): string {
  const percentage = processed > 0 ? Math.round((count / processed) * 100) : 0;
  return `${count.toLocaleString()} ${label} (${percentage}%)`;
}

/* ---------- Segmented run progress ---------- */

// One segment per outcome bucket. Together the buckets partition the run's
// total, so the bar doubles as the status breakdown (no separate KPI rail).
type RunSegment = {
  key: string;
  label: string;
  value: number;
  barClass: string;
  dotClass: string;
};

function SegmentedRunProgress({ segments, total }: { segments: RunSegment[]; total: number }) {
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {segments
          .filter((s) => s.value > 0 && s.barClass)
          .map((s) => (
            <div
              key={s.key}
              className={s.barClass}
              style={{ width: `${total > 0 ? (s.value / total) * 100 : 0}%` }}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.dotClass}`} />
              <strong className="font-semibold tabular-nums text-foreground">{s.value.toLocaleString()}</strong>
              {s.label}
            </span>
          ))}
      </div>
    </div>
  );
}

/* ---------- Pipeline funnel stage ---------- */

function PipelineStage({
  label,
  value,
  icon: Icon,
  active,
  pct,
  tooltip,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  active: boolean;
  /** Share of everyone in the run. null on the first stage. */
  pct?: number | null;
  tooltip: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`flex min-w-[104px] flex-1 cursor-help items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
            active ? "border-blue-300 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30" : "bg-card"
          }`}
        >
          <Icon className={`h-4 w-4 shrink-0 ${active ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground"}`} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold leading-none tabular-nums">{value.toLocaleString()}</span>
              {pct !== null && pct !== undefined && (
                <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{pct}%</span>
              )}
            </div>
            <div className="mt-1 truncate text-[11px] text-muted-foreground">{label}</div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/* ---------- Conversion funnel ---------- */

// Maps each pipeline stage to its funnel column. The funnel is built by walking
// the list's own stage_order and emitting one column per ENABLED stage, so it
// mirrors whatever pipeline the list actually runs (order, gates, disabled stages).
const FUNNEL_STAGES: Record<
  string,
  {
    label: string;
    tooltip: string;
    icon: typeof Users;
    activeStageKey: string;
    enabled: (o: LeadListProcessingOperationalMetrics) => boolean;
    cleared: (o: LeadListProcessingOperationalMetrics) => number;
    pct?: (o: LeadListProcessingOperationalMetrics) => number | null;
  }
> = {
  icp: {
    label: "Passed ICP",
    tooltip: "Contacts that cleared ICP scoring and moved to the next step.",
    icon: Target,
    activeStageKey: "analyzing_icp",
    enabled: (o) => o.stageIcpEnabled,
    cleared: (o) => o.clearedIcp,
  },
  find_email: {
    label: "Email found",
    tooltip: "Contacts in this list where a data provider found an email — through this workflow, daily enrichment, or campaign enrichment.",
    icon: MailCheck,
    activeStageKey: "finding_email",
    enabled: (o) => o.stageFindEmailEnabled,
    // Unlike progression stages, an email-provider find rate is meaningful
    // only against completed lookups—not everyone who entered the workflow.
    cleared: (o) => o.emailFoundTotal,
    pct: (o) => o.emailSearchesTotal > 0
      ? Math.round((o.emailFoundTotal / o.emailSearchesTotal) * 100)
      : null,
  },
  verify_email: {
    label: "Email valid",
    tooltip: "Emails that came back valid (safe to send) from the verifier. If the list is set to verify only stale emails, freshly-validated addresses are trusted here without a verifier check and continue to enrollment.",
    icon: ShieldCheck,
    activeStageKey: "verifying_email",
    enabled: (o) => o.stageVerifyEmailEnabled,
    cleared: (o) => o.clearedVerifyEmail,
  },
  enroll: {
    label: "Enrolled",
    tooltip: "Contacts that finished every step and were added to the destination.",
    icon: CheckCircle2,
    activeStageKey: "enrolling",
    enabled: () => true,
    cleared: (o) => o.enrolled,
  },
};

// Short nouns for the per-stage waiting breakdown in the status header.
const STAGE_NOUNS: Record<string, string> = {
  queued: "not started",
  analyzing_icp: "at ICP scoring",
  finding_email: "at email finding",
  verifying_email: "at email verification",
  writing_message: "at message writing",
  enrolling: "at enrollment",
};

/* ---------- Provider card ---------- */

const PROVIDER_LABELS: Record<string, string> = {
  apollo: "Apollo",
  hunter: "Hunter",
  prospeo: "Prospeo",
  moltsets: "MoltSets",
};

function providerState(provider: LeadListProcessingProviderStatus) {
  const quotaReached = provider.dailyCap !== null
    && provider.dailyRequests !== null
    && provider.dailyRequests >= provider.dailyCap;
  if (!provider.keyConfigured) return { label: "Not connected", icon: WifiOff, className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400", attention: true, unhealthy: true, quotaReached };
  if (!provider.keyValid) return { label: "Invalid key", icon: AlertCircle, className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400", attention: true, unhealthy: true, quotaReached };
  if (provider.running > 0) return { label: "Calling now", icon: Loader2, className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-400", attention: true, unhealthy: false, quotaReached };
  if (quotaReached) return { label: "Daily limit reached", icon: Gauge, className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400", attention: false, unhealthy: true, quotaReached };
  if (provider.found > 0) return { label: "Working", icon: CheckCircle2, className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400", attention: false, unhealthy: false, quotaReached };
  if (provider.failed > 0) return { label: "Needs attention", icon: AlertCircle, className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400", attention: true, unhealthy: true, quotaReached };
  return { label: "Ready", icon: CheckCircle2, className: "border-border bg-muted/40 text-foreground", attention: false, unhealthy: false, quotaReached };
}

function ProviderActivity({
  provider,
  isLast,
}: {
  provider: LeadListProcessingProviderStatus;
  isLast: boolean;
}) {
  const state = providerState(provider);
  const { quotaReached } = state;
  const StateIcon = state.icon;
  // Only calls that ran and answered. Skips are the scheduler pacing us, not
  // the provider answering, so counting them would understate the hit rate.
  const ran = provider.found + provider.notFound;
  const findRatePct = ran > 0 ? Math.round((provider.found / ran) * 100) : null;
  const latestText = provider.lastAttemptAt
    ? formatDistanceToNow(new Date(provider.lastAttemptAt), { addSuffix: true })
    : null;

  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <Database className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {provider.chainPosition}. {PROVIDER_LABELS[provider.provider] ?? provider.provider}
            </div>
            <div className="text-xs text-muted-foreground">
              {provider.providerPlan?.replace("tier_", "Tier ") ?? "Email enrichment"}
            </div>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${state.className}`}>
          <StateIcon className={`h-3.5 w-3.5 ${provider.running > 0 ? "animate-spin" : ""}`} />
          {state.label}
        </span>
      </div>

      {/* What this list got out of the provider — nothing about how the
          scheduler paced it. Rate gauges, org quota bars and fair-share lines
          are org/provider plumbing: they answered "is the machine busy", not
          "how is my list doing", and buried the two numbers that matter. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">This list:</span>
        {ran > 0 ? (
          <>
            <span><strong className="font-semibold text-emerald-700 dark:text-emerald-400">{provider.found.toLocaleString()}</strong> found</span>
            <span><strong className="font-semibold text-foreground">{provider.notFound.toLocaleString()}</strong> none</span>
            <span className="tabular-nums">{findRatePct}% find rate</span>
          </>
        ) : (
          <span>No calls yet</span>
        )}
        {provider.running > 0 && (
          <span className="font-medium text-blue-700 dark:text-blue-400">{provider.running.toLocaleString()} live</span>
        )}
      </div>

      {quotaReached && isLast ? (
        <p className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-400">
          This organization&apos;s quota is exhausted. Contacts wait for tomorrow, or add a fallback provider to continue today.
        </p>
      ) : provider.lastError && state.unhealthy ? (
        /* Only when the provider is genuinely unhealthy. Gating on failed > 0
           surfaced the all-time last error forever, so a ~1% transient painted
           a red line under a "Working" pill. Item-level failures still surface
           in the run's own error counts and retry actions. */
        <p className="mt-2 line-clamp-2 text-xs text-red-700 dark:text-red-400" title={provider.lastError}>{provider.lastError}</p>
      ) : latestText ? (
        <p className="mt-2 text-xs text-muted-foreground">Last call {latestText}</p>
      ) : null}
    </div>
  );
}

/* ---------- Collapsible section shell ---------- */

function Section({
  title,
  summary,
  icon: Icon,
  defaultOpen,
  action,
  children,
}: {
  title: string;
  summary?: ReactNode;
  icon: typeof Activity;
  defaultOpen: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-t">
      <div className="flex items-center justify-between gap-3 py-3">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold">{title}</span>
          {summary && <span className="truncate text-xs text-muted-foreground">· {summary}</span>}
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent className="pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/* ---------- Workflow alert ---------- */

function WorkflowAlert({
  icon: Icon,
  title,
  description,
  action,
  tone = "critical",
}: {
  icon: typeof AlertCircle;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "critical" | "warning";
}) {
  const styles = tone === "warning"
    ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300"
    : "border-red-200 bg-red-50 text-red-950 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300";
  const iconStyles = tone === "warning" ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
  const descriptionStyles = tone === "warning" ? "text-amber-800 dark:text-amber-400/90" : "text-red-800 dark:text-red-400/90";

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <div className="flex min-w-0 items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconStyles}`} />
        <div>
          <p className="font-semibold">{title}</p>
          <p className={`mt-0.5 ${descriptionStyles}`}>{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------- Main panel ---------- */

export function LeadListProcessingStatus({ listId, onConfigure, onShowFilter, onDownloadRawJson, downloadingRawJson }: LeadListProcessingStatusProps) {
  const { data: status } = useLeadListProcessingStatus(listId);
  const { data: providers = [] } = useLeadListProcessingProviderStatus(listId);
  const { data: llmKeyStatus } = useLeadListProcessingLlmKeyStatus(listId);
  const { data: operations } = useLeadListProcessingOperationalMetrics(listId);
  const { data: mailtesterJobs } = useActiveMailtesterJobs();
  const { data: failedMailtesterJobs } = useRecentFailedMailtesterJobs();
  const cancelVerification = useCancelMailtesterJob();
  const pause = usePauseLeadListProcessing();
  const resume = useResumeLeadListProcessing();
  const cancelRun = useCancelLeadListProcessingRun();
  const resetRun = useResetLeadListProcessingRun();
  const restartCanceled = useRestartCanceledLeadListProcessingRun();
  const retryFailed = useRetryFailedLeadListProcessingRun();
  const routeNoSourceData = useRouteNoSourceDataLeadListProcessing();
  const [resetAfterCancelListId, setResetAfterCancelListId] = useState<string | null>(null);

  const verificationJob = useMemo<MailtesterJob | null>(() => {
    if (!mailtesterJobs) return null;
    return mailtesterJobs.find((j) => j.list_id === listId || j.list_ids?.includes(listId)) ?? null;
  }, [mailtesterJobs, listId]);

  const verificationFailedJob = useMemo<MailtesterJob | null>(() => {
    if (verificationJob || !failedMailtesterJobs) return null;
    return failedMailtesterJobs.find((j) => j.list_id === listId || j.list_ids?.includes(listId)) ?? null;
  }, [verificationJob, failedMailtesterJobs, listId]);

  // A reset cannot overwrite an item while its worker is still in an external
  // provider call. Make the one-click intent durable in the UI: once the
  // cooperative cancellation has parked every active item, start the full new
  // run automatically instead of asking the operator to come back and click
  // Reset again.
  useEffect(() => {
    if (resetAfterCancelListId !== listId || !status || status.processing > 0 || resetRun.isPending) return;
    setResetAfterCancelListId(null);
    resetRun.mutate({ listId }, {
      onSuccess: ({ affected }) => toast.success(`Reset all ${affected.toLocaleString()} contact${affected === 1 ? "" : "s"}. Hit Resume when you're ready to start the new run.`),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reset this workflow run"),
    });
  }, [listId, resetAfterCancelListId, resetRun, status]);

  // Manual MailTester runs do not require a lead-list processing policy. Keep
  // their progress visible even when this list has never started that broader
  // workflow; previously the early return hid a correctly queued job.
  if (!status) {
    if (!verificationJob) return null;
    const remaining = Math.max(0, verificationJob.total - verificationJob.processed);
    const isQueued = verificationJob.status === "queued";
    return (
      <Card className="border-amber-200 bg-amber-50/40 p-5 dark:border-amber-900/50 dark:bg-amber-950/10" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
              <MailCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">MailTester verification {isQueued ? "queued" : "in progress"}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isQueued ? "Waiting for the organization-wide MailTester worker." : "Checks are running now."}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelVerification.mutate(verificationJob.id)}
            disabled={cancelVerification.isPending}
            className="text-muted-foreground"
          >
            {cancelVerification.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="mr-1.5 h-4 w-4" />}
            Cancel
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium tabular-nums">{verificationJob.processed.toLocaleString()} of {verificationJob.total.toLocaleString()} checked</span>
            <span className="text-muted-foreground tabular-nums">{remaining.toLocaleString()} queued</span>
          </div>
          <Progress value={verificationJob.total > 0 ? (verificationJob.processed / verificationJob.total) * 100 : 0} />
          <p className="text-xs text-muted-foreground">
            {verificationOutcomeLabel(verificationJob.valid, "valid", verificationJob.processed)} · {verificationOutcomeLabel(verificationJob.invalid, "invalid", verificationJob.processed)} · {verificationOutcomeLabel(verificationJob.catch_all, "catch-all", verificationJob.processed)} · {verificationOutcomeLabel(verificationJob.unknown, "unknown", verificationJob.processed)}
          </p>
        </div>
      </Card>
    );
  }

  const updatedText = status.updatedAt
    ? formatDistanceToNow(new Date(status.updatedAt), { addSuffix: true })
    : null;
  const isParking = status.isPaused && status.processing > 0;
  const recoverableFailureCount = status.failedRetryable + status.failedOther;
  const needsAttention = !status.isActive && !status.isPaused && recoverableFailureCount > 0;

  // This list's workflow lookups: ran = calls that concluded with an answer
  // (found or not found — quota skips and provider errors excluded), so the
  // rate is a true hit rate. Finds from other enrichment paths (daily tick,
  // campaigns) have no logged misses and are counted only in the funnel's
  // "Email found" contact total.
  const lookupsRan = operations?.emailSearchesTotal ?? 0;
  const lookupsFound = operations?.emailFoundTotal ?? 0;
  const findRatePct = lookupsRan > 0
    ? Math.round((lookupsFound / lookupsRan) * 100)
    : null;
  const llmKeyBlocked = llmKeyStatus?.healthStatus === "blocked";

  // Provider-availability alerts (preserved workflow diagnostics).
  const hasUsableEmailProvider = providers.some((provider) => (
    provider.keyConfigured
    && provider.keyValid
    && (provider.dailyCap === null || provider.dailyRequests === null || provider.dailyRequests < provider.dailyCap)
  ));
  const waitingOnEmailProviders = status.hasWaitingEmailWork && providers.length > 0;
  const emailProvidersBlockedByKey = waitingOnEmailProviders
    && !hasUsableEmailProvider
    && providers.every((provider) => !provider.keyConfigured || !provider.keyValid);
  const emailProvidersBlockedByQuota = waitingOnEmailProviders
    && !hasUsableEmailProvider
    && providers.some((provider) => provider.keyConfigured && provider.keyValid)
    && providers.every((provider) => (
      !provider.keyConfigured
      || !provider.keyValid
      || (provider.dailyCap !== null && provider.dailyRequests !== null && provider.dailyRequests >= provider.dailyCap)
    ));
  const recoveryExhausted = status.failedTransientExhausted > 0;
  const hasWorkflowAlert = llmKeyBlocked || emailProvidersBlockedByKey || emailProvidersBlockedByQuota || recoveryExhausted;

  const tone = status.isActive
    ? { pill: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400", icon: Loader2, spin: true }
    : status.isPaused
      ? { pill: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400", icon: Pause, spin: false }
      : needsAttention
        ? { pill: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400", icon: AlertCircle, spin: false }
        : { pill: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400", icon: CheckCircle2, spin: false };
  const ToneIcon = tone.icon;

  const title = isParking
    ? "Pausing workflow"
    : status.isPaused
      ? "Workflow paused"
      : status.isActive
        ? "Full list workflow running"
        : needsAttention
          ? "Workflow stopped with errors"
          : "Full list workflow finished";
  const statusDetail = isParking
    ? `${status.processing.toLocaleString()} active contact${status.processing === 1 ? " is" : "s are"} finishing the current provider call`
    : status.isPaused
      ? "No new contacts will start until you resume"
      : status.activeStage
        // Contacts sit at different stages at the same time; the headline stage is
        // only the one with the most activity, so say so.
        ? (status.isActive ? `Busiest stage: ${status.activeStage}` : status.activeStage)
        : `${status.finished.toLocaleString()} contacts finished`;

  const handlePause = () => pause.mutate({ listId }, {
    onSuccess: () => toast.success("Workflow is pausing. Active provider calls will park when they return."),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not pause workflow"),
  });
  const handleResume = () => resume.mutate({ listId }, {
    onSuccess: ({ affected }) => toast.success(`Workflow resumed with ${affected.toLocaleString()} contact${affected === 1 ? "" : "s"} ready to continue.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not resume workflow"),
  });
  const handleCancel = () => cancelRun.mutate({ listId }, {
    onSuccess: ({ affected }) => toast.success(`Cancel requested for ${affected.toLocaleString()} active contact${affected === 1 ? "" : "s"}.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not cancel workflow"),
  });
  const handleReset = () => {
    if (status.processing > 0) {
      setResetAfterCancelListId(listId);
      cancelRun.mutate({ listId }, {
        onSuccess: () => toast.success("Active provider calls are stopping. The full reset will run automatically when they finish, then stay paused."),
        onError: (error) => {
          setResetAfterCancelListId(null);
          toast.error(error instanceof Error ? error.message : "Could not stop this workflow run for reset");
        },
      });
      return;
    }
    resetRun.mutate({ listId }, {
      onSuccess: ({ affected }) => toast.success(`Reset all ${affected.toLocaleString()} contact${affected === 1 ? "" : "s"}. Hit Resume when you're ready to start the new run.`),
      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not reset this workflow run"),
    });
  };
  const handleRestartCanceled = () => restartCanceled.mutate({ listId }, {
    onSuccess: ({ affected }) => {
      if (affected === 0) {
        toast.warning("No contacts are in the canceled state — they may have already been re-queued, or are waiting on the provider's daily quota window.");
      } else {
        toast.success(`Restarted ${affected.toLocaleString()} canceled contact${affected === 1 ? "" : "s"}.`);
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not restart canceled contacts"),
  });
  const handleRetryFailed = () => retryFailed.mutate({ listId }, {
    onSuccess: ({ affected }) => toast.success(`Restarted ${affected.toLocaleString()} failed contact${affected === 1 ? "" : "s"} from the first workflow stage.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not retry workflow errors"),
  });
  const handleRouteNoSourceData = () => routeNoSourceData.mutate({ listId }, {
    onSuccess: ({ affected }) => toast.success(`Routed ${affected.toLocaleString()} no-data contact${affected === 1 ? "" : "s"}.`),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not route no-data contacts"),
  });

  // Outcome buckets partition the run total; the segmented bar and its legend
  // replace the old KPI tile rail.
  const runSegments: RunSegment[] = [
    { key: "done", label: "done", value: status.completed, barClass: "bg-emerald-500", dotClass: "bg-emerald-500" },
    { key: "stopped", label: "stopped by rules", value: status.rejected, barClass: "bg-orange-400", dotClass: "bg-orange-400" },
    { key: "errors", label: "errors", value: status.failed, barClass: "bg-red-500", dotClass: "bg-red-500" },
    { key: "canceled", label: "canceled", value: status.canceled, barClass: "bg-muted-foreground/50", dotClass: "bg-muted-foreground/50" },
    { key: "working", label: "working now", value: status.processing, barClass: status.isActive ? "animate-pulse bg-blue-500" : "bg-blue-500", dotClass: "bg-blue-500" },
    { key: "waiting", label: "waiting their turn", value: status.pending + status.retrying, barClass: "", dotClass: "border border-border bg-muted" },
  ];

  // Where the waiting work actually sits, in this list's own stage order.
  // Same pending+retry definition as the legend's "waiting their turn", so
  // both numbers agree.
  const waitingBreakdown = (() => {
    const folded: Record<string, number> = {};
    for (const [stage, counts] of Object.entries(status.stageCounts ?? {})) {
      const key = stage === "replacement_email_found" ? "enrolling" : stage;
      folded[key] = (folded[key] ?? 0) + counts.waiting;
    }
    const ordered = [
      "queued",
      ...(operations?.stageOrder ?? ["icp", "find_email", "verify_email", "enroll"])
        .map((key) => FUNNEL_STAGES[key]?.activeStageKey)
        .filter((key): key is string => !!key),
    ];
    // AI message writing lives inside the enroll stage, just ahead of the
    // enrollment call, so show it there rather than trailing the list.
    const enrollIndex = ordered.indexOf("enrolling");
    if (enrollIndex >= 0) ordered.splice(enrollIndex, 0, "writing_message");
    const rest = Object.keys(folded).filter((key) => !ordered.includes(key));
    return [...ordered, ...rest]
      .filter((key) => (folded[key] ?? 0) > 0)
      .map((key) => ({ key, label: STAGE_NOUNS[key] ?? key, waiting: folded[key] }));
  })();

  const providersNeedAttention = providers.some((p) => providerState(p).attention);
  const providerSummary = (() => {
    const attn = providers.find((p) => providerState(p).attention);
    if (attn) return `${PROVIDER_LABELS[attn.provider] ?? attn.provider} · ${providerState(attn).label.toLowerCase()}`;
    return `${providers.length} in fallback order`;
  })();

  // Verification section data
  const verifRemaining = verificationJob ? Math.max(0, verificationJob.total - verificationJob.processed) : 0;
  const isKeyError = /disabled|invalid|rejected|expired|credit|key/i.test(verificationFailedJob?.error ?? "");

  return (
    <Card className="p-5" aria-live="polite">
      {/* Status header + run controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${tone.pill}`}>
            <ToneIcon className={`h-5 w-5 ${tone.spin ? "animate-spin" : ""}`} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{statusDetail}</p>
            {/* Live flow — totals plus an honest per-stage waiting breakdown,
                because contacts sit at several stages at once. */}
            {status.isActive && (
              <>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {status.processing.toLocaleString()} working now
                  {operations ? ` · ${operations.completedLastFiveMinutes.toLocaleString()} finished in the last 5 min` : ""}
                </p>
                {waitingBreakdown.length > 0 && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Waiting: {waitingBreakdown.map((s) => `${s.waiting.toLocaleString()} ${s.label}`).join(" · ")}
                  </p>
                )}
              </>
            )}
            {updatedText && <p className="mt-0.5 text-xs text-muted-foreground">Updated {updatedText}</p>}
          </div>
        </div>

        {(status.hasWork || status.isPaused || status.canceled > 0) && (
          <div className="flex flex-wrap items-center gap-2">
            {status.isPaused ? (
              <Button variant="cta" size="sm" onClick={handleResume} disabled={isParking || resume.isPending}>
                {resume.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
                {isParking ? "Pausing" : "Resume"}
              </Button>
            ) : status.hasWork ? (
              <Button variant="outline" size="sm" onClick={handlePause} disabled={pause.isPending}>
                {pause.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
                Pause
              </Button>
            ) : null}

            {status.hasWork && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={cancelRun.isPending}>
                    <CircleStop className="mr-1.5 h-4 w-4" />
                    Cancel run
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel this workflow run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Waiting and retrying contacts will be canceled. Active provider calls will stop when they return. A final enrollment already in progress cannot be recalled.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep running</AlertDialogCancel>
                    <AlertDialogAction onClick={handleCancel} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      Cancel run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {status.total > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resetRun.isPending || cancelRun.isPending || resetAfterCancelListId === listId}
                  >
                    {resetRun.isPending || resetAfterCancelListId === listId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                    {resetAfterCancelListId === listId ? "Stopping run" : "Reset run"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset this workflow run?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {status.processing > 0
                        ? `This will stop ${status.processing.toLocaleString()} active provider call${status.processing === 1 ? "" : "s"}, then queue a completely new run for all ${status.total.toLocaleString()} contacts.`
                        : `This queues a completely new run for all ${status.total.toLocaleString()} contacts, including contacts that already completed.`} Every lead runs through this list&apos;s configured stages again, and pipeline results plus this list&apos;s provider-call history reset to zero. The workflow stays paused afterward — hit Resume when you&apos;re ready to start it. Shared contact data and any enrollment already sent to a destination are not undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep current run</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {status.processing > 0 ? "Stop & reset run" : "Reset run"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {!status.hasWork && status.canceled > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="cta" size="sm" disabled={restartCanceled.isPending}>
                    {restartCanceled.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                    Restart canceled
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Restart {status.canceled.toLocaleString()} canceled contact{status.canceled === 1 ? "" : "s"}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Canceled contacts rerun every configured step. Steps whose work already happened are not repeated — a contact canceled after its email was found keeps that email and skips the search, so it can finish immediately without new provider lookups. Only contacts still missing an email trigger new searches.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep canceled</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRestartCanceled}>Restart canceled</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {recoverableFailureCount > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={retryFailed.isPending}>
                    {retryFailed.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                    Retry errors
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Retry recoverable workflow errors?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {status.failedRetryable.toLocaleString()} transient failure{status.failedRetryable === 1 ? "" : "s"} and {status.failedOther.toLocaleString()} other error{status.failedOther === 1 ? "" : "s"} restart from the first workflow stage. Contacts marked “No data to analyze” are not retried.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep marked outcomes</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRetryFailed}>Retry errors</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {status.failedNoData > 0 && onConfigure && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={routeNoSourceData.isPending}>
                    Route no-data contacts
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Route contacts with no source data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This sends {status.failedNoData.toLocaleString()} contacts to the dedicated No source data destination configured in Enrich &amp; enroll.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRouteNoSourceData}>Route contacts</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      {/* Run progress: one segmented bar whose buckets partition the run total.
          Replaces the old flat bar + five-tile KPI rail. */}
      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium tabular-nums">
            {status.finished.toLocaleString()} of {status.total.toLocaleString()} finished
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{status.progress}%</span>
        </div>
        <SegmentedRunProgress segments={runSegments} total={status.total} />
        {status.failedNoData > 0 && (
          <p className="text-xs text-muted-foreground">
            {status.failedNoData.toLocaleString()} of the errors had no source data to analyze — they are not retried automatically.
          </p>
        )}
        {/* Error-recovery filters live with the error counts they act on. */}
        {onShowFilter && (recoverableFailureCount > 0 || status.failedNoData > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-muted-foreground">Show in table:</span>
            <Button variant="outline" size="sm" className="h-7" onClick={() => onShowFilter("not_analyzed")}>Not analyzed</Button>
            {recoverableFailureCount > 0 && <Button variant="outline" size="sm" className="h-7" onClick={() => onShowFilter("failed")}>Failed</Button>}
            {status.failedNoData > 0 && <Button variant="outline" size="sm" className="h-7" onClick={() => onShowFilter("no_data")}>No data</Button>}
            {onDownloadRawJson && (
              <Button variant="ghost" size="sm" className="h-7" disabled={downloadingRawJson} onClick={onDownloadRawJson}>
                {downloadingRawJson ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileJson className="mr-1.5 h-3.5 w-3.5" />}
                Raw JSON
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Conversion funnel, built from THIS list's configured pipeline: one column
          per enabled stage, in the list's own stage_order. Progression stages use
          the workflow population; Email found uses completed provider lookups. */}
      {operations && (() => {
        const people = operations.totalPeople || status.total;
        const pctOf = (value: number) => (people > 0 ? Math.round((value / people) * 100) : 0);
        const stages = operations.stageOrder
          .map((key) => FUNNEL_STAGES[key])
          .filter((stage) => stage && stage.enabled(operations));
        const validPct = operations.verifiedEmails > 0
          ? Math.round((operations.validEmails / operations.verifiedEmails) * 100)
          : null;
        return (
          <div className="mt-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline results</h3>
              <span className="text-xs text-muted-foreground">% = share of the {people.toLocaleString()} people in this run</span>
            </div>
            <div className="mt-2 flex flex-wrap items-stretch gap-2">
              <PipelineStage
                label="People"
                value={people}
                icon={Users}
                active={status.isActive && status.activeStageKey === "queued"}
                pct={null}
                tooltip="Everyone included in this workflow run."
              />
              {stages.map((stage) => {
                const value = stage.cleared(operations);
                return (
                  <PipelineStage
                    key={stage.label}
                    label={stage.label}
                    value={value}
                    icon={stage.icon}
                    active={status.isActive && status.activeStageKey === stage.activeStageKey}
                    pct={stage.pct?.(operations) ?? pctOf(value)}
                    tooltip={stage.tooltip}
                  />
                );
              })}
            </div>
            {/* Email quality — scoped explicitly to this list's contacts, whatever
                tool checked them. Replaces the ambiguous "Emails valid" card. */}
            {operations.stageVerifyEmailEnabled && validPct !== null && (
              <p className="mt-2 text-xs text-muted-foreground">
                Email quality: of the {operations.verifiedEmails.toLocaleString()} emails checked so far in this list, {operations.validEmails.toLocaleString()} are valid ({validPct}%).
              </p>
            )}
            {/* Coverage splits the no-email population so "done" explains itself:
                a searched miss (provider answered "no email exists") is a final
                outcome, not a skipped contact — without this, a finished run
                that correctly made no new provider calls reads as a silent bug. */}
            {/* Reuse split: a run that made almost no new analyses is the skip
                working, not a stalled ICP stage — say so rather than leaving
                "Passed ICP" to be read as fresh research on every contact. */}
            {operations.stageIcpEnabled && (operations.analysisRan > 0 || operations.analysisReused > 0) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Company analysis: {operations.analysisRan.toLocaleString()} newly analyzed
                {operations.analysisReused > 0 && <> · {operations.analysisReused.toLocaleString()} reused a stored analysis — no re-crawl, no AI call</>}
              </p>
            )}
            {operations.stageFindEmailEnabled && (operations.noEmailSearched > 0 || operations.noEmailUnsearched > 0) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Email coverage: {operations.contactsWithEmail.toLocaleString()} have an email
                {operations.noEmailSearched > 0 && <> · {operations.noEmailSearched.toLocaleString()} searched — no email exists at the providers</>}
                {operations.noEmailUnsearched > 0 && <> · {operations.noEmailUnsearched.toLocaleString()} never searched (usually missing a personal LinkedIn profile URL)</>}
              </p>
            )}
          </div>
        );
      })()}

      {/* Workflow alerts (blocked keys / quota / exhausted retries) */}
      {hasWorkflowAlert && (
        <div className="mt-4 space-y-2" aria-live="assertive">
          {llmKeyBlocked && (
            <WorkflowAlert
              icon={KeyRound}
              title="ICP analysis is blocked by the OpenRouter key"
              description={llmKeyStatus?.healthMessage || "Contacts are held until the key limit is raised or the key is replaced."}
              action={<Button variant="outline" size="sm" asChild><a href="/settings?tab=integrations">Manage API keys</a></Button>}
            />
          )}
          {emailProvidersBlockedByKey && (
            <WorkflowAlert
              icon={KeyRound}
              title="Email enrichment is blocked by provider keys"
              description="Contacts are waiting for email enrichment, but none of this list's configured providers has a usable key."
              action={onConfigure ? <Button variant="outline" size="sm" onClick={onConfigure}>Manage providers</Button> : undefined}
            />
          )}
          {emailProvidersBlockedByQuota && (
            <WorkflowAlert
              icon={Gauge}
              tone="warning"
              title="Email enrichment is waiting for provider quota"
              description="Every usable provider in this list's fallback chain has reached its organization-wide daily cap. Work resumes when a quota resets, or when you add capacity."
              action={onConfigure ? <Button variant="outline" size="sm" onClick={onConfigure}>Manage providers</Button> : undefined}
            />
          )}
          {recoveryExhausted && (
            <WorkflowAlert
              icon={AlertCircle}
              title={`${status.failedTransientExhausted.toLocaleString()} contacts exhausted automatic retries`}
              description="These contacts failed with transient provider errors after three automatic recovery attempts. Review the provider error below, then retry them manually when the provider has recovered."
              action={<Button variant="outline" size="sm" onClick={handleRetryFailed} disabled={retryFailed.isPending}>{retryFailed.isPending ? "Retrying" : "Retry errors"}</Button>}
            />
          )}
        </div>
      )}

      {/* Verification failed alert (prominent, not collapsed) */}
      {verificationFailedJob && (
        <div className="mt-4">
          <WorkflowAlert
            icon={isKeyError ? KeyRound : AlertCircle}
            title={`Email verification failed${isKeyError ? " · Mailtester key disabled" : ""}`}
            description={verificationFailedJob.error ?? "The verification could not be completed. Please try again."}
            action={isKeyError ? (
              <Button asChild variant="cta" size="sm">
                <Link to="/settings?tab=integrations"><KeyRound className="mr-1.5 h-4 w-4" />Update key</Link>
              </Button>
            ) : undefined}
          />
        </div>
      )}

      {/* Email data providers (collapsible) */}
      {providers.length > 0 && (
        <Section
          title="Email data providers"
          summary={providerSummary}
          icon={Activity}
          defaultOpen={providersNeedAttention}
          action={
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">Fallback order</span>
              {onConfigure && (
                <Button variant="outline" size="sm" onClick={onConfigure}>
                  <Settings2 className="mr-1.5 h-4 w-4" />
                  Manage
                </Button>
              )}
            </div>
          }
        >
          {/* True hit rate for THIS list's workflow lookups — only calls that
              ran and answered count; quota skips and errors are excluded. */}
          {findRatePct !== null && (
            <p className="mb-3 text-xs text-muted-foreground">
              This list&apos;s lookups: <strong className="font-semibold text-foreground">{lookupsFound.toLocaleString()} found of {lookupsRan.toLocaleString()} that ran ({findRatePct}%)</strong> — skipped and failed calls not counted.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider, index) => (
              <ProviderActivity
                key={`${provider.chainPosition}-${provider.provider}`}
                provider={provider}
                isLast={index === providers.length - 1}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Email verification (collapsible) */}
      {verificationJob && (
        <Section
          title="Verification queue"
          summary={`${verificationJob.processed.toLocaleString()} checked in this run`}
          icon={MailCheck}
          defaultOpen
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => cancelVerification.mutate(verificationJob.id)}
              disabled={cancelVerification.isPending}
              className="shrink-0 text-muted-foreground"
            >
              {cancelVerification.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="mr-1.5 h-4 w-4" />}
              Cancel
            </Button>
          }
        >
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Downstream re-check of this run's emails — counts here are independent of the Email quality figure above.</span>
              {verificationJob.daily_limit_reached && (
                <span className="rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">Daily cap reached</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span><strong className="font-semibold tabular-nums">{verificationJob.processed.toLocaleString()}</strong> <span className="text-muted-foreground">checked</span></span>
              <span><strong className="font-semibold tabular-nums">{verifRemaining.toLocaleString()}</strong> <span className="text-muted-foreground">queued</span></span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span><span className="font-medium text-emerald-700 tabular-nums dark:text-emerald-400">{verificationJob.valid.toLocaleString()}</span> valid ({verificationJob.processed > 0 ? Math.round((verificationJob.valid / verificationJob.processed) * 100) : 0}%)</span>
              <span className="text-muted-foreground/40">·</span>
              <span><span className="font-medium text-red-700 tabular-nums dark:text-red-400">{verificationJob.invalid.toLocaleString()}</span> bad ({verificationJob.processed > 0 ? Math.round((verificationJob.invalid / verificationJob.processed) * 100) : 0}%)</span>
              {verificationJob.catch_all > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span><span className="font-medium tabular-nums">{verificationJob.catch_all.toLocaleString()}</span> catch-all ({verificationJob.processed > 0 ? Math.round((verificationJob.catch_all / verificationJob.processed) * 100) : 0}%)</span>
                </>
              )}
              {verificationJob.unknown > 0 && (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span><span className="font-medium tabular-nums">{verificationJob.unknown.toLocaleString()}</span> unknown ({verificationJob.processed > 0 ? Math.round((verificationJob.unknown / verificationJob.processed) * 100) : 0}%)</span>
                </>
              )}
            </div>
          </div>
        </Section>
      )}
    </Card>
  );
}
