import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Bookmark, FileText, Image, Video, Music } from "lucide-react";
import { useSavedContent } from "@/hooks/useSavedContent";
import type { SavedContentType } from "@/types/savedContent";
import { toast } from "sonner";

export interface SaveableContent {
  id: string;
  contentType: SavedContentType;
  content: Record<string, any>;
  suggestedName: string;
  sourceStage: string;
  preview?: string;
  thumbnailUrl?: string;
}

interface SaveContentMultiDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableContent: SaveableContent[];
  sourceOutputId?: string;
  sourceJobId?: string;
  outputTitle?: string;
}

const contentTypeIcons: Record<SavedContentType, React.ReactNode> = {
  text: <FileText className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  audio: <Music className="h-4 w-4" />,
};

const contentTypeColors: Record<SavedContentType, string> = {
  text: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  image: "bg-green-500/10 text-green-600 border-green-500/20",
  video: "bg-primary/10 text-primary border-primary/20",
  audio: "bg-cta/10 text-cta border-cta/20",
};

export function SaveContentMultiDialog({
  open,
  onOpenChange,
  availableContent,
  sourceOutputId,
  sourceJobId,
  outputTitle,
}: SaveContentMultiDialogProps) {
  const { createSavedContent, isCreating } = useSavedContent();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setSelectedIds([]);
      setCustomNames({});
    }
    onOpenChange(isOpen);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setSelectedIds(availableContent.map((c) => c.id));
  };

  const clearAll = () => {
    setSelectedIds([]);
  };

  const getName = (item: SaveableContent) => {
    return customNames[item.id] || item.suggestedName;
  };

  const handleSave = async () => {
    if (selectedIds.length === 0) return;

    setIsSaving(true);
    let savedCount = 0;
    let errorCount = 0;

    for (const id of selectedIds) {
      const item = availableContent.find((c) => c.id === id);
      if (!item) continue;

      try {
        await createSavedContent({
          name: getName(item),
          content_type: item.contentType,
          content: item.content as any, // Content structure matches the type based on contentType
          source_output_id: sourceOutputId,
          source_job_id: sourceJobId,
          source_stage: item.sourceStage,
        });
        savedCount++;
      } catch (error) {
        errorCount++;
      }
    }

    setIsSaving(false);

    if (errorCount === 0) {
      toast.success(`Saved ${savedCount} item${savedCount !== 1 ? "s" : ""} to library`);
      onOpenChange(false);
    } else if (savedCount > 0) {
      toast.warning(`Saved ${savedCount} items, ${errorCount} failed`);
    }
  };

  const getPreviewContent = (item: SaveableContent) => {
    if (item.thumbnailUrl) {
      return (
        <img
          src={item.thumbnailUrl}
          alt={item.suggestedName}
          className="h-16 w-16 rounded-lg object-cover"
        />
      );
    }

    if (item.contentType === "image" && (item.content as any).url) {
      return (
        <img
          src={(item.content as any).url}
          alt={item.suggestedName}
          className="h-16 w-16 rounded-lg object-cover"
        />
      );
    }

    return (
      <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center">
        {contentTypeIcons[item.contentType]}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-5 w-5" />
            Save to Library
          </DialogTitle>
        </DialogHeader>

        {availableContent.length === 0 ? (
          <div className="py-8 text-center">
            <Bookmark className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No content available to save yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Generate some content first
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between py-2">
              <p className="text-sm text-muted-foreground">
                Select content to save ({selectedIds.length} of {availableContent.length})
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll} className="h-7 text-xs">
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={clearAll} className="h-7 text-xs">
                  Clear
                </Button>
              </div>
            </div>

            <ScrollArea className="max-h-[450px] -mx-6 px-6">
              <div className="space-y-3 pb-2">
                {availableContent.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleSelection(item.id)}
                      className={`flex items-start gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-0.5 shrink-0"
                      />

                      <div className="shrink-0">
                        {getPreviewContent(item)}
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className={`text-xs shrink-0 ${contentTypeColors[item.contentType]}`}
                          >
                            {contentTypeIcons[item.contentType]}
                            <span className="ml-1 capitalize">{item.contentType}</span>
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            from {item.sourceStage}
                          </span>
                        </div>

                        {isSelected ? (
                          <Input
                            value={getName(item)}
                            onChange={(e) => {
                              e.stopPropagation();
                              setCustomNames((prev) => ({
                                ...prev,
                                [item.id]: e.target.value,
                              }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Enter name..."
                            className="h-9"
                          />
                        ) : (
                          <p className="text-sm font-medium truncate">{item.suggestedName}</p>
                        )}

                        {item.preview && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.preview}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={selectedIds.length === 0 || isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Bookmark className="h-4 w-4 mr-2" />
                Save {selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
