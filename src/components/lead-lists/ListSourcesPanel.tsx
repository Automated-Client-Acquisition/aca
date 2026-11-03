import { useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  AlertCircle,
  Link2,
  Loader2,
  MessageSquare,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Radio,
  ThumbsUp,
  Trash2,
  UserRound,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useUnipileAccounts } from "@/hooks/useUnipileAccounts";
import {
  parsePostUrl,
  parseProfileUrl,
  useAddLeadListSources,
  useDeleteLeadListSource,
  useLeadListSources,
  useUpdateLeadListSource,
  type LeadListSource,
} from "@/hooks/useLeadListSources";

const REACTION_TYPES = [
  { id: "LIKE", label: "Like", emoji: "👍" },
  { id: "CELEBRATE", label: "Celebrate", emoji: "👏" },
  { id: "SUPPORT", label: "Support", emoji: "💚" },
  { id: "LOVE", label: "Love", emoji: "❤️" },
  { id: "INSIGHTFUL", label: "Insightful", emoji: "💡" },
  { id: "FUNNY", label: "Funny", emoji: "😄" },
];

const WATCH_WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

const STATUS_BADGES: Record<LeadListSource["status"], { label: string; className: string }> = {
  active: { label: "Active", className: "border-green-300 text-green-700 bg-green-50" },
  paused: { label: "Paused", className: "border-amber-300 text-amber-700 bg-amber-50" },
  error: { label: "Error", className: "border-red-300 text-red-700 bg-red-50" },
  expired: { label: "Expired", className: "border-muted text-muted-foreground bg-muted/40" },
};

function sourceLabel(source: LeadListSource): string {
  if (source.source_type === "linkedin_creator") {
    const slug = parseProfileUrl(source.source_url);
    return slug ? `in/${slug}` : source.source_url;
  }
  try {
    const url = new URL(source.source_url);
    return url.pathname.replace(/^\/+/, "").substring(0, 60) || source.source_url;
  } catch {
    return source.source_url.substring(0, 60);
  }
}

interface Props {
  listId: string;
}

export function ListSourcesPanel({ listId }: Props) {
  const { data: sources = [], isLoading } = useLeadListSources(listId);
  const addSources = useAddLeadListSources();
  const updateSource = useUpdateLeadListSource();
  const deleteSource = useDeleteLeadListSource();
  const { data: accountsData } = useUnipileAccounts();
  const linkedinAccounts = accountsData?.linkedinAccounts || [];

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [tab, setTab] = useState<"posts" | "creators">("posts");
  const [urlsInput, setUrlsInput] = useState("");
  const [accountId, setAccountId] = useState("");
  const [includeReactors, setIncludeReactors] = useState(true);
  const [includeCommenters, setIncludeCommenters] = useState(true);
  const [selectedReactions, setSelectedReactions] = useState<string[]>([]);
  const [watchDays, setWatchDays] = useState("60");
  const [expandedCreators, setExpandedCreators] = useState<Set<string>>(new Set());

  // Creator-spawned post watches are shown under their parent, not top-level
  const parents = useMemo(() => sources.filter((s) => !s.parent_source_id), [sources]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, LeadListSource[]>();
    for (const s of sources) {
      if (!s.parent_source_id) continue;
      map.set(s.parent_source_id, [...(map.get(s.parent_source_id) || []), s]);
    }
    return map;
  }, [sources]);

  const activeCount = parents.filter((s) => s.status === "active").length;

  const parsedUrls = useMemo(() => {
    const lines = urlsInput.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines.map((line) => ({
      url: line,
      valid: tab === "posts" ? !!parsePostUrl(line) : !!parseProfileUrl(line),
    }));
  }, [urlsInput, tab]);

  const validUrls = parsedUrls.filter((u) => u.valid);
  const invalidUrls = parsedUrls.filter((u) => !u.valid);

  const resetDialog = () => {
    setUrlsInput("");
    setSelectedReactions([]);
  };

  const handleAdd = () => {
    if (validUrls.length === 0) return;
    addSources.mutate(
      {
        listId,
        sources: validUrls.map((u) => ({
          sourceType: tab === "posts" ? "linkedin_post" : "linkedin_creator",
          url: u.url,
        })),
        accountId: accountId || null,
        includeReactors,
        includeCommenters,
        reactionTypes: selectedReactions,
        watchDays: parseInt(watchDays, 10),
      },
      {
        onSuccess: (rows) => {
          toast.success(
            rows.length > 0
              ? `Added ${rows.length} source${rows.length === 1 ? "" : "s"} — new engagement will sync automatically`
              : "Those sources are already attached to this list"
          );
          resetDialog();
          setShowAddDialog(false);
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to add sources"),
      }
    );
  };

  const toggleReaction = (id: string) => {
    setSelectedReactions((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  };

  const toggleExpanded = (id: string) => {
    setExpandedCreators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                Sources
                {parents.length > 0 && (
                  <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50 gap-1">
                    Auto-sync on · {activeCount} active
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Watch LinkedIn posts and creators — new commenters and reactors are added to this list automatically
              </CardDescription>
            </div>
            <Button variant="cta" size="sm" onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Add source
            </Button>
          </div>
        </CardHeader>
        {parents.length > 0 && (
          <CardContent className="space-y-2">
            {parents.map((source) => {
              const children = childrenByParent.get(source.id) || [];
              const badge = STATUS_BADGES[source.status];
              const isCreator = source.source_type === "linkedin_creator";
              const childImported = children.reduce((sum, c) => sum + c.total_imported, 0);
              const totalImported = source.total_imported + childImported;
              const expanded = expandedCreators.has(source.id);

              return (
                <div key={source.id} className="rounded-lg border">
                  <div className="flex items-center gap-3 px-3 py-2">
                    {isCreator ? (
                      <UserRound className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <Link2 className="h-4 w-4 text-blue-600 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={source.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium truncate block hover:underline"
                        title={source.source_url}
                      >
                        {sourceLabel(source)}
                      </a>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{isCreator ? "Creator" : "Post"}</span>
                        {source.last_polled_at && (
                          <span>· checked {formatDistanceToNow(new Date(source.last_polled_at), { addSuffix: true })}</span>
                        )}
                        {isCreator && children.length > 0 && (
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline"
                            onClick={() => toggleExpanded(source.id)}
                          >
                            · watching {children.length} post{children.length === 1 ? "" : "s"}
                          </button>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="whitespace-nowrap shrink-0">
                      {totalImported} added
                    </Badge>
                    {source.status === "error" && source.error_message ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className={`${badge.className} gap-1 cursor-default shrink-0`}>
                            <AlertCircle className="h-3 w-3" />
                            {badge.label}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{source.error_message}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Badge variant="outline" className={`${badge.className} shrink-0`}>
                        {badge.label}
                      </Badge>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {source.status === "active" ? (
                          <DropdownMenuItem
                            onClick={() => updateSource.mutate({ id: source.id, updates: { status: "paused" } })}
                          >
                            <Pause className="h-4 w-4 mr-2" />
                            Pause syncing
                          </DropdownMenuItem>
                        ) : source.status !== "expired" ? (
                          <DropdownMenuItem
                            onClick={() => updateSource.mutate({ id: source.id, updates: { status: "active" } })}
                          >
                            <Play className="h-4 w-4 mr-2" />
                            Resume syncing
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            deleteSource.mutate(source.id, {
                              onSuccess: () => toast.success("Source removed"),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove source
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {isCreator && expanded && children.length > 0 && (
                    <div className="border-t bg-muted/30 px-3 py-2 space-y-1">
                      {children.map((child) => (
                        <div key={child.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Link2 className="h-3 w-3 shrink-0" />
                          <a
                            href={child.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline flex-1"
                            title={child.source_url}
                          >
                            {sourceLabel(child)}
                          </a>
                          <span className="shrink-0">{child.total_imported} added</span>
                          <Badge variant="outline" className={`${STATUS_BADGES[child.status].className} shrink-0`}>
                            {STATUS_BADGES[child.status].label}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        )}
      </Card>

      <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetDialog(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add sources</DialogTitle>
            <DialogDescription>
              We check sources on a rolling schedule and add new engagers to this list automatically.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={(v) => setTab(v as "posts" | "creators")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="posts">
                <Link2 className="h-4 w-4 mr-1" />
                Posts
              </TabsTrigger>
              <TabsTrigger value="creators">
                <UserRound className="h-4 w-4 mr-1" />
                Creators
              </TabsTrigger>
            </TabsList>
            <TabsContent value="posts" className="space-y-2 pt-2">
              <Label htmlFor="source-urls">LinkedIn post URLs (one per line)</Label>
              <Textarea
                id="source-urls"
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder={"https://www.linkedin.com/posts/username_activity-...\nhttps://www.linkedin.com/feed/update/urn:li:activity:..."}
                rows={4}
              />
            </TabsContent>
            <TabsContent value="creators" className="space-y-2 pt-2">
              <Label htmlFor="source-urls-creators">LinkedIn profile URLs (one per line)</Label>
              <Textarea
                id="source-urls-creators"
                value={urlsInput}
                onChange={(e) => setUrlsInput(e.target.value)}
                placeholder={"https://www.linkedin.com/in/username\nhttps://www.linkedin.com/in/another-creator"}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                We watch each creator's new posts and pull in their commenters and reactors as they engage.
              </p>
            </TabsContent>
          </Tabs>

          {invalidUrls.length > 0 && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {invalidUrls.length} line{invalidUrls.length === 1 ? " doesn't" : "s don't"} look like{" "}
              {tab === "posts" ? "a LinkedIn post URL" : "a LinkedIn profile URL"}
            </p>
          )}

          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeReactors} onCheckedChange={(c) => setIncludeReactors(!!c)} />
              <ThumbsUp className="h-4 w-4 text-blue-600" />
              Reactors
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeCommenters} onCheckedChange={(c) => setIncludeCommenters(!!c)} />
              <MessageSquare className="h-4 w-4 text-green-600" />
              Commenters
            </label>
          </div>

          {includeReactors && (
            <div className="flex flex-wrap gap-1.5">
              {REACTION_TYPES.map((reaction) => (
                <Button
                  key={reaction.id}
                  type="button"
                  variant={selectedReactions.includes(reaction.id) ? "default" : "outline"}
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => toggleReaction(reaction.id)}
                >
                  <span>{reaction.emoji}</span>
                  {reaction.label}
                </Button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>LinkedIn account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Auto (any active)" />
                </SelectTrigger>
                <SelectContent>
                  {linkedinAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={account.avatar_url || undefined} referrerPolicy="no-referrer" />
                          <AvatarFallback className="text-[9px] bg-primary/10">
                            {(account.display_name || account.username)?.charAt(0) || "?"}
                          </AvatarFallback>
                        </Avatar>
                        {account.display_name || account.username || "LinkedIn Account"}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Watch window</Label>
              <Select value={watchDays} onValueChange={setWatchDays}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WATCH_WINDOWS.map((w) => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!includeReactors && !includeCommenters && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Select at least Reactors or Commenters
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="cta"
              onClick={handleAdd}
              disabled={
                validUrls.length === 0 ||
                (!includeReactors && !includeCommenters) ||
                addSources.isPending
              }
            >
              {addSources.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add {validUrls.length > 0 ? `${validUrls.length} ` : ""}source{validUrls.length === 1 ? "" : "s"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
