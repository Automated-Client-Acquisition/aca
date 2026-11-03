import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { format, formatDistanceToNow, isToday, isTomorrow, isPast, addHours, addDays } from "date-fns";
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCcw,
  Calendar,
  MoreVertical,
  ExternalLink,
  Image as ImageIcon,
  Video,
  FileText,
  Trash2,
  CalendarClock,
  Send,
  AlertTriangle,
  Zap,
  List,
  Search,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { ContentTabs } from "@/components/ContentTabs";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlatformBadge } from "@/components/autopilot/PlatformBadge";
import { usePublishQueue, useAutopilots, useDeletePublishQueueItem, useReschedulePublishQueueItem } from "@/hooks/useAutopilots";
import type { PublishQueueItem, PublishQueueStatus } from "@/types/autopilot";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { useConnectedAccounts, type ConnectedAccount } from "@/hooks/useConnectedAccounts";

export default function PublishQueue() {
  const navigate = useNavigate();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUsePublishing = hasFeature("publishing");

  const [statusFilter, setStatusFilter] = useState<PublishQueueStatus | "all">("pending");
  const [autopilotFilter, setAutopilotFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [deleteItem, setDeleteItem] = useState<PublishQueueItem | null>(null);
  const [rescheduleItem, setRescheduleItem] = useState<PublishQueueItem | null>(null);
  const [customDateTime, setCustomDateTime] = useState("");

  const { data: queueItems, isLoading, refetch } = usePublishQueue();
  const { data: autopilots } = useAutopilots();
  const { accounts: connectedAccounts } = useConnectedAccounts();
  const deleteMutation = useDeletePublishQueueItem();
  const rescheduleMutation = useReschedulePublishQueueItem();

  // Helper to find connected account by ID
  const findAccountById = (accountId: string): ConnectedAccount | undefined => {
    if (!connectedAccounts || !accountId) return undefined;
    return connectedAccounts.find((acc) => acc.id === accountId);
  };

  const handleDelete = () => {
    if (!deleteItem) return;
    deleteMutation.mutate(deleteItem.id, {
      onSuccess: () => setDeleteItem(null),
    });
  };

  const handleReschedule = (itemId: string, newDate: Date) => {
    rescheduleMutation.mutate({
      itemId,
      scheduledFor: newDate.toISOString(),
    });
  };

  const handleCustomReschedule = () => {
    if (!rescheduleItem || !customDateTime) return;
    rescheduleMutation.mutate(
      {
        itemId: rescheduleItem.id,
        scheduledFor: new Date(customDateTime).toISOString(),
      },
      {
        onSuccess: () => {
          setRescheduleItem(null);
          setCustomDateTime("");
        },
      }
    );
  };

  // Filter and sort items
  const filteredItems = useMemo(() => {
    if (!queueItems) return [];

    const filtered = queueItems.filter((item) => {
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      const matchesAutopilot =
        autopilotFilter === "all" || item.autopilot_id === autopilotFilter;

      // Search filter
      const query = searchQuery.toLowerCase();
      const title = item.content_output?.data?.title?.toLowerCase() || "";
      const autopilotName = item.autopilot?.name?.toLowerCase() || "";
      const matchesSearch = !query || title.includes(query) || autopilotName.includes(query);

      return matchesStatus && matchesAutopilot && matchesSearch;
    });

    // Sort: published/failed by most recent first, pending/publishing by soonest first
    return filtered.sort((a, b) => {
      const aIsPast = a.status === "published" || a.status === "failed";
      const bIsPast = b.status === "published" || b.status === "failed";

      // If mixed statuses (all filter), show pending/publishing first, then published/failed
      if (aIsPast !== bIsPast) return aIsPast ? 1 : -1;

      if (aIsPast) {
        // Published/failed: most recent first
        const aDate = (a.status === "published" && a.published_at) ? a.published_at : a.scheduled_for;
        const bDate = (b.status === "published" && b.published_at) ? b.published_at : b.scheduled_for;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      }

      // Pending/publishing: soonest first
      return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
    });
  }, [queueItems, statusFilter, autopilotFilter, searchQuery]);

  // Group by date for calendar view
  const groupedByDate = useMemo(() => {
    const groups: Record<string, PublishQueueItem[]> = {};

    filteredItems.forEach((item) => {
      const relevantDate = item.status === "published" && item.published_at ? item.published_at : item.scheduled_for;
      const date = format(new Date(relevantDate), "yyyy-MM-dd");
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(item);
    });

    return groups;
  }, [filteredItems]);

  // Stats
  const pendingCount = queueItems?.filter((i) => i.status === "pending").length || 0;
  const publishingCount = queueItems?.filter((i) => i.status === "publishing").length || 0;
  const publishedCount = queueItems?.filter((i) => i.status === "published").length || 0;
  const failedCount = queueItems?.filter((i) => i.status === "failed").length || 0;

  const getStatusBadge = (status: PublishQueueStatus) => {
    switch (status) {
      case "pending":
        return (
          <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "publishing":
        return (
          <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Publishing
          </Badge>
        );
      case "published":
        return (
          <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/30">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Published
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
    }
  };

  const getContentIcon = (pipeline?: string) => {
    if (!pipeline) return <FileText className="h-4 w-4 text-muted-foreground" />;

    if (pipeline.includes("video")) {
      return <Video className="h-4 w-4 text-primary" />;
    }
    if (pipeline.includes("image") || pipeline.includes("carousel")) {
      return <ImageIcon className="h-4 w-4 text-blue-500" />;
    }
    return <FileText className="h-4 w-4 text-muted-foreground" />;
  };

  const getScheduleLabel = (item: PublishQueueItem) => {
    // For published items, show when it was actually published
    if (item.status === "published" && item.published_at) {
      const date = new Date(item.published_at);
      if (isToday(date)) return `Published today at ${format(date, "HH:mm")}`;
      return `Published ${format(date, "MMM d, HH:mm")}`;
    }

    // For failed items, show when it was scheduled
    if (item.status === "failed") {
      const date = new Date(item.scheduled_for);
      return `Failed · was ${format(date, "MMM d, HH:mm")}`;
    }

    // For pending/publishing items
    const date = new Date(item.scheduled_for);
    if (item.status === "pending" && isPast(date)) return "Overdue";
    if (isToday(date)) return `Today at ${format(date, "HH:mm")}`;
    if (isTomorrow(date)) return `Tomorrow at ${format(date, "HH:mm")}`;
    return format(date, "MMM d, HH:mm");
  };

  const getDateGroupLabel = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, "EEEE, MMMM d");
  };

  const isOverdue = (scheduledFor: string) => {
    return isPast(new Date(scheduledFor));
  };

  // Feature gating for non-pro users
  if (!canUsePublishing && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1600px] mx-auto">
            <ContentTabs />
            <PageHeader
              className="mb-8"
              icon={Send}
              title="Publish Queue"
              description="Schedule and publish content to WordPress and other platforms"
            />

            {/* Upgrade prompt */}
            <div className="max-w-md mx-auto mt-12">
              <UpgradePrompt feature="publishing" variant="card" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Client without access - show nothing
  if (!canUsePublishing) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-8">
          <div className="max-w-[1600px] mx-auto text-center py-12">
            <p className="text-muted-foreground">This feature is not available for your organization.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1600px] mx-auto space-y-6">
          <ContentTabs />
          <PageHeader
            icon={Send}
            title="Publish Queue"
            description="Scheduled content ready to be published by your autopilots."
            actions={
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCcw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            }
          />

          {/* Enhanced Stats Cards — clickable to filter */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card
              className={`bg-gradient-to-br from-card to-card/50 border hover:shadow-md transition-shadow cursor-pointer ${statusFilter === "pending" ? "ring-2 ring-amber-500/50" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
            >
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10">
                    <Clock className="h-5 w-5 text-amber-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{pendingCount}</div>
                    <div className="text-sm text-muted-foreground">Pending</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`bg-gradient-to-br from-card to-card/50 border hover:shadow-md transition-shadow cursor-pointer ${statusFilter === "publishing" ? "ring-2 ring-blue-500/50" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "publishing" ? "all" : "publishing")}
            >
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-blue-500/10">
                    <Loader2 className="h-5 w-5 text-blue-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{publishingCount}</div>
                    <div className="text-sm text-muted-foreground">Publishing</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`bg-gradient-to-br from-card to-card/50 border hover:shadow-md transition-shadow cursor-pointer ${statusFilter === "published" ? "ring-2 ring-green-500/50" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "published" ? "all" : "published")}
            >
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-green-500/10">
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{publishedCount}</div>
                    <div className="text-sm text-muted-foreground">Published</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className={`bg-gradient-to-br from-card to-card/50 border hover:shadow-md transition-shadow cursor-pointer ${statusFilter === "failed" ? "ring-2 ring-red-500/50" : ""}`}
              onClick={() => setStatusFilter(statusFilter === "failed" ? "all" : "failed")}
            >
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-red-500/10">
                    <XCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <div className="text-2xl font-bold">{failedCount}</div>
                    <div className="text-sm text-muted-foreground">Failed</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Enhanced Filters Bar */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title or autopilot..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10"
              />
            </div>

            <div className="flex gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as any)}
              >
                <SelectTrigger className="w-[150px] h-10">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending" textValue="Pending">
                    <span className="flex items-center gap-2">
                      <Clock className="h-3 w-3 text-amber-500" />
                      Pending
                    </span>
                  </SelectItem>
                  <SelectItem value="publishing" textValue="Publishing">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 text-blue-500" />
                      Publishing
                    </span>
                  </SelectItem>
                  <SelectItem value="published" textValue="Published">
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      Published
                    </span>
                  </SelectItem>
                  <SelectItem value="failed" textValue="Failed">
                    <span className="flex items-center gap-2">
                      <XCircle className="h-3 w-3 text-red-500" />
                      Failed
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={autopilotFilter}
                onValueChange={setAutopilotFilter}
              >
                <SelectTrigger className="w-[180px] h-10">
                  <SelectValue placeholder="Autopilot" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Autopilots</SelectItem>
                  {autopilots?.map((ap) => (
                    <SelectItem key={ap.id} value={ap.id} textValue={ap.name}>
                      <span className="flex items-center gap-2">
                        <Zap className="h-3 w-3 text-primary" />
                        {ap.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex border rounded-lg overflow-hidden">
                <Button
                  variant={viewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("list")}
                  className="rounded-none h-10 px-3"
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === "calendar" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewMode("calendar")}
                  className="rounded-none border-l h-10 px-3"
                >
                  <Calendar className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <Card className="overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
              <CardContent className="p-6">
                <div className="space-y-4">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center gap-4">
                      <Skeleton className="h-10 w-10 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-48" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-6 w-20" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : filteredItems.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                <div className="mb-6 relative">
                  <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl" />
                  <div className="relative bg-primary/10 p-6 rounded-full">
                    <Send className="h-12 w-12 text-primary" />
                  </div>
                </div>
                <h2 className="text-2xl font-semibold mb-3">No Queue Items</h2>
                <p className="text-muted-foreground mb-6 max-w-md">
                  {statusFilter !== "all" || autopilotFilter !== "all" || searchQuery
                    ? "No items match your current filters. Try adjusting your search criteria."
                    : "Content will appear here when autopilots queue items for publishing."}
                </p>
                {(statusFilter !== "all" || autopilotFilter !== "all" || searchQuery) && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStatusFilter("all");
                      setAutopilotFilter("all");
                      setSearchQuery("");
                    }}
                  >
                    Clear Filters
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : viewMode === "list" ? (
            <Card className="overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-primary via-primary/80 to-primary/60" />
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b">
                    <TableHead className="w-[35%]">Content</TableHead>
                    <TableHead>Autopilot</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => (
                    <TableRow
                      key={item.id}
                      className="group cursor-pointer hover:bg-muted/50"
                      onClick={() => item.content_output?.job_id && navigate(`/jobs/${item.content_output.job_id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-muted/50 shrink-0">
                            {getContentIcon(item.content_output?.pipeline)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[250px]">
                              {item.content_output?.data?.title ||
                                item.content_output?.pipeline?.replace(/_/g, " ") ||
                                "Untitled"}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.is_repost && (
                                <Badge variant="outline" className="text-xs bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30">
                                  <RefreshCcw className="h-2.5 w-2.5 mr-1" />
                                  Repost
                                </Badge>
                              )}
                              {item.status === "pending" && isOverdue(item.scheduled_for) && (
                                <Badge variant="outline" className="text-xs bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                                  <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                                  Overdue
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <Zap className="h-3.5 w-3.5 text-primary" />
                          <span className="truncate max-w-[120px]">
                            {item.autopilot?.name || "Unknown"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const account = findAccountById(item.account_id);
                          return (
                            <PlatformBadge
                              platform={item.platform}
                              name={account?.name}
                              avatarUrl={account?.avatarUrl}
                              showLabel={true}
                              showAvatar={true}
                              size="sm"
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className={`text-sm font-medium ${
                            item.status === "pending" && isOverdue(item.scheduled_for)
                              ? "text-red-600 dark:text-red-400"
                              : item.status === "published"
                              ? "text-green-600 dark:text-green-400"
                              : item.status === "failed"
                              ? "text-red-600 dark:text-red-400"
                              : ""
                          }`}>
                            {getScheduleLabel(item)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {formatDistanceToNow(
                              new Date(item.status === "published" && item.published_at ? item.published_at : item.scheduled_for),
                              { addSuffix: true }
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(item.status)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/jobs/${item.content_output?.job_id}`);
                              }}
                              disabled={!item.content_output?.job_id}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View Content
                            </DropdownMenuItem>
                            {item.status === "pending" && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuSub>
                                  <DropdownMenuSubTrigger>
                                    <CalendarClock className="h-4 w-4 mr-2" />
                                    Reschedule
                                  </DropdownMenuSubTrigger>
                                  <DropdownMenuSubContent>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReschedule(item.id, addHours(new Date(), 1));
                                      }}
                                    >
                                      In 1 hour
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReschedule(item.id, addHours(new Date(), 3));
                                      }}
                                    >
                                      In 3 hours
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReschedule(item.id, addHours(new Date(), 6));
                                      }}
                                    >
                                      In 6 hours
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReschedule(item.id, addDays(new Date(), 1));
                                      }}
                                    >
                                      Tomorrow
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRescheduleItem(item);
                                      }}
                                    >
                                      Custom date/time...
                                    </DropdownMenuItem>
                                  </DropdownMenuSubContent>
                                </DropdownMenuSub>
                              </>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteItem(item);
                              }}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove from Queue
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : (
            /* Calendar View */
            <div className="space-y-6">
              {Object.entries(groupedByDate)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, items]) => {
                  const dateObj = new Date(date);
                  const isDateToday = isToday(dateObj);
                  const isDateTomorrow = isTomorrow(dateObj);

                  return (
                    <Card key={date} className="overflow-hidden">
                      <div className={`h-1 ${
                        isDateToday
                          ? "bg-gradient-to-r from-green-500 via-green-500/80 to-green-500/60"
                          : isDateTomorrow
                          ? "bg-gradient-to-r from-blue-500 via-blue-500/80 to-blue-500/60"
                          : "bg-gradient-to-r from-primary via-primary/80 to-primary/60"
                      }`} />
                      <CardHeader className="pb-3">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${
                            isDateToday
                              ? "bg-green-500/10"
                              : isDateTomorrow
                              ? "bg-blue-500/10"
                              : "bg-primary/10"
                          }`}>
                            <Calendar className={`h-5 w-5 ${
                              isDateToday
                                ? "text-green-500"
                                : isDateTomorrow
                                ? "text-blue-500"
                                : "text-primary"
                            }`} />
                          </div>
                          <div>
                            <CardTitle className="text-lg">
                              {getDateGroupLabel(date)}
                            </CardTitle>
                            <CardDescription>
                              {items.length} item{items.length !== 1 ? "s" : ""} scheduled
                            </CardDescription>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {items
                            .sort(
                              (a, b) =>
                                new Date(a.scheduled_for).getTime() -
                                new Date(b.scheduled_for).getTime()
                            )
                            .map((item) => (
                              <div
                                key={item.id}
                                className="group flex items-center gap-4 p-4 bg-muted/30 rounded-lg border border-border/50 hover:border-primary/20 hover:bg-muted/50 transition-all cursor-pointer"
                                onClick={() => item.content_output?.job_id && navigate(`/jobs/${item.content_output.job_id}`)}
                              >
                                <div className={`text-sm font-semibold w-16 text-center px-2 py-1 rounded ${
                                  item.status === "published"
                                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                                    : item.status === "pending" && isOverdue(item.scheduled_for)
                                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                    : item.status === "failed"
                                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                                    : "bg-muted text-muted-foreground"
                                }`}>
                                  {format(new Date(item.status === "published" && item.published_at ? item.published_at : item.scheduled_for), "HH:mm")}
                                </div>
                                <div className="p-2 rounded-lg bg-background/50">
                                  {getContentIcon(item.content_output?.pipeline)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">
                                    {item.content_output?.data?.title ||
                                      item.content_output?.pipeline?.replace(/_/g, " ") ||
                                      "Untitled"}
                                  </div>
                                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                                    <span className="flex items-center gap-1">
                                      <Zap className="h-3 w-3 text-primary" />
                                      {item.autopilot?.name}
                                    </span>
                                    <span>&rarr;</span>
                                    {(() => {
                                      const account = findAccountById(item.account_id);
                                      return (
                                        <PlatformBadge
                                          platform={item.platform}
                                          name={account?.name}
                                          avatarUrl={account?.avatarUrl}
                                          showLabel={true}
                                          showAvatar={true}
                                          size="sm"
                                        />
                                      );
                                    })()}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {item.is_repost && (
                                    <Badge variant="outline" className="text-xs bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/30">
                                      <RefreshCcw className="h-2.5 w-2.5 mr-1" />
                                      Repost
                                    </Badge>
                                  )}
                                  {getStatusBadge(item.status)}
                                </div>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        navigate(`/jobs/${item.content_output?.job_id}`);
                                      }}
                                      disabled={!item.content_output?.job_id}
                                    >
                                      <ExternalLink className="h-4 w-4 mr-2" />
                                      View Content
                                    </DropdownMenuItem>
                                    {item.status === "pending" && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <CalendarClock className="h-4 w-4 mr-2" />
                                            Reschedule
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleReschedule(item.id, addHours(new Date(), 1));
                                              }}
                                            >
                                              In 1 hour
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleReschedule(item.id, addHours(new Date(), 3));
                                              }}
                                            >
                                              In 3 hours
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleReschedule(item.id, addDays(new Date(), 1));
                                              }}
                                            >
                                              Tomorrow
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setRescheduleItem(item);
                                              }}
                                            >
                                              Custom date/time...
                                            </DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                      </>
                                    )}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setDeleteItem(item);
                                      }}
                                      className="text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Remove
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from Queue</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this item from the publish queue?
              {deleteItem?.content_output?.data?.title && (
                <span className="block mt-2 font-medium text-foreground">
                  "{deleteItem.content_output.data.title}"
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Custom Reschedule Dialog */}
      <Dialog open={!!rescheduleItem} onOpenChange={(open) => !open && setRescheduleItem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule Publication</DialogTitle>
            <DialogDescription>
              Choose a new date and time for this content to be published.
              {rescheduleItem?.content_output?.data?.title && (
                <span className="block mt-2 font-medium text-foreground">
                  "{rescheduleItem.content_output.data.title}"
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="datetime">New Date & Time</Label>
              <Input
                id="datetime"
                type="datetime-local"
                value={customDateTime}
                onChange={(e) => setCustomDateTime(e.target.value)}
                min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleItem(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleCustomReschedule}
              disabled={!customDateTime || rescheduleMutation.isPending}
            >
              {rescheduleMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CalendarClock className="h-4 w-4 mr-2" />
              )}
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
