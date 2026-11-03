import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Download, ImagePlus, Loader2, Pencil, Upload, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { downloadImage, type Piece } from "@/lib/piece";

export interface PieceAuthor {
  name: string;
  avatarUrl?: string | null;
}

interface PiecePreviewProps {
  piece: Piece;
  author: PieceAuthor;
  editable: boolean;
  savingText: boolean;
  onSaveText: (text: string) => Promise<unknown>;
  imageBusy: boolean;
  onNewImage: (instructions?: string) => void;
  onReplaceImage: (file: File) => void;
}

const LINKEDIN_LIMIT = 3000;

// ─── Editable text ──────────────────────────────────────────────────────────

function EditableText({
  piece,
  editable,
  saving,
  onSave,
  render,
  className,
}: {
  piece: Piece;
  editable: boolean;
  saving: boolean;
  onSave: (text: string) => Promise<unknown>;
  render: (text: string) => React.ReactNode;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(piece.text);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setValue(piece.text);
  }, [piece.text, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight + 4}px`;
    }
  }, [editing]);

  if (editing) {
    const over = piece.kind === "post" && value.length > LINKEDIN_LIMIT;
    return (
      <div className={cn("space-y-2", className)}>
        <Textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight + 4}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSave(value).then(() => setEditing(false));
            }
          }}
          className="min-h-[160px] resize-none text-[14px] leading-relaxed"
          aria-label="Edit text"
        />
        <div className="flex items-center gap-2">
          <span className={cn("mr-auto text-xs tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
            {value.length.toLocaleString()} characters{piece.kind === "post" ? ` · LinkedIn allows ${LINKEDIN_LIMIT.toLocaleString()}` : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="cta" size="sm" onClick={() => onSave(value).then(() => setEditing(false))} disabled={saving || value === piece.text}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group/text relative", className)}>
      {render(piece.text)}
      {editable && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          className="absolute -top-1 right-0 h-7 gap-1 bg-background/95 px-2 text-xs opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover/text:opacity-100"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </Button>
      )}
    </div>
  );
}

// ─── Image with actions ─────────────────────────────────────────────────────

function ImageActions({
  piece,
  url,
  busy,
  onNewImage,
  onReplaceImage,
}: {
  piece: Piece;
  url: string | null;
  busy: boolean;
  onNewImage: (instructions?: string) => void;
  onReplaceImage: (file: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const canDraw = piece.kind !== "carousel";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canDraw && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs shadow-sm" disabled={busy}>
              <Wand2 className="h-3.5 w-3.5" />
              New image
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-2.5">
            <div className="text-sm font-medium">Draw a new image</div>
            <Input
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Optional: what to change (warmer light, no text…)"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onNewImage(instructions.trim() || undefined);
                  setOpen(false);
                  setInstructions("");
                }
              }}
            />
            <p className="text-xs text-muted-foreground">Uses the same description and references as this run. Costs one image.</p>
            <div className="flex justify-end">
              <Button
                variant="cta"
                size="sm"
                onClick={() => {
                  onNewImage(instructions.trim() || undefined);
                  setOpen(false);
                  setInstructions("");
                }}
              >
                Draw it
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
      <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs shadow-sm" onClick={() => fileRef.current?.click()} disabled={busy}>
        <Upload className="h-3.5 w-3.5" />
        {url ? "Replace" : "Upload"}
      </Button>
      {url && (
        <Button variant="secondary" size="sm" className="h-8 gap-1.5 text-xs shadow-sm" onClick={() => downloadImage(piece, url)}>
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onReplaceImage(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function PieceImage({
  piece,
  busy,
  editable,
  onNewImage,
  onReplaceImage,
  className,
}: {
  piece: Piece;
  busy: boolean;
  editable: boolean;
  onNewImage: (instructions?: string) => void;
  onReplaceImage: (file: File) => void;
  className?: string;
}) {
  const drawing = busy || piece.steps.some((s) => s.id === "image" && s.status === "active");
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [piece.image]);

  if (drawing) {
    return (
      <div className={cn("grid aspect-square w-full place-items-center bg-muted/60", className)}>
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Drawing the image…
        </div>
      </div>
    );
  }

  if (!piece.image || broken) {
    return (
      <div className={cn("grid aspect-[4/3] w-full place-items-center border-t border-dashed bg-muted/30", className)}>
        <div className="flex flex-col items-center gap-3 px-6 text-center text-sm text-muted-foreground">
          <ImagePlus className="h-6 w-6" />
          {broken ? "This image couldn't be loaded." : "No image yet."}
          {editable && <ImageActions piece={piece} url={null} busy={busy} onNewImage={onNewImage} onReplaceImage={onReplaceImage} />}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group/img relative bg-muted/40", className)}>
      <img src={piece.image} alt="" className="block max-h-[640px] w-full object-contain" onError={() => setBroken(true)} />
      {editable && (
        <div className="absolute left-3 top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover/img:opacity-100">
          <ImageActions piece={piece} url={piece.image} busy={busy} onNewImage={onNewImage} onReplaceImage={onReplaceImage} />
        </div>
      )}
    </div>
  );
}

// ─── Frames ─────────────────────────────────────────────────────────────────

function Avatar({ author }: { author: PieceAuthor }) {
  if (author.avatarUrl) return <img src={author.avatarUrl} alt="" className="h-10 w-10 rounded-full border object-cover" />;
  return (
    <div className="grid h-10 w-10 place-items-center rounded-full bg-foreground text-xs font-bold text-background">
      {author.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function TextSkeleton() {
  return (
    <div className="space-y-2.5 py-1" aria-label="Writing">
      {[92, 100, 84, 96, 60].map((w, i) => (
        <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

const postText = (text: string) => <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{text}</div>;

export function PiecePreview(props: PiecePreviewProps) {
  const { piece, author, editable, savingText, onSaveText, imageBusy, onNewImage, onReplaceImage } = props;
  const writing = !piece.text && (piece.state === "generating" || piece.steps[0]?.status === "active");

  if (piece.kind === "article") {
    return (
      <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {(piece.image || editable) && (
          <PieceImage piece={piece} busy={imageBusy} editable={editable} onNewImage={onNewImage} onReplaceImage={onReplaceImage} className="max-h-80 overflow-hidden" />
        )}
        <div className="px-6 pb-8 pt-6 sm:px-10">
          <h1 className="mb-5 text-2xl font-bold leading-tight tracking-tight">{piece.title}</h1>
          {writing ? (
            <TextSkeleton />
          ) : (
            <EditableText
              piece={piece}
              editable={editable}
              saving={savingText}
              onSave={onSaveText}
              render={(t) => (
                <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:tracking-tight">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{t}</ReactMarkdown>
                </div>
              )}
            />
          )}
        </div>
      </article>
    );
  }

  if (piece.kind === "thread") {
    const renderThread = () => (
      <ol className="space-y-2.5">
        {piece.tweets.map((t, i) => (
          <li key={i} className="rounded-xl border bg-card px-4 py-3">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{author.name}</span>
              <span>
                {i + 1}/{piece.tweets.length}
              </span>
              <span className={cn("ml-auto tabular-nums", t.length > 280 && "font-medium text-destructive")}>
                {t.length}/280
              </span>
            </div>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{t}</p>
          </li>
        ))}
      </ol>
    );
    return (
      <div className="space-y-2">
        {writing ? (
          <div className="rounded-xl border bg-card p-4">
            <TextSkeleton />
          </div>
        ) : !piece.text && piece.state === "failed" ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">Nothing was written: this thread failed before the text was ready.</p>
        ) : (
          <EditableText piece={piece} editable={editable} saving={savingText} onSave={onSaveText} render={renderThread} />
        )}
        {editable && piece.tweets.length > 0 && (
          <p className="text-xs text-muted-foreground">When editing, keep each post numbered (1/, 2/…) or separated by a blank line.</p>
        )}
      </div>
    );
  }

  if (piece.kind === "image") {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <PieceImage piece={piece} busy={imageBusy} editable={editable} onNewImage={onNewImage} onReplaceImage={onReplaceImage} />
        {piece.imagePrompt && <p className="border-t px-4 py-3 text-xs leading-relaxed text-muted-foreground">{piece.imagePrompt}</p>}
      </div>
    );
  }

  // post / carousel: a social post card
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-3 px-5 pb-2 pt-4">
        <Avatar author={author} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{author.name}</div>
          <div className="text-xs text-muted-foreground">Preview</div>
        </div>
      </div>
      <div className="px-5 pb-4 pt-1">
        {writing ? (
          <TextSkeleton />
        ) : !piece.text && piece.state === "failed" ? (
          <p className="py-6 text-sm text-muted-foreground">Nothing was written: this piece failed before the text was ready.</p>
        ) : (
          <EditableText piece={piece} editable={editable} saving={savingText} onSave={onSaveText} render={postText} />
        )}
      </div>
      {piece.kind === "post" && (piece.image || imageBusy || piece.steps.find((s) => s.id === "image")?.status !== "todo") && (
        <PieceImage piece={piece} busy={imageBusy} editable={editable} onNewImage={onNewImage} onReplaceImage={onReplaceImage} className="border-t" />
      )}
      {piece.kind === "carousel" && (
        <div className="flex snap-x gap-2 overflow-x-auto border-t bg-muted/30 p-3">
          {piece.slides.length === 0 && <div className="px-2 py-8 text-sm text-muted-foreground">Slides appear here once they're designed.</div>}
          {piece.slides.map((s, i) => (
            <figure key={i} className="w-60 shrink-0 snap-start overflow-hidden rounded-lg border bg-card">
              {s.url ? (
                // Natural size: templates render square or 4:5, and a fixed frame cropped the text.
                <img src={s.url} alt={s.text || `Slide ${i + 1}`} className="block h-auto w-full" />
              ) : (
                <div className={cn("grid aspect-square place-items-center p-4 text-center text-xs", s.failed ? "text-destructive" : "text-muted-foreground")}>
                  {s.failed ? "This slide failed" : s.text || "Designing…"}
                </div>
              )}
              <figcaption className="border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">Slide {i + 1}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
