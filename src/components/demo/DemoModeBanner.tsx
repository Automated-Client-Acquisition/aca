import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { AlertTriangle, ArrowRight, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface DemoModeBannerProps {
  className?: string;
}

export function DemoModeBanner({ className }: DemoModeBannerProps) {
  const navigate = useNavigate();
  const { isComplete, isLoading, missingItems } = useSetupStatus();
  const { isCompleted: onboardingCompleted, isLoading: onboardingLoading } = useOnboardingState();
  const [isDismissed, setIsDismissed] = useState(false);

  // Don't show if setup is complete, loading, dismissed, or onboarding not yet completed.
  // (Trial users still need to connect OpenRouter / Replicate / Cloud Storage to
  // actually run their pipeline - the BYOK keys are mandatory for the system.)
  if (isComplete || isLoading || isDismissed || !onboardingCompleted || onboardingLoading) {
    return null;
  }

  const missingLabels = missingItems.map((item) => item.label).join(", ");

  return (
    <div
      className={cn(
        "bg-amber-500/10 border-b border-amber-500/20 px-4 py-2",
        className
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Connect your AI key to unlock your workspace
            {missingLabels ? (
              <span className="text-xs ml-2">· missing: {missingLabels}</span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
            onClick={() => navigate("/settings?tab=integrations")}
          >
            Complete Setup
            <ArrowRight className="h-3.5 w-3.5 ml-1" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
