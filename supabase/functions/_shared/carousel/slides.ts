/**
 * Carousel slide normalizer.
 *
 * Takes whatever the slide-copy model returned (or a legacy deck) and turns it
 * into a deck the renderer can trust: exact slide count, cover first, CTA last,
 * a valid layout on every content slide, a button-sized CTA, clean copy, and
 * lists that are real lists (3 to 4 clean parallel items, never prose in disguise).
 *
 * `problems` are things a retry could fix (wrong count, cover number that does
 * not match the deck, missing image prompts). `warnings` are recorded on the
 * stage as `quality_warnings` and never fail the job.
 */

import { cleanCopy, cleanLine, stripAllEmoji, wordCount } from './text.ts';
import {
  type SlideLayout,
  isSlideLayout,
  cleanKeyword,
  normalizeCta,
  promisedCount,
  validHighlight,
} from './plan.ts';
import { normalizeItems, parseListBody } from './list-parse.ts';

export interface CarouselSlide {
  slide_number: number;
  type: 'cover' | 'content' | 'cta';
  /** Content slides only. */
  layout?: SlideLayout;
  /** Cover: label above the headline. CTA: the recap line. Content: optional eyebrow. */
  kicker?: string;
  headline: string;
  /** Words of the headline to color. */
  highlight?: string;
  /**
   * Always populated so older readers and the text editor still work. For a list
   * it is the lead-in, the bullets ("- item") and the footnote, so editing it
   * round-trips through the same parser.
   */
  body: string;
  /** List layout: 3 to 4 clean parallel items. */
  items?: string[];
  /** List layout: a one-line lead-in above the items. */
  lead?: string;
  /** List layout: a short note under the items. */
  footnote?: string;
  stat_value?: string;
  stat_label?: string;
  before?: string;
  after?: string;
  cta_keyword?: string;
  cta_button_text?: string;
  cta_reason?: string;
  /** AI-image carousels only. */
  image_prompt?: string;
}

export interface NormalizeOptions {
  slideCount: number;
  /** The blueprint's CTA instruction (free text; may be a paragraph). */
  ctaInstruction?: string;
  /** AI-image variant: every slide needs an image prompt. */
  requireImagePrompt?: boolean;
}

export interface NormalizeResult {
  slides: CarouselSlide[];
  problems: string[];
  warnings: string[];
}

export const MIN_LIST_ITEMS = 3;
export const MAX_LIST_ITEMS = 4;
export const MAX_ITEM_WORDS = 8;
export const MAX_LEAD_WORDS = 12;

// ============= FIELD HELPERS =============

function pickString(raw: any, ...keys: string[]): string {
  for (const k of keys) {
    const v = raw?.[k];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

/** A slide text line: cleaned, single line, no emoji. */
function line(raw: any, ...keys: string[]): string {
  return stripAllEmoji(cleanLine(pickString(raw, ...keys)));
}

/** First stat-looking token in a text: 47%, $5K, 3x, 12,000. */
export function extractStatToken(...texts: Array<string | undefined>): string {
  for (const t of texts) {
    if (!t) continue;
    const m = t.match(/[$€£]?\d[\d,]*(?:\.\d+)?\s?(?:%|x|X|k|K|m|M|bn|B)?(?![\w])/);
    if (m && m[0].trim().length <= 8 && /[%$€£xXkKmMB]|\d{2,}/.test(m[0])) return m[0].trim();
  }
  return '';
}

function layoutFits(layout: SlideLayout, s: CarouselSlide): boolean {
  switch (layout) {
    case 'list': return (s.items?.length ?? 0) >= MIN_LIST_ITEMS;
    case 'stat': return !!s.stat_value;
    case 'compare': return !!s.before && !!s.after;
    case 'statement': return !!s.headline;
    default: return true;
  }
}

function inferLayout(s: CarouselSlide): SlideLayout {
  if ((s.items?.length ?? 0) >= MIN_LIST_ITEMS) return 'list';
  if (s.stat_value) return 'stat';
  if (s.before && s.after) return 'compare';
  return 'point';
}

/** "Get X. Then Y." from short items that turned out not to be a list. */
function itemsAsProse(items: string[]): string {
  return items.map((i) => (/[.!?]$/.test(i) ? i : `${i}.`)).join(' ');
}

/** Body text older readers see, and the text editor round-trips through parseListBody. */
export function composeListBody(lead: string | undefined, items: string[], footnote: string | undefined): string {
  const parts: string[] = [];
  if (lead) parts.push(lead);
  parts.push(items.map((i) => `- ${i}`).join('\n'));
  if (footnote) parts.push(footnote);
  return parts.join('\n\n');
}

/** Body text derived from the structured fields when the model left it empty. */
export function deriveBody(s: Pick<CarouselSlide, 'layout' | 'items' | 'lead' | 'footnote' | 'stat_label' | 'before' | 'after' | 'body'>): string {
  if (s.layout === 'list' && s.items?.length) return composeListBody(s.lead, s.items, s.footnote);
  if (s.body?.trim()) return s.body;
  if (s.layout === 'compare' && s.before && s.after) return `Instead of: ${s.before}\nDo this: ${s.after}`;
  if (s.layout === 'stat' && s.stat_label) return s.stat_label;
  return '';
}

/** First sentence only (for a lead-in that came out as a paragraph). */
function firstSentence(text: string): string {
  const m = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (m ? m[1] : text).trim();
}

// ============= PER-SLIDE CLEANING =============

interface ListParts { items: string[]; lead: string; footnote: string }

/**
 * Where a content slide's list comes from: the model's `items` array first, else the
 * body string (inline separators, arrows, bullets, emoji markers, trailing prose).
 */
function extractList(raw: any, body: string): ListParts | null {
  let parts: ListParts | null = null;

  if (Array.isArray(raw?.items) && raw.items.length) {
    const strings = raw.items.map((i: any) => (typeof i === 'string' ? i : i?.text ?? i?.label ?? '')).filter(Boolean);
    const n = normalizeItems(strings);
    parts = { items: n.items, lead: '', footnote: n.footnote };
  } else {
    const parsed = parseListBody(body);
    if (parsed) parts = { items: parsed.items, lead: parsed.lead, footnote: parsed.footnote };
  }
  if (!parts) return null;

  const lead = line(raw, 'lead', 'intro') || parts.lead;
  const footnote = line(raw, 'footnote', 'note') || parts.footnote;
  return {
    items: parts.items.map((i) => stripAllEmoji(i)).filter(Boolean),
    lead: stripAllEmoji(lead),
    footnote: stripAllEmoji(footnote),
  };
}

function cleanContentSlide(raw: any): CarouselSlide {
  const rawBody = cleanCopy(pickString(raw, 'body', 'text', 'content'));
  const list = extractList(raw, rawBody);

  const slide: CarouselSlide = {
    slide_number: 0,
    type: 'content',
    headline: line(raw, 'headline', 'title'),
    body: stripAllEmoji(rawBody),
  };
  const kicker = line(raw, 'kicker', 'eyebrow');
  if (kicker) slide.kicker = kicker.toUpperCase();
  const hl = validHighlight(slide.headline, line(raw, 'highlight'));
  if (hl) slide.highlight = hl;

  if (list) {
    if (list.items.length >= MIN_LIST_ITEMS) {
      slide.items = list.items;
      if (list.lead) slide.lead = list.lead;
      if (list.footnote) slide.footnote = list.footnote;
      // the body is rebuilt from the clean parts (composeListBody), never the raw string
      slide.body = composeListBody(slide.lead, slide.items, slide.footnote);
    } else if (list.items.length >= 1) {
      // two points is not a list: it reads as a sentence pair
      slide.body = [list.lead, itemsAsProse(list.items), list.footnote].filter(Boolean).join(' ');
    }
  }

  const statValue = line(raw, 'stat_value', 'statValue', 'stat');
  if (statValue) slide.stat_value = statValue;
  const statLabel = line(raw, 'stat_label', 'statLabel');
  if (statLabel) slide.stat_label = statLabel;
  const before = line(raw, 'before', 'old_way', 'instead');
  const after = line(raw, 'after', 'new_way', 'do_this');
  if (before) slide.before = before;
  if (after) slide.after = after;
  if (isSlideLayout(raw?.layout)) slide.layout = raw.layout;
  const image = cleanCopy(pickString(raw, 'image_prompt', 'imagePrompt', 'prompt'));
  if (image) slide.image_prompt = image;
  return slide;
}

function cleanCover(raw: any): CarouselSlide {
  const headline = line(raw, 'headline', 'title');
  const slide: CarouselSlide = {
    slide_number: 1,
    type: 'cover',
    headline,
    body: line(raw, 'body', 'subline', 'subheadline'),
  };
  const kicker = line(raw, 'kicker', 'eyebrow');
  if (kicker) slide.kicker = kicker.toUpperCase();
  const hl = validHighlight(headline, line(raw, 'highlight'));
  if (hl) slide.highlight = hl;
  const image = cleanCopy(pickString(raw, 'image_prompt', 'imagePrompt', 'prompt'));
  if (image) slide.image_prompt = image;
  return slide;
}

function cleanCta(raw: any): CarouselSlide {
  const slide: CarouselSlide = {
    slide_number: 0,
    type: 'cta',
    headline: line(raw, 'headline', 'title'),
    body: line(raw, 'body', 'cta_reason', 'subline'),
  };
  const kicker = line(raw, 'kicker', 'recap');
  if (kicker) slide.kicker = kicker;
  const keyword = cleanKeyword(line(raw, 'cta_keyword', 'keyword'));
  if (keyword) slide.cta_keyword = keyword;
  const button = line(raw, 'cta_button_text', 'ctaButtonText', 'cta_text', 'ctaText', 'button');
  if (button) slide.cta_button_text = button;
  const reason = line(raw, 'cta_reason', 'reason');
  if (reason) slide.cta_reason = reason;
  const image = cleanCopy(pickString(raw, 'image_prompt', 'imagePrompt', 'prompt'));
  if (image) slide.image_prompt = image;
  return slide;
}

// ============= MAIN =============

export function normalizeCarouselSlides(rawInput: unknown, opts: NormalizeOptions): NormalizeResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const expected = opts.slideCount;

  const rawSlides: any[] = Array.isArray(rawInput)
    ? rawInput
    : Array.isArray((rawInput as any)?.slides)
      ? (rawInput as any).slides
      : [];
  const usable = rawSlides.filter((s) => s && typeof s === 'object');

  if (usable.length === 0) {
    return { slides: [], problems: ['No slides were returned.'], warnings };
  }

  // ----- slide count -----
  let picked = usable;
  if (usable.length > expected) {
    // keep the cover, the CTA and the first (expected - 2) middle slides
    const middle = usable.slice(1, -1).slice(0, expected - 2);
    picked = [usable[0], ...middle, usable[usable.length - 1]];
    warnings.push(`Model returned ${usable.length} slides for a ${expected}-slide deck; extra slides were dropped.`);
  } else if (usable.length < expected) {
    problems.push(`Expected exactly ${expected} slides but got ${usable.length}.`);
  }

  const lastIdx = picked.length - 1;
  const slides: CarouselSlide[] = picked.map((raw, idx) => {
    if (idx === 0) return cleanCover(raw);
    if (idx === lastIdx && picked.length >= 2) return cleanCta(raw);
    return cleanContentSlide(raw);
  });

  const cover = slides[0];
  const cta = picked.length >= 2 ? slides[lastIdx] : null;

  // ----- content slides: layout, structured fields, body sync -----
  slides.forEach((s, idx) => {
    if (s.type !== 'content') return;
    const modelLayout = s.layout;

    // Try to recover a stat when the model picked "stat" but gave no value.
    if (modelLayout === 'stat' && !s.stat_value) {
      const token = extractStatToken(s.headline, s.body);
      if (token) s.stat_value = token;
    }

    // A list needs 3 to 4 items. More are dropped (never squeezed onto the slide);
    // a slide the model called a list with fewer becomes a point.
    if (s.items && s.items.length > MAX_LIST_ITEMS) {
      warnings.push(`Slide ${idx + 1}: list had ${s.items.length} items; kept the first ${MAX_LIST_ITEMS}.`);
      s.items = s.items.slice(0, MAX_LIST_ITEMS);
      s.body = composeListBody(s.lead, s.items, s.footnote);
    }
    if (s.lead && wordCount(s.lead) > MAX_LEAD_WORDS) {
      const short = firstSentence(s.lead);
      if (wordCount(short) <= MAX_LEAD_WORDS + 4) {
        s.lead = short;
      } else {
        warnings.push(`Slide ${idx + 1}: list lead-in is ${wordCount(s.lead)} words (limit ${MAX_LEAD_WORDS}).`);
      }
      s.body = composeListBody(s.lead, s.items ?? [], s.footnote);
    }

    const candidates = [modelLayout].filter(isSlideLayout) as SlideLayout[];
    let layout = candidates.find((c) => layoutFits(c, s));
    if (!layout) {
      layout = inferLayout(s);
      if (candidates.length && candidates[0] !== layout) {
        warnings.push(`Slide ${idx + 1}: layout "${candidates[0]}" needs fields the copy did not provide; used "${layout}".`);
      }
    }
    s.layout = layout;

    if (layout === 'list') {
      const long = (s.items ?? []).filter((i) => wordCount(i) > MAX_ITEM_WORDS);
      if (long.length) warnings.push(`Slide ${idx + 1}: ${long.length} list item(s) longer than ${MAX_ITEM_WORDS} words.`);
      s.body = composeListBody(s.lead, s.items ?? [], s.footnote);
    } else {
      delete s.items; delete s.lead; delete s.footnote;
    }
    if (layout !== 'stat') { delete s.stat_value; delete s.stat_label; }
    if (layout !== 'compare') { delete s.before; delete s.after; }
    s.body = deriveBody(s);
    if (layout === 'statement' && wordCount(s.headline) > 14) {
      warnings.push(`Slide ${idx + 1}: statement is ${wordCount(s.headline)} words; it may render small.`);
    }
    if (wordCount(s.headline) > 7 && layout !== 'statement') {
      warnings.push(`Slide ${idx + 1}: headline is ${wordCount(s.headline)} words (limit 7).`);
    }
  });

  if (wordCount(cover.headline) > 8) warnings.push(`Cover headline is ${wordCount(cover.headline)} words (limit 8).`);
  if (!cover.headline) problems.push('The cover has no headline.');

  // ----- CTA -----
  if (cta) {
    const instr = cleanLine(opts.ctaInstruction);
    // A blueprint CTA that is already button-sized is the exact label the author wants.
    const instrIsButton = !!instr && wordCount(instr) <= 5 && instr.length <= 32;
    const modelButton = cleanLine(cta.cta_button_text);
    if (!instrIsButton && (!modelButton || wordCount(modelButton) > 5 || modelButton.length > 32)) {
      problems.push(
        `The CTA button "${modelButton}" must be 5 words or fewer (32 characters at most), taken from the post's call to action.`,
      );
    }
    const normalized = normalizeCta(
      {
        button: cta.cta_button_text,
        keyword: cta.cta_keyword ?? null,
        headline: cta.headline,
        reason: cta.cta_reason || cta.body,
      },
      instr,
    );
    cta.headline = normalized.headline || cta.headline;
    cta.cta_button_text = instrIsButton ? instr : normalized.button;
    if (normalized.keyword) cta.cta_keyword = normalized.keyword; else delete cta.cta_keyword;
    cta.cta_reason = normalized.reason;
    cta.body = normalized.reason;
    if (cta.kicker && wordCount(cta.kicker) > 9) delete cta.kicker;
    if (!cta.headline) problems.push('The CTA slide has no headline.');
  }

  // ----- numbering and types -----
  slides.forEach((s, i) => { s.slide_number = i + 1; });

  // ----- cover count must equal the number of value slides -----
  const promised = promisedCount(cover.headline);
  const actualValue = Math.max(0, slides.length - 2);
  if (promised !== null && promised !== actualValue) {
    problems.push(
      `The cover headline promises ${promised} but the deck has ${actualValue} value slides (slides 2 to ${slides.length - 1}). ` +
      `Make the number match ${actualValue} or rewrite the headline without a count.`,
    );
  }
  if (slides.length !== expected && slides.length > 0 && !problems.some((p) => p.startsWith('Expected exactly'))) {
    problems.push(`Expected exactly ${expected} slides but got ${slides.length}.`);
  }

  // ----- image prompts (AI variant) -----
  if (opts.requireImagePrompt) {
    const missing = slides.filter((s) => !s.image_prompt).map((s) => s.slide_number);
    if (missing.length) problems.push(`Slides ${missing.join(', ')} have no "image_prompt".`);
  }

  return { slides, problems, warnings };
}

/**
 * Last-resort image prompt for the AI-image variant when the model skipped one
 * (the slide handlers fail a slide with no prompt at all). Keeps the deck
 * renderable; the text on the image is what matters.
 */
export function fallbackImagePrompt(slide: CarouselSlide): string {
  const lines: string[] = [];
  if (slide.type === 'cover') {
    lines.push(`A finished Instagram cover slide. Render the headline "${slide.headline}" as very large bold typography.`);
    if (slide.body) lines.push(`Smaller supporting line: "${slide.body}".`);
  } else if (slide.type === 'cta') {
    lines.push(`A finished Instagram call-to-action slide. Render the headline "${slide.headline}" prominently.`);
    if (slide.cta_button_text) lines.push(`Include a clear button reading "${slide.cta_button_text}".`);
  } else {
    lines.push(`A finished Instagram content slide. Render the headline "${slide.headline}" prominently with the supporting text legible.`);
    if (slide.layout === 'stat' && slide.stat_value) lines.push(`Show "${slide.stat_value}" as one giant numeral.`);
    else if (slide.layout === 'compare' && slide.before && slide.after) lines.push(`Two columns: old way "${slide.before}" versus new way "${slide.after}".`);
    else if (slide.layout === 'list' && slide.items?.length) lines.push(`A clean list of rows: ${slide.items.map((i) => `"${i}"`).join(', ')}.`);
    else if (slide.body) lines.push(`Supporting text: "${slide.body.replace(/\n+/g, '; ')}".`);
  }
  lines.push('Keep the same visual style, layout system and colors as the rest of the deck.');
  return lines.join(' ');
}

/** Fill missing image prompts (AI variant) and report which slides needed it. */
export function ensureImagePrompts(slides: CarouselSlide[]): string[] {
  const filled: string[] = [];
  for (const s of slides) {
    if (!s.image_prompt) {
      s.image_prompt = fallbackImagePrompt(s);
      filled.push(`Slide ${s.slide_number}: no image prompt from the model; wrote a basic one.`);
    }
  }
  return filled;
}
