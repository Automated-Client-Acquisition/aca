import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, ExternalLink, Loader2, Play, Plus, RotateCcw, Search, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useBlueprints } from "@/hooks/useBlueprints";
import { useIdeas } from "@/hooks/useIdeas";
import { useBrandKit, type BrandKitElement } from "@/hooks/useBrandKit";
import { useBlueprintRunStats, useHealthEnvironment } from "@/hooks/useBlueprintHealth";
import {
  RUN_PHASE_LABEL,
  kindsUsedBy,
  promptUsesAngles,
  useRunOutputs,
  useStartBlueprintRun,
  type RunContextChoice,
  type RunOutput,
} from "@/hooks/useBlueprintRun";
import { Segmented } from "@/components/blueprint-studio/StudioSection";
import { BlueprintHealthPill } from "@/components/blueprints/BlueprintHealthPill";
import { formatLabelForBlueprint } from "@/components/blueprints/BlueprintCard";
import { evaluateBlueprintHealth } from "@/lib/blueprint-health";
import { humanizeGenerationError } from "@/lib/generation-errors";
import { threadTweetsFromContent } from "@/lib/thread-text";
import { supportsRunComposer } from "@/lib/blueprint-routes";
import { QUALITY_TIERS, detectQualityTier } from "@/lib/blueprint-brief";
import { KIND_ASSETS_TAB, KIND_LABEL, LIBRARY_KINDS, parseBlueprintContext, type LibraryKind } from "@/lib/blueprint-context";
import {
  maxImagesFor,
  ROLE_META,
  getImageReferences,
  newReferenceId,
  REFERENCE_ROLES,
  referenceMode,
  resolveReferencesForRun,
  toJobReferences,
  uploadReferenceImages,
  type ImageReferenceSpec,
  type ReferenceRole,
} from "@/lib/image-references";
import { cn } from "@/lib/utils";
import { getImageLooks, lookMode, nextLook } from "@/lib/image-looks";
import { useRecentManualLookIds } from "@/hooks/useRecentPieces";
import { LookThumb } from "@/components/blueprint-studio/LooksEditor";

const STAGE_LABEL: Record<string, string> = {
  caption: "Writing",
  text: "Writing",
  thread_tweets: "Writing",
  image_prompt: "Planning the image",
  image: "Drawing the image",
  carousel_content: "Writing slides",
  carousel_slide_prompts: "Planning slides",
  carousel_slides: "Designing slides",
  outline: "Outlining",
  voiceover: "Recording the voice",
  director: "Directing",
  images: "Making visuals",
  composition: "Editing the video",
};

function outputState(o: RunOutput): "working" | "ready" | "approved" | "failed" | "waiting" {
  if (o.status === "failed") return "failed";
  if (o.status === "approved" || o.status === "published") return "approved";
  if (o.status === "review" && o.current_stage === "complete") return "ready";
  if (o.status === "review") return "waiting";
  return "working";
}

function ResultCard({ output, jobId, onRedo }: { output: RunOutput; jobId: string; onRedo: (title: string) => void }) {
  const state = outputState(output);
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const title = output.title || "Untitled";
  const text = output.caption || output.text || (output.thread ? threadTweetsFromContent(output.thread).join("\n\n") : null) || output.script;
  const image = output.image_url || output.slide_image;
  const effective = approved ? "approved" : state;

  const approve = async () => {
    setApproving(true);
    const { error } = await supabase.from("content_outputs").update({ status: "approved" }).eq("id", output.id);
    setApproving(false);
    if (error) return toast.error(`Couldn't approve: ${error.message}`);
    setApproved(true);
    toast.success("Approved. It's in Content, ready to schedule.");
  };

  return (
    <div className={cn("rounded-xl border bg-card p-3.5", effective === "ready" && "border-emerald-500/40", effective === "failed" && "border-red-500/40")}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        {effective === "working" && (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            {STAGE_LABEL[output.current_stage ?? ""] ?? "Working"}
          </span>
        )}
        {effective === "waiting" && <BlueprintHealthPill status="needs_setup" label="Needs your OK" />}
        {effective === "ready" && <BlueprintHealthPill status="ready" label="Ready to review" />}
        {effective === "approved" && <BlueprintHealthPill status="ready" label="Approved" />}
        {effective === "failed" && <BlueprintHealthPill status="failing" label="Failed" />}
      </div>

      {effective === "failed" && (
        <p className="mt-2 text-xs text-red-700 dark:text-red-400">{humanizeGenerationError(output.error_message)}</p>
      )}

      {(effective === "ready" || effective === "approved" || effective === "waiting") && (text || image) && (
        <div className="mt-2.5 flex gap-3">
          {image && <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-md border object-cover" loading="lazy" />}
          {text && <p className="line-clamp-4 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{text}</p>}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {effective === "ready" && (
          <Button size="sm" variant="cta" className="h-7 text-xs" onClick={approve} disabled={approving}>
            {approving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Approve
          </Button>
        )}
        {effective !== "working" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
            <Link to={`/jobs/${jobId}`}>
              <ExternalLink className="mr-1 h-3 w-3" />
              {effective === "failed" ? "Details" : "Edit or schedule"}
            </Link>
          </Button>
        )}
        {(effective === "ready" || effective === "failed") && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onRedo(title.replace(/ \(v\d+\)$/, ""))}>
            <RotateCcw className="mr-1 h-3 w-3" />
            {effective === "failed" ? "Try again" : "Redo"}
          </Button>
        )}
      </div>
    </div>
  );
}

function JobResults({ jobId, expected, onRedo }: { jobId: string; expected?: number; onRedo: (title: string) => void }) {
  const { job, outputs } = useRunOutputs(jobId);
  const total = Math.max(expected ?? 0, outputs.length, (job?.progress as any)?.total ?? 0);
  const readyCount = outputs.filter((o) => ["ready", "approved"].includes(outputState(o))).length;
  const placeholders = job?.status !== "failed" ? Math.max(0, total - outputs.length) : 0;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">{total > 0 ? `${readyCount} of ${total} ready` : "Starting"}</span>
        <Link to={`/jobs/${jobId}`} className="underline-offset-2 hover:text-foreground hover:underline">
          Open in Content
        </Link>
      </div>
      {job?.status === "failed" && outputs.length === 0 ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-4 text-sm">
          <div className="font-semibold text-red-700 dark:text-red-400">The run didn't start</div>
          <p className="mt-1 text-red-700/90 dark:text-red-300">{humanizeGenerationError(job.error)}</p>
        </div>
      ) : (
        <>
          {outputs.map((o) => (
            <ResultCard key={o.id} output={o} jobId={jobId} onRedo={onRedo} />
          ))}
          {Array.from({ length: placeholders }).map((_, i) => (
            <div key={`q${i}`} className="flex items-center justify-between rounded-xl border border-dashed bg-card/50 p-3.5 text-sm text-muted-foreground">
              Queued
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

export default function BlueprintRun() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: blueprints, isLoading } = useBlueprints();
  const blueprint = blueprints?.find((b) => b.id === id);
  const { ideas } = useIdeas();
  const brandKit = useBrandKit();
  const { start, phase, isRunning } = useStartBlueprintRun();

  const [topicsText, setTopicsText] = useState("");
  const [selectedIdeaIds, setSelectedIdeaIds] = useState<string[]>(() => (searchParams.get("ideas") ?? "").split(",").filter(Boolean));
  const [ideaSearch, setIdeaSearch] = useState("");
  const [versions, setVersions] = useState("1");
  // "auto" = the blueprint's own rule (take turns, or its one look).
  const [lookChoice, setLookChoice] = useState<string>("auto");
  const [choices, setChoices] = useState<RunContextChoice>({});
  // Reference photos: the blueprint's, minus any removed for this run, plus uploads for this run.
  const [removedRefIds, setRemovedRefIds] = useState<string[]>([]);
  const [runRefs, setRunRefs] = useState<ImageReferenceSpec[]>([]);
  const [uploadRole, setUploadRole] = useState<ReferenceRole | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const refFileInput = useRef<HTMLInputElement>(null);
  // Every run started from this page, newest first (kept in the URL so a refresh keeps them).
  const jobIds = (searchParams.get("job") ?? "").split(",").filter(Boolean);
  const [expected, setExpected] = useState<Record<string, number>>({});

  // Classic-only blueprints go to the wizard.
  useEffect(() => {
    if (blueprint && !supportsRunComposer(blueprint)) {
      navigate(`/create?blueprint=${blueprint.id}${selectedIdeaIds.length ? `&ideas=${selectedIdeaIds.join(",")}` : ""}`, { replace: true });
    }
  }, [blueprint, navigate, selectedIdeaIds]);

  const used = useMemo(() => (blueprint ? kindsUsedBy(blueprint) : new Map()), [blueprint]);
  const context = useMemo(() => parseBlueprintContext(blueprint?.context), [blueprint]);

  // Default choice per kind: blueprint pin → workspace default → most recent.
  const effectiveChoice = (kind: LibraryKind): BrandKitElement | "none" | null => {
    if (choices[kind]) return choices[kind]!;
    return brandKit.resolve(kind, context?.[kind]?.element_id)?.element ?? null;
  };

  const typedTopics = topicsText.split("\n").map((t) => t.trim()).filter(Boolean);
  const selectedIdeas = selectedIdeaIds.map((iid) => ideas.find((i) => i.id === iid)).filter(Boolean) as typeof ideas;
  const topicCount = typedTopics.length + selectedIdeas.length;
  const pieceCount = topicCount * Number(versions);

  const ideaMatches = useMemo(() => {
    const q = ideaSearch.trim().toLowerCase();
    return ideas
      .filter((i) => !selectedIdeaIds.includes(i.id))
      .filter((i) => !q || i.title.toLowerCase().includes(q))
      .slice(0, q ? 8 : 5);
  }, [ideas, ideaSearch, selectedIdeaIds]);

  // Preflight: the same rules as the Blueprints list, plus missing context.
  const envInput = useMemo(() => (blueprint ? [blueprint] : []), [blueprint]);
  const { env, isLoading: envLoading } = useHealthEnvironment(envInput);
  const { data: stats } = useBlueprintRunStats();
  const health = useMemo(
    () => (blueprint && !envLoading ? evaluateBlueprintHealth(blueprint, env, stats?.get(blueprint.id)) : null),
    [blueprint, env, envLoading, stats],
  );
  const missingContext = [...used.entries()].filter(([kind, mode]) => mode === "always" && !effectiveChoice(kind)).map(([kind]) => kind);
  const blockers = (health?.issues ?? []).filter((i) => i.severity === "blocker");
  const blueprintRefs = getImageReferences(blueprint?.model_config as any);
  const drawsImages =
    !!blueprint &&
    (blueprint.pipeline === "image_only" ||
      blueprint.pipeline === "instagram_carousel_ai" ||
      blueprint.pipeline === "video" ||
      (blueprint.pipeline === "social_media_post" && !blueprint.skip_image_generation));
  const refChoice = (kind: LibraryKind) => {
    const c = effectiveChoice(kind);
    return c && c !== "none" ? (c as Record<string, any>) : null;
  };
  const resolvedRefs = resolveReferencesForRun(
    [...(blueprintRefs ?? []).filter((r) => !removedRefIds.includes(r.id)), ...runRefs],
    { product: refChoice("product"), person: refChoice("person") },
  );
  // Roles whose photos take turns (one per piece) rather than all going to every piece.
  const rotatingRoles = REFERENCE_ROLES.filter(
    (role) =>
      referenceMode(blueprint?.model_config as any, role) === "rotate" &&
      new Set(resolvedRefs.filter((r) => r.role === role).flatMap((r) => r.images)).size >= 2,
  );
  const looks = getImageLooks(blueprint?.model_config as any) ?? [];
  const rotates = looks.length > 1 && lookMode(blueprint?.model_config as any) === "rotate";
  const { data: recentLookIds } = useRecentManualLookIds(blueprint?.id, drawsImages && rotates);
  const autoLook = nextLook(blueprint?.model_config as any, recentLookIds ?? []);
  // Only send an explicit list when the blueprint uses references or this run changed them.
  const referencesForJob = blueprintRefs !== null || runRefs.length > 0 || removedRefIds.length > 0 ? toJobReferences(resolvedRefs) : null;

  const addRunReference = async (files: FileList | null) => {
    if (!files?.length || !uploadRole) return;
    setUploadingRef(true);
    try {
      const urls = await uploadReferenceImages([...files].slice(0, maxImagesFor(uploadRole)));
      setRunRefs((r) => [...r, { id: newReferenceId(), role: uploadRole, source: "upload", images: urls, label: files[0].name.replace(/\.[^.]+$/, "").slice(0, 40) }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingRef(false);
      setUploadRole(null);
      if (refFileInput.current) refFileInput.current.value = "";
    }
  };

  const canGenerate = !!blueprint && pieceCount > 0 && blockers.length === 0 && missingContext.length === 0 && !isRunning;

  const run = async (topicsOverride?: Array<{ title: string; ideaId?: string }>) => {
    if (!blueprint) return;
    const topics = topicsOverride ?? [
      ...selectedIdeas.map((i) => ({ title: i.title, ideaId: i.id })),
      ...typedTopics.map((title) => ({ title })),
    ];
    const contextChoice: RunContextChoice = {};
    for (const [kind] of used) {
      const c = effectiveChoice(kind);
      if (c) contextChoice[kind] = c;
    }
    try {
      const { jobId: newJob, itemCount } = await start({
        blueprint,
        topics,
        versions: topicsOverride ? 1 : Number(versions),
        context: contextChoice,
        references: referencesForJob,
        lookId: lookChoice === "auto" || !looks.some((l) => l.id === lookChoice) ? null : lookChoice,
      });
      setExpected((e) => ({ ...e, [newJob]: itemCount }));
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const existing = (prev.get("job") ?? "").split(",").filter(Boolean);
        next.set("job", [newJob, ...existing].slice(0, 10).join(","));
        next.delete("ideas");
        return next;
      });
      if (!topicsOverride) {
        setTopicsText("");
        setSelectedIdeaIds([]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the run");
    }
  };

  if (!blueprint) {
    return (
      <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
        <div className="flex-1 p-8">
          {isLoading ? <Skeleton className="mx-auto h-96 max-w-5xl" /> : (
            <div className="mx-auto max-w-md space-y-3 py-16 text-center">
              <h1 className="text-xl font-semibold">Blueprint not found</h1>
              <Button variant="outline" asChild><Link to="/blueprints">Back to Blueprints</Link></Button>
            </div>
          )}
        </div>
      </AppLayout>
    );
  }

  const tier = detectQualityTier(blueprint.model_config as any);
  const usesAngles = promptUsesAngles(blueprint);

  return (
    <AppLayout header={<div className="ml-auto"><UserProfileMenu /></div>}>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 lg:px-6">
          <Link to={`/blueprints/${blueprint.id}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to the blueprint">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm text-muted-foreground">Run</span>
          <span className="text-sm font-semibold">{blueprint.name}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{formatLabelForBlueprint(blueprint.pipeline)}</span>
        </div>

        <div className="mx-auto grid max-w-[1300px] gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:p-6">
          {/* Composer */}
          <div className="space-y-5 rounded-xl border bg-card p-5">
            <div>
              <h1 className="text-lg font-bold">What should these be about?</h1>
              <p className="text-sm text-muted-foreground">One piece per line. The blueprint handles the rest.</p>
            </div>

            <Textarea
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
              rows={4}
              placeholder={"Why we stopped cold calling\nThe 5-mailbox rule for cold email"}
              aria-label="Topics, one per line"
            />

            <div className="space-y-2">
              <div className="text-xs font-semibold text-foreground/80">Or add from Ideas</div>
              {selectedIdeas.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedIdeas.map((i) => (
                    <span key={i.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-foreground bg-foreground py-1 pl-3 pr-1.5 text-xs text-background">
                      <span className="truncate">{i.title}</span>
                      <button type="button" onClick={() => setSelectedIdeaIds((ids) => ids.filter((x) => x !== i.id))} className="rounded-full p-0.5 hover:bg-background/20" aria-label={`Remove ${i.title}`}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={ideaSearch} onChange={(e) => setIdeaSearch(e.target.value)} placeholder="Search your ideas" className="h-8 pl-8 text-xs" aria-label="Search ideas" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ideaMatches.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setSelectedIdeaIds((ids) => [...ids, i.id])}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    <span className="truncate">{i.title}</span>
                  </button>
                ))}
                {ideas.length === 0 && <span className="text-xs text-muted-foreground">No saved ideas yet.</span>}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-foreground/80">Using</div>
              <div className="flex flex-wrap gap-1.5">
                {LIBRARY_KINDS.filter((k) => used.has(k)).map((kind) => {
                  const choice = effectiveChoice(kind);
                  const list = brandKit.lists[kind];
                  const mode = used.get(kind);
                  if (list.length === 0) {
                    return (
                      <Link
                        key={kind}
                        to={`/assets?tab=${KIND_ASSETS_TAB[kind]}`}
                        className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs", mode === "always" ? "border-red-500/50 text-red-700 dark:text-red-400" : "text-muted-foreground")}
                      >
                        {mode === "always" && <AlertTriangle className="h-3 w-3" />}
                        No {KIND_LABEL[kind].toLowerCase()} yet
                      </Link>
                    );
                  }
                  return (
                    <DropdownMenu key={kind}>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted">
                          <span className="text-muted-foreground">{KIND_LABEL[kind]}:</span>
                          <span className="font-medium">{choice === "none" ? "left out" : choice?.name ?? "none"}</span>
                          {mode === "relevant" && choice !== "none" && <span className="text-muted-foreground">(if relevant)</span>}
                          <ChevronDown className="h-3 w-3 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                        <DropdownMenuLabel className="text-[11px] text-muted-foreground">For this run only</DropdownMenuLabel>
                        {list.map((e) => (
                          <DropdownMenuItem key={e.id} className="text-xs" onClick={() => setChoices((c) => ({ ...c, [kind]: e }))}>
                            {e.name}
                          </DropdownMenuItem>
                        ))}
                        {mode === "relevant" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-xs" onClick={() => setChoices((c) => ({ ...c, [kind]: "none" }))}>
                              Leave it out
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  );
                })}
                <Link to={`/blueprints/${blueprint.id}`} className="inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted">
                  <span className="text-muted-foreground">Quality:</span>
                  <span className="font-medium">{tier === "custom" ? "Custom" : QUALITY_TIERS.find((t) => t.id === tier)?.label}</span>
                </Link>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-foreground/80">Versions per topic</div>
              <Segmented ariaLabel="Versions per topic" options={["1", "2", "3"].map((v) => ({ id: v, label: v }))} value={versions} onChange={setVersions} />
            </div>

            {drawsImages && looks.length > 1 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-foreground/80">Look</div>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Look for this run">
                  {[{ id: "auto", label: rotates ? "Next in turn" : "Blueprint's look", thumb: autoLook, sub: autoLook?.label }, ...looks.map((l) => ({ id: l.id, label: l.label, thumb: l, sub: undefined }))].map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={lookChoice === o.id}
                      onClick={() => setLookChoice(o.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border bg-background p-1.5 pr-2.5 text-left transition-colors",
                        lookChoice === o.id ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/40",
                      )}
                    >
                      {o.thumb && <LookThumb look={o.thumb} size="sm" />}
                      <span className="min-w-0">
                        <span className="block max-w-[140px] truncate text-xs font-medium">{o.label}</span>
                        {o.sub && <span className="block max-w-[140px] truncate text-[10px] text-muted-foreground">{o.sub}</span>}
                      </span>
                    </button>
                  ))}
                </div>
                {lookChoice === "auto" && rotates && pieceCount > 1 && (
                  <p className="text-xs text-muted-foreground">Each piece takes the next look, so versions come out in different looks.</p>
                )}
              </div>
            )}

            {drawsImages && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-foreground/80">Reference photos</div>
                  <input ref={refFileInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addRunReference(e.target.files)} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" disabled={uploadingRef}>
                        {uploadingRef ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Add a photo for this run
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {((looks.length > 0 ? ["product", "person"] : ["product", "person", "style"]) as ReferenceRole[]).map((role) => (
                        <DropdownMenuItem
                          key={role}
                          className="text-xs"
                          onClick={() => {
                            setUploadRole(role);
                            setTimeout(() => refFileInput.current?.click(), 0);
                          }}
                        >
                          {{ product: "Product photo (show this exact object)", person: "Person photo (keep this face)", style: "Style photo (match this look)" }[role]}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {resolvedRefs.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {blueprintRefs === null
                      ? "This blueprint picks photos from its libraries automatically. Add one here to control exactly what the image model sees."
                      : "None. Images are drawn from the brief and the look alone."}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {resolvedRefs.map((r) => (
                      <div key={r.id} className={cn("flex items-center gap-2 rounded-lg border bg-background p-1.5 pr-2", r.missing && "border-amber-500/50")}>
                        <div className="flex -space-x-2">
                          {r.images.length > 0 ? (
                            r.images.map((u) => <img key={u} src={u} alt="" className="h-8 w-8 rounded border-2 border-background object-cover" />)
                          ) : (
                            <div className="grid h-8 w-8 place-items-center rounded bg-muted text-[10px] text-muted-foreground">none</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{ROLE_META[r.role].title}</div>
                          <div className="max-w-[140px] truncate text-xs">{r.label}</div>
                          {r.missing && <div className="text-[10px] text-amber-700 dark:text-amber-400">{r.missing}</div>}
                        </div>
                        <button
                          type="button"
                          aria-label={`Leave out ${r.label} for this run`}
                          className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                          onClick={() =>
                            runRefs.some((x) => x.id === r.id)
                              ? setRunRefs((x) => x.filter((y) => y.id !== r.id))
                              : setRemovedRefIds((ids) => [...ids, r.id])
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {rotatingRoles.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {rotatingRoles.map((role) => ({ remake: "Base images", product: "Product photos", person: "Person photos", style: "Style photos" })[role]).join(" and ")} take
                    turns: each piece uses one. Remove the others to use a specific one.
                  </p>
                )}
              </div>
            )}

            {/* Preflight */}
            {health && (
              blockers.length === 0 && missingContext.length === 0 ? (
                <div className="space-y-1 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                  <div className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> API keys and models check out</div>
                  {[...used.keys()].map((kind) => {
                    const c = effectiveChoice(kind);
                    return c && c !== "none" ? (
                      <div key={kind} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> {KIND_LABEL[kind]}: {c.name}</div>
                    ) : null;
                  })}
                  {usesAngles && <div className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> New topics get an AI angle first (adds about 20 seconds)</div>}
                </div>
              ) : (
                <ul className="space-y-1.5 rounded-lg bg-red-500/10 px-3 py-2.5 text-xs text-red-800 dark:text-red-300">
                  {blockers.map((b, i) => (
                    <li key={i}>
                      {b.message}{" "}
                      {b.action?.href && <Link to={b.action.href} className="font-semibold underline underline-offset-2">{b.action.label}</Link>}
                    </li>
                  ))}
                  {missingContext.map((kind) => (
                    <li key={kind}>
                      This blueprint always uses a {KIND_LABEL[kind].toLowerCase()}.{" "}
                      <Link to={`/assets?tab=${KIND_ASSETS_TAB[kind]}`} className="font-semibold underline underline-offset-2">Add one</Link>
                    </li>
                  ))}
                </ul>
              )
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-sm text-muted-foreground tabular-nums">
                {isRunning
                  ? `${RUN_PHASE_LABEL[phase]}...`
                  : pieceCount > 0
                    ? `${pieceCount} piece${pieceCount === 1 ? "" : "s"} · about ${Math.max(1, Math.ceil(pieceCount * 0.7))} min`
                    : "Add a topic to start"}
              </span>
              <Button variant="cta" onClick={() => run()} disabled={!canGenerate}>
                {isRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                {pieceCount > 0 ? `Generate ${pieceCount} piece${pieceCount === 1 ? "" : "s"}` : "Generate"}
              </Button>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold">Results</h2>
            {jobIds.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Finished pieces appear here as they're written. Nothing publishes until you approve and schedule it.
              </div>
            ) : (
              jobIds.map((jid) => <JobResults key={jid} jobId={jid} expected={expected[jid]} onRedo={(title) => run([{ title }])} />)
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
