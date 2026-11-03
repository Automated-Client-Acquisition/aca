import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
  Eye,
  Pencil,
  Users,
  Trash2,
  Building2,
  Archive,
  RotateCcw,
  Ban,
  CheckCircle,
  CreditCard,
  AlertCircle,
  Key,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminArchiveOrganization } from "@/hooks/useAdminOrganizations";
import { AdminOrganization, getPlanTierBadge } from "@/types/admin";
import { getOrgInitials, getOrgColor } from "@/types/organization";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { ChangePlanDialog } from "./ChangePlanDialog";
import { SuspendOrganizationDialog } from "./SuspendOrganizationDialog";
import { EditOrganizationDialog } from "./EditOrganizationDialog";
import { DeleteOrganizationDialog } from "./DeleteOrganizationDialog";
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

interface AdminOrganizationsTableProps {
  organizations: AdminOrganization[];
  isLoading: boolean;
}

export function AdminOrganizationsTable({
  organizations,
  isLoading,
}: AdminOrganizationsTableProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { startImpersonation } = useAuth();

  // Dialog states
  const [planDialogOrg, setPlanDialogOrg] = useState<AdminOrganization | null>(null);
  const [suspendDialogOrg, setSuspendDialogOrg] = useState<AdminOrganization | null>(null);
  const [editDialogOrg, setEditDialogOrg] = useState<AdminOrganization | null>(null);
  const [deleteDialogOrg, setDeleteDialogOrg] = useState<AdminOrganization | null>(null);
  const [archiveDialogOrg, setArchiveDialogOrg] = useState<{
    org: AdminOrganization;
    action: "archive" | "unarchive";
  } | null>(null);

  const archiveOrg = useAdminArchiveOrganization();

  const handleImpersonate = async (orgId: string) => {
    const { error } = await startImpersonation(orgId);
    if (!error) {
      // Clear all React Query caches to ensure fresh data for the new organization
      await queryClient.invalidateQueries();
      navigate("/jobs");
    }
  };

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

  const getStatusBadge = (status: string | null, isSuspended: boolean) => {
    if (isSuspended) {
      return (
        <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200">
          <Ban className="w-3 h-3 mr-1" />
          Suspended
        </Badge>
      );
    }

    switch (status) {
      case "active":
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
            Active
          </Badge>
        );
      case "inactive":
        return (
          <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200">
            Inactive
          </Badge>
        );
      case "archived":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">
            Archived
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">
            Active
          </Badge>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center space-x-4">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-3 w-[150px]" />
            </div>
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (!organizations || organizations.length === 0) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="font-medium mb-1">No organizations found</h3>
        <p className="text-sm text-muted-foreground">
          Try adjusting your filters
        </p>
      </div>
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Users</TableHead>
            <TableHead>API Keys</TableHead>
            <TableHead>Content</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-[70px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((org) => {
            const planBadge = getPlanTierBadge(org.plan_tier);

            return (
              <TableRow
                key={org.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => navigate(`/admin/organizations/${org.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Avatar className="h-10 w-10 rounded-lg">
                        {org.logo_url && (
                          <AvatarImage src={org.logo_url} className="object-cover rounded-lg" />
                        )}
                        <AvatarFallback
                          className={`rounded-lg text-white font-bold ${getOrgColor(org.id)}`}
                        >
                          {getOrgInitials(org.name)}
                        </AvatarFallback>
                      </Avatar>
                      {org.is_suspended && (
                        <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-background" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {org.name}
                        {org.is_suspended && (
                          <AlertCircle className="w-4 h-4 text-red-500" />
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {org.slug}
                        {org.parent_name && (
                          <span className="ml-2 text-xs">
                            → {org.parent_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{getTypeBadge(org.type)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={planBadge.color}>
                    {planBadge.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  {getStatusBadge(org.status, org.is_suspended)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4 text-muted-foreground" />
                    {org.user_count}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Key className={`w-4 h-4 ${org.api_key_count > 0 ? "text-green-500" : "text-muted-foreground opacity-50"}`} />
                    <span className={org.api_key_count > 0 ? "font-medium" : "text-muted-foreground"}>
                      {org.api_key_count}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="font-medium">{org.content_count}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDistanceToNow(new Date(org.created_at), {
                    addSuffix: true,
                  })}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleImpersonate(org.id);
                        }}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View as Org
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/admin/organizations/${org.id}`);
                        }}
                      >
                        <Building2 className="w-4 h-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlanDialogOrg(org);
                        }}
                      >
                        <CreditCard className="w-4 h-4 mr-2" />
                        Change Plan
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditDialogOrg(org);
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {org.is_suspended ? (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSuspendDialogOrg(org);
                          }}
                          className="text-green-600 focus:text-green-600"
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          Unsuspend
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setSuspendDialogOrg(org);
                          }}
                          className="text-red-600 focus:text-red-600"
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Suspend
                        </DropdownMenuItem>
                      )}
                      {org.status === "archived" ? (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveDialogOrg({ org, action: "unarchive" });
                          }}
                        >
                          <RotateCcw className="w-4 h-4 mr-2" />
                          Unarchive
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiveDialogOrg({ org, action: "archive" });
                          }}
                          className="text-yellow-600 focus:text-yellow-600"
                        >
                          <Archive className="w-4 h-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteDialogOrg(org);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Change Plan Dialog */}
      {planDialogOrg && (
        <ChangePlanDialog
          open={!!planDialogOrg}
          onOpenChange={(open) => !open && setPlanDialogOrg(null)}
          organization={planDialogOrg}
        />
      )}

      {/* Suspend Dialog */}
      {suspendDialogOrg && (
        <SuspendOrganizationDialog
          open={!!suspendDialogOrg}
          onOpenChange={(open) => !open && setSuspendDialogOrg(null)}
          organization={suspendDialogOrg}
        />
      )}

      {/* Edit Dialog */}
      {editDialogOrg && (
        <EditOrganizationDialog
          open={!!editDialogOrg}
          onOpenChange={(open) => !open && setEditDialogOrg(null)}
          organization={editDialogOrg}
        />
      )}

      {/* Delete Dialog */}
      {deleteDialogOrg && (
        <DeleteOrganizationDialog
          open={!!deleteDialogOrg}
          onOpenChange={(open) => !open && setDeleteDialogOrg(null)}
          organization={deleteDialogOrg}
        />
      )}

      {/* Archive/Unarchive Confirmation Dialog */}
      <AlertDialog
        open={!!archiveDialogOrg}
        onOpenChange={() => setArchiveDialogOrg(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {archiveDialogOrg?.action === "archive"
                ? "Archive Organization"
                : "Unarchive Organization"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {archiveDialogOrg?.action === "archive" ? (
                  <>
                    Are you sure you want to archive{" "}
                    <strong>{archiveDialogOrg?.org.name}</strong>?
                    <p className="mt-2 text-yellow-600 font-medium">
                      All users will lose access until the organization is unarchived.
                    </p>
                  </>
                ) : (
                  <>
                    Unarchive <strong>{archiveDialogOrg?.org.name}</strong>?
                    <p className="mt-2">Users will regain access to their organization.</p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiveDialogOrg) {
                  archiveOrg.mutate({
                    orgId: archiveDialogOrg.org.id,
                    archive: archiveDialogOrg.action === "archive",
                  });
                  setArchiveDialogOrg(null);
                }
              }}
              disabled={archiveOrg.isPending}
              className={
                archiveDialogOrg?.action === "archive"
                  ? "bg-yellow-600 text-white hover:bg-yellow-700"
                  : ""
              }
            >
              {archiveDialogOrg?.action === "archive" ? "Archive" : "Unarchive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
