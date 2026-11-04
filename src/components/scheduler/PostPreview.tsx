import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  FileText,
  Globe,
  Heart,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Play,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { normPlatform, ruleFor, supportsStory, xMeasure, type Media, type PostFormat } from "@/lib/scheduler";
import { AccountAvatar } from "./PlatformGlyph";

interface PreviewProps {
  platform: string;
  caption: string;
  media: Media;
  accountName: string;
  avatarUrl?: string;
  handle?: string;
  firstComment?: string;
  format?: PostFormat;
  /** LinkedIn through GHL turns several pictures into a PDF document; native posts a multi-image post. */
  linkedinDocument?: boolean;
}

/** The account's @handle as the feed prints it: its username when known, else its name squeezed. */
function toHandle(handle: string | undefined, accountName: string): string {
  return (handle || accountName).trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
}

/** Caption cut at the platform's "see more" fold, expandable like the real feed. */
function FoldedText({
  text,
  fold,
  moreLabel = "…more",
  className,
  prefix,
}: {
  text: string;
  fold: number;
  moreLabel?: string;
  className?: string;
  /** Printed before the caption, outside the fold count (Instagram's bold handle). */
  prefix?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const needsFold = text.length > fold;
  const shown = open || !needsFold ? text : text.slice(0, fold).trimEnd();
  return (
    <p className={cn("whitespace-pre-wrap break-words", className)}>
      {prefix}
      {shown || <span className="italic text-muted-foreground">Your caption shows here</span>}
      {needsFold && !open && (
        <button type="button" onClick={() => setOpen(true)} className="ml-0.5 text-muted-foreground hover:underline">
          {moreLabel}
        </button>
      )}
    </p>
  );
}

function MediaGrid({ media, rounded = "rounded-none", aspect = "aspect-[4/3]" }: { media: Media; rounded?: string; aspect?: string }) {
  if (media.video) {
    return (
      <div className={cn("relative grid w-full place-items-center overflow-hidden bg-black", aspect, rounded)}>
        <video src={media.video} className="h-full w-full object-cover opacity-90" muted playsInline preload="metadata" />
        <span className="absolute grid h-12 w-12 place-items-center rounded-full bg-black/55 text-white">
          <Play className="ml-0.5 h-5 w-5 fill-current" />
        </span>
      </div>
    );
  }
  const imgs = media.images;
  if (!imgs.length) return null;
  if (imgs.length === 1) return <img src={imgs[0]} alt="" className={cn("w-full object-cover", aspect, rounded)} />;
  const shown = imgs.slice(0, 4);
  return (
    <div className={cn("grid w-full gap-0.5 overflow-hidden", aspect, rounded, shown.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2")}>
      {shown.map((src, i) => (
        <div key={src + i} className={cn("relative overflow-hidden", shown.length === 3 && i === 0 && "row-span-2")}>
          <img src={src} alt="" className="h-full w-full object-cover" />
          {i === 3 && imgs.length > 4 && (
            <span className="absolute inset-0 grid place-items-center bg-black/50 text-lg font-semibold text-white">+{imgs.length - 4}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Several pictures as the feed shows a carousel: swipe (trackpad or touch), or
 * use the arrows; a counter and dots say where you are.
 */
function Carousel({
  images,
  className,
  arrows = "light",
  counter = "top",
  dots = true,
  label = "picture",
  arrowsAt = "top-1/2",
  onIndex,
}: {
  images: string[];
  /** Size of the frame, e.g. "aspect-[4/5]" or "h-full". */
  className: string;
  /** Instagram-style white buttons, or dark ones for a document. */
  arrows?: "light" | "dark";
  counter?: "top" | "bottom";
  dots?: boolean;
  label?: string;
  /** Height of the arrows, when something else sits mid-frame (TikTok's buttons). */
  arrowsAt?: string;
  /** For a feed that draws its own dots (Instagram's sit in the action row). */
  onIndex?: (index: number) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Where an arrow is taking us: a second click during the smooth scroll counts
  // from there, not from the slide still in view.
  const heading = useRef<number | null>(null);
  const key = images.join("|");
  useEffect(() => {
    track.current?.scrollTo({ left: 0 });
    heading.current = null;
    setIndex(0);
  }, [key]);
  useEffect(() => onIndex?.(index), [index, onIndex]);

  const step = (dir: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    const to = Math.max(0, Math.min(images.length - 1, (heading.current ?? index) + dir));
    heading.current = to;
    el.scrollTo({ left: to * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = track.current;
    if (!el?.clientWidth) return;
    setIndex(Math.min(images.length - 1, Math.round(el.scrollLeft / el.clientWidth)));
    if (heading.current !== null && Math.abs(el.scrollLeft - heading.current * el.clientWidth) < 2) heading.current = null;
  };
  const arrow = cn(
    "absolute grid -translate-y-1/2 place-items-center rounded-full shadow-sm",
    arrowsAt,
    arrows === "light" ? "h-7 w-7 bg-white/85 text-zinc-900 hover:bg-white" : "h-8 w-8 bg-black/60 text-white hover:bg-black/75",
  );

  return (
    <div className={cn("relative w-full", className)}>
      <div
        ref={track}
        onScroll={onScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((src, i) => (
          <img key={src + i} src={src} alt="" draggable={false} className="h-full w-full shrink-0 snap-center object-cover" />
        ))}
      </div>
      {index > 0 && (
        <button type="button" onClick={() => step(-1)} className={cn(arrow, "left-2")} aria-label={`Previous ${label}`}>
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      {index < images.length - 1 && (
        <button type="button" onClick={() => step(1)} className={cn(arrow, "right-2")} aria-label={`Next ${label}`}>
          <ChevronRight className="h-4 w-4" />
        </button>
      )}
      <span className={cn("absolute right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white", counter === "top" ? "top-2" : "bottom-2")}>
        {index + 1}/{images.length}
      </span>
      {dots && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
          {images.slice(0, 20).map((_, i) => (
            <span key={i} className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === index ? "bg-white" : "bg-white/50")} />
          ))}
        </div>
      )}
    </div>
  );
}

/** GHL posts several pictures to LinkedIn as a PDF document: one page at a time, swipeable. */
function LinkedInDocument({ images, title }: { images: string[]; title: string }) {
  return (
    <div className="bg-zinc-100 dark:bg-zinc-800">
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
        <FileText className="h-3.5 w-3.5" />
        <span className="truncate">{title || "Document"} · {images.length} pages</span>
      </div>
      <Carousel images={images} className="aspect-[4/5]" arrows="dark" counter="bottom" dots={false} label="page" />
    </div>
  );
}

function LinkedInPreview({ caption, media, accountName, avatarUrl, firstComment, linkedinDocument = true }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[13px] text-[#191919] shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-start gap-2 p-3 pb-2">
        <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="linkedin" size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-semibold">{accountName}</div>
          <div className="text-[11px] text-zinc-500">Just now · <Globe className="inline h-3 w-3" /></div>
        </div>
        <MoreHorizontal className="h-4 w-4 text-zinc-500" />
      </div>
      <FoldedText text={caption} fold={ruleFor("linkedin").fold} className="px-3 pb-2 leading-snug" />
      {linkedinDocument && !media.video && media.images.length > 1 ? <LinkedInDocument images={media.images} title={caption.split("\n")[0]} /> : <MediaGrid media={media} />}
      <div className="flex justify-around border-t px-2 py-1.5 text-[12px] font-medium text-zinc-500">
        {[[ThumbsUp, "Like"], [MessageCircle, "Comment"], [Repeat2, "Repost"], [Send, "Send"]].map(([Icon, label]) => {
          const I = Icon as typeof ThumbsUp;
          return <span key={label as string} className="flex items-center gap-1.5 px-2 py-1"><I className="h-4 w-4" />{label as string}</span>;
        })}
      </div>
      {firstComment?.trim() && (
        <div className="flex gap-2 border-t bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="linkedin" size={28} />
          <div className="rounded-lg bg-zinc-100 px-3 py-2 text-[12px] dark:bg-zinc-800">{firstComment}</div>
        </div>
      )}
    </div>
  );
}

function XPreview({ caption, media, accountName, avatarUrl, handle }: PreviewProps) {
  const cut = xMeasure(caption).overflowAt ?? caption.length;
  return (
    <div className="flex gap-3 rounded-lg border bg-white p-3 text-[14px] text-[#0f1419] shadow-sm dark:bg-black dark:text-zinc-100">
      <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="twitter" size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[14px]">
          <span className="truncate font-bold">{accountName}</span>
          <span className="truncate text-zinc-500">@{toHandle(handle, accountName)} · now</span>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap break-words leading-snug">
          {caption.slice(0, cut) || <span className="italic text-zinc-400">Your post shows here</span>}
          {cut < caption.length && <span className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">{caption.slice(cut)}</span>}
        </p>
        {(media.images.length > 0 || media.video) && (
          <div className="mt-2 overflow-hidden rounded-2xl border">
            <MediaGrid media={{ images: media.images.slice(0, 4), video: media.video }} aspect="aspect-video" />
          </div>
        )}
        <div className="mt-2 flex max-w-[300px] justify-between text-zinc-500">
          <MessageCircle className="h-4 w-4" /><Repeat2 className="h-4 w-4" /><Heart className="h-4 w-4" /><Share2 className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

function InstagramPreview({ caption, media, accountName, avatarUrl, handle: rawHandle, firstComment }: PreviewProps) {
  const handle = toHandle(rawHandle, accountName);
  const hasMedia = media.images.length > 0 || !!media.video;
  const carousel = !media.video && media.images.length > 1;
  const [slide, setSlide] = useState(0);
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[13px] text-zinc-900 shadow-sm dark:bg-black dark:text-zinc-100">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]">
          <span className="block rounded-full bg-white p-[1px] dark:bg-black">
            <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="instagram" size={28} />
          </span>
        </span>
        <span className="flex-1 truncate font-semibold">{handle}</span>
        <MoreHorizontal className="h-4 w-4" />
      </div>
      {carousel ? (
        <Carousel images={media.images.slice(0, 20)} className="aspect-[4/5]" dots={false} onIndex={setSlide} />
      ) : hasMedia ? (
        <MediaGrid media={{ images: media.images.slice(0, 1), video: media.video }} aspect={media.video ? "aspect-[9/16] max-h-[520px]" : "aspect-[4/5]"} />
      ) : (
        <div className="grid aspect-square place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200 px-8 text-center text-xs text-zinc-500 dark:from-zinc-900 dark:to-zinc-800">
          Instagram needs a picture or video
        </div>
      )}
      {/* Like, comment, share, save, with the carousel dots between them as in the app. */}
      <div className="relative flex items-center gap-4 px-3 pt-3">
        <Heart className="h-6 w-6" strokeWidth={1.8} />
        <MessageCircle className="h-6 w-6 -scale-x-100" strokeWidth={1.8} />
        <Send className="h-6 w-6" strokeWidth={1.8} />
        {carousel && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 translate-y-[-25%] gap-1">
            {media.images.slice(0, 20).map((_, i) => (
              <span key={i} className={cn("h-1.5 w-1.5 rounded-full transition-colors", i === slide ? "bg-[#0095f6]" : "bg-zinc-300 dark:bg-zinc-600")} />
            ))}
          </div>
        )}
        <Bookmark className="ml-auto h-6 w-6" strokeWidth={1.8} />
      </div>
      <div className="px-3 pb-3 pt-2 leading-snug">
        <div className="font-semibold">Be the first to like this</div>
        <div className="mt-1">
          <FoldedText text={caption} fold={ruleFor("instagram").fold} moreLabel="… more" prefix={<span className="mr-1 font-semibold">{handle}</span>} />
        </div>
        {firstComment?.trim() && (
          <p className="mt-1 whitespace-pre-wrap break-words">
            <span className="mr-1 font-semibold">{handle}</span>
            {firstComment}
          </p>
        )}
        <div className="mt-1.5 text-[10px] uppercase tracking-wide text-zinc-500">Just now</div>
      </div>
    </div>
  );
}

function FacebookPreview({ caption, media, accountName, avatarUrl }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-[14px] text-[#050505] shadow-sm dark:bg-zinc-900 dark:text-zinc-100">
      <div className="flex items-center gap-2 p-3 pb-2">
        <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="facebook" size={40} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-semibold">{accountName}</div>
          <div className="text-[12px] text-zinc-500">Just now · <Globe className="inline h-3 w-3" /></div>
        </div>
        <MoreHorizontal className="h-5 w-5 text-zinc-500" />
      </div>
      <FoldedText text={caption} fold={ruleFor("facebook").fold} moreLabel="… See more" className="px-3 pb-2 leading-snug" />
      <MediaGrid media={media} />
      <div className="mx-3 flex justify-around border-t py-1.5 text-[13px] font-semibold text-zinc-500">
        <span className="flex items-center gap-1.5"><ThumbsUp className="h-4 w-4" />Like</span>
        <span className="flex items-center gap-1.5"><MessageCircle className="h-4 w-4" />Comment</span>
        <span className="flex items-center gap-1.5"><Share2 className="h-4 w-4" />Share</span>
      </div>
    </div>
  );
}

function TikTokPreview({ caption, media, accountName, avatarUrl, handle }: PreviewProps) {
  const poster = media.images[0];
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-2xl bg-black text-white shadow-lg">
      {media.video ? (
        <video src={media.video} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      ) : media.images.length > 1 ? (
        <div className="absolute inset-0">
          <Carousel images={media.images} className="h-full" dots={false} arrowsAt="top-[22%]" />
        </div>
      ) : poster ? (
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center text-xs text-white/60">TikTok needs a video or pictures</div>
      )}
      <div className="absolute bottom-24 right-2 flex flex-col items-center gap-4">
        <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform="tiktok" size={36} />
        <Heart className="h-7 w-7 fill-white/90" /><MessageCircle className="h-7 w-7" /><Bookmark className="h-7 w-7" /><Share2 className="h-7 w-7" />
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pr-14 text-[12px] leading-snug">
        <div className="font-semibold">@{toHandle(handle, accountName)}</div>
        <FoldedText text={caption} fold={ruleFor("tiktok").fold} moreLabel=" more" className="mt-0.5" />
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-white/80"><Music2 className="h-3 w-3" />original sound</div>
      </div>
    </div>
  );
}

function GenericPreview({ platform, caption, media, accountName, avatarUrl }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card text-sm shadow-sm">
      <div className="flex items-center gap-2 p-3">
        <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform={platform} size={36} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{accountName}</div>
          <div className="text-xs text-muted-foreground">{ruleFor(platform).label}</div>
        </div>
      </div>
      <MediaGrid media={media} />
      <FoldedText text={caption} fold={ruleFor(platform).fold} className="p-3 leading-snug" />
    </div>
  );
}

/** Instagram / Facebook Story: full-screen 9:16, no caption. */
function StoryPreview({ platform, media, accountName, avatarUrl }: PreviewProps) {
  const poster = media.images[0];
  return (
    <div className="relative mx-auto aspect-[9/16] w-full max-w-[260px] overflow-hidden rounded-2xl bg-black text-white shadow-lg">
      {media.video ? (
        <video src={media.video} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      ) : poster ? (
        <img src={poster} alt="" className="h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-x-2 top-2 h-0.5 rounded-full bg-white/40"><div className="h-full w-1/3 rounded-full bg-white" /></div>
      <div className="absolute left-3 top-4 flex items-center gap-2 text-[12px] font-semibold">
        <AccountAvatar name={accountName} avatarUrl={avatarUrl} platform={platform} size={28} />
        {accountName} <span className="font-normal text-white/70">now</span>
      </div>
      <div className="absolute inset-x-3 bottom-3 rounded-full border border-white/60 px-3 py-1.5 text-[12px] text-white/80">Send message</div>
    </div>
  );
}

export function PostPreview(props: PreviewProps) {
  if (props.format === "story" && supportsStory(props.platform) && (props.media.images.length || props.media.video)) {
    return <StoryPreview {...props} />;
  }
  switch (normPlatform(props.platform)) {
    case "linkedin":
      return <LinkedInPreview {...props} />;
    case "twitter":
      return <XPreview {...props} />;
    case "instagram":
    case "threads":
      return <InstagramPreview {...props} />;
    case "facebook":
      return <FacebookPreview {...props} />;
    case "tiktok":
      return <TikTokPreview {...props} />;
    default:
      return <GenericPreview {...props} />;
  }
}
