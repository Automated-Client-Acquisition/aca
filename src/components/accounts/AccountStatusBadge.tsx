import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type AccountStatus = "active" | "expired" | "disconnected" | "error";

interface AccountStatusBadgeProps {
  status: AccountStatus;
  errorMessage?: string | null;
  className?: string;
}

const statusConfig: Record<
  AccountStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    className: string;
  }
> = {
  active: {
    label: "Available",
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  expired: {
    label: "Expired",
    icon: AlertCircle,
    className: "text-amber-600 bg-amber-50 border-amber-200",
  },
  disconnected: {
    label: "Disconnected",
    icon: XCircle,
    className: "text-red-600 bg-red-50 border-red-200",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    className: "text-red-600 bg-red-50 border-red-200",
  },
};

export function AccountStatusBadge({ status, errorMessage, className }: AccountStatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.error;
  const Icon = config.icon;

  const showTooltip = status !== "active" && errorMessage;

  const badge = (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
        showTooltip && "cursor-help",
        config.className,
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{config.label}</span>
    </div>
  );

  if (!showTooltip) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[300px]">
          <p className="text-xs">{errorMessage}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
