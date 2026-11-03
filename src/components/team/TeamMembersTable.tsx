import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  Shield,
  UserCog,
  UserMinus,
  Crown,
  User,
} from "lucide-react";
import { useOrganizationMembers, useUpdateMemberRole, useRemoveMember } from "@/hooks/useOrganizationMembers";
import { useAuth } from "@/contexts/AuthContext";
import { OrganizationMember, UserRole, getRoleLabel, getRoleBadgeColor, hasRolePrivilege } from "@/types/organization";
import { EditMemberRoleDialog } from "./EditMemberRoleDialog";
import { RemoveMemberDialog } from "./RemoveMemberDialog";
import { Skeleton } from "@/components/ui/skeleton";

interface TeamMembersTableProps {
  organizationId?: string;
}

export function TeamMembersTable({ organizationId }: TeamMembersTableProps = {}) {
  const { data: members, isLoading } = useOrganizationMembers(organizationId);
  const { user, userRole } = useAuth();
  const [selectedMember, setSelectedMember] = useState<OrganizationMember | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const canManageMembers = userRole && hasRolePrivilege(userRole, "admin");

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case "super_admin":
        return <Shield className="w-3 h-3" />;
      case "owner":
        return <Crown className="w-3 h-3" />;
      case "admin":
        return <UserCog className="w-3 h-3" />;
      default:
        return <User className="w-3 h-3" />;
    }
  };

  const getInitials = (member: OrganizationMember) => {
    if (member.user?.full_name) {
      return member.user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    return member.user?.email?.slice(0, 2).toUpperCase() || "??";
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center space-x-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-3 w-[150px]" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!members || members.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No team members found.
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            {canManageMembers && <TableHead className="w-[70px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => {
            const isCurrentUser = member.user_id === user?.id;
            const canEdit =
              canManageMembers &&
              !isCurrentUser &&
              !member.is_primary_owner &&
              member.role !== "super_admin";

            return (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={member.user?.avatar_url || undefined} />
                      <AvatarFallback>{getInitials(member)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {member.user?.full_name || "Unnamed User"}
                        {isCurrentUser && (
                          <Badge variant="outline" className="text-xs">
                            You
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {member.user?.email}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`${getRoleBadgeColor(member.role as UserRole)} gap-1`}
                  >
                    {getRoleIcon(member.role as UserRole)}
                    {getRoleLabel(member.role as UserRole)}
                    {member.is_primary_owner && " (Primary)"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {member.joined_at
                    ? new Date(member.joined_at).toLocaleDateString()
                    : "—"}
                </TableCell>
                {canManageMembers && (
                  <TableCell>
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedMember(member);
                              setEditDialogOpen(true);
                            }}
                          >
                            <UserCog className="w-4 h-4 mr-2" />
                            Change Role
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => {
                              setSelectedMember(member);
                              setRemoveDialogOpen(true);
                            }}
                          >
                            <UserMinus className="w-4 h-4 mr-2" />
                            Remove Member
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {selectedMember && (
        <>
          <EditMemberRoleDialog
            open={editDialogOpen}
            onOpenChange={setEditDialogOpen}
            member={selectedMember}
          />
          <RemoveMemberDialog
            open={removeDialogOpen}
            onOpenChange={setRemoveDialogOpen}
            member={selectedMember}
          />
        </>
      )}
    </>
  );
}
