import { useState } from "react";
import {
  ChevronDown,
  FolderInput,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
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

export interface IdeasSelectionBarProps {
  selectedCount: number;
  busy?: boolean;
  onClear: () => void;
  onCreate: () => void;
  onAnalyze: () => void;
  onTags: () => void;
  onMove: () => void;
  onAssign: () => void;
  onRemove: () => void;
  onDelete: () => void;
}

export function IdeasSelectionBar({
  selectedCount,
  busy,
  onClear,
  onCreate,
  onAnalyze,
  onTags,
  onMove,
  onAssign,
  onRemove,
  onDelete,
}: IdeasSelectionBarProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (selectedCount === 0) return null;

  return (
    <>
      <div
        className="sticky top-2 z-20 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-amber-300/70 bg-background px-3 py-2 shadow-sm"
        role="region"
        aria-label="Selected ideas actions"
      >
        <p className="mr-auto text-sm font-medium" aria-live="polite">
          {selectedCount} {selectedCount === 1 ? "idea" : "ideas"} selected
        </p>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClear}>
          <X />
          Clear
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={busy}>
              Manage
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onTags}>
              <Tags className="mr-2 h-4 w-4" />
              Edit tags
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onMove}>
              <FolderInput className="mr-2 h-4 w-4" />
              Move to folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onAnalyze}>
              <Sparkles className="mr-2 h-4 w-4" />
              Enrich ideas
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAssign}>
              Assign to autopilot
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove}>
              Remove from autopilot
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setConfirmDelete(true)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete ideas
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="cta" size="sm" disabled={busy} onClick={onCreate}>
          <Sparkles />
          Create content
        </Button>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount} {selectedCount === 1 ? "idea" : "ideas"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected ideas from your library.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={busy}
              onClick={onDelete}
            >
              Delete {selectedCount === 1 ? "idea" : "ideas"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
