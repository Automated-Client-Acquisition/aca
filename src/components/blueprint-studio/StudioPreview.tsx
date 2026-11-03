import { useEffect, useMemo, useState } from "react";
import { splitThreadText } from "@/lib/thread-text";
import { Link } from "react-router-dom";
import { FlaskConical, Loader2, RefreshCw, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIdeas } from "@/hooks/useIdeas";
import { useBrandKit } from "@/hooks/useBrandKit";
import { getImageReferences, resolveReferencesForRun, type ResolvedRunReference } from "@/lib/image-references";
import { CAROUSEL_TEMPLATES, resolveCarouselTemplateId } from "@/data/carouselTemplates";
import type { BlueprintFormat } from "@/lib/blueprint-brief";
import { effectiveLooks, lookMode, nextLook } from "@/lib/image-looks";
import { cn } from "@/lib/utils";
import { Segmented } from "./StudioSection";
import { draftFormat, type StudioDraft } from "./draft";

interface PreviewResult {
  text: string | null;
  resolved_prompt: string;
  used: Record<string, string>;
  model: string | null;
}

function snapshot(draft: StudioDraft): string {
  return JSON.stringify([draft.pipeline, draft.master_prompt, draft.image_prompt, draft.context]);
}

// ─── Output frames ─────────────────────────────────────────────────────────

function splitBlocks(text: string): string[] {
  return text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

function splitSlides(text: string): string[] {
  const bySlide = text.split(/\n?(?=^\s*(?:\*\*|#+\s*)?(?:slide|cover)\s*\d*\b)/gim).map((s) => s.trim()).filter(Boolean);
  return bySlide.length > 1 ? bySlide : splitBlocks(text);
}

// Same split the backend uses when it stores the thread (lib/thread-text).
const splitThread = splitThreadText;

function stripMd(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "");
}

function PostFrame({ text, name, draft, refs }: { text: string; name: string; draft: StudioDraft; refs: ResolvedRunReference[] }) {
  const looks = effectiveLooks(draft.model_config);
  const first = nextLook(draft.model_config, []);
  const lookLabel = !first ? "Image" : looks.length > 1 && lookMode(draft.model_config) === "rotate" ? `${first.label} (then the next look)` : first.label;
  const shape = draft.model_config.output_config_defaults?.aspectRatio ?? "square";
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2.5 px-3.5 pb-1.5 pt-3">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-foreground text-[11px] font-bold text-background">
          {name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="text-[13px] font-semibold leading-tight">{name}</div>
          <div className="text-[11px] text-muted-foreground">now</div>
        </div>
      </div>
      <div className="whitespace-pre-wrap px-3.5 pb-3 text-[13px] leading-relaxed">{stripMd(text)}</div>
      {!draft.skip_image_generation && (
        <div
          className={cn(
            "grid place-items-center border-t bg-muted/60 text-center text-xs text-muted-foreground",
            shape === "landscape" ? "aspect-video" : shape === "portrait" ? "aspect-[9/12]" : "aspect-square max-h-72 w-full",
          )}
        >
          <span className="flex flex-col items-center gap-1.5 px-6">
            <ImageIcon className="h-5 w-5" />
            {lookLabel}, drawn when the blueprint runs
            {refs.some((r) => r.images.length > 0) && (
              <span className="mt-1 flex flex-wrap justify-center gap-2">
                {refs.filter((r) => r.images.length > 0).map((r) => (
                  <span key={r.id} className="flex items-center gap-1 rounded-full bg-background/80 py-0.5 pl-0.5 pr-2 text-[10px]">
                    <img src={r.images[0]} alt="" className="h-5 w-5 rounded-full object-cover" />
                    {r.role === "style" ? "look" : r.role === "remake" ? "recreate" : r.label}
                  </span>
                ))}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function CarouselFrame({ text, draft }: { text: string; draft: StudioDraft }) {
  const template = CAROUSEL_TEMPLATES.find((t) => t.id === resolveCarouselTemplateId(draft.model_config.carousel_template));
  const slides = splitSlides(text);
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {slides.map((s, i) => {
        const cover = i === 0;
        const bg = draft.pipeline === "instagram_carousel" && template ? (cover ? template.preview.coverBg : template.preview.contentBg) : undefined;
        const color = draft.pipeline === "instagram_carousel" && template ? (cover ? template.preview.coverText : template.preview.contentText) : undefined;
        return (
          <div
            key={i}
            className="flex aspect-[4/5] w-44 shrink-0 flex-col justify-between rounded-lg border bg-card p-3 shadow-sm"
            style={{ background: bg, color }}
          >
            <span className="font-mono text-[10px] opacity-70">
              {i + 1}/{slides.length}
            </span>
            <p className="line-clamp-[9] whitespace-pre-wrap text-[12px] font-medium leading-snug">{stripMd(s).replace(/^(slide|cover)\s*\d*[:.\s-]*/i, "")}</p>
          </div>
        );
      })}
    </div>
  );
}

function ArticleFrame({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 rounded-xl border bg-card p-4 text-[13px] leading-relaxed">
      {text.split("\n").filter((l) => l.trim()).map((line, i) =>
        /^#{1,3}\s/.test(line) ? (
          <h4 key={i} className={cn("font-bold", i === 0 ? "text-lg leading-tight" : "pt-1 text-sm")}>
            {line.replace(/^#+\s*/, "")}
          </h4>
        ) : (
          <p key={i}>{stripMd(line)}</p>
        ),
      )}
    </div>
  );
}

function ThreadFrame({ text, name }: { text: string; name: string }) {
  return (
    <div className="space-y-2">
      {splitThread(text).map((t, i) => (
        <div key={i} className="rounded-xl border bg-card px-3.5 py-2.5">
          {i === 0 && <div className="mb-1 text-[13px] font-semibold">{name}</div>}
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{stripMd(t)}</p>
        </div>
      ))}
    </div>
  );
}

function VideoFrame({ text, draft }: { text: string; draft: StudioDraft }) {
  const sentences = stripMd(text).split(/(?<=[.!?])\s+/).filter(Boolean);
  const beats = sentences.slice(0, 4);
  const landscape = draft.model_config.video_config_defaults?.orientation === "landscape";
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-2">
        {beats.map((s, i) => (
          <div
            key={i}
            className={cn("relative flex shrink-0 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-zinc-700 to-zinc-900 p-2", landscape ? "aspect-video w-56" : "aspect-[9/16] w-28")}
          >
            <span className="rounded bg-amber-300 px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-tight text-black">
              {s.split(" ").slice(0, 6).join(" ")}
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-3.5 text-[13px] leading-relaxed">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Voiceover</div>
        <p className="whitespace-pre-wrap">{stripMd(text)}</p>
      </div>
    </div>
  );
}

function OutputFrame({ format, text, draft, name, refs }: { format: BlueprintFormat; text: string; draft: StudioDraft; name: string; refs: ResolvedRunReference[] }) {
  switch (format) {
    case "post":
      return <PostFrame text={text} name={name} draft={draft} refs={refs} />;
    case "carousel":
      return <CarouselFrame text={text} draft={draft} />;
    case "article":
      return <ArticleFrame text={text} />;
    case "thread":
      return <ThreadFrame text={text} name={name} />;
    case "video":
      return <VideoFrame text={text} draft={draft} />;
    default:
      return null;
  }
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export function StudioPreview({ draft }: { draft: StudioDraft }) {
  const { currentOrganization } = useAuth();
  const { ideas } = useIdeas();
  const format = draftFormat(draft);
  const [topic, setTopic] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [testedSnapshot, setTestedSnapshot] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"output" | "prompt">("output");

  useEffect(() => {
    if (!topic && ideas.length > 0) setTopic(ideas[0].title);
  }, [ideas, topic]);

  const stale = useMemo(() => !!result && testedSnapshot !== snapshot(draft), [result, testedSnapshot, draft]);
  const brandKit = useBrandKit();
  const refs = resolveReferencesForRun(getImageReferences(draft.model_config), {
    product: (brandKit.resolve("product", draft.context?.product?.element_id)?.element as Record<string, any>) ?? null,
    person: (brandKit.resolve("person", draft.context?.person?.element_id)?.element as Record<string, any>) ?? null,
  });
  const name = result?.used.person || result?.used.brand || currentOrganization?.name || "Your brand";

  const runTest = async (nextTopic?: string) => {
    const t = (nextTopic ?? topic).trim();
    if (!t || !currentOrganization) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("preview-blueprint", {
        body: {
          organization_id: currentOrganization.id,
          pipeline: draft.pipeline,
          master_prompt: draft.master_prompt,
          image_prompt: draft.image_prompt,
          context: draft.context,
          topic: t,
          text_model: draft.model_config.text_llm?.model_id,
        },
      });
      if (fnError) throw fnError;
      if (!data?.success) {
        setError({ message: data?.error ?? "The preview failed.", code: data?.code });
        return;
      }
      setResult(data as PreviewResult);
      setTestedSnapshot(snapshot(draft));
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "The preview failed." });
    } finally {
      setLoading(false);
    }
  };

  const otherIdea = () => {
    if (ideas.length === 0) return;
    const pool = ideas.slice(0, 30).filter((i) => i.title !== topic);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      setTopic(pick.title);
      runTest(pick.title);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Preview</h2>
        <Segmented<"output" | "prompt">
          size="sm"
          ariaLabel="Preview view"
          options={[
            { id: "output", label: format === "image" ? "Image prompt" : "The piece" },
            { id: "prompt", label: "What the AI got" },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          runTest();
        }}
      >
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="A topic to test, e.g. Why we stopped cold calling" aria-label="Test topic" />
        <Button type="submit" variant="outline" disabled={loading || !topic.trim() || !draft.pipeline}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
          <span className="ml-1.5">Test</span>
        </Button>
      </form>
      {ideas.length > 1 && (
        <button type="button" onClick={otherIdea} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" disabled={loading}>
          <RefreshCw className="h-3 w-3" />
          Try another idea from your list
        </button>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2.5 text-xs text-red-800 dark:text-red-300">
          {error.message}{" "}
          {error.code === "MISSING_API_KEY" && (
            <Link to="/settings?tab=integrations" className="font-semibold underline underline-offset-2">
              Open Settings
            </Link>
          )}
        </div>
      )}

      {stale && !loading && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          The blueprint changed since this preview.
          <button type="button" className="font-semibold underline underline-offset-2" onClick={() => runTest()}>
            Test again
          </button>
        </div>
      )}

      {result && Object.keys(result.used).length > 0 && (
        <p className="text-xs text-muted-foreground">
          Written with{" "}
          {Object.entries(result.used)
            .map(([k, v]) => `${v} (${k})`)
            .join(" · ")}
        </p>
      )}

      <div className={cn("transition-opacity", loading && "opacity-50")}>
        {!result ? (
          <div className="rounded-xl border border-dashed bg-background/60 p-6 text-center text-sm text-muted-foreground">
            {draft.pipeline ? "Type a topic and press Test to see what this blueprint writes." : "Pick a format first."}
          </div>
        ) : view === "prompt" || format === "image" || !format || !result.text ? (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl border bg-card p-3.5 font-mono text-[11.5px] leading-relaxed">
            {result.resolved_prompt}
          </pre>
        ) : (
          <OutputFrame format={format} text={result.text} draft={draft} name={name} refs={refs} />
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Previews write text with a fast model and skip AI angles and images. Real runs use your Quality setting.
      </p>
    </div>
  );
}
