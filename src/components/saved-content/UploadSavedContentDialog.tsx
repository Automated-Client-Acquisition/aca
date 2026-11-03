import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, Image, Video, Music, Loader2, Link, X } from "lucide-react";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { useSavedContent } from "@/hooks/useSavedContent";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { SavedContentType, SavedContentData } from "@/types/savedContent";

interface UploadSavedContentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type UploadTab = "file" | "text" | "url";

const contentTypeConfig = {
  image: {
    icon: Image,
    accept: "image/jpeg,image/png,image/webp,image/gif",
    label: "Images",
    formats: "JPEG, PNG, WebP, GIF",
  },
  video: {
    icon: Video,
    accept: "video/mp4,video/webm,video/quicktime",
    label: "Videos",
    formats: "MP4, WebM, MOV",
  },
  audio: {
    icon: Music,
    accept: "audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/m4a",
    label: "Audio",
    formats: "MP3, WAV, OGG, AAC, M4A",
  },
};

export function UploadSavedContentDialog({ open, onOpenChange }: UploadSavedContentDialogProps) {
  const [activeTab, setActiveTab] = useState<UploadTab>("file");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [urlContentType, setUrlContentType] = useState<SavedContentType>("image");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadBlob, isUploading, uploads } = useMediaUpload();
  const { user } = useAuth();
  const { createSavedContent, isCreating } = useSavedContent();
  const uploadProgress = uploads[0];

  const resetForm = () => {
    setName("");
    setDescription("");
    setTags([]);
    setTagInput("");
    setSelectedFile(null);
    setPreviewUrl(null);
    setTextContent("");
    setUrlInput("");
    setActiveTab("file");
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const detectContentType = (file: File): SavedContentType => {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    return "text";
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setName(file.name.replace(/\.[^/.]+$/, "")); // Remove extension for name

    // Create preview URL for images and videos
    if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("Please enter a name");
      return;
    }

    let contentType: SavedContentType;
    let content: SavedContentData;

    if (activeTab === "file" && selectedFile) {
      contentType = detectContentType(selectedFile);
      if (!user) { toast.error("Not authenticated"); return; }
      const uploadedUrl = await uploadBlob(selectedFile, selectedFile.name, user.id);

      if (!uploadedUrl) return;

      if (contentType === "image") {
        content = { url: uploadedUrl };
      } else if (contentType === "video") {
        content = { url: uploadedUrl };
      } else if (contentType === "audio") {
        content = { url: uploadedUrl };
      } else {
        toast.error("Unsupported file type");
        return;
      }
    } else if (activeTab === "text") {
      if (!textContent.trim()) {
        toast.error("Please enter some text content");
        return;
      }
      contentType = "text";
      content = { text: textContent, format: "plain" };
    } else if (activeTab === "url") {
      if (!urlInput.trim()) {
        toast.error("Please enter a URL");
        return;
      }
      contentType = urlContentType;
      if (contentType === "image") {
        content = { url: urlInput };
      } else if (contentType === "video") {
        content = { url: urlInput };
      } else if (contentType === "audio") {
        content = { url: urlInput };
      } else {
        content = { text: urlInput, format: "plain" };
      }
    } else {
      toast.error("Please select a file, enter text, or provide a URL");
      return;
    }

    try {
      await createSavedContent({
        name: name.trim(),
        description: description.trim() || undefined,
        content_type: contentType,
        content,
        tags,
      });
      handleClose();
    } catch (error) {
      // Error is handled in the hook
    }
  };

  const isSubmitting = isUploading || isCreating;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Content</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as UploadTab)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="file" className="gap-2">
              <Upload className="h-4 w-4" />
              File
            </TabsTrigger>
            <TabsTrigger value="text" className="gap-2">
              <FileText className="h-4 w-4" />
              Text
            </TabsTrigger>
            <TabsTrigger value="url" className="gap-2">
              <Link className="h-4 w-4" />
              URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4 mt-4">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
                isDragging ? "border-primary bg-primary/5" : "border-border",
                selectedFile && "border-green-500 bg-green-500/5"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="space-y-4">
                  <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    Uploading... {uploadProgress?.progress || 0}%
                  </p>
                </div>
              ) : selectedFile ? (
                <div className="space-y-3">
                  {previewUrl && selectedFile.type.startsWith("image/") && (
                    <img src={previewUrl} alt="Preview" className="h-24 mx-auto rounded object-contain" />
                  )}
                  {previewUrl && selectedFile.type.startsWith("video/") && (
                    <video src={previewUrl} className="h-24 mx-auto rounded" controls />
                  )}
                  {selectedFile.type.startsWith("audio/") && (
                    <Music className="h-10 w-10 mx-auto text-primary" />
                  )}
                  <p className="text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      setPreviewUrl(null);
                      setName("");
                    }}
                  >
                    Change file
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground mb-2">
                    Drag and drop a file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Images, videos, or audio files (max 50MB)
                  </p>
                </>
              )}
              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                className="hidden"
              />
            </div>
          </TabsContent>

          <TabsContent value="text" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="text-content">Text Content</Label>
              <Textarea
                id="text-content"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="Enter or paste your text content here..."
                className="min-h-[150px]"
              />
            </div>
          </TabsContent>

          <TabsContent value="url" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Content Type</Label>
              <div className="flex gap-2">
                {(["image", "video", "audio"] as const).map((type) => {
                  const config = contentTypeConfig[type];
                  const Icon = config.icon;
                  return (
                    <Button
                      key={type}
                      type="button"
                      variant={urlContentType === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => setUrlContentType(type)}
                      className="gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {config.label}
                    </Button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="url-input">URL</Label>
              <Input
                id="url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/media.jpg"
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Common fields */}
        <div className="space-y-4 pt-4 border-t">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter a name for this content"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="min-h-[80px]"
            />
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Add a tag..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={handleAddTag}>
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Save to Library"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
