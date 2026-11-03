import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, LayoutGrid, Table } from "lucide-react";
import { BlueprintFilters, BlueprintFiltersState, ActiveFilters } from "./BlueprintFilters";
import type { Blueprint } from "@/types/blueprint";

interface BlueprintsHeaderProps {
  blueprints: Blueprint[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortBy: string;
  onSortChange: (sortBy: string) => void;
  filters: BlueprintFiltersState;
  onFiltersChange: (filters: BlueprintFiltersState) => void;
  viewMode: 'grid' | 'table';
  onViewModeChange: (mode: 'grid' | 'table') => void;
}

export function BlueprintsHeader({
  blueprints,
  searchQuery,
  onSearchChange,
  sortBy,
  onSortChange,
  filters,
  onFiltersChange,
  viewMode,
  onViewModeChange,
}: BlueprintsHeaderProps) {
  const removeFilter = (category: keyof BlueprintFiltersState, value: string) => {
    const updated = filters[category].filter(v => v !== value);
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
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blueprints by name, type, or tags..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 h-10"
          />
        </div>
        
        <div className="flex gap-2">
          <div className="flex border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewModeChange('grid')}
              className="rounded-none"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onViewModeChange('table')}
              className="rounded-none border-l"
            >
              <Table className="h-4 w-4" />
            </Button>
          </div>
          
          <BlueprintFilters
            blueprints={blueprints}
            filters={filters}
            onFiltersChange={onFiltersChange}
          />
          
          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger className="w-full sm:w-[180px] h-10">
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent className="z-50 bg-popover">
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
              <SelectItem value="name-desc">Name Z-A</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ActiveFilters
        filters={filters}
        onRemoveFilter={removeFilter}
        onClearAll={clearAllFilters}
      />
    </div>
  );
}
