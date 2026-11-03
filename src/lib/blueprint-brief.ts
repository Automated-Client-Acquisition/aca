/**
 * Blueprint Studio brief: the plain-language fields a user fills in, and the
 * compiler that turns them into the master_prompt / image_prompt the
 * generation pipeline already runs. The backend never reads `brief`; it only
 * sees the compiled prompts, so every pipeline, autopilot, MCP tool and API
 * call keeps working unchanged.
 *
 * Template syntax used here is the subset dispatch-generation-job resolves:
 * {{var}}, {{lib.field}}, and {{#path}}…{{/path}} / {{^path}}…{{/path}}
 * sections that drop when the value is empty (renderPromptSections).
 * Image prompts for social posts are substituted by execute-stage with flat
 * keys only, so compiled image prompts avoid dotted paths and sections.
 */
import type { PipelineId } from "@/types/pipeline";
import type { BlueprintContext, ContextMode, LibraryKind } from "@/lib/blueprint-context";

// ─── Formats ────────────────────────────────────────────────────────────────

export type BlueprintFormat = "post" | "carousel" | "article" | "thread" | "video" | "image";

export const FORMAT_ORDER: BlueprintFormat[] = ["post", "carousel", "article", "video", "image", "thread"];

export interface FormatMeta {
  label: string;
  hint: string;
  /** Default pipeline for new blueprints of this format. */
  pipeline: PipelineId;
  /** Does the format generate visuals (so Look + visual references apply)? */
  visual: boolean;
  platforms: Array<{ id: string; label: string }>;
  defaultShape: string[];
  lengths: Record<BriefLength, string>;
}

export const FORMATS: Record<BlueprintFormat, FormatMeta> = {
  post: {
    label: "Social post",
    hint: "Text, optional image",
    pipeline: "social_media_post",
    visual: true,
    platforms: [
      { id: "linkedin", label: "LinkedIn" },
      { id: "instagram", label: "Instagram" },
      { id: "x", label: "X" },
      { id: "facebook", label: "Facebook" },
    ],
    defaultShape: ["Hook", "A story or example", "The lesson", "Call to action"],
    lengths: { short: "~120 words", medium: "~220 words", long: "~400 words" },
  },
  carousel: {
    label: "Carousel",
    hint: "5 to 10 slides",
    pipeline: "instagram_carousel",
    visual: true,
    platforms: [
      { id: "linkedin", label: "LinkedIn" },
      { id: "instagram", label: "Instagram" },
    ],
    defaultShape: ["Cover slide with the hook", "One idea per slide", "Summary slide", "Call to action slide"],
    lengths: { short: "Headlines only", medium: "Headline + 1 line", long: "Headline + 2-3 lines" },
  },
  article: {
    label: "Article",
    hint: "Blog or newsletter",
    pipeline: "rich_article",
    visual: false,
    platforms: [
      { id: "blog", label: "Blog post" },
      { id: "newsletter", label: "Newsletter" },
      { id: "linkedin_article", label: "LinkedIn article" },
    ],
    defaultShape: ["Why this matters now", "The main points, each with an example", "Takeaways", "Call to action"],
    lengths: { short: "~600 words", medium: "~1,200 words", long: "~2,000 words" },
  },
  thread: {
    label: "X thread",
    hint: "Chained posts",
    pipeline: "twitter_thread",
    visual: false,
    platforms: [{ id: "x", label: "X" }],
    defaultShape: ["Hook post", "One point per post", "Recap", "Call to action"],
    lengths: { short: "4 posts", medium: "7 posts", long: "10 posts" },
  },
  video: {
    label: "Short video",
    hint: "Voice, captions, visuals",
    pipeline: "video",
    visual: true,
    platforms: [
      { id: "tiktok", label: "TikTok / Reels" },
      { id: "youtube_shorts", label: "YouTube Shorts" },
      { id: "linkedin", label: "LinkedIn" },
    ],
    defaultShape: ["Hook in the first 3 seconds", "The problem", "The insight", "Call to action"],
    lengths: { short: "~30 seconds", medium: "~45 seconds", long: "~60 seconds" },
  },
  image: {
    label: "Image",
    hint: "One visual, no caption",
    pipeline: "image_only",
    visual: true,
    platforms: [
      { id: "linkedin", label: "LinkedIn" },
      { id: "instagram", label: "Instagram" },
    ],
    defaultShape: [],
    lengths: { short: "", medium: "", long: "" },
  },
};

const PIPELINE_FORMAT: Partial<Record<string, BlueprintFormat>> = {
  social_media_post: "post",
  instagram_carousel: "carousel",
  instagram_carousel_ai: "carousel",
  rich_article: "article",
  twitter_thread: "thread",
  video: "video",
  image_only: "image",
};

/** The Studio format for a pipeline, or null for pipelines only the classic editor handles. */
export function formatForPipeline(pipeline: string | null | undefined): BlueprintFormat | null {
  return pipeline ? PIPELINE_FORMAT[pipeline] ?? null : null;
}

// ─── Brief ──────────────────────────────────────────────────────────────────

export type BriefGoal = "authority" | "calls" | "teach" | "story" | "promote";
export type BriefOpening = "bold_claim" | "question" | "number" | "story";
export type BriefLength = "short" | "medium" | "long";

export interface BlueprintBrief {
  version: 1;
  platform: string;
  goal: BriefGoal | null;
  opening: BriefOpening | null;
  shape: string[];
  length: BriefLength;
  /** Literal call to action; empty = the AI writes one per topic. */
  cta: string;
  rules: string[];
  /** Anything else, free text, appended as-is. For Image: what the picture shows. */
  notes: string;
  /** master_prompt was edited by hand: the fields no longer drive it. */
  custom_prompt?: boolean;
}

export const GOALS: Array<{ id: BriefGoal; label: string; line: string }> = [
  { id: "authority", label: "Build authority", line: "Build authority: share a sharp point of view, backed by specifics the reader can check." },
  { id: "calls", label: "Start sales conversations", line: "Start sales conversations: make the reader recognise their own problem and want to talk about it." },
  { id: "teach", label: "Teach a skill", line: "Teach one practical thing the reader can use today." },
  { id: "story", label: "Tell a story", line: "Tell a specific story with a clear lesson." },
  { id: "promote", label: "Promote the product", line: "Show the problem the product solves and one concrete result, without sounding like an ad." },
];

export const OPENINGS: Array<{ id: BriefOpening; label: string; line: string }> = [
  { id: "bold_claim", label: "Bold claim", line: "Open with a bold, specific claim." },
  { id: "question", label: "Question", line: "Open with a question the reader can't ignore." },
  { id: "number", label: "Surprising number", line: "Open with a surprising, specific number." },
  { id: "story", label: "Mid-story", line: "Open in the middle of a story." },
];

export const RULE_PRESETS = [
  "No em dashes",
  "Short paragraphs",
  "No corporate jargon",
  "Use specific numbers",
  "No hashtags",
  "No emojis",
];

export function defaultBrief(format: BlueprintFormat): BlueprintBrief {
  return {
    version: 1,
    platform: FORMATS[format].platforms[0]?.id ?? "",
    goal: format === "image" ? null : "authority",
    opening: format === "image" ? null : "bold_claim",
    shape: [...FORMATS[format].defaultShape],
    length: "medium",
    cta: "",
    rules: format === "image" ? ["No text in the image"] : ["No em dashes", "Short paragraphs", "No corporate jargon"],
    notes: "",
  };
}

export function parseBrief(raw: unknown): BlueprintBrief | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    version: 1,
    platform: typeof r.platform === "string" ? r.platform : "",
    goal: GOALS.some((g) => g.id === r.goal) ? (r.goal as BriefGoal) : null,
    opening: OPENINGS.some((o) => o.id === r.opening) ? (r.opening as BriefOpening) : null,
    shape: strArr(r.shape),
    length: r.length === "short" || r.length === "long" ? r.length : "medium",
    cta: typeof r.cta === "string" ? r.cta : "",
    rules: strArr(r.rules),
    notes: typeof r.notes === "string" ? r.notes : "",
    custom_prompt: r.custom_prompt === true,
  };
}

// ─── Look (stored on model_config) ───────────────────────────────────────────

export type ImageStyleId = "auto" | "quote_card" | "editorial_photo" | "diagram" | "illustration";

export const IMAGE_STYLES: Array<{ id: ImageStyleId; label: string; direction: string }> = [
  { id: "auto", label: "Match the post", direction: "" },
  {
    id: "quote_card",
    label: "Quote card",
    direction: "A clean typographic graphic: one short, punchy line from the post in large bold type on a plain or subtly textured background. Lots of empty space. No other text.",
  },
  {
    id: "editorial_photo",
    label: "Editorial photo",
    direction: "A natural, editorial-style photograph with real light and a candid feel. It should look like a real photo, not a stock image or an illustration. No text.",
  },
  {
    id: "diagram",
    label: "Simple diagram",
    direction: "A simple, clean diagram or framework that explains the post's main idea visually, with a few short labels at most. Flat, minimal, readable at phone size.",
  },
  {
    id: "illustration",
    label: "Illustration",
    direction: "A modern flat illustration with a limited colour palette and a single clear focal point. No text.",
  },
];

export type OutputShape = "square" | "portrait" | "landscape";

// ─── Compiler ─────────────────────────────────────────────────────────────────

const PLATFORM_NOUN: Record<string, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  x: "X",
  facebook: "Facebook",
  tiktok: "TikTok / Reels",
  youtube_shorts: "YouTube Shorts",
  blog: "blog post",
  newsletter: "newsletter issue",
  linkedin_article: "LinkedIn article",
};

const LENGTH_LINE: Record<BlueprintFormat, Record<BriefLength, string>> = {
  post: { short: "About 120 words.", medium: "About 220 words.", long: "About 400 words." },
  carousel: {
    short: "Each slide is a headline only, 8 words or fewer.",
    medium: "Each slide has a headline of 8 words or fewer plus one short sentence.",
    long: "Each slide has a headline of 8 words or fewer plus two or three short sentences.",
  },
  article: {
    short: "About 600 words. Use subheadings.",
    medium: "About 1,200 words. Use subheadings.",
    long: "About 2,000 words. Use subheadings.",
  },
  thread: {
    short: "4 posts, each under 280 characters.",
    medium: "7 posts, each under 280 characters.",
    long: "10 posts, each under 280 characters.",
  },
  video: {
    short: "About 30 seconds when read aloud (roughly 75 words).",
    medium: "About 45 seconds when read aloud (roughly 110 words).",
    long: "About 60 seconds when read aloud (roughly 150 words).",
  },
  image: { short: "", medium: "", long: "" },
};

function contextBlock(kind: LibraryKind, mode: ContextMode | undefined): string {
  if (!mode || mode === "off") return "";
  const gate = (path: string, body: string) => `{{#${path}}}${body}{{/${path}}}`;
  switch (kind) {
    case "brand": {
      const details =
        gate("brand.tone", "Tone: {{brand.tone}}\n") +
        gate("brand.style_guidelines", "Style guidelines: {{brand.style_guidelines}}\n");
      return mode === "always"
        ? `Voice: write as {{brand.name}}.\n${details}`
        : gate("brand.name", `Voice: if it suits the topic, write as {{brand.name}}.\n${details}`);
    }
    case "audience": {
      const details =
        gate("icp.description", "Who they are: {{icp.description}}\n") +
        gate("icp.pain_points", "What they struggle with: {{icp.pain_points}}\n") +
        gate("icp.desires", "What they want: {{icp.desires}}\n") +
        gate("icp.language_style", "How they talk: {{icp.language_style}}\n");
      return mode === "always"
        ? `Reader: {{icp.name}}.\n${details}`
        : gate("icp.name", `Reader: {{icp.name}}, if the topic is relevant to them.\n${details}`);
    }
    case "product": {
      const details =
        gate("product.description", "What it is: {{product.description}}\n") +
        gate("product.key_benefits", "Key benefits: {{product.key_benefits}}\n");
      return mode === "always"
        ? `Product to feature: {{product.name}}.\n${details}Show how it helps with the topic. Don't turn the piece into an ad.\n`
        : gate(
            "product.name",
            `Product: {{product.name}}.\n${details}Mention it only if it fits the topic naturally. Most pieces shouldn't mention it.\n`,
          );
    }
    case "person": {
      const line =
        "Speaker: {{character.name}}" +
        gate("character.speaking_style", ", who speaks {{character.speaking_style}}") +
        ".\n";
      return mode === "always" ? line : gate("character.name", line);
    }
  }
}

function ctaLine(brief: BlueprintBrief, format: BlueprintFormat): string {
  const where =
    format === "carousel" ? "Last slide" : format === "thread" ? "Last post" : format === "video" ? "Final line" : "Close";
  if (brief.cta.trim()) {
    return `${where}: end with this call to action, adapted to fit naturally: "${brief.cta.trim()}"`;
  }
  return `${where}: {{#ai_cta}}end with a call to action along the lines of: {{ai_cta}}{{/ai_cta}}{{^ai_cta}}end with one clear, low-effort call to action.{{/ai_cta}}`;
}

export interface CompileOptions {
  context: BlueprintContext | null;
  /** Carousel only: the slide count set in Look. */
  slideCount?: number;
  /** Image only: the Look image style, written into the image prompt. */
  imageStyleDirection?: string;
}

export interface CompiledPrompts {
  master_prompt: string;
  /** Only for the Image format; other formats keep their image_prompt as-is. */
  image_prompt?: string;
}

/** Turn a brief into the prompt(s) the pipeline runs. Pure; same input, same output. */
export function compileBrief(brief: BlueprintBrief, format: BlueprintFormat, opts: CompileOptions): CompiledPrompts {
  const ctx = opts.context ?? {};
  const platform = PLATFORM_NOUN[brief.platform] ?? brief.platform;
  const goal = GOALS.find((g) => g.id === brief.goal);
  const opening = OPENINGS.find((o) => o.id === brief.opening);
  const shape = brief.shape.map((s) => s.trim()).filter(Boolean);
  const rules = brief.rules.map((r) => r.trim()).filter(Boolean);
  const notes = brief.notes.trim();

  if (format === "image") {
    const parts = [
      notes ? `${notes}` : "An image about: {{topic}}",
      notes ? "Topic: {{topic}}" : "",
      opts.imageStyleDirection ? `Style: ${opts.imageStyleDirection}` : "",
      ctx.brand && ctx.brand.mode !== "off"
        ? "{{#brand.visual_style_description}}Brand look: {{brand.visual_style_description}}\n{{/brand.visual_style_description}}"
        : "",
      ctx.product && ctx.product.mode !== "off"
        ? "{{#product.name}}Show {{product.name}} if it fits.\n{{/product.name}}"
        : "",
      rules.length ? rules.map((r) => `${r}.`).join(" ") : "",
    ].filter(Boolean);
    const prompt = parts.join("\n").replace(/\.\./g, ".");
    return { master_prompt: prompt, image_prompt: prompt };
  }

  const opener: Record<Exclude<BlueprintFormat, "image">, string> = {
    post: `Write a ${platform} post about: {{topic}}`,
    carousel: `Create a ${platform} carousel${opts.slideCount ? ` of ${opts.slideCount} slides` : ""} about: {{topic}}`,
    article: `Write a ${platform} about: {{topic}}`,
    thread: "Write an X thread about: {{topic}}",
    video: `Write the spoken script for a ${platform} video about: {{topic}}`,
  };

  const sections: string[] = [];
  sections.push(`${opener[format]}\n{{#idea_text}}Notes on this topic: {{idea_text}}\n{{/idea_text}}`);

  if (goal) sections.push(`Goal: ${goal.line}`);

  if (opening) {
    const where = format === "carousel" ? "Cover slide" : format === "article" ? "First paragraph" : "Opening";
    sections.push(
      `${where}: ${opening.line}\n{{#ai_hook}}Angle to build it from (reword it, don't copy it): {{ai_hook}}\n{{/ai_hook}}`,
    );
  }

  if (shape.length) {
    const label = format === "carousel" ? "Slides" : format === "article" ? "Sections" : format === "thread" ? "Sequence" : "Structure";
    sections.push(`${label}:\n${shape.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }

  // The idea's guidelines: points to make, what not to mention, and the rule
  // to only state facts from them (see _shared/idea-guidelines.ts).
  sections.push("{{#ai_guidelines}}{{ai_guidelines}}\n{{/ai_guidelines}}");

  const length = LENGTH_LINE[format][brief.length];
  if (length) sections.push(`Length: ${length}`);

  const context = (["brand", "audience", "product", "person"] as LibraryKind[])
    .map((kind) => contextBlock(kind, ctx[kind]?.mode))
    .filter(Boolean)
    .join("\n");
  if (context) sections.push(context.trimEnd());

  sections.push(ctaLine(brief, format));

  const allRules = [...rules];
  if (format === "thread") allRules.push("Put each post on its own line block, numbered like 1/, 2/, 3/");
  if (allRules.length) sections.push(`Rules:\n${allRules.map((r) => `- ${r}.`).join("\n").replace(/\.\.$/gm, ".")}`);

  if (notes) sections.push(`Also: ${notes}`);

  const returnLine: Record<Exclude<BlueprintFormat, "image">, string> = {
    post: "Return only the post text. No title, no preamble, no quotation marks around it.",
    carousel: "Return only the slide copy, slide by slide.",
    article: "Return only the article, starting with its headline.",
    thread: "Return only the thread.",
    video: "Return only the words to be spoken. No stage directions, no scene labels.",
  };
  sections.push(returnLine[format]);

  return { master_prompt: sections.join("\n\n") };
}

// ─── Quality tiers (model_config) ─────────────────────────────────────────────

export type QualityTier = "fast" | "balanced" | "best";

const TEXT_MODEL: Record<QualityTier, string> = {
  fast: "anthropic/claude-haiku-4.5",
  balanced: "anthropic/claude-sonnet-4.5",
  best: "anthropic/claude-opus-4.7",
};

const IMAGE_MODEL: Record<QualityTier, string> = {
  fast: "google/gemini-3.1-flash-image-preview",
  balanced: "google/gemini-3.1-flash-image-preview",
  best: "openai/gpt-5.4-image-2",
};

export const QUALITY_TIERS: Array<{ id: QualityTier; label: string; blurb: string }> = [
  { id: "fast", label: "Fast", blurb: "Claude Haiku 4.5 writes; Gemini Flash Image draws. Cheapest." },
  { id: "balanced", label: "Balanced", blurb: "Claude Sonnet 4.5 writes; Gemini Flash Image draws." },
  { id: "best", label: "Best", blurb: "Claude Opus 4.7 writes; GPT Image draws. Slowest and priciest." },
];

/** Model used for Studio previews: fast and cheap, text only. */
export const PREVIEW_MODEL = TEXT_MODEL.fast;

type ModelConfigLike = Record<string, any>;

/** Write the tier's models into model_config, keeping every other setting. */
export function applyQualityTier(modelConfig: ModelConfigLike, tier: QualityTier, format: BlueprintFormat, pipeline: string): ModelConfigLike {
  const next: ModelConfigLike = { ...modelConfig, quality: tier };
  const prevText = modelConfig.text_llm ?? {};
  next.text_llm = {
    provider: "openrouter",
    model_id: TEXT_MODEL[tier],
    parameters: { temperature: 0.7, max_tokens: 4096, ...(prevText.parameters ?? {}) },
  };
  const makesImages = format === "post" || format === "image" || pipeline === "instagram_carousel_ai" || format === "video";
  if (makesImages) {
    // AI carousels thread reference images through the Gemini path; keep them there.
    const imageModel = pipeline === "instagram_carousel_ai" ? IMAGE_MODEL.balanced : IMAGE_MODEL[tier];
    const prevImage = modelConfig.image_generator ?? {};
    next.image_generator = {
      provider: "openrouter",
      model_id: imageModel,
      parameters: { ...(prevImage.parameters ?? {}) },
    };
  }
  if (format === "video" && !next.tts?.model_id) {
    next.tts = { provider: "elevenlabs", model_id: "eleven_multilingual_v2", parameters: {} };
  }
  return next;
}

/** Which tier a model_config matches, or "custom" when the models were picked by hand. */
export function detectQualityTier(modelConfig: ModelConfigLike | null | undefined): QualityTier | "custom" {
  const text = modelConfig?.text_llm?.model_id;
  if (!text) return "balanced";
  const tier = (Object.keys(TEXT_MODEL) as QualityTier[]).find((t) => TEXT_MODEL[t] === text);
  if (!tier) return "custom";
  if (modelConfig?.quality && modelConfig.quality !== tier) return "custom";
  // AI carousels always draw with the Balanced image model, whatever the tier.
  const image = modelConfig?.image_generator?.model_id;
  if (image && image !== IMAGE_MODEL[tier] && image !== IMAGE_MODEL.balanced) return "custom";
  return tier;
}
