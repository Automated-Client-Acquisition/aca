// Run: deno test supabase/functions/_shared/content-mix_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { pickMixEntry, rankMixEntries } from "./content-mix.ts";

const e = (blueprint_id: string, weight: number, enabled = true) => ({ blueprint_id, weight, enabled });

/** Run the picker n times, feeding its own picks back as history. */
function simulate(mix: ReturnType<typeof e>[], runs: number, seed: string[] = []): string[] {
  const history = [...seed];
  const out: string[] = [];
  for (let i = 0; i < runs; i++) {
    const picked = pickMixEntry(mix, history)!.blueprint_id;
    out.push(picked);
    history.unshift(picked);
  }
  return out;
}

Deno.test("nothing enabled, nothing picked", () => {
  assertEquals(pickMixEntry([e("a", 50, false)], []), null);
  assertEquals(pickMixEntry([], []), null);
});

Deno.test("50/50 alternates instead of repeating", () => {
  assertEquals(simulate([e("a", 50), e("b", 50)], 6), ["a", "b", "a", "b", "a", "b"]);
});

Deno.test("an existing streak is balanced out", () => {
  assertEquals(simulate([e("a", 50), e("b", 50)], 2, ["a", "a", "a"]), ["b", "b"]);
});

Deno.test("70/30 converges on the weights with no long streaks", () => {
  const runs = simulate([e("a", 70), e("b", 30)], 20);
  assertEquals(runs.filter((r) => r === "a").length, 14);
  assertEquals(runs.join("").includes("aaaa"), false);
});

Deno.test("three blueprints all get used early", () => {
  assertEquals(new Set(simulate([e("a", 40), e("b", 30), e("c", 30)], 3)).size, 3);
});

Deno.test("all-zero weights share equally; zero weight is skipped otherwise", () => {
  assertEquals(simulate([e("a", 0), e("b", 0)], 4), ["a", "b", "a", "b"]);
  assertEquals(simulate([e("a", 100), e("b", 0)], 3), ["a", "a", "a"]);
});

Deno.test("history from blueprints no longer in the mix is ignored", () => {
  assertEquals(pickMixEntry([e("a", 50), e("b", 50)], ["old", "old", "a"])!.blueprint_id, "b");
});

Deno.test("ranking lists every blueprint, best first, for fall-through", () => {
  const mix = [e("a", 40), e("b", 40), e("c", 20)];
  assertEquals(rankMixEntries(mix, []).map((m) => m.blueprint_id), ["a", "b", "c"]);
  assertEquals(rankMixEntries(mix, ["a"]).map((m) => m.blueprint_id), ["b", "c", "a"]);
  assertEquals(rankMixEntries([e("a", 1, false)], []), []);
});

Deno.test("entries sharing a blueprint are all ranked", () => {
  const mix = [{ ...e("a", 50), tag: "x" }, { ...e("a", 50), tag: "y" }, e("b", 100)];
  const ranked = rankMixEntries(mix, ["b"], () => 0.9);
  assertEquals(ranked.map((m) => m.blueprint_id), ["a", "a", "b"]);
  assertEquals(ranked.map((m: any) => m.tag ?? "-"), ["y", "x", "-"]);
});
