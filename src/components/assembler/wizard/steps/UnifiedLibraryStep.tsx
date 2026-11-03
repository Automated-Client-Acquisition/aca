import { useState } from "react";
import { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { LibraryStepTemplate } from "./LibraryStepTemplate";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Library, Sparkles, ChevronDown, ChevronUp, Lightbulb, ImageIcon, User, Plus, CheckCircle2 } from "lucide-react";
import { UnifiedAIInsightsEditor } from "../UnifiedAIInsightsEditor";
import { SelectedAiInsights, IdeaAiInsightsMap } from "@/types/wizard";
import { ManualIdeaRow } from "@/types/generation";
import { useIdeas } from "@/hooks/useIdeas";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";

interface UnifiedLibraryStepProps {
  blueprint: Blueprint;
  value: PinnedLibraryElements;
  onChange: (elements: PinnedLibraryElements) => void;
  ideaRows: ManualIdeaRow[];
  ideaAiInsights: IdeaAiInsightsMap;
  onIdeaAiInsightsChange: (ideaId: string, insights: SelectedAiInsights | null) => void;
}

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brands",
  library_characters: "People & Faces",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "Target Audiences",
  library_images: "Style & Composition",
};

export function UnifiedLibraryStep({
  blueprint,
  value,
  onChange,
  ideaRows,
  ideaAiInsights,
  onIdeaAiInsightsChange,
}: UnifiedLibraryStepProps) {
  const { ideas: dbIdeas } = useIdeas();
  const [expandedIdeaInsights, setExpandedIdeaInsights] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  // Parse required library types from blueprint (from both master_prompt and image_prompt)
  const parsedSlots = parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
  const librarySlots = parsedSlots.filter(
    slot => slot.type === 'library_element' && slot.library_table
  );

  // Include libraries from both prompt variables AND reference_image_libraries
  const referenceImageLibraries = blueprint.reference_image_libraries || [];
  const uniqueLibraryTables = Array.from(
    new Set([
      ...librarySlots.map(slot => slot.library_table!).filter(Boolean),
      ...referenceImageLibraries
    ])
  );

  const hasNoContent = uniqueLibraryTables.length === 0 && ideaRows.length === 0;
  const supportsFaceAndStyle = uniqueLibraryTables.includes('library_characters') && uniqueLibraryTables.includes('library_images');
  const hasSelectedFace = Object.values(value.library_characters?.elements || {}).some(
    (element) => (element.selected_images?.length || 0) > 0
  );
  const hasSelectedStyle = Object.values(value.library_images?.elements || {}).some(
    (element) => (element.selected_images?.length || 0) > 0
  );

  if (hasNoContent) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No ideas or library elements available for this configuration</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
          <Library className="h-8 w-8 text-primary" />
          Configure Generation
        </h1>
        <p className="text-muted-foreground text-lg">
          Select library elements and customize AI insights for your content
        </p>
      </div>

      {/* Ideas Section - Always show all ideas */}
      {ideaRows.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-cta" />
              Ideas ({ideaRows.length})
            </h2>
            <p className="text-sm text-muted-foreground">
              Your selected ideas for content generation
            </p>
          </div>

          <div className="space-y-3">
            {ideaRows.map((row) => {
              const dbIdea = dbIdeas?.find(idea => idea.id === row.id);
              const hasAiAnalysis = !!dbIdea?.ai_analysis;
              const isExpanded = expandedIdeaInsights[row.id] ?? false;
              const currentInsights = ideaAiInsights[row.id] || null;

              // Calculate variations info
              const hookVariations = currentInsights?.createVariations && currentInsights.selectedHookIndices?.length > 0;
              const tpVariations = currentInsights?.createTalkingPointVariations && currentInsights.selectedTalkingPointIndices?.length > 0;

              let variationText = '';
              if (hookVariations || tpVariations) {
                const parts = [];
                if (hookVariations) parts.push(`${currentInsights.selectedHookIndices.length} hook${currentInsights.selectedHookIndices.length !== 1 ? 's' : ''}`);
                if (tpVariations && currentInsights.talkingPointMode === 'separate') {
                  parts.push(`${currentInsights.selectedTalkingPointIndices.length} talking point${currentInsights.selectedTalkingPointIndices.length !== 1 ? 's' : ''}`);
                }
                variationText = parts.join(' × ');
              }

              // Get merged AI analysis
              const mergedAnalysis = (() => {
                const baseAnalysis = typeof dbIdea?.ai_analysis === 'string'
                  ? JSON.parse(dbIdea.ai_analysis)
                  : (dbIdea?.ai_analysis || {});
                return { ...baseAnalysis };
              })();

              return (
                <Card
                  key={row.id}
                  className={hasAiAnalysis ? "border-primary/20 dark:border-primary/30" : ""}
                >
                  <Collapsible
                    open={isExpanded}
                    onOpenChange={(open) => setExpandedIdeaInsights(prev => ({ ...prev, [row.id]: open }))}
                  >
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {hasAiAnalysis ? (
                              <Sparkles className="h-4 w-4 text-primary" />
                            ) : (
                              <Lightbulb className="h-4 w-4 text-cta" />
                            )}
                            <div>
                              <CardTitle className="text-base font-medium">
                                {dbIdea?.title || row.context.slice(0, 50)}
                              </CardTitle>
                              <CardDescription className="text-xs">
                                {variationText ? (
                                  <span className="text-primary">
                                    Creating variations: {variationText}
                                  </span>
                                ) : hasAiAnalysis ? (
                                  'Click to configure AI insights'
                                ) : (
                                  <span className="text-muted-foreground">
                                    Click to add hooks, talking points & CTAs
                                  </span>
                                )}
                              </CardDescription>
                            </div>
                          </div>
                          <Button variant="ghost" size="sm">
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </CardHeader>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <CardContent className="pt-0">
                        <UnifiedAIInsightsEditor
                          ideaId={row.id}
                          ideaTitle={dbIdea?.title || ''}
                          ideaContext={row.context}
                          aiAnalysis={mergedAnalysis}
                          keyTalkingPoints={undefined}
                          selectedInsights={currentInsights}
                          onInsightsChange={(insights) => onIdeaAiInsightsChange(row.id, insights)}
                          onAnalysisUpdated={() => {
                            queryClient.invalidateQueries({ queryKey: ['content-ideas'] });
                          }}
                        />
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Library Sections */}
      {uniqueLibraryTables.length > 0 && (
        <div className="space-y-8">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Library className="h-5 w-5" />
            Library Elements
          </h2>
          {supportsFaceAndStyle && (
            <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 text-primary">
                  <ImageIcon className="h-5 w-5" />
                  <Plus className="h-3.5 w-3.5" />
                  <User className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-medium">Combine a visual reference with your face</p>
                  <p className="text-xs text-muted-foreground">
                    Choose the look under Style & Composition and the identity under People & Faces. Both are sent together in one reference set.
                  </p>
                </div>
              </div>
              {hasSelectedFace && hasSelectedStyle && (
                <Badge variant="outline" className="w-fit gap-1 border-green-500/50 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Combined
                </Badge>
              )}
            </div>
          )}
          {uniqueLibraryTables.map((libraryTable) => {
            const slot = librarySlots.find(s => s.library_table === libraryTable);
            // Only required if it comes from a prompt variable (not just reference_image_libraries)
            const isFromPrompt = librarySlots.some(s => s.library_table === libraryTable);
            const isRequired = isFromPrompt && slot?.required !== false;
            const isReferenceImageOnly = !isFromPrompt && referenceImageLibraries.includes(libraryTable as any);

            return (
              <Card key={libraryTable} className="border-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Library className="h-5 w-5" />
                    {LIBRARY_TABLE_LABELS[libraryTable] || libraryTable}
                    {isRequired && (
                      <span className="text-sm font-normal text-muted-foreground">
                        (Required)
                      </span>
                    )}
                    {isReferenceImageOnly && (
                      <span className="text-sm font-normal text-muted-foreground">
                        (Reference Images)
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <LibraryStepTemplate
                    blueprint={blueprint}
                    libraryTable={libraryTable}
                    value={value}
                    onChange={onChange}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
