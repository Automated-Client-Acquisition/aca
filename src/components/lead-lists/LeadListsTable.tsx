import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  MoreVertical,
  Users,
  Pencil,
  Trash2,
  Archive,
  FileText,
  Sparkles,
  RefreshCw,
  Loader2,
  Zap,
  ZapOff,
  Pause,
  Minus,
  AlertTriangle,
  X,
  Merge,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LeadList } from "@/hooks/useLeadLists";
import { useActiveCSVImportJobs, type CSVImportJob } from "@/hooks/useCSVImportJob";
import { format, formatDistanceToNow } from "date-fns";
import { TablePagination } from "@/components/TablePagination";
import { useTablePagination } from "@/hooks/useTablePagination";
import { useColumnResize } from "@/hooks/useColumnResize";
import { ResizeHandle } from "@/components/ui/resize-handle";
import { useMoltsetsWorkerLists, useToggleMoltsetsWorkerList } from "@/hooks/useMoltsetsWorkerLists";
import { useLeadListsWorkflowStatus, deriveLeadListWorkflowState, type LeadListWorkflowState } from "@/hooks/useLeadListProcessing";

interface LeadListsTableProps {
  lists: LeadList[];
  isLoading: boolean;
  onEdit: (list: LeadList) => void;
  onDelete: (list: LeadList) => void;
  onArchive: (list: LeadList) => void;
  onMerge: (lists: LeadList[]) => void;
  onBulkDelete: (lists: LeadList[]) => void;
}

// Default column widths in pixels for resizable columns
const LEAD_LISTS_DEFAULT_WIDTHS: Record<string, number> = {
  _checkbox: 48,
  name: 400,
  type: 140,
  leads: 140,
  workflow: 160,
  _actions: 50,
};

const sourceTypeLabels: Record<LeadList["source_type"], string> = {
  manual: "Manual",
  csv: "CSV Import",
  linkedin_search: "LinkedIn Search",
  event: "Event",
  post_reactors: "Post Reactors",
  smart: "Smart Segment",
  apify_leads_finder: "Apify Import",
  signal: "Signal",
  discovery_pack: "Discovery Pack",
};

const WORKFLOW_BADGE: Record<LeadListWorkflowState, { label: string; dotClassName: string; textClassName: string; dotPulse: boolean }> = {
  running: { label: "Running", dotClassName: "bg-blue-500", textClassName: "text-blue-700 dark:text-blue-400", dotPulse: true },
  paused: { label: "Paused", dotClassName: "bg-amber-500", textClassName: "text-amber-700 dark:text-amber-400", dotPulse: false },
  stalled: { label: "Stalled", dotClassName: "bg-red-500", textClassName: "text-red-700 dark:text-red-400", dotPulse: true },
  idle: { label: "Idle", dotClassName: "bg-gray-400 dark:bg-gray-500", textClassName: "text-muted-foreground", dotPulse: false },
};

/**
 * Minimal dot + label status indicator — mirrors the People table's
 * StatusFlag (src/pages/Contacts.tsx), duplicated locally per this
 * codebase's existing per-page pattern for table-cell status renderers.
 */
function StatusFlag({
  label,
  dotClassName,
  textClassName,
  dotPulse = false,
}: {
  label: string;
  dotClassName: string;
  textClassName: string;
  dotPulse?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${textClassName}`}>
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotClassName}${dotPulse ? " animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function LeadListsTable({
  lists,
  isLoading,
  onEdit,
  onDelete,
  onArchive,
  onMerge,
  onBulkDelete,
}: LeadListsTableProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [workflowFilter, setWorkflowFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Drop selected ids that no longer exist (e.g. after a bulk delete) so a
  // stale selection can't be re-submitted against lists that are gone.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(lists.map((l) => l.id));
      const next = new Set([...prev].filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [lists]);

  // Column resize hook
  const { getTableProps, getHeaderProps, getResizeHandleProps } = useColumnResize({
    tableId: 'lead-lists-table',
    defaultWidths: LEAD_LISTS_DEFAULT_WIDTHS,
  });
  const visibleColumnKeys = ['_checkbox', 'name', 'type', 'leads', 'workflow', '_actions'];

  // Pagination
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("lead-lists", 25);

  // Get active import jobs to show progress indicators
  const { data: activeImportJobs } = useActiveCSVImportJobs();

  // MoltSets daily-enrichment worker enrollment
  const { data: moltsetsWorkerLists } = useMoltsetsWorkerLists();
  const toggleMoltsetsWorkerList = useToggleMoltsetsWorkerList();
  const enrolledListIds = new Set((moltsetsWorkerLists || []).map((l) => l.lead_list_id));

  // Enrich & enroll workflow status (Running / Paused / Stalled / Idle) per list
  const { data: workflowStatusByListId } = useLeadListsWorkflowStatus();
  const getWorkflowState = (list: LeadList): LeadListWorkflowState =>
    deriveLeadListWorkflowState(workflowStatusByListId?.get(list.id), list.lead_count);

  // Create a map of list ID to active import job for quick lookup
  const importJobsByListId = (activeImportJobs || []).reduce((acc, job) => {
    acc[job.target_list_id] = job;
    return acc;
  }, {} as Record<string, CSVImportJob>);

  // Filter lists
  const filteredLists = lists.filter((list) => {
    const matchesSearch = list.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || list.status === statusFilter;
    const matchesType = typeFilter === "all" || list.source_type === typeFilter;
    const matchesWorkflow = workflowFilter === "all" || getWorkflowState(list) === workflowFilter;
    return matchesSearch && matchesStatus && matchesType && matchesWorkflow;
  });

  // Reset page when filters change
  useEffect(() => {
    resetPage();
  }, [searchQuery, statusFilter, typeFilter, workflowFilter, resetPage]);

  // Paginate filtered lists
  const totalPages = Math.ceil(filteredLists.length / pageSize);
  const paginatedLists = filteredLists.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  // Selection — a plain Set is enough since `lists` is already the full,
  // unpaginated array (no server-side pagination for lead lists).
  const allVisibleSelected = paginatedLists.length > 0 && paginatedLists.every((l) => selectedIds.has(l.id));
  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        paginatedLists.forEach((l) => next.delete(l.id));
      } else {
        paginatedLists.forEach((l) => next.add(l.id));
      }
      return next;
    });
  };
  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const selectedLists = lists.filter((l) => selectedIds.has(l.id));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow className="[&>th]:h-9 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70 bg-muted/30 hover:bg-muted/30">
                <TableHead>List Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Workflow</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-10 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search lists..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px]">
            <FileText className="h-4 w-4 mr-2" />
            <SelectValue placeholder="List type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="smart">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Smart Segment
              </div>
            </SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="csv">CSV Import</SelectItem>
            <SelectItem value="linkedin_search">LinkedIn Search</SelectItem>
            <SelectItem value="event">Event</SelectItem>
            <SelectItem value="post_reactors">Post Reactors</SelectItem>
            <SelectItem value="apify_leads_finder">Apify Import</SelectItem>
            <SelectItem value="signal">Signal</SelectItem>
            <SelectItem value="discovery_pack">Discovery Pack</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={workflowFilter} onValueChange={setWorkflowFilter}>
          <SelectTrigger className="w-[160px]">
            <Loader2 className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Workflow" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All workflows</SelectItem>
            <SelectItem value="running">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 text-blue-600" />
                Running
              </div>
            </SelectItem>
            <SelectItem value="paused">
              <div className="flex items-center gap-2">
                <Pause className="h-3.5 w-3.5 text-amber-600" />
                Paused
              </div>
            </SelectItem>
            <SelectItem value="stalled">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-600" />
                Stalled
              </div>
            </SelectItem>
            <SelectItem value="idle">
              <div className="flex items-center gap-2">
                <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                Idle
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table style={getTableProps(visibleColumnKeys).style}>
          <TableHeader>
            <TableRow className="[&>th]:h-9 [&>th]:py-2 [&>th]:text-[10px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-muted-foreground [&>th]:border-b-2 [&>th]:border-foreground/70 bg-muted/30 hover:bg-muted/30">
              <TableHead style={getHeaderProps('_checkbox').style}>
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={toggleSelectAllVisible}
                  aria-label="Select all lists on this page"
                />
              </TableHead>
              <TableHead className="relative" style={getHeaderProps('name').style}>
                List Name
                <ResizeHandle {...getResizeHandleProps('name')} />
              </TableHead>
              <TableHead className="relative" style={getHeaderProps('type').style}>
                Type
                <ResizeHandle {...getResizeHandleProps('type')} />
              </TableHead>
              <TableHead className="relative" style={getHeaderProps('leads').style}>
                Leads
                <ResizeHandle {...getResizeHandleProps('leads')} />
              </TableHead>
              <TableHead className="relative" style={getHeaderProps('workflow').style}>
                Workflow
                <ResizeHandle {...getResizeHandleProps('workflow')} />
              </TableHead>
              <TableHead style={getHeaderProps('_actions').style}></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedLists.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {searchQuery || statusFilter !== "all" || typeFilter !== "all"
                    ? "No lists match your filters"
                    : "No lead lists yet. Create your first list to get started."}
                </TableCell>
              </TableRow>
            ) : (
              paginatedLists.map((list) => (
                <TableRow
                  key={list.id}
                  className="group [&>td]:py-2 [&>td]:px-3 [&>td]:text-[13px] even:bg-muted/20 hover:bg-muted/40 cursor-pointer"
                  onClick={() => navigate(`/leads/lists/${list.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(list.id)}
                      onCheckedChange={() => toggleSelectOne(list.id)}
                      aria-label={`Select ${list.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
                        importJobsByListId[list.id]
                          ? "bg-blue-100"
                          : list.is_smart
                            ? "bg-primary/10"
                            : "bg-muted"
                      }`}>
                        {importJobsByListId[list.id] ? (
                          <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                        ) : list.is_smart ? (
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {list.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {list.is_smart && list.last_computed_at ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="flex items-center gap-1">
                                  <RefreshCw className="h-3 w-3" />
                                  Updated {formatDistanceToNow(new Date(list.last_computed_at), { addSuffix: true })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                Smart list count auto-updates based on filter criteria
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            format(new Date(list.created_at), "MMM d, yyyy, h:mm:ss a")
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {list.is_smart ? (
                      <StatusFlag label="Dynamic" dotClassName="bg-primary" textClassName="text-primary" />
                    ) : list.status === "active" ? (
                      <StatusFlag label={sourceTypeLabels[list.source_type]} dotClassName="bg-green-500" textClassName="text-green-700 dark:text-green-400" />
                    ) : (
                      <StatusFlag label={sourceTypeLabels[list.source_type]} dotClassName="bg-gray-400 dark:bg-gray-500" textClassName="text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell>
                    {importJobsByListId[list.id] ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Progress value={importJobsByListId[list.id].progress} className="h-1.5 w-24" />
                          <span className="text-xs text-blue-600 font-medium">
                            {importJobsByListId[list.id].progress}%
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {importJobsByListId[list.id].imported_count.toLocaleString()} imported
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>{list.lead_count.toLocaleString()}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const workflowState = getWorkflowState(list);
                      const workflowStatus = workflowStatusByListId?.get(list.id);
                      const tone = WORKFLOW_BADGE[workflowState];
                      const badge = (
                        <StatusFlag label={tone.label} dotClassName={tone.dotClassName} textClassName={tone.textClassName} dotPulse={tone.dotPulse} />
                      );
                      if (workflowState === "idle" || !workflowStatus) return badge;
                      const notYetQueued = Math.max(0, list.lead_count - workflowStatus.totalCount);
                      const remaining = workflowStatus.pendingCount + workflowStatus.processingCount + notYetQueued;
                      const detail = workflowState === "running"
                        ? `${remaining.toLocaleString()} left`
                        : workflowState === "paused"
                          ? `${remaining.toLocaleString()} waiting on resume`
                          : `${remaining.toLocaleString()} never started — enabled but nothing queued`;
                      const updatedSuffix = workflowStatus.updatedAt
                        ? ` · updated ${formatDistanceToNow(new Date(workflowStatus.updatedAt), { addSuffix: true })}`
                        : "";
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>{badge}</TooltipTrigger>
                          <TooltipContent>{detail}{updatedSuffix}</TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(list); }}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onArchive(list); }}>
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleMoltsetsWorkerList.mutate({
                              leadListId: list.id,
                              enroll: !enrolledListIds.has(list.id),
                            });
                          }}
                        >
                          {enrolledListIds.has(list.id) ? (
                            <>
                              <ZapOff className="h-4 w-4 mr-2" />
                              Remove from MoltSets daily enrichment
                            </>
                          ) : (
                            <>
                              <Zap className="h-4 w-4 mr-2" />
                              Enroll in MoltSets daily enrichment
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => { e.stopPropagation(); onDelete(list); }}
                          className="text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {filteredLists.length > 0 && (
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={filteredLists.length}
          onPageChange={setCurrentPage}
          onPageSizeChange={handlePageSizeChange}
        />
      )}

      {/* Bulk actions bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-300">
          <div className="flex items-center gap-3 bg-background border shadow-lg rounded-lg px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="h-7 px-3 text-sm font-medium">
                {selectedIds.size} selected
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setSelectedIds(new Set())}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="h-6 w-px bg-border" />

            <Button
              variant="cta"
              size="sm"
              disabled={selectedIds.size < 2}
              onClick={() => onMerge(selectedLists)}
            >
              <Merge className="h-4 w-4 mr-2" />
              Merge Lists
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onBulkDelete(selectedLists)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
