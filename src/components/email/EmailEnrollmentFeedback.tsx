import { AlertCircle, ArrowUpRight, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  describeEmailEnrollmentResult,
  getEmailEnrollmentReasons,
  type EmailEnrollmentPreview,
  type EmailEnrollmentResult,
} from "@/lib/email-enrollment-result";

interface EmailEnrollmentFeedbackProps {
  preview?: EmailEnrollmentPreview;
  result?: EmailEnrollmentResult | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  sequenceId?: string | null;
  listIds?: string[];
}

export function EmailEnrollmentFeedback({ preview, result, loading, error, onRetry, sequenceId, listIds }: EmailEnrollmentFeedbackProps) {
  if (!result && loading) {
    return (
      <div role="status" className="flex items-center gap-2 rounded-lg border bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        Checking who can enroll…
      </div>
    );
  }
  if (!result && error) {
    return (
      <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="text-sm font-medium">Couldn't check eligibility</p>
            <p className="text-xs text-muted-foreground mt-1">Retry the check before enrolling these contacts.</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry check</Button>
      </div>
    );
  }
  const data = result ?? preview;
  if (!data) return null;

  const ready = result ? result.enrolled : preview!.eligible;
  const reasons = getEmailEnrollmentReasons(data);
  const blocked = ready === 0;
  const Icon = blocked ? AlertCircle : CheckCircle2;
  const title = result
    ? describeEmailEnrollmentResult(result).title
    : preview!.totalContacts === 0 ? "No matching contacts" : blocked ? "No contacts ready to enroll" : "Ready to enroll";
  const conflicts = preview?.conflictingSequences ?? [];
  const reviewListHref = listIds?.length === 1 ? `/leads/lists/${listIds[0]}` : undefined;

  return (
    <div role="status" aria-live="polite" className="rounded-lg border overflow-hidden">
      <div className={cn("px-4 py-3 flex items-center gap-2", blocked ? "bg-amber-500/5" : "bg-emerald-500/5")}>
        <Icon className={cn("h-4 w-4 shrink-0", blocked ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")} />
        <p className="text-sm font-medium">{title}</p>
      </div>
      {!result && preview && (
        <dl className="grid grid-cols-3 gap-2 border-t px-4 py-3 text-center">
          {[
            { label: "Contacts", value: preview.totalContacts },
            { label: "Ready", value: preview.eligible },
            { label: "Skipped", value: preview.totalContacts - preview.eligible },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{value.toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      )}
      {reasons.length > 0 && (
        <div className="border-t divide-y">
          {reasons.map((reason) => {
            const href = reason.key === "filteredOut" && sequenceId
              ? `/email/sequences/${sequenceId}`
              : ["noEmail", "awaitingPipeline", "missingContent"].includes(reason.key) ? reviewListHref : undefined;
            return (
              <div key={reason.key} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{reason.label}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{reason.detail}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{reason.count.toLocaleString()}</span>
                </div>
                {reason.key === "alreadyInAnotherSequence" && conflicts.length > 0 && (
                  <div className="space-y-1">
                    {conflicts.map((sequence) => (
                      <a key={sequence.id} href={`/email/sequences/${sequence.id}`} target="_blank" rel="noopener noreferrer"
                        aria-label={`Review ${sequence.name} (${sequence.count.toLocaleString()} contacts, opens in a new tab)`}
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0 truncate font-medium">{sequence.name}</span>
                        <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                          {sequence.count.toLocaleString()} contacts<ArrowUpRight className="h-3.5 w-3.5" />
                        </span>
                      </a>
                    ))}
                    {conflicts.length > 1 && <p className="text-xs text-muted-foreground">A contact can appear in more than one sequence.</p>}
                  </div>
                )}
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4">{reason.key === "filteredOut" ? "Review enrollment filter" : "Review list"}<ArrowUpRight className="h-3 w-3" /></a>}
              </div>
            );
          })}
        </div>
      )}
      {!result && preview?.totalContacts === 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">This selection contains no matching contacts. Choose another list or adjust its filters.</p>}
      {!result && ready > 0 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Only ready contacts will be enrolled. Sending follows the sequence's schedule.</p>}
    </div>
  );
}
