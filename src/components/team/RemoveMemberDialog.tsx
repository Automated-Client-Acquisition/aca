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
import { Loader2 } from "lucide-react";
import { useRemoveMember } from "@/hooks/useOrganizationMembers";
import { OrganizationMember } from "@/types/organization";

interface RemoveMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: OrganizationMember;
}

export function RemoveMemberDialog({
  open,
  onOpenChange,
  member,
}: RemoveMemberDialogProps) {
  const { mutate: removeMember, isPending } = useRemoveMember();

  const handleRemove = () => {
    removeMember(member.id, {
      onSuccess: () => {
        onOpenChange(false);
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to remove{" "}
            <strong>{member.user?.full_name || member.user?.email}</strong> from
            your team? They will lose access to all organization resources.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRemove}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Remove Member
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
