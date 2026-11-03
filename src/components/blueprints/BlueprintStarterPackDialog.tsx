import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Linkedin,
  Instagram,
  Video,
  FileText,
  Film,
  Image,
  Shuffle,
  MonitorPlay,
  Clapperboard,
  ChevronRight,
  Clock,
  Play,
  Gift,
  ArrowRight,
  Loader2,
} from "lucide-react";
import {
  starterPackByCategory,
  allStarterPackBlueprints,
  type StarterPackBlueprint,
} from "@/data/starterPackBlueprints";
import { PIPELINES } from "@/types/pipeline";
import { useBlueprints, useCreateBlueprint } from "@/hooks/useBlueprints";
import { cn } from "@/lib/utils";

/** Categories whose blueprints ALL use a coming_soon pipeline */
const COMING_SOON_CATEGORIES = new Set(
  (Object.keys(starterPackByCategory) as CategoryKey[]).filter((key) => {
    const cat = starterPackByCategory[key];
    return cat.blueprints.length > 0 && cat.blueprints.every((bp) => {
      const pipeline = PIPELINES.find((p) => p.id === bp.pipeline);
      return pipeline?.status === 'coming_soon';
    });
  })
);

interface BlueprintStarterPackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CategoryKey = keyof typeof starterPackByCategory;

const categoryIcons: Record<string, typeof Linkedin> = {
  linkedin: Linkedin,
  instagram: Instagram,
  twitter: Sparkles,
  video: Video,
  clapperboard: Clapperboard,
  "file-text": FileText,
  film: Film,
  image: Image,
  shuffle: Shuffle,
  "monitor-play": MonitorPlay,
};

const categoryColors: Record<CategoryKey, { color: string; bgColor: string; borderColor: string }> = {
  linkedin: {
    color: "text-blue-600",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
  },
  instagram: {
    color: "text-pink-600",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
  },
  blog: {
    color: "text-green-600",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  image_only: {
    color: "text-cyan-600",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
  },
  video: {
    color: "text-indigo-600",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
  },
  twitter: {
    color: "text-sky-500",
    bgColor: "bg-sky-500/10",
    borderColor: "border-sky-500/30",
  },
};

function generateUniqueName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let counter = 2;
  let uniqueName = `${baseName} (${counter})`;
  while (existingNames.has(uniqueName)) {
    counter++;
    uniqueName = `${baseName} (${counter})`;
  }
  return uniqueName;
}

export function BlueprintStarterPackDialog({
  open,
  onOpenChange,
}: BlueprintStarterPackDialogProps) {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(null);
  const [savingBlueprintId, setSavingBlueprintId] = useState<string | null>(null);
  const { data: existingBlueprints } = useBlueprints();
  const createBlueprint = useCreateBlueprint();

  const totalBlueprints = allStarterPackBlueprints.length;

  const existingNames = new Set(existingBlueprints?.map(b => b.name) ?? []);

  const handleUseBlueprint = async (blueprint: StarterPackBlueprint) => {
    setSavingBlueprintId(blueprint.id);

    try {
      // Generate a unique name to avoid duplicate key constraint violation
      const uniqueName = generateUniqueName(blueprint.name, existingNames);

      // Convert StarterPackBlueprint to CreateBlueprintInput and save to database
      const created = await createBlueprint.mutateAsync({
        name: uniqueName,
        description: blueprint.description,
        pipeline: blueprint.pipeline,
        master_prompt: blueprint.master_prompt,
        image_prompt: blueprint.image_prompt,
        director_prompt: blueprint.director_prompt,
        structure: blueprint.structure,
        model_config: blueprint.model_config,
        tags: [...blueprint.tags, 'starter-pack'],
      });

      onOpenChange(false);
      // Open it in the Studio so the user sees a preview before running it.
      navigate(`/blueprints/${created.id}`);
    } catch (error) {
      // Error is already handled by the mutation's onError
      console.error('Failed to save blueprint:', error);
    } finally {
      setSavingBlueprintId(null);
    }
  };

  // Render the detail view for a category
  if (activeCategory) {
    const cat = starterPackByCategory[activeCategory];
    const colors = categoryColors[activeCategory];
    const Icon = categoryIcons[cat.icon] || FileText;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl flex flex-col max-h-[85vh] overflow-hidden p-0">
          {/* Header with gradient */}
          <div className={cn("shrink-0 px-6 pt-6 pb-4", colors.bgColor)}>
            <button
              onClick={() => setActiveCategory(null)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3 transition-colors"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              Back to categories
            </button>
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  colors.bgColor,
                  "border-2",
                  colors.borderColor
                )}
              >
                <Icon className={cn("w-6 h-6", colors.color)} />
              </div>
              <div>
                <DialogTitle className="text-xl">{cat.name}</DialogTitle>
                <DialogDescription className="mt-0.5">
                  {cat.blueprints.length} templates available
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* Blueprints list */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="p-4 space-y-3">
              {cat.blueprints.map((blueprint) => {
                const isSaving = savingBlueprintId === blueprint.id;
                return (
                  <Card
                    key={blueprint.id}
                    className={cn(
                      "transition-all hover:shadow-md hover:border-primary/30 group",
                      isSaving ? "opacity-70 pointer-events-none" : "cursor-pointer"
                    )}
                    onClick={() => !isSaving && handleUseBlueprint(blueprint)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={cn(
                            "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                            colors.bgColor,
                            "border",
                            colors.borderColor
                          )}
                        >
                          {isSaving ? (
                            <Loader2 className={cn("w-4 h-4 animate-spin", colors.color)} />
                          ) : (
                            <Play className={cn("w-4 h-4", colors.color)} />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">{blueprint.name}</h3>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs capitalize",
                                blueprint.difficulty === "beginner"
                                  ? "bg-green-500/10 text-green-600 border-green-500/30"
                                  : "bg-amber-500/10 text-amber-600 border-amber-500/30"
                              )}
                            >
                              {blueprint.difficulty}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">
                            {blueprint.description}
                          </p>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {blueprint.estimated_time}
                            </span>
                            <span className="flex items-center gap-1">
                              {blueprint.structure.slots.filter((s) => s.required).length}{" "}
                              required input
                              {blueprint.structure.slots.filter((s) => s.required).length !== 1
                                ? "s"
                                : ""}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="cta"
                          size="sm"
                          disabled={isSaving}
                          className={cn(
                            "shrink-0 transition-opacity",
                            isSaving ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          )}
                        >
                          {isSaving ? (
                            <>
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                              Adding...
                            </>
                          ) : (
                            <>
                              Add to Blueprints
                              <ArrowRight className="w-3 h-3 ml-1" />
                            </>
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background">
            <Button variant="outline" onClick={() => setActiveCategory(null)}>
              Back to Categories
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Main category selection view
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* Hero header */}
        <div className="relative shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <div className="absolute top-4 right-4">
            <Badge className="bg-gradient-aca text-white border-0 gap-1">
              <Gift className="w-3 h-3" />
              {totalBlueprints} Templates
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-aca flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">Blueprint Starter Pack</DialogTitle>
              <DialogDescription className="mt-0.5">
                Pre-configured templates with best-in-class AI models
              </DialogDescription>
            </div>
          </div>
        </div>

        {/* Category cards */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-6 py-4">
            <p className="text-xs font-medium text-muted-foreground mb-3">
              Choose a category to get started:
            </p>
            <div className="space-y-2">
              {(Object.keys(starterPackByCategory) as CategoryKey[]).map((key) => {
                const cat = starterPackByCategory[key];
                const colors = categoryColors[key];
                const Icon = categoryIcons[cat.icon] || FileText;
                const isComingSoon = COMING_SOON_CATEGORIES.has(key);

                return (
                  <Card
                    key={key}
                    className={cn(
                      "transition-all group border",
                      isComingSoon
                        ? "opacity-60 cursor-not-allowed"
                        : "cursor-pointer hover:shadow-md hover:border-primary/30"
                    )}
                    onClick={isComingSoon ? undefined : () => setActiveCategory(key)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center gap-4">
                        <div
                          className={cn(
                            "w-11 h-11 rounded-lg flex items-center justify-center transition-colors",
                            colors.bgColor,
                            "border",
                            colors.borderColor
                          )}
                        >
                          <Icon className={cn("w-5 h-5", colors.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{cat.name}</h3>
                            {isComingSoon ? (
                              <Badge variant="secondary" className="text-xs h-5">
                                Coming Soon
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs h-5">
                                {cat.blueprints.length}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{cat.description}</p>
                        </div>
                        <ChevronRight className={cn(
                          "w-5 h-5 text-muted-foreground transition-all",
                          !isComingSoon && "group-hover:text-foreground group-hover:translate-x-0.5"
                        )} />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t bg-muted/30 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Click a category to browse templates
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
