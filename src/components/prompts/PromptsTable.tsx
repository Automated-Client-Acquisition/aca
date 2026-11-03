import { useState, useMemo, useEffect } from "react";
import { usePromptLibrary, type PromptTemplate, type PromptType } from "@/hooks/usePromptLibrary";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "@/components/ContentToolbar";
import { FilterDialog, FilterConfig } from "@/components/FilterDialog";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { PromptDetailsDialog } from "./PromptDetailsDialog";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { PIPELINES } from "@/types/pipeline";
import { Sparkles, ImageIcon, FileText } from "lucide-react";

export function PromptsTable() {
  const { prompts, isLoading, updatePrompt, deletePrompt, isUpdating, deleteBulkPrompts, isDeletingBulk, duplicatePrompt } = usePromptLibrary();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: "created_at", direction: "desc" });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "prompt_type", "pipeline_type", "scenario", "created_at"]);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptTemplate | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("prompts");

  useEffect(() => {
    const saved = loadColumnConfig("prompts");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, filters, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "prompt_type", label: "Type" },
    { key: "pipeline_type", label: "Pipeline" },
    { key: "scenario", label: "Scenario" },
    { key: "description", label: "Description" },
    { key: "created_at", label: "Created" },
  ];

  const getPipelineLabel = (pipelineId: string | null) => {
    if (!pipelineId) return null;
    const pipeline = PIPELINES.find(p => p.id === pipelineId);
    return pipeline?.name || pipelineId;
  };

  const tableColumns: DataTableColumn[] = [
    {
      key: "name",
      label: "Name",
      sortable: true,
      visible: visibleColumns.includes("name"),
      render: (v, row) => (
        <div className="flex items-center gap-2">
          {row.preview_url && (
            <img
              src={row.preview_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded-md border bg-muted object-cover"
              loading="lazy"
            />
          )}
          {row.is_preset && (
            <Sparkles className="w-4 h-4 text-cta shrink-0" />
          )}
          <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
            {v}
          </span>
        </div>
      )
    },
    {
      key: "prompt_type",
      label: "Type",
      sortable: true,
      visible: visibleColumns.includes("prompt_type"),
      render: (v: PromptType) => (
        <Badge
          variant="outline"
          className={v === 'image'
            ? "bg-gradient-to-r from-pink-500/10 to-rose-500/10 text-pink-600 border-pink-500/30"
            : "bg-gradient-to-r from-blue-500/10 to-cyan-500/10 text-blue-600 border-blue-500/30"
          }
        >
          {v === 'image' ? <ImageIcon className="w-3 h-3 mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
          {v === 'image' ? 'Image' : 'Text'}
        </Badge>
      )
    },
    {
      key: "pipeline_type",
      label: "Pipeline",
      sortable: true,
      visible: visibleColumns.includes("pipeline_type"),
      render: (v) => v ? (
        <Badge
          variant="outline"
          className="bg-gradient-to-r from-primary/10 to-primary/5 text-primary border-primary/30 font-medium"
        >
          {getPipelineLabel(v)}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    {
      key: "scenario",
      label: "Scenario",
      sortable: true,
      visible: visibleColumns.includes("scenario"),
      render: (v) => v ? (
        <Badge variant="secondary">
          {v.split(/[_-]/).map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")}
        </Badge>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    {
      key: "description",
      label: "Description",
      visible: visibleColumns.includes("description"),
      render: (v) => (
        <span className="line-clamp-2 text-sm text-muted-foreground group-hover:text-foreground transition-colors duration-200">
          {v || "—"}
        </span>
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

  // Get unique values for filters
  const uniquePipelineTypes = useMemo(() => {
    const types = [...new Set(prompts.map(p => p.pipeline_type).filter(Boolean))];
    return types.map(t => ({ value: t!, label: getPipelineLabel(t!) || t! }));
  }, [prompts]);

  const uniqueScenarios = useMemo(() => {
    return [...new Set(prompts.map(p => p.scenario).filter(Boolean))] as string[];
  }, [prompts]);

  // Format scenario for display (convert snake_case to Title Case)
  const formatScenario = (scenario: string | null): string => {
    if (!scenario) return "";
    return scenario
      .split(/[_-]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const filterConfigs: FilterConfig[] = [
    {
      key: "prompt_type",
      label: "Type",
      type: "select",
      options: [
        { value: "text", label: "Text" },
        { value: "image", label: "Image" },
      ],
    },
    {
      key: "pipeline_type",
      label: "Pipeline",
      type: "select",
      options: uniquePipelineTypes,
    },
    {
      key: "scenario",
      label: "Scenario",
      type: "select",
      options: uniqueScenarios.map(s => ({ value: s, label: formatScenario(s) })),
    },
    {
      key: "is_preset",
      label: "Preset Only",
      type: "boolean",
    },
  ];

  const filteredData = useMemo(() => {
    let result = prompts;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.scenario?.toLowerCase().includes(query) ||
        item.prompt_content?.toLowerCase().includes(query)
      );
    }

    if (filters.prompt_type) {
      result = result.filter((item) => item.prompt_type === filters.prompt_type);
    }

    if (filters.pipeline_type) {
      result = result.filter((item) => item.pipeline_type === filters.pipeline_type);
    }

    if (filters.scenario) {
      result = result.filter((item) => item.scenario === filters.scenario);
    }

    if (filters.is_preset) {
      result = result.filter((item) => item.is_preset === true);
    }

    return result;
  }, [prompts, searchQuery, filters]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const activeFilters = useMemo(() => {
    return Object.entries(filters)
      .filter(([_, value]) => value !== undefined && value !== null && value !== "")
      .map(([key, value]) => {
        const config = filterConfigs.find(f => f.key === key);
        let displayValue = value;
        if (config?.type === "select" && config.options) {
          const option = config.options.find(o => o.value === value);
          displayValue = option?.label || value;
        } else if (config?.type === "boolean") {
          displayValue = value ? "Yes" : "No";
        }
        return { key, label: config?.label || key, value: displayValue };
      });
  }, [filters]);

  const handleBulkDelete = () => {
    deleteBulkPrompts(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "prompt_type", label: "Type" },
    { key: "pipeline_type", label: "Pipeline", exportFormat: getPipelineLabel },
    { key: "scenario", label: "Scenario", exportFormat: formatScenario },
    { key: "description", label: "Description" },
    { key: "prompt_content", label: "Prompt Content" },
    { key: "created_at", label: "Created", exportFormat: formatDate },
  ];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={activeFilters}
        onFilterClick={() => setFilterDialogOpen(true)}
        onClearFilters={() => setFilters({})}
        onRemoveFilter={(key) => {
          const newFilters = { ...filters };
          delete newFilters[key];
          setFilters(newFilters);
        }}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(cols) => {
          setVisibleColumns(cols);
          saveColumnConfig("prompts", cols, cols);
        }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="prompt-library"
      />
      <DataTable
        data={sortedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({
          column: col,
          direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc"
        })}
        onRowClick={(row) => {
          setSelectedPrompt(row as PromptTemplate);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No prompts found. Create your first prompt template to get started."
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
      <FilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        filters={filterConfigs}
        currentFilters={filters}
        onApply={setFilters}
      />
      <PromptDetailsDialog
        prompt={selectedPrompt}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updatePrompt}
        onDelete={deletePrompt}
        onDuplicate={duplicatePrompt}
        isUpdating={isUpdating}
      />
    </div>
  );
}
