import { useState, useMemo, useEffect } from "react";
import { useICPs } from "@/hooks/useICPs";
import type { ICP } from "@/hooks/useICPs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "./ContentToolbar";
import { DataTable, DataTableColumn } from "./DataTable";
import { ICPDetailsDialog } from "./ICPDetailsDialog";
import { TablePagination } from "./TablePagination";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { ColumnConfig } from "./ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";

interface ICPsTableProps {
  onAdd?: () => void;
}

export function ICPsTable({ onAdd }: ICPsTableProps) {
  const { icps, isLoading, updateICP, deleteICP, deleteBulkICPs, isUpdating, isDeletingBulk } = useICPs();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "pain_points", "desires", "tags", "created_at"]);
  const [selectedICP, setSelectedICP] = useState<ICP | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("icps");

  useEffect(() => {
    const saved = loadColumnConfig("icps");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "pain_points", label: "Pain Points" },
    { key: "desires", label: "Desires" },
    { key: "tags", label: "Tags" },
    { key: "created_at", label: "Created" },
  ];

  const tableColumns: DataTableColumn[] = [
    { 
      key: "name", 
      label: "Audience", 
      sortable: true, 
      visible: visibleColumns.includes("name"), 
      render: (v, row) => (
        <div className="flex flex-col py-1">
          <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
            {v}
          </span>
          {(row.summary || row.description) && (
            <span className="text-sm text-muted-foreground truncate max-w-[400px]">
              {row.summary || row.description}
            </span>
          )}
        </div>
      )
    },
    {
      key: "pain_points",
      label: "Pain Points",
      visible: visibleColumns.includes("pain_points"),
      render: (v) => v?.length > 0 ? (
        <span className="text-sm tabular-nums">{v.length}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    {
      key: "desires",
      label: "Desires",
      visible: visibleColumns.includes("desires"),
      render: (v) => v?.length > 0 ? (
        <span className="text-sm tabular-nums">{v.length}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
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
    let result = icps;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.summary?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [icps, searchQuery]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkICPs(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
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
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("icps", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="target-audiences"
      />
      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedICP(row as ICP);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No target audiences found. Create your first ICP to get started."
        emptyState={onAdd ? <AssetEmptyState type="icps" onAdd={onAdd} /> : undefined}
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
      <ICPDetailsDialog
        icp={selectedICP}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateICP}
        onDelete={deleteICP}
        isUpdating={isUpdating}
      />
    </div>
  );
}
