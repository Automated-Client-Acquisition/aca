import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useIdeaTags } from "@/hooks/useIdeaTags";
import { useBulkAssignTags, useBulkRemoveTags } from "@/hooks/useIdeaTagAssignments";
import { useIdeaTagsCRUD } from "@/hooks/useIdeaTagsCRUD";
import { Tag, Loader2, Plus, Minus, Pencil, Trash2, Check, X } from "lucide-react";

interface BulkTagsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  onComplete?: () => void;
}

export function BulkTagsDialog({ open, onOpenChange, selectedIds, onComplete }: BulkTagsDialogProps) {
  const { data: availableTags = [], isLoading: isLoadingTags } = useIdeaTags();
  const { mutateAsync: bulkAssign, isPending: isAssigning } = useBulkAssignTags();
  const { mutateAsync: bulkRemove, isPending: isRemoving } = useBulkRemoveTags();
  const { createTag, updateTag, deleteTag, isCreating, isDeleting } = useIdeaTagsCRUD();

  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"add" | "remove">("add");

  // CRUD state
  const [newTagName, setNewTagName] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [tagToDelete, setTagToDelete] = useState<{ id: string; name: string } | null>(null);

  const handleToggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };

  const handleApply = async () => {
    if (selectedTagIds.length === 0) return;

    try {
      if (activeTab === "add") {
        await bulkAssign({ ideaIds: selectedIds, tagIds: selectedTagIds });
      } else {
        await bulkRemove({ ideaIds: selectedIds, tagIds: selectedTagIds });
      }
      handleClose();
      onComplete?.();
    } catch (error) {
      // Error is handled in the hooks
    }
  };

  const handleClose = () => {
    setSelectedTagIds([]);
    setActiveTab("add");
    setNewTagName("");
    setEditingTagId(null);
    setEditingTagName("");
    onOpenChange(false);
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      await createTag.mutateAsync(newTagName);
      setNewTagName("");
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleStartEdit = (tagId: string, tagName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTagId(tagId);
    setEditingTagName(tagName);
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingTagId(null);
    setEditingTagName("");
  };

  const handleSaveEdit = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!editingTagId || !editingTagName.trim()) return;
    try {
      await updateTag.mutateAsync({ id: editingTagId, name: editingTagName });
      setEditingTagId(null);
      setEditingTagName("");
    } catch (error) {
      // Error handled in hook
    }
  };

  const handleDeleteClick = (tagId: string, tagName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTagToDelete({ id: tagId, name: tagName });
  };

  const handleDeleteConfirm = async () => {
    if (!tagToDelete) return;
    try {
      // Remove from selection if selected
      setSelectedTagIds((prev) => prev.filter((id) => id !== tagToDelete.id));
      await deleteTag.mutateAsync(tagToDelete.id);
      setTagToDelete(null);
    } catch (error) {
      // Error handled in hook
    }
  };

  const isPending = isAssigning || isRemoving;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Manage Tags for {selectedIds.length} Idea{selectedIds.length !== 1 ? "s" : ""}
            </DialogTitle>
            <DialogDescription>
              Select tags to add or remove from the selected ideas.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "add" | "remove"); setSelectedTagIds([]); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="add" className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Tags
              </TabsTrigger>
              <TabsTrigger value="remove" className="flex items-center gap-2">
                <Minus className="h-4 w-4" />
                Remove Tags
              </TabsTrigger>
            </TabsList>

            <TabsContent value="add" className="mt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Select tags to add to all {selectedIds.length} selected ideas.
              </p>
            </TabsContent>

            <TabsContent value="remove" className="mt-4">
              <p className="text-sm text-muted-foreground mb-3">
                Select tags to remove from all {selectedIds.length} selected ideas.
              </p>
            </TabsContent>
          </Tabs>

          {/* Create new tag */}
          <div className="flex gap-2">
            <Input
              placeholder="New tag name..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateTag();
                }
              }}
              disabled={isCreating}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={handleCreateTag}
              disabled={!newTagName.trim() || isCreating}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          <ScrollArea className="h-[220px] pr-4">
            {isLoadingTags ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : availableTags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No tags available</p>
                <p className="text-xs mt-1">Create your first tag above</p>
              </div>
            ) : (
              <div className="space-y-2">
                {availableTags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.id);
                  const isEditing = editingTagId === tag.id;

                  return (
                    <div
                      key={tag.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors group ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-transparent bg-muted/50 hover:bg-muted"
                      }`}
                      onClick={() => !isEditing && handleToggleTag(tag.id)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleToggleTag(tag.id)}
                        onClick={(e) => e.stopPropagation()}
                        disabled={isEditing}
                      />
                      <Tag className="h-4 w-4 text-muted-foreground shrink-0" />

                      {isEditing ? (
                        <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                            className="h-7 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit();
                              if (e.key === "Escape") handleCancelEdit();
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={handleSaveEdit}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <span className="flex-1 font-medium">{tag.name}</span>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => handleStartEdit(tag.id, tag.name, e)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={(e) => handleDeleteClick(tag.id, tag.name, e)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {selectedTagIds.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2 border-t">
              <span className="text-xs text-muted-foreground mr-2 self-center">Selected:</span>
              {selectedTagIds.map((tagId) => {
                const tag = availableTags.find((t) => t.id === tagId);
                return tag ? (
                  <Badge key={tagId} variant="secondary" className="text-xs">
                    {tag.name}
                  </Badge>
                ) : null;
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={selectedTagIds.length === 0 || isPending}
              variant={activeTab === "remove" ? "destructive" : "cta"}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {activeTab === "add" ? (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add {selectedTagIds.length} Tag{selectedTagIds.length !== 1 ? "s" : ""}
                </>
              ) : (
                <>
                  <Minus className="h-4 w-4 mr-2" />
                  Remove {selectedTagIds.length} Tag{selectedTagIds.length !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!tagToDelete} onOpenChange={() => setTagToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the tag "{tagToDelete?.name}"?
              This will remove it from all ideas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
