import { Badge } from "@/components/ui/badge";
import { Play, Pause, CheckCircle, FileEdit } from "lucide-react";
import type { CampaignStatus } from "@/hooks/useCampaigns";

interface CampaignStatusBadgeProps {
  status: CampaignStatus;
  className?: string;
}

const STATUS_CONFIG: Record<
  CampaignStatus,
  {
    label: string;
    icon: typeof Play;
    className: string;
  }
> = {
  draft: {
    label: "Draft",
    icon: FileEdit,
    className: "border-border bg-muted/50 text-muted-foreground",
  },
  active: {
    label: "Active",
    icon: Play,
    className:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  paused: {
    label: "Paused",
    icon: Pause,
    className:
      "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle,
    className:
      "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
};

export function CampaignStatusBadge({
  status,
  className,
}: CampaignStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={`${config.className} ${className || ""} gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {config.label}
    </Badge>
  );
}
