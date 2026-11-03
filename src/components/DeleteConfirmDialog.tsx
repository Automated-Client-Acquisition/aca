import { useState, useEffect } from "react";
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
import { Input } from "@/components/ui/input";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  itemName: string;
  itemType: string;
  description?: string;
  /**
   * When set, the user must type this exact string to enable the Delete
   * button. Used to guard high-blast-radius deletes (e.g. "select all
   * matching" filter deletes that can remove tens of thousands of contacts).
   */
  confirmText?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  itemName,
  itemType,
  description,
  confirmText,
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  // Reset the typed guard whenever the dialog opens/closes.
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const needsTyped = !!confirmText;
  const canConfirm = !needsTyped || typed.trim() === confirmText;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {itemType}?</AlertDialogTitle>
          <AlertDialogDescription>
            {description || `Are you sure you want to delete "${itemName}"? This action cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsTyped && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground">{confirmText}</span> to confirm.
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText}
              autoFocus
              aria-label={`Type ${confirmText} to confirm deletion`}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
