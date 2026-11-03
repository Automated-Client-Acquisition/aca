import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarClock, Pause, Play, Plus } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { PlatformIcon, getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import { useAutopilotRotationHistory, useAutopilots, useToggleAutopilotStatus } from "@/hooks/useAutopilots";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useConnectedAccounts, type ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { useAutopilotFuel } from "@/hooks/useIdeaFeeds";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { describeSchedule, firstRunAt } from "@/lib/autopilot-schedule";
import { type PlannedPost, isShown, joinNames, kindOf, mixColor, plannedPerWeek, projectPlan, routeFor } from "@/lib/autopilot-plan";
import { fuelAction, fuelDetail, fuelHeadline, fuelState, needsIdeas } from "@/lib/idea-feeds";
import { autopilotPath, newAutopilotPath } from "@/lib/blueprint-routes";
import { cn } from "@/lib/utils";
import type { Autopilot } from "@/types/autopilot";

const DAY = 86_400_000;
const DRAFTS = "__drafts__";

interface CellPost {
  at: Date;
  autopilotId: string;
  color: string;
  blueprint: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Autopilots() {
  const navigate = useNavigate();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const { data: autopilots, isLoading } = useAutopilots();
  const { data: blueprints = [] } = useBlueprints();
  const { accounts } = useConnectedAccounts();
  const { data: fuel = [] } = useAutopilotFuel();
  const toggleStatus = useToggleAutopilotStatus();

  const list = useMemo(
    () =>
      (autopilots ?? [])
        .filter((a) => a.status !== "archived")
        .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || b.created_at.localeCompare(a.created_at)),
    [autopilots],
  );
  const active = list.filter((a) => a.status === "active");
  const { data: history = {} } = useAutopilotRotationHistory(active.map((a) => a.id));
  const blueprintById = useMemo(() => new Map(blueprints.map((b) => [b.id, b])), [blueprints]);
  const colorOf = useMemo(() => new Map(list.map((a, i) => [a.id, mixColor(i)])), [list]);
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountName = (id: string) => {
    const acc = accountById.get(id);
    return acc ? acc.name || acc.username || getPlatformConfig(acc.platform).label : "Account not connected";
  };

  // The next 7 days of posts, per autopilot.
  const today = useMemo(() => startOfToday(), []);
  const until = useMemo(() => new Date(today.getTime() + 7 * DAY - 1), [today]);
  const projected = useMemo(() => {
    const out = new Map<string, PlannedPost[]>();
    for (const a of active) out.set(a.id, projectPlan(a, { from: new Date(), until, history: history[a.id] ?? [], blueprints: blueprintById }));
    return out;
  }, [active, history, blueprintById, until]);

  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * DAY));
  const dayIndex = (d: Date) => Math.floor((d.getTime() - today.getTime()) / DAY);

  // Rows: each account a running autopilot posts to, drafts, then connected accounts nothing posts to.
  const rows = useMemo(() => {
    const byAccount = new Map<string, CellPost[][]>();
    const cells = () => Array.from({ length: 7 }, () => [] as CellPost[]);
    for (const a of active) {
      for (const p of projected.get(a.id) ?? []) {
        const i = dayIndex(p.at);
        if (i < 0 || i > 6) continue;
        const entry: CellPost = {
          at: p.at,
          autopilotId: a.id,
          color: colorOf.get(a.id)!,
          blueprint: p.blueprint_id ? blueprintById.get(p.blueprint_id)?.name ?? "Deleted blueprint" : "No blueprint",
        };
        const targets = (a.destinations ?? []).some((d) => d.enabled) ? p.to.map((d) => d.account_id) : [DRAFTS];
        for (const id of targets) {
          if (!byAccount.has(id)) byAccount.set(id, cells());
          byAccount.get(id)![i].push(entry);
        }
      }
    }
    for (const c of byAccount.values()) for (const day of c) day.sort((x, y) => x.at.getTime() - y.at.getTime());
    return byAccount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projected, colorOf, blueprintById]);

  const usedAccounts = new Set(active.flatMap((a) => (a.destinations ?? []).filter((d) => d.enabled).map((d) => d.account_id)));
  const idle = accounts.filter((a) => a.isActive && a.isValid && !usedAccounts.has(a.id));
  const accountRows = [...rows.keys()].filter((id) => id !== DRAFTS);
  const clashCell = (posts: CellPost[]) =>
    posts.some((p, i) => posts.some((q, j) => j !== i && q.autopilotId !== p.autopilotId && Math.abs(q.at.getTime() - p.at.getTime()) <= 60 * 60_000));

  const fmtTime = (d: Date) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(d);
  const fmtDay = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(d);

  const togglePause = (a: Autopilot) => {
    const resume = a.status !== "active";
    toggleStatus.mutate({
      id: a.id,
      status: resume ? "active" : "paused",
      next_run_at: resume && a.scheduling_mode === "scheduled" ? firstRunAt(a).toISOString() : undefined,
    });
  };

  if (!hasFeature("autopilots")) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="mx-auto max-w-md flex-1 py-12">
          {showUpgradePrompts ? <UpgradePrompt feature="autopilots" variant="card" /> : <p className="text-center text-muted-foreground">Autopilots are not available for your organization.</p>}
        </div>
      </AppLayout>
    );
  }

  const accountLabel = (id: string, account?: ConnectedAccount) => {
    const posts = rows.get(id)?.reduce((n, d) => n + d.length, 0) ?? 0;
    if (id === DRAFTS) {
      return (
        <div className="min-w-0">
          <div className="text-sm font-medium">Drafts for review</div>
          <div className="text-xs text-muted-foreground">{posts} piece{posts === 1 ? "" : "s"} · not posted</div>
        </div>
      );
    }
    return (
      <div className="flex min-w-0 items-start gap-2.5">
        <PlatformIcon platform={account?.platform ?? "ghl"} size="sm" className="shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{accountName(id)}</div>
          <div className="text-xs text-muted-foreground">
            {account ? getPlatformConfig(account.platform).label : "Reconnect in Settings"} · {posts} post{posts === 1 ? "" : "s"}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1 p-6 lg:p-8">
        <div className="mx-auto max-w-[1400px] space-y-8">
          <PageHeader
            icon={CalendarClock}
            title="Autopilots"
            description="Each autopilot posts a mix of your blueprints to your accounts on a schedule."
            actions={
              <Button variant="cta" asChild>
                <Link to={newAutopilotPath()}>
                  <Plus className="mr-2 h-4 w-4" />
                  New autopilot
                </Link>
              </Button>
            }
          />

          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-64 w-full" />
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-56" />
                <Skeleton className="h-56" />
              </div>
            </div>
          ) : list.length === 0 ? (
            <div className="space-y-3 rounded-xl border border-dashed p-12 text-center">
              <h2 className="text-xl font-semibold">No autopilots yet</h2>
              <p className="mx-auto max-w-lg text-muted-foreground">
                Pick the accounts to post to, the days and times, and which blueprints take turns. It writes each post from your ideas and posts it on time, or keeps it as a draft for you.
              </p>
              <Button variant="cta" asChild>
                <Link to={newAutopilotPath()}>
                  <Plus className="mr-2 h-4 w-4" />
                  Start your first autopilot
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <section className="space-y-3" aria-labelledby="week-heading">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <h2 id="week-heading" className="text-base font-semibold">Next 7 days, by account</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {active.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorOf.get(a.id) }} />
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
                {active.length === 0 ? (
                  <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Every autopilot is paused, so nothing goes out this week.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border bg-card">
                    <div className="min-w-[960px]">
                      <div className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b bg-muted/40 text-xs">
                        <div className="px-3 py-2 text-muted-foreground">Account</div>
                        {days.map((d, i) => (
                          <div key={i} className="border-l px-2 py-2 font-semibold">
                            {new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(d)}
                            {i === 0 && <span className="ml-1 font-normal text-muted-foreground">Today</span>}
                          </div>
                        ))}
                      </div>
                      {[...accountRows, ...(rows.has(DRAFTS) ? [DRAFTS] : [])].map((id) => (
                        <div key={id} className="grid grid-cols-[200px_repeat(7,minmax(0,1fr))] border-b last:border-b-0">
                          <div className="px-3 py-2.5">
                            {accountLabel(id, accountById.get(id))}
                          </div>
                          {rows.get(id)!.map((posts, i) => {
                            const clash = id !== DRAFTS && clashCell(posts);
                            return (
                              <div key={i} className={cn("min-h-[72px] space-y-1 border-l p-1.5", clash && "bg-amber-500/10")}>
                                {posts.map((p, k) => (
                                  <Link
                                    key={k}
                                    to={autopilotPath({ id: p.autopilotId })}
                                    className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] leading-tight hover:bg-muted"
                                    title={`${fmtTime(p.at)} · ${p.blueprint} · ${list.find((a) => a.id === p.autopilotId)?.name ?? ""}`}
                                  >
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} />
                                    <span className="tabular-nums text-muted-foreground">{fmtTime(p.at)}</span>
                                    <span className="truncate">{p.blueprint}</span>
                                  </Link>
                                ))}
                                {clash && <p className="px-1 text-[10px] font-semibold text-amber-800 dark:text-amber-300">2 posts within an hour</p>}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                      {idle.map((acc) => (
                        <div key={acc.id} className="grid grid-cols-[200px_minmax(0,1fr)] border-b last:border-b-0">
                          <div className="flex items-start gap-2.5 px-3 py-2.5">
                            <PlatformIcon platform={acc.platform} size="sm" className="shrink-0" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{acc.name || acc.username}</div>
                              <div className="text-xs text-muted-foreground">{getPlatformConfig(acc.platform).label} · no posts</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 border-l px-3 text-sm text-muted-foreground">
                            Nothing posts here.
                            <Link to={newAutopilotPath({ accountId: acc.id })} className="font-medium text-foreground underline underline-offset-2">
                              Start an autopilot for this account
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Your local time. Days-and-times autopilots post on the minute; older "every N hours" ones post around the times shown. Paused autopilots aren't shown.
                </p>
              </section>

              <section className="space-y-3" aria-labelledby="plans-heading">
                <h2 id="plans-heading" className="text-base font-semibold">Your autopilots</h2>
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {list.map((a) => {
                    const isActive = a.status === "active";
                    const shown = (a.content_mix ?? []).filter(isShown);
                    const total = shown.reduce((n, m) => n + Math.max(0, m.weight || 0), 0);
                    const where = (a.destinations ?? []).filter((d) => d.enabled);
                    const perWeek = plannedPerWeek(a);
                    const next = projected.get(a.id)?.[0];
                    const f = fuel.find((x) => x.autopilot_id === a.id);
                    const state = f ? fuelState(f, { ignorePause: true }) : null;
                    const warnings: Array<{ title: string; text: string; href?: string; cta?: string }> = [];
                    if (!isActive) {
                      warnings.push({
                        title: a.paused_reason ? "Paused automatically." : "Paused.",
                        text: a.paused_reason ?? "It won't write or post until you resume it.",
                      });
                    }
                    if (f && state && needsIdeas(state)) {
                      warnings.push({ title: `${fuelHeadline(f, state)}.`, text: fuelDetail(f, state), ...fuelAction(a.id, state) });
                    }
                    // One line per account a blueprint can't post to, naming the blueprints it skips.
                    const skips = new Map<string, { reason: string; blueprints: string[] }>();
                    for (const m of shown) {
                      const bp = blueprintById.get(m.blueprint_id);
                      for (const s of routeFor(a, m, kindOf(bp, m)).skipped) {
                        const hit = skips.get(s.destination.account_id) ?? { reason: s.reason, blueprints: [] };
                        hit.blueprints.push(bp?.name ?? "a deleted blueprint");
                        skips.set(s.destination.account_id, hit);
                      }
                    }
                    for (const [accountId, s] of skips) {
                      const which = s.blueprints.length === shown.length ? "any of its blueprints" : joinNames(s.blueprints);
                      warnings.push({ title: `Skips ${accountName(accountId)} for ${which}.`, text: `${s.reason}.` });
                    }
                    const clashDays = isActive
                      ? [...rows.entries()].filter(([id]) => id !== DRAFTS).flatMap(([, cells]) => cells.filter((posts) => clashCell(posts) && posts.some((p) => p.autopilotId === a.id)))
                      : [];
                    if (clashDays.length) {
                      const other = clashDays[0].find((p) => p.autopilotId !== a.id);
                      const otherName = list.find((x) => x.id === other?.autopilotId)?.name ?? "another autopilot";
                      warnings.push({ title: "Shares a slot.", text: `${otherName} posts to the same account within an hour of it.` });
                    }

                    return (
                      <article
                        key={a.id}
                        className="flex cursor-pointer flex-col gap-4 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md"
                        onClick={() => navigate(autopilotPath(a))}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(a.id) }} aria-hidden />
                              <h3 className="line-clamp-2 text-[15px] font-semibold">
                                <Link to={autopilotPath(a)} onClick={(e) => e.stopPropagation()} className="hover:underline">{a.name}</Link>
                              </h3>
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                                  isActive ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                                )}
                              >
                                {isActive ? "On" : "Paused"}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {where.length ? (
                                <>Posts to <span className="font-medium text-foreground">{joinNames(where.map((d) => accountName(d.account_id)))}</span></>
                              ) : (
                                "Keeps drafts for review"
                              )}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {describeSchedule(a)} · <span className="tabular-nums">{perWeek} a week</span>
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            disabled={toggleStatus.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePause(a);
                            }}
                          >
                            {isActive ? <Pause className="mr-1.5 h-3.5 w-3.5" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
                            {isActive ? "Pause" : "Resume"}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                            {shown.map((m, i) => (
                              <span key={i} style={{ flexGrow: total > 0 ? Math.max(m.weight || 0, 0.15) : 1, background: mixColor(i) }} />
                            ))}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                            {shown.map((m, i) => (
                              <span key={i} className="inline-flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-sm" style={{ background: mixColor(i) }} />
                                {blueprintById.get(m.blueprint_id)?.name ?? "Deleted blueprint"}
                                <span className="tabular-nums text-muted-foreground">
                                  {total > 0 ? (m.weight > 0 ? `${Math.round((m.weight / total) * 100)}%` : "pinned") : `${Math.round(100 / shown.length)}%`}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                          {f && state && !needsIdeas(state) && <span>{fuelHeadline(f, state)}</span>}
                          <span>
                            {next
                              ? `Next: ${fmtDay(next.at)}, ${fmtTime(next.at)}, ${next.blueprint_id ? blueprintById.get(next.blueprint_id)?.name ?? "a blueprint" : "a blueprint"}`
                              : isActive
                                ? "Nothing in the next 7 days"
                                : "Not running"}
                          </span>
                        </div>

                        {warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                            <span>
                              <span className="font-semibold">{w.title}</span> {w.text}{" "}
                              {w.href && (
                                <Link to={w.href} onClick={(e) => e.stopPropagation()} className="font-semibold underline underline-offset-2">
                                  {w.cta}
                                </Link>
                              )}
                            </span>
                          </div>
                        ))}
                      </article>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
