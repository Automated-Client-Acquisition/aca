import { useMemo } from "react";
import { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ImageIcon,
  User,
  Package,
  Palette,
  Target,
  Blocks,
  Edit2,
  Info,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  analyzeImageUsage,
  getImageUsageSummary,
  blueprintUsesImages,
  ImageUsageAnalysis,
} from "@/lib/imageUsageUtils";

interface VisualReferencesSectionProps {
  pinnedElements: PinnedLibraryElements;
  libraryData?: Record<string, any[]>;
  blueprint?: Blueprint;
  onEdit?: () => void;
  className?: string;
}

// Configuration for library types
const LIBRARY_CONFIG: Record<string, {
  icon: typeof User;
  label: string;
  singularLabel: string;
  imageField: string;
}> = {
  library_characters: {
    icon: User,
    label: "People & Faces",
    singularLabel: "Person / face",
    imageField: "reference_images"
  },
  library_products: {
    icon: Package,
    label: "Product Images",
    singularLabel: "Product",
    imageField: "images"
  },
  library_brand_voices: {
    icon: Palette,
    label: "Brand Visuals",
    singularLabel: "Brand",
    imageField: "reference_images"
  },
  library_icps: {
    icon: Target,
    label: "Audience References",
    singularLabel: "Audience",
    imageField: "reference_images"
  },
  library_blocks: {
    icon: Blocks,
    label: "Block Images",
    singularLabel: "Block",
    imageField: "images"
  },
  library_images: {
    icon: ImageIcon,
    label: "Style & Composition",
    singularLabel: "Style reference",
    imageField: "images"
  },
};

export function VisualReferencesSection({
  pinnedElements,
  libraryData,
  blueprint,
  onEdit,
  className,
}: VisualReferencesSectionProps) {
  // Analyze image usage based on blueprint
  const imageAnalysis = useMemo(() => {
    if (!blueprint) {
      // Fallback: collect images without analysis
      return null;
    }
    return analyzeImageUsage(blueprint, pinnedElements);
  }, [blueprint, pinnedElements]);

  const usageSummary = useMemo(() => {
    if (!imageAnalysis) return null;
    return getImageUsageSummary(imageAnalysis);
  }, [imageAnalysis]);

  // Fallback: collect images without blueprint analysis
  const getSelectedImagesLegacy = () => {
    const imagesByType: {
      table: string;
      config: typeof LIBRARY_CONFIG[string];
      images: string[];
      elementNames: string[];
    }[] = [];

    for (const [table, config] of Object.entries(pinnedElements)) {
      const tableConfig = LIBRARY_CONFIG[table];
      if (!tableConfig) continue;

      const images: string[] = [];
      const elementNames: string[] = [];

      for (const [elementId, elementConfig] of Object.entries(config.elements)) {
        const selectedImages = elementConfig.selected_images || [];
        images.push(...selectedImages);

        if (libraryData?.[table]) {
          const element = libraryData[table].find((e: any) => e.id === elementId);
          if (element) {
            elementNames.push(element.name || element.title || 'Unknown');
          }
        }
      }

      if (images.length > 0) {
        imagesByType.push({
          table,
          config: tableConfig,
          images,
          elementNames,
        });
      }
    }

    return imagesByType;
  };

  // Get element names for a table from libraryData
  const getElementNames = (table: string): string[] => {
    const config = pinnedElements[table];
    if (!config || !libraryData?.[table]) return [];

    const names: string[] = [];
    for (const elementId of Object.keys(config.elements)) {
      const element = libraryData[table].find((e: any) => e.id === elementId);
      if (element) {
        names.push(element.name || element.title || 'Unknown');
      }
    }
    return names;
  };

  // Use analysis if available, otherwise fallback
  const imagesByType = imageAnalysis || getSelectedImagesLegacy();
  const totalImages = imageAnalysis
    ? usageSummary?.totalImages || 0
    : (imagesByType as any[]).reduce((sum: number, t: any) => sum + t.images.length, 0);

  // Don't render if no images selected
  if (totalImages === 0) {
    return null;
  }

  const usesImages = blueprint ? blueprintUsesImages(blueprint) : true;

  return (
    <Card className={cn("border-2", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Visual References
            <Badge variant="secondary" className="ml-2">
              {totalImages} {totalImages === 1 ? 'image' : 'images'}
            </Badge>
          </CardTitle>
          {onEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit2 className="h-4 w-4 mr-1" />
              Edit
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Image groups with status */}
        {imageAnalysis ? (
          // New: Show with usage analysis
          imageAnalysis.map((analysis: ImageUsageAnalysis) => {
            const tableConfig = LIBRARY_CONFIG[analysis.table];
            if (!tableConfig) return null;

            const Icon = tableConfig.icon;
            const elementNames = getElementNames(analysis.table);

            return (
              <div key={analysis.table} className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{tableConfig.label}</span>
                  <Badge variant="secondary" className="text-xs">
                    {analysis.images.length}
                  </Badge>

                  {/* Status badge - informational only */}
                  {analysis.reason === 'blueprint_reference' ? (
                    <Badge variant="outline" className="text-xs border-green-500/50 text-green-700 dark:text-green-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      In blueprint
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs border-blue-500/50 text-blue-700 dark:text-blue-400 gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Selected
                    </Badge>
                  )}

                  {elementNames.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      from {elementNames.slice(0, 2).join(', ')}{elementNames.length > 2 ? ` +${elementNames.length - 2}` : ''}
                    </span>
                  )}
                </div>

                {/* Status explanation - only show for blueprint reference */}
                {analysis.reason === 'blueprint_reference' && analysis.referencedVariable && (
                  <p className="text-xs text-muted-foreground ml-6">
                    Also referenced in blueprint as <code className="bg-muted px-1 rounded">{analysis.referencedVariable}</code>
                  </p>
                )}

                {/* Image thumbnails */}
                <div className="flex flex-wrap gap-2 ml-6">
                  {analysis.images.slice(0, 6).map((url, idx) => (
                    <div
                      key={idx}
                      className="relative w-14 h-14 rounded-lg overflow-hidden border-2 border-border hover:border-primary/50 transition-colors"
                    >
                      <img
                        src={url}
                        alt={`Reference ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                  {analysis.images.length > 6 && (
                    <div className="w-14 h-14 rounded-lg bg-muted border-2 border-border flex items-center justify-center text-sm font-medium text-muted-foreground">
                      +{analysis.images.length - 6}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          // Legacy: Show without analysis
          (imagesByType as any[]).map(({ table, config, images, elementNames }) => {
            const Icon = config.icon;
            return (
              <div key={table} className="space-y-2">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{config.label}</span>
                  <Badge variant="secondary" className="text-xs">
                    {images.length}
                  </Badge>
                  {elementNames.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      from {elementNames.join(', ')}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {images.slice(0, 6).map((url: string, idx: number) => (
                    <div
                      key={idx}
                      className="relative w-16 h-16 rounded-lg overflow-hidden border-2 border-border hover:border-primary/50 transition-colors"
                    >
                      <img
                        src={url}
                        alt={`Reference ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ))}
                  {images.length > 6 && (
                    <div className="w-16 h-16 rounded-lg bg-muted border-2 border-border flex items-center justify-center text-sm font-medium text-muted-foreground">
                      +{images.length - 6}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* Info message */}
        {!usesImages && blueprint && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50 mt-4">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground">
              This blueprint ({blueprint.pipeline}) doesn't typically use reference images for generation.
            </p>
          </div>
        )}

        {usesImages && usageSummary && usageSummary.totalImages > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20 mt-4">
            <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-green-700 dark:text-green-400">
              Your {usageSummary.totalImages} selected reference{usageSummary.totalImages !== 1 ? 's' : ''} will be sent together. If a model limits the number of images, ACA balances the available slots across reference types so both face and style are represented.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
