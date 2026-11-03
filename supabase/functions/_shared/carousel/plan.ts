/**
 * Carousel deck rules shared by the slide normalizer: layouts, slide counts, the
 * cover count rule and CTA button sizing. Everything here is pure so it can be
 * unit-tested without a model.
 */

import { cleanLine, wordCount } from './text.ts';

// ============= TYPES =============

export type SlideLayout = 'point' | 'list' | 'stat' | 'compare' | 'statement';
export const SLIDE_LAYOUTS: SlideLayout[] = ['point', 'list', 'stat', 'compare', 'statement'];

export function isSlideLayout(value: unknown): value is SlideLayout {
  return typeof value === 'string' && (SLIDE_LAYOUTS as string[]).includes(value);
}

// ============= SLIDE COUNTS =============

export const DEFAULT_SLIDE_COUNT = 5;
export const MIN_SLIDE_COUNT = 3;
export const MAX_SLIDE_COUNT = 10;

/** Effective slide count: default 5, and never fewer than cover + 1 value slide + CTA. */
export function resolveSlideCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SLIDE_COUNT;
  return Math.max(MIN_SLIDE_COUNT, Math.min(MAX_SLIDE_COUNT, Math.round(n)));
}

/** Slides that carry a takeaway: everything except the cover and the CTA (min 1). */
export function valueSlideCountFor(slideCount: number): number {
  return Math.max(1, slideCount - 2);
}

// ============= COUNT RULE (cover number must match the deck) =============

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

// Nouns that follow a number but are not "a count of the slides".
const NOT_A_COUNT_NEXT = new Set([
  'of', 'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'min', 'mins', 'second', 'seconds', 'sec', 'week', 'weeks',
  'month', 'months', 'year', 'years', 'percent', 'x', 'k', 'm', 'am', 'pm', 'times', 'dollars', 'usd', 'eur', 'people',
  'people.', 'to', 'in', 'out',
]);

// Words that lead into a count ("Why 5 numbers...", "Top 10 tools", "These 3 signals").
// Any other capitalized word right before a number makes the number part of a name or an
// ordinal: "Gemini 4 has been announced", "GPT 5", "iPhone 17", "Step 3", "Day 2".
const COUNT_LEAD = new Set([
  'the', 'these', 'those', 'my', 'our', 'your', 'his', 'her', 'their', 'its', 'all', 'only', 'just', 'top', 'why', 'how',
  'what', 'here', "here's", 'are', 'were', 'i', 'we', 'you', 'they', 'best', 'worst', 'first', 'last', 'every', 'over',
  'under', 'about', 'nearly', 'almost', 'with', 'without', 'in', 'for', 'from', 'after', 'before', 'and', 'or', 'than',
  'use', 'steal', 'try', 'avoid', 'stop', 'fix', 'get', 'meet', 'learn', 'know', 'skip',
]);

/** True when the word right before a number names something ("Gemini" in "Gemini 4"). */
function namesTheNumber(before: string): boolean {
  const prev = before.match(/(\p{L}[\p{L}\p{N}'’]*)\s+$/u)?.[1];
  return !!prev && /\p{Lu}/u.test(prev) && !COUNT_LEAD.has(prev.toLowerCase().replace('’', "'"));
}

/**
 * The count a headline promises about the deck ("3 signals", "Five mistakes",
 * "a 5-step system"), or null when it does not name one. Deliberately narrow:
 * durations, money, percentages, "x of y" and version numbers ("Gemini 4",
 * "GPT-5") are not counts of the deck.
 */
export function promisedCount(headline: string | undefined | null): number | null {
  if (!headline) return null;
  const re = /(?<![\d$€£.,/-])\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?![\d%.,:/])[\s-]+([a-z][a-z'-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headline)) !== null) {
    const next = m[2].toLowerCase();
    if (NOT_A_COUNT_NEXT.has(next)) continue;
    if (namesTheNumber(headline.slice(0, m.index))) continue;
    const word = m[1].toLowerCase();
    const n = /^\d/.test(word) ? parseInt(word, 10) : NUMBER_WORDS[word];
    if (n >= 2 && n <= 12) return n;
  }
  return null;
}

// ============= CTA NORMALIZATION =============

const KEYWORD_STOPWORDS = new Set([
  'below', 'here', 'down', 'me', 'us', 'yes', 'the', 'a', 'an', 'your', 'now', 'if', 'and', 'for', 'to', 'in', 'this', 'that',
  'word', 'it', 'below.', 'link', 'bio',
]);

/**
 * A comment keyword as the commenter must type it: letters, digits and single spaces,
 * uppercased ("gmaps agent" -> "GMAPS AGENT"). Multi-word keywords keep their space.
 */
export function cleanKeyword(input: unknown): string {
  return String(input ?? '').replace(/[^A-Za-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

// the quote must not follow a letter, so the apostrophes in "I'll get it, won't" are never quotes
const QUOTED_KEYWORD = /(?<![A-Za-z])['"]([A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,2})['"]/;
const VERB_KEYWORD = /\b(?:comment|drop|type|reply(?:\s+with)?|dm(?:\s+me)?|write)\s+(?:the\s+word\s+)?['"]?([A-Za-z][A-Za-z0-9]{1,19})\b/i;

/** Pull a comment keyword out of free text like: Drop 'SIGNALS' in the comments and I'll DM you... */
export function extractCtaKeyword(text: string | undefined | null): string | null {
  if (!text) return null;
  const quoted = text.match(QUOTED_KEYWORD);
  if (quoted && quoted[1].length >= 2 && quoted[1].length <= 24 && !KEYWORD_STOPWORDS.has(quoted[1].toLowerCase())) {
    return quoted[1].toUpperCase();
  }
  const verb = text.match(VERB_KEYWORD);
  if (!verb || KEYWORD_STOPWORDS.has(verb[1].toLowerCase())) return null;
  const words = [verb[1]];
  // an all-caps keyword carries on through following all-caps words: Comment GMAPS AGENT below
  if (/^[A-Z][A-Z0-9]+$/.test(verb[1])) {
    const rest = text.slice((verb.index ?? 0) + verb[0].length).match(/^(?: [A-Z][A-Z0-9]+){1,2}\b/);
    for (const w of rest ? rest[0].trim().split(' ') : []) {
      if (KEYWORD_STOPWORDS.has(w.toLowerCase())) break;
      words.push(w);
    }
  }
  return words.join(' ').toUpperCase();
}

function isButtonSized(text: string): boolean {
  return !!text && wordCount(text) <= 5 && text.length <= 32;
}

export interface CtaInput {
  button?: string;
  keyword?: string | null;
  headline?: string;
  reason?: string;
}

/**
 * Turn whatever the model (or the blueprint's free-text CTA instruction) gave
 * into button-sized pieces. A paragraph never lands in the button: it becomes
 * `reason`, and the button is derived ("Comment KEYWORD", "Save this post", ...).
 */
export function normalizeCta(input: CtaInput, instruction?: string): { button: string; keyword: string | null; headline: string; reason: string } {
  const rawButton = cleanLine(input.button);
  const rawKeyword = cleanKeyword(cleanLine(input.keyword));
  let keyword: string | null = rawKeyword.length >= 2 && rawKeyword.length <= 24 ? rawKeyword : null;
  if (!keyword) keyword = extractCtaKeyword(rawButton) ?? extractCtaKeyword(instruction) ?? null;

  let button = rawButton;
  let reason = cleanLine(input.reason);

  if (!isButtonSized(button)) {
    const overflow = button;
    button = '';
    if (keyword) button = `Comment ${keyword}`;
    else {
      const basis = `${overflow} ${instruction ?? ''}`.toLowerCase();
      if (/\bsave\b/.test(basis)) button = 'Save this post';
      else if (/\bshare\b/.test(basis)) button = 'Share this post';
      else if (/\bfollow\b/.test(basis)) button = 'Follow for more';
      else if (/\bbook\b|\bcall\b/.test(basis)) button = 'Book a call';
      else if (/\bdm\b|message me/.test(basis)) button = 'DM me';
      else if (/link in (my )?bio/.test(basis)) button = 'Link in bio';
      else button = 'Follow for more';
    }
    if (!reason && overflow) reason = overflow;
  }

  return { button, keyword, headline: cleanLine(input.headline), reason };
}

// ============= COVER =============

function wordSet(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}

/**
 * A cover kicker that only repeats headline words ("3 SIGNALS" over "3 signals your
 * prospect is ready to sign") reads as a stutter. It must add something or go.
 * Keep in sync with the worker's resolveSlide (workers/carousel-renderer/src/carousel-layouts.ts).
 */
export function kickerRepeatsHeadline(kicker: string, headline: string): boolean {
  const k = wordSet(kicker);
  if (k.size === 0) return false;
  const h = wordSet(headline);
  for (const w of k) if (!h.has(w)) return false;
  return true;
}

/** highlight must be a substring of the headline; otherwise drop it. */
export function validHighlight(headline: string, highlight: string): string {
  const h = highlight.trim();
  if (!h) return '';
  return headline.toLowerCase().includes(h.toLowerCase()) ? h : '';
}
