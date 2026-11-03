import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollText } from "lucide-react";
import { useAdminActionLogs } from "@/hooks/useAdminOrganizations";
import { getActionTypeDisplay, AdminActionType } from "@/types/admin";
import { formatDistanceToNow } from "date-fns";

interface AdminActionLogsPanelProps {
  organizationId?: string;
}

export function AdminActionLogsPanel({ organizationId }: AdminActionLogsPanelProps) {
  const { data: logs, isLoading } = useAdminActionLogs(organizationId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="text-center py-12">
        <ScrollText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
        <h3 className="font-medium mb-1">No action logs</h3>
        <p className="text-sm text-muted-foreground">
          Admin actions will appear here
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Organization</TableHead>
          <TableHead>Admin</TableHead>
          <TableHead>Details</TableHead>
          <TableHead>Time</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => {
          const actionDisplay = getActionTypeDisplay(log.action_type as AdminActionType);

          return (
            <TableRow key={log.id}>
              <TableCell>
                <Badge variant="outline" className={actionDisplay.color}>
                  {actionDisplay.label}
                </Badge>
              </TableCell>
              <TableCell className="font-medium">
                {log.target_organization_name}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {log.admin_name || log.admin_email}
              </TableCell>
              <TableCell className="text-sm max-w-[200px] truncate">
                {log.notes || formatChangeDetails(log.action_type, log.previous_value, log.new_value)}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatDistanceToNow(new Date(log.created_at), {
                  addSuffix: true,
                })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function formatChangeDetails(
  actionType: string,
  previousValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null
): string {
  switch (actionType) {
    case "plan_change":
      return `${previousValue?.plan_tier || "free"} → ${newValue?.plan_tier || "free"}`;
    case "suspend":
      return newValue?.reason ? `Reason: ${newValue.reason}` : "Suspended";
    case "unsuspend":
      return "Restored access";
    case "archive":
      return "Archived";
    case "unarchive":
      return "Restored from archive";
    case "delete":
      return "Permanently deleted";
    case "edit_name":
      return `${previousValue?.name} → ${newValue?.name}`;
    case "edit_limits":
      return "Limits updated";
    case "edit_settings":
      return "Settings updated";
    case "network_review":
      return `${previousValue?.network_status} → ${newValue?.network_status}${newValue?.note ? ` (${newValue.note})` : ""}`;
    default:
      return "";
  }
}
