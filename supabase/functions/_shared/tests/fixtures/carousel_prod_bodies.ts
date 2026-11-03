/**
 * Slide bodies pulled from production that broke the old carousel renderer.
 * Used verbatim by the list-parser and normalizer tests. The renderer's contact
 * sheet fixtures (workers/carousel-renderer/src/test-fixtures.ts) carry the same
 * strings, because the worker cannot import from supabase/.
 */
export const PROD_BODIES = {
  /** 1. inline separators, ten items: rendered as one gray blob */
  inlineTen:
    "Orange Health Labs ($30M) · CroíValve ($36M) · Timefold ($13M) · Fika Jobs ($4M) · Rentify ($2M) · LiLLBUD · Superpal · Sherlocks AI · Astral Systems · Citring",
  /** 2a. a sentence glued onto the last item */
  trailingProse:
    "Nasdaq Private Market $38M · Isometric $40M · Spiro $55M · FlexPay · Crizac acquisition · 'Real World' AI startup. 12 signals. One window.",
  /** 2b. same with bullets */
  trailingProseBullets:
    "Sales development • Content marketing • Market research • Sales enablement • Demand gen. One AI does it all, no breaks, no politics.",
  /** 3. prose paragraph + 5 arrow bullets + prose: ran off the card and off the canvas */
  proseArrowsProse:
    "Tier 1: 36 regex patterns classify 60–70% of replies in under 10ms. Tier 2: LLM handles edge cases. Result: 8 intent categories, each triggering a unique automated path.\n\n→ Interested = steered toward booking\n→ Neutral = qualifying questions sent\n→ Not Interested = soft re-engagement drafted\n→ Do Not Contact = all automation stopped instantly\n→ OOO = snoozed to exact return date\n\nConfidence score (0–1.0) on every classification. Above 0.40 = auto-action. Below = human review. Conservative teams run 0.60.",
  /** 4. an accent dot PLUS an emoji on every line */
  doubleMarkers:
    "- \u{1F3E5} Leave the clinic with a protective headband\n- \u{1F695} Private transfer takes you back to the hotel\n- \u{1F48A} Start your prescribed meds to prevent swelling\n- \u{1F4A7} Stay hydrated but avoid caffeine and alcohol",
  pinEmojis:
    "- \u{1F4CD} Not every hair moved will actually grow.\n- \u{1F4CD} Ask for their audited success percentages.\n- \u{1F4CD} Poor handling kills grafts before implantation.\n- \u{1F4CD} High volume hair mills often have lower rates.",
  /** 5. a 2-item "list" whose second item is a continuation sentence */
  twoAsProse:
    "- Scraping 10,000 leads at once feels productive\n- But treating a static CSV as evergreen guarantees diminishing returns",
  /** 5b. two short stat-like bullets */
  twoShort: "- 25-30% annual turnover rate\n- 2.5% of static lists rot every 30 days",
};
