import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Plus, Users, FileText } from "lucide-react";
import { ClientsTable } from "@/components/clients/ClientsTable";
import { CreateClientDialog } from "@/components/clients/CreateClientDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useClientOrganizations } from "@/hooks/useClientOrganizations";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

export default function ClientsManagement() {
  const { currentOrganization, isAgency, isClient } = useAuth();
  const { data: clients } = useClientOrganizations();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(true);

  // Filter clients based on archived status
  const filteredClients = showArchived
    ? clients
    : clients?.filter(c => c.status !== "archived");

  // Calculate stats from filtered clients
  const totalClients = filteredClients?.length || 0;
  const archivedCount = clients?.filter(c => c.status === "archived").length || 0;
  const totalUsers = filteredClients?.reduce((sum, c) => sum + (c.user_count || 0), 0) || 0;
  const totalContent = filteredClients?.reduce((sum, c) => sum + (c.content_count || 0), 0) || 0;

  // Check if org is agency (by isAgency flag OR by type)
  const isAgencyOrg = isAgency || currentOrganization?.type === "agency";

  // Client organizations cannot manage sub-clients
  if (isClient) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="container max-w-5xl py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">Client Management Not Available</h3>
              <p className="text-sm text-muted-foreground">
                This workspace is managed by your parent agency. Client management is only available for agency accounts.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (!isAgencyOrg) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="container max-w-5xl py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">Become an Agency</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first client to become an agency and unlock client management features.
              </p>
              <Button variant="cta" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Client
              </Button>
            </CardContent>
          </Card>

          <CreateClientDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
          />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="container max-w-5xl py-6 space-y-6">
        {/* Header */}
        <PageHeader
          icon={Building2}
          title="Clients"
          description={
            <>
              Manage client sub-accounts under{" "}
              <span className="font-medium text-foreground">
                {currentOrganization?.name}
              </span>
            </>
          }
          actions={
            <>
              {archivedCount > 0 && (
                <div className="mr-2 flex items-center gap-2">
                  <Switch
                    id="show-archived"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                  />
                  <Label htmlFor="show-archived" className="text-sm text-muted-foreground">
                    Show archived ({archivedCount})
                  </Label>
                </div>
              )}
              <Button variant="cta" onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Client
              </Button>
            </>
          }
        />

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalClients}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalUsers}</div>
              <p className="text-xs text-muted-foreground">across all clients</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Content</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalContent}</div>
              <p className="text-xs text-muted-foreground">pieces created</p>
            </CardContent>
          </Card>
        </div>

        {/* Clients Table */}
        <Card>
          <CardHeader>
            <CardTitle>All Clients</CardTitle>
            <CardDescription>
              Click on a client to view details and manage their account
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ClientsTable showArchived={showArchived} />
          </CardContent>
        </Card>

        {/* Create Dialog */}
        <CreateClientDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
        />
      </div>
    </AppLayout>
  );
}
