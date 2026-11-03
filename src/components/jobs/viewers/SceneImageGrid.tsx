import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, Upload, GripVertical, Pencil, Download, Copy, Loader2, Sparkles, EyeOff, X, Images, ZoomIn, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RegenerateImageDialog } from "../dialogs/RegenerateImageDialog";
import { EmptyState } from "./EmptyState";

interface SceneImage {
  scene_number: number;
  prompt: string;
  image_url?: string;
  status: 'pending' | 'approved' | 'rejected' | 'generating' | 'failed' | 'excluded' | 'completed';
  is_uploaded?: boolean;
  approved_at?: string;
  approved_by?: string;
  error?: string;
}

interface SceneImageGridProps {
  scenes: SceneImage[];
  onSceneRegenerate: (sceneNumber: number, prompt?: string, instructions?: string) => void;
  onSceneUpload: (sceneNumber: number, file: File) => void;
  onSceneExclude: (sceneNumber: number) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  isRegeneratingScene?: number | null;
  aspectRatio?: 'landscape' | 'portrait' | 'square'; // From video_config
}

// Map aspect ratio to Tailwind class for container
const ASPECT_RATIO_CLASS: Record<string, string> = {
  landscape: 'aspect-video', // 16:9
  portrait: 'aspect-[9/16]', // 9:16
  square: 'aspect-square', // 1:1
};

export function SceneImageGrid({
  scenes,
  onSceneRegenerate,
  onSceneUpload,
  onSceneExclude,
  onReorder,
  isRegeneratingScene = null,
  aspectRatio = 'landscape',
}: SceneImageGridProps) {
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [regenerateDialogScene, setRegenerateDialogScene] = useState<number | null>(null);
  const [expandedImage, setExpandedImage] = useState<{ url: string; sceneNumber: number; prompt: string } | null>(null);
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<number, boolean>>({});
  const [imageRetryCount, setImageRetryCount] = useState<Record<number, number>>({});

  const excludedCount = scenes.filter(s => s.status === 'excluded' || s.status === 'rejected').length;
  const failedCount = scenes.filter(s => s.status === 'failed').length;
  const activeCount = scenes.length - excludedCount;
  const totalCount = scenes.length;

  const handlePromptEdit = (sceneNumber: number, prompt: string) => {
    setEditedPrompts(prev => ({ ...prev, [sceneNumber]: prompt }));
  };

  const handleSaveEdit = (sceneNumber: number) => {
    const editedPrompt = editedPrompts[sceneNumber];
    if (editedPrompt && editedPrompt !== scenes.find(s => s.scene_number === sceneNumber)?.prompt) {
      onSceneRegenerate(sceneNumber, editedPrompt);
    }
    setEditingScene(null);
    setEditedPrompts(prev => {
      const newPrompts = { ...prev };
      delete newPrompts[sceneNumber];
      return newPrompts;
    });
  };

  const handleRegenerateWithInstructions = (instructions: string) => {
    if (regenerateDialogScene === null) return;
    const scene = scenes.find(s => s.scene_number === regenerateDialogScene);
    if (scene) {
      onSceneRegenerate(regenerateDialogScene, scene.prompt, instructions || undefined);
    }
    setRegenerateDialogScene(null);
  };

  const handleFileUpload = (sceneNumber: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onSceneUpload(sceneNumber, file);
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index && onReorder) {
      onReorder(draggedIndex, index);
      setDraggedIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleDownloadImage = async (url: string, sceneNumber: number) => {
    try {
      const filename = `scene-${sceneNumber}.jpg`;
      // Use download proxy to add proper Content-Disposition header
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Image download started");
    } catch (error) {
      toast.error("Failed to download image");
    }
  };

  const handleCopyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied to clipboard");
  };

  // Empty state when no scenes
  if (scenes.length === 0) {
    return (
      <EmptyState
        icon={Images}
        title="No storyboard yet"
        message="Scene images will appear here after generation"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            Storyboard: {activeCount} / {totalCount} Active
          </div>
          {excludedCount > 0 && (
            <Badge variant="outline" className="gap-1 text-muted-foreground">
              <EyeOff className="h-3 w-3" />
              {excludedCount} Excluded
            </Badge>
          )}
          {failedCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <X className="h-3 w-3" />
              {failedCount} Failed
            </Badge>
          )}
        </div>
      </div>

      {/* Scene Grid - more columns for portrait to reduce scrolling */}
      <div className={cn(
        "grid gap-4",
        aspectRatio === 'portrait'
          ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
          : "grid-cols-1 md:grid-cols-2"
      )}>
        {scenes.map((scene, index) => {
          const isEditing = editingScene === scene.scene_number;
          const currentPrompt = editedPrompts[scene.scene_number] ?? scene.prompt;
          const isRegenerating = isRegeneratingScene === scene.scene_number;
          const isExcluded = scene.status === 'excluded' || scene.status === 'rejected';

          const isGeneratingState = scene.status === 'generating' || isRegenerating;

          return (
            <Card
              key={`scene-${scene.scene_number}-${index}`}
              draggable={!!onReorder && !isGeneratingState}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "relative overflow-hidden transition-all",
                isExcluded && "ring-2 ring-muted-foreground/30 opacity-60",
                scene.status === 'failed' && "ring-2 ring-destructive/50 bg-destructive/5",
                !isExcluded && scene.status !== 'failed' && "hover:ring-1 hover:ring-primary/30",
                isGeneratingState && "ring-2 ring-primary/50 shadow-lg shadow-primary/10",
                draggedIndex === index && "opacity-50"
              )}
            >
              {/* Drag Handle */}
              {onReorder && (
                <div className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing">
                  <GripVertical className="h-5 w-5 text-muted-foreground" />
                </div>
              )}

              {/* Status Badge */}
              <div className="absolute top-2 right-2 z-10">
                <Badge
                  variant={
                    isExcluded
                      ? 'secondary'
                      : scene.status === 'failed'
                      ? 'destructive'
                      : isGeneratingState
                      ? 'default'
                      : 'secondary'
                  }
                  className={cn(
                    "gap-1 shadow-sm",
                    isGeneratingState && "bg-primary animate-pulse",
                    !isExcluded && scene.status !== 'failed' && !isGeneratingState && "bg-background/95 backdrop-blur-sm border border-border text-foreground font-medium"
                  )}
                >
                  {isExcluded && <EyeOff className="h-3 w-3" />}
                  {scene.status === 'failed' && <X className="h-3 w-3" />}
                  {isGeneratingState && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isExcluded
                    ? 'Excluded'
                    : scene.status === 'failed'
                    ? 'Failed'
                    : isGeneratingState
                    ? 'Generating...'
                    : `Scene ${scene.scene_number}`}
                </Badge>
              </div>

              <div className={cn(
                "p-3 space-y-2",
                aspectRatio === 'portrait' && "p-2 space-y-1.5" // Tighter padding for portrait grid
              )}>
                {/* Image Display */}
                <div className={cn(
                  ASPECT_RATIO_CLASS[aspectRatio] || "aspect-video",
                  "bg-black/5 dark:bg-white/5 rounded-md overflow-hidden relative flex items-center justify-center group",
                  isGeneratingState && "ring-1 ring-primary/30",
                  scene.image_url && !isGeneratingState && "cursor-pointer"
                )}>
                  {scene.image_url ? (
                    imageLoadErrors[scene.scene_number] ? (
                      // Image load error state
                      <div className="flex flex-col items-center justify-center gap-3 p-4 w-full h-full">
                        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                          <ImageOff className="h-5 w-5 text-destructive" />
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-xs font-medium text-destructive">Image unavailable</p>
                          <p className="text-[10px] text-muted-foreground">Storage permission issue</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {(imageRetryCount[scene.scene_number] || 0) < 2 && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                setImageRetryCount(prev => ({
                                  ...prev,
                                  [scene.scene_number]: (prev[scene.scene_number] || 0) + 1
                                }));
                                setImageLoadErrors(prev => ({
                                  ...prev,
                                  [scene.scene_number]: false
                                }));
                              }}
                            >
                              <RefreshCw className="h-3 w-3 mr-1" />
                              Retry
                            </Button>
                          )}
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRegenerateDialogScene(scene.scene_number);
                            }}
                            disabled={isRegeneratingScene !== null}
                          >
                            <Sparkles className="h-3 w-3 mr-1" />
                            Regenerate
                          </Button>
                        </div>
                      </div>
                    ) : (
                    <>
                      <img
                        src={
                          (imageRetryCount[scene.scene_number] || 0) > 0
                            ? `${scene.image_url}${scene.image_url.includes('?') ? '&' : '?'}retry=${imageRetryCount[scene.scene_number]}`
                            : scene.image_url
                        }
                        alt={`Scene ${scene.scene_number}`}
                        className={cn(
                          "max-w-full max-h-full object-contain transition-all duration-300",
                          isGeneratingState && "opacity-40 scale-[1.02] blur-[1px]"
                        )}
                        onClick={() => !isGeneratingState && setExpandedImage({
                          url: scene.image_url!,
                          sceneNumber: scene.scene_number,
                          prompt: scene.prompt
                        })}
                        onError={() => setImageLoadErrors(prev => ({
                          ...prev,
                          [scene.scene_number]: true
                        }))}
                      />
                      {/* Expand hint on hover */}
                      {!isGeneratingState && (
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                          <div className="bg-background/90 backdrop-blur-sm rounded-full p-2">
                            <ZoomIn className="h-5 w-5 text-foreground" />
                          </div>
                        </div>
                      )}
                      {/* Enhanced Regenerating overlay */}
                      {isGeneratingState && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          {/* Animated gradient background */}
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/20 animate-pulse" />

                          {/* Scanning line effect */}
                          <div className="absolute inset-0 overflow-hidden">
                            <div className="absolute w-full h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-[scan_2s_linear_infinite]"
                                 style={{ animation: 'scan 2s linear infinite' }} />
                          </div>

                          {/* Center content */}
                          <div className="relative z-10 flex flex-col items-center gap-3 p-4 rounded-xl bg-background/80 backdrop-blur-md border border-primary/20 shadow-xl">
                            <Sparkles className="h-8 w-8 text-primary animate-pulse" />
                            <div className="text-center">
                              <p className="text-sm font-semibold text-foreground">AI Generating</p>
                              <p className="text-xs text-muted-foreground">Creating your image...</p>
                            </div>
                            {/* Progress dots */}
                            <div className="flex gap-1">
                              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        </div>
                      )}
                      {scene.is_uploaded && !isGeneratingState && (
                        <Badge className="absolute bottom-2 left-2 gap-1" variant="secondary">
                          <Upload className="h-3 w-3" />
                          Uploaded
                        </Badge>
                      )}
                    </>
                    )
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-3">
                      {isGeneratingState ? (
                        <div className="flex flex-col items-center gap-3 p-6">
                          {/* Animated gradient background for empty state */}
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/10 animate-pulse" />

                          <div className="relative z-10 flex flex-col items-center gap-3 p-4 rounded-xl bg-background/60 backdrop-blur-sm border border-primary/20">
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
                      ) : (
                        <span className="text-muted-foreground">No image yet</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Prompt Display/Edit - Compact for portrait */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className={cn(
                      "font-medium text-muted-foreground",
                      aspectRatio === 'portrait' ? "text-[10px]" : "text-xs"
                    )}>
                      Scene Prompt
                    </label>
                    <div className="flex gap-0.5">
                      {!isEditing && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopyPrompt(scene.prompt)}
                            disabled={isRegeneratingScene !== null}
                            className={cn("gap-1", aspectRatio === 'portrait' ? "h-6 w-6 p-0" : "h-7")}
                          >
                            <Copy className={aspectRatio === 'portrait' ? "h-2.5 w-2.5" : "h-3 w-3"} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingScene(scene.scene_number)}
                            disabled={isRegeneratingScene !== null}
                            className={cn(aspectRatio === 'portrait' ? "h-6 w-6 p-0" : "h-7")}
                          >
                            <Pencil className={aspectRatio === 'portrait' ? "h-2.5 w-2.5" : "h-3 w-3"} />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing ? (
                    <div className="space-y-2">
                      <Textarea
                        value={currentPrompt}
                        onChange={(e) => handlePromptEdit(scene.scene_number, e.target.value)}
                        className="min-h-[80px] text-sm"
                        disabled={isRegeneratingScene !== null}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleSaveEdit(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                        >
                          Save & Regenerate
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingScene(null);
                            setEditedPrompts(prev => {
                              const newPrompts = { ...prev };
                              delete newPrompts[scene.scene_number];
                              return newPrompts;
                            });
                          }}
                          disabled={isRegeneratingScene !== null}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className={cn(
                      "text-foreground/80",
                      aspectRatio === 'portrait' ? "text-[11px] line-clamp-2" : "text-sm line-clamp-3"
                    )}>{scene.prompt}</p>
                  )}
                </div>

                {/* Action Buttons - Icon-only row for portrait, full for landscape */}
                <div className={cn(
                  "flex items-center justify-center",
                  aspectRatio === 'portrait' ? "gap-1 pt-1" : "flex-wrap gap-2 pt-2"
                )}>
                  {/* Excluded scenes - show regenerate option */}
                  {isExcluded ? (
                    aspectRatio === 'portrait' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0"
                        onClick={() => setRegenerateDialogScene(scene.scene_number)}
                        disabled={isRegeneratingScene !== null}
                        title="Regenerate"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 gap-1"
                          onClick={() => setRegenerateDialogScene(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Regenerate
                        </Button>
                        <div className="text-xs text-muted-foreground flex items-center">
                          This scene will be skipped
                        </div>
                      </>
                    )
                  ) : scene.status === 'failed' ? (
                    /* Failed scenes - show retry and exclude options */
                    aspectRatio === 'portrait' ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 w-7 p-0"
                          onClick={() => setRegenerateDialogScene(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                          title="Retry"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 w-7 p-0"
                          onClick={() => onSceneExclude(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                          title="Exclude"
                        >
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          className="flex-1 gap-1"
                          onClick={() => setRegenerateDialogScene(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                        >
                          <RefreshCw className="h-3 w-3" />
                          Retry
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          onClick={() => onSceneExclude(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                        >
                          <EyeOff className="h-3 w-3" />
                          Exclude
                        </Button>
                        {scene.error && (
                          <div className="w-full text-xs text-destructive mt-1">
                            Error: {scene.error}
                          </div>
                        )}
                      </>
                    )
                  ) : (
                    /* Normal scenes - icon row for portrait, full buttons for landscape */
                    aspectRatio === 'portrait' ? (
                      <>
                        {scene.image_url && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleDownloadImage(scene.image_url!, scene.scene_number)}
                            disabled={isRegeneratingScene !== null}
                            title="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={isGeneratingState ? "default" : "ghost"}
                          className={cn(
                            "h-7 w-7 p-0",
                            isGeneratingState && "bg-primary/20 text-primary"
                          )}
                          onClick={() => setRegenerateDialogScene(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                          title="Regenerate"
                        >
                          {isGeneratingState ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => document.getElementById(`upload-${scene.scene_number}`)?.click()}
                          disabled={isRegeneratingScene !== null}
                          title="Replace"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </Button>
                        <input
                          id={`upload-${scene.scene_number}`}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileUpload(scene.scene_number, e)}
                          disabled={isRegeneratingScene !== null}
                        />
                        {!isGeneratingState && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => onSceneExclude(scene.scene_number)}
                            disabled={isRegeneratingScene !== null}
                            title="Exclude"
                          >
                            <EyeOff className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    ) : (
                      <>
                        {scene.image_url && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => handleDownloadImage(scene.image_url!, scene.scene_number)}
                            disabled={isRegeneratingScene !== null}
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant={isGeneratingState ? "default" : "outline"}
                          className={cn(
                            "gap-1",
                            isGeneratingState && "bg-primary/20 text-primary border-primary/30"
                          )}
                          onClick={() => setRegenerateDialogScene(scene.scene_number)}
                          disabled={isRegeneratingScene !== null}
                        >
                          {isGeneratingState ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {isGeneratingState ? "Generating..." : "Regenerate"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => document.getElementById(`upload-${scene.scene_number}`)?.click()}
                          disabled={isRegeneratingScene !== null}
                        >
                          <Upload className="h-3 w-3" />
                          Replace
                        </Button>
                        <input
                          id={`upload-${scene.scene_number}`}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleFileUpload(scene.scene_number, e)}
                          disabled={isRegeneratingScene !== null}
                        />
                        {/* Exclude button */}
                        {!isGeneratingState && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-muted-foreground hover:text-destructive"
                            onClick={() => onSceneExclude(scene.scene_number)}
                            disabled={isRegeneratingScene !== null}
                            title="Exclude this scene from the final video"
                          >
                            <EyeOff className="h-3 w-3" />
                          </Button>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Regenerate Dialog */}
      <RegenerateImageDialog
        open={regenerateDialogScene !== null}
        onOpenChange={(open) => !open && setRegenerateDialogScene(null)}
        onRegenerate={handleRegenerateWithInstructions}
        isGenerating={isRegeneratingScene !== null}
        currentPrompt={regenerateDialogScene !== null
          ? scenes.find(s => s.scene_number === regenerateDialogScene)?.prompt || ""
          : ""
        }
      />

      {/* Expanded Image Lightbox */}
      <Dialog open={expandedImage !== null} onOpenChange={(open) => !open && setExpandedImage(null)}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 overflow-hidden bg-black/95 border-none">
          <DialogTitle className="sr-only">
            Scene {expandedImage?.sceneNumber} - Expanded View
          </DialogTitle>
          {expandedImage && (
            <div className="relative w-full h-full flex flex-col">
              {/* Header with scene info and actions */}
              <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-gradient-to-b from-black/80 to-transparent">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="bg-white/20 text-white border-none">
                    Scene {expandedImage.sceneNumber}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-white hover:bg-white/20"
                    onClick={() => handleDownloadImage(expandedImage.url, expandedImage.sceneNumber)}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-white hover:bg-white/20"
                    onClick={() => handleCopyPrompt(expandedImage.prompt)}
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Prompt
                  </Button>
                </div>
              </div>

              {/* Image container */}
              <div className="flex-1 flex items-center justify-center p-4 pt-16 pb-24">
                <img
                  src={expandedImage.url}
                  alt={`Scene ${expandedImage.sceneNumber}`}
                  className="max-w-full max-h-[70vh] object-contain"
                />
              </div>

              {/* Footer with prompt */}
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-sm text-white/80 line-clamp-2">{expandedImage.prompt}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
