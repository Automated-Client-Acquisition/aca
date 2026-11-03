import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { cleanListItem, normalizeItems, parseListBody, splitKeyValue } from "../carousel/list-parse.ts";
import { PROD_BODIES } from "./fixtures/carousel_prod_bodies.ts";

Deno.test("prod body 1 - ten inline items split cleanly, nothing glued together", () => {
  const p = parseListBody(PROD_BODIES.inlineTen)!;
  assertEquals(p.items.length, 10);
  assertEquals(p.items[0], "Orange Health Labs ($30M)");
  assertEquals(p.items[9], "Citring");
  assertEquals(p.footnote, "");
  assertEquals(p.lead, "");
  assert(p.inline);
});

Deno.test("prod body 2 - a trailing sentence becomes the footnote, not part of the last item", () => {
  const p = parseListBody(PROD_BODIES.trailingProse)!;
  assertEquals(p.items.length, 6);
  assertEquals(p.items[5], "'Real World' AI startup");
  assertEquals(p.footnote, "12 signals. One window.");
  const q = parseListBody(PROD_BODIES.trailingProseBullets)!;
  assertEquals(q.items, ["Sales development", "Content marketing", "Market research", "Sales enablement", "Demand gen"]);
  assertEquals(q.footnote, "One AI does it all, no breaks, no politics.");
});

Deno.test("prod body 3 - prose, five arrow bullets, prose: lead, items and footnote are separated", () => {
  const p = parseListBody(PROD_BODIES.proseArrowsProse)!;
  assert(p.lead.startsWith("Tier 1: 36 regex patterns"));
  assertEquals(p.items.length, 5);
  assertEquals(p.items[0], "Interested = steered toward booking");
  assertEquals(p.items[4], "OOO = snoozed to exact return date");
  assert(p.footnote.startsWith("Confidence score (0–1.0)"));
  assert(p.footnote.endsWith("Conservative teams run 0.60."));
  // no arrow or dash leaks into an item
  assert(p.items.every((i) => !/^[-→>]/.test(i)));
});

Deno.test("prod body 3 - arrows survive: '->' written as ascii arrows parse the same", () => {
  const ascii = PROD_BODIES.proseArrowsProse.replace(/→/g, "->");
  const p = parseListBody(ascii)!;
  assertEquals(p.items.length, 5);
  assertEquals(p.items[1], "Neutral = qualifying questions sent");
});

Deno.test("prod body 4 - emoji on every line is stripped from the item and returned separately", () => {
  const p = parseListBody(PROD_BODIES.doubleMarkers)!;
  assertEquals(p.items, [
    "Leave the clinic with a protective headband",
    "Private transfer takes you back to the hotel",
    "Start your prescribed meds to prevent swelling",
    "Stay hydrated but avoid caffeine and alcohol",
  ]);
  assertEquals(p.emojis.length, 4);
  assert(p.emojis.every((e) => e.length > 0));
  const q = parseListBody(PROD_BODIES.pinEmojis)!;
  assertEquals(q.items[0], "Not every hair moved will actually grow");
  assert(q.items.every((i) => !i.endsWith(".")));
});

Deno.test("prod body 5 - a two-bullet body still parses (callers decide it is prose, not a list)", () => {
  const p = parseListBody(PROD_BODIES.twoAsProse)!;
  assertEquals(p.items.length, 2);
  assertEquals(p.items[1], "But treating a static CSV as evergreen guarantees diminishing returns");
});

Deno.test("parseListBody - plain prose, one bullet, a stray separator and a sentence with hyphens are not lists", () => {
  assertEquals(parseListBody("Procurement joins unprompted. That means budget is moving."), null);
  assertEquals(parseListBody("- just one bullet"), null);
  assertEquals(parseListBody("Fast · cheap"), null);
  assertEquals(parseListBody("A well-known, cloud-based tool"), null);
  assertEquals(parseListBody(""), null);
  assertEquals(parseListBody(undefined), null);
});

Deno.test("parseListBody - numbered items on one line and letter markers", () => {
  const p = parseListBody("Do this: 1. Open the file. 2. Change the name. 3. Save it")!;
  assertEquals(p.items.length, 3);
  assertEquals(p.items[1], "Change the name");
  const q = parseListBody("a) first thing\nb) second thing\nc) third thing")!;
  assertEquals(q.items, ["first thing", "second thing", "third thing"]);
});

Deno.test("parseListBody - a first-segment lead-in before a colon is split off", () => {
  const p = parseListBody("Today's Funding Signals: Acme ($3M) · Beta ($4M) · Gamma ($5M)")!;
  assertEquals(p.lead, "Today's Funding Signals");
  assertEquals(p.items, ["Acme ($3M)", "Beta ($4M)", "Gamma ($5M)"]);
});

Deno.test("parseListBody - a wrapped bullet continues the item; a capitalised line after a gap is a footnote", () => {
  const p = parseListBody("- A long first item that\nwraps onto a second line\n- Second item\n- Third item\n\nNote: numbers are illustrative")!;
  assertEquals(p.items[0], "A long first item that wraps onto a second line");
  assertEquals(p.footnote, "Note: numbers are illustrative");
});

Deno.test("normalizeItems - markers, emoji, markdown and trailing periods are stripped; a sentence tail moves to the footnote", () => {
  const n = normalizeItems(["- **Send** the recap.", "\u{1F4CD} Book the next call.", "1) Share the plan. It takes ten minutes and nobody has to attend the meeting."]);
  assertEquals(n.items, ["Send the recap", "Book the next call", "Share the plan"]);
  assertEquals(n.footnote, "It takes ten minutes and nobody has to attend the meeting.");
});

Deno.test("cleanListItem / splitKeyValue", () => {
  assertEquals(cleanListItem("→ Interested = booking.").text, "Interested = booking");
  assertEquals(splitKeyValue("Interested = steered toward booking"), { key: "Interested", value: "steered toward booking" });
  assertEquals(splitKeyValue("Just a plain item"), null);
  assertEquals(splitKeyValue("This is much too long to be a key: value"), null);
});
