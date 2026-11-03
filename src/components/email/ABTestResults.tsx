import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { BarChart3, Crown, RefreshCw, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AB_METRIC_LABELS,
  calculateABPerformance,
  type ABWinningMetric,
} from "@/lib/email-ab-performance";
import type { EmailABVariant } from "@/types/email";

interface ABTestResultsProps {
  variants: EmailABVariant[];
  onDeclareWinner?: (variantId: string) => Promise<unknown>;
  winningMetric: ABWinningMetric;
  sampleSize?: number;
  autoOptimize?: boolean;
  openTracking?: boolean;
  clickTracking?: boolean;
  isLoading?: boolean;
  isRefreshing?: boolean;
  error?: boolean;
  onRefresh?: () => void;
  className?: string;
}

const VARIANT_COLORS = [
  "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-300",
  "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:text-purple-300",
  "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300",
  "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300",
];

function formatRate(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function ABTestResults({
  variants,
  onDeclareWinner,
  winningMetric,
  sampleSize = 100,
  autoOptimize = false,
  openTracking = true,
  clickTracking = true,
  isLoading = false,
  isRefreshing = false,
  error = false,
  onRefresh,
  className,
}: ABTestResultsProps) {
  const { rows, totals, winner, leaderId, tied, sampleReached, sampleTarget } =
    calculateABPerformance(variants, winningMetric, sampleSize);
  const [winnerToSelect, setWinnerToSelect] = useState<EmailABVariant | null>(
    null,
  );
  const [selectingWinner, setSelectingWinner] = useState(false);
  const [winnerError, setWinnerError] = useState(false);
  const status = winner
    ? `Winner: ${winner.variant_label}`
    : totals.sent === 0
      ? "Awaiting sends"
      : sampleReached
        ? "Sample reached"
        : "Collecting data";

  return (
    <section
      aria-label="A/B performance"
      className={cn(
        "space-y-4 rounded-xl border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            A/B performance
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            All-time recorded results · comparing{" "}
            {AB_METRIC_LABELS[winningMetric].toLowerCase()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isLoading && !error && <Badge variant="outline">{status}</Badge>}
          {onRefresh && (
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh A/B stats"
              disabled={isRefreshing}
              onClick={onRefresh}
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-3.5 w-3.5",
                  isRefreshing && "animate-spin",
                )}
              />
              Refresh
            </Button>
          )}
        </div>
      </div>
      {isLoading ? (
        <div
          aria-label="Loading A/B stats"
          className="grid gap-3 sm:grid-cols-2"
        >
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          Couldn’t load A/B performance. Refresh to try again.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-muted/40 p-3">
            <Summary label="Sent" value={totals.sent} />
            <Summary label="Non-bounced" value={totals.delivered} />
            <Summary label="Replies" value={totals.replied} />
          </div>
          {totals.sent === 0 && (
            <p className="text-sm text-muted-foreground">
              No sends yet. Each variant’s performance will appear here as the
              test runs.
            </p>
          )}
          {tied && (
            <p className="text-xs text-muted-foreground">
              Variants are tied on{" "}
              {AB_METRIC_LABELS[winningMetric].toLowerCase()}. There is no sole
              leader yet.
            </p>
          )}
          {!winner && totals.sent > 0 && (
            <p className="text-xs text-muted-foreground">
              {autoOptimize
                ? `Automatic selection starts once every variant reaches ${sampleTarget.toLocaleString()} sends.`
                : `Sample target: ${sampleTarget.toLocaleString()} sends per variant. Winner selection is manual.`}{" "}
              A current leader is an observed result, not a confidence estimate.
            </p>
          )}
          <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
            {rows.map((variant, index) => (
              <Card
                key={variant.id}
                aria-label={`Performance for variant ${variant.variant_label}`}
                className={cn(
                  "min-w-0 rounded-lg shadow-none",
                  variant.is_winner && "border-amber-500/50 bg-amber-500/5",
                )}
              >
                <CardHeader className="p-4 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge
                        variant="outline"
                        className={
                          VARIANT_COLORS[index % VARIANT_COLORS.length]
                        }
                      >
                        Variant {variant.variant_label}
                      </Badge>
                      {variant.is_winner ? (
                        <Badge variant="outline" className="gap-1">
                          <Crown className="h-3 w-3 text-amber-600" />
                          Winner
                        </Badge>
                      ) : leaderId === variant.id ? (
                        <Badge
                          variant="outline"
                          className="text-emerald-700 dark:text-emerald-300"
                        >
                          Current leader
                        </Badge>
                      ) : null}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {variant.split_percentage}% configured split
                    </span>
                  </div>
                  <p className="break-words text-sm text-muted-foreground">
                    {variant.subject || "Inherited subject"}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4 p-4 pt-0">
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-4">
                    <Metric label="Sent" count={variant.sent} />
                    <Metric label="Non-bounced" count={variant.delivered} />
                    <Metric
                      label="Bounces"
                      count={variant.bounced}
                      rate={variant.bounce_rate}
                    />
                    <Metric
                      label="Opens"
                      count={variant.opened}
                      rate={variant.open_rate}
                      highlighted={winningMetric === "open_rate"}
                      trackingOff={!openTracking}
                    />
                    <Metric
                      label="Clicks"
                      count={variant.clicked}
                      rate={variant.click_rate}
                      highlighted={winningMetric === "click_rate"}
                      trackingOff={!clickTracking}
                    />
                    <Metric
                      label="Replies"
                      count={variant.replied}
                      rate={variant.reply_rate}
                      highlighted={winningMetric === "reply_rate"}
                    />
                  </dl>
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-muted-foreground">
                      <span>Sample progress</span>
                      <span className="tabular-nums">
                        {variant.sent.toLocaleString()} /{" "}
                        {sampleTarget.toLocaleString()} sends
                      </span>
                    </div>
                    <Progress
                      className="[&>div]:bg-emerald-500"
                      value={variant.sampleProgress}
                      aria-label={`Sample progress for variant ${variant.variant_label}`}
                    />
                  </div>
                  {onDeclareWinner && !winner && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={variant.sent === 0 || selectingWinner}
                      onClick={() => {
                        setWinnerError(false);
                        setWinnerToSelect(variant);
                      }}
                    >
                      <Trophy className="mr-2 h-3.5 w-3.5" />
                      Choose variant {variant.variant_label} as winner
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Open, click and reply rates use sent minus bounces; bounce rate uses
            sent. A dash means there is no denominator yet. Stats refresh every
            30 seconds while this sequence is open.
            {!openTracking &&
              " Open tracking is off; recorded opens may be incomplete."}
            {!clickTracking &&
              " Click tracking is off; recorded clicks may be incomplete."}
          </p>
        </>
      )}
      <AlertDialog
        open={!!winnerToSelect}
        onOpenChange={(open) => {
          if (!open && !selectingWinner) setWinnerToSelect(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Choose variant {winnerToSelect?.variant_label} as winner?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Future variant selection will use this version. Review its
              performance before choosing a winner.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {winnerError && (
            <p role="alert" className="text-sm text-destructive">
              Couldn’t select the winner. Try again.
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={selectingWinner}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="cta"
              disabled={selectingWinner}
              onClick={async () => {
                if (!winnerToSelect || !onDeclareWinner) return;
                setSelectingWinner(true);
                setWinnerError(false);
                try {
                  await onDeclareWinner(winnerToSelect.id);
                  setWinnerToSelect(null);
                } catch {
                  setWinnerError(true);
                } finally {
                  setSelectingWinner(false);
                }
              }}
            >
              {selectingWinner
                ? "Selecting…"
                : `Use variant ${winnerToSelect?.variant_label}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function Metric({
  label,
  count,
  rate,
  highlighted = false,
  trackingOff = false,
}: {
  label: string;
  count: number;
  rate?: number | null;
  highlighted?: boolean;
  trackingOff?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md",
        highlighted && "bg-emerald-500/5 ring-1 ring-emerald-500/20 p-2 -m-2",
      )}
    >
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">
        {count.toLocaleString()}
        {rate !== undefined && (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            · {formatRate(rate)}
          </span>
        )}
      </dd>
      {trackingOff && (
        <p className="mt-1 text-[10px] text-muted-foreground">Tracking off</p>
      )}
    </div>
  );
}
