import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useIdeas, ContentIdea } from "@/hooks/useIdeas";
import { useIdeaTags } from "@/hooks/useIdeaTags";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterDialog, FilterConfig } from "@/components/FilterDialog";
import { IdeaDetailsDialog } from "@/components/IdeaDetailsDialog";
import { DataTable, DataTableColumn } from "@/components/DataTable";
import { BulkGenerateDialog } from "@/components/ideas/BulkGenerateDialog";
import { BulkTagsDialog } from "@/components/ideas/BulkTagsDialog";
import { BulkAnalyzeDialog } from "@/components/ideas/BulkAnalyzeDialog";
import { MoveToFolderDialog } from "@/components/ideas/MoveToFolderDialog";
import { AssignToAutopilotDialog } from "@/components/ideas/AssignToAutopilotDialog";
import { RemoveFromAutopilotDialog } from "@/components/ideas/RemoveFromAutopilotDialog";
import { useIdeaFolders } from "@/hooks/useIdeaFolders";
import {
  useAutopilotFuel,
  useIdeaExclusions,
  useIdeaUsage,
} from "@/hooks/useIdeaFeeds";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { SortConfig } from "@/lib/tableUtils";
import {
  sortData,
  loadColumnConfig,
  saveColumnConfig,
  formatDate,
} from "@/lib/tableUtils";
import type { ColumnConfig } from "@/components/ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import {
  autopilotsFedBy,
  duplicateTitleCounts,
  normaliseTitle,
} from "@/lib/idea-feeds";
import {
  Loader2,
  RotateCcw,
  Folder,
  MoreHorizontal,
  Sparkles,
  Zap,
  Pencil,
  X,
  ZapOff,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Lightbulb,
  Telescope,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ColumnSelector } from "@/components/ColumnSelector";
import { ExportButton } from "@/components/ExportButton";
import { IdeaLibraryCard } from "@/components/ideas/IdeaLibraryCard";
import { IdeasSelectionBar } from "@/components/ideas/IdeasSelectionBar";

type IdeaView = "new" | "used" | "review" | "all" | "duplicates";

// Where a saved idea came from (content_ideas.metadata.source).
const SOURCE_LABEL: Record<string, string> = {
  trending: "From Trending",
  post: "From Research",
  signals: "From Signals",
};

// v2: Status and Feeds replaced Brand Voice / Product / Content Angle as the defaults.
const COLUMN_CONFIG_KEY = "ideas-v2";
const DEFAULT_COLUMNS = ["title", "status", "feeds", "created_at", "actions"];

interface IdeasTableProps {
  onAdd?: () => void;
  folderControls?: ReactNode;
  onClearFolder?: () => void;
  folderFilter?: string | null; // null = all, "uncategorized" = no folder, uuid = specific folder
  /** Only ideas that feed this autopilot by tag. */
  feedAutopilotId?: string | null;
  onClearFeed?: () => void;
  /** Choosing unused, unassigned ideas for this autopilot. */
  pickForAutopilotId?: string | null;
  onExitPick?: () => void;
}

export function IdeasTable({
  onAdd,
  folderControls,
  onClearFolder,
  folderFilter,
  feedAutopilotId,
  onClearFeed,
  pickForAutopilotId,
  onExitPick,
}: IdeasTableProps) {
  const navigate = useNavigate();
  const { currentOrganization } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const view: IdeaView = [
    "new",
    "used",
    "review",
    "all",
    "duplicates",
  ].includes(requestedView ?? "")
    ? (requestedView as IdeaView)
    : "all";
  const setView = (next: IdeaView) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "all") params.delete("view");
        else params.set("view", next);
        return params;
      },
      { replace: true },
    );
  const [layout, setLayout] = useState<"cards" | "table">("cards");
  const {
    ideas,
    isLoading,
    error,
    refetch,
    updateIdea,
    isUpdating,
    deleteBulkIdeas,
    isDeletingBulk,
    resetIdeaGeneration,
  } = useIdeas();
  const { data: availableTags = [] } = useIdeaTags();
  const { data: availableFolders = [] } = useIdeaFolders();
  const {
    data: usage,
    error: usageError,
    refetch: refetchUsage,
  } = useIdeaUsage();
  const {
    data: exclusions,
    error: exclusionsError,
    refetch: refetchExclusions,
  } = useIdeaExclusions();
  const {
    data: fuel = [],
    isLoading: feedsLoading,
    error: feedsError,
    refetch: refetchFeeds,
  } = useAutopilotFuel();
  const [selectedIdea, setSelectedIdea] = useState<ContentIdea | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterDialogOpen, setFilterDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    column: null,
    direction: null,
  });
  const [visibleColumns, setVisibleColumns] =
    useState<string[]>(DEFAULT_COLUMNS);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generateDialogOpen, setGenerateDialogOpen] = useState(false);
  const [analyzeDialogOpen, setAnalyzeDialogOpen] = useState(false);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [moveToFolderDialogOpen, setMoveToFolderDialogOpen] = useState(false);
  const [assignIds, setAssignIds] = useState<string[] | null>(null);
  const [removeIds, setRemoveIds] = useState<string[] | null>(null);
  const {
    currentPage,
    pageSize,
    setCurrentPage,
    handlePageSizeChange,
    resetPage,
  } = useTablePagination("ideas");

  useEffect(() => {
    const saved = loadColumnConfig(COLUMN_CONFIG_KEY);
    if (saved)
      setVisibleColumns(
        saved.visible.includes("actions")
          ? saved.visible
          : [...saved.visible, "actions"],
      );
  }, []);

  // Reset to page 1 when filters or search change
  useEffect(() => {
    resetPage();
  }, [
    searchQuery,
    filters,
    view,
    folderFilter,
    feedAutopilotId,
    pickForAutopilotId,
    resetPage,
  ]);

  // A selection always belongs to the visible library scope.
  useEffect(() => {
    setSelectedIds([]);
  }, [
    searchQuery,
    filters,
    view,
    folderFilter,
    feedAutopilotId,
    pickForAutopilotId,
    currentOrganization?.id,
  ]);

  const handleColumnVisibilityChange = (columns: string[]) => {
    const next = columns.includes("actions")
      ? columns
      : [...columns, "actions"];
    setVisibleColumns(next);
    saveColumnConfig(COLUMN_CONFIG_KEY, next, next);
  };

  // Usage, feeds and duplicates per idea, joined once so filters and sorting can use them.
  const duplicates = useMemo(
    () => duplicateTitleCounts(ideas.map((i) => i.title)),
    [ideas],
  );
  const rows = useMemo(
    () =>
      ideas.map((idea) => {
        const u = usage?.get(idea.id);
        const feeds = autopilotsFedBy(
          (idea.tags ?? []).map((t) => t.name),
          fuel,
          exclusions?.get(idea.id),
        );
        return {
          ...idea,
          status: usage ? (u?.used_count ?? 0) : null,
          last_used_at: u?.last_used_at ?? null,
          feeds: feeds.filter((f) => f.viaTag).length,
          _feeds: feeds,
          _duplicate: (duplicates.get(normaliseTitle(idea.title)) ?? 0) > 1,
          _source:
            SOURCE_LABEL[
              (idea as unknown as { metadata?: { source?: string } | null })
                .metadata?.source ?? ""
            ] ?? null,
          // Guidelines a person approved (autopilots can require it)
          _approved: !!idea.guidelines_approved_at,
        };
      }),
    [ideas, usage, fuel, duplicates, exclusions],
  );
  type Row = (typeof rows)[number];

  const pickAutopilot = pickForAutopilotId
    ? fuel.find((f) => f.autopilot_id === pickForAutopilotId)
    : undefined;
  const feedAutopilot = feedAutopilotId
    ? fuel.find((f) => f.autopilot_id === feedAutopilotId)
    : undefined;

  const columnConfigs: ColumnConfig[] = [
    { key: "title", label: "Idea", alwaysVisible: true },
    { key: "status", label: "Content created" },
    { key: "approval", label: "Guidelines" },
    { key: "feeds", label: "Available to autopilots" },
    { key: "folder", label: "Folder" },
    { key: "tags", label: "Tags" },
    { key: "brand_voice", label: "Brand Voice" },
    { key: "product", label: "Product" },
    { key: "content_angle", label: "Content Angle" },
    { key: "priority", label: "Priority" },
    { key: "scripts_count", label: "Scripts" },
    { key: "created_at", label: "Added" },
  ];

  const tableColumns: DataTableColumn<Row>[] = [
    {
      key: "title",
      label: "Idea",
      sortable: true,
      visible: visibleColumns.includes("title"),
      render: (v, row) => {
        const isStale =
          row.generation_in_progress &&
          Date.now() - new Date(row.updated_at).getTime() > 30 * 60 * 1000;

        return (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-left font-medium leading-relaxed text-foreground hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIdea(row);
                setDialogOpen(true);
              }}
            >
              {v}
            </button>
            {row._source && (
              <Badge
                variant="outline"
                className="shrink-0 text-[10px] font-normal text-muted-foreground"
              >
                {row._source}
              </Badge>
            )}
            {row._duplicate && (
              <Badge
                variant="outline"
                className="shrink-0 border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
              >
                Duplicate
              </Badge>
            )}
            {row.generation_in_progress && (
              <div className="flex items-center gap-1">
                <Badge
                  variant="secondary"
                  className={cn(
                    "border bg-primary/10 text-primary border-primary/20 animate-pulse",
                  )}
                >
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  Enriching idea…
                </Badge>
                {isStale && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      resetIdeaGeneration(row.id);
                    }}
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "status",
      label: "Content created",
      sortable: true,
      visible: visibleColumns.includes("status"),
      render: (v: number, row) => (
        <div className="space-y-1">
          {v === null ? (
            <span className="text-xs text-muted-foreground">
              Usage unavailable
            </span>
          ) : v > 0 ? (
            <div className="text-sm">
              <div>Created {v}×</div>
              {row.last_used_at && (
                <div className="text-xs text-muted-foreground">
                  {formatDate(row.last_used_at)}
                </div>
              )}
            </div>
          ) : (
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              Not used yet
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "approval",
      label: "Guidelines",
      visible: visibleColumns.includes("approval"),
      render: (_v, row) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-auto whitespace-normal text-left"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedIdea(row);
            setDialogOpen(true);
          }}
        >
          {row._approved ? "Guidelines approved" : "Review guidelines"}
        </Button>
      ),
    },
    {
      key: "feeds",
      label: "Available to autopilots",
      sortable: true,
      visible: visibleColumns.includes("feeds"),
      render: (_v, row) => {
        const tagged = row._feeds.filter((f) => f.viaTag);
        // A paused autopilot that takes any idea says nothing about this one.
        const anyIdea = row._feeds.filter(
          (f) => !f.viaTag && f.fuel.status === "active",
        );
        if (feedsError || exclusionsError)
          return (
            <span className="text-xs text-muted-foreground">Unavailable</span>
          );
        if (feedsLoading || !exclusions)
          return (
            <span className="text-xs text-muted-foreground">Checking…</span>
          );
        if (tagged.length === 0 && anyIdea.length === 0) {
          return <span className="text-xs text-muted-foreground">None</span>;
        }
        return (
          <div className="flex max-w-[260px] flex-wrap items-center gap-1">
            {tagged.slice(0, 2).map(({ fuel: f }) => (
              <Badge
                key={f.autopilot_id}
                variant="secondary"
                className={cn(
                  "gap-1 text-xs",
                  f.status !== "active" && "opacity-60",
                )}
                title={f.status !== "active" ? `${f.name} (paused)` : f.name}
              >
                <Zap className="h-3 w-3" />
                <span className="max-w-[140px] truncate">{f.name}</span>
              </Badge>
            ))}
            {tagged.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{tagged.length - 2}
              </Badge>
            )}
            {tagged.length === 0 &&
              anyIdea.slice(0, 2).map(({ fuel: f }) => (
                <Badge
                  key={f.autopilot_id}
                  variant="outline"
                  className="gap-1 border-dashed text-xs font-normal text-muted-foreground"
                  title={`${f.name} uses any idea`}
                >
                  <Zap className="h-3 w-3" />
                  <span className="max-w-[140px] truncate">{f.name}</span>
                </Badge>
              ))}
            {tagged.length === 0 && anyIdea.length > 2 && (
              <Badge
                variant="outline"
                className="border-dashed text-xs text-muted-foreground"
              >
                +{anyIdea.length - 2}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "folder",
      label: "Folder",
      visible: visibleColumns.includes("folder"),
      render: (v, row) => {
        if (!row.folder)
          return <span className="text-muted-foreground text-xs">-</span>;
        return (
          <Badge
            variant="secondary"
            className="text-xs"
            style={{
              backgroundColor: `${row.folder.color}15`,
              color: row.folder.color,
              borderColor: `${row.folder.color}30`,
            }}
          >
            <Folder className="w-3 h-3 mr-1" />
            {row.folder.name}
          </Badge>
        );
      },
    },
    {
      key: "tags",
      label: "Tags",
      visible: visibleColumns.includes("tags"),
      render: (v, row) => {
        const tags = row.tags || [];
        if (tags.length === 0)
          return <span className="text-muted-foreground text-xs">-</span>;
        return (
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {tags.slice(0, 3).map((tag) => (
              <Badge
                key={tag.id}
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-xs"
              >
                {tag.name}
              </Badge>
            ))}
            {tags.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{tags.length - 3}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      key: "brand_voice",
      label: "Brand Voice",
      visible: visibleColumns.includes("brand_voice"),
      render: (v, row) =>
        row.brand_voice ? (
          <Badge
            variant="secondary"
            className="bg-primary/10 text-primary border-primary/20"
          >
            {row.brand_voice.name}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      key: "product",
      label: "Product",
      visible: visibleColumns.includes("product"),
      render: (v, row) =>
        row.product ? (
          <Badge
            variant="secondary"
            className="bg-blue-500/10 text-blue-600 border-blue-500/20"
          >
            {row.product.name}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      key: "content_angle",
      label: "Content Angle",
      visible: visibleColumns.includes("content_angle"),
      render: (v, row) =>
        row.content_angle ? (
          <Badge
            variant="secondary"
            className="bg-orange-500/10 text-orange-600 border-orange-500/20"
          >
            {row.content_angle.name}
          </Badge>
        ) : (
          "-"
        ),
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      visible: visibleColumns.includes("priority"),
      render: (v) =>
        v ? (
          <Badge variant="outline" className="font-mono">
            {v}
          </Badge>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
      className: "text-center",
    },
    {
      key: "scripts_count",
      label: "Scripts",
      sortable: true,
      visible: visibleColumns.includes("scripts_count"),
      render: (v) => (
        <span className="font-mono text-sm font-medium">{v || 0}</span>
      ),
      className: "text-center",
    },
    {
      key: "created_at",
      label: "Added",
      sortable: true,
      visible: visibleColumns.includes("created_at"),
      render: (v) => (
        <span className="text-sm text-muted-foreground">{formatDate(v)}</span>
      ),
    },
    {
      key: "actions",
      label: "",
      visible: !pickForAutopilotId,
      className: "w-12",
      render: (_v, row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Actions for ${row.title}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onClick={() => navigate(`/create?ideas=${row.id}`)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Create content now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setAssignIds([row.id])}>
                <Zap className="mr-2 h-4 w-4" />
                Use in an autopilot…
              </DropdownMenuItem>
              {row._feeds.length > 0 && (
                <DropdownMenuItem onClick={() => setRemoveIds([row.id])}>
                  <ZapOff className="mr-2 h-4 w-4" />
                  Remove from an autopilot…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setSelectedIdea(row);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  const exportColumns: ExportColumn[] = tableColumns
    .filter((c) => c.key !== "actions" && visibleColumns.includes(c.key))
    .map((c) => ({ key: c.key, label: c.label }));

  const filterConfigs: FilterConfig[] = useMemo(() => {
    // Deduplicate library elements by ID
    const brandVoicesMap = new Map();
    ideas.forEach((i) => {
      if (i.brand_voice) brandVoicesMap.set(i.brand_voice.id, i.brand_voice);
    });
    const brandVoices = Array.from(brandVoicesMap.values()).map((bv) => ({
      value: bv.id,
      label: bv.name,
    }));

    const productsMap = new Map();
    ideas.forEach((i) => {
      if (i.product) productsMap.set(i.product.id, i.product);
    });
    const products = Array.from(productsMap.values()).map((p) => ({
      value: p.id,
      label: p.name,
    }));

    const contentAnglesMap = new Map();
    ideas.forEach((i) => {
      if (i.content_angle)
        contentAnglesMap.set(i.content_angle.id, i.content_angle);
    });
    const contentAngles = Array.from(contentAnglesMap.values()).map((ca) => ({
      value: ca.id,
      label: ca.name,
    }));

    // Use available tags from the hook
    const tagOptions = availableTags.map((tag) => ({
      value: tag.id,
      label: tag.name,
    }));

    return [
      { key: "tags", label: "Tags", type: "select", options: tagOptions },
      {
        key: "brand_voice",
        label: "Brand Voice",
        type: "select",
        options: brandVoices,
      },
      { key: "product", label: "Product", type: "select", options: products },
      {
        key: "content_angle",
        label: "Content Angle",
        type: "select",
        options: contentAngles,
      },
    ];
  }, [ideas, availableTags]);

  // Folder, search and filter-dialog filters; the view chips count within these.
  const baseRows = useMemo(() => {
    let result = rows;

    // Apply folder filter from sidebar
    if (folderFilter === "uncategorized") {
      result = result.filter((i) => !i.folder_id);
    } else if (folderFilter) {
      result = result.filter((i) => i.folder_id === folderFilter);
    }

    if (feedAutopilotId && !pickForAutopilotId) {
      result = result.filter((i) =>
        i._feeds.some(
          (f) => f.viaTag && f.fuel.autopilot_id === feedAutopilotId,
        ),
      );
    }

    if (searchQuery) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((i) =>
        [
          i.title,
          i.free_text,
          ...(i.keywords ?? []),
          ...(i.tags ?? []).map((t) => t.name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    // Apply folder filter from filter dialog
    if (filters.folder) {
      result = result.filter((i) => i.folder_id === filters.folder);
    }
    if (filters.tags) {
      result = result.filter((i) =>
        i.tags?.some((tag) => tag.id === filters.tags),
      );
    }
    if (filters.brand_voice)
      result = result.filter((i) => i.brand_voice?.id === filters.brand_voice);
    if (filters.product)
      result = result.filter((i) => i.product?.id === filters.product);
    if (filters.content_angle)
      result = result.filter(
        (i) => i.content_angle?.id === filters.content_angle,
      );
    return result;
  }, [
    rows,
    searchQuery,
    filters,
    folderFilter,
    feedAutopilotId,
    pickForAutopilotId,
  ]);

  const viewCounts = useMemo(
    () => ({
      new: baseRows.filter((r) => r.status === 0).length,
      used: baseRows.filter((r) => r.status > 0).length,
      all: baseRows.length,
      duplicates: baseRows.filter((r) => r._duplicate).length,
      review: baseRows.filter((r) => !r._approved).length,
    }),
    [baseRows],
  );

  const filteredIdeas = useMemo(() => {
    if (pickForAutopilotId) {
      // Unused ideas no autopilot draws from by tag: the ones worth handing over.
      return baseRows.filter(
        (r) => r.status === 0 && !r._feeds.some((f) => f.viaTag),
      );
    }
    switch (view) {
      case "new":
        return baseRows.filter((r) => r.status === 0);
      case "used":
        return baseRows.filter((r) => r.status > 0);
      case "duplicates":
        return baseRows.filter((r) => r._duplicate);
      case "review":
        return baseRows.filter((r) => !r._approved);
      default:
        return baseRows;
    }
  }, [baseRows, view, pickForAutopilotId]);

  const sortedIdeas = useMemo(() => {
    if (view === "duplicates" && !sortConfig.column) {
      return [...filteredIdeas].sort((a, b) =>
        normaliseTitle(a.title).localeCompare(normaliseTitle(b.title)),
      );
    }
    return sortData(filteredIdeas, sortConfig);
  }, [filteredIdeas, sortConfig, view]);

  const totalPages = Math.ceil(sortedIdeas.length / pageSize);

  useEffect(() => {
    if (currentPage > Math.max(1, totalPages))
      setCurrentPage(Math.max(1, totalPages));
  }, [currentPage, totalPages, setCurrentPage]);

  const activeFilters = useMemo(() => {
    const active: { key: string; label: string; value: string }[] = [];
    if (filters.folder) {
      const folder = availableFolders.find((f) => f.id === filters.folder);
      if (folder)
        active.push({ key: "folder", label: "Folder", value: folder.name });
    }
    if (filters.tags) {
      const tag = availableTags.find((t) => t.id === filters.tags);
      if (tag) active.push({ key: "tags", label: "Tag", value: tag.name });
    }
    if (filters.brand_voice) {
      const bv = ideas.find(
        (i) => i.brand_voice?.id === filters.brand_voice,
      )?.brand_voice;
      if (bv)
        active.push({
          key: "brand_voice",
          label: "Brand Voice",
          value: bv.name,
        });
    }
    if (filters.product) {
      const p = ideas.find((i) => i.product?.id === filters.product)?.product;
      if (p) active.push({ key: "product", label: "Product", value: p.name });
    }
    if (filters.content_angle) {
      const ca = ideas.find(
        (i) => i.content_angle?.id === filters.content_angle,
      )?.content_angle;
      if (ca)
        active.push({
          key: "content_angle",
          label: "Content Angle",
          value: ca.name,
        });
    }
    return active;
  }, [filters, ideas, availableTags, availableFolders]);

  const handleSort = (column: string) => {
    setSortConfig((prev) => {
      if (prev.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        if (prev.direction === "desc") return { column: null, direction: null };
      }
      return { column, direction: "asc" };
    });
  };

  const handleBulkDelete = () => {
    deleteBulkIdeas(selectedIds);
    setSelectedIds([]);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setFilters({});
    onClearFolder?.();
    onClearFeed?.();
  };
  const openIdea = (idea: ContentIdea) => {
    setSelectedIdea(idea);
    setDialogOpen(true);
  };
  const pageIdeas = sortedIdeas.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const allPageSelected =
    pageIdeas.length > 0 && pageIdeas.every((i) => selectedIds.includes(i.id));
  const togglePage = (checked: boolean) =>
    setSelectedIds((ids) =>
      checked
        ? [...new Set([...ids, ...pageIdeas.map((i) => i.id)])]
        : ids.filter((id) => !pageIdeas.some((i) => i.id === id)),
    );
  const statusesPending = !usage && !usageError;
  const pickingPending =
    !!pickForAutopilotId &&
    (statusesPending || feedsLoading || (!exclusions && !exclusionsError));
  const usageUnavailable = !!usageError && !usage;
  const assignmentUnavailable = !!feedsError || !!exclusionsError;
  const assignmentViewBlocked =
    !!(feedAutopilotId || pickForAutopilotId) && assignmentUnavailable;
  const filteredViewPending =
    (statusesPending && (view === "new" || view === "used")) ||
    (!!feedAutopilotId && (feedsLoading || (!exclusions && !exclusionsError)));
  const filtersActive =
    !!searchQuery ||
    activeFilters.length > 0 ||
    !!folderFilter ||
    !!feedAutopilotId;

  if (isLoading)
    return (
      <div aria-label="Loading ideas" className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-64 rounded-xl" />
        ))}
      </div>
    );
  if (error)
    return (
      <div role="alert" className="rounded-xl border bg-card p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
        <h2 className="font-semibold">Couldn't load your ideas</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Try again to restore your library.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!ideas.length)
    return (
      <div className="rounded-xl border bg-card px-6 py-12 text-center">
        <Lightbulb className="mx-auto mb-4 h-8 w-8 text-amber-700" />
        <h2 className="text-lg font-semibold">Save your first idea</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          An idea is a topic for your next post. Add one here or save
          inspiration from Research, then shape its guidelines and create
          content.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="cta" onClick={onAdd}>
            Add ideas
          </Button>
          <Button variant="outline" asChild>
            <Link to="/research">
              <Telescope className="mr-2 h-4 w-4" />
              Explore Research
            </Link>
          </Button>
          {folderControls}
        </div>
      </div>
    );

  const views: Array<{
    id: IdeaView;
    label: string;
    count: number;
    hidden?: boolean;
  }> = [
    { id: "all", label: "All ideas", count: viewCounts.all },
    { id: "new", label: "Unused", count: viewCounts.new },
    { id: "used", label: "Used", count: viewCounts.used },
    { id: "review", label: "Review guidelines", count: viewCounts.review },
    {
      id: "duplicates",
      label: "Duplicates",
      count: viewCounts.duplicates,
      hidden: viewCounts.duplicates === 0,
    },
  ];

  return (
    <>
      <Tabs
        value={view}
        onValueChange={(next) => setView(next as IdeaView)}
        className="space-y-4"
      >
        {pickForAutopilotId ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-amber-50/50 p-4 dark:bg-amber-950/10">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                Choose ideas for {pickAutopilot?.name ?? "this autopilot"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select unused ideas that have no autopilot tag assignment.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="cta"
                disabled={
                  !selectedIds.length ||
                  pickingPending ||
                  usageUnavailable ||
                  assignmentUnavailable
                }
                onClick={() => setAssignIds(selectedIds)}
              >
                Assign {selectedIds.length || "ideas"}
              </Button>
              <Button variant="outline" onClick={onExitPick}>
                Exit selection
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 overflow-x-auto border-b">
            <TabsList
              aria-label="Idea library views"
              className="h-11 justify-start gap-2 rounded-none bg-transparent p-0 sm:gap-4"
            >
              {views
                .filter((v) => !v.hidden)
                .map((v) => (
                  <TabsTrigger
                    key={v.id}
                    value={v.id}
                    aria-label={
                      v.id === "review"
                        ? `Review guidelines ${v.count}`
                        : undefined
                    }
                    disabled={
                      statusesPending && (v.id === "new" || v.id === "used")
                    }
                    className="h-11 rounded-none border-b-2 border-transparent px-0 text-sm data-[state=active]:border-amber-600 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    {v.id === "review" ? (
                      <>
                        <span className="sm:hidden">Review</span>
                        <span className="hidden sm:inline">{v.label}</span>
                      </>
                    ) : (
                      v.label
                    )}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {!usage && (v.id === "new" || v.id === "used")
                        ? "—"
                        : v.count}
                    </span>
                  </TabsTrigger>
                ))}
            </TabsList>
          </div>
        )}
        <TabsContent value={view} className="mt-0 space-y-4">
          {feedAutopilotId && (
            <div className="flex items-center gap-2 text-sm">
              <Zap className="h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">
                Tagged for {feedAutopilot?.name ?? "this autopilot"}
              </span>
              <Button variant="ghost" size="sm" onClick={onClearFeed}>
                Show all
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search ideas"
                placeholder="Search topics, notes or tags…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            {folderControls}
            <Button
              variant="outline"
              className="h-10 gap-2"
              onClick={() => setFilterDialogOpen(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilters.length > 0 && (
                <span className="text-xs">{activeFilters.length}</span>
              )}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Library options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(300px,calc(100vw-2rem))] space-y-4"
              >
                <h3 className="text-sm font-semibold">Library options</h3>
                <div className="space-y-2">
                  <label htmlFor="idea-sort" className="text-xs font-medium">
                    Sort ideas
                  </label>
                  <Select
                    value={
                      sortConfig.column === "created_at" &&
                      sortConfig.direction === "asc"
                        ? "oldest"
                        : sortConfig.column === "title"
                          ? "title"
                          : sortConfig.column === "status"
                            ? "used"
                            : "newest"
                    }
                    onValueChange={(v) => {
                      setSortConfig(
                        v === "oldest"
                          ? { column: "created_at", direction: "asc" }
                          : v === "title"
                            ? { column: "title", direction: "asc" }
                            : v === "used"
                              ? { column: "status", direction: "desc" }
                              : { column: "created_at", direction: "desc" },
                      );
                      resetPage();
                    }}
                  >
                    <SelectTrigger id="idea-sort">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest first</SelectItem>
                      <SelectItem value="oldest">Oldest first</SelectItem>
                      <SelectItem value="title">Title A–Z</SelectItem>
                      <SelectItem value="used">Most used</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2">
                  {layout === "table" && (
                    <ColumnSelector
                      columns={columnConfigs.map((column) => ({
                        ...column,
                        group: "Idea details",
                      }))}
                      defaultVisibleColumns={DEFAULT_COLUMNS}
                      visibleColumns={visibleColumns}
                      onVisibilityChange={handleColumnVisibilityChange}
                    />
                  )}
                  <ExportButton
                    data={sortedIdeas}
                    columns={exportColumns}
                    filename="content-ideas"
                  />
                </div>
              </PopoverContent>
            </Popover>
          </div>
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {activeFilters.map((f) => (
                <Button
                  key={f.key}
                  variant="outline"
                  size="sm"
                  className="h-auto gap-2 whitespace-normal py-1 text-xs"
                  aria-label={`Remove ${f.label} filter: ${f.value}`}
                  onClick={() =>
                    setFilters((prev) => {
                      const next = { ...prev };
                      delete next[f.key];
                      return next;
                    })
                  }
                >
                  {f.label}: {f.value}
                  <X className="h-3 w-3 shrink-0" />
                </Button>
              ))}
            </div>
          )}
          {usageUnavailable && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            >
              Usage history is unavailable. Your ideas are still here.
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchUsage()}
              >
                Retry usage
              </Button>
            </div>
          )}
          {assignmentUnavailable && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              Couldn't load autopilot availability.
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  refetchExclusions();
                  refetchFeeds();
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {!pickForAutopilotId && (
            <IdeasSelectionBar
              selectedCount={selectedIds.length}
              busy={isDeletingBulk}
              onClear={() => setSelectedIds([])}
              onCreate={() => setGenerateDialogOpen(true)}
              onAnalyze={() => setAnalyzeDialogOpen(true)}
              onTags={() => setTagsDialogOpen(true)}
              onMove={() => setMoveToFolderDialogOpen(true)}
              onAssign={() => setAssignIds(selectedIds)}
              onRemove={() => setRemoveIds(selectedIds)}
              onDelete={handleBulkDelete}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {pageIdeas.length > 0 &&
                !pickingPending &&
                !assignmentViewBlocked && (
                  <label className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      aria-label="Select ideas on this page"
                      checked={
                        allPageSelected
                          ? true
                          : pageIdeas.some((i) => selectedIds.includes(i.id))
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(v) => togglePage(v === true)}
                    />
                    <span>Select page</span>
                  </label>
                )}
              <span aria-live="polite">
                {assignmentViewBlocked
                  ? "Availability unavailable"
                  : filteredViewPending || pickingPending
                    ? "Loading…"
                    : `${sortedIdeas.length} ${sortedIdeas.length === 1 ? "idea" : "ideas"}`}
              </span>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </div>
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label="Library layout"
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", layout === "cards" && "bg-muted")}
                aria-label="Card view"
                aria-pressed={layout === "cards"}
                onClick={() => setLayout("cards")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", layout === "table" && "bg-muted")}
                aria-label="Table view"
                aria-pressed={layout === "table"}
                onClick={() => setLayout("table")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {(view === "review" || view === "used" || view === "new") &&
            !pickForAutopilotId && (
              <p className="text-xs text-muted-foreground">
                {view === "review"
                  ? "These ideas have guidelines awaiting approval. Open an idea to review and approve its talking points."
                  : view === "used"
                    ? "These ideas have already been turned into content. You can reuse them for a new angle or format."
                    : "These ideas haven't been turned into content yet."}
              </p>
            )}
          {assignmentViewBlocked ? (
            <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
              Retry autopilot availability to show matching ideas accurately.
            </p>
          ) : filteredViewPending || pickingPending ? (
            <Skeleton className="h-52 rounded-xl" />
          ) : usageUnavailable &&
            (view === "new" || view === "used" || !!pickForAutopilotId) ? (
            <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
              Retry usage history to show these ideas accurately.
            </p>
          ) : sortedIdeas.length === 0 ? (
            <div className="rounded-xl border bg-card p-8 text-center">
              <h2 className="font-semibold">
                {pickForAutopilotId
                  ? "No unused, unassigned ideas"
                  : filtersActive
                    ? "No matching ideas"
                    : view === "review"
                      ? "All guidelines are approved"
                      : view === "new"
                        ? "Every idea has been used"
                        : view === "used"
                          ? "No content created yet"
                          : "No ideas in this view"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {pickForAutopilotId
                  ? "Add ideas or assign an existing idea from the full library."
                  : filtersActive
                    ? "Try another search or clear your filters."
                    : "Explore the full library or add another topic."}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {filtersActive && (
                  <Button variant="outline" onClick={clearFilters}>
                    Clear filters
                  </Button>
                )}
                {!pickForAutopilotId && view !== "all" && (
                  <Button variant="outline" onClick={() => setView("all")}>
                    View all ideas
                  </Button>
                )}
                <Button variant="cta" onClick={onAdd}>
                  Add ideas
                </Button>
              </div>
            </div>
          ) : (
            <>
              {layout === "cards" ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  {pageIdeas.map((idea) => (
                    <IdeaLibraryCard
                      key={idea.id}
                      idea={idea}
                      selected={selectedIds.includes(idea.id)}
                      onSelect={(checked) =>
                        setSelectedIds((ids) =>
                          checked
                            ? [...new Set([...ids, idea.id])]
                            : ids.filter((id) => id !== idea.id),
                        )
                      }
                      onOpen={() => openIdea(idea)}
                      onCreate={() => navigate(`/create?ideas=${idea.id}`)}
                      onAssign={() => setAssignIds([idea.id])}
                      onRemove={() => setRemoveIds([idea.id])}
                      onResetGeneration={() => resetIdeaGeneration(idea.id)}
                      usedCount={idea.status}
                      approved={idea._approved}
                      sourceLabel={idea._source}
                      duplicate={idea._duplicate}
                      autopilots={idea._feeds
                        .filter((f) => f.viaTag || f.fuel.status === "active")
                        .map((f) => ({
                          id: f.fuel.autopilot_id,
                          name: f.fuel.name,
                          paused: f.fuel.status !== "active",
                        }))}
                      feedsLoading={
                        feedsLoading || !exclusions || assignmentUnavailable
                      }
                      picking={!!pickForAutopilotId}
                    />
                  ))}
                </div>
              ) : (
                <DataTable
                  data={sortedIdeas}
                  columns={tableColumns}
                  sortConfig={sortConfig}
                  onSort={handleSort}
                  onRowClick={(idea) => {
                    if (pickForAutopilotId)
                      setSelectedIds((ids) =>
                        ids.includes(idea.id)
                          ? ids.filter((id) => id !== idea.id)
                          : [...ids, idea.id],
                      );
                    else openIdea(idea);
                  }}
                  selectable
                  selectedIds={selectedIds}
                  onSelectionChange={setSelectedIds}
                  paginated
                  currentPage={currentPage}
                  pageSize={pageSize}
                  resizable
                  tableId="ideas-table-v2"
                  defaultColumnWidths={{
                    title: 400,
                    status: 130,
                    approval: 180,
                    feeds: 200,
                    folder: 120,
                    tags: 200,
                    brand_voice: 150,
                    product: 180,
                    content_angle: 150,
                    priority: 90,
                    scripts_count: 90,
                    created_at: 110,
                    actions: 52,
                  }}
                />
              )}
              <TablePagination
                responsive
                itemLabel="Ideas per page"
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                totalItems={sortedIdeas.length}
                onPageChange={setCurrentPage}
                onPageSizeChange={handlePageSizeChange}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
      <FilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        filters={filterConfigs}
        currentFilters={filters}
        onApply={setFilters}
      />
      <IdeaDetailsDialog
        idea={
          selectedIdea
            ? (ideas.find((i) => i.id === selectedIdea.id) ?? selectedIdea)
            : null
        }
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={updateIdea}
        isUpdating={isUpdating}
      />
      <BulkGenerateDialog
        open={generateDialogOpen}
        onOpenChange={setGenerateDialogOpen}
        selectedIds={selectedIds}
      />
      <BulkAnalyzeDialog
        open={analyzeDialogOpen}
        onOpenChange={setAnalyzeDialogOpen}
        selectedIds={selectedIds}
        onComplete={() => setSelectedIds([])}
      />
      <BulkTagsDialog
        open={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
        selectedIds={selectedIds}
      />
      <MoveToFolderDialog
        open={moveToFolderDialogOpen}
        onOpenChange={setMoveToFolderDialogOpen}
        selectedIds={selectedIds}
        onComplete={() => setSelectedIds([])}
      />
      <RemoveFromAutopilotDialog
        open={!!removeIds}
        onOpenChange={(o) => {
          if (!o) setRemoveIds(null);
        }}
        ideaIds={removeIds ?? []}
        defaultAutopilotId={feedAutopilotId}
        onDone={() => setSelectedIds([])}
      />
      <AssignToAutopilotDialog
        open={!!assignIds}
        onOpenChange={(o) => {
          if (!o) setAssignIds(null);
        }}
        ideaIds={assignIds ?? []}
        autopilotId={pickForAutopilotId ?? feedAutopilotId}
        onDone={() => setSelectedIds([])}
      />
    </>
  );
}
