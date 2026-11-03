import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Building2,
  Users,
  FileText,
  Search,
  TrendingUp,
  Ban,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformAnalytics } from "@/hooks/useContentAnalytics";
import { useAdminOrganizations } from "@/hooks/useAdminOrganizations";
import { AdminFilters } from "@/types/admin";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminOrganizationsTable } from "@/components/admin/AdminOrganizationsTable";
import { AdminActionLogsPanel } from "@/components/admin/AdminActionLogsPanel";
import { AdminAcquisitionPanel } from "@/components/admin/AdminAcquisitionPanel";
import { SignupRequestsQueue } from "@/components/admin/SignupRequestsQueue";
import { NetworkRequestsQueue } from "@/components/admin/NetworkAccessPanel";
import { SkoolCommunitiesPanel } from "@/components/admin/SkoolCommunitiesPanel";
import { useSignupRequestStats } from "@/hooks/useSignupRequests";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { SELF_HOSTED } from "@/config/site";

export default function AdminDashboard() {
  const { isSuperAdmin } = useAuth();

  // Filters state
  const [filters, setFilters] = useState<AdminFilters>({
    type: undefined,
    status: undefined,
    plan: undefined,
    search: "",
    includeSuspended: true,
  });

  // Debounced search
  const [searchInput, setSearchInput] = useState("");

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    // Debounce the actual filter update
    const timeout = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: value || undefined }));
    }, 300);
    return () => clearTimeout(timeout);
  };

  const { data: organizations, isLoading: orgsLoading } = useAdminOrganizations(filters);
  const { data: platformStats, isLoading: statsLoading } = usePlatformAnalytics("30d");
  const { data: signupStats } = useSignupRequestStats();

  // Calculate suspended count
  const suspendedCount = organizations?.filter((org) => org.is_suspended).length || 0;
  const pendingSignups = signupStats?.pending || 0;

  if (!isSuperAdmin) {
    return (
      <AppLayout
        header={
          <>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-500" />
              <span className="font-semibold">Admin Dashboard</span>
            </div>
            <UserProfileMenu />
          </>
        }
      >
        <div className="container max-w-5xl py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">Access Denied</h3>
              <p className="text-sm text-muted-foreground">
                You don't have permission to access the admin dashboard.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-500" />
            <span className="font-semibold">Admin Dashboard</span>
          </div>
          <UserProfileMenu />
        </>
      }
    >
      <div className="container max-w-6xl py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-red-500" />
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground">
            Platform-wide management and analytics
          </p>
        </div>

      {/* Platform Stats */}
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Organizations
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {platformStats?.totalOrganizations || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                {platformStats?.totalAgencies || 0} agencies,{" "}
                {platformStats?.totalClients || 0} clients
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {platformStats?.totalUsers || 0}
              </div>
              <p className="text-xs text-muted-foreground">across all orgs</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Content</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {platformStats?.totalContent || 0}
              </div>
              <p className="text-xs text-muted-foreground">pieces created</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {platformStats?.totalJobs || 0}
              </div>
              <p className="text-xs text-muted-foreground">generation jobs</p>
            </CardContent>
          </Card>
          <Card className={suspendedCount > 0 ? "border-red-200" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Suspended</CardTitle>
              <Ban className={`h-4 w-4 ${suspendedCount > 0 ? "text-red-500" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${suspendedCount > 0 ? "text-red-600" : ""}`}>
                {suspendedCount}
              </div>
              <p className="text-xs text-muted-foreground">organizations</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs defaultValue="organizations">
        <TabsList>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="acquisition">Acquisition</TabsTrigger>
          {!SELF_HOSTED && (
            <TabsTrigger value="signups" className="relative">
              Signup Requests
              {pendingSignups > 0 && (
                <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-yellow-500 text-white rounded-full">
                  {pendingSignups}
                </span>
              )}
            </TabsTrigger>
          )}
          {!SELF_HOSTED && <TabsTrigger value="network">ACA Network</TabsTrigger>}
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          {!SELF_HOSTED && <TabsTrigger value="skool">Skool Sync</TabsTrigger>}
        </TabsList>

        <TabsContent value="organizations" className="space-y-4">
          {/* Filters */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>All Organizations</CardTitle>
                  <CardDescription>
                    View and manage all organizations on the platform
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4 mb-4">
                <div className="relative flex-1 min-w-[200px] max-w-[300px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search organizations..."
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <Select
                  value={filters.type || "all"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      type: value === "all" ? undefined : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="agency">Agencies</SelectItem>
                    <SelectItem value="client">Clients</SelectItem>
                    <SelectItem value="standalone">Standalone</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={filters.status || "all"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      status: value === "all" ? undefined : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="archived">Archived</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={filters.plan || "all"}
                  onValueChange={(value) =>
                    setFilters((prev) => ({
                      ...prev,
                      plan: value === "all" ? undefined : value,
                    }))
                  }
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Plans</SelectItem>
                    <SelectItem value="free">Starter</SelectItem>
                    <SelectItem value="pro">Pro</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="include-suspended"
                    checked={filters.includeSuspended}
                    onCheckedChange={(checked) =>
                      setFilters((prev) => ({ ...prev, includeSuspended: checked }))
                    }
                  />
                  <Label htmlFor="include-suspended" className="text-sm">
                    Show suspended
                  </Label>
                </div>
              </div>

              <AdminOrganizationsTable
                organizations={organizations || []}
                isLoading={orgsLoading}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="acquisition" className="space-y-4">
          <AdminAcquisitionPanel />
        </TabsContent>

        <TabsContent value="signups" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <UserPlus className="w-5 h-5" />
                    Community Signup Requests
                  </CardTitle>
                  <CardDescription>
                    Review and approve signup requests from your Skool community
                  </CardDescription>
                </div>
                {signupStats && (
                  <div className="flex gap-4 text-sm">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-yellow-600">{signupStats.pending}</div>
                      <div className="text-muted-foreground">Pending</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">{signupStats.approved}</div>
                      <div className="text-muted-foreground">Approved</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-muted-foreground">{signupStats.rejected}</div>
                      <div className="text-muted-foreground">Rejected</div>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="pending">
                <TabsList className="mb-4">
                  <TabsTrigger value="pending">
                    Pending
                    {pendingSignups > 0 && (
                      <span className="ml-1.5 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
                        {pendingSignups}
                      </span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="approved">Approved</TabsTrigger>
                  <TabsTrigger value="rejected">Rejected</TabsTrigger>
                  <TabsTrigger value="all">All</TabsTrigger>
                </TabsList>
                <TabsContent value="pending">
                  <SignupRequestsQueue statusFilter="pending" />
                </TabsContent>
                <TabsContent value="approved">
                  <SignupRequestsQueue statusFilter="approved" />
                </TabsContent>
                <TabsContent value="rejected">
                  <SignupRequestsQueue statusFilter="rejected" />
                </TabsContent>
                <TabsContent value="all">
                  <SignupRequestsQueue />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network" className="space-y-4">
          <NetworkRequestsQueue />
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>
                Recent admin actions across all organizations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AdminActionLogsPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="skool" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Skool Community Sync</CardTitle>
              <CardDescription>
                Configure which Skool communities to sync membership data from
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SkoolCommunitiesPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </AppLayout>
  );
}
