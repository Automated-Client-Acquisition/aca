import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowDown, ArrowUp, ArrowUpRight, Search, Trophy, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { EmailSequencePerformance } from "@/types/email";
import { bounceHealth, formatCount, formatRate } from "@/components/email/analytics/format";
import {
  MIN_LEADS_TO_RANK,
  RATE_KEYS,
  UNRANKED_REASON,
  bestCampaign,
  rankable,
  tieBreak,
  type RateKey,
  type SortKey,
} from "@/components/email/analytics/ranking";

const RANK_OPTIONS: { key: SortKey; label: string; hint: string }[] = [
  { key: "positive_per_lead", label: "Best overall", hint: "Positive replies per delivered lead: the whole funnel in one number" },
  { key: "reply_rate", label: "Reply rate", hint: "Replies as a share of delivered leads" },
  { key: "positive_rate", label: "Positive rate", hint: "Positive replies as a share of replies" },
  { key: "meeting_rate", label: "Meeting rate", hint: "Meetings booked as a share of positive replies" },
  { key: "sent", label: "Volume", hint: "Emails sent" },
];

const STATUS_STYLES: Record<string, { label: string; dot: string }> = {
  active: { label: "Active", dot: "bg-[hsl(var(--status-success))]" },
  paused: { label: "Paused", dot: "bg-amber-500" },
  draft: { label: "Draft", dot: "bg-muted-foreground/40" },
  completed: { label: "Completed", dot: "bg-[hsl(var(--status-info))]" },
  archived: { label: "Archived", dot: "bg-muted-foreground/40" },
};

interface CampaignLeaderboardProps {
  rows?: EmailSequencePerformance[];
  isLoading?: boolean;
  isFetching?: boolean;
  periodLabel: string;
  selectedSequenceId: string | null;
  onSelectSequence: (sequenceId: string | null) => void;
}

function value(row: EmailSequencePerformance, key: SortKey): number | string {
  if (key === "name") return row.sequence_name.toLowerCase();
  return row[key];
}

/**
 * One funnel step for one campaign: the rate with an inline bar, then the
 * counts behind it ("2 of 208"), so every rate shows its sample size.
 */
function RateCell({
  count,
  base,
  rate,
  max,
  isBest,
  dim,
  dimReason,
  extra,
  extraTitle,
}: {
  count: number;
  /** The step's denominator (delivered leads, replies, positive replies). */
  base: number;
  rate: number;
  max: number;
  isBest: boolean;
  dim?: boolean;
  dimReason?: string;
  /** Appended to the counts line, e.g. the segregated auto-replies. */
  extra?: string;
  extraTitle?: string;
}) {
  // Nothing to convert yet (e.g. no replies, so no positive rate): a quiet
  // dash reads cleaner than "0% / 0 of 0".
  if (base === 0) {
    return (
      <div className="ml-auto w-[7rem] text-right text-sm text-muted-foreground/50" aria-label="No data yet">
        -
      </div>
    );
  }
  const width = max > 0 ? Math.max((rate / max) * 100, rate > 0 ? 6 : 0) : 0;
  const cell = (
    <div className={cn("ml-auto flex w-[7rem] flex-col items-end gap-1", dim && "opacity-50")}>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-[hsl(var(--viz-1))]" style={{ width: `${width}%` }} />
        </span>
        <span className={cn("w-12 text-right text-sm tabular-nums text-foreground", isBest ? "font-semibold" : "font-medium")}>
          {formatRate(rate)}
        </span>
      </div>
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {isBest && <Trophy className="h-3 w-3 text-amber-500" aria-label="Best in this column" />}
        {formatCount(count)} of {formatCount(base)}
        {extra && <span title={extraTitle}>· {extra}</span>}
      </span>
    </div>
  );
  if (!dim || !dimReason || rate === 0) return cell;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent className="max-w-[220px] text-xs">Small sample: {dimReason}, so this rate isn't ranked.</TooltipContent>
    </Tooltip>
  );
}

function SortHeader({
  label,
  sublabel,
  sortKey,
  active,
  direction,
  onSort,
  align = "right",
  className,
}: {
  label: string;
  sublabel?: string;
  sortKey: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const Arrow = direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2.5 align-bottom font-medium", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex flex-col rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" ? "items-end" : "items-start",
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wide">
          {label}
          <Arrow className={cn("h-3 w-3", active ? "opacity-100" : "opacity-0")} aria-hidden />
        </span>
        {sublabel && <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">{sublabel}</span>}
      </button>
    </th>
  );
}

/**
 * Every campaign that sent in the period, side by side, read as a funnel:
 * reply rate per delivered lead, positive as a share of replies, meetings as
 * a share of positive replies. Ranked by the step you pick.
 */
export function CampaignLeaderboard({
  rows,
  isLoading,
  isFetching,
  periodLabel,
  selectedSequenceId,
  onSelectSequence,
}: CampaignLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("positive_per_lead");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const allRows = useMemo(() => rows ?? [], [rows]);
  const best = useMemo(() => bestCampaign(allRows), [allRows]);

  // Column maxima for the inline bars (all rows) and the per-column best
  // marker (only campaigns with enough volume behind that step).
  const columnBest = useMemo(() => {
    const stat = (key: "reply_rate" | "positive_rate" | "meeting_rate") => ({
      best: Math.max(0, ...allRows.filter((r) => rankable(r, key)).map((r) => r[key])),
      max: Math.max(0, ...allRows.map((r) => r[key])),
    });
    return { reply_rate: stat("reply_rate"), positive_rate: stat("positive_rate"), meeting_rate: stat("meeting_rate") };
  }, [allRows]);

  const rateSort = RATE_KEYS.includes(sortKey as RateKey) ? (sortKey as RateKey) : null;

  const sorted = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? allRows.filter((r) => r.sequence_name.toLowerCase().includes(needle))
      : allRows;
    const dir = direction === "asc" ? 1 : -1;
    const byKey = (a: EmailSequencePerformance, b: EmailSequencePerformance) => {
      const va = value(a, sortKey);
      const vb = value(b, sortKey);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * dir;
      const diff = ((va as number) - (vb as number)) * dir;
      return diff !== 0 ? diff : tieBreak(a, b, sortKey);
    };
    // Ranking by a rate: campaigns too small to judge on that step go last.
    if (rateSort) {
      const ranked = filtered.filter((r) => rankable(r, rateSort)).sort(byKey);
      const small = filtered.filter((r) => !rankable(r, rateSort)).sort(byKey);
      return { ranked, small };
    }
    return { ranked: [...filtered].sort(byKey), small: [] as EmailSequencePerformance[] };
  }, [allRows, search, sortKey, direction, rateSort]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDirection((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setDirection(key === "name" || key === "bounce_rate" ? "asc" : "desc");
    }
  };

  const totalShown = sorted.ranked.length + sorted.small.length;
  const activeHint = RANK_OPTIONS.find((o) => o.key === sortKey)?.hint;

  const renderRow = (row: EmailSequencePerformance, rank: number | null) => {
    const status = STATUS_STYLES[row.sequence_status ?? ""] ?? { label: row.sequence_status ?? "Unknown", dot: "bg-muted-foreground/40" };
    const bounce = bounceHealth(row.bounce_rate);
    const selected = row.sequence_id === selectedSequenceId;
    const lowVolume = row.delivered < MIN_LEADS_TO_RANK;
    const isBest = (key: "reply_rate" | "positive_rate" | "meeting_rate") =>
      rankable(row, key) && columnBest[key].best > 0 && row[key] === columnBest[key].best;

    return (
      <tr
        key={row.sequence_id}
        onClick={() => onSelectSequence(selected ? null : row.sequence_id)}
        className={cn(
          "group cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40",
          selected && "bg-primary/5 hover:bg-primary/10",
        )}
      >
        <td className="w-10 py-3 pl-4 pr-1 text-center align-middle">
          {rank !== null ? (
            <span
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                rank === 1 && rateSort ? "bg-gradient-cta text-black" : "bg-muted text-muted-foreground",
              )}
            >
              {rank}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">–</span>
          )}
        </td>
        <td className="max-w-[14rem] px-3 py-3 align-middle">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-medium text-foreground", selected && "text-primary")} title={row.sequence_name}>
              {row.sequence_name}
            </span>
            <Link
              to={`/email/sequences/${row.sequence_id}`}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded-sm text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              aria-label={`Open ${row.sequence_name}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden />
            {status.label}
            {row.last_sent_at && (
              <span className="hidden sm:inline">· last sent {formatDistanceToNowStrict(new Date(row.last_sent_at), { addSuffix: true })}</span>
            )}
            {lowVolume && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="rounded border border-dashed px-1 text-[10px] uppercase tracking-wide">Low volume</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[240px] text-xs">
                  Under {MIN_LEADS_TO_RANK} delivered leads in this period, so its rates aren't ranked yet.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-3 text-right align-middle tabular-nums">
          <div className="text-sm font-medium text-foreground">{formatCount(row.sent)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatCount(row.unique_leads)} leads</div>
        </td>
        <td className="px-3 py-3 align-middle">
          <RateCell
            count={row.replied}
            base={row.delivered}
            rate={row.reply_rate}
            max={columnBest.reply_rate.max}
            isBest={isBest("reply_rate")}
            dim={!rankable(row, "reply_rate")}
            dimReason={UNRANKED_REASON.reply_rate}
            extra={row.auto_replies > 0 ? `+${formatCount(row.auto_replies)} auto` : undefined}
            extraTitle={`${formatCount(row.auto_replies)} out-of-office / auto-replies, not counted as replies`}
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <RateCell
            count={row.positive}
            base={row.replied}
            rate={row.positive_rate}
            max={columnBest.positive_rate.max}
            isBest={isBest("positive_rate")}
            dim={!rankable(row, "positive_rate")}
            dimReason={UNRANKED_REASON.positive_rate}
          />
        </td>
        <td className="px-3 py-3 align-middle">
          <RateCell
            count={row.meetings}
            base={row.positive}
            rate={row.meeting_rate}
            max={columnBest.meeting_rate.max}
            isBest={isBest("meeting_rate")}
            dim={!rankable(row, "meeting_rate")}
            dimReason={UNRANKED_REASON.meeting_rate}
          />
        </td>
        <td className="py-3 pl-3 pr-5 text-right align-middle tabular-nums">
          <div className="inline-flex items-center gap-1.5 text-sm text-foreground">
            {bounce.tone !== "good" && (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  bounce.tone === "critical" ? "bg-[hsl(var(--status-error))]" : "bg-amber-500",
                )}
                aria-label={`${bounce.label} bounce rate`}
              />
            )}
            {formatRate(row.bounce_rate)}
          </div>
          <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
            {formatCount(row.bounced)} bounced
            {row.blocked > 0 && (
              <span title="Refused for the sending domain's reputation, not a bad address. Not counted in the bounce rate.">
                {" "}· {formatCount(row.blocked)} blocked
              </span>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Card className={cn("overflow-hidden transition-opacity", isFetching && !isLoading && "opacity-70")}>
        <CardHeader className="gap-4 space-y-0 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-lg">Campaign performance</CardTitle>
            <CardDescription>
              {isLoading
                ? "Loading campaigns…"
                : `${allRows.length} ${allRows.length === 1 ? "campaign" : "campaigns"} · ${periodLabel}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center rounded-md border p-0.5" role="group" aria-label="Rank campaigns by">
              {RANK_OPTIONS.map((option) => (
                <Tooltip key={option.key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setSortKey(option.key);
                        setDirection("desc");
                      }}
                      aria-pressed={sortKey === option.key}
                      className={cn(
                        "rounded-[calc(var(--radius)-4px)] px-2.5 py-1 text-xs font-medium transition-colors",
                        sortKey === option.key
                          ? "bg-foreground text-background"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px] text-xs">{option.hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            {allRows.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Find a campaign"
                  className="h-8 w-44 pl-8 text-sm"
                  aria-label="Find a campaign"
                />
              </div>
            )}
          </div>
        </CardHeader>

        {best && !isLoading && (
          <div className="mx-6 mb-4 flex items-center gap-3 rounded-lg border border-amber-200/70 bg-gradient-to-r from-amber-50 to-transparent px-3 py-2.5 dark:border-amber-500/20 dark:from-amber-500/10">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-cta shadow-sm">
              <Trophy className="h-3.5 w-3.5 text-black" aria-hidden />
            </span>
            <p className="min-w-0 text-sm text-foreground">
              <span className="mr-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Top campaign</span>
              <button
                type="button"
                className="font-semibold hover:underline"
                onClick={() => onSelectSequence(best.row.sequence_id)}
              >
                {best.row.sequence_name}
              </button>
              <span className="text-muted-foreground">
                {best.metric === "positive" ? (
                  <>
                    {" · "}
                    <span className="font-medium text-foreground">{formatCount(best.row.positive)} positive</span> from{" "}
                    {formatCount(best.row.delivered)} leads · {formatRate(best.row.reply_rate)} replied ·{" "}
                    {formatRate(best.row.positive_rate)} of replies positive
                  </>
                ) : (
                  <>
                    {" · best reply rate "}
                    <span className="font-medium text-foreground">{formatRate(best.row.reply_rate)}</span> ·{" "}
                    {formatCount(best.row.replied)} from {formatCount(best.row.delivered)} leads
                  </>
                )}
              </span>
            </p>
          </div>
        )}

        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 px-6 pb-6">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : allRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-4 text-center">
              <p className="text-sm text-muted-foreground">No campaign sent emails in this period.</p>
              <Button asChild variant="outline" size="sm">
                <Link to="/email/sequences">Go to sequences</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto border-t">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-muted/30">
                  <tr className="border-b">
                    <th scope="col" className="w-10 py-2.5 pl-4 pr-1 text-center align-bottom text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      #
                    </th>
                    <SortHeader label="Campaign" sortKey="name" align="left" active={sortKey === "name"} direction={direction} onSort={handleSort} />
                    <SortHeader label="Sent" sublabel="emails" sortKey="sent" active={sortKey === "sent"} direction={direction} onSort={handleSort} />
                    <SortHeader label="Replies" sublabel="of leads" sortKey="reply_rate" active={sortKey === "reply_rate"} direction={direction} onSort={handleSort} />
                    <SortHeader label="Positive" sublabel="of replies" sortKey="positive_rate" active={sortKey === "positive_rate"} direction={direction} onSort={handleSort} />
                    <SortHeader label="Meetings" sublabel="of positive" sortKey="meeting_rate" active={sortKey === "meeting_rate"} direction={direction} onSort={handleSort} />
                    <SortHeader label="Bounce" sublabel="of leads" sortKey="bounce_rate" active={sortKey === "bounce_rate"} direction={direction} onSort={handleSort} className="pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.ranked.map((row, i) => renderRow(row, rateSort ? i + 1 : null))}
                  {rateSort && sorted.small.length > 0 && (
                    <tr className="border-b bg-muted/20">
                      <td colSpan={7} className="px-4 py-2 text-xs text-muted-foreground">
                        Not ranked on this measure yet: {UNRANKED_REASON[rateSort]} in this period
                      </td>
                    </tr>
                  )}
                  {sorted.small.map((row) => renderRow(row, null))}
                  {totalShown === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No campaign matches "{search}".{" "}
                        <button type="button" className="inline-flex items-center gap-1 text-foreground hover:underline" onClick={() => setSearch("")}>
                          <X className="h-3 w-3" /> Clear search
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
        {activeHint && !isLoading && allRows.length > 0 && (
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t px-6 py-2.5 text-xs text-muted-foreground">
            <span>Ranked by {activeHint.charAt(0).toLowerCase() + activeHint.slice(1)}.</span>
            <span>Click a campaign to focus the page on it.</span>
          </div>
        )}
      </Card>
    </TooltipProvider>
  );
}
