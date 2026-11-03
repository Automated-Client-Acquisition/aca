import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, ArrowLeft, Loader2, Pause, Pin, Play, Plus, ShieldCheck, Trash2, X, Zap } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useAuth } from "@/contexts/AuthContext";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useIdeas } from "@/hooks/useIdeas";
import { useIdeaTags, useIdeasCountByTag } from "@/hooks/useIdeaTags";
import {
  useAutopilotRotationHistory,
  useAutopilots,
  useCreateAutopilot,
  useDeleteAutopilot,
  useRecentPublishes,
  useToggleAutopilotStatus,
  useTriggerAutopilot,
  useUpdateAutopilot,
} from "@/hooks/useAutopilots";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { AutopilotIdeasStatus } from "@/components/autopilot/AutopilotIdeasStatus";
import { AutopilotFeedCard } from "@/components/autopilot/AutopilotFeedCard";
import { AccountChips } from "@/components/autopilot/AccountChips";
import { WeekPlanner } from "@/components/autopilot/WeekPlanner";
import { MixEditor } from "@/components/autopilot/MixEditor";
import { getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import { Segmented } from "@/components/blueprint-studio/StudioSection";
import { WEEKDAYS, describeDays, describeInterval, firstRunAt } from "@/lib/autopilot-schedule";
import {
  type PlanForm,
  type Posting,
  type ScheduleKind,
  type Topics,
  TIME_OPTIONS,
  describeMix,
  firstRunFor,
  formToPlan,
  isShown,
  joinNames,
  mixColor,
  mixToSave,
  newPlanForm,
  planFormFrom,
  plannedPerWeek,
  projectPlan,
  rotatingPerWeek,
  scheduleFields,
  shares,
  slotsFromTimes,
  timesForInterval,
} from "@/lib/autopilot-plan";
import { IDEA_REPEAT_COOLDOWN_DAYS } from "@/lib/idea-feeds";
import type { Autopilot, UpdateAutopilotInput } from "@/types/autopilot";
import { cn } from "@/lib/utils";

function allTimezones(current: string): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list.includes(current) ? list : [current, ...list];
  } catch {
    /* older browsers */
  }
  return [current, "UTC", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Singapore", "Australia/Sydney"];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type SectionId = "where" | "when" | "what" | "topics";

function Section({
  id,
  sectionRef,
  n,
  title,
  aside,
  children,
}: {
  id: SectionId;
  sectionRef: React.RefObject<HTMLElement>;
  n: number;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section ref={sectionRef} aria-labelledby={`ap-${id}`} className="scroll-mt-4 space-y-3 rounded-xl border bg-card p-5 transition-shadow">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-xs font-bold text-muted-foreground">{n}</span>
        <h2 id={`ap-${id}`} className="text-[15px] font-semibold">{title}</h2>
        {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1 p-8">{children}</div>
    </AppLayout>
  );
}

export default function AutopilotEditor() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { data: autopilots, isLoading } = useAutopilots();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const autopilot = id ? autopilots?.find((a) => a.id === id) ?? null : null;

  if (!hasFeature("autopilots")) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md py-12">
          {showUpgradePrompts ? (
            <UpgradePrompt feature="autopilots" variant="card" />
          ) : (
            <p className="text-center text-muted-foreground">Autopilots are not available for your organization.</p>
          )}
        </div>
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <Skeleton className="mx-auto h-96 max-w-5xl" />
      </PageShell>
    );
  }

  if (id && !autopilot) {
    return (
      <PageShell>
        <div className="mx-auto max-w-md space-y-3 py-16 text-center">
          <h1 className="text-xl font-semibold">Autopilot not found</h1>
          <Button variant="outline" asChild><Link to="/autopilots">Back to Autopilots</Link></Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PlanEditor
      key={autopilot?.id ?? "new"}
      autopilot={autopilot}
      blueprintId={searchParams.get("blueprint")}
      accountId={searchParams.get("account")}
      others={(autopilots ?? []).filter((a) => a.id !== autopilot?.id && a.status === "active")}
    />
  );
}

function PlanEditor({
  autopilot,
  blueprintId,
  accountId,
  others,
}: {
  autopilot: Autopilot | null;
  blueprintId: string | null;
  accountId: string | null;
  others: Autopilot[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();
  const { data: blueprints = [] } = useBlueprints();
  const { ideas } = useIdeas();
  const { data: tagRows = [] } = useIdeaTags();
  const { data: tagCounts = {} } = useIdeasCountByTag();
  const { accounts, isLoading: accountsLoading } = useConnectedAccounts();
  const createAutopilot = useCreateAutopilot();
  const updateAutopilot = useUpdateAutopilot();
  const deleteAutopilot = useDeleteAutopilot();
  const toggleStatus = useToggleAutopilotStatus();
  const trigger = useTriggerAutopilot();
  const { data: recentPublishes = [] } = useRecentPublishes(autopilot?.id);
  const { data: historyByAutopilot = {} } = useAutopilotRotationHistory(autopilot ? [autopilot.id] : []);

  const [baseline, setBaseline] = useState<PlanForm>(() =>
    autopilot ? planFormFrom(autopilot) : newPlanForm({ blueprintId, accountId }),
  );
  const [form, setForm] = useState<PlanForm>(baseline);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K] | ((prev: PlanForm[K]) => PlanForm[K])) =>
    setForm((f) => ({ ...f, [key]: typeof value === "function" ? (value as (p: PlanForm[K]) => PlanForm[K])(f[key]) : value }));

  const refs: Record<SectionId, React.RefObject<HTMLElement>> = {
    where: useRef<HTMLElement>(null),
    when: useRef<HTMLElement>(null),
    what: useRef<HTMLElement>(null),
    topics: useRef<HTMLElement>(null),
  };
  const focusSection = (key: SectionId) => {
    const el = refs[key].current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("ring-2");
    void el.offsetWidth;
    el.classList.add("ring-2", "ring-cta");
    setTimeout(() => el.classList.remove("ring-2", "ring-cta"), 1200);
  };

  const isActive = autopilot?.status === "active";
  const blueprintById = useMemo(() => new Map(blueprints.map((b) => [b.id, b])), [blueprints]);
  const shownMix = form.mix.map((m, index) => ({ m, index })).filter(({ m }) => isShown(m));
  const colorByIndex = new Map(shownMix.map(({ index }, pos) => [index, mixColor(pos)]));
  const colorOfBlueprint = (id: string | null) => {
    const hit = shownMix.find(({ m }) => m.blueprint_id === id);
    return hit ? colorByIndex.get(hit.index)! : "hsl(var(--muted-foreground))";
  };
  const nameOf = (id: string | null) => (id ? blueprintById.get(id)?.name ?? "Deleted blueprint" : "Nothing to post");
  const accountName = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    return acc ? acc.name || acc.username || getPlatformConfig(acc.platform).label : "an account";
  };
  const tagNames = useMemo(() => tagRows.map((t) => t.name), [tagRows]);

  const plan = formToPlan(form, autopilot);
  const perWeek = plannedPerWeek(plan);
  const rotating = rotatingPerWeek(form, plan);
  const shareInfo = shares(form);
  const hasPins = form.scheduleKind === "plan" && form.slots.some((s) => s.blueprint_id && shownMix.some(({ m }) => m.blueprint_id === s.blueprint_id));
  const enabledDestinations = form.posting === "publish" ? form.destinations.filter((d) => d.enabled) : [];

  // The next two weeks of posts, with the blueprint each gets.
  const now = useMemo(() => new Date(), []);
  const posts = useMemo(
    () =>
      projectPlan(plan, {
        from: now,
        until: new Date(now.getTime() + 14 * 86_400_000),
        history: autopilot ? historyByAutopilot[autopilot.id] ?? [] : [],
        blueprints: blueprintById,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(plan), historyByAutopilot, blueprintById, now],
  );
  const tz = plan.timezone || form.timezone;
  const fmtDay = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);
  const fmtTime = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: tz }).format(d);
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).format(d);
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(now.getTime() + i * 86_400_000);
    return { key: dayKey(day), label: new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", timeZone: tz }).format(day), posts: posts.filter((p) => dayKey(p.at) === dayKey(day)) };
  });

  // Another autopilot posting to the same account within the hour.
  const clashes = useMemo(() => {
    if (enabledDestinations.length === 0) return [] as string[];
    const until = new Date(now.getTime() + 7 * 86_400_000);
    const mine = posts.filter((p) => p.at <= until);
    const out = new Set<string>();
    for (const other of others) {
      const theirs = projectPlan(other, { from: now, until, blueprints: blueprintById });
      for (const p of mine) {
        for (const q of theirs) {
          if (Math.abs(p.at.getTime() - q.at.getTime()) > 60 * 60_000) continue;
          const shared = p.to.find((d) => q.to.some((e) => e.account_id === d.account_id));
          if (shared) out.add(`${other.name} also posts to ${accountName(shared.account_id)} on ${fmtDay(p.at)} around ${fmtTime(p.at)}.`);
        }
      }
    }
    return [...out].slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, others, blueprintById, now]);

  // Ideas this autopilot draws from, and how many still need their guidelines approved.
  // Tags that were deleted match nothing, and the scheduler then takes any idea.
  const liveSharedTags = form.sharedTags.filter((t) => tagNames.includes(t));
  const topicTags = form.topics === "shared"
    ? liveSharedTags
    : shownMix.some(({ m }) => !(m.idea_tags ?? []).length)
      ? []
      : [...new Set(shownMix.flatMap(({ m }) => m.idea_tags ?? []))];
  const matchingIdeas = topicTags.length ? ideas.filter((i) => (i.tags ?? []).some((t) => topicTags.includes(t.name))) : ideas;
  const unapprovedIdeas = matchingIdeas.filter((i) => !i.guidelines_approved_at).length;
  const readyIdeas = form.onlyApproved ? matchingIdeas.length - unapprovedIdeas : matchingIdeas.length;
  const weeksOfIdeas = perWeek > 0 ? Math.floor(readyIdeas / perWeek) : 0;

  const problems: string[] = [];
  if (form.scheduleKind === "times" && form.days.length === 0) problems.push("Pick at least one day.");
  if (form.scheduleKind === "times" && form.times.length === 0) problems.push("Pick at least one time.");
  if (form.scheduleKind === "plan" && form.slots.length === 0) problems.push("Add at least one time to the week.");
  if (shownMix.length === 0) problems.push("Add a blueprint.");
  if (form.posting === "publish" && enabledDestinations.length === 0) problems.push("Pick an account to post to, or keep drafts.");
  if (shownMix.length > 0 && rotating > 0 && shownMix.every(({ m }) => !(m.weight > 0)) && hasPins) {
    problems.push("Unpinned slots need a blueprint in the rotation: give one a share above 0.");
  }

  const scheduleChanged =
    form.scheduleKind !== baseline.scheduleKind ||
    !same(form.days, baseline.days) ||
    !same(form.times, baseline.times) ||
    !same(form.slots, baseline.slots) ||
    form.timezone !== baseline.timezone;
  const mixChanged = !same(form.mix, baseline.mix);
  const topicsChanged = form.topics !== baseline.topics || !same(form.sharedTags, baseline.sharedTags);
  const postingChanged = form.posting !== baseline.posting || !same(form.destinations, baseline.destinations);
  const dirty =
    form.name !== baseline.name ||
    form.recycle !== baseline.recycle ||
    form.onlyApproved !== baseline.onlyApproved ||
    scheduleChanged ||
    mixChanged ||
    topicsChanged ||
    postingChanged;
  const saving = createAutopilot.isPending || updateAutopilot.isPending;

  // Destinations carry the account's real platform (it routes the publish).
  const destinationsToSave = () =>
    form.posting === "publish"
      ? form.destinations.map((d) => ({ ...d, platform: accounts.find((a) => a.id === d.account_id)?.platform ?? d.platform }))
      : [];
  const defaultName = () => {
    const where = enabledDestinations.map((d) => accountName(d.account_id));
    const first = nameOf(shownMix[0]?.m.blueprint_id ?? null);
    return where.length ? `${joinNames(where.slice(0, 2))} · ${shownMix.length > 1 ? `${shownMix.length} blueprints` : first}` : `${first} on autopilot`;
  };

  const turnOn = async () => {
    if (problems.length > 0) return;
    const created = await createAutopilot.mutateAsync({
      name: form.name.trim() || defaultName(),
      content_mix: mixToSave(form),
      ideas_source: form.topics === "per" ? "per_blueprint" : "shared",
      shared_idea_tags: form.topics === "shared" ? form.sharedTags : [],
      frequency: { amount: 1, unit: "day" },
      ...scheduleFields(form),
      destinations: destinationsToSave(),
      auto_reload_pool: form.recycle,
      only_approved_ideas: form.onlyApproved,
      next_run_at: firstRunFor(form, null).toISOString(),
    });
    await queryClient.refetchQueries({ queryKey: ["autopilots", currentOrganization?.id] });
    navigate(`/autopilots/${(created as Autopilot).id}`, { replace: true });
  };

  const save = async () => {
    if (!autopilot || problems.length > 0) return;
    // Send only what changed: older autopilots keep their interval, per-blueprint
    // settings and library selections unless that part is edited here.
    const patch: UpdateAutopilotInput = { id: autopilot.id };
    if (form.name !== baseline.name) patch.name = form.name.trim() || autopilot.name;
    if (form.recycle !== baseline.recycle) patch.auto_reload_pool = form.recycle;
    if (form.onlyApproved !== baseline.onlyApproved) patch.only_approved_ideas = form.onlyApproved;
    if (mixChanged || topicsChanged) patch.content_mix = mixToSave(form);
    if (topicsChanged) {
      patch.ideas_source = form.topics === "per" ? "per_blueprint" : "shared";
      patch.shared_idea_tags = form.topics === "shared" ? form.sharedTags : [];
    }
    if (scheduleChanged && form.scheduleKind !== "interval") {
      Object.assign(patch, scheduleFields(form));
      patch.next_run_at = firstRunFor(form, autopilot).toISOString();
    }
    if (postingChanged) patch.destinations = destinationsToSave();
    await updateAutopilot.mutateAsync(patch);
    setBaseline(form);
  };

  const togglePause = () => {
    if (!autopilot) return;
    // Resume on the saved schedule's next slot rather than "a day from now".
    const next = autopilot.scheduling_mode === "scheduled" ? firstRunAt(autopilot) : undefined;
    toggleStatus.mutate({ id: autopilot.id, status: isActive ? "paused" : "active", next_run_at: next?.toISOString() });
  };

  const remove = async () => {
    if (!autopilot) return;
    await deleteAutopilot.mutateAsync(autopilot.id);
    navigate("/autopilots");
  };

  const removeEntry = (index: number) => {
    setForm((f) => {
      const gone = f.mix[index]?.blueprint_id;
      const mix = f.mix.filter((_, i) => i !== index);
      const stillThere = mix.some((m) => isShown(m) && m.blueprint_id === gone);
      return { ...f, mix, slots: stillThere ? f.slots : f.slots.map((s) => (s.blueprint_id === gone ? { ...s, blueprint_id: null } : s)) };
    });
  };

  const setScheduleKind = (kind: ScheduleKind) => {
    setForm((f) => {
      if (kind === f.scheduleKind) return f;
      if (kind === "plan") {
        return { ...f, scheduleKind: kind, slots: f.slots.length ? f.slots : slotsFromTimes(f.days, f.times) };
      }
      // Back to the same times every day: the plan's days and times, pins go back to the rotation.
      const days = f.slots.length ? [...new Set(f.slots.map((s) => s.day))] : f.days;
      const times = f.slots.length ? [...new Set(f.slots.map((s) => s.time))].sort() : f.times;
      return { ...f, scheduleKind: kind, days, times };
    });
  };

  const setTopics = (topics: Topics) => {
    setForm((f) => {
      if (topics === f.topics) return f;
      if (topics === "per") {
        return { ...f, topics, mix: f.mix.map((m) => (isShown(m) ? { ...m, idea_tags: m.idea_tags?.length ? m.idea_tags : f.sharedTags } : m)) };
      }
      const union = [...new Set(f.mix.filter(isShown).flatMap((m) => m.idea_tags ?? []))];
      return { ...f, topics, sharedTags: f.sharedTags.length ? f.sharedTags : union };
    });
  };

  const lastFinished = recentPublishes[0];
  const failedRecently = recentPublishes.filter((p) => p.status === "failed").length;

  // The whole plan as one sentence.
  const mixNames = shownMix.map(({ m }) => nameOf(m.blueprint_id));
  const pinnedNames = form.scheduleKind === "plan"
    ? [...new Set(form.slots.filter((s) => s.blueprint_id && shownMix.some(({ m }) => m.blueprint_id === s.blueprint_id)).map((s) => nameOf(s.blueprint_id!)))]
    : [];
  const whenText =
    form.scheduleKind === "interval" && autopilot
      ? describeInterval(autopilot).replace(/^Every/, "every")
      : form.scheduleKind === "plan"
        ? `${form.slots.length} time${form.slots.length === 1 ? "" : "s"} a week on your plan`
        : form.days.length && form.times.length
          ? `every ${describeDays(form.days)} at ${joinNames([...form.times].sort())}`
          : "[pick days and times]";
  const topicsText =
    form.topics === "per"
      ? "each blueprint's own topics"
      : liveSharedTags.length
        ? `ideas tagged ${liveSharedTags.join(" or ")}`
        : "any of my ideas";
  const whereText = enabledDestinations.length
    ? joinNames(enabledDestinations.map((d) => `${accountName(d.account_id)} on ${getPlatformConfig(accounts.find((a) => a.id === d.account_id)?.platform ?? d.platform).label}`))
    : "[pick an account]";
  const mixText = `${describeMix(mixNames)}${pinnedNames.length ? `, with ${joinNames(pinnedNames)} in pinned slots` : ""}`;

  // Links, not buttons, so a long phrase wraps with the sentence.
  const Token = ({ children, to }: { children: React.ReactNode; to: SectionId }) => (
    <a
      href={`#ap-${to}`}
      onClick={(e) => {
        e.preventDefault();
        focusSection(to);
      }}
      className="rounded-sm font-bold underline decoration-cta decoration-2 underline-offset-4 hover:bg-cta/15"
    >
      {children}
    </a>
  );

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 lg:px-6">
          <Link to="/autopilots" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to Autopilots">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Link to="/autopilots" className="text-sm text-muted-foreground hover:text-foreground">Autopilots</Link>
          <span className="text-sm text-muted-foreground">/</span>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder={autopilot ? autopilot.name : "Name this autopilot"}
            aria-label="Autopilot name"
            className="h-8 w-64 max-w-full border-transparent px-2 text-sm font-semibold shadow-none hover:border-input focus-visible:border-input"
          />
          {autopilot && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-500" : "bg-amber-500")} />
              {isActive ? "On" : "Paused"}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {autopilot ? (
              <>
                <Button variant="outline" size="sm" onClick={() => trigger.mutate(autopilot.id)} disabled={trigger.isPending} title="Make one post now and post it when it's ready">
                  {trigger.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
                  Run now
                </Button>
                <Button variant="outline" size="sm" onClick={togglePause} disabled={toggleStatus.isPending}>
                  {isActive ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                  {isActive ? "Pause" : "Resume"}
                </Button>
                <Button variant="outline" size="icon" className="h-9 w-9 text-destructive hover:bg-destructive/10" onClick={() => setConfirmDelete(true)} aria-label="Delete autopilot">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <Button variant="cta" size="sm" onClick={save} disabled={!dirty || problems.length > 0 || saving}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save changes
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/autopilots">Cancel</Link>
                </Button>
                <Button variant="cta" size="sm" onClick={turnOn} disabled={problems.length > 0 || saving}>
                  {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
                  Turn on
                </Button>
              </>
            )}
          </div>
        </div>

        <div className="mx-auto max-w-[1240px] space-y-5 p-4 lg:p-6">
          {autopilot && !isActive && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
              <Pause className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                {autopilot.paused_reason ? (
                  <><span className="font-semibold">Paused automatically.</span> {autopilot.paused_reason}</>
                ) : (
                  "Paused. It won't write or post anything until you resume it."
                )}
              </span>
            </div>
          )}

          {lastFinished?.status === "failed" && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                <span className="font-semibold">
                  {failedRecently === recentPublishes.length && failedRecently > 1
                    ? `The last ${failedRecently} posts didn't go out.`
                    : "The last post didn't go out."}
                </span>{" "}
                {lastFinished.last_error || "The platform rejected it."}{" "}
                <Link to="/publish-queue" className="font-semibold underline underline-offset-2">Open Publish Queue</Link>
              </span>
            </div>
          )}

          <div className="rounded-xl border bg-card p-5 text-lg leading-relaxed sm:text-xl">
            {form.posting === "publish" ? (
              <>
                Post to <Token to="where">{whereText}</Token> <Token to="when">{whenText}</Token>: <Token to="what">{mixText}</Token>, about{" "}
                <Token to="topics">{topicsText}</Token>.
              </>
            ) : (
              <>
                <Token to="when">{whenText.charAt(0).toUpperCase() + whenText.slice(1)}</Token>, write <Token to="what">{mixText}</Token> about{" "}
                <Token to="topics">{topicsText}</Token>, and <Token to="where">keep them as drafts for me to review</Token>.
              </>
            )}
          </div>

          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-5">
              <Section id="where" sectionRef={refs.where} n={1} title="Where it posts">
                <Segmented<Posting>
                  ariaLabel="When a piece is ready"
                  options={[
                    { id: "publish", label: "Post automatically" },
                    { id: "draft", label: "Keep as drafts" },
                  ]}
                  value={form.posting}
                  onChange={(v) => set("posting", v)}
                />
                {form.posting === "publish" ? (
                  <AccountChips accounts={accounts} value={form.destinations} onChange={(v) => set("destinations", v)} loading={accountsLoading} />
                ) : (
                  <p className="text-sm text-muted-foreground">Finished pieces wait in Content for you to review, edit and schedule.</p>
                )}
                {clashes.length > 0 && (
                  <ul className="space-y-1 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    {clashes.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                )}
              </Section>

              <Section id="when" sectionRef={refs.when} n={2} title="When" aside={perWeek > 0 ? `${form.scheduleKind === "interval" ? "About " : ""}${perWeek} post${perWeek === 1 ? "" : "s"} a week` : undefined}>
                {form.scheduleKind === "interval" && autopilot ? (
                  <div className="space-y-2">
                    <p className="text-sm">{describeInterval(autopilot)}.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setForm((f) => ({ ...f, scheduleKind: "times", ...timesForInterval(autopilot) }))}
                    >
                      Switch to set days and times
                    </Button>
                  </div>
                ) : (
                  <>
                    <Segmented<"times" | "plan">
                      ariaLabel="Schedule type"
                      options={[
                        { id: "times", label: "Same times every day" },
                        { id: "plan", label: "Plan each day" },
                      ]}
                      value={form.scheduleKind === "plan" ? "plan" : "times"}
                      onChange={setScheduleKind}
                    />
                    {form.scheduleKind === "times" ? (
                      <>
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-foreground/80">Days</div>
                          <div className="flex flex-wrap gap-1.5">
                            {WEEKDAYS.map((d) => {
                              const on = form.days.includes(d.id);
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  aria-pressed={on}
                                  onClick={() => set("days", (s) => (on ? s.filter((x) => x !== d.id) : [...s, d.id]))}
                                  className={cn("min-h-8 w-12 rounded-full border text-xs", on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}
                                >
                                  {d.short}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-xs font-semibold text-foreground/80">Times</div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {[...form.times].sort().map((t) => (
                              <span key={t} className="inline-flex items-center gap-1 rounded-full border border-foreground bg-foreground py-1 pl-3 pr-1.5 text-xs tabular-nums text-background">
                                {t}
                                <button type="button" onClick={() => set("times", (s) => s.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-background/20">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ))}
                            <Select value="" onValueChange={(v) => set("times", (s) => (s.includes(v) ? s : [...s, v].sort()))}>
                              <SelectTrigger className="h-7 w-auto gap-1 rounded-full border-dashed px-3 text-xs" aria-label="Add a time">
                                <Plus className="h-3 w-3" />
                                <span>Add time</span>
                              </SelectTrigger>
                              <SelectContent className="max-h-64">
                                {TIME_OPTIONS.filter((t) => !form.times.includes(t)).map((t) => (
                                  <SelectItem key={t} value={t} className="text-xs tabular-nums">{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <WeekPlanner
                          slots={form.slots}
                          onChange={(v) => set("slots", v)}
                          blueprints={shownMix.map(({ m, index }) => ({ blueprint_id: m.blueprint_id, name: nameOf(m.blueprint_id), color: colorByIndex.get(index)! }))}
                        />
                        <p className="text-xs text-muted-foreground">
                          A slot set to Rotate takes the next blueprint in the mix. A pinned slot always runs its blueprint, and falls back to the mix when that one has no ideas left.
                        </p>
                      </>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Time zone</span>
                      <Select value={form.timezone} onValueChange={(v) => set("timezone", v)}>
                        <SelectTrigger className="h-7 w-64 text-xs" aria-label="Time zone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {allTimezones(form.timezone).map((zone) => (
                            <SelectItem key={zone} value={zone} className="text-xs">{zone}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground">It starts writing an hour early, so each post goes out on time.</span>
                    </div>
                  </>
                )}
              </Section>

              <Section id="what" sectionRef={refs.what} n={3} title="What it posts" aside={shownMix.length > 1 ? "Blueprints take turns by share" : undefined}>
                <MixEditor
                  mix={form.mix}
                  onChange={(v) => set("mix", v)}
                  onRemove={removeEntry}
                  blueprints={blueprints}
                  colorOf={(pos) => mixColor(pos)}
                  shareInfo={shareInfo}
                  rotatingPerWeek={rotating}
                  hasPins={hasPins}
                  plan={plan}
                  posting={form.posting}
                  accounts={accounts}
                  topics={form.topics}
                  tags={tagNames}
                  tagCounts={tagCounts}
                />
              </Section>

              <Section id="topics" sectionRef={refs.topics} n={4} title="Topics">
                <Segmented<Topics>
                  ariaLabel="Topic source"
                  options={[
                    { id: "shared", label: "Same for every blueprint" },
                    { id: "per", label: "Each blueprint its own" },
                  ]}
                  value={form.topics}
                  onChange={setTopics}
                />
                {form.topics === "shared" ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Ideas tagged with any of these. None picked uses any idea, oldest first.</p>
                    {form.sharedTags.length > 0 && liveSharedTags.length === 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        {form.sharedTags.length === 1 ? "Its tag no longer exists" : "None of its tags exist any more"}, so it uses any of your ideas. Pick a tag to narrow it again.
                      </p>
                    )}
                    {tagNames.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No idea tags yet. <Link to="/ideas" className="underline underline-offset-2">Tag some ideas</Link>, or use any of your ideas.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {[...tagNames, ...form.sharedTags.filter((t) => !tagNames.includes(t))].map((tag) => {
                          const on = form.sharedTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              aria-pressed={on}
                              onClick={() => set("sharedTags", (s) => (on ? s.filter((x) => x !== tag) : [...s, tag]))}
                              className={cn("rounded-full border px-3 py-1 text-xs", on ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-muted")}
                            >
                              {tag} <span className="tabular-nums opacity-60">{tagCounts[tag] ?? 0}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Each blueprint row above shows its own topics. Use this when blueprints speak to different audiences.</p>
                )}
                {perWeek > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {readyIdeas} idea{readyIdeas === 1 ? "" : "s"} ready. At {perWeek} a week that lasts{" "}
                    {weeksOfIdeas < 1 ? "less than a week" : `about ${weeksOfIdeas} week${weeksOfIdeas === 1 ? "" : "s"}`}. Ideas you tag later are picked up too.
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={form.recycle} onCheckedChange={(v) => set("recycle", !!v)} />
                  When every idea has been used, start again from the top (an idea waits {IDEA_REPEAT_COOLDOWN_DAYS} days before it posts again)
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={form.onlyApproved} onCheckedChange={(v) => set("onlyApproved", !!v)} />
                  Only post ideas whose guidelines you approved
                </label>
                {form.onlyApproved && unapprovedIdeas > 0 && (
                  <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">
                    {unapprovedIdeas} of these idea{unapprovedIdeas === 1 ? " isn't" : "s aren't"} approved yet, so {unapprovedIdeas === 1 ? "it won't" : "they won't"} be posted.{" "}
                    <Link to={autopilot ? `/ideas?feed=${autopilot.id}&view=review` : "/ideas?view=review"} className="underline underline-offset-2">Review them</Link>
                  </p>
                )}
              </Section>

              <div className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                It checks your API key before every run and pauses itself after 2 failed runs in a row. The reason shows here.
              </div>

              {problems.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs text-amber-800 dark:text-amber-300">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </div>

            <aside className="min-w-0 space-y-4 lg:sticky lg:top-4" aria-label="Preview">
              <section className="space-y-3 rounded-xl border bg-card p-5" aria-labelledby="ap-week">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id="ap-week" className="text-sm font-semibold">{autopilot && !isActive ? "Next 7 days, once resumed" : "Next 7 days"}</h2>
                  <span className="text-xs text-muted-foreground">{tz}</span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {week.map((d) => (
                    <div key={d.key} className={cn("flex min-h-24 flex-col gap-1 rounded-md p-1", d.posts.length ? "bg-muted/60" : "bg-muted/20")}>
                      <span className="text-center text-[11px] font-semibold">{d.label}</span>
                      {d.posts.map((p) => (
                        <span
                          key={p.at.toISOString()}
                          className="block rounded px-1 py-0.5 text-center text-[10px] font-semibold leading-tight text-white"
                          style={{ background: colorOfBlueprint(p.blueprint_id) }}
                          title={`${fmtTime(p.at)} ${nameOf(p.blueprint_id)}`}
                        >
                          {fmtTime(p.at)}
                          <span className="block truncate font-normal">{nameOf(p.blueprint_id)}</span>
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2 rounded-xl border bg-card p-5" aria-labelledby="ap-next">
                <h2 id="ap-next" className="text-sm font-semibold">Next posts</h2>
                {autopilot && !isActive ? (
                  <p className="text-sm text-muted-foreground">Nothing runs while it's paused.</p>
                ) : posts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Pick a schedule and a blueprint to see what goes out when.</p>
                ) : (
                  <ol className="divide-y">
                    {posts.slice(0, 7).map((p) => (
                      <li key={p.at.toISOString()} className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 py-2.5 text-sm">
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {fmtDay(p.at)}
                          <span className="block font-semibold text-foreground">{form.scheduleKind === "interval" ? `about ${fmtTime(p.at)}` : fmtTime(p.at)}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOfBlueprint(p.blueprint_id) }} />
                            <span className="truncate">{nameOf(p.blueprint_id)}</span>
                            {p.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Pinned slot" />}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {form.posting === "draft"
                              ? "Draft, waits for your review"
                              : enabledDestinations.length === 0
                                ? "Pick an account to post to"
                                : p.to.length
                                  ? `Posts to ${joinNames([...new Set(p.to.map((d) => getPlatformConfig(d.platform).label))])}`
                                  : "None of its accounts can post this"}
                            {form.posting === "publish" && p.skipped.length > 0 && `, skips ${joinNames(p.skipped.map((s) => getPlatformConfig(s.destination.platform).label))}`}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                {autopilot?.last_run_at && (
                  <p className="text-xs text-muted-foreground">
                    Last ran {formatDistanceToNow(new Date(autopilot.last_run_at), { addSuffix: true })}. {autopilot.total_generated} made, {autopilot.total_published} posted.
                  </p>
                )}
              </section>

              {autopilot && <AutopilotIdeasStatus autopilotId={autopilot.id} />}

              <section className="space-y-1.5 rounded-xl bg-muted/50 p-4 text-xs text-muted-foreground" aria-labelledby="ap-how">
                <h2 id="ap-how" className="text-[13px] font-semibold text-foreground">How it picks</h2>
                <p>Each slot goes to the blueprint furthest behind its share, so a 2 : 1 : 1 mix runs A, B, C, A, then repeats. If a blueprint has no ideas left, the next one takes the slot.</p>
                <p>Accounts that can't take a piece are skipped for it: Instagram and TikTok need a picture or video, and articles only go to WordPress sites.</p>
              </section>
            </aside>
          </div>

          {autopilot && <AutopilotFeedCard autopilotId={autopilot.id} />}
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{autopilot?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops writing and posting. Content it already made stays in Content. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
