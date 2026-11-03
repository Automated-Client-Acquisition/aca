/**
 * Is a blueprint ready to run? Pure rules shared by the Blueprints list,
 * the Studio's readiness pill and the Run preflight, so all three agree.
 * Mirrors the checks dispatch-generation-job makes before it will run a job.
 */
import type { Blueprint } from "@/types/blueprint";
import { getRequiredProviders, isHardRequirement, providerLabel } from "@/lib/required-api-keys";
import { getRequiredLibraryTables } from "@/lib/blueprintUtils";
import { KIND_ASSETS_TAB, KIND_LABEL, LIBRARY_KINDS, TABLE_KIND, parseBlueprintContext, type LibraryKind } from "@/lib/blueprint-context";
import { humanizeGenerationError } from "@/lib/generation-errors";
import { getImageReferences, kindsNeededByReferences } from "@/lib/image-references";
import { autopilotPath } from "@/lib/blueprint-routes";

export type HealthStatus = "ready" | "needs_setup" | "failing";

export interface HealthIssue {
  /** blocker: a run would fail. warning: runs work, something needs attention. */
  severity: "blocker" | "warning";
  status: Exclude<HealthStatus, "ready">;
  message: string;
  action?: { label: string; href?: string; fix?: "switch_to_balanced" };
}

export interface BlueprintHealth {
  status: HealthStatus;
  issues: HealthIssue[];
  /** The one line to show on a card. */
  headline: string | null;
}

export interface BlueprintRunStats {
  runs: number;
  succeeded: number;
  failed: number;
  in_progress: number;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  failed_in_last_two: number;
}

export interface HealthEnvironment {
  apiKeys: Array<{ provider: string; is_valid: boolean | null; last_validated: string | null }>;
  hasActiveStorage: boolean;
  /** model_id → is_active, for OpenRouter models referenced by blueprints. Missing = unknown (assume fine). */
  modelActive: Map<string, boolean>;
  libraryCounts: Record<LibraryKind, number>;
  pausedAutopilots: Array<{ id: string; name: string; paused_reason: string | null; blueprintIds: string[] }>;
}

const NEEDS_STORAGE = new Set([
  "social_media_post", "instagram_carousel", "instagram_carousel_ai", "rich_article", "image_only",
  "ugc_video", "ugc_heygen", "ugc_heygen_template", "generative_video_oneshot",
  "storyboard_video_longform", "presenter_video", "video_remix", "video",
]);

// dispatch-generation-job lets an Ollama text model stand in for OpenRouter on
// these pipelines only; every other provider still needs the OpenRouter key.
const OLLAMA_EXEMPT_PIPELINES = new Set(["social_media_post", "instagram_carousel", "instagram_carousel_ai", "video_script", "rich_article", "twitter_thread"]);

/**
 * dispatch-generation-job also requires a key for every provider the blueprint's
 * model_config declares (e.g. tts → ElevenLabs on video, image_generator →
 * OpenAI), skipping slots the pipeline never runs. Mirrors SLOT_PIPELINES /
 * KEYED_PROVIDERS there.
 */
const KEYED_PROVIDERS: Record<string, string> = {
  openrouter: "OpenRouter",
  replicate: "Replicate",
  elevenlabs: "ElevenLabs",
  heygen: "HeyGen",
  openai: "OpenAI",
};
const SLOT_PIPELINES: Record<string, string[]> = {
  tts: ["ugc_video", "storyboard_video_longform", "presenter_video", "video_remix", "video"],
  heygen_video: ["ugc_heygen", "ugc_heygen_template"],
  heygen_template: ["ugc_heygen", "ugc_heygen_template"],
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "recently";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function evaluateBlueprintHealth(
  blueprint: Pick<Blueprint, "id" | "pipeline" | "master_prompt" | "image_prompt" | "director_prompt" | "reference_image_libraries" | "model_config" | "context" | "skip_image_generation">,
  env: HealthEnvironment,
  stats?: BlueprintRunStats | null,
): BlueprintHealth {
  const issues: HealthIssue[] = [];
  const edit = { label: "Edit", href: `/blueprints/${blueprint.id}` };
  const pipeline = blueprint.pipeline ?? "";

  if (!pipeline) {
    issues.push({ severity: "blocker", status: "needs_setup", message: "Pick a format to finish this blueprint.", action: edit });
  }
  const isImageOnly = pipeline === "image_only";
  const hasPrompt = isImageOnly ? !!blueprint.image_prompt?.trim() : !!blueprint.master_prompt?.trim();
  if (pipeline && !hasPrompt) {
    issues.push({ severity: "blocker", status: "needs_setup", message: "Write the brief to finish this blueprint.", action: edit });
  }

  // API keys, same rules as dispatch-generation-job.
  const textCfg = blueprint.model_config?.text_llm;
  const textOnOllama = textCfg?.provider === "ollama" || String(textCfg?.model_id ?? "").startsWith("ollama:");
  for (const provider of getRequiredProviders(pipeline)) {
    if (!isHardRequirement(provider)) continue;
    if (provider === "openrouter" && textOnOllama && OLLAMA_EXEMPT_PIPELINES.has(pipeline)) continue;
    const row = env.apiKeys.find((k) => k.provider === provider);
    const keys = { label: "Fix key", href: "/settings?tab=integrations" };
    if (!row) {
      issues.push({ severity: "blocker", status: "needs_setup", message: `Add a ${providerLabel(provider)} API key to run this.`, action: { ...keys, label: "Add key" } });
    } else if (row.is_valid === false) {
      issues.push({ severity: "blocker", status: "failing", message: `${providerLabel(provider)} rejected your API key on ${formatDate(row.last_validated)}.`, action: keys });
    }
  }

  // Providers the model settings name (dispatch fails the run without their key).
  const flagged = new Set(issues.map((i) => i.message));
  for (const [slot, cfg] of Object.entries((blueprint.model_config ?? {}) as Record<string, any>)) {
    const onlyFor = SLOT_PIPELINES[slot];
    if (onlyFor && !onlyFor.includes(pipeline)) continue;
    const provider = cfg && typeof cfg === "object" ? String(cfg.provider ?? "") : "";
    const label = KEYED_PROVIDERS[provider];
    if (!label) continue;
    const row = env.apiKeys.find((k) => k.provider === provider);
    const keys = { label: "Fix key", href: "/settings?tab=integrations" };
    const message = !row
      ? `Add a ${label} API key to run this. The blueprint's ${slot === "tts" ? "voice" : slot === "image_generator" ? "image model" : "model settings"} use${slot === "tts" ? "s" : ""} ${label}.`
      : row.is_valid === false
        ? `${label} rejected your API key on ${formatDate(row.last_validated)}.`
        : "";
    if (!message || flagged.has(message) || [...flagged].some((m) => m.startsWith(`Add a ${label} API key`) || m.startsWith(`${label} rejected`))) continue;
    flagged.add(message);
    issues.push({ severity: "blocker", status: row ? "failing" : "needs_setup", message, action: row ? keys : { ...keys, label: "Add key" } });
  }

  if (NEEDS_STORAGE.has(pipeline) && !env.hasActiveStorage) {
    issues.push({ severity: "blocker", status: "needs_setup", message: "Connect cloud storage so images and videos have somewhere to go.", action: { label: "Connect storage", href: "/settings?tab=storage" } });
  }

  // Withdrawn models.
  for (const slot of ["text_llm", "image_generator"] as const) {
    const cfg = blueprint.model_config?.[slot];
    if (!cfg?.model_id || (cfg.provider && cfg.provider !== "openrouter")) continue;
    if (env.modelActive.get(cfg.model_id) === false) {
      issues.push({
        severity: "blocker",
        status: "failing",
        message: `${cfg.model_id} is no longer available.`,
        action: { label: "Switch to Balanced", fix: "switch_to_balanced" },
      });
    }
  }

  // Context the blueprint needs but the Brand Kit doesn't have.
  const context = parseBlueprintContext(blueprint.context);
  const neededKinds = new Set<LibraryKind>();
  for (const kind of LIBRARY_KINDS) if (context?.[kind]?.mode === "always") neededKinds.add(kind);
  if (!context && pipeline) {
    for (const table of getRequiredLibraryTables(blueprint)) {
      const kind = TABLE_KIND[table];
      if (kind) neededKinds.add(kind);
    }
  }
  for (const kind of kindsNeededByReferences(getImageReferences(blueprint.model_config as any))) neededKinds.add(kind);
  for (const kind of neededKinds) {
    if (env.libraryCounts[kind] === 0) {
      issues.push({
        severity: "blocker",
        status: "needs_setup",
        message: `This blueprint uses a ${KIND_LABEL[kind].toLowerCase()}, and the Brand Kit has none yet.`,
        action: { label: "Open Brand Kit", href: `/assets?tab=${KIND_ASSETS_TAB[kind]}` },
      });
    }
  }

  // Recent outcomes.
  if (stats && stats.failed_in_last_two >= 2) {
    issues.push({
      severity: "warning",
      status: "failing",
      message: `The last 2 runs failed: ${humanizeGenerationError(stats.last_error)}`,
    });
  }

  for (const ap of env.pausedAutopilots) {
    if (!ap.blueprintIds.includes(blueprint.id) || !ap.paused_reason) continue;
    issues.push({
      severity: "warning",
      status: "failing",
      message: `Autopilot "${ap.name}" paused: ${ap.paused_reason}`,
      action: { label: "Open autopilot", href: autopilotPath(ap) },
    });
  }

  const status: HealthStatus = issues.some((i) => i.status === "failing")
    ? "failing"
    : issues.some((i) => i.status === "needs_setup")
      ? "needs_setup"
      : "ready";
  const lead = issues.find((i) => i.status === status) ?? null;
  return { status, issues, headline: lead?.message ?? null };
}

export const HEALTH_LABEL: Record<HealthStatus, string> = {
  ready: "Ready",
  needs_setup: "Needs setup",
  failing: "Failing",
};
