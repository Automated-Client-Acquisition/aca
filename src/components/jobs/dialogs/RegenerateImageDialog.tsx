import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";

interface RegenerateImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerate: (instructions: string, updatedPrompt?: string) => void;
  isGenerating?: boolean;
  currentPrompt?: string;
}

export function RegenerateImageDialog({
  open,
  onOpenChange,
  onRegenerate,
  isGenerating = false,
  currentPrompt = "",
}: RegenerateImageDialogProps) {
  const [instructions, setInstructions] = useState("");
  const [editedPrompt, setEditedPrompt] = useState(currentPrompt);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const prevOpenRef = useRef(open);

  // Reset state when dialog opens (transition from closed to open)
  // This ensures we always start with the latest prompt when opening the dialog
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;

    // Only reset when dialog transitions from closed to open
    if (open && !wasOpen) {
      setEditedPrompt(currentPrompt);
      setIsEditingPrompt(false);
      setInstructions("");
    }
  }, [open, currentPrompt]);

  const handleRegenerate = () => {
    const promptChanged = editedPrompt !== currentPrompt;
    onRegenerate(instructions, promptChanged ? editedPrompt : undefined);
    setInstructions("");
    setIsEditingPrompt(false);
  };

  const handleClose = () => {
    setInstructions("");
    setEditedPrompt(currentPrompt);
    setIsEditingPrompt(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Regenerate Image</DialogTitle>
          <DialogDescription>
            Provide instructions to guide the regeneration. Leave empty to regenerate with the same prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {currentPrompt && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Prompt</Label>
                {!isEditingPrompt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setIsEditingPrompt(true)}
                    disabled={isGenerating}
                  >
                    Edit
                  </Button>
                )}
              </div>
              {isEditingPrompt ? (
                <Textarea
                  value={editedPrompt}
                  onChange={(e) => setEditedPrompt(e.target.value)}
                  className="min-h-[100px] text-sm"
                  disabled={isGenerating}
                  placeholder="Describe the image you want to generate..."
                />
              ) : (
                <p className="text-sm bg-muted/50 rounded-md p-3 max-h-[100px] overflow-y-auto">
                  {editedPrompt || currentPrompt}
                </p>
              )}
              {editedPrompt !== currentPrompt && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Prompt has been modified
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="instructions">Additional Instructions (Optional)</Label>
            <Textarea
              id="instructions"
              placeholder="e.g., Make the background darker, add more contrast, change the style to be more realistic..."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[80px]"
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground">
              These instructions will be combined with the prompt to guide the image generation.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleRegenerate} disabled={isGenerating}>
            <Sparkles className="h-4 w-4 mr-2" />
            {isGenerating ? "Regenerating..." : "Regenerate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
