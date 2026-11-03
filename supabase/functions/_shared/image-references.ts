/**
 * Reference images with roles.
 *
 * A blueprint (or a single run) can say which images the image model gets and
 * what each one is FOR:
 *   - product: reproduce this exact object
 *   - person:  keep this face / identity
 *   - style:   match the look, not the subject
 *   - remake:  recreate this image (layout, pose, look) with only the post's
 *              changes; with a person reference that's a face swap
 *
 * Stored on model_config.image_references (see src/lib/image-references.ts).
 * When that key is present (even as an empty array) the image stages use ONLY
 * these references; the legacy "send every image on the run's library items"
 * behaviour applies to blueprints that never set it.
 *
 * Each reference is either concrete (`images` listed: a specific library item's
 * chosen photos, or uploads) or `source: 'run'`, meaning "the product / person
 * this run uses", resolved from the run's library elements at generation time.
 *
 * Several photos in one role either all go to every piece (combine, the
 * default) or take turns, one per piece (rotate): model_config.reference_modes,
 * e.g. { person: 'rotate' }. dispatch-generation-job applies the turn with
 * rotateReferences, so each piece's own model_config holds only its photo.
 */
import { resolveReferenceImagesToDataUrls } from './image-reference-resolver.ts';
import { leastRecent } from './least-recent.ts';

export type ReferenceRole = 'remake' | 'product' | 'person' | 'style';

export interface ImageReferenceSpec {
  id?: string;
  role: ReferenceRole;
  source: 'run' | 'library' | 'upload';
  element_id?: string | null;
  images?: string[];
  label?: string;
}

export interface ResolvedReference {
  role: ReferenceRole;
  label: string;
  urls: string[];
}

// The base image goes first: image models treat the first picture as the canvas.
const ROLE_ORDER: ReferenceRole[] = ['remake', 'product', 'person', 'style'];
const MAX_PER_ROLE: Record<ReferenceRole, number> = { remake: 1, product: 2, person: 2, style: 2 };
export const MAX_REFERENCE_IMAGES = 6;

export const ROLE_TITLE: Record<ReferenceRole, string> = {
  remake: 'BASE IMAGE',
  product: 'PRODUCT',
  person: 'PERSON',
  style: 'STYLE',
};

export const ROLE_INSTRUCTION: Record<ReferenceRole, string> = {
  remake:
    'Recreate this image as closely as possible: same layout, framing, pose, camera angle, lighting, colours, typography and design. Change only what the instructions below say.',
  product:
    'Reproduce this exact object faithfully: same shape, colours, materials, labels, logo and proportions. Do not redesign it or invent a different product.',
  person:
    "The person in this reference MUST appear visibly in the generated image, with their face large enough to be clearly recognisable: same facial features, hair and skin tone. Reserve space for them in the composition, including infographics and text-led designs. Do not omit them, replace them with a generic person, or use the photo only as style inspiration. Pose, expression, clothing and setting may change.",
  style:
    'Match its whole look: medium (photo, 3D, flat illustration, screenshot collage...), layout and composition, lighting, colour palette, typography and how on-image text is treated, and mood. Do NOT copy its subject, people, objects or its exact words; any text on the new image must be new and fit this post.',
};

/** With a base image, a person reference replaces the person in it (a face swap). */
const PERSON_INTO_BASE =
  "Put this person in place of the person in the BASE image: keep the base image's pose, framing, expression and clothing, but use this person's face, hair, skin tone and identity so they are clearly recognisable. The referenced person MUST appear visibly; do not omit them.";

/** The instruction for one reference group, given the others in the request. */
export function roleInstruction(role: ReferenceRole, refs: ResolvedReference[]): string {
  if (role === 'person' && refs.some((r) => r.role === 'remake')) return PERSON_INTO_BASE;
  return ROLE_INSTRUCTION[role];
}

/**
 * Closing requirements for selected references. Image models weigh
 * the last, most specific text heavily, so a detailed description in another
 * style (dark 3D illustration vs a bright photo thumbnail) used to win over
 * the reference (job ad545b6c, 2026-09-26).
 */
export function referenceReminder(refs: ResolvedReference[], styleDescription?: string): string {
  const lines: string[] = [];
  if (refs.some((r) => r.role === 'remake')) {
    lines.push("RESULT: the BASE image with only the listed changes: same layout, framing, pose, lighting, colours and typography.");
    if (refs.some((r) => r.role === 'person')) {
      lines.push("The person must be the PERSON reference (their face and identity), not the person from the base image.");
    }
  }
  if (refs.some((r) => r.role === 'person')) {
    lines.push('REQUIRED PERSON: the person from each PERSON reference MUST appear visibly with a clearly recognisable face. Reserve space for them alongside any text or diagrams. This requirement takes precedence over instructions for a text-only or process-only composition; never omit the person to simplify the layout.');
  }
  if (refs.some((r) => r.role === 'style')) {
    const described = styleDescription?.trim() ? ` The reference's look: ${styleDescription.trim()}` : '';
    lines.push(`STYLE: the image must look like the STYLE reference image (same medium, layout, lighting, palette and typography). Where the description above suggests a different style, the reference wins.${described}`);
  }
  return lines.join('\n');
}

/** Repeat reference requirements after the template's composition instructions. */
export function withReferenceRequirements(prompt: string, refs: ResolvedReference[], styleDescription?: string): string {
  const reminder = referenceReminder(refs, styleDescription);
  return reminder && !prompt.trimEnd().endsWith(reminder) ? `${prompt}\n\n${reminder}` : prompt;
}

/** True when the blueprint/run manages references explicitly (role mode). */
export function hasRoleReferences(modelConfig: Record<string, unknown> | null | undefined): boolean {
  return Array.isArray((modelConfig as any)?.image_references);
}

function pickElement(libraryElements: Record<string, any>, keys: string[]): Record<string, any> | null {
  for (const key of keys) {
    const v = libraryElements?.[key];
    const el = Array.isArray(v) ? v[0] : v;
    if (el && typeof el === 'object') return el;
  }
  return null;
}

function stringUrls(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((u): u is string => typeof u === 'string' && u.length > 0) : [];
}

/** Photos of the run's product / person (the `source: 'run'` case). */
function runElementImages(role: ReferenceRole, libraryElements: Record<string, any>): { urls: string[]; name?: string } {
  if (role === 'product') {
    const p = pickElement(libraryElements, ['product', 'library_products']);
    return { urls: stringUrls(p?.images), name: p?.name };
  }
  if (role === 'person') {
    const c = pickElement(libraryElements, ['character', 'library_characters']);
    return { urls: stringUrls(c?.reference_images), name: c?.name };
  }
  return { urls: [] };
}

/** Turn specs into concrete, labelled image groups: product, then person, then style; capped. */
export function resolveRoleReferences(
  modelConfig: Record<string, unknown> | null | undefined,
  libraryElements: Record<string, any>,
  options: { required?: boolean } = {},
): ResolvedReference[] {
  const specs = ((modelConfig as any)?.image_references ?? []) as ImageReferenceSpec[];
  const out: ResolvedReference[] = [];
  const used = new Map<ReferenceRole, number>();
  const seen = new Set<string>();
  let total = 0;

  const sorted = [...specs]
    .filter((s) => s && ROLE_ORDER.includes(s.role))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));

  for (const spec of sorted) {
    let urls = stringUrls(spec.images);
    let name = spec.label;
    if (urls.length === 0 && spec.source === 'run') {
      const fromRun = runElementImages(spec.role, libraryElements);
      urls = fromRun.urls;
      name = name || fromRun.name;
    }
    if (options.required && urls.length === 0) {
      throw new Error(`Required ${ROLE_TITLE[spec.role]} reference "${name || spec.role}" has no images. Select a reference image before generating.`);
    }
    const room = Math.min(MAX_PER_ROLE[spec.role] - (used.get(spec.role) ?? 0), MAX_REFERENCE_IMAGES - total);
    const chosen = urls.filter((u) => !seen.has(u)).slice(0, Math.max(0, room));
    if (chosen.length === 0) {
      if (options.required) {
        throw new Error(`Required ${ROLE_TITLE[spec.role]} reference "${name || spec.role}" could not be included because its images are duplicated or exceed the reference limit. Remove duplicate references or reduce the number of selected images.`);
      }
      continue;
    }
    chosen.forEach((u) => seen.add(u));
    used.set(spec.role, (used.get(spec.role) ?? 0) + chosen.length);
    total += chosen.length;
    out.push({
      role: spec.role,
      label: (name || '').trim() || (spec.role === 'style' ? 'style reference' : spec.role === 'remake' ? 'base image' : spec.role),
      urls: chosen,
    });
  }
  return out;
}

export type ReferenceMode = 'combine' | 'rotate';

/** The photo each rotating role gave a piece (generation_params.reference_picks). */
export type ReferencePicks = Partial<Record<ReferenceRole, string>>;

/**
 * How a role's photos reach the pieces. Base images always take turns: only
 * one image can be recreated at a time. Style has no mode here; Looks rotate
 * styles (image-looks.ts).
 */
export function referenceMode(modelConfig: Record<string, unknown> | null | undefined, role: ReferenceRole): ReferenceMode {
  if (role === 'remake') return 'rotate';
  if (role === 'style') return 'combine';
  return (modelConfig as any)?.reference_modes?.[role] === 'rotate' ? 'rotate' : 'combine';
}

/** True when some reference's role takes turns, so dispatch needs the rotation history. */
export function rotatesReferences(modelConfig: Record<string, unknown> | null | undefined): boolean {
  const specs = (modelConfig as any)?.image_references;
  return Array.isArray(specs) && specs.some((s: ImageReferenceSpec) => s && referenceMode(modelConfig, s.role) === 'rotate');
}

/** Every photo of one role, in saved order (capped per reference, like the Studio shows). */
function rolePhotos(
  specs: ImageReferenceSpec[],
  role: ReferenceRole,
  libraryElements: Record<string, any>,
): Array<{ url: string; spec: ImageReferenceSpec; name?: string }> {
  const out: Array<{ url: string; spec: ImageReferenceSpec; name?: string }> = [];
  const seen = new Set<string>();
  for (const spec of specs) {
    if (spec?.role !== role) continue;
    let urls = stringUrls(spec.images);
    let name = spec.label;
    if (urls.length === 0 && spec.source === 'run') {
      const fromRun = runElementImages(role, libraryElements);
      urls = fromRun.urls;
      name = name || fromRun.name;
    }
    for (const url of urls.slice(0, MAX_PER_ROLE[role])) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, spec, name });
    }
  }
  return out;
}

/**
 * One piece's model_config with each rotating role cut to a single photo: the
 * one used least recently. `recent` is the picks of recent pieces, most recent
 * first; a role with fewer than 2 photos is left as is.
 */
export function rotateReferences(
  modelConfig: Record<string, unknown> | null | undefined,
  libraryElements: Record<string, any>,
  recent: ReferencePicks[] = [],
): { modelConfig: Record<string, unknown> | null | undefined; picks: ReferencePicks } {
  const specs = (modelConfig as any)?.image_references;
  if (!Array.isArray(specs)) return { modelConfig, picks: {} };

  let refs = specs as ImageReferenceSpec[];
  const picks: ReferencePicks = {};
  for (const role of ROLE_ORDER) {
    if (referenceMode(modelConfig, role) !== 'rotate') continue;
    const photos = rolePhotos(specs, role, libraryElements);
    if (photos.length < 2) continue;
    const pick = leastRecent(photos, (p) => p.url, recent.map((r) => r?.[role]).filter((u): u is string => !!u));
    picks[role] = pick.url;
    refs = [
      ...refs.filter((r) => r?.role !== role),
      { id: pick.spec.id, role, source: 'upload', images: [pick.url], ...(pick.name ? { label: pick.name } : {}) },
    ];
  }
  return Object.keys(picks).length > 0 ? { modelConfig: { ...modelConfig, image_references: refs }, picks } : { modelConfig, picks };
}

/** Picks of the recent pieces this rotation continues from, most recent first (scoped like Looks). */
export async function recentReferencePicks(
  supabase: any,
  scope: { autopilotId?: string | null; blueprintId?: string | null },
  limit = 30,
): Promise<ReferencePicks[]> {
  if (!scope.autopilotId && !scope.blueprintId) return [];
  let q = supabase
    .from('content_outputs')
    .select('picks:generation_params->reference_picks')
    .order('created_at', { ascending: false })
    .limit(limit);
  q = scope.autopilotId ? q.eq('autopilot_id', scope.autopilotId) : q.eq('blueprint_id', scope.blueprintId).is('autopilot_id', null);
  const { data, error } = await q;
  if (error) {
    console.warn(`[references] Couldn't read recent picks: ${error.message}`);
    return [];
  }
  return (data ?? []).map((r: any) => (r?.picks && typeof r.picks === 'object' ? r.picks : {}));
}

/** Numbered text version, for providers that take images and prompt separately. */
export function referencesAsText(refs: ResolvedReference[], styleDescription?: string): string {
  if (refs.length === 0) return '';
  let n = 1;
  const lines = refs.map((r) => {
    const first = n;
    n += r.urls.length;
    const which = r.urls.length > 1 ? `Reference images ${first}-${n - 1}` : `Reference image ${first}`;
    return `${which} (${ROLE_TITLE[r.role]}: ${r.label}): ${roleInstruction(r.role, refs)}`;
  });
  const reminder = referenceReminder(refs, styleDescription);
  return `REFERENCE IMAGES\n${lines.join('\n')}${reminder ? `\n${reminder}` : ''}`;
}

/**
 * What the image-prompt writer should know so it builds the scene around the
 * references. The writer can't see the images, so a style reference comes
 * with a description of its look (see describeStyleReference); without one it
 * invents its own style, which then overrides the reference.
 */
export function referencesBriefForPromptWriter(
  refs: ResolvedReference[],
  styleDescription?: string,
  opts: { imagesAttached?: boolean } = {},
): string {
  if (refs.length === 0) return '';
  const lines: string[] = [];
  for (const r of refs) {
    if (r.role === 'product') {
      lines.push(
        opts.imagesAttached
          ? `- The product "${r.label}" (its photos are attached) must appear exactly as shown. Describe it briefly as it looks and call it "the product".`
          : `- The product "${r.label}" must appear, exactly as in its reference photos. Refer to it as "the product".`,
      );
    }
    if (r.role === 'remake') {
      lines.push(`- The BASE image${opts.imagesAttached ? ' (attached)' : ''} is recreated as is. Only write what changes.`);
    }
    if (r.role === 'person') {
      lines.push(
        refs.some((x) => x.role === 'remake')
          ? `- ${r.label} (the PERSON reference) replaces the person in the base image, same pose. Call them "the person from the person reference"; don't describe their face.`
          : `- ${r.label} MUST appear visibly in the image (the person in the reference photos), with a recognisable face. Reserve space for them alongside any text or diagrams, even for an infographic. Refer to them as "the person"; don't describe a different face.`,
      );
    }
    if (r.role === 'style' && opts.imagesAttached) {
      lines.push(
        "- The STYLE reference is attached. Write the scene in exactly its look, and put that look into words in your prompt: its medium (photo, 3D, illustration, screenshot collage...), layout, lighting, colours, typography and how on-image text is treated. Do not invent a different style. Don't describe the reference's own subject or copy its words. If it puts headline text on the image, write short new text for this post (at most 6 words) in quotes; otherwise add no text.",
      );
    } else if (r.role === 'style') {
      lines.push(
        styleDescription?.trim()
          ? `- A style reference sets the whole look. Its look: ${styleDescription.trim()}\n  Write the scene in exactly that look: use its medium, layout, lighting, palette and typography. Do not invent a different style, palette, lighting or medium. Don't describe the reference's own subject. If the look puts headline text on the image, write short new text for this post (at most 6 words) in quotes; otherwise add no text.`
          : "- A style reference sets the whole look (medium, layout, lighting, palette, typography). Describe the subject and composition only; do not name a style, palette, lighting or medium of your own. Don't describe the reference's own subject.",
      );
    }
  }
  return opts.imagesAttached
    ? `The reference images attached above will also go to the image model:\n${lines.join('\n')}`
    : `The image model will also receive reference images:\n${lines.join('\n')}`;
}

const STYLE_DESCRIBER_MODEL = 'anthropic/claude-haiku-4.5';

/** One plain paragraph: drops the heading and bold the model adds despite "no preamble". */
export function cleanStyleDescription(text: string): string {
  return text
    .replace(/^\s*#+[^\n]*(\n+|$)/, '')
    .replace(/\*\*|__/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * One short paragraph on how the style reference(s) look, from a vision
 * model, so the prompt writer and the image model get words that agree with
 * the picture. Returns '' on any failure; generation goes on without it.
 */
export async function describeStyleReference(refs: ResolvedReference[], openRouterApiKey: string): Promise<string> {
  const urls = refs.filter((r) => r.role === 'style' || r.role === 'remake').flatMap((r) => r.urls).slice(0, 2);
  if (!urls.length || !openRouterApiKey) return '';
  try {
    const dataUrls = await resolveReferenceImagesToDataUrls(urls);
    if (!dataUrls.length) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: STYLE_DESCRIBER_MODEL,
          max_tokens: 400,
          messages: [{
            role: 'user',
            content: [
              ...dataUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
              {
                type: 'text',
                text: 'Describe the visual style of this image so an image generator can reproduce the look with a different subject. Cover: medium (photo, 3D render, flat illustration, screenshot collage...), layout and composition, lighting, main colours, typography and how any on-image text is treated (size, weight, colour, highlight boxes), and mood. Mention people or objects only by their role in the layout (for example "a person cut out on the left, looking at the camera"), never who they are or what the text says. One paragraph, 60 to 110 words, no preamble.',
              },
            ],
          }],
        }),
      });
      if (!res.ok) {
        console.warn(`[describeStyleReference] ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return '';
      }
      const json = await res.json();
      return cleanStyleDescription(String(json?.choices?.[0]?.message?.content ?? ''));
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.warn('[describeStyleReference] failed:', e instanceof Error ? e.message : e);
    return '';
  }
}

export type ContentPart = { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };

/** Final image generation must not silently lose a selected reference group. */
export async function resolveRequiredReferenceImages(refs: ResolvedReference[]): Promise<ResolvedReference[]> {
  const resolved: ResolvedReference[] = [];
  for (const ref of refs) {
    const urls = await resolveReferenceImagesToDataUrls(ref.urls);
    if (urls.length === 0) {
      throw new Error(`Required ${ROLE_TITLE[ref.role]} reference "${ref.label}" could not be loaded. Check the reference image and retry; generation was stopped before contacting the image provider.`);
    }
    resolved.push({ ...ref, urls });
  }
  return resolved;
}

/**
 * Each reference group introduced by its role instruction, then its images
 * (inlined as data URLs). The prompt writer may skip unavailable groups;
 * final image generation requires every selected group to load.
 */
export async function buildReferenceParts(refs: ResolvedReference[], options: { required?: boolean } = {}): Promise<{ parts: ContentPart[]; imageCount: number }> {
  const parts: ContentPart[] = [];
  let n = 1;
  let imageCount = 0;
  const groups = options.required ? await resolveRequiredReferenceImages(refs) : refs;
  for (const r of groups) {
    const dataUrls = options.required ? r.urls : await resolveReferenceImagesToDataUrls(r.urls);
    if (dataUrls.length === 0) continue;
    const first = n;
    n += dataUrls.length;
    const which = dataUrls.length > 1 ? `Reference images ${first}-${n - 1}` : `Reference image ${first}`;
    parts.push({ type: 'text', text: `${which} (${ROLE_TITLE[r.role]}: ${r.label}). ${roleInstruction(r.role, refs)}` });
    for (const url of dataUrls) parts.push({ type: 'image_url', image_url: { url } });
    imageCount += dataUrls.length;
  }
  return { parts, imageCount };
}

/** Multimodal message for the image model: the labelled references, then the prompt. */
export async function buildLabeledReferenceContent(
  refs: ResolvedReference[],
  prompt: string,
  styleDescription?: string,
): Promise<{ content: ContentPart[] | string; imageCount: number }> {
  const { parts, imageCount } = await buildReferenceParts(refs, { required: true });
  if (imageCount === 0) return { content: prompt, imageCount: 0 };
  parts.push({ type: 'text', text: `Now create the image, following the reference instructions above.\n\n${withReferenceRequirements(prompt, refs, styleDescription)}` });
  return { content: parts, imageCount };
}

/** Library tables a run must include so `source: 'run'` references can resolve. */
export function tablesNeededByReferences(modelConfig: Record<string, unknown> | null | undefined): string[] {
  const specs = ((modelConfig as any)?.image_references ?? []) as ImageReferenceSpec[];
  const tables = new Set<string>();
  for (const s of specs) {
    if (s?.source !== 'run' || stringUrls(s.images).length > 0) continue;
    if (s.role === 'product') tables.add('library_products');
    if (s.role === 'person') tables.add('library_characters');
  }
  return [...tables];
}
