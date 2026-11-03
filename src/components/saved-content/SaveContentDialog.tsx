import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Bookmark, FileText, Image, Video, Music, Hash } from "lucide-react";
import { EditableList } from "@/components/EditableList";
import { useSavedContent } from "@/hooks/useSavedContent";
import type {
  SavedContentType,
  SavedContentData,
  CreateSavedContentInput,
} from "@/types/savedContent";

interface SaveContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentType: SavedContentType;
  content: SavedContentData;
  suggestedName?: string;
  sourceOutputId?: string;
  sourceJobId?: string;
  sourceStage?: string;
}

const contentTypeIcons: Record<SavedContentType, React.ReactNode> = {
  text: <FileText className="h-5 w-5" />,
  image: <Image className="h-5 w-5" />,
  video: <Video className="h-5 w-5" />,
  audio: <Music className="h-5 w-5" />,
};

const contentTypeLabels: Record<SavedContentType, string> = {
  text: "Text",
  image: "Image",
  video: "Video",
  audio: "Audio",
};

export function SaveContentDialog({
  open,
  onOpenChange,
  contentType,
  content,
  suggestedName = "",
  sourceOutputId,
  sourceJobId,
  sourceStage,
}: SaveContentDialogProps) {
  const { createSavedContent, isCreating } = useSavedContent();
  const [name, setName] = useState(suggestedName);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const handleSave = async () => {
    if (!name.trim()) return;

    const input: CreateSavedContentInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      content_type: contentType,
      content,
      source_output_id: sourceOutputId,
      source_job_id: sourceJobId,
      source_stage: sourceStage,
      tags: tags.length > 0 ? tags : undefined,
    };

    try {
      await createSavedContent(input);
      onOpenChange(false);
      // Reset form
      setName("");
      setDescription("");
      setTags([]);
    } catch (error) {
      // Error is handled by the hook
    }
  };

  // Reset form when dialog opens with new content
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setName(suggestedName);
      setDescription("");
      setTags([]);
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-5 w-5" />
            Save to Library
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5">
              {contentTypeIcons[contentType]}
              {contentTypeLabels[contentType]}
            </Badge>
            {sourceStage && (
              <Badge variant="secondary" className="text-xs">
                {sourceStage}
              </Badge>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a name for this content..."
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description (optional)..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Hash className="h-4 w-4" />
              Tags
            </Label>
            <EditableList
              items={tags}
              onChange={setTags}
              placeholder="Add tags..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={!name.trim() || isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Bookmark className="h-4 w-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
