import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Blueprint, PinnedLibraryElements, NestedPathSelection, LibraryElementType } from "@/types/blueprint";
import { ManualIdeaRow } from "@/types/generation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreateGenerationJob } from "@/hooks/useCreateGenerationJob";
import { AlertCircle, CheckCircle2, Loader2, Sparkles, Layers, Image as ImageIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { parseAllPromptSlots, formatFieldLabel } from "@/lib/blueprintUtils";
import { toast } from "sonner";

const LIBRARY_TABLE_LABELS: Record<LibraryElementType, string> = {
  library_brand_voices: "Brands",
  library_characters: "Characters",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "ICPs",
  library_images: "Images",
};

interface GenerationVerificationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprint: Blueprint;
  ideaRows: ManualIdeaRow[];
  pinnedLibraryElements: PinnedLibraryElements;
}

export function GenerationVerificationModal({ 
  open, 
  onOpenChange, 
  blueprint, 
  ideaRows,
  pinnedLibraryElements,
}: GenerationVerificationModalProps) {
  const navigate = useNavigate();
  const createJob = useCreateGenerationJob();

  // Fetch COMPLETE library data for only the selected IDs
  const { data: brandVoices } = useQuery({
    queryKey: ["library-brand-voices-full", Object.keys(pinnedLibraryElements.library_brand_voices?.elements || {})],
    queryFn: async () => {
      const ids = Object.keys(pinnedLibraryElements.library_brand_voices?.elements || {});
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from("library_brand_voices")
        .select("*")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!Object.keys(pinnedLibraryElements.library_brand_voices?.elements || {}).length,
  });

  const { data: characters } = useQuery({
    queryKey: ["library-characters-full", Object.keys(pinnedLibraryElements.library_characters?.elements || {})],
    queryFn: async () => {
      const ids = Object.keys(pinnedLibraryElements.library_characters?.elements || {});
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from("library_characters")
        .select("*")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!Object.keys(pinnedLibraryElements.library_characters?.elements || {}).length,
  });

  const { data: blocks } = useQuery({
    queryKey: ["library-blocks-full", Object.keys(pinnedLibraryElements.library_blocks?.elements || {})],
    queryFn: async () => {
      const ids = Object.keys(pinnedLibraryElements.library_blocks?.elements || {});
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from("library_blocks")
        .select("*")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!Object.keys(pinnedLibraryElements.library_blocks?.elements || {}).length,
  });

  const { data: products } = useQuery({
    queryKey: ["library-products-full", Object.keys(pinnedLibraryElements.library_products?.elements || {})],
    queryFn: async () => {
      const ids = Object.keys(pinnedLibraryElements.library_products?.elements || {});
      if (!ids || ids.length === 0) return [];
      const { data, error } = await supabase
        .from("library_products")
        .select("*")
        .in("id", ids);
      if (error) throw error;
      return data;
    },
    enabled: !!Object.keys(pinnedLibraryElements.library_products?.elements || {}).length,
  });

  // Story elements are now part of blocks - no separate query needed

  // Parse slots from prompt - always use parser to detect library elements (from both master_prompt and image_prompt)
  const slots = useMemo(() => {
    return parseAllPromptSlots(blueprint.master_prompt || '', blueprint.image_prompt, blueprint.director_prompt);
  }, [blueprint.master_prompt, blueprint.image_prompt, blueprint.director_prompt]);

  // Validation checks - only for required library elements
  const requiredLibrarySlots = slots.filter(s => s.required && s.library_table);
  const unmappedRequired = requiredLibrarySlots.filter(slot => {
    if (slot.library_table) {
      const pinned = pinnedLibraryElements[slot.library_table];
      return !pinned || !pinned.elements || Object.keys(pinned.elements).length === 0;
    }
    return false;
  });

  const hasErrors = unmappedRequired.length > 0;

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

  // Calculate multiplication factor from pinned library elements including nested paths
  const pinnedCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    
    Object.entries(pinnedLibraryElements).forEach(([table, libraryData]) => {
      const elements = libraryData.elements || {};
      const elementIds = Object.keys(elements);
      const mode = libraryData.combination_mode || 'separate';
      
      if (elementIds.length > 0) {
        if (mode === 'separate') {
          // For separate mode, count each element AND its nested path multiplier
          let totalForThisTable = 0;
          
          elementIds.forEach(elementId => {
            const paths = elements[elementId]?.paths || {};
            const nestedMultiplier = calculateNestedMultiplier(paths);
            totalForThisTable += nestedMultiplier;
          });
          
          counts[table] = totalForThisTable;
        } else {
          // Combine mode: still treat as 1
          counts[table] = 1;
        }
      }
    });
    
    return counts;
  }, [pinnedLibraryElements]);

  const multiplicationFactor = Object.values(pinnedCounts).reduce((acc, count) => acc * count, 1);
  const totalOutputs = ideaRows.length * multiplicationFactor;

  // Get library element data by ID
  const getLibraryElement = (libraryTable: string, elementId: string) => {
    let data: any[] = [];
    switch (libraryTable) {
      case 'library_brand_voices':
        data = brandVoices || [];
        break;
      case 'library_characters':
        data = characters || [];
        break;
      case 'library_blocks':
        data = blocks || [];
        break;
      case 'library_products':
        data = products || [];
        break;
      case 'library_icps':
        data = [];
        break;
    }
    return data.find((item: any) => item.id === elementId);
  };

  // Resolve variables in prompt with actual first library element values
  const resolvePromptVariables = (prompt: string): string => {
    let resolved = prompt;
    
      // Get first element from each pinned library table with nested path selections
    const firstElements: Record<string, { data: any; paths: Record<string, any> }> = {};
    Object.entries(pinnedLibraryElements).forEach(([libraryTable, libraryData]) => {
      const elements = libraryData.elements || {};
      const elementIds = Object.keys(elements);
      if (elementIds && elementIds.length > 0) {
        const firstId = elementIds[0];
        const element = getLibraryElement(libraryTable, firstId);
        if (element) {
          // All included fields are used (simplified structure)
          const includedFields: string[] = [];
          Object.entries(elements[firstId]?.paths || {}).forEach(([path, config]) => {
            if (config.included) {
              includedFields.push(path);
            }
          });
          
          firstElements[libraryTable] = {
            data: element,
            paths: includedFields,
          };
        }
      }
    });

    // Replace variables - handle both shorthand and full table names
    const shorthandMap: Record<string, string> = {
      'product': 'library_products',
      'brand': 'library_brand_voices',
      'brand_voice': 'library_brand_voices', // Legacy alias
      'character': 'library_characters',
      'block': 'library_blocks',
      'icp': 'library_icps',
      'identity': 'library_identities',
    };

    // Find all {{variable}} patterns
    const regex = /\{\{([^}]+)\}\}/g;
    resolved = resolved.replace(regex, (match, variable) => {
      const parts = variable.trim().split('.');
      if (parts.length < 2) return match; // Not a library reference
      
      const tableRef = parts[0];
      
      // Map shorthand to full table name
      const fullTableName = shorthandMap[tableRef] || tableRef;
      
      const elementInfo = firstElements[fullTableName];
      if (!elementInfo) return `[${variable} - no element selected]`;
      
      const { data: element, paths } = elementInfo;
      
      // Navigate nested fields (e.g., icp.painPoints or icp.ageRange)
      const fieldPath = parts.slice(1).join('.');
      let value: any = element;
      
      for (const field of parts.slice(1)) {
        if (value === null || value === undefined) {
          return `[${variable} - null value]`;
        }
        
        // Parse JSON strings automatically
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch (e) {
            // Not a JSON string, keep as is
          }
        }
        
        if (typeof value === 'object' && field in value) {
          value = value[field];
        } else {
          return `[${variable} - field not found in data]`;
        }
      }
      
      // Handle null/undefined final values
      if (value === null || value === undefined) {
        return `[${variable} - no data]`;
      }
      
      // Handle string/number/boolean fields - use directly
      if (['string', 'number', 'boolean'].includes(typeof value)) {
        return String(value);
      }
      
      // Handle arrays - use selected index/indices if available
      if (Array.isArray(value)) {
        // Single-item array - auto-include the only item
        if (value.length === 1) {
          const singleValue = value[0];
          if (typeof singleValue === 'object') {
            return JSON.stringify(singleValue);
          }
          return String(singleValue);
        }
        
        // Multi-item array - check for user selection
        const selectedData = paths[fieldPath];
        
        if (Array.isArray(selectedData)) {
          // Multiple indices (combine mode) - show all selected values
          const selectedValues = selectedData
            .filter(idx => value[idx] !== undefined)
            .map(idx => {
              const val = value[idx];
              return typeof val === 'object' ? JSON.stringify(val) : String(val);
            });
          return selectedValues.length > 0 ? selectedValues.join(', ') : `[${variable} - no items selected]`;
        } else if (selectedData !== undefined && value[selectedData] !== undefined) {
          // Single index (separate mode or single selection)
          const selectedValue = value[selectedData];
          if (typeof selectedValue === 'object') {
            return JSON.stringify(selectedValue);
          }
          return String(selectedValue);
        }
        return value.length > 0 ? value.join(', ') : `[${variable} - empty array]`;
      }
      
      // Handle objects (shouldn't end on an object, but just in case)
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      
      return String(value);
    });

    return resolved;
  };

  // Preview - show resolved master prompt + idea context
  const previewRow = ideaRows[0];
  const previewPrompt = resolvePromptVariables(blueprint.master_prompt || '');
  const previewContext = previewRow?.context || '[No context provided]';

  // Validate required library elements
  const requiredLibraryTables = useMemo(() => {
    return slots
      .filter(slot => slot.library_table && slot.required !== false)
      .map(slot => slot.library_table!)
      .filter((value, index, self) => self.indexOf(value) === index);
  }, [slots]);

  const missingRequiredElements = useMemo(() => {
    return requiredLibraryTables.filter(table => {
      const selected = pinnedLibraryElements[table];
      return !selected || !selected.elements || Object.keys(selected.elements).length === 0;
    });
  }, [requiredLibraryTables, pinnedLibraryElements]);

  // Extract image inputs from pinned elements for display
  const imageInputsPreview = useMemo(() => {
    const allImages: Record<string, string[]> = {};
    
    Object.entries(pinnedLibraryElements).forEach(([libraryTable, libraryData]) => {
      const elements = libraryData.elements || {};
      Object.entries(elements).forEach(([elementId, elementConfig]) => {
        const element = getLibraryElement(libraryTable, elementId);
        if (!element) return;
        
        Object.entries(elementConfig.paths || {}).forEach(([path, config]) => {
          if (!config.included) return; // Skip excluded fields
          
          if (path.includes('image') || path.endsWith('.images')) {
            const fieldName = path.split('.').pop();
            const fieldValue = element[fieldName as string];
            
            if (Array.isArray(fieldValue) && fieldValue.length > 0) {
              // All images in the array are included (combined)
              const urls = fieldValue.filter(url => url);
              
              if (urls.length > 0) {
                const displayPath = `${libraryTable.replace('library_', '').replace(/_/g, ' ')} › ${path.split('.').slice(-1)[0]}`;
                if (!allImages[displayPath]) {
                  allImages[displayPath] = [];
                }
                urls.forEach(url => {
                  if (!allImages[displayPath].includes(url)) {
                    allImages[displayPath].push(url);
                  }
                });
              }
            }
          }
        });
      });
    });
    
    return allImages;
  }, [pinnedLibraryElements, brandVoices, characters, blocks, products]);

  const handleConfirm = async () => {
    if (hasErrors) return;
    
    if (missingRequiredElements.length > 0) {
      toast.error("Missing required library elements", {
        description: `Please select at least one element for: ${missingRequiredElements.map(t => t.replace('library_', '').replace(/_/g, ' ')).join(', ')}`
      });
      return;
    }

    try {
      // Step 1: Organize all selected library elements by type
      const libraryGroups: Record<string, Array<{id: string, data: any, paths: NestedPathSelection}>> = {};
      const combinationModes: Record<string, 'combine' | 'separate'> = {};
      
      Object.entries(pinnedLibraryElements).forEach(([libraryTable, libraryData]) => {
        const elements = libraryData.elements || {};
        const elementIds = Object.keys(elements);
        if (elementIds.length > 0) {
          combinationModes[libraryTable] = libraryData.combination_mode || 'separate';
          libraryGroups[libraryTable] = elementIds.map(id => ({
            id,
            data: getLibraryElement(libraryTable, id),
            paths: elements[id]?.paths || {}
          }));
        }
      });

      // Step 2: Generate all combinations respecting combination modes
      const generateCombinations = (
        groups: typeof libraryGroups,
        modes: typeof combinationModes
      ): Array<Record<string, any>> => {
        const tables = Object.keys(groups);
        if (tables.length === 0) return [{}];
        
        let combinations: Array<Record<string, any>> = [{}];
        
        for (const table of tables) {
          const elements = groups[table];
          const mode = modes[table] || 'separate';
          const newCombinations: Array<Record<string, any>> = [];
          
          if (mode === 'combine') {
            // Combine all elements into single entry (no multiplication)
            for (const combo of combinations) {
              newCombinations.push({
                ...combo,
                [table]: elements // Array of all elements
              });
            }
          } else {
            // Separate mode - each element creates new combination (multiplication)
            for (const combo of combinations) {
              for (const element of elements) {
                // Expand nested paths for this element
                const pathCombinations = expandNestedPaths(element.paths);
                
                for (const pathCombo of pathCombinations) {
                  newCombinations.push({
                    ...combo,
                    [table]: {
                      ...element,
                      paths: pathCombo
                    }
                  });
                }
              }
            }
          }
          
          combinations = newCombinations;
        }
        
        return combinations;
      };

      // Helper to expand nested path arrays into combinations respecting per-field modes
      const expandNestedPaths = (paths: NestedPathSelection): Array<Record<string, any>> => {
        const pathKeys = Object.keys(paths);
        if (pathKeys.length === 0) return [{}];
        
        // With simplified structure, all included fields are combined (no multiplication)
        const includedFields: Record<string, boolean> = {};
        for (const key of pathKeys) {
          const config = paths[key];
          if (config.included) {
            includedFields[key] = true;
          }
        }
        
        // Return single combination with all included fields
        return [includedFields];
      };

      const combinations = generateCombinations(libraryGroups, combinationModes);

      // Step 3: Create items for all combinations × ideas
      const items = ideaRows.flatMap(row => 
        combinations.map(combo => {
          const libraryElementsData: Record<string, any> = {};
          const selectedPathsData: Record<string, Record<string, any>> = {};
          const imageInputs: Record<string, string[]> = {};
          
          Object.entries(combo).forEach(([libraryTable, element]: [string, any]) => {
            libraryElementsData[libraryTable] = element.data;
            selectedPathsData[libraryTable] = element.paths;
            
            // Extract image URLs from paths if present
            Object.entries(element.paths || {}).forEach(([path, indexOrIndices]) => {
              if (path.includes('image') || path.endsWith('.images')) {
                const fieldName = path.split('.').pop();
                const fieldValue = element.data?.[fieldName as string];
                
                if (Array.isArray(fieldValue)) {
                  const indices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices];
                  const urls = indices
                    .filter(idx => fieldValue[idx])
                    .map(idx => fieldValue[idx]);
                  
                  if (urls.length > 0) {
                    const paramName = `${libraryTable}.${path}`;
                    imageInputs[paramName] = urls;
                  }
                }
              }
            });
          });
          
          return {
            idea_id: row.id,
            idea_title: row.context || '',
            slot_values: {},
            library_elements: libraryElementsData,
            selected_paths: selectedPathsData,
            image_inputs: imageInputs,
          };
        })
      );

      const jobId = await createJob.mutateAsync({
        blueprint_id: blueprint.id,
        pipeline: blueprint.pipeline,
        items,
        configuration: {
          blueprint_name: blueprint.name,
          pipeline: blueprint.pipeline,
          model_config: blueprint.model_config,
        },
      });

      onOpenChange(false);
      navigate('/jobs');
    } catch (error) {
      console.error('Failed to create generation job:', error);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Review & Generate Content</DialogTitle>
          <DialogDescription>
            Review your selections and estimated output before starting generation
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Generation Summary Card */}
          <Card className="p-5 bg-gradient-to-br from-primary/5 via-primary/3 to-background border-2 border-primary/20">
            <div className="flex items-start justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Generation Calculation</h3>
                </div>
                
                {/* Tier 1: Ideas */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-center gap-3 text-sm">
                    <Badge variant="outline" className="font-mono text-base px-3 py-1.5">
                      {ideaRows.length}
                    </Badge>
                    <span className="text-muted-foreground font-medium">Ideas</span>
                  </div>
                  
                  {/* Tier 2: Library Elements & Tier 3: Nested fields */}
                  {Object.entries(pinnedCounts).map(([table, count]) => {
                    const label = table.replace('library_', '').replace(/_/g, ' ');
                    const libraryData = pinnedLibraryElements[table];
                    const elements = libraryData?.elements || {};
                    const elementCount = Object.keys(elements).length;
                    const mode = libraryData?.combination_mode || 'separate';
                    
                    return (
                      <div key={table} className="space-y-2">
                        <div className="flex items-center gap-3 text-sm">
                          <Badge variant="outline" className="font-mono text-base px-3 py-1.5">
                            ×{mode === 'combine' ? '1' : elementCount}
                          </Badge>
                          <span className="text-muted-foreground font-medium capitalize">
                            {label} {mode === 'combine' ? '(combined)' : ''}
                          </span>
                        </div>
                        
                        {/* Tier 3: Nested fields - simplified (show included fields count) */}
                        {mode === 'separate' && Object.entries(elements).map(([elementId, elementConfig]) => {
                          const paths = elementConfig.paths || {};
                          const includedFieldsCount = Object.values(paths).filter(config => config.included).length;
                          
                          if (includedFieldsCount === 0) return null;
                          
                          const element = getLibraryElement(table, elementId);
                          const elementName = element?.name || 'Unknown';
                          
                          return (
                            <div key={elementId} className="ml-8">
                              <div className="text-xs text-muted-foreground">
                                {elementName}: {includedFieldsCount} fields included (all combined)
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  
                  {/* Total */}
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-3 p-3 bg-primary/10 rounded-lg border border-primary/30">
                      <Badge variant="default" className="font-mono text-xl px-4 py-2">
                        {totalOutputs}
                      </Badge>
                      <div>
                        <div className="font-semibold text-base">Total Variations</div>
                        <div className="text-xs text-muted-foreground">
                          Unique content pieces to generate
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Pipeline Type */}
              <div className="text-right">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Pipeline</div>
                  <Badge variant="secondary" className="text-sm px-3 py-1">
                    {blueprint.pipeline || 'N/A'}
                  </Badge>
                </div>
              </div>
            </div>
          </Card>

          {/* Validation Errors */}
          {hasErrors && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <div className="font-medium mb-2">Missing required mappings:</div>
                <ul className="list-disc list-inside space-y-1">
                  {unmappedRequired.map(slot => (
                    <li key={slot.key}>{slot.label || slot.key}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Preview */}
          <div className="space-y-2">
            <h3 className="font-medium text-sm">Preview (First Item)</h3>
            <Card className="p-4 bg-muted/50 space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">Master Prompt:</div>
                <pre className="text-xs whitespace-pre-wrap text-foreground/80 font-mono">
                  {previewPrompt.substring(0, 300)}
                  {previewPrompt.length > 300 && '...'}
                </pre>
              </div>
              <div className="border-t border-border pt-3">
                <div className="text-xs font-medium text-muted-foreground mb-1">Idea Context:</div>
                <pre className="text-xs whitespace-pre-wrap text-foreground/80">
                  {previewContext}
                </pre>
              </div>
            </Card>
          </div>

          {/* Pinned Library Elements */}
          {Object.keys(pinnedLibraryElements).length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium text-sm">Pinned Library Elements</h3>
               <div className="space-y-1">
                {Object.entries(pinnedLibraryElements).map(([libraryTable, libraryData]) => {
                  const elements = libraryData.elements || {};
                  const elementIds = Object.keys(elements);
                  if (elementIds.length === 0) return null;
                  
                  const mode = libraryData.combination_mode || 'separate';
                  const label = libraryTable.replace('library_', '').replace(/_/g, ' ')
                    .split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                    .join(' ');
                  const count = elementIds.length;
                  
                  return (
                    <div key={libraryTable} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                      <span className="text-muted-foreground">
                        {label} {mode === 'combine' ? '(combined)' : ''}
                      </span>
                      <Badge variant="secondary">{count} selected</Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected Images */}
          {Object.keys(imageInputsPreview).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4" />
                <h3 className="font-medium text-sm">Selected Images</h3>
              </div>
              {Object.entries(imageInputsPreview).map(([path, urls]) => (
                <div key={path} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground capitalize">{path}</div>
                  <div className="grid grid-cols-6 gap-2">
                    {urls.slice(0, 6).map((url, idx) => (
                      <div key={idx} className="aspect-square bg-background rounded-md border border-border/50 overflow-hidden">
                        <img 
                          src={url} 
                          alt={`Selected ${idx + 1}`} 
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23ccc" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23666" font-size="12">Error</text></svg>';
                          }}
                        />
                      </div>
                    ))}
                    {urls.length > 6 && (
                      <div className="aspect-square bg-muted rounded-md border border-border/50 flex items-center justify-center">
                        <span className="text-xs text-muted-foreground font-medium">+{urls.length - 6}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex-1">
            <Button 
              onClick={handleConfirm} 
              disabled={hasErrors || missingRequiredElements.length > 0 || createJob.isPending}
              className="w-full"
            >
              {createJob.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Start Generation ({totalOutputs} {totalOutputs === 1 ? 'item' : 'items'})
                </>
              )}
            </Button>
            {missingRequiredElements.length > 0 && (
              <p className="text-xs text-destructive text-center mt-2">
                Missing required: {missingRequiredElements.map(t => t.replace('library_', '').replace(/_/g, ' ')).join(', ')}
              </p>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
