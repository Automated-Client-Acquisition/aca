/**
 * Blueprint context: which brand voice, audience, product and person a
 * blueprint writes with. Mirrors supabase/functions/_shared/library-defaults.ts,
 * which applies the same rules at generation time. Keep the two in sync.
 */
import type { LibraryElementType } from "@/types/blueprint";

export type LibraryKind = "brand" | "audience" | "product" | "person";
export type ContextMode = "always" | "relevant" | "off";

export interface BlueprintContextEntry {
  mode: ContextMode;
  /** Pin one element for this blueprint; null = use the workspace default. */
  element_id?: string | null;
}

export type BlueprintContext = Partial<Record<LibraryKind, BlueprintContextEntry>>;

export const LIBRARY_KINDS: LibraryKind[] = ["brand", "audience", "product", "person"];

export const KIND_TABLE: Record<LibraryKind, LibraryElementType> = {
  brand: "library_brand_voices",
  audience: "library_icps",
  product: "library_products",
  person: "library_characters",
};

export const TABLE_KIND: Partial<Record<string, LibraryKind>> = {
  library_brand_voices: "brand",
  library_icps: "audience",
  library_products: "product",
  library_characters: "person",
};

/** organization_settings column holding the workspace default for each kind. */
export const DEFAULT_COLUMN = {
  brand: "default_brand_voice_id",
  audience: "default_icp_id",
  product: "default_product_id",
  person: "default_character_id",
} as const satisfies Record<LibraryKind, string>;

export const KIND_LABEL: Record<LibraryKind, string> = {
  brand: "Brand voice",
  audience: "Audience",
  product: "Product",
  person: "Person",
};

/** What each kind adds to the writing, in the user's terms. */
export const KIND_ADDS: Record<LibraryKind, string> = {
  brand: "Tone, style rules and banned words",
  audience: "Their pains, goals and the words they use",
  product: "Name, what it does and its key benefits",
  person: "Their face and voice in images and video",
};

/** Where to create one when the workspace has none. */
export const KIND_ASSETS_TAB: Record<LibraryKind, string> = {
  brand: "brands",
  audience: "icps",
  product: "products",
  person: "characters",
};

export const MODE_LABEL: Record<ContextMode, string> = {
  always: "Always",
  relevant: "If relevant",
  off: "Off",
};

export const DEFAULT_CONTEXT: BlueprintContext = {
  brand: { mode: "always" },
  audience: { mode: "always" },
  product: { mode: "relevant" },
  person: { mode: "off" },
};

export function parseBlueprintContext(raw: unknown): BlueprintContext | null {
  if (!raw || typeof raw !== "object") return null;
  const out: BlueprintContext = {};
  for (const kind of LIBRARY_KINDS) {
    const entry = (raw as Record<string, unknown>)[kind] as Partial<BlueprintContextEntry> | undefined;
    if (!entry || typeof entry !== "object") continue;
    const mode = entry.mode === "always" || entry.mode === "relevant" || entry.mode === "off" ? entry.mode : "off";
    out[kind] = { mode, element_id: typeof entry.element_id === "string" ? entry.element_id : null };
  }
  return out;
}
