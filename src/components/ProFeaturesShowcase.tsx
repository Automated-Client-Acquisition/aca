import {
  Crown,
  Zap,
  Send,
  Bookmark,
  Image,
  Bot,
  Building2,
  CheckCircle2,
  ExternalLink,
  TrendingUp,
  Clock,
  Infinity,
  ArrowRight,
  AlertTriangle,
  Megaphone,
  Mail,
  Magnet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { UPGRADE_URL } from "@/hooks/useFeatureAccess";
import { useOrganizationQuota } from "@/hooks/useOrganizationQuota";

const PRO_FEATURES = [
  {
    icon: Bot,
    title: "Autopilots",
    description: "Set up automated content pipelines that run on a schedule",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    icon: Send,
    title: "Auto-Publishing",
    description: "Publish directly to WordPress, LeadConnector, and more",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
  },
  {
    icon: Bookmark,
    title: "Prompt Library",
    description: "Save and reuse your best-performing prompts",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  {
    icon: Image,
    title: "Reference Libraries",
    description: "Organize reference images for consistent style",
    color: "text-pink-500",
    bgColor: "bg-pink-500/10",
  },
  {
    icon: Building2,
    title: "Agency Workspaces",
    description: "Manage multiple clients from one account",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  {
    icon: Zap,
    title: "Starter Packs",
    description: "Pre-built templates to jumpstart your content",
    color: "text-orange-500",
    bgColor: "bg-orange-500/10",
  },
  {
    icon: Megaphone,
    title: "LinkedIn Campaigns",
    description: "Automated outreach sequences with AI personalization",
    color: "text-blue-600",
    bgColor: "bg-blue-600/10",
  },
  {
    icon: Mail,
    title: "Email Campaigns",
    description: "Cold email sequences with warmup and deliverability",
    color: "text-purple-600",
    bgColor: "bg-purple-600/10",
  },
  {
    icon: Magnet,
    title: "Lead Magnets",
    description: "Automated lead capture from social comments",
    color: "text-cyan-600",
    bgColor: "bg-cyan-600/10",
  },
];

const LIMITS_COMPARISON = [
  {
    label: "Daily generations",
    free: "3",
    pro: "100",
    icon: Clock,
  },
  {
    label: "Monthly generations",
    free: "25",
    pro: "2,000",
    icon: TrendingUp,
  },
  {
    label: "Items per job",
    free: "3",
    pro: "50",
    icon: Zap,
  },
  {
    label: "Autopilots",
    free: "0",
    pro: "10",
    icon: Bot,
  },
];

interface ProFeaturesShowcaseProps {
  variant?: "banner" | "card" | "full";
  className?: string;
  /** Specific feature to highlight (for contextual upsells) */
  highlightFeature?: string;
}

/**
 * Showcase Pro features to encourage upgrades
 */
export function ProFeaturesShowcase({
  variant = "card",
  className,
  highlightFeature,
}: ProFeaturesShowcaseProps) {
  const { data: quota } = useOrganizationQuota();

  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  // Banner variant - compact horizontal strip
  if (variant === "banner") {
    return (
      <div
        className={cn(
          "bg-pro-bg border border-pro-border rounded-lg p-4 dark:bg-pro-bg-dark dark:border-pro-border-dark",
          className
        )}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-aca rounded-lg">
              <Crown className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="font-semibold text-pro-text dark:text-pro-text-dark">
                Unlock the full power of ACA
              </p>
              <p className="text-sm text-pro-text/80 dark:text-pro-text-dark/80">
                Autopilots, auto-publishing, 100 daily generations & more
              </p>
            </div>
          </div>
          <Button
            variant="cta"
            onClick={handleUpgrade}
            className="shadow-md"
          >
            Upgrade to Pro
            <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Card variant - medium size feature list
  if (variant === "card") {
    return (
      <Card className={cn("border-pro-border dark:border-pro-border-dark overflow-hidden", className)}>
        <div className="bg-gradient-aca px-6 py-4">
          <div className="flex items-center gap-3">
            <Crown className="h-6 w-6 text-white" />
            <div>
              <h3 className="text-lg font-bold text-white">Upgrade to Pro</h3>
              <p className="text-white/80 text-sm">
                Unlock automation & higher limits
              </p>
            </div>
          </div>
        </div>
        <CardContent className="p-6 space-y-4">
          {/* Usage context if available */}
          {quota && quota.planTier === "free" && (
            <div className="p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">
                You've used{" "}
                <span className="font-semibold text-foreground">
                  {quota.usage.daily.generations} of {quota.limits.daily_generations}
                </span>{" "}
                daily generations. Pro gives you{" "}
                <span className="font-semibold text-foreground">100/day</span>.
              </p>
            </div>
          )}

          {/* Key features */}
          <div className="space-y-3">
            {PRO_FEATURES.slice(0, 4).map((feature) => (
              <div key={feature.title} className="flex items-center gap-3">
                <div className={cn("p-1.5 rounded-md", feature.bgColor)}>
                  <feature.icon className={cn("h-4 w-4", feature.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{feature.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {feature.description}
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              </div>
            ))}
          </div>

          <Button
            variant="cta"
            onClick={handleUpgrade}
            className="w-full shadow-md"
          >
            View Pro Plans
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Full variant - comprehensive comparison
  return (
    <div className={cn("space-y-8", className)}>
      {/* Header */}
      <div className="text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-aca rounded-full text-white font-medium mb-4">
          <Crown className="h-5 w-5" />
          Upgrade to Pro
        </div>
        <h2 className="text-3xl font-bold mb-2">
          Unlock the Full Power of ACA
        </h2>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          Stop hitting limits. Start scaling your content production with automation,
          higher quotas, and powerful features.
        </p>
      </div>

      {/* Limits comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Usage Limits Comparison
          </CardTitle>
          <CardDescription>
            See how much more you can do with Pro
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground pb-2 border-b">
              <div>Feature</div>
              <div className="text-center">Starter (Free)</div>
              <div className="text-center text-primary">Pro</div>
            </div>
            {LIMITS_COMPARISON.map((item) => (
              <div key={item.label} className="grid grid-cols-3 gap-4 items-center">
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item.label}</span>
                </div>
                <div className="text-center">
                  <Badge variant="outline" className="bg-gray-50 dark:bg-muted">
                    {item.free}
                  </Badge>
                </div>
                <div className="text-center">
                  <Badge className="bg-gradient-aca text-white border-0">
                    {item.pro}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Features grid */}
      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Pro-Only Features
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PRO_FEATURES.map((feature) => (
            <Card
              key={feature.title}
              className={cn(
                "transition-all hover:shadow-md",
                highlightFeature === feature.title.toLowerCase() &&
                  "ring-2 ring-primary"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn("p-2 rounded-lg shrink-0", feature.bgColor)}>
                    <feature.icon className={cn("h-5 w-5", feature.color)} />
                  </div>
                  <div>
                    <h4 className="font-semibold">{feature.title}</h4>
                    <p className="text-sm text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Button
          variant="cta"
          onClick={handleUpgrade}
          size="lg"
          className="shadow-md px-8"
        >
          <Crown className="h-5 w-5 mr-2" />
          Upgrade to Pro Now
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
        <p className="text-sm text-muted-foreground mt-3">
          Plans are linked to your Skool community membership
        </p>
      </div>
    </div>
  );
}

/**
 * Contextual upgrade nudge - shows when user tries to use a Pro feature
 */
interface ContextualUpgradeNudgeProps {
  feature: string;
  action?: string;
  className?: string;
}

export function ContextualUpgradeNudge({
  feature,
  action = "use this feature",
  className,
}: ContextualUpgradeNudgeProps) {
  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 bg-pro-bg border border-pro-border rounded-lg dark:bg-pro-bg-dark dark:border-pro-border-dark",
        className
      )}
    >
      <div className="p-1.5 bg-primary/10 rounded-md">
        <Crown className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium text-pro-text dark:text-pro-text-dark">{feature}</span>{" "}
          <span className="text-pro-text/80 dark:text-pro-text-dark/80">
            requires a Pro plan to {action}.
          </span>
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={handleUpgrade}
        className="shrink-0 border-pro-border text-pro-text hover:bg-pro-bg dark:border-pro-border-dark dark:text-pro-text-dark dark:hover:bg-pro-bg-dark"
      >
        Upgrade
        <ExternalLink className="h-3 w-3 ml-1" />
      </Button>
    </div>
  );
}

/**
 * Discreet inline limit indicator - shows usage in a subtle way
 */
interface LimitWarningProps {
  limitType: "daily" | "monthly";
  current: number;
  max: number;
  className?: string;
}

export function LimitWarning({
  limitType,
  current,
  max,
  className,
}: LimitWarningProps) {
  // Don't show for unlimited plans (max === -1) or pro/enterprise
  if (max === -1) return null;

  const percentage = (current / max) * 100;
  const isAtLimit = current >= max;
  const isNearLimit = percentage >= 80;

  // Only show when at or near limit
  if (!isAtLimit && !isNearLimit) return null;

  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  // Compact inline badge style
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs",
        isAtLimit
          ? "bg-red-50 text-red-700 border border-red-200"
          : "bg-amber-50 text-amber-700 border border-amber-200",
        className
      )}
    >
      {isAtLimit ? (
        <Clock className="h-3 w-3" />
      ) : (
        <TrendingUp className="h-3 w-3" />
      )}
      <span>
        {isAtLimit ? (
          <>{limitType === "daily" ? "Daily" : "Monthly"} limit reached</>
        ) : (
          <>
            {current}/{max} {limitType}
          </>
        )}
      </span>
      <button
        onClick={handleUpgrade}
        className={cn(
          "font-medium hover:underline",
          isAtLimit ? "text-red-800" : "text-amber-800"
        )}
      >
        Upgrade
      </button>
    </div>
  );
}

/**
 * Shows how many times the user has hit their limits this month
 * Creates urgency by showing they're being blocked often
 */
interface LimitHitStatsProps {
  dailyHits: number;
  totalHits: number;
  className?: string;
}

export function LimitHitStats({
  dailyHits,
  totalHits,
  className,
}: LimitHitStatsProps) {
  // Only show if they've hit limits
  if (dailyHits === 0 && totalHits === 0) return null;

  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={cn(
        "bg-pro-bg border border-pro-border rounded-lg p-4 dark:bg-pro-bg-dark dark:border-pro-border-dark",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-gradient-aca rounded-lg">
          <AlertTriangle className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-pro-text dark:text-pro-text-dark">
            You've been blocked {dailyHits > 0 ? dailyHits : totalHits} time{(dailyHits || totalHits) !== 1 ? 's' : ''} this month
          </h4>
          <p className="text-sm text-pro-text/80 dark:text-pro-text-dark/80 mt-1">
            {dailyHits > 0 ? (
              <>You hit your daily limit <span className="font-semibold">{dailyHits}</span> times this month. </>
            ) : null}
            {totalHits > 0 ? (
              <>Total limit blocks: <span className="font-semibold">{totalHits}</span>. </>
            ) : null}
            Pro users get <span className="font-semibold">100 generations/day</span> vs your 3.
          </p>
          <div className="mt-3">
            <Button
              variant="cta"
              size="sm"
              onClick={handleUpgrade}
              className="shadow-md"
            >
              <Crown className="h-4 w-4 mr-1" />
              Stop hitting limits - Upgrade now
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
