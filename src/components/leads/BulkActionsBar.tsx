import { useState } from "react";
import {
  X,
  RefreshCw,
  Trash2,
  Download,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface BulkActionsBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onUpdateStatus: (status: string) => void;
  onDelete: () => void;
  onExport: () => void;
  isDeleting?: boolean;
  isExporting?: boolean;
  onRetryDm?: () => void;
  isRetrying?: boolean;
}

export function BulkActionsBar({
  selectedCount,
  onClearSelection,
  onUpdateStatus,
  onDelete,
  onExport,
  isDeleting,
  isExporting,
  onRetryDm,
  isRetrying,
}: BulkActionsBarProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <div className="flex items-center gap-3 bg-background border shadow-lg rounded-lg px-4 py-3">
          {/* Selection count */}
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="h-7 px-3 text-sm font-medium">
              {selectedCount} selected
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClearSelection}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="h-6 w-px bg-border" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* Update Status */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Change Status
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                <DropdownMenuItem onClick={() => onUpdateStatus("pending")}>
                  <Badge variant="secondary" className="mr-2">Pending</Badge>
                  Mark as Pending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onUpdateStatus("dm_sent")}>
                  <Badge className="bg-green-600 mr-2">DM Sent</Badge>
                  Mark as DM Sent
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onUpdateStatus("replied")}>
                  <Badge className="bg-blue-600 mr-2">Replied</Badge>
                  Mark as Replied
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onUpdateStatus("converted")}>
                  <Badge className="bg-primary mr-2">Converted</Badge>
                  Mark as Converted
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onUpdateStatus("dm_failed")}>
                  <Badge variant="destructive" className="mr-2">Failed</Badge>
                  Mark as Failed
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Retry DM */}
            {onRetryDm && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRetryDm}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Retry DM
              </Button>
            )}

            {/* Export */}
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              disabled={isExporting}
            >
              {isExporting ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export
            </Button>

            {/* Delete */}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} lead(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The selected leads will be permanently
              deleted from your campaigns.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete();
                setShowDeleteDialog(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
