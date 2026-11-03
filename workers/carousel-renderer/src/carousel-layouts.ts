/**
 * Carousel layouts.
 *
 * One shared layout engine draws every theme. Structure follows the content:
 *   cover, point, list, stat, compare, statement, cta
 * Themes (carousel-themes.ts) only supply tokens: colors, type, marker style,
 * decoration. Text is sized to its box with real per-font metrics (carousel-kit.ts)
 * and shrunk until the stack fits. When it still cannot fit (an editor can type far more
 * than the model writes) it gives way in a fixed order, and every step is reported
 * through onWarn: optional blocks are dropped, then text may go 20% under its minimum
 * size, then it is cut with an ellipsis. Nothing is ever drawn outside the safe area or
 * over another element.
 *
 * Pure TypeScript (no Node or Deno APIs): copied to supabase/functions/_shared.
 */

import {
  EMERGENCY_FLOOR,
  type FitBlock,
  type FitResult,
  type FontRef,
  type RenderOptions,
  type SatoriElement,
  type SlideContent,
  type SlideLayout,
  type StackBlock,
  type StackResult,
  balancedWidth,
  blockLines,
  box,
  clampToLines,
  cleanLine,
  fitBlocks,
  fitLine,
  fitStack,
  gap,
  icon,
  longArrow,
  splitHighlight,
  stackText,
  text,
  textWidth,
  wrapLines,
} from './carousel-kit.js';
import type { Tokens } from './carousel-themes.js';
import { normalizeItems, parseListBody } from './list-parse.js';

// ============= RESOLVED CONTENT =============

/** A slide's copy after layout inference and list parsing. Everything is drawn from this. */
export interface Resolved {
  kind: 'cover' | 'content' | 'cta';
  layout: SlideLayout;
  headline: string;
  highlight: string;
  kicker: string;
  body: string;
  items: string[];
  lead: string;
  footnote: string;
  statValue: string;
  statLabel: string;
  before: string;
  after: string;
  keyword: string;
  button: string;
  reason: string;
}

const MAX_ITEMS_SHOWN = 8;
const BUTTON_WORDS = 5;

function wc(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** A CTA button label that is never a paragraph: derive "Comment KEYWORD" or a short default. */
export function safeButtonLabel(raw: string | undefined, keyword: string, authorHandle?: string): string {
  const label = cleanLine(raw);
  if (label && wc(label) <= BUTTON_WORDS && label.length <= 32) return label;
  if (keyword) return `Comment ${keyword}`;
  const basis = label.toLowerCase();
  if (/\bsave\b/.test(basis)) return 'Save this post';
  if (/\bshare\b/.test(basis)) return 'Share this post';
  if (/\bbook\b/.test(basis)) return 'Book a call';
  if (/\bdm\b/.test(basis)) return 'DM me';
  if (authorHandle) return 'Follow for more';
  return 'Follow for more';
}

/** A comment keyword as typed: letters, digits and single spaces ("GMAPS AGENT" keeps its space). */
function cleanKeyword(s: string): string {
  return s.replace(/[^A-Za-z0-9\s]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function extractKeyword(...sources: Array<string | undefined>): string {
  for (const s of sources) {
    if (!s) continue;
    const quoted = s.match(/(?<![A-Za-z])['"]([A-Za-z][A-Za-z0-9]*(?: [A-Za-z0-9]+){0,2})['"]/);
    if (quoted && quoted[1].length >= 2 && quoted[1].length <= 24) return quoted[1].toUpperCase();
    const verb = s.match(/\b(?:comment|drop|type|reply(?:\s+with)?|dm(?:\s+me)?)\s+(?:the\s+word\s+)?['"]?([A-Z][A-Z0-9]{1,19}(?: [A-Z][A-Z0-9]+){0,2})\b/);
    if (verb) return verb[1].toUpperCase();
  }
  return '';
}

/** First sentence of a text, or its first `words` words. */
function firstSentence(s: string, words = 16): string {
  const m = s.match(/^(.+?[.!?])(?:\s|$)/);
  const one = (m ? m[1] : s).trim();
  if (wc(one) <= words) return one;
  return `${one.split(/\s+/).slice(0, words).join(' ')}...`;
}

function wordSet(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)),
  );
}

/**
 * A cover kicker that only repeats headline words ("3 SIGNALS" over "3 signals your
 * prospect is ready to sign") reads as a stutter, so it is dropped. Same rule as
 * kickerRepeatsHeadline in supabase/functions/_shared/carousel/plan.ts.
 */
function kickerRepeatsHeadline(kicker: string, headline: string): boolean {
  const k = wordSet(kicker);
  if (k.size === 0) return false;
  const h = wordSet(headline);
  for (const w of k) if (!h.has(w)) return false;
  return true;
}

/** Decide layout and parse lists. The single place slide copy becomes drawable fields. */
export function resolveSlide(slide: SlideContent, kind: 'cover' | 'content' | 'cta', authorHandle?: string, onWarn?: (m: string) => void): Resolved {
  const headline = cleanLine(slide.headline);
  const rawBody = String(slide.body ?? '');
  const r: Resolved = {
    kind, layout: 'point', headline, highlight: cleanLine(slide.highlight), kicker: cleanLine(slide.kicker),
    body: '', items: [], lead: '', footnote: '', statValue: '', statLabel: '', before: '', after: '',
    keyword: '', button: '', reason: '',
  };

  if (kind === 'cover') {
    r.body = cleanLine(rawBody);
    if (kickerRepeatsHeadline(r.kicker, headline)) r.kicker = '';
    return r;
  }

  if (kind === 'cta') {
    r.keyword = cleanKeyword(cleanLine(slide.cta_keyword)) || extractKeyword(slide.cta_button_text, rawBody);
    r.button = safeButtonLabel(slide.cta_button_text, r.keyword, authorHandle);
    // the reason: the structured field, else the body when it is short; a paragraph is trimmed
    const reason = cleanLine(slide.cta_reason) || cleanLine(rawBody);
    r.reason = wc(reason) > 16 ? firstSentence(reason, 14) : reason;
    return r;
  }

  // ---- content slides ----
  r.statValue = cleanLine(slide.stat_value);
  r.statLabel = cleanLine(slide.stat_label);
  r.before = cleanLine(slide.before);
  r.after = cleanLine(slide.after);

  // list: structured items win; otherwise parse the body string (legacy, edited, MCP)
  let items: string[] = [];
  let lead = cleanLine(slide.lead);
  let footnote = cleanLine(slide.footnote);
  if (Array.isArray(slide.items) && slide.items.length) {
    const n = normalizeItems(slide.items.map(String));
    items = n.items;
    if (!footnote) footnote = n.footnote;
  } else {
    const parsed = parseListBody(rawBody);
    if (parsed && (slide.layout === 'list' || parsed.items.length >= 2)) {
      items = parsed.items;
      lead = lead || parsed.lead;
      footnote = footnote || parsed.footnote;
    }
  }
  items = items.map(cleanLine).filter(Boolean);

  const asked = slide.layout;
  let layout: SlideLayout;
  if (asked === 'stat' && r.statValue) layout = 'stat';
  else if (asked === 'compare' && r.before && r.after) layout = 'compare';
  else if (asked === 'statement' && headline) layout = 'statement';
  else if (items.length >= 2) layout = 'list';
  else if (r.statValue && !asked) layout = 'stat';
  else if (r.before && r.after && !asked) layout = 'compare';
  else layout = 'point';
  r.layout = layout;

  if (layout === 'list') {
    if (items.length > MAX_ITEMS_SHOWN) {
      onWarn?.(`list has ${items.length} items; showing the first ${MAX_ITEMS_SHOWN}`);
      const more = items.length - MAX_ITEMS_SHOWN;
      items = items.slice(0, MAX_ITEMS_SHOWN);
      footnote = footnote ? `${footnote} (+${more} more)` : `+${more} more`;
    }
    r.items = items;
    r.lead = lead;
    r.footnote = footnote;
  } else {
    r.body = cleanLine(items.length === 1 ? items[0] : [lead, rawBody.replace(/\s*\n+\s*/g, ' ')].filter(Boolean).join(' '));
    if (layout === 'stat' && r.body === r.statLabel) r.body = '';
  }
  return r;
}

// ============= CONTEXT =============

export interface Ctx {
  slide: SlideContent;
  r: Resolved;
  t: Tokens;
  W: number;
  H: number;
  u: number;
  n: number;
  total: number;
  opts: RenderOptions;
  padX: number;
  padTop: number;
  padBottom: number;
  headerH: number;
  footerH: number;
  sectionGap: number;
  cw: number;
  regionH: number;
  wide: boolean;
  warn: (m: string) => void;
}

export function makeCtx(slide: SlideContent, r: Resolved, t: Tokens, total: number, opts: RenderOptions): Ctx {
  const W = opts.width || 1080;
  const H = opts.height || 1350;
  const u = W / 1080;
  const padX = Math.round(84 * u);
  const padTop = Math.round(78 * u);
  const padBottom = Math.round(74 * u);
  const headerH = Math.round(70 * u);
  const footerH = Math.round(46 * u);
  const sectionGap = Math.round(46 * u);
  const label = `slide ${slide.slide_number} (${r.kind}${r.kind === 'content' ? `:${r.layout}` : ''})`;
  return {
    slide, r, t, W, H, u, n: slide.slide_number, total, opts, padX, padTop, padBottom, headerH, footerH, sectionGap,
    cw: W - padX * 2,
    // the header grows by its rule's padding; the bottom-right identity takes 26u of gap plus its ~68u name block
    regionH: H - padTop - padBottom - headerH - footerH - sectionGap * 2
      - (t.headerRule ? Math.round(18 * u) : 0)
      - (t.identity === 'bottom-right' && r.kind !== 'cta' ? Math.round(96 * u) : 0),
    wide: H <= W * 1.08,
    warn: (m) => opts.onWarn?.(`${label}: ${m}`),
  };
}

// ============= SMALL PARTS =============

const px = (n: number) => Math.round(n);

function labelText(c: Ctx, content: string, size: number, color: string, weight?: number): SatoriElement {
  return text(content, {
    font: { ...c.t.label, weight: weight ?? c.t.label.weight }, size: px(size * c.u), color, tracking: c.t.labelTracking, upper: true, lh: 1.1,
  });
}

function initialOf(name: string, handle: string): string {
  const s = (name || handle).replace(/^@/, '').trim();
  return s ? s[0].toUpperCase() : '';
}

function cleanHandle(h: string | undefined): string {
  const s = cleanLine(h).replace(/\s+/g, '').replace(/^@+/, '');
  return s ? `@${s}` : '';
}

/** Logo chip or initial avatar + brand name + @handle. Null when there is nothing to show. */
function identity(c: Ctx, size: 'sm' | 'lg', align: 'left' | 'right' = 'left'): SatoriElement | null {
  const { t, opts, u } = c;
  const name = cleanLine(opts.authorName);
  const handle = cleanHandle(opts.authorHandle);
  const logo = opts.logo;
  if (!name && !handle && !logo) return null;

  const av = px((size === 'sm' ? 64 : 104) * u);
  let mark: SatoriElement;
  let markW = av;
  if (logo) {
    const wideLogo = logo.aspect > 1.35;
    const h = wideLogo ? px(av * 0.82) : av;
    const w = wideLogo ? Math.min(px(av * 3.6), px(h * logo.aspect)) : av;
    markW = w;
    const innerH = wideLogo ? px(w / logo.aspect) : px(av * 0.84);
    const innerW = wideLogo ? w - px(av * 0.36) : px(av * 0.84);
    mark = box(
      { width: wideLogo ? w : av, height: h, alignItems: 'center', justifyContent: 'center', background: '#FFFFFF', borderRadius: wideLogo ? px(av * 0.2) : '50%', flexShrink: 0 },
      { type: 'img', props: { src: logo.dataUri, width: wideLogo ? innerW : innerH, height: wideLogo ? px(innerW / logo.aspect) : innerH, style: { objectFit: 'contain' } } },
    );
  } else {
    mark = box(
      { width: av, height: av, borderRadius: '50%', background: t.accent, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
      text(initialOf(name, handle), { font: { family: t.display.family, weight: t.display.weight }, size: px(av * 0.5), color: t.onAccent, lh: 1, extra: { textTransform: 'uppercase' } }),
    );
  }

  const nameSize = px((size === 'sm' ? 30 : 40) * u);
  const handleSize = px((size === 'sm' ? 26 : 30) * u);
  // a long brand name or handle is cut to one line: it must not run under the slide counter or off the slide
  const gapW = px((size === 'sm' ? 16 : 24) * u);
  const room = c.cw - markW - gapW - (size === 'sm' && align === 'left' ? px(150 * u) : 0);
  const nameFont: FontRef = { family: 'Inter', weight: 700 };
  const handleFont: FontRef = { family: 'Inter', weight: 500 };
  const lines: SatoriElement[] = [];
  if (name) lines.push(text(fitLine(nameFont, name, nameSize, nameSize, room, -0.01).text, { font: nameFont, size: nameSize, color: t.fg, lh: 1.15, tracking: -0.01 }));
  if (handle) lines.push(text(fitLine(handleFont, handle, handleSize, handleSize, room).text, { font: handleFont, size: handleSize, color: t.muted, lh: 1.15 }));

  return box(
    { alignItems: 'center', gap: gapW, flexDirection: align === 'right' ? 'row-reverse' : 'row' },
    [mark, ...(lines.length ? [box({ flexDirection: 'column', gap: px(3 * u), alignItems: align === 'right' ? 'flex-end' : 'flex-start' }, lines)] : [])],
  );
}

function counter(c: Ctx): SatoriElement {
  const { t, u } = c;
  return box({ alignItems: 'baseline', gap: px(2 * u) }, [
    text(String(c.n), { font: { ...t.label, weight: 700 }, size: px(36 * u), color: t.fg, lh: 1 }),
    text(`/${c.total}`, { font: { ...t.label, weight: 400 }, size: px(30 * u), color: t.faint, lh: 1 }),
  ]);
}

function header(c: Ctx, showIdentity: boolean): SatoriElement {
  const { t } = c;
  const id = showIdentity && t.identity === 'top' ? identity(c, 'sm') : null;
  return box(
    {
      alignItems: 'center', justifyContent: 'space-between', height: c.headerH, flexShrink: 0,
      ...(t.headerRule ? { borderBottom: `1.5px solid ${t.rule}`, paddingBottom: px(18 * c.u), height: c.headerH + px(18 * c.u) } : {}),
    },
    [id ?? box({}), counter(c)],
  );
}

function progress(c: Ctx): SatoriElement {
  const { t, n, total, u } = c;
  if (t.progress === 'line') {
    return box({ flex: 1, height: px(3 * u), background: t.rule, alignItems: 'stretch' },
      box({ width: `${Math.round((n / total) * 100)}%`, background: t.accent }));
  }
  const segs: SatoriElement[] = [];
  for (let i = 1; i <= total; i++) {
    segs.push(box({ flex: 1, height: px(6 * u), borderRadius: 3, background: i <= n ? (i === n ? t.accent : t.fg) : t.rule, ...(i < n ? { opacity: 0.75 } : {}) }));
  }
  return box({ flex: 1, gap: px(7 * u), alignItems: 'center' }, segs);
}

function footer(c: Ctx): SatoriElement {
  const { t, u, r } = c;
  const last = r.kind === 'cta';
  const right: SatoriElement[] = [];
  if (r.kind === 'cover') {
    right.push(labelText(c, 'Swipe', 25, t.fg, 700));
    right.push(longArrow(px(64 * u), t.accent, 3.4));
  } else if (!last) {
    right.push(longArrow(px(52 * u), t.faint, 3));
  }
  return box({ alignItems: 'center', gap: px(30 * u), height: c.footerH, flexShrink: 0 }, [progress(c), ...(right.length ? [box({ alignItems: 'center', gap: px(14 * u) }, right)] : [])]);
}

/** The whole slide: decoration, grain, then header / main / footer. */
function frame(c: Ctx, main: SatoriElement | SatoriElement[], opts: { identity?: boolean; overlay?: SatoriElement[] } = {}): SatoriElement {
  const { t } = c;
  const assets = c.opts.assets ?? {};
  const layers: SatoriElement[] = [
    ...t.decor({ w: c.W, h: c.H, assets, slideNumber: c.n, total: c.total }),
  ];
  if (assets.grain && t.grain > 0) {
    layers.push(box({
      position: 'absolute', top: 0, left: 0, width: c.W, height: c.H,
      backgroundImage: `url(${assets.grain})`, backgroundRepeat: 'repeat', backgroundSize: '256px 256px', opacity: t.grain * (t.dark ? 1.9 : 3.2),
    }));
  }
  const bottomId = t.identity === 'bottom-right' && c.r.kind !== 'cta' ? identity(c, 'sm', 'right') : null;
  layers.push(box(
    { position: 'absolute', top: 0, left: 0, width: c.W, height: c.H, flexDirection: 'column', padding: `${c.padTop}px ${c.padX}px ${c.padBottom}px` },
    [
      header(c, opts.identity !== false),
      gap(c.sectionGap),
      box({ flex: 1, flexDirection: 'column', minHeight: 0 }, main),
      ...(bottomId ? [gap(px(26 * c.u)), box({ justifyContent: 'flex-end' }, bottomId)] : []),
      gap(c.sectionGap),
      footer(c),
    ],
  ));
  if (opts.overlay) layers.push(...opts.overlay);
  return box({ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: t.bg, fontFamily: t.body.family }, layers);
}

// ============= TEXT PIECES =============

/** The headline, with the highlight words styled by the theme. */
function headlineEl(c: Ctx, content: string, size: number, color?: string): SatoriElement {
  const { t } = c;
  const fg = color ?? t.fg;
  const font = t.display;
  const base = {
    font, size, color: fg, lh: t.displayLeading, tracking: t.displayTracking, upper: t.displayUpper,
  };
  const parts = c.r.highlight ? splitHighlight(content, c.r.highlight) : null;
  if (!parts) {
    const w = balancedWidth(font, content, size, c.cw, t.displayTracking, t.displayUpper);
    return text(content, { ...base, extra: w < c.cw ? { maxWidth: `${w}px` } : undefined });
  }

  const { before, run, after } = parts;
  const spaceW = px(textWidth(font, ' ', size, t.displayTracking) + 1);

  const word = (w: string) => text(w, base);
  const runEl = (): SatoriElement => {
    const s = t.highlight;
    if (s === 'color') return text(run, { ...base, color: t.accentText });
    if (s === 'italic') return text(run, { ...base, font: t.italic, color: t.accentText });
    const padX = px(size * (s === 'tape' ? 0.16 : 0.15));
    return box(
      {
        background: t.accent, padding: `0 ${padX}px`, borderRadius: px(s === 'tape' ? 2 : Math.min(t.radius, size * 0.14)),
        ...(s === 'tape' ? { transform: 'rotate(-1.6deg)' } : {}),
      },
      text(run, { ...base, color: t.onAccent }),
    );
  };

  const items: SatoriElement[] = [
    ...before.split(/\s+/).filter(Boolean).map(word),
    runEl(),
    ...after.split(/\s+/).filter(Boolean).map(word),
  ];
  return box({ flexWrap: 'wrap', columnGap: spaceW, rowGap: 0, alignItems: 'center' }, items);
}

/** Fit options that make a headline block measure its highlight run the way it is drawn. */
function hl(c: Ctx): Pick<FitBlock, 'highlight' | 'runPad' | 'runFont'> {
  if (!c.r.highlight) return {};
  const s = c.t.highlight;
  return {
    highlight: c.r.highlight,
    runPad: s === 'marker' ? 0.3 : s === 'tape' ? 0.32 : 0,
    runFont: s === 'italic' ? c.t.italic : undefined,
  };
}

/**
 * The small label above a headline, always ONE line (shrunk, then cut with "...") so it
 * never wraps inside its pill or tag. `h` is the real drawn height, chrome included.
 */
function kicker(c: Ctx, content: string): { el: SatoriElement; h: number } {
  const { t, u } = c;
  const font: FontRef = { ...t.label, weight: 700 };
  const chrome = t.kicker === 'rule' ? 74 : t.kicker === 'pill' ? 56 : t.kicker === 'tag' ? 40 : 0;
  const fit = fitLine(font, content, 30 * u, 24 * u, c.cw - chrome * u, t.labelTracking, true);
  if (fit.clamped) c.warn('too much text: the label was cut to one line');
  const size = px(fit.size);
  const label = labelText(c, fit.text, size / u, t.kicker === 'tag' ? t.onAccent : t.accentText, 700);
  const line = size * 1.1;
  if (t.kicker === 'rule') {
    return { el: box({ alignItems: 'center', gap: px(18 * u) }, [box({ width: px(56 * u), height: px(3 * u), background: t.accent }), label]), h: line };
  }
  if (t.kicker === 'pill') {
    return {
      el: box({ alignSelf: 'flex-start', padding: `${px(11 * u)}px ${px(26 * u)}px`, border: `${px(2 * u)}px solid ${t.accent}`, borderRadius: 999 }, label),
      h: line + px(11 * u) * 2 + px(2 * u) * 2,
    };
  }
  if (t.kicker === 'tag') {
    return {
      el: box({ alignSelf: 'flex-start', padding: `${px(9 * u)}px ${px(20 * u)}px`, background: t.accent, borderRadius: t.radius }, label),
      h: line + px(9 * u) * 2,
    };
  }
  return { el: label, h: line };
}

function numeralEl(c: Ctx, n: number, size: number, color?: string): SatoriElement {
  const { t } = c;
  return text(String(n).padStart(2, '0'), {
    font: t.numeral, size, color: color ?? t.accentText, lh: 0.84, tracking: t.numeral.family === 'Anton' ? 0 : -0.045,
    extra: t.numeral.family === 'Instrument Serif' ? { fontStyle: 'italic' } : undefined,
  });
}

function shortRule(c: Ctx): SatoriElement {
  return box({ width: px(96 * c.u), height: px(8 * c.u), background: c.t.accent, flexShrink: 0, borderRadius: c.t.radius > 8 ? 4 : 0 });
}

// ============= FIT REPORTING =============

/** One warning per step a stack had to give: dropped blocks, the emergency floor, cut text. */
function reportFit(c: Ctx, res: Pick<StackResult, 'dropped' | 'floored' | 'clamped' | 'fits'>, names: Record<string, string> = {}): void {
  const name = (id: string) => names[id] ?? id;
  if (res.dropped.length) c.warn(`too much text: dropped the ${res.dropped.map(name).join(' and ')}`);
  if (res.floored) c.warn('too much text: shrunk below the normal minimum size');
  if (res.clamped.length) c.warn(`too much text: cut the ${res.clamped.map(name).join(' and ')} with an ellipsis`);
  if (!res.fits) c.warn('too much text: it still does not fit after trimming');
}

/**
 * A zero-height block for the end of a stack. A block's `gap` (space below it) only counts
 * while another block follows, so this keeps the gap below a droppable block real.
 */
function tail(c: Ctx): StackBlock {
  return { id: 'z', font: c.t.body, text: '', min: 0, max: 0, lh: 0, width: c.cw };
}

// ============= COVER =============

export function buildCoverLayout(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const kick = r.kicker ? kicker(c, r.kicker) : null;
  const kickGap = (t.highlight === 'tape' ? 52 : 36) * u;
  const blocks: StackBlock[] = [
    {
      id: 'h', font: t.display, text: r.headline, min: t.coverSize[0] * u * 0.72, max: t.coverSize[1] * u, lh: t.displayLeading,
      tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 7, gap: 34 * u,
    },
  ];
  if (r.body) blocks.push({ id: 's', font: t.body, text: r.body, min: 34 * u, max: 42 * u, lh: t.bodyLeading, width: cw * 0.9, maxLines: 3, optional: true });
  const fit = fitStack(blocks, regionH - (kick ? kick.h + kickGap : 0));
  reportFit(c, fit, { h: 'headline', s: 'subline' });

  const group: SatoriElement[] = [headlineEl(c, stackText(fit, 'h'), fit.sizes.h)];
  const sub = stackText(fit, 's');
  if (sub) group.push(gap(34 * u), text(sub, { font: t.body, size: fit.sizes.s, color: t.muted, lh: t.bodyLeading }));

  const anchor = t.coverAnchor;
  const stack = [...(kick ? [kick.el, gap(kickGap)] : []), ...group];
  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: anchor === 'bottom' ? 'flex-end' : anchor === 'top' ? 'flex-start' : 'center' }, stack));
}

// ============= POINT =============

function buildPoint(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const n = Math.max(1, c.n - 1);
  const blocks: StackBlock[] = [
    {
      id: 'h', font: t.display, text: r.headline, min: t.contentSize[0] * u, max: t.contentSize[1] * u, lh: t.displayLeading,
      tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 5, gap: 44 * u,
    },
  ];
  if (r.body) blocks.push({ id: 'b', font: t.body, text: r.body, min: 38 * u, max: 48 * u, lh: t.bodyLeading, width: cw, maxLines: 9 });
  const numMin = 150 * u;
  const kickGap = 28 * u;
  const ruleH = r.body ? 8 * u + 80 * u : 0; // rule plus the gap above and below it
  const numGap = 40 * u;
  let kick = r.kicker ? kicker(c, r.kicker) : null;
  let kickH = kick ? kick.h + kickGap : 0;

  // the big numeral is drawn only while the text fits beside it at its normal sizes
  let fit = fitStack(blocks, regionH - numMin * 0.84 - numGap - kickH - ruleH, 1);
  const withNum = fit.fits;
  if (!withNum) {
    // it is the first thing to go: the beat number moves into the kicker and the text gets the room
    c.warn('too much text: dropped the big numeral');
    kick = kicker(c, r.kicker || String(n).padStart(2, '0'));
    kickH = kick.h + kickGap;
    fit = fitStack(blocks, regionH - kickH - ruleH);
    reportFit(c, fit, { h: 'headline', b: 'body' });
  }

  const children: SatoriElement[] = [];
  if (withNum) {
    const used = fit.height + kickH + ruleH + numGap;
    const numSize = Math.max(numMin, Math.min(350 * u, (regionH - used) / 0.84 - 8 * u));
    children.push(numeralEl(c, n, px(numSize)), gap(numGap));
  }
  if (kick) children.push(kick.el, gap(kickGap));
  children.push(headlineEl(c, stackText(fit, 'h'), fit.sizes.h));
  const body = stackText(fit, 'b');
  if (body) {
    children.push(gap(40 * u), shortRule(c), gap(40 * u));
    children.push(text(body, { font: t.body, size: fit.sizes.b, color: t.muted, lh: t.bodyLeading }));
  }
  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, children));
}

// ============= LIST =============

interface ListPlan {
  lead: string;
  footnote: string;
  items: string[];
}

function itemFont(c: Ctx): FontRef {
  return { family: c.t.body.family, weight: Math.max(c.t.body.weight, 600) };
}

function markerWidth(c: Ctx, size: number): number {
  const m = c.t.marker;
  if (m === 'numeral') return size * 1.5;
  if (m === 'check') return size * 1.0;
  return size * 0.62;
}

function rowPad(c: Ctx, size: number): number {
  return size * (c.t.marker === 'numeral' || c.t.hardShadow ? 0.44 : 0.4);
}

function markerEl(c: Ctx, i: number, size: number): SatoriElement {
  const { t } = c;
  if (t.marker === 'numeral') {
    return text(String(i + 1).padStart(2, '0'), { font: t.numeral.family === 'Instrument Serif' ? { family: 'Space Mono', weight: 700 } : { ...t.label, weight: 700 }, size: px(size * 0.62), color: t.accentText, lh: 1, tracking: 0.02 });
  }
  if (t.marker === 'check') {
    const s = px(size * 0.9);
    return box({ width: s, height: s, borderRadius: '50%', background: t.accent, alignItems: 'center', justifyContent: 'center' }, icon('check', px(s * 0.62), t.onAccent, 3.2));
  }
  const s = px(size * 0.36);
  return box({ width: s, height: s, background: t.accent, borderRadius: t.radius > 10 ? 3 : 0 });
}

interface ListMode {
  twoCol: boolean;
  colW: number;
  iMin: number;
  iMax: number;
}

interface ListChoice {
  v: ListPlan;
  m: ListMode;
  fit: FitResult;
  /** index in the prose variants: how much lead-in and footnote were given up */
  idx: number;
  head: string;
  items: string[];
  /** 1 at the normal minimum sizes, EMERGENCY_FLOOR when below them */
  f: number;
}

function buildList(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const colGap = 44 * u;
  const font = itemFont(c);
  const kick = r.kicker ? kicker(c, r.kicker) : null;
  const kickerRoom = kick ? kick.h + 24 * u : 0;
  const room = regionH - kickerRoom;
  const rule = t.marker === 'numeral' || t.hardShadow ? px(Math.max(1.5, 2 * u)) : 0;

  // Two columns suit a long list of short items; single column suits long items. The
  // preferred mode goes first; the other one is the way out when it cannot hold the text.
  const modeOf = (twoCol: boolean): ListMode => ({
    twoCol, colW: twoCol ? (cw - colGap) / 2 : cw, iMin: (twoCol ? 34 : 36) * u, iMax: (twoCol ? 42 : 60) * u,
  });
  const prefTwo = r.items.length > 5;
  const modes: ListMode[] = [modeOf(prefTwo), ...(prefTwo || r.items.length >= 4 ? [modeOf(!prefTwo)] : [])];
  const lineW = (m: ListMode, size: number) => m.colW - markerWidth(c, size) - size * 0.5;

  const trim = (s: string) => firstSentence(s, 14);
  const variants: ListPlan[] = [
    { lead: r.lead, footnote: r.footnote, items: r.items },
    { lead: r.lead, footnote: trim(r.footnote), items: r.items },
    { lead: trim(r.lead), footnote: trim(r.footnote), items: r.items },
    { lead: trim(r.lead), footnote: '', items: r.items },
    { lead: '', footnote: '', items: r.items },
  ];
  const last = variants.length - 1;

  const headBlock = (content: string, f: number, v: ListPlan, maxLines = 4): FitBlock => ({
    id: 'h', font: t.display, text: content, min: t.contentSize[0] * 0.86 * u * f, max: t.contentSize[1] * 0.98 * u, lh: t.displayLeading,
    tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines, gap: (v.lead ? 22 : 30) * u,
  });

  interface Opts { single?: boolean; f?: number; cap?: number; head?: string; headCap?: number; items?: string[]; force?: boolean }
  /** One arrangement: the plan in a column mode at a size scale. Null when it does not fit (unless forced). */
  const attempt = (m: ListMode, v: ListPlan, idx: number, o: Opts = {}): ListChoice | null => {
    const f = o.f ?? 1;
    const items = o.items ?? v.items;
    const head = o.head ?? r.headline;
    const single = !!o.single && !m.twoCol;
    const cap = single ? 1 : o.cap ?? 3;
    // single-line mode: the largest item size (>= 44px) at which every item fits on ONE line.
    // The items then stay at that size and only the other blocks scale, so a long item does not
    // shrink the headline too.
    let fixedSize = 0;
    if (single) {
      for (let sz = m.iMax; sz >= 44 * u; sz -= 2) {
        if (items.every((it) => wrapLines(font, it, sz, lineW(m, sz), 0).length <= 1)) { fixedSize = sz; break; }
      }
      if (!fixedSize) return null;
    }
    const rows = m.twoCol ? Math.ceil(items.length / 2) : items.length;
    const measureItems = (size: number) => {
      let ok = true;
      const cols = m.twoCol ? [items.slice(0, rows), items.slice(rows)] : [items];
      const heights = cols.map((col) => {
        let h = rule; // the first row's top border
        col.forEach((it) => {
          const lines = wrapLines(font, it, size, lineW(m, size), 0).length;
          if (lines > cap) ok = false;
          h += lines * size * 1.22 + rowPad(c, size) * 2 + rule;
        });
        return h;
      });
      return { height: Math.max(...heights), ok };
    };
    const blocks: FitBlock[] = [headBlock(head, f, v, o.headCap)];
    if (v.lead) blocks.push({ id: 'l', font: t.body, text: v.lead, min: 34 * u * f, max: 44 * u, lh: t.bodyLeading, width: cw, maxLines: 3, gap: 30 * u });
    blocks.push({ id: 'i', font, text: '', min: fixedSize || m.iMin * f, max: fixedSize || m.iMax, lh: 1.22, width: m.colW, measure: measureItems, gap: 26 * u });
    if (v.footnote) blocks.push({ id: 'f', font: t.body, text: v.footnote, min: 30 * u * f, max: 34 * u, lh: t.bodyLeading, width: cw, maxLines: 3, gap: 0 });
    const fit = fitBlocks(blocks, room);
    return fit.fits || o.force ? { v, m, fit, idx, head, items, f } : null;
  };

  // Stage 1 and 2: shrink first; give up prose (trim, then drop) next; then let everything go
  // to 80% of its minimum size. Every item on ONE line is the goal, but when that forces the
  // items much smaller than wrapping would allow (long items), bigger type that wraps reads better.
  const pickIn = (m: ListMode, f: number): ListChoice | null => {
    // below the normal minimum the prose is already gone: only the last variant is tried
    const from = f < 1 ? last : 0;
    const firstFit = (single: boolean): ListChoice | null => {
      for (let idx = from; idx < variants.length; idx++) {
        const got = attempt(m, variants[idx], idx, { single, f });
        if (got) return got;
      }
      return null;
    };
    const oneLine = m.twoCol || f < 1 ? null : firstFit(true);
    const wrapped = firstFit(false);
    // keep the person's prose (lead-in, footnote) over either preference: the variant that trims less wins
    let picked: ListChoice | null = oneLine ?? wrapped;
    if (oneLine && wrapped) {
      if (wrapped.idx < oneLine.idx) picked = wrapped;
      else if (wrapped.idx === oneLine.idx && wrapped.fit.sizes.i >= oneLine.fit.sizes.i * 1.15) picked = wrapped;
    }
    return picked;
  };

  let chosen: ListChoice | null = null;
  for (const f of [1, EMERGENCY_FLOOR]) {
    for (const m of modes) {
      chosen = pickIn(m, f);
      if (chosen) break;
    }
    if (chosen) break;
  }

  // Stage 3: cut text. Items go to two lines, then one; the headline last. Cut text ends in "...".
  const floorSize = (minPx: number) => Math.round((minPx * EMERGENCY_FLOOR) / 2) * 2;
  const cutItems = (items: string[], m: ListMode, cap: number) => {
    const sz = floorSize(m.iMin);
    return items.map((it) => clampToLines(it, cap, (s) => wrapLines(font, s, sz, lineW(m, sz), 0).length));
  };
  const cutHead = (cap: number) => {
    const b = headBlock(r.headline, EMERGENCY_FLOOR, variants[last], cap);
    const sz = floorSize(t.contentSize[0] * 0.86 * u);
    return clampToLines(r.headline, cap, (s) => blockLines(b, s, sz));
  };
  if (!chosen) {
    for (const headCap of [4, 3, 2]) {
      const head = cutHead(headCap);
      for (const cap of [2, 1]) {
        for (const m of modes) {
          chosen = attempt(m, variants[last], last, { f: EMERGENCY_FLOOR, cap, head, headCap, items: cutItems(variants[last].items, m, cap) });
          if (chosen) break;
        }
        if (chosen) break;
      }
      if (chosen) break;
    }
  }

  // Stage 4, the last resort: drop items from the end (as few as possible)
  if (!chosen) {
    const head = cutHead(2);
    for (let n = r.items.length - 1; n >= 2 && !chosen; n--) {
      for (const m of modes) {
        chosen = attempt(m, variants[last], last, { f: EMERGENCY_FLOOR, cap: 1, head, headCap: 2, items: cutItems(r.items.slice(0, n), m, 1) });
        if (chosen) break;
      }
    }
  }
  if (!chosen) {
    const m = modes[modes.length - 1];
    chosen = attempt(m, variants[last], last, { f: EMERGENCY_FLOOR, cap: 1, head: cutHead(2), headCap: 2, items: cutItems(r.items.slice(0, 2), m, 1), force: true })!;
    c.warn('too much text: it still does not fit after trimming');
  }

  const { v, fit, m, head, items: shown } = chosen;
  if (r.lead && v.lead !== r.lead) c.warn(v.lead ? 'too much text: trimmed the lead-in to its first sentence' : 'too much text: dropped the lead-in');
  if (r.footnote && v.footnote !== r.footnote) c.warn(v.footnote ? 'too much text: trimmed the footnote to its first sentence' : 'too much text: dropped the footnote');
  if (chosen.f < 1) c.warn('too much text: shrunk below the normal minimum size');
  if (head !== r.headline) c.warn('too much text: cut the headline with an ellipsis');
  const nCut = shown.filter((it, i) => it !== r.items[i]).length;
  if (nCut) c.warn(`too much text: cut ${nCut} item(s) with an ellipsis`);
  if (shown.length < r.items.length) c.warn(`too much text: dropped ${r.items.length - shown.length} item(s) from the end`);

  const size = fit.sizes.i;
  const lineH = size * 1.22;
  const nRows = m.twoCol ? Math.ceil(shown.length / 2) : shown.length;
  // spread spare height into the rows so the list fills the slide instead of floating in it
  const spare = Math.max(0, room - fit.height - 24 * u);
  const pad = rowPad(c, size) + Math.min(spare / (2 * nRows), size * 0.8);
  const mW = markerWidth(c, size);
  const rowsEl = (col: string[], offset: number) => box(
    { flexDirection: 'column', width: m.colW },
    col.map((it, i) => box(
      {
        alignItems: 'flex-start', gap: px(size * 0.5), paddingTop: px(pad), paddingBottom: px(pad),
        ...(rule ? { borderBottom: `${rule}px solid ${t.rule}` } : {}),
        ...(i === 0 && rule ? { borderTop: `${rule}px solid ${t.rule}` } : {}),
      },
      [
        box({ width: px(mW), height: px(lineH), alignItems: 'center', flexShrink: 0 }, markerEl(c, offset + i, size)),
        text(it, { font, size, color: t.fg, lh: 1.22, extra: { flex: 1 } }),
      ],
    )),
  );

  const body: SatoriElement[] = [];
  if (kick) body.push(kick.el, gap(24 * u));
  body.push(headlineEl(c, head, fit.sizes.h));
  if (v.lead) body.push(gap(22 * u), text(v.lead, { font: t.body, size: fit.sizes.l, color: t.muted, lh: t.bodyLeading }));
  body.push(gap(30 * u));
  if (m.twoCol) {
    const rows = Math.ceil(shown.length / 2);
    body.push(box({ gap: px(colGap) }, [rowsEl(shown.slice(0, rows), 0), rowsEl(shown.slice(rows), rows)]));
  } else {
    body.push(rowsEl(shown, 0));
  }
  if (v.footnote) body.push(gap(26 * u), text(v.footnote, { font: t.body, size: fit.sizes.f, color: t.muted, lh: t.bodyLeading }));

  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, body));
}

// ============= STAT =============

function buildStat(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const numFont = t.numeral.family === 'Instrument Serif' ? { family: 'Instrument Serif', weight: 400 } : t.numeral;
  const tracking = -0.045;
  const kick = r.kicker ? kicker(c, r.kicker) : null;
  const kickH = kick ? kick.h + 24 * u : 0;
  const labelFont: FontRef = { ...t.body, weight: 700 };
  const airAbove = 44 * u; // between the headline and the numeral, at the least
  const airBelow = 40 * u; // between the numeral (and its label) and the body, at the least
  const bodyLead = 32 * u; // the rule and its margin above the body

  // The numeral's height is reserved inside the headline's `gap`, so the stack that is fitted is
  // the whole slide: headline, numeral, label, body.
  const stackFor = (heroMin: number, withBody: boolean): StackBlock[] => {
    const heroH = heroMin * 0.86;
    const below = withBody ? airBelow + bodyLead : 0;
    const blocks: StackBlock[] = [
      {
        id: 'h', font: t.display, text: r.headline, min: t.contentSize[0] * 0.8 * u, max: t.contentSize[1] * 0.86 * u, lh: t.displayLeading,
        tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 3, gap: airAbove + heroH + (r.statLabel ? 22 * u : below),
      },
    ];
    if (r.statLabel) blocks.push({ id: 'l', font: labelFont, text: r.statLabel, min: 38 * u, max: 48 * u, lh: t.bodyLeading, width: cw, maxLines: 3, gap: below });
    if (withBody) blocks.push({ id: 'b', font: t.body, text: r.body, min: 34 * u, max: 40 * u, lh: t.bodyLeading, width: cw, maxLines: 3 });
    blocks.push(tail(c));
    return blocks;
  };
  // the body is the optional block: it goes first; past that the numeral may shrink with the text
  const hasBody = !!r.body;
  let heroMin = 150 * u;
  let withBody = hasBody;
  let fit = fitStack(stackFor(heroMin, withBody), regionH - kickH, 1);
  if (!fit.fits && hasBody) {
    withBody = false;
    fit = fitStack(stackFor(heroMin, false), regionH - kickH, 1);
  }
  if (!fit.fits) {
    heroMin = 150 * u * EMERGENCY_FLOOR;
    fit = fitStack(stackFor(heroMin, false), regionH - kickH, 2);
    if (!fit.fits) fit = fitStack(stackFor(heroMin, false), regionH - kickH, 3);
  }
  if (hasBody && !withBody) c.warn('too much text: dropped the body');
  reportFit(c, fit, { h: 'headline', l: 'label', b: 'body' });

  // hero number: as large as fits the width and the space left
  const heroRoom = regionH - kickH - (fit.height - heroMin * 0.86);
  let hero = Math.min(330 * u, heroRoom / 0.86);
  while (hero > heroMin && textWidth(numFont, r.statValue, hero, tracking) > cw) hero -= 4 * u;
  hero = Math.max(hero, heroMin);
  let heroText = r.statValue;
  if (textWidth(numFont, heroText, hero, tracking) > cw) {
    const f = fitLine(numFont, heroText, hero, 64 * u, cw, tracking);
    hero = f.size;
    heroText = f.text;
    c.warn(f.clamped ? 'too much text: the number was cut with an ellipsis' : 'too much text: the number was shrunk below its normal minimum size');
  }

  const heroEl = text(heroText, { font: numFont, size: px(hero), color: t.accentText, lh: 0.86, tracking, extra: { alignSelf: 'flex-start' } });
  const top = [...(kick ? [kick.el, gap(24 * u)] : []), headlineEl(c, stackText(fit, 'h'), fit.sizes.h)];
  const mid: SatoriElement[] = [heroEl];
  const label = stackText(fit, 'l');
  if (label) mid.push(gap(22 * u), text(label, { font: labelFont, size: fit.sizes.l, color: t.fg, lh: t.bodyLeading }));
  const bodyText = stackText(fit, 'b');
  const bottom: SatoriElement[] = bodyText
    ? [box({ height: px(2 * u), background: t.rule, marginBottom: px(30 * u) }), text(bodyText, { font: t.body, size: fit.sizes.b, color: t.muted, lh: t.bodyLeading })]
    : [];
  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'space-between' }, [
    box({ flexDirection: 'column' }, top),
    box({ flexDirection: 'column' }, mid),
    box({ flexDirection: 'column' }, bottom),
  ]));
}

// ============= COMPARE =============

function buildCompare(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const panelGap = 28 * u;
  const bFont: FontRef = { family: t.body.family, weight: 700 };
  const aFont: FontRef = { ...t.body, weight: 500 };
  const kick = r.kicker ? kicker(c, r.kicker) : null;
  const kickH = kick ? kick.h + 22 * u : 0;
  const borderW = px((t.hardShadow ? 5 : 2) * u);
  const shadow = t.hardShadow ? 10 * u : 0;

  // headline first (at most a third of the slide), then the panels share what is left
  const headFit = fitStack(
    [{
      id: 'h', font: t.display, text: r.headline, min: t.contentSize[0] * 0.8 * u, max: t.contentSize[1] * 0.9 * u, lh: t.displayLeading,
      tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 3, gap: 0,
    }],
    regionH * 0.34,
  );
  reportFit(c, headFit, { h: 'headline' });
  const avail = regionH - headFit.height - 44 * u - kickH;

  // Arrangements, most natural first: side by side on a square canvas, stacked on a tall one;
  // then tighter padding; then the other orientation; then no "Instead of" / "Do this" labels.
  interface Cfg { side: boolean; pad: number; label: boolean }
  const pref = c.wide;
  const cfgs: Cfg[] = [
    { side: pref, pad: 40 * u, label: true },
    { side: pref, pad: 28 * u, label: true },
    { side: !pref, pad: 40 * u, label: true },
    { side: !pref, pad: 28 * u, label: true },
    { side: pref, pad: 28 * u, label: false },
    { side: !pref, pad: 28 * u, label: false },
  ];
  const geom = (g: Cfg) => {
    const panelW = g.side ? (cw - panelGap) / 2 : cw;
    const panelH = g.side ? avail : (avail - panelGap) / 2;
    const outerW = panelW - shadow;
    const outerH = panelH - shadow;
    return {
      panelW, panelH, outerW, outerH,
      textW: outerW - g.pad * 2 - borderW * 2,
      inner: Math.max(40 * u, outerH - g.pad * 2 - borderW * 2 - (g.label ? 54 * u : 0)),
    };
  };
  interface Sol { g: Cfg; a: StackResult; b: StackResult }
  const solve = (g: Cfg, stage: 1 | 2 | 3): Sol => {
    const { textW, inner } = geom(g);
    const ab: StackBlock = { id: 'a', font: aFont, text: r.before, min: 36 * u, max: 66 * u, lh: 1.26, width: textW, maxLines: 6, gap: 0 };
    const bb: StackBlock = { id: 'b', font: bFont, text: r.after, min: 38 * u, max: 72 * u, lh: 1.22, width: textW, maxLines: 6, gap: 0 };
    return { g, a: fitStack([ab], inner, stage), b: fitStack([bb], inner, stage) };
  };
  const fitsBoth = (s: Sol) => s.a.fits && s.b.fits;
  let sol: Sol | null = null;
  // At the normal sizes the first arrangement that fits wins. Below them (or when cut) the
  // arrangement that leaves the text biggest wins, since the orientation decides how much fits.
  const size = (s: Sol) => Math.min(s.a.sizes.a, s.b.sizes.b);
  const biggest = (list: Sol[]) => list.reduce((best, s) => (size(s) > size(best) ? s : best));
  const normal = cfgs.map((g) => solve(g, 1)).find(fitsBoth);
  if (normal) sol = normal;
  else {
    const floored = cfgs.map((g) => solve(g, 2)).filter(fitsBoth);
    sol = floored.length ? biggest(floored) : biggest(cfgs.map((g) => solve(g, 3)));
  }
  const { g, a: aFit, b: bFit } = sol;
  if (!g.label) c.warn('too much text: dropped the panel labels');
  reportFit(c, {
    dropped: [], floored: aFit.floored || bFit.floored, fits: fitsBoth(sol),
    clamped: [...(aFit.clamped.length ? ['before text'] : []), ...(bFit.clamped.length ? ['after text'] : [])],
  });
  const { panelW, panelH, outerW, outerH } = geom(g);
  // one size for both sides keeps the pair readable as a pair
  const shared = g.side ? Math.min(aFit.sizes.a, bFit.sizes.b) : undefined;
  const aSize = shared ?? aFit.sizes.a;
  const bSize = shared ?? bFit.sizes.b;

  const panel = (kind: 'before' | 'after'): SatoriElement => {
    const isAfter = kind === 'after';
    const fg = isAfter ? t.onAccent : t.muted;
    const label = box({ alignItems: 'center', gap: px(14 * u), marginBottom: px(22 * u) }, [
      icon(isAfter ? 'check' : 'x', px(30 * u), isAfter ? t.onAccent : t.faint, 3.2),
      labelText(c, isAfter ? 'Do this' : 'Instead of', 26, isAfter ? t.onAccent : t.faint, 700),
    ]);
    const body = text(isAfter ? stackText(bFit, 'b') : stackText(aFit, 'a'), {
      font: isAfter ? bFont : aFont, size: px(isAfter ? bSize : aSize), color: fg, lh: isAfter ? 1.22 : 1.26,
      extra: isAfter ? undefined : { textDecoration: 'line-through' },
    });
    const boxEl = box({
      flexDirection: 'column', justifyContent: 'center', width: px(outerW), height: px(outerH), padding: `${px(g.pad)}px`,
      background: isAfter ? t.accent : t.surface, border: `${borderW}px solid ${isAfter ? t.accent : t.surfaceBorder}`, borderRadius: t.radius,
    }, g.label ? [label, body] : [body]);
    if (!t.hardShadow) return boxEl;
    return box({ position: 'relative', width: px(panelW), height: px(panelH) }, [
      box({ position: 'absolute', top: px(10 * u), left: px(10 * u), width: px(outerW), height: px(outerH), background: '#0E0E0E' }),
      boxEl,
    ]);
  };

  const head = [
    ...(kick ? [kick.el, gap(22 * u)] : []),
    headlineEl(c, stackText(headFit, 'h'), headFit.sizes.h),
    gap(44 * u),
  ];
  const panelsEl = g.side
    ? box({ gap: px(panelGap) }, [panel('before'), panel('after')])
    : box({ flexDirection: 'column', gap: px(panelGap) }, [panel('before'), panel('after')]);
  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'flex-start' }, [...head, panelsEl]));
}

// ============= STATEMENT =============

function buildStatement(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const blocks: StackBlock[] = [
    {
      id: 'h', font: t.display, text: r.headline, min: t.contentSize[0] * 0.95 * u, max: t.coverSize[1] * 0.95 * u, lh: t.displayLeading,
      tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 8, gap: 44 * u,
    },
  ];
  if (r.body) blocks.push({ id: 'b', font: t.body, text: r.body, min: 34 * u, max: 42 * u, lh: t.bodyLeading, width: cw * 0.9, maxLines: 3, optional: true });
  const kick = r.kicker ? kicker(c, r.kicker) : null;
  const fit = fitStack(blocks, regionH - 120 * u - (kick ? kick.h + 36 * u : 0));
  reportFit(c, fit, { h: 'headline', b: 'body' });
  const lead = kick ? [kick.el, gap(36 * u)] : [shortRule(c), gap(50 * u)];
  const children: SatoriElement[] = [...lead, headlineEl(c, stackText(fit, 'h'), fit.sizes.h)];
  const body = stackText(fit, 'b');
  if (body) children.push(gap(44 * u), text(body, { font: t.body, size: fit.sizes.b, color: t.muted, lh: t.bodyLeading }));
  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'center' }, children));
}

// ============= CTA =============

function buildCta(c: Ctx): SatoriElement {
  const { t, r, u, cw, regionH } = c;
  const compact = c.wide;
  const idBlock = identity(c, compact ? 'sm' : 'lg');
  const idH = idBlock ? (compact ? 64 + 30 : 104 + 44) * u : 0;
  const groupGap = 30 * u; // the least air between the headline group, the button group and the identity

  // the "recap" label above the headline: one line
  const recapSize = (compact ? 26 : 29) * u;
  const recap = r.kicker ? fitLine({ ...t.label, weight: 700 }, r.kicker, recapSize, 22 * u, cw, t.labelTracking, true) : null;
  if (recap?.clamped) c.warn('too much text: the label was cut to one line');
  const recapGap = (compact ? 22 : 32) * u;
  const recapH = recap ? px(recap.size) * 1.1 + recapGap : 0;

  // the button: its label is one line, shrunk then cut
  const btnSize = (compact ? 38 : 44) * u;
  const btnPad = (compact ? 22 : 28) * u;
  const btnFont: FontRef = { family: t.body.family, weight: 800 };
  const btnBorder = t.hardShadow ? 10 * u : 0;
  const btnLabel = fitLine(btnFont, r.button, btnSize, btnSize * 0.7, cw - btnPad * 3.2 - 18 * u - btnSize * 1.05 - btnBorder, -0.01);
  if (btnLabel.clamped) c.warn('too much text: the button label was cut to one line');
  const btnH = btnSize * 1.1 + btnPad * 2 + btnBorder;
  const saveOk = !compact && !/save/i.test(r.button);

  // keyword chip: as big as the width and the slide allow, down to `kwMin`
  const chipFor = (kwMin: number) => {
    if (!r.keyword) return null;
    const wide = (s: number, w: string) => textWidth(t.display, t.displayUpper ? w.toUpperCase() : w, s, t.displayTracking) + s * 0.9;
    let size = (compact ? 96 : 138) * u;
    while (size > kwMin && wide(size, r.keyword) > cw) size -= 4 * u;
    let word = r.keyword;
    let cut = false;
    if (wide(size, word) > cw) {
      const f = fitLine(t.display, word, size, size, cw - size * 0.9, t.displayTracking, t.displayUpper);
      word = f.text;
      cut = f.clamped;
    }
    return { size, word, cut, h: size * t.displayLeading + size * 0.24 + (t.highlight === 'tape' ? 16 * u : 0) };
  };
  // arrangements: everything, then no "save" reminder, then a smaller chip
  const plans = [
    { save: saveOk, kwMin: 58 * u },
    { save: false, kwMin: 58 * u },
    { save: false, kwMin: 40 * u },
  ].map((cfg) => {
    const chip = chipFor(cfg.kwMin);
    const chipGap = chip ? (compact ? 22 : 30) * u : 0;
    const fixed = recapH + groupGap + (chip ? chip.h + chipGap : 0) + btnH + (cfg.save ? 71 * u : 0) + groupGap + idH;
    return { ...cfg, chip, chipGap, fixed };
  });

  const reasonGap = (compact ? 22 : 26) * u;
  const stackBlocks = (optional: boolean): StackBlock[] => [
    {
      id: 'h', font: t.display, text: r.headline, min: (compact ? 60 : 76) * u, max: Math.min(t.coverSize[1] * 0.72, compact ? 104 : 136) * u, lh: t.displayLeading,
      tracking: t.displayTracking, upper: t.displayUpper, width: cw, ...hl(c), maxLines: 4, gap: 0,
    },
    ...(r.reason
      ? [{ id: 'r', font: t.body, text: r.reason, min: 32 * u, max: (compact ? 38 : 46) * u, lh: t.bodyLeading, width: cw, maxLines: 2, gap: reasonGap, optional } as StackBlock]
      : []),
    tail(c),
  ];
  // the "save" reminder and a big chip give way before any of the person's words do
  const steps: Array<{ optional: boolean; stage: 1 | 2 | 3 }> = [
    { optional: false, stage: 1 }, { optional: true, stage: 1 }, { optional: true, stage: 2 }, { optional: true, stage: 3 },
  ];
  let picked: { p: (typeof plans)[number]; fit: StackResult } | null = null;
  for (const s of steps) {
    for (const p of s.stage === 3 ? [plans[plans.length - 1]] : plans) {
      const fit = fitStack(stackBlocks(s.optional), regionH - p.fixed, s.stage);
      if (fit.fits) { picked = { p, fit }; break; }
    }
    if (picked) break;
  }
  if (!picked) {
    const p = plans[plans.length - 1];
    picked = { p, fit: fitStack(stackBlocks(true), regionH - p.fixed, 3) };
  }
  const { p, fit } = picked;
  reportFit(c, fit, { h: 'headline', r: 'reason' });
  if (saveOk && !p.save) c.warn('too much text: dropped the "save" reminder');
  if (p.chip?.cut) c.warn('too much text: the keyword was cut with an ellipsis');

  const top: SatoriElement[] = [];
  if (recap) top.push(labelText(c, recap.text, px(recap.size) / u, t.muted, 700), gap(recapGap));
  top.push(headlineEl(c, stackText(fit, 'h'), fit.sizes.h));

  const mid: SatoriElement[] = [];
  if (p.chip) {
    const kw = p.chip;
    const chip = box(
      { alignSelf: 'flex-start', padding: `${px(kw.size * 0.1)}px ${px(kw.size * 0.3)}px`, background: t.accent, borderRadius: t.radius > 8 ? px(kw.size * 0.2) : 0, ...(t.highlight === 'tape' ? { transform: 'rotate(-1.4deg)' } : {}) },
      text(kw.word, { font: t.display, size: px(kw.size), color: t.onAccent, lh: t.displayLeading, tracking: t.displayTracking, upper: t.displayUpper }),
    );
    mid.push(chip, gap(p.chipGap));
  }
  const reason = stackText(fit, 'r');
  if (reason) mid.push(text(reason, { font: t.body, size: fit.sizes.r, color: t.muted, lh: t.bodyLeading }), gap(reasonGap));

  const btn = box(
    { alignSelf: 'flex-start', alignItems: 'center', gap: px(18 * u), padding: `${px(btnPad)}px ${px(btnPad * 1.6)}px`, background: t.accent, borderRadius: t.radius > 10 ? 999 : t.radius, ...(t.hardShadow ? { border: `${px(5 * u)}px solid #0E0E0E` } : {}) },
    [
      text(btnLabel.text, { font: btnFont, size: px(btnLabel.size), color: t.onAccent, lh: 1.1, tracking: -0.01 }),
      icon('arrow', px(btnSize * 1.05), t.onAccent, 3),
    ],
  );
  mid.push(btn);
  if (p.save) {
    mid.push(box({ alignItems: 'center', gap: px(14 * u), marginTop: px(34 * u) }, [
      icon('bookmark', px(34 * u), t.muted, 2.4),
      text('Save this for later', { font: { family: 'Inter', weight: 500 }, size: px(31 * u), color: t.muted, lh: 1.2 }),
    ]));
  }

  const bottom = idBlock
    ? box({ flexDirection: 'column', borderTop: `${px(2 * u)}px solid ${t.rule}`, paddingTop: px((compact ? 24 : 38) * u) }, idBlock)
    : box({});

  return frame(c, box({ flex: 1, flexDirection: 'column', justifyContent: 'space-between' }, [
    box({ flexDirection: 'column', marginBottom: px(groupGap) }, top),
    box({ flexDirection: 'column', marginBottom: px(groupGap) }, mid),
    bottom,
  ]), { identity: false });
}

// ============= ENTRY =============

export function buildSlideElement(slide: SlideContent, kind: 'cover' | 'content' | 'cta', t: Tokens, total: number, opts: RenderOptions): SatoriElement {
  const r = resolveSlide(slide, kind, opts.authorHandle, (m) => opts.onWarn?.(`slide ${slide.slide_number}: ${m}`));
  // Point slides draw their beat number as the big numeral. Every other value
  // layout carries it as the kicker, so a deck never jumps from nothing to "02".
  if (kind === 'content' && r.layout !== 'point' && !r.kicker) {
    r.kicker = String(Math.max(1, slide.slide_number - 1)).padStart(2, '0');
  }
  const c = makeCtx(slide, r, t, total, opts);
  if (kind === 'cover') return buildCoverLayout(c);
  if (kind === 'cta') return buildCta(c);
  switch (r.layout) {
    case 'list': return buildList(c);
    case 'stat': return buildStat(c);
    case 'compare': return buildCompare(c);
    case 'statement': return buildStatement(c);
    default: return buildPoint(c);
  }
}

