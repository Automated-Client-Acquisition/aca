import { useState, useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Info } from "lucide-react";
import { extractUsedFields } from "@/lib/blueprintUtils";
import { getFieldLabel } from "@/lib/fieldCategorization";

interface NestedFieldSelectorProps {
  item: any;
  elementId: string;
  blueprintPrompt: string;
  libraryTable: string;
  selectedPaths: Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>;
  onChange: (paths: Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }>) => void;
}

export function NestedFieldSelector({
  item,
  elementId,
  blueprintPrompt,
  libraryTable,
  selectedPaths,
  onChange,
}: NestedFieldSelectorProps) {
  // Extract fields used in the prompt
  const usedFields = useMemo(
    () => extractUsedFields(blueprintPrompt, libraryTable),
    [blueprintPrompt, libraryTable]
  );

  // Get image fields that are used in prompt
  const imageFields = useMemo(() => {
    const fields = ['images', 'reference_images'];
    return fields.filter(field => 
      usedFields.includes(field) && 
      item[field] && 
      Array.isArray(item[field]) && 
      item[field].length > 0
    );
  }, [item, usedFields]);

  // Get array fields (ICP, marketing, affiliate, features) that are used in prompt
  const arrayFields = useMemo(() => {
    const fieldPrefixes = ['icp_', 'marketing_', 'affiliate_'];
    const arrays: Record<string, any[]> = {};
    
    usedFields.forEach(field => {
      if (item[field] && Array.isArray(item[field]) && item[field].length > 0) {
        const hasMatchingPrefix = fieldPrefixes.some(prefix => field.startsWith(prefix));
        if (hasMatchingPrefix || field === 'features') {
          arrays[field] = item[field];
        }
      }
    });
    
    return arrays;
  }, [item, usedFields]);

  // Initialize selectedPaths if empty - include all fields by default
  useEffect(() => {
    if (Object.keys(selectedPaths).length === 0) {
      const initialPaths: Record<string, { included: boolean; selectedItems?: string[]; combinationMode?: 'combine' | 'separate' }> = {};
      
      // Include all image fields
      imageFields.forEach(field => {
        initialPaths[field] = { included: true };
      });

      // Include all array fields with all items selected by default
      Object.entries(arrayFields).forEach(([field, items]) => {
        initialPaths[field] = {
          included: true,
          selectedItems: items.map(String),
          combinationMode: 'combine'
        };
      });
      
      onChange(initialPaths);
    }
  }, [imageFields, arrayFields, onChange, selectedPaths]);

  const handleFieldToggle = (fieldKey: string, included: boolean) => {
    const newPaths = { ...selectedPaths };
    if (included) {
      // When enabling, select all items by default
      const items = arrayFields[fieldKey];
      newPaths[fieldKey] = {
        included: true,
        selectedItems: items ? items.map(String) : undefined,
        combinationMode: 'combine'
      };
    } else {
      delete newPaths[fieldKey];
    }
    onChange(newPaths);
  };

  const handleArrayItemToggle = (fieldKey: string, itemValue: string) => {
    const newPaths = { ...selectedPaths };
    const currentField = newPaths[fieldKey] || { included: true, selectedItems: [], combinationMode: 'combine' };
    const currentItems = new Set(currentField.selectedItems || []);
    
    if (currentItems.has(itemValue)) {
      currentItems.delete(itemValue);
    } else {
      currentItems.add(itemValue);
    }
    
    newPaths[fieldKey] = {
      ...currentField,
      selectedItems: Array.from(currentItems)
    };
    
    onChange(newPaths);
  };

  const handleSelectAllArrayItems = (fieldKey: string, items: any[]) => {
    const newPaths = { ...selectedPaths };
    newPaths[fieldKey] = {
      included: true,
      selectedItems: items.map(String),
      combinationMode: newPaths[fieldKey]?.combinationMode || 'combine'
    };
    onChange(newPaths);
  };

  const handleDeselectAllArrayItems = (fieldKey: string) => {
    const newPaths = { ...selectedPaths };
    if (newPaths[fieldKey]) {
      newPaths[fieldKey] = {
        ...newPaths[fieldKey],
        selectedItems: []
      };
    }
    onChange(newPaths);
  };

  const handleFieldCombinationModeChange = (fieldKey: string, mode: 'combine' | 'separate') => {
    const newPaths = { ...selectedPaths };
    if (newPaths[fieldKey]) {
      newPaths[fieldKey] = {
        ...newPaths[fieldKey],
        combinationMode: mode
      };
    }
    onChange(newPaths);
  };

  if (imageFields.length === 0 && Object.keys(arrayFields).length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 mt-4 pt-4 border-t" onClick={(e) => e.stopPropagation()}>
      {/* Helper text */}
      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          Select which data to include in your content. Choose specific items from arrays and decide whether to combine them or create separate outputs.
        </p>
      </div>

      {/* Images Section */}
      {imageFields.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🎨</span>
              <span className="font-semibold text-sm">Visual Assets</span>
              <Badge variant="secondary" className="text-xs">Images auto-included</Badge>
            </div>

            {imageFields.map((field) => {
              const value = item[field];
              const isIncluded = selectedPaths[field]?.included ?? false;
              
              return (
                <div key={field} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={isIncluded}
                      onCheckedChange={(checked) => handleFieldToggle(field, checked as boolean)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Label className="font-medium text-sm cursor-pointer">
                      {getFieldLabel(field)}
                    </Label>
                    <Badge variant="outline" className="text-xs">
                      {value.length} images
                    </Badge>
                  </div>

                  {isIncluded && (
                    <div className="grid grid-cols-4 gap-2 ml-6">
                      {value.slice(0, 8).map((imageUrl: string, idx: number) => (
                        <div
                          key={idx}
                          className="relative aspect-square rounded-md overflow-hidden border border-border bg-muted"
                        >
                          <img
                            src={imageUrl}
                            alt={`${getFieldLabel(field)} ${idx + 1}`}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" fill="%23999" font-size="10"%3ENo Image%3C/text%3E%3C/svg%3E';
                            }}
                          />
                        </div>
                      ))}
                      {value.length > 8 && (
                        <div className="aspect-square rounded-md border border-dashed border-muted-foreground/30 flex items-center justify-center text-xs text-muted-foreground">
                          +{value.length - 8}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Array Fields Section */}
      {Object.keys(arrayFields).length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Granular Selection</h4>
          <p className="text-xs text-muted-foreground">
            Select specific items from each field. Choose whether to combine them or create separate outputs.
          </p>
          
          {Object.entries(arrayFields).map(([fieldKey, items]) => {
            const fieldLabel = getFieldLabel(fieldKey);
            const fieldData = selectedPaths[fieldKey];
            const selectedItems = new Set(fieldData?.selectedItems || []);
            const combinationMode = fieldData?.combinationMode || 'combine';
            const allSelected = selectedItems.size === items.length;
            const isIncluded = fieldData?.included ?? false;
            
            return (
              <Card key={fieldKey} className="border-l-4 border-l-primary/40">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isIncluded}
                        onCheckedChange={(checked) => handleFieldToggle(fieldKey, checked as boolean)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <Label className="text-sm font-medium">{fieldLabel}</Label>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {selectedItems.size}/{items.length} selected
                    </Badge>
                  </div>

                  {isIncluded && (
                    <>
                      {/* Selection Controls */}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectAllArrayItems(fieldKey, items);
                          }}
                          disabled={allSelected}
                          className="text-xs"
                        >
                          Select All
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeselectAllArrayItems(fieldKey);
                          }}
                          disabled={selectedItems.size === 0}
                          className="text-xs"
                        >
                          Clear
                        </Button>
                      </div>

                      {/* Combination Mode */}
                      {selectedItems.size > 1 && (
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">Generation Mode</Label>
                          <ToggleGroup
                            type="single"
                            value={combinationMode}
                            onValueChange={(value) => {
                              if (value) handleFieldCombinationModeChange(fieldKey, value as 'combine' | 'separate');
                            }}
                            className="justify-start"
                          >
                            <ToggleGroupItem value="combine" className="text-xs" aria-label="Combine all items">
                              <span className="mr-1">🔗</span> Combine All
                            </ToggleGroupItem>
                            <ToggleGroupItem value="separate" className="text-xs" aria-label="Create separate outputs">
                              <span className="mr-1">✂️</span> Separate ({selectedItems.size}x)
                            </ToggleGroupItem>
                          </ToggleGroup>
                          <p className="text-xs text-muted-foreground">
                            {combinationMode === 'combine' 
                              ? 'All selected items will be used together in each output'
                              : `Creates ${selectedItems.size} separate outputs, one per item`
                            }
                          </p>
                        </div>
                      )}

                      {/* Item Checkboxes */}
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {items.map((item, index) => {
                          const itemValue = String(item);
                          const isSelected = selectedItems.has(itemValue);
                          
                          return (
                            <div key={index} className="flex items-start gap-2 p-2 rounded hover:bg-accent/50">
                              <Checkbox
                                id={`${fieldKey}-${index}`}
                                checked={isSelected}
                                onCheckedChange={() => handleArrayItemToggle(fieldKey, itemValue)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Label 
                                htmlFor={`${fieldKey}-${index}`}
                                className="text-sm cursor-pointer flex-1"
                              >
                                {itemValue}
                              </Label>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
