import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applySlideEdit, applySlideTextEdit, convertLayout, readSlideFields } from "../carousel/slide-edit.ts";

const listSlide = {
  slide_number: 2, type: "content", layout: "list", headline: "Three moves", lead: "After every demo",
  items: ["Send the recap", "Book the next call", "Share the plan"],
  body: "After every demo\n\n- Send the recap\n- Book the next call\n- Share the plan",
};

Deno.test("slide edit - a headline edit keeps every structured field", () => {
  const next = applySlideTextEdit(listSlide, { headline: "Four moves" });
  assertEquals(next.headline, "Four moves");
  assertEquals(next.layout, "list");
  assertEquals(next.items, listSlide.items);
  assertEquals(next.lead, "After every demo");
  assertEquals(listSlide.headline, "Three moves", "the input slide is not mutated");
});

Deno.test("slide edit - editing a list body re-derives items, lead and footnote from it", () => {
  const next = applySlideTextEdit(listSlide, {
    body: "Do these\n\n- Send the recap fast\n- Book the next call\n- Share the plan\n- Ask for the intro\n\nNo exceptions.",
  });
  assertEquals(next.layout, "list");
  assertEquals(next.items, ["Send the recap fast", "Book the next call", "Share the plan", "Ask for the intro"]);
  assertEquals(next.lead, "Do these");
  assertEquals(next.footnote, "No exceptions.");
});

Deno.test("slide edit - a list body edited down to prose becomes a point, so the typed text is what renders", () => {
  const next = applySlideTextEdit(listSlide, { body: "Just send the recap and book the next call." });
  assertEquals(next.layout, "point");
  assertEquals(next.items, undefined);
  assertEquals(next.lead, undefined);
  assertEquals(next.body, "Just send the recap and book the next call.");
});

Deno.test("slide edit - an unchanged body leaves the structure alone", () => {
  const next = applySlideTextEdit(listSlide, { headline: "New", body: listSlide.body });
  assertEquals(next.items, listSlide.items);
  assertEquals(next.layout, "list");
});

Deno.test("slide edit - stat and point slides keep their fields when the body is edited", () => {
  const stat = { slide_number: 4, type: "content", layout: "stat", headline: "Go quiet", stat_value: "47%", stat_label: "of deals", body: "Silence is a pause." };
  const next = applySlideTextEdit(stat, { body: "Silence is not a no." });
  assertEquals(next.layout, "stat");
  assertEquals(next.stat_value, "47%");
  assertEquals(next.body, "Silence is not a no.");
});

Deno.test("slide edit - editing the body of a compare slide turns it into a point", () => {
  const compare = { slide_number: 3, type: "content", layout: "compare", headline: "Your demo", before: "Every feature", after: "One workflow", body: "Instead of: Every feature\nDo this: One workflow" };
  const next = applySlideTextEdit(compare, { body: "Show the one workflow that costs them most." });
  assertEquals(next.layout, "point");
  assertEquals(next.before, undefined);
  assertEquals(next.after, undefined);
});

Deno.test("slide edit - the CTA button edit lands on cta_button_text, which the renderer reads first", () => {
  const cta = { slide_number: 5, type: "cta", headline: "Spot them", cta_button_text: "Comment SIGNALS", cta_keyword: "SIGNALS", cta_reason: "Get the checklist" };
  const next = applySlideTextEdit(cta, { ctaText: "Comment GOLD" });
  assertEquals(next.cta_button_text, "Comment GOLD");
  assertEquals(next.ctaText, "Comment GOLD");
  assertEquals(next.cta_keyword, "SIGNALS");
  assert(next.cta_reason === "Get the checklist");
});

// ---------- structured editing (layout-aware editor) ----------


// the 09-29 live deck, as stored by the slide-copy stage
const liveCompare = {
  slide_number: 2, type: "content", layout: "compare", headline: "The question type flipped",
  before: "'Does this actually work for our use case?'",
  after: "'How long does onboarding take and who handles data migration?'",
  body: "Instead of: 'Does this actually work for our use case?'\nDo this: 'How long does onboarding take and who handles data migration?'",
};
const liveCta = {
  slide_number: 5, type: "cta", kicker: "Now you know all 3 signals", headline: "Get the Buyer Intent Diagnostic Checklist",
  cta_keyword: "SIGNALS", cta_button_text: "Comment SIGNALS below", cta_reason: "1-page checklist to spot all 3 signals in real time",
  body: "1-page checklist to spot all 3 signals in real time",
};

Deno.test("structured edit - editing the 'Do this' side keeps a compare slide a compare slide", () => {
  const f = readSlideFields(liveCompare);
  assertEquals(f.layout, "compare");
  assertEquals(f.before, liveCompare.before);
  const saved = applySlideEdit(liveCompare, { ...f, after: "'Who owns the rollout on your side?'" }) as any;
  assertEquals(saved.layout, "compare");
  assertEquals(saved.after, "'Who owns the rollout on your side?'");
  assertEquals(saved.before, liveCompare.before);
  assertEquals(saved.body, `Instead of: ${liveCompare.before}\nDo this: 'Who owns the rollout on your side?'`);
});

Deno.test("structured edit - the CTA form opens with the real button, and a new button renames the keyword chip", () => {
  const f = readSlideFields(liveCta);
  assertEquals(f.cta_button_text, "Comment SIGNALS below");
  const saved = applySlideEdit(liveCta, { ...f, cta_button_text: "Comment GUIDE" }) as any;
  assertEquals(saved.cta_keyword, "GUIDE");
  assertEquals(saved.cta_button_text, "Comment GUIDE");
  // a button with no keyword clears the chip instead of leaving a stale one
  const save = applySlideEdit(liveCta, { ...f, cta_button_text: "Save this post" }) as any;
  assertEquals(save.cta_keyword, undefined);
});

Deno.test("structured edit - renaming the keyword renames it in the untouched button", () => {
  const f = readSlideFields(liveCta);
  const saved = applySlideEdit(liveCta, { ...f, cta_keyword: "intent" }) as any;
  assertEquals(saved.cta_keyword, "INTENT");
  assertEquals(saved.cta_button_text, "Comment INTENT below");
  assertEquals(saved.body, liveCta.cta_reason);
});

Deno.test("structured edit - stat number, list items and the cover label are editable fields", () => {
  const stat = { slide_number: 3, type: "content", layout: "stat", headline: "Most deals stall here", stat_value: "47%", stat_label: "of stalled deals", body: "x" };
  const s = applySlideEdit(stat, { ...readSlideFields(stat), stat_value: "62%" }) as any;
  assertEquals(s.stat_value, "62%");
  assertEquals(s.layout, "stat");

  const list = { slide_number: 2, type: "content", layout: "list", headline: "Signals", items: ["a", "b", "c"], body: "- a\n- b\n- c" };
  const l = applySlideEdit(list, { ...readSlideFields(list), items: ["a", "b", "c", "d"], lead: "Watch for:" }) as any;
  assertEquals(l.items, ["a", "b", "c", "d"]);
  assertEquals(l.body, "Watch for:\n\n- a\n- b\n- c\n- d");

  const cover = { slide_number: 1, type: "cover", kicker: "FOR B2B SELLERS", headline: "3 signals", highlight: "3 signals", body: "sub" };
  const c = applySlideEdit(cover, { ...readSlideFields(cover), kicker: "", highlight: "signals" }) as any;
  assertEquals(c.kicker, undefined);
  assertEquals(c.highlight, "signals");
  assertEquals(c.body, "sub");
});

Deno.test("structured edit - switching layout carries the text over and clears the old layout's fields", () => {
  const f = readSlideFields(liveCompare);
  const asList = convertLayout(f, "list");
  assertEquals(asList.items.length, 2);
  const asPoint = convertLayout(f, "point");
  assert(asPoint.body.includes("Does this actually work"));
  const saved = applySlideEdit(liveCompare, asPoint) as any;
  assertEquals(saved.layout, "point");
  assertEquals(saved.before, undefined);
  assertEquals(saved.after, undefined);

  const point = readSlideFields({ slide_number: 3, type: "content", layout: "point", headline: "47% go quiet", body: "Most stalled deals restart. Silence is a pause." });
  const asStat = convertLayout(point, "stat");
  assertEquals(asStat.stat_value, "47%");
  const asList2 = convertLayout(point, "list");
  assertEquals(asList2.items, ["Most stalled deals restart", "Silence is a pause"]);
});

Deno.test("structured edit - an older slide with a bullet body opens as a list", () => {
  const f = readSlideFields({ slide_number: 2, type: "content", headline: "Signals", body: "- onboarding\n- migration\n- adoption" });
  assertEquals(f.layout, "list");
  assertEquals(f.items, ["onboarding", "migration", "adoption"]);
});

Deno.test("structured edit - an AI slide's image prompt is dropped only when its text changes", () => {
  const ai = { slide_number: 3, type: "content", layout: "point", headline: "Old words", body: "b", image_prompt: "Render the headline 'Old words'" };
  const same = applySlideEdit(ai, readSlideFields(ai)) as any;
  assertEquals(same.image_prompt, ai.image_prompt);
  const edited = applySlideEdit(ai, { ...readSlideFields(ai), headline: "New words" }) as any;
  assertEquals(edited.image_prompt, undefined);
  assertEquals(edited.headline, "New words");
});

Deno.test("structured edit - a two-word keyword keeps its space (job d8cb6db8: GMAPSAGENT)", () => {
  const f = readSlideFields(liveCta);
  const typed = applySlideEdit(liveCta, { ...f, cta_keyword: "gmaps  agent" }) as any;
  assertEquals(typed.cta_keyword, "GMAPS AGENT");
  assertEquals(typed.cta_button_text, "Comment GMAPS AGENT below");
  const fromButton = applySlideEdit(liveCta, { ...f, cta_button_text: 'COMMENT "CAROUSEL AGENT"' }) as any;
  assertEquals(fromButton.cta_keyword, "CAROUSEL AGENT");
});
