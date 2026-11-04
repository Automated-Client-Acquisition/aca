import { formatDistanceToNow } from "date-fns";
import { BarChart3, ExternalLink, Info, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRefreshPostStats } from "@/hooks/useScheduler";
import { formatCount, interactionsOf, ruleFor, type PostStats, type SchedulerPost } from "@/lib/scheduler";

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2.5" title={hint}>
      <div className="text-lg font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Numbers({ stats }: { stats: PostStats }) {
  const audience = stats.reach ? { label: "Reach", value: stats.reach } : stats.views ? { label: "Views", value: stats.views } : { label: "Reach", value: 0 };
  const extras = [
    { label: "impressions", value: stats.impressions, skip: audience.label === "Reach" && !stats.impressions },
    { label: "views", value: stats.views, skip: audience.label === "Views" },
    { label: "saves", value: stats.saves },
    { label: "shares", value: stats.shares },
    { label: "clicks", value: stats.clicks },
  ].filter((e) => e.value > 0 && !e.skip);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={audience.label} value={formatCount(audience.value)} hint="Accounts that saw the post" />
        <Tile label="Likes" value={formatCount(stats.likes)} />
        <Tile label="Comments" value={formatCount(stats.comments)} />
        <Tile
          label="Engagement"
          value={stats.engagementRate === null ? "–" : `${stats.engagementRate}%`}
          hint="Likes, comments, shares and saves over impressions (or reach, or views)"
        />
      </div>
      {extras.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {extras.map((e) => `${formatCount(e.value)} ${e.label}`).join(" · ")}
        </p>
      )}
    </>
  );
}

/** How a published post is doing, read back from the platform through Zernio. */
export function PostStatsPanel({ post, accountLabel }: { post: SchedulerPost; accountLabel: (accountId: string) => string }) {
  const refresh = useRefreshPostStats();
  const zernioRows = post.rows.filter((r) => r.account_id.startsWith("zernio:"));
  const stats = post.stats;
  const platform = stats?.rows[0]?.platform ?? zernioRows[0]?.platform ?? post.platforms[0];
  const label = ruleFor(platform).label;

  if (!zernioRows.length) {
    return (
      <section className="flex gap-2 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Stats are read through Zernio. This post went out another way, so ACA has no numbers for it.</p>
      </section>
    );
  }

  const hasNumbers = !!stats && (stats.status === "synced" || stats.status === "pending") && (interactionsOf(stats) > 0 || stats.reach + stats.impressions + stats.views > 0);

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-muted-foreground" /> Performance
        </h3>
        {stats?.fetchedAt && (
          <span className="text-xs text-muted-foreground">Updated {formatDistanceToNow(new Date(stats.fetchedAt), { addSuffix: true })}</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {stats?.postUrl && (
            <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
              <a href={stats.postUrl} target="_blank" rel="noreferrer">
                View on {label} <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(zernioRows.map((r) => r.id))}
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", refresh.isPending && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {hasNumbers && stats ? (
        <Numbers stats={stats} />
      ) : stats?.status === "no_access" ? (
        <div className="flex gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your Zernio plan doesn't include analytics, so {label} can't share this post's numbers with ACA. Turn on Analytics in{" "}
            <a href="https://zernio.com" target="_blank" rel="noreferrer" className="font-medium underline">Zernio</a>, then refresh.
          </p>
        </div>
      ) : stats && (stats.status === "error" || stats.status === "unavailable") ? (
        <div className="flex gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{stats.error || "Zernio can't read this post's numbers."}</p>
        </div>
      ) : (
        <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          {label} is still counting. The first numbers usually arrive within an hour of publishing, then update hourly for the first day.
        </p>
      )}

      {stats && stats.rows.length > 1 && hasNumbers && (
        <ul className="mt-3 space-y-1 border-t pt-3 text-xs">
          {stats.rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{accountLabel(r.accountId)}</span>
              <span className="tabular-nums text-muted-foreground">
                {formatCount(r.reach || r.views)} reach · {formatCount(r.likes)} likes · {formatCount(r.comments)} comments
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
