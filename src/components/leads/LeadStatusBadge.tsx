import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Clock,
  Loader2,
  Hourglass,
  CheckCircle,
  XCircle,
  MessageSquare,
  SkipForward,
  Unplug,
} from "lucide-react";
import type { ProgressStatus } from "@/hooks/useCampaignProgress";

interface StatusConfig {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
  icon: React.ElementType;
  className?: string;
}

const statusConfig: Record<ProgressStatus, StatusConfig> = {
  pending: {
    label: "Pending",
    variant: "secondary",
    icon: Clock,
  },
  in_progress: {
    label: "In Progress",
    variant: "default",
    icon: Loader2,
    className: "animate-spin",
  },
  waiting: {
    label: "Waiting",
    variant: "outline",
    icon: Hourglass,
  },
  completed: {
    label: "Completed",
    variant: "secondary",
    icon: CheckCircle,
    className: "text-green-500",
  },
  failed: {
    label: "Failed",
    variant: "destructive",
    icon: XCircle,
  },
  replied: {
    label: "Replied",
    variant: "secondary",
    icon: MessageSquare,
    className: "text-emerald-500",
  },
  skipped: {
    label: "Skipped",
    variant: "secondary",
    icon: SkipForward,
  },
  sender_disconnected: {
    label: "Sender Disconnected",
    variant: "destructive",
    icon: Unplug,
  },
  handed_off: {
    label: "Handed Off",
    variant: "secondary",
    icon: CheckCircle,
  },
  pending_review: {
    label: "Awaiting Review",
    variant: "outline",
    icon: Clock,
  },
};

interface LeadStatusBadgeProps {
  status: ProgressStatus;
  showIcon?: boolean;
  size?: "sm" | "default";
}

export function LeadStatusBadge({
  status,
  showIcon = true,
  size = "default",
}: LeadStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "gap-1",
        size === "sm" && "text-xs px-1.5 py-0",
        status === "completed" && "bg-green-50 text-green-700 border-green-200",
        status === "replied" && "bg-emerald-50 text-emerald-700 border-emerald-200",
        status === "sender_disconnected" && "bg-orange-50 text-orange-700 border-orange-200"
      )}
    >
      {showIcon && (
        <Icon className={cn("h-3 w-3", config.className)} />
      )}
      {config.label}
    </Badge>
  );
}

// Compact version for tables
export function LeadStatusDot({ status }: { status: ProgressStatus }) {
  const colors: Record<ProgressStatus, string> = {
    pending: "bg-gray-400",
    in_progress: "bg-blue-500",
    waiting: "bg-yellow-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    replied: "bg-emerald-500",
    skipped: "bg-gray-300",
    sender_disconnected: "bg-orange-500",
    handed_off: "bg-indigo-500",
    pending_review: "bg-amber-500",
  };

  return (
    <span
      className={cn("inline-block w-2 h-2 rounded-full", colors[status])}
      title={statusConfig[status]?.label || status}
    />
  );
}
