import { useState, useMemo, useRef, useCallback } from "react";
import {
  Search,
  Users,
  Linkedin,
  Instagram,
  ExternalLink,
  CheckCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Reply,
  Loader2,
  Send,
  SlidersHorizontal,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  type LeadWithCrmContact,
  type LeadsFilters,
  type PaginatedLeads,
  useReplyToComment,
} from "@/hooks/leads/useLeadsSync";
import { Textarea } from "@/components/ui/textarea";
import { useCommentAiDraft } from "@/hooks/leads/useCommentAiDraft";
import { type UnipileCampaign } from "@/hooks/useUnipileCampaigns";
import { BulkActionsBar } from "./BulkActionsBar";

interface LeadsTableProps {
  leadsData: PaginatedLeads | undefined;
  campaigns: UnipileCampaign[];
  isLoading: boolean;
  filters: LeadsFilters;
  onFiltersChange: (filters: LeadsFilters) => void;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onUpdateStatus: (status: string) => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
  isDeleting?: boolean;
  isExporting?: boolean;
  onRetryDm?: (leadId: string) => void;
  onBulkRetryDm?: (leadIds: string[]) => void;
  isRetryingDm?: boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const AI_DIRECTION_PRESETS = [
  { label: "Thank & engage", direction: "Thank them for commenting, ask an engaging follow-up question" },
  { label: "Ask to connect", direction: "Invite them to connect so you can share more details via DM" },
  { label: "Share resource", direction: "Offer to share a relevant resource or guide, ask if they want it" },
  { label: "Book a call", direction: "Suggest hopping on a quick call to discuss further" },
];

type LeadsColumnKey = "lead" | "campaign" | "comment" | "status" | "captured" | "connection";

const LEADS_COLUMNS: { key: LeadsColumnKey; label: string }[] = [
  { key: "lead", label: "Lead" },
  { key: "campaign", label: "Campaign" },
  { key: "comment", label: "Comment / Keyword" },
  { key: "status", label: "Status" },
  { key: "captured", label: "Captured" },
  { key: "connection", label: "Connection" },
];

// Column resize hook
function useColumnResize(initialWidths: Record<string, number>) {
  const [widths, setWidths] = useState(initialWidths);
  const resizing = useRef<{ col: string; startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback(
    (col: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizing.current = { col, startX: e.clientX, startW: widths[col] || 150 };

      const onMouseMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const delta = ev.clientX - resizing.current.startX;
        const newW = Math.max(60, resizing.current.startW + delta);
        setWidths((prev) => ({ ...prev, [resizing.current!.col]: newW }));
      };

      const onMouseUp = () => {
        resizing.current = null;
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
    [widths]
  );

  return { widths, onMouseDown };
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 z-10"
    />
  );
}

export function LeadsTable({
  leadsData,
  campaigns,
  isLoading,
  filters,
  onFiltersChange,
  selectedIds,
  onSelectionChange,
  onUpdateStatus,
  onDeleteSelected,
  onExportSelected,
  isDeleting,
  isExporting,
  onRetryDm,
  onBulkRetryDm,
  isRetryingDm,
}: LeadsTableProps) {
  const leads = leadsData?.data || [];
  const total = leadsData?.total || 0;
  const currentPage = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const totalPages = leadsData?.totalPages || 1;

  const sortBy = filters.sortBy || "captured_at";
  const sortDirection = filters.sortDirection || "desc";

  const { widths, onMouseDown } = useColumnResize({
    lead: 200,
    campaign: 140,
    comment: 350,
    status: 120,
    captured: 130,
    connection: 130,
  });

  const [visibleCols, setVisibleCols] = useState<Set<LeadsColumnKey>>(
    new Set(LEADS_COLUMNS.map((c) => c.key))
  );

  const toggleCol = (key: LeadsColumnKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 2) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isVisible = (key: LeadsColumnKey) => visibleCols.has(key);

  // Selection handlers
  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));
  const someSelected = leads.some((l) => selectedIds.has(l.id));

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const newSelection = new Set(selectedIds);
      leads.forEach((l) => newSelection.add(l.id));
      onSelectionChange(newSelection);
    } else {
      const newSelection = new Set(selectedIds);
      leads.forEach((l) => newSelection.delete(l.id));
      onSelectionChange(newSelection);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelection = new Set(selectedIds);
    if (checked) {
      newSelection.add(id);
    } else {
      newSelection.delete(id);
    }
    onSelectionChange(newSelection);
  };

  const handleSort = (field: LeadsFilters["sortBy"]) => {
    if (sortBy === field) {
      onFiltersChange({
        ...filters,
        sortDirection: sortDirection === "asc" ? "desc" : "asc",
        page: 1,
      });
    } else {
      onFiltersChange({
        ...filters,
        sortBy: field,
        sortDirection: "desc",
        page: 1,
      });
    }
  };

  const handlePageChange = (page: number) => {
    onFiltersChange({ ...filters, page });
  };

  const handlePageSizeChange = (size: string) => {
    onFiltersChange({ ...filters, pageSize: Number(size), page: 1 });
  };

  const SortIcon = ({ field }: { field: LeadsFilters["sortBy"] }) => {
    if (sortBy !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-40" />;
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 ml-1" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 ml-1" />
    );
  };

  // Calculate page range
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-36" />
          </div>
        </CardHeader>
        <div className="px-6">
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"><Skeleton className="h-4 w-4" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-20" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-20" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-28" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-16" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-20" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-16" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...Array(8)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-9 w-9 rounded-full" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="h-3 w-44" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-5 rounded-full" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search leads..."
                value={filters.search || ""}
                onChange={(e) =>
                  onFiltersChange({ ...filters, search: e.target.value, page: 1 })
                }
                className="pl-9 h-9"
              />
            </div>

            {/* Status Filter */}
            <Select
              value={filters.status || "all"}
              onValueChange={(v) =>
                onFiltersChange({
                  ...filters,
                  status: v as LeadsFilters["status"],
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="awaiting_connection">Awaiting Connection</SelectItem>
                <SelectItem value="dm_sent">DM Sent</SelectItem>
                <SelectItem value="dm_failed">Failed</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="converted">Converted</SelectItem>
              </SelectContent>
            </Select>

            {/* Campaign Filter */}
            <Select
              value={filters.campaign_id || "all"}
              onValueChange={(v) =>
                onFiltersChange({
                  ...filters,
                  campaign_id: v === "all" ? undefined : v,
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-[170px] h-9">
                <SelectValue placeholder="Campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Campaigns</SelectItem>
                {campaigns.map((campaign) => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Connection Status Filter */}
            <Select
              value={filters.synced || "all"}
              onValueChange={(v) =>
                onFiltersChange({
                  ...filters,
                  synced: v as LeadsFilters["synced"],
                  page: 1,
                })
              }
            >
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Connection" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Leads</SelectItem>
                <SelectItem value="synced">Connected</SelectItem>
                <SelectItem value="unsynced">Not Connected</SelectItem>
              </SelectContent>
            </Select>

            {/* Column Visibility */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[180px]">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {LEADS_COLUMNS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.key}
                    checked={visibleCols.has(col.key)}
                    onCheckedChange={() => toggleCol(col.key)}
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        {leads.length === 0 ? (
          <CardContent>
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-medium">
                {filters.search || filters.status !== "all" || filters.campaign_id
                  ? "No leads match your filters"
                  : "No leads captured yet"}
              </p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                {filters.search || filters.status !== "all" || filters.campaign_id
                  ? "Try adjusting your search or filters."
                  : "Leads will appear here when commenters trigger your keywords."}
              </p>
            </div>
          </CardContent>
        ) : (
          <>
            <div className="px-6">
              <div className="rounded-lg border overflow-x-auto">
                <Table className="table-fixed">
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableHead className="w-12">
                        <div className="flex items-center justify-center">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={handleSelectAll}
                            aria-label="Select all"
                          />
                        </div>
                      </TableHead>
                      {isVisible("lead") && (
                        <TableHead
                          className="relative cursor-pointer select-none"
                          style={{ width: widths.lead }}
                          onClick={() => handleSort("commenter_name")}
                        >
                          <span className="flex items-center">
                            Lead
                            <SortIcon field="commenter_name" />
                          </span>
                          <ResizeHandle onMouseDown={onMouseDown("lead")} />
                        </TableHead>
                      )}
                      {isVisible("campaign") && (
                        <TableHead className="relative" style={{ width: widths.campaign }}>
                          Campaign
                          <ResizeHandle onMouseDown={onMouseDown("campaign")} />
                        </TableHead>
                      )}
                      {isVisible("comment") && (
                        <TableHead className="relative" style={{ width: widths.comment }}>
                          Comment / Keyword
                          <ResizeHandle onMouseDown={onMouseDown("comment")} />
                        </TableHead>
                      )}
                      {isVisible("status") && (
                        <TableHead
                          className="relative cursor-pointer select-none"
                          style={{ width: widths.status }}
                          onClick={() => handleSort("status")}
                        >
                          <span className="flex items-center">
                            Status
                            <SortIcon field="status" />
                          </span>
                          <ResizeHandle onMouseDown={onMouseDown("status")} />
                        </TableHead>
                      )}
                      {isVisible("captured") && (
                        <TableHead
                          className="relative cursor-pointer select-none"
                          style={{ width: widths.captured }}
                          onClick={() => handleSort("captured_at")}
                        >
                          <span className="flex items-center">
                            Captured
                            <SortIcon field="captured_at" />
                          </span>
                          <ResizeHandle onMouseDown={onMouseDown("captured")} />
                        </TableHead>
                      )}
                      {isVisible("connection") && (
                        <TableHead className="text-center" style={{ width: widths.connection }}>Connection</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <LeadTableRow
                        key={lead.id}
                        lead={lead}
                        isSelected={selectedIds.has(lead.id)}
                        onSelect={(checked) => handleSelectOne(lead.id, checked)}
                        visibleCols={visibleCols}
                        onRetryDm={onRetryDm}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between px-6 py-3">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Showing {startItem.toLocaleString()} - {endItem.toLocaleString()} of{" "}
                  {total.toLocaleString()} leads
                </span>
                <div className="flex items-center gap-2">
                  <span>Show</span>
                  <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                    <SelectTrigger className="h-8 w-[70px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={String(size)}>
                          {size}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span>per page</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-3">
                  Page {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handlePageChange(1)}
                  disabled={currentPage === 1}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handlePageChange(totalPages)}
                  disabled={currentPage === totalPages}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Bulk Actions Bar */}
      <BulkActionsBar
        selectedCount={selectedIds.size}
        onClearSelection={() => onSelectionChange(new Set())}
        onUpdateStatus={onUpdateStatus}
        onDelete={onDeleteSelected}
        onExport={onExportSelected}
        isDeleting={isDeleting}
        isExporting={isExporting}
        onRetryDm={onBulkRetryDm ? () => onBulkRetryDm(Array.from(selectedIds)) : undefined}
        isRetrying={isRetryingDm}
      />
    </>
  );
}

interface LeadTableRowProps {
  lead: LeadWithCrmContact;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  visibleCols: Set<LeadsColumnKey>;
  onRetryDm?: (leadId: string) => void;
}

function LeadTableRow({ lead, isSelected, onSelect, visibleCols, onRetryDm }: LeadTableRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showDirectionPicker, setShowDirectionPicker] = useState(false);
  const [customDirection, setCustomDirection] = useState("");
  const replyMutation = useReplyToComment();
  const aiDraft = useCommentAiDraft();

  const Icon = lead.campaign?.account?.provider === "LINKEDIN" ? Linkedin : Instagram;
  const iconColor =
    lead.campaign?.account?.provider === "LINKEDIN" ? "text-[#0A66C2]" : "text-[#E1306C]";

  const initials = lead.commenter_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "?";

  const isLong = (lead.comment_text?.length || 0) > 140;
  const canReply = lead.comment_id && lead.post?.id && lead.campaign?.account_id;

  const handleAiDraft = (direction?: string) => {
    setShowDirectionPicker(false);
    setCustomDirection("");
    aiDraft.mutate(
      {
        commentText: lead.comment_text || "",
        commenterName: lead.commenter_name,
        commenterHeadline: lead.commenter_headline || undefined,
        postUrl: lead.post?.post_url || undefined,
        matchedKeyword: lead.matched_keyword || undefined,
        direction: direction || undefined,
      },
      {
        onSuccess: (data) => {
          if (data?.draft) {
            setReplyText(data.draft);
          }
        },
      }
    );
  };

  const handleReply = () => {
    if (!replyText.trim() || !canReply) return;
    replyMutation.mutate(
      {
        accountId: lead.campaign!.account_id,
        postId: lead.post!.post_id,
        commentId: lead.comment_id,
        replyText: replyText.trim(),
        leadId: lead.id,
      },
      {
        onSuccess: () => {
          setReplyText("");
          setShowReply(false);
        },
      }
    );
  };

  return (
    <TableRow className={cn("group", isSelected && "bg-muted/50")}>
      <TableCell>
        <div className="flex items-center justify-center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            aria-label={`Select ${lead.commenter_name}`}
          />
        </div>
      </TableCell>
      {visibleCols.has("lead") && (
        <TableCell>
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              {lead.commenter_profile_url ? (
                <a
                  href={lead.commenter_profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline flex items-center gap-1"
                >
                  {lead.commenter_name}
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              ) : (
                <span className="text-sm font-medium">{lead.commenter_name}</span>
              )}
              {lead.commenter_headline && (
                <p className="text-xs text-muted-foreground truncate max-w-[220px]">
                  {lead.commenter_headline}
                </p>
              )}
            </div>
          </div>
        </TableCell>
      )}
      {visibleCols.has("campaign") && (
        <TableCell>
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4 flex-shrink-0", iconColor)} />
            <span className="text-sm truncate max-w-[120px]">{lead.campaign?.name}</span>
          </div>
        </TableCell>
      )}
      {visibleCols.has("comment") && (
        <TableCell className="max-w-[350px]">
          <p className={cn(
            "text-sm text-muted-foreground",
            expanded ? "whitespace-pre-line" : "line-clamp-2"
          )}>
            {lead.comment_text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline" className="text-[11px] font-normal">
              {lead.matched_keyword}
            </Badge>
            {lead.post?.post_url && (
              <a
                href={lead.post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View post
              </a>
            )}
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
            {canReply && !showReply && (
              <button
                onClick={() => setShowReply(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                <Reply className="h-3 w-3" />
                Reply
              </button>
            )}
          </div>
          {showReply && (
            <div className="mt-2 space-y-1.5">
              {aiDraft.isPending && (
                <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Generating AI draft...</span>
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={aiDraft.isPending ? "AI is writing a draft..." : `Reply to ${lead.commenter_name}...`}
                  className="text-sm min-h-[60px] max-h-[120px] resize-none flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply();
                    if (e.key === "Escape") { setShowReply(false); setReplyText(""); }
                  }}
                />
                <div className="flex flex-col gap-1">
                  <Popover open={showDirectionPicker} onOpenChange={setShowDirectionPicker}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            disabled={aiDraft.isPending}
                          >
                            {aiDraft.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                            )}
                          </Button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent>AI Assist</TooltipContent>
                    </Tooltip>
                    <PopoverContent align="end" className="w-[260px] p-3" side="top">
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">Choose a direction or write your own</p>
                        <div className="flex flex-wrap gap-1.5">
                          {AI_DIRECTION_PRESETS.map((preset) => (
                            <button
                              key={preset.label}
                              onClick={() => handleAiDraft(preset.direction)}
                              className="text-xs px-2.5 py-1 rounded-full border bg-muted/50 hover:bg-accent transition-colors"
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-1.5">
                          <Input
                            value={customDirection}
                            onChange={(e) => setCustomDirection(e.target.value)}
                            placeholder="Custom direction..."
                            className="h-8 text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleAiDraft(customDirection || undefined);
                            }}
                          />
                          <Button
                            size="sm"
                            className="h-8 px-3"
                            onClick={() => handleAiDraft(customDirection || undefined)}
                          >
                            Go
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    disabled={!replyText.trim() || replyMutation.isPending}
                    onClick={handleReply}
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => { setShowReply(false); setReplyText(""); }}
                  >
                    &times;
                  </Button>
                </div>
              </div>
            </div>
          )}
        </TableCell>
      )}
      {visibleCols.has("status") && (
        <TableCell>
          <div className="flex items-center gap-1.5">
            <LeadStatusBadge status={lead.status} dmError={lead.dm_error} />
            {lead.status === "dm_failed" && onRetryDm && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => { e.stopPropagation(); onRetryDm(lead.id); }}
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retry DM</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
      )}
      {visibleCols.has("captured") && (
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(lead.captured_at), { addSuffix: true })}
        </TableCell>
      )}
      {visibleCols.has("connection") && (
        <TableCell>
          <div className="flex items-center justify-center">
            {lead.is_connected ? (
              <Tooltip>
                <TooltipTrigger>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </TooltipTrigger>
                <TooltipContent>Connected</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger>
                  <Clock className="h-4 w-4 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent>Awaiting connection</TooltipContent>
              </Tooltip>
            )}
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function LeadStatusBadge({ status, dmError }: { status: string; dmError?: string | null }) {
  switch (status) {
    case "dm_sent":
      return <Badge variant="status" className="status-success">DM Sent</Badge>;
    case "dm_failed":
      if (dmError) {
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="status" className="status-error cursor-help">Failed</Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              <p className="text-xs">{dmError}</p>
            </TooltipContent>
          </Tooltip>
        );
      }
      return <Badge variant="status" className="status-error">Failed</Badge>;
    case "pending":
      return <Badge variant="secondary">Pending</Badge>;
    case "awaiting_connection":
      return <Badge variant="status" className="status-warning">Awaiting</Badge>;
    case "replied":
      return <Badge variant="status" className="status-info">Replied</Badge>;
    case "converted":
      return <Badge variant="status" className="status-purple">Converted</Badge>;
    case "comment_replied":
      return <Badge variant="status" className="status-teal">Comment Replied</Badge>;
    case "unresponsive":
      return <Badge variant="secondary" className="text-muted-foreground">Unresponsive</Badge>;
    case "scoring":
      return <Badge variant="status" className="status-purple">Scoring</Badge>;
    case "low_icp":
      return <Badge variant="outline" className="text-muted-foreground">Low ICP</Badge>;
    case "ai_chatting":
      return <Badge variant="status" className="status-info">AI Chatting</Badge>;
    case "skipped":
      return <Badge variant="outline" className="text-muted-foreground">Skipped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
