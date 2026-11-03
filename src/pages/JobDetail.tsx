import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, FileDown, Inbox, Loader2, MoreHorizontal, Pencil, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import { BulkPushToGHLDialog } from "@/components/jobs/BulkPushToGHLDialog";
import { OutputDetailPanel } from "@/components/jobs/OutputDetailPanel";
import { LoadingState } from "@/components/jobs/viewers/LoadingState";
import { Filmstrip, type FilmFilter } from "@/components/review/Filmstrip";
import { PieceReview } from "@/components/review/PieceReview";
import { useAuth } from "@/contexts/AuthContext";
import { useGenerationJob } from "@/hooks/useGenerationJob";
import { useContentOutputs } from "@/hooks/useContentOutputs";
import { useUpdateJobName } from "@/hooks/useUpdateJobName";
import { useDeleteContentOutput } from "@/hooks/useDeleteContentOutput";
import { useBulkUpdateOutputs } from "@/hooks/useBulkUpdateOutputs";
import { useBulkDeleteOutputs } from "@/hooks/useBulkDeleteOutputs";
import { useExportOutputs } from "@/hooks/useExportOutputs";
import { useGHLConnection } from "@/hooks/useGHLConnection";
import { usePublishedCounts } from "@/hooks/usePublishedCounts";
import { useRetryJobDispatch } from "@/hooks/useGenerationJobs";
import { getPipelineLabel } from "@/lib/pipeline-labels";
import { humanizeGenerationError } from "@/lib/generation-errors";
import { isReviewable, toPiece } from "@/lib/piece";
import { cn } from "@/lib/utils";

/** A readable name for a run that nobody named. */
function getJobDisplayInfo(job: any): { title: string; blueprintName?: string } {
  const config = job.configuration as any;
  const blueprintName = config?.blueprint_name || config?.blueprint?.name;
  const items = (job.items as any[]) || [];
  if (job.name) return { title: job.name, blueprintName };

  const firstItem = items[0];
  const topic = firstItem?.slot_values?.topic || firstItem?.slot_values?.title || firstItem?.idea_title;
  if (topic) {
    const maxLen = items.length > 1 ? 50 : 70;
    const title = topic.length > maxLen ? `${topic.slice(0, maxLen).trim()}…` : topic;
    return { title: items.length > 1 ? `${title} + ${items.length - 1} more` : title, blueprintName };
  }
  return { title: `${items.length} ${getPipelineLabel(job.pipeline, items.length)}${blueprintName ? ` · ${blueprintName}` : ""}`, blueprintName };
}

function EditableJobTitle({ jobId, currentName, fallbackName }: { jobId: string; currentName: string | null; fallbackName: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(currentName || fallbackName);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateNameMutation = useUpdateJobName();

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(currentName || fallbackName);
  }, [currentName, fallbackName]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== currentName) updateNameMutation.mutate({ jobId, name: trimmed });
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSave();
          if (e.key === "Escape") {
            setEditValue(currentName || fallbackName);
            setIsEditing(false);
          }
        }}
        className="h-8 w-full max-w-xl px-2 py-0 text-lg font-semibold"
        aria-label="Run name"
      />
    );
  }

  return (
    <div className="group/title flex min-w-0 items-center gap-1.5">
      <h1 className="truncate text-lg font-semibold" title={currentName || fallbackName}>
        {currentName || fallbackName}
      </h1>
      <button
        onClick={() => setIsEditing(true)}
        className="shrink-0 rounded p-1 opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover/title:opacity-100"
        aria-label="Rename this run"
      >
        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
}

function hasVideo(output: any): boolean {
  const data = output?.data ?? {};
  const sd = output?.stage_data ?? {};
  return !!(data.video_url || data.videoUrl || sd.final?.url || output?.videoUrl || output?.video_url);
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { currentOrganization } = useAuth();
  const { job, isGenerating, refetch } = useGenerationJob(id || null);
  const { data: outputs = [], refetch: refetchOutputs } = useContentOutputs(id || null, isGenerating);

  const [filter, setFilter] = useState<FilmFilter>("all");
  const [checked, setChecked] = useState<string[]>([]);
  const [showBulkPushDialog, setShowBulkPushDialog] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const deleteOutput = useDeleteContentOutput();
  const bulkUpdateOutputs = useBulkUpdateOutputs();
  const bulkDeleteOutputs = useBulkDeleteOutputs();
  const retryJob = useRetryJobDispatch();
  const { exportToJSON, exportToCSV } = useExportOutputs();
  const { data: ghlConnection } = useGHLConnection();

  const outputIds = useMemo(() => outputs.map((o) => o.id), [outputs]);
  const { data: publishedCounts } = usePublishedCounts(outputIds);

  const allItems = useMemo(() => outputs.map((o) => ({ id: o.id as string, output: o, piece: toPiece(o) })), [outputs]);
  const items = useMemo(() => (filter === "all" ? allItems : allItems.filter((i) => i.piece.state === filter)), [allItems, filter]);

  const requested = searchParams.get("piece");
  const selected = allItems.find((i) => i.id === requested) ?? items[0] ?? null;
  const selectedIndex = selected ? items.findIndex((i) => i.id === selected.id) : -1;

  const select = useCallback(
    (pieceId: string) => {
      setSearchParams(
        (p) => {
          p.set("piece", pieceId);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const goPrevious = useCallback(() => {
    if (selectedIndex > 0) select(items[selectedIndex - 1].id);
  }, [items, selectedIndex, select]);
  const goNext = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < items.length - 1) select(items[selectedIndex + 1].id);
  }, [items, selectedIndex, select]);

  // ← / → between pieces, except while typing or with a dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") goPrevious();
      else goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrevious, goNext]);

  const goBack = () => (location.key !== "default" ? navigate(-1) : navigate("/jobs"));

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetch(), refetchOutputs()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDelete = async (outputId: string) => {
    const next = items[selectedIndex + 1] ?? items[selectedIndex - 1];
    await deleteOutput.mutateAsync(outputId);
    toast.success("Piece deleted");
    if (next) select(next.id);
    refetchOutputs();
  };

  const toggleCheck = (outputId: string) => setChecked((prev) => (prev.includes(outputId) ? prev.filter((x) => x !== outputId) : [...prev, outputId]));

  const checkedOutputs = outputs.filter((o) => checked.includes(o.id));
  const allCheckedHaveImages = checkedOutputs.every((o) => !!toPiece(o).image);
  const allCheckedHaveVideos = checkedOutputs.every(hasVideo);

  if (!id) {
    return (
      <AppLayout header={<UserProfileMenu />}>
        <div className="container mx-auto py-8">
          <p className="text-muted-foreground">Invalid job ID</p>
        </div>
      </AppLayout>
    );
  }

  if (!job) {
    return (
      <AppLayout header={<UserProfileMenu />}>
        <div className="mx-auto max-w-6xl space-y-6 px-6 py-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={goBack} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Skeleton className="h-8 w-64" />
          </div>
          <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
            <Skeleton className="h-[520px] w-full rounded-2xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const config = job.configuration as any;
  const displayInfo = getJobDisplayInfo(job);
  const blueprintId = (job as any).blueprint_id ?? config?.blueprint_id ?? config?.blueprint?.id;
  const counts = {
    waiting: allItems.filter((i) => i.piece.state === "waiting").length,
    failed: allItems.filter((i) => i.piece.state === "failed").length,
    generating: allItems.filter((i) => i.piece.state === "generating").length,
    ready: allItems.filter((i) => i.piece.state === "ready" || i.piece.state === "done").length,
  };
  const exportName = config?.blueprint_name || "outputs";
  const exportSet = checked.length ? checkedOutputs : outputs;

  const summary = [
    counts.generating ? `${counts.generating} in progress` : null,
    counts.waiting ? `${counts.waiting} need${counts.waiting === 1 ? "s" : ""} you` : null,
    counts.failed ? `${counts.failed} failed` : null,
    allItems.length > 1 && counts.ready ? `${counts.ready} ready` : null,
  ].filter(Boolean);

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-6">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" onClick={goBack} aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <EditableJobTitle jobId={job.id} currentName={job.name} fallbackName={displayInfo.title} />
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              {displayInfo.blueprintName && (
                <>
                  <span>
                    From{" "}
                    {blueprintId ? (
                      <Link to={`/blueprints/${blueprintId}`} className="text-foreground underline-offset-2 hover:underline">
                        {displayInfo.blueprintName}
                      </Link>
                    ) : (
                      displayInfo.blueprintName
                    )}
                  </span>
                  <span className="opacity-40">·</span>
                </>
              )}
              <span>{formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}</span>
              {summary.length > 0 && (
                <>
                  <span className="opacity-40">·</span>
                  <span className={cn(counts.waiting ? "text-amber-600 dark:text-amber-400" : counts.generating ? "text-blue-600 dark:text-blue-400" : undefined)}>
                    {summary.join(", ")}
                  </span>
                </>
              )}
            </div>
          </div>

          {items.length > 1 && selectedIndex >= 0 && (
            <div className="hidden items-center gap-1 sm:flex">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goPrevious} disabled={selectedIndex <= 0} aria-label="Previous piece">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
                {selectedIndex + 1} of {items.length}
              </span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={goNext} disabled={selectedIndex >= items.length - 1} aria-label="Next piece">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => exportToCSV(exportSet, exportName)}>
                <FileDown className="mr-2 h-4 w-4" />
                Export {checked.length ? "selected" : "all"} as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportToJSON(exportSet, exportName)}>
                <FileDown className="mr-2 h-4 w-4" />
                Export {checked.length ? "selected" : "all"} as JSON
              </DropdownMenuItem>
              {allItems.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setChecked(checked.length === items.length ? [] : items.map((i) => i.id))}>
                    {checked.length === items.length ? "Clear selection" : "Select all shown"}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleRefresh} disabled={isRefreshing}>
                <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
                Refresh
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {allItems.length > 1 && (
          <Filmstrip
            items={items}
            allItems={allItems}
            selectedId={selected?.id ?? null}
            onSelect={select}
            filter={filter}
            onFilter={(f) => {
              setFilter(f);
              const shown = f === "all" ? allItems : allItems.filter((i) => i.piece.state === f);
              if (shown.length && !shown.some((i) => i.id === selected?.id)) select(shown[0].id);
            }}
            checked={checked}
            onToggleCheck={toggleCheck}
          />
        )}

        {/* Body */}
        {selected ? (
          isReviewable(selected.output.pipeline) ? (
            <main className="min-h-0 flex-1 overflow-y-auto">
              <PieceReview
                key={selected.id}
                output={selected.output}
                piece={selected.piece}
                job={job}
                organizationName={currentOrganization?.name}
                publish={publishedCounts?.[selected.id]}
                onPrevious={goPrevious}
                onNext={goNext}
                onDelete={() => handleDelete(selected.id)}
                index={Math.max(0, selectedIndex)}
                count={items.length}
              />
            </main>
          ) : (
            <main className="min-h-0 flex-1 overflow-hidden">
              <OutputDetailPanel
                output={selected.output}
                currentIndex={Math.max(0, selectedIndex)}
                totalCount={items.length}
                onPrevious={goPrevious}
                onNext={goNext}
                onApprove={() => bulkUpdateOutputs.mutate({ ids: [selected.id], status: "approved" })}
                onReject={() => bulkUpdateOutputs.mutate({ ids: [selected.id], status: "rejected" })}
                onDelete={() => handleDelete(selected.id)}
              />
            </main>
          )
        ) : job.status === "failed" || job.error ? (
          <div className="grid flex-1 place-items-center p-8">
            <div className="max-w-md space-y-4 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10">
                <AlertCircle className="h-7 w-7 text-destructive" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-lg font-semibold">This run didn't make anything</h2>
                <p className="text-sm text-muted-foreground">{humanizeGenerationError(job.error)}</p>
              </div>
              <Button variant="cta" onClick={() => retryJob.mutate(job.id)} disabled={retryJob.isPending}>
                {retryJob.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Run it again
              </Button>
            </div>
          </div>
        ) : isGenerating ? (
          <div className="grid flex-1 place-items-center p-8">
            <LoadingState message="Starting the run…" submessage="Pieces appear here as soon as they're made. You can leave this page." className="max-w-md" />
          </div>
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="space-y-3 text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted/50">
                <Inbox className="h-7 w-7 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{filter === "all" ? "Nothing in this run yet." : "Nothing matches this filter."}</p>
            </div>
          </div>
        )}

        <BulkActionsToolbar
          selectedCount={checked.length}
          onDeleteSelected={async () => {
            await bulkDeleteOutputs.mutateAsync(checked);
            setChecked([]);
          }}
          onDeselectAll={() => setChecked([])}
          isDeleting={bulkDeleteOutputs.isPending}
          onApprove={async () => {
            await bulkUpdateOutputs.mutateAsync({ ids: checked, status: "approved" });
            setChecked([]);
          }}
          onReject={async () => {
            await bulkUpdateOutputs.mutateAsync({ ids: checked, status: "rejected" });
            setChecked([]);
          }}
          onPushToGHL={() => setShowBulkPushDialog(true)}
          showGHLButton={!!ghlConnection?.connected}
        />

        <BulkPushToGHLDialog
          open={showBulkPushDialog}
          onOpenChange={setShowBulkPushDialog}
          outputIds={checked}
          outputCount={checked.length}
          allHaveImages={allCheckedHaveImages}
          allHaveVideos={allCheckedHaveVideos}
        />
      </div>
    </AppLayout>
  );
}
