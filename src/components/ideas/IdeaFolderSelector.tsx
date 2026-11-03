import { useState } from "react";
import { Check, ChevronsUpDown, Folder, FolderOpen, Plus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useIdeaFolders, type IdeaFolder } from "@/hooks/useIdeaFolders";
import { useUpdateIdeaFolder, useIdeaFoldersCRUD } from "@/hooks/useIdeaFoldersCRUD";

// Preset colors for folders
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

const FOLDER_COLOR_NAMES = ["indigo", "violet", "pink", "red", "orange", "yellow", "green", "teal", "sky", "gray"];

interface IdeaFolderSelectorProps {
  id?: string;
  "aria-label"?: string;
  ideaId: string;
  currentFolderId?: string | null;
  currentFolder?: { id: string; name: string; color: string } | null;
  className?: string;
  disabled?: boolean;
}

export function IdeaFolderSelector({
  id,
  "aria-label": ariaLabel = "Folder",
  ideaId,
  currentFolderId,
  currentFolder,
  className,
  disabled = false,
}: IdeaFolderSelectorProps) {
  const [open, setOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);

  const { data: folders = [], isLoading: isLoadingFolders } = useIdeaFolders();
  const { mutateAsync: updateFolder, isPending: isUpdating } = useUpdateIdeaFolder();
  const { createFolder, isCreating } = useIdeaFoldersCRUD();

  const handleSelectFolder = async (folderId: string | null) => {
    setOpen(false);
    await updateFolder({ ideaId, folderId });
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const newFolder = await createFolder.mutateAsync({
        name: newFolderName,
        color: newFolderColor,
      });
      setShowCreateDialog(false);
      setNewFolderName("");
      setNewFolderColor(FOLDER_COLORS[0]);
      // Auto-select the new folder
      if (newFolder?.id) {
        await updateFolder({ ideaId, folderId: newFolder.id });
      }
    } catch (error) {
      // Error handled in hook
    }
  };

  const selectedFolder = folders.find((f) => f.id === currentFolderId) || currentFolder;

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            aria-label={ariaLabel}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || isLoadingFolders || isUpdating}
            className="w-full min-w-0 justify-between font-normal"
          >
            {isLoadingFolders || isUpdating ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isUpdating ? "Updating..." : "Loading..."}
              </span>
            ) : selectedFolder ? (
              <span className="flex min-w-0 items-center gap-2">
                <Folder className="h-4 w-4 shrink-0" style={{ color: selectedFolder.color }} />
                <span className="truncate" title={selectedFolder.name}>{selectedFolder.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">No folder</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}>

          <Command>
            <CommandInput placeholder="Search folders..." />
            <CommandList>
              <CommandEmpty>No folders found.</CommandEmpty>
              <CommandGroup>
                {/* No folder option */}
                <CommandItem
                  value="__none__"
                  onSelect={() => handleSelectFolder(null)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      !currentFolderId ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <X className="mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">No folder</span>
                </CommandItem>

                {/* Folder options */}
                {folders.map((folder) => (
                  <CommandItem
                    key={folder.id}
                    value={folder.name}
                    onSelect={() => handleSelectFolder(folder.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        currentFolderId === folder.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {currentFolderId === folder.id ? (
                      <FolderOpen className="mr-2 h-4 w-4 shrink-0" style={{ color: folder.color }} />
                    ) : (
                      <Folder className="mr-2 h-4 w-4 shrink-0" style={{ color: folder.color }} />
                    )}
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{folder.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  onSelect={() => {
                    setOpen(false);
                    setShowCreateDialog(true);
                  }}
                  className="text-primary"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create new folder
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Create Folder Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-folder-name">Name</Label>
              <Input
                id="new-folder-name"
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreateFolder();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map((color, index) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Choose ${FOLDER_COLOR_NAMES[index]} folder color`}
                    aria-pressed={newFolderColor === color}
                    onClick={() => setNewFolderColor(color)}
                    className={cn(
                      "w-8 h-8 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      newFolderColor === color
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
                setNewFolderName("");
                setNewFolderColor(FOLDER_COLORS[0]);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || isCreating}
            >
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
