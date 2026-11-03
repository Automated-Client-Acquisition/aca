import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateGenerationJob } from "@/hooks/useCreateGenerationJob";
import { explodeGenerationItems } from "@/lib/generationUtils";
import { getRequiredLibraryTables } from "@/lib/blueprintUtils";
import { analyzePrompt } from "@/lib/prompt-variables";
import { KIND_TABLE, LIBRARY_KINDS, TABLE_KIND, parseBlueprintContext, type BlueprintContext, type LibraryKind } from "@/lib/blueprint-context";
import { DEFAULT_VIDEO_CONFIG } from "@/types/video";
import type { Blueprint, PinnedLibraryElements } from "@/types/blueprint";
import type { ManualIdeaRow } from "@/types/generation";
import type { PipelineId } from "@/types/pipeline";
import type { BrandKitElement } from "@/hooks/useBrandKit";
import { getImageReferences, kindsNeededByReferences, type ImageReferenceSpec } from "@/lib/image-references";

export interface RunTopic {
  title: string;
  /** Existing idea; typed topics are saved as ideas first. */
  ideaId?: string;
}

/** Per-run choice for each library kind: an element, or "none" to leave it out. */
export type RunContextChoice = Partial<Record<LibraryKind, BrandKitElement | "none">>;

export type RunPhase = "idle" | "saving_topics" | "finding_angles" | "queueing";

export const RUN_PHASE_LABEL: Record<RunPhase, string> = {
  idle: "",
  saving_topics: "Saving topics",
  finding_angles: "Finding an angle for each topic",
  queueing: "Starting the run",
};

/** Which library kinds this blueprint uses, and whether each is required. */
export function kindsUsedBy(blueprint: Blueprint): Map<LibraryKind, "always" | "relevant"> {
  const out = new Map<LibraryKind, "always" | "relevant">();
  const context = parseBlueprintContext(blueprint.context);
  for (const kind of LIBRARY_KINDS) {
    const mode = context?.[kind]?.mode;
    if (mode === "always" || mode === "relevant") out.set(kind, mode);
  }
  for (const table of getRequiredLibraryTables(blueprint)) {
    const kind = TABLE_KIND[table];
    if (kind && !out.has(kind) && context?.[kind]?.mode !== "off") out.set(kind, "always");
  }
  // "Whichever product/person the run uses" references need one chosen, even
  // when the writing doesn't mention them.
  for (const kind of kindsNeededByReferences(getImageReferences(blueprint.model_config as any))) {
    if (!out.has(kind)) out.set(kind, "always");
  }
  return out;
}

export function promptUsesAngles(blueprint: Blueprint): boolean {
  return [blueprint.master_prompt, blueprint.image_prompt, blueprint.director_prompt]
    .filter(Boolean)
    .some((p) => analyzePrompt(p!).some((t) => t.path.startsWith("ai_")));
}

function elementImages(el: Record<string, any>): string[] {
  const imgs = el.reference_images || el.images || el.logos || (el.logo ? [el.logo] : []);
  return (Array.isArray(imgs) ? imgs : []).filter((x: unknown): x is string => typeof x === "string");
}

function buildVideoConfig(blueprint: Blueprint) {
  const vcd = { ...DEFAULT_VIDEO_CONFIG, ...(blueprint.model_config?.video_config_defaults ?? {}), source: "prompt_only" } as any;
  const snake = {
    source: vcd.source,
    narration_mode: vcd.narrationMode,
    target_duration: vcd.targetDuration,
    voice_mode: vcd.voiceMode,
    image_mode: vcd.imageMode,
    b_roll_enabled: vcd.bRollEnabled,
    b_roll_style: vcd.bRollStyle,
    orientation: vcd.orientation,
    aspect_ratio: vcd.aspectRatio,
    subtitle_style: vcd.subtitleStyle,
  };
  return {
    video_config: snake,
    extra: {
      video_config: snake,
      source: vcd.source,
      voice_mode: vcd.voiceMode,
      voice_type: vcd.voiceMode === "avatar" ? "avatar" : "voiceover",
      b_roll_enabled: vcd.bRollEnabled,
      b_roll_style: vcd.bRollStyle,
      subtitle_style: vcd.subtitleStyle,
      orientation: vcd.orientation,
    },
  };
}

/**
 * Start a run: topics in, one generation job out. Mirrors the classic wizard's
 * job shape (same item builder, same configuration keys) so dispatch treats it
 * identically; the differences are that context comes pre-filled and every
 * stage auto-approves, so the user reviews the finished piece.
 */
export function useStartBlueprintRun() {
  const { currentOrganization, user } = useAuth();
  const createJob = useCreateGenerationJob();
  const [phase, setPhase] = useState<RunPhase>("idle");

  const start = async (params: {
    blueprint: Blueprint;
    topics: RunTopic[];
    versions: number;
    context: RunContextChoice;
    /** Resolved image references for this run (null = leave the blueprint's as-is). */
    references?: ImageReferenceSpec[] | null;
    /** One look for every piece of this run (null = the blueprint's turn order). */
    lookId?: string | null;
  }): Promise<{ jobId: string; itemCount: number }> => {
    const { blueprint, topics, versions, context, references, lookId } = params;
    if (!currentOrganization || !user) throw new Error("Not signed in");
    if (topics.length === 0) throw new Error("Add at least one topic");
    const orgId = currentOrganization.id;

    try {
      // 1. Typed topics become ideas, so outputs link back to them.
      setPhase("saving_topics");
      const typed = topics.filter((t) => !t.ideaId);
      let created: Array<{ id: string; title: string }> = [];
      if (typed.length > 0) {
        const { data, error } = await supabase
          .from("content_ideas")
          .insert(typed.map((t) => ({ organization_id: orgId, title: t.title.slice(0, 200), free_text: t.title.length > 200 ? t.title : null })))
          .select("id, title");
        if (error) throw error;
        created = data ?? [];
      }
      const ideaIds = [...topics.filter((t) => t.ideaId).map((t) => t.ideaId!), ...created.map((c) => c.id)];

      // 2. AI angles (hooks, talking points, CTAs) when the brief uses them.
      const loadIdeas = async () => {
        const { data, error } = await supabase
          .from("content_ideas")
          .select("id, title, free_text, ai_analysis")
          .in("id", ideaIds);
        if (error) throw error;
        return data ?? [];
      };
      let ideas = await loadIdeas();
      if (promptUsesAngles(blueprint)) {
        const missing = ideas.filter((i) => !i.ai_analysis);
        if (missing.length > 0) {
          setPhase("finding_angles");
          const brand = context.brand && context.brand !== "none" ? context.brand.id : undefined;
          const product = context.product && context.product !== "none" ? context.product.id : undefined;
          // One call per idea, in parallel; a failed angle just means the prompt's angle lines drop out.
          await Promise.allSettled(
            missing.map((i) =>
              supabase.functions.invoke("bulk-generate-analysis", {
                body: { idea_ids: [i.id], brand_voice_id: brand, product_id: product },
              }),
            ),
          );
          ideas = await loadIdeas();
        }
      }

      // 3. Items, via the wizard's own builder.
      setPhase("queueing");
      const byId = new Map(ideas.map((i) => [i.id, i]));
      const rows: ManualIdeaRow[] = ideaIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((i) => ({ id: i!.id, context: i!.title, ...(i!.free_text ? { freeText: i!.free_text } : {}) }));
      const analysis: Record<string, any> = Object.fromEntries(ideas.filter((i) => i.ai_analysis).map((i) => [i.id, i.ai_analysis]));

      const refTables = new Set(blueprint.reference_image_libraries ?? []);
      const pinned: PinnedLibraryElements = {};
      const libraryData: Record<string, any[]> = {};
      const runContext: BlueprintContext = { ...(parseBlueprintContext(blueprint.context) ?? {}) };
      for (const kind of LIBRARY_KINDS) {
        const choice = context[kind];
        const table = KIND_TABLE[kind];
        if (choice === "none") {
          // Tell dispatch not to fill it back in from the defaults.
          runContext[kind] = { mode: "off" };
          continue;
        }
        if (!choice) continue;
        pinned[table] = {
          combination_mode: "combine",
          elements: { [choice.id]: refTables.has(table) ? { selected_images: elementImages(choice) } : {} },
        };
        libraryData[table] = [choice];
      }

      let items = explodeGenerationItems(rows, pinned, libraryData, undefined, analysis, "force_all", blueprint.pipeline as PipelineId);
      if (versions > 1) {
        items = items.flatMap((item) =>
          Array.from({ length: versions }, (_, v) => ({ ...item, idea_title: v === 0 ? item.idea_title : `${item.idea_title} (v${v + 1})` })),
        );
      }

      const mc = (blueprint.model_config ?? {}) as Record<string, any>;
      const isCarousel = blueprint.pipeline === "instagram_carousel";
      const outputConfig = {
        aspectRatio:
          mc.output_config_defaults?.aspectRatio ??
          (isCarousel || blueprint.pipeline === "instagram_carousel_ai" ? "portrait" : "landscape"),
        ...(isCarousel
          ? {
              carouselTemplate: mc.carousel_template || "creator",
              slideCount: mc.carousel_slide_count || 5,
              ...(mc.carousel_cta_text ? { ctaButtonText: mc.carousel_cta_text } : {}),
              ...(mc.carousel_handle ? { authorHandle: mc.carousel_handle } : {}),
              ...(mc.carousel_custom_palette ? { customPalette: mc.carousel_custom_palette } : {}),
              ...(mc.carousel_background_image ? { backgroundImageUrl: mc.carousel_background_image } : {}),
            }
          : {}),
      };
      const video = blueprint.pipeline === "video" ? buildVideoConfig(blueprint) : null;

      // References resolved on the Run screen (the run's product/person photos,
      // plus anything added for this run) travel as concrete image lists.
      const modelConfig = references ? { ...(blueprint.model_config ?? {}), image_references: references } : blueprint.model_config;

      const jobId = await createJob.mutateAsync({
        blueprint_id: blueprint.id,
        pipeline: blueprint.pipeline!,
        items,
        video_config: video?.video_config,
        output_config: outputConfig,
        configuration: {
          blueprint_name: blueprint.name,
          pipeline: blueprint.pipeline!,
          model_config: modelConfig,
          auto_approve_all: true,
          source: "run_composer",
          ...(lookId ? { look_id: lookId } : {}),
          blueprint: { ...blueprint, context: runContext, model_config: modelConfig },
          ...(video?.extra ?? {}),
        } as any,
      });
      return { jobId, itemCount: items.length };
    } finally {
      setPhase("idle");
    }
  };

  return { start, phase, isRunning: phase !== "idle" };
}

export interface RunOutput {
  id: string;
  status: string;
  current_stage: string | null;
  error_message: string | null;
  idea_id: string | null;
  created_at: string;
  title: string | null;
  caption: string | null;
  thread?: string | null;
  script?: string | null;
  text: string | null;
  image_url: string | null;
  slide_image: string | null;
}

/** Outputs of one run, polled while anything is still being made. */
export function useRunOutputs(jobId: string | null) {
  const { currentOrganization } = useAuth();
  const job = useQuery({
    queryKey: ["run-job", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_generation_jobs")
        .select("id, status, error, progress")
        .eq("id", jobId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.status;
      return s === "completed" || s === "failed" ? false : 2500;
    },
  });
  const outputs = useQuery({
    queryKey: ["run-outputs", jobId, currentOrganization?.id],
    queryFn: async () => {
      // JSON-path aliases keep the payload small; typed loosely because
      // supabase-js's select-string parser can't infer paths this deep.
      const { data, error } = await (supabase.from("content_outputs") as any)
        .select(
          "id, status, current_stage, error_message, idea_id, created_at, title:data->>title, caption:stage_data->caption->>content, text:data->>text, thread:stage_data->thread_tweets->>content, script:stage_data->text->>content, image_url:stage_data->image->>url, slide_image:stage_data->carousel_slides->slides->0->>image_url",
        )
        .eq("job_id", jobId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as RunOutput[];
    },
    enabled: !!jobId,
    refetchInterval: (q) => {
      const rows = (q.state.data as RunOutput[] | undefined) ?? [];
      const jobDone = job.data?.status === "completed" || job.data?.status === "failed";
      const busy = rows.length === 0 || rows.some((r) => r.status === "generating" || (r.status === "review" && r.current_stage !== "complete"));
      return jobDone && !busy ? false : 2500;
    },
  });
  return { job: job.data, outputs: outputs.data ?? [], refetch: outputs.refetch };
}
