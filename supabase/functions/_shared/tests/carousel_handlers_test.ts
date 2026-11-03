import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { executeCarouselContentStage, postForSlides } from "../stages/handlers/CarouselCopyHandlers.ts";
import { CAROUSEL_CONTENT_STAGE } from "../stages/definitions/instagram_carousel.ts";
import { CAROUSEL_CONTENT_AI_STAGE } from "../stages/definitions/instagram_carousel_ai.ts";
import { StageRegistry } from "../execution/StageRegistry.ts";
import type { ExecutionContext } from "../execution/types.ts";

/** Stub engine: replies come from a queue, prompts are recorded. */
function stubEngine(replies: string[]) {
  const calls: Array<{ system: string; user: string }> = [];
  const engine: any = {
    executeTextStage: (_ctx: unknown, _def: unknown, prompts: { system: string; user: string }) => {
      calls.push(prompts);
      const text = replies.shift();
      if (text === undefined) throw new Error("no more stub replies");
      return Promise.resolve({ content: text, text, model: "stub/model", usage: { inputTokens: 100, outputTokens: 50 }, cost: 0.01, status: "completed" });
    },
  };
  return { engine, calls };
}

const POST = "3 signals buyers send before they say yes.\n\nThey stop asking if and ask about onboarding.\n\nFree access below. ↓";

function ctx(over: Record<string, unknown> = {}, outputConfig: Record<string, unknown> = {}): ExecutionContext {
  return {
    pipeline: "instagram_carousel",
    ideaContext: "Buyer intent signals",
    masterPrompt: "You are Cedric. Write a LinkedIn post. No hashtags.",
    brandVoice: { name: "Acme", tone: "direct", writingStyle: "plain" },
    aiInsights: null,
    outputConfig: { slideCount: 5, ...outputConfig },
    previousStageOutputs: { caption: { content: POST } },
    ...over,
  } as unknown as ExecutionContext;
}

const slidesReply = (over: Record<string, unknown>[] = []) => JSON.stringify({
  slides: [
    { slide_number: 1, type: "cover", headline: "3 signals buyers send before they say yes" },
    { slide_number: 2, type: "content", layout: "list", headline: "They stop asking if", items: ["onboarding", "migration", "adoption"] },
    { slide_number: 3, type: "content", layout: "point", headline: "They bring the team", body: "Procurement joins unprompted." },
    { slide_number: 4, type: "content", layout: "stat", headline: "47% go quiet", stat_value: "47%", stat_label: "of stalled deals" },
    { slide_number: 5, type: "cta", headline: "Get the checklist", cta_button_text: "Free access below" },
  ].map((s, i) => ({ ...s, ...(over[i] ?? {}) })),
});

// ---------- the caption is the blueprint prompt, not a carousel stage ----------

Deno.test("carousel caption is not an engine stage: it runs the social-post text path", () => {
  assertEquals(StageRegistry.has("instagram_carousel", "caption"), false);
  assertEquals(StageRegistry.has("instagram_carousel_ai", "caption"), false);
  assertEquals(StageRegistry.has("instagram_carousel", "carousel_content"), true);
});

Deno.test("postForSlides - the stored caption without its first comment", () => {
  assertEquals(postForSlides({ content: "The post.\n\n---FOLLOW-UP---\n\nThe link.\n[LINK]" }), "The post.");
  assertEquals(postForSlides({ text: "From text", content: "From content" }), "From text");
  assertEquals(postForSlides(undefined), "");
});

// ---------- content stage ----------

Deno.test("content stage - slides are cut from the post; no copy rules of its own", async () => {
  const { engine, calls } = stubEngine([slidesReply()]);
  const result = await executeCarouselContentStage(
    ctx({ previousStageOutputs: { caption: { content: `${POST}\n\n---FOLLOW-UP---\n\nThe kit.\n[LINK]` } } }),
    CAROUSEL_CONTENT_STAGE,
    engine,
  );
  assertEquals(calls.length, 1);
  assert(calls[0].user.includes("## THE POST\n3 signals buyers send"));
  assert(!calls[0].user.includes("[LINK]"), "the first comment is not part of the slides");
  assert(calls[0].user.includes("You are Cedric. Write a LinkedIn post. No hashtags."));
  assert(calls[0].system.includes("THE POST IS THE ONLY SOURCE"));
  for (const copyRule of ["3 to 5 hashtags", "Comment SIGNALS", "Contrarian", "- Tone:", "80 to 220 words"]) {
    assert(!calls[0].system.includes(copyRule), copyRule);
  }
  const slides = (result.content as any).slides;
  assertEquals(slides.length, 5);
  assertEquals(slides.map((s: any) => s.layout ?? s.type), ["cover", "list", "point", "stat", "cta"]);
  assertEquals(slides[4].cta_button_text, "Free access below");
  assertEquals(slides[4].kicker, undefined, "no invented 'Now you know...' recap");
  assertEquals((result.content as any).quality_warnings, undefined);
  assertEquals(typeof (result.content as any).raw_text, "string");
});

Deno.test("content stage - no post yet throws instead of inventing slides", async () => {
  const { engine, calls } = stubEngine([slidesReply()]);
  await assertRejects(
    () => executeCarouselContentStage(ctx({ previousStageOutputs: {} }), CAROUSEL_CONTENT_STAGE, engine),
    Error,
    "need the post",
  );
  assertEquals(calls.length, 0);
});

Deno.test("content stage - the blueprint CTA setting and user instructions reach the prompt", async () => {
  const { engine, calls } = stubEngine([slidesReply()]);
  await executeCarouselContentStage(
    ctx({ instructions: "Fewer words on slide 3" }, { ctaButtonText: "Drop 'SIGNALS' in the comments" }),
    CAROUSEL_CONTENT_STAGE,
    engine,
  );
  assert(calls[0].user.includes("Drop 'SIGNALS' in the comments"));
  assert(calls[0].user.includes("Fewer words on slide 3"));
});

Deno.test("content stage - a CTA button that is a sentence is sent back for a retry", async () => {
  const long = slidesReply([{}, {}, {}, {}, { cta_button_text: "Grab the full reply workflow and the templates below" }]);
  const { engine, calls } = stubEngine([long, slidesReply()]);
  const result = await executeCarouselContentStage(ctx(), CAROUSEL_CONTENT_STAGE, engine);
  assertEquals(calls.length, 2);
  assert(calls[1].user.includes("must be 5 words or fewer"));
  assertEquals((result.content as any).slides[4].cta_button_text, "Free access below");
});

Deno.test("content stage - a slide-count mismatch retries once with the problem, then keeps the best", async () => {
  const short = JSON.stringify({ slides: JSON.parse(slidesReply()).slides.slice(0, 4) });
  const { engine, calls } = stubEngine([short, short]);
  const result = await executeCarouselContentStage(ctx(), CAROUSEL_CONTENT_STAGE, engine);
  assertEquals(calls.length, 2);
  assert(calls[1].user.includes("Expected exactly 5 slides but got 4"));
  const content = result.content as any;
  assertEquals(content.slides.length, 4);
  assert(content.quality_warnings.some((w: string) => w.startsWith("Unresolved after retry")));
});

Deno.test("content stage - a cover count that disagrees with the deck is fixed by the retry", async () => {
  const wrong = slidesReply([{ headline: "5 signals buyers send before they say yes" }]);
  const { engine, calls } = stubEngine([wrong, slidesReply()]);
  const result = await executeCarouselContentStage(ctx(), CAROUSEL_CONTENT_STAGE, engine);
  assertEquals(calls.length, 2);
  assert(calls[1].user.includes("promises 5"));
  assertEquals((result.content as any).quality_warnings, undefined);
});

Deno.test("content stage - unparseable twice throws", async () => {
  const { engine } = stubEngine(["not json", "still not json"]);
  await assertRejects(() => executeCarouselContentStage(ctx(), CAROUSEL_CONTENT_STAGE, engine), Error, "no slides");
});

// Reasoning models (deepseek-v4.1-flash) think before they answer, and the
// thinking is billed against max_tokens. At 3500 both attempts came back empty
// (outputTokens 3500, content "") and the job failed as "not valid JSON"
// (job e9b10d7b, 2026-10-02).
Deno.test("content stage - budgets leave room for a reasoning model to think and still answer", () => {
  assert(CAROUSEL_CONTENT_STAGE.providerConfig.maxTokens! >= 8192, "template carousel");
  assert(CAROUSEL_CONTENT_AI_STAGE.providerConfig.maxTokens! >= 8192, "AI carousel");
});

Deno.test("content stage - an empty reply at the token ceiling says the budget ran out, and retries the same prompt", async () => {
  const budget = CAROUSEL_CONTENT_STAGE.providerConfig.maxTokens!;
  const calls: Array<{ system: string; user: string }> = [];
  const engine: any = {
    executeTextStage: (_ctx: unknown, _def: unknown, prompts: { system: string; user: string }) => {
      calls.push(prompts);
      return Promise.resolve({ content: "", text: "", model: "deepseek/deepseek-v4.1-flash", usage: { inputTokens: 2547, outputTokens: budget }, status: "completed", finishReason: "length" });
    },
  };
  const err = await assertRejects(() => executeCarouselContentStage(ctx(), CAROUSEL_CONTENT_STAGE, engine), Error);
  assert(err.message.includes("token budget"), err.message);
  assert(!err.message.includes("not valid JSON"), err.message);
  assertEquals(calls.length, 2);
  assertEquals(calls[1].user, calls[0].user, "an empty answer has nothing to correct: resend the original prompt");
});

Deno.test("content stage (AI) - missing image prompts trigger a retry and then get a fallback prompt", async () => {
  const noPrompts = slidesReply();
  const { engine, calls } = stubEngine([noPrompts, noPrompts]);
  const result = await executeCarouselContentStage(ctx({ pipeline: "instagram_carousel_ai" }), CAROUSEL_CONTENT_AI_STAGE, engine);
  assertEquals(calls.length, 2);
  assert(calls[1].user.includes("no \"image_prompt\""));
  const slides = (result.content as any).slides;
  assert(slides.every((s: any) => typeof s.image_prompt === "string" && s.image_prompt.length > 10));
});
