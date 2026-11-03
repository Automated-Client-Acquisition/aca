import { Search, Filter, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ColumnSelector, type ColumnConfig } from "@/components/ColumnSelector";
import { ExportButton } from "@/components/ExportButton";
import { cn } from "@/lib/utils";
import type { ExportColumn } from "@/lib/exportUtils";

interface ActiveFilter {
  key: string;
  label: string;
  value: string;
}

interface ContentToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  responsive?: boolean;
  searchPlaceholder?: string;
  searchLabel?: string;
  // Filters (optional): omit onFilterClick when the table has nothing to filter by
  activeFilters?: ActiveFilter[];
  onFilterClick?: () => void;
  onClearFilters?: () => void;
  onRemoveFilter?: (key: string) => void;
  // Column management
  columns?: ColumnConfig[];
  visibleColumns?: string[];
  onColumnVisibilityChange?: (columns: string[]) => void;
  // Export (optional): the rows, or a loader for tables that only hold one page
  exportData?: any[];
  exportLoader?: () => Promise<unknown[]>;
  exportColumns?: ExportColumn[];
  exportFilename?: string;
}

export function ContentToolbar({
  searchValue,
  onSearchChange,
  responsive = false,
  searchPlaceholder = "Search...",
  searchLabel = "Search items",
  activeFilters = [],
  onFilterClick,
  onClearFilters,
  onRemoveFilter,
  columns,
  visibleColumns,
  onColumnVisibilityChange,
  exportData,
  exportLoader,
  exportColumns,
  exportFilename,
}: ContentToolbarProps) {
  const showColumnSelector =
    columns && visibleColumns && onColumnVisibilityChange;
  const showExport =
    (exportData || exportLoader) && exportColumns && exportFilename;
  return (
    <div className="space-y-3 mb-6">
      <div
        className={cn(
          "flex gap-3",
          responsive
            ? "flex-col items-stretch md:flex-row md:items-center"
            : "items-center",
        )}
      >
        <div className={cn("relative flex-1", responsive && "min-w-0 w-full")}>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <div
          className={
            responsive
              ? "flex max-w-full flex-wrap items-center gap-2 md:shrink-0"
              : "contents"
          }
        >
          {onFilterClick && (
            <Button
              variant="outline"
              size="sm"
              onClick={onFilterClick}
              className="h-10 gap-2"
            >
              <Filter className="w-4 h-4" />
              Filters
              {activeFilters.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 h-5 px-1 min-w-5 justify-center"
                >
                  {activeFilters.length}
                </Badge>
              )}
            </Button>
          )}

          {showColumnSelector && (
            <ColumnSelector
              columns={columns}
              visibleColumns={visibleColumns}
              onVisibilityChange={onColumnVisibilityChange}
            />
          )}

          {showExport && (
            <ExportButton
              data={exportData}
              loadData={exportLoader}
              columns={exportColumns}
              filename={exportFilename}
            />
          )}
        </div>
      </div>

      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {activeFilters.map((filter) => (
            <Badge
              key={filter.key}
              variant="secondary"
              className="gap-1.5 pr-1.5 pl-2.5"
            >
              <span className="text-xs">
                {filter.label}: {filter.value}
              </span>
              <button
                onClick={() => onRemoveFilter?.(filter.key)}
                className="hover:bg-secondary-foreground/20 rounded-full p-0.5 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-6 text-xs"
          >
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
