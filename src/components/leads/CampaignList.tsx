import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  FileEdit,
  Instagram,
  Linkedin,
  Magnet,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { cn } from "@/lib/utils";
import type { UnipileCampaign } from "@/hooks/useUnipileCampaigns";

interface CampaignListProps {
  campaigns: UnipileCampaign[];
  isLoading: boolean;
  onSelect: (campaign: UnipileCampaign) => void;
  onEdit: (campaign: UnipileCampaign) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string, is_active: boolean) => void;
  onSetStatus?: (id: string, status: "draft" | "active" | "paused") => void;
  onCreate?: () => void;
  isUpdating?: boolean;
}

export function CampaignStatusBadge({
  status,
}: {
  status: UnipileCampaign["status"];
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 font-medium capitalize",
        status === "active" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        status === "paused" &&
          "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        status === "draft" && "bg-muted text-muted-foreground",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full bg-current"
        aria-hidden="true"
      />
      {status}
    </Badge>
  );
}

export function CampaignList({
  campaigns,
  isLoading,
  onSelect,
  onEdit,
  onDelete,
  onToggleStatus,
  onSetStatus,
  onCreate,
  isUpdating,
}: CampaignListProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [platform, setPlatform] = useState("all");
  const filteredCampaigns = useMemo(
    () =>
      campaigns.filter((campaign) => {
        const query = search.trim().toLowerCase();
        return (
          (status === "all" || campaign.status === status) &&
          (platform === "all" || campaign.account?.provider === platform) &&
          (!query ||
            [
              campaign.name,
              campaign.trigger_keywords,
              campaign.account?.display_name,
              campaign.account?.username,
            ].some((value) => value?.toLowerCase().includes(query)))
        );
      }),
    [campaigns, search, status, platform],
  );
  const hasFilters = !!search || status !== "all" || platform !== "all";
  const resetFilters = () => {
    setSearch("");
    setStatus("all");
    setPlatform("all");
  };

  return (
    <div className="space-y-4">
      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) onDelete(deleteId);
          setDeleteId(null);
        }}
        itemName={campaigns.find((c) => c.id === deleteId)?.name || "campaign"}
        itemType="campaign"
        description="This will delete the campaign and all its monitored posts. Leads will be preserved."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 basis-56 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            aria-label="Search campaigns"
            placeholder="Search campaigns or keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 bg-card pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger
              aria-label="Filter campaigns by status"
              className="h-10 w-[140px] bg-card"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger
              aria-label="Filter campaigns by platform"
              className="h-10 w-[145px] bg-card"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
              <SelectItem value="INSTAGRAM">Instagram</SelectItem>
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button variant="ghost" onClick={resetFilters}>
              Clear filters
            </Button>
          )}
        </div>
        {!isLoading && (
          <p className="text-xs text-muted-foreground sm:ml-auto" role="status">
            {hasFilters
              ? `${filteredCampaigns.length} of ${campaigns.length}`
              : campaigns.length}{" "}
            {campaigns.length === 1 ? "campaign" : "campaigns"}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center">
          <div className="mb-5 rounded-2xl bg-amber-500/10 p-4">
            <Magnet className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-xl font-semibold">
            Turn comments into conversations
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Choose a keyword, write your delivery message, and add a post. ACA
            captures interested people and shares your resource.
          </p>
          {onCreate && (
            <Button variant="cta" className="mt-6" onClick={onCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first campaign
            </Button>
          )}
          <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span>1. Set a keyword</span>
            <span>2. Add your resource</span>
            <span>3. Monitor a post</span>
          </div>
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-14 text-center">
          <Search className="mx-auto mb-4 h-6 w-6 text-muted-foreground" />
          <h2 className="font-semibold">No matching campaigns</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Try another name, keyword, or filter.
          </p>
          <Button variant="outline" className="mt-5" onClick={resetFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCampaigns.map((campaign) => {
            const Icon =
              campaign.account?.provider === "INSTAGRAM" ? Instagram : Linkedin;
            const keywords = campaign.trigger_keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean);
            return (
              <article
                key={campaign.id}
                className="group flex min-w-0 flex-col rounded-xl border bg-card transition-colors hover:border-foreground/25"
              >
                <div className="flex items-center justify-between px-5 pt-5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        "rounded-lg p-2",
                        campaign.account?.provider === "INSTAGRAM"
                          ? "bg-pink-500/10 text-pink-600 dark:text-pink-400"
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <CampaignStatusBadge status={campaign.status} />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Actions for ${campaign.name}`}
                        disabled={isUpdating}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEdit(campaign)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit campaign
                      </DropdownMenuItem>
                      {campaign.status !== "active" ? (
                        <DropdownMenuItem
                          onClick={() =>
                            onSetStatus
                              ? onSetStatus(campaign.id, "active")
                              : onToggleStatus(campaign.id, true)
                          }
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Activate
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() =>
                            onSetStatus
                              ? onSetStatus(campaign.id, "paused")
                              : onToggleStatus(campaign.id, false)
                          }
                        >
                          <Pause className="mr-2 h-4 w-4" />
                          Pause
                        </DropdownMenuItem>
                      )}
                      {onSetStatus && campaign.status !== "draft" && (
                        <DropdownMenuItem
                          onClick={() => onSetStatus(campaign.id, "draft")}
                        >
                          <FileEdit className="mr-2 h-4 w-4" />
                          Move to draft
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(campaign.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete campaign
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(campaign)}
                  className="flex min-w-0 flex-1 flex-col rounded-b-xl px-5 pb-4 pt-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <h2 className="line-clamp-2 text-base font-semibold leading-snug group-hover:text-amber-700 dark:group-hover:text-amber-400">
                    {campaign.name}
                  </h2>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {campaign.sender_account_ids &&
                    campaign.sender_account_ids.length > 1
                      ? `${campaign.sender_account_ids.length} sender accounts`
                      : campaign.account?.display_name ||
                        campaign.account?.username ||
                        "Account unavailable"}
                  </p>
                  <div className="my-4 flex min-h-6 flex-wrap gap-1.5">
                    {keywords.slice(0, 3).map((keyword) => (
                      <Badge
                        key={keyword}
                        variant="secondary"
                        className="max-w-full truncate font-normal"
                      >
                        {keyword}
                      </Badge>
                    ))}
                    {keywords.length > 3 && (
                      <Badge variant="outline">+{keywords.length - 3}</Badge>
                    )}
                  </div>
                  <div className="mt-auto grid w-full grid-cols-3 gap-3 border-t pt-4">
                    {[
                      { label: "Captured", value: campaign.stats?.total_leads },
                      { label: "DMs sent", value: campaign.stats?.dm_sent },
                      {
                        label: "Active posts",
                        value: campaign.stats?.monitored_posts,
                      },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <p className="text-lg font-semibold tabular-nums">
                          {(stat.value || 0).toLocaleString()}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {stat.label}
                        </p>
                      </div>
                    ))}
                  </div>
                  <span className="mt-4 flex w-full items-center justify-between text-xs font-medium text-muted-foreground">
                    Open campaign
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
