/**
 * Automated layout check: reads the real geometry Satori computed and reports text
 * that overlaps other text, touches another block, runs into a rule, or leaves the
 * safe area.
 *
 * `slideToSvg(..., embedFont = false)` keeps every word as a <text x y width height
 * font-size> element (Yoga's actual layout, not the fit model's estimate), so this
 * catches exactly the failures the fit model can get wrong: a stack that came out
 * taller than its box and ran into the identity block, the progress bar, a panel edge.
 *
 * Test tooling only: not imported by the worker at runtime.
 */

export interface TextBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** bottom including descenders: only the safe-area check uses it */
  yd: number;
  size: number;
  family: string;
}

export interface LayoutViolation {
  kind: 'overlap' | 'touching' | 'outside' | 'rule' | 'spill' | 'cut';
  message: string;
}

// Cap height and descender depth per family, in em (measured from the vendored fonts).
const GLYPH: Record<string, { cap: number; desc: number }> = {
  anton: { cap: 0.87, desc: 0.13 },
  'bricolage grotesque': { cap: 0.7, desc: 0.18 },
  'instrument serif': { cap: 0.74, desc: 0.22 },
  inter: { cap: 0.74, desc: 0.22 },
  'space mono': { cap: 0.71, desc: 0.2 },
};

function attr(attrs: string, name: string): number {
  const a = attrs.match(new RegExp(`\\b${name}="([-\\d.]+)"`));
  return a ? parseFloat(a[1]) : NaN;
}

/** Text elements with their glyph boxes (cap height above the baseline, descenders below it). */
export function textBoxes(svg: string): TextBox[] {
  const boxes: TextBox[] = [];
  const re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const attrs = m[1];
    const content = m[2].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"');
    if (!content.trim()) continue;
    const x = attr(attrs, 'x');
    const y = attr(attrs, 'y');
    const width = attr(attrs, 'width');
    const size = attr(attrs, 'font-size');
    if (![x, y, width, size].every(Number.isFinite)) continue;
    const family = (attrs.match(/font-family="([^"]+)"/)?.[1] ?? 'inter').toLowerCase();
    const g = GLYPH[family] ?? GLYPH.inter;
    // Collisions use the baseline as the bottom: a descender dipping into the next block is
    // not a layout fault at word level (the word box is far wider than the one letter).
    boxes.push({ text: content.trim(), x0: x, x1: x + width, y0: y - size * g.cap, y1: y + size * 0.02, yd: y + size * g.desc, size, family });
  }
  return boxes;
}

const OVERLAP_MIN_W = 4;
/** Two different blocks of text stacked closer than this read as touching. */
const MIN_BLOCK_GAP = 6;

/** Thin filled rectangles (rules, progress segments): text must not sit on them. */
function thinRects(svg: string): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const re = /<rect\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const a = m[1];
    const x = attr(a, 'x');
    const y = attr(a, 'y');
    const w = attr(a, 'width');
    const h = attr(a, 'height');
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (h <= 10 && w >= 40 && w < 1000 && !/fill="none"/.test(a)) out.push({ x0: x, y0: y, x1: x + w, y1: y + h });
  }
  return out;
}

/** Filled panels and chips (compare panels, keyword chip, list cards): text that starts inside one must end inside it. */
function panels(svg: string, width: number, height: number): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const re = /<rect\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const a = m[1];
    const x = attr(a, 'x');
    const y = attr(a, 'y');
    const w = attr(a, 'width');
    const h = attr(a, 'height');
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (w < 160 || h < 60) continue;
    if (w >= width * 0.9 && h >= height * 0.5) continue; // the slide background and full-bleed decoration
    if (h > height * 0.55) continue; // a whole content column (a highlight box that wrapped), not a panel
    if (/fill="none"/.test(a)) continue;
    // decorative circles and blobs are rects with a huge radius, often bleeding off the slide
    const rx = attr(a, 'rx');
    if (x < -1 || y < -1 || x + w > width + 1 || y + h > height + 1) continue;
    if (Number.isFinite(rx) && rx >= 0.45 * Math.min(w, h)) continue;
    out.push({ x0: x, y0: y, x1: x + w, y1: y + h });
  }
  return out;
}

const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** The words of the slide's text, lowercased and without edge punctuation ("that." -> "that"). */
function sourceWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().split(/\s+/)) {
    // Satori may also break after a hyphen or slash, which is not a cut
    for (const part of [token, ...token.split(/[-/\u2013\u2014]/)]) {
      const w = part.replace(EDGE_PUNCT, '');
      if (w) out.add(w);
    }
  }
  return out;
}

/**
 * Words cut across lines ("ANNOUNC / ED."). Satori lays out a word it considers wider than
 * its line (wordBreak: 'break-word') one grapheme at a time, so each line of such a word is
 * a run of single-character boxes glued edge to edge. A run that spells a whole word of the
 * slide only switched modes (Satori decides without negative letter-spacing, then fits the
 * word with it); a run that spells part of a word was cut.
 */
function cutWords(boxes: TextBox[], words: Set<string>): string[] {
  const out: string[] = [];
  let run: TextBox[] = [];
  const flush = () => {
    const spelled = run.map((b) => b.text).join('');
    const w = spelled.toLowerCase().replace(EDGE_PUNCT, '');
    if ((w.match(/[\p{L}\p{N}]/gu) ?? []).length >= 2 && !words.has(w)) out.push(spelled);
    run = [];
  };
  for (const b of boxes) {
    if ([...b.text].length !== 1) { flush(); continue; }
    const prev = run[run.length - 1];
    if (prev && Math.abs(prev.y0 - b.y0) < 1 && Math.abs(prev.x1 - b.x0) < 1.5) run.push(b);
    else { flush(); run = [b]; }
  }
  flush();
  return out;
}

/**
 * Cut: a word broken across lines (needs `sourceText`, all the text drawn on the slide).
 * Overlap: two words whose glyph boxes intersect by more than a sliver in both directions.
 * Touching: stacked blocks of different type with no air between them.
 * Rule: text sitting on a rule or progress bar.
 * Outside: text whose box leaves the safe area (`marginX` / `marginY` from each edge).
 */
export function checkLayout(svg: string, width: number, height: number, sourceText = '', marginX = 44, marginY = 36): LayoutViolation[] {
  const boxes = textBoxes(svg);
  const out: LayoutViolation[] = [];

  if (sourceText) {
    for (const w of cutWords(boxes, sourceWords(sourceText))) out.push({ kind: 'cut', message: `"${w}" is part of a word cut across lines` });
  }

  for (const b of boxes) {
    if (b.x0 < marginX - 0.5 || b.x1 > width - marginX + 0.5 || b.y0 < marginY - 0.5 || b.yd > height - marginY + 0.5) {
      out.push({
        kind: 'outside',
        message: `"${b.text.slice(0, 28)}" at ${Math.round(b.x0)},${Math.round(b.y0)}-${Math.round(b.x1)},${Math.round(b.y1)} leaves the safe area`,
      });
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const ow = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oh = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      // adjacent lines of one block may touch by a hair (tight leading); anything more is a collision
      if (ow > OVERLAP_MIN_W && oh > Math.max(2, Math.min(a.size, b.size) * 0.06)) {
        out.push({
          kind: 'overlap',
          message: `"${a.text.slice(0, 22)}" overlaps "${b.text.slice(0, 22)}" by ${Math.round(ow)}x${Math.round(oh)}px`,
        });
      } else if (ow > OVERLAP_MIN_W && (a.family !== b.family || a.size !== b.size) && oh > -MIN_BLOCK_GAP) {
        out.push({
          kind: 'touching',
          message: `"${a.text.slice(0, 22)}" (${a.size}px) touches "${b.text.slice(0, 22)}" (${b.size}px): gap ${Math.round(-oh)}px`,
        });
      }
    }
  }

  for (const r of thinRects(svg)) {
    for (const b of boxes) {
      const ow = Math.min(r.x1, b.x1) - Math.max(r.x0, b.x0);
      const oh = Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0);
      if (ow <= OVERLAP_MIN_W || oh <= 1.5) continue;
      // a strike-through is drawn through the middle of its own text: not a collision
      const mid = (r.y0 + r.y1) / 2;
      if (mid > b.y0 + (b.y1 - b.y0) * 0.3 && mid < b.y0 + (b.y1 - b.y0) * 0.75) continue;
      out.push({ kind: 'rule', message: `"${b.text.slice(0, 22)}" runs into a rule or bar at y=${Math.round(r.y0)}` });
    }
  }

  // text that begins inside a panel but runs out of it
  for (const p of panels(svg, width, height)) {
    for (const b of boxes) {
      const startsInside = b.x0 >= p.x0 - 1 && b.x0 <= p.x1 && b.y0 >= p.y0 - 1 && b.y0 <= p.y1;
      const overX = b.x1 - p.x1;
      const overY = b.y1 - p.y1;
      if (startsInside && (overX > 3 || overY > 3)) {
        out.push({ kind: 'spill', message: `"${b.text.slice(0, 22)}" runs out of its panel by ${Math.round(Math.max(overX, overY))}px (${Math.round(p.x0)},${Math.round(p.y0)}-${Math.round(p.x1)},${Math.round(p.y1)})` });
      }
    }
  }
  return out;
}
