import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Tags, Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { useIdeaTagsCRUD, useIdeasCountByTag } from "@/hooks/useIdeaTagsCRUD";

export function IdeaTagsSettings() {
  const { tags, isLoading, createTag, updateTag, deleteTag, isCreating, isDeleting } = useIdeaTagsCRUD();
  const { data: tagCounts } = useIdeasCountByTag();

  const [newTagName, setNewTagName] = useState("");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [tagToDelete, setTagToDelete] = useState<{ id: string; name: string } | null>(null);

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagName.trim()) return;

    await createTag.mutateAsync(newTagName);
    setNewTagName("");
  };

  const handleStartEdit = (tagId: string, tagName: string) => {
    setEditingTagId(tagId);
    setEditingTagName(tagName);
  };

  const handleCancelEdit = () => {
    setEditingTagId(null);
    setEditingTagName("");
  };

  const handleSaveEdit = async () => {
    if (!editingTagId || !editingTagName.trim()) return;

    await updateTag.mutateAsync({ id: editingTagId, name: editingTagName });
    setEditingTagId(null);
    setEditingTagName("");
  };

  const handleDeleteConfirm = async () => {
    if (!tagToDelete) return;

    await deleteTag.mutateAsync(tagToDelete.id);
    setTagToDelete(null);
  };

  const getTagCount = (tagId: string) => {
    return tagCounts?.[tagId] || 0;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tags className="w-5 h-5" />
            Idea Tags
          </CardTitle>
          <CardDescription>
            Create and manage tags to organize your content ideas. Tags can be used to filter ideas in autopilots.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Add New Tag */}
          <form onSubmit={handleCreateTag} className="flex gap-2">
            <Input
              placeholder="Enter new tag name..."
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              className="max-w-xs"
              disabled={isCreating}
            />
            <Button variant="cta" type="submit" disabled={!newTagName.trim() || isCreating}>
              {isCreating ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Add Tag
            </Button>
          </form>

          {/* Tags List */}
          <div className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Tags className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p>No tags yet</p>
                <p className="text-sm">Create your first tag to start organizing ideas</p>
              </div>
            ) : (
              <div className="border rounded-lg divide-y">
                {tags.map((tag) => {
                  const count = getTagCount(tag.id);
                  const isEditing = editingTagId === tag.id;

                  return (
                    <div
                      key={tag.id}
                      className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {isEditing ? (
                          <Input
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                            className="max-w-xs h-8"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit();
                              if (e.key === "Escape") handleCancelEdit();
                            }}
                          />
                        ) : (
                          <>
                            <Badge variant="secondary" className="font-medium">
                              {tag.name}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {count} {count === 1 ? "idea" : "ideas"}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={handleSaveEdit}
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={handleCancelEdit}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleStartEdit(tag.id, tag.name)}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setTagToDelete({ id: tag.id, name: tag.name })}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!tagToDelete} onOpenChange={() => setTagToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the tag "{tagToDelete?.name}"?
              {tagToDelete && getTagCount(tagToDelete.id) > 0 && (
                <span className="block mt-2 text-amber-600">
                  This tag is assigned to {getTagCount(tagToDelete.id)} ideas.
                  The tag will be removed from all ideas.
                </span>
              )}
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
    </div>
  );
}
