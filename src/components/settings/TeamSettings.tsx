import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserPlus, Users, Mail } from "lucide-react";
import { TeamMembersTable } from "@/components/team/TeamMembersTable";
import { PendingInvitationsTable } from "@/components/team/PendingInvitationsTable";
import { InviteUserDialog } from "@/components/team/InviteUserDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganizationMembers } from "@/hooks/useOrganizationMembers";
import { useInvitations } from "@/hooks/useInvitations";
import { hasRolePrivilege } from "@/types/organization";

export function TeamSettings() {
  const { currentOrganization, userRole } = useAuth();
  const { data: members } = useOrganizationMembers();
  const { data: invitations } = useInvitations();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  // Allow invite if user has admin role or higher, or if role not set (likely owner)
  const canInvite = !userRole || userRole === "owner" || userRole === "admin" || userRole === "super_admin";
  const pendingCount = invitations?.filter((i) => i.status === "pending").length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Team Members</h2>
          <p className="text-sm text-muted-foreground">
            Manage who has access to {currentOrganization?.name}
          </p>
        </div>
        <Button onClick={() => setInviteDialogOpen(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Invite Member
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Invites</CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">
            Members ({members?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="invitations">
            Invitations ({invitations?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>
                People with access to this organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TeamMembersTable />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invitations">
          <Card>
            <CardHeader>
              <CardTitle>Invitations</CardTitle>
              <CardDescription>
                Manage pending and past invitations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PendingInvitationsTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Invite Dialog */}
      <InviteUserDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
      />
    </div>
  );
}
