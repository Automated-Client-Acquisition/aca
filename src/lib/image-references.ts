/**
 * Reference images with roles, stored on blueprint model_config.image_references.
 * Mirrors supabase/functions/_shared/image-references.ts, which resolves them at
 * generation time and tells the image model what each image is for.
 */
import { supabase } from "@/integrations/supabase/client";
import type { LibraryKind } from "@/lib/blueprint-context";

export type ReferenceRole = "remake" | "product" | "person" | "style";

export interface ImageReferenceSpec {
  id: string;
  role: ReferenceRole;
  /** run: the run's product/person · library: a specific Brand Kit item · upload: uploaded photos */
  source: "run" | "library" | "upload";
  element_id?: string | null;
  images?: string[];
  label?: string;
}

export const REFERENCE_ROLES: ReferenceRole[] = ["remake", "person", "product", "style"];

export const ROLE_META: Record<ReferenceRole, { title: string; tells: string; kind: LibraryKind | null }> = {
  remake: {
    title: "Recreate this image",
    tells: "Keeps its layout, pose and look; only the post's text and details change. Add a Person to swap the face.",
    kind: null,
  },
  product: { title: "Product or object", tells: "Reproduces this exact object: shape, colours, logo.", kind: "product" },
  person: { title: "Person", tells: "Keeps this face recognisable. With Recreate, replaces the person in that image.", kind: "person" },
  style: { title: "Style", tells: "Matches the look (light, palette, composition), not the people or subject.", kind: null },
};

/** Per role, same caps as the backend. */
export const MAX_IMAGES_PER_ROLE = 2;
export const MAX_REFERENCE_IMAGES = 6;

export function maxImagesFor(role: ReferenceRole): number {
  return role === "remake" ? 1 : MAX_IMAGES_PER_ROLE;
}

/** The role references equivalent to the old "send every photo from these libraries". */
export function referencesFromLegacyLibraries(libraries: string[]): ImageReferenceSpec[] {
  const out: ImageReferenceSpec[] = [];
  if (libraries.includes("library_products")) out.push({ id: newReferenceId(), role: "product", source: "run" });
  if (libraries.includes("library_characters")) out.push({ id: newReferenceId(), role: "person", source: "run" });
  return out;
}

/** combine: every post gets all of a role's photos. rotate: one per post, taking turns. */
export type ReferenceMode = "combine" | "rotate";

/**
 * How a role's photos reach the posts (model_config.reference_modes), same rule
 * as the backend's referenceMode. Base images always take turns: only one can
 * be recreated at a time. Style has no mode; Looks rotate styles.
 */
export function referenceMode(modelConfig: Record<string, any> | null | undefined, role: ReferenceRole): ReferenceMode {
  if (role === "remake") return "rotate";
  if (role === "style") return "combine";
  return modelConfig?.reference_modes?.[role] === "rotate" ? "rotate" : "combine";
}

export function getImageReferences(modelConfig: Record<string, any> | null | undefined): ImageReferenceSpec[] | null {
  const refs = modelConfig?.image_references;
  return Array.isArray(refs) ? (refs as ImageReferenceSpec[]) : null;
}

/** Photos a Brand Kit element offers as references. */
export function elementPhotos(kind: LibraryKind, el: Record<string, any> | null | undefined): string[] {
  if (!el) return [];
  const list = kind === "product" ? el.images : kind === "person" ? el.reference_images : el.logos ?? (el.logo ? [el.logo] : []);
  return Array.isArray(list) ? list.filter((u: unknown): u is string => typeof u === "string" && u.length > 0) : [];
}

/** Brand Kit kinds a run must choose because a reference says "the run's product/person". */
export function kindsNeededByReferences(refs: ImageReferenceSpec[] | null): LibraryKind[] {
  const kinds = new Set<LibraryKind>();
  for (const r of refs ?? []) {
    if (r.source !== "run" || (r.images?.length ?? 0) > 0) continue;
    const kind = ROLE_META[r.role].kind;
    if (kind) kinds.add(kind);
  }
  return [...kinds];
}

export interface ResolvedRunReference {
  id: string;
  role: ReferenceRole;
  label: string;
  images: string[];
  /** "run" references whose product/person isn't chosen, or has no photos. */
  missing?: string;
}

/**
 * What a run will actually send: "run" references filled from the run's chosen
 * product/person, capped like the backend. Used for the Run screen and preview.
 */
export function resolveReferencesForRun(
  refs: ImageReferenceSpec[] | null,
  choice: Partial<Record<LibraryKind, Record<string, any> | null>>,
): ResolvedRunReference[] {
  const out: ResolvedRunReference[] = [];
  for (const r of refs ?? []) {
    let images = r.images ?? [];
    let label = r.label ?? "";
    let missing: string | undefined;
    if (r.source === "run" && images.length === 0) {
      const kind = ROLE_META[r.role].kind!;
      const el = choice[kind];
      images = elementPhotos(kind, el);
      label = label || String(el?.name ?? "");
      if (!el) missing = `No ${kind} chosen for this run`;
      else if (images.length === 0) missing = `${el.name} has no photos in the Brand Kit`;
    }
    out.push({
      id: r.id,
      role: r.role,
      label: label || (r.role === "style" ? "Style reference" : r.role === "remake" ? "Base image" : ROLE_META[r.role].title),
      images: images.slice(0, maxImagesFor(r.role)),
      missing,
    });
  }
  const order = (x: ResolvedRunReference) => REFERENCE_ROLES.indexOf(x.role);
  return out.sort((a, b) => order(a) - order(b));
}

/** Concrete specs for a job: everything resolved to image URLs, nothing left to the backend. */
export function toJobReferences(resolved: ResolvedRunReference[]): ImageReferenceSpec[] {
  return resolved
    .filter((r) => r.images.length > 0)
    .map((r) => ({ id: r.id, role: r.role, source: "upload" as const, images: r.images, label: r.label }));
}

export function newReferenceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Upload reference photos to the user's folder in library-images; returns public URLs. */
export async function uploadReferenceImages(files: File[]): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const urls: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image`);
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is over 10 MB`);
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${user.id}/ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("library-images").upload(path, file, { contentType: file.type });
    if (error) throw new Error(`Couldn't upload ${file.name}: ${error.message}`);
    urls.push(supabase.storage.from("library-images").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
