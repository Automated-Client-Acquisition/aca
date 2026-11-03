import { useState, useMemo, useRef, useCallback } from "react";
import {
  Search,
  Star,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  MessageSquare,
  HelpCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Reply,
  Loader2,
  Send,
  SlidersHorizontal,
  Sparkles,
  Linkedin,
  Instagram,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useCampaignComments, useRetryLeadDm, type UnipileLead } from "@/hooks/useUnipileCampaigns";
import { useReplyToComment } from "@/hooks/leads/useLeadsSync";
import { useCommentAiDraft } from "@/hooks/leads/useCommentAiDraft";
import { useQueryClient } from "@tanstack/react-query";

interface CampaignCommentsProps {
  campaignId: string;
  accountId: string;
}

type SortField = "commenter_name" | "matched_keyword" | "status" | "captured_at";
type SortDirection = "asc" | "desc";

type CommentsColumnKey = "author" | "comment" | "keyword" | "sender" | "status" | "date";

const COMMENTS_COLUMNS: { key: CommentsColumnKey; label: string }[] = [
  { key: "author", label: "Author" },
  { key: "comment", label: "Comment" },
  { key: "keyword", label: "Keyword" },
  { key: "sender", label: "Sender" },
  { key: "status", label: "Status" },
  { key: "date", label: "Date" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "pending", label: "Pending" },
  { value: "dm_sent", label: "DM Sent" },
  { value: "dm_failed", label: "Failed" },
  { value: "replied", label: "Replied" },
  { value: "converted", label: "Converted" },
  { value: "skipped", label: "Skipped" },
  { value: "awaiting_connection", label: "Awaiting Connection" },
  { value: "comment_replied", label: "Comment Replied" },
  { value: "unresponsive", label: "Unresponsive" },
  { value: "scoring", label: "Scoring" },
  { value: "low_icp", label: "Low ICP" },
  { value: "ai_chatting", label: "AI Chatting" },
];

const AI_DIRECTION_PRESETS = [
  { label: "Thank & engage", direction: "Thank them for commenting, ask an engaging follow-up question" },
  { label: "Ask to connect", direction: "Invite them to connect so you can share more details via DM" },
  { label: "Share resource", direction: "Offer to share a relevant resource or guide, ask if they want it" },
  { label: "Book a call", direction: "Suggest hopping on a quick call to discuss further" },
];

const PAGE_SIZE = 25;

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

export function CampaignComments({ campaignId, accountId }: CampaignCommentsProps) {
  const { data: leads, isLoading, isRefetching } = useCampaignComments(campaignId);
  const queryClient = useQueryClient();
  const retryDm = useRetryLeadDm();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [senderFilter, setSenderFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("captured_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const { widths, onMouseDown } = useColumnResize({
    author: 200,
    comment: 350,
    keyword: 120,
    sender: 150,
    status: 130,
    date: 140,
  });

  const [visibleCols, setVisibleCols] = useState<Set<CommentsColumnKey>>(
    new Set(COMMENTS_COLUMNS.map((c) => c.key))
  );

  const toggleCol = (key: CommentsColumnKey) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size > 2) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isVisible = (key: CommentsColumnKey) => visibleCols.has(key);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "captured_at" ? "desc" : "asc");
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-50" />;
    return sortDirection === "asc"
      ? <ArrowUp className="h-3.5 w-3.5 ml-1" />
      : <ArrowDown className="h-3.5 w-3.5 ml-1" />;
  };

  // Derive unique sender accounts from leads for filter dropdown
  const senderAccounts = useMemo(() => {
    if (!leads) return [];
    const seen = new Map<string, { id: string; display_name: string | null; provider: string }>();
    for (const lead of leads) {
      const acct = lead.sender_account;
      if (acct && !seen.has(acct.id)) {
        seen.set(acct.id, { id: acct.id, display_name: acct.display_name, provider: acct.provider });
      }
    }
    return Array.from(seen.values());
  }, [leads]);

  // Filter + sort + paginate
  const { filtered, paginated, totalPages } = useMemo(() => {
    if (!leads) return { filtered: [], paginated: [], totalPages: 1 };

    const searchLower = search.toLowerCase();

    let result = leads.filter((lead) => {
      // Status filter
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;

      // Sender filter
      if (senderFilter !== "all" && lead.sender_account?.id !== senderFilter) return false;

      // Search filter
      if (searchLower) {
        const haystack = [
          lead.commenter_name,
          lead.commenter_headline,
          lead.comment_text,
          lead.matched_keyword,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(searchLower)) return false;
      }

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === "captured_at") {
        cmp = new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime();
      } else if (sortField === "matched_keyword") {
        cmp = (a.matched_keyword || "").localeCompare(b.matched_keyword || "");
      } else if (sortField === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === "commenter_name") {
        cmp = (a.commenter_name || "").localeCompare(b.commenter_name || "");
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    const total = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const paged = result.slice(start, start + PAGE_SIZE);

    return { filtered: result, paginated: paged, totalPages: total };
  }, [leads, search, statusFilter, senderFilter, sortField, sortDirection, page]);

  // Reset page when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["unipile-comments", campaignId] });
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle className="text-lg">Lead Comments</CardTitle>
            <CardDescription>View leads captured from your post comments.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by author, comment, or keyword..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-9 h-9 w-[260px]"
              />
            </div>
            <Select value={statusFilter} onValueChange={handleStatusChange}>
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {senderAccounts.length > 1 && (
              <Select value={senderFilter} onValueChange={(v) => { setSenderFilter(v); setPage(1); }}>
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue placeholder="All senders" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All senders</SelectItem>
                  {senderAccounts.map((acct) => (
                    <SelectItem key={acct.id} value={acct.id}>
                      {acct.display_name || acct.provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={handleRefresh}
              disabled={isRefetching}
            >
              <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
            </Button>
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
                {COMMENTS_COLUMNS.map((col) => (
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
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : !leads || leads.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">No comments captured yet</p>
            <p className="text-xs mt-1">Comments will appear here when leads interact with your monitored posts.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-10 w-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium">No matching comments</p>
            <p className="text-xs mt-1">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]" />
                    {isVisible("author") && (
                      <TableHead
                        className="relative cursor-pointer select-none"
                        style={{ width: widths.author }}
                        onClick={() => handleSort("commenter_name")}
                      >
                        <span className="flex items-center">
                          Author
                          <SortIcon field="commenter_name" />
                        </span>
                        <ResizeHandle onMouseDown={onMouseDown("author")} />
                      </TableHead>
                    )}
                    {isVisible("comment") && (
                      <TableHead className="relative" style={{ width: widths.comment }}>
                        Comment
                        <ResizeHandle onMouseDown={onMouseDown("comment")} />
                      </TableHead>
                    )}
                    {isVisible("keyword") && (
                      <TableHead
                        className="relative cursor-pointer select-none"
                        style={{ width: widths.keyword }}
                        onClick={() => handleSort("matched_keyword")}
                      >
                        <span className="flex items-center">
                          Keyword
                          <SortIcon field="matched_keyword" />
                        </span>
                        <ResizeHandle onMouseDown={onMouseDown("keyword")} />
                      </TableHead>
                    )}
                    {isVisible("sender") && (
                      <TableHead className="relative" style={{ width: widths.sender }}>
                        Sender
                        <ResizeHandle onMouseDown={onMouseDown("sender")} />
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p className="text-xs">Current processing status of the lead</p>
                            </TooltipContent>
                          </Tooltip>
                          <SortIcon field="status" />
                        </span>
                        <ResizeHandle onMouseDown={onMouseDown("status")} />
                      </TableHead>
                    )}
                    {isVisible("date") && (
                      <TableHead
                        className="cursor-pointer select-none"
                        style={{ width: widths.date }}
                        onClick={() => handleSort("captured_at")}
                      >
                        <span className="flex items-center">
                          Date
                          <SortIcon field="captured_at" />
                        </span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginated.map((lead) => (
                    <CommentRow
                      key={lead.id}
                      lead={lead}
                      accountId={accountId}
                      isStarred={starred.has(lead.id)}
                      onToggleStar={() => toggleStar(lead.id)}
                      visibleCols={visibleCols}
                      onRetryDm={(leadId) => retryDm.mutate({ leadIds: [leadId] })}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-4">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} comments
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface CommentRowProps {
  lead: UnipileLead;
  accountId: string;
  isStarred: boolean;
  onToggleStar: () => void;
  visibleCols: Set<CommentsColumnKey>;
  onRetryDm?: (leadId: string) => void;
}

function CommentRow({ lead, accountId, isStarred, onToggleStar, visibleCols, onRetryDm }: CommentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [showDirectionPicker, setShowDirectionPicker] = useState(false);
  const [customDirection, setCustomDirection] = useState("");
  const replyMutation = useReplyToComment();
  const aiDraft = useCommentAiDraft();

  const isLong = (lead.comment_text?.length || 0) > 140;
  const replyAccountId = lead.sender_account?.id || accountId;
  const canReply = lead.comment_id && lead.post?.id && replyAccountId;

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
        accountId: replyAccountId,
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
    <TableRow className="group">
      {/* Star */}
      <TableCell className="pr-0">
        <button
          onClick={onToggleStar}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <Star
            className={cn(
              "h-4 w-4",
              isStarred
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40 group-hover:text-muted-foreground"
            )}
          />
        </button>
      </TableCell>

      {/* Author */}
      {visibleCols.has("author") && (
        <TableCell>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium flex-shrink-0">
              {lead.commenter_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              {lead.commenter_profile_url ? (
                <a
                  href={lead.commenter_profile_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-amber-500 hover:underline block truncate"
                >
                  {lead.commenter_name}
                </a>
              ) : (
                <span className="text-sm font-medium block truncate">
                  {lead.commenter_name}
                </span>
              )}
              {lead.commenter_headline && (
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {lead.commenter_headline}
                </p>
              )}
            </div>
          </div>
        </TableCell>
      )}

      {/* Comment */}
      {visibleCols.has("comment") && (
        <TableCell className="max-w-[350px]">
          <p className={cn(
            "text-sm text-muted-foreground",
            expanded ? "whitespace-pre-line" : "line-clamp-2"
          )}>
            {lead.comment_text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            {lead.post?.post_url && (
              <a
                href={lead.post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
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

      {/* Keyword */}
      {visibleCols.has("keyword") && (
        <TableCell>
          <Badge variant="outline" className="font-medium text-xs">
            {lead.matched_keyword.toUpperCase()}
          </Badge>
        </TableCell>
      )}

      {/* Sender */}
      {visibleCols.has("sender") && (
        <TableCell>
          {lead.sender_account ? (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                {lead.sender_account.provider === "LINKEDIN" ? (
                  <Linkedin className="h-2.5 w-2.5 text-[#0A66C2]" />
                ) : (
                  <Instagram className="h-2.5 w-2.5 text-[#E1306C]" />
                )}
              </div>
              <span className="text-xs truncate max-w-[120px]">{lead.sender_account.display_name || "Unknown"}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">-</span>
          )}
        </TableCell>
      )}

      {/* Status */}
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

      {/* Date */}
      {visibleCols.has("date") && (
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDistanceToNow(new Date(lead.captured_at), { addSuffix: true })}
        </TableCell>
      )}
    </TableRow>
  );
}
