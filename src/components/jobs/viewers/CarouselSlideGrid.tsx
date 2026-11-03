import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  RefreshCw,
  Upload,
  GripVertical,
  Pencil,
  Download,
  Copy,
  Loader2,
  Sparkles,
  FileText,
  Image as ImageIcon,
  Megaphone,
  AlertCircle,
  Layers,
  Type,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { RegenerateImageDialog } from "../dialogs/RegenerateImageDialog";
import { EmptyState } from "./EmptyState";
import type { CarouselSlide } from "@/types/carousel";
import type { SlideFields } from "@/lib/carousel-slide-edit";
import { CarouselSlideFields } from "./CarouselSlideFields";

export type SlideContentEdits = SlideFields;

interface CarouselSlideGridProps {
  slides: CarouselSlide[];
  aspectRatio?: string;
  onSlideApprove: (slideNumber: number) => void;
  onSlideReject: (slideNumber: number) => void;
  onSlideRegenerate: (slideNumber: number, prompt?: string, instructions?: string) => void;
  onSlideUpload: (slideNumber: number, file: File) => void;
  onSlideContentEdit?: (slideNumber: number, content: SlideContentEdits) => void;
  /** The structured slides from carousel_content; the editor opens from these, not the rendered records. */
  contentSlides?: object[];
  onReorder?: (fromIndex: number, toIndex: number) => void;
  isRegeneratingSlide?: number | null;
}

const SLIDE_TYPE_ICONS = {
  cover: FileText,
  content: ImageIcon,
  cta: Megaphone,
};

export function CarouselSlideGrid({
  slides,
  aspectRatio = 'square',
  onSlideApprove,
  onSlideReject,
  onSlideRegenerate,
  onSlideUpload,
  onSlideContentEdit,
  contentSlides,
  onReorder,
  isRegeneratingSlide = null,
}: CarouselSlideGridProps) {
  const [editingSlide, setEditingSlide] = useState<number | null>(null);
  const [editingContentSlide, setEditingContentSlide] = useState<number | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [regenerateDialogSlide, setRegenerateDialogSlide] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const approvedCount = slides.filter(s => s.status === 'approved').length;
  const failedCount = slides.filter(s => s.status === 'failed').length;
  const totalCount = slides.length;
  const allApproved = approvedCount === totalCount && failedCount === 0;

  const handlePromptEdit = (slideNumber: number, prompt: string) => {
    setEditedPrompts(prev => ({ ...prev, [slideNumber]: prompt }));
  };

  const handleSaveEdit = (slideNumber: number) => {
    const editedPrompt = editedPrompts[slideNumber];
    if (editedPrompt && editedPrompt !== slides.find(s => s.slide_number === slideNumber)?.prompt) {
      onSlideRegenerate(slideNumber, editedPrompt);
    }
    setEditingSlide(null);
    setEditedPrompts(prev => {
      const newPrompts = { ...prev };
      delete newPrompts[slideNumber];
      return newPrompts;
    });
  };

  const handleStartContentEdit = (slide: CarouselSlide) => {
    setEditingContentSlide(slide.slide_number);
  };

  const contentSlideFor = (slide: CarouselSlide): object =>
    (contentSlides ?? []).find((c) => {
      const r = c as { slide_number?: number; scene?: number };
      return (r.slide_number ?? r.scene) === slide.slide_number;
    }) ?? slide;

  const handleSaveContentEdit = (slideNumber: number, fields: SlideContentEdits) => {
    onSlideContentEdit?.(slideNumber, fields);
    setEditingContentSlide(null);
  };

  const handleRegenerateWithInstructions = (instructions: string) => {
    if (regenerateDialogSlide === null) return;
    const slide = slides.find(s => s.slide_number === regenerateDialogSlide);
    if (slide) {
      onSlideRegenerate(regenerateDialogSlide, slide.prompt, instructions || undefined);
    }
    setRegenerateDialogSlide(null);
  };

  const handleFileUpload = (slideNumber: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onSlideUpload(slideNumber, file);
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

  const handleDownloadImage = async (url: string, slideNumber: number) => {
    try {
      const filename = `carousel-slide-${slideNumber}.png`;
      const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/download-proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

      const a = document.createElement("a");
      a.href = proxyUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Image download started");
    } catch {
      toast.error("Failed to download image");
    }
  };

  const handleCopyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied to clipboard");
  };

  // Aspect ratio CSS class for image containers
  const getAspectRatioClass = () => {
    switch (aspectRatio) {
      case '4:5':
      case 'portrait':
        return 'aspect-[4/5]';
      case '9:16':
      case 'story':
      case 'reel':
        return 'aspect-[9/16]';
      default:
        return 'aspect-square';
    }
  };

  // Grid columns — fewer columns for portrait/story so slides are bigger
  const getGridClass = () => {
    switch (aspectRatio) {
      case '9:16':
      case 'story':
      case 'reel':
        return 'grid-cols-2 md:grid-cols-3';
      case '4:5':
      case 'portrait':
        return 'grid-cols-2 md:grid-cols-3';
      default:
        return 'grid-cols-2 md:grid-cols-3';
    }
  };

  // Lightbox navigation
  const slidesWithImages = slides.filter(s => s.image_url);
  const lightboxSlide = lightboxIndex !== null ? slidesWithImages[lightboxIndex] : null;

  const handleLightboxPrev = () => {
    if (lightboxIndex !== null && lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
    }
  };

  const handleLightboxNext = () => {
    if (lightboxIndex !== null && lightboxIndex < slidesWithImages.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
    }
  };

  const openLightbox = (slide: CarouselSlide) => {
    const idx = slidesWithImages.findIndex(s => s.slide_number === slide.slide_number);
    if (idx !== -1) setLightboxIndex(idx);
  };

  if (slides.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No slides yet"
        message="Carousel slides will appear here after generation"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="text-sm font-medium">
            Carousel Progress: {approvedCount}/{totalCount} slides approved
          </div>
          {allApproved && (
            <Badge className="gap-1 bg-green-500 text-white hover:bg-green-500/90">
              <Check className="h-3 w-3" />
              All Approved
            </Badge>
          )}
          {failedCount > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" />
              {failedCount} failed
            </Badge>
          )}
        </div>
        {!allApproved && (
          <div className="text-sm text-muted-foreground">
            Approve all slides to finalize your carousel
          </div>
        )}
      </div>

      {/* Slide Grid */}
      <div className={cn("grid gap-4", getGridClass())}>
        {slides.map((slide, index) => {
          const isEditing = editingSlide === slide.slide_number;
          const currentPrompt = editedPrompts[slide.slide_number] ?? slide.prompt;
          const isRegenerating = isRegeneratingSlide === slide.slide_number;
          const isGeneratingState = slide.status === 'generating' || isRegenerating;
          const isFailed = slide.status === 'failed';
          const SlideIcon = SLIDE_TYPE_ICONS[slide.type];

          return (
            <Card
              key={slide.slide_number}
              draggable={!!onReorder && !isGeneratingState}
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              className={cn(
                "relative overflow-hidden transition-all",
                slide.status === 'approved' && "ring-2 ring-green-500/50",
                slide.status === 'rejected' && "ring-2 ring-destructive/50",
                isFailed && "ring-2 ring-destructive/50 bg-destructive/5",
                isGeneratingState && "ring-2 ring-primary/50 shadow-lg shadow-primary/10",
                draggedIndex === index && "opacity-50"
              )}
            >
              {/* Drag Handle */}
              {onReorder && (
                <div className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              )}

              {/* Status Badge */}
              <div className="absolute top-2 right-2 z-10 flex gap-1">
                <Badge
                  variant="secondary"
                  className="gap-1 text-xs"
                >
                  <SlideIcon className="h-3 w-3" />
                  {slide.slide_number}
                </Badge>
                {slide.status === 'approved' && (
                  <Badge className="gap-1 bg-green-500 text-white hover:bg-green-500/90">
                    <Check className="h-3 w-3" />
                  </Badge>
                )}
                {isFailed && (
                  <Badge variant="destructive" className="gap-1">
                    <X className="h-3 w-3" />
                  </Badge>
                )}
                {isGeneratingState && (
                  <Badge variant="default" className="gap-1 bg-primary animate-pulse">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </Badge>
                )}
              </div>

              <div className="p-3 space-y-2">
                {/* Image Display */}
                <div
                  className={cn(
                    "bg-muted rounded-md overflow-hidden relative flex items-center justify-center",
                    getAspectRatioClass(),
                    isGeneratingState && "ring-1 ring-primary/30",
                    slide.image_url && "cursor-pointer group/img"
                  )}
                  onClick={() => slide.image_url && !isGeneratingState && openLightbox(slide)}
                >
                  {slide.image_url ? (
                    <>
                      <img
                        src={slide.image_url}
                        alt={`Slide ${slide.slide_number}`}
                        className={cn(
                          "w-full h-full object-cover transition-all duration-300",
                          isGeneratingState && "opacity-40 scale-[1.02] blur-[1px]"
                        )}
                      />
                      {/* Hover zoom hint */}
                      {!isGeneratingState && (
                        <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="text-white text-xs font-medium opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/50 px-2 py-1 rounded">
                            Click to enlarge
                          </span>
                        </div>
                      )}
                      {/* Regenerating overlay */}
                      {isGeneratingState && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/20 animate-pulse" />
                          <div className="relative z-10 flex flex-col items-center gap-2 p-3 rounded-lg bg-background/80 backdrop-blur-md border border-primary/20 shadow-xl">
                            <Sparkles className="h-6 w-6 text-primary animate-pulse" />
                            <p className="text-xs font-medium">Generating...</p>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
                      {isGeneratingState ? (
                        <div className="flex flex-col items-center gap-2 p-4">
                          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/10 animate-pulse" />
                          <Sparkles className="h-8 w-8 text-primary animate-pulse relative z-10" />
                          <p className="text-xs font-medium relative z-10">Generating...</p>
                        </div>
                      ) : isFailed ? (
                        <div className="flex flex-col items-center gap-2 p-4">
                          <AlertCircle className="h-8 w-8 text-destructive" />
                          <p className="text-xs font-medium text-destructive">Failed</p>
                        </div>
                      ) : (
                        <ImageIcon className="h-8 w-8 opacity-50" />
                      )}
                    </div>
                  )}
                </div>

                {/* Error Message */}
                {isFailed && slide.error && (
                  <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive">
                    <AlertCircle className="h-3 w-3 inline mr-1" />
                    {slide.error}
                  </div>
                )}

                {/* Slide Content Preview / Edit */}
                {editingContentSlide === slide.slide_number && onSlideContentEdit ? (
                  <CarouselSlideFields
                    slide={contentSlideFor(slide)}
                    saving={isRegeneratingSlide !== null}
                    saveLabel="Save & Re-render"
                    onSave={(fields) => handleSaveContentEdit(slide.slide_number, fields)}
                    onCancel={() => setEditingContentSlide(null)}
                  />
                ) : (slide.headline || slide.body) ? (
                  <div
                    className={cn(
                      "space-y-1",
                      onSlideContentEdit && "cursor-pointer rounded-md p-1 -m-1 hover:bg-muted/50 transition-colors group/content"
                    )}
                    onClick={() => onSlideContentEdit && handleStartContentEdit(slide)}
                  >
                    {slide.headline && (
                      <p className="text-xs font-semibold line-clamp-1">{slide.headline}</p>
                    )}
                    {slide.body && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{slide.body}</p>
                    )}
                    {slide.render_warnings && slide.render_warnings.length > 0 && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400" title={slide.render_warnings.join("\n")}>
                        <AlertCircle className="h-3 w-3 inline mr-1" />
                        Too much text for this slide: it was shrunk or trimmed to fit. Shorten it for the best result.
                      </p>
                    )}
                    {onSlideContentEdit && (
                      <span className="text-[10px] text-muted-foreground opacity-0 group-hover/content:opacity-100 transition-opacity">
                        Click to edit text
                      </span>
                    )}
                  </div>
                ) : null}

                {/* Prompt Display/Edit */}
                {isEditing && (
                  <div className="space-y-2">
                    <Textarea
                      value={currentPrompt}
                      onChange={(e) => handlePromptEdit(slide.slide_number, e.target.value)}
                      className="min-h-[60px] text-xs"
                      disabled={isRegeneratingSlide !== null}
                    />
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => handleSaveEdit(slide.slide_number)}
                        disabled={isRegeneratingSlide !== null}
                        className="flex-1 h-7 text-xs"
                      >
                        Save & Regenerate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingSlide(null);
                          setEditedPrompts(prev => {
                            const newPrompts = { ...prev };
                            delete newPrompts[slide.slide_number];
                            return newPrompts;
                          });
                        }}
                        disabled={isRegeneratingSlide !== null}
                        className="h-7 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Failed slide - show retry button */}
                {isFailed && (
                  <div className="flex gap-1 justify-center mb-1">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 flex-1 text-xs"
                      onClick={() => setRegenerateDialogSlide(slide.slide_number)}
                      disabled={isRegeneratingSlide !== null}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  </div>
                )}

                {/* Approve/Reject Buttons */}
                {slide.image_url && slide.status !== 'approved' && !isFailed && (
                  <div className="flex gap-1 justify-center mb-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-xs border-green-500/50 text-green-600 hover:bg-green-500/10 hover:text-green-700"
                      onClick={() => onSlideApprove(slide.slide_number)}
                      disabled={isRegeneratingSlide !== null}
                    >
                      <Check className="h-3 w-3 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
                      onClick={() => onSlideReject(slide.slide_number)}
                      disabled={isRegeneratingSlide !== null}
                    >
                      <X className="h-3 w-3 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-1 flex-wrap justify-center">
                  {slide.image_url && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleDownloadImage(slide.image_url!, slide.slide_number)}
                      disabled={isRegeneratingSlide !== null}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  )}
                  {slide.prompt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleCopyPrompt(slide.prompt)}
                      disabled={isRegeneratingSlide !== null}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  )}
                  {onSlideContentEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleStartContentEdit(slide)}
                      disabled={isRegeneratingSlide !== null}
                      title="Edit slide text"
                    >
                      <Type className="h-3 w-3" />
                    </Button>
                  )}
                  {slide.prompt && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => setEditingSlide(slide.slide_number)}
                      disabled={isRegeneratingSlide !== null}
                      title="Edit prompt"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant={isGeneratingState ? "default" : "ghost"}
                    className={cn(
                      "h-7 w-7 p-0",
                      isGeneratingState && "bg-primary/20 text-primary border-primary/30"
                    )}
                    onClick={() => setRegenerateDialogSlide(slide.slide_number)}
                    disabled={isRegeneratingSlide !== null}
                  >
                    {isGeneratingState ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => document.getElementById(`carousel-upload-${slide.slide_number}`)?.click()}
                    disabled={isRegeneratingSlide !== null}
                  >
                    <Upload className="h-3 w-3" />
                  </Button>
                  <input
                    id={`carousel-upload-${slide.slide_number}`}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleFileUpload(slide.slide_number, e)}
                    disabled={isRegeneratingSlide !== null}
                  />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Lightbox */}
      {lightboxSlide && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setLightboxIndex(null)}
        >
          {/* Close hint */}
          <button
            className="absolute top-4 right-4 z-50 text-white/70 hover:text-white transition-colors"
            onClick={() => setLightboxIndex(null)}
          >
            <X className="h-8 w-8" />
          </button>

          {/* Counter */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white/70 text-sm font-medium">
            {lightboxIndex + 1} / {slidesWithImages.length}
          </div>

          {/* Prev */}
          {lightboxIndex > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
              onClick={(e) => { e.stopPropagation(); handleLightboxPrev(); }}
            >
              <ChevronLeft className="h-8 w-8" />
            </button>
          )}

          {/* Next */}
          {lightboxIndex < slidesWithImages.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
              onClick={(e) => { e.stopPropagation(); handleLightboxNext(); }}
            >
              <ChevronRight className="h-8 w-8" />
            </button>
          )}

          {/* Image */}
          <img
            src={lightboxSlide.image_url!}
            alt={`Slide ${lightboxSlide.slide_number}`}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Slide info */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-center max-w-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {lightboxSlide.headline && (
              <p className="text-sm font-semibold">{lightboxSlide.headline}</p>
            )}
          </div>
        </div>
      )}

      {/* Regenerate Dialog */}
      <RegenerateImageDialog
        open={regenerateDialogSlide !== null}
        onOpenChange={(open) => !open && setRegenerateDialogSlide(null)}
        onRegenerate={handleRegenerateWithInstructions}
        isGenerating={isRegeneratingSlide !== null}
        currentPrompt={regenerateDialogSlide !== null
          ? slides.find(s => s.slide_number === regenerateDialogSlide)?.prompt || ""
          : ""
        }
      />
    </div>
  );
}
