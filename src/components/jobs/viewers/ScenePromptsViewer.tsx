import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle, XCircle, RefreshCw, Edit2, Check, X, Copy, EyeOff, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { CarouselSlideFields } from "./CarouselSlideFields";
import type { SlideFields } from "@/lib/carousel-slide-edit";

interface ScenePrompt {
  scene?: number;
  scene_number?: number;  // Support enhanced scenes (storyboard_video_longform)
  slide_number?: number;  // Support carousel slides
  prompt?: string;        // Optional - carousel_content stage doesn't have prompts
  headline?: string;      // Carousel slide headline
  body?: string | null;   // Carousel slide body
  type?: string;          // Carousel slide type (cover, content, cta)
  status?: 'pending' | 'generating' | 'completed' | 'approved' | 'rejected' | 'excluded' | 'failed';
  approved_at?: string;
  approved_by?: string;
}

// Helper to get item number (supports scene, scene_number, and slide_number)
const getItemNumber = (item: ScenePrompt): number => item.scene ?? item.scene_number ?? item.slide_number ?? 0;

interface ScenePromptsViewerProps {
  scenePrompts: ScenePrompt[];
  onExclude: (sceneNumber: number) => void;
  onEdit: (sceneNumber: number, newPrompt: string) => void;
  onEditSlideContent?: (slideNumber: number, content: SlideFields) => void;
  onRegenerate: (sceneNumber: number) => void;
  onRegenerateAll: () => void;
  isRegeneratingScene?: number | null;
}

export function ScenePromptsViewer({
  scenePrompts,
  onExclude,
  onEdit,
  onEditSlideContent,
  onRegenerate,
  onRegenerateAll,
  isRegeneratingScene = null,
}: ScenePromptsViewerProps) {
  const [editingScene, setEditingScene] = useState<number | null>(null);
  const [editedPrompts, setEditedPrompts] = useState<Record<number, string>>({});
  const [editingSlideContent, setEditingSlideContent] = useState<number | null>(null);

  const excludedCount = scenePrompts.filter(s => s.status === 'excluded' || s.status === 'rejected').length;
  const activeCount = scenePrompts.length - excludedCount;
  const totalCount = scenePrompts.length;

  // Determine if this is a content stage (no prompts) or a prompts stage
  const hasPrompts = scenePrompts.some(s => s.prompt);
  const isSlideContent = scenePrompts.some(s => s.slide_number !== undefined);

  const handleStartEdit = (sceneNumber: number, currentPrompt: string) => {
    setEditingScene(sceneNumber);
    setEditedPrompts(prev => ({ ...prev, [sceneNumber]: currentPrompt }));
  };

  const handleSaveEdit = (sceneNumber: number) => {
    const newPrompt = editedPrompts[sceneNumber];
    if (newPrompt && newPrompt.trim() !== '') {
      onEdit(sceneNumber, newPrompt);
      setEditingScene(null);
    }
  };

  const handleCancelEdit = (sceneNumber: number) => {
    setEditingScene(null);
    setEditedPrompts(prev => {
      const updated = { ...prev };
      delete updated[sceneNumber];
      return updated;
    });
  };

  const handleCopyPrompt = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Prompt copied to clipboard");
  };

  const handleSaveSlideContentEdit = (slideNumber: number, fields: SlideFields) => {
    onEditSlideContent?.(slideNumber, fields);
    setEditingSlideContent(null);
  };

  // Empty state when no prompts
  if (scenePrompts.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No prompts yet"
        message="Scene prompts will appear here after generation"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/20 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">
            {isSlideContent
              ? (hasPrompts ? 'Slide Prompts' : 'Slide Content')
              : 'Scene Prompts'
            }
          </span>
          <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-sm">
            {activeCount} / {totalCount} Active
          </Badge>
          {excludedCount > 0 && (
            <Badge variant="outline" className="gap-1.5 px-3 py-1 text-sm text-muted-foreground">
              <EyeOff className="h-3 w-3" />
              {excludedCount} Excluded
            </Badge>
          )}
        </div>

        {/* Bulk Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerateAll}
            disabled={isRegeneratingScene !== null}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Regenerate All
          </Button>
        </div>
      </div>

      {/* Scene/Slide Prompts Grid */}
      <div className="grid gap-4">
        {scenePrompts.map((item) => {
          const itemNumber = getItemNumber(item);
          const isSlide = item.slide_number !== undefined;
          const isEditing = editingScene === itemNumber;
          const isEditingContent = editingSlideContent === itemNumber;
          const editedValue = editedPrompts[itemNumber] || item.prompt;
          const isExcluded = item.status === 'excluded' || item.status === 'rejected';
          const isRegenerating = isRegeneratingScene === itemNumber;

          return (
            <Card
              key={itemNumber}
              className={cn(
                "border-l-4 transition-all duration-300 relative group/card",
                isExcluded && "border-l-muted-foreground/30 bg-muted/30 opacity-60",
                !isExcluded && "border-l-primary/50 hover:border-l-primary"
              )}
            >

              <CardContent className="p-3">
                <div className="space-y-2">
                  {/* Header - simplified */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {isSlide ? `Slide ${itemNumber}` : `Scene ${itemNumber}`}
                        {isSlide && item.type && (
                          <span className="ml-1.5 text-xs text-primary/70 capitalize">({item.type})</span>
                        )}
                      </span>
                      {isExcluded && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          <EyeOff className="h-3 w-3 mr-1" />
                          Excluded
                        </Badge>
                      )}
                    </div>

                    {/* Actions - show on hover only */}
                    <div className={cn(
                      "flex gap-1 transition-opacity",
                      (isEditing || isEditingContent) ? "opacity-100" : "opacity-0 group-hover/card:opacity-100"
                    )}>
                      {!isEditing && !isEditingContent ? (
                        <>
                          {/* Edit slide content (headline/body) for carousel_content */}
                          {isSlide && item.headline && !item.prompt && onEditSlideContent && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingSlideContent(itemNumber)}
                              className="h-7 w-7"
                              title="Edit slide content"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {/* Copy and Edit only shown if there's a prompt */}
                          {item.prompt && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleCopyPrompt(item.prompt!)}
                                className="h-7 w-7"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleStartEdit(itemNumber, item.prompt!)}
                                className="h-7 w-7"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {!isExcluded && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => onExclude(itemNumber)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              title="Exclude from processing"
                            >
                              <EyeOff className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      ) : isEditingContent ? null : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleCancelEdit(itemNumber)}
                            className="h-7 w-7"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSaveEdit(itemNumber)}
                            className="h-7 w-7 text-green-500 hover:text-green-600"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Slide headline/body for carousels — editable when isEditingContent */}
                  {isSlide && item.headline && (
                    isEditingContent ? (
                      <CarouselSlideFields
                        slide={item}
                        onSave={(fields) => handleSaveSlideContentEdit(itemNumber, fields)}
                        onCancel={() => setEditingSlideContent(null)}
                      />
                    ) : (
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">{item.headline}</p>
                        {item.body && (
                          <p className="text-xs text-muted-foreground">{item.body}</p>
                        )}
                      </div>
                    )
                  )}

                  {/* Prompt Content - only show if prompt exists */}
                  {item.prompt && (
                    <>
                      {isSlide && item.headline && (
                        <div className="border-t border-border/50 mt-2 pt-2">
                          <span className="text-[10px] font-medium text-primary/70 uppercase tracking-wide">Image Prompt</span>
                        </div>
                      )}
                      {isEditing ? (
                        <Textarea
                          value={editedValue}
                          onChange={(e) =>
                            setEditedPrompts(prev => ({ ...prev, [itemNumber]: e.target.value }))
                          }
                          className="min-h-[80px] font-mono text-sm"
                          placeholder={isSlide ? "Enter slide image prompt..." : "Enter scene prompt..."}
                          autoFocus
                        />
                      ) : (
                        <p className="text-sm leading-relaxed text-foreground/90">{item.prompt}</p>
                      )}
                    </>
                  )}

                  {/* For slides without prompts (carousel_content stage), show "text only" indicator */}
                  {isSlide && !item.prompt && item.headline && (
                    <div className="text-xs text-muted-foreground italic pt-1">
                      Text content only — image prompts will be generated in the next stage
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info about excluded items */}
      {excludedCount > 0 && (
        <div className="p-3 bg-muted/50 border border-muted-foreground/20 rounded-lg flex items-start gap-3">
          <EyeOff className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            {excludedCount} {isSlideContent ? 'slide' : 'scene'}{excludedCount !== 1 ? 's' : ''} excluded and will be skipped during processing.
          </p>
        </div>
      )}
    </div>
  );
}
