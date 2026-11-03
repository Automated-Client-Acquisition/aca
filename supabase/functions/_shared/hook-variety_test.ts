// Run: deno test supabase/functions/_shared/hook-variety_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { cleanHook, freshHookPrompt, openerKey, opensLikeRecent, pickStoredHook, promptUsesHook } from "./hook-variety.ts";

// The 3811e5d7 feed on 2026-09-27, most recent first.
const recent = [
  "Most people cold-message strangers and hope. I built an agent in Hermes that only pings me when someone's ready to buy 🤯",
  "I built a YouTube agent in Hermes Agent that finds the gaps in my niche",
  "I stopped paying per-lead to enrich lists. Built the whole pipeline in Hermes Agent instead",
  "I built a LinkedIn setter in Hermes Agent in an afternoon",
  "I built a SEC Form 4 agent in Hermes Agent in an afternoon",
  "I just vibe-coded a Google Maps Lead Gen Scraper in Hermes Agent 🤯",
];

Deno.test("opener key ignores case, punctuation and emoji", () => {
  assertEquals(openerKey("🤯 I BUILT, a thing"), "i built");
  assertEquals(openerKey("Nobody's mining Reddit"), "nobody's mining");
});

Deno.test("a hook opens like the feed when its first two words repeat", () => {
  assert(opensLikeRecent("Most people guess what to post.", recent));
  assert(!opensLikeRecent("Most creators guess what to post.", recent.slice(1, 2)));
});

Deno.test("a first word that already starts two recent posts is too much", () => {
  // 5 of the last 6 start with "I", so any "I ..." hook repeats the feed.
  assert(opensLikeRecent("I cancelled my $200/mo Maps scraper", recent));
  assert(!opensLikeRecent("I cancelled my $200/mo Maps scraper", [recent[0], recent[1]]));
  assert(!opensLikeRecent("Nobody needs Clay. Built the whole pipeline in Hermes Agent", recent));
});

Deno.test("no history, no repetition", () => {
  assert(!opensLikeRecent("I built a thing", []));
  assert(!opensLikeRecent("", recent));
});

Deno.test("stored hooks are searched from the rotation cursor, wrapping around", () => {
  const hooks = [
    { text: "Nobody needs Clay." },
    { text: "I vibe-coded a lead pipeline in Hermes Agent" },
    { text: "I cancelled my enrichment stack" },
    { text: "Reddit is full of buyers." },
  ];
  assertEquals(pickStoredHook(hooks, 1, recent)?.index, 3);
  assertEquals(pickStoredHook(hooks, 0, recent)?.index, 0);
  assertEquals(pickStoredHook([{ text: "I built X" }, { text: "I built Y" }], 0, recent), null);
});

Deno.test("only blueprints that put the hook in the post", () => {
  assert(promptUsesHook("Hook (use verbatim): {{ai_hook}}"));
  assert(promptUsesHook("{{ hook }}"));
  assert(promptUsesHook("{{#ai_hook}}Open with: {{ai_hook}}{{/ai_hook}}"));
  assert(!promptUsesHook("Pick one of {{ai_hooks}}"));
  assert(!promptUsesHook(null));
});

Deno.test("cleaned hook is one plain line", () => {
  assertEquals(cleanHook('\n"Nobody needs Clay — built it myself."\nextra'), "Nobody needs Clay. Built it myself.");
  assertEquals(cleanHook("**Hook:** Most teams guess."), "Most teams guess.");
});

Deno.test("the writer sees the stored hooks, the feed and the last rejected start", () => {
  const p = freshHookPrompt("Buying signals agent", ["Watches 428 sources"], ["I built an agent"], recent, "I built something");
  assert(p.includes("- Watches 428 sources"));
  assert(p.includes("- I built an agent"));
  assert(p.includes(recent[1]));
  assert(p.includes('started "i built"'));
});
