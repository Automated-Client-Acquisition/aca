/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Copy of workers/carousel-renderer/src/carousel-kit.ts.
 * Regenerate with: node scripts/generate-carousel-ports.mjs
 */

/**
 * Carousel kit: everything the layouts and themes are built from.
 *
 * Pure TypeScript with no Node or Deno APIs, so this file is copied verbatim to
 * supabase/functions/_shared (node scripts/generate-carousel-ports.mjs).
 *
 *  - types shared by the renderer, the layouts and the themes
 *  - color math (contrast-safe accent picking, tinting)
 *  - text sizing: per-font advance widths, word wrap, and a fitter that shrinks a
 *    stack of text blocks until it fits its box (Satori cannot measure text)
 *  - small Satori element helpers (boxes, text, inline SVG icons)
 */

import { TEXT_METRICS } from './carousel-text-metrics.ts';
import { normalizeDashes } from './sanitize-ai-output.ts';

// ============= TYPES =============

export type SatoriElement = any;

export type SlideLayout = 'point' | 'list' | 'stat' | 'compare' | 'statement';

export interface SlideContent {
  slide_number: number;
  type: 'cover' | 'content' | 'cta';
  headline: string;
  body?: string;
  cta_button_text?: string;
  // structured copy (all optional; legacy slides only have the fields above)
  layout?: SlideLayout;
  kicker?: string;
  highlight?: string;
  items?: string[];
  lead?: string;
  footnote?: string;
  stat_value?: string;
  stat_label?: string;
  before?: string;
  after?: string;
  cta_keyword?: string;
  cta_reason?: string;
}

export interface Palette {
  primary: string;
  secondary: string;
  background: string;
  text: string;
  accent: string;
  /** false when nothing came from the brand: themes then use their own signature colors. */
  custom?: boolean;
}

export interface LogoAsset {
  /** data: URI, already fetched and validated by the worker. */
  dataUri: string;
  /** width / height */
  aspect: number;
}

export interface RenderAssets {
  /** Tileable RGBA film grain (PNG data URI). */
  grain?: string;
  /** 1080x1350 white halftone dots, dense at the bottom right (PNG data URI). */
  halftone?: string;
}

export interface RenderOptions {
  width?: number;
  height?: number;
  /** Brand name shown in the header of every slide. */
  authorName?: string;
  /** @handle shown under the name. */
  authorHandle?: string;
  logo?: LogoAsset;
  assets?: RenderAssets;
  /** Layout engine notes (a text stack that had to be trimmed, and so on). */
  onWarn?: (message: string) => void;
}

// ============= TEXT SANITIZING =============

/** Sanitize text for Satori/resvg: dashes, smart quotes, XML-unsafe characters, markdown. */
export function sanitizeText(text: string): string {
  return normalizeDashes(text)
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/…/g, '...')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/↔/g, '<->')
    .replace(/⇒/g, '=>')
    // strip XML-unsafe chars LAST: they break Satori SVG output via resvg
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/&/g, 'and')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_([^_\s][^_]*?)_(?=\s|$)/g, '$1$2')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** Emoji are not in any carousel font and read as clutter: drop them. */
export function stripEmoji(text: string): string {
  return text
    .replace(/(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?)+/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** One line of slide copy, ready to draw. */
export function cleanLine(text: string | undefined | null): string {
  if (!text) return '';
  return stripEmoji(sanitizeText(String(text))).replace(/\s*\n+\s*/g, ' ').trim();
}

// ============= COLOR =============

type RGB = { r: number; g: number; b: number };

export function hexToRgb(hex: string): RGB | null {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i)
    || hex.replace('#', '').match(/^([a-f\d])([a-f\d])([a-f\d])$/i);
  if (!m) return null;
  const p = (s: string) => parseInt(s.length === 1 ? s + s : s, 16);
  return { r: p(m[1]), g: p(m[2]), b: p(m[3]) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend of two colors: t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export const lighten = (hex: string, amount: number): string => mix(hex, '#FFFFFF', amount);
export const darken = (hex: string, amount: number): string => mix(hex, '#000000', amount);

export function rgba(hex: string, alpha: number): string {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r},${c.g},${c.b},${alpha})` : hex;
}

export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0.5;
  const [r, g, b] = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors (1 to 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export function saturation(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max === 0 ? 0 : (max - min) / max;
}

/** The more readable of two text colors on a background. */
export function readableOn(bg: string, light = '#FFFFFF', dark = '#111111'): string {
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}

/**
 * Nudge `color` toward black or white until it reaches `min` contrast on `bg`.
 * Keeps the hue, so a brand blue on a dark slide becomes a lighter blue rather than grey.
 */
export function ensureContrast(color: string, bg: string, min = 3): string {
  if (contrast(color, bg) >= min) return color;
  const towardWhite = luminance(bg) < 0.5;
  for (let t = 0.08; t <= 1; t += 0.08) {
    const next = towardWhite ? lighten(color, t) : darken(color, t);
    if (contrast(next, bg) >= min) return next;
  }
  return towardWhite ? '#FFFFFF' : '#000000';
}

/**
 * The best accent among candidates for a background: saturated, and readable on it.
 * Falls back to nudging the first candidate.
 */
export function pickAccent(candidates: string[], bg: string, min = 3): string {
  const valid = candidates.filter((c) => hexToRgb(c));
  if (!valid.length) return '#E0301E';
  const ok = valid.filter((c) => contrast(c, bg) >= min);
  if (ok.length) return ok.sort((a, b) => saturation(b) - saturation(a))[0];
  return ensureContrast(valid.sort((a, b) => saturation(b) - saturation(a))[0], bg, min);
}

// ============= FONTS =============

export interface FontRef {
  family: string;
  weight: number;
  italic?: boolean;
}

/** Every face the renderer loads (file names inside assets/fonts). `key` indexes TEXT_METRICS. */
export const FONT_FACES: Array<{ family: string; weight: number; italic: boolean; file: string; key: string }> = [
  { family: 'Inter', weight: 400, italic: false, file: 'Inter-Regular.ttf', key: 'Inter-400' },
  { family: 'Inter', weight: 500, italic: false, file: 'Inter-Medium.ttf', key: 'Inter-500' },
  { family: 'Inter', weight: 700, italic: false, file: 'Inter-Bold.ttf', key: 'Inter-700' },
  { family: 'Inter', weight: 800, italic: false, file: 'Inter-ExtraBold.ttf', key: 'Inter-800' },
  { family: 'Inter', weight: 900, italic: false, file: 'Inter-Black.ttf', key: 'Inter-900' },
  { family: 'Instrument Serif', weight: 400, italic: false, file: 'InstrumentSerif-Regular.ttf', key: 'InstrumentSerif-400' },
  { family: 'Instrument Serif', weight: 400, italic: true, file: 'InstrumentSerif-Italic.ttf', key: 'InstrumentSerif-400i' },
  { family: 'Anton', weight: 400, italic: false, file: 'Anton-Regular.ttf', key: 'Anton-400' },
  { family: 'Bricolage Grotesque', weight: 700, italic: false, file: 'BricolageGrotesque-Bold.ttf', key: 'Bricolage-700' },
  { family: 'Bricolage Grotesque', weight: 800, italic: false, file: 'BricolageGrotesque-ExtraBold.ttf', key: 'Bricolage-800' },
  { family: 'Space Mono', weight: 400, italic: false, file: 'SpaceMono-Regular.ttf', key: 'SpaceMono-400' },
  { family: 'Space Mono', weight: 700, italic: false, file: 'SpaceMono-Bold.ttf', key: 'SpaceMono-700' },
];

/** The face Satori will pick for a request (nearest weight, italic if the family has it). */
export function resolveFace(f: FontRef): (typeof FONT_FACES)[number] {
  const family = FONT_FACES.filter((x) => x.family === f.family);
  const pool = family.length ? family : FONT_FACES.filter((x) => x.family === 'Inter');
  const styled = pool.filter((x) => x.italic === !!f.italic);
  const candidates = styled.length ? styled : pool;
  return candidates.reduce((best, x) => (Math.abs(x.weight - f.weight) < Math.abs(best.weight - f.weight) ? x : best));
}

// ============= TEXT SIZING =============

const FALLBACK_ADVANCE = 560; // per 1000 units, for glyphs outside ASCII

function advance(widths: number[], ch: string): number {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return widths[code - 32];
  const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (base !== ch && base.length === 1) {
    const c = base.charCodeAt(0);
    if (c >= 32 && c <= 126) return widths[c - 32];
  }
  return FALLBACK_ADVANCE;
}

/** Width in px of a single line of text. `tracking` is letter-spacing in em. */
export function textWidth(font: FontRef, text: string, size: number, tracking = 0): number {
  const widths = TEXT_METRICS[resolveFace(font).key] ?? TEXT_METRICS['Inter-400'];
  let units = 0;
  for (const ch of text) units += advance(widths, ch);
  return (units / 1000) * size + tracking * size * text.length;
}

// 2.5% safety margin: the metrics ignore kerning and rounding, and overshooting a line is
// the failure that matters (an extra line pushes text out of its box); a slightly early
// wrap only makes the estimate a little conservative
const WRAP_ROOM = 0.975;

/** Greedy word wrap into lines that fit `maxWidth` (words wider than a line break anywhere). */
export function wrapLines(font: FontRef, text: string, size: number, maxWidthIn: number, tracking = 0): string[] {
  const maxWidth = maxWidthIn * WRAP_ROOM;
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  const push = (w: string) => {
    const next = current ? `${current} ${w}` : w;
    if (textWidth(font, next, size, tracking) <= maxWidth) { current = next; return; }
    if (current) { lines.push(current); current = ''; }
    if (textWidth(font, w, size, tracking) <= maxWidth) { current = w; return; }
    // a single word wider than the box: break it by characters
    let chunk = '';
    for (const ch of w) {
      if (textWidth(font, chunk + ch, size, tracking) > maxWidth && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    current = chunk;
  };
  words.forEach(push);
  if (current) lines.push(current);
  return lines;
}

/**
 * Split a headline around its highlight words. The run is extended to the end of the
 * last word it touches, so trailing punctuation ("that.") stays inside the run
 * instead of becoming a lone dot on its own line.
 */
export function splitHighlight(text: string, highlight: string): { before: string; run: string; after: string } | null {
  const idx = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  if (idx < 0) return null;
  let end = idx + highlight.length;
  while (end < text.length && !/\s/.test(text[end])) end++;
  return { before: text.slice(0, idx).trim(), run: text.slice(idx, end).trim(), after: text.slice(end).trim() };
}

/**
 * Number of lines a headline takes when part of it is a highlight run. The run is
 * drawn as one box, so it never breaks across lines: it goes to the next line
 * whole, and when it is wider than a line it wraps inside itself on rows of its own.
 */
export function wrapHeadline(
  font: FontRef, text: string, highlight: string, size: number, maxWidth: number, tracking = 0, runPadEm = 0, runFont?: FontRef,
): number {
  const parts = splitHighlight(text, highlight);
  if (!parts) return Math.max(1, wrapLines(font, text, size, maxWidth, tracking).length);
  const before = parts.before.split(/\s+/).filter(Boolean);
  const run = parts.run;
  const after = parts.after.split(/\s+/).filter(Boolean);
  const gapW = textWidth(font, ' ', size, tracking) + 1;
  let rows = 0;
  let cur = 0;
  const add = (w: number) => {
    if (cur === 0) cur = w;
    else if (cur + gapW + w <= maxWidth) cur += gapW + w;
    else { rows++; cur = w; }
  };
  before.forEach((w) => add(textWidth(font, w, size, tracking)));
  const runW = textWidth(runFont ?? font, run, size, tracking) + runPadEm * size;
  if (runW <= maxWidth) add(runW);
  else {
    if (cur > 0) { rows++; cur = 0; }
    rows += Math.max(1, wrapLines(runFont ?? font, run, size, maxWidth - runPadEm * size, tracking).length);
  }
  after.forEach((w) => add(textWidth(font, w, size, tracking)));
  if (cur > 0) rows++;
  return Math.max(1, rows);
}

/**
 * The narrowest width that keeps a text on the same number of lines, so the lines come
 * out balanced instead of leaving one orphan word on the last line.
 */
export function balancedWidth(font: FontRef, text: string, size: number, maxWidth: number, tracking = 0, upper = false): number {
  const t = upper ? text.toUpperCase() : text;
  const n = wrapLines(font, t, size, maxWidth, tracking).length;
  if (n < 2) return maxWidth;
  // never narrower than the longest word: the line count can hold while a word gets cut in two
  const longest = Math.max(...t.split(/\s+/).map((w) => textWidth(font, w, size, tracking)));
  let best = maxWidth;
  for (let w = maxWidth * 0.98; w >= maxWidth * 0.55; w -= maxWidth * 0.02) {
    if (longest > w * WRAP_ROOM) break;
    if (wrapLines(font, t, size, w, tracking).length > n) break;
    best = w;
  }
  return Math.round(best);
}

export interface FitBlock {
  id: string;
  font: FontRef;
  text: string;
  /** px at 1080 wide */
  min: number;
  max: number;
  lh: number;
  tracking?: number;
  upper?: boolean;
  /** available width for this block */
  width: number;
  /** more lines than this at a size means the size is too big */
  maxLines?: number;
  /** space below the block */
  gap?: number;
  /** custom height for composite blocks (a list): overrides the text wrap math */
  measure?: (size: number) => { height: number; ok: boolean };
  /** words styled as one unbreakable highlight run (marker, tape, italic) */
  highlight?: string;
  /** horizontal padding of the highlight run, in em of the font size (both sides together) */
  runPad?: number;
  /** font of the highlight run when it differs (italic serif) */
  runFont?: FontRef;
}

export interface FitResult {
  sizes: Record<string, number>;
  lines: Record<string, number>;
  /** total height of the stack */
  height: number;
  fits: boolean;
}

/** Lines a block's `text` takes at `size` (the same math the fitter uses). */
export function blockLines(b: FitBlock, content: string, size: number): number {
  const text = b.upper ? content.toUpperCase() : content;
  if (!text) return 0;
  const hl = b.highlight && b.upper ? b.highlight.toUpperCase() : b.highlight;
  return hl
    ? wrapHeadline(b.font, text, hl, size, b.width, b.tracking ?? 0, b.runPad ?? 0, b.runFont)
    : Math.max(1, wrapLines(b.font, text, size, b.width, b.tracking ?? 0).length);
}

/**
 * Largest size at which every word of a block fits on a line of its own. A wider word is
 * drawn cut in two ("ANNOUNC / ED."), so this caps the block's size, down to
 * EMERGENCY_FLOOR of its minimum; only a word too long even there (a URL) still breaks.
 */
function wholeWordSize(b: FitBlock): number {
  const text = b.upper ? b.text.toUpperCase() : b.text;
  const hl = b.highlight && b.upper ? b.highlight.toUpperCase() : b.highlight;
  const parts = hl ? splitHighlight(text, hl) : null;
  const words = (s: string) => s.split(/\s+/).filter(Boolean);
  // width at 1px font size: text width grows linearly with size
  const unit = (font: FontRef, w: string) => textWidth(font, w, 1, b.tracking ?? 0);
  let widest = 0;
  for (const w of words(parts ? `${parts.before} ${parts.after}` : text)) widest = Math.max(widest, unit(b.font, w));
  if (parts) for (const w of words(parts.run)) widest = Math.max(widest, unit(b.runFont ?? b.font, w) + (b.runPad ?? 0));
  if (!widest) return Infinity;
  return Math.max(b.min * EMERGENCY_FLOOR, Math.floor((b.width * WRAP_ROOM) / widest / 2) * 2);
}

function stackAt(blocks: FitBlock[], t: number): FitResult {
  const sizes: Record<string, number> = {};
  const lines: Record<string, number> = {};
  let height = 0;
  let linesOk = true;
  blocks.forEach((b, i) => {
    const scaled = Math.round((b.min + (b.max - b.min) * t) / 2) * 2;
    const size = b.measure ? scaled : Math.min(scaled, wholeWordSize(b));
    sizes[b.id] = size;
    let blockH = 0;
    let present = true;
    if (b.measure) {
      const m = b.measure(size);
      blockH = m.height;
      lines[b.id] = 0;
      if (!m.ok) linesOk = false;
    } else {
      present = !!b.text;
      const n = blockLines(b, b.text, size);
      lines[b.id] = n;
      if (b.maxLines && n > b.maxLines) linesOk = false;
      blockH = n * size * b.lh;
    }
    height += blockH + (i < blocks.length - 1 && present ? b.gap ?? 0 : 0);
  });
  return { sizes, lines, height, fits: linesOk };
}

/**
 * Largest uniform scale (between each block's min and max) at which the stack fits
 * `budget` px. Never goes below the mins: `fits` is false when even the mins overflow.
 * The one exception is a block with a word too wide for the line: it stops at the size
 * where that word fits whole (wholeWordSize), even below its min.
 */
export function fitBlocks(blocks: FitBlock[], budget: number): FitResult {
  for (let t = 1; t >= 0; t -= 0.04) {
    const r = stackAt(blocks, Math.max(0, t));
    if (r.fits && r.height <= budget) return r;
  }
  const r = stackAt(blocks, 0);
  return { ...r, fits: r.fits && r.height <= budget };
}

// ============= WHEN THE TEXT IS TOO LONG =============
//
// Editors let people type far more than the model ever writes. Nothing may overflow, so a
// stack that does not fit at its minimum sizes gives way in a fixed order:
//   1. optional blocks are dropped, in the order they are listed (a subline, a footnote)
//   2. every block may go down to EMERGENCY_FLOOR of its minimum size
//   3. the remaining text is cut to fewer lines, ending in "..."
// Each step is reported back so the layout can raise a warning.

/** How far below its normal minimum a block may shrink before its text is cut instead. */
export const EMERGENCY_FLOOR = 0.8;

const TRAILING_JUNK = /[\s,;:.-]+$/;

/**
 * Cut `text` to the most words that fit in `cap` lines, ending in "...". `count` returns
 * the line count of a candidate, so headlines (highlight runs) and body text share this.
 */
export function clampToLines(text: string, cap: number, count: (s: string) => number): string {
  if (count(text) <= cap) return text;
  const words = text.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const cand = `${words.slice(0, n).join(' ').replace(TRAILING_JUNK, '')}...`;
    if (count(cand) <= cap) return cand;
  }
  const w = words[0] ?? '';
  for (let k = w.length - 1; k >= 1; k--) {
    const cand = `${w.slice(0, k)}...`;
    if (count(cand) <= cap) return cand;
  }
  return '...';
}

export interface LineFit {
  text: string;
  size: number;
  /** words were cut to make it fit */
  clamped: boolean;
}

/**
 * One line of text (a label, a name, a button): shrink from `size` towards `minSize`,
 * then cut words and end in "..." when even the smallest size is too wide.
 */
export function fitLine(font: FontRef, text: string, size: number, minSize: number, width: number, tracking = 0, upper = false): LineFit {
  const room = width * 0.975;
  const w = (s: string, sz: number) => textWidth(font, upper ? s.toUpperCase() : s, sz, tracking);
  let sz = size;
  while (sz > minSize && w(text, sz) > room) sz -= 1;
  if (w(text, sz) <= room) return { text, size: sz, clamped: false };
  const words = text.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const cand = `${words.slice(0, n).join(' ').replace(TRAILING_JUNK, '')}...`;
    if (w(cand, sz) <= room) return { text: cand, size: sz, clamped: true };
  }
  const first = words[0] ?? text;
  for (let k = first.length - 1; k >= 1; k--) {
    const cand = `${first.slice(0, k)}...`;
    if (w(cand, sz) <= room) return { text: cand, size: sz, clamped: true };
  }
  return { text: '...', size: sz, clamped: true };
}

export interface StackBlock extends FitBlock {
  /** dropped whole, in list order, before anything else gives way */
  optional?: boolean;
  /** false keeps the text from being cut (default: plain text blocks may be cut) */
  clamp?: boolean;
}

export interface StackResult extends FitResult {
  /** the blocks that made it, with any cut text, in their original order */
  blocks: StackBlock[];
  dropped: string[];
  floored: boolean;
  clamped: string[];
}

/** Text of a block after fitStack (cut when it had to be). */
export function stackText(res: StackResult, id: string): string {
  return res.blocks.find((b) => b.id === id)?.text ?? '';
}

/**
 * fitBlocks with the degradation order above. `maxStage` stops the ladder early
 * (1 = drop optional blocks only, 2 = also the emergency floor, 3 = also cut text), so a
 * layout can try other arrangements between the steps. `fits` is false only when even
 * one-line blocks at the floor overflow.
 */
export function fitStack(blocks: StackBlock[], budget: number, maxStage: 1 | 2 | 3 = 3, floor = EMERGENCY_FLOOR): StackResult {
  const done = (r: FitResult, bs: StackBlock[], dropped: string[], floored: boolean, clamped: string[]): StackResult => (
    { ...r, blocks: bs, dropped, floored, clamped }
  );
  let cur = blocks.slice();
  const dropped: string[] = [];
  let r = fitBlocks(cur, budget);
  if (r.fits) return done(r, cur, dropped, false, []);

  for (const b of blocks.filter((x) => x.optional)) {
    cur = cur.filter((x) => x.id !== b.id);
    dropped.push(b.id);
    r = fitBlocks(cur, budget);
    if (r.fits) return done(r, cur, dropped, false, []);
  }
  if (maxStage < 2) return done(r, cur, dropped, false, []);

  let low: StackBlock[] = cur.map((b) => ({ ...b, min: b.min * floor }));
  r = fitBlocks(low, budget);
  if (r.fits) return done(r, low, dropped, true, []);
  if (maxStage < 3) return done(r, low, dropped, true, []);

  const clamped: string[] = [];
  for (let guard = 0; guard < 120 && !r.fits; guard++) {
    // a block over its own line allowance first, then the last block that still has more than one line
    let idx = low.findIndex((b) => !b.measure && b.clamp !== false && !!b.maxLines && r.lines[b.id] > b.maxLines);
    let cap = idx >= 0 ? low[idx].maxLines! : 0;
    if (idx < 0) {
      for (let i = low.length - 1; i >= 0; i--) {
        const b = low[i];
        if (!b.measure && b.clamp !== false && r.lines[b.id] > 1) { idx = i; break; }
      }
      if (idx < 0) break;
      cap = r.lines[low[idx].id] - 1;
    }
    const b = low[idx];
    const size = r.sizes[b.id];
    const cut = clampToLines(b.text, cap, (s) => blockLines(b, s, size));
    if (cut === b.text) break; // nothing left to cut
    low = low.map((x, i) => (i === idx ? { ...x, text: cut, maxLines: Math.min(x.maxLines ?? cap, cap) } : x));
    if (!clamped.includes(b.id)) clamped.push(b.id);
    r = fitBlocks(low, budget);
  }
  return done(r, low, dropped, true, clamped);
}

// ============= ELEMENT HELPERS =============

/** A flex box. Satori needs display:flex on any element with children. */
export function box(style: Record<string, any>, children?: SatoriElement | SatoriElement[] | string): SatoriElement {
  return { type: 'div', props: { style: { display: 'flex', ...style }, ...(children !== undefined ? { children } : {}) } };
}

export function spacer(grow = 1): SatoriElement {
  return box({ flex: grow });
}

export function gap(h: number): SatoriElement {
  return box({ height: `${Math.round(h)}px`, flexShrink: 0 });
}

export interface TextStyle {
  font: FontRef;
  size: number;
  color: string;
  lh?: number;
  tracking?: number;
  upper?: boolean;
  align?: 'left' | 'center' | 'right';
  extra?: Record<string, any>;
}

/** A block of text. */
export function text(content: string, s: TextStyle): SatoriElement {
  return box(
    {
      fontFamily: s.font.family,
      fontWeight: s.font.weight,
      ...(s.font.italic ? { fontStyle: 'italic' } : {}),
      fontSize: `${s.size}px`,
      color: s.color,
      lineHeight: s.lh ?? 1.2,
      letterSpacing: `${s.tracking ?? 0}em`,
      ...(s.upper ? { textTransform: 'uppercase' } : {}),
      ...(s.align ? { textAlign: s.align } : {}),
      wordBreak: 'break-word',
      flexShrink: 0,
      ...s.extra,
    },
    content,
  );
}

// ============= ICONS (inline SVG; never SVG filters) =============

export type IconName = 'arrow' | 'check' | 'x' | 'bookmark' | 'plus' | 'send';

const ICON_PATHS: Record<IconName, Array<{ d: string; fill?: boolean }>> = {
  arrow: [{ d: 'M3 12 H20 M13 5 L20 12 L13 19' }],
  check: [{ d: 'M4 12.5 L9.5 18 L20 6.5' }],
  x: [{ d: 'M5 5 L19 19 M19 5 L5 19' }],
  plus: [{ d: 'M12 4 V20 M4 12 H20' }],
  bookmark: [{ d: 'M6 3 H18 V21 L12 16 L6 21 Z' }],
  send: [{ d: 'M3 11 L21 3 L14 21 L11 13 Z' }],
};

/** A crisp stroked icon at `size` px. */
export function icon(name: IconName, size: number, color: string, strokeWidth = 2.6): SatoriElement {
  return {
    type: 'svg',
    props: {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      xmlns: 'http://www.w3.org/2000/svg',
      style: { display: 'flex', flexShrink: 0 },
      children: ICON_PATHS[name].map((p) => ({
        type: 'path',
        props: { d: p.d, stroke: color, strokeWidth, fill: p.fill ? color : 'none', strokeLinecap: 'round', strokeLinejoin: 'round' },
      })),
    },
  };
}

/** A long arrow ( ---> ) for the "swipe" affordance. */
export function longArrow(width: number, color: string, strokeWidth = 3): SatoriElement {
  const h = Math.round(width * 0.42);
  return {
    type: 'svg',
    props: {
      width,
      height: h,
      viewBox: '0 0 60 25',
      xmlns: 'http://www.w3.org/2000/svg',
      style: { display: 'flex', flexShrink: 0 },
      children: [
        { type: 'path', props: { d: 'M2 12.5 H56 M45 3 L57 12.5 L45 22', stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' } },
      ],
    },
  };
}
