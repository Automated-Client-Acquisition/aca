import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Loader2, UserCog } from "lucide-react";
import { useUpdateMemberRole } from "@/hooks/useOrganizationMembers";
import { OrganizationMember, UserRole, getRoleLabel } from "@/types/organization";

interface EditMemberRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: OrganizationMember;
}

export function EditMemberRoleDialog({
  open,
  onOpenChange,
  member,
}: EditMemberRoleDialogProps) {
  const [selectedRole, setSelectedRole] = useState<UserRole>(
    member.role as UserRole
  );
  const { mutate: updateRole, isPending } = useUpdateMemberRole();

  const handleSave = () => {
    if (selectedRole === member.role) {
      onOpenChange(false);
      return;
    }

    updateRole(
      { memberId: member.id, newRole: selectedRole },
      {
        onSuccess: () => {
          onOpenChange(false);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5" />
            Change Role
          </DialogTitle>
          <DialogDescription>
            Update the role for {member.user?.full_name || member.user?.email}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Role</Label>
            <Select
              value={selectedRole}
              onValueChange={(value) => setSelectedRole(value as UserRole)}
            >
              <SelectTrigger>
                <SelectValue>
                  {getRoleLabel(selectedRole)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner" className="py-3">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Owner</span>
                    <span className="text-xs text-muted-foreground">
                      Full access including billing and deletion
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="admin" className="py-3">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Can manage team members and settings
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="member" className="py-3">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Member</span>
                    <span className="text-xs text-muted-foreground">
                      Can create and manage content
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
