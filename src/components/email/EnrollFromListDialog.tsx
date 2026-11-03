import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLeadLists } from "@/hooks/useLeadLists";
import {
  useBulkEnrollLeads,
} from "@/hooks/useEmailEnrollments";
import { Info, Loader2, Users, X } from "lucide-react";
import { describeEmailEnrollmentResult, type EmailEnrollmentResult } from "@/lib/email-enrollment-result";
import { useEmailEnrollmentPreview } from "@/hooks/useEmailEnrollmentPreview";
import { EmailEnrollmentFeedback } from "@/components/email/EmailEnrollmentFeedback";
import { BACKGROUND_ENROLL_THRESHOLD, useStartEmailEnrollmentJob } from "@/hooks/useEmailEnrollmentJobs";

interface EnrollFromListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequenceId: string;
  initialListIds?: string[];
}

export function EnrollFromListDialog({
  open,
  onOpenChange,
  sequenceId,
  initialListIds,
}: EnrollFromListDialogProps) {
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [result, setResult] = useState<EmailEnrollmentResult | null>(null);
  const requestVersion = useRef(0);

  const { leadLists, isLoading: listsLoading } = useLeadLists(open);
  const bulkEnroll = useBulkEnrollLeads();
  const startJob = useStartEmailEnrollmentJob();

  useEffect(() => {
    requestVersion.current++;
    setResult(null);
    setSelectedListIds(open ? [...(initialListIds ?? [])] : []);
  }, [open, sequenceId, initialListIds]);

  const activeLists = leadLists.filter((l) => l.status === "active");
  const selectedLists = activeLists.filter((l) => selectedListIds.includes(l.id));
  const availableLists = activeLists.filter((l) => !selectedListIds.includes(l.id));
  // Big audiences skip the dry run (a 190k preview outlives the edge budget)
  // and enroll as a background job; eligibility is checked batch by batch.
  const audienceSize = selectedLists.reduce((sum, l) => sum + (l.lead_count || 0), 0);
  const background = audienceSize > BACKGROUND_ENROLL_THRESHOLD;
  const preview = useEmailEnrollmentPreview(sequenceId, { listIds: selectedListIds }, open && !result && !background);
  const canEnroll = background
    ? selectedListIds.length > 0
    : !!preview.data?.eligible && !preview.isFetching && !preview.isError;
  const pending = bulkEnroll.isPending || startJob.isPending;
  const enrollLabel = background
    ? `Enroll ~${audienceSize.toLocaleString()} in background`
    : preview.data?.eligible
    ? `Enroll ${preview.data.eligible.toLocaleString()} contact${preview.data.eligible === 1 ? "" : "s"}`
    : preview.data ? "No contacts ready" : "Enroll contacts";

  const addList = (listId: string) => {
    if (!listId || selectedListIds.includes(listId)) return;
    setResult(null);
    bulkEnroll.reset();
    startJob.reset();
    setSelectedListIds((prev) => [...prev, listId]);
  };
  const removeList = (listId: string) => {
    setResult(null);
    bulkEnroll.reset();
    startJob.reset();
    setSelectedListIds((prev) => prev.filter((id) => id !== listId));
  };

  const handleEnroll = async () => {
    if (!canEnroll || pending || result) return;
    const version = ++requestVersion.current;
    setResult(null);
    if (background) {
      try {
        await startJob.mutateAsync({ sequence_id: sequenceId, list_ids: selectedListIds });
        if (version === requestVersion.current) handleOpenChange(false);
      } catch {
        // The mutation shows the error; keep the selection for retry.
      }
      return;
    }
    try {
      const outcome = await bulkEnroll.mutateAsync({ sequence_id: sequenceId, list_ids: selectedListIds });
      if (version !== requestVersion.current) return;
      setResult(outcome);
      if (outcome.enrolled > 0 && !describeEmailEnrollmentResult(outcome).description) {
        handleOpenChange(false);
      }
    } catch {
      // The mutation shows the server error; keep the selected lists for retry.
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestVersion.current++;
      setSelectedListIds([]);
      setResult(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            Review audience enrollment
          </DialogTitle>
          <DialogDescription>
            Review matching people from your lists and smart segments. Eligibility is checked before enrollment.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto space-y-4 py-2">
          {selectedLists.length > 0 && (
            <div className="flex flex-col gap-1">
              {selectedLists.map((list) => (
                <div
                  key={list.id}
                  className="flex w-full items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" title={list.name}>
                    {list.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {list.lead_count.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeList(list.id)}
                    disabled={pending}
                    className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-background hover:text-destructive"
                    aria-label={`Remove ${list.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Select value="" onValueChange={addList} disabled={pending}>
            <SelectTrigger>
              <SelectValue placeholder={listsLoading ? "Loading lists..." : (selectedLists.length > 0 ? "Add another list..." : "Select a lead list")} />
            </SelectTrigger>
            <SelectContent>
              {availableLists.map((list) => (
                <SelectItem key={list.id} value={list.id}>
                  <span className="flex items-center gap-2">
                    {list.name}
                    <span className="text-muted-foreground text-xs">
                      ({list.lead_count} contacts)
                    </span>
                  </span>
                </SelectItem>
              ))}
              {availableLists.length === 0 && !listsLoading && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  {activeLists.length === 0 ? "No lead lists found" : "All lists added"}
                </div>
              )}
            </SelectContent>
          </Select>

          {selectedListIds.length > 0 && background && (
            <div role="status" className="rounded-lg border bg-muted/20 p-4 flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Large audience: about {audienceSize.toLocaleString()} contacts</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Enrollment runs in the background in batches of {BACKGROUND_ENROLL_THRESHOLD.toLocaleString()}. Each batch skips
                  contacts that are already enrolled, active in another sequence, unsubscribed, or missing an email.
                  Progress and the final breakdown show at the top of the sequence page. You can close this window.
                </p>
              </div>
            </div>
          )}
          {selectedListIds.length > 0 && !background && <EmailEnrollmentFeedback
            preview={preview.data}
            result={result}
            loading={preview.isPending || preview.isFetching}
            error={preview.isError}
            onRetry={() => preview.refetch()}
            sequenceId={sequenceId}
            listIds={selectedListIds}
          />}
          {!selectedListIds.length && <p className="text-xs text-muted-foreground">Already enrolled contacts and contacts active in another sequence are kept in their current sequence.</p>}
          {startJob.isError && <p role="alert" className="text-sm text-destructive">Couldn't start the enrollment. Please retry. {startJob.error?.message}</p>}
          {bulkEnroll.isError && !result && <p role="alert" className="text-sm text-destructive">Enrollment couldn't finish. Please retry. {bulkEnroll.error?.message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? "Done" : preview.data?.eligible === 0 ? "Close" : "Cancel"}
          </Button>
          {!result && <Button
            variant="cta"
            onClick={handleEnroll}
            disabled={!canEnroll || pending || !!result}
          >
            {startJob.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting…</> : bulkEnroll.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enrolling…</> : selectedListIds.length > 0 && !background && (preview.isPending || preview.isFetching) ? "Checking…" : enrollLabel}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
