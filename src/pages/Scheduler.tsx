import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  Keyboard,
  LayoutGrid,
  List,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import { useAutopilots } from "@/hooks/useAutopilots";
import {
  useAgentPlan,
  useApprovePosts,
  useAutopilotHealth,
  useNativeDestinations,
  useDeletePosts,
  useReschedulePost,
  useRetryPosts,
  useSchedulerAttention,
  useSchedulerPosts,
} from "@/hooks/useScheduler";
import { projectPosts } from "@/lib/autopilot-schedule";
import { buildInsights, isSocialPlatform, normPlatform, ruleFor, withoutGhlTwins, type Insight, type SchedulerPost } from "@/lib/scheduler";
import { WeekView, type Projection } from "@/components/scheduler/WeekView";
import { MonthView } from "@/components/scheduler/MonthView";
import { ListView, type ListTab } from "@/components/scheduler/ListView";
import { PostComposer, type ComposerPrefill } from "@/components/scheduler/PostComposer";
import { AgentBar, type PlanCommand } from "@/components/scheduler/AgentBar";
import { BriefingPanel } from "@/components/scheduler/BriefingPanel";
import { PostCardGhost } from "@/components/scheduler/PostCard";
import { PlatformGlyph } from "@/components/scheduler/PlatformGlyph";
import { ConnectAccountMenu } from "@/components/scheduler/ConnectAccountMenu";

type View = "week" | "month" | "list";

const BRIEFING_KEY = "scheduler.briefing";

function readBriefingPref(): boolean {
  try {
    return localStorage.getItem(BRIEFING_KEY) !== "0";
  } catch {
    return true;
  }
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export default function Scheduler() {
  const navigate = useNavigate();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canPublish = hasFeature("publishing");
  const [params, setParams] = useSearchParams();

  const view = (["week", "month", "list"].includes(params.get("view") ?? "") ? params.get("view") : "week") as View;
  const anchor = useMemo(() => {
    const d = params.get("d");
    const parsed = d ? parseISO(d) : new Date();
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }, [params]);
  const setView = (v: View) => setParams((p) => { p.set("view", v); return p; }, { replace: true });
  const setAnchor = (d: Date) => setParams((p) => { p.set("d", format(d, "yyyy-MM-dd")); return p; }, { replace: true });

  // ---- Range -------------------------------------------------------------
  const [now] = useState(() => new Date());
  const { rangeStart, rangeEnd, days, rangeLabel } = useMemo(() => {
    if (view === "month") {
      const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
      const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
      const list: Date[] = [];
      for (let d = start; d <= end; d = addDays(d, 1)) list.push(d);
      return { rangeStart: start, rangeEnd: end, days: list, rangeLabel: format(anchor, "MMMM yyyy") };
    }
    if (view === "list") {
      const start = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), -14);
      return { rangeStart: start, rangeEnd: addDays(start, 60), days: [], rangeLabel: "Last 2 weeks and next 45 days" };
    }
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    const list = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const label = isSameMonth(start, end) ? `${format(start, "d")} – ${format(end, "d MMM yyyy")}` : `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`;
    return { rangeStart: start, rangeEnd: end, days: list, rangeLabel: label };
  }, [view, anchor, now]);

  const step = (dir: 1 | -1) => setAnchor(view === "month" ? addMonths(anchor, dir) : addWeeks(anchor, dir));

  // ---- Data --------------------------------------------------------------
  const { accounts: ghlAndOtherAccounts, isLoading: accountsLoading } = useConnectedAccounts();
  // Native LinkedIn (Unipile) first: ACA publishes those itself, the rest go through GHL.
  const { data: nativeAccounts = [] } = useNativeDestinations();
  const allAccounts = useMemo(() => [...nativeAccounts, ...ghlAndOtherAccounts], [nativeAccounts, ghlAndOtherAccounts]);
  // What can be picked: a GHL copy of an account also connected through Zernio is
  // left out, or a post to "all accounts" would go out twice. Posts already on a
  // GHL copy still show and edit (accountsById keeps every account).
  const { offered: accounts, replacedBy } = useMemo(
    () => withoutGhlTwins(allAccounts.filter((a) => isSocialPlatform(a.platform))),
    [allAccounts],
  );
  const accountsById = useMemo(() => new Map(allAccounts.map((a) => [a.id, a])), [allAccounts]);
  const { data: rangePosts = [], isLoading, isFetching, refetch } = useSchedulerPosts(rangeStart, rangeEnd);
  const [horizon] = useState(() => [new Date(Date.now() - 3600_000), addDays(new Date(), 16)] as const);
  const { data: horizonPosts = [] } = useSchedulerPosts(horizon[0], horizon[1]);
  const { data: attention } = useSchedulerAttention();
  const { data: autopilots = [] } = useAutopilots();
  const activeAutopilots = useMemo(() => autopilots.filter((a) => a.status === "active").map((a) => ({ id: a.id, name: a.name })), [autopilots]);
  const { data: stalled = [] } = useAutopilotHealth(activeAutopilots);
  const stalledById = useMemo(
    () => new Map(stalled.map((s) => [s.id, s.reason === "no_ideas" ? "Out of ideas" : "Approval failing"])),
    [stalled],
  );

  const [platformFilter, setPlatformFilter] = useState<string[] | null>(null);
  const connectedPlatforms = useMemo(() => [...new Set(accounts.map((a) => normPlatform(a.platform)))], [accounts]);
  const filterPlatforms = useMemo(
    () => [...new Set([...connectedPlatforms, ...rangePosts.flatMap((p) => p.platforms)])].filter(Boolean),
    [connectedPlatforms, rangePosts],
  );
  const posts = useMemo(
    () => (platformFilter ? rangePosts.filter((p) => p.platforms.some((pl) => platformFilter.includes(pl))) : rangePosts),
    [rangePosts, platformFilter],
  );
  const heatPlatforms = platformFilter ?? connectedPlatforms;

  // Upcoming autopilot runs, so the calendar shows everything that will go out.
  const projections = useMemo<Projection[]>(() => {
    if (view === "list") return [];
    const from = new Date(Math.max(Date.now() + 2 * 3600_000, rangeStart.getTime()));
    if (from > rangeEnd) return [];
    const out: Projection[] = [];
    for (const ap of autopilots) {
      if (ap.status !== "active") continue;
      const platforms = [...new Set((ap.destinations ?? []).filter((d) => d.enabled !== false).map((d) => normPlatform(d.platform)))];
      if (!platforms.length) continue;
      if (platformFilter && !platforms.some((p) => platformFilter.includes(p))) continue;
      let slots: Array<{ at: Date }> = [];
      try {
        slots = projectPosts(ap as never, rangeEnd, from, 60);
      } catch {
        slots = [];
      }
      for (const s of slots) {
        const queued = rangePosts.some((p) => p.rows.some((r) => r.autopilot_id === ap.id) && Math.abs(p.at.getTime() - s.at.getTime()) < 3 * 3600_000);
        if (!queued) out.push({ key: `${ap.id}:${s.at.toISOString()}`, autopilotId: ap.id, name: ap.name, at: s.at, platforms, stalled: stalledById.get(ap.id) });
      }
    }
    return out.slice(0, 300);
  }, [autopilots, rangeStart, rangeEnd, rangePosts, view, platformFilter, stalledById]);

  const busy = useMemo(
    () => [...horizonPosts, ...(attention?.drafts ?? [])].flatMap((p) => p.rows.map((r) => ({ account_id: r.account_id, at: new Date(r.scheduled_for) }))),
    [horizonPosts, attention],
  );

  const proposals = useMemo(() => (attention?.drafts ?? []).filter((p) => p.origin === "agent"), [attention]);
  const insights = useMemo(
    () =>
      buildInsights({
        posts: rangePosts,
        rangeStart: view === "list" ? now : rangeStart,
        rangeEnd: view === "list" ? addDays(now, 7) : rangeEnd,
        accountCount: accountsLoading ? 1 : accounts.length,
        failedRecent: attention?.failed ?? [],
        draftsAhead: attention?.drafts ?? [],
        projections,
        stalled,
      }),
    [rangePosts, rangeStart, rangeEnd, accounts.length, accountsLoading, attention, view, now, projections, stalled],
  );

  // ---- Mutations ---------------------------------------------------------
  const reschedule = useReschedulePost();
  const approve = useApprovePosts();
  const retry = useRetryPosts();
  const remove = useDeletePosts();
  const plan = useAgentPlan();

  // ---- Composer ----------------------------------------------------------
  const [composer, setComposer] = useState<{ open: boolean; post: SchedulerPost | null; at: Date | null; prefill: ComposerPrefill | null }>({
    open: false,
    post: null,
    at: null,
    prefill: null,
  });
  const openComposer = useCallback((opts: { post?: SchedulerPost; at?: Date; prefill?: ComposerPrefill } = {}) => {
    setComposer({ open: true, post: opts.post ?? null, at: opts.at ?? null, prefill: opts.prefill ?? null });
  }, []);
  // A published post's stats keep updating while it's open: show the latest copy of it.
  const composerPost = useMemo(() => {
    const opened = composer.post;
    if (opened?.status !== "published") return opened;
    return rangePosts.find((p) => p.key === opened.key) ?? opened;
  }, [composer.post, rangePosts]);

  // ---- Agent -------------------------------------------------------------
  const agentRef = useRef<HTMLTextAreaElement>(null);
  const [agentInput, setAgentInput] = useState("");
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("upcoming");

  const defaultAgentRange = useMemo<[Date, Date]>(() => {
    const start = new Date(Math.max(Date.now(), rangeStart.getTime()));
    const end = view !== "list" && rangeEnd.getTime() > Date.now() + 86400_000 ? rangeEnd : addDays(new Date(), 7);
    return [start, end];
  }, [rangeStart, rangeEnd, view]);

  const runPlan = (cmd: PlanCommand) => {
    if (!cmd.accounts.length) {
      toast.error("Connect a social account first.");
      return;
    }
    setAgentSummary(null);
    plan.mutate(
      {
        instruction: cmd.instruction,
        rangeStart: cmd.rangeStart,
        rangeEnd: cmd.rangeEnd,
        accounts: cmd.accounts.map((a) => ({ id: a.id, platform: normPlatform(a.platform), name: a.name })),
      },
      {
        onSuccess: (res) => {
          setAgentSummary(res.summary);
          setAgentInput("");
          toast.success(`${res.created} proposal${res.created === 1 ? "" : "s"} added to your calendar`, {
            description: "Review them, tweak anything, then approve.",
          });
          if (view !== "list" && (cmd.rangeStart > rangeEnd || cmd.rangeStart < rangeStart)) setAnchor(cmd.rangeStart);
        },
        onError: (e: Error) => toast.error(e.message),
      },
    );
  };

  const onInsightAction = (insight: Insight) => {
    const kind = insight.action?.kind;
    if (kind === "review_failed") {
      setListTab("failed");
      setView("list");
    } else if (kind === "approve_drafts") {
      setListTab("approval");
      setView("list");
    } else if (kind === "connect") {
      navigate("/settings?tab=integrations");
    } else if (kind === "open_ideas") {
      navigate("/ideas");
    } else if (kind === "plan_gap") {
      const gapDays: string[] = insight.action?.payload?.days ?? [];
      if (!gapDays.length) return;
      const first = parseISO(gapDays[0]);
      const last = addDays(parseISO(gapDays[gapDays.length - 1]), 1);
      const instruction = `Fill these empty days with one post per channel each: ${gapDays.map((d) => format(parseISO(d), "EEE d MMM")).join(", ")}. Leave days that already have posts alone.`;
      setAgentInput(instruction);
      runPlan({ instruction, rangeStart: new Date(Math.max(Date.now(), first.getTime())), rangeEnd: last, accounts: accounts.filter((a) => a.isActive) });
    }
  };

  // ---- Drag and drop -----------------------------------------------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const [dragging, setDragging] = useState<SchedulerPost | null>(null);
  const onDragStart = (e: DragStartEvent) => setDragging((e.active.data.current?.post as SchedulerPost) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const post = e.active.data.current?.post as SchedulerPost | undefined;
    const target = e.over?.data.current as { at: Date; granularity: "hour" | "day" } | undefined;
    if (!post || !target) return;
    const at =
      target.granularity === "hour"
        ? new Date(target.at.getFullYear(), target.at.getMonth(), target.at.getDate(), target.at.getHours(), post.at.getMinutes())
        : new Date(target.at.getFullYear(), target.at.getMonth(), target.at.getDate(), post.at.getHours(), post.at.getMinutes());
    if (at.getTime() === post.at.getTime()) return;
    if (at.getTime() < Date.now() + 60_000) {
      toast.error("That time has already passed.");
      return;
    }
    const from = post.at;
    reschedule.mutate(
      { post, at },
      {
        onSuccess: () =>
          toast.success(`Moved to ${format(at, "EEE d MMM, HH:mm")}`, {
            action: { label: "Undo", onClick: () => reschedule.mutate({ post: { ...post, at }, at: from }) },
          }),
      },
    );
  };

  // ---- Keyboard shortcuts ------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (composer.open || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "c") { e.preventDefault(); openComposer(); }
      else if (k === "t") setAnchor(new Date());
      else if (k === "arrowleft" && view !== "list") step(-1);
      else if (k === "arrowright" && view !== "list") step(1);
      else if (k === "w") setView("week");
      else if (k === "m") setView("month");
      else if (k === "l") setView("list");
      else if (k === "/") { e.preventDefault(); agentRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Briefing ----------------------------------------------------------
  const [briefing, setBriefing] = useState(readBriefingPref);
  const toggleBriefing = () => {
    setBriefing((b) => {
      try { localStorage.setItem(BRIEFING_KEY, b ? "0" : "1"); } catch { /* private mode */ }
      return !b;
    });
  };

  // ---- List view data ----------------------------------------------------
  const lists = useMemo<Record<ListTab, SchedulerPost[]>>(() => {
    const t = Date.now() - 3600_000;
    return {
      upcoming: posts.filter((p) => (p.status === "pending" || p.status === "publishing") && p.at.getTime() >= t),
      approval: (attention?.drafts ?? []).filter((p) => !platformFilter || p.platforms.some((pl) => platformFilter.includes(pl))),
      published: posts.filter((p) => p.status === "published"),
      failed: (attention?.failed ?? []).filter((p) => !platformFilter || p.platforms.some((pl) => platformFilter.includes(pl))),
    };
  }, [posts, attention, platformFilter]);

  // ---- Gating ------------------------------------------------------------
  const header = (
    <div className="ml-auto">
      <UserProfileMenu />
    </div>
  );
  if (!canPublish) {
    return (
      <AppLayout header={header}>
        <div className="mx-auto max-w-md p-8 pt-16">
          {showUpgradePrompts ? <UpgradePrompt feature="publishing" variant="card" /> : <p className="text-center text-muted-foreground">This feature is not available for your organization.</p>}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout header={header}>
      <div className="flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto flex max-w-[1680px] flex-col gap-4">
          {/* Title */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <CalendarDays className="h-6 w-6 text-primary" /> Scheduler
              </h1>
              <p className="text-sm text-muted-foreground">Every post across your channels, by you, your autopilots and your agent, on one calendar.</p>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label="Keyboard shortcuts">
                    <Keyboard className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs leading-relaxed">
                  <div><b>C</b> new post · <b>/</b> ask the agent</div>
                  <div><b>←</b> <b>→</b> move · <b>T</b> today</div>
                  <div><b>W</b> week · <b>M</b> month · <b>L</b> list</div>
                  <div><b>⌘ Enter</b> schedule from the composer</div>
                </TooltipContent>
              </Tooltip>
              <ConnectAccountMenu />
              <Button variant="cta" onClick={() => openComposer()}>
                <Plus className="mr-1.5 h-4 w-4" /> Create post
              </Button>
            </div>
          </div>

          <AgentBar
            ref={agentRef}
            accounts={accounts}
            defaultRange={defaultAgentRange}
            running={plan.isPending}
            onPlan={runPlan}
            proposals={proposals}
            summary={agentSummary}
            onDismissSummary={() => setAgentSummary(null)}
            onApproveAll={() => approve.mutate(proposals, { onSuccess: () => setAgentSummary(null) })}
            onDiscardAll={() => setConfirmDiscard(true)}
            onReview={() => {
              setListTab("approval");
              setView("list");
            }}
            approving={approve.isPending}
            value={agentInput}
            onValueChange={setAgentInput}
          />

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {view !== "list" && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => step(-1)} aria-label="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => step(1)} aria-label="Next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
            <h2 className="text-lg font-semibold tabular-nums">{rangeLabel}</h2>
            {isFetching && !isLoading && <RefreshCcw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className="hidden text-xs text-muted-foreground md:inline">{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")}</span>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {view === "week" && (
                <span className="hidden items-center gap-3 text-[11px] text-muted-foreground lg:flex">
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-[hsl(var(--status-success)/0.14)]" />Peak time</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-dashed border-[hsl(var(--status-purple))]/60 bg-[hsl(var(--status-purple-bg))]" />Proposal</span>
                  <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm border border-dashed border-primary/40" />Autopilot run</span>
                </span>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("gap-1.5", platformFilter && "border-foreground/60")}>
                    <Filter className="h-3.5 w-3.5" />
                    {platformFilter ? `${platformFilter.length} channel${platformFilter.length === 1 ? "" : "s"}` : "All channels"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-2">
                  {filterPlatforms.length === 0 && <p className="px-2 py-2 text-sm text-muted-foreground">No channels yet.</p>}
                  {filterPlatforms.map((p) => {
                    const on = !platformFilter || platformFilter.includes(p);
                    return (
                      <label key={p} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                        <Checkbox
                          checked={on}
                          onCheckedChange={() => {
                            const current = platformFilter ?? filterPlatforms;
                            const next = on ? current.filter((x) => x !== p) : [...current, p];
                            setPlatformFilter(next.length === filterPlatforms.length || next.length === 0 ? null : next);
                          }}
                        />
                        <PlatformGlyph platform={p} />
                        {ruleFor(p).label}
                      </label>
                    );
                  })}
                </PopoverContent>
              </Popover>
              <div className="flex rounded-lg border p-0.5">
                {([
                  ["week", CalendarDays, "Week"],
                  ["month", LayoutGrid, "Month"],
                  ["list", List, "List"],
                ] as const).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
                      view === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={view === v}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="icon" className="hidden h-9 w-9 xl:inline-flex" onClick={toggleBriefing} aria-label={briefing ? "Hide briefing" : "Show briefing"}>
                {briefing ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Main */}
          <div className={cn("grid gap-4", briefing && "xl:grid-cols-[minmax(0,1fr)_300px]")}>
            <div className="h-[max(560px,calc(100vh-330px))] min-w-0">
              {isLoading ? (
                <div className="grid h-full place-items-center rounded-xl border bg-card">
                  <RefreshCcw className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
                  {view === "week" && (
                    <WeekView
                      days={days}
                      posts={posts}
                      projections={projections}
                      heatPlatforms={heatPlatforms}
                      onOpen={(post) => openComposer({ post })}
                      onCreate={(at) => openComposer({ at })}
                      onOpenAutopilot={(id) => navigate(`/autopilots/${id}`)}
                      selectedKey={composer.open ? composer.post?.key : null}
                    />
                  )}
                  {view === "month" && (
                    <MonthView
                      month={anchor}
                      days={days}
                      posts={posts}
                      projections={projections}
                      onOpen={(post) => openComposer({ post })}
                      onCreateOnDay={(day) => {
                        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, 0);
                        openComposer({ at: at > new Date() ? at : undefined });
                      }}
                      onShowDay={(day) => {
                        setAnchor(day);
                        setView("week");
                      }}
                      selectedKey={composer.open ? composer.post?.key : null}
                    />
                  )}
                  {view === "list" && (
                    <ListView
                      tab={listTab}
                      onTabChange={setListTab}
                      lists={lists}
                      accountsById={accountsById}
                      onOpen={(post) => openComposer({ post })}
                      onApprove={(ps) => approve.mutate(ps)}
                      onRetry={(ps) => retry.mutate(ps)}
                      onDelete={(ps) => remove.mutate(ps)}
                      busy={approve.isPending || retry.isPending || remove.isPending}
                    />
                  )}
                  <DragOverlay dropAnimation={null}>{dragging ? <PostCardGhost post={dragging} /> : null}</DragOverlay>
                </DndContext>
              )}
            </div>
            {briefing && (
              <div className="hidden h-[max(560px,calc(100vh-330px))] xl:block">
                <BriefingPanel
                  periodLabel={view === "list" ? "Last 2 weeks and next 45 days" : view === "month" ? format(anchor, "MMMM") : "This week"}
                  posts={posts}
                  insights={insights}
                  onInsightAction={onInsightAction}
                  onOpen={(post) => openComposer({ post })}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <PostComposer
        open={composer.open}
        onOpenChange={(open) => setComposer((c) => ({ ...c, open }))}
        post={composerPost}
        initialAt={composer.at}
        prefill={composer.prefill}
        accounts={accounts}
        knownAccounts={allAccounts}
        replacedBy={replacedBy}
        busy={busy}
        onDuplicate={(prefill) => openComposer({ prefill })}
      />

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard {proposals.length} proposal{proposals.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>They come off the calendar. Approved and scheduled posts stay as they are.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate(proposals, { onSuccess: () => setAgentSummary(null) })}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
