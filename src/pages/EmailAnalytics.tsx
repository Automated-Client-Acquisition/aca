import { useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";
import {
  BarChart3,
  CalendarIcon,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Mail,
  RefreshCw,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilteredLeadsCard } from "@/components/email/FilteredLeadsCard";
import { ReplySentimentCard } from "@/components/email/ReplySentimentCard";
import { MailboxHealthBadge } from "@/components/email/MailboxHealthBadge";
import { EmailOutcomeFunnel, type OutcomeDrillDown } from "@/components/email/analytics/EmailOutcomeFunnel";
import { CampaignLeaderboard } from "@/components/email/analytics/CampaignLeaderboard";
import { bestCampaign } from "@/components/email/analytics/ranking";
import { EmailTrendCharts } from "@/components/email/analytics/EmailTrendCharts";
import { EmailAnalyticsDrillDown } from "@/components/email/analytics/EmailAnalyticsDrillDown";
import { FilterCombobox } from "@/components/email/analytics/FilterCombobox";
import {
  TIME_RANGE_LABELS,
  formatCount,
  formatRate,
  previousPeriodLabel,
} from "@/components/email/analytics/format";
import {
  useEmailStats,
  useEmailDailyTrend,
  useEmailSequencePerformance,
  useSequenceMailboxIds,
  type EmailStatsFilters,
  type TimeRange,
  type Granularity,
} from "@/hooks/useEmailStats";
import { useEmailMailboxes } from "@/hooks/useEmailMailboxes";
import { useEmailSequences } from "@/hooks/useEmailSequences";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { EmailCampaignsShowcase } from "@/components/showcase/EmailCampaignsShowcase";
import { cn } from "@/lib/utils";

const MAILBOX_INITIAL_SHOW = 6;
const PRESET_RANGES: Exclude<TimeRange, "custom">[] = ["7d", "30d", "90d", "all"];

export default function EmailAnalytics() {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseEmail = hasFeature("email_campaigns");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>();
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | null>(null);
  const [drillDown, setDrillDown] = useState<OutcomeDrillDown | null>(null);
  const [mailboxExpanded, setMailboxExpanded] = useState(false);

  const filters: EmailStatsFilters = {
    sequenceId: selectedSequenceId,
    mailboxId: selectedMailboxId,
    customStart: timeRange === "custom" ? customDateRange?.from ?? null : null,
    customEnd: timeRange === "custom" ? customDateRange?.to ?? null : null,
  };

  const statsQuery = useEmailStats(timeRange, filters);
  const trendQuery = useEmailDailyTrend(timeRange, filters, granularity);
  const performanceQuery = useEmailSequencePerformance(timeRange, filters);
  const { data: allMailboxes } = useEmailMailboxes();
  const { data: sequences } = useEmailSequences();
  const { data: sequenceMailboxIds } = useSequenceMailboxIds(selectedSequenceId);

  const stats = statsQuery.data;

  // Scope the mailbox list to the selected sequence; otherwise it lists every
  // mailbox in the org, most of which this sequence never touches.
  const mailboxes = selectedSequenceId
    ? (allMailboxes || []).filter((m) => sequenceMailboxIds?.has(m.id))
    : allMailboxes;

  const hasActiveFilters = !!selectedSequenceId || !!selectedMailboxId;
  const selectedSequenceName =
    (sequences || []).find((s) => s.id === selectedSequenceId)?.name ??
    performanceQuery.data?.find((r) => r.sequence_id === selectedSequenceId)?.sequence_name;

  if (!canUseEmail && showUpgradePrompts) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8">
          <EmailCampaignsShowcase />
        </div>
      </AppLayout>
    );
  }

  if (!canUseEmail) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8 py-12 text-center">
          <p className="text-muted-foreground">This feature is not available for your organization.</p>
        </div>
      </AppLayout>
    );
  }

  const periodLabel =
    timeRange === "custom"
      ? customDateRange?.from && customDateRange?.to
        ? `${format(customDateRange.from, "MMM d")} to ${format(customDateRange.to, "MMM d, yyyy")}`
        : "Custom range"
      : TIME_RANGE_LABELS[timeRange];

  const comparisonLabel = previousPeriodLabel(timeRange);

  const selectPreset = (range: Exclude<TimeRange, "custom">) => {
    setTimeRange(range);
    setCustomDateRange(undefined);
  };

  const handleDateRangeSelect = (range: DateRange | undefined) => {
    // react-day-picker returns undefined when the "from" day is clicked again:
    // treat that as a single-day range.
    if (!range && customDateRange?.from && !customDateRange.to) {
      const endOfDay = new Date(customDateRange.from);
      endOfDay.setHours(23, 59, 59, 999);
      setCustomDateRange({ from: customDateRange.from, to: endOfDay });
      setTimeRange("custom");
      setDatePickerOpen(false);
      return;
    }
    if (!range) {
      setCustomDateRange(undefined);
      return;
    }
    if (range.from && !range.to) {
      setCustomDateRange(range);
      return;
    }
    if (range.from && range.to) {
      const endOfDay = new Date(range.to);
      endOfDay.setHours(23, 59, 59, 999);
      setCustomDateRange({ from: range.from, to: endOfDay });
      setTimeRange("custom");
      setDatePickerOpen(false);
    }
  };

  const focusSequence = (sequenceId: string | null) => {
    setSelectedSequenceId(sequenceId);
    setSelectedMailboxId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const copySummary = async () => {
    if (!stats) return;
    const best = bestCampaign(performanceQuery.data ?? []);
    const lines = [
      `Email results, ${periodLabel.toLowerCase()}${selectedSequenceName ? ` (${selectedSequenceName})` : ""}`,
      `${formatCount(stats.sent)} emails sent to ${formatCount(stats.unique_leads)} leads`,
      `${formatCount(stats.replied)} replies (${formatRate(stats.reply_rate)} of leads, excluding ${formatCount((stats.out_of_office ?? 0) + (stats.auto_replied ?? 0))} out-of-office and auto-replies)`,
      `${formatCount(stats.positive ?? 0)} positive (${formatRate(stats.positive_rate ?? 0)} of replies)`,
      `${formatCount(stats.meetings ?? 0)} meetings booked (${formatRate(stats.meeting_rate ?? 0)} of positive replies)`,
      `Bounce rate ${formatRate(stats.bounce_rate)}`,
    ];
    if (best?.metric === "positive" && !selectedSequenceId) {
      lines.push(
        `Top campaign: ${best.row.sequence_name}, ${formatCount(best.row.positive)} positive from ${formatCount(best.row.delivered)} leads (${formatRate(best.row.reply_rate)} replied, ${formatRate(best.row.positive_rate)} of replies positive)`,
      );
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Summary copied", { description: "Paste it into Slack, email or a client update." });
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  const drillTotal =
    drillDown && stats
      ? {
          sent: stats.unique_leads,
          replied: stats.replied,
          positive: stats.positive ?? 0,
          meetings: stats.meetings ?? 0,
          bounced: stats.bounced,
          blocked: stats.blocked ?? 0,
          auto: (stats.out_of_office ?? 0) + (stats.auto_replied ?? 0),
        }[drillDown]
      : undefined;

  const isRefreshing =
    (statsQuery.isFetching && !statsQuery.isLoading) || (performanceQuery.isFetching && !performanceQuery.isLoading);

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 px-4 py-6 sm:p-8">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <PageHeader
            icon={BarChart3}
            title="Email Analytics"
            description="Which campaigns turn sends into replies, positive replies and meetings."
            actions={
              <Button variant="outline" onClick={copySummary} disabled={!stats} className="gap-2">
                <Copy className="h-4 w-4" />
                Copy summary
              </Button>
            }
          />

          {/* Filters: one row that scopes everything below it. */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border bg-card p-0.5 shadow-sm" role="group" aria-label="Time range">
              {PRESET_RANGES.map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => selectPreset(range)}
                  aria-pressed={timeRange === range}
                  className={cn(
                    "rounded-[calc(var(--radius)-3px)] px-3 py-1.5 text-sm font-medium transition-colors",
                    timeRange === range ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {range === "all" ? "All time" : range.toUpperCase()}
                </button>
              ))}
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={timeRange === "custom"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-3px)] px-3 py-1.5 text-sm font-medium transition-colors",
                      timeRange === "custom" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {timeRange === "custom" ? periodLabel : "Custom"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={customDateRange}
                    onSelect={handleDateRangeSelect}
                    numberOfMonths={2}
                    disabled={{ after: new Date() }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <FilterCombobox
              value={selectedSequenceId}
              onChange={focusSequence}
              options={(sequences || []).map((seq) => ({ value: seq.id, label: seq.name }))}
              allLabel="All campaigns"
              searchPlaceholder="Search campaigns"
            />

            <FilterCombobox
              value={selectedMailboxId}
              onChange={setSelectedMailboxId}
              options={(mailboxes || []).map((mb) => ({ value: mb.id, label: mb.email_address }))}
              allLabel="All mailboxes"
              searchPlaceholder="Search mailboxes"
            />

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedSequenceId(null);
                  setSelectedMailboxId(null);
                }}
                className="gap-1 text-muted-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}

            {isRefreshing && (
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Updating
              </span>
            )}
          </div>

          {statsQuery.isError ? (
            <Card className="border-destructive/30">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-medium text-foreground">Couldn't load email stats</p>
                  <p className="text-sm text-muted-foreground">
                    {(statsQuery.error as Error)?.message || "The request failed. Try again in a moment."}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => statsQuery.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className={cn("transition-opacity", statsQuery.isFetching && !statsQuery.isLoading && "opacity-70")}>
              <EmailOutcomeFunnel
                stats={stats}
                isLoading={statsQuery.isLoading}
                comparisonLabel={comparisonLabel}
                onDrillDown={setDrillDown}
              />
            </div>
          )}

          <CampaignLeaderboard
            rows={performanceQuery.data}
            isLoading={performanceQuery.isLoading}
            isFetching={performanceQuery.isFetching}
            periodLabel={periodLabel}
            selectedSequenceId={selectedSequenceId}
            onSelectSequence={focusSequence}
          />

          <EmailTrendCharts
            data={trendQuery.data}
            isLoading={trendQuery.isLoading}
            isFetching={trendQuery.isFetching}
            granularity={granularity}
            onGranularityChange={setGranularity}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <ReplySentimentCard
              stats={
                stats
                  ? {
                      total_replies: stats.replied,
                      by_intent: stats.intents ?? {},
                      out_of_office: stats.out_of_office ?? 0,
                      auto_replied: stats.auto_replied ?? 0,
                    }
                  : undefined
              }
              isLoading={statsQuery.isLoading}
              onShowAutomatic={() => setDrillDown("auto")}
              className={cn(!Object.values(stats?.filtered ?? {}).some((n) => n > 0) && "lg:col-span-2")}
            />
            <FilteredLeadsCard byReason={stats?.filtered} />
          </div>

          {/* Mailbox Health */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4" />
                Mailbox health
                {mailboxes && mailboxes.length > 0 && (
                  <Badge variant="secondary" className="ml-1 font-normal">
                    {mailboxes.length}
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                {selectedSequenceId
                  ? "Health and today's volume for the mailboxes this campaign sends from"
                  : "Health and today's volume for every connected mailbox"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {mailboxes && mailboxes.length > 0 ? (
                <div className="space-y-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mailbox</TableHead>
                        <TableHead className="w-[120px]">Sent today</TableHead>
                        <TableHead className="w-[100px]">Status</TableHead>
                        <TableHead className="w-[80px] text-right">Health</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(mailboxExpanded ? mailboxes : mailboxes.slice(0, MAILBOX_INITIAL_SHOW)).map((mailbox) => (
                        <TableRow key={mailbox.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <div
                                className={cn(
                                  "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                                  mailbox.provider === "gmail"
                                    ? "border-red-500/20 bg-red-500/10 text-red-600"
                                    : mailbox.provider === "outlook"
                                      ? "border-blue-500/20 bg-blue-500/10 text-blue-600"
                                      : "border-gray-500/20 bg-gray-500/10 text-gray-600",
                                )}
                              >
                                {(mailbox.provider || "S")[0].toUpperCase()}
                              </div>
                              <span className="truncate text-sm">{mailbox.email_address}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">
                            {mailbox.daily_sent}/{mailbox.daily_limit}
                          </TableCell>
                          <TableCell>
                            <MailboxHealthBadge status={mailbox.status} imapConnected={mailbox.imap_connected} />
                          </TableCell>
                          <TableCell className="text-right">
                            {mailbox.health_score !== undefined && mailbox.status !== "disconnected" ? (
                              <span
                                className={cn(
                                  "text-sm font-medium tabular-nums",
                                  mailbox.health_score >= 0.8
                                    ? "text-green-600"
                                    : mailbox.health_score >= 0.5
                                      ? "text-amber-600"
                                      : "text-red-600",
                                )}
                              >
                                {Math.round(mailbox.health_score * 100)}%
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {mailboxes.length > MAILBOX_INITIAL_SHOW && (
                    <button
                      onClick={() => setMailboxExpanded(!mailboxExpanded)}
                      className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {mailboxExpanded ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          Show all {mailboxes.length} mailboxes
                        </>
                      )}
                    </button>
                  )}
                </div>
              ) : selectedSequenceId ? (
                <p className="py-8 text-center text-muted-foreground">This campaign hasn't sent from any mailbox yet.</p>
              ) : (
                <div className="space-y-2 py-8 text-center text-muted-foreground">
                  <p>No mailboxes connected yet.</p>
                  <Link to="/settings?tab=mailboxes">
                    <Button variant="outline" size="sm">Connect mailboxes</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <EmailAnalyticsDrillDown
        kind={drillDown}
        onClose={() => setDrillDown(null)}
        timeRange={timeRange}
        filters={filters}
        total={drillTotal}
      />
    </AppLayout>
  );
}
