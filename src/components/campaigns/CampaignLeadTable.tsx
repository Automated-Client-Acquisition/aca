import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  usePaginatedCampaignProgress,
  useUpdateCampaignLeadStatus,
  useRemoveCampaignLead,
  useBulkRemoveCampaignLeads,
  useBulkUpdateCampaignLeadStatus,
} from "@/hooks/useCampaignProgress";
import type { ProgressStatus, CampaignLeadFilter, CampaignProgressStats, SortField, SortDir } from "@/hooks/useCampaignProgress";
import { useLeadListMembers } from "@/hooks/useLeadListMembers";
import { useLeadLists } from "@/hooks/useLeadLists";
import type { SequenceNode, SequenceEdge } from "@/lib/sequence-utils";
import { TablePagination } from "@/components/TablePagination";
import {
  Search,
  MoreHorizontal,
  Trash2,
  Users,
  X,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Clock,
  Loader2,
  SkipForward,
  RotateCcw,
  RefreshCw,
  Unplug,
  ExternalLink,
  UserCheck,
  UserPlus,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isFilteredOut } from "@/lib/sequence-utils";
import { formatDistanceToNow } from "date-fns";
import { CampaignLeadDetailSheet } from "@/components/campaigns/CampaignLeadDetailSheet";
import type { CampaignLeadProgress } from "@/hooks/useCampaignProgress";

interface CampaignLeadTableProps {
  campaignId: string;
  leadListId?: string | null;
  leadListName?: string | null;
  leadListIds?: string[];
  totalEnrolled?: number;
  stats?: CampaignProgressStats;
  statusFilter?: CampaignLeadFilter;
  onStatusFilterChange?: (filter: CampaignLeadFilter) => void;
  sequenceNodes?: SequenceNode[];
  sequenceEdges?: SequenceEdge[];
  /** When true, the campaign is actively processing — poll for live updates. */
  isActive?: boolean;
}

// Friendly, present-tense labels for what a lead is doing on each node type.
const NODE_ACTIVITY_LABELS: Record<string, string> = {
  analyzeContact: "Analyzing contact",
  generateEmails: "Generating emails",
  connectionRequest: "Sending connection",
  message: "Sending message",
  inmail: "Sending InMail",
  email: "Sending email",
  whatsappMessage: "Sending WhatsApp",
  instagramDm: "Sending Instagram DM",
};

const STATUS_BADGES: Record<ProgressStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20" },
  in_progress: { label: "In Progress", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  waiting: { label: "Waiting", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  completed: { label: "Completed", color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20" },
  failed: { label: "Failed", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  replied: { label: "Replied", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
  skipped: { label: "Skipped", color: "bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/20" },
  handed_off: { label: "Handed Off", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
  pending_review: { label: "Awaiting Review", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
  sender_disconnected: { label: "Sender Disconnected", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20" },
};

// Synthetic badge for leads that exited via a dead-end condition branch. Not a
// real DB status — derived from a "completed" lead whose error_message carries
// the "Filtered out at …" marker (see isFilteredOut).
const FILTERED_BADGE = { label: "Filtered", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" };

const COLUMNS = [
  { key: "lead", label: "Lead", defaultWidth: 240, minWidth: 140 },
  { key: "status", label: "Status", defaultWidth: 140, minWidth: 90 },
  { key: "sender", label: "Sender", defaultWidth: 160, minWidth: 100 },
  { key: "nextAction", label: "Next Action", defaultWidth: 150, minWidth: 100 },
] as const;

export function CampaignLeadTable({ campaignId, leadListId, leadListName, leadListIds, totalEnrolled,
  stats, statusFilter: controlledStatusFilter, onStatusFilterChange, sequenceNodes, sequenceEdges,
  isActive }: CampaignLeadTableProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const updateStatusMutation = useUpdateCampaignLeadStatus();
  const removeMutation = useRemoveCampaignLead();
  const bulkRemoveMutation = useBulkRemoveCampaignLeads();
  const bulkUpdateStatusMutation = useBulkUpdateCampaignLeadStatus();

  const [selectedLead, setSelectedLead] = useState<CampaignLeadProgress | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [localStatusFilter, setLocalStatusFilter] = useState<CampaignLeadFilter>("all");
  const statusFilter = controlledStatusFilter ?? localStatusFilter;
  const sourceIds = leadListIds?.length ? leadListIds : leadListId ? [leadListId] : [];
  const [previewListId, setPreviewListId] = useState(leadListId || sourceIds[0] || "");
  const selectedSourceId = sourceIds.includes(previewListId) ? previewListId : sourceIds[0];
  const [unfilteredTotal, setUnfilteredTotal] = useState<number | null>(null);
  // Audience mode is independent of the current search/filter result.
  const enrolledTotal = totalEnrolled ?? stats?.total ?? unfilteredTotal;
  const showListFallback = enrolledTotal === 0 && sourceIds.length > 0;
  const { leadLists } = useLeadLists(showListFallback);
  const selectedSourceName = leadLists.find(list => list.id === selectedSourceId)?.name
    || (selectedSourceId === leadListId ? leadListName : null) || "Source list";
  const [sortBy, setSortBy] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const handleSortByNextAction = () => {
    if (sortBy === "next_action_at") {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy("next_action_at");
      setSortDir("asc");
    }
    setPage(1);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Primary: campaign progress rows
  const { data: result, isLoading, isFetching, isPlaceholderData, isError, refetch } = usePaginatedCampaignProgress(campaignId, {
    page,
    pageSize,
    search: debouncedSearch || undefined,
    status: statusFilter === "all" ? undefined : statusFilter,
    sortBy,
    sortDir,
  }, { live: isActive, enabled: !showListFallback });

  // Map node id -> node type so we can label what an in-progress lead is doing.
  const nodeTypeById = useMemo(() => {
    const map: Record<string, string> = {};
    (sequenceNodes || []).forEach((n) => {
      if (n?.id) map[n.id] = n.type;
    });
    return map;
  }, [sequenceNodes]);

  const getActivityLabel = (lead: CampaignLeadProgress): string | null => {
    if (lead.status !== "in_progress" || !lead.current_node_id) return null;
    const nodeType = nodeTypeById[lead.current_node_id];
    return (nodeType && NODE_ACTIVITY_LABELS[nodeType]) || "Processing";
  };

  useEffect(() => {
    if (!isPlaceholderData && result && statusFilter === "all" && !debouncedSearch) {
      setUnfilteredTotal(result.total);
    }
  }, [result, statusFilter, debouncedSearch, isPlaceholderData]);

  const { data: listResult, isLoading: listLoading, isFetching: listFetching,
    isError: listError, refetch: refetchList } = useLeadListMembers(
    showListFallback ? selectedSourceId : null,
    { page, pageSize, search: search || undefined },
  );

  const leads = useMemo(() => result?.data || [], [result?.data]);
  const totalItems = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;

  // Fallback list data
  const listMembers = listResult?.data || [];
  const listTotalItems = listResult?.total ?? 0;
  const listTotalPages = listResult?.totalPages ?? 0;

  // Column resize
  const [columnWidths, setColumnWidths] = useState<number[]>(
    () => COLUMNS.map((c) => c.defaultWidth),
  );
  const resizeRef = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback(
    (colIdx: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { colIdx, startX: e.clientX, startWidth: columnWidths[colIdx] };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const diff = ev.clientX - resizeRef.current.startX;
        const newWidth = Math.max(
          COLUMNS[resizeRef.current.colIdx].minWidth,
          resizeRef.current.startWidth + diff,
        );
        setColumnWidths((prev) => {
          const next = [...prev];
          next[resizeRef.current!.colIdx] = newWidth;
          return next;
        });
      };

      const onMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths],
  );

  // Selection
  const pageIds = useMemo(() => new Set(leads.map((l) => l.id)), [leads]);
  const allPageSelected = pageIds.size > 0 && [...pageIds].every((id) => selectedIds.has(id));
  const somePageSelected = [...pageIds].some((id) => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds(previous => new Set([...previous].filter(id => pageIds.has(id))));
  }, [pageIds]);

  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        pageIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());
  const setStatusFilter = (filter: CampaignLeadFilter) => {
    setLocalStatusFilter(filter);
    onStatusFilterChange?.(filter);
    setPage(1);
    clearSelection();
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [campaignId, page, pageSize, search, statusFilter, sortBy, sortDir, selectedSourceId]);

  useEffect(() => {
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setLocalStatusFilter("all");
    setUnfilteredTotal(null);
    setPreviewListId("");
    setSelectedLead(null);
    setDetailSheetOpen(false);
  }, [campaignId]);

  const selectedLeads = leads.filter(lead => selectedIds.has(lead.id));
  const skippableIds = selectedLeads.filter(lead => ["pending", "waiting", "in_progress"].includes(lead.status)).map(lead => lead.id);
  const resettableIds = selectedLeads.filter(lead => ["failed", "skipped", "completed", "sender_disconnected"].includes(lead.status)).map(lead => lead.id);
  const reassignableIds = selectedLeads.filter(lead => lead.status === "sender_disconnected").map(lead => lead.id);
  const isMutating = bulkRemoveMutation.isPending || bulkUpdateStatusMutation.isPending
    || updateStatusMutation.isPending || removeMutation.isPending;
  const isRefreshing = showListFallback ? listFetching : isFetching;
  const bodyLoading = showListFallback ? listLoading : isLoading;
  const bodyError = showListFallback ? listError : isError;
  const visibleTotal = showListFallback ? listTotalItems : totalItems;
  const retry = () => {
    if (!showListFallback) return refetch();
    queryClient.refetchQueries({ queryKey: ["lead-list-members-count", selectedSourceId], type: "active" });
    return refetchList();
  };
  const hasFilters = !!search || statusFilter !== "all";
  const clearFilters = () => { setSearch(""); setStatusFilter("all"); setPage(1); };
  const views: Array<{ filter: CampaignLeadFilter; label: string; count?: number }> = [
    { filter: "all", label: "All leads", count: stats?.total ?? totalEnrolled },
    { filter: "in_sequence", label: "In sequence", count: stats ? stats.pending + stats.inProgress + stats.waiting : undefined },
    { filter: "replied", label: "Replied", count: stats?.replied },
    { filter: "failed", label: "Failed", count: stats?.failed },
    { filter: "filtered", label: "Filtered", count: stats?.filteredOut },
  ];

  const handleBulkRemove = () => {
    if (selectedLeads.length === 0) return;
    bulkRemoveMutation.mutate(
      { ids: selectedLeads.map(lead => lead.id), campaignId },
      { onSuccess: () => { clearSelection(); setRemoveDialogOpen(false); } },
    );
  };

  const handleBulkSkip = () => {
    const applicable = skippableIds;
    if (applicable.length === 0) return;
    bulkUpdateStatusMutation.mutate(
      { ids: applicable, campaignId, status: "skipped" },
      { onSuccess: clearSelection },
    );
  };

  const handleBulkReset = () => {
    const applicable = resettableIds;
    if (applicable.length === 0) return;
    bulkUpdateStatusMutation.mutate(
      { ids: applicable, campaignId, status: "pending" },
      { onSuccess: clearSelection },
    );
  };

  const handleBulkReassign = () => {
    const applicable = reassignableIds;
    if (applicable.length === 0) return;
    bulkUpdateStatusMutation.mutate(
      { ids: applicable, campaignId, status: "pending" },
      { onSuccess: clearSelection },
    );
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    clearSelection();
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
    clearSelection();
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm" aria-busy={isRefreshing}>
      <div className="space-y-4 border-b px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <h2 className="text-sm font-semibold">{showListFallback ? "Audience preview" : "Campaign leads"}</h2>
            {enrolledTotal !== null && !showListFallback && (
              <Badge variant="secondary" className="rounded-md px-2 text-xs font-medium tabular-nums">
                {enrolledTotal.toLocaleString()}
              </Badge>
            )}
            {isRefreshing && <Loader2 aria-label="Updating leads" className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search campaign leads" placeholder="Search name, company or email…"
                value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                className="h-9 bg-background pl-9 pr-8" />
              {search && <Button variant="ghost" size="icon" aria-label="Clear search"
                className="absolute right-0.5 top-0.5 h-8 w-8" onClick={() => setSearch("")}>
                <X className="h-3.5 w-3.5" />
              </Button>}
            </div>
            {!showListFallback && <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CampaignLeadFilter)}>
              <SelectTrigger aria-label="Filter leads by status" className="h-9 w-[165px] bg-background">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="in_sequence">In sequence</SelectItem>
                <SelectItem value="filtered">Filtered out</SelectItem>
                {(Object.keys(STATUS_BADGES) as ProgressStatus[]).map(status => (
                  <SelectItem key={status} value={status}>{STATUS_BADGES[status].label}</SelectItem>
                ))}
                <SelectItem value="sequence_changed">Sequence changed</SelectItem>
              </SelectContent>
            </Select>}
          </div>
        </div>
        {showListFallback ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
              Previewing {sourceIds.length > 1 ? "one source list" : "the source list"}. These contacts are not enrolled yet; exclusions apply when the campaign starts.
            </p>
            {sourceIds.length > 1 ? (
              <Select value={selectedSourceId} onValueChange={(value) => { setPreviewListId(value); setPage(1); }}>
                <SelectTrigger aria-label="Preview source list" className="h-8 w-full max-w-[260px] bg-background text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{sourceIds.map((sourceId, index) => <SelectItem key={sourceId} value={sourceId}>
                  {leadLists.find(list => list.id === sourceId)?.name || (sourceId === leadListId ? leadListName : null) || `Source list ${index + 1}`}
                </SelectItem>)}</SelectContent>
              </Select>
            ) : <Badge variant="outline" className="max-w-full truncate text-xs">{selectedSourceName}</Badge>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1" aria-label="Lead views">
              {views.map(view => <button key={view.filter} type="button"
                onClick={() => setStatusFilter(view.filter)} aria-pressed={statusFilter === view.filter}
                className={cn("inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  statusFilter === view.filter ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {view.label}{view.count !== undefined && <span className="tabular-nums opacity-70">{view.count.toLocaleString()}</span>}
              </button>)}
            </div>
            {!bodyLoading && !bodyError && !isRefreshing && hasFilters && (
              <span className="text-xs text-muted-foreground">{visibleTotal.toLocaleString()} matching</span>
            )}
          </div>
        )}
      </div>
      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="border-b bg-muted/25 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="h-7 px-3 text-sm font-medium">
                {selectedIds.size} selected
              </Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearSelection} aria-label="Clear selection">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="h-6 w-px bg-border" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="cta" size="sm">
                  Actions
                  <ChevronDown className="h-4 w-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-48">
                <DropdownMenuItem disabled={skippableIds.length === 0 || isMutating || isRefreshing} onClick={() => setTimeout(handleBulkSkip, 0)}>
                  <SkipForward className="h-4 w-4 mr-2" />
                  Skip {skippableIds.length} lead{skippableIds.length === 1 ? "" : "s"}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={resettableIds.length === 0 || isMutating || isRefreshing} onClick={() => setTimeout(handleBulkReset, 0)}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset {resettableIds.length} to pending
                </DropdownMenuItem>
                <DropdownMenuItem disabled={reassignableIds.length === 0 || isMutating || isRefreshing} onClick={() => setTimeout(handleBulkReassign, 0)}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reassign {reassignableIds.length} sender{reassignableIds.length === 1 ? "" : "s"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setTimeout(() => setRemoveDialogOpen(true), 0)}
                  disabled={selectedLeads.length === 0 || isMutating || isRefreshing}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove Selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {bodyError ? (
        <div className="flex flex-col items-center gap-3 px-5 py-12 text-center" role="alert">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <div><h3 className="text-sm font-semibold">Couldn’t load {showListFallback ? "the audience preview" : "campaign leads"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">Try again to refresh this view.</p></div>
          <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
        </div>
      ) : bodyLoading ? (
        <div className="space-y-4 px-5 py-5" aria-label="Loading campaign leads">
          {[1, 2, 3, 4, 5].map(row => <div key={row} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-8 flex-1" />
          </div>)}
        </div>
      ) : showListFallback ? (
        <div className="overflow-hidden">
          <div className="overflow-auto">
            <table
              className="w-full caption-bottom text-sm"
              style={{ tableLayout: "fixed", minWidth: "500px" }}
            >
              <thead className="[&_tr]:border-b sticky top-0 z-10 bg-muted/35">
                <tr className="border-b">
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" style={{ width: 280 }}>
                    Lead
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" style={{ width: 180 }}>
                    Email
                  </th>
                  <th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground" style={{ width: 120 }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {listMembers.map((member) => {
                  const c = member.contact;
                  const displayName =
                    c?.first_name || c?.last_name
                      ? `${c?.first_name || ""} ${c?.last_name || ""}`.trim()
                      : c?.display_name || "Unknown";
                  const initials =
                    (c?.first_name?.[0] || "") + (c?.last_name?.[0] || "") ||
                    c?.display_name?.[0] || "?";

                  return (
                    <tr
                      key={member.id}
                      className="border-b transition-colors cursor-pointer hover:bg-muted/50"
                      onClick={() => c?.id && navigate(`/contacts/${c.id}`)}
                    >
                      <td className="px-4 py-3 align-middle" style={{ width: 280 }}>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarImage src={c?.avatar_url || undefined} alt="" referrerPolicy="no-referrer" />
                            <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={(event) => { event.stopPropagation(); if (c?.id) navigate(`/contacts/${c.id}`); }}>
                              {displayName}
                            </button>
                            {c?.job_title && <p className="text-xs text-muted-foreground truncate">{c.job_title}</p>}
                            {c?.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle" style={{ width: 180 }}>
                        <span className="text-xs text-muted-foreground truncate block">{c?.primary_email || "--"}</span>
                      </td>
                      <td className="px-4 py-3 align-middle" style={{ width: 120 }}>
                        <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-500 dark:text-gray-400 border-gray-500/20">
                          Source preview
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
                {listMembers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      {search ? `No leads match “${search}”` : "This source list has no contacts yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {listTotalItems > 0 && (
            <TablePagination
              currentPage={page}
              totalPages={Math.max(1, listTotalPages)}
              responsive
              pageSize={pageSize}
              totalItems={listTotalItems}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </div>
      ) : totalItems === 0 && !hasFilters ? (
        <div className="flex flex-col items-center px-5 py-14 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-muted"><Users className="h-5 w-5 text-muted-foreground" /></div>
          <h3 className="text-sm font-semibold">No leads enrolled yet</h3>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            {isActive ? "Leads will appear here as the campaign prepares its audience or receives contacts from a connected list workflow." : "Choose a source list or route a list workflow to this campaign to build your audience."}
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate(`/campaigns/${campaignId}/edit`)}>Manage lead sources</Button>
        </div>
      ) : (
      <div className="overflow-hidden">
        <div className="overflow-auto">
          <table
            className="w-full caption-bottom text-sm"
            style={{
              tableLayout: "fixed",
              minWidth: `${columnWidths.reduce((s, w) => s + w, 0) + 40 + 40}px`,
            }}
          >
            <thead className="[&_tr]:border-b sticky top-0 z-10 bg-muted/35">
              <tr className="border-b">
                <th
                  className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-10"
                  style={{ width: 40 }}
                >
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select this page"
                    disabled={isRefreshing || isMutating}
                  />
                </th>
                {COLUMNS.map((col, colIdx) => (
                  <th
                    key={col.key}
                    className="h-10 px-4 text-left align-middle font-medium text-muted-foreground relative select-none"
                    style={{ width: columnWidths[colIdx] }}
                  >
                    {col.key === "nextAction" ? (
                      <button
                        className="flex items-center gap-1 hover:text-foreground transition-colors"
                        onClick={handleSortByNextAction}
                      >
                        {col.label}
                        {sortBy === "next_action_at" ? (
                          sortDir === "asc" ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
                      onMouseDown={(e) => handleResizeStart(colIdx, e)}
                    />
                  </th>
                ))}
                <th
                  className="h-10 px-4 text-left align-middle font-medium text-muted-foreground w-10"
                  style={{ width: 40 }}
                />
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {leads.map((lead) => {
                const filtered = lead.status === "completed" && isFilteredOut(lead.error_message);
                const statusConfig = filtered
                  ? FILTERED_BADGE
                  : STATUS_BADGES[lead.status] || STATUS_BADGES.pending;
                const isSelected = selectedIds.has(lead.id);
                const contact = lead.contact;
                const displayName =
                  contact?.first_name || contact?.last_name
                    ? `${contact?.first_name || ""} ${contact?.last_name || ""}`.trim()
                    : contact?.display_name || "Unknown";
                const initials =
                  (contact?.first_name?.[0] || "") + (contact?.last_name?.[0] || "") ||
                  contact?.display_name?.[0] ||
                  "?";

                return (
                  <tr
                    key={lead.id}
                    className={cn(
                      "border-b transition-colors cursor-pointer hover:bg-muted/50",
                      isSelected && "bg-muted/30",
                    )}
                    onClick={() => {
                      setSelectedLead(lead);
                      setDetailSheetOpen(true);
                    }}
                  >
                    <td
                      className="px-4 py-3 align-middle w-10"
                      style={{ width: 40 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${displayName}`}
                        disabled={isRefreshing || isMutating}
                      />
                    </td>

                    {/* Lead */}
                    <td className="px-4 py-3 align-middle overflow-hidden" style={{ width: columnWidths[0] }}>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={contact?.avatar_url || undefined} alt="" referrerPolicy="no-referrer" />
                          <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <button type="button" className="block max-w-full truncate text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={(event) => { event.stopPropagation(); setSelectedLead(lead); setDetailSheetOpen(true); }}>
                            {displayName}
                          </button>
                          {contact?.job_title && (
                            <p className="text-xs text-muted-foreground truncate">
                              {contact.job_title}
                            </p>
                          )}
                          {contact?.company && (
                            <p className="text-xs text-muted-foreground truncate">
                              {contact.company}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 align-middle overflow-hidden" style={{ width: columnWidths[1] }}>
                      <Badge variant="outline" className={cn("text-xs", statusConfig.color)}>
                        {statusConfig.label}
                      </Badge>
                      {lead.connection_sent_at && (
                        <div className="flex items-center gap-1 mt-1">
                          {lead.connection_accepted_at ? (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5">
                              <UserCheck className="h-3 w-3" />
                              Connected
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                              <UserPlus className="h-3 w-3" />
                              Pending
                            </span>
                          )}
                        </div>
                      )}
                      {lead.error_message && (
                        <p
                          className={cn(
                            "text-[10px] mt-1 truncate",
                            filtered ? "text-amber-600 dark:text-amber-400" : "text-destructive",
                          )}
                          title={lead.error_message}
                        >
                          {lead.error_message}
                        </p>
                      )}
                    </td>

                    {/* Sender */}
                    <td className="px-4 py-3 align-middle overflow-hidden" style={{ width: columnWidths[2] }}>
                      <span className="text-xs text-muted-foreground truncate block">
                        {lead.sender_account?.display_name || "--"}
                      </span>
                      {lead.sender_account && lead.sender_account.status !== 'active' && (
                        <span className="text-[10px] text-orange-600 dark:text-orange-400 flex items-center gap-0.5 mt-0.5">
                          <Unplug className="h-3 w-3" />
                          Disconnected
                        </span>
                      )}
                    </td>

                    {/* Next Action */}
                    <td className="px-4 py-3 align-middle overflow-hidden" style={{ width: columnWidths[3] }}>
                      {(() => {
                        const activity = getActivityLabel(lead);
                        if (activity) {
                          return (
                            <span className="text-xs flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium">
                              <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin" />
                              {activity}…
                            </span>
                          );
                        }
                        if (["pending", "waiting", "in_progress"].includes(lead.status) && lead.connection_sent_at && !lead.connection_accepted_at) {
                          return (
                            <span className="text-xs flex items-center gap-1 text-blue-500">
                              <UserPlus className="h-3 w-3 flex-shrink-0" />
                              Awaiting connection
                            </span>
                          );
                        }
                        // Terminal states have no upcoming action.
                        const TERMINAL = ["completed", "failed", "replied", "skipped", "handed_off", "pending_review", "sender_disconnected"];
                        if (TERMINAL.includes(lead.status)) {
                          return <span className="text-xs text-muted-foreground">--</span>;
                        }
                        if (lead.next_action_at) {
                          const due = new Date(lead.next_action_at);
                          // Future schedule (a real delay) → show the countdown.
                          if (due.getTime() > Date.now()) {
                            return (
                              <span className="text-xs flex items-center gap-1 text-muted-foreground">
                                <Clock className="h-3 w-3 flex-shrink-0" />
                                {formatDistanceToNow(due, { addSuffix: true })}
                              </span>
                            );
                          }
                          // Past due time just means the lead is queued for the next
                          // processing pass — not late. Showing "16 minutes ago" is
                          // misleading, so surface it as queued instead.
                          return (
                            <span className="text-xs flex items-center gap-1 text-muted-foreground">
                              <Clock className="h-3 w-3 flex-shrink-0" />
                              Processing soon
                            </span>
                          );
                        }
                        return <span className="text-xs text-muted-foreground">--</span>;
                      })()}
                    </td>

                    {/* Actions */}
                    <td
                      className="px-4 py-3 align-middle w-10"
                      style={{ width: 40 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${displayName}`} disabled={isRefreshing || isMutating}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {contact?.linkedin_url && (
                            <DropdownMenuItem
                              onClick={() => window.open(contact.linkedin_url, "_blank")}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              Open LinkedIn
                            </DropdownMenuItem>
                          )}
                          {contact?.id && (
                            <DropdownMenuItem
                              onClick={() => setTimeout(() => navigate(`/contacts/${contact.id}`), 0)}
                            >
                              <Users className="h-4 w-4 mr-2" />
                              View Contact
                            </DropdownMenuItem>
                          )}
                          {["pending", "waiting", "in_progress"].includes(lead.status) && (
                            <DropdownMenuItem
                              onClick={() =>
                                setTimeout(() => updateStatusMutation.mutate({
                                  id: lead.id,
                                  campaignId,
                                  status: "skipped",
                                }), 0)
                              }
                            >
                              <SkipForward className="h-4 w-4 mr-2" />
                              Skip
                            </DropdownMenuItem>
                          )}
                          {["failed", "skipped", "completed"].includes(lead.status) && (
                            <DropdownMenuItem
                              onClick={() =>
                                setTimeout(() => updateStatusMutation.mutate({
                                  id: lead.id,
                                  campaignId,
                                  status: "pending",
                                }), 0)
                              }
                            >
                              <RotateCcw className="h-4 w-4 mr-2" />
                              Reset to Pending
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setTimeout(() => removeMutation.mutate({ id: lead.id, campaignId }), 0)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              {leads.length === 0 && (debouncedSearch || statusFilter !== "all") && (
                <tr>
                  <td
                    colSpan={COLUMNS.length + 2}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No leads match the current filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalItems > 0 && (
          <TablePagination
            currentPage={page}
            totalPages={Math.max(1, totalPages)}
            responsive
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </div>

      )}
      {!bodyLoading && !bodyError && !isRefreshing && visibleTotal === 0 && hasFilters && (
        <div className="flex justify-center border-t px-4 py-3"><Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button></div>
      )}
      {/* Remove confirmation dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected leads from this campaign. Any pending actions
              will not be executed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkRemoveMutation.isPending}
            >
              {bulkRemoveMutation.isPending ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lead detail sheet */}
      <CampaignLeadDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        lead={selectedLead}
        campaignId={campaignId}
        sequenceNodes={sequenceNodes || []}
        sequenceEdges={sequenceEdges || []}
      />
    </div>
  );
}
