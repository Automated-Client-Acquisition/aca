import { useState, useMemo, useEffect } from "react";
import { useCharacters } from "@/hooks/useCharacters";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ContentToolbar } from "./ContentToolbar";
import { DataTable, DataTableColumn } from "./DataTable";
import { CharacterDetailsDialog } from "./CharacterDetailsDialog";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { TablePagination } from "./TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import type { ColumnConfig } from "./ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";

interface Character {
  id: string;
  name: string;
  description: string | null;
  visual_style: string | null;
  gender: string | null;
  age_range: string | null;
  build: string | null;
  ethnicity: string | null;
  hair_description: string | null;
  typical_clothing: string | null;
  accessories: any;
  voice_selection: string | null;
  overall_tone: string | null;
  speaking_style: string | null;
  personality: any;
  personality_traits: any;
  expertise: any;
  visual_config: any;
  voice_config: any;
  reference_images: string[] | null;
  reference_videos: string[] | null;
  tags: string[] | null;
  usage_count: number | null;
  created_at: string | null;
}

interface CharactersTableProps {
  onAdd?: () => void;
}

export function CharactersTable({ onAdd }: CharactersTableProps) {
  const { characters, isLoading, updateCharacter, deleteCharacter, isUpdating, deleteBulkCharacters, isDeletingBulk } = useCharacters();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "reference_images", "tags", "description", "visual_style", "gender", "created_at"]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("characters");

  useEffect(() => {
    const saved = loadColumnConfig("characters");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "reference_images", label: "Images" },
    { key: "tags", label: "Tags" },
    { key: "description", label: "Description" },
    { key: "visual_style", label: "Visual Style" },
    { key: "gender", label: "Gender" },
    { key: "created_at", label: "Created" },
  ];

  const tableColumns: DataTableColumn[] = [
    { 
      key: "name", 
      label: "Name", 
      sortable: true, 
      visible: visibleColumns.includes("name"), 
      className: "min-w-[140px]",
      render: (v) => (
        <span className="font-semibold text-foreground group-hover:text-primary transition-colors duration-200">
          {v}
        </span>
      )
    },
    {
      key: "reference_images",
      label: "Images",
      visible: visibleColumns.includes("reference_images"),
      render: (v: string[] | null) => v && v.length > 0 ? (
        <div className="flex gap-1 items-center">
          {v.slice(0, 3).map((url, i) => (
            <div key={i} className="w-9 h-9 shrink-0 rounded-md overflow-hidden border bg-muted">
              <img src={url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
          {v.length > 3 && (
            <span className="ml-1 text-xs text-muted-foreground whitespace-nowrap">+{v.length - 3}</span>
          )}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    {
      key: "tags",
      label: "Tags",
      visible: visibleColumns.includes("tags"),
      render: (v: string[] | null) => v && v.length > 0 ? (
        <div className="flex max-w-xs flex-wrap gap-1">
          {v.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs font-normal">
              {tag}
            </Badge>
          ))}
          {v.length > 3 && <Badge variant="secondary">+{v.length - 3}</Badge>}
        </div>
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      )
    },
    { 
      key: "description", 
      label: "Description", 
      visible: visibleColumns.includes("description"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-xs group-hover:text-foreground transition-colors duration-200">
          {v}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    { 
      key: "visual_style", 
      label: "Visual Style", 
      sortable: true, 
      visible: visibleColumns.includes("visual_style"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[200px]">{v}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    { 
      key: "gender", 
      label: "Gender", 
      visible: visibleColumns.includes("gender"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground capitalize">{v}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
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
    let result = characters;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    }
    return result;
  }, [characters, searchQuery]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "tags", label: "Tags", exportFormat: (v) => v?.join(", ") || "" },
    { key: "visual_style", label: "Visual Style" },
    { key: "gender", label: "Gender" },
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
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("characters", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="characters"
      />
      {selectedIds.length > 0 && (
        <BulkActionsToolbar
          selectedCount={selectedIds.length}
          onDeleteSelected={() => {
            deleteBulkCharacters(selectedIds);
            setSelectedIds([]);
          }}
          onDeselectAll={() => setSelectedIds([])}
          isDeleting={isDeletingBulk}
        />
      )}
      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedCharacter(row as Character);
          setDetailsDialogOpen(true);
        }}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        emptyMessage="No characters found. Create your first character to get started."
        emptyState={onAdd ? <AssetEmptyState type="characters" onAdd={onAdd} /> : undefined}
      />
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={sortedData.length}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
      />
      <CharacterDetailsDialog
        character={selectedCharacter}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateCharacter}
        onDelete={deleteCharacter}
        isUpdating={isUpdating}
      />
    </div>
  );
}
