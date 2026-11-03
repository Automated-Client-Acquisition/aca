import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Filter, X } from "lucide-react";
import type { Blueprint } from "@/types/blueprint";
import { formatLabel } from "@/lib/blueprintCardUtils";

export interface BlueprintFiltersState {
  contentTypes: string[];
  pipelines: string[];
  providers: string[];
  tags: string[];
}

interface BlueprintFiltersProps {
  blueprints: Blueprint[];
  filters: BlueprintFiltersState;
  onFiltersChange: (filters: BlueprintFiltersState) => void;
}

export function BlueprintFilters({ 
  blueprints, 
  filters, 
  onFiltersChange 
}: BlueprintFiltersProps) {
  // Extract unique values from blueprints
  const pipelines = [...new Set(blueprints.map(b => b.pipeline).filter(Boolean))] as string[];
  const providers = [...new Set(blueprints.map(b =>
    b.model_config.text_llm?.model_id?.split('/')[0] || 
    b.model_config.provider || 
    'unknown'
  ))];
  const allTags = [...new Set(blueprints.flatMap(b => b.tags || []))];

  const activeFilterCount = 
    filters.contentTypes.length + 
    filters.pipelines.length + 
    filters.providers.length + 
    filters.tags.length;

  const toggleFilter = (category: keyof BlueprintFiltersState, value: string) => {
    const current = filters[category];
    const updated = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value];
    
    onFiltersChange({ ...filters, [category]: updated });
  };

  const clearAllFilters = () => {
    onFiltersChange({
      contentTypes: [],
      pipelines: [],
      providers: [],
      tags: [],
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-2 relative">
          <Filter className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge 
              variant="secondary" 
              className="ml-1 h-5 min-w-5 rounded-full px-1.5 text-xs"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 z-50 bg-popover" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm">Filters</h4>
            {activeFilterCount > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={clearAllFilters}
                className="h-8 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>

          <Separator />

          {/* Pipeline Filter */}
          {pipelines.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Pipeline</Label>
                <div className="space-y-2">
                  {pipelines.map((pipeline) => (
                    <div key={pipeline} className="flex items-center space-x-2">
                      <Checkbox
                        id={`pipeline-${pipeline}`}
                        checked={filters.pipelines.includes(pipeline)}
                        onCheckedChange={() => toggleFilter('pipelines', pipeline)}
                      />
                      <label
                        htmlFor={`pipeline-${pipeline}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {formatLabel(pipeline)}
                      </label>
                      <Badge variant="secondary" className="text-xs">
                        {blueprints.filter(b => b.pipeline === pipeline).length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Provider Filter */}
          {providers.length > 1 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Provider</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {providers.map((provider) => (
                    <div key={provider} className="flex items-center space-x-2">
                      <Checkbox
                        id={`provider-${provider}`}
                        checked={filters.providers.includes(provider)}
                        onCheckedChange={() => toggleFilter('providers', provider)}
                      />
                      <label
                        htmlFor={`provider-${provider}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {formatLabel(provider)}
                      </label>
                      <Badge variant="secondary" className="text-xs">
                        {blueprints.filter(b => 
                          (b.model_config.text_llm?.model_id?.split('/')[0] || 
                           b.model_config.provider || 
                           'unknown') === provider
                        ).length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Tags Filter */}
          {allTags.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Tags</Label>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {allTags.map((tag) => (
                    <div key={tag} className="flex items-center space-x-2">
                      <Checkbox
                        id={`tag-${tag}`}
                        checked={filters.tags.includes(tag)}
                        onCheckedChange={() => toggleFilter('tags', tag)}
                      />
                      <label
                        htmlFor={`tag-${tag}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {tag}
                      </label>
                      <Badge variant="secondary" className="text-xs">
                        {blueprints.filter(b => b.tags?.includes(tag)).length}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Active Filters Display Component
interface ActiveFiltersProps {
  filters: BlueprintFiltersState;
  onRemoveFilter: (category: keyof BlueprintFiltersState, value: string) => void;
  onClearAll: () => void;
}

export function ActiveFilters({ filters, onRemoveFilter, onClearAll }: ActiveFiltersProps) {
  const allActiveFilters = [
    ...filters.contentTypes.map(v => ({ category: 'contentTypes' as const, value: v, label: formatLabel(v) })),
    ...filters.pipelines.map(v => ({ category: 'pipelines' as const, value: v, label: formatLabel(v) })),
    ...filters.providers.map(v => ({ category: 'providers' as const, value: v, label: formatLabel(v) })),
    ...filters.tags.map(v => ({ category: 'tags' as const, value: v, label: `#${v}` })),
  ];

  if (allActiveFilters.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Active filters:</span>
      {allActiveFilters.map(({ category, value, label }) => (
        <Badge 
          key={`${category}-${value}`} 
          variant="secondary"
          className="gap-1 pr-1"
        >
          <span className="capitalize text-xs">{label}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 hover:bg-transparent"
            onClick={() => onRemoveFilter(category, value)}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="h-7 text-xs"
      >
        Clear all
      </Button>
    </div>
  );
}
