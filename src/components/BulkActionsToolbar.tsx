import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, X, Check, Send, Sparkles, Tag, Lock, Folder, BrainCircuit, Wand2, Zap, ZapOff } from "lucide-react";
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
import { useState } from "react";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";

interface BulkActionsToolbarProps {
  selectedCount: number;
  onDeleteSelected: () => void;
  onDeselectAll: () => void;
  isDeleting?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onPushToGHL?: () => void;
  showGHLButton?: boolean;
  onGenerate?: () => void;
  showGenerateButton?: boolean;
  /** Defaults to "Generate". */
  generateLabel?: string;
  /** Ideas: point the selection at an autopilot. */
  onAssignToAutopilot?: () => void;
  /** Ideas: stop autopilots using the selection. */
  onRemoveFromAutopilot?: () => void;
  onManageTags?: () => void;
  showTagsButton?: boolean;
  onMoveToFolder?: () => void;
  showMoveToFolderButton?: boolean;
  onAnalyze?: () => void;
  showAnalyzeButton?: boolean;
  onReverseEngineer?: () => void;
  showReverseEngineerButton?: boolean;
  /** Page-specific actions shown before Delete. */
  extraActions?: React.ReactNode;
}

export function BulkActionsToolbar({
  selectedCount,
  onDeleteSelected,
  onDeselectAll,
  isDeleting = false,
  onApprove,
  onReject,
  onPushToGHL,
  showGHLButton = false,
  onGenerate,
  showGenerateButton = false,
  generateLabel = "Generate",
  onAssignToAutopilot,
  onRemoveFromAutopilot,
  onManageTags,
  showTagsButton = false,
  onMoveToFolder,
  showMoveToFolderButton = false,
  onAnalyze,
  showAnalyzeButton = false,
  onReverseEngineer,
  showReverseEngineerButton = false,
  extraActions,
}: BulkActionsToolbarProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canPushToGHL = hasFeature("push_to_ghl");
  const showLockedGHL = !canPushToGHL && showUpgradePrompts;

  const handleConfirmDelete = () => {
    setShowDeleteDialog(false);
    onDeleteSelected();
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <div className="fixed bottom-6 left-1/2 md:left-[calc(var(--sidebar-width,0px)+((100vw-var(--sidebar-width,0px))/2))] -translate-x-1/2 z-50 max-w-[calc(100vw-1.5rem)] md:max-w-[calc(100vw-var(--sidebar-width,0px)-3rem)] animate-in slide-in-from-bottom-4 duration-300">
        <div className="bg-card border border-border shadow-lg rounded-lg px-6 py-3 flex items-center gap-4 overflow-x-auto">
          <span className="text-sm font-medium">
            {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2">
            {onApprove && (
              <Button
                variant="cta"
                size="sm"
                onClick={onApprove}
                disabled={isDeleting}
              >
                <Check className="h-4 w-4 mr-2" />
                Approve
              </Button>
            )}
            
            {onReject && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReject}
                disabled={isDeleting}
              >
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
            )}

            {/* Publish - show if has access OR if should show locked state */}
            {showGHLButton && onPushToGHL && (canPushToGHL || showLockedGHL) && (
              <Button
                size="sm"
                onClick={canPushToGHL ? onPushToGHL : () => window.open(UPGRADE_URL, "_blank")}
                disabled={isDeleting}
                className={canPushToGHL
                  ? "bg-gradient-aca"
                  : "border-amber-500/30 hover:bg-amber-500/10"
                }
                variant={canPushToGHL ? "default" : "outline"}
              >
                {canPushToGHL ? (
                  <Send className="h-4 w-4 mr-2" />
                ) : (
                  <Lock className="h-4 w-4 mr-2 text-amber-500" />
                )}
                Publish
                {showLockedGHL && (
                  <Badge variant="outline" className="ml-2 text-xs py-0 px-1.5 border-amber-300 text-amber-700 bg-amber-50">
                    Pro
                  </Badge>
                )}
              </Button>
            )}

            {showTagsButton && onManageTags && (
              <Button
                variant="outline"
                size="sm"
                onClick={onManageTags}
                disabled={isDeleting}
              >
                <Tag className="h-4 w-4 mr-2" />
                Tags
              </Button>
            )}

            {showMoveToFolderButton && onMoveToFolder && (
              <Button
                variant="outline"
                size="sm"
                onClick={onMoveToFolder}
                disabled={isDeleting}
              >
                <Folder className="h-4 w-4 mr-2" />
                Move to Folder
              </Button>
            )}

            {showAnalyzeButton && onAnalyze && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAnalyze}
                disabled={isDeleting}
              >
                <BrainCircuit className="h-4 w-4 mr-2" />
                Enrich Ideas
              </Button>
            )}

            {extraActions}

            {showReverseEngineerButton && onReverseEngineer && (
              <Button
                variant="outline"
                size="sm"
                onClick={onReverseEngineer}
                disabled={isDeleting || selectedCount > 5}
                title={selectedCount > 5 ? "Select up to 5 posts" : "Make a blueprint that writes in these posts' format"}
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Copy format
              </Button>
            )}

            {onAssignToAutopilot && (
              <Button
                variant="outline"
                size="sm"
                onClick={onAssignToAutopilot}
                disabled={isDeleting}
              >
                <Zap className="h-4 w-4 mr-2" />
                Use in autopilot
              </Button>
            )}

            {onRemoveFromAutopilot && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRemoveFromAutopilot}
                disabled={isDeleting}
              >
                <ZapOff className="h-4 w-4 mr-2" />
                Remove from autopilot
              </Button>
            )}

            {showGenerateButton && onGenerate && (
              <Button
                variant="cta"
                size="sm"
                onClick={onGenerate}
                disabled={isDeleting}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                {generateLabel}
              </Button>
            )}

            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={onDeselectAll}
              disabled={isDeleting}
            >
              Deselect All
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} items?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the selected items.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
