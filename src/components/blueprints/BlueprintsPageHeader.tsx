import { useState } from "react";
import { Layers, Sparkles, Lock, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateBlueprintDialog } from "./CreateBlueprintDialog";
import { BlueprintStarterPackDialog } from "./BlueprintStarterPackDialog";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";
import { ImportPostDialog } from "@/components/ideas/ImportPostDialog";

export function BlueprintsPageHeader() {
  const [starterPackOpen, setStarterPackOpen] = useState(false);
  const [fromPostOpen, setFromPostOpen] = useState(false);
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseStarterPacks = hasFeature("starter_packs");

  return (
    <div className="mb-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-aca flex items-center justify-center shadow-lg">
            <Layers className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-1">Blueprints</h1>
            <p className="text-muted-foreground">
              Create and manage reusable AI content generation templates
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setFromPostOpen(true)}>
            <Wand2 className="w-4 h-4 mr-2 text-primary" />
            From a post
          </Button>
          <Button
            variant="outline"
            onClick={
              canUseStarterPacks
                ? () => setStarterPackOpen(true)
                : () => window.open(UPGRADE_URL, "_blank")
            }
            className={
              canUseStarterPacks
                ? "border-cta/30 hover:bg-cta/10"
                : "border-amber-500/30 hover:bg-amber-500/10"
            }
          >
            {canUseStarterPacks ? (
              <Sparkles className="w-4 h-4 mr-2 text-cta" />
            ) : (
              <Lock className="w-4 h-4 mr-2 text-amber-500" />
            )}
            Starter Pack
          </Button>
          <CreateBlueprintDialog />
        </div>
      </div>

      <ImportPostDialog open={fromPostOpen} onOpenChange={setFromPostOpen} mode="blueprint" />
      <BlueprintStarterPackDialog
        open={starterPackOpen}
        onOpenChange={setStarterPackOpen}
      />
    </div>
  );
}
