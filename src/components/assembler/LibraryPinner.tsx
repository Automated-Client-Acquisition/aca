import { useMemo } from "react";
import { Blueprint, PinnedLibraryElements, NestedPathSelection, LibraryElementType } from "@/types/blueprint";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useBrandVoices } from "@/hooks/useBrandVoices";
import { useCharacters } from "@/hooks/useCharacters";
import { useBlocks } from "@/hooks/useBlocks";
import { useProducts } from "@/hooks/useProducts";
import { useICPs } from "@/hooks/useICPs";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { CheckCircle2, AlertCircle, ChevronRight, Sparkles } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NestedDataSelector } from "./NestedDataSelector";

interface LibraryPinnerProps {
  blueprint: Blueprint;
  value: PinnedLibraryElements;
  onChange: (value: PinnedLibraryElements) => void;
}

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brands",
  library_characters: "Characters",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "ICPs",
};

const SHORTHAND_REVERSE_MAP: Record<LibraryElementType, string> = {
  'library_brand_voices': 'brand',
  'library_characters': 'character',
  'library_blocks': 'block',
  'library_products': 'product',
  'library_icps': 'icp',
};

export function LibraryPinner({ blueprint, value, onChange }: LibraryPinnerProps) {
  // Parse slots to detect which library elements are needed (from both master_prompt and image_prompt)
  const slots = useMemo(() => {
    return parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
  }, [blueprint.master_prompt, blueprint.image_prompt, blueprint.director_prompt]);

  // Get REQUIRED library tables from slots
  const requiredLibraryTables = useMemo(() => {
    const tables = new Set<LibraryElementType>();
    slots.forEach(slot => {
      // Only include if library_table exists AND slot is required
      if (slot.library_table && slot.required !== false) {
        tables.add(slot.library_table as LibraryElementType);
      }
    });
    return Array.from(tables);
  }, [slots]);

  // Fetch library data
  const { brandVoices, isLoading: loadingBrandVoices } = useBrandVoices();
  const { characters, isLoading: loadingCharacters } = useCharacters();
  const { blocks, isLoading: loadingBlocks } = useBlocks();
  const { products, isLoading: loadingProducts } = useProducts();
  const { icps, isLoading: loadingICPs } = useICPs();

  // Get data for a specific library table
  const getLibraryData = (libraryTable: LibraryElementType): any[] => {
    switch (libraryTable) {
      case 'library_brand_voices':
        return brandVoices || [];
      case 'library_characters':
        return characters || [];
      case 'library_blocks':
        return blocks || [];
      case 'library_products':
        return products || [];
      case 'library_icps':
        return icps || [];
      default:
        return [];
    }
  };

  // Check if library is loading
  const isLoadingLibrary = (libraryTable: LibraryElementType): boolean => {
    switch (libraryTable) {
      case 'library_brand_voices':
        return loadingBrandVoices;
      case 'library_characters':
        return loadingCharacters;
      case 'library_blocks':
        return loadingBlocks;
      case 'library_products':
        return loadingProducts;
      case 'library_icps':
        return loadingICPs;
      default:
        return false;
    }
  };

  // Get first image URL from item
  const getItemImageUrl = (item: any): string | null => {
    if (item.reference_images && Array.isArray(item.reference_images) && item.reference_images.length > 0) {
      return item.reference_images[0];
    }
    if (item.images) {
      if (Array.isArray(item.images) && item.images.length > 0) {
        return item.images[0];
      }
      if (typeof item.images === 'object') {
        const imageArrays = Object.values(item.images).filter(Array.isArray);
        if (imageArrays.length > 0 && (imageArrays[0] as any[]).length > 0) {
          return (imageArrays[0] as any[])[0];
        }
      }
    }
    return null;
  };

  // Get image count from item
  const getImageCount = (item: any): number => {
    if (item.reference_images && Array.isArray(item.reference_images)) {
      return item.reference_images.length;
    }
    if (item.images) {
      if (Array.isArray(item.images)) {
        return item.images.length;
      }
      if (typeof item.images === 'object') {
        const imageArrays = Object.values(item.images).filter(Array.isArray);
        return imageArrays.reduce((sum, arr) => sum + (arr as any[]).length, 0);
      }
    }
    return 0;
  };

  // Get nested data preview with business-friendly labels
  const getNestedDataPreview = (item: any): string => {
    const previews: string[] = [];
    
    if (item.icp) {
      if (Array.isArray(item.icp.demographics)) {
        previews.push(`${item.icp.demographics.length} target demographics`);
      }
      if (Array.isArray(item.icp.painPoints)) {
        previews.push(`${item.icp.painPoints.length} pain points`);
      }
      if (Array.isArray(item.icp.psychographics)) {
        previews.push(`${item.icp.psychographics.length} psychographic profiles`);
      }
    }
    
    if (item.marketing_angles) {
      if (Array.isArray(item.marketing_angles.hooks)) {
        previews.push(`${item.marketing_angles.hooks.length} marketing hooks`);
      }
      if (Array.isArray(item.marketing_angles.frameworks)) {
        previews.push(`${item.marketing_angles.frameworks.length} content frameworks`);
      }
    }
    
    if (item.tone) previews.push(`Tone: ${item.tone}`);
    if (item.description) previews.push(`${item.description.substring(0, 50)}...`);
    if (item.category) previews.push(`Category: ${item.category}`);
    if (item.price) previews.push(`Price: ${item.price}`);
    
    return previews.length > 0 ? previews.join(' • ') : 'No preview available';
  };

  // Check if essential data is complete
  const isDataComplete = (item: any): boolean => {
    if (!item) return false;
    if (!item.name) return false;
    
    const hasContent = 
      item.description || 
      item.tone || 
      item.icp || 
      item.marketing_angles ||
      item.features ||
      item.category;
    
    return !!hasContent;
  };

  // Get referenced paths in prompt for a specific library table
  const getReferencedPaths = (libraryTable: LibraryElementType): string[] => {
    const shorthandMap: Record<string, LibraryElementType | string> = {
      'product': 'library_products',
      'brand': 'library_brand_voices',
      'brand_voice': 'library_brand_voices', // Legacy alias
      'character': 'library_characters',
      'block': 'library_blocks',
      'icp': 'library_icps',
      'identity': 'library_identities',
    };

    const reverseMap: Record<LibraryElementType, string> = {} as Record<LibraryElementType, string>;
    Object.entries(shorthandMap).forEach(([short, full]) => {
      reverseMap[full] = short;
    });

    const shorthand = reverseMap[libraryTable];
    const regex = new RegExp(`\\{\\{(?:${shorthand}|${libraryTable})\\.([^}]+)\\}\\}`, 'gi');
    const matches = [...(blueprint.master_prompt || '').matchAll(regex)];
    
    // Return unique paths only (dedupe)
    return Array.from(new Set(matches.map(m => m[1].trim())));
  };

  // Handle checkbox toggle
  const handleToggle = (libraryTable: LibraryElementType, itemId: string, checked: boolean) => {
    const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
    const currentElements = currentLibrary.elements || {};
    const newElements = { ...currentElements };
    
    if (checked) {
      const referencedPaths = getReferencedPaths(libraryTable);
      const defaultPaths: NestedPathSelection = {};
      referencedPaths.forEach(path => {
        defaultPaths[path] = { included: true }; // Simplified: all fields included by default
      });
      newElements[itemId] = { paths: defaultPaths };
    } else {
      delete newElements[itemId];
    }
    
    onChange({
      ...value,
      [libraryTable]: {
        ...currentLibrary,
        elements: newElements,
      },
    });
  };

  // Select all items in a library table
  const handleSelectAll = (libraryTable: LibraryElementType) => {
    const data = getLibraryData(libraryTable) || [];
    const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
    const referencedPaths = getReferencedPaths(libraryTable);
    const newElements: Record<string, { paths: NestedPathSelection }> = {};
    
    data.forEach((item: any) => {
      const defaultPaths: NestedPathSelection = {};
      referencedPaths.forEach(path => {
        defaultPaths[path] = { included: true }; // Simplified: all fields included by default
      });
      newElements[item.id] = { paths: defaultPaths };
    });
    
    onChange({
      ...value,
      [libraryTable]: {
        ...currentLibrary,
        elements: newElements,
      },
    });
  };

  // Clear all selections in a library table
  const handleClearAll = (libraryTable: LibraryElementType) => {
    const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
    onChange({
      ...value,
      [libraryTable]: {
        ...currentLibrary,
        elements: {},
      },
    });
  };

  // Handle nested path selection
  const handlePathChange = (
    libraryTable: LibraryElementType, 
    itemId: string, 
    path: string, 
    included: boolean // Simplified: just included boolean
  ) => {
    const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
    const currentElements = currentLibrary.elements || {};
    const currentItem = currentElements[itemId] || { paths: {} };
    
    onChange({
      ...value,
      [libraryTable]: {
        ...currentLibrary,
        elements: {
          ...currentElements,
          [itemId]: {
            ...currentItem,
            paths: {
              ...currentItem.paths,
              [path]: { included },
            },
          },
        },
      },
    });
  };

  // Handle combination mode change
  const handleCombinationModeChange = (libraryTable: LibraryElementType, mode: 'combine' | 'separate') => {
    const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
    onChange({
      ...value,
      [libraryTable]: {
        ...currentLibrary,
        combination_mode: mode,
      },
    });
  };

  // Helper to calculate multiplication factor from nested paths
  const calculateNestedMultiplier = (paths: Record<string, any>): number => {
    if (!paths || Object.keys(paths).length === 0) return 1;
    
    let multiplier = 1;
    
    Object.values(paths).forEach((config: any) => {
      const indices = Array.isArray(config.indices) ? config.indices : [config.indices];
      const mode = config.combination_mode || 'separate';
      
      if (mode === 'separate' && indices.length > 0) {
        multiplier *= indices.length;
      }
      // combine mode doesn't multiply (stays as 1)
    });
    
    return multiplier;
  };

  // Calculate total generation count across all libraries (variations per idea)
  const totalGenerationCount = useMemo(() => {
    let libraryMultiplier = 1;

    requiredLibraryTables.forEach((libraryTable) => {
      const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
      const elements = currentLibrary.elements || {};
      const elementIds = Object.keys(elements);
      const mode = currentLibrary.combination_mode || 'separate';

      if (elementIds.length > 0) {
        if (mode === 'separate') {
          let tableMultiplier = 0;
          elementIds.forEach(elementId => {
            const paths = elements[elementId]?.paths || {};
            const nestedMultiplier = calculateNestedMultiplier(paths);
            tableMultiplier += nestedMultiplier;
          });
          libraryMultiplier *= tableMultiplier;
        }
        // combine mode stays as 1
      }
    });

    return libraryMultiplier;
  }, [requiredLibraryTables, value]);

  if (requiredLibraryTables.length === 0) {
    return (
      <Card className="p-8 text-center text-muted-foreground">
        <p>No required library elements for this blueprint.</p>
        <p className="text-sm mt-2">The master prompt doesn't require any library elements.</p>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Blueprint Requirements Header */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Blueprint Requirements
          </h2>
          <p className="text-sm text-muted-foreground">
            This blueprint needs the following data sources to create personalized content. Selecting more options creates more variations.
          </p>
        </div>
        {requiredLibraryTables.map((libraryTable) => {
          const label = LIBRARY_TABLE_LABELS[libraryTable] || libraryTable;
          const items = getLibraryData(libraryTable);
          const isLoading = isLoadingLibrary(libraryTable);
          const currentLibrary = value[libraryTable] || { combination_mode: 'separate', elements: {} };
          const selectedItems = currentLibrary.elements || {};
          const selectedCount = Object.keys(selectedItems).length;
          const combinationMode = currentLibrary.combination_mode || 'separate';
          const referencedPaths = getReferencedPaths(libraryTable);

          return (
            <Card key={libraryTable} className="p-4">
              <div className="mb-4">
                {/* Used in Prompt Context */}
                {referencedPaths.length > 0 && (
                  <div className="mb-4 p-2.5 rounded-md bg-muted/30 border border-border/50">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      Used in prompt:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {referencedPaths.map(path => (
                        <Badge 
                          key={path} 
                          variant="outline" 
                          className="font-mono text-xs px-2 py-0.5"
                        >
                          {`{{${SHORTHAND_REVERSE_MAP[libraryTable]}.${path}}}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <h3 className="font-semibold text-base">{label}</h3>
                    {selectedCount > 0 ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {selectedCount} selected
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        None selected • Required
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {items.length > 0 && (
                      <>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => handleSelectAll(libraryTable)}
                        >
                          Select All
                        </Button>
                        {selectedCount > 0 && (
                          <Button 
                            size="sm" 
                            variant="ghost"
                            onClick={() => handleClearAll(libraryTable)}
                          >
                            Clear
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Combination Mode Selection */}
              {selectedCount > 0 && (
                <div className="space-y-2 mb-4 p-3 rounded-md bg-muted/30 border border-border/50">
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="radio"
                      name={`mode-${libraryTable}`}
                      checked={combinationMode === 'combine'}
                      onChange={() => handleCombinationModeChange(libraryTable, 'combine')}
                      className="mt-0.5 h-4 w-4 text-primary cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm group-hover:text-primary transition-colors">
                        Mix all together
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Combine all {selectedCount} {label.toLowerCase()} in each output
                      </div>
                    </div>
                  </label>
                  
                  <label className="flex items-start gap-2.5 cursor-pointer group">
                    <input
                      type="radio"
                      name={`mode-${libraryTable}`}
                      checked={combinationMode === 'separate'}
                      onChange={() => handleCombinationModeChange(libraryTable, 'separate')}
                      className="mt-0.5 h-4 w-4 text-primary cursor-pointer"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm group-hover:text-primary transition-colors">
                        Create separate versions
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Generate a unique output for each {label.toLowerCase().replace(/s$/, '')}
                      </div>
                    </div>
                  </label>
                </div>
              )}

              <div className="space-y-2">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-12 w-full" />
                  ))
                ) : items.length === 0 ? (
                  <div className="text-sm p-4 text-center border border-dashed rounded-lg bg-muted/20">
                    <p className="font-medium text-foreground mb-1">
                      No {label.toLowerCase()} found
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Go to the Assets page to create {label.toLowerCase()} first, then return here to select them.
                    </p>
                    <Button 
                      size="sm" 
                      variant="outline"
                      asChild
                    >
                      <a href="/assets">Go to Assets</a>
                    </Button>
                  </div>
                ) : (
                  items.map((item) => {
                    const isSelected = item.id in selectedItems;
                    const isComplete = isDataComplete(item);
                    const preview = getNestedDataPreview(item);
                    const imageUrl = getItemImageUrl(item);
                    const imageCount = getImageCount(item);

                    return (
                      <div key={item.id} className="space-y-0">
                        <div className="flex items-center space-x-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
                          {imageUrl && (
                            <div className="relative flex-shrink-0">
                              <img 
                                src={imageUrl} 
                                alt={item.name}
                                className="w-12 h-12 object-cover rounded border border-border"
                              />
                              {imageCount > 1 && (
                                <Badge 
                                  variant="secondary" 
                                  className="absolute -top-2 -right-2 h-5 px-1.5 text-xs"
                                >
                                  {imageCount}
                                </Badge>
                              )}
                            </div>
                          )}
                          
                          <Checkbox
                            id={`pin-${item.id}`}
                            checked={isSelected}
                            onCheckedChange={(checked) => handleToggle(libraryTable, item.id, checked as boolean)}
                          />
                          <label
                            htmlFor={`pin-${item.id}`}
                            className="flex-1 text-sm font-medium cursor-pointer flex items-center gap-2"
                          >
                            <span>{item.name}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1">
                                  {isComplete ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-yellow-600" />
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-sm">
                                <div className="space-y-2">
                                  <p className="font-medium">{item.name}</p>
                                  {imageUrl && (
                                    <img 
                                      src={imageUrl} 
                                      alt={item.name}
                                      className="w-full max-w-xs rounded border border-border"
                                    />
                                  )}
                                  <p className="text-xs text-muted-foreground">{preview}</p>
                                  {!isComplete && (
                                    <p className="text-xs text-yellow-600">⚠️ Some fields are missing</p>
                                  )}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </label>
                        </div>

                        {isSelected && (
                          <Collapsible>
                            <CollapsibleTrigger className="ml-16 mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                              <ChevronRight className="h-3 w-3" />
                              Advanced: Create variations using different aspects
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="ml-16 mt-2 p-3 rounded-md border border-border/50 bg-muted/20">
                                <NestedDataSelector
                                  elementData={item}
                                  elementId={item.id}
                                  selectedPaths={selectedItems[item.id]?.paths || {}}
                                  onPathChange={(path, included) => handlePathChange(libraryTable, item.id, path, included)}
                                />
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
