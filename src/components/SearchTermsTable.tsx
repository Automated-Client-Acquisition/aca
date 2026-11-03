import { useState, useMemo, useEffect } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "@/components/ContentToolbar";
import { FilterDialog, FilterConfig } from "@/components/FilterDialog";
import { SearchTermDetailsDialog } from "@/components/SearchTermDetailsDialog";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { Search, CalendarClock } from "lucide-react";
import { useSearchTerms } from "@/hooks/useSearchTerms";
import { ScrapeStatusBadge } from "@/components/ScrapeStatusBadge";
import { NextScrapeIndicator } from "@/components/NextScrapeIndicator";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";
import { useSearchTermSchedules } from "@/hooks/useSearchTermSchedules";
import { PlatformBadge } from "@/components/PlatformBadge";
import type { SearchTerm } from "@/hooks/useSearchTerms";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import type { SortConfig } from "@/lib/tableUtils";
import { loadColumnConfig, saveColumnConfig, sortData } from "@/lib/tableUtils";
import { IdeasEmptyState } from "@/components/ideas/IdeasEmptyState";
import { BulkResearchScheduleDialog } from "@/components/BulkResearchScheduleDialog";
import type { BulkScheduleTarget } from "@/hooks/useApplyResearchSchedules";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

interface SearchTermsTableProps {
  onAdd?: () => void;
  embedded?: boolean;
}

export function SearchTermsTable({ onAdd, embedded = false }: SearchTermsTableProps) {
  const { searchTerms, isLoading, deleteBulkSearchTerms, isDeletingBulk } = useSearchTerms();
  const { activeScrapes } = useActiveScrapes();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchTerm, setSelectedSearchTerm] = useState<SearchTerm | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentOrganization } = useAuth();
  const [bulkScheduleTargets, setBulkScheduleTargets] = useState<BulkScheduleTarget[]>([]);
  useEffect(() => {
    setSelectedIds([]);
    setBulkScheduleTargets([]);
  }, [currentOrganization?.id]);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: "created_at", direction: "desc" });
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    "search_term", "platform", "status", "total_results", "last_scraped_at"
  ]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("search_terms");

  // Fetch all schedules at once to avoid calling hooks in render
  const searchTermIds = useMemo(() => searchTerms.map(st => st.id), [searchTerms]);
  const { scheduleMap } = useSearchTermSchedules(searchTermIds);

  // Load saved column config
  useEffect(() => {
    const saved = loadColumnConfig("search_terms");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, filters, resetPage]);

  const handleColumnVisibilityChange = (columns: string[]) => {
    setVisibleColumns(columns);
    saveColumnConfig("search_terms", columns, columns);
  };

  // Column configurations for the column selector
  const columnConfigs: ColumnConfig[] = [
    { key: "search_term", label: "Search Term", alwaysVisible: true },
    { key: "platform", label: "Platform" },
    { key: "status", label: "Collection" },
    { key: "total_results", label: "Posts found" },
    { key: "last_scraped_at", label: "Last collected" },
    { key: "tags", label: "Tags" },
  ];

  // Filter configurations
  const filterConfigs: FilterConfig[] = useMemo(() => {
    const platforms = [...new Set(searchTerms.map(st => st.platform))];
    return [
      {
        key: "platform",
        label: "Platform",
        type: "select",
        options: platforms.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
      },
      {
        key: "has_schedule",
        label: "Has Active Schedule",
        type: "checkbox"
      },
    ];
  }, [searchTerms]);

  const filteredSearchTerms = useMemo(() => {
    let result = searchTerms;

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (term) =>
          term.search_term.toLowerCase().includes(query) ||
          term.platform.toLowerCase().includes(query) ||
          term.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }

    // Apply filters
    if (filters.platform) {
      result = result.filter(term => term.platform === filters.platform);
    }
    if (filters.has_schedule) {
      result = result.filter(term => {
        const scheduleInfo = scheduleMap.get(term.id);
        return scheduleInfo?.hasSchedule && scheduleInfo?.isActive;
      });
    }

    return result;
  }, [searchTerms, searchQuery, filters, scheduleMap]);

  // Build active filters display
  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.platform) {
      active.push({ key: "platform", label: "Platform", value: filters.platform.charAt(0).toUpperCase() + filters.platform.slice(1) });
    }
    if (filters.has_schedule) {
      active.push({ key: "has_schedule", label: "Has Active Schedule", value: "Yes" });
    }
    return active;
  }, [filters]);

  const sortedSearchTerms = useMemo(() => sortData(filteredSearchTerms, sortConfig), [filteredSearchTerms, sortConfig]);

  const totalPages = Math.ceil(sortedSearchTerms.length / pageSize);

  // 3-way sort cycle: asc -> desc -> none (matching other tables)
  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const selectedSources = searchTerms.filter((source) => source.organization_id === currentOrganization?.id && selectedIds.includes(source.id));
  const allMatchingSelected = filteredSearchTerms.length > 0 && filteredSearchTerms.every((source) => selectedIds.includes(source.id));
  const toggleAllMatching = () => {
    const matchingIds = new Set(filteredSearchTerms.map((source) => source.id));
    setSelectedIds((previous) => allMatchingSelected
      ? previous.filter((id) => !matchingIds.has(id))
      : [...new Set([...previous, ...matchingIds])]);
  };
  const handleBulkSchedule = () => {
    setBulkScheduleTargets(selectedSources.map((source) => ({ id: source.id, name: source.search_term, organizationId: source.organization_id })));
  };

  const handleBulkDelete = () => {
    deleteBulkSearchTerms(selectedIds);
    setSelectedIds([]);
  };

  const tableColumns: DataTableColumn[] = [
    {
      key: "search_term",
      label: "Search Term",
      sortable: true,
      visible: visibleColumns.includes("search_term"),
      render: (_: any, term: SearchTerm) => (
        <div className="space-y-1 py-1">
          <p className="font-semibold leading-relaxed">{term.search_term}</p>
          <p className="text-xs text-muted-foreground">Keyword search</p>
        </div>
      ),
    },
    {
      key: "platform",
      label: "Platform",
      sortable: true,
      visible: visibleColumns.includes("platform"),
      render: (_: any, term: SearchTerm) => (
        <PlatformBadge platform={term.platform} />
      ),
    },
    {
      key: "status",
      label: "Collection",
      sortable: false,
      visible: visibleColumns.includes("status"),
      render: (_: any, term: SearchTerm) => {
        const activeScrape = activeScrapes?.find(s => s.search_term_id === term.id);
        const scheduleInfo = scheduleMap.get(term.id) || { hasSchedule: false, nextRun: null, isActive: false };
        return activeScrape ? <ScrapeStatusBadge status={activeScrape.status as any} /> : scheduleInfo.hasSchedule && scheduleInfo.isActive && scheduleInfo.nextRun ? <NextScrapeIndicator nextRunAt={scheduleInfo.nextRun} showIcon={false} /> : <Badge variant="outline" className="bg-muted/30 text-xs">{scheduleInfo.hasSchedule ? (scheduleInfo.isActive ? "Scheduled" : "Paused") : "Not scheduled"}</Badge>;
      },
    },
    {
      key: "total_results",
      label: "Posts found",
      sortable: true,
      visible: visibleColumns.includes("total_results"),
      render: (_: any, term: SearchTerm) => (
        <span className="text-muted-foreground">
          {term.total_results ?? "—"}
        </span>
      ),
    },
    {
      key: "last_scraped_at",
      label: "Last collected",
      sortable: true,
      visible: visibleColumns.includes("last_scraped_at"),
      render: (_: any, term: SearchTerm) => (
        <span className="text-muted-foreground">
          {term.last_scraped_at
            ? new Date(term.last_scraped_at).toLocaleDateString()
            : "Never"
          }
        </span>
      ),
    },
    {
      key: "tags",
      label: "Tags",
      sortable: false,
      visible: visibleColumns.includes("tags"),
      render: (_: any, term: SearchTerm) => (
        <div className="flex flex-wrap gap-1">
          {term.tags?.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {term.tags && term.tags.length > 3 && (
            <Badge variant="secondary" className="text-xs">
              +{term.tags.length - 3}
            </Badge>
          )}
        </div>
      ),
    },
  ];

  // Export columns (only visible columns)
  const exportColumns: ExportColumn[] = tableColumns
    .filter(c => visibleColumns.includes(c.key))
    .map(c => ({ key: c.key, label: c.label }));

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!searchTerms.length) {
    return <IdeasEmptyState type="search" onAdd={onAdd} />;
  }

  return (
    <>
      {!embedded && <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Searches you track</h2>
          <p className="mt-1 text-sm text-muted-foreground">Discover posts beyond your followed creators. Open a search to manage its schedule.</p>
        </div>
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">{filteredSearchTerms.length} of {searchTerms.length} searches</span>
      </div>}
      <ContentToolbar
        responsive={embedded}
        searchLabel="Search tracked keywords"
        searchPlaceholder="Search tracked keywords..."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        activeFilters={activeFilters}
        onFilterClick={() => setFilterDialogOpen(true)}
        onClearFilters={() => setFilters({})}
        onRemoveFilter={(k) => setFilters(p => { const u = {...p}; delete u[k]; return u; })}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        exportData={sortedSearchTerms}
        exportColumns={exportColumns}
        exportFilename="search-terms"
      />

      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {selectedSources.length > 0 ? `${selectedSources.length} selected` : `${filteredSearchTerms.length} matching search terms`} · Selection includes all matching pages.
        </p>
        <Button variant="outline" size="sm" onClick={toggleAllMatching} disabled={isDeletingBulk || filteredSearchTerms.length === 0}>
          {allMatchingSelected ? "Deselect all matching" : `Select all ${filteredSearchTerms.length} search terms`}
        </Button>
      </div>
      {filteredSearchTerms.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No search terms match your search.</p>
        </div>
      ) : (
        <>
          <DataTable
            columns={tableColumns}
            data={sortedSearchTerms}
            sortConfig={sortConfig}
            onSort={handleSort}
            onRowClick={(term) => {
              setSelectedSearchTerm(term);
              setDetailsDialogOpen(true);
            }}
            selectable
            selectAllScope="filtered"
            selectAllLabel={`Select all ${filteredSearchTerms.length} matching search terms across pages`}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            paginated
            currentPage={currentPage}
            pageSize={pageSize}
            resizable
            tableId="search-terms-table"
            defaultColumnWidths={{
              search_term: 340,
              platform: 120,
              status: 150,
              total_results: 110,
              last_scraped_at: 140,
              tags: 200,
            }}
          />
          <TablePagination
            responsive
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={sortedSearchTerms.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </>
      )}
      <BulkActionsToolbar
        selectedCount={selectedSources.length}
        onDeleteSelected={handleBulkDelete}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
        extraActions={
          <Button variant="cta" size="sm" onClick={handleBulkSchedule} disabled={isDeletingBulk}>
            <CalendarClock className="mr-2 h-4 w-4" /> Apply schedule
          </Button>
        }
      />
      {bulkScheduleTargets.length > 0 && <BulkResearchScheduleDialog
        type="search_term"
        targets={bulkScheduleTargets}
        onClose={() => setBulkScheduleTargets([])}
        onApplied={(ids) => setSelectedIds((previous) => previous.filter((id) => !ids.includes(id)))}
      />}

      <SearchTermDetailsDialog
        searchTerm={selectedSearchTerm}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
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
