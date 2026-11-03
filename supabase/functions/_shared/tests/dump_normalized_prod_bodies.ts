/**
 * Writes the production bodies, run through the slide-copy normalizer, as JSON the
 * renderer harness can draw (workers/carousel-renderer/test-data/prod-bodies-normalized.json).
 * That is the "after" path end to end: model-shaped body string -> structured slide -> pixels.
 *
 *   deno run --allow-write --allow-read --no-check supabase/functions/_shared/tests/dump_normalized_prod_bodies.ts
 */
import { normalizeCarouselSlides } from "../carousel/slides.ts";
import { PROD_BODIES } from "./fixtures/carousel_prod_bodies.ts";

const cases: Array<[string, string, string]> = [
  ["inline-ten", "Today's Funding Signals - Jun 23", PROD_BODIES.inlineTen],
  ["trailing-prose", "The Full Raise List Today", PROD_BODIES.trailingProse],
  ["trailing-bullets", "Six Roles, One AI Employee", PROD_BODIES.trailingProseBullets],
  ["arrows-prose", "The Architecture: Two Tiers, Eight Outcomes", PROD_BODIES.proseArrowsProse],
  ["double-markers", "Hour 0 to 6: The Exit", PROD_BODIES.doubleMarkers],
  ["pin-emojis", "What is your graft survival rate?", PROD_BODIES.pinEmojis],
  ["two-as-prose", "Static Lists Guarantee Failure", PROD_BODIES.twoAsProse],
  ["two-short", "B2B Turnover Kills Lists", PROD_BODIES.twoShort],
];

const out = cases.map(([id, headline, body]) => {
  const result = normalizeCarouselSlides(
    [
      { slide_number: 1, type: "cover", headline: "Signals before the call" },
      { slide_number: 2, type: "content", headline, body },
      { slide_number: 3, type: "cta", headline: "Want the setup?", cta_button_text: "Comment SIGNAL" },
    ],
    { slideCount: 3 },
  );
  return { id, slide: result.slides[1], warnings: result.warnings };
});

const target = new URL("../../../../workers/carousel-renderer/test-data/prod-bodies-normalized.json", import.meta.url);
await Deno.mkdir(new URL(".", target), { recursive: true });
await Deno.writeTextFile(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${target.pathname} (${out.length} slides)`);
