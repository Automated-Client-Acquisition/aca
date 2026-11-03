import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { TeamMembersTable } from "@/components/team/TeamMembersTable";
import { PendingInvitationsTable } from "@/components/team/PendingInvitationsTable";
import { InviteUserDialog } from "@/components/team/InviteUserDialog";

interface ClientTeamTabProps {
  clientId: string;
}

export function ClientTeamTab({ clientId }: ClientTeamTabProps) {
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Team Members</CardTitle>
            <CardDescription>
              People with access to this client account
            </CardDescription>
          </div>
          <Button onClick={() => setInviteDialogOpen(true)}>
            <Users className="w-4 h-4 mr-2" />
            Invite
          </Button>
        </CardHeader>
        <CardContent>
          <TeamMembersTable organizationId={clientId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending Invitations</CardTitle>
          <CardDescription>
            Invitations that have been sent but not yet accepted
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PendingInvitationsTable organizationId={clientId} />
        </CardContent>
      </Card>

      <InviteUserDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        organizationId={clientId}
      />
    </div>
  );
}
