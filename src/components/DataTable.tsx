import { ReactNode } from "react";
import { SortableTableHeader } from "@/components/SortableTableHeader";
import type { SortConfig } from "@/lib/tableUtils";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useColumnResize } from "@/hooks/useColumnResize";
import { ResizeHandle } from "@/components/ui/resize-handle";

export interface DataTableColumn<T = any> {
  key: string;
  label: string;
  sortable?: boolean;
  visible?: boolean;
  render?: (value: any, row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: DataTableColumn<T>[];
  sortConfig: SortConfig;
  onSort: (column: string) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  emptyState?: ReactNode;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  /** Defaults to the current page. Filtered selects every row supplied in data. */
  selectAllScope?: "page" | "filtered";
  selectAllLabel?: string;
  getRowId?: (row: T) => string;
  paginated?: boolean;
  currentPage?: number;
  pageSize?: number;
  /** Enable drag-to-resize columns */
  resizable?: boolean;
  /** Unique ID for persisting column widths (required when resizable is true) */
  tableId?: string;
  /** Default column widths in pixels, keyed by column key */
  defaultColumnWidths?: Record<string, number>;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  sortConfig,
  onSort,
  onRowClick,
  emptyMessage = "No data available",
  emptyState,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  selectAllScope = "page",
  selectAllLabel,
  getRowId = (row: T) => row.id,
  paginated = false,
  currentPage = 1,
  pageSize = 25,
  resizable = false,
  tableId = 'data-table',
  defaultColumnWidths = {},
}: DataTableProps<T>) {
  const visibleColumns = columns.filter(col => col.visible !== false);

  // Build default widths from visible columns
  const defaultWidths: Record<string, number> = {
    ...(selectable ? { _checkbox: 48 } : {}),
    ...Object.fromEntries(visibleColumns.map(col => [col.key, defaultColumnWidths[col.key] ?? 150])),
  };

  const { getTableProps, getHeaderProps, getResizeHandleProps } = useColumnResize({
    tableId,
    defaultWidths,
  });

  const visibleColumnKeys = [
    ...(selectable ? ['_checkbox'] : []),
    ...visibleColumns.map(col => col.key),
  ];

  const getValue = (row: T, key: string): any => {
    return key.split('.').reduce((obj, k) => obj?.[k], row);
  };

  // Paginate data if pagination is enabled
  const paginatedData = paginated
    ? data.slice((currentPage - 1) * pageSize, currentPage * pageSize)
    : data;

  const selectionRows = selectAllScope === "filtered" ? data : paginatedData;
  const selectedIdSet = new Set(selectedIds);
  const allSelected = selectionRows.length > 0 && selectionRows.every(row => selectedIdSet.has(getRowId(row)));
  const someSelected = !allSelected && selectionRows.some(row => selectedIdSet.has(getRowId(row)));

  const handleSelectAll = () => {
    const scopeIds = new Set(selectionRows.map(getRowId));
    onSelectionChange?.(allSelected
      ? selectedIds.filter(id => !scopeIds.has(id))
      : [...new Set([...selectedIds, ...scopeIds])]);
  };

  const handleSelectRow = (rowId: string) => {
    if (selectedIds.includes(rowId)) {
      onSelectionChange?.(selectedIds.filter(id => id !== rowId));
    } else {
      onSelectionChange?.([...selectedIds, rowId]);
    }
  };

  if (data.length === 0) {
    if (emptyState) {
      return <>{emptyState}</>;
    }
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const tableStyle = resizable ? getTableProps(visibleColumnKeys).style : undefined;

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden bg-gradient-to-br from-card to-card/50 shadow-lg backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className={cn("border-collapse", resizable ? undefined : "w-full")} style={tableStyle}>
          <thead className="bg-gradient-to-r from-muted/50 via-muted/30 to-muted/50 backdrop-blur-sm border-b border-border/50">
            <tr>
              {selectable && (
                <th
                  className="w-12 px-4 py-4 text-left align-middle"
                  style={resizable ? getHeaderProps('_checkbox').style : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={handleSelectAll}
                      aria-label={selectAllLabel || (selectAllScope === "filtered" ? "Select all matching rows" : "Select all")}
                      title={selectAllLabel || (selectAllScope === "filtered" ? "Select all matching rows across pages" : "Select all rows on this page")}
                      className={cn(
                        "transition-all duration-200",
                        someSelected ? "data-[state=indeterminate]:bg-primary/20 data-[state=indeterminate]:border-primary" : ""
                      )}
                    />
                  </div>
                </th>
              )}
              {visibleColumns.map((column) => (
                <SortableTableHeader
                  key={column.key}
                  label={column.label}
                  columnKey={column.key}
                  sortConfig={sortConfig}
                  onSort={onSort}
                  sortable={column.sortable}
                  className={cn(column.className, resizable && "relative")}
                  style={resizable ? getHeaderProps(column.key).style : undefined}
                  resizeHandle={
                    resizable ? (
                      <ResizeHandle {...getResizeHandleProps(column.key)} />
                    ) : undefined
                  }
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, rowIndex) => {
              const rowId = getRowId(row);
              const isSelected = selectedIds.includes(rowId);

              return (
                <tr
                  key={rowIndex}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b border-border/30 transition-all duration-200 group relative",
                    "hover:bg-gradient-to-r hover:from-primary/[0.02] hover:via-primary/[0.04] hover:to-primary/[0.02]",
                    "hover:border-primary/20",
                    isSelected && "bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-primary/30",
                    onRowClick && "cursor-pointer"
                  )}
                >
                  {selectable && (
                    <td
                      className="w-12 px-4 py-4 text-left align-middle"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectRow(rowId);
                      }}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => handleSelectRow(rowId)}
                        aria-label={`Select row ${rowIndex + 1}`}
                        className="transition-all duration-200"
                      />
                    </td>
                  )}
                  {visibleColumns.map((column) => {
                    const value = getValue(row, column.key);
                    return (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-4 text-sm text-left align-middle",
                          column.className
                        )}
                      >
                        {column.render ? column.render(value, row) : (value ?? "")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
