import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Building2,
  Users,
  FileText,
  Settings,
  Key,
  Share2,
  BarChart3,
  Eye,
  RotateCcw,
} from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useClientOrganization, useArchiveClientOrganization } from "@/hooks/useClientOrganizations";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getOrgInitials, getOrgColor } from "@/types/organization";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientTeamTab } from "@/components/clients/ClientTeamTab";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const defaultTab = searchParams.get("tab") || "overview";
  const { startImpersonation, isSuperAdmin } = useAuth();

  const { data: client, isLoading } = useClientOrganization(id);
  const { mutate: archiveClient, isPending: isArchiving } = useArchiveClientOrganization();

  const isArchived = client?.status === "archived";

  const handleViewAsClient = async () => {
    if (!id) return;
    if (isArchived) {
      toast.error("Cannot view archived client. Reactivate it first.");
      return;
    }
    const { error } = await startImpersonation(id);
    if (error) {
      toast.error(error.message);
    } else {
      // Clear all React Query caches to ensure fresh data for the new organization
      await queryClient.invalidateQueries();
      navigate("/jobs");
    }
  };

  const handleReactivate = () => {
    if (!id) return;
    archiveClient({ id, archive: false });
  };

  if (isLoading) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="container max-w-5xl py-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </AppLayout>
    );
  }

  if (!client) {
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
              <h3 className="font-medium mb-1">Client Not Found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This client doesn't exist or you don't have access.
              </p>
              <Button onClick={() => navigate("/clients")}>
                Back to Clients
              </Button>
            </CardContent>
          </Card>
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
      {/* Breadcrumb Navigation */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/clients">Clients</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{client.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14 rounded-lg">
            {client.logo_url && (
              <AvatarImage src={client.logo_url} className="object-cover rounded-lg" />
            )}
            <AvatarFallback
              className={`rounded-lg text-white text-xl font-bold ${getOrgColor(
                client.id
              )}`}
            >
              {getOrgInitials(client.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{client.name}</h1>
              <Badge
                variant="outline"
                className={
                  client.status === "archived"
                    ? "bg-yellow-100 text-yellow-800 border-yellow-200"
                    : client.status === "inactive"
                    ? "bg-gray-100 text-gray-800 border-gray-200"
                    : "bg-green-100 text-green-800 border-green-200"
                }
              >
                {client.status ? client.status.charAt(0).toUpperCase() + client.status.slice(1) : "Active"}
              </Badge>
            </div>
            <p className="text-muted-foreground">{client.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isArchived ? (
            <Button
              onClick={handleReactivate}
              variant="outline"
              disabled={isArchiving}
              className="text-yellow-600 border-yellow-600 hover:bg-yellow-50"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Reactivate
            </Button>
          ) : isSuperAdmin ? (
            <Button onClick={handleViewAsClient} variant="outline">
              <Eye className="w-4 h-4 mr-2" />
              View as Client
            </Button>
          ) : null}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{client.member_count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Content</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{client.total_content}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Videos</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {client.content_stats?.video || 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Images</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {client.content_stats?.image || 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={defaultTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="shared">Shared Assets</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Content Breakdown</CardTitle>
                <CardDescription>Content created by type</CardDescription>
              </CardHeader>
              <CardContent>
                {Object.entries(client.content_stats || {}).length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(client.content_stats || {}).map(
                      ([type, count]) => (
                        <div
                          key={type}
                          className="flex items-center justify-between"
                        >
                          <span className="capitalize">{type}</span>
                          <span className="font-medium">{count as number}</span>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No content created yet
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common management tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => navigate(`/clients/${id}?tab=team`)}
                >
                  <Users className="w-4 h-4 mr-2" />
                  Manage Team
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => navigate(`/clients/${id}?tab=api-keys`)}
                >
                  <Key className="w-4 h-4 mr-2" />
                  Manage API Keys
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => navigate(`/clients/${id}?tab=shared`)}
                >
                  <Share2 className="w-4 h-4 mr-2" />
                  Share Assets
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="team">
          {id && <ClientTeamTab clientId={id} />}
        </TabsContent>

        <TabsContent value="api-keys">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                API Keys
              </CardTitle>
              <CardDescription>
                Manage API keys for this client. Protected keys are managed by
                you and cannot be modified by the client.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm py-8 text-center">
                API key management for clients coming soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shared">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Share2 className="w-5 h-5" />
                Shared Assets
              </CardTitle>
              <CardDescription>
                Blueprints and prompts shared with this client
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm py-8 text-center">
                Asset sharing coming soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Client Settings
              </CardTitle>
              <CardDescription>
                Configure this client's account settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <h4 className="font-medium mb-2">API Key Strategy</h4>
                  <p className="text-sm text-muted-foreground">
                    {client.organization_settings?.[0]?.inherit_api_keys_from_parent
                      ? "Inheriting API keys from agency"
                      : "Using own API keys"}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Onboarding Status</h4>
                  <p className="text-sm text-muted-foreground">
                    {client.organization_settings?.[0]?.onboarding_completed
                      ? "Completed"
                      : "Not completed"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      </div>
    </AppLayout>
  );
}
