/**
 * The Review screen's view of one content_output: what the piece is, what it
 * says and shows, and where it stands. Hides stage_data / data differences
 * between pipelines so the UI can show "a post" instead of three stage tabs.
 */
import { getPipelineStages } from "@/types/pipelineStages";
import { threadTweetsFromContent } from "@/lib/thread-text";

export type PieceKind = "post" | "carousel" | "image" | "article" | "thread" | "video";
export type PieceState = "generating" | "waiting" | "failed" | "ready" | "done" | "discarded";
export type StepStatus = "done" | "active" | "waiting" | "failed" | "todo";

export interface PieceStep {
  id: string;
  label: string;
  status: StepStatus;
}

export interface PieceSlide {
  url: string | null;
  text?: string;
  failed?: boolean;
}

export interface Piece {
  kind: PieceKind;
  state: PieceState;
  title: string;
  text: string;
  /** Where the main text is stored, for inline edits (threads store JSON posts). */
  textTarget: { where: "stage"; stageId: string; format?: "thread" } | { where: "data" } | null;
  /** Thread posts, in order. */
  tweets: string[];
  image: string | null;
  imageTarget: "stage" | "data" | null;
  imagePrompt: string;
  slides: PieceSlide[];
  steps: PieceStep[];
  /** The stage a person has to OK (or that the run stopped after). */
  waitingOn?: { stageId: string; label: string; next?: string; stalled: boolean };
  failure?: { stageId?: string; message: string };
  models: { label: string; model: string }[];
  autoApprove: boolean;
}

const ACTIVE = ["generating", "processing", "queued", "pending", "regenerating"];

const KIND_BY_PIPELINE: Record<string, PieceKind> = {
  social_media_post: "post",
  instagram_carousel: "carousel",
  instagram_carousel_ai: "carousel",
  image_only: "image",
  rich_article: "article",
  video_script: "article",
  tweet: "article",
  twitter_thread: "thread",
};

/** Plain-language step names; the pipeline's own labels are engineer-speak. */
const STEP_LABEL: Record<string, string> = {
  caption: "Writing the post",
  image_prompt: "Planning the image",
  image: "Drawing the image",
  carousel_content: "Writing the slides",
  carousel_slides: "Designing the slides",
  text: "Writing",
  thread_tweets: "Writing the thread",
};

const MODEL_LABEL: Record<string, string> = {
  thread_tweets: "Writing",
  caption: "Writing",
  image_prompt: "Image plan",
  image: "Image",
  carousel_content: "Slides",
  carousel_slides: "Slide design",
};

export function pieceKind(pipeline: string | null | undefined): PieceKind {
  if (!pipeline) return "article";
  return KIND_BY_PIPELINE[pipeline] ?? "video";
}

/** Pipelines the Review screen renders itself; the rest keep the stage editor. */
export function isReviewable(pipeline: string | null | undefined): boolean {
  return pieceKind(pipeline) !== "video";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function stepStatus(stage: any, autoApprove: boolean): StepStatus {
  const s = stage?.status;
  if (!stage || !s) return "todo";
  if (s === "approved" || s === "completed" || s === "complete" || s === "skipped") return "done";
  if (s === "failed" || s === "error") return "failed";
  if (ACTIVE.includes(s)) return "active";
  if (s === "awaiting_approval") return autoApprove ? "active" : "waiting";
  return "todo";
}

export function toPiece(output: any): Piece {
  const pipeline: string = output?.pipeline ?? "";
  const kind = pieceKind(pipeline);
  const sd: Record<string, any> = output?.stage_data ?? {};
  const data: Record<string, any> = output?.data ?? {};
  const params: Record<string, any> = output?.generation_params ?? {};
  const autoApprove = !!(output?.autopilot_id || params.auto_approve_all);

  const title = str(data.title) || str(output?.content_ideas?.title) || "Untitled";

  // Stages this output actually runs.
  const allStages = pipeline ? getPipelineStages(pipeline as any) : [];
  const resolved: string[] | undefined = params.pipeline_stages;
  const stages = resolved?.length ? allStages.filter((s) => resolved.includes(s.id)) : allStages;
  const multiStage = stages.length > 1;

  let text = "";
  let textTarget: Piece["textTarget"] = null;
  let image: string | null = null;
  let imageTarget: Piece["imageTarget"] = null;
  let imagePrompt = "";
  let slides: PieceSlide[] = [];
  let tweets: string[] = [];

  if (kind === "post" || kind === "carousel") {
    text = str(sd.caption?.content);
    textTarget = { where: "stage", stageId: "caption" };
  } else if (kind === "thread") {
    tweets = threadTweetsFromContent(sd.thread_tweets?.content);
    text = tweets.join("\n\n");
    textTarget = { where: "stage", stageId: "thread_tweets", format: "thread" };
  } else if (kind === "article") {
    text = str(data.text) || str(data.content) || str(sd.text?.content);
    textTarget = sd.text?.content && !data.text ? { where: "stage", stageId: "text" } : { where: "data" };
  }

  if (kind === "post" || kind === "image") {
    image = str(sd.image?.url) || str(sd.image?.image_url) || str(data.image_url) || null;
    imageTarget = "stage";
    // A post's image.prompt can be the writing brief (when its image plan came
    // back empty); only reuse a real plan and let the backend describe the post otherwise.
    imagePrompt =
      kind === "post"
        ? str(sd.image_prompt?.content)
        : str(sd.image?.prompt) || str(params.resolved_image_prompt) || str(params.image_prompt);
  } else if (kind === "article") {
    image = str(data.image_url) || str(data.imageUrl) || null;
    imageTarget = "data";
    imagePrompt = str(data.image_prompt) || str(params.image_prompt);
  } else if (kind === "carousel") {
    const slideTexts: any[] = Array.isArray(sd.carousel_content?.slides) ? sd.carousel_content.slides : [];
    const slideText = (t: any) => [str(t?.headline), str(t?.body)].filter(Boolean).join(": ");
    const drawn: any[] = Array.isArray(sd.carousel_slides?.slides) ? sd.carousel_slides.slides : [];
    slides = (drawn.length ? drawn : slideTexts).map((s: any, i: number) => ({
      url: str(s?.image_url) || null,
      text: slideText(slideTexts[i]) || slideText(s),
      failed: s?.status === "failed",
    }));
    image = slides.find((s) => s.url)?.url ?? null;
  }

  const steps: PieceStep[] = multiStage
    ? stages.map((s) => ({ id: s.id, label: STEP_LABEL[s.id] ?? s.label, status: stepStatus(sd[s.id], autoApprove) }))
    : [{ id: stages[0]?.id ?? "text", label: STEP_LABEL.text, status: ACTIVE.includes(output?.status) ? "active" : output?.status === "failed" ? "failed" : "done" }];

  // Carousel: every slide approved means the stage is done even if its own status lags.
  const carouselSlides = sd.carousel_slides?.slides;
  const slidesAllApproved = Array.isArray(carouselSlides) && carouselSlides.length > 0 && carouselSlides.every((s: any) => s?.status === "approved");
  if (slidesAllApproved) {
    const st = steps.find((s) => s.id === "carousel_slides");
    if (st) st.status = "done";
  }

  const models: Piece["models"] = [];
  for (const s of stages) {
    const model = str(sd[s.id]?.model);
    // "template" marks a step filled from the blueprint without a model call.
    if (model && model !== "template") models.push({ label: MODEL_LABEL[s.id] ?? s.label, model });
  }
  if (!models.length) {
    const tl = str(params.model_config?.text_llm?.model_id);
    if (tl) models.push({ label: "Writing", model: tl });
  }

  // ── State ──
  const status: string = output?.status ?? "";
  let state: PieceState;
  let waitingOn: Piece["waitingOn"];
  let failure: Piece["failure"];

  const failedStep = steps.find((s) => s.status === "failed");
  const complete =
    output?.current_stage === "complete" || slidesAllApproved || (!multiStage && status === "review") || steps.every((s) => s.status === "done");

  if (status === "rejected") {
    state = "discarded";
  } else if (status === "failed" || status === "error" || (failedStep && !steps.some((s) => s.status === "active"))) {
    state = "failed";
    const stageErr = failedStep ? str(sd[failedStep.id]?.error) || str(sd[failedStep.id]?.error_message) : "";
    failure = { stageId: failedStep?.id, message: str(output?.error_message) || stageErr || "This piece failed to generate." };
  } else if (ACTIVE.includes(status) || steps.some((s) => s.status === "active")) {
    state = "generating";
  } else if (status === "approved") {
    state = "done";
  } else if (complete) {
    state = "ready";
  } else {
    // Stopped mid-way: either waiting on a person's OK, or a stage finished and the next never started.
    const idx = steps.findIndex((s) => s.status === "waiting");
    const waitingIdx = idx >= 0 ? idx : Math.max(0, steps.findIndex((s) => s.status !== "done") - 1);
    const stalled = idx < 0;
    const at = steps[waitingIdx];
    if (at) {
      state = "waiting";
      waitingOn = { stageId: at.id, label: at.label, next: steps[waitingIdx + 1]?.label, stalled };
    } else {
      state = "ready";
    }
  }

  return { kind, state, title, text, textTarget, tweets, image, imageTarget, imagePrompt, slides, steps, waitingOn, failure, models, autoApprove };
}

/** Everything a person can copy out of the piece. */
export function pieceCopyText(piece: Piece): string {
  if (piece.kind === "carousel" && piece.slides.some((s) => s.text)) {
    return [piece.text, ...piece.slides.map((s, i) => (s.text ? `Slide ${i + 1}: ${s.text}` : ""))].filter(Boolean).join("\n\n");
  }
  return piece.text;
}

export const STATE_LABEL: Record<PieceState, string> = {
  generating: "Making it",
  waiting: "Needs your OK",
  failed: "Failed",
  ready: "Ready",
  done: "Done",
  discarded: "Discarded",
};

function downloadName(piece: Piece, url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.slice(0, 4) || "png";
  const base = piece.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "image";
  return `${base}.${ext}`;
}

/** Save the image with a readable file name (falls back to opening it). */
export async function downloadImage(piece: Piece, url: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = downloadName(piece, url);
    a.click();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}
