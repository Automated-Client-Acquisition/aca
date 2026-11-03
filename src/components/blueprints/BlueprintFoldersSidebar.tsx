import { useState } from "react";
import { Folder, FolderOpen, Plus, MoreHorizontal, Pencil, Trash2, Loader2, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useBlueprintFolders, type BlueprintFolder } from "@/hooks/useBlueprintFolders";
import { useBlueprintsCountByFolder } from "@/hooks/useBlueprintFolders";
import { useBlueprintFoldersCRUD } from "@/hooks/useBlueprintFoldersCRUD";

const FOLDER_COLORS = [
  "#6366f1", // Indigo (default)
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#14b8a6", // Teal
  "#0ea5e9", // Sky
  "#6b7280", // Gray
];

interface BlueprintFoldersSidebarProps {
  selectedFolder: string | null;
  onSelectFolder: (folderId: string | null) => void;
  className?: string;
}

export function BlueprintFoldersSidebar({
  selectedFolder,
  onSelectFolder,
  className,
}: BlueprintFoldersSidebarProps) {
  const { data: folders = [], isLoading } = useBlueprintFolders();
  const { data: counts } = useBlueprintsCountByFolder();
  const { createFolder, updateFolder, deleteFolder, isCreating, isDeleting } = useBlueprintFoldersCRUD();

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingFolder, setEditingFolder] = useState<BlueprintFolder | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<BlueprintFolder | null>(null);

  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(FOLDER_COLORS[0]);

  const handleCreateFolder = async () => {
    if (!formName.trim()) return;
    try {
      await createFolder.mutateAsync({ name: formName, color: formColor });
      setShowCreateDialog(false);
      resetForm();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleUpdateFolder = async () => {
    if (!editingFolder || !formName.trim()) return;
    try {
      await updateFolder.mutateAsync({ id: editingFolder.id, name: formName, color: formColor });
      setEditingFolder(null);
      resetForm();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;
    try {
      if (selectedFolder === folderToDelete.id) {
        onSelectFolder(null);
      }
      await deleteFolder.mutateAsync(folderToDelete.id);
      setFolderToDelete(null);
    } catch (error) {
      // Error handled in hook
    }
  };

  const resetForm = () => {
    setFormName("");
    setFormColor(FOLDER_COLORS[0]);
  };

  const openEditDialog = (folder: BlueprintFolder) => {
    setEditingFolder(folder);
    setFormName(folder.name);
    setFormColor(folder.color);
  };

  const totalBlueprints = (counts?.uncategorized || 0) + Object.values(counts?.folders || {}).reduce((a, b) => a + b, 0);

  return (
    <div className={cn("flex flex-col rounded-xl border bg-card shadow-sm", className)}>
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-sm text-foreground">Folders</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => setShowCreateDialog(true)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-px bg-border mx-3" />

      {/* Folder List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {/* All Blueprints */}
          <button
            onClick={() => onSelectFolder(null)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              selectedFolder === null
                ? "bg-accent text-accent-foreground font-medium"
                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            )}
          >
            <Folder className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">All Blueprints</span>
            <span className={cn(
              "text-xs tabular-nums min-w-[1.5rem] text-right",
              selectedFolder === null ? "text-accent-foreground/70" : "text-muted-foreground"
            )}>{totalBlueprints}</span>
          </button>

          {/* Uncategorized */}
          <button
            onClick={() => onSelectFolder("uncategorized")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
              selectedFolder === "uncategorized"
                ? "bg-accent text-accent-foreground font-medium"
                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
            )}
          >
            <Inbox className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Uncategorized</span>
            <span className={cn(
              "text-xs tabular-nums min-w-[1.5rem] text-right",
              selectedFolder === "uncategorized" ? "text-accent-foreground/70" : "text-muted-foreground"
            )}>{counts?.uncategorized || 0}</span>
          </button>

          {/* Divider */}
          {folders.length > 0 && <div className="h-px bg-border mx-1 my-1.5" />}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Folders */}
          {folders.map((folder) => {
            const isSelected = selectedFolder === folder.id;
            const count = counts?.folders[folder.id] || 0;

            return (
              <div
                key={folder.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md transition-colors",
                  isSelected ? "bg-accent" : "hover:bg-accent/50"
                )}
              >
                <button
                  onClick={() => onSelectFolder(folder.id)}
                  className="flex-1 flex items-center gap-3 px-3 py-2 text-sm min-w-0"
                >
                  {isSelected ? (
                    <FolderOpen className="h-4 w-4 shrink-0" style={{ color: folder.color }} />
                  ) : (
                    <Folder className="h-4 w-4 shrink-0" style={{ color: folder.color }} />
                  )}
                  <span
                    className={cn(
                      "flex-1 text-left truncate",
                      isSelected ? "text-accent-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {folder.name}
                  </span>
                  <span className={cn(
                    "text-xs tabular-nums min-w-[1.5rem] text-right",
                    isSelected ? "text-accent-foreground/70" : "text-muted-foreground"
                  )}>{count}</span>
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditDialog(folder)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setFolderToDelete(folder)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          {/* Empty state */}
          {!isLoading && folders.length === 0 && (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No folders yet</p>
              <Button
                variant="link"
                size="sm"
                className="mt-1"
                onClick={() => setShowCreateDialog(true)}
              >
                Create your first folder
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Create/Edit Dialog */}
      <Dialog
        open={showCreateDialog || !!editingFolder}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateDialog(false);
            setEditingFolder(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {editingFolder ? "Edit Folder" : "Create Folder"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                placeholder="Folder name..."
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    editingFolder ? handleUpdateFolder() : handleCreateFolder();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setFormColor(color)}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all",
                      formColor === color
                        ? "ring-2 ring-offset-2 ring-primary"
                        : "hover:scale-110"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateDialog(false);
                setEditingFolder(null);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={editingFolder ? handleUpdateFolder : handleCreateFolder}
              disabled={!formName.trim() || isCreating}
            >
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingFolder ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!folderToDelete} onOpenChange={() => setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{folderToDelete?.name}"?
              Blueprints in this folder will become uncategorized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteFolder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
