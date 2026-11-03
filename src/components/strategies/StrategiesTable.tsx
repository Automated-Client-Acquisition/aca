import { useState, useMemo, useEffect } from "react";
import { useStrategyDocuments } from "@/hooks/useStrategyDocuments";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "../ContentToolbar";
import { FilterDialog, FilterConfig } from "../FilterDialog";
import { DataTable, DataTableColumn } from "../DataTable";
import { TablePagination } from "../TablePagination";
import { BulkActionsToolbar } from "../BulkActionsToolbar";
import { AssetEmptyState } from "../assets/AssetEmptyState";
import { StrategyDetailDialog } from "./StrategyDetailDialog";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { ColumnConfig } from "../ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { FileText } from "lucide-react";
import { StrategyDocument, STRATEGY_DOCUMENT_TYPES, getDocumentTypeLabel, getDocumentTypeIcon } from "@/types/strategyDocument";

interface StrategiesTableProps {
  onAdd?: () => void;
}

export function StrategiesTable({ onAdd }: StrategiesTableProps) {
  const { documents, isLoading, updateDocument, deleteDocument, deleteBulkDocuments, isUpdating, isDeletingBulk } = useStrategyDocuments();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "document_type", "tags", "updated_at"]);
  const [selectedDocument, setSelectedDocument] = useState<StrategyDocument | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("strategies");

  useEffect(() => {
    const saved = loadColumnConfig("strategies");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, filters, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "document_type", label: "Type" },
    { key: "tags", label: "Tags" },
    { key: "updated_at", label: "Updated" },
  ];

  const getTypeBadgeStyles = (type: string) => {
    const styles: Record<string, string> = {
      lead_magnet: "bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400",
      sales_strategy: "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-400",
      content_calendar: "bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary/10 dark:text-primary",
      funnel: "bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-400",
      email_sequence: "bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-950/50 dark:text-cyan-400",
      landing_page: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-400",
      ad_copy: "bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-950/50 dark:text-orange-400",
      other: "bg-slate-50 text-slate-700 hover:bg-slate-100 dark:bg-slate-950/50 dark:text-slate-400",
    };
    return styles[type] || styles.other;
  };

  const tableColumns: DataTableColumn[] = [
    {
      key: "name",
      label: "Strategy",
      sortable: true,
      visible: visibleColumns.includes("name"),
      render: (v, row) => (
        <div className="flex flex-col py-1">
          <div className="flex items-center gap-2">
            <span className="text-lg">{getDocumentTypeIcon(row.document_type)}</span>
            <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
              {v}
            </span>
          </div>
          {row.description && (
            <span className="text-sm text-muted-foreground truncate max-w-[350px] ml-7">
              {row.description}
            </span>
          )}
        </div>
      )
    },
    {
      key: "document_type",
      label: "Type",
      sortable: true,
      visible: visibleColumns.includes("document_type"),
      render: (v) => (
        <Badge variant="secondary" className={`gap-1.5 whitespace-nowrap font-medium ${getTypeBadgeStyles(v)}`}>
          <FileText className="w-3 h-3" />
          {getDocumentTypeLabel(v)}
        </Badge>
      )
    },
    {
      key: "tags",
      label: "Tags",
      visible: visibleColumns.includes("tags"),
      render: (v) => v?.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {v.slice(0, 3).map((tag: string, idx: number) => (
            <Badge
              key={idx}
              variant="secondary"
              className="text-xs font-medium px-2.5 py-0.5 bg-secondary/80 hover:bg-secondary"
            >
              {tag}
            </Badge>
          ))}
          {v.length > 3 && (
            <Badge
              variant="secondary"
              className="text-xs font-medium px-2.5 py-0.5 bg-muted text-muted-foreground"
            >
              +{v.length - 3}
            </Badge>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    {
      key: "updated_at",
      label: "Updated",
      sortable: true,
      visible: visibleColumns.includes("updated_at"),
      render: (v) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(v)}
        </span>
      )
    },
  ];

  const filterConfigs: FilterConfig[] = [
    {
      key: "document_type",
      label: "Document Type",
      type: "select",
      options: STRATEGY_DOCUMENT_TYPES.map(t => ({ value: t.value, label: `${t.icon} ${t.label}` })),
    },
  ];

  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.document_type) {
      const typeLabel = getDocumentTypeLabel(filters.document_type);
      active.push({ key: "document_type", label: "Type", value: typeLabel });
    }
    return active;
  }, [filters]);

  const filteredData = useMemo(() => {
    let result = documents;
    if (filters.document_type) {
      result = result.filter((item) => item.document_type === filters.document_type);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.content?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [documents, searchQuery, filters]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkDocuments(selectedIds);
    setSelectedIds([]);
  };

  const handleSave = async (id: string, updates: Partial<StrategyDocument>) => {
    await updateDocument(id, updates);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "document_type", label: "Type", exportFormat: getDocumentTypeLabel },
    { key: "description", label: "Description" },
    { key: "updated_at", label: "Updated", exportFormat: formatDate },
  ];

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-[600px] w-full" /></div>;

  return (
    <>
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={activeFilters}
        onFilterClick={() => setFilterDialogOpen(true)}
        onClearFilters={() => setFilters({})}
        onRemoveFilter={(key) => setFilters((prev) => { const updated = { ...prev }; delete updated[key]; return updated; })}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("strategies", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="strategy-documents"
      />
      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedDocument(row as StrategyDocument);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No strategy documents found. Create your first strategy to get started."
        emptyState={onAdd ? <AssetEmptyState type="strategies" onAdd={onAdd} /> : undefined}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
        totalItems={sortedData.length}
      />
      <BulkActionsToolbar
        selectedCount={selectedIds.length}
        onDeleteSelected={handleBulkDelete}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
      />
      <StrategyDetailDialog
        document={selectedDocument}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={handleSave}
        onDelete={deleteDocument}
        isUpdating={isUpdating}
      />
      <FilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        filters={filterConfigs}
        currentFilters={filters}
        onApply={setFilters}
      />
    </>
  );
}
