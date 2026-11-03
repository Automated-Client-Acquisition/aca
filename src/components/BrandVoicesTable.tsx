import { useState, useMemo, useEffect } from "react";
import { useBrandVoices, type BrandVoice } from "@/hooks/useBrandVoices";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpandableText } from "@/components/ui/expandable-text";
import { ContentToolbar } from "./ContentToolbar";
import { DataTable, DataTableColumn } from "./DataTable";
import { BrandVoiceDetailsDialog } from "./BrandVoiceDetailsDialog";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { TablePagination } from "./TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import type { ColumnConfig } from "./ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";

interface BrandVoicesTableProps {
  onAdd?: () => void;
}

export function BrandVoicesTable({ onAdd }: BrandVoicesTableProps) {
  const { brandVoices, isLoading, updateBrandVoice, deleteBrandVoice, isUpdating, deleteBulkBrandVoices, isDeletingBulk } = useBrandVoices();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "tone", "description", "created_at"]);
  const [selectedBrandVoice, setSelectedBrandVoice] = useState<BrandVoice | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("brand-voices");

  useEffect(() => {
    const saved = loadColumnConfig("brand-voices");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "tone", label: "Tone" },
    { key: "description", label: "Description" },
    { key: "created_at", label: "Created" },
  ];

  const tableColumns: DataTableColumn[] = [
    { 
      key: "name", 
      label: "Name", 
      sortable: true, 
      visible: visibleColumns.includes("name"), 
      className: "min-w-[220px]",
      render: (v) => (
        <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
          {v}
        </span>
      )
    },
    {
      key: "tone",
      label: "Tone",
      sortable: true,
      visible: visibleColumns.includes("tone"),
      render: (v) => (
        <ExpandableText
          text={v}
          maxLines={2}
          className="group-hover:text-foreground"
        />
      )
    },
    {
      key: "description",
      label: "Description",
      visible: visibleColumns.includes("description"),
      render: (v) => (
        <ExpandableText
          text={v}
          maxLines={2}
          className="group-hover:text-foreground"
        />
      )
    },
    { 
      key: "created_at", 
      label: "Created", 
      sortable: true, 
      visible: visibleColumns.includes("created_at"), 
      render: (v) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(v)}
        </span>
      )
    },
  ];

  const filteredData = useMemo(() => {
    let result = brandVoices;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) => item.name?.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query));
    }
    return result;
  }, [brandVoices, searchQuery]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkBrandVoices(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "tone", label: "Tone" },
    { key: "description", label: "Description" },
    { key: "created_at", label: "Created", exportFormat: formatDate },
  ];

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-[600px] w-full" /></div>;

  return (
    <div className="space-y-4">
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("brand-voices", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="brand-voices"
      />
      <DataTable
        data={sortedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedBrandVoice(row as BrandVoice);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No brands found. Create your first brand to get started."
        emptyState={onAdd ? <AssetEmptyState type="brands" onAdd={onAdd} /> : undefined}
        selectable
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        paginated
        currentPage={currentPage}
        pageSize={pageSize}
      />
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={sortedData.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
      />
      <BulkActionsToolbar
        selectedCount={selectedIds.length}
        onDeleteSelected={handleBulkDelete}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
      />
      <BrandVoiceDetailsDialog
        brandVoice={selectedBrandVoice}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateBrandVoice}
        onDelete={deleteBrandVoice}
        isUpdating={isUpdating}
      />
    </div>
  );
}
