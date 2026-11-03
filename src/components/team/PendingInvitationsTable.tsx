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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  RefreshCw,
  Trash2,
  XCircle,
  Clock,
  CheckCircle,
  AlertCircle,
  Mail,
} from "lucide-react";
import { useInvitations, useResendInvitation, useCancelInvitation, useDeleteInvitation } from "@/hooks/useInvitations";
import { Invitation, InvitationStatus } from "@/types/organization";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

const statusConfig: Record<
  InvitationStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  pending: {
    label: "Pending",
    icon: Clock,
    className: "bg-yellow-100 text-yellow-800 border-yellow-200",
  },
  accepted: {
    label: "Accepted",
    icon: CheckCircle,
    className: "bg-green-100 text-green-800 border-green-200",
  },
  expired: {
    label: "Expired",
    icon: AlertCircle,
    className: "bg-red-100 text-red-800 border-red-200",
  },
  cancelled: {
    label: "Cancelled",
    icon: XCircle,
    className: "bg-gray-100 text-gray-800 border-gray-200",
  },
};

interface PendingInvitationsTableProps {
  organizationId?: string;
}

export function PendingInvitationsTable({ organizationId }: PendingInvitationsTableProps = {}) {
  const { data: invitations, isLoading } = useInvitations(organizationId);
  const { mutate: resendInvitation, isPending: isResending } = useResendInvitation();
  const { mutate: cancelInvitation, isPending: isCancelling } = useCancelInvitation();
  const { mutate: deleteInvitation, isPending: isDeleting } = useDeleteInvitation();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-[200px]" />
              <Skeleton className="h-3 w-[150px]" />
            </div>
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
    );
  }

  if (!invitations || invitations.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>No invitations sent yet.</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Sent</TableHead>
          <TableHead className="w-[70px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invitation) => {
          const status = statusConfig[invitation.status];
          const StatusIcon = status.icon;
          const isPending = invitation.status === "pending";
          const canResend = isPending || invitation.status === "expired";

          return (
            <TableRow key={invitation.id}>
              <TableCell>
                <div className="font-medium">{invitation.email}</div>
                {invitation.resent_count > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Resent {invitation.resent_count} time
                    {invitation.resent_count > 1 ? "s" : ""}
                  </div>
                )}
              </TableCell>
              <TableCell className="capitalize">{invitation.role || "member"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`${status.className} gap-1`}>
                  <StatusIcon className="w-3 h-3" />
                  {status.label}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(invitation.created_at), {
                  addSuffix: true,
                })}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canResend && (
                      <DropdownMenuItem
                        onClick={() => resendInvitation(invitation.id)}
                        disabled={isResending}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Resend Invitation
                      </DropdownMenuItem>
                    )}
                    {isPending && (
                      <DropdownMenuItem
                        onClick={() => cancelInvitation(invitation.id)}
                        disabled={isCancelling}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Cancel Invitation
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => deleteInvitation(invitation.id)}
                      disabled={isDeleting}
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
  );
}
