import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { SendingHealthAlert } from "@/components/SendingHealthAlert";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import {
  useEmailSequences,
  useDeleteEmailSequence,
  useToggleSequenceStatus,
  useCreateEmailSequence,
} from "@/hooks/useEmailSequences";
import { DuplicateSequenceDialog } from "@/components/email/DuplicateSequenceDialog";
import { OrgFleetNotice } from "@/components/email/FleetDemandNotice";
import {
  Search,
  Plus,
  GitBranch,
  Play,
  Pause,
  Trash2,
  MoreHorizontal,
  Mail,
  Tag,
  FileEdit,
  Users,
  Copy,
  AlertTriangle,
  MessageSquare,
  X,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { SequenceStatus } from "@/types/email";
import type { SequenceWithStats } from "@/hooks/useEmailSequences";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { EmailCampaignsShowcase } from "@/components/showcase/EmailCampaignsShowcase";

type StatusFilter = "all" | SequenceStatus;
type SortOrder = "newest" | "updated" | "name";

const STATUS_BADGES: Record<
  SequenceStatus,
  { label: string; color: string; dot: string }
> = {
  draft: {
    label: "Draft",
    color: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  },
  active: {
    label: "Active",
    color:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  paused: {
    label: "Paused",
    color:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    dot: "bg-amber-500",
  },
  completed: {
    label: "Completed",
    color: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    dot: "bg-blue-500",
  },
};

export default function EmailSequences() {
  const navigate = useNavigate();
  const { hasFeature, showUpgradePrompts } = useFeatureAccess();
  const canUseEmail = hasFeature("email_campaigns");
  const {
    data: sequences,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useEmailSequences(canUseEmail);
  const deleteMutation = useDeleteEmailSequence();
  const toggleMutation = useToggleSequenceStatus();
  const createMutation = useCreateEmailSequence();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [duplicateTarget, setDuplicateTarget] =
    useState<SequenceWithStats | null>(null);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    sequences?.forEach((seq) =>
      seq.settings.tags?.forEach((tag) =>
        counts.set(tag, (counts.get(tag) ?? 0) + 1),
      ),
    );
    return counts;
  }, [sequences]);
  const allTags = useMemo(
    () => Array.from(tagCounts.keys()).sort((a, b) => a.localeCompare(b)),
    [tagCounts],
  );

  if (!canUseEmail && showUpgradePrompts) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 p-4 sm:p-8">
          <EmailCampaignsShowcase />
        </div>
      </AppLayout>
    );
  }
  if (!canUseEmail) {
    return (
      <AppLayout
        header={
          <div className="ml-auto">
            <UserProfileMenu />
          </div>
        }
      >
        <div className="flex-1 px-4 py-12 text-center">
          <p className="text-muted-foreground">
            This feature is not available for your organization.
          </p>
        </div>
      </AppLayout>
    );
  }

  const query = searchQuery.trim().toLowerCase();
  const hasFilters = !!query || statusFilter !== "all" || !!tagFilter;
  const filtered = (sequences ?? [])
    .filter((seq) => {
      if (statusFilter !== "all" && seq.status !== statusFilter) return false;
      if (tagFilter && !seq.settings.tags?.includes(tagFilter)) return false;
      return !query || seq.name.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (sortOrder === "name") return a.name.localeCompare(b.name);
      const dateKey = sortOrder === "updated" ? "updated_at" : "created_at";
      return new Date(b[dateKey]).getTime() - new Date(a[dateKey]).getTime();
    });
  const statusCounts: Record<StatusFilter, number> = {
    all: sequences?.length ?? 0,
    draft: sequences?.filter((s) => s.status === "draft").length ?? 0,
    active: sequences?.filter((s) => s.status === "active").length ?? 0,
    paused: sequences?.filter((s) => s.status === "paused").length ?? 0,
    completed: sequences?.filter((s) => s.status === "completed").length ?? 0,
  };
  const summary = [
    {
      label: "Active sequences",
      value: statusCounts.active,
      icon: Play,
      description: "Sequences enabled for sending",
    },
    {
      label: "Total enrolled",
      value:
        sequences?.reduce((total, seq) => total + seq.enrollment_total, 0) ?? 0,
      icon: Users,
      description: "Enrollments across all sequences",
    },
    {
      label: "Replies received",
      value:
        sequences?.reduce((total, seq) => total + seq.enrollment_replied, 0) ??
        0,
      icon: MessageSquare,
      description: "Enrollments marked as replied",
    },
  ];
  const resetFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setTagFilter(null);
  };
  const handleCreate = () => {
    createMutation.mutate(
      { name: "New Sequence" },
      { onSuccess: (data) => navigate(`/email/sequences/${data.id}`) },
    );
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <PageHeader
            icon={GitBranch}
            title="Email sequences"
            description="Create your outreach, follow up automatically, and track every reply."
            actions={
              <Button
                variant="cta"
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {createMutation.isPending ? "Creating…" : "New sequence"}
              </Button>
            }
          />

          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {summary.map(({ label, value, icon: Icon, description }) => (
              <div
                key={label}
                className="flex min-w-0 items-center gap-4 rounded-xl border bg-card px-3 py-3 sm:px-5 sm:py-4"
              >
                <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 sm:flex text-amber-700 dark:text-amber-400">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {label}
                  </p>
                  {isLoading ? (
                    <Skeleton className="my-1 h-7 w-14" />
                  ) : (
                    <p className="text-xl sm:text-2xl font-semibold tabular-nums">
                      {isError ? "—" : value.toLocaleString()}
                    </p>
                  )}
                  <p className="hidden text-xs text-muted-foreground sm:block">
                    {description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <SendingHealthAlert channel="email" />

          <OrgFleetNotice />

          <section
            className="overflow-hidden rounded-xl border bg-card"
            aria-label="Your email sequences"
          >
            <div className="space-y-4 border-b p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative min-w-0 flex-1 sm:min-w-56">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    aria-label="Search sequences by name"
                    placeholder="Search sequences…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 pl-9 pr-9"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 h-8 w-8"
                      aria-label="Clear search"
                      onClick={() => setSearchQuery("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {allTags.length > 0 && (
                  <Select
                    value={
                      tagFilter === null ? "__all_tags__" : `tag:${tagFilter}`
                    }
                    onValueChange={(value) =>
                      setTagFilter(
                        value === "__all_tags__" ? null : value.slice(4),
                      )
                    }
                  >
                    <SelectTrigger
                      className="h-10 w-full sm:w-44"
                      aria-label="Filter by tag"
                    >
                      <Tag
                        className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <SelectValue placeholder="All tags" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all_tags__">All tags</SelectItem>
                      {allTags.map((tag) => (
                        <SelectItem key={tag} value={`tag:${tag}`}>
                          {tag} ({tagCounts.get(tag)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select
                  value={sortOrder}
                  onValueChange={(value) => setSortOrder(value as SortOrder)}
                >
                  <SelectTrigger
                    className="h-10 w-full sm:w-44"
                    aria-label="Sort sequences"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="updated">Recently updated</SelectItem>
                    <SelectItem value="name">Name: A to Z</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className="flex flex-wrap gap-1.5"
                  role="group"
                  aria-label="Filter by sequence status"
                >
                  {(
                    Object.entries(statusCounts) as [StatusFilter, number][]
                  ).map(([key, count]) => (
                    <Button
                      key={key}
                      variant="ghost"
                      size="sm"
                      aria-pressed={statusFilter === key}
                      onClick={() => setStatusFilter(key)}
                      className={cn(
                        "h-8 gap-2 rounded-lg px-3 text-xs",
                        statusFilter === key
                          ? "bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300 ring-1 ring-inset ring-amber-500/25"
                          : "text-muted-foreground",
                      )}
                    >
                      {key === "all"
                        ? "All sequences"
                        : STATUS_BADGES[key].label}
                      <span className="tabular-nums opacity-70">
                        {isLoading || isError ? "—" : count}
                      </span>
                    </Button>
                  ))}
                </div>
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="h-8 text-xs"
                  >
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    Clear filters
                  </Button>
                )}
              </div>
            </div>

            {isError ? (
              <div
                role="alert"
                className="flex flex-col items-center px-6 py-16 text-center"
              >
                <AlertTriangle className="mb-4 h-8 w-8 text-amber-600" />
                <h2 className="text-lg font-semibold">
                  Couldn't load your sequences
                </h2>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  Please try again to see your sequences and enrollment
                  activity.
                </p>
                <Button
                  variant="outline"
                  className="mt-5"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                >
                  {isFetching ? "Retrying…" : "Try again"}
                </Button>
              </div>
            ) : isLoading ? (
              <div
                className="space-y-5 p-5"
                aria-label="Loading sequences"
                role="status"
              >
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-7 w-20 rounded-full" />
                  </div>
                ))}
              </div>
            ) : filtered.length > 0 ? (
              <>
                <div
                  className="border-b bg-muted/20 px-4 py-3 text-xs text-muted-foreground sm:px-5"
                  aria-live="polite"
                >
                  Showing{" "}
                  <span className="font-medium text-foreground">
                    {filtered.length}
                  </span>{" "}
                  of {sequences?.length ?? 0} sequences
                </div>
                <div
                  className="hidden grid-cols-[minmax(220px,1fr)_100px_300px_180px] items-center gap-4 border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground xl:grid"
                  aria-hidden="true"
                >
                  <span>Sequence</span>
                  <span>Status</span>
                  <div className="grid grid-cols-4 text-center">
                    <span>Enrolled</span>
                    <span>Active</span>
                    <span>Replied</span>
                    <span>Bounced</span>
                  </div>
                  <span className="text-right">Manage</span>
                </div>
                <div className="divide-y">
                  {filtered.map((seq) => {
                    const badge = STATUS_BADGES[seq.status];
                    const emailSteps = seq.steps.filter(
                      (step) =>
                        step.type === "email" || step.type === "ab_test",
                    ).length;
                    const updatedAt = new Date(
                      seq.updated_at || seq.created_at,
                    );
                    const metrics = [
                      {
                        label: "Enrolled",
                        count: seq.enrollment_total,
                        color: "",
                      },
                      {
                        label: "Active",
                        count: seq.enrollment_active,
                        color: "",
                      },
                      {
                        label: "Replied",
                        count: seq.enrollment_replied,
                        color:
                          seq.enrollment_replied > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "",
                      },
                      {
                        label: "Bounced",
                        count: seq.enrollment_bounced,
                        color:
                          seq.enrollment_bounced > 0 ? "text-destructive" : "",
                      },
                    ];
                    return (
                      <article
                        key={seq.id}
                        className="grid items-center gap-4 p-4 transition-colors hover:bg-muted/20 sm:p-5 xl:grid-cols-[minmax(220px,1fr)_100px_300px_180px]"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/30">
                            <Mail
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                          </div>
                          <div className="min-w-0 space-y-1.5">
                            <h2 className="text-sm font-semibold">
                              <Link
                                to={`/email/sequences/${seq.id}`}
                                className="break-words rounded-sm hover:text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-amber-400"
                              >
                                {seq.name}
                              </Link>
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              {emailSteps} email{" "}
                              {emailSteps === 1 ? "step" : "steps"}
                              {!Number.isNaN(updatedAt.getTime()) && (
                                <>
                                  {" "}
                                  · Updated{" "}
                                  {formatDistanceToNow(updatedAt, {
                                    addSuffix: true,
                                  })}
                                </>
                              )}
                            </p>
                            {(seq.settings.tags?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {seq.settings.tags.slice(0, 3).map((tag) => (
                                  <Badge
                                    key={tag}
                                    variant="outline"
                                    className="max-w-full break-all px-1.5 py-0 text-[10px] font-normal text-muted-foreground"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {seq.settings.tags.length > 3 && (
                                  <Badge
                                    variant="outline"
                                    className="px-1.5 py-0 text-[10px] font-normal"
                                    title={seq.settings.tags
                                      .slice(3)
                                      .join(", ")}
                                  >
                                    +{seq.settings.tags.length - 3}
                                  </Badge>
                                )}
                              </div>
                            )}
                            {seq.status === "active" &&
                              !seq.has_usable_mailbox && (
                                <p className="flex items-start gap-1 text-xs text-destructive">
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  Needs a connected mailbox
                                </p>
                              )}
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={cn("w-fit gap-1.5 text-xs", badge.color)}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              badge.dot,
                            )}
                          />
                          {badge.label}
                        </Badge>
                        <dl className="grid grid-cols-4 rounded-lg bg-muted/30 py-3 xl:rounded-none xl:bg-transparent xl:py-0">
                          {metrics.map(({ label, count, color }) => (
                            <div key={label} className="text-center">
                              <dt className="text-[11px] text-muted-foreground xl:sr-only">
                                {label}
                              </dt>
                              <dd
                                className={cn(
                                  "mt-0.5 text-sm font-semibold tabular-nums xl:mt-0",
                                  color,
                                )}
                              >
                                {count.toLocaleString()}
                              </dd>
                            </div>
                          ))}
                        </dl>
                        <div className="flex items-center gap-2 xl:justify-end">
                          <Button asChild variant="outline" size="sm">
                            <Link
                              to={`/email/sequences/${seq.id}`}
                              aria-label={`Edit ${seq.name}`}
                            >
                              <FileEdit className="mr-1.5 h-3.5 w-3.5" />
                              Edit
                            </Link>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`Actions for ${seq.name}`}
                              >
                                <MoreHorizontal className="mr-1.5 h-4 w-4" />
                                Actions
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {seq.status === "active" && (
                                <DropdownMenuItem
                                  disabled={toggleMutation.isPending}
                                  onClick={() =>
                                    toggleMutation.mutate({
                                      id: seq.id,
                                      status: "paused",
                                    })
                                  }
                                >
                                  <Pause className="mr-2 h-4 w-4" />
                                  Pause sequence
                                </DropdownMenuItem>
                              )}
                              {(seq.status === "draft" ||
                                seq.status === "paused") && (
                                <DropdownMenuItem
                                  onClick={() =>
                                    navigate(`/email/sequences/${seq.id}`)
                                  }
                                >
                                  <Play className="mr-2 h-4 w-4" />
                                  Review and activate
                                </DropdownMenuItem>
                              )}
                              {(seq.status === "active" ||
                                seq.status === "paused") && (
                                <DropdownMenuItem
                                  disabled={toggleMutation.isPending}
                                  onClick={() =>
                                    toggleMutation.mutate({
                                      id: seq.id,
                                      status: "draft",
                                    })
                                  }
                                >
                                  <FileEdit className="mr-2 h-4 w-4" />
                                  Move to draft
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => setDuplicateTarget(seq)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={deleteMutation.isPending}
                                onClick={() =>
                                  setDeleteTarget({
                                    id: seq.id,
                                    name: seq.name,
                                  })
                                }
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-6 py-16 text-center" aria-live="polite">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  {hasFilters ? (
                    <Search className="h-6 w-6" />
                  ) : (
                    <GitBranch className="h-6 w-6" />
                  )}
                </div>
                <h2 className="text-lg font-semibold">
                  {hasFilters
                    ? "No matching sequences"
                    : "Start your first email sequence"}
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                  {hasFilters
                    ? "Try another name, status, or tag to find your sequence."
                    : "Write your first email, add follow-ups, and choose your sending mailboxes."}
                </p>
                {hasFilters ? (
                  <Button
                    variant="outline"
                    className="mt-5"
                    onClick={resetFilters}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button
                    variant="cta"
                    className="mt-5"
                    disabled={createMutation.isPending}
                    onClick={handleCreate}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create sequence
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <DuplicateSequenceDialog
        open={!!duplicateTarget}
        onOpenChange={(open) => !open && setDuplicateTarget(null)}
        sequence={duplicateTarget}
        enrollmentTotal={duplicateTarget?.enrollment_total}
      />
      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
        itemName={deleteTarget?.name || ""}
        itemType="sequence"
      />
    </AppLayout>
  );
}
