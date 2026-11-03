import type { ElementType } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Info,
  MessageSquareReply,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EmailAggregatedStats } from "@/types/email";
import {
  bounceHealth,
  formatChange,
  formatCount,
  formatRate,
  relativeChange,
  share,
  type HealthTone,
} from "@/components/email/analytics/format";

export type OutcomeDrillDown = "sent" | "replied" | "positive" | "meetings" | "bounced" | "blocked" | "auto";

interface EmailOutcomeFunnelProps {
  stats?: EmailAggregatedStats;
  isLoading?: boolean;
  /** "previous 30 days"; null when the range has no comparison (All time). */
  comparisonLabel: string | null;
  onDrillDown: (kind: OutcomeDrillDown) => void;
}

interface Stage {
  key: OutcomeDrillDown;
  label: string;
  icon: ElementType;
  value: number;
  detail: React.ReactNode;
  change: number | null;
  /** The previous period's figure as displayed ("0.22%", "3,520"). */
  previous?: string;
  /** Volume changes are neither good nor bad, so they render neutral. */
  neutralChange?: boolean;
}

const TONE_STYLES: Record<HealthTone, { icon: ElementType; className: string }> = {
  good: { icon: CircleCheck, className: "text-[hsl(var(--status-success))]" },
  warning: { icon: TriangleAlert, className: "text-amber-600 dark:text-amber-400" },
  critical: { icon: CircleAlert, className: "text-[hsl(var(--status-error))]" },
};

/**
 * "↘ 21%  vs 0.22%": one short line. The period it compares against is named
 * once, in the footer strip, instead of on every tile. Naming the previous
 * figure keeps it clear that a rate tile compares rates, not the count above.
 */
function ChangeLabel({
  change,
  previous,
  neutral,
  comparisonLabel,
}: {
  change: number | null;
  previous?: string;
  neutral?: boolean;
  comparisonLabel: string | null;
}) {
  if (!comparisonLabel || change === null) {
    return <span className="text-xs">&nbsp;</span>;
  }
  const title = previous ? `${previous} in the ${comparisonLabel}` : `vs the ${comparisonLabel}`;
  if (change === 0) {
    return (
      <span className="text-xs text-muted-foreground" title={title}>
        Flat{previous ? ` vs ${previous}` : ""}
      </span>
    );
  }
  const up = change > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" title={title}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          neutral ? "text-foreground" : up ? "text-[hsl(var(--status-success))]" : "text-[hsl(var(--status-error))]",
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {formatChange(change)}
      </span>
      {previous && <>vs {previous}</>}
    </span>
  );
}

/** One figure in the deliverability strip: small label over a value; clickable when it has a list behind it. */
function StripStat({
  label,
  hint,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground">{children}</span>
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onClick ? (
          <button
            type="button"
            onClick={onClick}
            className="flex flex-col items-start gap-0.5 rounded-sm text-left transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {body}
          </button>
        ) : (
          <div className="flex flex-col items-start gap-0.5">{body}</div>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The page's headline, read as a funnel: emails sent, replies (rate per
 * delivered lead), positive replies (share of replies), meetings (share of
 * positive replies). Deliverability sits in a quieter strip underneath.
 */
export function EmailOutcomeFunnel({ stats, isLoading, comparisonLabel, onDrillDown }: EmailOutcomeFunnelProps) {
  if (isLoading || !stats) {
    return (
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-3 p-6">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-24" />
              <Skeleton className="h-4 w-36" />
            </div>
          ))}
        </div>
        <div className="border-t px-6 py-3">
          <Skeleton className="h-4 w-80" />
        </div>
      </Card>
    );
  }

  const positive = stats.positive ?? 0;
  const meetings = stats.meetings ?? 0;
  // Each step's previous-period rate uses that period's own base for the
  // step (replies / delivered, positive / replies, meetings / positive).
  const prevRate = (n: number | undefined, base: number | undefined) =>
    n === undefined || base === undefined || base <= 0 ? undefined : (n / base) * 100;
  const fmtPrevRate = (n: number | undefined, base: number | undefined) => {
    const rate = prevRate(n, base);
    return rate === undefined ? undefined : formatRate(rate);
  };

  const stages: Stage[] = [
    {
      key: "sent",
      label: "Emails sent",
      icon: Send,
      value: stats.sent,
      detail: (
        <>
          to <span className="font-medium text-foreground">{formatCount(stats.unique_leads)}</span> leads
        </>
      ),
      change: relativeChange(stats.sent, stats.prev_sent),
      previous: stats.prev_sent !== undefined ? formatCount(stats.prev_sent) : undefined,
      neutralChange: true,
    },
    {
      key: "replied",
      label: "Replies",
      icon: MessageSquareReply,
      value: stats.replied,
      detail: (
        <>
          <span className="font-medium text-foreground">{formatRate(stats.reply_rate)}</span> reply rate
        </>
      ),
      change: relativeChange(stats.reply_rate, prevRate(stats.prev_replied, stats.prev_delivered), stats.replied, stats.prev_replied),
      previous: fmtPrevRate(stats.prev_replied, stats.prev_delivered),
    },
    {
      key: "positive",
      label: "Positive replies",
      icon: Sparkles,
      value: positive,
      detail: (
        <>
          <span className="font-medium text-foreground">{formatRate(stats.positive_rate ?? 0)}</span> of replies
        </>
      ),
      change: relativeChange(stats.positive_rate ?? 0, prevRate(stats.prev_positive, stats.prev_replied), positive, stats.prev_positive),
      previous: fmtPrevRate(stats.prev_positive, stats.prev_replied),
    },
    {
      key: "meetings",
      label: "Meetings booked",
      icon: CalendarCheck,
      value: meetings,
      detail: (
        <>
          <span className="font-medium text-foreground">{formatRate(stats.meeting_rate ?? 0)}</span> of positive replies
        </>
      ),
      change: relativeChange(stats.meeting_rate ?? 0, prevRate(stats.prev_meetings, stats.prev_positive), meetings, stats.prev_meetings),
      previous: fmtPrevRate(stats.prev_meetings, stats.prev_positive),
    },
  ];

  const deliveredRate = share(stats.delivered, stats.unique_leads);
  const automatic = (stats.out_of_office ?? 0) + (stats.auto_replied ?? 0);
  const health = bounceHealth(stats.bounce_rate);
  const HealthIcon = TONE_STYLES[health.tone].icon;

  return (
    <TooltipProvider delayDuration={200}>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => onDrillDown(stage.key)}
                className={cn(
                  "group relative flex flex-col gap-1 p-5 text-left transition-colors sm:p-6",
                  "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
                  // Hairline dividers: between columns on desktop, between the 2x2 cells on mobile.
                  index > 0 && "lg:border-l",
                  index % 2 === 1 && "border-l",
                  index >= 2 && "border-t lg:border-t-0",
                )}
                aria-label={`${stage.label}: ${formatCount(stage.value)}. Show leads`}
              >
                {index > 0 && (
                  <span
                    aria-hidden
                    className="absolute -left-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border bg-card text-muted-foreground lg:flex"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Icon className="h-4 w-4" aria-hidden />
                  {stage.label}
                </span>
                <span className="mt-1 text-4xl font-semibold tracking-tight text-foreground">
                  {formatCount(stage.value)}
                </span>
                <span className="text-sm text-muted-foreground">{stage.detail}</span>
                <span className="mt-1">
                  <ChangeLabel
                    change={stage.change}
                    previous={stage.previous}
                    neutral={stage.neutralChange}
                    comparisonLabel={comparisonLabel}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t bg-muted/30 px-5 py-3.5 sm:px-6">
          <StripStat label="Delivered" hint="Share of leads emailed whose email didn't bounce or get blocked.">
            {formatRate(deliveredRate)}
          </StripStat>
          <StripStat
            label="Bounce rate"
            hint={`${formatCount(stats.bounced)} leads bounced. ${health.label}: under 2% is healthy, over 5% hurts deliverability. Click to see them.`}
            onClick={() => onDrillDown("bounced")}
          >
            {formatRate(stats.bounce_rate)}
            <HealthIcon className={cn("h-3.5 w-3.5", TONE_STYLES[health.tone].className)} aria-label={health.label} />
          </StripStat>
          {(stats.blocked ?? 0) > 0 && (
            <StripStat
              label="Blocked"
              hint="Refused by the receiving server because of our sender reputation. Not counted as bounces. Click to see them."
              onClick={() => onDrillDown("blocked")}
            >
              {formatCount(stats.blocked ?? 0)}
            </StripStat>
          )}
          {automatic > 0 && (
            <>
              <StripStat
                label="Out of office"
                hint="Out-of-office responses. Kept out of reply counts and rates. Click to see them."
                onClick={() => onDrillDown("auto")}
              >
                {formatCount(stats.out_of_office ?? 0)}
              </StripStat>
              <StripStat
                label="Auto-replies"
                hint="Other automatic responses. Kept out of reply counts and rates. Click to see them."
                onClick={() => onDrillDown("auto")}
              >
                {formatCount(stats.auto_replied ?? 0)}
              </StripStat>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-help items-center gap-1.5 text-xs text-muted-foreground sm:ml-auto">
                <Info className="h-3.5 w-3.5" aria-hidden />
                {comparisonLabel ? `Changes vs the ${comparisonLabel}` : "How rates work"}
              </span>
            </TooltipTrigger>
            <TooltipContent align="end" className="max-w-[280px] text-xs">
              Reply rate is per delivered lead. Positive is a share of replies, meetings a share of positive replies.
              Out-of-office and auto-replies never count as replies.
            </TooltipContent>
          </Tooltip>
        </div>
      </Card>
    </TooltipProvider>
  );
}
