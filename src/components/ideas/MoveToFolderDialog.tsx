import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Folder, FolderOpen, Inbox, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIdeaFolders } from "@/hooks/useIdeaFolders";
import { useMoveIdeasToFolder } from "@/hooks/useIdeaFoldersCRUD";

interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onComplete?: () => void;
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  selectedIds,
  onComplete,
}: MoveToFolderDialogProps) {
  const { data: folders = [], isLoading: isLoadingFolders } = useIdeaFolders();
  const { mutateAsync: moveToFolder, isPending: isMoving } = useMoveIdeasToFolder();

  // "none" means remove from folder (set folder_id to null)
  const [selectedFolderId, setSelectedFolderId] = useState<string>("none");

  const handleMove = async () => {
    try {
      await moveToFolder({
        ideaIds: selectedIds,
        folderId: selectedFolderId === "none" ? null : selectedFolderId,
      });
      handleClose();
      onComplete?.();
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleClose = () => {
    setSelectedFolderId("none");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Move {selectedIds.length} Idea{selectedIds.length !== 1 ? "s" : ""} to Folder
          </DialogTitle>
          <DialogDescription>
            Select a folder to move the selected ideas to, or remove them from their current folder.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[300px] pr-4">
          {isLoadingFolders ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <RadioGroup
              value={selectedFolderId}
              onValueChange={setSelectedFolderId}
              className="space-y-2"
            >
              {/* Remove from folder option */}
              <div
                className={cn(
                  "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  selectedFolderId === "none"
                    ? "border-primary bg-primary/5"
                    : "border-transparent bg-muted/50 hover:bg-muted"
                )}
                onClick={() => setSelectedFolderId("none")}
              >
                <RadioGroupItem value="none" id="folder-none" />
                <Label
                  htmlFor="folder-none"
                  className="flex-1 flex items-center gap-3 cursor-pointer"
                >
                  <Inbox className="h-4 w-4 text-muted-foreground" />
                  <span>Remove from folder</span>
                </Label>
              </div>

              {/* Folder options */}
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className={cn(
                    "flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors",
                    selectedFolderId === folder.id
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-muted/50 hover:bg-muted"
                  )}
                  onClick={() => setSelectedFolderId(folder.id)}
                >
                  <RadioGroupItem value={folder.id} id={`folder-${folder.id}`} />
                  <Label
                    htmlFor={`folder-${folder.id}`}
                    className="flex-1 flex items-center gap-3 cursor-pointer"
                  >
                    {selectedFolderId === folder.id ? (
                      <FolderOpen className="h-4 w-4" style={{ color: folder.color }} />
                    ) : (
                      <Folder className="h-4 w-4" style={{ color: folder.color }} />
                    )}
                    <span>{folder.name}</span>
                  </Label>
                </div>
              ))}

              {/* Empty state */}
              {folders.length === 0 && (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <Folder className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No folders available</p>
                  <p className="text-xs mt-1">Create folders from the sidebar</p>
                </div>
              )}
            </RadioGroup>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isMoving}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleMove} disabled={isMoving}>
            {isMoving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {selectedFolderId === "none" ? "Remove from Folder" : "Move to Folder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
