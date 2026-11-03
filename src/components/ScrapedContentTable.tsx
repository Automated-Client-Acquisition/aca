import { useState, useMemo, useEffect } from "react";
import { useScrapedContent, type ScrapedContentListParams } from "@/hooks/useScrapedContent";
import { useCreators } from "@/hooks/useCreators";
import { useSearchTerms } from "@/hooks/useSearchTerms";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ContentToolbar } from "@/components/ContentToolbar";
import { FilterDialog, FilterConfig } from "@/components/FilterDialog";
import { ScrapedContentDetailsDialog } from "@/components/ScrapedContentDetailsDialog";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PlatformBadge } from "@/components/PlatformBadge";
import type { SortConfig } from "@/lib/tableUtils";
import { loadColumnConfig, saveColumnConfig, formatDate, formatNumber, formatDuration } from "@/lib/tableUtils";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { CheckCircle2, Eye, ThumbsUp, MessageCircle, Loader2, FileVideo } from "lucide-react";
import { IdeasEmptyState } from "@/components/ideas/IdeasEmptyState";
import { ReverseEngineerBlueprintDialog } from "@/components/ideas/ReverseEngineerBlueprintDialog";

import { SaveAsIdeaButton } from "@/components/research/SaveAsIdeaButton";
import { useSaveResearchAsIdeas } from "@/hooks/useSaveAsIdea";
import { cn } from "@/lib/utils";

// research_content_platform_check. Listed statically: the table is paged, so the
// platforms actually present can't be read off the loaded rows.
const PLATFORMS = ["youtube", "tiktok", "instagram", "linkedin", "twitter", "other"];

// What the export reads (see exportColumns); LIST_COLUMNS carries ~10KB/row of raw payloads.
const EXPORT_COLUMNS = "id, title, author_name, platform, engagement, duration_seconds, published_at, converted_to_idea, analyzed_at, created_at";

interface ScrapedContentTableProps {
  initialCreatorFilter?: string | null;
  onClearCreatorFilter?: () => void;
  initialSearchTermFilter?: string | null;
  onClearSearchTermFilter?: () => void;
}

export function ScrapedContentTable({
  initialCreatorFilter,
  onClearCreatorFilter,
  initialSearchTermFilter,
  onClearSearchTermFilter
}: ScrapedContentTableProps) {
  const { creators } = useCreators();
  const { searchTerms } = useSearchTerms();
  // Store the id, not the row, so the dialog shows fresh transcript/analysis after refetches
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [reverseDialogOpen, setReverseDialogOpen] = useState(false);
  const saveAsIdeas = useSaveResearchAsIdeas();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    if (initialCreatorFilter) initial.creator_id = initialCreatorFilter;
    if (initialSearchTermFilter) initial.search_term_id = initialSearchTermFilter;
    return initial;
  });
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);

  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["title", "platform", "views", "likes", "published_at", "converted_to_idea"]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("scraped_content");

  // Back to page 1 in the same update as the change, so the old page is never fetched with the new query
  const updateFilters = (update: Parameters<typeof setFilters>[0]) => {
    setFilters(update);
    resetPage();
  };

  // Sync filters when initialCreatorFilter or initialSearchTermFilter changes
  useEffect(() => {
    if (initialCreatorFilter) {
      setFilters(prev => ({ ...prev, creator_id: initialCreatorFilter }));
      resetPage();
    }
  }, [initialCreatorFilter, resetPage]);

  useEffect(() => {
    if (initialSearchTermFilter) {
      setFilters(prev => ({ ...prev, search_term_id: initialSearchTermFilter }));
      resetPage();
    }
  }, [initialSearchTermFilter, resetPage]);

  useEffect(() => {
    const saved = loadColumnConfig("scraped_content");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  const debouncedSearch = useDebouncedValue(searchQuery.trim(), 300);
  const listParams = useMemo<ScrapedContentListParams>(() => {
    const { from, to } = filters.published_date ?? {};
    let publishedTo: string | undefined;
    if (to) {
      // Through the end of the 'to' day
      const endOfToDate = new Date(to);
      endOfToDate.setHours(23, 59, 59, 999);
      publishedTo = endOfToDate.toISOString();
    }
    return {
      search: debouncedSearch || undefined,
      platform: filters.platform || undefined,
      creatorId: filters.creator_id || undefined,
      searchTermId: filters.search_term_id || undefined,
      publishedFrom: from ? new Date(from).toISOString() : undefined,
      publishedTo,
      savedAsIdeaOnly: !!filters.converted_to_idea,
      hasCreatorOnly: !!filters.has_creator,
      sort: sortConfig,
    };
  }, [debouncedSearch, filters, sortConfig]);
  const isFiltered = Object.entries(listParams).some(([key, value]) => key !== "sort" && Boolean(value));

  const { content, totalCount, isLoading, isRefreshing, error, fetchAllMatching, deleteBulkScrapedContent, isDeletingBulk } =
    useScrapedContent(listParams, { page: currentPage, pageSize });
  const selectedContent = useMemo(() => content.find((c) => c.id === selectedContentId) ?? null, [content, selectedContentId]);

  const columnConfigs: ColumnConfig[] = [{ key: "title", label: "Title", alwaysVisible: true }, { key: "author_name", label: "Author" }, { key: "platform", label: "Platform" }, { key: "views", label: "Views" }, { key: "likes", label: "Likes" }, { key: "comments", label: "Comments" }, { key: "duration", label: "Duration" }, { key: "published_at", label: "Published" }, { key: "converted_to_idea", label: "Idea" }, { key: "analyzed", label: "Analyzed" }, { key: "created_at", label: "Scraped" }];

  const tableColumns: DataTableColumn[] = [
    { key: "title", label: "Content", sortable: true, visible: visibleColumns.includes("title"), render: (value, row) => {
      const isVertical = row.platform === 'tiktok' || row.platform === 'youtube-shorts';
      const thumbnailClasses = isVertical
        ? "w-14 h-20 object-cover rounded-lg flex-shrink-0 bg-muted"
        : "w-20 h-16 object-cover rounded-lg flex-shrink-0 bg-muted";
      // Skip tiny LinkedIn thumbnails (feedshare-shrink_20 is only 20px)
      const showThumbnail = row.thumbnail_url && !(row.platform === 'linkedin' && row.thumbnail_url.includes('feedshare-shrink_20'));
      return (
        <div className="flex min-w-[240px] items-center gap-4 py-1">
          {showThumbnail && <img src={row.thumbnail_url} alt="" referrerPolicy="no-referrer" className={thumbnailClasses} />}
          <div className="min-w-0 space-y-1.5">
            <p className="line-clamp-2 text-sm font-semibold leading-relaxed">{value || "Untitled post"}</p>
            {!visibleColumns.includes("author_name") && <p className="truncate text-xs text-muted-foreground">{row.author_name || row.author_handle || "Unknown creator"}</p>}
          </div>
        </div>
      );
    }},
    { key: "author_name", label: "Author", sortable: true, visible: visibleColumns.includes("author_name"), render: (value, row) => (<div className="flex items-center gap-2 min-w-[150px]"><Avatar className="w-7 h-7 ring-1 ring-border"><AvatarImage src={row.author_avatar_url || undefined} referrerPolicy="no-referrer" /><AvatarFallback className="text-xs">{value?.[0]?.toUpperCase()}</AvatarFallback></Avatar><span className="text-sm">{value || '-'}</span></div>) },
    { key: "platform", label: "Platform", sortable: true, visible: visibleColumns.includes("platform"), render: (value) => <PlatformBadge platform={value} /> },
    { key: "engagement.viewCount", label: "Views", sortable: true, visible: visibleColumns.includes("views"), render: (value, row) => (<div className="flex items-center gap-1.5 text-sm font-mono"><Eye className="w-3.5 h-3.5 text-muted-foreground" /><span>{row.engagement?.viewCount == null ? "—" : formatNumber(row.engagement.viewCount)}</span></div>), className: "text-right" },
    { key: "engagement.likeCount", label: "Likes", sortable: true, visible: visibleColumns.includes("likes"), render: (value, row) => (<div className="flex items-center gap-1.5 text-sm font-mono"><ThumbsUp className="w-3.5 h-3.5 text-muted-foreground" /><span>{row.engagement?.likeCount == null ? "—" : formatNumber(row.engagement.likeCount)}</span></div>), className: "text-right" },
    { key: "engagement.commentCount", label: "Comments", sortable: true, visible: visibleColumns.includes("comments"), render: (value, row) => (<div className="flex items-center gap-1.5 text-sm font-mono"><MessageCircle className="w-3.5 h-3.5 text-muted-foreground" /><span>{row.engagement?.commentCount == null ? "—" : formatNumber(row.engagement.commentCount)}</span></div>), className: "text-right" },
    { key: "duration", label: "Duration", sortable: true, visible: visibleColumns.includes("duration"), render: (value, row) => <span className="font-mono text-sm">{formatDuration(row.duration_seconds)}</span>, className: "text-center" },
    { key: "published_at", label: "Published", sortable: true, visible: visibleColumns.includes("published_at"), render: (value) => <span className="text-sm text-muted-foreground">{formatDate(value)}</span> },
    { key: "converted_to_idea", label: "Saved", sortable: true, visible: visibleColumns.includes("converted_to_idea"), render: (value, row: any) => row.conversion_in_progress ? (<Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 animate-pulse"><span className="flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Saving...</span></Badge>) : value ? (<Badge variant="secondary"><span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" />Saved</span></Badge>) : (<span className="text-muted-foreground text-xs">Not saved</span>), className: "text-center" },
    { key: "analyzed", label: "Analyzed", sortable: true, visible: visibleColumns.includes("analyzed"), render: (value, row) => row.ai_analysis?._meta ? (<CheckCircle2 className="w-4 h-4 text-blue-600 mx-auto" />) : (<span className="text-muted-foreground text-xs">-</span>), className: "text-center" },
    { key: "created_at", label: "Scraped", sortable: true, visible: visibleColumns.includes("created_at"), render: (value) => <span className="text-sm text-muted-foreground">{formatDate(value)}</span> },
  ];

  const exportColumns: ExportColumn[] = tableColumns.filter(col => visibleColumns.includes(col.key.split('.')[0])).map(col => ({ key: col.key, label: col.label }));

  const getPlatformLabel = (platform: string): string => {
    const labels: Record<string, string> = {
      'youtube': 'YouTube',
      'youtube-shorts': 'YouTube Shorts',
      'tiktok': 'TikTok',
      'instagram': 'Instagram',
      'linkedin': 'LinkedIn',
      'twitter': 'X (Twitter)',
      'other': 'Other'
    };
    return labels[platform] || platform;
  };

  const filterConfigs: FilterConfig[] = useMemo(() => {
    const creatorOptions = creators.map(c => ({ 
      value: c.id, 
      label: `${c.display_name} (${c.platform})` 
    }));
    const searchTermOptions = searchTerms.map(st => ({ 
      value: st.id, 
      label: `${st.search_term} (${st.platform})` 
    }));
    
    return [
      { key: "platform", label: "Platform", type: "select", options: PLATFORMS.map(p => ({ value: p, label: getPlatformLabel(p) })) },
      { key: "creator_id", label: "Creator", type: "select", options: creatorOptions },
      { key: "search_term_id", label: "Search Term", type: "select", options: searchTermOptions },
      { key: "published_date", label: "Published Date Range", type: "date-range" },
      { key: "converted_to_idea", label: "Saved as idea", type: "checkbox" },
      { key: "has_creator", label: "Has Creator", type: "checkbox" }
    ];
  }, [creators, searchTerms]);

  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.platform) active.push({ key: "platform", label: "Platform", value: filters.platform.charAt(0).toUpperCase() + filters.platform.slice(1) });
    if (filters.creator_id) {
      const creator = creators.find(c => c.id === filters.creator_id);
      if (creator) active.push({ key: "creator_id", label: "Creator", value: creator.display_name });
    }
    if (filters.search_term_id) {
      const searchTerm = searchTerms.find(st => st.id === filters.search_term_id);
      if (searchTerm) active.push({ key: "search_term_id", label: "Search Term", value: searchTerm.search_term });
    }
    if (filters.published_date?.from || filters.published_date?.to) {
      const fromStr = filters.published_date.from ? formatDate(filters.published_date.from.toISOString()) : 'any';
      const toStr = filters.published_date.to ? formatDate(filters.published_date.to.toISOString()) : 'any';
      active.push({ key: "published_date", label: "Published", value: `${fromStr} - ${toStr}` });
    }
    if (filters.converted_to_idea) active.push({ key: "converted_to_idea", label: "Saved as idea", value: "Yes" });
    if (filters.has_creator) active.push({ key: "has_creator", label: "Has Creator", value: "Yes" });
    if (filters.analyzed) active.push({ key: "analyzed", label: "Analyzed", value: "Yes" });
    return active;
  }, [filters, creators, searchTerms]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Rows deleted from under the last page: step back to the new last page
  useEffect(() => {
    if (!isRefreshing && currentPage > totalPages) setCurrentPage(totalPages);
  }, [isRefreshing, currentPage, totalPages, setCurrentPage]);

  const handleSort = (column: string) => {
    resetPage();
    setSortConfig((prev) => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        if (prev.direction === 'desc') return { column: null, direction: null };
      }
      return { column, direction: 'asc' };
    });
  };

  const handleBulkDelete = () => {
    deleteBulkScrapedContent(selectedIds);
    setSelectedIds([]);
  };

  if (isLoading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>;
  if (!error && !totalCount && !isFiltered) return <IdeasEmptyState type="scraped" />;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Collected posts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Browse your sources, open a post, and save what inspires you.</p>
        </div>
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">{totalCount.toLocaleString()} {totalCount === 1 ? "post" : "posts"}{isFiltered ? " matching filters" : " collected"}</span>
      </div>
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); resetPage(); }}
        activeFilters={activeFilters}
        onFilterClick={() => setFilterDialogOpen(true)}
        onClearFilters={() => {
          updateFilters({});
          onClearCreatorFilter?.();
          onClearSearchTermFilter?.();
        }}
        onRemoveFilter={(k) => {
          updateFilters(p => { const u = {...p}; delete u[k]; return u; });
          if (k === 'creator_id') onClearCreatorFilter?.();
          if (k === 'search_term_id') onClearSearchTermFilter?.();
        }}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(c) => { setVisibleColumns(c); saveColumnConfig("scraped_content", c, c); }}
        exportLoader={() => fetchAllMatching(EXPORT_COLUMNS)}
        exportColumns={exportColumns}
        exportFilename="scraped-content"
      />
      {error ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">Couldn't load posts: {error.message}</p></div>
      ) : totalCount === 0 ? (
        <div className="text-center py-20 text-muted-foreground"><p className="text-lg">No content matches your filters.</p></div>
      ) : (
        <div className={cn("transition-opacity", isRefreshing && "opacity-60")}>
          <DataTable
            data={content}
            columns={tableColumns}
            sortConfig={sortConfig}
            onSort={handleSort}
            onRowClick={(c) => { setSelectedContentId(c.id); setDialogOpen(true); }}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            resizable
            tableId="scraped-content-table"
            defaultColumnWidths={{
              title: 420,
              author_name: 160,
              platform: 110,
              "engagement.viewCount": 100,
              "engagement.likeCount": 100,
              "engagement.commentCount": 110,
              duration: 100,
              published_at: 120,
              converted_to_idea: 110,
              analyzed: 90,
              created_at: 120,
            }}
          />
          <TablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalCount}
            onPageChange={setCurrentPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      )}
      <BulkActionsToolbar
        selectedCount={selectedIds.length}
        onDeleteSelected={handleBulkDelete}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
        showReverseEngineerButton
        onReverseEngineer={() => setReverseDialogOpen(true)}
        extraActions={
          <SaveAsIdeaButton
            label={`Save ${selectedIds.length} as idea${selectedIds.length === 1 ? "" : "s"}`}
            saving={saveAsIdeas.isPending}
            onSave={(target) =>
              saveAsIdeas.mutate(
                { contentIds: selectedIds, source: "post", target },
                { onSuccess: () => setSelectedIds([]) },
              )
            }
          />
        }
      />
      <ReverseEngineerBlueprintDialog contentIds={selectedIds} open={reverseDialogOpen} onOpenChange={setReverseDialogOpen} />
      <FilterDialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen} filters={filterConfigs} currentFilters={filters} onApply={updateFilters} />
      <ScrapedContentDetailsDialog content={selectedContent} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
