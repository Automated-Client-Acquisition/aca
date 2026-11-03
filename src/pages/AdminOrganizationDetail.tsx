import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Building2,
  Users,
  FileText,
  Briefcase,
  Eye,
  CreditCard,
  Pencil,
  Ban,
  CheckCircle,
  Archive,
  RotateCcw,
  Trash2,
  AlertCircle,
  Loader2,
  Mail,
  Clock,
  Shield,
  ExternalLink,
  Key,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminOrganization, useAdminArchiveOrganization } from "@/hooks/useAdminOrganizations";
import {
  getPlanTierBadge,
  PlanTier,
  PlanLimits,
  UsageMetrics,
  formatLimit,
  getUsagePercentage,
  isUnlimited,
  getEffectiveLimits,
} from "@/types/admin";
import { Progress } from "@/components/ui/progress";
import { getOrgInitials, getOrgColor, getRoleLabel } from "@/types/organization";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow, format } from "date-fns";
import { ChangePlanDialog } from "@/components/admin/ChangePlanDialog";
import { SuspendOrganizationDialog } from "@/components/admin/SuspendOrganizationDialog";
import { EditOrganizationDialog } from "@/components/admin/EditOrganizationDialog";
import { DeleteOrganizationDialog } from "@/components/admin/DeleteOrganizationDialog";
import { AdminActionLogsPanel } from "@/components/admin/AdminActionLogsPanel";
import { NetworkAccessPanel } from "@/components/admin/NetworkAccessPanel";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AdminOrganizationDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isSuperAdmin, startImpersonation } = useAuth();

  const { data: org, isLoading, error } = useAdminOrganization(id);
  const archiveOrg = useAdminArchiveOrganization();

  // Dialog states
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [suspendDialogOpen, setSuspendDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);

  const handleImpersonate = async () => {
    if (!id) return;
    const { error } = await startImpersonation(id);
    if (!error) {
      // Clear all React Query caches to ensure fresh data for the new organization
      await queryClient.invalidateQueries();
      navigate("/jobs");
    }
  };

  const headerContent = (
    <>
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-red-500" />
        <span className="font-semibold">Admin Dashboard</span>
      </div>
      <UserProfileMenu />
    </>
  );

  if (!isSuperAdmin) {
    return (
      <AppLayout header={headerContent}>
        <div className="container max-w-5xl py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <Shield className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="font-medium mb-1">Access Denied</h3>
              <p className="text-sm text-muted-foreground">
                You don't have permission to access this page.
              </p>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  if (isLoading) {
    return (
      <AppLayout header={headerContent}>
        <div className="container max-w-6xl py-6 space-y-6">
          <Skeleton className="h-10 w-40" />
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </AppLayout>
    );
  }

  if (error || !org) {
    return (
      <AppLayout header={headerContent}>
        <div className="container max-w-5xl py-6">
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-500 opacity-50" />
              <h3 className="font-medium mb-1">Organization Not Found</h3>
              <p className="text-sm text-muted-foreground mb-4">
                The organization you're looking for doesn't exist or has been deleted.
              </p>
              <Button onClick={() => navigate("/admin")}>Back to Admin</Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const planBadge = getPlanTierBadge(org.plan_tier);

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "agency":
        return (
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            Agency
          </Badge>
        );
      case "client":
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
            Client
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
            Standalone
          </Badge>
        );
    }
  };

  return (
    <AppLayout header={headerContent}>
      <div className="container max-w-6xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
        <div className="flex items-center gap-4 flex-1">
          <div className="relative">
            <Avatar className="h-14 w-14 rounded-lg">
              {org.logo_url && (
                <AvatarImage src={org.logo_url} className="object-cover rounded-lg" />
              )}
              <AvatarFallback
                className={`rounded-lg text-white font-bold text-xl ${getOrgColor(org.id)}`}
              >
                {getOrgInitials(org.name)}
              </AvatarFallback>
            </Avatar>
            {org.is_suspended && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-background flex items-center justify-center">
                <Ban className="w-2.5 h-2.5 text-white" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{org.name}</h1>
              {getTypeBadge(org.type)}
              <Badge variant="outline" className={planBadge.color}>
                {planBadge.label}
              </Badge>
              {org.is_suspended && (
                <Badge variant="destructive">
                  <Ban className="w-3 h-3 mr-1" />
                  Suspended
                </Badge>
              )}
              {org.status === "archived" && (
                <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
                  Archived
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground">
              {org.slug}
              {org.parent_name && (
                <span className="ml-2">• Client of {org.parent_name}</span>
              )}
            </p>
          </div>
          <Button variant="outline" onClick={handleImpersonate}>
            <Eye className="w-4 h-4 mr-2" />
            View as Org
          </Button>
        </div>
      </div>

      {/* Suspension Banner */}
      {org.is_suspended && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Ban className="w-5 h-5 text-red-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-800">This organization is suspended</p>
                {org.suspension_reason && (
                  <p className="text-sm text-red-700 mt-1">Reason: {org.suspension_reason}</p>
                )}
                {org.suspended_at && (
                  <p className="text-xs text-red-600 mt-1">
                    Suspended {formatDistanceToNow(new Date(org.suspended_at), { addSuffix: true })}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-100"
                onClick={() => setSuspendDialogOpen(true)}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Unsuspend
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{org.user_count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">API Keys</CardTitle>
            <Key className={`h-4 w-4 ${org.api_key_count > 0 ? "text-green-500" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{org.api_key_count}</span>
              {org.api_key_count === 0 && (
                <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-800 border-yellow-200">
                  Not configured
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Content</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{org.content_count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs Run</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{org.jobs_count}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {format(new Date(org.created_at), "MMM d, yyyy")}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Admin Actions</CardTitle>
          <CardDescription>Manage this organization</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPlanDialogOpen(true)}>
              <CreditCard className="w-4 h-4 mr-2" />
              Change Plan
            </Button>
            <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </Button>
            {org.is_suspended ? (
              <Button
                variant="outline"
                className="text-green-600 border-green-200 hover:bg-green-50"
                onClick={() => setSuspendDialogOpen(true)}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Unsuspend
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setSuspendDialogOpen(true)}
              >
                <Ban className="w-4 h-4 mr-2" />
                Suspend
              </Button>
            )}
            {org.status === "archived" ? (
              <Button
                variant="outline"
                onClick={() => setArchiveDialogOpen(true)}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Unarchive
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-yellow-600 border-yellow-200 hover:bg-yellow-50"
                onClick={() => setArchiveDialogOpen(true)}
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive
              </Button>
            )}
            <Button
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="network">ACA Network</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Users in this organization</CardDescription>
            </CardHeader>
            <CardContent>
              {org.members && org.members.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Skool</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {org.members.map((member) => {
                      const user = member.user as any;
                      const displayName = user?.first_name && user?.last_name
                        ? `${user.first_name} ${user.last_name}`
                        : user?.full_name || "Unknown";

                      return (
                        <TableRow key={member.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{displayName}</span>
                              {member.is_primary_owner && (
                                <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20">
                                  Primary Owner
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <span>{user?.email || "Unknown"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {getRoleLabel(member.role as any)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {user?.skool_profile_url ? (
                              <a
                                href={user.skool_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                <span>Profile</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No members found
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="network">
          {id && <NetworkAccessPanel orgId={id} />}
        </TabsContent>

        <TabsContent value="details">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Organization Info */}
            <Card>
              <CardHeader>
                <CardTitle>Organization Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Organization ID
                    </label>
                    <p className="font-mono text-sm">{org.id}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Slug
                    </label>
                    <p>{org.slug}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Type
                    </label>
                    <p className="capitalize">{org.type}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Status
                    </label>
                    <p className="capitalize">{org.status || "active"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Owner Email
                    </label>
                    <p>{org.owner_email || "N/A"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Plan Changed
                    </label>
                    <p>
                      {org.plan_changed_at
                        ? format(new Date(org.plan_changed_at), "MMM d, yyyy")
                        : "Never"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Usage & Limits */}
            <Card>
              <CardHeader>
                <CardTitle>Usage & Limits</CardTitle>
                <CardDescription>
                  Current usage vs plan limits ({planBadge.label} plan)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {(() => {
                  const planTier = (org.plan_tier || "free") as PlanTier;
                  const customLimits = org.limits as Partial<PlanLimits> | null;
                  const effectiveLimits = getEffectiveLimits(planTier, customLimits);
                  const rawUsage = org.current_usage as Record<string, any> | null;
                  const usage: UsageMetrics | null = rawUsage ? {
                    daily: rawUsage.daily || { generations: 0, cost: 0, date: '' },
                    monthly: rawUsage.monthly || { generations: 0, cost: 0, month: '' },
                    all_time: rawUsage.all_time || { generations: 0, cost: 0 },
                  } : null;

                  const dailyGen = usage?.daily?.generations || 0;
                  const monthlyGen = usage?.monthly?.generations || 0;
                  const dailyLimit = effectiveLimits.daily_generations;
                  const monthlyLimit = effectiveLimits.monthly_generations;

                  const dailyPercent = getUsagePercentage(dailyGen, dailyLimit);
                  const monthlyPercent = getUsagePercentage(monthlyGen, monthlyLimit);

                  return (
                    <>
                      {/* Daily Usage */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Daily Generations</span>
                          <span className="font-medium">
                            {dailyGen.toLocaleString()} / {formatLimit(dailyLimit)}
                            {customLimits?.daily_generations !== undefined && (
                              <span className="text-xs text-muted-foreground ml-1">(custom)</span>
                            )}
                          </span>
                        </div>
                        {!isUnlimited(dailyLimit) && (
                          <Progress
                            value={Math.min(dailyPercent, 100)}
                            className={dailyPercent >= 100 ? "[&>div]:bg-destructive" : dailyPercent >= 80 ? "[&>div]:bg-yellow-500" : ""}
                          />
                        )}
                      </div>

                      {/* Monthly Usage */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Monthly Generations</span>
                          <span className="font-medium">
                            {monthlyGen.toLocaleString()} / {formatLimit(monthlyLimit)}
                            {customLimits?.monthly_generations !== undefined && (
                              <span className="text-xs text-muted-foreground ml-1">(custom)</span>
                            )}
                          </span>
                        </div>
                        {!isUnlimited(monthlyLimit) && (
                          <Progress
                            value={Math.min(monthlyPercent, 100)}
                            className={monthlyPercent >= 100 ? "[&>div]:bg-destructive" : monthlyPercent >= 80 ? "[&>div]:bg-yellow-500" : ""}
                          />
                        )}
                      </div>

                      {/* All Time Stats */}
                      <div className="border-t pt-4 grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-sm text-muted-foreground">All-time Generations</label>
                          <p className="text-lg font-bold">
                            {(usage?.all_time?.generations || 0).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <label className="text-sm text-muted-foreground">All-time Cost</label>
                          <p className="text-lg font-bold">
                            ${(usage?.all_time?.cost || 0).toFixed(2)}
                          </p>
                        </div>
                      </div>

                      {/* Other Limits */}
                      <div className="border-t pt-4 space-y-2">
                        <h4 className="text-sm font-medium mb-3">Other Limits</h4>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Team Members</span>
                            <span>{formatLimit(effectiveLimits.max_team_members)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Concurrent Jobs</span>
                            <span>{formatLimit(effectiveLimits.concurrent_jobs)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Max Items/Job</span>
                            <span>{formatLimit(effectiveLimits.max_items_per_job)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">API Keys</span>
                            <span>{formatLimit(effectiveLimits.max_api_keys)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Workspaces/Clients</span>
                            <span>
                              {effectiveLimits.max_workspaces === 0
                                ? "None (no agency)"
                                : formatLimit(effectiveLimits.max_workspaces)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Autopilots</span>
                            <span>{formatLimit(effectiveLimits.max_autopilots)}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription>Recent admin actions on this organization</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminActionLogsPanel organizationId={org.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ChangePlanDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        organization={org}
      />

      <SuspendOrganizationDialog
        open={suspendDialogOpen}
        onOpenChange={setSuspendDialogOpen}
        organization={org}
      />

      <EditOrganizationDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        organization={org}
      />

      <DeleteOrganizationDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            // Navigate back after deletion
            navigate("/admin");
          }
        }}
        organization={org}
      />

      {/* Archive Dialog */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {org.status === "archived" ? "Unarchive" : "Archive"} Organization
            </AlertDialogTitle>
            <AlertDialogDescription>
              {org.status === "archived" ? (
                <>
                  Restore <strong>{org.name}</strong>? Users will regain access.
                </>
              ) : (
                <>
                  Archive <strong>{org.name}</strong>? All users will lose access
                  until unarchived.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                archiveOrg.mutate({
                  orgId: org.id,
                  archive: org.status !== "archived",
                });
                setArchiveDialogOpen(false);
              }}
              disabled={archiveOrg.isPending}
              className={
                org.status !== "archived"
                  ? "bg-yellow-600 text-white hover:bg-yellow-700"
                  : ""
              }
            >
              {archiveOrg.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              {org.status === "archived" ? "Unarchive" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </AppLayout>
  );
}
