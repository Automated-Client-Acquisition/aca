import { useMemo } from "react";
import {
  Users,
  MessageSquare,
  Reply,
  CheckCircle,
  TrendingUp,
  BarChart3,
  Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { type LeadStats } from "@/hooks/leads/useLeadsSync";
import { type UnipileCampaign } from "@/hooks/useUnipileCampaigns";

interface LeadsAnalyticsProps {
  stats: LeadStats | undefined;
  campaigns: UnipileCampaign[];
  isLoading: boolean;
}

export function LeadsAnalytics({ stats, campaigns, isLoading }: LeadsAnalyticsProps) {
  // Calculate conversion funnel
  const funnel = useMemo(() => {
    if (!stats) return null;

    const total = stats.total_leads || 0;
    const dmSent = stats.by_status?.dm_sent ?? 0;
    const replied = stats.by_status?.replied ?? 0;
    const converted = stats.by_status?.converted ?? 0;

    return {
      captured: { value: total, percent: 100 },
      dmSent: {
        value: dmSent,
        percent: total > 0 ? Math.round((dmSent / total) * 100) : 0,
      },
      replied: {
        value: replied,
        percent: total > 0 ? Math.round((replied / total) * 100) : 0,
      },
      converted: {
        value: converted,
        percent: total > 0 ? Math.round((converted / total) * 100) : 0,
      },
    };
  }, [stats]);

  // Calculate campaign performance
  const campaignPerformance = useMemo(() => {
    if (!stats?.by_campaign) return [];

    return stats.by_campaign
      .map((cp) => {
        const campaign = campaigns.find((c) => c.id === cp.campaign_id);
        return {
          ...cp,
          campaign_name: cp.campaign_name || campaign?.name || 'Unknown Campaign',
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [stats, campaigns]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[...Array(4)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!stats || stats.total_leads === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[400px] border rounded-lg bg-muted/10">
        <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="font-medium text-lg">No Data Yet</h3>
        <p className="text-muted-foreground mt-1 text-center max-w-md">
          Start capturing leads to see analytics about your campaign performance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Total Leads"
          value={stats.total_leads}
          icon={Users}
          color="text-blue-600"
          bgColor="bg-blue-100"
        />
        <MetricCard
          title="Connected"
          value={stats.synced_count}
          icon={CheckCircle}
          color="text-green-600"
          bgColor="bg-green-100"
          subtext={`${Math.round((stats.synced_count / stats.total_leads) * 100)}% of leads`}
        />
        <MetricCard
          title="Reply Rate"
          value={`${funnel?.replied.percent ?? 0}%`}
          icon={Reply}
          color="text-primary"
          bgColor="bg-primary/10"
          subtext={`${stats.by_status?.replied ?? 0} replies`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversion Funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Conversion Funnel
            </CardTitle>
            <CardDescription>
              Lead progression through your pipeline stages
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {funnel && (
                <>
                  <FunnelStep
                    label="Leads Captured"
                    value={funnel.captured.value}
                    percent={funnel.captured.percent}
                    color="bg-blue-500"
                  />
                  <FunnelStep
                    label="DM Sent"
                    value={funnel.dmSent.value}
                    percent={funnel.dmSent.percent}
                    color="bg-green-500"
                  />
                  <FunnelStep
                    label="Replied"
                    value={funnel.replied.value}
                    percent={funnel.replied.percent}
                    color="bg-primary"
                  />
                  <FunnelStep
                    label="Converted"
                    value={funnel.converted.value}
                    percent={funnel.converted.percent}
                    color="bg-[hsl(var(--status-warning))]"
                  />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Campaign Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Top Campaigns
            </CardTitle>
            <CardDescription>
              Campaigns ranked by leads captured
            </CardDescription>
          </CardHeader>
          <CardContent>
            {campaignPerformance.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No campaign data available
              </p>
            ) : (
              <div className="space-y-4">
                {campaignPerformance.map((cp, idx) => (
                  <div
                    key={cp.campaign_id}
                    className="flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "w-6 h-6 p-0 flex items-center justify-center text-xs font-bold",
                          idx === 0 && "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30 text-[hsl(var(--status-warning))]",
                          idx === 1 && "bg-gray-100 border-gray-300 text-gray-700",
                          idx === 2 && "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30 text-[hsl(var(--status-warning))]"
                        )}
                      >
                        {idx + 1}
                      </Badge>
                      <span className="font-medium truncate">
                        {cp.campaign_name}
                      </span>
                    </div>
                    <Badge variant="secondary" className="flex-shrink-0">
                      {cp.count} leads
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Status Breakdown
          </CardTitle>
          <CardDescription>
            Distribution of leads by current status
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <StatusCard
              label="Pending"
              value={stats.by_status?.pending ?? 0}
              total={stats.total_leads}
              color="bg-[hsl(var(--status-warning))]"
            />
            <StatusCard
              label="Awaiting"
              value={stats.by_status?.awaiting_connection ?? 0}
              total={stats.total_leads}
              color="bg-[hsl(var(--status-warning))]"
            />
            <StatusCard
              label="DM Sent"
              value={stats.by_status?.dm_sent ?? 0}
              total={stats.total_leads}
              color="bg-green-500"
            />
            <StatusCard
              label="Failed"
              value={stats.by_status?.dm_failed ?? 0}
              total={stats.total_leads}
              color="bg-red-500"
            />
            <StatusCard
              label="Replied"
              value={stats.by_status?.replied ?? 0}
              total={stats.total_leads}
              color="bg-blue-500"
            />
            <StatusCard
              label="Converted"
              value={stats.by_status?.converted ?? 0}
              total={stats.total_leads}
              color="bg-primary"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bgColor: string;
  subtext?: string;
}

function MetricCard({ title, value, icon: Icon, color, bgColor, subtext }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground font-medium">
            {title}
          </span>
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", bgColor)}>
            <Icon className={cn("h-4 w-4", color)} />
          </div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-3xl font-bold", color)}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </span>
          {subtext && (
            <span className="text-sm text-muted-foreground">{subtext}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface FunnelStepProps {
  label: string;
  value: number;
  percent: number;
  color: string;
}

function FunnelStep({ label, value, percent, color }: FunnelStepProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value.toLocaleString()} ({percent}%)
        </span>
      </div>
      <Progress value={percent} className="h-3" indicatorClassName={color} />
    </div>
  );
}

interface StatusCardProps {
  label: string;
  value: number;
  total: number;
  color: string;
}

function StatusCard({ label, value, total, color }: StatusCardProps) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="p-3 rounded-lg border bg-muted/20">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-3 h-3 rounded-full", color)} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value}</span>
        <span className="text-xs text-muted-foreground">({percent}%)</span>
      </div>
    </div>
  );
}
