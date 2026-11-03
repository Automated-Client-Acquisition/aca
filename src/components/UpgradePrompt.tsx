import { useState } from "react";
import { Lock, Crown, ExternalLink, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FeatureName, FEATURE_LABELS } from "@/types/admin";
import { UPGRADE_URL, useFeatureAccess } from "@/hooks/useFeatureAccess";

interface UpgradePromptProps {
  feature: FeatureName;
  variant?: "inline" | "card" | "banner" | "overlay";
  className?: string;
  showDescription?: boolean;
}

/**
 * Displays an upgrade prompt for a gated feature
 * Explains that plans are tied to Skool community membership
 */
export function UpgradePrompt({
  feature,
  variant = "card",
  className,
  showDescription = true,
}: UpgradePromptProps) {
  const { label, description } = FEATURE_LABELS[feature];

  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
  };

  if (variant === "inline") {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Lock className="h-4 w-4" />
        <span>
          {label} requires a paid Skool membership.{" "}
          <button
            onClick={handleUpgrade}
            className="text-primary hover:underline font-medium inline-flex items-center gap-1"
          >
            Join the community <ExternalLink className="h-3 w-3" />
          </button>
        </span>
      </div>
    );
  }

  if (variant === "banner") {
    return (
      <div
        className={cn(
          "flex items-center justify-between gap-4 p-4 bg-pro-bg border border-pro-border rounded-lg dark:bg-pro-bg-dark dark:border-pro-border-dark",
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-full">
            <Crown className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-pro-text dark:text-pro-text-dark">{label} requires a paid membership</p>
            <p className="text-sm text-pro-text/80 dark:text-pro-text-dark/80">
              Upgrade your Skool community membership to unlock this feature
            </p>
          </div>
        </div>
        <Button variant="cta" onClick={handleUpgrade}>
          View Plans
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
      </div>
    );
  }

  if (variant === "overlay") {
    return (
      <div
        className={cn(
          "absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg",
          className
        )}
      >
        <div className="text-center p-6 max-w-sm">
          <div className="mx-auto w-12 h-12 bg-gradient-aca rounded-full flex items-center justify-center mb-4">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h3 className="font-semibold text-lg mb-2">{label}</h3>
          {showDescription && (
            <p className="text-sm text-muted-foreground mb-3">{description}</p>
          )}
          <Badge variant="outline" className="mb-3 border-pro-border text-pro-text bg-pro-bg dark:border-pro-border-dark dark:text-pro-text-dark dark:bg-pro-bg-dark">
            Paid Membership Feature
          </Badge>
          <div className="flex items-start gap-2 text-left p-3 bg-muted/50 rounded-lg mb-4">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Your plan is linked to your Skool community membership. Upgrade your membership to unlock Pro features.
            </p>
          </div>
          <Button variant="cta" onClick={handleUpgrade} className="w-full shadow-md">
            <Sparkles className="h-4 w-4 mr-2" />
            View Membership Plans
            <ExternalLink className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Default: card variant
  return (
    <Card className={cn("border-pro-border bg-pro-bg dark:border-pro-border-dark dark:bg-pro-bg-dark", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-primary/10 rounded-md">
            <Crown className="h-4 w-4 text-primary" />
          </div>
          <Badge variant="outline" className="border-pro-border text-pro-text bg-pro-bg dark:border-pro-border-dark dark:text-pro-text-dark dark:bg-pro-bg-dark">
            Paid Membership Feature
          </Badge>
        </div>
        <CardTitle className="text-lg">{label}</CardTitle>
        {showDescription && (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Your app plan is linked to your Skool community membership level. Upgrade your membership to unlock this feature.
          </p>
        </div>
        <Button variant="cta" onClick={handleUpgrade} className="w-full shadow-md">
          <Sparkles className="h-4 w-4 mr-2" />
          View Membership Plans
          <ExternalLink className="h-4 w-4 ml-2" />
        </Button>
      </CardContent>
    </Card>
  );
}

interface FeatureGateProps {
  feature: FeatureName;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** If true, shows children but with an overlay prompt */
  showPreview?: boolean;
}

/**
 * Wrapper component that gates content based on feature access
 */
export function FeatureGate({
  feature,
  children,
  fallback,
  showPreview = false,
}: FeatureGateProps) {
  const { hasFeature } = useFeatureAccess();

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  if (showPreview) {
    return (
      <div className="relative">
        <div className="opacity-50 pointer-events-none select-none">
          {children}
        </div>
        <UpgradePrompt feature={feature} variant="overlay" />
      </div>
    );
  }

  return fallback ?? <UpgradePrompt feature={feature} variant="card" />;
}

/**
 * Button that shows upgrade prompt when feature is not available
 */
interface UpgradeButtonProps {
  feature: FeatureName;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  disabled?: boolean;
}

export function FeatureButton({
  feature,
  children,
  onClick,
  className,
  variant = "default",
  size = "default",
  disabled,
}: UpgradeButtonProps) {
  const { hasFeature } = useFeatureAccess();
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

  const hasAccess = hasFeature(feature);
  const { label, description } = FEATURE_LABELS[feature];

  const handleClick = () => {
    if (hasAccess && onClick) {
      onClick();
    } else if (!hasAccess) {
      setShowUpgradeDialog(true);
    }
  };

  const handleUpgrade = () => {
    window.open(UPGRADE_URL, "_blank", "noopener,noreferrer");
    setShowUpgradeDialog(false);
  };

  return (
    <>
      <Button
        onClick={handleClick}
        className={cn(
          !hasAccess && "relative",
          className
        )}
        variant={variant}
        size={size}
        disabled={disabled}
      >
        {!hasAccess && <Lock className="h-4 w-4 mr-2" />}
        {children}
        {!hasAccess && (
          <Badge variant="outline" className="ml-2 text-xs py-0 px-1.5 border-pro-border text-pro-text bg-pro-bg dark:border-pro-border-dark dark:text-pro-text-dark dark:bg-pro-bg-dark">
            Pro
          </Badge>
        )}
      </Button>

      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto w-12 h-12 bg-gradient-aca rounded-full flex items-center justify-center mb-2">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <DialogTitle className="text-center">{label}</DialogTitle>
            <DialogDescription className="text-center">
              {description}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex items-start gap-3 p-4 bg-muted/50 rounded-lg">
              <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-medium">How to unlock this feature</p>
                <p className="text-sm text-muted-foreground">
                  Your ACA plan is linked to your Skool community membership level.
                  Upgrade to a paid membership in the Skool community to unlock Pro features.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowUpgradeDialog(false)}
              >
                Maybe Later
              </Button>
              <Button
                onClick={handleUpgrade}
                variant="cta"
                className="flex-1 shadow-md"
              >
                View Plans
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
