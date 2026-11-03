import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useSequenceStepStats,
  useReplySentimentStats,
} from "@/hooks/useEmailStats";
import { useABVariants } from "@/hooks/useEmailABTests";
import { ReplySentimentCard } from "@/components/email/ReplySentimentCard";
import { ABTestResults } from "@/components/email/ABTestResults";
import { getStepABPerformanceVariants } from "@/lib/email-ab-performance";
import { cn } from "@/lib/utils";
import { BarChart3 } from "lucide-react";
import type { EmailSequenceSettings, EmailSequenceStep } from "@/types/email";

interface SequenceAnalyticsTabProps {
  sequenceId: string;
  steps?: EmailSequenceStep[];
  settings?: EmailSequenceSettings;
}

export function SequenceAnalyticsTab({
  sequenceId,
  steps,
  settings,
}: SequenceAnalyticsTabProps) {
  const { data: stepStats, isLoading: stepsLoading } =
    useSequenceStepStats(sequenceId);
  const { data: sentimentStats, isLoading: sentimentLoading } =
    useReplySentimentStats("all", { sequenceId });
  const {
    data: variants,
    isLoading: variantsLoading,
    isFetching: variantsRefreshing,
    isError: variantsError,
    refetch: refreshVariants,
  } = useABVariants(sequenceId);

  const hasABTests = steps?.some((s) => s.type === "ab_test");

  if (stepsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Per-Step Funnel Table */}
      <StepFunnelTable stepStats={stepStats || []} />

      {/* Reply Sentiment for this sequence */}
      <ReplySentimentCard
        stats={sentimentStats}
        isLoading={sentimentLoading}
        hideWhenEmpty
      />

      {/* A/B Variant Comparison */}
      {hasABTests && (
        <div className="space-y-4" aria-label="Sequence A/B tests">
          {steps
            ?.filter((step) => step.type === "ab_test")
            .map((step) => (
              <div key={step.order} className="space-y-2">
                <h3 className="text-sm font-semibold">
                  Step {step.order + 1} · A/B test
                </h3>
                <ABTestResults
                  variants={getStepABPerformanceVariants(
                    step,
                    variants || [],
                    sequenceId,
                  )}
                  winningMetric={settings?.ab_winning_metric || "reply_rate"}
                  sampleSize={settings?.ab_sample_size || 100}
                  autoOptimize={settings?.auto_optimize_ab}
                  openTracking={settings?.open_tracking}
                  clickTracking={settings?.click_tracking}
                  isLoading={variantsLoading}
                  isRefreshing={variantsRefreshing}
                  error={variantsError}
                  onRefresh={() => {
                    void refreshVariants();
                  }}
                />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Per-Step Funnel Table
// ============================================================================

function StepFunnelTable({
  stepStats,
}: {
  stepStats: Array<{
    step: number;
    subject: string;
    sent: number;
    unique_leads: number;
    delivered: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
    open_rate: number;
    click_rate: number;
    reply_rate: number;
  }>;
}) {
  if (stepStats.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No step data yet</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Analytics will appear here once emails have been sent from this
            sequence.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Per-Step Performance
        </CardTitle>
        <CardDescription>
          Engagement funnel across each email step
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Step</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="w-[70px] text-right">Sent</TableHead>
              <TableHead className="w-[80px] text-right">Delivered</TableHead>
              <TableHead className="w-[70px] text-right">Opened</TableHead>
              <TableHead className="w-[70px] text-right">Clicked</TableHead>
              <TableHead className="w-[70px] text-right">Replied</TableHead>
              <TableHead className="w-[90px] text-right">Open %</TableHead>
              <TableHead className="w-[90px] text-right">Reply %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stepStats.map((row) => (
              <TableRow key={row.step}>
                <TableCell>
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary font-semibold text-xs">
                    {row.step + 1}
                  </div>
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm">
                  {row.subject}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.sent}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.delivered}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.opened}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.clicked}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {row.replied}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <RateCell value={row.open_rate} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  <RateCell value={row.reply_rate} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RateCell({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "font-medium",
        value >= 30
          ? "text-green-600"
          : value >= 10
            ? "text-amber-600"
            : "text-muted-foreground",
      )}
    >
      {value.toFixed(1)}%
    </span>
  );
}
