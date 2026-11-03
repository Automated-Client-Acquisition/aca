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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GitBranch, Info } from "lucide-react";
import { useCreateStageBranch } from "@/hooks/useCreateStageBranch";

interface StageBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  stageId: string;
  stageName: string;
}

export function StageBranchDialog({
  open,
  onOpenChange,
  outputId,
  stageId,
  stageName,
}: StageBranchDialogProps) {
  const [branchName, setBranchName] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const createBranch = useCreateStageBranch();

  const handleCreate = () => {
    createBranch.mutate(
      {
        outputId,
        stageId,
        branchName: branchName || undefined,
        customPrompt: customPrompt || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          setBranchName("");
          setCustomPrompt("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Create Stage Branch
          </DialogTitle>
          <DialogDescription>
            Create a variant output from {stageName} stage
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Branching creates a new content output that copies this stage's configuration and generates a variant. Perfect for A/B testing or exploring different creative directions.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="branch-name">Branch Name (Optional)</Label>
            <Input
              id="branch-name"
              placeholder="e.g., Energetic Version, Formal Tone"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              A descriptive name to identify this variant
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="custom-prompt">Custom Instructions (Optional)</Label>
            <Textarea
              id="custom-prompt"
              placeholder="Add specific instructions for this variant..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              rows={4}
            />
            <p className="text-sm text-muted-foreground">
              Modify the prompt to change the output direction
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createBranch.isPending}
          >
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleCreate}
            disabled={createBranch.isPending}
          >
            {createBranch.isPending ? "Creating..." : "Create Branch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
