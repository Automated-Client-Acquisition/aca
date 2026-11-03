import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { EmailDailyTrend } from "@/types/email";
import type { Granularity } from "@/hooks/useEmailStats";
import { formatCompact, formatCount, formatRate } from "@/components/email/analytics/format";

const ROLLING_DAYS = 7;
/** Below this many delivered leads in the window a rate is noise, so the line breaks instead. */
const MIN_WINDOW_VOLUME = 20;

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const GRID_STROKE = "hsl(var(--border))";
const SERIES = "hsl(var(--viz-1))";

function parseBucket(value: string): Date {
  // "YYYY-MM" (month) or "YYYY-MM-DD" (day / week start), local time.
  return value.length === 7 ? new Date(`${value}-01T00:00:00`) : new Date(`${value}T00:00:00`);
}

function tickLabel(value: string, granularity: Granularity): string {
  const d = parseBucket(value);
  if (granularity === "month") return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longLabel(value: string, granularity: Granularity): string {
  const d = parseBucket(value);
  if (granularity === "month") return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return granularity === "week" ? `Week of ${date}` : date;
}

interface TooltipShellProps {
  title: string;
  children: React.ReactNode;
}

function TooltipShell({ title, children }: TooltipShellProps) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {children}
    </div>
  );
}

interface EmailTrendChartsProps {
  data?: EmailDailyTrend[];
  isLoading?: boolean;
  isFetching?: boolean;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
}

export function EmailTrendCharts({ data, isLoading, isFetching, granularity, onGranularityChange }: EmailTrendChartsProps) {
  const series = useMemo(() => data ?? [], [data]);
  const hasSends = series.some((d) => d.sent > 0);

  const peak = useMemo(
    () => series.reduce<EmailDailyTrend | null>((best, d) => (!best || d.sent > best.sent ? d : best), null),
    [series],
  );

  // Daily view: a trailing 7-day window, because a single day's reply rate
  // swings on one reply. Week/month buckets are already wide enough to read raw.
  const replySeries = useMemo(
    () =>
      series.map((point, i) => {
        const from = granularity === "day" ? Math.max(0, i - ROLLING_DAYS + 1) : i;
        let delivered = 0;
        let replied = 0;
        for (let j = from; j <= i; j++) {
          delivered += series[j].delivered;
          replied += series[j].replied;
        }
        return {
          date: point.date,
          delivered,
          replied,
          rate: delivered >= MIN_WINDOW_VOLUME ? (replied / delivered) * 100 : null,
        };
      }),
    [series, granularity],
  );

  const bucketWord = granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly";

  return (
    <section className="space-y-3" aria-label="Trends">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">Trends</h2>
        <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Group trends by">
          {(["day", "week", "month"] as Granularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onGranularityChange(g)}
              aria-pressed={g === granularity}
              className={cn(
                "rounded-[calc(var(--radius)-4px)] px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                g === granularity ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-4 lg:grid-cols-2", isFetching && !isLoading && "opacity-70 transition-opacity")}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Emails sent</CardTitle>
            <CardDescription>
              {hasSends && peak
                ? `${bucketWord} volume · peak ${formatCount(peak.sent)} on ${longLabel(peak.date, granularity)}`
                : `${bucketWord} volume`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px]" />
            ) : !hasSends ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No emails sent in this period
              </div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: GRID_STROKE }}
                      tickFormatter={(v) => tickLabel(v, granularity)}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatCompact(v)}
                      width={44}
                      allowDecimals={false}
                    />
                    <Tooltip
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as EmailDailyTrend;
                        return (
                          <TooltipShell title={longLabel(String(label), granularity)}>
                            <p>
                              <span className="font-medium tabular-nums">{formatCount(point.sent)}</span> emails sent
                            </p>
                            <p className="text-muted-foreground">
                              {formatCount(point.unique_leads)} leads · {formatCount(point.replied)} replied
                            </p>
                          </TooltipShell>
                        );
                      }}
                    />
                    <Bar dataKey="sent" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reply rate</CardTitle>
            <CardDescription>
              {granularity === "day"
                ? `${ROLLING_DAYS}-day rolling, per delivered lead`
                : `${bucketWord}, per delivered lead`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px]" />
            ) : !replySeries.some((p) => p.rate !== null) ? (
              <div className="flex h-[260px] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Not enough delivered emails yet to chart a reply rate
              </div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={replySeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                    <XAxis
                      dataKey="date"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: GRID_STROKE }}
                      tickFormatter={(v) => tickLabel(v, granularity)}
                      interval="preserveStartEnd"
                      minTickGap={24}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => formatRate(v)}
                      width={48}
                    />
                    <Tooltip
                      cursor={{ stroke: GRID_STROKE }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0].payload as (typeof replySeries)[number];
                        return (
                          <TooltipShell title={longLabel(String(label), granularity)}>
                            {point.rate === null ? (
                              <p className="text-muted-foreground">Too few delivered leads to call</p>
                            ) : (
                              <>
                                <p>
                                  <span className="font-medium tabular-nums">{formatRate(point.rate)}</span> reply rate
                                </p>
                                <p className="text-muted-foreground">
                                  {formatCount(point.replied)} replies from {formatCount(point.delivered)} delivered leads
                                  {granularity === "day" ? ` (${ROLLING_DAYS} days)` : ""}
                                </p>
                              </>
                            )}
                          </TooltipShell>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="rate"
                      stroke={SERIES}
                      strokeWidth={2}
                      fill={SERIES}
                      fillOpacity={0.1}
                      connectNulls={false}
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 4, fill: SERIES, stroke: "hsl(var(--card))", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
