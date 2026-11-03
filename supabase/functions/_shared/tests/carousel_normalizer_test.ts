import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeCarouselSlides, ensureImagePrompts } from "../carousel/slides.ts";
import { normalizeCta, promisedCount, resolveSlideCount, valueSlideCountFor } from "../carousel/plan.ts";

const cover = (headline = "3 signals that show up before they say yes") => ({
  slide_number: 1, type: "cover", kicker: "3 signals", headline, body: "Read the room before the call.",
});
const cta = (extra: Record<string, unknown> = {}) => ({
  slide_number: 5, type: "cta", headline: "Know who is ready", cta_button_text: "Comment SIGNALS", ...extra,
});
const point = (n: number, extra: Record<string, unknown> = {}) => ({
  slide_number: n, type: "content", headline: `Signal ${n - 1}`, body: "They ask about onboarding.", ...extra,
});

// ---------- slide counts ----------

Deno.test("slide counts - default 5, min 3, max 10, value slides = count - 2", () => {
  assertEquals(resolveSlideCount(undefined), 5);
  assertEquals(resolveSlideCount(2), 3);
  assertEquals(resolveSlideCount(12), 10);
  assertEquals(resolveSlideCount("7"), 7);
  assertEquals(valueSlideCountFor(5), 3);
  assertEquals(valueSlideCountFor(3), 1);
});

// ---------- count mismatch ----------

Deno.test("normalizeCarouselSlides - too few slides is a problem", () => {
  const r = normalizeCarouselSlides([cover(), point(2), cta({ slide_number: 3 })], { slideCount: 5 });
  assert(r.problems.some((p) => p.startsWith("Expected exactly 5")));
  assertEquals(r.slides.length, 3);
});

Deno.test("normalizeCarouselSlides - too many slides keeps cover and CTA, drops middle extras", () => {
  const raw = [cover(), point(2), point(3), point(4), point(5), point(6), cta({ slide_number: 7 })];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides.length, 5);
  assertEquals(r.slides[0].type, "cover");
  assertEquals(r.slides[4].type, "cta");
  assertEquals(r.slides.map((s) => s.slide_number), [1, 2, 3, 4, 5]);
  assert(r.warnings.some((w) => w.includes("extra slides were dropped")));
  assertEquals(r.problems.length, 0);
});

Deno.test("normalizeCarouselSlides - types are forced by position", () => {
  const raw = [
    { slide_number: 1, type: "content", headline: "3 signals that show up early" },
    point(2), point(3), point(4),
    { slide_number: 5, type: "content", headline: "Comment below" },
  ];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides.map((s) => s.type), ["cover", "content", "content", "content", "cta"]);
});

// ---------- CTA ----------

Deno.test("normalizeCarouselSlides - paragraph CTA becomes a derived button plus a reason", () => {
  const paragraph = "Drop 'SIGNALS' in the comments and I'll DM you our 1-page Buyer Intent Diagnostic Checklist.";
  const r = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta({ cta_button_text: paragraph })], {
    slideCount: 5,
  });
  const last = r.slides[4];
  // asked back first: the retry takes a short button from the post
  assert(r.problems.some((p) => p.includes("must be 5 words or fewer")));
  // last resort after the retry: derived from the post's own keyword, never a paragraph
  assertEquals(last.cta_button_text, "Comment SIGNALS");
  assertEquals(last.cta_keyword, "SIGNALS");
  assertEquals(last.cta_reason, paragraph);
  assertEquals(last.body, paragraph);
});

Deno.test("normalizeCarouselSlides - blueprint CTA instruction is the source when the model wrote a paragraph", () => {
  const instruction = "Drop 'SIGNALS' in the comments and I'll DM you the checklist";
  const r = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta({ cta_button_text: instruction })], {
    slideCount: 5,
    ctaInstruction: instruction,
  });
  assertEquals(r.slides[4].cta_button_text, "Comment SIGNALS");
});

Deno.test("normalizeCarouselSlides - a button-sized blueprint CTA is used exactly", () => {
  const r = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta({ cta_button_text: "Save this" })], {
    slideCount: 5,
    ctaInstruction: "Book a free call",
  });
  assertEquals(r.slides[4].cta_button_text, "Book a free call");
  assertEquals(r.problems.length, 0);
});

Deno.test("normalizeCta - no keyword derives from the verb, never a paragraph", () => {
  const out = normalizeCta({ button: "Save this post so you can come back to it when your next deal stalls" });
  assert(out.button.split(" ").length <= 5);
  assertEquals(out.button, "Save this post");
  assertEquals(out.keyword, null);
});

// ---------- layout ----------

Deno.test("normalizeCarouselSlides - missing layout is inferred from the fields", () => {
  const raw = [
    cover(),
    point(2, { body: "- Asks about onboarding\n- Asks about migration\n- Asks about adoption" }),
    point(3, { stat_value: "47%", stat_label: "of buyers go quiet" }),
    point(4, { before: "Send a deck", after: "Send a mutual plan" }),
    cta(),
  ];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides[1].layout, "list");
  assertEquals(r.slides[1].items?.length, 3);
  assertEquals(r.slides[2].layout, "stat");
  assertEquals(r.slides[3].layout, "compare");
});

Deno.test("normalizeCarouselSlides - a plain slide defaults to point and keeps body", () => {
  const r = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta()], { slideCount: 5 });
  assertEquals(r.slides[1].layout, "point");
  assertEquals(r.slides[1].body, "They ask about onboarding.");
});

Deno.test("normalizeCarouselSlides - list body is synced from items and capped at 4", () => {
  const r = normalizeCarouselSlides(
    [cover(), point(2, { layout: "list", items: ["a one", "b two", "c three", "d four", "e five"] }), point(3), point(4), cta()],
    { slideCount: 5 },
  );
  assertEquals(r.slides[1].items?.length, 4);
  assertEquals(r.slides[1].body, "- a one\n- b two\n- c three\n- d four");
  assert(r.warnings.some((w) => w.includes("kept the first 4")));
});

Deno.test("normalizeCarouselSlides - a layout whose fields are missing is demoted", () => {
  const raw = [cover(), point(2, { layout: "compare" }), point(3, { layout: "list", items: ["only one"] }), point(4), cta()];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides[1].layout, "point");
  assertEquals(r.slides[2].layout, "point");
  assert(r.warnings.length >= 2);
});

// ---------- cover number vs deck ----------

Deno.test("promisedCount - counts of the deck only", () => {
  assertEquals(promisedCount("3 signals that show up before they say yes"), 3);
  assertEquals(promisedCount("Five mistakes killing your open rate"), 5);
  assertEquals(promisedCount("Steal my 5-step lead system"), 5);
  assertEquals(promisedCount("How we booked 47 calls in 14 days"), null);
  assertEquals(promisedCount("Stop posting every day"), null);
  assertEquals(promisedCount("Cut costs by 30% in 2 weeks"), null);
});

Deno.test("promisedCount - version numbers and ordinals are not counts", () => {
  // job 32a594dc: "Gemini 4" was read as a promise of 4 slides and spent the retry on it
  assertEquals(promisedCount("Gemini 4 has been announced."), null);
  assertEquals(promisedCount("GPT-5 just dropped"), null);
  assertEquals(promisedCount("Why GPT 5 changes outbound"), null);
  assertEquals(promisedCount("Day 3 of building in public"), null);
  // a count still counts after a name, at the start, or behind a lead-in word
  assertEquals(promisedCount("Claude 5 vs GPT 6: 4 lessons"), 4);
  assertEquals(promisedCount("10 Fresh Signals Dropped Today"), 10);
  assertEquals(promisedCount("Why 5 numbers explain your pipeline"), 5);
  assertEquals(promisedCount("WHY 5 NUMBERS EXPLAIN YOUR PIPELINE"), 5);
  assertEquals(promisedCount("Top 7 tools for outbound"), 7);
  assertEquals(promisedCount("These 3 signals beat intent data"), 3);
});

Deno.test("normalizeCarouselSlides - cover count that does not match the value slides is a problem", () => {
  const ok = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta()], { slideCount: 5 });
  assertEquals(ok.problems.length, 0);
  const bad = normalizeCarouselSlides([cover("5 signals that show up early"), point(2), point(3), point(4), cta()], {
    slideCount: 5,
  });
  assert(bad.problems.some((p) => p.includes("promises 5")));
});

Deno.test("normalizeCarouselSlides - the prod deck shape (intro slide eats a value slot) is caught", () => {
  // 5 slides, cover promises 3 but slide 2 is an intro: still 3 value slides, count matches,
  // so the plan (beat 1 must deliver value) is what prevents the warm-up. With 4 slides it must flag.
  const r = normalizeCarouselSlides([cover(), point(2), point(3), cta({ slide_number: 4 })], { slideCount: 4 });
  assert(r.problems.some((p) => p.includes("promises 3")));
});

// ---------- the model's deck, kept as written ----------

Deno.test("normalizeCarouselSlides - cover and CTA stay as the model cut them from the post; no recap invented", () => {
  const raw = [cover("Inboxes are crowded"), point(2), point(3), point(4), cta({ headline: "Get the workflow", cta_button_text: "Free access below" })];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides[0].headline, "Inboxes are crowded");
  assertEquals(r.slides[4].headline, "Get the workflow");
  assertEquals(r.slides[4].cta_button_text, "Free access below");
  assertEquals(r.slides[4].cta_keyword, undefined);
  assertEquals(r.slides[4].kicker, undefined);
  assertEquals(r.problems.length, 0);
});

Deno.test("normalizeCarouselSlides - a stat slide with no value recovers the number from its own text", () => {
  const raw = [cover(), point(2), point(3), point(4, { layout: "stat", headline: "47% go quiet before the demo", body: "" }), cta()];
  const r = normalizeCarouselSlides(raw, { slideCount: 5 });
  assertEquals(r.slides[3].layout, "stat");
  assertEquals(r.slides[3].stat_value, "47%");
});

// ---------- copy cleaning ----------

Deno.test("normalizeCarouselSlides - dashes and markdown are removed from copy", () => {
  const r = normalizeCarouselSlides(
    [cover(), point(2, { headline: "**Stop** guessing — start asking", body: "Use `this` – it works" }), point(3), point(4), cta()],
    { slideCount: 5 },
  );
  assert(!/[–—*`]/.test(r.slides[1].headline + r.slides[1].body));
});

// ---------- AI variant ----------

Deno.test("normalizeCarouselSlides - AI variant flags missing image prompts and fills a fallback", () => {
  const raw = [
    { ...cover(), image_prompt: "poster" }, { ...point(2), image_prompt: "x" }, point(3), { ...point(4), image_prompt: "y" }, { ...cta(), image_prompt: "z" },
  ];
  const r = normalizeCarouselSlides(raw, { slideCount: 5, requireImagePrompt: true });
  assert(r.problems.some((p) => p.includes("Slides 3 have no")));
  const notes = ensureImagePrompts(r.slides);
  assertEquals(notes.length, 1);
  assert(r.slides[2].image_prompt!.includes("Signal 2"));
});

// ---------- legacy decks ----------

Deno.test("normalizeCarouselSlides - a legacy deck with no layout, kicker or items still normalizes", () => {
  const legacy = {
    slides: [
      { slide_number: 1, type: "cover", headline: "Your lead is ready. You missed it.", body: "" },
      { slide_number: 2, type: "content", headline: "Enthusiasm is a smokescreen.", body: "Nodding on Zoom is not intent." },
      { slide_number: 3, type: "content", headline: "Signal 1: They stop asking if.", body: "- Asks about onboarding\n- Asks about data migration\n- Asks about adoption" },
      { slide_number: 4, type: "content", headline: "Signal 2: They bring the team.", body: "Procurement joins unprompted." },
      { slide_number: 5, type: "cta", headline: "Know who is ready.", body: "Get the checklist.", cta_button_text: "Comment SIGNALS" },
    ],
  };
  const r = normalizeCarouselSlides(legacy, { slideCount: 5 });
  assertEquals(r.problems.length, 0);
  assertEquals(r.slides.map((s) => s.layout ?? s.type), ["cover", "point", "list", "point", "cta"]);
  assertEquals(r.slides[4].cta_button_text, "Comment SIGNALS");
});

Deno.test("normalizeCta - a two-word keyword keeps its space (job d8cb6db8: GMAPSAGENT)", () => {
  assertEquals(normalizeCta({ keyword: "GMAPS AGENT", button: 'COMMENT "GMAPS AGENT"' }).keyword, "GMAPS AGENT");
  assertEquals(normalizeCta({ button: 'Comment "lead agent" for the build' }).keyword, "LEAD AGENT");
  assertEquals(normalizeCta({ button: "Comment SIGNAL AGENT below" }).keyword, "SIGNAL AGENT");
  assertEquals(normalizeCta({ button: "Comment GUIDE AND I'll send it" }).keyword, "GUIDE");
  const r = normalizeCarouselSlides([cover(), point(2), point(3), point(4), cta({ cta_keyword: "linkedin agent", cta_button_text: 'Comment "LINKEDIN AGENT"' })], { slideCount: 5 });
  assertEquals(r.slides[4].cta_keyword, "LINKEDIN AGENT");
});
