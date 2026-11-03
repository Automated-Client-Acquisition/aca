import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect } from "react";
import { Boxes, Calendar, Trash2, FileText, Hash, Zap, Target, Sparkles, BookOpen, Palette } from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EditableList } from "./EditableList";

interface Block {
  id: string;
  name: string;
  block_type: string;
  content: string | null;
  tags: string[] | null;
  created_at: string | null;
}

interface BlockDetailsDialogProps {
  block: Block | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<Block>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function BlockDetailsDialog({ block, open, onOpenChange, onSave, onDelete, isUpdating }: BlockDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<Block>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!open || !block) {
      setEdited({});
    }
  }, [open, block?.id]);

  const { isSaving } = useAutosave(
    (updates) => {
      if (block) {
        onSave(block.id, updates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

  const handleSave = () => {
    if (block && Object.keys(edited).length > 0) {
      onSave(block.id, edited);
      setEdited({});
      onOpenChange(false);
    } else {
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (block) {
      onDelete(block.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!block) return null;

  const currentName = edited.name ?? block.name;
  const currentBlockType = edited.block_type ?? block.block_type;
  const currentContent = edited.content ?? block.content ?? "";
  const currentTags = edited.tags ?? block.tags ?? [];

  const blockTypeLabels: Record<string, string> = {
    hook: "Hook",
    angle: "Angle",
    cta: "CTA",
    story_element: "Story Element",
    visual_style: "Visual Style",
  };

  const blockTypeIcons: Record<string, any> = {
    hook: Zap,
    angle: Target,
    cta: Sparkles,
    story_element: BookOpen,
    visual_style: Palette,
  };

  const blockTypeColors: Record<string, string> = {
    hook: "yellow",
    angle: "green",
    cta: "purple",
    story_element: "blue",
    visual_style: "rose",
  };

  const BlockIcon = blockTypeIcons[currentBlockType] || Boxes;
  const colorTheme = blockTypeColors[currentBlockType] || "gray";

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-3xl p-0">
          <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <BlockIcon className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">Edit Block</DialogTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(block.created_at)}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {blockTypeLabels[currentBlockType] || currentBlockType}
                      </Badge>
                    </div>
                  </div>
                </div>
                <AutosaveIndicator isSaving={isSaving} />
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-6 py-4">
                <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="blockType" className="text-sm font-medium">
                        Type
                      </Label>
                      <Select 
                        value={currentBlockType} 
                        onValueChange={(value) => setEdited({ ...edited, block_type: value })}
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hook">
                            <div className="flex items-center gap-2">
                              <Zap className="w-4 h-4" />
                              Hook
                            </div>
                          </SelectItem>
                          <SelectItem value="angle">
                            <div className="flex items-center gap-2">
                              <Target className="w-4 h-4" />
                              Angle
                            </div>
                          </SelectItem>
                          <SelectItem value="cta">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4" />
                              CTA
                            </div>
                          </SelectItem>
                          <SelectItem value="story_element">
                            <div className="flex items-center gap-2">
                              <BookOpen className="w-4 h-4" />
                              Story Element
                            </div>
                          </SelectItem>
                          <SelectItem value="visual_style">
                            <div className="flex items-center gap-2">
                              <Palette className="w-4 h-4" />
                              Visual Style
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium">Name</Label>
                      <Input 
                        id="name" 
                        value={currentName} 
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })} 
                        className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="content" className="text-sm font-medium">
                      Content
                    </Label>
                    <Textarea 
                      id="content" 
                      value={currentContent} 
                      onChange={(e) => setEdited({ ...edited, content: e.target.value })} 
                      placeholder="Enter block content..."
                      className="resize-y font-mono text-sm min-h-[200px] max-h-[400px] focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Tags
                    </Label>
                    <EditableList
                      items={currentTags}
                      onChange={(items) => setEdited({ ...edited, tags: items })}
                      placeholder="Add organizational tags..."
                    />
                  </div>
                </div>
              </div>
            </ScrollArea>

            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-t">
              <Button 
                type="button"
                variant="destructive" 
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Block
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="min-w-24"
              >
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Block</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{block.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
