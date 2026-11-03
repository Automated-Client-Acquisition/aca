import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Trash2, MoreHorizontal, Copy, Pencil, Play, FolderInput, Folder, X, Settings2 } from "lucide-react";
import type { Blueprint } from "@/types/blueprint";
import { useBlueprintFolders } from "@/hooks/useBlueprintFolders";
import { useUpdateBlueprintFolder } from "@/hooks/useBlueprintFoldersCRUD";
import { getPipelineIcon, formatRelativeTime } from "@/lib/blueprintCardUtils";
import { FORMATS, formatForPipeline } from "@/lib/blueprint-brief";
import { PIPELINES } from "@/types/pipeline";
import type { BlueprintHealth, BlueprintRunStats } from "@/lib/blueprint-health";
import type { BlueprintSample } from "@/hooks/useBlueprintHealth";
import { editPath, runPath } from "@/lib/blueprint-routes";
import { AutomateMenu } from "@/components/autopilot/AutomateMenu";
import { BlueprintHealthPill, HEALTH_MESSAGE_STYLES } from "./BlueprintHealthPill";
import { cn } from "@/lib/utils";

interface BlueprintCardProps {
  blueprint: Blueprint;
  health?: BlueprintHealth;
  stats?: BlueprintRunStats;
  sample?: BlueprintSample;
  /** Autopilots that make this blueprint, running ones first (autopilotsForBlueprint). */
  autopilots: Array<{ id: string; status: string }>;
  onDelete: (id: string) => void;
  onDuplicate?: (blueprint: Blueprint) => void;
  onFix?: (blueprint: Blueprint, fix: "switch_to_balanced") => void;
  /** Open the pre-Studio editor (every setting, every pipeline). */
  onClassicEdit: (blueprint: Blueprint) => void;
}

export function formatLabelForBlueprint(pipeline?: string | null): string {
  const format = formatForPipeline(pipeline);
  if (format) {
    if (pipeline === "instagram_carousel_ai") return "Carousel, AI images";
    return FORMATS[format].label;
  }
  return PIPELINES.find((p) => p.id === pipeline)?.name ?? "No format";
}

function statsLine(stats: BlueprintRunStats | undefined, autopilotCount: number): string {
  const parts: string[] = [];
  if (!stats || stats.runs === 0) parts.push("Never run");
  else {
    parts.push(`${stats.runs} run${stats.runs === 1 ? "" : "s"}`);
    const finished = stats.succeeded + stats.failed;
    if (finished > 0) parts.push(`${Math.round((stats.succeeded / finished) * 100)}% succeeded`);
    if (stats.last_run_at) parts.push(`last ${formatRelativeTime(stats.last_run_at)}`);
  }
  if (autopilotCount > 0) parts.push(`${autopilotCount} autopilot${autopilotCount === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function Thumbnail({ blueprint, sample }: { blueprint: Blueprint; sample?: BlueprintSample }) {
  const Icon = getPipelineIcon(blueprint.pipeline);
  if (sample?.image_url) {
    // Show the whole image (no cropped faces or headlines) over a blurred copy of itself.
    return (
      <>
        <img src={sample.image_url} alt="" aria-hidden loading="lazy" className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl opacity-70" />
        <img
          src={sample.image_url}
          alt=""
          loading="lazy"
          className="relative h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </>
    );
  }
  const text = sample?.text_snippet || sample?.title;
  if (text) {
    return (
      <div className="h-full w-full p-4 flex items-end">
        <div className="w-full rounded-lg bg-card shadow-sm border p-3 translate-y-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-4 whitespace-pre-line">{text}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full w-full grid place-items-center text-muted-foreground/60">
      <div className="flex flex-col items-center gap-1.5">
        <Icon className="h-6 w-6" />
        <span className="text-[11px]">No output yet</span>
      </div>
    </div>
  );
}

export function BlueprintCard({
  blueprint,
  health,
  stats,
  sample,
  autopilots,
  onDelete,
  onDuplicate,
  onFix,
  onClassicEdit,
}: BlueprintCardProps) {
  const navigate = useNavigate();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const { data: folders = [] } = useBlueprintFolders();
  const updateFolder = useUpdateBlueprintFolder();
  const currentFolder = folders.find((f) => f.id === blueprint.folder_id);

  const status = health?.status ?? "ready";
  const lead = health?.issues.find((i) => i.status === status);
  const canRun = status !== "needs_setup" && !health?.issues.some((i) => i.severity === "blocker");
  const autopilotCount = autopilots.length;

  return (
    <>
      <Card
        className={cn(
          "group relative overflow-hidden flex flex-col cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5",
          status === "failing" && "border-red-500/40",
        )}
        onClick={() => navigate(editPath(blueprint))}
      >
        <div className="relative aspect-[16/10] bg-muted/50 border-b overflow-hidden">
          <Thumbnail blueprint={blueprint} sample={sample} />
          {health && (
            <div className="absolute left-2 top-2 rounded-full bg-background/90 shadow-sm backdrop-blur">
              <BlueprintHealthPill status={status} />
            </div>
          )}
          <div className="absolute right-2 top-2" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-8 w-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => navigate(editPath(blueprint))}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit in Studio
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onClassicEdit(blueprint)}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  Classic editor
                </DropdownMenuItem>
                {onDuplicate && (
                  <DropdownMenuItem onClick={() => onDuplicate(blueprint)}>
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowFolderDialog(true)}>
                  <FolderInput className="mr-2 h-4 w-4" />
                  Move to folder
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="font-semibold text-[15px] leading-snug line-clamp-2 min-h-[2.5rem]" title={blueprint.name}>
            {blueprint.name}
          </h3>

          <div className="space-y-0.5 text-xs text-muted-foreground tabular-nums">
            <p className="font-medium text-foreground/70">{formatLabelForBlueprint(blueprint.pipeline)}</p>
            <p className="line-clamp-2">{statsLine(stats, autopilotCount)}</p>
          </div>

          {currentFolder && (
            <span className="inline-flex w-fit items-center gap-1 text-[11px]" style={{ color: currentFolder.color }}>
              <Folder className="h-3 w-3" />
              {currentFolder.name}
            </span>
          )}

          {lead && status !== "ready" && (
            <div
              className={cn("rounded-md px-2.5 py-2 text-xs leading-snug", HEALTH_MESSAGE_STYLES[status])}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="line-clamp-3" title={lead.message}>{lead.message}</span>
              {lead.action && (
                <>
                  {" "}
                  {lead.action.fix && onFix ? (
                    <button className="font-semibold underline underline-offset-2" onClick={() => onFix(blueprint, lead.action!.fix!)}>
                      {lead.action.label}
                    </button>
                  ) : lead.action.href ? (
                    <Link className="font-semibold underline underline-offset-2" to={lead.action.href}>
                      {lead.action.label}
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="cta" className="h-8" disabled={!canRun} onClick={() => navigate(runPath(blueprint))}>
            <Play className="mr-1 h-3.5 w-3.5" />
            Run
          </Button>
          {/* An existing autopilot stays reachable even when the blueprint can't run, so it can be paused. */}
          <AutomateMenu blueprint={blueprint} canRun={canRun} />
        </div>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{blueprint.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {autopilotCount > 0
                ? `${autopilotCount} autopilot${autopilotCount === 1 ? " uses" : "s use"} this blueprint and will stop producing it. This can't be undone.`
                : "This can't be undone. Content it already made stays in Content."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete(blueprint.id);
                setShowDeleteDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
        <DialogContent className="sm:max-w-[300px] p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm">Move to folder</DialogTitle>
          </DialogHeader>
          <div className="px-2 pb-3 space-y-0.5">
            {blueprint.folder_id && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors text-muted-foreground"
                onClick={() => {
                  updateFolder.mutate({ blueprintId: blueprint.id, folderId: null });
                  setShowFolderDialog(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
                Remove from folder
              </button>
            )}
            {folders.map((folder) => (
              <button
                key={folder.id}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors",
                  folder.id === blueprint.folder_id ? "bg-accent font-medium" : "",
                )}
                onClick={() => {
                  updateFolder.mutate({ blueprintId: blueprint.id, folderId: folder.id });
                  setShowFolderDialog(false);
                }}
              >
                <Folder className="h-3.5 w-3.5" style={{ color: folder.color }} />
                <span className="truncate">{folder.name}</span>
              </button>
            ))}
            {folders.length === 0 && (
              <p className="text-xs text-muted-foreground px-3 py-3">No folders yet. Create one from the sidebar.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
