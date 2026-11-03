import type { Blueprint } from "@/types/blueprint";
import { formatForPipeline } from "@/lib/blueprint-brief";
import { parseAllPromptSlots } from "@/lib/blueprintUtils";

type RoutableBlueprint = Pick<Blueprint, "id" | "pipeline" | "model_config"> &
  Partial<Pick<Blueprint, "master_prompt" | "image_prompt" | "director_prompt" | "reference_image_libraries">>;

/**
 * Can the one-screen Run composer handle this blueprint, or does it need the
 * classic wizard (source uploads, style-reference images, blocks)?
 */
export function supportsRunComposer(blueprint: Omit<RoutableBlueprint, "id">): boolean {
  const format = formatForPipeline(blueprint.pipeline);
  if (!format) return false;
  if (format === "video") {
    // URL, upload and recording sources need the wizard's source inputs.
    const source = blueprint.model_config?.video_config_defaults?.source;
    if (source && source !== "prompt_only") return false;
  }
  // Style references and blocks are picked per run in the wizard.
  const refs = blueprint.reference_image_libraries ?? [];
  if (refs.includes("library_images") || refs.includes("library_blocks")) return false;
  const slots = parseAllPromptSlots(blueprint.master_prompt ?? "", blueprint.image_prompt, blueprint.director_prompt);
  if (slots.some((s) => s.library_table === "library_blocks" || s.library_table === "library_images")) return false;
  return true;
}

export function runPath(blueprint: RoutableBlueprint, ideaIds?: string[]): string {
  const ideas = ideaIds?.length ? `ideas=${ideaIds.join(",")}` : "";
  if (supportsRunComposer(blueprint)) return `/blueprints/${blueprint.id}/run${ideas ? `?${ideas}` : ""}`;
  return `/create?blueprint=${blueprint.id}${ideas ? `&${ideas}` : ""}`;
}

export function editPath(blueprint: Pick<Blueprint, "id">): string {
  return `/blueprints/${blueprint.id}`;
}

/** An autopilot's editor. */
export function autopilotPath(autopilot: { id: string }): string {
  return `/autopilots/${autopilot.id}`;
}

/** A new autopilot, optionally starting from a blueprint and/or an account. */
export function newAutopilotPath(opts: { blueprintId?: string; accountId?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.blueprintId) params.set("blueprint", opts.blueprintId);
  if (opts.accountId) params.set("account", opts.accountId);
  const query = params.toString();
  return `/autopilots/new${query ? `?${query}` : ""}`;
}

/** Autopilots that make this blueprint, running ones first, then newest. */
export function autopilotsForBlueprint<
  T extends { status: string; created_at: string; content_mix?: Array<{ blueprint_id: string; enabled?: boolean }> | null },
>(autopilots: T[] | undefined, blueprintId: string): T[] {
  return (autopilots ?? [])
    .filter((a) => a.status !== "archived" && (a.content_mix ?? []).some((m) => m.blueprint_id === blueprintId && m.enabled !== false))
    .sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || b.created_at.localeCompare(a.created_at));
}
