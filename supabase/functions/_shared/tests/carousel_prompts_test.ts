import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { renderPromptTemplate } from "../builders/PromptBuilder.ts";
import { carouselContext } from "../stages/handlers/CarouselCopyHandlers.ts";
import { CONTENT_AI_PROMPT, CONTENT_PROMPT } from "../carousel/prompts.ts";
import type { ExecutionContext } from "../execution/types.ts";

function mockContext(over: Record<string, unknown> = {}, outputConfig: Record<string, unknown> = {}): ExecutionContext {
  return {
    ideaContext: "Buyer intent signals in B2B sales",
    masterPrompt: "You are Cedric. Write a LinkedIn post. No hashtags.",
    brandVoice: { name: "Acme", tone: "direct", writingStyle: "plain words" },
    aiInsights: null,
    imagePromptTemplate: "",
    outputConfig: { slideCount: 5, ...outputConfig },
    previousStageOutputs: {},
    ...over,
  } as unknown as ExecutionContext;
}

function assertClean(label: string, text: string) {
  assert(!/\{\{|\}\}/.test(text), `${label}: unresolved template braces: ${(text.match(/.{0,40}(\{\{|\}\}).{0,40}/) ?? [])[0]}`);
  // no "## Heading" left with nothing under it
  for (const section of text.split(/^## /m).slice(1)) {
    const [heading, ...rest] = section.split("\n");
    assert(rest.join("\n").trim().length > 0, `${label}: empty section: ${heading}`);
  }
  assert(!/undefined|null(?![a-z])/.test(text), `${label}: leaked undefined/null`);
}

const POST = "3 signals buyers send before they say yes.\n\nThey stop asking if.\n\nFree access below.";

for (const [name, template] of [["content", CONTENT_PROMPT], ["content (AI)", CONTENT_AI_PROMPT]] as const) {
  Deno.test(`${name} prompt - the post, the blueprint prompt and the Look CTA render cleanly`, () => {
    const ctx = carouselContext(mockContext({}, { ctaButtonText: "Comment SIGNALS" }), { post: POST });
    const { system, user } = renderPromptTemplate(template, ctx);
    assertClean(`${name} system`, system);
    assertClean(`${name} user`, user);
    assert(system.includes("5 slides: slide 1 is the cover, slides 2 to 4 are the 3 value slides, slide 5 is the call to action"));
    assert(system.includes("must equal 3"));
    assert(user.includes(`## THE POST\n${POST}`));
    assert(user.includes("THE BLUEPRINT PROMPT THE POST WAS WRITTEN FROM"));
    assert(user.includes("You are Cedric. Write a LinkedIn post. No hashtags."));
    assert(user.includes('"Comment SIGNALS". Use it for the last slide.'));
    assert(user.includes("exactly 5 slides"));
    assertEquals(system.includes("image_prompt"), name === "content (AI)");
  });

  Deno.test(`${name} prompt - format only: no copywriting rules or brand tone underneath the post`, () => {
    const { system, user } = renderPromptTemplate(template, carouselContext(mockContext(), { post: POST }));
    for (const rule of ["3 to 5", "Contrarian", "Curiosity gap", "Tone:", "Style:", "Never invent offer", "No warm-up"]) {
      assert(!system.includes(rule) && !user.includes(rule), `${name}: still carries "${rule}"`);
    }
  });

  Deno.test(`${name} prompt - no blueprint prompt, no CTA setting, user instructions`, () => {
    const ctx = carouselContext(mockContext({ masterPrompt: "", instructions: "Make it punchier" }), { post: POST });
    const { user } = renderPromptTemplate(template, ctx);
    assertClean(`${name} user`, user);
    assert(user.includes("Make it punchier"));
    assert(!user.includes("BLUEPRINT PROMPT"));
    assert(!user.includes("CALL TO ACTION SET ON THE BLUEPRINT"));
  });
}

Deno.test("content prompt - a 10-slide deck says 8 value slides; slide count is clamped to 3..10", () => {
  const ten = renderPromptTemplate(CONTENT_PROMPT, carouselContext(mockContext({}, { slideCount: 10 }), { post: POST }));
  assert(ten.system.includes("10 slides: slide 1 is the cover, slides 2 to 9 are the 8 value slides"));
  const unset = renderPromptTemplate(CONTENT_PROMPT, carouselContext(mockContext({}, { slideCount: undefined }), { post: POST }));
  assert(unset.system.includes("5 slides: slide 1 is the cover"));
  const tiny = renderPromptTemplate(CONTENT_PROMPT, carouselContext(mockContext({}, { slideCount: 2 }), { post: POST }));
  assert(tiny.system.includes("3 slides: slide 1 is the cover, slides 2 to 2 are the 1 value slides"));
});

Deno.test("content AI prompt - brand style block renders when the blueprint has an image prompt", () => {
  const ctx = carouselContext(mockContext({ imagePromptTemplate: "Grainy halftone poster, red accent" }), { post: POST });
  const { system } = renderPromptTemplate(CONTENT_AI_PROMPT, ctx);
  assertClean("ai system", system);
  assert(system.includes("Grainy halftone poster, red accent"));
});

Deno.test("prompts contain no em or en dashes in their own copy", () => {
  for (const t of [CONTENT_PROMPT, CONTENT_AI_PROMPT]) {
    assert(!/[–—]/.test(t.system + t.user), "prompt template contains an em or en dash");
  }
});
