import type { Blueprint, LibraryElementType, UpdateBlueprintInput } from "@/types/blueprint";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";
import {
  FORMATS,
  applyQualityTier,
  compileBrief,
  defaultBrief,
  detectQualityTier,
  formatForPipeline,
  parseBrief,
  type BlueprintBrief,
  type BlueprintFormat,
} from "@/lib/blueprint-brief";
import { DEFAULT_CONTEXT, LIBRARY_KINDS, parseBlueprintContext, type BlueprintContext, type LibraryKind } from "@/lib/blueprint-context";

export interface StudioDraft {
  name: string;
  description: string;
  pipeline: string | null;
  brief: BlueprintBrief | null;
  context: BlueprintContext | null;
  master_prompt: string;
  image_prompt: string;
  director_prompt: string;
  skip_image_generation: boolean;
  reference_image_libraries: LibraryElementType[];
  model_config: Record<string, any>;
}

export function draftFromBlueprint(bp: Blueprint): StudioDraft {
  return {
    name: bp.name,
    description: bp.description ?? "",
    pipeline: bp.pipeline ?? null,
    brief: parseBrief(bp.brief),
    context: parseBlueprintContext(bp.context),
    master_prompt: bp.master_prompt ?? "",
    image_prompt: bp.image_prompt ?? "",
    director_prompt: bp.director_prompt ?? "",
    skip_image_generation: !!bp.skip_image_generation,
    reference_image_libraries: (bp.reference_image_libraries ?? []) as LibraryElementType[],
    model_config: (bp.model_config ?? {}) as Record<string, any>,
  };
}

export function draftFormat(draft: Pick<StudioDraft, "pipeline">): BlueprintFormat | null {
  return formatForPipeline(draft.pipeline);
}

/** Does the brief drive the prompt (guided), or was the prompt written by hand? */
export function isGuided(draft: StudioDraft): boolean {
  return !!draft.brief && !draft.brief.custom_prompt && !!draftFormat(draft);
}

/** Re-derive compiled prompts after any change. Hand-written prompts are left alone. */
export function recompile(draft: StudioDraft): StudioDraft {
  const format = draftFormat(draft);
  if (!format || !draft.brief || draft.brief.custom_prompt) return draft;
  const compiled = compileBrief(draft.brief, format, {
    context: draft.context,
    slideCount: draft.model_config.carousel_slide_count,
    imageStyleDirection: draft.model_config.image_style_direction,
  });
  return {
    ...draft,
    master_prompt: compiled.master_prompt,
    image_prompt: compiled.image_prompt ?? draft.image_prompt,
  };
}

/** Context for a new blueprint: use what the Brand Kit actually has. */
export function defaultContextFor(counts: Record<LibraryKind, number>): BlueprintContext {
  return {
    brand: { mode: counts.brand > 0 ? "always" : "off" },
    audience: { mode: counts.audience > 0 ? "always" : "off" },
    product: { mode: counts.product > 0 ? "relevant" : "off" },
    person: { mode: "off" },
  };
}

const DEFAULT_NAMES: Record<BlueprintFormat, string> = {
  post: "New social post",
  carousel: "New carousel",
  article: "New article",
  thread: "New X thread",
  video: "New short video",
  image: "New image",
};

export function newDraft(format: BlueprintFormat, counts: Record<LibraryKind, number>): StudioDraft {
  const pipeline = FORMATS[format].pipeline;
  const base: StudioDraft = {
    name: DEFAULT_NAMES[format],
    description: "",
    pipeline,
    brief: defaultBrief(format),
    context: defaultContextFor(counts),
    master_prompt: "",
    image_prompt: "",
    director_prompt: "",
    skip_image_generation: false,
    reference_image_libraries: [],
    model_config: {},
  };
  return recompile(withFormatDefaults(base, format));
}

/** Model and look defaults a format needs to run. */
export function withFormatDefaults(draft: StudioDraft, format: BlueprintFormat): StudioDraft {
  const pipeline = draft.pipeline ?? FORMATS[format].pipeline;
  const tier = detectQualityTier(draft.model_config);
  let mc: Record<string, any>;
  if (tier === "custom") {
    // Hand-picked models stay; only fill the slots this format needs and lacks.
    const filled = applyQualityTier(draft.model_config, "balanced", format, pipeline);
    mc = { ...draft.model_config };
    for (const slot of ["text_llm", "image_generator", "tts"]) {
      if (!mc[slot]?.model_id && filled[slot]) mc[slot] = filled[slot];
    }
  } else {
    mc = applyQualityTier(draft.model_config, tier, format, pipeline);
  }
  if (format === "carousel") {
    mc = { ...mc, carousel_slide_count: mc.carousel_slide_count ?? 5 };
    if (pipeline === "instagram_carousel") mc.carousel_template = mc.carousel_template ?? "creator";
    // 4:5 is what Instagram and LinkedIn favor; an explicit choice (including square) is kept
    mc.output_config_defaults = { aspectRatio: "portrait", ...(mc.output_config_defaults ?? {}) };
  }
  if (format === "post" || format === "image") {
    mc.output_config_defaults = { aspectRatio: "square", ...(mc.output_config_defaults ?? {}) };
  }
  // Formats that draw images manage references explicitly (no silent "every
  // library photo" fallback), unless an older blueprint still uses whole libraries.
  const drawsImages = format === "post" || format === "image" || format === "video" || pipeline === "instagram_carousel_ai";
  if (drawsImages && !Array.isArray(mc.image_references) && draft.reference_image_libraries.length === 0) {
    mc.image_references = [];
  }
  if (format === "video") {
    mc.video_config_defaults = {
      source: "prompt_only",
      orientation: "portrait",
      voiceMode: "voiceover",
      imageMode: "ai_generated",
      bRollEnabled: false,
      subtitleStyle: "tiktok_bounce",
      targetDuration: 45,
      ...(mc.video_config_defaults ?? {}),
    };
  }
  return { ...draft, pipeline, model_config: mc };
}

/** Switch a draft to another format, keeping everything that still applies. */
export function changeFormat(draft: StudioDraft, format: BlueprintFormat): StudioDraft {
  const current = draftFormat(draft);
  if (current === format) return draft;
  const pipeline = FORMATS[format].pipeline;
  let brief = draft.brief;
  let context = draft.context;
  // Empty blueprints (no prompt yet) become guided once they have a format.
  if (!brief && !draft.master_prompt.trim() && !draft.image_prompt.trim()) {
    brief = defaultBrief(format);
    context = context ?? DEFAULT_CONTEXT;
  } else if (brief && !brief.custom_prompt) {
    const fresh = defaultBrief(format);
    brief = {
      ...brief,
      platform: FORMATS[format].platforms.some((p) => p.id === brief!.platform) ? brief.platform : fresh.platform,
      shape: fresh.shape,
      goal: format === "image" ? null : brief.goal ?? fresh.goal,
      opening: format === "image" ? null : brief.opening ?? fresh.opening,
      rules: format === "image" ? fresh.rules : current === "image" ? fresh.rules : brief.rules,
    };
  }
  return recompile(withFormatDefaults({ ...draft, pipeline, brief, context }, format));
}

/** Fields to write to `blueprints`. */
export function draftToUpdate(id: string, draft: StudioDraft): UpdateBlueprintInput {
  const slots = parseAllPromptSlots(draft.master_prompt, draft.image_prompt || undefined, draft.director_prompt || undefined);
  const context = draft.context
    ? (Object.fromEntries(LIBRARY_KINDS.filter((k) => draft.context![k]).map((k) => [k, draft.context![k]])) as BlueprintContext)
    : null;
  return {
    id,
    name: draft.name.trim() || "Untitled blueprint",
    description: draft.description,
    pipeline: draft.pipeline ?? undefined,
    brief: draft.brief,
    context,
    master_prompt: draft.master_prompt,
    image_prompt: draft.image_prompt,
    director_prompt: draft.director_prompt,
    skip_image_generation: draft.skip_image_generation,
    reference_image_libraries: draft.reference_image_libraries,
    model_config: draft.model_config as any,
    structure: { slots },
  };
}
