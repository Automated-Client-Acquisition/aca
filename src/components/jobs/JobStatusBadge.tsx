import { Badge } from "@/components/ui/badge";
import { Clock, Eye, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: string;
  className?: string;
  label?: string;
}

export function JobStatusBadge({ status, className, label }: JobStatusBadgeProps) {
  const statusConfig = {
    queued: {
      label: "Queued",
      icon: Clock,
      variant: "secondary" as const,
      className: "bg-secondary text-secondary-foreground",
      animated: false,
    },
    processing: {
      label: "Processing",
      icon: null,
      variant: "default" as const,
      className: "bg-primary text-primary-foreground",
      animated: false,
    },
    review: {
      label: "Needs your OK",
      icon: Eye,
      variant: "outline" as const,
      className: "bg-accent text-accent-foreground border-accent",
      animated: false,
    },
    completed: {
      label: "Completed",
      icon: CheckCircle2,
      variant: "outline" as const,
      className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
      animated: false,
    },
    failed: {
      label: "Failed",
      icon: XCircle,
      variant: "destructive" as const,
      className: "bg-destructive/10 text-destructive border-destructive/20",
      animated: false,
    },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.queued;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={cn(config.className, className)}>
      {Icon && (
        <Icon
          className={cn(
            "h-3 w-3 mr-1",
            config.animated && "animate-spin"
          )}
        />
      )}
      {label || config.label}
    </Badge>
  );
}
