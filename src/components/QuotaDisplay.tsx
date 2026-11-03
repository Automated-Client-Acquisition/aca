import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  Zap,
  TrendingUp,
  Infinity,
  Clock,
  Calendar,
} from "lucide-react";
import { formatLimit, isUnlimited, PLAN_TIERS, PlanTier } from "@/types/admin";
import { cn } from "@/lib/utils";

interface QuotaProgressProps {
  label: string;
  used: number;
  limit: number;
  icon: React.ReactNode;
  showWarning?: boolean;
}

function QuotaProgress({
  label,
  used,
  limit,
  icon,
  showWarning,
}: QuotaProgressProps) {
  const unlimited = isUnlimited(limit);
  const percentage = unlimited ? 0 : Math.min((used / limit) * 100, 100);
  const isOver = !unlimited && used >= limit;
  const isNear = !unlimited && percentage >= 80;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {isOver && showWarning && (
            <AlertTriangle className="w-4 h-4 text-destructive" />
          )}
          <span className={cn("font-medium", isOver && "text-destructive")}>
            {used.toLocaleString()}
            {!unlimited && (
              <span className="text-muted-foreground">
                {" "}
                / {formatLimit(limit)}
              </span>
            )}
            {unlimited && (
              <span className="text-muted-foreground flex items-center gap-1 ml-1">
                <Infinity className="w-3 h-3" />
              </span>
            )}
          </span>
        </div>
      </div>
      {!unlimited && (
        <Progress
          value={percentage}
          className={cn(
            "h-2",
            isOver && "[&>div]:bg-destructive",
            isNear && !isOver && "[&>div]:bg-yellow-500"
          )}
        />
      )}
    </div>
  );
}

interface QuotaDisplayProps {
  variant?: "compact" | "full";
  className?: string;
}

export function QuotaDisplay({ variant = "full", className }: QuotaDisplayProps) {
  const { data: quota, isLoading, error } = useOrganizationQuota();

  if (isLoading) {
    return (
      <div className={cn("space-y-3", className)}>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }

  if (error || !quota) {
    return null;
  }

  const planConfig = PLAN_TIERS[quota.planTier] ?? PLAN_TIERS.free;

  if (variant === "compact") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-default",
              quota.isAtDailyLimit || quota.isAtMonthlyLimit
                ? "border-destructive/50 bg-destructive/10"
                : quota.isNearDailyLimit || quota.isNearMonthlyLimit
                ? "border-yellow-500/50 bg-yellow-500/10"
                : "border-border bg-muted/30",
              className
            )}
          >
            <Zap className="w-4 h-4" />
            <span className="text-sm font-medium">
              {quota.usage.daily.generations}/{formatLimit(quota.limits.daily_generations)}
            </span>
            {(quota.isAtDailyLimit || quota.isAtMonthlyLimit) && (
              <AlertTriangle className="w-4 h-4 text-destructive" />
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-medium">Usage Today</p>
            <p className="text-sm text-muted-foreground">
              {quota.usage.daily.generations} of {formatLimit(quota.limits.daily_generations)} daily
              generations used
            </p>
            <p className="text-sm text-muted-foreground">
              {quota.usage.monthly.generations} of {formatLimit(quota.limits.monthly_generations)} monthly
              generations used
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Usage & Limits</CardTitle>
          <Badge variant="outline" className={planConfig.color}>
            {planConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <QuotaProgress
          label="Today"
          used={quota.usage.daily.generations}
          limit={quota.limits.daily_generations}
          icon={<Clock className="w-4 h-4" />}
          showWarning={quota.isAtDailyLimit}
        />
        <QuotaProgress
          label="This Month"
          used={quota.usage.monthly.generations}
          limit={quota.limits.monthly_generations}
          icon={<Calendar className="w-4 h-4" />}
          showWarning={quota.isAtMonthlyLimit}
        />

        {/* Show warning message if at limit */}
        {(quota.isAtDailyLimit || quota.isAtMonthlyLimit) && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Limit Reached</p>
              <p className="text-muted-foreground">
                {quota.isAtDailyLimit
                  ? "You've reached your daily generation limit."
                  : "You've reached your monthly generation limit."}
                {" "}Upgrade your plan for more.
              </p>
            </div>
          </div>
        )}

        {/* Show warning if near limit but not at it */}
        {!quota.isAtDailyLimit &&
          !quota.isAtMonthlyLimit &&
          (quota.isNearDailyLimit || quota.isNearMonthlyLimit) && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30">
              <TrendingUp className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-yellow-600">Approaching Limit</p>
                <p className="text-muted-foreground">
                  You're using most of your{" "}
                  {quota.isNearDailyLimit ? "daily" : "monthly"} quota.
                </p>
              </div>
            </div>
          )}

        {/* All time stats */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>All-time generations</span>
            <span className="font-medium">
              {quota.usage.all_time.generations.toLocaleString()}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Warning banner to show when quota is exceeded
 */
export function QuotaWarningBanner() {
  const { data: quota, isLoading } = useOrganizationQuota();

  if (isLoading || !quota) return null;
  if (!quota.isAtDailyLimit && !quota.isAtMonthlyLimit) return null;

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-destructive">
            {quota.isAtDailyLimit ? "Daily" : "Monthly"} Limit Reached
          </h4>
          <p className="text-sm text-muted-foreground mt-1">
            You've used all your{" "}
            {quota.isAtDailyLimit
              ? `${quota.limits.daily_generations} daily`
              : `${quota.limits.monthly_generations} monthly`}{" "}
            content generations.
            {quota.isAtDailyLimit
              ? " Your limit will reset at midnight UTC."
              : " Your limit will reset on the 1st of next month."}
          </p>
          <p className="text-sm mt-2">
            <a href="/settings?tab=billing" className="text-primary hover:underline">
              Upgrade your plan
            </a>{" "}
            for higher limits.
          </p>
        </div>
      </div>
    </div>
  );
}
