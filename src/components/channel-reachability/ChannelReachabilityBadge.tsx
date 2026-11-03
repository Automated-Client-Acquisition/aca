import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Linkedin,
  Mail,
  Phone,
  MessageCircle,
  Instagram,
  Twitter,
  BarChart3,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { LeadListChannelStats } from "@/hooks/useLeadListChannelStats";
import { cn } from "@/lib/utils";

interface ChannelConfig {
  key: keyof Pick<
    LeadListChannelStats,
    | "linkedin_pct"
    | "email_pct"
    | "phone_pct"
    | "whatsapp_pct"
    | "instagram_pct"
    | "twitter_pct"
  >;
  countKey: keyof Pick<
    LeadListChannelStats,
    | "has_linkedin"
    | "has_email"
    | "has_phone"
    | "has_whatsapp"
    | "has_instagram"
    | "has_twitter"
  >;
  label: string;
  icon: LucideIcon;
  color: string;
}

const CHANNEL_CONFIGS: ChannelConfig[] = [
  {
    key: "linkedin_pct",
    countKey: "has_linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    color: "text-[#0A66C2]",
  },
  {
    key: "email_pct",
    countKey: "has_email",
    label: "Email",
    icon: Mail,
    color: "text-red-500",
  },
  {
    key: "phone_pct",
    countKey: "has_phone",
    label: "Phone",
    icon: Phone,
    color: "text-green-500",
  },
];

function getPercentageColor(percentage: number): string {
  if (percentage >= 70) return "text-green-600 dark:text-green-400";
  if (percentage >= 30) return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground";
}

interface ChannelReachabilityBadgeProps {
  stats: LeadListChannelStats;
  /**
   * Which channels to display (defaults to all)
   */
  channels?: Array<"linkedin" | "email" | "phone" | "whatsapp" | "instagram" | "twitter">;
  /**
   * Compact mode shows only icons with percentage
   */
  compact?: boolean;
  /**
   * Only show channels with non-zero coverage
   */
  hideEmpty?: boolean;
  className?: string;
}

/**
 * Displays channel coverage badges for a lead list
 *
 * Example: LinkedIn 95% | Email 45% | Phone 12%
 */
export function ChannelReachabilityBadge({
  stats,
  channels,
  compact = false,
  hideEmpty = false,
  className,
}: ChannelReachabilityBadgeProps) {
  const channelsToShow = channels
    ? CHANNEL_CONFIGS.filter((c) =>
        channels.includes(
          c.key.replace("_pct", "") as "linkedin" | "email" | "phone" | "whatsapp" | "instagram" | "twitter"
        )
      )
    : CHANNEL_CONFIGS;

  const filteredChannels = hideEmpty
    ? channelsToShow.filter((c) => (stats[c.key] as number) > 0)
    : channelsToShow;

  return (
    <TooltipProvider>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {filteredChannels.map((channel) => {
          const percentage = stats[channel.key] as number;
          const count = stats[channel.countKey] as number;
          const Icon = channel.icon;

          return (
            <Tooltip key={channel.key}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="cursor-default bg-background"
                >
                  <Icon className={cn("h-3 w-3", compact ? "" : "mr-1", channel.color)} />
                  {!compact && <span className="mr-1">{channel.label}</span>}
                  <span className={cn("font-medium", getPercentageColor(percentage))}>
                    {Math.round(percentage)}%
                  </span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <div className="text-sm">
                  <p className="font-medium">
                    {count} of {stats.total_leads} leads have {channel.label}
                  </p>
                  <p className="text-muted-foreground">
                    {percentage >= 70
                      ? "Good coverage"
                      : percentage >= 30
                        ? "Moderate coverage"
                        : "Low coverage - consider enrichment"}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

interface ChannelStatsCardProps {
  stats?: LeadListChannelStats;
  className?: string;
  isLoading?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  title?: string;
  description?: string;
}

/**
 * Full channel stats card with progress bars
 */
export function ChannelStatsCard({
  stats,
  className,
  isLoading = false,
  onRefresh,
  isRefreshing = false,
  title = "Channel Availability",
  description = "Contact data availability by channel",
}: ChannelStatsCardProps) {
  // Loading state
  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{title}</CardTitle>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-2 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  // No stats yet - offer to compute
  if (!stats) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">{title}</CardTitle>
            </div>
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <p className="text-sm text-muted-foreground mb-3">
              No channel stats available yet
            </p>
            {onRefresh && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                <Sparkles className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
                {isRefreshing ? "Computing..." : "Compute Stats"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Full stats display
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
            </Button>
          )}
        </div>
        <CardDescription>
          {description} • {stats.total_leads} total leads
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {CHANNEL_CONFIGS.map((channel) => {
          const percentage = stats[channel.key] as number;
          const count = stats[channel.countKey] as number;
          const Icon = channel.icon;

          return (
            <div key={channel.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <Icon className={cn("h-4 w-4", channel.color)} />
                  <span>{channel.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {count} / {stats.total_leads}
                  </span>
                  <span className={cn("font-medium", getPercentageColor(percentage))}>
                    {Math.round(percentage)}%
                  </span>
                </div>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    percentage >= 70
                      ? "bg-green-500"
                      : percentage >= 30
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  )}
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/**
 * Minimal inline stats display
 */
export function ChannelStatsInline({
  stats,
  channels = ["linkedin", "email", "phone"],
  className,
}: {
  stats: LeadListChannelStats;
  channels?: Array<"linkedin" | "email" | "phone" | "whatsapp" | "instagram" | "twitter">;
  className?: string;
}) {
  const channelsToShow = CHANNEL_CONFIGS.filter((c) =>
    channels.includes(
      c.key.replace("_pct", "") as "linkedin" | "email" | "phone" | "whatsapp" | "instagram" | "twitter"
    )
  );

  return (
    <div className={cn("flex items-center gap-3 text-sm", className)}>
      {channelsToShow.map((channel, idx) => {
        const percentage = stats[channel.key] as number;
        const Icon = channel.icon;

        return (
          <div key={channel.key} className="flex items-center gap-1">
            {idx > 0 && <span className="text-muted-foreground">|</span>}
            <Icon className={cn("h-3.5 w-3.5 ml-1", channel.color)} />
            <span className={getPercentageColor(percentage)}>
              {Math.round(percentage)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
