import { useState, useMemo, useEffect } from "react";
import { useBlocks } from "@/hooks/useBlocks";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "./ContentToolbar";
import { FilterDialog, FilterConfig } from "./FilterDialog";
import { DataTable, DataTableColumn } from "./DataTable";
import { BlockDetailsDialog } from "./BlockDetailsDialog";
import { TablePagination } from "./TablePagination";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { ColumnConfig } from "./ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";

interface Block {
  id: string;
  name: string;
  block_type: string;
  content: string | null;
  tags: string[] | null;
  usage_count: number | null;
  organization_id: string;
  created_at: string | null;
  updated_at: string | null;
}

interface BlocksTableProps {
  onAdd?: () => void;
}

export function BlocksTable({ onAdd }: BlocksTableProps) {
  const { blocks, isLoading, updateBlock, deleteBlock, deleteBulkBlocks, isUpdating, isDeletingBulk } = useBlocks();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "block_type", "content", "tags", "created_at"]);
  const [selectedBlock, setSelectedBlock] = useState<Block | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("blocks");

  useEffect(() => {
    const saved = loadColumnConfig("blocks");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, filters, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "block_type", label: "Type" },
    { key: "content", label: "Content" },
    { key: "tags", label: "Tags" },
    { key: "created_at", label: "Created" },
  ];

  const blockTypeLabels: Record<string, string> = {
    hook: "Hook",
    angle: "Angle",
    cta: "CTA",
    story_element: "Story Element",
    visual_style: "Visual Style",
  };

  const tableColumns: DataTableColumn[] = [
    { 
      key: "name", 
      label: "Block", 
      sortable: true, 
      visible: visibleColumns.includes("name"), 
      render: (v) => (
        <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
          {v}
        </span>
      )
    },
    { 
      key: "block_type", 
      label: "Type", 
      sortable: true, 
      visible: visibleColumns.includes("block_type"), 
      render: (v) => (
        <Badge variant="outline" className="whitespace-nowrap font-medium">
          {blockTypeLabels[v] || v}
        </Badge>
      )
    },
    { 
      key: "content", 
      label: "Content", 
      visible: visibleColumns.includes("content"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[400px]">
          {v}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    { 
      key: "tags", 
      label: "Tags", 
      visible: visibleColumns.includes("tags"), 
      render: (v) => v?.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {v.slice(0, 3).map((tag: string, idx: number) => (
            <Badge key={idx} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
          {v.length > 3 && <Badge variant="secondary" className="text-xs">+{v.length - 3}</Badge>}
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

  const filterConfigs: FilterConfig[] = [
    {
      key: "block_type",
      label: "Block Type",
      type: "select",
      options: [
        { value: "hook", label: "Hooks" },
        { value: "angle", label: "Angles" },
        { value: "cta", label: "CTAs" },
        { value: "story_element", label: "Story Elements" },
        { value: "visual_style", label: "Visual Styles" },
      ],
    },
  ];

  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.block_type) {
      const typeLabel = blockTypeLabels[filters.block_type] || filters.block_type;
      active.push({ key: "block_type", label: "Type", value: typeLabel });
    }
    return active;
  }, [filters]);

  const filteredData = useMemo(() => {
    let result = blocks;
    if (filters.block_type) {
      result = result.filter((item) => item.block_type === filters.block_type);
    }
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.content?.toLowerCase().includes(query)
      );
    }
    return result;
  }, [blocks, searchQuery, filters]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkBlocks(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "block_type", label: "Type" },
    { key: "content", label: "Content" },
    { key: "created_at", label: "Created", exportFormat: formatDate },
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
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("blocks", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="blocks"
      />
      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedBlock(row as Block);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No blocks found. Create your first block to get started."
        emptyState={onAdd ? <AssetEmptyState type="blocks" onAdd={onAdd} /> : undefined}
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
      <BlockDetailsDialog
        block={selectedBlock}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateBlock}
        onDelete={deleteBlock}
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
