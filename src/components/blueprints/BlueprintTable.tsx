import { useState } from "react";
import { MoreHorizontal, Trash2, Copy, Pencil, Sparkles, FolderInput, Folder, X } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Blueprint } from "@/types/blueprint";
import { useBlueprintFolders } from "@/hooks/useBlueprintFolders";
import { useUpdateBlueprintFolder } from "@/hooks/useBlueprintFoldersCRUD";
import { cn } from "@/lib/utils";
import { formatRelativeTime, formatLabel, getPipelineIcon } from "@/lib/blueprintCardUtils";
import { getPipelineStages } from "@/types/pipelineStages";
import type { PipelineId } from "@/types/pipeline";

interface BlueprintTableProps {
  blueprints: Blueprint[];
  onEdit: (blueprint: Blueprint) => void;
  onUse: (blueprint: Blueprint) => void;
  onDelete: (id: string) => void;
  onDuplicate: (blueprint: Blueprint) => void;
}

export function BlueprintTable({
  blueprints,
  onEdit,
  onUse,
  onDelete,
  onDuplicate,
}: BlueprintTableProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [folderBlueprintId, setFolderBlueprintId] = useState<string | null>(null);
  const { data: folders = [] } = useBlueprintFolders();
  const updateFolder = useUpdateBlueprintFolder();

  const folderBlueprint = folderBlueprintId ? blueprints.find(b => b.id === folderBlueprintId) : null;

  const getPrimaryModel = (blueprint: Blueprint) => {
    // Get modelTypes this pipeline actually uses
    const pipelineModelTypes = blueprint.pipeline 
      ? getPipelineStages(blueprint.pipeline as PipelineId)
          .map(stage => stage.modelType)
          .filter(Boolean)
      : [];

    // Check each model type in priority order, but only if it's used by the pipeline
    const textLlm = blueprint.model_config.text_llm?.model_id;
    const imageGen = blueprint.model_config.image_generator?.model_id;
    const worldSim = blueprint.model_config.world_simulator?.model_id;
    const legacyModel = blueprint.model_config.model_id;

    // Return first configured model that's actually used by the pipeline
    if (textLlm && textLlm.trim() && (!blueprint.pipeline || pipelineModelTypes.includes('text_llm'))) {
      return textLlm;
    }
    if (worldSim && worldSim.trim() && (!blueprint.pipeline || pipelineModelTypes.includes('world_simulator'))) {
      return worldSim;
    }
    if (imageGen && imageGen.trim() && (!blueprint.pipeline || pipelineModelTypes.includes('image_generator'))) {
      return imageGen;
    }
    if (legacyModel && legacyModel.trim()) {
      return legacyModel;
    }
    
    return 'No model';
  };

  return (
    <>
      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b">
              <TableHead className="w-[40%]">Blueprint</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead className="text-right">Variables</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {blueprints.map((blueprint) => {
              const ContentTypeIcon = getPipelineIcon(blueprint.pipeline);
              const variableCount = blueprint.structure.slots.length;
              
              return (
                <TableRow 
                  key={blueprint.id} 
                  className="group cursor-pointer"
                  onClick={() => onEdit(blueprint)}
                >
                  <TableCell>
                    <div className="flex items-start gap-3">
                      <ContentTypeIcon className="h-4 w-4 text-foreground mt-0.5 shrink-0" />
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-medium">{blueprint.name}</div>
                        {blueprint.description && (
                          <div className="text-sm text-muted-foreground line-clamp-1">
                            {blueprint.description}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground/70">
                          {getPrimaryModel(blueprint)}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {blueprint.pipeline ? (
                      <span className="text-sm">{formatLabel(blueprint.pipeline)}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-muted-foreground">{variableCount}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm text-muted-foreground">
                      {formatRelativeTime(blueprint.updated_at)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onUse(blueprint); }}>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Use
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(blueprint); }}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDuplicate(blueprint); }}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setFolderBlueprintId(blueprint.id); }}>
                          <FolderInput className="mr-2 h-4 w-4" />
                          Move to Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); setDeleteId(blueprint.id); }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Blueprint</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this blueprint? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) {
                  onDelete(deleteId);
                  setDeleteId(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Move to Folder Dialog */}
      <Dialog open={!!folderBlueprintId} onOpenChange={(open) => !open && setFolderBlueprintId(null)}>
        <DialogContent className="sm:max-w-[300px] p-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm">Move to folder</DialogTitle>
          </DialogHeader>
          <div className="px-2 pb-3 space-y-0.5">
            {folderBlueprint?.folder_id && (
              <button
                className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors text-muted-foreground"
                onClick={() => {
                  updateFolder.mutate({ blueprintId: folderBlueprintId!, folderId: null });
                  setFolderBlueprintId(null);
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
                  folder.id === folderBlueprint?.folder_id ? "bg-accent font-medium" : ""
                )}
                onClick={() => {
                  updateFolder.mutate({ blueprintId: folderBlueprintId!, folderId: folder.id });
                  setFolderBlueprintId(null);
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
