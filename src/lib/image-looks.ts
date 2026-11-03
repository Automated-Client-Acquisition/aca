/**
 * Looks: a blueprint's set of visual styles. Each piece gets exactly one.
 * Stored on model_config.image_looks, with look_mode ("rotate" = take turns,
 * the default; "fixed" = always look_fixed_id). Mirrors
 * supabase/functions/_shared/image-looks.ts, which picks each piece's look at
 * dispatch and records it on generation_params.look.
 *
 * Blueprints set up before looks keep image_style / a Style reference; the
 * Studio shows those as looks and saves them as looks on the first edit.
 */
import { supabase } from "@/integrations/supabase/client";
import { IMAGE_STYLES, type ImageStyleId } from "@/lib/blueprint-brief";
import type { ImageReferenceSpec } from "@/lib/image-references";

export interface ImageLook {
  id: string;
  label: string;
  kind: "preset" | "reference";
  /** Preset looks: the Studio style id and its written direction. */
  preset?: string;
  direction?: string;
  /** Reference looks: 1-2 images of one style, and that style in words. */
  images?: string[];
  description?: string;
}

export type LookMode = "rotate" | "fixed";

/** What a piece records about its look (generation_params.look). */
export interface PieceLook {
  id: string;
  label: string;
  kind: ImageLook["kind"];
}

/** A blueprint's model_config, as far as looks are concerned. */
type ModelConfig = Record<string, unknown> | null | undefined;

export const MAX_LOOKS = 6;
export const MAX_LOOK_IMAGES = 2;

export const PRESET_STYLES = IMAGE_STYLES.filter((s) => s.id !== "auto");

export function newLookId(): string {
  return `look_${Math.random().toString(36).slice(2, 10)}`;
}

function isUsable(value: unknown): value is ImageLook {
  const look = value as Partial<ImageLook> | null;
  if (!look || typeof look.id !== "string" || !look.id) return false;
  if (look.kind === "preset") return typeof look.direction === "string" && look.direction.trim().length > 0;
  if (look.kind === "reference") return Array.isArray(look.images) && look.images.some((u: unknown) => typeof u === "string" && u);
  return false;
}

/** Saved looks, or null when the blueprint was never given looks. */
export function getImageLooks(modelConfig: ModelConfig): ImageLook[] | null {
  const looks = modelConfig?.image_looks;
  return Array.isArray(looks) ? looks.filter(isUsable) : null;
}

export function lookMode(modelConfig: ModelConfig): LookMode {
  return modelConfig?.look_mode === "fixed" ? "fixed" : "rotate";
}

export function presetLook(styleId: ImageStyleId): ImageLook {
  const style = IMAGE_STYLES.find((s) => s.id === styleId);
  return { id: newLookId(), label: style?.label ?? "Look", kind: "preset", preset: styleId, direction: style?.direction ?? "" };
}

/** The looks a pre-looks blueprint implies: its image style, then its style references. */
export function legacyLooks(modelConfig: ModelConfig): ImageLook[] {
  const mc = modelConfig ?? {};
  const looks: ImageLook[] = [];
  const style = IMAGE_STYLES.find((s) => s.id === mc.image_style && s.id !== "auto");
  if (style) {
    const direction = typeof mc.image_style_direction === "string" && mc.image_style_direction ? mc.image_style_direction : style.direction;
    looks.push({ id: `legacy_${style.id}`, label: style.label, kind: "preset", preset: style.id, direction });
  }
  const refs = Array.isArray(mc.image_references) ? (mc.image_references as ImageReferenceSpec[]) : [];
  for (const r of refs) {
    const images = (r.images ?? []).filter(Boolean).slice(0, MAX_LOOK_IMAGES);
    if (r.role !== "style" || images.length === 0) continue;
    looks.push({ id: `legacy_${r.id}`, label: r.label || "Style reference", kind: "reference", images });
  }
  return looks.filter(isUsable);
}

/** The looks the Studio shows: saved ones, else what the old settings imply. */
export function effectiveLooks(modelConfig: ModelConfig): ImageLook[] {
  return getImageLooks(modelConfig) ?? legacyLooks(modelConfig);
}

/**
 * model_config with these looks as its only style setting: the old single
 * image style and Style references are cleared so runs don't send two styles.
 */
export function withLooks<T extends Record<string, unknown>>(
  modelConfig: T,
  looks: ImageLook[],
  patch: { look_mode?: LookMode; look_fixed_id?: string | null } = {},
): T {
  const next: Record<string, unknown> = { ...modelConfig, image_looks: looks, ...patch };
  delete next.image_style;
  delete next.image_style_direction;
  if (Array.isArray(next.image_references)) {
    next.image_references = (next.image_references as ImageReferenceSpec[]).filter((r) => r.role !== "style");
  }
  if (next.look_fixed_id && !looks.some((l) => l.id === next.look_fixed_id)) delete next.look_fixed_id;
  if (next.look_fixed_id === null) delete next.look_fixed_id;
  return next as T;
}

/** The look the next piece gets (same rule as the backend's pickLooks). */
export function nextLook(modelConfig: ModelConfig, recentLookIds: string[]): ImageLook | null {
  const looks = effectiveLooks(modelConfig);
  if (looks.length === 0) return null;
  if (lookMode(modelConfig) === "fixed") return looks.find((l) => l.id === modelConfig?.look_fixed_id) ?? looks[0];
  let best = looks[0];
  let bestAge = -1;
  for (const look of looks) {
    const at = recentLookIds.indexOf(look.id);
    const age = at === -1 ? Number.POSITIVE_INFINITY : at;
    if (age > bestAge) {
      best = look;
      bestAge = age;
    }
  }
  return best;
}

/** A style reference's look in words (preview-blueprint describe_look). */
export async function describeLook(organizationId: string, images: string[]): Promise<string> {
  const { data, error } = await supabase.functions.invoke("preview-blueprint", {
    body: { organization_id: organizationId, action: "describe_look", images: images.slice(0, MAX_LOOK_IMAGES) },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || "Couldn't describe this look.");
  return String(data.description || "");
}

/** The look a piece used, from its generation_params. */
export function pieceLookOf(generationParams: Record<string, unknown> | null | undefined): PieceLook | null {
  const look = generationParams?.look as Partial<PieceLook> | undefined;
  return look && typeof look.id === "string" && typeof look.label === "string" ? (look as PieceLook) : null;
}

/** Swatches for preset looks (reference looks show their images). */
export const LOOK_SWATCH: Record<string, string> = {
  auto: "linear-gradient(135deg, hsl(var(--muted)), hsl(var(--muted-foreground) / 0.25))",
  quote_card: "radial-gradient(120% 90% at 20% 10%, #3B3226 0, #1B1E24 60%)",
  editorial_photo: "linear-gradient(160deg, #C9B9A0, #6D5B45)",
  diagram: "repeating-linear-gradient(90deg, #F2EFE9 0 14px, #D9D4CB 14px 15px), #F2EFE9",
  illustration: "radial-gradient(circle at 30% 40%, #F1D07E 0 22%, transparent 23%), linear-gradient(135deg, #7AA7D9, #3E6FB0)",
};
