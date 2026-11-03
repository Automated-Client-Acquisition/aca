import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, Save } from "lucide-react";
import { useGenerateVideoCaption } from "@/hooks/useGenerateVideoCaption";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface GenerateVideoCaptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  outputData: any;
}

export function GenerateVideoCaptionDialog({
  open,
  onOpenChange,
  outputId,
  outputData,
}: GenerateVideoCaptionDialogProps) {
  const queryClient = useQueryClient();
  const [caption, setCaption] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const generateCaption = useGenerateVideoCaption();

  // Load existing caption when dialog opens
  useEffect(() => {
    if (open && outputData?.stage_data?.final?.caption) {
      setCaption(outputData.stage_data.final.caption);
    } else if (open) {
      setCaption("");
    }
  }, [open, outputData]);

  const handleGenerate = async () => {
    const stageData = outputData?.stage_data || {};
    const params = outputData?.generation_params || {};
    
    await generateCaption.mutateAsync({
      outputId,
      ideaContext: outputData?.content_ideas?.title,
      scenePrompts: stageData?.scene_prompts?.scenes,
      libraryContext: {
        brandVoice: params?.brand_voice,
        product: params?.product,
      }
    });

    // Refresh to get generated caption
    const { data } = await supabase
      .from('content_outputs')
      .select('stage_data')
      .eq('id', outputId)
      .single();

    if (data) {
      const newCaption = (data.stage_data as any)?.final?.caption;
      if (newCaption) {
        setCaption(newCaption);
      }
    }
  };

  const handleSave = async () => {
    try {
      const stageData = outputData?.stage_data || {};
      const updatedStageData = {
        ...stageData,
        final: {
          ...stageData?.final,
          caption,
          caption_updated_at: new Date().toISOString()
        }
      };

      const { error } = await supabase
        .from('content_outputs')
        .update({ stage_data: updatedStageData })
        .eq('id', outputId);

      if (error) throw error;

      toast.success('Caption saved');
      queryClient.invalidateQueries({ queryKey: ['content-outputs'] });
      onOpenChange(false);
    } catch (error) {
      console.error('Save caption error:', error);
      toast.error('Failed to save caption');
    }
  };

  const scenePrompts = outputData?.stage_data?.scene_prompts?.scenes || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Video Caption</DialogTitle>
          <DialogDescription>
            Generate an AI caption or write your own for social media publishing
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Video context */}
          {scenePrompts.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">Video Scenes</Label>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 max-h-40 overflow-y-auto">
                {scenePrompts.slice(0, 3).map((scene: any, idx: number) => (
                  <div key={idx} className="text-sm">
                    <span className="font-medium">Scene {idx + 1}:</span>{" "}
                    <span className="text-muted-foreground">{scene.prompt || scene.description}</span>
                  </div>
                ))}
                {scenePrompts.length > 3 && (
                  <div className="text-xs text-muted-foreground italic">
                    + {scenePrompts.length - 3} more scenes
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Caption editor */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="caption">Caption</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerate}
                disabled={generateCaption.isPending}
              >
                {generateCaption.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Wand2 className="h-4 w-4 mr-2" />
                )}
                Generate with AI
              </Button>
            </div>
            <Textarea
              id="caption"
              value={caption}
              onChange={(e) => {
                setCaption(e.target.value);
                setIsEditing(true);
              }}
              placeholder="Your video caption with hashtags..."
              className="min-h-32 resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {caption.length} characters • TikTok: 150-200, Instagram: up to 2200, YouTube: up to 5000
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={!caption.trim()}>
            <Save className="h-4 w-4 mr-2" />
            Save Caption
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
