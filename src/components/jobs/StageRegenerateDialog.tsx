import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRegenerateStage } from "@/hooks/useRegenerateStage";

interface StageRegenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  stageId: string;
  stageName: string;
  hasDownstreamStages: boolean;
}

export function StageRegenerateDialog({
  open,
  onOpenChange,
  outputId,
  stageId,
  stageName,
  hasDownstreamStages,
}: StageRegenerateDialogProps) {
  const [preserveDownstream, setPreserveDownstream] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const regenerateStage = useRegenerateStage();

  const handleRegenerate = () => {
    regenerateStage.mutate(
      {
        outputId,
        stageId,
        preserveDownstream,
        customPrompt: customPrompt.trim() || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setCustomPrompt("");
          setPreserveDownstream(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Regenerate Stage: {stageName}
          </DialogTitle>
          <DialogDescription>
            Configure regeneration options for this stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {hasDownstreamStages && (
            <>
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-0.5">
                  <Label htmlFor="preserve-downstream">
                    Preserve downstream stages
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Keep approved stages that depend on this one
                  </p>
                </div>
                <Switch
                  id="preserve-downstream"
                  checked={preserveDownstream}
                  onCheckedChange={setPreserveDownstream}
                />
              </div>

              {!preserveDownstream && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    All downstream stages will be reset and require re-approval.
                  </AlertDescription>
                </Alert>
              )}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="custom-prompt">
              Custom prompt (optional)
            </Label>
            <Textarea
              id="custom-prompt"
              placeholder="Add specific instructions for regeneration..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to use the original prompt configuration
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={regenerateStage.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRegenerate}
            disabled={regenerateStage.isPending}
          >
            {regenerateStage.isPending ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Regenerating...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate Stage
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
