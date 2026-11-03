// Run: deno test supabase/functions/_shared/recent-pieces_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { openingLine, recentImagesBrief } from "./recent-pieces.ts";

Deno.test("opening line skips blank lines and clips", () => {
  assertEquals(openingLine("\n\n  Most founders get this wrong.\nSecond line"), "Most founders get this wrong.");
  assertEquals(openingLine("x".repeat(200), 20).length, 20);
});

Deno.test("no history, no brief", () => {
  assertEquals(recentImagesBrief([{ caption: "", imagePrompt: "" }]), "");
});

Deno.test("images brief keeps the style when asked", () => {
  const pieces = [{ caption: "", imagePrompt: "A founder at a desk, warm light" }];
  assert(recentImagesBrief(pieces, { keepStyle: true }).includes("Keep the required visual style"));
  assert(recentImagesBrief(pieces).includes("colour mood"));
});
