// Run: deno test supabase/functions/_shared/library-defaults_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { fillLibraryElements, resolveBrandKitIds } from "./library-defaults.ts";

type Row = Record<string, unknown>;

/** Minimal supabase-js stand-in: from().select().eq()...maybeSingle() / order().limit(). */
function mockSupabase(tables: Record<string, Row[]>, settings: Row | null) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (table === "organization_settings" ? (settings ? [settings] : []) : tables[table] ?? [])
        .filter((r) => filters.every(([k, v]) => r[k] === v));
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        order: () => q,
        limit: (n: number) => Promise.resolve({ data: [...rows()].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, n) }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null }),
      };
      return q;
    },
  } as any;
}

const ORG = "org-1";
const tables = {
  library_brand_voices: [
    { id: "b-old", organization_id: ORG, name: "Old brand", updated_at: "2026-01-01" },
    { id: "b-new", organization_id: ORG, name: "Newest brand", updated_at: "2026-09-01" },
    { id: "b-other-org", organization_id: "org-2", name: "Someone else's", updated_at: "2026-09-20" },
  ],
  library_icps: [{ id: "a1", organization_id: ORG, name: "Founders", updated_at: "2026-05-01" }],
  library_products: [{ id: "p1", organization_id: ORG, name: "Autopilot", updated_at: "2026-05-01" }],
  library_characters: [],
};
const brandSlot = { library_table: "library_brand_voices", required: true };
const productOptional = { library_table: "library_products", required: false };

Deno.test("workspace default beats most recent", async () => {
  const sb = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-old" });
  const { elements } = await fillLibraryElements(sb, { organizationId: ORG, existing: {}, slots: [brandSlot] });
  assertEquals((elements.library_brand_voices as Row).id, "b-old");
});

Deno.test("no default → most recently updated (previous behaviour)", async () => {
  const sb = mockSupabase(tables, null);
  const { elements } = await fillLibraryElements(sb, { organizationId: ORG, existing: {}, slots: [brandSlot] });
  assertEquals((elements.library_brand_voices as Row).id, "b-new");
});

Deno.test("blueprint pin beats idea link beats default", async () => {
  const sb = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-new" });
  const pinned = await fillLibraryElements(sb, {
    organizationId: ORG, existing: {}, slots: [brandSlot],
    context: { brand: { mode: "always", element_id: "b-old" } }, ideaBrandVoiceId: "b-new",
  });
  assertEquals((pinned.elements.library_brand_voices as Row).id, "b-old");
  const linked = await fillLibraryElements(sb, { organizationId: ORG, existing: {}, slots: [brandSlot], ideaBrandVoiceId: "b-old" });
  assertEquals((linked.elements.library_brand_voices as Row).id, "b-old");
});

Deno.test("never returns another org's element, even if pinned or defaulted", async () => {
  const sb = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-other-org" });
  const { elements } = await fillLibraryElements(sb, {
    organizationId: ORG, existing: {}, slots: [brandSlot],
    context: { brand: { mode: "always", element_id: "b-other-org" } },
  });
  assertEquals((elements.library_brand_voices as Row).organization_id, ORG);
});

Deno.test("caller-supplied elements are kept (any alias)", async () => {
  const sb = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-old" });
  const mine = { id: "picked", name: "Picked" };
  for (const key of ["library_brand_voices", "brand", "brand_voice"]) {
    const { elements, filled } = await fillLibraryElements(sb, { organizationId: ORG, existing: { [key]: [mine] }, slots: [brandSlot] });
    assertEquals(Object.keys(filled).length, 0, key);
    assertEquals(elements[key], [mine]);
  }
});

Deno.test("optional slot left empty by a wizard user stays empty; filled for API callers", async () => {
  const sb = mockSupabase(tables, null);
  const wizard = await fillLibraryElements(sb, { organizationId: ORG, existing: { library_icps: { id: "a1" } }, slots: [productOptional] });
  assert(!("library_products" in wizard.elements));
  const api = await fillLibraryElements(sb, { organizationId: ORG, existing: {}, slots: [productOptional] });
  assertEquals((api.elements.library_products as Row).id, "p1");
});

Deno.test("context: relevant fills, off never fills (even for a required slot)", async () => {
  const sb = mockSupabase(tables, null);
  const { elements } = await fillLibraryElements(sb, {
    organizationId: ORG, existing: {}, slots: [brandSlot],
    context: { product: { mode: "relevant" }, brand: { mode: "off" } },
  });
  assertEquals((elements.library_products as Row).id, "p1");
  assert(!("library_brand_voices" in elements));
});

Deno.test("kind with no elements in the org stays missing", async () => {
  const sb = mockSupabase(tables, null);
  const { elements } = await fillLibraryElements(sb, { organizationId: ORG, existing: {}, slots: [], context: { person: { mode: "always" } } });
  assert(!("library_characters" in elements));
});

Deno.test("forceTables fills a kind even when context has it off (image references)", async () => {
  const sb = mockSupabase({ ...tables, library_characters: [{ id: "c1", organization_id: ORG, name: "Cedric", updated_at: "2026-01-01" }] }, null);
  const { elements } = await fillLibraryElements(sb, {
    organizationId: ORG, existing: {}, slots: [],
    context: { person: { mode: "off" } }, forceTables: ["library_characters"],
  });
  assertEquals((elements.library_characters as Row).id, "c1");
});

Deno.test("resolveBrandKitIds: default, else most recent, never another org's", async () => {
  const withDefault = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-old" });
  assertEquals(await resolveBrandKitIds(withDefault, ORG, ["brand", "audience", "person"]), { brand: "b-old", audience: "a1" });
  const noDefault = mockSupabase(tables, null);
  assertEquals(await resolveBrandKitIds(noDefault, ORG, ["brand"]), { brand: "b-new" });
  const staleDefault = mockSupabase(tables, { organization_id: ORG, default_brand_voice_id: "b-other-org" });
  assertEquals(await resolveBrandKitIds(staleDefault, ORG, ["brand"]), { brand: "b-new" });
});
