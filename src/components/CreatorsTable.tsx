import { useState, useMemo, useEffect } from "react";
import { useCreators, Creator } from "@/hooks/useCreators";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "@/components/ContentToolbar";
import { FilterDialog, FilterConfig } from "@/components/FilterDialog";
import { CreatorDetailsDialog } from "@/components/CreatorDetailsDialog";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { ScrapeStatusBadge } from "@/components/ScrapeStatusBadge";
import { NextScrapeIndicator } from "@/components/NextScrapeIndicator";
import { useActiveScrapes } from "@/hooks/useActiveScrapes";
import { useCreatorSchedules } from "@/hooks/useCreatorSchedules";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate, formatNumber } from "@/lib/tableUtils";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { ExternalLink, Users, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { PlatformBadge } from "@/components/PlatformBadge";
import { IdeasEmptyState } from "@/components/ideas/IdeasEmptyState";
import { BulkResearchScheduleDialog } from "@/components/BulkResearchScheduleDialog";
import type { BulkScheduleTarget } from "@/hooks/useApplyResearchSchedules";
import { useAuth } from "@/contexts/AuthContext";

interface CreatorsTableProps {
  onAdd?: () => void;
  embedded?: boolean;
}

export function CreatorsTable({ onAdd, embedded = false }: CreatorsTableProps) {
  const { creators, isLoading, deleteBulkCreators, isDeletingBulk } = useCreators();
  const [selectedCreator, setSelectedCreator] = useState<Creator | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    "display_name", "platform", "status", "subscriber_count", "last_scraped_at"
  ]);
  const { activeScrapes } = useActiveScrapes();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentOrganization } = useAuth();
  const [bulkScheduleTargets, setBulkScheduleTargets] = useState<BulkScheduleTarget[]>([]);
  useEffect(() => {
    setSelectedIds([]);
    setBulkScheduleTargets([]);
  }, [currentOrganization?.id]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("creators");

  // Fetch all schedules at once to avoid calling hooks in render
  const creatorIds = useMemo(() => creators.map(c => c.id), [creators]);
  const { scheduleMap } = useCreatorSchedules(creatorIds);

  // Helper to format numbers (e.g., 162500000 -> 162.5M)
  const formatFollowerCount = (num: number): string => {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  useEffect(() => {
    const saved = loadColumnConfig("creators");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, filters, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "display_name", label: "Creator", alwaysVisible: true },
    { key: "platform", label: "Platform" },
    { key: "status", label: "Collection" },
    { key: "channel_id", label: "Channel ID" },
    { key: "subscriber_count", label: "Audience" },
    { key: "video_count", label: "Videos" },
    { key: "last_scraped_at", label: "Last collected" },
    { key: "created_at", label: "Created" },
    { key: "tags", label: "Tags" },
    { key: "notes", label: "Notes" },
  ];

  const tableColumns: DataTableColumn[] = [
    { key: "display_name", label: "Creator", sortable: true, visible: visibleColumns.includes("display_name"), render: (value, row) => (
      <div className="flex items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={row.avatar_url || undefined} alt={value} referrerPolicy="no-referrer" />
          <AvatarFallback className="bg-muted text-muted-foreground font-medium">{value?.charAt(0)?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 space-y-1">
          <p className="truncate font-semibold">{value}</p>
          <p className="text-xs text-muted-foreground">{row.total_content_items ?? 0} posts collected</p>
        </div>
      </div>
    )},
    { key: "platform", label: "Platform", sortable: true, visible: visibleColumns.includes("platform"), render: (value) => (
      <PlatformBadge platform={value as string} variant="outline" />
    )},
    { key: "status", label: "Collection", sortable: false, visible: visibleColumns.includes("status"), render: (_, row) => {
      const activeScrape = activeScrapes?.find(s => s.creator_id === row.id);
      const scheduleInfo = scheduleMap.get(row.id) || { hasSchedule: false, nextRun: null, isActive: false };
      return activeScrape ? <ScrapeStatusBadge status={activeScrape.status as any} /> : scheduleInfo.hasSchedule && scheduleInfo.isActive && scheduleInfo.nextRun ? <NextScrapeIndicator nextRunAt={scheduleInfo.nextRun} showIcon={false} /> : <Badge variant="outline" className="text-xs bg-muted/30">{scheduleInfo.hasSchedule ? (scheduleInfo.isActive ? "Scheduled" : "Paused") : "Not scheduled"}</Badge>;
    }},
    { key: "channel_id", label: "Channel ID", visible: visibleColumns.includes("channel_id"), render: (value, row) => {
      const metadata = row.metadata as any;
      const platform = row.platform;
      
      return (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-mono bg-muted/50 px-2 py-1 rounded">
            {value || '-'}
          </span>
          {platform === "tiktok" && metadata?.tiktok?.verified && (
            <span className="text-primary text-sm" title="Verified">✓</span>
          )}
          {platform === "tiktok" && metadata?.tiktok?.followerCount && (
            <span className="text-xs text-muted-foreground">
              ({formatFollowerCount(metadata.tiktok.followerCount)})
            </span>
          )}
        </div>
      );
    }},
    { key: "subscriber_count", label: "Audience", sortable: true, visible: visibleColumns.includes("subscriber_count"), render: (value) => value ? formatNumber(value) : <span className="text-muted-foreground text-sm">—</span> },
    { key: "video_count", label: "Videos", sortable: true, visible: visibleColumns.includes("video_count"), render: (value) => value ? formatNumber(value) : <span className="text-muted-foreground text-sm">—</span> },
    { key: "channel_url", label: "Profile Link", visible: visibleColumns.includes("profile_url"), render: (value) => value ? (
      <Button 
        variant="ghost" 
        size="sm" 
        className="h-8 px-2"
        onClick={(e) => {
          e.stopPropagation();
          window.open(value, '_blank', 'noopener,noreferrer');
        }}
      >
        <ExternalLink className="h-4 w-4" />
      </Button>
    ) : <span className="text-xs text-muted-foreground">-</span> },
    { key: "last_scraped_at", label: "Last collected", sortable: true, visible: visibleColumns.includes("last_scraped_at"), render: (value) => <span className="text-sm text-muted-foreground">{formatDate(value)}</span> },
    { key: "created_at", label: "Created", sortable: true, visible: visibleColumns.includes("created_at"), render: (value) => <span className="text-sm text-muted-foreground">{formatDate(value)}</span> },
    { key: "tags", label: "Tags", visible: visibleColumns.includes("tags"), render: (value) => value?.length > 0 ? (<div className="flex gap-1 flex-wrap max-w-xs">{value.slice(0, 2).map((t: string) => (<Badge key={t} variant="secondary" className="text-xs px-2">{t}</Badge>))}{value.length > 2 && (<Badge variant="secondary" className="text-xs px-2">+{value.length - 2}</Badge>)}</div>) : '-' },
    { key: "notes", label: "Notes", visible: visibleColumns.includes("notes"), render: (value) => <span className="text-muted-foreground text-sm line-clamp-1 max-w-xs">{value || '-'}</span> },
  ];

  const exportColumns: ExportColumn[] = [{ key: "display_name", label: "Creator" }, { key: "platform", label: "Platform" }, { key: "channel_id", label: "Channel ID" }, { key: "channel_url", label: "Profile URL" }, { key: "subscriber_count", label: "Audience", exportFormat: (v) => v ? formatNumber(v) : '-' }, { key: "video_count", label: "Videos", exportFormat: (v) => v ? formatNumber(v) : '-' }, { key: "total_content_items", label: "Content Items" }, { key: "last_scraped_at", label: "Last collected", exportFormat: formatDate }, { key: "created_at", label: "Created", exportFormat: formatDate }, { key: "tags", label: "Tags", exportFormat: (v) => v?.join(", ") || "" }, { key: "notes", label: "Notes" }].filter(col => visibleColumns.includes(col.key.split('.')[0]));

  const filterConfigs: FilterConfig[] = useMemo(() => {
    const platforms = [...new Set(creators.map(c => c.platform))];
    const allTags = [...new Set(creators.flatMap(c => c.tags || []))];
    return [
      { 
        key: "platform", 
        label: "Platform", 
        type: "select", 
        options: platforms.map(p => ({ 
          value: p, 
          label: p.charAt(0).toUpperCase() + p.slice(1),
          icon: p
        })) 
      }, 
      { 
        key: "tags", 
        label: "Tags", 
        type: "multi-select", 
        options: allTags.map(t => ({ value: t, label: t })) 
      }, 
      { 
        key: "has_content", 
        label: "Has Scraped Content", 
        type: "checkbox" 
      }
    ];
  }, [creators]);

  const filteredCreators = useMemo(() => {
    let result = creators;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c => c.display_name.toLowerCase().includes(q) || c.channel_id?.toLowerCase().includes(q) || c.notes?.toLowerCase().includes(q) || c.tags?.some(t => t.toLowerCase().includes(q)));
    }
    if (filters.platform) result = result.filter(c => c.platform === filters.platform);
    if (filters.tags?.length > 0) result = result.filter(c => filters.tags.some((t: string) => c.tags?.includes(t)));
    if (filters.has_content) result = result.filter(c => (c.total_content_items || 0) > 0);
    return result;
  }, [creators, searchQuery, filters]);

  const sortedCreators = useMemo(() => sortData(filteredCreators, sortConfig), [filteredCreators, sortConfig]);

  const totalPages = Math.ceil(sortedCreators.length / pageSize);

  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.platform) active.push({ key: "platform", label: "Platform", value: filters.platform.charAt(0).toUpperCase() + filters.platform.slice(1) });
    if (filters.tags?.length > 0) active.push({ key: "tags", label: "Tags", value: filters.tags.join(", ") });
    if (filters.has_content) active.push({ key: "has_content", label: "Has Content", value: "Yes" });
    return active;
  }, [filters]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const selectedSources = creators.filter((source) => source.organization_id === currentOrganization?.id && selectedIds.includes(source.id));
  const allMatchingSelected = filteredCreators.length > 0 && filteredCreators.every((source) => selectedIds.includes(source.id));
  const toggleAllMatching = () => {
    const matchingIds = new Set(filteredCreators.map((source) => source.id));
    setSelectedIds((previous) => allMatchingSelected
      ? previous.filter((id) => !matchingIds.has(id))
      : [...new Set([...previous, ...matchingIds])]);
  };
  const handleBulkSchedule = () => {
    setBulkScheduleTargets(selectedSources.map((source) => ({ id: source.id, name: source.display_name, organizationId: source.organization_id })));
  };

  const handleBulkDelete = () => {
    deleteBulkCreators(selectedIds);
    setSelectedIds([]);
  };

  if (isLoading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>;
  if (!creators.length) return <IdeasEmptyState type="creators" onAdd={onAdd} />;

  return (
    <>
      {!embedded && <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Creators you follow</h2>
          <p className="mt-1 text-sm text-muted-foreground">Open a creator to manage collection schedules and browse their posts.</p>
        </div>
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">{filteredCreators.length} of {creators.length} creators</span>
      </div>}
      <ContentToolbar responsive={embedded} searchLabel="Search creators" searchPlaceholder="Search creators..." searchValue={searchQuery} onSearchChange={setSearchQuery} activeFilters={activeFilters} onFilterClick={() => setFilterDialogOpen(true)} onClearFilters={() => setFilters({})} onRemoveFilter={(k) => setFilters(p => { const u = {...p}; delete u[k]; return u; })} columns={columnConfigs} visibleColumns={visibleColumns} onColumnVisibilityChange={(c) => { setVisibleColumns(c); saveColumnConfig("creators", c, c); }} exportData={sortedCreators} exportColumns={exportColumns} exportFilename="research-creators" />
      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {selectedSources.length > 0 ? `${selectedSources.length} selected` : `${filteredCreators.length} matching creators`} · Selection includes all matching pages.
        </p>
        <Button variant="outline" size="sm" onClick={toggleAllMatching} disabled={isDeletingBulk || filteredCreators.length === 0}>
          {allMatchingSelected ? "Deselect all matching" : `Select all ${filteredCreators.length} creators`}
        </Button>
      </div>
      {filteredCreators.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">No creators match your filters.</p></div>
      ) : (
        <>
          <DataTable
            data={sortedCreators}
            columns={tableColumns}
            sortConfig={sortConfig}
            onSort={handleSort}
            onRowClick={(c) => { setSelectedCreator(c); setDialogOpen(true); }}
            selectable
            selectAllScope="filtered"
            selectAllLabel={`Select all ${filteredCreators.length} matching creators across pages`}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            paginated
            currentPage={currentPage}
            pageSize={pageSize}
            resizable
            tableId="creators-table"
            defaultColumnWidths={{
              display_name: 320,
              platform: 120,
              status: 150,
              channel_id: 180,
              subscriber_count: 130,
              video_count: 110,
              last_scraped_at: 130,
              created_at: 120,
              tags: 180,
              notes: 200,
            }}
          />
          <TablePagination
            responsive
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={sortedCreators.length}
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
        type="creator"
        targets={bulkScheduleTargets}
        onClose={() => setBulkScheduleTargets([])}
        onApplied={(ids) => setSelectedIds((previous) => previous.filter((id) => !ids.includes(id)))}
      />}
      <FilterDialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen} filters={filterConfigs} currentFilters={filters} onApply={setFilters} />
      <CreatorDetailsDialog creator={selectedCreator} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
