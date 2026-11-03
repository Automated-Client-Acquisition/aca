import { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Download, RotateCcw, Maximize2, Upload, Link2, Video as VideoIcon, Loader2, X, Scissors } from "lucide-react";
import { ErrorState } from "./ErrorState";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { Progress } from "@/components/ui/progress";
import { VideoTrimmer } from "./VideoTrimmer";

interface VideoContentSectionProps {
  videoUrl?: string;
  onRegenerate?: () => void;
  onUpdateVideo?: (url: string | null) => void;
  isRegenerating?: boolean;
}

export function VideoContentSection({
  videoUrl,
  onRegenerate,
  onUpdateVideo,
  isRegenerating = false,
}: VideoContentSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [manualVideoUrl, setManualVideoUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showTrimmer, setShowTrimmer] = useState(false);
  const [currentVideoUrl, setCurrentVideoUrl] = useState(videoUrl);
  const { uploadMedia, isUploading, progress } = useMediaUpload();

  // Update current video URL when prop changes
  useEffect(() => {
    setCurrentVideoUrl(videoUrl);
  }, [videoUrl]);

  const handleTrimSave = (newVideoUrl: string) => {
    setCurrentVideoUrl(newVideoUrl);
    setShowTrimmer(false);
    if (onUpdateVideo) {
      onUpdateVideo(newVideoUrl);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleDownload = async () => {
    try {
      const urlToDownload = currentVideoUrl || videoUrl;
      if (!urlToDownload) return;
      const filename = 'video.mp4';
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(urlToDownload)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Video download started");
    } catch (error) {
      toast.error("Failed to download video");
    }
  };

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;

    if (!document.fullscreenElement) {
      video.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    const url = await uploadMedia(file);
    if (url && onUpdateVideo) {
      onUpdateVideo(url);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('video/')) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleAddManualVideo = () => {
    if (manualVideoUrl.trim() && onUpdateVideo) {
      onUpdateVideo(manualVideoUrl.trim());
      setManualVideoUrl("");
    }
  };

  const handleRemoveVideo = () => {
    if (onUpdateVideo) {
      onUpdateVideo(null);
    }
  };

  if (hasError) {
    return (
      <ErrorState
        title="Video Load Error"
        message="Failed to load video. The file may be corrupted or the URL is invalid."
        onRetry={() => {
          setHasError(false);
          if (videoRef.current) {
            videoRef.current.load();
          }
        }}
      />
    );
  }

  // No video yet - show upload section
  if (!videoUrl) {
    return (
      <div className="border border-dashed border-border rounded-lg p-6">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <VideoIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h4 className="font-medium mb-1">Add Video</h4>
            <p className="text-sm text-muted-foreground">
              Upload a video file or paste a URL
            </p>
          </div>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="url">
                <Link2 className="h-4 w-4 mr-2" />
                URL
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-3 mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileInputChange}
                className="hidden"
              />
              
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted/50'
                }`}
              >
                {isUploading ? (
                  <div className="space-y-3">
                    <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">Uploading video...</p>
                      {progress && (
                        <>
                          <Progress value={progress.percentage} className="h-2" />
                          <p className="text-xs text-muted-foreground">
                            {Math.round(progress.percentage)}%
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <VideoIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium mb-1">
                      Drop your video here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Supports: MP4, WebM, MOV
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Maximum file size: 50MB
                    </p>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-3 mt-4">
              <div className="space-y-2">
                <Label>Video URL</Label>
                <Input
                  placeholder="https://example.com/video.mp4"
                  value={manualVideoUrl}
                  onChange={(e) => setManualVideoUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddManualVideo();
                    }
                  }}
                  disabled={isUploading}
                />
                <p className="text-xs text-muted-foreground">
                  Paste a direct link to a video hosted online
                </p>
              </div>
              <Button
                onClick={handleAddManualVideo}
                disabled={!manualVideoUrl.trim() || isUploading}
                className="w-full"
              >
                <Link2 className="h-4 w-4 mr-1" />
                Add Video
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  const displayVideoUrl = currentVideoUrl || videoUrl;

  return (
    <div className="space-y-4">
      {/* Video Player */}
      <div className="relative rounded-lg overflow-hidden border border-border bg-black max-w-2xl mx-auto">
        <video
          ref={videoRef}
          src={displayVideoUrl}
          controls
          className="w-full h-auto"
          onError={() => setHasError(true)}
        >
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-2xl mx-auto">
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download
        </Button>
        <Button variant="outline" size="sm" onClick={handleFullscreen}>
          <Maximize2 className="h-3.5 w-3.5 mr-1.5" />
          Fullscreen
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowTrimmer(!showTrimmer)}
        >
          <Scissors className="h-3.5 w-3.5 mr-1.5" />
          {showTrimmer ? 'Hide Editor' : 'Trim/Cut'}
        </Button>
        {onUpdateVideo && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemoveVideo}
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Remove
          </Button>
        )}
        {onRegenerate && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            {isRegenerating ? "Regenerating..." : "Regenerate"}
          </Button>
        )}
      </div>

      {/* Video Trimmer */}
      {showTrimmer && displayVideoUrl && (
        <div className="max-w-2xl mx-auto">
          <VideoTrimmer
            videoUrl={displayVideoUrl}
            onSave={handleTrimSave}
            onCancel={() => setShowTrimmer(false)}
          />
        </div>
      )}
    </div>
  );
}
