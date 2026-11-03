import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Search, Play } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useBlueprintsHealth } from "@/hooks/useBlueprintHealth";
import { getPipelineIcon, formatRelativeTime } from "@/lib/blueprintCardUtils";
import { runPath } from "@/lib/blueprint-routes";
import { BlueprintHealthPill } from "./BlueprintHealthPill";
import { formatLabelForBlueprint } from "./BlueprintCard";

/** "Create" with no blueprint chosen yet: pick one, then go to its Run screen. */
export function CreatePicker({ ideaIds }: { ideaIds: string[] }) {
  const navigate = useNavigate();
  const { data: blueprints, isLoading } = useBlueprints();
  const { health, stats } = useBlueprintsHealth(blueprints);
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (blueprints ?? [])
      .filter((b) => b.pipeline && (!query || b.name.toLowerCase().includes(query)))
      .sort((a, b) => (stats.get(b.id)?.last_run_at ?? b.updated_at).localeCompare(stats.get(a.id)?.last_run_at ?? a.updated_at));
  }, [blueprints, q, stats]);

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-6 lg:p-10">
        <div>
          <h1 className="text-2xl font-bold">What do you want to make?</h1>
          <p className="text-muted-foreground">
            {ideaIds.length > 0
              ? `Pick a blueprint for your ${ideaIds.length} selected idea${ideaIds.length === 1 ? "" : "s"}.`
              : "Pick a blueprint. You'll add topics on the next screen."}
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blueprints" className="pl-9" aria-label="Search blueprints" autoFocus />
        </div>

        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {q ? "No blueprints match." : "No blueprints yet."}
          </div>
        ) : (
          <ul className="divide-y rounded-xl border bg-card">
            {list.map((bp) => {
              const Icon = getPipelineIcon(bp.pipeline);
              const h = health.get(bp.id);
              const blocked = h?.issues.some((i) => i.severity === "blocker");
              const s = stats.get(bp.id);
              return (
                <li key={bp.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{bp.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatLabelForBlueprint(bp.pipeline)}
                      {s?.last_run_at ? ` · last run ${formatRelativeTime(s.last_run_at)}` : " · never run"}
                    </div>
                  </div>
                  {h && h.status !== "ready" && <BlueprintHealthPill status={h.status} />}
                  {blocked ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/blueprints/${bp.id}`}>Fix</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="cta" onClick={() => navigate(runPath(bp, ideaIds))}>
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Run
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Button variant="outline" onClick={() => navigate("/blueprints?new=1")}>
            <Plus className="mr-2 h-4 w-4" />
            New blueprint
          </Button>
          <Link to={`/create?wizard=1${ideaIds.length ? `&ideas=${ideaIds.join(",")}` : ""}`} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Use the step-by-step wizard instead
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
