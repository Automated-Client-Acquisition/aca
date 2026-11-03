import { Database, Filter, Pause, Play, Settings2, Workflow } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type FunnelCounts = {
  matching: number;
  hasEmail?: number;
  verified?: number;
  enrolled?: number;
  inWorkflow?: number;
};

type ProcessingSummary = {
  hasPolicy: boolean;
  enabled: boolean;
  isPaused?: boolean;
  destinationLabel?: string | null;
  destinationHref?: string | null;
  total?: number;
  completed?: number;
  processing?: number;
  pending?: number;
  retrying?: number;
  rejected?: number;
} | null;

/** Segment membership and processing are separate populations, not a send funnel. */
export function SmartSegmentFunnel({
  counts,
  processing,
  isSmart,
  onSetupOutreach,
  onEditFilters,
  onPause,
  onResume,
  pausing,
  resuming,
}: {
  counts: FunnelCounts;
  processing: ProcessingSummary;
  isSmart: boolean;
  onSetupOutreach: () => void;
  onEditFilters?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  pausing?: boolean;
  resuming?: boolean;
}) {
  const hasWorkflow = !!processing?.hasPolicy;
  const waiting = counts.inWorkflow ?? (
    processing?.pending !== undefined
      ? processing.pending + (processing.processing ?? 0) + (processing.retrying ?? 0)
      : undefined
  );
  const status = processing?.isPaused ? "Paused" : processing?.enabled ? "Auto run on" : "Auto run off";

  return (
    <Card className="overflow-hidden rounded-xl shadow-none">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm font-semibold">Audience overview</span>
            <Badge variant="outline" className="text-[11px]">{isSmart ? "Smart segment · live rules" : "List · added contacts"}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {processing?.isPaused && onResume && <Button variant="outline" size="sm" onClick={onResume} disabled={resuming}><Play className="mr-1.5 h-3.5 w-3.5" />{resuming ? "Resuming…" : "Resume processing"}</Button>}
            {hasWorkflow && !processing?.isPaused && processing?.enabled && onPause && <Button variant="outline" size="sm" onClick={onPause} disabled={pausing}><Pause className="mr-1.5 h-3.5 w-3.5" />{pausing ? "Pausing…" : "Pause processing"}</Button>}
            {onEditFilters && <Button variant="outline" size="sm" onClick={onEditFilters}><Filter className="mr-1.5 h-3.5 w-3.5" />Edit rules</Button>}
            <Button variant={hasWorkflow ? "outline" : "cta"} size="sm" onClick={onSetupOutreach}><Settings2 className="mr-1.5 h-3.5 w-3.5" />{hasWorkflow ? "Manage processing" : "Set up processing"}</Button>
          </div>
        </div>
        <div className={hasWorkflow ? "grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0" : "grid gap-4 sm:grid-cols-[1fr_2fr]"}>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">{isSmart ? "Matching members" : "List members"}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{counts.matching.toLocaleString()}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{isSmart ? "Matches the saved rules right now." : "Contacts currently in this list."}</p>
          </div>
          {hasWorkflow ? <>
            <div className="p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Workflow className="h-3.5 w-3.5" />Waiting or processing</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{waiting?.toLocaleString() ?? "—"}</p>
              <Badge variant="outline" className="mt-1 text-[11px]">{status}</Badge>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Completed processing</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{processing?.completed?.toLocaleString() ?? "—"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{processing?.rejected ? `${processing.rejected.toLocaleString()} rejected by processing rules` : "Workflow totals; enrollment is tracked at the destination."}</p>
            </div>
          </> : <div className="flex flex-col justify-center p-4">
            <p className="text-sm font-medium">Membership and outreach are separate</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Matching these rules adds a contact to this audience. Connect a campaign or email sequence to use the audience, or set up processing to qualify and enrich members first.</p>
          </div>}
        </div>
        {hasWorkflow && <div className="flex items-start gap-2 border-t bg-muted/20 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {processing?.isPaused
              ? <p>Processing is paused. Queued members wait until you resume; segment membership continues to update.</p>
              : !processing?.enabled
                ? <p>Automatic processing is off. Manage the workflow to process new members.</p>
                : <p>New members follow the processing rules. Workflow totals can include members who no longer match this segment.</p>}
            {processing?.destinationLabel && <p className="mt-1">Approved members route to {processing.destinationHref ? <Link to={processing.destinationHref} className="font-medium text-foreground underline underline-offset-2">{processing.destinationLabel}</Link> : <span className="font-medium text-foreground">{processing.destinationLabel}</span>} using this source’s processing settings.</p>}
          </div>
        </div>}
      </CardContent>
    </Card>
  );
}
