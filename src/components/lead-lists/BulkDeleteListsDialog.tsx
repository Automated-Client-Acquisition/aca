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
import { LeadList } from "@/hooks/useLeadLists";
import { Loader2 } from "lucide-react";

interface BulkDeleteListsDialogProps {
  lists: LeadList[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function BulkDeleteListsDialog({
  lists,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: BulkDeleteListsDialogProps) {
  const totalContacts = lists.reduce((sum, l) => sum + l.lead_count, 0);
  const namesPreview = lists.slice(0, 5).map((l) => l.name).join(", ");
  const remaining = lists.length - 5;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {lists.length} Lead Lists</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete {namesPreview}
            {remaining > 0 ? ` and ${remaining} more` : ""}? This will remove{" "}
            {lists.length === 1 ? "the list" : "these lists"} and their{" "}
            {totalContacts.toLocaleString()} total memberships. The contacts themselves will not
            be deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isLoading}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Delete {lists.length} Lists
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
