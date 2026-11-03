import { Package, Sparkles, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";

interface AssetsHeaderProps {
  onStarterPackClick?: () => void;
}

export function AssetsHeader({ onStarterPackClick }: AssetsHeaderProps) {
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseStarterPacks = hasFeature("starter_packs");
  // Only show upgrade prompts for non-client organizations
  const showLockedState = !canUseStarterPacks && showUpgradePrompts;

  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-4">
        <div className="w-14 h-14 shrink-0 rounded-2xl bg-gradient-aca flex items-center justify-center shadow-lg">
          <Package className="w-7 h-7 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-bold text-foreground mb-1">Brand Kit</h1>
          <p className="text-muted-foreground">
            Who you are, who you write for and what you sell. Set it once; everything you make writes with it.
          </p>
        </div>
      </div>

      {/* Starter pack: enabled if has access, locked with upgrade for non-clients, hidden for clients without access */}
      {onStarterPackClick && (canUseStarterPacks || showLockedState) && (
        <Button
          variant="outline"
          onClick={canUseStarterPacks ? onStarterPackClick : () => window.open(UPGRADE_URL, "_blank")}
          className={`shrink-0 self-start ${canUseStarterPacks ? "border-primary/30 hover:bg-primary/10" : "border-cta/30 hover:bg-cta/10"}`}
        >
          {canUseStarterPacks ? (
            <Sparkles className="w-4 h-4 mr-2 text-primary" />
          ) : (
            <Lock className="w-4 h-4 mr-2 text-cta" />
          )}
          Starter Pack
          {showLockedState && (
            <Badge variant="outline" className="ml-2 text-xs py-0 px-1.5 border-cta/50 text-cta bg-cta/10">
              Pro
            </Badge>
          )}
        </Button>
      )}
    </div>
  );
}
