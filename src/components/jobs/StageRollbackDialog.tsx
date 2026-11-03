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
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { History, AlertTriangle } from "lucide-react";
import { useRollbackStage } from "@/hooks/useRollbackStage";

interface StageVersion {
  id: string;
  version_number: number;
  created_at: string;
  approved_by?: string;
  cost?: number;
  generation_time_ms?: number;
  model_used?: string;
}

interface StageRollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outputId: string;
  stageId: string;
  selectedVersion: StageVersion;
}

export function StageRollbackDialog({
  open,
  onOpenChange,
  outputId,
  stageId,
  selectedVersion,
}: StageRollbackDialogProps) {
  const [resetDownstream, setResetDownstream] = useState(true);
  const rollbackStage = useRollbackStage();

  const handleRollback = () => {
    rollbackStage.mutate(
      {
        outputId,
        stageId,
        versionId: selectedVersion.id,
        resetDownstream,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Rollback Stage
          </DialogTitle>
          <DialogDescription>
            Revert this stage to version {selectedVersion.version_number}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-lg bg-muted p-4 space-y-2">
            <div className="text-sm">
              <span className="text-muted-foreground">Version:</span> #{selectedVersion.version_number}
            </div>
            <div className="text-sm">
              <span className="text-muted-foreground">Created:</span>{" "}
              {new Date(selectedVersion.created_at).toLocaleString()}
            </div>
            {selectedVersion.model_used && (
              <div className="text-sm">
                <span className="text-muted-foreground">Model:</span> {selectedVersion.model_used}
              </div>
            )}
            {selectedVersion.cost && (
              <div className="text-sm">
                <span className="text-muted-foreground">Cost:</span> ${selectedVersion.cost.toFixed(4)}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="reset-downstream">Reset Downstream Stages</Label>
              <div className="text-sm text-muted-foreground">
                Clear all stages that come after this one
              </div>
            </div>
            <Switch
              id="reset-downstream"
              checked={resetDownstream}
              onCheckedChange={setResetDownstream}
            />
          </div>

          {resetDownstream && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                All approved downstream stages will be reset and require re-approval.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={rollbackStage.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRollback}
            disabled={rollbackStage.isPending}
          >
            {rollbackStage.isPending ? "Rolling back..." : "Rollback"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
