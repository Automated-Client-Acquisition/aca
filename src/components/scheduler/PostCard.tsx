import { useDraggable } from "@dnd-kit/core";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle2, Film, Heart, Loader2, MessageCircle, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCount, isEditable, ruleFor, type SchedulerPost } from "@/lib/scheduler";
import { PlatformStack } from "./PlatformGlyph";

function statusTone(post: SchedulerPost): string {
  if (post.status === "failed") return "border-[hsl(var(--status-error))]/60 bg-[hsl(var(--status-error-bg))] dark:bg-red-950/40";
  if (post.status === "draft" && post.origin === "agent") return "border-dashed border-[hsl(var(--status-purple))]/60 bg-[hsl(var(--status-purple-bg))] dark:bg-violet-950/40";
  if (post.status === "draft") return "border-dashed border-muted-foreground/40 bg-muted/60";
  if (post.status === "published") return "border-border bg-card/70 opacity-80";
  return "border-border bg-card";
}

export function StatusIcon({ post, className }: { post: SchedulerPost; className?: string }) {
  if (post.status === "failed") return <AlertTriangle className={cn("h-3 w-3 text-[hsl(var(--status-error))]", className)} aria-label="Failed" />;
  if (post.status === "publishing") return <Loader2 className={cn("h-3 w-3 animate-spin text-[hsl(var(--status-info))]", className)} aria-label="Publishing" />;
  if (post.status === "published") return <CheckCircle2 className={cn("h-3 w-3 text-[hsl(var(--status-success))]", className)} aria-label="Published" />;
  if (post.status === "draft" && post.origin === "agent") return <Sparkles className={cn("h-3 w-3 text-[hsl(var(--status-purple))]", className)} aria-label="Agent proposal" />;
  if (post.origin === "autopilot") return <Zap className={cn("h-3 w-3 text-primary", className)} aria-label="Autopilot" />;
  return null;
}

function Thumb({ post, className }: { post: SchedulerPost; className?: string }) {
  const src = post.media.images[0];
  if (src) return <img src={src} alt="" loading="lazy" className={cn("rounded object-cover", className)} />;
  if (post.media.video) {
    return (
      <span className={cn("grid place-items-center rounded bg-foreground/80 text-background", className)}>
        <Film className="h-3 w-3" />
      </span>
    );
  }
  return null;
}

interface PostCardProps {
  post: SchedulerPost;
  variant: "week" | "month";
  onOpen: (post: SchedulerPost) => void;
  selected?: boolean;
}

/** A post on the calendar. Drafts, scheduled and failed posts can be dragged to a new time. */
export function PostCard({ post, variant, onOpen, selected }: PostCardProps) {
  const draggable = isEditable(post);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `post:${post.key}`, data: { post }, disabled: !draggable });
  const accent = ruleFor(post.platforms[0]).color;
  const time = format(post.at, "HH:mm");
  const firstLine = post.caption.split("\n").find((l) => l.trim()) || post.title;

  if (variant === "month") {
    return (
      <button
        ref={setNodeRef}
        type="button"
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(post);
        }}
        className={cn(
          "group flex w-full min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-5 transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          statusTone(post),
          draggable && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-40",
          selected && "ring-2 ring-primary",
        )}
        title={[`${time} · ${firstLine}`, statsTitle(post)].filter(Boolean).join("\n")}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <span className="shrink-0 font-semibold tabular-nums">{time}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground group-hover:text-foreground">{firstLine}</span>
        <StatusIcon post={post} className="shrink-0" />
      </button>
    );
  }

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(post);
      }}
      className={cn(
        "group relative flex w-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg border py-1.5 pl-2.5 pr-1.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        statusTone(post),
        draggable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-40",
        selected && "ring-2 ring-primary",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent, opacity: post.status === "draft" ? 0.45 : 1 }} />
      <span className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold tabular-nums">{time}</span>
        <PlatformStack platforms={post.platforms} max={3} />
        <span className="ml-auto flex items-center gap-1">
          <StatusIcon post={post} />
        </span>
      </span>
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-snug text-foreground/85">{firstLine}</span>
        <Thumb post={post} className="h-7 w-7 shrink-0" />
      </span>
      <StatsLine post={post} />
    </button>
  );
}

/** Likes and comments on a published post, once the platform has counted them. */
export function StatsLine({ post, className, withReach }: { post: SchedulerPost; className?: string; withReach?: boolean }) {
  const s = post.stats;
  if (!s || (s.status !== "synced" && s.status !== "pending") || s.likes + s.comments + s.reach + s.views === 0) return null;
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-[10.5px] tabular-nums text-muted-foreground", className)} title={statsTitle(post)}>
      <span className="inline-flex items-center gap-0.5"><Heart className="h-2.5 w-2.5" />{formatCount(s.likes)}</span>
      <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-2.5 w-2.5" />{formatCount(s.comments)}</span>
      {withReach && (s.reach || s.views) > 0 && <span>{formatCount(s.reach || s.views)} {s.reach ? "reach" : "views"}</span>}
      {withReach && s.engagementRate !== null && <span>{s.engagementRate}% engagement</span>}
    </span>
  );
}

function statsTitle(post: SchedulerPost): string | undefined {
  const s = post.stats;
  if (!s) return undefined;
  return `${formatCount(s.reach || s.views)} ${s.reach ? "reach" : "views"} · ${formatCount(s.likes)} likes · ${formatCount(s.comments)} comments${s.engagementRate !== null ? ` · ${s.engagementRate}% engagement` : ""}`;
}

/** What the drag overlay shows under the cursor. */
export function PostCardGhost({ post }: { post: SchedulerPost }) {
  return (
    <div className={cn("w-48 rotate-1 rounded-lg border px-2.5 py-1.5 shadow-xl", statusTone(post))}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold tabular-nums">{format(post.at, "HH:mm")}</span>
        <PlatformStack platforms={post.platforms} max={3} />
      </div>
      <div className="mt-1 line-clamp-2 text-[11.5px] leading-snug">{post.caption.split("\n").find((l) => l.trim()) || post.title}</div>
    </div>
  );
}
