import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowRight,
  ChevronDown,
  Flame,
  Info,
  Loader2,
  MessageCircle,
  Search,
  SlidersHorizontal,
  Trash2,
  ThumbsUp,
  TrendingUp,
  Wand2,
  X,
  Eye,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PlatformBadge } from "@/components/PlatformBadge";
import { ScrapedContentDetailsDialog } from "@/components/ScrapedContentDetailsDialog";
import { ReverseEngineerBlueprintDialog } from "@/components/ideas/ReverseEngineerBlueprintDialog";
import {
  useScrapedContentById,
  useDeleteTrendingPosts,
  useTrendingContent,
  type TrendingPost,
} from "@/hooks/useTrendingContent";
import { useSaveResearchAsIdeas } from "@/hooks/useSaveAsIdea";
import { SaveAsIdeaButton } from "@/components/research/SaveAsIdeaButton";
import type { FeedTarget } from "@/lib/idea-feeds";
import { formatNumber } from "@/lib/tableUtils";
import { cn } from "@/lib/utils";

const PLATFORMS = [
  { value: "all", label: "All platforms" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "X (Twitter)" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
];
const WINDOWS = [7, 14, 30, 90];
type SortKey = "worth" | "ratio" | "newest" | "rising";

const BASIS_LABEL: Record<TrendingPost["baseline_basis"], string> = {
  author: "vs their usual",
  audience: "vs accounts this size",
  search_term: "vs this search term",
  platform: "vs typical posts here",
};
const BASIS_EXPLAIN: Record<TrendingPost["baseline_basis"], string> = {
  author: "Compared with this author's median post over the last 6 months.",
  audience:
    "Compared with what accounts with this many followers usually get in your data.",
  search_term: "Compared with the median post found for the same search term.",
  platform: "Compared with the median post on this platform in your data.",
};

const label = (s: string | null) => (s ? s.replace(/_/g, " ") : "");

interface Theme {
  key: string;
  format: string;
  hookType: string;
  posts: TrendingPost[];
  authors: number;
  avgRatio: number;
}

/** Group analyzed outliers by format × hook type; a theme needs 2+ authors to count as a trend. */
function buildThemes(posts: TrendingPost[]): Theme[] {
  const groups = new Map<string, TrendingPost[]>();
  for (const p of posts) {
    if (!p.analyzed || !p.format) continue;
    const key = `${p.format}|${p.hook_type || "other"}`;
    groups.set(key, [...(groups.get(key) || []), p]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [format, hookType] = key.split("|");
      return {
        key,
        format,
        hookType,
        posts: group,
        authors: new Set(group.map((p) => p.author_handle || p.author_name))
          .size,
        avgRatio: group.reduce((sum, p) => sum + p.ratio, 0) / group.length,
      };
    })
    .filter((t) => t.authors >= 2)
    .sort((a, b) => b.posts.length * b.avgRatio - a.posts.length * a.avgRatio)
    .slice(0, 5);
}

function TrendingCard({
  post,
  selected,
  onToggle,
  onOpen,
  onReverse,
  onSave,
  onDelete,
  saving,
  selectionFull,
}: {
  post: TrendingPost;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onReverse: () => void;
  onSave: (target?: FeedTarget) => void;
  onDelete: () => void;
  saving: boolean;
  selectionFull: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const showThumb =
    !imageFailed &&
    post.thumbnail_url &&
    !(
      post.platform === "linkedin" &&
      post.thumbnail_url.includes("feedshare-shrink_20")
    );
  const title = post.title || "Untitled post";
  const author = post.author_name || post.author_handle || "Unknown creator";
  const metrics = [
    { label: "Views", value: post.engagement?.viewCount, icon: Eye },
    { label: "Likes", value: post.engagement?.likeCount, icon: ThumbsUp },
    {
      label: "Comments",
      value: post.engagement?.commentCount,
      icon: MessageCircle,
    },
  ].filter((metric) => metric.value !== undefined && metric.value !== null);

  return (
    <article
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card transition-shadow hover:shadow-md",
        selected && "border-amber-500 ring-2 ring-amber-500/20",
      )}
    >
      <div className="flex items-center gap-3 px-5 pt-5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          disabled={selectionFull && !selected}
          aria-label={`Select post by ${author}: ${title}`}
          className="shrink-0"
        />
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage
            src={post.author_avatar_url || undefined}
            referrerPolicy="no-referrer"
          />
          <AvatarFallback>{author[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={author}>
            {author}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDistanceToNowStrict(new Date(post.published_at))} ago
          </p>
        </div>
        <PlatformBadge
          platform={post.platform}
          showIcon={false}
          className="shrink-0 text-[11px]"
        />
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`Read post: ${title}`}
      >
        {showThumb && (
          <div className="mb-4 aspect-video w-full overflow-hidden rounded-lg bg-muted">
            <img
              src={post.thumbnail_url!}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          </div>
        )}
        <h3
          className={cn(
            "break-words font-semibold leading-relaxed text-foreground",
            showThumb ? "line-clamp-3 text-base" : "line-clamp-5 text-lg",
          )}
        >
          {title}
        </h3>
        <span className="mt-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
          Read post & analysis <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </button>

      <div className="mx-5 rounded-xl border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-left"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
                  <TrendingUp className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold tabular-nums">
                    {post.ratio >= 10
                      ? Math.round(post.ratio)
                      : post.ratio.toFixed(1)}
                    × performance
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {BASIS_LABEL[post.baseline_basis]}
                  </span>
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>
                {BASIS_EXPLAIN[post.baseline_basis]} Typical:{" "}
                {formatNumber(Math.round(post.baseline))}; this post:{" "}
                {formatNumber(Math.round(post.score))}{" "}
                {post.engagement?.viewCount ? "views" : "weighted interactions"}
                .
                {post.numbers_as_of &&
                  ` Updated ${formatDistanceToNowStrict(new Date(post.numbers_as_of))} ago.`}
              </p>
            </TooltipContent>
          </Tooltip>
          {post.fit_score !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    post.fit_score >= 7
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  Audience fit {post.fit_score}/10
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                {post.fit_reason ||
                  "Fit with your products and ideal customer profiles."}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {metrics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2.5">
            {metrics.map((metric) => (
              <span
                key={metric.label}
                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                title={metric.label}
              >
                <metric.icon className="h-3.5 w-3.5" />
                <span className="font-medium tabular-nums text-foreground">
                  {formatNumber(metric.value!)}
                </span>
                <span className="sr-only">{metric.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pt-3">
        {post.analyzed ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {post.format && (
                <Badge variant="secondary" className="font-normal capitalize">
                  {label(post.format)}
                </Badge>
              )}
              {post.hook_type && (
                <Badge variant="outline" className="font-normal capitalize">
                  {label(post.hook_type)} hook
                </Badge>
              )}
            </div>
            {post.formula && (
              <details className="mt-3 rounded-lg bg-muted/30 text-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-xs font-medium [&::-webkit-details-marker]:hidden">
                  The reusable pattern{" "}
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </summary>
                <p className="break-words px-3 pb-3 text-sm leading-relaxed text-muted-foreground">
                  {post.formula}
                </p>
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Open the post to analyze its format.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t px-5 py-4">
        <SaveAsIdeaButton
          onSave={onSave}
          saving={saving}
          saved={!!post.idea_id}
        />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-muted-foreground"
          onClick={onReverse}
          title="Create a blueprint using this post’s format"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Copy format
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete post by ${author}`}
          title="Delete this post from your research"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}

export function TrendingContent() {
  const [search, setSearch] = useState("");
  const [savedFilter, setSavedFilter] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [limit, setLimit] = useState(18);
  const [platform, setPlatform] = useState("all");
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState<SortKey>("worth");
  const [themeKey, setThemeKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reverseIds, setReverseIds] = useState<string[] | null>(null);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const saveAsIdeas = useSaveResearchAsIdeas();
  const deletePosts = useDeleteTrendingPosts();
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const save = (ids: string[], target?: FeedTarget) => {
    setSavingIds(ids);
    saveAsIdeas.mutate(
      { contentIds: ids, source: "trending", target },
      {
        onSettled: () => setSavingIds([]),
        onSuccess: () =>
          setSelected((prev) => prev.filter((id) => !ids.includes(id))),
      },
    );
  };

  const {
    data: posts = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useTrendingContent(platform === "all" ? null : platform, days);
  const {
    data: openContent,
    isLoading: openingPost,
    error: openError,
    refetch: retryOpen,
  } = useScrapedContentById(openId);

  const themes = useMemo(() => buildThemes(posts), [posts]);
  const activeTheme = themes.find((t) => t.key === themeKey) || null;

  const visible = useMemo(() => {
    const list = activeTheme ? activeTheme.posts : posts;
    const query = search.trim().toLowerCase();
    const sorted = list.filter(
      (post) =>
        (!query ||
          [
            post.title,
            post.author_name,
            post.author_handle,
            post.format,
            post.hook_type,
          ].some((value) => value?.toLowerCase().includes(query))) &&
        (savedFilter === "all" ||
          (savedFilter === "saved" ? !!post.idea_id : !post.idea_id)),
    );
    if (sort === "ratio") sorted.sort((a, b) => b.ratio - a.ratio);
    if (sort === "newest")
      sorted.sort(
        (a, b) => +new Date(b.published_at) - +new Date(a.published_at),
      );
    if (sort === "rising")
      sorted.sort(
        (a, b) =>
          (b.growth_7d ?? -1) - (a.growth_7d ?? -1) ||
          b.velocity_per_day - a.velocity_per_day,
      );
    if (sort === "worth") sorted.sort((a, b) => b.worth - a.worth);
    return sorted;
  }, [posts, activeTheme, sort, search, savedFilter]);

  useEffect(() => {
    setLimit(18);
    setSelected([]);
  }, [platform, days, themeKey, search, savedFilter]);

  const resetFilters = () => {
    setPlatform("all");
    setDays(30);
    setSearch("");
    setSavedFilter("all");
    setThemeKey(null);
  };
  const hasFilters =
    platform !== "all" ||
    days !== 30 ||
    !!search.trim() ||
    savedFilter !== "all" ||
    !!activeTheme;
  const gridClass =
    "grid grid-cols-1 items-start gap-5 min-[960px]:grid-cols-2 min-[1440px]:grid-cols-3 min-[1920px]:grid-cols-4";

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= 5
          ? prev
          : [...prev, id],
    );

  return (
    <div className="space-y-4 pb-6">
      <h2 className="sr-only">Trending posts</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="research-search"
            aria-label="Search this feed"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search posts or creators…"
            className="pl-9"
          />
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <Select
            value={platform}
            onValueChange={(value) => {
              setPlatform(value);
              setThemeKey(null);
            }}
          >
            <SelectTrigger aria-label="Platform" className="w-[148px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(days)}
            onValueChange={(value) => {
              setDays(Number(value));
              setThemeKey(null);
            }}
          >
            <SelectTrigger aria-label="Published" className="w-[132px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((window) => (
                <SelectItem key={window} value={String(window)}>
                  Last {window} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as SortKey)}
          >
            <SelectTrigger aria-label="Sort by" className="w-[156px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="worth">Best match</SelectItem>
              <SelectItem value="ratio">Biggest outlier</SelectItem>
              <SelectItem value="rising">Rising this week</SelectItem>
              <SelectItem value="newest">Newest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              aria-label="Feed filters"
              className={cn(
                "gap-2",
                (savedFilter !== "all" || platform !== "all" || days !== 30) &&
                  "border-amber-500",
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="xl:sr-only">Filters</span>
              {savedFilter !== "all" && <span className="text-xs">1</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(300px,calc(100vw-2rem))] space-y-4"
          >
            <h3 className="text-sm font-semibold">Filter posts</h3>
            <div className="space-y-4 xl:hidden">
              <div className="space-y-1.5">
                <label
                  htmlFor="research-platform"
                  className="text-xs font-medium"
                >
                  Platform
                </label>
                <Select
                  value={platform}
                  onValueChange={(value) => {
                    setPlatform(value);
                    setThemeKey(null);
                  }}
                >
                  <SelectTrigger id="research-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="research-window"
                  className="text-xs font-medium"
                >
                  Published
                </label>
                <Select
                  value={String(days)}
                  onValueChange={(value) => {
                    setDays(Number(value));
                    setThemeKey(null);
                  }}
                >
                  <SelectTrigger id="research-window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOWS.map((window) => (
                      <SelectItem key={window} value={String(window)}>
                        Last {window} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="research-sort" className="text-xs font-medium">
                  Sort by
                </label>
                <Select
                  value={sort}
                  onValueChange={(value) => setSort(value as SortKey)}
                >
                  <SelectTrigger id="research-sort">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="worth">Best match</SelectItem>
                    <SelectItem value="ratio">Biggest outlier</SelectItem>
                    <SelectItem value="rising">Rising this week</SelectItem>
                    <SelectItem value="newest">Newest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="research-saved" className="text-xs font-medium">
                Idea status
              </label>
              <Select value={savedFilter} onValueChange={setSavedFilter}>
                <SelectTrigger id="research-saved">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All posts</SelectItem>
                  <SelectItem value="unsaved">Not saved yet</SelectItem>
                  <SelectItem value="saved">Saved as ideas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-between gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltersOpen(false)}
              >
                Done
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span aria-live="polite" className="text-muted-foreground">
            {isLoading
              ? "Loading posts…"
              : `${visible.length} ${visible.length === 1 ? "post" : "posts"}`}
          </span>
          {isFetching && !isLoading && (
            <Loader2
              aria-label="Updating posts"
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
            />
          )}
          {activeTheme && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setThemeKey(null)}
              className="h-auto gap-1.5 whitespace-normal py-1 text-xs capitalize"
            >
              {label(activeTheme.format)} · {label(activeTheme.hookType)}
              <X className="h-3 w-3 shrink-0" />
              <span className="sr-only">Clear pattern filter</span>
            </Button>
          )}
          {savedFilter !== "all" && (
            <span className="rounded bg-muted px-2 py-1 text-xs">
              {savedFilter === "saved" ? "Saved ideas" : "Not saved yet"}
            </span>
          )}
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 px-2 text-xs text-muted-foreground"
            >
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {themes.length > 0 && (
            <Popover open={patternsOpen} onOpenChange={setPatternsOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
                >
                  <Wand2 className="h-3.5 w-3.5" />
                  Patterns
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
                    {themes.length}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(380px,calc(100vw-2rem))] space-y-3"
              >
                <div>
                  <h3 className="text-sm font-semibold">
                    Patterns across creators
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Explore formats working for more than one creator.
                  </p>
                </div>
                <div className="space-y-2">
                  {themes.map((theme) => (
                    <button
                      key={theme.key}
                      type="button"
                      aria-pressed={themeKey === theme.key}
                      onClick={() => {
                        setThemeKey(themeKey === theme.key ? null : theme.key);
                        setPatternsOpen(false);
                      }}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                        themeKey === theme.key &&
                          "border-amber-500 bg-amber-50 dark:bg-amber-950/20",
                      )}
                    >
                      <span className="block text-sm font-medium capitalize">
                        {label(theme.format)} · {label(theme.hookType)} hook
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {theme.posts.length} posts · {theme.authors} creators ·{" "}
                        {theme.avgRatio.toFixed(1)}× average
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground"
                aria-label="How posts are picked"
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(320px,calc(100vw-2rem))]"
            >
              <h3 className="text-sm font-semibold">How posts are picked</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Posts perform at least 2× above their baseline or rank in the
                top 3% of their platform. We compare the creator’s usual
                performance, similar-sized accounts, or other posts in your
                data. Best match also weighs audience fit. The top 10 new
                outliers are analyzed daily.
              </p>
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Select up to 5 posts to save ideas or combine formats.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="sticky top-3 z-30 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur-sm">
          <span className="mr-auto text-sm font-medium">
            {selected.length} of 5 selected
          </span>
          <SaveAsIdeaButton
            label={`Save ${selected.length} as ${selected.length === 1 ? "idea" : "ideas"}`}
            onSave={(target) => save(selected, target)}
            saving={saveAsIdeas.isPending}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setReverseIds(selected)}
          >
            <Wand2 className="h-3.5 w-3.5" />
            {selected.length > 1 ? "Combine formats" : "Copy format"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-destructive hover:text-destructive"
            onClick={() => setDeleteIds(selected)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      )}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-card p-8 text-center"
        >
          <h3 className="font-semibold">Couldn’t load trending posts</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Try loading your research feed again.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <div className={gridClass}>
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[440px] rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <Flame className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h3 className="text-lg font-semibold">
            {search.trim() || savedFilter !== "all" || activeTheme
              ? "No posts match your filters"
              : "No standout posts in this window"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Try a different search, platform or time window. This feed
            highlights the best performers among your collected posts.
          </p>
          {hasFilters && (
            <Button variant="outline" className="mt-5" onClick={resetFilters}>
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className={gridClass}>
            {visible.slice(0, limit).map((post) => (
              <TrendingCard
                key={post.id}
                post={post}
                selected={selected.includes(post.id)}
                selectionFull={selected.length >= 5}
                onToggle={() => toggle(post.id)}
                onOpen={() => setOpenId(post.id)}
                onReverse={() => setReverseIds([post.id])}
                onSave={(target) => save([post.id], target)}
                onDelete={() => setDeleteIds([post.id])}
                saving={savingIds.includes(post.id)}
              />
            ))}
          </div>
          {visible.length > limit && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setLimit(limit + 18)}>
                Show more posts <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              <p className="text-xs text-muted-foreground">
                Showing {Math.min(limit, visible.length)} of {visible.length}{" "}
                standout posts
              </p>
            </div>
          )}
        </>
      )}

      {!!openId && (openingPost || openError) && (
        <div
          role={openError ? "alert" : "status"}
          className="sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-xl border bg-background p-4 shadow-lg"
        >
          {openingPost && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="mr-auto text-sm">
            {openError ? "Couldn’t open this post." : "Opening post…"}
          </span>
          {openError && (
            <Button variant="outline" size="sm" onClick={() => retryOpen()}>
              Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>
            Cancel
          </Button>
        </div>
      )}

      <ScrapedContentDetailsDialog
        content={openContent ?? null}
        open={!!openId && !!openContent}
        onOpenChange={(open) => !open && setOpenId(null)}
      />
      <AlertDialog
        open={!!deleteIds}
        onOpenChange={(open) => !open && setDeleteIds(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteIds?.length === 1 ? "this post" : `${deleteIds?.length} posts`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are removed from Trending and the Posts tab. Ideas already
              saved from them stay. A later scrape can bring a post back if its
              creator or search still matches.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ids = deleteIds ?? [];
                deletePosts.mutate(ids, {
                  onSuccess: () =>
                    setSelected((prev) => prev.filter((id) => !ids.includes(id))),
                });
                setDeleteIds(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ReverseEngineerBlueprintDialog
        contentIds={reverseIds || []}
        open={!!reverseIds}
        onOpenChange={(open) => {
          if (!open) {
            setReverseIds(null);
            setSelected([]);
          }
        }}
      />
    </div>
  );
}
