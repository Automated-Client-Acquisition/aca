import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractTerms } from "./pulse-terms.ts";

Deno.test("extracts model / product names with versions", () => {
  const { terms, display } = extractTerms(
    "Anthropic and OpenAI both shipped cheaper flagship model updates today. Opus 5.5: 20% lower token prices. GPT-6 Sol is out.",
  );
  assert(terms.includes("opus 5.5"), terms.join(" | "));
  assert(terms.includes("opus"));
  assert(terms.includes("gpt-6 sol") || terms.includes("gpt-6"), terms.join(" | "));
  assert(terms.includes("anthropic"));
  assertEquals(display["opus 5.5"], "Opus 5.5");
});

Deno.test("acronyms like JEV and hashtags", () => {
  const { terms } = extractTerms("Everyone is talking about JEV today. The TypeSafe team shipped it #buildinpublic");
  assert(terms.includes("jev"), terms.join(" | "));
  assert(terms.includes("#buildinpublic"));
  assert(terms.includes("typesafe"));
});

Deno.test("drops sentence starters and stopwords", () => {
  const { terms } = extractTerms("Stop using Apollo today. This is the way. I think we need more leads.");
  assert(!terms.includes("stop"), terms.join(" | "));
  assert(!terms.includes("this"));
  assert(terms.includes("apollo"));
  assert(!terms.some((t) => t.startsWith("the ")));
});

Deno.test("drops HN boilerplate", () => {
  const { terms } = extractTerms("Show HN: Jev, a typed decision model for agents");
  assert(!terms.includes("show hn"), terms.join(" | "));
  assert(terms.includes("jev"));
});

Deno.test("ignores urls", () => {
  const { terms } = extractTerms("Read this https://Example.com/Some-Path/ABC now");
  assert(!terms.some((t) => t.includes("example")), terms.join(" | "));
});

Deno.test("keeps acronym prefixes", () => {
  const { terms } = extractTerms("We replaced our SDR team with an AI SDR built on Claude Code.");
  assert(terms.includes("ai sdr"), terms.join(" | "));
  assert(terms.includes("claude code"));
});

Deno.test("rolls model variants up into their family", () => {
  const { terms } = extractTerms("OpenAI shipped GPT-6 Sol today. Also GPT-6 Luna is cheaper. Google answered with Gemini 3 Pro. Grok 4.7 is out.");
  assert(terms.includes("gpt-6 sol"), terms.join(" | "));
  assert(terms.includes("gpt-6"), terms.join(" | "));
  assert(terms.includes("gemini 3") && terms.includes("gemini"), terms.join(" | "));
  assert(terms.includes("grok 4.7") && terms.includes("grok"), terms.join(" | "));
});

Deno.test("possessives split owner and product", () => {
  const { terms } = extractTerms("Everyone is testing Meta's Muse today and comparing it with Google's Gemini 3.");
  assert(terms.includes("meta"), terms.join(" | "));
  assert(terms.includes("muse"), terms.join(" | "));
  assert(!terms.includes("meta's muse"), terms.join(" | "));
  assert(terms.includes("gemini 3") || terms.includes("gemini"), terms.join(" | "));
});
