import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { getEmailEnrollmentReasons } from "@/lib/email-enrollment-result";
import {
  isActiveEnrollmentJob,
  useCancelEmailEnrollmentJob,
  useLatestEmailEnrollmentJob,
} from "@/hooks/useEmailEnrollmentJobs";

/** Finished jobs stay visible for a day so the outcome isn't missed. */
const RECENT_MS = 24 * 60 * 60 * 1000;

const dismissKey = (jobId: string) => `enrollment-job-dismissed:${jobId}`;
const readDismissed = (jobId: string) => {
  try { return localStorage.getItem(dismissKey(jobId)) === "1"; } catch { return false; }
};

export function EnrollmentJobBanner({ sequenceId }: { sequenceId: string | undefined }) {
  const { data: job } = useLatestEmailEnrollmentJob(sequenceId);
  const cancel = useCancelEmailEnrollmentJob();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  if (!job || !sequenceId) return null;
  const active = isActiveEnrollmentJob(job);
  if (!active) {
    const finishedAt = new Date(job.completed_at ?? job.created_at).getTime();
    if (Date.now() - finishedAt > RECENT_MS || dismissedId === job.id || readDismissed(job.id)) return null;
  }

  const dismiss = () => {
    try { localStorage.setItem(dismissKey(job.id), "1"); } catch { /* per-viewer convenience only */ }
    setDismissedId(job.id);
  };

  const { enrolled } = job.results;
  const pct = job.total > 0 ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const reasons = getEmailEnrollmentReasons(job.results);
  const failed = job.status === "failed";

  const title = job.status === "pending" || job.status === "snapshotting"
    ? "Preparing audience…"
    : job.status === "running"
      ? "Enrolling audience…"
      : job.status === "completed"
        ? `Enrollment finished: ${enrolled.toLocaleString()} contact${enrolled === 1 ? "" : "s"} enrolled`
        : job.status === "cancelled"
          ? `Enrollment stopped: ${enrolled.toLocaleString()} enrolled before it stopped`
          : "Enrollment couldn't finish";

  const detail = job.status === "pending" || job.status === "snapshotting"
    ? `${job.total.toLocaleString()} contacts found so far`
    : `${job.processed.toLocaleString()} of ${job.total.toLocaleString()} checked · ${enrolled.toLocaleString()} enrolled`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-lg border px-4 py-3 space-y-2",
        failed ? "border-amber-500/30 bg-amber-500/5" : active ? "bg-muted/30" : "bg-emerald-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        {active
          ? <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin text-muted-foreground" />
          : failed
            ? <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">{detail}</p>
          {active && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Runs in the background. You can leave this page.
              {job.attempts > 0 && " Retrying a batch that failed…"}
            </p>
          )}
          {failed && job.error_message && (
            <p className="text-xs text-muted-foreground mt-1 break-words">{job.error_message}</p>
          )}
        </div>
        {active ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancel.mutate({ jobId: job.id, sequenceId })}
            disabled={cancel.isPending}
          >
            Stop
          </Button>
        ) : (
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {job.status === "running" && <Progress value={pct} className="h-1.5" aria-label={`${pct}% checked`} />}
      {reasons.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 pl-7 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason.key}>
              {reason.label}: <span className="tabular-nums font-medium text-foreground">{reason.count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
