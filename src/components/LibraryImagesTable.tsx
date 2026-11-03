import { useState, useMemo, useEffect } from "react";
import { Images } from "lucide-react";
import { useLibraryImages, type LibraryImage } from "@/hooks/useLibraryImages";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ContentToolbar } from "./ContentToolbar";
import { LibraryImageDetailsDialog } from "./LibraryImageDetailsDialog";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { TablePagination } from "./TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import { formatDate } from "@/lib/tableUtils";
import type { ExportColumn } from "@/lib/exportUtils";

interface LibraryImagesTableProps {
  onAdd?: () => void;
}

/** Reference images as a grid: you pick these by how they look, so the picture leads. */
export function LibraryImagesTable({ onAdd }: LibraryImagesTableProps) {
  const { libraryImages, isLoading, updateLibraryImage, deleteLibraryImage, isUpdating, deleteBulkLibraryImages, isDeletingBulk } = useLibraryImages();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLibraryImage, setSelectedLibraryImage] = useState<LibraryImage | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("library-images");

  const filteredData = useMemo(() => {
    let result = libraryImages;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }
    return result;
  }, [libraryImages, searchQuery]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredData.slice(startIndex, startIndex + pageSize);
  }, [filteredData, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredData.length / pageSize);

  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "tags", label: "Tags", exportFormat: (v) => v?.join(", ") || "" },
    { key: "created_at", label: "Added", exportFormat: formatDate },
  ];

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (libraryImages.length === 0 && onAdd) return <AssetEmptyState type="images" onAdd={onAdd} />;

  return (
    <div className="space-y-4">
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        exportData={filteredData}
        exportColumns={exportColumns}
        exportFilename="library-images"
      />

      {filteredData.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No images match "{searchQuery}".</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {paginatedData.map((item) => {
            const selected = selectedIds.includes(item.id);
            const cover = item.images?.[0];
            return (
              <div
                key={item.id}
                className={cn(
                  "group relative overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md",
                  selected && "ring-2 ring-primary",
                )}
              >
                <button
                  type="button"
                  className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => {
                    setSelectedLibraryImage(item);
                    setDetailsDialogOpen(true);
                  }}
                >
                  <div className="relative aspect-[4/3] bg-muted">
                    {cover ? (
                      <img src={cover} alt={item.name} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Images className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    {item.images?.length > 1 && (
                      <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                        <Images className="h-3 w-3" />
                        {item.images.length}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5 p-3">
                    <p className="truncate text-sm font-medium" title={item.name}>
                      {item.name}
                    </p>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.tags?.length ? item.tags.slice(0, 2).join(" · ") : "No tags"}</span>
                      <span className="shrink-0">{formatDate(item.created_at)}</span>
                    </div>
                  </div>
                </button>
                <div
                  className={cn(
                    "absolute left-2 top-2 rounded-md bg-background/90 p-1 shadow-sm transition-opacity",
                    selected || selectedIds.length > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
                  )}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={() => toggleSelected(item.id)}
                    aria-label={`Select ${item.name}`}
                    className="block"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredData.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
      />
      <BulkActionsToolbar
        selectedCount={selectedIds.length}
        onDeleteSelected={() => {
          deleteBulkLibraryImages(selectedIds);
          setSelectedIds([]);
        }}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
      />
      <LibraryImageDetailsDialog
        libraryImage={selectedLibraryImage}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateLibraryImage}
        onDelete={deleteLibraryImage}
        isUpdating={isUpdating}
      />
    </div>
  );
}
