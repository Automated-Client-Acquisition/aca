import { useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAdminDeleteOrganization } from "@/hooks/useAdminOrganizations";

interface DeleteOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    name: string;
    content_count?: number;
  };
}

export function DeleteOrganizationDialog({
  open,
  onOpenChange,
  organization,
}: DeleteOrganizationDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const deleteOrg = useAdminDeleteOrganization();

  const handleDelete = async () => {
    await deleteOrg.mutateAsync({
      orgId: organization.id,
      orgName: organization.name,
    });

    setConfirmText("");
    onOpenChange(false);
  };

  const canDelete = confirmText === organization.name;
  const hasContent = (organization.content_count || 0) > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Delete Organization
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              Are you sure you want to permanently delete{" "}
              <strong>{organization.name}</strong>? This action cannot be undone.
            </p>
            {hasContent && (
              <p className="text-amber-600 font-medium">
                Warning: This organization has {organization.content_count} content items
                that will also be deleted.
              </p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="confirm">
            Type <strong>{organization.name}</strong> to confirm
          </Label>
          <Input
            id="confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={organization.name}
            className="font-mono"
          />
        </div>

        <AlertDialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setConfirmText("");
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={deleteOrg.isPending || !canDelete}
          >
            {deleteOrg.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Delete Permanently
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
