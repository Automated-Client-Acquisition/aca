/**
 * Looks: a blueprint's set of visual styles. Each piece gets exactly one.
 *
 * model_config.image_looks lists them and model_config.look_mode says how a
 * piece gets one:
 *   - rotate (default): least recently used first, over this autopilot's recent
 *     pieces (a manual run: this blueprint's). Not random: a random pick repeats,
 *     the same trap the idea pool fell into.
 *   - fixed: always model_config.look_fixed_id (else the first look).
 * A run can force one look with configuration.look_id.
 *
 * A look is a preset (a written direction such as "quote card") or a style
 * reference (1-2 images of one style). Never two looks in one request: two
 * different style references blend into neither.
 *
 * Mirrored in src/lib/image-looks.ts. dispatch-generation-job picks the look
 * and writes it into the piece's generation_params.model_config as the fields
 * the stages already read (image_style_direction, or one style entry in
 * image_references), and records it as generation_params.look.
 */
import type { ImageReferenceSpec } from './image-references.ts';
import { leastRecent } from './least-recent.ts';

export interface ImageLook {
  id: string;
  label: string;
  kind: 'preset' | 'reference';
  /** Preset looks: the Studio style id (display only) and its written direction. */
  preset?: string;
  direction?: string;
  /** Reference looks: 1-2 images of one style, and that style in words. */
  images?: string[];
  description?: string;
}

export type LookMode = 'rotate' | 'fixed';

/** What a piece records about its look (generation_params.look). */
export interface PieceLook {
  id: string;
  label: string;
  kind: ImageLook['kind'];
}

export const MAX_LOOK_IMAGES = 2;

function isUsable(look: any): look is ImageLook {
  if (!look || typeof look.id !== 'string' || !look.id) return false;
  if (look.kind === 'preset') return typeof look.direction === 'string' && look.direction.trim().length > 0;
  if (look.kind === 'reference') return Array.isArray(look.images) && look.images.some((u: unknown) => typeof u === 'string' && u);
  return false;
}

/** The blueprint's usable looks, in their saved order. */
export function getImageLooks(modelConfig: Record<string, unknown> | null | undefined): ImageLook[] {
  const looks = (modelConfig as any)?.image_looks;
  return Array.isArray(looks) ? looks.filter(isUsable) : [];
}

export function lookMode(modelConfig: Record<string, unknown> | null | undefined): LookMode {
  return (modelConfig as any)?.look_mode === 'fixed' ? 'fixed' : 'rotate';
}

/**
 * One look per piece for the next `count` pieces. `recentLookIds` is the look
 * of each recent piece, most recent first. Rotation takes the look unused the
 * longest (never used first, then saved order), and counts its own picks so
 * several pieces in one job get different looks.
 */
export function pickLooks(
  modelConfig: Record<string, unknown> | null | undefined,
  count: number,
  recentLookIds: string[] = [],
  forcedLookId?: string | null,
): ImageLook[] {
  const looks = getImageLooks(modelConfig);
  if (looks.length === 0 || count <= 0) return [];

  const forced = forcedLookId ? looks.find((l) => l.id === forcedLookId) : undefined;
  if (forced) return Array.from({ length: count }, () => forced);

  if (lookMode(modelConfig) === 'fixed') {
    const fixedId = (modelConfig as any)?.look_fixed_id;
    const fixed = looks.find((l) => l.id === fixedId) ?? looks[0];
    return Array.from({ length: count }, () => fixed);
  }

  const history = [...recentLookIds];
  const picked: ImageLook[] = [];
  for (let i = 0; i < count; i++) {
    const best = leastRecent(looks, (l) => l.id, history);
    picked.push(best);
    history.unshift(best.id);
  }
  return picked;
}

export function pieceLook(look: ImageLook): PieceLook {
  return { id: look.id, label: look.label, kind: look.kind };
}

/**
 * The model_config a piece runs with: the look written into the fields the
 * stages read. Style references from the blueprint's references are dropped so
 * the look is the only style; product, person and base-image references stay.
 */
export function applyLook(modelConfig: Record<string, unknown> | null | undefined, look: ImageLook): Record<string, unknown> {
  const mc: Record<string, any> = { ...(modelConfig ?? {}) };
  const refs = Array.isArray(mc.image_references) ? (mc.image_references as ImageReferenceSpec[]) : null;
  const keptRefs = (refs ?? []).filter((r) => r?.role !== 'style');

  if (look.kind === 'preset') {
    mc.image_style = look.preset || 'custom';
    mc.image_style_direction = look.direction;
    delete mc.look_style_description;
    if (refs) mc.image_references = keptRefs;
    return mc;
  }

  mc.image_style = 'auto';
  delete mc.image_style_direction;
  const images = (look.images ?? []).filter((u) => typeof u === 'string' && u).slice(0, MAX_LOOK_IMAGES);
  mc.image_references = [...keptRefs, { id: `look-${look.id}`, role: 'style', source: 'upload', images, label: look.label }];
  if (look.description?.trim()) mc.look_style_description = look.description.trim();
  else delete mc.look_style_description;
  return mc;
}

/** Looks of the recent pieces this rotation continues from, most recent first. */
export async function recentLookIds(
  supabase: any,
  scope: { autopilotId?: string | null; blueprintId?: string | null },
  limit = 30,
): Promise<string[]> {
  if (!scope.autopilotId && !scope.blueprintId) return [];
  let q = supabase
    .from('content_outputs')
    .select('look_id:generation_params->look->>id')
    .order('created_at', { ascending: false })
    .limit(limit);
  q = scope.autopilotId ? q.eq('autopilot_id', scope.autopilotId) : q.eq('blueprint_id', scope.blueprintId).is('autopilot_id', null);
  const { data, error } = await q;
  if (error) {
    console.warn(`[looks] Couldn't read recent looks: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: any) => r?.look_id).filter((id: unknown): id is string => typeof id === 'string' && !!id);
}
