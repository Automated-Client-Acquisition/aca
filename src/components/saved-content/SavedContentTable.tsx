import { useState, useMemo, useEffect } from "react";
import { useSavedContent } from "@/hooks/useSavedContent";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContentToolbar } from "@/components/ContentToolbar";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { SavedContentDetailDialog } from "./SavedContentDetailDialog";
import { TablePagination } from "@/components/TablePagination";
import { BulkActionsToolbar } from "@/components/BulkActionsToolbar";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { FileText, Image, Video, Music, Star, ExternalLink } from "lucide-react";
import type { SavedContent, SavedContentType, SavedContentData, ImageContentData, VideoContentData, AudioContentData, TextContentData } from "@/types/savedContent";

interface SavedContentTableProps {
  contentType?: SavedContentType;
}

const contentTypeIcons: Record<SavedContentType, React.ReactNode> = {
  text: <FileText className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  audio: <Music className="h-4 w-4" />,
};

const contentTypeColors: Record<SavedContentType, string> = {
  text: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  image: "bg-green-500/10 text-green-600 border-green-500/20",
  video: "bg-primary/10 text-primary border-primary/20",
  audio: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

function getContentPreview(content: SavedContentData, contentType: SavedContentType): string {
  switch (contentType) {
    case "text":
      return (content as TextContentData).text?.substring(0, 100) + "..." || "No text";
    case "image":
      return (content as ImageContentData).prompt || "Image";
    case "video":
      return `Video (${(content as VideoContentData).duration || 0}s)`;
    case "audio":
      return (content as AudioContentData).transcript?.substring(0, 100) + "..." || `Audio (${(content as AudioContentData).duration || 0}s)`;
    default:
      return "Content";
  }
}

function ContentThumbnail({ content, contentType }: { content: SavedContentData; contentType: SavedContentType }) {
  if (contentType === "image") {
    const url = (content as ImageContentData).url;
    return url ? (
      <img src={url} alt="Thumbnail" className="h-10 w-10 rounded object-cover" />
    ) : (
      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
        <Image className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  if (contentType === "video") {
    const thumbnail = (content as VideoContentData).thumbnail_url;
    return thumbnail ? (
      <img src={thumbnail} alt="Video thumbnail" className="h-10 w-10 rounded object-cover" />
    ) : (
      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
        <Video className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
      {contentTypeIcons[contentType]}
    </div>
  );
}

export function SavedContentTable({ contentType }: SavedContentTableProps) {
  const {
    savedContent,
    isLoading,
    updateSavedContent,
    deleteSavedContent,
    deleteBulkSavedContent,
    toggleFavorite,
    isUpdating,
    isDeletingBulk,
  } = useSavedContent(contentType);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>([
    "thumbnail",
    "name",
    "content_type",
    "preview",
    "tags",
    "created_at",
  ]);
  const [selectedItem, setSelectedItem] = useState<SavedContent | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } =
    useTablePagination("saved-content");

  useEffect(() => {
    const saved = loadColumnConfig("saved-content");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, contentType, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "thumbnail", label: "Preview", alwaysVisible: true },
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "content_type", label: "Type" },
    { key: "preview", label: "Content" },
    { key: "tags", label: "Tags" },
    { key: "created_at", label: "Created" },
  ];

  const tableColumns: DataTableColumn[] = [
    {
      key: "thumbnail",
      label: "",
      visible: visibleColumns.includes("thumbnail"),
      render: (_, row) => (
        <ContentThumbnail content={row.content} contentType={row.content_type} />
      ),
    },
    {
      key: "name",
      label: "Name",
      sortable: true,
      visible: visibleColumns.includes("name"),
      render: (v, row) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
            {v}
          </span>
          {row.is_favorite && <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />}
        </div>
      ),
    },
    {
      key: "content_type",
      label: "Type",
      sortable: true,
      visible: visibleColumns.includes("content_type"),
      render: (v: SavedContentType) => (
        <Badge variant="outline" className={`gap-1.5 ${contentTypeColors[v]}`}>
          {contentTypeIcons[v]}
          {v.charAt(0).toUpperCase() + v.slice(1)}
        </Badge>
      ),
    },
    {
      key: "preview",
      label: "Content",
      visible: visibleColumns.includes("preview"),
      render: (_, row) => (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[300px]">
          {getContentPreview(row.content, row.content_type)}
        </span>
      ),
    },
    {
      key: "tags",
      label: "Tags",
      visible: visibleColumns.includes("tags"),
      render: (v: string[]) =>
        v?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {v.slice(0, 3).map((tag: string, idx: number) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {v.length > 3 && (
              <Badge variant="secondary" className="text-xs">
                +{v.length - 3}
              </Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
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
      ),
    },
  ];

  const filteredData = useMemo(() => {
    if (!searchQuery) return savedContent;
    const query = searchQuery.toLowerCase();
    return savedContent.filter(
      (item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [savedContent, searchQuery]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkSavedContent(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "content_type", label: "Type" },
    { key: "description", label: "Description" },
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
        activeFilters={[]}
        onFilterClick={() => {}}
        onClearFilters={() => {}}
        onRemoveFilter={() => {}}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(cols) => {
          setVisibleColumns(cols);
          saveColumnConfig("saved-content", cols, cols);
        }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="saved-content"
      />

      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) =>
          setSortConfig({
            column: col,
            direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc",
          })
        }
        onRowClick={(row) => {
          setSelectedItem(row as SavedContent);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No saved content found. Save content from your jobs to build your library."
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

      <SavedContentDetailDialog
        item={selectedItem}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateSavedContent}
        onDelete={deleteSavedContent}
        onToggleFavorite={toggleFavorite}
        isUpdating={isUpdating}
      />
    </div>
  );
}
