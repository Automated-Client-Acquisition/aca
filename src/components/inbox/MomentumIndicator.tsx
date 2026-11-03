import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Minus, Snowflake, TrendingDown, TrendingUp } from "lucide-react";

type MomentumTrend = 'rising' | 'stable' | 'falling' | 'cold';

interface MomentumIndicatorProps {
  score: number;
  trend: MomentumTrend;
  compact?: boolean;
  className?: string;
}

const trendConfig: Record<
  MomentumTrend,
  {
    icon: React.ElementType;
    iconColor: string;
    label: string;
    bgColor: string;
  }
> = {
  rising: {
    icon: TrendingUp,
    iconColor: "text-green-500",
    label: "Rising",
    bgColor: "bg-green-100 dark:bg-green-950/40",
  },
  stable: {
    icon: Minus,
    iconColor: "text-muted-foreground",
    label: "Stable",
    bgColor: "bg-amber-100 dark:bg-amber-950/40",
  },
  falling: {
    icon: TrendingDown,
    iconColor: "text-red-500",
    label: "Falling",
    bgColor: "bg-red-100 dark:bg-red-950/40",
  },
  cold: {
    icon: Snowflake,
    iconColor: "text-blue-400",
    label: "Cold",
    bgColor: "bg-gray-100 dark:bg-gray-800/40",
  },
};

export function MomentumIndicator({
  score,
  trend,
  compact = false,
  className,
}: MomentumIndicatorProps) {
  const config = trendConfig[trend];
  const Icon = config.icon;

  // Compact mode: small icon with tooltip
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn("inline-flex items-center", className)}>
            <Icon className={cn("h-3 w-3", config.iconColor)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Momentum: {score}/100 ({trend})
        </TooltipContent>
      </Tooltip>
    );
  }

  // Full mode: score + icon + label
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1",
        config.bgColor,
        className
      )}
    >
      <span className={cn("text-xs font-semibold", config.iconColor)}>
        {score}
      </span>
      <Icon className={cn("h-3.5 w-3.5", config.iconColor)} />
      <span className={cn("text-xs font-medium", config.iconColor)}>
        {config.label}
      </span>
    </div>
  );
}
