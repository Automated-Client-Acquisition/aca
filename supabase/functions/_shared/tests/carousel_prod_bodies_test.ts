/**
 * Regression tests for the slide bodies that broke the old carousel renderer in
 * production (bullet points rendered as a gray blob, glued prose, arrows turned
 * into dashes, dot plus emoji markers, two-item "lists"). The normalizer must turn
 * each one into clean structured fields.
 */
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeCarouselSlides } from "../carousel/slides.ts";
import { PROD_BODIES } from "./fixtures/carousel_prod_bodies.ts";

const cover = (headline = "3 signals that show up before they say yes") => ({
  slide_number: 1, type: "cover", kicker: "3 signals", headline, body: "Read the room before the call.",
});
const cta = { slide_number: 5, type: "cta", headline: "Know who is ready", cta_button_text: "Comment SIGNALS" };
const point = (n: number, extra: Record<string, unknown> = {}) => ({
  slide_number: n, type: "content", headline: `Signal ${n - 1}`, body: "They ask about onboarding.", ...extra,
});

const withBody = (body: string, extra: Record<string, unknown> = {}) =>
  normalizeCarouselSlides([cover(), point(2, { headline: "The list", body, ...extra }), point(3), point(4), cta], { slideCount: 5 }).slides[1];

Deno.test("prod body 1 (ten inline items) - a real list of 4 items, no gray blob", () => {
  const s = withBody(PROD_BODIES.inlineTen);
  assertEquals(s.layout, "list");
  assertEquals(s.items, ["Orange Health Labs ($30M)", "CroíValve ($36M)", "Timefold ($13M)", "Fika Jobs ($4M)"]);
  assert(!s.body.includes("·"));
});

Deno.test("prod body 2 (sentence glued to the last item) - the sentence is a footnote, never part of an item", () => {
  const s = withBody(PROD_BODIES.trailingProse);
  assertEquals(s.layout, "list");
  assert(s.items!.every((i) => !i.includes("12 signals")));
  assertEquals(s.footnote, "12 signals. One window.");
  const t = withBody(PROD_BODIES.trailingProseBullets);
  assertEquals(t.items, ["Sales development", "Content marketing", "Market research", "Sales enablement"]);
  assertEquals(t.footnote, "One AI does it all, no breaks, no politics.");
});

Deno.test("prod body 3 (prose + arrow bullets + prose) - lead-in, four items, footnote; arrows never become dashes", () => {
  const s = withBody(PROD_BODIES.proseArrowsProse);
  assertEquals(s.layout, "list");
  assertEquals(s.items!.length, 4);
  assertEquals(s.items![0], "Interested = steered toward booking");
  assert(s.lead!.startsWith("Tier 1: 36 regex patterns"));
  assert(!s.lead!.includes("Tier 2"), "lead-in is one sentence, not the whole paragraph");
  assert(s.footnote!.startsWith("Confidence score"));
  assert(s.items!.every((i) => !/^[-→>]/.test(i)));
});

Deno.test("prod body 4 (dot plus emoji on every line) - emoji removed, clean parallel items", () => {
  const s = withBody(PROD_BODIES.doubleMarkers);
  assertEquals(s.layout, "list");
  assertEquals(s.items!.length, 4);
  assert(s.items!.every((i) => !/\p{Extended_Pictographic}/u.test(i)));
  assertEquals(s.items![0], "Leave the clinic with a protective headband");
  const p = withBody(PROD_BODIES.pinEmojis);
  assert(p.items!.every((i) => !/\p{Extended_Pictographic}/u.test(i) && !i.endsWith(".")));
});

Deno.test("prod body 5 (two-item 'list' whose second item continues the first) - a point with prose, not a list", () => {
  const s = withBody(PROD_BODIES.twoAsProse, { layout: "list" });
  assertEquals(s.layout, "point");
  assertEquals(s.items, undefined);
  assertEquals(
    s.body,
    "Scraping 10,000 leads at once feels productive. But treating a static CSV as evergreen guarantees diminishing returns.",
  );
});

Deno.test("emoji are stripped from every slide text field", () => {
  const r = normalizeCarouselSlides(
    [cover("3 signals that matter \u{1F525}"), point(2, { headline: "\u{1F4CD} Ask early", body: "Ask \u{1F440} first." }), point(3), point(4), cta],
    { slideCount: 5 },
  );
  assert(!/\p{Extended_Pictographic}/u.test(JSON.stringify(r.slides)));
});

Deno.test("a model-written items array is cleaned and a trailing sentence moves to the footnote", () => {
  const s = withBody("", {
    layout: "list",
    items: ["- Send the recap.", "\u{1F4CD} Book the next call.", "Share the plan. It takes ten minutes and nobody has to attend the meeting."],
    lead: "Three moves after every demo",
  });
  assertEquals(s.items, ["Send the recap", "Book the next call", "Share the plan"]);
  assertEquals(s.footnote, "It takes ten minutes and nobody has to attend the meeting.");
  assertEquals(s.lead, "Three moves after every demo");
  assertEquals(
    s.body,
    "Three moves after every demo\n\n- Send the recap\n- Book the next call\n- Share the plan\n\nIt takes ten minutes and nobody has to attend the meeting.",
  );
});
