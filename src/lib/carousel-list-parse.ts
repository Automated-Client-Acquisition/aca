/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Copy of supabase/functions/_shared/carousel/list-parse.ts.
 * Regenerate with: node scripts/generate-carousel-ports.mjs
 */

/**
 * List parsing for carousel slide bodies. PURE and dependency-free on purpose:
 * this file is the source of truth for both the slide-copy normalizer (Deno) and
 * the Fly renderer, which gets a generated copy (node scripts/generate-carousel-ports.mjs).
 *
 * Models and older decks write lists as strings. Real bodies from production:
 *   "A ($30M) · B ($36M) · C · D · E"                        inline separators
 *   "X $38M · Y · Z. 12 signals. One window."                a sentence glued to the last item
 *   "Tier 1: ...\n\n→ Interested = booking\n→ Neutral = ...\n\nConfidence score ..."
 *                                                            prose, arrow bullets, prose
 *   "- 🏥 Leave the clinic\n- 📍 Not every hair moved"        emoji on every line
 * parseListBody turns each of those into { lead, items, footnote }: a one-line
 * lead-in, clean parallel items, and a trailing note that is never glued onto an item.
 */

export interface ParsedList {
  /** Prose that sets up the list ('' when none). */
  lead: string;
  /** Clean items: markers, emoji, markdown and trailing periods stripped. */
  items: string[];
  /** Leading emoji of each item ('' when none), parallel to items. */
  emojis: string[];
  /** Prose after the list ('' when none). */
  footnote: string;
  /** The list was written on one line with separators (· • | ;). */
  inline: boolean;
}

const EMOJI_LEAD = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?[\s‍]*)+/u;
const EMOJI_TRAIL = /[\s‍]*(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?)+$/u;

// A bullet marker at the start of a line. Hyphens, asterisks, numbers and letters
// need a space after them so "-based" or "3.5x" is never read as a marker.
const MARKER = /^\s*(?:(?:[•‣●○▪▫◦⬤⁃·→⇒▶►➤➜]|->|=>|-->)\s*|(?:[-*>]|\d{1,2}[.)]|[a-eA-E]\))\s+)/;

/** Remove leading and trailing emoji; returns the leading one. */
export function stripEmoji(text: string): { text: string; emoji: string } {
  let out = text.trim();
  let emoji = '';
  const lead = out.match(EMOJI_LEAD);
  if (lead) {
    emoji = lead[0].trim();
    out = out.slice(lead[0].length);
  }
  out = out.replace(EMOJI_TRAIL, '');
  return { text: out.trim(), emoji };
}

/** One list item, cleaned: no marker, emoji, markdown, trailing period or stray quotes. */
export function cleanListItem(raw: string, stripTrailingPunctuation = true): { text: string; emoji: string } {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  // a marker can be doubled ("- → item"), so strip until none is left
  for (let i = 0; i < 3 && MARKER.test(t); i++) t = t.replace(MARKER, '').trim();
  const { text, emoji } = stripEmoji(t);
  t = text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (stripTrailingPunctuation) t = t.replace(/[.;,]+$/g, '').trim();
  return { text: t, emoji };
}

/** Split a sentence tail off an item: "Demand gen. One AI does it all." -> item + rest. */
function splitTrailingSentence(item: string): { item: string; rest: string } {
  const re = /([.!?])\s+(?=["'(“]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(item)) !== null) {
    const head = item.slice(0, m.index);
    if (!head.trim()) continue;
    // not a sentence end: "U.S. Foo", "e.g. Foo", "Acme Inc. Foo"
    if (m[1] === '.' && /(?:\b[A-Za-z]|\b(?:e\.g|i\.e|vs|etc|Inc|Ltd|Co|Mr|Ms|Dr|St))$/.test(head)) continue;
    return { item: head, rest: item.slice(m.index + m[0].length).trim() };
  }
  return { item, rest: '' };
}

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Key and value of "Interested = steered toward booking" / "Tier 1: 36 patterns". */
export function splitKeyValue(item: string): { key: string; value: string } | null {
  const m = item.match(/^([^:=\n]{2,26}?)\s*(?:=|:)\s+(.{3,})$/);
  if (!m) return null;
  if (wordCount(m[1]) > 4) return null;
  return { key: m[1].trim(), value: m[2].trim() };
}

/**
 * Clean an items array a model produced and pull a trailing sentence off the last
 * item into the footnote. Empty items are dropped.
 */
export function normalizeItems(rawItems: string[]): { items: string[]; emojis: string[]; footnote: string } {
  const items: string[] = [];
  const emojis: string[] = [];
  let footnote = '';
  rawItems.forEach((raw, idx) => {
    const isLast = idx === rawItems.length - 1;
    // keep the trailing period on the last item until the sentence tail is split off
    const c = cleanListItem(raw, !isLast);
    if (!c.text) return;
    if (isLast && items.length >= 1 && wordCount(c.text) >= 6) {
      const { item, rest } = splitTrailingSentence(c.text);
      if (rest) {
        const head = cleanListItem(item);
        if (head.text) {
          items.push(head.text);
          emojis.push(c.emoji);
          footnote = rest.replace(/\s+/g, ' ').trim();
          return;
        }
      }
    }
    const done = cleanListItem(c.text);
    items.push(done.text);
    emojis.push(c.emoji);
  });
  return { items, emojis, footnote };
}

/**
 * Parse a slide body into lead / items / footnote, or null when the body is not
 * list-like (fewer than two items). Never returns more than it found: callers
 * cap and fit.
 */
export function parseListBody(body: string | undefined | null): ParsedList | null {
  if (!body) return null;
  let text = String(body).replace(/\r/g, '').trim();
  if (!text) return null;

  // Arrows written inline: "A -> B -> C" is not a list, but "→ A → B" style bullets on one line are.
  // Split inline numbered items: "... 2. Next item" -> newline before "2."
  text = text.replace(/([.!?:;])[ \t]+(\d{1,2})[.)][ \t]/g, '$1\n$2. ');
  // Split inline arrow bullets when a line carries two or more of them.
  text = text.split('\n').map((line) => {
    const arrows = line.match(/(?:^|\s)(?:→|⇒|->|=>)\s/g);
    return arrows && arrows.length >= 2 ? line.replace(/\s+(?=(?:→|⇒|->|=>)\s)/g, '\n') : line;
  }).join('\n');

  const rawLines = text.split('\n').map((l) => l.trim());
  type Line = { kind: 'bullet' | 'prose' | 'blank'; text: string };
  const lines: Line[] = rawLines.map((l) => {
    if (!l) return { kind: 'blank', text: '' };
    return MARKER.test(l) ? { kind: 'bullet', text: l } : { kind: 'prose', text: l };
  });
  const bulletCount = lines.filter((l) => l.kind === 'bullet').length;

  if (bulletCount >= 2) {
    const first = lines.findIndex((l) => l.kind === 'bullet');
    let last = -1;
    lines.forEach((l, i) => { if (l.kind === 'bullet') last = i; });

    const lead = lines.slice(0, first).filter((l) => l.kind === 'prose').map((l) => l.text).join(' ');
    const rawItems: string[] = [];
    let sawBlankAfterLast = false;
    const footBits: string[] = [];

    for (let i = first; i < lines.length; i++) {
      const l = lines[i];
      if (i <= last) {
        if (l.kind === 'bullet') rawItems.push(l.text);
        else if (l.kind === 'prose' && rawItems.length) rawItems[rawItems.length - 1] += ` ${l.text}`; // wrapped item
      } else if (l.kind === 'blank') {
        sawBlankAfterLast = true;
      } else if (l.kind === 'prose') {
        // directly under the last bullet with no blank line and no capital = a wrapped last item;
        // anything else is a note that follows the list
        if (!sawBlankAfterLast && footBits.length === 0 && !/^[A-Z0-9]/.test(l.text)) {
          rawItems[rawItems.length - 1] += ` ${l.text}`;
        } else {
          footBits.push(l.text);
        }
      }
    }

    const { items, emojis, footnote: tail } = normalizeItems(rawItems);
    if (items.length < 2) return null;
    const footnote = [tail, footBits.join(' ')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { lead: lead.replace(/\s+/g, ' ').trim(), items, emojis, footnote, inline: false };
  }

  // No bullet lines: a single paragraph with separators (a middot, bullet or pipe with spaces around it).
  const flat = text.replace(/\s*\n+\s*/g, ' ').trim();
  let segments = flat.split(/\s+[·•‣|]\s+/);
  if (segments.length < 3) {
    // semicolon lists: "a; b; c; d" with short segments
    const semi = flat.split(/;\s+/);
    if (semi.length >= 3 && semi.every((s) => s.length <= 70)) segments = semi; else return null;
  }

  // "Today's Funding Signals: A (..)" the first segment can carry a lead-in before a colon
  let lead = '';
  const firstSeg = segments[0].match(/^(.{4,70}?):\s+(.+)$/);
  if (firstSeg && wordCount(firstSeg[1]) <= 9) {
    lead = firstSeg[1].trim();
    segments[0] = firstSeg[2];
  }

  const { items, emojis, footnote } = normalizeItems(segments);
  if (items.length < 3) return null;
  return { lead, items, emojis, footnote, inline: true };
}
