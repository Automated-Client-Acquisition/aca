/**
 * Which brand voice / audience / product / person a generation uses when the
 * caller didn't pick one explicitly.
 *
 * Resolution order per library table (first hit wins, always scoped to the org):
 *   1. an element the caller already supplied (wizard pin, autopilot mix, API)
 *   2. the blueprint's own pin   (blueprints.context[kind].element_id)
 *   3. the idea's link           (content_ideas.brand_voice_id / product_id)
 *   4. the workspace default     (organization_settings.default_*_id, "Brand Kit")
 *   5. the most recently updated element of that kind
 *
 * Which tables get filled:
 *   - blueprint.context mode 'always' | 'relevant' → filled; 'off' → not filled
 *     for the text (forceTables still fills it, for image references)
 *   - required prompt slots ({{brand.tone}}) → filled when missing
 *   - optional prompt slots → filled only when the caller supplied nothing at all
 *     (the historical API/MCP behaviour; a wizard user who left one empty meant it)
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export type LibraryKind = 'brand' | 'audience' | 'product' | 'person';
export type ContextMode = 'always' | 'relevant' | 'off';
export interface BlueprintContextEntry {
  mode: ContextMode;
  element_id?: string | null;
}
export type BlueprintContext = Partial<Record<LibraryKind, BlueprintContextEntry>>;

export const KIND_TABLE: Record<LibraryKind, string> = {
  brand: 'library_brand_voices',
  audience: 'library_icps',
  product: 'library_products',
  person: 'library_characters',
};

const TABLE_KIND: Record<string, LibraryKind> = Object.fromEntries(
  Object.entries(KIND_TABLE).map(([kind, table]) => [table, kind as LibraryKind]),
);

const DEFAULT_COLUMN: Record<LibraryKind, string> = {
  brand: 'default_brand_voice_id',
  audience: 'default_icp_id',
  product: 'default_product_id',
  person: 'default_character_id',
};

/** Every key a library element may be stored under in item.library_elements. */
const TABLE_ALIASES: Record<string, string[]> = {
  library_brand_voices: ['library_brand_voices', 'brand', 'brand_voice'],
  library_icps: ['library_icps', 'icp'],
  library_products: ['library_products', 'product'],
  library_characters: ['library_characters', 'character'],
};

function hasElement(elements: Record<string, unknown>, table: string): boolean {
  const aliases = TABLE_ALIASES[table] ?? [table];
  return aliases.some((key) => {
    const v = elements[key];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null;
  });
}

export async function loadWorkspaceDefaults(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Partial<Record<LibraryKind, string>>> {
  const { data } = await supabase
    .from('organization_settings')
    .select('default_brand_voice_id, default_icp_id, default_product_id, default_character_id')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const out: Partial<Record<LibraryKind, string>> = {};
  if (!data) return out;
  for (const kind of Object.keys(DEFAULT_COLUMN) as LibraryKind[]) {
    const id = (data as Record<string, string | null>)[DEFAULT_COLUMN[kind]];
    if (id) out[kind] = id;
  }
  return out;
}

/** First candidate id that exists in this org, else (optionally) the most recent element. */
async function fetchFirstExisting(
  supabase: SupabaseClient,
  organizationId: string,
  table: string,
  candidateIds: Array<string | null | undefined>,
  fallbackToMostRecent: boolean,
): Promise<Record<string, unknown> | null> {
  const seen = new Set<string>();
  for (const id of candidateIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (data) return data as Record<string, unknown>;
  }
  if (!fallbackToMostRecent) return null;
  const { data } = await supabase
    .from(table)
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false })
    .limit(1);
  return (data?.[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * The Brand Kit element ids to write with when the caller picked none: the
 * workspace default, else the most recently updated element (the same last
 * two steps as fillLibraryElements). For callers that load elements
 * themselves, like AI idea generation.
 */
export async function resolveBrandKitIds(
  supabase: SupabaseClient,
  organizationId: string,
  kinds: LibraryKind[],
): Promise<Partial<Record<LibraryKind, string>>> {
  const defaults = await loadWorkspaceDefaults(supabase, organizationId);
  const out: Partial<Record<LibraryKind, string>> = {};
  for (const kind of kinds) {
    const row = await fetchFirstExisting(supabase, organizationId, KIND_TABLE[kind], [defaults[kind]], true);
    if (row?.id) out[kind] = String(row.id);
  }
  return out;
}

export interface FillLibraryElementsParams {
  organizationId: string;
  /** Elements the caller supplied, keyed by table name or shorthand. Not mutated. */
  existing: Record<string, unknown> | null | undefined;
  /** Library slots parsed from the blueprint prompts. */
  slots: Array<{ library_table?: string; required?: boolean }>;
  context?: BlueprintContext | null;
  ideaBrandVoiceId?: string | null;
  ideaProductId?: string | null;
  /** Pre-loaded workspace defaults (saves a query per item in batch jobs). */
  workspaceDefaults?: Partial<Record<LibraryKind, string>>;
  /**
   * Tables to fill even when context turns them off for the text, e.g. a
   * "the run's person" image reference needs the person's photos.
   */
  forceTables?: string[];
}

export interface FillLibraryElementsResult {
  elements: Record<string, unknown>;
  /** table name → how it was filled, for logs. */
  filled: Record<string, string>;
}

export async function fillLibraryElements(
  supabase: SupabaseClient,
  params: FillLibraryElementsParams,
): Promise<FillLibraryElementsResult> {
  const elements: Record<string, unknown> = { ...(params.existing ?? {}) };
  const filled: Record<string, string> = {};
  const suppliedNothing = Object.keys(elements).length === 0;
  const context = params.context ?? null;

  const tables = new Set<string>();
  const offTables = new Set<string>();
  if (context) {
    for (const [kind, entry] of Object.entries(context) as Array<[LibraryKind, BlueprintContextEntry | undefined]>) {
      const table = KIND_TABLE[kind];
      if (!table || !entry) continue;
      if (entry.mode === 'off') offTables.add(table);
      else tables.add(table);
    }
  }
  for (const slot of params.slots) {
    if (!slot.library_table || !TABLE_KIND[slot.library_table]) continue;
    if (slot.required !== false || suppliedNothing) tables.add(slot.library_table);
  }
  for (const t of offTables) tables.delete(t);
  for (const t of params.forceTables ?? []) if (TABLE_KIND[t]) tables.add(t);

  const missing = [...tables].filter((t) => !hasElement(elements, t));
  if (missing.length === 0) return { elements, filled };

  const defaults = params.workspaceDefaults ?? await loadWorkspaceDefaults(supabase, params.organizationId);

  for (const table of missing) {
    const kind = TABLE_KIND[table];
    const pinned = context?.[kind]?.element_id ?? null;
    const ideaLinked = kind === 'brand' ? params.ideaBrandVoiceId : kind === 'product' ? params.ideaProductId : null;
    const element = await fetchFirstExisting(
      supabase,
      params.organizationId,
      table,
      [pinned, ideaLinked, defaults[kind]],
      true,
    );
    if (element) {
      elements[table] = element;
      const source = element.id === pinned ? 'blueprint pin'
        : element.id === ideaLinked ? 'idea link'
        : element.id === defaults[kind] ? 'workspace default'
        : 'most recent';
      filled[table] = `${String(element.name ?? element.id)} (${source})`;
    }
  }

  return { elements, filled };
}
