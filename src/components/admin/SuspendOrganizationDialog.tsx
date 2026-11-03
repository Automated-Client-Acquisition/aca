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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useSuspendOrganization } from "@/hooks/useAdminOrganizations";

interface SuspendOrganizationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organization: {
    id: string;
    name: string;
    is_suspended: boolean;
  };
}

export function SuspendOrganizationDialog({
  open,
  onOpenChange,
  organization,
}: SuspendOrganizationDialogProps) {
  const [reason, setReason] = useState("");
  const suspendOrg = useSuspendOrganization();

  const isSuspending = !organization.is_suspended;

  const handleSubmit = async () => {
    if (isSuspending && !reason.trim()) {
      return; // Require reason when suspending
    }

    await suspendOrg.mutateAsync({
      orgId: organization.id,
      suspend: isSuspending,
      reason: isSuspending ? reason : undefined,
    });

    setReason("");
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isSuspending && <AlertTriangle className="w-5 h-5 text-red-500" />}
            {isSuspending ? "Suspend Organization" : "Unsuspend Organization"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSuspending ? (
              <>
                Are you sure you want to suspend <strong>{organization.name}</strong>?
                This will immediately block all users from accessing this organization.
              </>
            ) : (
              <>
                Are you sure you want to unsuspend <strong>{organization.name}</strong>?
                This will restore access for all users.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isSuspending && (
          <div className="space-y-2 py-2">
            <Label htmlFor="reason">
              Suspension Reason <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="reason"
              placeholder="Reason for suspending this organization..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This reason will be stored for audit purposes.
            </p>
          </div>
        )}

        <AlertDialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isSuspending ? "destructive" : "default"}
            onClick={handleSubmit}
            disabled={suspendOrg.isPending || (isSuspending && !reason.trim())}
          >
            {suspendOrg.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isSuspending ? "Suspend" : "Unsuspend"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
