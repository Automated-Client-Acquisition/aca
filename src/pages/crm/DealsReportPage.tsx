import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { endOfDay, startOfDay, subDays } from "date-fns";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, ArrowLeft, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { formatMoney, useDealPipelines, useDealReport } from "@/hooks/crm/useDeals";
import { cn } from "@/lib/utils";

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
const GRID_STROKE = "hsl(var(--border))";
const SERIES = "hsl(var(--viz-1))";
const ALL = "__all__";
const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "180", label: "6m", days: 180 },
  { key: "365", label: "12m", days: 365 },
] as const;

function monthLabel(m: string | null, long = false) {
  if (m === null) return "No close date";
  if (m === "overdue") return "Overdue";
  const d = new Date(`${m}-01T00:00:00`);
  if (long) return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return `${d.toLocaleDateString("en-US", { month: "short" })} '${String(d.getFullYear()).slice(2)}`;
}

// Axis ticks keep one decimal ($7.5K) so auto-scaled ticks don't round to odd values.
const axisMoney = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(v);

function TooltipShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {children}
    </div>
  );
}

export default function DealsReportPage() {
  const { data: pipelines = [] } = useDealPipelines();
  const { data: members = [] } = useOrganizationMembers();
  const [pipelineId, setPipelineId] = useState<string>(ALL);
  const [ownerId, setOwnerId] = useState<string>(ALL);
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("90");

  // Day-aligned so the query key is stable across renders.
  const { from, to } = useMemo(() => {
    const days = RANGES.find((r) => r.key === rangeKey)!.days;
    return { from: startOfDay(subDays(new Date(), days)), to: endOfDay(new Date()) };
  }, [rangeKey]);

  const { data: report, isLoading } = useDealReport({
    pipelineId: pipelineId === ALL ? null : pipelineId,
    ownerUserId: ownerId === ALL ? null : ownerId,
    from,
    to,
  });

  // The report sums deal values as entered; mixed currencies aren't converted.
  const money = (v: number | null | undefined, compact = true) => formatMoney(Number(v ?? 0), "USD", compact);
  const s = report?.summary;

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1 px-4 py-6 sm:p-8">
        <div className="mx-auto max-w-[1400px] space-y-6">
          <PageHeader
            icon={BarChart3}
            title="Pipeline report"
            description="What's in the pipeline, what will close, and where deals are won and lost."
            actions={
              <Button variant="outline" asChild className="gap-2">
                <Link to="/deals">
                  <ArrowLeft className="h-4 w-4" /> Deals
                </Link>
              </Button>
            }
          />

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border bg-card p-0.5 shadow-sm" role="group" aria-label="Closed deals window">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRangeKey(r.key)}
                  aria-pressed={rangeKey === r.key}
                  className={cn(
                    "rounded-[calc(var(--radius)-4px)] px-2.5 py-1 text-xs font-medium transition-colors",
                    rangeKey === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {pipelines.length > 1 && (
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All pipelines</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.user?.full_name || m.user?.email || "Member"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">Won/lost metrics use deals closed in this window. Open pipeline is as of now.</span>
          </div>

          {isLoading || !report || !s ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Open pipeline" value={money(s.open_value)} sub={`${s.open_count} open deals`} />
                <Stat label="Weighted forecast" value={money(s.weighted_value)} sub="Value × confidence" />
                <Stat label="Won" value={money(s.won_value)} sub={`${s.won_count} deals`} />
                <Stat label="Win rate" value={s.win_rate != null ? `${s.win_rate}%` : "-"} sub={`${s.won_count} won / ${s.lost_count} lost`} />
                <Stat label="Avg deal won" value={s.avg_won_value != null ? money(s.avg_won_value) : "-"} sub="Closed won" />
                <Stat
                  label="Sales cycle"
                  value={s.avg_cycle_days == null ? "-" : s.avg_cycle_days < 1 ? "<1d" : `${Math.round(s.avg_cycle_days)}d`}
                  sub="Created to won"
                />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Open pipeline by stage" subtitle="Value of open deals sitting in each stage now">
                  {report.by_stage.every((r) => r.count === 0) ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(180, report.by_stage.length * 44)}>
                      <BarChart data={report.by_stage} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
                        <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
                        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                        <YAxis type="category" dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} width={110} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as (typeof report.by_stage)[number];
                            return (
                              <TooltipShell title={p.name}>
                                <p>
                                  <span className="font-medium tabular-nums">{money(p.value, false)}</span> in {p.count} deals
                                </p>
                                <p className="text-muted-foreground">
                                  {money(p.weighted, false)} weighted at {p.win_probability ?? 0}%
                                  {p.avg_days_in_stage != null && ` · ${p.avg_days_in_stage}d avg in stage`}
                                </p>
                              </TooltipShell>
                            );
                          }}
                        />
                        {/* Stage colors match the board, so a stage reads the same everywhere. */}
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false}>
                          {report.by_stage.map((st) => (
                            <Cell key={st.stage_id} fill={st.color || SERIES} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="Forecast by close month" subtitle="Weighted value of open deals by expected close date">
                  {report.forecast.length === 0 ? (
                    <Empty />
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={report.forecast} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={8}>
                        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} tickFormatter={(m) => monthLabel(m)} />
                        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={56} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as (typeof report.forecast)[number];
                            return (
                              <TooltipShell title={monthLabel(p.month, true)}>
                                <p>
                                  <span className="font-medium tabular-nums">{money(p.weighted, false)}</span> weighted
                                </p>
                                <p className="text-muted-foreground">
                                  {money(p.value, false)} total across {p.count} deals
                                </p>
                              </TooltipShell>
                            );
                          }}
                        />
                        <Bar dataKey="weighted" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="Won by month" subtitle="Closed-won value in the selected window">
                  {report.won_by_month.every((m) => m.won_count === 0) ? (
                    <Empty text="No deals won in this window." />
                  ) : (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={report.won_by_month} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap={8}>
                        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} tickFormatter={(m) => monthLabel(m)} />
                        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={56} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as (typeof report.won_by_month)[number];
                            return (
                              <TooltipShell title={monthLabel(p.month, true)}>
                                <p>
                                  <span className="font-medium tabular-nums">{money(p.won_value, false)}</span> won in {p.won_count} deals
                                </p>
                                <p className="text-muted-foreground">{p.lost_count} lost</p>
                              </TooltipShell>
                            );
                          }}
                        />
                        <Bar dataKey="won_value" fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>

                <ChartCard title="Lost reasons" subtitle="Why deals closed lost in the selected window">
                  {report.lost_reasons.length === 0 ? (
                    <Empty text="No lost deals in this window." />
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(160, report.lost_reasons.length * 40)}>
                      <BarChart data={report.lost_reasons} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
                        <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
                        <XAxis
                          type="number"
                          tick={AXIS_TICK}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                          domain={[0, (max: number) => Math.max(1, max)]}
                        />
                        <YAxis type="category" dataKey="reason" tick={AXIS_TICK} tickLine={false} axisLine={false} width={140} />
                        <Tooltip
                          cursor={{ fill: "hsl(var(--muted))", opacity: 0.6 }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as (typeof report.lost_reasons)[number];
                            return (
                              <TooltipShell title={p.reason}>
                                <p>
                                  <span className="font-medium tabular-nums">{p.count}</span> deals · {money(p.value, false)}
                                </p>
                              </TooltipShell>
                            );
                          }}
                        />
                        <Bar dataKey="count" fill={SERIES} radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </ChartCard>
              </div>

              <div className="rounded-lg border bg-card">
                <div className="border-b px-4 py-3">
                  <h3 className="text-sm font-semibold">By owner</h3>
                  <p className="text-xs text-muted-foreground">Open pipeline now, won and lost in the selected window</p>
                </div>
                {report.by_owner.length === 0 ? (
                  <Empty />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Owner</TableHead>
                          <TableHead className="text-right">Open</TableHead>
                          <TableHead className="text-right">Open value</TableHead>
                          <TableHead className="text-right">Weighted</TableHead>
                          <TableHead className="text-right">Won</TableHead>
                          <TableHead className="text-right">Won value</TableHead>
                          <TableHead className="text-right">Lost</TableHead>
                          <TableHead className="text-right">Win rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.by_owner.map((o) => (
                          <TableRow key={o.owner_user_id ?? "none"}>
                            <TableCell className="font-medium">{o.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.open_count}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(o.open_value, false)}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(o.weighted, false)}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.won_count}</TableCell>
                            <TableCell className="text-right tabular-nums">{money(o.won_value, false)}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.lost_count}</TableCell>
                            <TableCell className="text-right tabular-nums">{o.win_rate != null ? `${o.win_rate}%` : "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>
      {children}
    </div>
  );
}

function Empty({ text = "No deals yet." }: { text?: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>;
}
