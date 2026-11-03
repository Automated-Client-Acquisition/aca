import { useMemo, useState } from "react";
import { ImageIcon, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePromptTemplates } from "@/hooks/usePromptTemplates";
import type { PromptTemplate } from "@/hooks/usePromptLibrary";
import { cn } from "@/lib/utils";
import { FieldLabel } from "./StudioSection";
import { recompile, type StudioDraft } from "./draft";

interface ImageTemplateChooserProps {
  draft: StudioDraft;
  onChange: (draft: StudioDraft) => void;
}

const FEATURED_COUNT = 6;

/** "Infographic: Swiss Style / Typography / Color #165" -> "Swiss Style / Typography / Color #165" */
const shortName = (name: string) => name.replace(/^Infographic:\s*/, "");

/** Quality score (out of 50) recorded in the description of imported styles. */
const scoreOf = (t: PromptTemplate): number => Number(/scored (\d+)\/50/.exec(t.description ?? "")?.[1] ?? 0);

/** Hand-made templates have no "#number" in their name; they come first. */
const isCurated = (t: PromptTemplate) => !/#\d+$/.test(t.name);

function TemplateCard({ t, selected, onPick }: { t: PromptTemplate; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      title={t.description ?? t.name}
      className={cn(
        "overflow-hidden rounded-lg border text-left transition-colors",
        selected ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/40",
      )}
    >
      {t.preview_url ? (
        <img src={t.preview_url} alt={`${shortName(t.name)} preview`} loading="lazy" className="aspect-square w-full bg-muted object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-muted text-muted-foreground">
          <ImageIcon className="h-6 w-6" aria-hidden />
        </div>
      )}
      <div className="line-clamp-2 px-2 py-1.5 text-[11px] font-medium leading-tight">{shortName(t.name)}</div>
    </button>
  );
}

/**
 * Pick a ready-made image prompt from the prompt library, with a preview of what it makes.
 * The template is copied into the blueprint's image prompt and filled per idea at run time
 * (topic, hook, talking points, avoid list, call to action).
 */
export function ImageTemplateChooser({ draft, onChange }: ImageTemplateChooserProps) {
  const { data: templates = [] } = usePromptTemplates({ promptType: "image", pipelineType: "social_media_post" });
  const [browseOpen, setBrowseOpen] = useState(false);
  const [search, setSearch] = useState("");
  const mc = draft.model_config;
  const chosenId = mc.image_template_id as string | undefined;

  // Templates you can see first (our hand-made ones, then the best scored), then those without a preview.
  const sorted = useMemo(
    () =>
      [...templates].sort(
        (a, b) =>
          Number(!!b.preview_url) - Number(!!a.preview_url) ||
          Number(isCurated(b)) - Number(isCurated(a)) ||
          scoreOf(b) - scoreOf(a) ||
          a.name.localeCompare(b.name),
      ),
    [templates],
  );

  const featured = useMemo(() => {
    const top = sorted.slice(0, FEATURED_COUNT);
    const chosen = chosenId ? sorted.find((t) => t.id === chosenId) : undefined;
    return chosen && !top.some((t) => t.id === chosen.id) ? [chosen, ...top.slice(0, FEATURED_COUNT - 1)] : top;
  }, [sorted, chosenId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sorted.filter((t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)) : sorted;
  }, [sorted, search]);

  if (sorted.length === 0) return null;

  const pick = (t: PromptTemplate) => {
    onChange(
      recompile({
        ...draft,
        image_prompt: t.prompt_content,
        model_config: { ...mc, image_template_id: t.id, image_template_name: t.name },
      }),
    );
    setBrowseOpen(false);
  };

  const clear = () => {
    const { image_template_id, image_template_name, ...rest } = mc;
    onChange(recompile({ ...draft, model_config: rest }));
  };

  return (
    <div>
      <FieldLabel hint="A ready-made image prompt. It is filled with each idea's hook, talking points and call to action, so the picture matches the post.">
        Image template
      </FieldLabel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {featured.map((t) => (
          <TemplateCard key={t.id} t={t} selected={chosenId === t.id} onPick={() => (chosenId === t.id ? clear() : pick(t))} />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <button type="button" onClick={() => setBrowseOpen(true)} className="font-medium text-foreground underline underline-offset-2">
          Browse all {sorted.length} templates
        </button>
        {chosenId && (
          <span className="flex items-center gap-3">
            <span>This template sets the look, so Looks are hidden.</span>
            <button type="button" onClick={clear} className="font-medium text-foreground underline underline-offset-2">
              Remove template
            </button>
          </span>
        )}
      </div>

      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 space-y-2 px-6 pb-4 pt-6">
            <DialogTitle>Image templates</DialogTitle>
            <DialogDescription>
              {sorted.length} ready-made styles, best scored first. Pick one to use it for this blueprint.
            </DialogDescription>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search styles, e.g. blueprint, minimal, neon"
                aria-label="Search image templates"
                className="pl-9"
              />
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No template matches "{search}".</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {filtered.map((t) => (
                  <TemplateCard key={t.id} t={t} selected={chosenId === t.id} onPick={() => pick(t)} />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
