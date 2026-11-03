import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect } from "react";
import {
  Calendar,
  Trash2,
  FileText,
  Hash,
  Star,
  Image,
  Video,
  Music,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { formatDate } from "@/lib/tableUtils";
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
import { EditableList } from "@/components/EditableList";
import type {
  SavedContent,
  SavedContentType,
  UpdateSavedContentInput,
  TextContentData,
  ImageContentData,
  VideoContentData,
  AudioContentData,
} from "@/types/savedContent";

interface SavedContentDetailDialogProps {
  item: SavedContent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: UpdateSavedContentInput) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string, isFavorite: boolean) => void;
  isUpdating: boolean;
}

const contentTypeIcons: Record<SavedContentType, React.ReactNode> = {
  text: <FileText className="h-6 w-6" />,
  image: <Image className="h-6 w-6" />,
  video: <Video className="h-6 w-6" />,
  audio: <Music className="h-6 w-6" />,
};

const contentTypeColors: Record<SavedContentType, string> = {
  text: "blue",
  image: "green",
  video: "purple",
  audio: "orange",
};

// Format prompt text with section highlighting
function FormattedPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Parse prompt into sections based on common patterns
  const formatPrompt = (text: string) => {
    // Split by common section headers (ALL CAPS followed by colon)
    const sectionPattern = /([A-Z][A-Z\s&\/]+):\s*/g;
    const parts: Array<{ type: 'header' | 'content'; text: string }> = [];

    let lastIndex = 0;
    let match;

    while ((match = sectionPattern.exec(text)) !== null) {
      // Add content before this header
      if (match.index > lastIndex) {
        const content = text.slice(lastIndex, match.index).trim();
        if (content) {
          parts.push({ type: 'content', text: content });
        }
      }
      // Add the header
      parts.push({ type: 'header', text: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining content
    if (lastIndex < text.length) {
      const content = text.slice(lastIndex).trim();
      if (content) {
        parts.push({ type: 'content', text: content });
      }
    }

    // If no sections found, return original text
    if (parts.length === 0) {
      return [{ type: 'content' as const, text: text }];
    }

    return parts;
  };

  const formattedParts = formatPrompt(prompt);
  const isLong = prompt.length > 500;

  return (
    <div className="rounded-lg border bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Prompt
        </span>
        <div className="flex items-center gap-2">
          {isLong && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className="h-7 px-2 gap-1.5 text-xs"
            >
              {isExpanded ? 'Collapse' : 'Expand'}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 gap-1.5 text-xs"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <div
        className={`p-3 space-y-2 text-sm overflow-y-auto ${
          isExpanded ? 'max-h-[400px]' : 'max-h-[150px]'
        }`}
      >
        {formattedParts.map((part, index) => (
          part.type === 'header' ? (
            <div key={index} className="flex items-center gap-2 mt-3 first:mt-0">
              <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded">
                {part.text}
              </span>
            </div>
          ) : (
            <p key={index} className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
              {part.text}
            </p>
          )
        ))}
      </div>
    </div>
  );
}

function ContentPreview({ item }: { item: SavedContent }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  switch (item.content_type) {
    case "text": {
      const content = item.content as TextContentData;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Content</Label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleCopy(content.text)}
              className="gap-2"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          <div className="p-4 bg-muted rounded-lg">
            <p className="whitespace-pre-wrap text-sm">{content.text}</p>
          </div>
        </div>
      );
    }

    case "image": {
      const content = item.content as ImageContentData;
      return (
        <div className="space-y-4">
          {content.url && (
            <div className="space-y-2">
              <Label className="text-base font-semibold">Image</Label>
              <div className="relative group">
                <img
                  src={content.url}
                  alt={item.name}
                  className="rounded-lg max-h-[400px] w-full object-contain bg-muted"
                />
                <a
                  href={content.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 right-2 p-2 bg-background/80 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          )}
          {content.prompt && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Generation Prompt</Label>
              <FormattedPrompt prompt={content.prompt} />
            </div>
          )}
          {content.width && content.height && (
            <div className="text-sm text-muted-foreground">
              Dimensions: {content.width} × {content.height}
            </div>
          )}
        </div>
      );
    }

    case "video": {
      const content = item.content as VideoContentData;
      return (
        <div className="space-y-4">
          {content.url && (
            <div className="space-y-2">
              <Label className="text-base font-semibold">Video</Label>
              <video
                src={content.url}
                controls
                className="rounded-lg max-h-[400px] w-full bg-muted"
              />
            </div>
          )}
          {content.duration && (
            <div className="text-sm text-muted-foreground">
              Duration: {Math.floor(content.duration / 60)}:{String(content.duration % 60).padStart(2, "0")}
            </div>
          )}
        </div>
      );
    }

    case "audio": {
      const content = item.content as AudioContentData;
      return (
        <div className="space-y-4">
          {content.url && (
            <div className="space-y-2">
              <Label className="text-base font-semibold">Audio</Label>
              <audio src={content.url} controls className="w-full" />
            </div>
          )}
          {content.transcript && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Transcript</Label>
              <p className="text-sm p-3 bg-muted rounded-lg whitespace-pre-wrap">
                {content.transcript}
              </p>
            </div>
          )}
          {content.duration && (
            <div className="text-sm text-muted-foreground">
              Duration: {Math.floor(content.duration / 60)}:{String(content.duration % 60).padStart(2, "0")}
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

export function SavedContentDetailDialog({
  item,
  open,
  onOpenChange,
  onSave,
  onDelete,
  onToggleFavorite,
  isUpdating,
}: SavedContentDetailDialogProps) {
  const [edited, setEdited] = useState<UpdateSavedContentInput>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    if (!open || !item) {
      setEdited({});
    }
  }, [open, item?.id]);

  const { isSaving } = useAutosave(
    (updates) => {
      if (item) {
        onSave(item.id, updates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

  const handleSave = () => {
    if (item && Object.keys(edited).length > 0) {
      onSave(item.id, edited);
      setEdited({});
      onOpenChange(false);
    } else {
      onOpenChange(false);
    }
  };

  const handleDelete = () => {
    if (item) {
      onDelete(item.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  const handleToggleFavorite = () => {
    if (item) {
      onToggleFavorite(item.id, !item.is_favorite);
    }
  };

  if (!item) return null;

  const currentName = edited.name ?? item.name;
  const currentDescription = edited.description ?? item.description ?? "";
  const currentTags = edited.tags ?? item.tags ?? [];

  const colorTheme = contentTypeColors[item.content_type];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-3xl">
          <form
            className="flex flex-col flex-1 min-h-0"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            <DialogHeader className="shrink-0 px-8 py-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5">
                  <div
                    className={`w-12 h-12 rounded-xl bg-gradient-to-br from-${colorTheme}-500/20 to-${colorTheme}-600/20 flex items-center justify-center`}
                  >
                    {contentTypeIcons[item.content_type]}
                  </div>
                  <div>
                    <DialogTitle className="text-2xl">Saved Content</DialogTitle>
                    <div className="flex items-center gap-3 mt-1">
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(item.created_at)}
                      </div>
                      <Badge
                        variant="outline"
                        className={`bg-${colorTheme}-500/10 text-${colorTheme}-600 border-${colorTheme}-500/30`}
                      >
                        {item.content_type.charAt(0).toUpperCase() + item.content_type.slice(1)}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleToggleFavorite}
                    className={item.is_favorite ? "text-yellow-500" : "text-muted-foreground"}
                  >
                    <Star className={`h-5 w-5 ${item.is_favorite ? "fill-current" : ""}`} />
                  </Button>
                  <AutosaveIndicator isSaving={isSaving} />
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-8 py-6">
                <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                  <div className="h-1.5 bg-gradient-to-r from-primary to-primary/60" />
                  <CardContent className="pt-6 space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-base font-semibold">
                        Name
                      </Label>
                      <Input
                        id="name"
                        value={currentName}
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                        className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="description" className="text-base font-semibold">
                        Description
                      </Label>
                      <Textarea
                        id="description"
                        value={currentDescription}
                        onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                        placeholder="Add a description..."
                        className="resize-y min-h-[80px] focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                  </CardContent>
                </Card>

                <ContentPreview item={item} />

                <div className="space-y-2">
                  <Label className="text-base font-semibold flex items-center gap-2">
                    <Hash className="w-4 h-4" />
                    Tags
                  </Label>
                  <EditableList
                    items={currentTags}
                    onChange={(items) => setEdited({ ...edited, tags: items })}
                    placeholder="Add tags..."
                  />
                </div>

                {item.source_job_id && (
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Source:</span> Job {item.source_job_id.substring(0, 8)}
                    {item.source_stage && ` (${item.source_stage} stage)`}
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="shrink-0 flex items-center justify-between px-8 py-6 border-t">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} className="min-w-24">
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Content</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{item.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
