import {
  type ComponentProps,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from "react";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Linkedin,
  Instagram,
  ExternalLink,
  Trash2,
  Pause,
  Play,
  Loader2,
  Link as LinkIcon,
  Users,
  Send,
  Clock,
  Zap,
  FileEdit,
  RefreshCw,
  MessageSquare,
  Settings2,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CampaignStatusBadge } from "@/components/leads/CampaignList";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { LeadMagnetSmartSettings } from "@/components/leads/LeadMagnetSmartSettings";
import { CampaignComments } from "@/components/leads/CampaignComments";
import { CampaignDeliveryMessage } from "@/components/leads/CampaignDeliveryMessage";
import { cn } from "@/lib/utils";
import {
  useMonitoredPosts,
  useAddPost,
  useRemovePost,
  useTogglePostStatus,
  useSetCampaignStatus,
  useSyncPosts,
  type UnipileCampaign,
} from "@/hooks/useUnipileCampaigns";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import type { AutopilotConfig } from "@/types/email";

interface CampaignDetailProps {
  campaign: UnipileCampaign;
  onEdit: () => void;
}

type CampaignSettings = {
  smart_config?: ComponentProps<typeof LeadMagnetSmartSettings>["smartConfig"];
  autopilot_config?: AutopilotConfig | null;
  ai_mode?: ComponentProps<typeof LeadMagnetSmartSettings>["aiMode"];
  agent_profile_id?: string | null;
};

export function CampaignDetail({ campaign, onEdit }: CampaignDetailProps) {
  const [detailTab, setDetailTab] = useState("posts");
  const [showAddPostDialog, setShowAddPostDialog] = useState(false);
  const [postUrl, setPostUrl] = useState("");
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);

  const [postAccountFilter, setPostAccountFilter] = useState<string>("all");
  const [postSearch, setPostSearch] = useState("");
  const [postStatus, setPostStatus] = useState("all");
  const [postPage, setPostPage] = useState(1);

  const {
    data: posts,
    isLoading: postsLoading,
    isError: postsError,
    refetch: refetchPosts,
  } = useMonitoredPosts(campaign.id);
  const addPostMutation = useAddPost();
  const removePostMutation = useRemovePost();
  const togglePostMutation = useTogglePostStatus();
  const setStatusMutation = useSetCampaignStatus();
  const syncPostsMutation = useSyncPosts();
  const queryClient = useQueryClient();

  // Derive unique source accounts from monitored posts for filtering
  const postSourceAccounts = useMemo(() => {
    if (!posts) return [];
    const seen = new Map<
      string,
      {
        id: string;
        display_name: string | null;
        provider: string;
        avatar_url: string | null;
      }
    >();
    for (const post of posts) {
      const acct = post.source_account;
      if (acct && !seen.has(acct.id)) {
        seen.set(acct.id, {
          id: acct.id,
          display_name: acct.display_name,
          provider: acct.provider,
          avatar_url: acct.avatar_url,
        });
      }
    }
    return Array.from(seen.values());
  }, [posts]);

  const filteredPosts = useMemo(
    () =>
      (posts || []).filter((post) => {
        const query = postSearch.trim().toLowerCase();
        return (
          (postAccountFilter === "all" ||
            post.source_account?.id === postAccountFilter) &&
          (postStatus === "all" ||
            post.is_active === (postStatus === "active")) &&
          (!query ||
            [post.post_content, post.post_author_name, post.post_url].some(
              (value) => value?.toLowerCase().includes(query),
            ))
        );
      }),
    [posts, postAccountFilter, postSearch, postStatus],
  );
  const postPageCount = Math.max(1, Math.ceil(filteredPosts.length / 12));
  const currentPostPage = Math.min(postPage, postPageCount);
  const visiblePosts = filteredPosts.slice(
    (currentPostPage - 1) * 12,
    currentPostPage * 12,
  );
  const hasPostFilters =
    !!postSearch || postAccountFilter !== "all" || postStatus !== "all";
  const resetPostFilters = () => {
    setPostSearch("");
    setPostAccountFilter("all");
    setPostStatus("all");
    setPostPage(1);
  };

  // The owning page keys details by campaign/edit revision; refetches preserve drafts.
  const settings = campaign as UnipileCampaign & CampaignSettings;
  const [localSmartConfig, setLocalSmartConfig] = useState<
    ComponentProps<typeof LeadMagnetSmartSettings>["smartConfig"]
  >(settings.smart_config || {});
  const [localAutopilotConfig, setLocalAutopilotConfig] =
    useState<AutopilotConfig | null>(settings.autopilot_config || null);
  const [localAiMode, setLocalAiMode] = useState<
    ComponentProps<typeof LeadMagnetSmartSettings>["aiMode"]
  >(settings.ai_mode || "chatbot_only");
  const [localAgentProfileId, setLocalAgentProfileId] = useState<string | null>(
    settings.agent_profile_id || null,
  );

  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<CampaignSettings>({});
  const failedSaveRef = useRef<CampaignSettings>({});
  const outstandingSavesRef = useRef(0);
  const { mutateAsync: saveSettingsAsync } = useMutation({
    scope: { id: `lead-magnet-settings-${campaign.id}` },
    mutationFn: async (payload: CampaignSettings) => {
      const { error } = await supabase
        .from("unipile_campaigns")
        .update(payload as unknown as TablesUpdate<"unipile_campaigns">)
        .eq("id", campaign.id)
        .eq("organization_id", campaign.organization_id)
        .select("id")
        .single();
      if (error) throw error;
    },
    onSuccess: (_, payload) => {
      for (const field of Object.keys(payload))
        delete failedSaveRef.current[field as keyof CampaignSettings];
      queryClient.invalidateQueries({
        queryKey: ["unipile-campaigns", campaign.organization_id],
      });
    },
    onError: (_, payload) => {
      failedSaveRef.current = { ...failedSaveRef.current, ...payload };
      toast.error("Couldn’t save automation settings. Please try again.");
    },
    onSettled: () => {
      outstandingSavesRef.current -= 1;
      setSaveState(
        Object.keys(failedSaveRef.current).length
          ? "error"
          : outstandingSavesRef.current > 0 ||
              Object.keys(pendingSaveRef.current).length
            ? "saving"
            : "saved",
      );
    },
  });
  const saveSettings = useCallback(
    (payload: CampaignSettings) => {
      outstandingSavesRef.current += 1;
      setSaveState("saving");
      // Mutation callbacks report failures; catch the promise to avoid unhandled rejections.
      void saveSettingsAsync(payload).catch(() => {});
    },
    [saveSettingsAsync],
  );
  const debouncedSave = useCallback(
    (payload: CampaignSettings) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      pendingSaveRef.current = { ...pendingSaveRef.current, ...payload };
      setSaveState("saving");
      saveTimerRef.current = setTimeout(() => {
        const pending = pendingSaveRef.current;
        pendingSaveRef.current = {};
        saveTimerRef.current = null;
        saveSettings(pending);
      }, 800);
    },
    [saveSettings],
  );
  const immediateSave = saveSettings;
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (Object.keys(pendingSaveRef.current).length) {
        saveSettings(pendingSaveRef.current);
        pendingSaveRef.current = {};
      }
    },
    [saveSettings],
  );

  const Icon = campaign.account?.provider === "LINKEDIN" ? Linkedin : Instagram;
  const iconColor =
    campaign.account?.provider === "LINKEDIN"
      ? "text-[#0A66C2]"
      : "text-[#E1306C]";

  const handleAddPost = () => {
    if (!postUrl.trim()) return;

    addPostMutation.mutate(
      { postUrl: postUrl.trim(), campaignId: campaign.id },
      {
        onSuccess: () => {
          setPostUrl("");
          setShowAddPostDialog(false);
        },
      },
    );
  };

  return (
    <>
      <DeleteConfirmDialog
        open={!!deletingPostId}
        onOpenChange={(open) => !open && setDeletingPostId(null)}
        onConfirm={() => {
          if (deletingPostId) removePostMutation.mutate(deletingPostId);
          setDeletingPostId(null);
        }}
        itemName="post"
        itemType="monitored post"
        description="This will stop monitoring this post for comments."
      />

      <Dialog open={showAddPostDialog} onOpenChange={setShowAddPostDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Post to Monitor</DialogTitle>
            <DialogDescription>
              Paste the URL of a{" "}
              {campaign.account?.provider === "LINKEDIN"
                ? "LinkedIn"
                : "Instagram"}{" "}
              post to start monitoring for comments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <label
              htmlFor="lead-magnet-post-url"
              className="text-sm font-medium"
            >
              Post URL
            </label>
            <Input
              id="lead-magnet-post-url"
              type="url"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              placeholder={
                campaign.account?.provider === "LINKEDIN"
                  ? "https://www.linkedin.com/posts/..."
                  : "https://www.instagram.com/p/..."
              }
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddPostDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleAddPost}
              disabled={!postUrl.trim() || addPostMutation.isPending}
            >
              {addPostMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Post"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
        {/* Campaign Header */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2 text-xl">
                  <Icon className={cn("h-5 w-5", iconColor)} />
                  <span className="min-w-0 break-words">{campaign.name}</span>
                  <CampaignStatusBadge status={campaign.status} />
                </CardTitle>
                <CardDescription>
                  {campaign.sender_account_ids &&
                  campaign.sender_account_ids.length > 1
                    ? `${campaign.sender_account_ids.length} connected accounts`
                    : campaign.account?.display_name ||
                      campaign.account?.username ||
                      (campaign.sender_account_ids?.length === 1
                        ? "1 connected account"
                        : "No connected account")}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(campaign.status === "active" ||
                  campaign.status === "paused") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setStatusMutation.mutate({
                        id: campaign.id,
                        status: "draft",
                      })
                    }
                    disabled={setStatusMutation.isPending}
                  >
                    <FileEdit className="h-4 w-4 mr-2" />
                    Move to Draft
                  </Button>
                )}
                {campaign.status !== "active" && (
                  <Button
                    variant="cta"
                    size="sm"
                    onClick={() =>
                      setStatusMutation.mutate({
                        id: campaign.id,
                        status: "active",
                        autoAddPosts: campaign.auto_add_posts,
                      })
                    }
                    disabled={setStatusMutation.isPending}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Activate
                  </Button>
                )}
                {campaign.status === "active" && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setStatusMutation.mutate({
                        id: campaign.id,
                        status: "paused",
                      })
                    }
                    disabled={setStatusMutation.isPending}
                  >
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onEdit}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                icon={Users}
                label="Total Leads"
                value={campaign.stats?.total_leads || 0}
              />
              <StatCard
                icon={Send}
                label="DMs Sent"
                value={campaign.stats?.dm_sent || 0}
                className="text-green-600"
              />
              <StatCard
                icon={Clock}
                label="Pending"
                value={campaign.stats?.dm_pending || 0}
                className="text-status-warning"
              />
              <StatCard
                icon={LinkIcon}
                label="Active posts"
                value={campaign.stats?.monitored_posts || 0}
              />
            </div>

            <div className="mt-5 grid gap-5 border-t pt-5 lg:grid-cols-[1fr_2fr]">
              <div className="min-w-0">
                <div className="text-sm text-muted-foreground mb-2">
                  Trigger Keywords
                </div>
                <div className="flex flex-wrap gap-2">
                  {campaign.trigger_keywords.split(",").map((keyword, i) => (
                    <Badge key={i} variant="outline">
                      {keyword.trim()}
                    </Badge>
                  ))}
                </div>
              </div>

              <CampaignDeliveryMessage campaign={campaign} />
            </div>
          </CardContent>
        </Card>

        <Tabs value={detailTab} onValueChange={setDetailTab}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="posts" className="gap-2 py-2">
              <LinkIcon className="h-4 w-4" />
              Posts
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-2 py-2">
              <MessageSquare className="h-4 w-4" />
              Captured comments
            </TabsTrigger>
            <TabsTrigger value="automation" className="gap-2 py-2">
              <Settings2 className="h-4 w-4" />
              Automation
            </TabsTrigger>
          </TabsList>
          <TabsContent value="posts" className="mt-4">
            {/* Monitored Posts */}
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-lg">Monitored Posts</CardTitle>
                    {campaign.auto_add_posts && (
                      <Badge variant="outline" className="text-xs gap-1">
                        <Zap className="h-3 w-3" />
                        Autopilot
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {postSourceAccounts.length > 1 && (
                      <Select
                        value={postAccountFilter}
                        onValueChange={(value) => {
                          setPostAccountFilter(value);
                          setPostPage(1);
                        }}
                      >
                        <SelectTrigger className="h-8 w-[180px] text-xs">
                          <SelectValue placeholder="All accounts" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All accounts</SelectItem>
                          {postSourceAccounts.map((acct) => (
                            <SelectItem key={acct.id} value={acct.id}>
                              <div className="flex items-center gap-1.5">
                                {acct.provider === "LINKEDIN" ? (
                                  <Linkedin className="h-3 w-3 text-[#0A66C2]" />
                                ) : (
                                  <Instagram className="h-3 w-3 text-[#E1306C]" />
                                )}
                                <span>
                                  {acct.display_name || acct.provider}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {campaign.auto_add_posts && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => syncPostsMutation.mutate(campaign.id)}
                        disabled={syncPostsMutation.isPending}
                      >
                        <RefreshCw
                          className={cn(
                            "h-4 w-4 mr-2",
                            syncPostsMutation.isPending && "animate-spin",
                          )}
                        />
                        {syncPostsMutation.isPending
                          ? "Syncing..."
                          : "Sync Posts Now"}
                      </Button>
                    )}
                    <Button
                      variant="cta"
                      size="sm"
                      onClick={() => setShowAddPostDialog(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add Post
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!!posts?.length && (
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 basis-48">
                      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9"
                        aria-label="Search monitored posts"
                        placeholder="Search posts or authors…"
                        value={postSearch}
                        onChange={(event) => {
                          setPostSearch(event.target.value);
                          setPostPage(1);
                        }}
                      />
                    </div>
                    <Select
                      value={postStatus}
                      onValueChange={(value) => {
                        setPostStatus(value);
                        setPostPage(1);
                      }}
                    >
                      <SelectTrigger
                        aria-label="Filter monitored posts by status"
                        className="w-[140px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All posts</SelectItem>
                        <SelectItem value="active">Active posts</SelectItem>
                        <SelectItem value="paused">Paused posts</SelectItem>
                      </SelectContent>
                    </Select>
                    {hasPostFilters && (
                      <Button variant="ghost" onClick={resetPostFilters}>
                        Clear filters
                      </Button>
                    )}
                  </div>
                )}
                {postsError ? (
                  <div className="py-8 text-center">
                    <p className="text-sm text-destructive">
                      We couldn’t load monitored posts.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-3"
                      onClick={() => refetchPosts()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : postsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : !filteredPosts || filteredPosts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <LinkIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">
                      {hasPostFilters
                        ? "No matching posts"
                        : "No posts being monitored"}
                    </p>
                    <p className="text-sm mt-1">
                      {hasPostFilters
                        ? "Try another search or clear your filters."
                        : "Add a post URL to start capturing leads."}
                    </p>
                    {hasPostFilters ? (
                      <Button
                        variant="outline"
                        className="mt-4"
                        onClick={resetPostFilters}
                      >
                        Clear filters
                      </Button>
                    ) : (
                      <Button
                        variant="cta"
                        className="mt-4"
                        onClick={() => setShowAddPostDialog(true)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add your first post
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visiblePosts.map((post) => {
                      const PostIcon =
                        post.provider === "LINKEDIN" ? Linkedin : Instagram;
                      const postIconColor =
                        post.provider === "LINKEDIN"
                          ? "text-[#0A66C2]"
                          : "text-[#E1306C]";

                      // Highlight trigger keywords in post content
                      const keywords =
                        campaign.trigger_keywords
                          ?.split(",")
                          .map((k: string) => k.trim())
                          .filter((k: string) => k.length > 0) || [];

                      const highlightText = (text: string) => {
                        if (!keywords.length || !text) return text;
                        const regex = new RegExp(
                          `(${keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
                          "gi",
                        );
                        const parts = text.split(regex);
                        return parts.map((part, i) =>
                          keywords.some(
                            (k) => k.toLowerCase() === part.toLowerCase(),
                          ) ? (
                            <mark
                              key={i}
                              className="bg-amber-200/70 dark:bg-amber-500/30 text-foreground rounded px-0.5 font-medium"
                            >
                              {part}
                            </mark>
                          ) : (
                            part
                          ),
                        );
                      };

                      // Build display content
                      const content = post.post_content || "";
                      const postDate = post.post_created_at
                        ? formatDistanceToNow(new Date(post.post_created_at), {
                            addSuffix: true,
                          })
                        : null;

                      return (
                        <div
                          key={post.id}
                          className={cn(
                            "group flex items-start gap-3 p-3 rounded-lg border transition-colors",
                            post.is_active
                              ? "border-border hover:border-foreground/20"
                              : "border-border/50 opacity-60",
                          )}
                        >
                          {/* Platform icon */}
                          {post.post_thumbnail_url ? (
                            <img
                              src={post.post_thumbnail_url}
                              alt=""
                              className="w-10 h-10 rounded object-cover flex-shrink-0 mt-0.5"
                            />
                          ) : (
                            <div
                              className={cn(
                                "w-10 h-10 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5",
                                postIconColor,
                              )}
                            >
                              <PostIcon className="h-5 w-5" />
                            </div>
                          )}

                          {/* Content */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row">
                              <div className="min-w-0">
                                {post.post_author_name && (
                                  <p className="text-xs font-medium text-muted-foreground">
                                    {post.post_author_name}
                                  </p>
                                )}
                                {content ? (
                                  <p className="break-words text-sm leading-relaxed line-clamp-2">
                                    {highlightText(content)}
                                  </p>
                                ) : (
                                  <a
                                    href={post.post_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-muted-foreground hover:underline flex items-center gap-1"
                                  >
                                    <span className="truncate">
                                      {post.provider} Post
                                    </span>
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </a>
                                )}
                              </div>
                              {/* Actions */}
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9"
                                  aria-label="Open original post"
                                  asChild
                                >
                                  <a
                                    href={post.post_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9"
                                  aria-label={
                                    post.is_active
                                      ? "Pause post monitoring"
                                      : "Resume post monitoring"
                                  }
                                  disabled={togglePostMutation.isPending}
                                  onClick={() =>
                                    togglePostMutation.mutate({
                                      id: post.id,
                                      is_active: !post.is_active,
                                    })
                                  }
                                >
                                  {post.is_active ? (
                                    <Pause className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 text-destructive hover:text-destructive"
                                  aria-label="Remove monitored post"
                                  onClick={() => setDeletingPostId(post.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                            {/* Meta row */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {post.source_account && (
                                <span className="flex items-center gap-1">
                                  <Avatar className="h-3 w-3">
                                    <AvatarImage
                                      src={
                                        post.source_account.avatar_url ||
                                        undefined
                                      }
                                      referrerPolicy="no-referrer"
                                    />
                                    <AvatarFallback className="text-[6px]">
                                      {post.source_account.provider ===
                                      "LINKEDIN"
                                        ? "Li"
                                        : "Ig"}
                                    </AvatarFallback>
                                  </Avatar>
                                  {post.source_account.display_name ||
                                    post.source_account.provider}
                                </span>
                              )}
                              {postDate && <span>{postDate}</span>}
                              {post.comments_processed > 0 && (
                                <span>
                                  {post.comments_processed} comments scanned
                                </span>
                              )}
                              {post.last_polled_at && (
                                <span>
                                  Polled{" "}
                                  {formatDistanceToNow(
                                    new Date(post.last_polled_at),
                                    { addSuffix: true },
                                  )}
                                </span>
                              )}
                              <Badge
                                variant="secondary"
                                className={cn(
                                  "text-[10px] h-4 px-1.5",
                                  post.is_active
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    : "",
                                )}
                              >
                                {post.is_active ? "Active" : "Paused"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!postsLoading && !postsError && filteredPosts.length > 0 && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                    <p className="text-xs text-muted-foreground" role="status">
                      {(currentPostPage - 1) * 12 + 1}–
                      {Math.min(currentPostPage * 12, filteredPosts.length)} of{" "}
                      {filteredPosts.length} posts
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Previous posts page"
                        disabled={currentPostPage === 1}
                        onClick={() => setPostPage(currentPostPage - 1)}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Page {currentPostPage} of {postPageCount}
                      </span>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Next posts page"
                        disabled={currentPostPage === postPageCount}
                        onClick={() => setPostPage(currentPostPage + 1)}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="comments" className="mt-4">
            {/* Lead Comments */}
            <CampaignComments
              campaignId={campaign.id}
              accountId={campaign.account_id || ""}
            />
          </TabsContent>
          <TabsContent value="automation" className="mt-4">
            {/* Smart Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Automation settings
                </CardTitle>
                <CardDescription>
                  Control how AI handles conversations, enroll leads in email
                  sequences, and prioritize high-fit leads.
                </CardDescription>
                <p
                  role="status"
                  className={cn(
                    "text-xs",
                    saveState === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                  )}
                >
                  {saveState === "saving"
                    ? "Saving changes…"
                    : saveState === "error"
                      ? "Changes couldn’t save. Please retry."
                      : saveState === "saved"
                        ? "All changes saved"
                        : "Changes save automatically"}
                </p>
                {saveState === "error" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => saveSettings(failedSaveRef.current)}
                  >
                    Retry save
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <LeadMagnetSmartSettings
                  smartConfig={localSmartConfig}
                  onSmartConfigChange={(config) => {
                    setLocalSmartConfig(config);
                    debouncedSave({ smart_config: config });
                  }}
                  autopilotConfig={localAutopilotConfig}
                  onAutopilotChange={(config: AutopilotConfig) => {
                    setLocalAutopilotConfig(config);
                    // Only save inline config when no agent profile is attached
                    // (profile-based configs are managed via the agent profile itself)
                    if (!localAgentProfileId) {
                      debouncedSave({ autopilot_config: config });
                    }
                  }}
                  aiMode={localAiMode}
                  onAiModeChange={(mode) => {
                    setLocalAiMode(mode);
                    immediateSave({ ai_mode: mode });
                  }}
                  agentProfileId={localAgentProfileId}
                  onAgentProfileChange={(profileId, config) => {
                    setLocalAgentProfileId(profileId);
                    setLocalAutopilotConfig(config);
                    // When a profile is attached, only save the reference — backend loads from profile
                    // When clearing (profileId=null), save inline config as fallback
                    if (profileId) {
                      immediateSave({ agent_profile_id: profileId });
                    } else {
                      immediateSave({
                        agent_profile_id: null,
                        autopilot_config: config,
                      });
                    }
                  }}
                  campaignId={campaign.id}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/50">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className={cn("h-4 w-4", className)} />
        <span className="text-xs">{label}</span>
      </div>
      <div className={cn("text-2xl font-bold", className)}>{value}</div>
    </div>
  );
}
