import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Image as ImageIcon, Sparkles, Edit2, Check, X, Link2, Upload, Loader2, Download, CheckCircle2, Maximize2, RefreshCw, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { useMediaUpload } from "@/hooks/useMediaUpload";
import { Progress } from "@/components/ui/progress";
import { RegenerateImageDialog } from "../dialogs/RegenerateImageDialog";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

type AspectRatio = 'landscape' | 'portrait' | 'square';

type ImageStatus = 'pending' | 'generating' | 'ready' | 'approved';

interface ImageContentSectionProps {
  imageUrl?: string;
  imagePrompt?: string;
  onGenerateImage?: (prompt: string) => void;
  onRegenerateImage?: (prompt: string, instructions?: string) => void;
  onUpdateImage?: (url: string | null) => void;
  isGenerating?: boolean;
  isRequired?: boolean;
  aspectRatio?: AspectRatio;
  status?: ImageStatus;
}

export function ImageContentSection({
  imageUrl,
  imagePrompt = "",
  onGenerateImage,
  onRegenerateImage,
  onUpdateImage,
  isGenerating = false,
  isRequired = false,
  aspectRatio = 'landscape',
  status,
}: ImageContentSectionProps) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState(imagePrompt);
  const [showPromptInput, setShowPromptInput] = useState(false);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showExpandedImage, setShowExpandedImage] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [imageRetryCount, setImageRetryCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadMedia, isUploading, progress } = useMediaUpload();

  // Reset error state when imageUrl changes
  useEffect(() => {
    setImageLoadError(false);
    setImageRetryCount(0);
  }, [imageUrl]);

  // Sync editedPrompt with imagePrompt prop when it changes (e.g., after regeneration or initial load)
  // Only update if not currently editing to avoid overwriting user's work
  useEffect(() => {
    if (!isEditingPrompt && !showRegenerateDialog) {
      setEditedPrompt(imagePrompt);
    }
  }, [imagePrompt, isEditingPrompt, showRegenerateDialog]);

  const handleGenerate = () => {
    if (!editedPrompt.trim()) {
      return;
    }
    if (editedPrompt.length < 10) {
      return;
    }
    onGenerateImage?.(editedPrompt);
    setShowPromptInput(false);
    setIsEditingPrompt(false);
  };

  const handleRegenerate = (instructions: string, updatedPrompt?: string) => {
    const promptToUse = updatedPrompt || editedPrompt;
    if (!promptToUse.trim()) {
      return;
    }
    if (promptToUse.length < 10) {
      return;
    }
    // Update local state if prompt was changed in dialog
    if (updatedPrompt) {
      setEditedPrompt(updatedPrompt);
    }
    onRegenerateImage?.(promptToUse, instructions || undefined);
    setIsEditingPrompt(false);
    setShowRegenerateDialog(false);
  };

  const handleSavePrompt = () => {
    setIsEditingPrompt(false);
  };

  const handleCancelPrompt = () => {
    setEditedPrompt(imagePrompt);
    setIsEditingPrompt(false);
  };

  const handleAddManualImage = () => {
    if (manualImageUrl.trim() && onUpdateImage) {
      onUpdateImage(manualImageUrl.trim());
      setManualImageUrl("");
    }
  };

  const handleRemoveImage = () => {
    if (onUpdateImage) {
      onUpdateImage(null);
    }
  };

  const handleFileSelect = async (file: File) => {
    const url = await uploadMedia(file);
    if (url && onUpdateImage) {
      onUpdateImage(url);
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
    if (file) {
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

  // Detect if URL is a video
  const isVideoUrl = (url?: string): boolean => {
    if (!url) return false;
    const videoExtensions = ['.mp4', '.webm', '.mov', '.avi', '.m4v', '.ogv'];
    const lowerUrl = url.toLowerCase();
    return videoExtensions.some(ext => lowerUrl.includes(ext));
  };

  const isVideo = isVideoUrl(imageUrl);

  const handleDownload = async () => {
    if (!imageUrl) return;
    try {
      const filename = isVideo ? 'content-video.mp4' : 'generated-image.jpg';
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(imageUrl)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success(isVideo ? "Video download started" : "Image download started");
    } catch (error) {
      toast.error(isVideo ? "Failed to download video" : "Failed to download image");
    }
  };

  // No image yet - show generating state or add image section
  if (!imageUrl) {
    // Show loading UI when auto-generating
    if (isGenerating) {
      return (
        <div className="border border-dashed border-primary/40 rounded-lg p-6 relative overflow-hidden min-h-[300px] flex items-center justify-center bg-muted/20">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/10 animate-pulse" />

          {/* Scanning line effect */}
          <div className="absolute inset-0 overflow-hidden">
            <div
              className="absolute w-full h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-scan"
            />
          </div>

          {/* Center content */}
          <div className="relative z-10 flex flex-col items-center gap-4 p-6 rounded-2xl bg-background/80 backdrop-blur-md border border-primary/20 shadow-2xl">
            <Sparkles className="h-10 w-10 text-primary animate-pulse" />
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">AI Generating</p>
              <p className="text-xs text-muted-foreground">Creating your image...</p>
            </div>
            {/* Progress dots */}
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      );
    }

    // When there's a pre-loaded AI prompt, show a streamlined AI-first UI
    if (imagePrompt && imagePrompt.length >= 10 && !showPromptInput) {
      return (
        <div className="border border-dashed border-border rounded-lg p-6">
          <div className="flex flex-col space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h4 className="font-medium">
                  {isRequired ? "Generate Image" : "Add Featured Image (Optional)"}
                </h4>
                <p className="text-sm text-muted-foreground">
                  AI prompt ready
                </p>
              </div>
            </div>

            {/* Prompt preview - always visible, full text */}
            <div className="bg-muted/50 rounded-md p-3 text-left">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{imagePrompt}</p>
            </div>

            {/* Primary action */}
            <Button
              onClick={() => onGenerateImage?.(imagePrompt)}
              className="w-full"
              size="lg"
              disabled={isGenerating}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {isGenerating ? "Generating..." : "Generate Image"}
            </Button>

            {/* Secondary options in a subtle row */}
            <div className="flex items-center justify-center gap-4 text-sm">
              <button
                onClick={() => {
                  setEditedPrompt(imagePrompt);
                  setShowPromptInput(true);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit prompt
              </button>
              <span className="text-muted-foreground/50">|</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </button>
              <span className="text-muted-foreground/50">|</span>
              <button
                onClick={() => setManualImageUrl("show")}
                className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <Link2 className="h-3.5 w-3.5" />
                URL
              </button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileInputChange}
              className="hidden"
            />

            {/* URL input (shown when clicking URL option) */}
            {manualImageUrl === "show" && (
              <div className="w-full space-y-2 pt-2 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="https://example.com/image.jpg"
                    value=""
                    onChange={(e) => setManualImageUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddManualImage();
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setManualImageUrl("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            {manualImageUrl && manualImageUrl !== "show" && (
              <div className="w-full space-y-2 pt-2 border-t">
                <div className="flex gap-2">
                  <Input
                    placeholder="https://example.com/image.jpg"
                    value={manualImageUrl}
                    onChange={(e) => setManualImageUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddManualImage();
                      }
                    }}
                  />
                  <Button variant="cta" onClick={handleAddManualImage} disabled={!manualImageUrl.trim()}>
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setManualImageUrl("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Upload progress */}
            {isUploading && (
              <div className="w-full space-y-2 pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm">Uploading...</span>
                </div>
                {progress && <Progress value={progress.percentage} className="h-2" />}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Edit prompt mode (when user clicks "Edit prompt")
    if (showPromptInput) {
      return (
        <div className="border border-dashed border-border rounded-lg p-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Edit Image Prompt</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowPromptInput(false);
                  setEditedPrompt(imagePrompt);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <Textarea
              value={editedPrompt}
              onChange={(e) => setEditedPrompt(e.target.value)}
              placeholder="Describe the image you want to generate..."
              className="min-h-[120px] focus-visible:ring-2"
              autoFocus
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {editedPrompt.length < 10 && editedPrompt.length > 0
                  ? `At least ${10 - editedPrompt.length} more characters needed`
                  : `${editedPrompt.length} characters`}
              </p>
              <Button
                onClick={handleGenerate}
                disabled={!editedPrompt.trim() || editedPrompt.length < 10 || isGenerating}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {isGenerating ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Default: No pre-loaded prompt - show full tabbed interface
    return (
      <div className="border border-dashed border-border rounded-lg p-6">
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <ImageIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <h4 className="font-medium mb-1">
              {isRequired ? "Image Required" : "Add Featured Image (Optional)"}
            </h4>
            <p className="text-sm text-muted-foreground">
              Generate with AI or add manually
            </p>
          </div>

          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload">
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="ai">
                <Sparkles className="h-4 w-4 mr-2" />
                AI Generate
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
                accept="image/*,video/*"
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
                      <p className="text-sm font-medium">Uploading...</p>
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
                    <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                    <p className="text-sm font-medium mb-1">
                      Drop your file here or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Supports: Images (JPG, PNG, WebP, GIF) and Videos (MP4, WebM, MOV)
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Maximum file size: 50MB
                    </p>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="ai" className="space-y-3 mt-4">
              <div className="w-full space-y-3">
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  placeholder="Describe the image you want to generate..."
                  className="min-h-[100px] focus-visible:ring-2"
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {editedPrompt.length < 10 && editedPrompt.length > 0
                      ? `At least ${10 - editedPrompt.length} more characters needed`
                      : `${editedPrompt.length} characters`}
                  </p>
                  <Button
                    onClick={handleGenerate}
                    disabled={!editedPrompt.trim() || editedPrompt.length < 10 || isGenerating}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    {isGenerating ? "Generating..." : "Generate"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="url" className="space-y-3 mt-4">
              <div className="space-y-2">
                <Label>Image URL</Label>
                <Input
                  placeholder="https://example.com/image.jpg"
                  value={manualImageUrl}
                  onChange={(e) => setManualImageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddManualImage();
                    }
                  }}
                  disabled={isGenerating}
                />
                <p className="text-xs text-muted-foreground">
                  Paste a direct link to an image hosted online
                </p>
              </div>
              <Button
                onClick={handleAddManualImage}
                disabled={!manualImageUrl.trim() || isGenerating}
                className="w-full"
              >
                <Link2 className="h-4 w-4 mr-1" />
                Add Image
              </Button>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    );
  }

  // Media exists - show image or video with actions
  return (
    <div className="border border-dashed border-border rounded-lg p-6">
      <div className="flex flex-col space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
              status === 'approved' ? "bg-green-500/10" : status === 'ready' ? "bg-emerald-500/10" : "bg-green-500/10"
            )}>
              {status === 'approved' ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : (
                <Check className="h-5 w-5 text-green-600" />
              )}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <h4 className="font-medium">Featured Image</h4>
                {status === 'ready' && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs px-2 py-0.5">
                    Ready for Review
                  </Badge>
                )}
                {status === 'approved' && (
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-xs px-2 py-0.5">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Approved
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {isVideo ? "Video added" : "Image added"}
              </p>
            </div>
          </div>
          {/* Action buttons */}
          {!isGenerating && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDownload}
              >
                <Download className="h-4 w-4" />
              </Button>
              {onUpdateImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemoveImage}
                  className="text-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Media container - constrained height with click to expand */}
        <div
          className={cn(
            "group rounded-lg overflow-hidden border bg-muted relative mx-auto cursor-pointer flex items-center justify-center",
            aspectRatio === 'portrait' ? 'max-w-sm' : aspectRatio === 'square' ? 'max-w-md' : 'max-w-full',
            isGenerating && "ring-2 ring-primary/50"
          )}
          onClick={() => !isGenerating && !isVideo && setShowExpandedImage(true)}
        >
          {isVideo ? (
            <video
              src={imageUrl}
              controls
              className={cn(
                "max-w-full max-h-[400px] object-contain transition-all duration-300",
                isGenerating && "opacity-40 blur-[2px]"
              )}
              onClick={(e) => e.stopPropagation()}
            />
          ) : imageLoadError ? (
            // Image load error state - show helpful message with regenerate option
            <div className="flex flex-col items-center justify-center gap-4 p-8 min-h-[200px] w-full">
              <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
                <ImageOff className="h-7 w-7 text-destructive" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-destructive">Image unavailable</p>
                <p className="text-xs text-muted-foreground max-w-[280px]">
                  This image couldn't be loaded. It may have expired or there's a storage permission issue.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {imageRetryCount < 2 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageRetryCount(prev => prev + 1);
                      setImageLoadError(false);
                    }}
                    disabled={isGenerating}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Retry
                  </Button>
                )}
                {imagePrompt && onRegenerateImage && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowRegenerateDialog(true);
                    }}
                    disabled={isGenerating}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Regenerate
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <img
              src={imageRetryCount > 0 ? `${imageUrl}${imageUrl?.includes('?') ? '&' : '?'}retry=${imageRetryCount}` : imageUrl}
              alt="Generated content"
              className={cn(
                "max-w-full max-h-[400px] object-contain transition-all duration-300",
                isGenerating && "opacity-40 blur-[2px]"
              )}
              onError={() => setImageLoadError(true)}
            />
          )}

          {/* Hover overlay for regenerate and expand - hide when there's an error (error state has its own buttons) */}
          {!isGenerating && !imageLoadError && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              {!isVideo && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowExpandedImage(true);
                  }}
                  className="shadow-lg"
                >
                  <Maximize2 className="h-4 w-4 mr-1" />
                  Expand
                </Button>
              )}
              {imagePrompt && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowRegenerateDialog(true);
                  }}
                  disabled={!editedPrompt.trim() || editedPrompt.length < 10}
                  className="shadow-lg"
                >
                  <Sparkles className="h-4 w-4 mr-1" />
                  Regenerate
                </Button>
              )}
            </div>
          )}

          {/* Enhanced Regenerating Overlay */}
          {isGenerating && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {/* Animated gradient background */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/20 animate-pulse" />

              {/* Scanning line effect */}
              <div className="absolute inset-0 overflow-hidden">
                <div
                  className="absolute w-full h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-scan"
                />
              </div>

              {/* Center content */}
              <div className="relative z-10 flex flex-col items-center gap-4 p-6 rounded-2xl bg-background/80 backdrop-blur-md border border-primary/20 shadow-2xl">
                <Sparkles className="h-10 w-10 text-primary animate-pulse" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-foreground">AI Generating</p>
                  <p className="text-xs text-muted-foreground">Creating your image...</p>
                </div>
                {/* Progress dots */}
                <div className="flex gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Prompt section - shown if prompt exists */}
        {imagePrompt && (
          <div className="space-y-2">
            {isEditingPrompt ? (
              <>
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="min-h-[80px] text-sm"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={handleCancelPrompt}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSavePrompt}>
                    <Check className="h-4 w-4 mr-1" />
                    Save
                  </Button>
                </div>
              </>
            ) : (
              <div
                className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => setIsEditingPrompt(true)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Edit2 className="h-3 w-3" />
                  <span className="text-xs font-medium">Prompt (click to edit)</span>
                </div>
                <p className="whitespace-pre-wrap">{imagePrompt}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <RegenerateImageDialog
        open={showRegenerateDialog}
        onOpenChange={setShowRegenerateDialog}
        onRegenerate={handleRegenerate}
        isGenerating={isGenerating}
        currentPrompt={editedPrompt}
      />

      {/* Expanded Image Dialog */}
      <Dialog open={showExpandedImage} onOpenChange={setShowExpandedImage}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden">
          <DialogTitle className="sr-only">Expanded Image View</DialogTitle>
          <div className="w-full h-full flex items-center justify-center bg-black/95">
            <img
              src={imageUrl}
              alt="Expanded view"
              className="max-w-full max-h-[85vh] object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
