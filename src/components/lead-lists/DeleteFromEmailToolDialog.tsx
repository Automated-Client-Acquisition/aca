import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useDeleteFromEmailTool, type LeadHandoff, type ToolType } from "@/hooks/useLeadHandoffs";

interface ConnectionGroup {
  connection: { id: string; name: string };
  toolType: ToolType;
  handoffs: LeadHandoff[];
}

interface DeleteFromEmailToolDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedByConnection: ConnectionGroup[];
  onComplete?: () => void;
}

type DeleteState = 'confirm' | 'deleting' | 'complete' | 'error';

interface DeleteProgress {
  current: number;
  total: number;
  deleted: number;
  failed: number;
  currentTool?: string;
}

const toolNames: Record<ToolType, string> = {
  smartlead: 'SmartLead',
  instantly: 'Instantly',
  successai: 'Success.ai',
};

export function DeleteFromEmailToolDialog({
  open,
  onOpenChange,
  selectedByConnection,
  onComplete,
}: DeleteFromEmailToolDialogProps) {
  const [state, setState] = useState<DeleteState>('confirm');
  const [progress, setProgress] = useState<DeleteProgress>({
    current: 0,
    total: 0,
    deleted: 0,
    failed: 0,
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deleteMutation = useDeleteFromEmailTool();

  const totalContacts = selectedByConnection.reduce((sum, g) => sum + g.handoffs.length, 0);

  const handleDelete = async () => {
    setState('deleting');
    setErrorMessage(null);
    setProgress({
      current: 0,
      total: selectedByConnection.length,
      deleted: 0,
      failed: 0,
    });

    let totalDeleted = 0;
    let totalFailed = 0;

    try {
      for (let i = 0; i < selectedByConnection.length; i++) {
        const group = selectedByConnection[i];

        setProgress(prev => ({
          ...prev,
          current: i,
          currentTool: toolNames[group.toolType],
        }));

        const result = await deleteMutation.mutateAsync({
          toolType: group.toolType,
          connectionId: group.connection.id,
          handoffIds: group.handoffs.map(h => h.id),
        });

        totalDeleted += result.deleted;
        totalFailed += result.failed;

        setProgress(prev => ({
          ...prev,
          deleted: totalDeleted,
          failed: totalFailed,
        }));
      }

      setProgress(prev => ({
        ...prev,
        current: selectedByConnection.length,
      }));

      setState('complete');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error occurred');
      setState('error');
    }
  };

  const handleClose = () => {
    if (state === 'deleting') return;

    setState('confirm');
    setProgress({ current: 0, total: 0, deleted: 0, failed: 0 });
    setErrorMessage(null);
    onOpenChange(false);

    if (state === 'complete' && progress.deleted > 0) {
      onComplete?.();
    }
  };

  const progressPercentage = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  // Confirm view
  if (state === 'confirm') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              Delete from Email Tools
            </DialogTitle>
            <DialogDescription>
              This will remove contacts from your email tool accounts.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium">This action cannot be undone</p>
                  <p className="text-amber-600 mt-1">
                    Contacts will be permanently removed from the external email tools.
                    Any pending or scheduled emails to these contacts will be cancelled.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Selected contacts:</div>
              {selectedByConnection.map((group, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2"
                >
                  <div>
                    <span className="font-medium">{group.connection.name}</span>
                    <span className="text-muted-foreground ml-2">
                      ({toolNames[group.toolType]})
                    </span>
                  </div>
                  <div className="text-sm font-medium">
                    {group.handoffs.length} contact{group.handoffs.length !== 1 ? 's' : ''}
                  </div>
                </div>
              ))}
            </div>

            <div className="text-center py-2">
              <div className="text-2xl font-bold text-red-600">{totalContacts}</div>
              <div className="text-sm text-muted-foreground">
                total contacts will be deleted
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete {totalContacts} Contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Deleting view
  if (state === 'deleting') {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent
          className="sm:max-w-[500px]"
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
                <Loader2 className="h-4 w-4 text-red-600 animate-spin" />
              </div>
              Deleting Contacts...
            </DialogTitle>
            <DialogDescription>
              {progress.currentTool
                ? `Removing contacts from ${progress.currentTool}...`
                : 'Processing deletion requests...'}
            </DialogDescription>
          </DialogHeader>

          <div className="py-6 space-y-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Progress: {progress.current} of {progress.total} connections
                </span>
                <span className="font-medium">{Math.round(progressPercentage)}%</span>
              </div>
              <Progress value={progressPercentage} className="h-2" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-emerald-600">{progress.deleted}</div>
                <div className="text-xs text-emerald-600/80">Deleted</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-600/80">Failed</div>
              </div>
            </div>

            <p className="text-xs text-center text-muted-foreground">
              This may take a moment. Don't close this dialog.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Complete view
  if (state === 'complete') {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500/20 to-green-500/20 flex items-center justify-center">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              Deletion Complete
            </DialogTitle>
            <DialogDescription>
              Contacts have been removed from your email tools.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-600">{progress.deleted}</div>
                <div className="text-xs text-emerald-600/80">Successfully Deleted</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-600/80">Failed</div>
              </div>
            </div>

            {progress.deleted > 0 && (
              <p className="text-sm text-muted-foreground">
                You've freed up {progress.deleted} contact slot{progress.deleted !== 1 ? 's' : ''} in your email tool subscription{selectedByConnection.length > 1 ? 's' : ''}.
              </p>
            )}

            {progress.failed > 0 && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
                <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {progress.failed} contact{progress.failed !== 1 ? 's' : ''} could not be deleted.
                  They may have been already removed or there was an API error.
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="cta" onClick={handleClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Error view
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/20 flex items-center justify-center">
              <XCircle className="h-4 w-4 text-red-600" />
            </div>
            Deletion Failed
          </DialogTitle>
          <DialogDescription>
            There was an error deleting contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {progress.deleted > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-emerald-600">{progress.deleted}</div>
                <div className="text-xs text-emerald-600/80">Deleted before error</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <div className="text-xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-xs text-red-600/80">Failed</div>
              </div>
            </div>
          )}

          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-lg">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{errorMessage || 'An unknown error occurred. Please try again.'}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Close</Button>
          <Button variant="cta" onClick={() => setState('confirm')}>Try Again</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
