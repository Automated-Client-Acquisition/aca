import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  Handshake,
  Plus,
  Search,
  LayoutGrid,
  List,
  BarChart3,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  type CrmDeal,
  type DealStatus,
  dealProbability,
  formatMoney,
  useDealPipelines,
  useDeals,
} from "@/hooks/crm/useDeals";
import { DealsBoard } from "@/components/deals/DealsBoard";
import { DealDialog } from "@/components/deals/DealDialog";
import { PipelineSettingsDialog } from "@/components/deals/PipelineSettingsDialog";
import { PipelineSwitcher } from "@/components/deals/PipelineSwitcher";
import { NewPipelineDialog } from "@/components/deals/NewPipelineDialog";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const ALL = "__all__";
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function DealsPage() {
  const {
    data: pipelines = [],
    isLoading: pipelinesLoading,
    isFetching: pipelinesFetching,
  } = useDealPipelines();
  const { data: members = [] } = useOrganizationMembers();
  const { currentOrganization } = useAuth();
  // Selected pipeline lives in the URL (shareable, survives reload); the last
  // one used per org is remembered for the next visit.
  const [searchParams, setSearchParams] = useSearchParams();
  const pipelineId = searchParams.get("pipeline");
  const storageKey = `deals:pipeline:${currentOrganization?.id ?? ""}`;
  const setPipelineId = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("pipeline", id);
      return next;
    });
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // storage unavailable: URL still holds the choice
    }
  };
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [ownerId, setOwnerId] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"board" | "list">("board");
  const [statusFilter, setStatusFilter] = useState<DealStatus | "all">("open");
  const [dialog, setDialog] = useState<{
    deal?: CrmDeal | null;
    stageId?: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.is_default) ?? pipelines[0];

  // No (or a stale) ?pipeline=: restore the last one used, if it still exists.
  // Wait out refetches: a just-created pipeline isn't in the list until then.
  useEffect(() => {
    if (pipelinesFetching || pipelines.length === 0 || pipelines.some((p) => p.id === pipelineId)) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(storageKey);
    } catch {
      remembered = null;
    }
    const target = pipelines.find((p) => p.id === remembered) ?? pipelines.find((p) => p.is_default) ?? pipelines[0];
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("pipeline", target.id);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelines, pipelineId, storageKey, pipelinesFetching]);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { data: deals = [], isLoading: dealsLoading } = useDeals({
    pipelineId: pipeline?.id,
    ownerUserId: ownerId === ALL ? null : ownerId,
    search: debouncedSearch,
  });

  const memberNames = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [
          m.user_id,
          m.user?.full_name || m.user?.email || "Member",
        ]),
      ),
    [members],
  );
  const stageById = useMemo(
    () => Object.fromEntries((pipeline?.stages ?? []).map((s) => [s.id, s])),
    [pipeline],
  );

  const listDeals = useMemo(
    () =>
      statusFilter === "all"
        ? deals
        : deals.filter((d) => d.status === statusFilter),
    [deals, statusFilter],
  );

  const dealCountByStage = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of deals) counts[d.stage_id] = (counts[d.stage_id] ?? 0) + 1;
    return counts;
  }, [deals]);

  const summary = useMemo(() => {
    const open = deals.filter((d) => d.status === "open");
    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1,
    );
    const wonThisMonth = deals.filter(
      (d) =>
        d.status === "won" &&
        d.closed_at &&
        new Date(d.closed_at) >= monthStart,
    );
    return {
      currency: deals[0]?.currency ?? "USD",
      openCount: open.length,
      openValue: open.reduce((s, d) => s + Number(d.value || 0), 0),
      weighted: open.reduce(
        (s, d) =>
          s +
          (Number(d.value || 0) * dealProbability(d, stageById[d.stage_id])) /
            100,
        0,
      ),
      wonCount: wonThisMonth.length,
      wonValue: wonThisMonth.reduce((s, d) => s + Number(d.value || 0), 0),
      overdue: open.filter(
        (d) =>
          d.expected_close_date &&
          differenceInCalendarDays(
            parseISO(d.expected_close_date),
            new Date(),
          ) < 0,
      ).length,
    };
  }, [deals, stageById]);

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 px-4 py-6 sm:p-8">
        <div className="mx-auto max-w-[1600px] space-y-5">
          <PageHeader
            icon={Handshake}
            title="Deals"
            description="Every opportunity in your pipeline, what it's worth and when it should close."
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild className="gap-2">
                  <Link to="/deals/report">
                    <BarChart3 className="h-4 w-4" /> Report
                  </Link>
                </Button>
                <Button
                  variant="cta"
                  className="gap-2"
                  onClick={() => setDialog({})}
                  disabled={!pipeline}
                >
                  <Plus className="h-4 w-4" /> New deal
                </Button>
              </div>
            }
          />

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <SummaryTile
              label="Open pipeline"
              value={formatMoney(summary.openValue, summary.currency, true)}
              sub={plural(summary.openCount, "open deal")}
            />
            <SummaryTile
              label="Weighted forecast"
              value={formatMoney(summary.weighted, summary.currency, true)}
              sub="Value × confidence"
            />
            <SummaryTile
              label="Won this month"
              value={formatMoney(summary.wonValue, summary.currency, true)}
              sub={plural(summary.wonCount, "deal")}
            />
            <SummaryTile
              label="Past close date"
              value={String(summary.overdue)}
              sub={
                summary.overdue === 1
                  ? "Open deal overdue"
                  : "Open deals overdue"
              }
              tone={summary.overdue > 0 ? "warn" : undefined}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PipelineSwitcher
              pipelines={pipelines}
              current={pipeline}
              onSelect={setPipelineId}
              onNew={() => setNewPipelineOpen(true)}
              onSettings={() => setSettingsOpen(true)}
            />
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search deals"
                className="pl-8"
              />
            </div>
            <Select value={ownerId} onValueChange={setOwnerId}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All owners</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {memberNames[m.user_id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {view === "list" && (
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as DealStatus | "all")}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div
              className="ml-auto flex items-center rounded-lg border bg-card p-0.5"
              role="group"
              aria-label="View"
            >
              {(["board", "list"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm",
                    view === v
                      ? "bg-muted font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-pressed={view === v}
                >
                  {v === "board" ? (
                    <LayoutGrid className="h-3.5 w-3.5" />
                  ) : (
                    <List className="h-3.5 w-3.5" />
                  )}
                  {v === "board" ? "Board" : "List"}
                </button>
              ))}
            </div>
          </div>

          {pipelinesLoading || (dealsLoading && deals.length === 0) ? (
            <div className="flex justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !pipeline ? null : view === "board" ? (
            <div className="space-y-3">
              {deals.length === 0 && !debouncedSearch && ownerId === ALL ? (
                <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">Track your first deal</p>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                      Add an opportunity with its value and expected close date.
                      Drag it through the stages, then drop it on Won or Lost to
                      close it. The report fills itself in.
                    </p>
                  </div>
                  <Button
                    variant="cta"
                    className="shrink-0 gap-2"
                    onClick={() => setDialog({})}
                  >
                    <Plus className="h-4 w-4" /> New deal
                  </Button>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MousePointerClick className="h-3.5 w-3.5" />
                  Drag cards between stages. Drop a card on Won or Lost to close
                  it.
                </p>
              )}
              <div className="h-[calc(100vh-400px)] min-h-[460px]">
                <DealsBoard
                  stages={pipeline.stages}
                  deals={deals}
                  memberNames={memberNames}
                  onOpenDeal={(deal) => setDialog({ deal })}
                  onAddDeal={(stageId) => setDialog({ stageId })}
                />
              </div>
            </div>
          ) : (
            <DealsTable
              deals={listDeals}
              stageById={stageById}
              memberNames={memberNames}
              onOpen={(deal) => setDialog({ deal })}
            />
          )}
        </div>
      </div>

      <DealDialog
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        pipelines={pipelines}
        deal={dialog?.deal}
        defaultPipelineId={pipeline?.id}
        defaultStageId={dialog?.stageId}
      />
      <PipelineSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        pipeline={pipeline}
        dealCountByStage={dealCountByStage}
        canDelete={pipelines.length > 1}
        onDeleted={() => {
          const fallback = pipelines.find((p) => p.id !== pipeline?.id && p.is_default) ?? pipelines.find((p) => p.id !== pipeline?.id);
          if (fallback) setPipelineId(fallback.id);
        }}
      />
      <NewPipelineDialog
        open={newPipelineOpen}
        onOpenChange={setNewPipelineOpen}
        copySource={pipeline}
        onCreated={(id, template) => {
          setPipelineId(id);
          // A blank pipeline needs its stages next.
          if (template === "blank") setTimeout(() => setSettingsOpen(true), 300);
        }}
      />
    </AppLayout>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn";
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function DealsTable({
  deals,
  stageById,
  memberNames,
  onOpen,
}: {
  deals: CrmDeal[];
  stageById: Record<
    string,
    { name: string; color: string; win_probability?: number | null }
  >;
  memberNames: Record<string, string>;
  onOpen: (deal: CrmDeal) => void;
}) {
  const sorted = useMemo(
    () =>
      [...deals].sort((a, b) => {
        const ad = a.expected_close_date ?? "9999";
        const bd = b.expected_close_date ?? "9999";
        return ad.localeCompare(bd) || Number(b.value) - Number(a.value);
      }),
    [deals],
  );

  if (deals.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
        No deals match.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deal</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Value</TableHead>
            <TableHead className="text-right">Conf.</TableHead>
            <TableHead>Close date</TableHead>
            <TableHead>Contact / company</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((d) => {
            const stage = stageById[d.stage_id];
            const overdue =
              d.status === "open" &&
              d.expected_close_date &&
              differenceInCalendarDays(
                parseISO(d.expected_close_date),
                new Date(),
              ) < 0;
            return (
              <TableRow
                key={d.id}
                className="cursor-pointer"
                onClick={() => onOpen(d)}
              >
                <TableCell className="font-medium">
                  {d.name}
                  {d.status !== "open" && (
                    <Badge
                      variant={d.status === "won" ? "default" : "secondary"}
                      className="ml-2 capitalize"
                    >
                      {d.status}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: stage?.color }}
                    />
                    {stage?.name ?? "-"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(Number(d.value), d.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.status === "open" ? `${dealProbability(d, stage)}%` : "-"}
                </TableCell>
                <TableCell
                  className={cn(overdue && "font-medium text-destructive")}
                >
                  {d.expected_close_date
                    ? format(parseISO(d.expected_close_date), "MMM d, yyyy")
                    : "-"}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-muted-foreground">
                  {[d.contact?.display_name, d.company?.name]
                    .filter(Boolean)
                    .join(" · ") || "-"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.owner_user_id
                    ? (memberNames[d.owner_user_id] ?? "-")
                    : "Unassigned"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
