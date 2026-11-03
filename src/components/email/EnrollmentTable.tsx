import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
// Table primitives not used — using raw <table> for fixed layout + resize support
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  useEmailEnrollments,
  useUpdateEnrollmentStatus,
  useRemoveEnrollment,
  useBulkRemoveEnrollments,
  useBulkUpdateEnrollmentStatus,
  useFetchAllEnrollmentIds,
} from "@/hooks/useEmailEnrollments";
import { TablePagination } from "@/components/TablePagination";
import {
  Search,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
  Users,
  Plus,
  X,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { EnrollFromListDialog } from "@/components/email/EnrollFromListDialog";
import { EnrollmentDetailSheet } from "@/components/email/EnrollmentDetailSheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format, formatDistanceToNow, isPast } from "date-fns";
import type { EmailSequenceStep, EmailSequenceEnrollment, EnrollmentStatus } from "@/types/email";

interface EnrollmentTableProps {
  sequenceId: string;
  steps: EmailSequenceStep[];
  onStepChange?: (index: number, step: EmailSequenceStep) => void;
  mailboxIds?: string[];
}

const STATUS_BADGES: Record<
  EnrollmentStatus,
  { label: string; color: string }
> = {
  active: { label: "Active", color: "bg-green-500/10 text-green-600 border-green-500/20" },
  paused: { label: "Paused", color: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
  completed: { label: "Completed", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  replied: { label: "Replied", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  bounced: { label: "Bounced", color: "bg-red-500/10 text-red-600 border-red-500/20" },
  unsubscribed: { label: "Unsubscribed", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  spam: { label: "Spam", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  sender_disconnected: { label: "Sender Disconnected", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
};

export function EnrollmentTable({ sequenceId, steps, onStepChange, mailboxIds }: EnrollmentTableProps) {
  const navigate = useNavigate();
  const updateStatusMutation = useUpdateEnrollmentStatus();
  const removeMutation = useRemoveEnrollment();
  const bulkRemoveMutation = useBulkRemoveEnrollments();
  const bulkUpdateStatusMutation = useBulkUpdateEnrollmentStatus();
  const fetchAllIds = useFetchAllEnrollmentIds();

  // Pagination + search state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedEnrollment, setSelectedEnrollment] = useState<EmailSequenceEnrollment | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: result, isLoading, isError, refetch } = useEmailEnrollments(sequenceId, {
    page,
    pageSize,
    search: debouncedSearch || undefined,
  });

  const enrollments = result?.data || [];
  const totalItems = result?.total ?? 0;
  const totalPages = result?.totalPages ?? 0;

  // Column resize logic
  const COLUMNS = [
    { key: "lead", label: "Lead", defaultWidth: 220, minWidth: 120 },
    { key: "step", label: "Step", defaultWidth: 110, minWidth: 70 },
    { key: "status", label: "Status", defaultWidth: 140, minWidth: 90 },
    { key: "nextSend", label: "Next Send", defaultWidth: 150, minWidth: 100 },
    { key: "mailbox", label: "Mailbox", defaultWidth: 180, minWidth: 100 },
  ] as const;

  const [columnWidths, setColumnWidths] = useState<number[]>(
    () => COLUMNS.map((c) => c.defaultWidth)
  );
  const resizeRef = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null);

  const handleResizeStart = useCallback((colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { colIdx, startX: e.clientX, startWidth: columnWidths[colIdx] };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const diff = ev.clientX - resizeRef.current.startX;
      const newWidth = Math.max(COLUMNS[resizeRef.current.colIdx].minWidth, resizeRef.current.startWidth + diff);
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
  }, [columnWidths]);

  const pageIds = useMemo(() => new Set(enrollments.map((e) => e.id)), [enrollments]);
  const allPageSelected = pageIds.size > 0 && [...pageIds].every((id) => selectedIds.has(id));
  const somePageSelected = [...pageIds].some((id) => selectedIds.has(id));

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

  // Select across pages, mirroring the lists selection pattern
  const [selectNValue, setSelectNValue] = useState("");
  const isSelectingAllPages = fetchAllIds.isPending;

  const handleSelectAllPages = () => {
    const toastId = toast.loading(
      totalItems > 0
        ? `Selecting all ${totalItems.toLocaleString()} enrollments…`
        : "Selecting all enrollments…"
    );
    fetchAllIds.mutate(
      { sequenceId, search: debouncedSearch || undefined },
      {
        onSuccess: (ids) => {
          setSelectedIds(new Set(ids));
          toast.success(`Selected ${ids.length.toLocaleString()} enrollments`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select all failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      }
    );
  };

  const handleSelectFirstN = (n: number) => {
    const toastId = toast.loading(`Selecting first ${n.toLocaleString()}…`);
    fetchAllIds.mutate(
      { sequenceId, search: debouncedSearch || undefined },
      {
        onSuccess: (ids) => {
          const sliced = ids.slice(0, n);
          setSelectedIds(new Set(sliced));
          toast.success(`Selected ${sliced.length.toLocaleString()} enrollments`, { id: toastId });
        },
        onError: (err) => {
          toast.error(`Select failed: ${err instanceof Error ? err.message : "unknown"}`, { id: toastId });
        },
      }
    );
  };

  const handleBulkRemove = () => {
    bulkRemoveMutation.mutate(
      { ids: [...selectedIds], sequence_id: sequenceId },
      { onSuccess: () => { clearSelection(); setRemoveDialogOpen(false); } }
    );
  };

  // Selection can span pages (via "Select all N"), so we only have status
  // for the rows on the current page. When every selected id is on this page,
  // filter by status; otherwise apply to all selected ids and let the server
  // update them by id.
  const selectionWithinPage = [...selectedIds].every((sid) => pageIds.has(sid));

  const handleBulkPause = () => {
    const ids = selectionWithinPage
      ? enrollments.filter((e) => selectedIds.has(e.id) && e.status === "active").map((e) => e.id)
      : [...selectedIds];
    if (ids.length === 0) return;
    bulkUpdateStatusMutation.mutate(
      { ids, sequence_id: sequenceId, status: "paused" },
      { onSuccess: clearSelection }
    );
  };

  const handleBulkResume = () => {
    const ids = selectionWithinPage
      ? enrollments.filter((e) => selectedIds.has(e.id) && e.status === "paused").map((e) => e.id)
      : [...selectedIds];
    if (ids.length === 0) return;
    bulkUpdateStatusMutation.mutate(
      { ids, sequence_id: sequenceId, status: "active" },
      { onSuccess: clearSelection }
    );
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setPage(1);
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <div role="alert" className="rounded-xl border p-8 text-center space-y-3"><h2 className="font-semibold">Unable to load enrollments</h2><p className="text-sm text-muted-foreground">Try again to see the leads in this sequence.</p><Button variant="outline" onClick={() => { void refetch(); }}>Try again</Button></div>;
  }

  if (totalItems === 0 && !debouncedSearch) {
    return (
      <>
        <div className="text-center py-12 border border-dashed rounded-lg">
          <Users className="h-8 w-8 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="text-sm font-semibold mb-1">No enrollments yet</h3>
          <p className="text-xs text-muted-foreground">
            Leads arrive here from an attached list, from a list whose lead processing routes
            them in, or by adding them yourself.
          </p>
          <Button
            size="sm"
            variant="cta"
            className="mt-3"
            onClick={() => setEnrollDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Leads from List
          </Button>
        </div>
        <EnrollFromListDialog
          open={enrollDialogOpen}
          onOpenChange={setEnrollDialogOpen}
          sequenceId={sequenceId}
        />
      </>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search enrolled leads"
            placeholder="Search leads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {totalItems} enrolled
        </span>
        <Button
          size="sm"
          variant="cta"
          onClick={() => setEnrollDialogOpen(true)}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Leads
        </Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        {(() => {
          const hasMorePages = totalItems > enrollments.length;
          const allPagesAlreadySelected = totalItems > 0 && selectedIds.size === totalItems;
          if (allPageSelected && hasMorePages && !allPagesAlreadySelected) {
            return (
              <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm flex items-center justify-center gap-2 flex-wrap">
                <span>All {enrollments.length} enrollments on this page are selected.</span>
                <button
                  className="text-primary font-medium hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                  onClick={handleSelectAllPages}
                  disabled={isSelectingAllPages}
                >
                  {isSelectingAllPages ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Selecting {totalItems.toLocaleString()}…
                    </>
                  ) : (
                    `Select all ${totalItems.toLocaleString()}`
                  )}
                </button>
                <span className="text-muted-foreground">or select first</span>
                <input
                  type="number"
                  min={1}
                  max={totalItems}
                  placeholder="e.g. 1000"
                  value={selectNValue}
                  onChange={(e) => setSelectNValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = parseInt(selectNValue);
                      if (n > 0) handleSelectFirstN(n);
                    }
                  }}
                  disabled={isSelectingAllPages}
                  className="w-24 h-7 px-2 text-sm border rounded bg-background text-foreground disabled:opacity-50"
                />
                <button
                  className="text-primary font-medium hover:underline disabled:opacity-50"
                  disabled={isSelectingAllPages || !selectNValue || parseInt(selectNValue) < 1}
                  onClick={() => {
                    const n = parseInt(selectNValue);
                    if (n > 0) handleSelectFirstN(n);
                  }}
                >
                  Go
                </button>
              </div>
            );
          }
          if (allPagesAlreadySelected && selectedIds.size > enrollments.length) {
            return (
              <div className="bg-muted/50 border-b px-4 py-2 text-center text-sm">
                All {totalItems.toLocaleString()} enrollments are selected.{" "}
                <button className="text-primary font-medium hover:underline" onClick={clearSelection}>
                  Clear selection
                </button>
              </div>
            );
          }
          return null;
        })()}
        <div className="overflow-auto">
          <table className="w-full caption-bottom text-sm" style={{ tableLayout: "fixed", minWidth: `${columnWidths.reduce((sum, w) => sum + w, 0) + 40 + 40}px` }}>
            <thead className="[&_tr]:border-b sticky top-0 z-10 bg-background">
              <tr className="border-b">
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-10" style={{ width: 40 }}>
                  <Checkbox
                    checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                {COLUMNS.map((col, colIdx) => (
                  <th
                    key={col.key}
                    className="h-12 px-4 text-left align-middle font-medium text-muted-foreground relative select-none"
                    style={{ width: columnWidths[colIdx] }}
                  >
                    {col.label}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
                      onMouseDown={(e) => handleResizeStart(colIdx, e)}
                    />
                  </th>
                ))}
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-10" style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {enrollments.map((enrollment) => {
                const statusConfig = STATUS_BADGES[enrollment.status];
                const isSelected = selectedIds.has(enrollment.id);
                return (
                  <tr
                    key={enrollment.id}
                    className={cn("border-b transition-colors cursor-pointer hover:bg-muted/50", isSelected && "bg-muted/30")}
                    onClick={() => {
                      setSelectedEnrollment(enrollment);
                      setDetailSheetOpen(true);
                    }}
                  >
                    <td className="p-4 align-middle w-10" style={{ width: 40 }} onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(enrollment.id)}
                        aria-label={`Select ${enrollment.lead_name || enrollment.lead_email}`}
                      />
                    </td>
                    <td className="p-4 align-middle overflow-hidden" style={{ width: columnWidths[0] }}>
                      <div className="truncate">
                        <p className="text-sm font-medium truncate">
                          {enrollment.lead_name || "Unknown"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {enrollment.lead_email || enrollment.lead_id}
                        </p>
                        {(enrollment.lead_position || enrollment.lead_company) && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                            {[enrollment.lead_position, enrollment.lead_company]
                              .filter(Boolean)
                              .join(" @ ")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-4 align-middle overflow-hidden" style={{ width: columnWidths[1] }}>
                      {(() => {
                        const step = steps.find((s) => s.order === enrollment.current_step);
                        const stepLabel = step?.type === "delay"
                          ? `Delay (${step.delay_hours || 24}h)`
                          : step?.type === "email"
                          ? `Email ${steps.filter((s) => s.type === "email" && s.order <= enrollment.current_step).length}`
                          : step?.type === "ab_test"
                          ? "A/B Test"
                          : step?.type === "condition"
                          ? "Condition"
                          : `Step ${enrollment.current_step + 1}`;
                        return (
                          <span className="text-sm tabular-nums">
                            {stepLabel}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-4 align-middle overflow-hidden" style={{ width: columnWidths[2] }}>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            statusConfig.color,
                            enrollment.status === "replied" && enrollment.crm_contact_id && "cursor-pointer hover:opacity-80"
                          )}
                          onClick={
                            enrollment.status === "replied" && enrollment.crm_contact_id
                              ? (e) => {
                                  e.stopPropagation();
                                  navigate(`/inbox?contact=${enrollment.crm_contact_id}`);
                                }
                              : undefined
                          }
                        >
                          {statusConfig.label}
                        </Badge>
                        {enrollment.cycle_number > 1 && (
                          <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
                            Cycle {enrollment.cycle_number}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="p-4 align-middle overflow-hidden" style={{ width: columnWidths[3] }}>
                      {enrollment.next_send_at ? (
                        <div>
                          <p className="text-xs font-medium">
                            {format(new Date(enrollment.next_send_at), "MMM d, h:mm a")}
                          </p>
                          {isPast(new Date(enrollment.next_send_at)) ? (
                            <p className="text-[11px] text-amber-600">
                              In queue
                            </p>
                          ) : (
                            <p className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(enrollment.next_send_at), { addSuffix: true })}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="p-4 align-middle overflow-hidden" style={{ width: columnWidths[4] }}>
                      <span className="text-xs text-muted-foreground truncate block">
                        {enrollment.mailbox_email || "--"}
                      </span>
                    </td>
                    <td className="p-4 align-middle w-10" style={{ width: 40 }} onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {enrollment.status === "active" && (
                            <DropdownMenuItem
                              onClick={() =>
                                updateStatusMutation.mutate({
                                  id: enrollment.id,
                                  sequence_id: sequenceId,
                                  status: "paused",
                                })
                              }
                            >
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </DropdownMenuItem>
                          )}
                          {enrollment.status === "paused" && (
                            <DropdownMenuItem
                              onClick={() =>
                                updateStatusMutation.mutate({
                                  id: enrollment.id,
                                  sequence_id: sequenceId,
                                  status: "active",
                                })
                              }
                            >
                              <Play className="h-4 w-4 mr-2" />
                              Resume
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() =>
                              removeMutation.mutate({
                                id: enrollment.id,
                                sequence_id: sequenceId,
                              })
                            }
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
              {enrollments.length === 0 && debouncedSearch && (
                <tr>
                  <td colSpan={COLUMNS.length + 2} className="py-8 text-center text-sm text-muted-foreground">
                    No enrollments match "{debouncedSearch}"
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <TablePagination
            currentPage={page}
            totalPages={totalPages}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </div>

      {/* Bulk Actions Bar */}
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
                onClick={clearSelection}
              >
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
                <DropdownMenuItem onClick={handleBulkPause}>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause Active
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBulkResume}>
                  <Play className="h-4 w-4 mr-2" />
                  Resume Paused
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setRemoveDialogOpen(true)}
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

      {/* Remove confirmation dialog */}
      <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedIds.size} enrollment{selectedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected leads from this sequence. Any pending emails will not be sent.
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

      <EnrollFromListDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        sequenceId={sequenceId}
      />

      <EnrollmentDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        enrollment={selectedEnrollment}
        steps={steps}
        sequenceId={sequenceId}
        onStepChange={onStepChange}
        mailboxIds={mailboxIds}
      />
    </div>
  );
}
