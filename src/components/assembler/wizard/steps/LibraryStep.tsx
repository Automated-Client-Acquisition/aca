import { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Library, AlertCircle, CheckCircle2 } from "lucide-react";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { getPipelineLibraryNeeds } from "@/lib/pipelineUtils";
import { LibraryStepTemplate } from "./LibraryStepTemplate";

interface LibraryStepProps {
  blueprint: Blueprint;
  pinnedLibraryElements: PinnedLibraryElements;
  onLibraryElementsChange: (elements: PinnedLibraryElements) => void;
}

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brands",
  library_characters: "People & Faces",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "Target Audiences",
  library_images: "Style & Composition",
};

export function LibraryStep({
  blueprint,
  pinnedLibraryElements,
  onLibraryElementsChange,
}: LibraryStepProps) {
  // Parse required library types from blueprint (from prompts)
  const parsedSlots = parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
  const librarySlots = parsedSlots.filter(
    slot => slot.type === 'library_element' && slot.library_table
  );

  // Include libraries from prompt variables, reference_image_libraries, AND pipeline-level needs
  const referenceImageLibraries = blueprint.reference_image_libraries || [];
  const pipelineNeeds = getPipelineLibraryNeeds(blueprint.pipeline);
  const uniqueLibraryTables = Array.from(
    new Set([
      ...librarySlots.map(slot => slot.library_table!).filter(Boolean),
      ...referenceImageLibraries,
      ...pipelineNeeds.map(n => n.table),
    ])
  );

  // Check which library tables have selections
  const getSelectionStatus = (libraryTable: string) => {
    const slot = librarySlots.find(s => s.library_table === libraryTable);
    // Only required if it comes from a prompt variable (not just reference_image_libraries or pipeline needs)
    const isFromPrompt = librarySlots.some(s => s.library_table === libraryTable);
    const isPipelineNeed = pipelineNeeds.some(n => n.table === libraryTable) && !isFromPrompt;
    const isRequired = isFromPrompt && slot?.required !== false;
    const isReferenceImageOnly = !isFromPrompt && !isPipelineNeed && referenceImageLibraries.includes(libraryTable as any);
    const selection = pinnedLibraryElements[libraryTable];
    const count = selection?.elements ? Object.keys(selection.elements).length : 0;
    return { isRequired, count, hasSelection: count > 0, isReferenceImageOnly, isPipelineNeed };
  };

  // Count total selections and missing required
  const totalSelections = uniqueLibraryTables.reduce((sum, table) => {
    const { count } = getSelectionStatus(table);
    return sum + count;
  }, 0);

  const missingRequired = uniqueLibraryTables.filter(table => {
    const { isRequired, hasSelection } = getSelectionStatus(table);
    return isRequired && !hasSelection;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
          <Library className="h-8 w-8 text-primary" />
          Library Elements
        </h1>
        <p className="text-muted-foreground text-lg">
          Select library elements to use in your content generation. These will be combined with all your selected ideas.
        </p>
      </div>

      {/* Library Elements Sections */}
      <div className="space-y-8">
        {uniqueLibraryTables.map(libraryTable => {
          const { isRequired, count, hasSelection, isReferenceImageOnly, isPipelineNeed } = getSelectionStatus(libraryTable);
          const pipelineNeedReason = isPipelineNeed ? pipelineNeeds.find(n => n.table === libraryTable)?.reason : null;

          return (
            <Card key={libraryTable} className={hasSelection ? "border-primary/30" : isPipelineNeed && !hasSelection ? "border-amber-500/30" : ""}>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl flex items-center gap-2">
                    <Library className="h-5 w-5" />
                    {LIBRARY_TABLE_LABELS[libraryTable] || libraryTable}
                    {isReferenceImageOnly && (
                      <span className="text-sm font-normal text-muted-foreground">
                        (Reference Images)
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {isRequired && !hasSelection && (
                      <Badge variant="destructive">Required</Badge>
                    )}
                    {isPipelineNeed && !hasSelection && (
                      <Badge variant="outline" className="border-amber-500 text-amber-600">Recommended</Badge>
                    )}
                    {hasSelection && (
                      <Badge variant="default" className="bg-green-500">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {count} selected
                      </Badge>
                    )}
                  </div>
                </div>
                {pipelineNeedReason && (
                  <CardDescription className="text-amber-600 dark:text-amber-400">
                    {pipelineNeedReason}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <LibraryStepTemplate
                  blueprint={blueprint}
                  libraryTable={libraryTable}
                  value={pinnedLibraryElements}
                  onChange={onLibraryElementsChange}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
