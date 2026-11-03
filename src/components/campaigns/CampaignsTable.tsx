import { useEffect, useMemo, useState } from "react";
import { Portal as TooltipPortal } from "@radix-ui/react-tooltip";
import { Link, useSearchParams } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Plus,
  Search,
  UserRound,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CampaignStatusBadge } from "@/components/campaigns/CampaignStatusBadge";
import { CampaignActions } from "@/components/campaigns/CampaignActions";
import type { CampaignStatus, LinkedInCampaign } from "@/hooks/useCampaigns";
import type { AccountWithLimits } from "@/hooks/useAccountsWithLimits";

interface CampaignsTableProps {
  campaigns: LinkedInCampaign[];
  isLoading?: boolean;
  isError?: boolean;
  isFetching?: boolean;
  onRetry?: () => void;
  accounts?: AccountWithLimits[];
}

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "completed", label: "Completed" },
] as const;
const PAGE_SIZE = 10;

const getSenderIds = (campaign: LinkedInCampaign) => [
  ...new Set([
    ...(campaign.sender_accounts?.linkedin?.length
      ? campaign.sender_accounts.linkedin
      : campaign.sender_account_ids ?? []),
    ...Object.entries(campaign.sender_accounts ?? {}).flatMap(
      ([channel, ids]) => channel === "linkedin" ? [] : ids ?? [],
    ),
  ]),
];

function getAccountName(account?: AccountWithLimits) {
  return (
    account?.display_name?.trim() ||
    [account?.first_name, account?.last_name].filter(Boolean).join(" ") ||
    account?.username ||
    "Unavailable sender"
  );
}

function getCampaignContext(campaign: LinkedInCampaign) {
  const listCount =
    campaign.lead_list_ids?.length ?? (campaign.lead_list_id ? 1 : 0);
  if (campaign.lead_list)
    return `${campaign.lead_list.name}${listCount > 1 ? ` + ${listCount - 1} more` : ""}`;
  if (listCount > 0)
    return `${listCount} lead ${listCount === 1 ? "list" : "lists"}`;
  return campaign.description || "No lead list assigned";
}

function CampaignName({ campaign }: { campaign: LinkedInCampaign }) {
  return (
    <div className="min-w-0">
      <Link
        to={`/campaigns/${campaign.id}`}
        title={campaign.name}
        className="block w-fit max-w-full truncate rounded-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {campaign.name}
      </Link>
      <p
        className="mt-1 truncate text-xs text-muted-foreground"
        title={getCampaignContext(campaign)}
      >
        {getCampaignContext(campaign)}
      </p>
    </div>
  );
}

function CampaignReach({ campaign }: { campaign: LinkedInCampaign }) {
  const contacted = campaign.contacted_leads ?? 0;
  const reach =
    campaign.total_leads > 0
      ? Math.min(100, (contacted / campaign.total_leads) * 100)
      : 0;
  return (
    <div className="max-w-[180px] space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
        <span className="font-medium">{contacted.toLocaleString()}</span>
        <span className="text-xs text-muted-foreground">
          {campaign.total_leads > 0 ? `${Math.round(reach)}%` : "—"}
        </span>
      </div>
      <Progress
        value={reach}
        aria-label={`${contacted} of ${campaign.total_leads} enrolled leads contacted`}
        className="h-1.5 bg-muted [&>div]:bg-emerald-500"
      />
    </div>
  );
}

function CampaignReplies({ campaign }: { campaign: LinkedInCampaign }) {
  const contacted = campaign.contacted_leads ?? 0;
  const replies = campaign.replied_count ?? 0;
  const replyRate =
    contacted > 0 ? Math.round((replies / contacted) * 100) : null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex flex-col rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-sm font-medium tabular-nums">
            {replies.toLocaleString()}
          </span>
          <span className="mt-1 text-xs text-muted-foreground tabular-nums">
            {replyRate === null ? "—" : `${replyRate}% of contacted`}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent className="max-w-64">
          {replies.toLocaleString()} leads replied out of{" "}
          {contacted.toLocaleString()} contacted leads. The reply rate uses
          contacted leads, not all enrolled leads.
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  );
}

function CampaignSenders({
  campaign,
  accountsMap,
}: {
  campaign: LinkedInCampaign;
  accountsMap: Map<string, AccountWithLimits>;
}) {
  const ids = getSenderIds(campaign);
  if (!ids.length)
    return <span className="text-xs text-muted-foreground">No senders</span>;
  return (
    <div
      className="flex items-center -space-x-2"
      role="group"
      aria-label="Campaign senders"
    >
      {ids.slice(0, 3).map((id) => {
        const account = accountsMap.get(id);
        const name = getAccountName(account);
        const initials = account
          ? name
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0])
              .join("")
              .toUpperCase()
          : null;
        const label = account
          ? `${name} · ${account.provider.charAt(0)}${account.provider.slice(1).toLowerCase()}`
          : name;
        return (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="img"
                aria-label={label}
                className="rounded-full outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Avatar
                  className="h-8 w-8 border-2 border-card"
                  aria-hidden="true"
                >
                  <AvatarImage
                    src={account?.avatar_url || undefined}
                    alt=""
                    referrerPolicy="no-referrer"
                  />
                  <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
                    {initials || <UserRound className="h-3.5 w-3.5" />}
                  </AvatarFallback>
                </Avatar>
              </span>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent>{label}</TooltipContent>
            </TooltipPortal>
          </Tooltip>
        );
      })}
      {ids.length > 3 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              role="img"
              aria-label={`${ids.length - 3} more senders`}
              className="rounded-full outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar
                className="h-8 w-8 border-2 border-card"
                aria-hidden="true"
              >
                <AvatarFallback className="bg-muted text-[10px] font-medium">
                  +{ids.length - 3}
                </AvatarFallback>
              </Avatar>
            </span>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent>
              {ids
                .slice(3)
                .map((id) => getAccountName(accountsMap.get(id)))
                .join(", ")}
            </TooltipContent>
          </TooltipPortal>
        </Tooltip>
      )}
    </div>
  );
}

export function CampaignsTable({
  campaigns,
  isLoading,
  isError,
  isFetching,
  onRetry,
  accounts = [],
}: CampaignsTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CampaignStatus | "all">(() => {
    const value = searchParams.get("status");
    return STATUS_FILTERS.some((filter) => filter.value === value)
      ? value as CampaignStatus | "all" : "all";
  });
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [sender, setSender] = useState(() => searchParams.get("sender") || "all");
  const [sort, setSort] = useState(() => {
    const value = searchParams.get("sort");
    return ["newest", "name", "replies"].includes(value || "") ? value! : "newest";
  });
  const [page, setPage] = useState(() => {
    const value = Number(searchParams.get("page"));
    return Number.isInteger(value) && value > 0 ? value : 1;
  });

  // Returning from a campaign, reloading, or sharing the URL restores the working view.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const values = { status: status === "all" ? "" : status, q: search,
      sender: sender === "all" ? "" : sender, sort: sort === "newest" ? "" : sort,
      page: page === 1 ? "" : String(page) };
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [status, search, sender, sort, page, searchParams, setSearchParams]);
  const accountsMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const referencedSenderIds = useMemo(
    () => new Set(campaigns.flatMap(getSenderIds)),
    [campaigns],
  );
  const senderOptions = accounts
    .filter((account) => referencedSenderIds.has(account.id))
    .sort((a, b) => getAccountName(a).localeCompare(getAccountName(b)));
  const hasUnavailableSenders = [...referencedSenderIds].some(
    (id) => !accountsMap.has(id),
  );
  const counts = Object.fromEntries(
    STATUS_FILTERS.map((filter) => [
      filter.value,
      filter.value === "all"
        ? campaigns.length
        : campaigns.filter((campaign) => campaign.status === filter.value)
            .length,
    ]),
  );
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns
      .filter((campaign) => {
        if (status !== "all" && campaign.status !== status) return false;
        const senderIds = getSenderIds(campaign);
        if (
          sender === "unavailable" &&
          !senderIds.some((id) => !accountsMap.has(id))
        )
          return false;
        if (
          sender !== "all" &&
          sender !== "unavailable" &&
          !senderIds.includes(sender)
        )
          return false;
        return (
          !term ||
          [campaign.name, campaign.description, campaign.lead_list?.name].some(
            (value) => value?.toLowerCase().includes(term),
          )
        );
      })
      .sort((a, b) => {
        if (sort === "name") return a.name.localeCompare(b.name);
        if (sort === "replies")
          return (
            (b.replied_count ?? 0) - (a.replied_count ?? 0) ||
            b.created_at.localeCompare(a.created_at)
          );
        return b.created_at.localeCompare(a.created_at);
      });
  }, [campaigns, status, search, sender, sort, accountsMap]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleCampaigns = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const hasFilters =
    status !== "all" || search.trim() !== "" || sender !== "all";
  const resetFilters = () => {
    setStatus("all");
    setSearch("");
    setSender("all");
    setPage(1);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value as CampaignStatus | "all");
          setPage(1);
        }}
        className="min-w-0 overflow-hidden rounded-xl border bg-card"
      >
        <div className="overflow-x-auto border-b px-4 sm:px-5">
          <TabsList
            aria-label="Filter campaigns by status"
            className="h-auto w-max justify-start gap-4 rounded-none bg-transparent p-0 sm:gap-6"
          >
            {STATUS_FILTERS.map((filter) => (
              <TabsTrigger
                key={filter.value}
                value={filter.value}
                className="relative gap-2 rounded-none border-b-2 border-transparent px-0 py-3 data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
              >
                {filter.label}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                  {isLoading || isError ? "—" : counts[filter.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={status} className="mt-0">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-5">
            <div className="relative min-w-[200px] flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Search campaigns"
                placeholder="Search campaigns…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="pl-9 pr-9"
              />
              {search && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="absolute right-1 top-1 h-8 w-8"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <Select
              value={sender}
              onValueChange={(value) => {
                setSender(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Filter by sender"
                className="w-full sm:w-[200px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="All senders" className="truncate" />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All senders</SelectItem>
                {senderOptions.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {getAccountName(account)}
                  </SelectItem>
                ))}
                {hasUnavailableSenders && (
                  <SelectItem value="unavailable">
                    Unavailable senders
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Select
              value={sort}
              onValueChange={(value) => {
                setSort(value);
                setPage(1);
              }}
            >
              <SelectTrigger
                aria-label="Sort campaigns"
                className="w-full sm:w-[180px]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ArrowUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="name">Name A–Z</SelectItem>
                <SelectItem value="replies">Most replies</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
          {isError ? (
            <div
              className="flex flex-col items-center px-6 py-16 text-center"
              role="alert"
            >
              <AlertCircle className="mb-4 h-8 w-8 text-muted-foreground" />
              <h2 className="text-base font-semibold">
                Couldn't load campaigns
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try again to see your campaigns and their latest activity.
              </p>
              <Button
                variant="outline"
                onClick={onRetry}
                disabled={isFetching}
                className="mt-5"
              >
                {isFetching ? "Retrying…" : "Try again"}
              </Button>
            </div>
          ) : isLoading ? (
            <div
              className="space-y-4 p-5"
              role="status"
              aria-label="Loading campaigns"
            >
              {Array.from({ length: 5 }, (_, index) => (
                <div
                  key={index}
                  className="flex items-center gap-6 border-b pb-4 last:border-0"
                >
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="hidden h-5 w-32 sm:block" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <div className="mb-4 rounded-xl bg-muted p-3">
                {campaigns.length ? (
                  <Search className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <Megaphone className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
              <h2 className="text-base font-semibold">
                {campaigns.length
                  ? "No matching campaigns"
                  : "Create your first automation"}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {campaigns.length
                  ? "Try a different search or reset your filters."
                  : "Choose your audience, build a sequence and start reaching the right people."}
              </p>
              {campaigns.length ? (
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={resetFilters}
                >
                  Reset filters
                </Button>
              ) : (
                <Button variant="cta" asChild className="mt-5">
                  <Link to="/campaigns/new">
                    <Plus className="h-4 w-4" />
                    New automation
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <Table className="min-w-[880px] table-fixed">
                  <TableHeader className="bg-muted/30">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[28%] pl-5">Campaign</TableHead>
                      <TableHead className="w-[13%]">Status</TableHead>
                      <TableHead className="w-[10%]">Enrolled</TableHead>
                      <TableHead className="w-[17%]">Contacted</TableHead>
                      <TableHead className="w-[16%]">Replies</TableHead>
                      <TableHead className="w-[10%]">Senders</TableHead>
                      <TableHead className="w-[56px] pr-5">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCampaigns.map((campaign) => (
                      <TableRow key={campaign.id} className="hover:bg-muted/30">
                        <TableCell className="py-5 pl-5">
                          <CampaignName campaign={campaign} />
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            Created{" "}
                            {formatDistanceToNow(
                              new Date(campaign.created_at),
                              { addSuffix: true },
                            )}
                          </p>
                        </TableCell>
                        <TableCell>
                          <CampaignStatusBadge status={campaign.status} />
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {campaign.total_leads.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <CampaignReach campaign={campaign} />
                        </TableCell>
                        <TableCell>
                          <CampaignReplies campaign={campaign} />
                        </TableCell>
                        <TableCell>
                          <CampaignSenders
                            campaign={campaign}
                            accountsMap={accountsMap}
                          />
                        </TableCell>
                        <TableCell className="px-1 pr-4">
                          <CampaignActions campaign={campaign} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {visibleCampaigns.map((campaign) => (
                  <article key={campaign.id} className="space-y-4 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <CampaignName campaign={campaign} />
                      <CampaignActions campaign={campaign} />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <CampaignStatusBadge status={campaign.status} />
                      <CampaignSenders
                        campaign={campaign}
                        accountsMap={accountsMap}
                      />
                    </div>
                    <dl className="grid grid-cols-3 gap-3">
                      <div>
                        <dt className="mb-2 text-xs text-muted-foreground">
                          Enrolled
                        </dt>
                        <dd className="text-sm font-medium tabular-nums">
                          {campaign.total_leads.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="mb-2 text-xs text-muted-foreground">
                          Contacted
                        </dt>
                        <dd>
                          <CampaignReach campaign={campaign} />
                        </dd>
                      </div>
                      <div>
                        <dt className="mb-2 text-xs text-muted-foreground">
                          Replies
                        </dt>
                        <dd>
                          <CampaignReplies campaign={campaign} />
                        </dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </>
          )}
          {!isLoading && !isError && filtered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 sm:px-5">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filtered.length)} of{" "}
                {filtered.length}{" "}
                {filtered.length === 1 ? "campaign" : "campaigns"}
                {hasFilters ? ` · ${campaigns.length} total` : ""}
              </p>
              <div className="flex items-center gap-2">
                <span className="mr-1 text-xs text-muted-foreground">
                  Page {currentPage} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous page"
                  disabled={currentPage === 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next page"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </TooltipProvider>
  );
}
