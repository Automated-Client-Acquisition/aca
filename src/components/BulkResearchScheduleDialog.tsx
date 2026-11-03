import { useState } from "react";
import { Loader2, CalendarClock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ResearchScheduleFields } from "@/components/ResearchScheduleFields";
import { defaultResearchSchedule } from "@/lib/research-schedule";
import { useApplyResearchSchedules, type BulkScheduleTarget } from "@/hooks/useApplyResearchSchedules";

interface Props {
  type: "creator" | "search_term";
  targets: BulkScheduleTarget[];
  onClose: () => void;
  onApplied: (ids: string[]) => void;
}

export function BulkResearchScheduleDialog({ type, targets, onClose, onApplied }: Props) {
  const [schedule, setSchedule] = useState({ ...defaultResearchSchedule, enabled: true });
  const [progress, setProgress] = useState({ completed: 0, total: targets.length });
  const [successfulIds, setSuccessfulIds] = useState<string[]>([]);
  const apply = useApplyResearchSchedules();
  const noun = type === "creator" ? "creator" : "search term";
  const failures = apply.data?.failures;
  const remaining = targets.filter((target) => !successfulIds.includes(target.id));
  const finished = successfulIds.length === targets.length;

  const submit = async () => {
    try {
      const result = await apply.mutateAsync({ type, targets: remaining, schedule, onProgress: (completed, total) => setProgress({ completed, total }) });
      const appliedIds = [...result.createdIds, ...result.updatedIds];
      setSuccessfulIds((previous) => [...new Set([...previous, ...appliedIds])]);
      onApplied(appliedIds);
    } catch {
      // The mutation exposes a readable error and keeps every unprocessed source available for retry.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !apply.isPending) onClose(); }}>
      <DialogContent className="max-w-xl w-[calc(100%-2rem)] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" /> Apply scraping schedule</DialogTitle>
          <DialogDescription>{targets.length} selected {noun}{targets.length === 1 ? "" : "s"}, including selections from other pages and filters.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-4">
          <div className="rounded-lg border px-3 py-2 text-sm break-words">
            {targets.slice(0, 5).map((target) => target.name).join(", ")}
            {targets.length > 5 && ` and ${targets.length - 5} more`}
          </div>
          <ResearchScheduleFields value={schedule} onChange={setSchedule} alwaysEnabled disabled={apply.isPending || successfulIds.length > 0} />
          <p className="text-sm text-muted-foreground">Schedules with this frequency will be updated and resumed. Other frequencies stay as configured. Sources without this frequency get a new schedule.</p>
          {apply.isPending && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Applying schedules: {progress.completed} of {progress.total}</p>}
          {!apply.isPending && successfulIds.length > 0 && <p role="status" className="text-sm font-medium">Schedule applied to {successfulIds.length} of {targets.length} {noun}{targets.length === 1 ? "" : "s"}.</p>}
          {apply.error && <p role="alert" className="text-sm text-destructive">{apply.error.message}</p>}
          {!apply.isPending && failures && failures.length > 0 && (
            <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm">
              <p className="font-medium text-destructive">{failures.length} {noun}{failures.length === 1 ? "" : "s"} could not be scheduled. Retry applies only to these sources.</p>
              <ul className="mt-2 max-h-40 overflow-y-auto space-y-1">
                {failures.map((failure) => <li key={failure.id} className="break-words"><span className="font-medium">{failure.name}:</span> {failure.message}</li>)}
              </ul>
            </div>
          )}
          <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 bg-background py-3">
            <Button type="button" variant="outline" disabled={apply.isPending} onClick={onClose}>{finished ? "Done" : successfulIds.length > 0 ? "Close" : "Cancel"}</Button>
            {!finished && <Button type="submit" variant="cta" disabled={apply.isPending || remaining.length === 0}>
              {apply.isPending ? "Applying..." : apply.data || apply.error ? `Retry ${remaining.length} ${apply.data ? "failed" : "sources"}` : `Apply to ${targets.length} ${noun}${targets.length === 1 ? "" : "s"}`}
            </Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
