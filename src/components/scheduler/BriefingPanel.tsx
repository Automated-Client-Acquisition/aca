import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Info, Lightbulb, Sparkles, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCount, ruleFor, type Insight, type SchedulerPost } from "@/lib/scheduler";
import { PlatformGlyph, PlatformStack } from "./PlatformGlyph";
import { StatusIcon } from "./PostCard";

const TONE: Record<Insight["tone"], { icon: typeof Info; className: string }> = {
  danger: { icon: AlertTriangle, className: "text-[hsl(var(--status-error))]" },
  warning: { icon: Lightbulb, className: "text-amber-600 dark:text-amber-400" },
  info: { icon: Sparkles, className: "text-[hsl(var(--status-purple))]" },
  success: { icon: CheckCircle2, className: "text-[hsl(var(--status-success))]" },
};

interface BriefingPanelProps {
  periodLabel: string;
  posts: SchedulerPost[];
  insights: Insight[];
  onInsightAction: (insight: Insight) => void;
  onOpen: (post: SchedulerPost) => void;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <div className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function BriefingPanel({ periodLabel, posts, insights, onInsightAction, onOpen }: BriefingPanelProps) {
  const now = Date.now();
  const scheduled = posts.filter((p) => p.status === "pending" || p.status === "publishing").length;
  const published = posts.filter((p) => p.status === "published").length;
  const drafts = posts.filter((p) => p.status === "draft").length;
  const failed = posts.filter((p) => p.status === "failed").length;

  const mix = new Map<string, number>();
  for (const p of posts) if (p.status !== "failed") for (const pl of p.platforms) mix.set(pl, (mix.get(pl) ?? 0) + 1);
  const mixMax = Math.max(1, ...mix.values());
  const upNext = posts.filter((p) => p.at.getTime() >= now && (p.status === "pending" || p.status === "draft")).slice(0, 5);

  // How what went out is doing (posts published through Zernio).
  const hasNumbers = (p: SchedulerPost) => !!p.stats && p.stats.interactions + p.stats.reach + p.stats.impressions + p.stats.views > 0;
  const measured = posts.filter((p) => p.stats && (p.stats.status === "synced" || (p.stats.status === "pending" && hasNumbers(p))));
  const counting = posts.filter((p) => p.stats?.status === "pending" && !hasNumbers(p)).length;
  const reach = measured.reduce((n, p) => n + (p.stats!.reach || p.stats!.views), 0);
  const interactions = measured.reduce((n, p) => n + p.stats!.interactions, 0);
  const rates = measured.map((p) => p.stats!.engagementRate).filter((r): r is number => r !== null);
  const avgRate = rates.length ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100 : null;
  const top = [...measured].sort((a, b) => b.stats!.interactions - a.stats!.interactions || (b.stats!.reach - a.stats!.reach))[0];
  const noAccess = posts.some((p) => p.stats?.status === "no_access");

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-xl border bg-card p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{periodLabel}</h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Scheduled" value={scheduled} />
          <Stat label="Published" value={published} tone="text-[hsl(var(--status-success))]" />
          <Stat label="Drafts & proposals" value={drafts} tone={drafts ? "text-[hsl(var(--status-purple))]" : undefined} />
          <Stat label="Failed" value={failed} tone={failed ? "text-[hsl(var(--status-error))]" : undefined} />
        </div>
      </section>

      {(measured.length > 0 || noAccess || counting > 0) && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance</h3>
          {measured.length > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border bg-background px-2.5 py-2">
                  <div className="text-base font-semibold tabular-nums">{formatCount(reach)}</div>
                  <div className="text-[11px] text-muted-foreground">Reach</div>
                </div>
                <div className="rounded-lg border bg-background px-2.5 py-2">
                  <div className="text-base font-semibold tabular-nums">{formatCount(interactions)}</div>
                  <div className="text-[11px] text-muted-foreground">Interactions</div>
                </div>
                <div className="rounded-lg border bg-background px-2.5 py-2">
                  <div className="text-base font-semibold tabular-nums">{avgRate === null ? "–" : `${avgRate}%`}</div>
                  <div className="text-[11px] text-muted-foreground">Engagement</div>
                </div>
              </div>
              {top && top.stats!.interactions > 0 && (
                <button type="button" onClick={() => onOpen(top)} className="mt-2 flex w-full items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-left hover:bg-muted">
                  <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 truncate text-xs">{top.caption.split("\n")[0] || top.title}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatCount(top.stats!.interactions)} interactions</span>
                </button>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                From {measured.length} post{measured.length === 1 ? "" : "s"} published through Zernio{counting ? `; ${counting} still being counted` : ""}.
              </p>
            </>
          ) : counting > 0 && !noAccess ? (
            <p className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
              {counting === 1 ? "Your latest post is" : `${counting} posts are`} still being counted. Reach and engagement show here as the platforms report them, usually within the hour.
            </p>
          ) : (
            <p className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
              Your Zernio plan doesn't include analytics, so there are no post stats yet. Turn on Analytics in Zernio to see reach and engagement here.
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent briefing</h3>
        <ul className="space-y-2">
          {insights.map((i) => {
            const { icon: Icon, className } = TONE[i.tone];
            return (
              <li key={i.id} className="rounded-lg border bg-background p-3">
                <div className="flex gap-2">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", className)} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{i.title}</p>
                    {i.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{i.detail}</p>}
                    {(i.action || i.secondary) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {i.action && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onInsightAction(i)}>
                            {i.action.kind === "plan_gap" && <Sparkles className="mr-1.5 h-3 w-3 text-[hsl(var(--status-purple))]" />}
                            {i.action.label}
                          </Button>
                        )}
                        {i.secondary && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onInsightAction({ ...i, action: i.secondary })}>
                            {i.secondary.label}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {mix.size > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Channel mix</h3>
          <ul className="space-y-1.5">
            {[...mix.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([pl, n]) => (
                <li key={pl} className="flex items-center gap-2 text-xs">
                  <PlatformGlyph platform={pl} />
                  <span className="w-20 truncate">{ruleFor(pl).label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full" style={{ width: `${(n / mixMax) * 100}%`, background: ruleFor(pl).color }} />
                  </span>
                  <span className="w-5 text-right tabular-nums text-muted-foreground">{n}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {upNext.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Up next</h3>
          <ul className="space-y-1">
            {upNext.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => onOpen(p)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted">
                  <span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">{format(p.at, "EEE HH:mm")}</span>
                  <PlatformStack platforms={p.platforms} max={2} />
                  <span className="min-w-0 flex-1 truncate text-xs">{p.caption.split("\n")[0] || p.title}</span>
                  <StatusIcon post={p} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
