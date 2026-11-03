import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  Calendar,
  Zap,
  Users,
  Key,
  Bot,
  HardDrive,
  AlertTriangle,
  TrendingUp,
  Infinity,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { PLAN_TIERS, PLAN_LIMITS, PlanTier, formatLimit, isUnlimited } from "@/types/admin";
import { cn } from "@/lib/utils";
import { ProFeaturesShowcase, LimitHitStats } from "@/components/ProFeaturesShowcase";

interface LimitRowProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  suffix?: string;
}

function LimitRow({ label, value, icon, suffix = "" }: LimitRowProps) {
  const unlimited = isUnlimited(value);
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-medium flex items-center gap-1">
        {unlimited ? (
          <>
            Unlimited <Infinity className="w-4 h-4" />
          </>
        ) : (
          `${formatLimit(value)}${suffix}`
        )}
      </span>
    </div>
  );
}

interface UsageRowProps {
  label: string;
  used: number;
  limit: number;
  icon: React.ReactNode;
}

function UsageRow({ label, used, limit, icon }: UsageRowProps) {
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
          {isOver && <AlertTriangle className="w-4 h-4 text-destructive" />}
          <span className={cn("font-medium", isOver && "text-destructive")}>
            {used.toLocaleString()}
            {!unlimited && (
              <span className="text-muted-foreground"> / {formatLimit(limit)}</span>
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

interface FeatureRowProps {
  label: string;
  enabled: boolean;
}

function FeatureRow({ label, enabled }: FeatureRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-muted-foreground">{label}</span>
      {enabled ? (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      ) : (
        <XCircle className="w-4 h-4 text-muted-foreground/50" />
      )}
    </div>
  );
}

export default function PlansAndUsageSettings() {
  const { data: quota, isLoading, error } = useOrganizationQuota();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !quota) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">
            Unable to load plan information. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  const planConfig = PLAN_TIERS[quota.planTier] ?? PLAN_TIERS.free;
  const planLimits = PLAN_LIMITS[quota.planTier] ?? PLAN_LIMITS.free;

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5" />
                Current Plan
              </CardTitle>
              <CardDescription>Your organization's plan and subscription details</CardDescription>
            </div>
            <Badge variant="outline" className={cn("text-base px-4 py-1", planConfig.color)}>
              {planConfig.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{planConfig.description}</p>
        </CardContent>
      </Card>

      {/* Usage Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Usage
          </CardTitle>
          <CardDescription>Your content generation usage for the current period</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageRow
            label="Today"
            used={quota.usage.daily.generations}
            limit={quota.limits.daily_generations}
            icon={<Clock className="w-4 h-4" />}
          />
          <UsageRow
            label="This Month"
            used={quota.usage.monthly.generations}
            limit={quota.limits.monthly_generations}
            icon={<Calendar className="w-4 h-4" />}
          />

          {/* Warning messages */}
          {(quota.isAtDailyLimit || quota.isAtMonthlyLimit) && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Limit Reached</p>
                <p className="text-muted-foreground">
                  {quota.isAtDailyLimit
                    ? "You've reached your daily generation limit. Resets at midnight UTC."
                    : "You've reached your monthly generation limit. Resets on the 1st."}
                </p>
              </div>
            </div>
          )}

          {!quota.isAtDailyLimit &&
            !quota.isAtMonthlyLimit &&
            (quota.isNearDailyLimit || quota.isNearMonthlyLimit) && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/30">
                <TrendingUp className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-yellow-600">Approaching Limit</p>
                  <p className="text-muted-foreground">
                    You're using most of your {quota.isNearDailyLimit ? "daily" : "monthly"} quota.
                  </p>
                </div>
              </div>
            )}

          {/* All time stats */}
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">All-time generations</span>
              <span className="font-medium">{quota.usage.all_time.generations.toLocaleString()}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan Limits Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Plan Limits
          </CardTitle>
          <CardDescription>Resource limits included in your {planConfig.label} plan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <LimitRow
              label="Daily generations"
              value={planLimits.daily_generations}
              icon={<Clock className="w-4 h-4" />}
            />
            <LimitRow
              label="Monthly generations"
              value={planLimits.monthly_generations}
              icon={<Calendar className="w-4 h-4" />}
            />
            <LimitRow
              label="Team members"
              value={planLimits.max_team_members}
              icon={<Users className="w-4 h-4" />}
            />
            <LimitRow
              label="API keys"
              value={planLimits.max_api_keys}
              icon={<Key className="w-4 h-4" />}
            />
            <LimitRow
              label="Autopilots"
              value={planLimits.max_autopilots}
              icon={<Bot className="w-4 h-4" />}
            />
            <LimitRow
              label="Storage"
              value={planLimits.storage_gb}
              icon={<HardDrive className="w-4 h-4" />}
              suffix=" GB"
            />
          </div>
        </CardContent>
      </Card>

      {/* Features Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            Features
          </CardTitle>
          <CardDescription>Features available on your {planConfig.label} plan</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <FeatureRow label="Starter Packs" enabled={planLimits.features.starter_packs} />
            <FeatureRow label="Prompt Library" enabled={planLimits.features.prompt_library} />
            <FeatureRow label="Autopilots" enabled={planLimits.features.autopilots} />
            <FeatureRow label="WordPress Publishing" enabled={planLimits.features.publishing} />
            <FeatureRow label="Social Publishing" enabled={planLimits.features.push_to_ghl} />
            <FeatureRow label="Reference Libraries" enabled={planLimits.features.reference_libraries} />
            <FeatureRow label="Agency Workspaces" enabled={planLimits.features.workspaces} />
          </div>
        </CardContent>
      </Card>

      {/* Limit Hit Stats - Show if user has been blocked */}
      {quota.planTier === "free" && quota.limitHits && (
        <LimitHitStats
          dailyHits={quota.limitHits.daily_hits}
          totalHits={quota.limitHits.total_hits}
        />
      )}

      {/* Full Pro Features Showcase for Free Users */}
      {quota.planTier === "free" && (
        <ProFeaturesShowcase variant="full" />
      )}
    </div>
  );
}
