import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Video, X, Upload, Loader2, Link } from "lucide-react";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface VideoUploadProps {
  videoUrl?: string;
  videoThumbnail?: string;
  onUpdateVideo: (videoUrl: string | undefined, thumbnail?: string) => void;
  className?: string;
}

export function VideoUpload({ videoUrl, videoThumbnail, onUpdateVideo, className }: VideoUploadProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { uploadMedia, isUploading, progress } = useMediaUpload();

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('video/')) {
      toast.error('Please upload a video file');
      return;
    }

    const url = await uploadMedia(file);
    if (url) {
      onUpdateVideo(url);
      setIsDialogOpen(false);
      toast.success('Video uploaded successfully');
    }
  };

  const handleUrlSubmit = () => {
    if (!urlInput.trim()) return;
    onUpdateVideo(urlInput.trim());
    setIsDialogOpen(false);
    setUrlInput("");
    toast.success('Video added successfully');
  };

  const handleRemoveVideo = () => {
    onUpdateVideo(undefined);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0].type.startsWith('video/')) {
      handleFileUpload(files[0]);
    } else {
      toast.error('Please drop a video file');
    }
  };

  return (
    <>
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Video</Label>
          {!videoUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsDialogOpen(true)}
              className="h-8 gap-2"
            >
              <Video className="h-3 w-3" />
              Add Video
            </Button>
          )}
        </div>

        {videoUrl ? (
          <div className="relative rounded-lg border bg-muted overflow-hidden">
            <video
              src={videoUrl}
              poster={videoThumbnail}
              controls
              className="w-full max-h-[200px] object-contain"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 h-8 w-8"
              onClick={handleRemoveVideo}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="border-2 border-dashed rounded-lg p-6 text-center text-muted-foreground">
            <Video className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No video added yet</p>
            <p className="text-xs mt-1">Click "Add Video" to upload</p>
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Video</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="url">
                <Link className="h-4 w-4 mr-2" />
                URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer",
                  isDragging ? "border-primary bg-primary/5" : "border-border"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                {isUploading ? (
                  <div className="space-y-4">
                    <Loader2 className="h-12 w-12 mx-auto animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Uploading... {progress?.percentage || 0}%
                    </p>
                  </div>
                ) : (
                  <>
                    <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-2">
                      Drag and drop a video here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Supports MP4, WebM, MOV (max 50MB)
                    </p>
                  </>
                )}
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                  className="hidden"
                />
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-4">
              <div className="space-y-3">
                <Label htmlFor="video-url">Video URL</Label>
                <Input
                  id="video-url"
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com/video.mp4"
                />
                <Button
                  variant="cta"
                  onClick={handleUrlSubmit}
                  disabled={!urlInput.trim()}
                  className="w-full"
                >
                  Add Video
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
