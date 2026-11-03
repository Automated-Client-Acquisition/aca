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
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useStageApproval } from "@/hooks/useStageApproval";
import { toast } from "sonner";

interface BulkStageApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedOutputs: Array<{
    outputId: string;
    stageId: string;
    stageName: string;
  }>;
  action: 'approve' | 'reject';
}

export function BulkStageApprovalDialog({
  open,
  onOpenChange,
  selectedOutputs,
  action,
}: BulkStageApprovalDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const stageApproval = useStageApproval();

  const handleBulkAction = async () => {
    setIsProcessing(true);
    let successCount = 0;
    let failCount = 0;

    for (const output of selectedOutputs) {
      try {
        await stageApproval.mutateAsync({
          outputId: output.outputId,
          stageId: output.stageId,
          action,
        });
        successCount++;
      } catch (error) {
        console.error(`Failed to ${action} stage for output ${output.outputId}:`, error);
        failCount++;
      }
    }

    setIsProcessing(false);
    
    if (successCount > 0) {
      toast.success(`${action === 'approve' ? 'Approved' : 'Rejected'} ${successCount} stage(s)`);
    }
    if (failCount > 0) {
      toast.error(`Failed to process ${failCount} stage(s)`);
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {action === 'approve' ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            Bulk {action === 'approve' ? 'Approve' : 'Reject'} Stages
          </DialogTitle>
          <DialogDescription>
            This will {action} {selectedOutputs.length} stage(s) across multiple outputs.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {action === 'approve' 
              ? 'Approved stages will automatically trigger the next stage in the pipeline.'
              : 'Rejected stages will prevent the pipeline from continuing until regenerated or approved.'}
          </AlertDescription>
        </Alert>

        <div className="py-4">
          <p className="text-sm text-muted-foreground mb-2">
            Stages to {action}:
          </p>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {selectedOutputs.map((output, index) => (
              <div
                key={`${output.outputId}-${output.stageId}`}
                className="text-sm p-2 rounded bg-muted/50"
              >
                {index + 1}. {output.stageName}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            variant={action === 'approve' ? 'cta' : 'destructive'}
            onClick={handleBulkAction}
            disabled={isProcessing}
          >
            {isProcessing ? (
              `Processing ${action}...`
            ) : (
              `${action === 'approve' ? 'Approve' : 'Reject'} All`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
