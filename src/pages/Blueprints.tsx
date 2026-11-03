import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layers, Plus, Search, AlertTriangle } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBlueprints, useDeleteBlueprint, useDuplicateBlueprint, useUpdateBlueprint } from "@/hooks/useBlueprints";
import { useAutopilots } from "@/hooks/useAutopilots";
import { useBlueprintSamples, useBlueprintsHealth } from "@/hooks/useBlueprintHealth";
import { EditBlueprintDialog } from "@/components/blueprints/EditBlueprintDialog";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
import { BlueprintCardSkeleton } from "@/components/blueprints/BlueprintCardSkeleton";
import { BlueprintFoldersSidebar } from "@/components/blueprints/BlueprintFoldersSidebar";
import { NewBlueprintDialog } from "@/components/blueprints/NewBlueprintDialog";
import { ProFeaturesShowcase } from "@/components/ProFeaturesShowcase";
import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";
import { FORMATS, FORMAT_ORDER, applyQualityTier, formatForPipeline, type BlueprintFormat } from "@/lib/blueprint-brief";
import { autopilotsForBlueprint } from "@/lib/blueprint-routes";
import type { Blueprint } from "@/types/blueprint";
import type { Autopilot } from "@/types/autopilot";
import { cn } from "@/lib/utils";

type FormatFilter = "all" | BlueprintFormat | "other" | "attention";

export default function Blueprints() {
  const navigate = useNavigate();
  const { data: quota } = useOrganizationQuota();
  const [searchParams, setSearchParams] = useSearchParams();
  const [classicBlueprint, setClassicBlueprint] = useState<Blueprint | null>(null);
  const [newOpen, setNewOpen] = useState(searchParams.get("new") === "1");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("recent");
  const [formatFilter, setFormatFilter] = useState<FormatFilter>("all");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const { data: blueprints, isLoading } = useBlueprints();
  const { data: autopilots } = useAutopilots();
  const { health, stats } = useBlueprintsHealth(blueprints);
  const { data: samples } = useBlueprintSamples();
  const deleteMutation = useDeleteBlueprint();
  const duplicateMutation = useDuplicateBlueprint();
  const updateMutation = useUpdateBlueprint();

  // Old links: /blueprints?edit=<id> now lives at /blueprints/<id>.
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (editId) navigate(`/blueprints/${editId}`, { replace: true });
  }, [searchParams, navigate]);

  const autopilotsByBlueprint = useMemo(() => {
    const byBlueprint = new Map<string, Autopilot[]>();
    for (const bp of blueprints ?? []) byBlueprint.set(bp.id, autopilotsForBlueprint(autopilots, bp.id));
    return byBlueprint;
  }, [blueprints, autopilots]);

  const attentionCount = useMemo(
    () => (blueprints ?? []).filter((b) => health.get(b.id)?.status === "failing").length,
    [blueprints, health],
  );

  const formatCounts = useMemo(() => {
    const counts = new Map<FormatFilter, number>();
    for (const b of blueprints ?? []) {
      const f: FormatFilter = formatForPipeline(b.pipeline) ?? "other";
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return counts;
  }, [blueprints]);

  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = (blueprints ?? []).filter((b) => {
      if (selectedFolder === "uncategorized" ? !!b.folder_id : selectedFolder && b.folder_id !== selectedFolder) return false;
      if (formatFilter === "attention" && health.get(b.id)?.status !== "failing") return false;
      if (formatFilter !== "all" && formatFilter !== "attention") {
        const f = formatForPipeline(b.pipeline) ?? "other";
        if (f !== formatFilter) return false;
      }
      if (!q) return true;
      return (
        b.name.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q) ||
        b.tags?.some((t) => t.toLowerCase().includes(q))
      );
    });
    const lastRun = (b: Blueprint) => stats.get(b.id)?.last_run_at ?? "";
    switch (sortBy) {
      case "recent":
        return list.sort((a, b) => (lastRun(b) || b.updated_at).localeCompare(lastRun(a) || a.updated_at));
      case "most_used":
        return list.sort((a, b) => (stats.get(b.id)?.runs ?? 0) - (stats.get(a.id)?.runs ?? 0));
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  }, [blueprints, searchQuery, formatFilter, selectedFolder, sortBy, stats, health]);

  const handleFix = (blueprint: Blueprint) => {
    const format = formatForPipeline(blueprint.pipeline) ?? "post";
    updateMutation.mutate({
      id: blueprint.id,
      model_config: applyQualityTier(blueprint.model_config as any, "balanced", format, blueprint.pipeline ?? ""),
    });
  };

  const chips: Array<{ id: FormatFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: blueprints?.length ?? 0 },
    ...FORMAT_ORDER.filter((f) => formatCounts.get(f)).map((f) => ({ id: f as FormatFilter, label: FORMATS[f].label, count: formatCounts.get(f)! })),
    ...(formatCounts.get("other") ? [{ id: "other" as FormatFilter, label: "Other", count: formatCounts.get("other")! }] : []),
  ];

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1 p-6 lg:p-8">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <PageHeader
            icon={Layers}
            title="Blueprints"
            description="Reusable formats. Each one turns a topic into a finished piece."
            actions={
              <Button variant="cta" onClick={() => setNewOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New blueprint
              </Button>
            }
          />

          {quota?.planTier === "free" && <ProFeaturesShowcase variant="banner" />}

          {isLoading ? (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {[...Array(6)].map((_, i) => <BlueprintCardSkeleton key={i} />)}
            </div>
          ) : (blueprints?.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-dashed p-12 text-center space-y-3">
              <h2 className="text-xl font-semibold">No blueprints yet</h2>
              <p className="text-muted-foreground max-w-md mx-auto">
                A blueprint is a reusable format, like "founder story post" or "weekly newsletter". Make one, then run it on any topic or put it on autopilot.
              </p>
              <Button variant="cta" onClick={() => setNewOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Make your first blueprint
              </Button>
            </div>
          ) : (
            <>
              {/* Two deliberate rows: search + sort are 40px controls and share a
                  row so they line up; the format chips get their own row. All
                  three used to sit in one flex row, so the 26px chips wrapped to
                  two lines that straddled the 40px controls — "All 46" floated
                  above the search field, "Needs attention" hung below the sort
                  menu, and the wrapped row left a ragged gap. */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[12rem] flex-1 lg:max-w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search blueprints"
                      className="pl-9"
                      aria-label="Search blueprints"
                    />
                  </div>
                  <div className="ml-auto">
                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-44" aria-label="Sort">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Recently used</SelectItem>
                        <SelectItem value="most_used">Most used</SelectItem>
                        <SelectItem value="newest">Newest</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by format">
                  {chips.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setFormatFilter(c.id)}
                      aria-pressed={formatFilter === c.id}
                      className={cn(
                        "inline-flex h-7 items-center rounded-full border px-3 text-xs transition-colors",
                        formatFilter === c.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted",
                      )}
                    >
                      {c.label} <span className="ml-1 opacity-60 tabular-nums">{c.count}</span>
                    </button>
                  ))}
                  {attentionCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setFormatFilter("attention")}
                      aria-pressed={formatFilter === "attention"}
                      className={cn(
                        "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-xs transition-colors",
                        formatFilter === "attention"
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-red-500/40 text-red-700 dark:text-red-400 hover:bg-red-500/10",
                      )}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Needs attention <span className="tabular-nums">{attentionCount}</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-6">
                <BlueprintFoldersSidebar
                  selectedFolder={selectedFolder}
                  onSelectFolder={setSelectedFolder}
                  className="hidden lg:block w-52 shrink-0 h-[calc(100vh-280px)] sticky top-4"
                />
                <div className="flex-1 min-w-0">
                  {visible.length > 0 ? (
                    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {visible.map((bp) => (
                        <BlueprintCard
                          key={bp.id}
                          blueprint={bp}
                          health={health.get(bp.id)}
                          stats={stats.get(bp.id)}
                          sample={samples?.get(bp.id)}
                          autopilots={autopilotsByBlueprint.get(bp.id) ?? []}
                          onDelete={(id) => deleteMutation.mutate(id)}
                          onDuplicate={(b) => duplicateMutation.mutate(b)}
                          onFix={handleFix}
                          onClassicEdit={setClassicBlueprint}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="py-12 text-center text-muted-foreground">No blueprints match. Try another search or filter.</p>
                  )}
                </div>
              </div>
            </>
          )}

          <NewBlueprintDialog open={newOpen} onOpenChange={setNewOpen} />
          <EditBlueprintDialog
            blueprint={classicBlueprint}
            open={!!classicBlueprint}
            onOpenChange={(open) => !open && setClassicBlueprint(null)}
          />
        </div>
      </div>
    </AppLayout>
  );
}
