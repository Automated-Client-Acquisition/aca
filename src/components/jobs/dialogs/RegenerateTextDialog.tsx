import { useState, useEffect } from "react";
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
import { RefreshCw, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RegenerateTextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegenerate: (instructions: string) => void;
  isRegenerating?: boolean;
  currentContent?: string;
  contentLabel?: string;
}

export function RegenerateTextDialog({
  open,
  onOpenChange,
  onRegenerate,
  isRegenerating = false,
  currentContent = "",
  contentLabel = "Content",
}: RegenerateTextDialogProps) {
  const [instructions, setInstructions] = useState("");

  // Reset instructions when dialog opens
  useEffect(() => {
    if (open) {
      setInstructions("");
    }
  }, [open]);

  const handleRegenerate = () => {
    onRegenerate(instructions);
    setInstructions("");
  };

  const handleClose = () => {
    setInstructions("");
    onOpenChange(false);
  };

  // Truncate content for preview
  const truncatedContent = currentContent.length > 500
    ? currentContent.substring(0, 500) + "..."
    : currentContent;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Regenerate {contentLabel}
          </DialogTitle>
          <DialogDescription>
            Provide instructions on what changes you'd like to see. Leave empty to regenerate with the same parameters.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isRegenerating ? (
            <Alert className="border-primary/20 bg-primary/5">
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription className="ml-2">
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Regenerating {contentLabel}...</span>
                  <span className="text-xs text-muted-foreground">
                    The AI is processing your instructions. This may take a few seconds.
                  </span>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {currentContent && (
                <div className="space-y-2">
                  <Label>Current {contentLabel}</Label>
                  <div className="text-sm bg-muted/50 rounded-md p-3 max-h-[150px] overflow-y-auto whitespace-pre-wrap">
                    {truncatedContent}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="instructions">Regeneration Instructions (Optional)</Label>
                <Textarea
                  id="instructions"
                  placeholder="e.g., Make it more concise, add more details about the benefits, change the tone to be more professional..."
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="min-h-[100px]"
                  disabled={isRegenerating}
                />
                <p className="text-xs text-muted-foreground">
                  These instructions will guide the AI when regenerating the content.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isRegenerating}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleRegenerate} disabled={isRegenerating}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isRegenerating ? 'animate-spin' : ''}`} />
            {isRegenerating ? "Regenerating..." : "Regenerate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
