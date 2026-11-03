import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Play, LayoutTemplate, Wand2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutosaveBlueprint, useBlueprints, useCreateBlueprint } from "@/hooks/useBlueprints";
import { useBrandKit } from "@/hooks/useBrandKit";
import { useBlueprintRunStats, useHealthEnvironment } from "@/hooks/useBlueprintHealth";
import { EditBlueprintDialog } from "@/components/blueprints/EditBlueprintDialog";
import { BlueprintStarterPackDialog } from "@/components/blueprints/BlueprintStarterPackDialog";
import { BlueprintHealthPill } from "@/components/blueprints/BlueprintHealthPill";
import { ImportPostDialog } from "@/components/ideas/ImportPostDialog";
import { StudioSection } from "@/components/blueprint-studio/StudioSection";
import { FormatSection, FormatTiles } from "@/components/blueprint-studio/FormatSection";
import { BriefSection } from "@/components/blueprint-studio/BriefSection";
import { ContextSection, contextSummary, kindsInPrompt } from "@/components/blueprint-studio/ContextSection";
import { LookSection, hasLook, lookSummary } from "@/components/blueprint-studio/LookSection";
import { AdvancedSection, qualitySummary } from "@/components/blueprint-studio/AdvancedSection";
import { StudioPreview } from "@/components/blueprint-studio/StudioPreview";
import {
  draftFormat,
  draftFromBlueprint,
  draftToUpdate,
  isGuided,
  newDraft,
  type StudioDraft,
} from "@/components/blueprint-studio/draft";
import { FORMATS, OPENINGS, detectQualityTier, type BlueprintFormat } from "@/lib/blueprint-brief";
import { evaluateBlueprintHealth } from "@/lib/blueprint-health";
import { runPath } from "@/lib/blueprint-routes";
import { AutomateMenu } from "@/components/autopilot/AutomateMenu";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import { cn } from "@/lib/utils";
import type { Blueprint } from "@/types/blueprint";

type SaveState = "saved" | "dirty" | "saving";
type SectionId = "format" | "brief" | "context" | "look" | "advanced";

function formatSummary(draft: StudioDraft): string {
  const f = draftFormat(draft);
  if (!f) return draft.pipeline ? "Classic format" : "Not chosen";
  const platform = FORMATS[f].platforms.find((p) => p.id === draft.brief?.platform)?.label;
  const extra = f === "post" ? (draft.skip_image_generation ? "text only" : "with image") : f === "carousel" && draft.pipeline === "instagram_carousel_ai" ? "AI images" : "";
  return [FORMATS[f].label, platform, extra].filter(Boolean).join(" · ");
}

function briefSummary(draft: StudioDraft): string {
  if (!isGuided(draft)) return "Hand-written prompt";
  const b = draft.brief!;
  const f = draftFormat(draft)!;
  if (f === "image") return b.notes.trim() ? b.notes.trim().slice(0, 60) : "Describe the picture";
  const opening = OPENINGS.find((o) => o.id === b.opening)?.label;
  return [opening, `${b.shape.length} parts`, FORMATS[f].lengths[b.length]].filter(Boolean).join(" · ");
}

/** A draft shaped like a Blueprint, for the shared health rules. */
function asBlueprint(id: string, draft: StudioDraft): Blueprint {
  return {
    id,
    pipeline: draft.pipeline ?? undefined,
    master_prompt: draft.master_prompt,
    image_prompt: draft.image_prompt,
    director_prompt: draft.director_prompt,
    reference_image_libraries: draft.reference_image_libraries,
    model_config: draft.model_config as any,
    context: draft.context,
    skip_image_generation: draft.skip_image_generation,
  } as Blueprint;
}

export default function BlueprintStudio() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: blueprints, isLoading } = useBlueprints();
  const blueprint = id ? blueprints?.find((b) => b.id === id) : undefined;
  const brandKit = useBrandKit();
  const createBlueprint = useCreateBlueprint();
  const autosave = useAutosaveBlueprint();

  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const pendingRef = useRef<StudioDraft | null>(null);
  const loadedRef = useRef<string | null>(null);
  const reloadAfterClassicRef = useRef<string | null>(null);

  const [open, setOpen] = useState<Record<SectionId, boolean>>({ format: false, brief: true, context: true, look: false, advanced: false });
  const [customModels, setCustomModels] = useState(false);
  const [classicOpen, setClassicOpen] = useState(false);
  const [fromPostOpen, setFromPostOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  // Load the blueprint into a local draft once (and again after the classic editor saves).
  useEffect(() => {
    if (!blueprint) return;
    const reload = reloadAfterClassicRef.current && reloadAfterClassicRef.current !== blueprint.updated_at;
    if (loadedRef.current === blueprint.id && !reload) return;
    loadedRef.current = blueprint.id;
    reloadAfterClassicRef.current = null;
    const d = draftFromBlueprint(blueprint);
    setDraft(d);
    setCustomModels(detectQualityTier(d.model_config) === "custom");
    setOpen((o) => ({ ...o, format: !d.pipeline, look: false }));
  }, [blueprint]);

  const update = useCallback((next: StudioDraft) => {
    setDraft(next);
    pendingRef.current = next;
    setSaveState("dirty");
  }, []);

  const save = useCallback(async () => {
    const d = pendingRef.current;
    if (!id || !d) return;
    setSaveState("saving");
    try {
      await autosave.mutateAsync(draftToUpdate(id, d));
      setSaveState(pendingRef.current === d ? "saved" : "dirty");
      if (pendingRef.current === d) pendingRef.current = null;
    } catch {
      setSaveState("dirty");
    }
  }, [id, autosave]);

  // Autosave 800ms after the last change.
  useEffect(() => {
    if (saveState !== "dirty") return;
    const t = setTimeout(save, 800);
    return () => clearTimeout(t);
  }, [draft, saveState, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (saveState === "saved") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  const flushAndGo = async (path: string) => {
    if (pendingRef.current) await save();
    navigate(path);
  };

  const counts = {
    brand: brandKit.lists.brand.length,
    audience: brandKit.lists.audience.length,
    product: brandKit.lists.product.length,
    person: brandKit.lists.person.length,
  };

  const createFromFormat = async (format: BlueprintFormat) => {
    const d = newDraft(format, counts);
    const slots = parseAllPromptSlots(d.master_prompt, d.image_prompt || undefined, d.director_prompt || undefined);
    const created = await createBlueprint.mutateAsync({
      name: d.name,
      description: d.description,
      pipeline: d.pipeline!,
      master_prompt: d.master_prompt,
      image_prompt: d.image_prompt,
      director_prompt: d.director_prompt,
      skip_image_generation: d.skip_image_generation,
      structure: { slots },
      model_config: d.model_config as any,
      reference_image_libraries: d.reference_image_libraries,
      brief: d.brief,
      context: d.context,
      tags: [],
    });
    navigate(`/blueprints/${created.id}`, { replace: true });
  };

  // Health of the draft, with the same rules as the Blueprints list.
  const draftAsBlueprint = useMemo(() => (id && draft ? [asBlueprint(id, draft)] : []), [id, draft]);
  const { env, isLoading: envLoading } = useHealthEnvironment(draftAsBlueprint);
  const { data: stats } = useBlueprintRunStats();
  const health = useMemo(
    () => (id && draft && !envLoading ? evaluateBlueprintHealth(draftAsBlueprint[0], env, stats?.get(id)) : null),
    [id, draft, env, envLoading, stats, draftAsBlueprint],
  );
  const blocked = !!health?.issues.some((i) => i.severity === "blocker");

  // ─── New blueprint: pick a format first ───────────────────────────────────
  if (!id) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-6 lg:p-10">
          <Link to="/blueprints" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Blueprints
          </Link>
          <div>
            <h1 className="text-2xl font-bold">What should this blueprint make?</h1>
            <p className="text-muted-foreground">You can change this later. Everything else has sensible defaults.</p>
          </div>
          <div className={createBlueprint.isPending ? "pointer-events-none opacity-60" : ""}>
            <FormatTiles value={null} onPick={createFromFormat} />
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-5">
            <Button variant="outline" onClick={() => setTemplatesOpen(true)}>
              <LayoutTemplate className="mr-2 h-4 w-4" /> Start from a template
            </Button>
            <Button variant="outline" onClick={() => setFromPostOpen(true)}>
              <Wand2 className="mr-2 h-4 w-4" /> Copy a post you like
            </Button>
          </div>
        </div>
        <BlueprintStarterPackDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
        <ImportPostDialog open={fromPostOpen} onOpenChange={setFromPostOpen} mode="blueprint" />
      </AppLayout>
    );
  }

  if (!draft) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8">
          {isLoading ? (
            <div className="mx-auto max-w-6xl space-y-4">
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : (
            <div className="mx-auto max-w-md space-y-3 py-16 text-center">
              <h1 className="text-xl font-semibold">Blueprint not found</h1>
              <p className="text-muted-foreground">It may have been deleted, or it belongs to another workspace.</p>
              <Button variant="outline" asChild>
                <Link to="/blueprints">Back to Blueprints</Link>
              </Button>
            </div>
          )}
        </div>
      </AppLayout>
    );
  }

  const format = draftFormat(draft);
  const promptKinds = kindsInPrompt(draft);
  const toggle = (s: SectionId) => (o: boolean) => setOpen((prev) => ({ ...prev, [s]: o }));
  const current = blueprint ?? null;

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1">
        {/* Top bar */}
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:px-6">
          <Link to="/blueprints" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to Blueprints">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <input
            value={draft.name}
            onChange={(e) => update({ ...draft, name: e.target.value })}
            aria-label="Blueprint name"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-base font-semibold outline-none hover:bg-muted/60 focus:bg-muted/60 sm:max-w-md"
          />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
            {saveState === "saving" ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving</>
            ) : saveState === "dirty" ? (
              "Unsaved"
            ) : (
              <><Check className="h-3.5 w-3.5 text-emerald-600" /> Saved</>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {health && (
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="Readiness details">
                    <BlueprintHealthPill status={health.status} label={health.status === "ready" ? "Ready to run" : undefined} />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 text-sm">
                  {health.issues.length === 0 ? (
                    <p className="text-muted-foreground">Keys, models and Brand Kit all check out. This blueprint is ready to run.</p>
                  ) : (
                    <ul className="space-y-2">
                      {health.issues.map((issue, i) => (
                        <li key={i} className="text-xs">
                          <span className={issue.severity === "blocker" ? "font-semibold" : ""}>{issue.message}</span>{" "}
                          {issue.action?.href && (
                            <Link to={issue.action.href} className="font-semibold text-primary underline underline-offset-2">
                              {issue.action.label}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
            )}
            <Button variant="outline" size="sm" disabled={blocked || !current} onClick={() => current && flushAndGo(runPath({ ...current, ...asBlueprint(current.id, draft) }))}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Run once
            </Button>
            <AutomateMenu
              blueprint={{ id, name: draft.name || current?.name || "This blueprint" }}
              canRun={!blocked}
              variant="cta"
              beforeNavigate={async () => {
                if (pendingRef.current) await save();
              }}
            />
          </div>
        </div>

        <div className="mx-auto grid max-w-[1400px] gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)] lg:p-6">
          {/* Editor */}
          <div className="space-y-3">
            <StudioSection step={1} title="Format" question="What comes out" summary={formatSummary(draft)} open={open.format} onOpenChange={toggle("format")}>
              <FormatSection draft={draft} onChange={update} />
            </StudioSection>

            {draft.pipeline && (
              <StudioSection step={2} title="Brief" question="How every piece is written" summary={briefSummary(draft)} open={open.brief} onOpenChange={toggle("brief")}>
                <BriefSection draft={draft} onChange={update} onCopyFromPost={() => setFromPostOpen(true)} />
              </StudioSection>
            )}

            {draft.pipeline && (
              <StudioSection step={3} title="Context" question="What the AI knows while writing" summary={contextSummary(draft, promptKinds)} open={open.context} onOpenChange={toggle("context")}>
                <ContextSection draft={draft} onChange={update} />
              </StudioSection>
            )}

            {format && hasLook(draft) && (
              <StudioSection step={4} title="Look" question="How it looks" summary={lookSummary(draft)} open={open.look} onOpenChange={toggle("look")}>
                <LookSection draft={draft} onChange={update} />
              </StudioSection>
            )}

            <StudioSection title="Advanced" question="Quality, models and raw prompts" summary={qualitySummary(draft)} open={open.advanced} onOpenChange={toggle("advanced")} dashed>
              <AdvancedSection
                draft={draft}
                onChange={update}
                customModels={customModels}
                onCustomModelsChange={setCustomModels}
                onOpenClassic={async () => {
                  if (pendingRef.current) await save();
                  setClassicOpen(true);
                }}
              />
            </StudioSection>
          </div>

          {/* Preview */}
          <aside className="lg:sticky lg:top-16 lg:max-h-[calc(100vh-5rem)] lg:self-start lg:overflow-y-auto">
            <div className="rounded-xl bg-muted/40 p-4">
              <StudioPreview draft={draft} />
            </div>
          </aside>
        </div>
      </div>

      <EditBlueprintDialog
        blueprint={classicOpen ? current : null}
        open={classicOpen}
        onOpenChange={(o) => {
          if (!o) {
            // Pick up whatever the classic editor saved.
            reloadAfterClassicRef.current = current?.updated_at ?? "reload";
            setClassicOpen(false);
          }
        }}
      />
      <ImportPostDialog open={fromPostOpen} onOpenChange={setFromPostOpen} mode="blueprint" />
    </AppLayout>
  );
}
