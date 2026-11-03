import { useState } from "react";
import { PinnedLibraryElements } from "@/types/blueprint";
import { ManualIdeaRow } from "@/types/generation";
import { IdeaAiInsightsMap } from "@/types/wizard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  User,
  Package,
  Palette,
  Target,
  Blocks,
  ChevronDown,
  ChevronUp,
  Minus,
  ImageIcon,
  Calculator
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SelectionSummaryCardProps {
  pinnedElements: PinnedLibraryElements;
  ideaRows: ManualIdeaRow[];
  ideaAiInsights: IdeaAiInsightsMap;
  libraryData?: Record<string, any[]>; // Optional: pre-fetched library data for names/images
  className?: string;
  sticky?: boolean;
}

// Icons and labels for library types
const LIBRARY_CONFIG: Record<string, { icon: typeof User; label: string; singularLabel: string; role: string }> = {
  library_characters: {
    icon: User,
    label: "People & Faces",
    singularLabel: "Person / face",
    role: "Controls identity and facial likeness"
  },
  library_products: {
    icon: Package,
    label: "Products",
    singularLabel: "Product",
    role: "Featured product in your content"
  },
  library_brand_voices: {
    icon: Palette,
    label: "Brands",
    singularLabel: "Brand",
    role: "Defines tone and communication style"
  },
  library_icps: {
    icon: Target,
    label: "Audiences",
    singularLabel: "Audience",
    role: "Target audience context"
  },
  library_blocks: {
    icon: Blocks,
    label: "Blocks",
    singularLabel: "Block",
    role: "Reusable content elements"
  },
  library_images: {
    icon: ImageIcon,
    label: "Style & Composition",
    singularLabel: "Style reference",
    role: "Controls layout, pose, lighting, and mood"
  },
};

export function SelectionSummaryCard({
  pinnedElements,
  ideaRows,
  ideaAiInsights,
  libraryData,
  className,
  sticky = true,
}: SelectionSummaryCardProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [showCombinations, setShowCombinations] = useState(false);

  // Calculate total variations
  const calculateTotalVariations = () => {
    // Start with base idea count, accounting for hook variations
    let baseCount = 0;
    ideaRows.forEach(row => {
      const insights = ideaAiInsights[row.id];
      if (insights?.createVariations && insights.selectedHookIndices.length > 0) {
        baseCount += insights.selectedHookIndices.length;
      } else {
        baseCount += 1;
      }
    });

    // Multiply by library elements in "separate" mode
    let multiplier = 1;
    const separateElements: { table: string; count: number }[] = [];

    for (const [table, config] of Object.entries(pinnedElements)) {
      const elementCount = Object.keys(config.elements).length;
      if (elementCount > 0 && config.combination_mode === 'separate') {
        multiplier *= elementCount;
        separateElements.push({ table, count: elementCount });
      }
    }

    return {
      total: baseCount * multiplier,
      baseCount,
      multiplier,
      separateElements
    };
  };

  // Get selected elements summary
  const getSelectedSummary = () => {
    const summary: {
      table: string;
      config: typeof LIBRARY_CONFIG[string];
      count: number;
      imageCount: number;
      mode: 'combine' | 'separate';
      elementIds: string[];
    }[] = [];

    for (const [table, config] of Object.entries(pinnedElements)) {
      const elementIds = Object.keys(config.elements);
      if (elementIds.length === 0) continue;

      // Count total selected images across all elements
      let imageCount = 0;
      for (const elementId of elementIds) {
        imageCount += config.elements[elementId]?.selected_images?.length || 0;
      }

      const tableConfig = LIBRARY_CONFIG[table] || {
        icon: Blocks,
        label: table.replace('library_', '').replace('_', ' '),
        singularLabel: table.replace('library_', '').replace('_', ' '),
        role: 'Library element'
      };

      summary.push({
        table,
        config: tableConfig,
        count: elementIds.length,
        imageCount,
        mode: config.combination_mode,
        elementIds,
      });
    }

    return summary;
  };

  const { total, baseCount, separateElements } = calculateTotalVariations();
  const selectedSummary = getSelectedSummary();
  const hasSelections = selectedSummary.length > 0;
  const totalImages = selectedSummary.reduce((sum, s) => sum + s.imageCount, 0);

  // Don't render if no selections
  if (!hasSelections && ideaRows.length === 0) {
    return null;
  }

  // Build formula string
  const buildFormulaString = () => {
    const parts: string[] = [];

    if (baseCount > 0) {
      parts.push(`${baseCount} idea${baseCount !== 1 ? 's' : ''}`);
    }

    separateElements.forEach(({ table, count }) => {
      const config = LIBRARY_CONFIG[table];
      const label = config?.label.toLowerCase() || table;
      parts.push(`${count} ${label}`);
    });

    return parts.join(' × ');
  };

  return (
    <Card
      className={cn(
        "border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent transition-all",
        sticky && "sticky top-4 z-10",
        isMinimized && "py-2",
        className
      )}
    >
      <CardContent className={cn("pt-4", isMinimized && "pt-2 pb-2")}>
        {/* Minimized View */}
        {isMinimized ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-muted-foreground">
                Your Content Elements
              </span>
              <div className="flex items-center gap-2">
                {selectedSummary.map(({ table, config: tableConfig, count }) => {
                  const Icon = tableConfig.icon;
                  return (
                    <Badge key={table} variant="secondary" className="gap-1">
                      <Icon className="h-3 w-3" />
                      {count}
                    </Badge>
                  );
                })}
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20">
                {total} output{total !== 1 ? 's' : ''}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(false)}
              className="h-7 px-2"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          /* Expanded View */
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                Your Content Elements
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsMinimized(true)}
                className="h-7 px-2 text-muted-foreground"
              >
                <Minus className="h-4 w-4" />
              </Button>
            </div>

            {/* Selected Elements Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {selectedSummary.map(({ table, config: tableConfig, count, imageCount, mode }) => {
                const Icon = tableConfig.icon;
                return (
                  <div
                    key={table}
                    className="flex items-start gap-2 p-2 rounded-lg bg-background/50 border"
                  >
                    <div className="p-1.5 rounded-md bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">
                        {count} {count === 1 ? tableConfig.singularLabel : tableConfig.label}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {imageCount > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <ImageIcon className="h-3 w-3" />
                            {imageCount}
                          </span>
                        )}
                        {mode === 'separate' && count > 1 && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                            ×{count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Empty state for when nothing is selected yet */}
              {selectedSummary.length === 0 && (
                <div className="col-span-full text-center py-4 text-muted-foreground text-sm">
                  Select library elements to see them here
                </div>
              )}
            </div>

            {/* Divider */}
            {hasSelections && (
              <div className="border-t pt-3">
                {/* Output Calculation */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {buildFormulaString()}
                    </span>
                  </div>
                  <Badge className="bg-primary text-primary-foreground">
                    = {total} output{total !== 1 ? 's' : ''}
                  </Badge>
                </div>

                {/* Reference Images Summary */}
                {totalImages > 0 && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <ImageIcon className="h-3.5 w-3.5" />
                    {totalImages} reference image{totalImages !== 1 ? 's' : ''} selected for visual consistency
                  </div>
                )}

                {/* See All Combinations */}
                {total > 1 && separateElements.length > 0 && (
                  <Collapsible open={showCombinations} onOpenChange={setShowCombinations}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full mt-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {showCombinations ? (
                          <>
                            <ChevronUp className="h-3 w-3 mr-1" />
                            Hide combinations
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 mr-1" />
                            See all {total} combinations
                          </>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 p-3 rounded-lg bg-muted/50 max-h-48 overflow-y-auto">
                        <div className="space-y-1 text-xs">
                          {/* Generate combination preview - simplified version */}
                          {ideaRows.slice(0, 3).map((idea, ideaIndex) => (
                            <div key={idea.id} className="py-1 border-b border-border/50 last:border-0">
                              <div className="font-medium">
                                {idea.title || idea.context}
                              </div>
                              {separateElements.length > 0 && (
                                <div className="text-muted-foreground mt-0.5">
                                  × {separateElements.map(s =>
                                    `${s.count} ${LIBRARY_CONFIG[s.table]?.label.toLowerCase() || s.table}`
                                  ).join(' × ')}
                                </div>
                              )}
                            </div>
                          ))}
                          {ideaRows.length > 3 && (
                            <div className="text-muted-foreground pt-1">
                              + {ideaRows.length - 3} more ideas...
                            </div>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
