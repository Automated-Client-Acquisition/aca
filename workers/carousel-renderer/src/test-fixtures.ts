/**
 * Fixture decks for the contact-sheet harness (test-render.ts).
 *
 * The production bodies are the real strings that broke the old renderer (they are
 * mirrored in supabase/functions/_shared/tests/fixtures/carousel_prod_bodies.ts,
 * because the worker cannot import from supabase/).
 */

import type { SlideContent } from './carousel-templates.js';

export const PROD_BODIES = {
  inlineTen:
    'Orange Health Labs ($30M) · CroíValve ($36M) · Timefold ($13M) · Fika Jobs ($4M) · Rentify ($2M) · LiLLBUD · Superpal · Sherlocks AI · Astral Systems · Citring',
  trailingProse:
    "Nasdaq Private Market $38M · Isometric $40M · Spiro $55M · FlexPay · Crizac acquisition · 'Real World' AI startup. 12 signals. One window.",
  trailingProseBullets:
    'Sales development • Content marketing • Market research • Sales enablement • Demand gen. One AI does it all, no breaks, no politics.',
  proseArrowsProse:
    'Tier 1: 36 regex patterns classify 60–70% of replies in under 10ms. Tier 2: LLM handles edge cases. Result: 8 intent categories, each triggering a unique automated path.\n\n→ Interested = steered toward booking\n→ Neutral = qualifying questions sent\n→ Not Interested = soft re-engagement drafted\n→ Do Not Contact = all automation stopped instantly\n→ OOO = snoozed to exact return date\n\nConfidence score (0–1.0) on every classification. Above 0.40 = auto-action. Below = human review. Conservative teams run 0.60.',
  doubleMarkers:
    '- \u{1F3E5} Leave the clinic with a protective headband\n- \u{1F695} Private transfer takes you back to the hotel\n- \u{1F48A} Start your prescribed meds to prevent swelling\n- \u{1F4A7} Stay hydrated but avoid caffeine and alcohol',
  pinEmojis:
    '- \u{1F4CD} Not every hair moved will actually grow.\n- \u{1F4CD} Ask for their audited success percentages.\n- \u{1F4CD} Poor handling kills grafts before implantation.\n- \u{1F4CD} High volume hair mills often have lower rates.',
  twoAsProse:
    '- Scraping 10,000 leads at once feels productive\n- But treating a static CSV as evergreen guarantees diminishing returns',
  twoShort: '- 25-30% annual turnover rate\n- 2.5% of static lists rot every 30 days',
};

const cover = (n: number, headline: string, extra: Partial<SlideContent> = {}): SlideContent => ({ slide_number: n, type: 'cover', headline, body: '', ...extra });
const content = (n: number, headline: string, extra: Partial<SlideContent> = {}): SlideContent => ({ slide_number: n, type: 'content', headline, body: '', ...extra });
const cta = (n: number, headline: string, extra: Partial<SlideContent> = {}): SlideContent => ({ slide_number: n, type: 'cta', headline, body: '', ...extra });

export interface Deck {
  id: string;
  title: string;
  slides: SlideContent[];
}

export const DECKS: Deck[] = [
  // The prod deck ("3 signals that show up before they say yes"), rewritten in the new shape:
  // the cover count matches the value slides and beat 1 delivers value at once.
  {
    id: 'prod',
    title: 'Prod deck, new shape',
    slides: [
      cover(1, '3 signals buyers send before they say yes', { kicker: '3 SIGNALS', highlight: '3 signals', body: 'Most reps only notice the third.' }),
      content(2, 'They stop asking if', {
        layout: 'list', lead: 'Real intent sounds like logistics',
        items: ['Asks about onboarding timelines', 'Asks about data migration steps', 'Asks about user adoption plans'],
        body: '- Asks about onboarding timelines\n- Asks about data migration steps\n- Asks about user adoption plans',
      }),
      content(3, 'They bring in the team', {
        layout: 'point', body: 'Procurement, legal or security joins unprompted. That means internal advocacy is already happening and budget is moving.',
      }),
      content(4, 'They go quiet, then reappear', {
        layout: 'stat', stat_value: '47%', stat_label: 'of stalled deals restart within 14 days', body: 'Silence after a real demo is a pause, not a no.',
      }),
      cta(5, 'Spot them before the call', {
        kicker: 'Now you know the 3 signals', cta_keyword: 'SIGNALS', cta_button_text: 'Comment SIGNALS', cta_reason: 'Get the 1-page checklist',
        body: 'Get the 1-page checklist',
      }),
    ],
  },
  {
    id: 'stat-heavy',
    title: 'Stat-heavy deck',
    slides: [
      cover(1, 'Why 5 numbers explain your pipeline', { kicker: 'THE NUMBERS', highlight: '5 numbers' }),
      content(2, 'Reply rate', { layout: 'stat', stat_value: '$5K', stat_label: 'is what most teams pay per booked meeting', body: 'Our average was $180.' }),
      content(3, 'Show-up rate', { layout: 'stat', stat_value: '47%', stat_label: 'of booked calls never happen without a reminder' }),
      content(4, 'Speed to lead', { layout: 'stat', stat_value: '3x', stat_label: 'more meetings when you reply inside five minutes', body: 'Speed beats copy every time.' }),
      content(5, 'Follow-ups', { layout: 'stat', stat_value: '14 days', stat_label: 'is how long a real buying window stays open' }),
      content(6, 'Volume', { layout: 'stat', stat_value: '10x', stat_label: 'output from the same team once the list stays fresh' }),
      cta(7, 'Want the full breakdown?', { kicker: 'Now you know the 5 numbers', cta_keyword: 'NUMBERS', cta_button_text: 'Comment NUMBERS', cta_reason: 'Get the benchmark sheet' }),
    ],
  },
  {
    id: 'compare',
    title: 'Compare deck',
    slides: [
      cover(1, 'Stop doing this. Start doing that.', { kicker: 'THE SWITCH', highlight: 'Start doing that' }),
      content(2, 'Your follow-up', { layout: 'compare', before: 'Just checking in on my last email', after: 'Here is the one-page plan we discussed, with your dates filled in' }),
      content(3, 'Your demo', { layout: 'compare', before: 'Walk through every feature in the product', after: 'Show the one workflow they told you costs them the most' }),
      content(4, 'Your close', { layout: 'compare', before: 'Ask if they are ready to sign', after: 'Ask what would have to be true to start on the first' }),
      cta(5, 'Get the swipe file', { kicker: 'Now you know the 3 switches', cta_keyword: 'SWITCH', cta_button_text: 'Comment SWITCH', cta_reason: 'Get 12 more before and afters' }),
    ],
  },
  {
    id: 'list4',
    title: '4-bullet list',
    slides: [
      cover(1, '4 checks before you hit send', { kicker: '4 CHECKS', highlight: '4 checks', body: 'Run them in 60 seconds.' }),
      content(2, 'The pre-send checklist', {
        layout: 'list', lead: 'Four questions, every time',
        items: ['Is the first line about them?', 'Does it name one real result?', 'Is there a single ask?', 'Would you reply to this?'],
        footnote: 'If any answer is no, rewrite before you send.',
        body: '',
      }),
      content(3, 'What good looks like', {
        layout: 'list', items: ['Under 90 words', 'One link at most', 'A question, not a pitch', 'No attachments'],
      }),
      content(4, 'Three moves after every demo', {
        layout: 'list', items: ['Send the recap in one hour', 'Book the next call before you hang up', 'Share the plan with the whole team'],
      }),
      cta(5, 'Want the full checklist?', { kicker: 'Now you know the 4 checks', cta_keyword: 'CHECK', cta_button_text: 'Comment CHECK', cta_reason: 'Get the printable version' }),
    ],
  },
  {
    id: 'max-headline',
    title: 'Max-length headlines',
    slides: [
      cover(1, 'Why nobody replies to your outreach and what to change first', { kicker: 'THE FIX', highlight: 'what to change first', body: 'A blunt audit of the five most common mistakes in cold outbound today.' }),
      content(2, 'Every sentence sells the sender instead of the reader', { layout: 'point', body: 'Cut every line that starts with we, our or I. Start with the problem they already named out loud.' }),
      content(3, 'Stop treating the first message like a full pitch deck', { layout: 'statement', body: 'One idea. One ask. Nothing else.' }),
      content(4, 'Personalization that is actually personal beats everything', { layout: 'point', body: 'Reference something only they would have written, not their job title or their city.' }),
      cta(5, 'Get the rewrite templates I use with every client', { kicker: 'Now you know the fix', cta_keyword: 'REWRITE', cta_button_text: 'Comment REWRITE', cta_reason: 'Get 8 templates' }),
    ],
  },
  {
    // job 32a594dc (2026-10-01): the fitter kept the biggest cover size whose height fit,
    // so "ANNOUNCED." was cut into "ANNOUNC / ED." Every word must fit on a line of its own.
    id: 'long-words',
    title: 'Long single words in big headlines',
    slides: [
      cover(1, 'Gemini 4 has been announced.', { kicker: 'BREAKING NEWS', highlight: 'Gemini 4', body: "The real story isn't the benchmarks. It's what changes for your business." }),
      cover(2, 'Microsoft announced everything.', { kicker: 'RECAP' }),
      content(3, 'Accountability beats motivation', { layout: 'point', body: 'Systems outlast willpower every single time.' }),
      content(4, 'Internationalization, explained', { layout: 'statement', highlight: 'Internationalization', body: 'One codebase, every market.' }),
      cta(5, 'Comprehensive breakdown inside', { cta_keyword: 'GUIDE', cta_button_text: 'Comment GUIDE', cta_reason: 'Get the full guide' }),
    ],
  },
  {
    id: 'cta-keyword',
    title: 'CTA: paragraph as button (legacy) and 1-word keyword',
    slides: [
      cover(1, 'Your lead is ready. You missed it.', { kicker: 'THE MISS', highlight: 'You missed it.', body: '3 signals that show up before they say yes.' }),
      content(2, 'Enthusiasm is a smokescreen', { body: 'Nodding on Zoom and early pricing questions feel like green lights. They are not. Real intent looks quieter and more specific.' }),
      cta(3, 'Know who is ready before the call.', {
        body: 'Get the 1-page checklist that maps all 3 signals.',
        cta_button_text: "Drop 'SIGNALS' in the comments and I'll DM you our 1-page Buyer Intent Diagnostic Checklist.",
      }),
      cta(3, 'Ready to see it?', { cta_keyword: 'GOLD', cta_button_text: 'Comment GOLD', cta_reason: 'Get the private list' }),
      cta(3, 'Save this for the next campaign', { cta_button_text: 'Save this post', body: '' }),
    ],
  },
  {
    // job d8cb6db8 (2026-10-07): the chip read "GMAPSAGENT" under a button that said
    // COMMENT "GMAPS AGENT". Multi-word keywords keep their space and shrink to fit whole.
    id: 'cta-keyword-multiword',
    title: 'CTA: two-word comment keywords',
    slides: [
      cta(1, 'Steal the agent.', { cta_keyword: 'GMAPS AGENT', cta_button_text: 'COMMENT "GMAPS AGENT"', cta_reason: 'I will send you the full build' }),
      cta(2, 'Want the whole system?', { cta_keyword: 'CAROUSEL AGENT', cta_button_text: 'Comment CAROUSEL AGENT', cta_reason: 'Get the agent that writes these' }),
      cta(3, 'Want it?', { cta_button_text: 'Comment "LINKEDIN AGENT" below', cta_reason: 'No keyword field: read from the button' }),
    ],
  },
  {
    id: 'legacy',
    title: 'Legacy slides (no layout, kicker, items)',
    slides: [
      cover(1, 'Clicks Aren\'t Buying Signals. This Is.', { body: '' }),
      content(2, '428 Sources. Zero Pricing Page Stalking.', { body: 'Hermes Agent monitors 428 verified sources for structural shifts - the real-world triggers your competitors don\'t even know exist.' }),
      content(3, 'The Full Raise List Today', { body: '- Nasdaq Private Market $38M\n- Isometric $40M\n- Spiro $55M\n- FlexPay\n- Crizac acquisition\n- \'Real World\' AI startup. 12 signals. One window.' }),
      cta(4, 'Want The Full Setup Breakdown?', { body: 'Comment "Signal" and I will send you the full breakdown to set it up yourself.', cta_button_text: 'Comment "Signal" and I will send you the full breakdown to set it up yourself' }),
    ],
  },
  ...([
    ['inline-ten', "Today's Funding Signals - Jun 23", PROD_BODIES.inlineTen],
    ['trailing-prose', 'The Full Raise List Today', PROD_BODIES.trailingProse],
    ['trailing-bullets', 'Six Roles, One AI Employee', PROD_BODIES.trailingProseBullets],
    ['arrows-prose', 'The Architecture: Two Tiers, Eight Outcomes', PROD_BODIES.proseArrowsProse],
    ['double-markers', 'Hour 0 to 6: The Exit', PROD_BODIES.doubleMarkers],
    ['pin-emojis', 'What is your graft survival rate?', PROD_BODIES.pinEmojis],
    ['two-as-prose', 'Static Lists Guarantee Failure', PROD_BODIES.twoAsProse],
    ['two-short', 'B2B Turnover Kills Lists', PROD_BODIES.twoShort],
  ] as const).map(([id, headline, body]): Deck => ({
    id: `prodbody-${id}`,
    title: `Prod body: ${id}`,
    slides: [content(2, headline, { body })],
  })),
];

export const BRANDS: Record<string, { palette?: Record<string, string>; name?: string; handle?: string }> = {
  acquist: { name: 'Acquist', handle: 'acquist' },
  // a brand name and handle far longer than any real one: the header must clamp them
  longname: { name: 'The Very Long Named Growth Consulting Collective International', handle: 'thelongesthandlethatanyonehaseverregisteredonanything' },
  none: { name: 'Acme Growth', handle: 'acmegrowth' },
  blue: { palette: { primary: '#1D4ED8', secondary: '#0EA5E9', accent: '#F59E0B', background: '#FFFFFF', text: '#0F172A' }, name: 'Acme Growth', handle: '@acmegrowth' },
  green: { palette: { primary: '#0F766E', secondary: '#14B8A6', accent: '#F97316', background: '#FFFFFF', text: '#0F172A' }, name: 'Verdant Labs', handle: 'verdantlabs' },
  pastel: { palette: { primary: '#FDE68A', secondary: '#FBCFE8', accent: '#A78BFA', background: '#FFFFFF', text: '#1F2937' }, name: 'Soft Studio' },
  anon: {},
};

/** Simple inline SVG logos for the logo / no-logo checks. */
export const LOGOS = {
  square: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#111"/><path d="M28 70 L50 26 L72 70 Z" fill="#FF5A1F"/></svg>').toString('base64')}`,
  wide: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 80"><rect width="300" height="80" rx="14" fill="#0F172A"/><circle cx="40" cy="40" r="20" fill="#38BDF8"/><rect x="76" y="30" width="180" height="20" rx="6" fill="#F8FAFC"/></svg>').toString('base64')}`,
};
