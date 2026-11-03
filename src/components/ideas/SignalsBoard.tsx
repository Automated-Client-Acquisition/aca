import { useMemo, useState } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Activity, BadgeCheck, ChevronDown, ChevronRight, ExternalLink, EyeOff, Loader2, RefreshCw, Rocket, Settings2, TrendingUp, Users, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAccountActivity, useCreateIdeaFromStory, useDismissStory, usePulseSettings, usePulseStories, useRunPulse, useSavePulseSettings,
  useStoryPosts, type PulseSettings, type PulseStory,
} from "@/hooks/usePulse";
import { SaveAsIdeaButton } from "@/components/research/SaveAsIdeaButton";
import { cn } from "@/lib/utils";

const HOUR = 3_600_000;

/** Wide pickup and good fit first, fading over half a day so the board stays current. */
function rank(s: PulseStory) {
  const hours = (Date.now() - new Date(s.detected_at).getTime()) / HOUR;
  const reach = s.accounts.length + (s.official_accounts.length ? 3 : 0);
  return (reach * (0.5 + Number(s.fit_score ?? 5) / 10)) / (1 + hours / 12);
}

const handles = (list: string[], max = 3) =>
  list.slice(0, max).map((h) => `@${h}`).join(", ") + (list.length > max ? ` +${list.length - max}` : "");

function StoryCard({ story, compact = false }: { story: PulseStory; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data: posts = [], isLoading } = useStoryPosts(open ? story : null);
  const createIdea = useCreateIdeaFromStory();
  const dismiss = useDismissStory();
  const launch = story.official_accounts.length > 0;
  const insiders = story.accounts.filter((a) => !story.official_accounts.includes(a));
  const first = story.first_post_at ? new Date(story.first_post_at) : new Date(story.detected_at);

  return (
    <article className={cn("rounded-xl border bg-card p-5 transition-shadow hover:shadow-sm", story.actionable === false && "opacity-60")}>
      {(story.actionable === false || story.fit_score !== null) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {story.actionable === false && <Badge variant="outline" className="text-xs">Low relevance</Badge>}
          {story.fit_score !== null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className={cn("text-xs", Number(story.fit_score) >= 7 && "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300")}>
                  Fit {Number(story.fit_score)}/10
                </Badge>
              </TooltipTrigger>
              {story.fit_reason && <TooltipContent className="max-w-xs"><p className="text-xs">{story.fit_reason}</p></TooltipContent>}
            </Tooltip>
          )}
        </div>
      )}
      <h4 className="mt-3 text-base font-semibold leading-relaxed tracking-tight">
        {story.headline || story.key_term}
        {!story.judged_at && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(summary on next scan)</span>}
      </h4>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {launch && (
          <span className="inline-flex items-center gap-1 text-foreground">
            <BadgeCheck className="h-3.5 w-3.5 text-sky-600" /> {handles(story.official_accounts, 2)}
          </span>
        )}
        {insiders.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1">
                <Users className="h-3.5 w-3.5" /> {insiders.length} {insiders.length === 1 ? "account" : "accounts"} talking
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm"><p className="text-xs">{handles(insiders, 20)}</p></TooltipContent>
          </Tooltip>
        )}
        <span title={format(first, "d MMM HH:mm")}>first post {formatDistanceToNowStrict(first)} ago</span>
      </p>

      {!compact && story.summary && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{story.summary}</p>}
      {!compact && story.angle && (
        <div className="mt-4 rounded-lg border border-amber-200/60 bg-amber-50/60 p-3 dark:border-amber-800/40 dark:bg-amber-950/20">
          <p className="mb-1 text-xs font-semibold text-amber-800 dark:text-amber-300">Your content angle</p>
          <p className="text-sm leading-relaxed">{story.angle}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
        <SaveAsIdeaButton
          saved={!!story.idea_id}
          saving={createIdea.isPending}
          onSave={(target) => createIdea.mutate({ story, target })}
        />
        <Button variant="ghost" size="sm" className="gap-1 px-2 text-xs text-muted-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} {story.item_ids.length} source posts
        </Button>
        <Button variant="ghost" size="sm" className="ml-auto gap-1 px-2 text-xs text-muted-foreground" disabled={dismiss.isPending} onClick={() => dismiss.mutate(story.id)}>
          <EyeOff className="h-3.5 w-3.5" /> Dismiss
        </Button>
      </div>

      {open && (
        <div className="mt-4 space-y-2 border-t pt-4">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : posts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No source posts are available for this story.</p>
          ) : (
            posts.map((p) => (
              <a key={p.id} href={p.url || "#"} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-muted/30 p-3 text-sm leading-relaxed hover:bg-muted/60">
                <span className="font-medium">@{p.author}</span>
                {p.published_at && <span className="text-muted-foreground"> · {format(new Date(p.published_at), "d MMM HH:mm")}</span>}
                <ExternalLink className="ml-1 inline h-3 w-3 text-muted-foreground" />
                <span className="line-clamp-3 block whitespace-pre-line">{p.body}</span>
              </a>
            ))
          )}
        </div>
      )}
    </article>
  );
}

const toLines = (list: string[]) => list.join("\n");
const fromLines = (text: string) => [...new Set(text.split(/[\s,]+/).map((h) => h.trim().replace(/^@/, "")).filter(Boolean))];

function SettingsDialog({ open, onOpenChange, settings }: { open: boolean; onOpenChange: (o: boolean) => void; settings: PulseSettings }) {
  const save = useSavePulseSettings();
  const { data: activity = [] } = useAccountActivity(open && settings.enabled);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [official, setOfficial] = useState(toLines(settings.official_accounts));
  const [insiders, setInsiders] = useState(toLines(settings.insider_accounts));
  const [minAccounts, setMinAccounts] = useState(String(settings.min_accounts || 4));
  const [digest, setDigest] = useState(settings.digest_enabled);

  const reset = () => {
    setEnabled(settings.enabled);
    setOfficial(toLines(settings.official_accounts));
    setInsiders(toLines(settings.insider_accounts));
    setMinAccounts(String(settings.min_accounts || 4));
    setDigest(settings.digest_enabled);
  };
  const active = new Set(activity.filter((a) => a.posts > 0).map((a) => a.author));
  // only meaningful once there is a week of scans to look at
  const silent = activity.length ? [...settings.official_accounts, ...settings.insider_accounts].filter((h) => !active.has(h.toLowerCase())) : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Signals settings</DialogTitle>
          <DialogDescription>
            Every 30 minutes Signals reads new posts and reposts (not replies) from the X accounts below (through your Apify key, about $5-15 a
            month) and turns them into stories. One handle per line; the lists start empty to use the defaults.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="flex items-center justify-between">
            <Label>Signals on</Label>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Official accounts ({fromLines(official).length})</Label>
              <Textarea rows={10} value={official} onChange={(e) => setOfficial(e.target.value)} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">Labs, products and tools. A launch post from any of them shows up right away.</p>
            </div>
            <div className="space-y-2">
              <Label>People and news ({fromLines(insiders).length})</Label>
              <Textarea rows={10} value={insiders} onChange={(e) => setInsiders(e.target.value)} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">A story is a new name several of them post about within 3 hours.</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Accounts needed for a story</Label>
              <p className="text-xs text-muted-foreground">Lower catches smaller stories, with more noise. 4 caught every launch in testing.</p>
            </div>
            <Select value={minAccounts} onValueChange={setMinAccounts}>
              <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{["3", "4", "5", "6"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Morning email digest</Label>
              <p className="text-xs text-muted-foreground">The last 24 hours of stories, at 06:30 UTC.</p>
            </div>
            <Switch checked={digest} onCheckedChange={setDigest} />
          </div>
          {silent.length > 0 && (
            <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              No posts or reposts in the last 7 days from {silent.length} accounts: {silent.map((h) => `@${h}`).join(", ")}. Replies aren't
              read, so an account that only replies shows here. If one of them is posting on X, open its profile: a renamed handle looks the
              same as a quiet one.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="cta"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { enabled, official_accounts: fromLines(official), insider_accounts: fromLines(insiders), min_accounts: Number(minAccounts), digest_enabled: digest },
                { onSuccess: () => onOpenChange(false) }
              )
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Column({ title, hint, icon, stories, tone }: { title: string; hint: string; icon: React.ReactNode; stories: PulseStory[]; tone: string }) {
  return (
    <section className={cn("space-y-4 rounded-2xl border p-4", tone)}>
      <div className="px-1 py-1">
        <h3 className="flex items-center gap-2 font-semibold">
          {icon} {title} <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">{stories.length}</span>
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      {stories.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-background/60 px-5 py-10 text-center">
          <p className="text-sm font-medium">No {title.toLowerCase()} yet</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">New stories from the last 48 hours will appear here after a scan.</p>
        </div>
      ) : (
        stories.map((s) => <StoryCard key={s.id} story={s} />)
      )}
    </section>
  );
}

export function SignalsBoard() {
  const { data: settings, isLoading: settingsLoading } = usePulseSettings();
  const enabled = !!settings?.enabled;
  const { data: stories = [], isLoading } = usePulseStories(enabled);
  const runPulse = useRunPulse();
  const save = useSavePulseSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFiltered, setShowFiltered] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  const { launches, takingOff, earlier, filtered } = useMemo(() => {
    const visible = stories.filter((s) => showFiltered || s.actionable !== false);
    const cutoff = Date.now() - 48 * HOUR;
    const recent = visible.filter((s) => new Date(s.detected_at).getTime() >= cutoff).sort((a, b) => rank(b) - rank(a));
    return {
      launches: recent.filter((s) => s.official_accounts.length > 0),
      takingOff: recent.filter((s) => s.official_accounts.length === 0),
      earlier: visible.filter((s) => new Date(s.detected_at).getTime() < cutoff),
      filtered: stories.filter((s) => s.actionable === false).length,
    };
  }, [stories, showFiltered]);

  if (settingsLoading) return <Skeleton className="h-64 w-full" />;

  if (!enabled) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card px-6 py-12 text-center sm:px-12">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600"><Zap className="h-7 w-7" /></div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Your news radar</p>
        <h3 className="mt-3 text-2xl font-semibold tracking-tight">Find the story before everyone posts it</h3>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Follow launches and emerging conversations from AI and GTM accounts on X. Signals brings you what happened, the source posts,
          and an angle you can save as an idea.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Scans every 30 minutes using your Apify key. Estimated Apify cost: $5–15 per month.
        </p>
        <div className="mt-5 flex justify-center">
          <Button variant="cta" disabled={save.isPending} onClick={() => save.mutate({ enabled: true })}>
            <Zap className="mr-2 h-4 w-4" /> Turn on Signals
          </Button>
        </div>
      </div>
    );
  }

  const summary = (settings?.last_run_summary || {}) as Record<string, unknown>;
  const xError = typeof summary.x === "string" && summary.x.startsWith("error") ? summary.x.replace(/^error:\s*/, "") : null;
  const following = (settings?.official_accounts.length || 0) + (settings?.insider_accounts.length || 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="space-y-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Activity className="h-4 w-4 text-emerald-600" /> News radar</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {following ? `${following} accounts · ` : "Default accounts · "}
            {settings?.last_run_at ? <>Last scan {formatDistanceToNowStrict(new Date(settings.last_run_at))} ago</> : "First scan pending"}
            <span className="mx-2">·</span>Every 30 minutes
          </p>
        </div>
        {xError && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="border-amber-300 text-xs text-amber-700 dark:text-amber-300">Scan needs attention</Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="text-xs">
                {/limit/i.test(xError) ? "Your Apify account hit its monthly usage limit. Raise it in Apify billing and scans pick up where they stopped. " : ""}
                {xError}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={runPulse.isPending} onClick={() => runPulse.mutate()}>
            {runPulse.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Scan now
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{launches.length + takingOff.length} stories</span> in the last 48 hours</p>
        {filtered > 0 && (
          <Button variant="outline" size="sm" className="gap-2 text-xs" aria-pressed={showFiltered} onClick={() => setShowFiltered(!showFiltered)}>
            <EyeOff className="h-3.5 w-3.5" /> {showFiltered ? "Hide low relevance" : `Show ${filtered} low relevance`}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Column
            title="Launches"
            hint="Posted by the lab or company itself."
            icon={<Rocket className="h-4 w-4 text-sky-600" />}
            stories={launches}
            tone="border-border bg-muted/20"
          />
          <Column
            title="Taking off"
            hint="Several accounts you follow picked up the same new thing within 3 hours."
            icon={<TrendingUp className="h-4 w-4 text-emerald-600" />}
            stories={takingOff}
            tone="border-border bg-muted/20"
          />
        </div>
      )}

      {earlier.length > 0 && (
        <div className="space-y-4 rounded-xl border p-5">
          <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={showEarlier} onClick={() => setShowEarlier(!showEarlier)}>
            {showEarlier ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <h3 className="font-semibold">Earlier this week <span className="text-sm font-normal text-muted-foreground">({earlier.length})</span></h3>
          </button>
          {showEarlier && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {earlier.map((s) => <StoryCard key={s.id} story={s} compact />)}
            </div>
          )}
        </div>
      )}

      {settings && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />}
    </div>
  );
}
