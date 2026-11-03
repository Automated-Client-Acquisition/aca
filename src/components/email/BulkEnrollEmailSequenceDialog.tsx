import { useEffect, useRef, useState, useMemo } from "react";
import { Mail, Loader2, Search, Check, Clock, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useEmailSequences, type SequenceWithStats } from "@/hooks/useEmailSequences";
import { useBulkEnrollLeads } from "@/hooks/useEmailEnrollments";
import { describeEmailEnrollmentResult, type EmailEnrollmentResult } from "@/lib/email-enrollment-result";
import { useEmailEnrollmentPreview } from "@/hooks/useEmailEnrollmentPreview";
import { EmailEnrollmentFeedback } from "@/components/email/EmailEnrollmentFeedback";
import { BACKGROUND_ENROLL_THRESHOLD, useStartEmailEnrollmentJob } from "@/hooks/useEmailEnrollmentJobs";

const DELAY_OPTIONS = [
  { value: "0", label: "No extra delay" },
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "48", label: "2 days" },
  { value: "72", label: "3 days" },
  { value: "168", label: "1 week" },
  { value: "custom", label: "Custom..." },
];

interface BulkEnrollEmailSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  onComplete?: () => void;
  /**
   * "Select all matching" path: enroll every member of listId matching filters,
   * resolved server-side, instead of shipping contactIds. When set, totalCount
   * is used for the button label.
   */
  listId?: string;
  filters?: Record<string, unknown>;
  allMatching?: boolean;
  totalCount?: number;
}

export function BulkEnrollEmailSequenceDialog({
  open,
  onOpenChange,
  contactIds,
  onComplete,
  listId,
  filters,
  allMatching,
  totalCount,
}: BulkEnrollEmailSequenceDialogProps) {
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [delayPreset, setDelayPreset] = useState("0");
  const [customDelayHours, setCustomDelayHours] = useState("");
  const [result, setResult] = useState<EmailEnrollmentResult | null>(null);
  const requestVersion = useRef(0);
  const { data: sequences, isLoading: sequencesLoading } = useEmailSequences(open);
  const enrollMutation = useBulkEnrollLeads();
  const startJob = useStartEmailEnrollmentJob();

  const filteredSequences = useMemo(() => {
    if (!sequences) return [];
    const q = search.toLowerCase();
    return sequences.filter(
      (s) => !q || s.name.toLowerCase().includes(q)
    );
  }, [sequences, search]);

  const effectiveDelayHours = delayPreset === "custom"
    ? parseFloat(customDelayHours) || 0
    : parseInt(delayPreset, 10);

  const resetState = () => {
    setSelectedSequenceId(null);
    setSearch("");
    setDelayPreset("0");
    setCustomDelayHours("");
    setResult(null);
  };

  const useFilterPath = !!(allMatching && listId && filters);
  const enrollCount = useFilterPath ? (totalCount ?? 0) : contactIds.length;
  const audience = useFilterPath ? { listIds: [listId], filters } : { contactIds };
  const audienceKey = JSON.stringify(audience);
  // Big audiences ("select all matching" on a list, or a large hand-picked
  // selection) run as a background job and skip the dry run, which can't
  // finish inside the edge budget at that size.
  const background = enrollCount > BACKGROUND_ENROLL_THRESHOLD;
  const preview = useEmailEnrollmentPreview(selectedSequenceId, audience, open && !result && !background);
  const canEnroll = background
    ? !!selectedSequenceId
    : !!preview.data?.eligible && !preview.isFetching && !preview.isError;
  const pending = enrollMutation.isPending || startJob.isPending;
  const enrollLabel = background
    ? `Enroll ~${enrollCount.toLocaleString()} in background`
    : preview.data?.eligible
    ? `Enroll ${preview.data.eligible.toLocaleString()} contact${preview.data.eligible === 1 ? "" : "s"}`
    : preview.data ? "No contacts ready" : "Enroll contacts";

  useEffect(() => {
    requestVersion.current++;
    setResult(null);
    if (!open) {
      setSelectedSequenceId(null);
      setSearch("");
      setDelayPreset("0");
      setCustomDelayHours("");
    }
  }, [open, audienceKey]);

  const handleEnroll = async () => {
    if (!selectedSequenceId || !canEnroll || pending || result) return;
    const version = ++requestVersion.current;

    setResult(null);
    if (background) {
      try {
        await startJob.mutateAsync({
          sequence_id: selectedSequenceId,
          ...(useFilterPath ? { list_ids: [listId!], filters } : { contact_ids: contactIds }),
          ...(effectiveDelayHours > 0 ? { delay_hours: effectiveDelayHours } : {}),
        });
        if (version !== requestVersion.current) return;
        onComplete?.();
        onOpenChange(false);
        resetState();
      } catch {
        // The mutation reports the error; preserve the selection for retry.
      }
      return;
    }
    try {
      const outcome = await enrollMutation.mutateAsync({
        sequence_id: selectedSequenceId,
        ...(useFilterPath
          ? { list_id: listId, filters }
          : { lead_ids: contactIds }),
        ...(effectiveDelayHours > 0 ? { delay_hours: effectiveDelayHours } : {}),
      });

      if (version !== requestVersion.current) return;

      if (outcome.enrolled > 0) onComplete?.();
      if (outcome.enrolled === 0 || describeEmailEnrollmentResult(outcome).description) {
        setResult(outcome);
      } else {
        onOpenChange(false);
        resetState();
      }
    } catch {
      // The mutation reports the error; preserve the selection for retry.
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestVersion.current++;
      resetState();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-muted-foreground" />
            Enroll in Email Sequence
          </DialogTitle>
          <DialogDescription>
            Choose a sequence for {enrollCount.toLocaleString()} selected contact{enrollCount !== 1 ? "s" : ""}. We'll check who can enroll before you continue.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto space-y-4">
        {/* Sequence Picker */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search sequences..."
              className="pl-9 h-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[180px] border rounded-md">
            {sequencesLoading ? (
              <div className="flex items-center justify-center h-full p-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSequences.length === 0 ? (
              <div className="flex items-center justify-center h-full p-8">
                <p className="text-sm text-muted-foreground">
                  {search ? "No sequences match your search" : "No email sequences found"}
                </p>
              </div>
            ) : (
              <div className="p-1 space-y-0.5">
                {filteredSequences.map((seq) => (
                  <SequenceRow
                    key={seq.id}
                    sequence={seq}
                    isSelected={seq.id === selectedSequenceId}
                    disabled={pending}
                    onClick={() => {
                      if (enrollMutation.isPending) return;
                      setSelectedSequenceId(seq.id);
                      setResult(null);
                      enrollMutation.reset();
                    }}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Delay before first email */}
        {!result && <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Delay before first email
          </Label>
          <div className="flex items-center gap-2">
            <Select value={delayPreset} onValueChange={setDelayPreset} disabled={pending}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DELAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {delayPreset === "custom" && (
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Hours"
                  className="h-8 w-20 text-sm"
                  value={customDelayHours}
                  onChange={(e) => setCustomDelayHours(e.target.value)}
                  disabled={pending}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">hours</span>
              </div>
            )}
          </div>
          {effectiveDelayHours > 0 && (
            <p className="text-[11px] text-muted-foreground">
              First email waits at least {formatDelay(effectiveDelayHours)} and follows the sequence's send window.
            </p>
          )}
        </div>}

        {selectedSequenceId && background && (
          <div role="status" className="rounded-lg border bg-muted/20 p-4 flex items-start gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="block text-sm font-medium text-foreground mb-1">Large audience: about {enrollCount.toLocaleString()} contacts</span>
              Enrollment runs in the background. Each batch skips contacts that are already enrolled, active in another
              sequence, unsubscribed, or missing an email. Progress shows at the top of the sequence page.
            </p>
          </div>
        )}
        {selectedSequenceId && !background && <EmailEnrollmentFeedback
          preview={preview.data}
          result={result}
          loading={preview.isPending || preview.isFetching}
          error={preview.isError}
          onRetry={() => preview.refetch()}
          sequenceId={selectedSequenceId}
          listIds={useFilterPath ? [listId] : undefined}
        />}
        {startJob.isError && <p role="alert" className="text-sm text-destructive">Couldn't start the enrollment. Please retry. {startJob.error?.message}</p>}
        {enrollMutation.isError && !result && <p role="alert" className="text-sm text-destructive">Enrollment couldn't finish. Please retry. {enrollMutation.error?.message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {result ? "Done" : preview.data?.eligible === 0 ? "Close" : "Cancel"}
          </Button>
          {!result && <Button
            variant="cta"
            disabled={!canEnroll || pending || !!result || enrollCount === 0}
            onClick={handleEnroll}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {startJob.isPending ? "Starting..." : "Enrolling..."}
              </>
            ) : (
              selectedSequenceId && !background && (preview.isPending || preview.isFetching) ? "Checking…" : enrollLabel
            )}
          </Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDelay(hours: number): string {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remaining = hours % 24;
  if (remaining === 0) return `${days}d`;
  return `${days}d ${remaining}h`;
}

function SequenceRow({
  sequence,
  isSelected,
  onClick,
  disabled,
}: {
  sequence: SequenceWithStats;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const stepCount = sequence.steps?.length ?? 0;

  const statusDot = sequence.status === "active"
    ? "bg-green-500"
    : sequence.status === "paused"
    ? "bg-yellow-500"
    : "bg-gray-400";

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        isSelected
          ? "bg-accent"
          : "hover:bg-accent/50"
      )}
    >
      <div className={cn(
        "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
        isSelected
          ? "border-amber-500 bg-amber-500 text-white"
          : "border-muted-foreground/30"
      )}>
        {isSelected && <Check className="h-3 w-3" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm truncate", isSelected && "font-medium")}>{sequence.name}</span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className={cn("w-1.5 h-1.5 rounded-full", statusDot)} />
            <span className="text-[10px] text-muted-foreground capitalize">{sequence.status}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
          <span>{stepCount} step{stepCount !== 1 ? "s" : ""}</span>
          {sequence.enrollment_active > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{sequence.enrollment_active} active</span>
            </>
          )}
          {sequence.enrollment_total > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{sequence.enrollment_total} total</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
