import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addMinutes, format, isBefore, startOfDay } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  ImagePlus,
  Info,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  Wand2,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import {
  useAgentAssist,
  useDeletePosts,
  usePublishNow,
  useRetryPosts,
  useSavePost,
  useUploadSchedulerMedia,
} from "@/hooks/useScheduler";
import {
  captionLength,
  isEditable,
  isNativeDestination,
  normPlatform,
  probeMedia,
  ruleFor,
  shortError,
  statusLabel,
  suggestSlots,
  supportsStory,
  validatePost,
  type Media,
  type MediaMeta,
  type PostFormat,
  type SchedulerPost,
} from "@/lib/scheduler";
import { AccountAvatar, PlatformGlyph } from "./PlatformGlyph";
import { AccountPickerList, NativeBadge } from "./AccountPickerList";
import { ConnectAccountMenu } from "./ConnectAccountMenu";
import { PostPreview } from "./PostPreview";
import { PostStatsPanel } from "./PostStatsPanel";

export interface ComposerPrefill {
  caption?: string;
  accountIds?: string[];
  media?: Media;
}

interface PostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post?: SchedulerPost | null;
  initialAt?: Date | null;
  prefill?: ComposerPrefill | null;
  /** What can be picked. */
  accounts: ConnectedAccount[];
  /** Every account, hidden GHL copies included, so a post already on one shows it by name. */
  knownAccounts?: ConnectedAccount[];
  /** Hidden GHL copy id → the Zernio account that replaces it (a duplicate moves across). */
  replacedBy?: Map<string, string>;
  busy: Array<{ account_id: string; at: Date }>;
  onDuplicate?: (prefill: ComposerPrefill) => void;
}

/** Above this many accounts the chips give way to a searchable picker (agencies run dozens). */
const COMPACT_PICKER_AFTER = 8;

const QUICK_ACTIONS: Array<{ label: string; instruction: string }> = [
  { label: "Improve writing", instruction: "Improve clarity and flow without changing the meaning or the length much." },
  { label: "Stronger hook", instruction: "Rewrite only the first line as a scroll-stopping hook. Keep everything else." },
  { label: "Make it shorter", instruction: "Make it about 40% shorter. Keep the core point." },
  { label: "More casual", instruction: "Make the tone more casual and conversational." },
  { label: "More professional", instruction: "Make the tone more professional and credible." },
  { label: "Add a call to action", instruction: "End with one clear, natural call to action." },
];

/** A textarea exactly as tall as its text: no inner scroll, the dialog scrolls instead. */
function fitToText(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** Now + 1 h, on the next quarter hour. */
function defaultTime(): Date {
  const t = addMinutes(new Date(), 60);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 15) * 15);
  return t;
}

function counterTone(len: number, limit: number) {
  if (len > limit) return "bg-[hsl(var(--status-error-bg))] text-[hsl(var(--status-error))] dark:bg-red-950";
  if (len > limit * 0.9) return "bg-[hsl(var(--status-warning-bg))] text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  return "bg-muted text-muted-foreground";
}

export function PostComposer({ open, onOpenChange, post, initialAt, prefill, accounts, knownAccounts, replacedBy, busy, onDuplicate }: PostComposerProps) {
  const navigate = useNavigate();
  const save = useSavePost();
  const assist = useAgentAssist();
  const upload = useUploadSchedulerMedia();
  const retry = useRetryPosts();
  const publishNow = usePublishNow();
  const remove = useDeletePosts();

  const readOnly = !!post && !isEditable(post);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [base, setBase] = useState("");
  const [customize, setCustomize] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<string>("all");
  const [media, setMedia] = useState<Media>({ images: [] });
  const [uploading, setUploading] = useState(0);
  const [firstComment, setFirstComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [when, setWhenState] = useState<Date>(defaultTime);
  // Until the person picks a time, a new post follows the best free slot. A ref,
  // not state: the reset-on-open effect and the best-slot effect run in the same
  // commit, and the best-slot effect must see what the reset just decided (as
  // state it read the previous value, so an edited post jumped to the best slot).
  const followBestSlot = useRef(false);
  const setWhen = (d: Date) => {
    followBestSlot.current = false;
    setWhenState(d);
  };
  const [history, setHistory] = useState<Array<{ base: string; overrides: Record<string, string>; customize: boolean }>>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const [previewPlatform, setPreviewPlatform] = useState<string>("");
  const [dropping, setDropping] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [postFormat, setPostFormat] = useState<PostFormat>("feed");
  const [meta, setMeta] = useState<Record<string, MediaMeta>>({});
  const probed = useRef(new Set<string>());

  // Measure every picture and video (size, shape, length) so the per-channel
  // checks can tell what will be rejected before it is scheduled.
  useEffect(() => {
    const items: Array<[string, "image" | "video"]> = [
      ...media.images.map((u) => [u, "image"] as [string, "image"]),
      ...(media.video ? [[media.video, "video"] as [string, "video"]] : []),
    ];
    for (const [url, kind] of items) {
      if (probed.current.has(url)) continue;
      probed.current.add(url);
      probeMedia(url, kind).then((m) => setMeta((prev) => ({ ...prev, [url]: { ...prev[url], ...m } })));
    }
  }, [media]);

  // Accounts the post already uses but that can't be picked now still show, so editing never drops them:
  // a hidden GHL copy keeps its own name, a disconnected account shows as the channel.
  const chips = useMemo(() => {
    const list = accounts.filter((a) => normPlatform(a.platform) !== "wordpress");
    const offered = new Set(list.map((a) => a.id));
    const everyAccount = new Map((knownAccounts ?? []).map((a) => [a.id, a]));
    const orphans: ConnectedAccount[] = (post?.rows ?? [])
      .filter((r) => !offered.has(r.account_id))
      .map(
        (r) =>
          everyAccount.get(r.account_id) ?? { id: r.account_id, type: "social", platform: r.platform ?? "", name: `${ruleFor(r.platform).label} account`, isActive: true, isValid: false },
      );
    return [...list, ...orphans.filter((o, i, arr) => arr.findIndex((x) => x.id === o.id) === i)];
  }, [accounts, knownAccounts, post]);
  const byId = useMemo(() => new Map(chips.map((a) => [a.id, a])), [chips]);
  const toggleAccount = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setHistory([]);
    setOptions([]);
    setPrompt("");
    setTab("all");
    if (post) {
      const ids = [...new Set(post.rows.map((r) => r.account_id))];
      const caps = post.captions;
      const distinct = new Set(Object.values(caps));
      setSelected(ids);
      setBase(post.caption);
      setCustomize(distinct.size > 1);
      setOverrides(distinct.size > 1 ? caps : {});
      setMedia(post.media);
      const comment = post.rows[0]?.publish_content?.followUpComment ?? "";
      setFirstComment(comment);
      setShowComment(!!comment);
      setWhenState(post.at);
      followBestSlot.current = false;
      setPostFormat(post.format);
    } else {
      const firstSocial = chips.filter((a) => a.isActive && a.isValid !== false);
      // A duplicate only keeps accounts that are still connected and postable; one that went
      // out through a GHL copy now goes to the Zernio account that replaced it.
      const usable = [...new Set((prefill?.accountIds ?? []).map((id) => replacedBy?.get(id) ?? id))].filter((id) =>
        firstSocial.some((a) => a.id === id),
      );
      setSelected(usable.length ? usable : firstSocial.length === 1 ? [firstSocial[0].id] : []);
      setBase(prefill?.caption ?? "");
      setCustomize(false);
      setOverrides({});
      setMedia(prefill?.media ?? { images: [] });
      setFirstComment("");
      setShowComment(false);
      const fromSlot = !!initialAt && initialAt > new Date();
      setWhenState(fromSlot ? initialAt! : defaultTime());
      followBestSlot.current = !fromSlot;
      setPostFormat("feed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.key]);

  const platforms = useMemo(() => [...new Set(selected.map((id) => normPlatform(byId.get(id)?.platform)).filter(Boolean))], [selected, byId]);
  useEffect(() => {
    if (!platforms.includes(previewPlatform)) setPreviewPlatform(platforms[0] ?? "");
    if (tab !== "all" && !platforms.includes(tab)) setTab("all");
  }, [platforms, previewPlatform, tab]);

  const captionFor = (p: string) => (customize ? overrides[p] ?? base : base);
  const captions = useMemo(() => Object.fromEntries(platforms.map((p) => [p, captionFor(p)])), [platforms, base, overrides, customize]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasMedia = media.images.length > 0 || !!media.video;
  const storyCapable = platforms.some(supportsStory);
  const effectiveFormat: PostFormat = storyCapable && hasMedia ? postFormat : "feed";
  const linkedinRoute = useMemo(() => {
    const li = selected.map((id) => byId.get(id)).filter((a) => a && normPlatform(a.platform) === "linkedin");
    const native = li.filter((a) => isNativeDestination(a!)).length;
    return native === 0 ? "ghl" : native === li.length ? "native" : "both";
  }, [selected, byId]) as "ghl" | "native" | "both";
  const issues = useMemo(
    () => validatePost({ platforms, captions, media, meta, format: effectiveFormat, firstComment: showComment ? firstComment : "", linkedinRoute }),
    [platforms, captions, media, meta, effectiveFormat, showComment, firstComment, linkedinRoute],
  );
  const errors = issues.filter((i) => i.level === "error");
  // This post's own slots don't count as busy when suggesting times for it.
  const busyOthers = useMemo(
    () => busy.filter((b) => !post?.rows.some((r) => r.account_id === b.account_id && Math.abs(new Date(r.scheduled_for).getTime() - b.at.getTime()) < 60_000)),
    [busy, post],
  );
  const suggestions = useMemo(() => suggestSlots({ platforms, accountIds: selected, busy: busyOthers, count: 3 }), [platforms, selected, busyOthers]);
  const bestSlot = suggestions[0]?.at.getTime();
  useEffect(() => {
    if (open && followBestSlot.current && bestSlot) setWhenState(new Date(bestSlot));
  }, [open, bestSlot]);

  const editingText = tab === "all" ? base : captionFor(tab);
  // The post text grows with what's written, so a long caption reads in one
  // piece and the dialog scrolls, not a 200px box inside it.
  // Fitted whenever the box mounts (the sheet remounts it on every open, even for the
  // same caption), whenever its width changes (it wraps into more or fewer lines),
  // and whenever the text changes.
  const textObserver = useRef<ResizeObserver | null>(null);
  const attachText = useCallback((el: HTMLTextAreaElement | null) => {
    textObserver.current?.disconnect();
    textObserver.current = null;
    textRef.current = el;
    if (!el) return;
    fitToText(el);
    let width = el.clientWidth;
    textObserver.current = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitToText(el);
    });
    textObserver.current.observe(el);
  }, []);
  useLayoutEffect(() => {
    if (textRef.current) fitToText(textRef.current);
  }, [editingText]);
  const setEditingText = (value: string) => {
    if (tab === "all") setBase(value);
    else setOverrides((o) => ({ ...o, [tab]: value }));
  };

  const snapshot = () => setHistory((h) => [...h.slice(-9), { base, overrides, customize }]);
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setBase(last.base);
    setOverrides(last.overrides);
    setCustomize(last.customize);
    setHistory((h) => h.slice(0, -1));
  };

  const runAssist = (instruction: string, opts: { count?: number; tailor?: boolean } = {}) => {
    const text = editingText;
    if (!text.trim() && !instruction.trim()) {
      toast.info("Write a draft or tell the AI what the post is about.");
      return;
    }
    assist.mutate(
      { text, instruction, count: opts.count, platforms: opts.tailor ? platforms : undefined },
      {
        onSuccess: (res) => {
          if (res.variants) {
            snapshot();
            setCustomize(true);
            setOverrides((o) => ({ ...o, ...res.variants }));
            setTab(platforms[0] ?? "all");
            toast.success(`Tailored for ${Object.keys(res.variants).length} channels. Check each tab.`);
          } else if (res.options) {
            setOptions(res.options);
          } else if (res.text) {
            snapshot();
            setEditingText(res.text);
          }
          setPrompt("");
        },
      },
    );
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    for (const file of list) {
      try {
        const res = await upload.mutateAsync(file);
        setMeta((prev) => ({ ...prev, [res.url]: { ...prev[res.url], bytes: file.size } }));
        setMedia((m) => (res.kind === "video" ? { images: [], video: res.url } : { images: [...m.images, res.url], video: undefined }));
      } catch {
        // toast shown by the hook
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const submit = (mode: "schedule" | "queue" | "now" | "draft") => {
    // The shortcut can fire while a save or upload is running; the buttons can't.
    if (save.isPending) return;
    if (uploading > 0) {
      toast.info("Wait for the upload to finish.");
      return;
    }
    const targets = selected.filter((id) => byId.get(id)?.platform);
    if (!targets.length) {
      toast.error("Pick at least one account to post to.");
      return;
    }
    let at = when;
    if (mode === "queue") {
      const next = suggestions[0]?.at;
      if (!next) {
        toast.error("No free best-time slot in the next two weeks. Pick a time instead.");
        return;
      }
      at = next;
    }
    if (mode === "now") at = new Date();
    if (mode !== "now" && mode !== "draft" && isBefore(at, addMinutes(new Date(), 1))) {
      toast.error("Pick a time in the future.");
      return;
    }
    if (mode !== "draft" && errors.length) {
      toast.error(errors[0].message);
      return;
    }
    save.mutate(
      {
        existing: post ?? null,
        accounts: targets.map((id) => ({ id, platform: byId.get(id)!.platform })),
        captions,
        media,
        firstComment: showComment ? firstComment : "",
        scheduledFor: at,
        status: mode === "draft" ? "draft" : "pending",
        format: effectiveFormat,
      },
      {
        onSuccess: () => {
          if (mode === "queue") toast.message(`Queued for ${format(at, "EEE d MMM, HH:mm")}`);
          if (mode === "now") toast.message("Goes out within 5 minutes.");
          onOpenChange(false);
        },
      },
    );
  };

  // Cmd/Ctrl + Enter schedules.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !readOnly) {
      e.preventDefault();
      submit("schedule");
    }
  };

  const title = !post ? "New post" : post.status === "draft" ? (post.origin === "agent" ? "Agent proposal" : "Draft") : readOnly ? statusLabel(post) + " post" : "Edit post";
  const primaryLabel = post?.status === "draft" ? "Approve & schedule" : post ? "Save changes" : "Schedule";
  const previewAccount = chips.find((a) => selected.includes(a.id) && normPlatform(a.platform) === previewPlatform);
  const saving = save.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[1120px]" onKeyDown={onKeyDown}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-6 py-4 pr-14">
          <div className="min-w-0">
            <SheetTitle className="flex items-center gap-2 text-lg">
              {post?.origin === "agent" && <Sparkles className="h-4 w-4 text-[hsl(var(--status-purple))]" />}
              {post?.origin === "autopilot" && <Zap className="h-4 w-4 text-primary" />}
              {title}
            </SheetTitle>
            <SheetDescription className="truncate">
              {post?.origin === "autopilot"
                ? `Made by ${post.autopilotName ?? "an autopilot"}. Edits here only change this post.`
                : readOnly
                  ? "This post has gone out. Duplicate it to post again."
                  : "Write once, tailor per channel, and pick the best time."}
            </SheetDescription>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Left: editor */}
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            {post?.rationale && (
              <div className="flex gap-2.5 rounded-lg border border-[hsl(var(--status-purple))]/30 bg-[hsl(var(--status-purple-bg))] p-3 text-sm dark:bg-violet-950/40">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-purple))]" />
                <div>
                  <div className="font-medium">Why the agent proposed this</div>
                  <p className="text-muted-foreground">{post.rationale}</p>
                </div>
              </div>
            )}
            {post?.status === "failed" && post.error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-[hsl(var(--status-error))]/40 bg-[hsl(var(--status-error-bg))] p-3 text-sm dark:bg-red-950/40">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--status-error))]" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{shortError(post.error)}</div>
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Full error</summary>
                    <p className="mt-1 break-words">{post.error}</p>
                  </details>
                </div>
                <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate([post], { onSuccess: () => onOpenChange(false) })}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Retry now
                </Button>
              </div>
            )}
            {post?.status === "published" && <PostStatsPanel post={post} accountLabel={(id) => byId.get(id)?.name ?? "Account"} />}

            {/* Accounts */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">Post to</h4>
                {!readOnly && chips.length > 1 && chips.length <= COMPACT_PICKER_AFTER && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelected(selected.length === chips.length ? [] : chips.filter((c) => c.isActive).map((c) => c.id))}
                  >
                    {selected.length === chips.length ? "Clear" : "Select all"}
                  </button>
                )}
              </div>
              {chips.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  No social accounts connected yet.
                  <ConnectAccountMenu size="sm" />
                </div>
              ) : chips.length > COMPACT_PICKER_AFTER ? (
                <div className="flex flex-wrap items-center gap-2">
                  {selected.map((id) => byId.get(id)).filter(Boolean).map((a) => (
                    <span key={a!.id} className="flex items-center gap-2 rounded-full border border-foreground/70 bg-foreground/[0.04] py-1 pl-1 pr-2 text-sm shadow-sm">
                      <AccountAvatar name={a!.name} avatarUrl={a!.avatarUrl} platform={a!.platform} size={28} />
                      <span className="max-w-[160px] truncate">{a!.name}</span>
                      {isNativeDestination(a!) && <NativeBadge provider={a!.metadata?.provider} />}
                      {!readOnly && (
                        <button type="button" onClick={() => toggleAccount(a!.id)} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${a!.name}`}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  ))}
                  {!readOnly && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 rounded-full">
                          <Plus className="h-4 w-4" /> {selected.length ? "Add accounts" : `Choose accounts (${chips.length})`}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-80 p-0">
                        <AccountPickerList title="Post to" accounts={chips} selected={selected} onChange={setSelected} />
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {chips.map((a) => {
                    const on = selected.includes(a.id);
                    const disabled = readOnly || (!a.isActive && !on);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => toggleAccount(a.id)}
                        className={cn(
                          "flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-all",
                          on ? "border-foreground/70 bg-foreground/[0.04] shadow-sm" : "border-border opacity-70 hover:opacity-100",
                          disabled && "cursor-not-allowed opacity-40",
                        )}
                        title={a.isValid === false ? "Needs reconnecting" : a.name}
                        aria-pressed={on}
                      >
                        <AccountAvatar name={a.name} avatarUrl={a.avatarUrl} platform={a.platform} size={28} />
                        <span className="max-w-[140px] truncate">{a.name}</span>
                        {isNativeDestination(a) && <NativeBadge provider={a.metadata?.provider} />}
                        {on && <Check className="h-3.5 w-3.5" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Format */}
            {storyCapable && hasMedia && (
              <section className="flex flex-wrap items-center gap-3">
                <h4 className="text-sm font-semibold">Format</h4>
                <div className="flex rounded-lg border p-0.5">
                  {([
                    ["feed", media.video ? "Feed / Reel" : media.images.length > 1 ? "Feed / Carousel" : "Feed"],
                    ["story", "Story"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      disabled={readOnly}
                      onClick={() => setPostFormat(v)}
                      className={cn(
                        "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                        effectiveFormat === v ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                      )}
                      aria-pressed={effectiveFormat === v}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground">
                  {effectiveFormat === "story"
                    ? `Story on ${platforms.filter(supportsStory).map((p) => ruleFor(p).label).join(" and ")}; other channels post normally.`
                    : media.video
                      ? "Videos go out as Reels on Instagram and Facebook."
                      : "Posts in the feed."}
                </span>
              </section>
            )}

            {/* Editor */}
            <section
              className={cn("rounded-xl border bg-card transition-colors", dropping && "border-primary bg-primary/5")}
              onDragOver={(e) => {
                if (readOnly || !e.dataTransfer.types.includes("Files")) return;
                e.preventDefault();
                setDropping(true);
              }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                if (readOnly) return;
                e.preventDefault();
                setDropping(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <div className="flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setTab("all")}
                  className={cn("rounded-md px-2.5 py-1 text-xs font-medium", tab === "all" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}
                >
                  {customize ? "Original" : "All channels"}
                </button>
                {customize &&
                  platforms.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTab(p)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium",
                        tab === p ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <PlatformGlyph platform={p} className={cn(tab === p && "text-background")} />
                      {ruleFor(p).label}
                      {overrides[p] !== undefined && overrides[p] !== base && <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--status-purple))]" />}
                    </button>
                  ))}
                {!readOnly && platforms.length > 1 && (
                  <label className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-xs text-muted-foreground">
                    Customize per channel
                    <Switch
                      checked={customize}
                      onCheckedChange={(v) => {
                        setCustomize(v);
                        if (!v) setTab("all");
                      }}
                    />
                  </label>
                )}
              </div>

              <Textarea
                ref={attachText}
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onPaste={(e) => {
                  if (readOnly) return;
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) {
                    e.preventDefault();
                    addFiles(files);
                  }
                }}
                readOnly={readOnly}
                placeholder={tab === "all" ? "What do you want to share? Paste or drop images and videos here too." : `The ${ruleFor(tab).label} version`}
                className="min-h-[200px] resize-none overflow-hidden rounded-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
                aria-label="Post text"
              />

              {/* Media */}
              {(media.images.length > 0 || media.video || uploading > 0) && (
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {media.images.map((src, i) => (
                    <div key={src + i} className="group relative h-20 w-20 overflow-hidden rounded-lg border">
                      <img src={src} alt="" className="h-full w-full object-cover" />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setMedia((m) => ({ ...m, images: m.images.filter((_, j) => j !== i) }))}
                          className="absolute right-1 top-1 hidden rounded-full bg-black/70 p-0.5 text-white group-hover:block"
                          aria-label="Remove picture"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {media.video && (
                    <div className="group relative h-20 w-32 overflow-hidden rounded-lg border bg-black">
                      <video src={media.video} className="h-full w-full object-cover" muted preload="metadata" />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => setMedia({ images: [] })}
                          className="absolute right-1 top-1 hidden rounded-full bg-black/70 p-0.5 text-white group-hover:block"
                          aria-label="Remove video"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {Array.from({ length: uploading }).map((_, i) => (
                    <div key={`up-${i}`} className="grid h-20 w-20 place-items-center rounded-lg border border-dashed">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}

              {/* Toolbar */}
              {!readOnly && (
                <div className="flex flex-wrap items-center gap-1 border-t px-2 py-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="h-4 w-4" /> Media
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" disabled={assist.isPending}>
                        {assist.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4 text-[hsl(var(--status-purple))]" />}
                        AI edit
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">Rewrite {tab === "all" ? "the post" : `the ${ruleFor(tab).label} version`}</DropdownMenuLabel>
                      {QUICK_ACTIONS.map((a) => (
                        <DropdownMenuItem key={a.label} onSelect={() => runAssist(a.instruction)}>
                          {a.label}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => runAssist("Write alternative versions with different hooks and angles.", { count: 3 })}>
                        <Sparkles className="mr-2 h-3.5 w-3.5" /> 3 alternative versions
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={platforms.length === 0} onSelect={() => runAssist("", { tailor: true })}>
                        <Wand2 className="mr-2 h-3.5 w-3.5" /> Tailor for each channel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-xs"
                    onClick={() => setShowComment((v) => !v)}
                  >
                    <MessageSquarePlus className="h-4 w-4" /> First comment
                  </Button>
                  {history.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={undo}>
                      <Undo2 className="h-4 w-4" /> Undo AI
                    </Button>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-1">
                    {platforms.map((p) => {
                      const len = captionLength(p, captionFor(p));
                      const limit = ruleFor(p).limit;
                      return (
                        <span key={p} className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] tabular-nums", counterTone(len, limit))} title={`${ruleFor(p).label}: ${len} of ${limit.toLocaleString()} characters${normPlatform(p) === "twitter" ? " (links count as 23, emoji as 2)" : ""}`}>
                          <PlatformGlyph platform={p} className="h-3 w-3" />
                          {limit < 10_000 ? `${len}/${limit.toLocaleString()}` : len}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Ask AI */}
              {!readOnly && (
                <form
                  className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (prompt.trim()) runAssist(prompt.trim());
                  }}
                >
                  <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--status-purple))]" />
                  <Input
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={editingText.trim() ? "Tell the AI how to change it, e.g. “mention the free trial”" : "Tell the AI what to write, e.g. “announce our webinar on Thursday”"}
                    className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                    disabled={assist.isPending}
                    aria-label="Ask AI"
                  />
                  <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={!prompt.trim() || assist.isPending}>
                    {assist.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : editingText.trim() ? "Rewrite" : "Write"}
                  </Button>
                </form>
              )}
            </section>

            {options.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-3.5 w-3.5 text-[hsl(var(--status-purple))]" /> Pick a version</h4>
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOptions([])}>Dismiss</button>
                </div>
                <div className="grid gap-2 md:grid-cols-3">
                  {options.map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        snapshot();
                        setEditingText(o);
                        setOptions([]);
                      }}
                      className="rounded-lg border bg-card p-3 text-left text-xs leading-relaxed transition-all hover:border-foreground/40 hover:shadow-md"
                    >
                      <span className="line-clamp-[10] whitespace-pre-wrap">{o}</span>
                      <span className="mt-2 inline-block font-medium text-[hsl(var(--status-purple))]">Use this</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {showComment && (
              <section>
                <h4 className="mb-1.5 text-sm font-semibold">First comment</h4>
                <Textarea
                  value={firstComment}
                  onChange={(e) => setFirstComment(e.target.value)}
                  readOnly={readOnly}
                  placeholder="Posted as the first comment, a good place for the link so the post itself gets more reach."
                  className="min-h-[72px] text-sm"
                />
                <p className="mt-1 text-xs text-muted-foreground">Posted where the channel supports it (LinkedIn, Facebook, Instagram).</p>
              </section>
            )}

            {issues.length > 0 && platforms.length > 0 && (
              <ul className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                {[...issues]
                  .sort((a, b) => ["error", "warning", "info"].indexOf(a.level) - ["error", "warning", "info"].indexOf(b.level))
                  .map((i, idx) => (
                    <li
                      key={idx}
                      className={cn(
                        "flex items-start gap-2 text-xs leading-relaxed",
                        i.level === "error" && "text-[hsl(var(--status-error))]",
                        i.level === "warning" && "text-amber-700 dark:text-amber-400",
                        i.level === "info" && "text-muted-foreground",
                      )}
                    >
                      {i.level === "info" ? <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      {i.message}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* Right: preview */}
          <aside className="hidden min-h-0 flex-col overflow-y-auto border-l bg-muted/30 lg:flex">
            <div className="sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b bg-muted/60 px-4 py-2 backdrop-blur">
              <span className="mr-1 text-xs font-medium text-muted-foreground">Preview</span>
              {platforms.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreviewPlatform(p)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                    previewPlatform === p ? "bg-card font-medium shadow-sm" : "text-muted-foreground hover:bg-card/60",
                  )}
                >
                  <PlatformGlyph platform={p} />
                  {ruleFor(p).label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {previewPlatform ? (
                <PostPreview
                  platform={previewPlatform}
                  caption={captionFor(previewPlatform)}
                  media={media}
                  accountName={previewAccount?.name ?? "Your account"}
                  avatarUrl={previewAccount?.avatarUrl}
                  handle={previewAccount?.username}
                  firstComment={showComment ? firstComment : undefined}
                  format={effectiveFormat}
                  linkedinDocument={!previewAccount || !isNativeDestination(previewAccount)}
                />
              ) : (
                <div className="grid h-64 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                  Pick an account to see how the post looks there.
                </div>
              )}
              {previewPlatform && ruleFor(previewPlatform).specs && (
                <div className="mt-4 flex gap-2 rounded-lg border bg-card p-3 text-xs leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    <span className="font-medium text-foreground">{ruleFor(previewPlatform).label} specs. </span>
                    {ruleFor(previewPlatform).specs}
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 border-t bg-card px-6 py-3">
          {readOnly ? (
            <>
              <span className="text-sm text-muted-foreground">
                {post?.status === "published" ? `Published ${format(post.at, "EEE d MMM, HH:mm")}` : "Publishing now…"}
              </span>
              <div className="ml-auto flex gap-2">
                {post?.jobId && (
                  <Button variant="outline" onClick={() => navigate(`/jobs/${post.jobId}`)}>
                    <ExternalLink className="mr-1.5 h-4 w-4" /> View run
                  </Button>
                )}
                {post && onDuplicate && (
                  <Button variant="cta" onClick={() => onDuplicate({ caption: post.caption, accountIds: post.rows.map((r) => r.account_id), media: post.media })}>
                    <Copy className="mr-1.5 h-4 w-4" /> Duplicate
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <CalendarDays className="h-4 w-4" />
                    <span className="tabular-nums">{format(when, "EEE d MMM, HH:mm")}</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={when}
                    onSelect={(d) => d && setWhen(new Date(d.getFullYear(), d.getMonth(), d.getDate(), when.getHours(), when.getMinutes()))}
                    disabled={(d) => isBefore(d, startOfDay(new Date()))}
                    initialFocus
                  />
                  <div className="flex items-center gap-2 border-t p-3">
                    <CalendarClock className="h-4 w-4 text-muted-foreground" />
                    <Input
                      type="time"
                      step={300}
                      value={format(when, "HH:mm")}
                      onChange={(e) => {
                        const [h, m] = e.target.value.split(":").map(Number);
                        if (Number.isFinite(h) && Number.isFinite(m)) setWhen(new Date(when.getFullYear(), when.getMonth(), when.getDate(), h, m));
                      }}
                      className="h-8 w-28"
                      aria-label="Time"
                    />
                    <Button size="sm" className="ml-auto h-8" variant="outline" onClick={() => setDateOpen(false)}>Done</Button>
                  </div>
                </PopoverContent>
              </Popover>
              {suggestions.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {suggestions.map((s) => {
                    const active = Math.abs(s.at.getTime() - when.getTime()) < 60_000;
                    return (
                      <button
                        key={s.at.toISOString()}
                        type="button"
                        onClick={() => setWhen(s.at)}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                          active ? "border-[hsl(var(--status-success))] bg-[hsl(var(--status-success-bg))] text-foreground dark:bg-emerald-950" : "text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                        )}
                        title={s.score >= 0.85 ? "Peak engagement time for these channels" : "Good time for these channels"}
                      >
                        <Star className={cn("h-3 w-3", s.score >= 0.85 ? "fill-amber-400 text-amber-400" : "text-amber-400")} />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                {post && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate([post], { onSuccess: () => onOpenChange(false) })}
                    aria-label="Remove post"
                    title="Remove post"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button variant="outline" disabled={saving} onClick={() => submit("draft")}>
                  {post?.status === "draft" ? "Save draft" : "Save as draft"}
                </Button>
                <div className="flex">
                  <Button variant="cta" className="rounded-r-none" disabled={saving || uploading > 0} onClick={() => submit("schedule")}>
                    {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />}
                    {primaryLabel}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="cta" className="rounded-l-none border-l border-black/10 px-2" disabled={saving || uploading > 0} aria-label="More ways to post">
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuItem onSelect={() => submit("queue")} disabled={!suggestions.length}>
                        <Star className="mr-2 h-4 w-4 text-amber-500" />
                        <div>
                          <div>Add to queue</div>
                          <div className="text-xs text-muted-foreground">{suggestions[0] ? `Next best slot: ${suggestions[0].label}` : "No free slot soon"}</div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => submit("now")}>
                        <Send className="mr-2 h-4 w-4" />
                        <div>
                          <div>Publish now</div>
                          <div className="text-xs text-muted-foreground">Goes out within 5 minutes</div>
                        </div>
                      </DropdownMenuItem>
                      {post && post.status === "pending" && (
                        <DropdownMenuItem onSelect={() => publishNow.mutate(post, { onSuccess: () => onOpenChange(false) })}>
                          <Send className="mr-2 h-4 w-4" /> Publish now without changes
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
