/**
 * Infographic spec: the JSON one infographic is drawn from.
 *
 * Source of truth for three runtimes. The others are generated copies
 * (node scripts/generate-carousel-ports.mjs):
 *   - edge: the infographic_content stage parses the model's answer with normalizeSpec
 *   - worker (workers/carousel-renderer/src/infographic/spec.ts): normalizes again before
 *     drawing, so a hand-edited spec can never break a render
 *   - frontend (src/lib/infographic-spec.ts): the Review editor
 *
 * Text limits are what the content prompt asks for. The normalizer only cuts text that runs
 * past twice its limit; the renderer fits everything else to the page.
 *
 * Pure TypeScript with no imports, so every runtime can take the file as is.
 */

// ============= TYPES =============

export type InfographicLayout = 'pyramid' | 'three_column' | 'reference_sheet';
export const INFOGRAPHIC_LAYOUTS: InfographicLayout[] = ['pyramid', 'three_column', 'reference_sheet'];

export interface Takeaway {
  label: string;
  text: string;
}

interface Base {
  kicker: string;
  headline: string;
  /** consecutive words of the headline drawn in the accent color */
  highlight: string;
  sub: string;
  takeaway: Takeaway;
}

export interface Metric {
  value: string;
  label: string;
}

export interface PyramidLayer {
  name: string;
  line: string;
  chips: string[];
  metric: Metric | null;
}

export interface Callout {
  title: string;
  body: string;
}

export interface PyramidData {
  /** the result the layers hold up */
  top: { label: string; name: string; line: string };
  /** top of the pyramid first; the last one is the base (layer 1) */
  layers: PyramidLayer[];
  callouts: {
    /** points at the top tier */
    left: Callout | null;
    /** points at `layer`, counted from the base (1 = base) */
    right: (Callout & { layer: number }) | null;
  };
}

export interface Column {
  title: string;
  sub: string;
  /** 1-3 bars lit on a small meter, or null for none */
  level: number | null;
  tag: string | null;
}

export interface Stat {
  value: string;
  label: string;
}

export type Row =
  | { label: string; kind: 'text' | 'quote' | 'action'; cells: string[] }
  | { label: string; kind: 'stat'; cells: Stat[] };

export interface ThreeColumnData {
  columns: Column[];
  highlight_column: number;
  rows: Row[];
}

export type CardKind = 'checklist' | 'avoid' | 'table' | 'chart' | 'stats' | 'steps' | 'examples' | 'formula';

interface CardBase {
  title: string;
  meta: string | null;
  /** drawn on the accent color; at most one card per sheet */
  emphasis: boolean;
}

export interface Bar {
  label: string;
  /** 0 to 1, relative to the tallest bar */
  value: number;
  hot: boolean;
}

export interface Step {
  tag: string;
  title: string;
  body: string;
  chip: string | null;
}

export type Card = CardBase &
  (
    | { kind: 'checklist' | 'avoid'; items: string[] }
    | { kind: 'table'; rows: Array<[string, string]> }
    | { kind: 'chart'; bars: Bar[]; caption: string; note: string | null }
    | { kind: 'stats'; stats: Stat[] }
    | { kind: 'steps'; steps: Step[] }
    | { kind: 'examples'; lines: Array<{ text: string; note: string }> }
    | { kind: 'formula'; parts: string[]; example: string | null }
  );

export interface ReferenceSheetData {
  /** most important first: when the page is full, cards are dropped from the end */
  cards: Card[];
}

export type InfographicSpec =
  | (Base & { layout: 'pyramid'; data: PyramidData })
  | (Base & { layout: 'three_column'; data: ThreeColumnData })
  | (Base & { layout: 'reference_sheet'; data: ReferenceSheetData });

// ============= LIMITS =============

/** Word limits the content prompt asks for (characters where the key ends in Chars). */
export const LIMITS = {
  kicker: 6,
  headline: 10,
  highlight: 4,
  sub: 20,
  takeawayLabel: 2,
  takeawayText: 18,
  pyramid: { topLabel: 3, topName: 3, topLine: 7, name: 2, line: 9, chip: 4, chips: 3, metricValueChars: 6, metricLabel: 4, calloutTitle: 4, calloutBody: 8 },
  threeColumn: { title: 3, sub: 6, tag: 3, rowLabel: 2, text: 10, quote: 18, action: 3, statValueChars: 6, statLabel: 5 },
  card: {
    title: 4, meta: 4, item: 7, tableLabel: 5, tableValue: 3, barLabelChars: 4, caption: 8, note: 10,
    statValueChars: 6, statLabel: 4, stepTagChars: 7, stepTitle: 3, stepBody: 7, stepChip: 3,
    exampleText: 5, exampleNote: 4, formulaPart: 4, formulaExample: 25,
  },
};

/** [min, max] counts. Below min is a contract error (the stage retries); above max is cut. */
export const COUNTS = {
  pyramidLayers: [3, 5],
  chips: [0, 3],
  threeColumnRows: [3, 7],
  cards: [4, 9],
  items: [2, 6],
  tableRows: [2, 6],
  bars: [3, 7],
  stats: [2, 4],
  steps: [3, 5],
  exampleLines: [2, 5],
  formulaParts: [2, 4],
} as const;

/** Grid width of each card kind: a reference sheet row holds 3 units. */
export const CARD_UNITS: Record<CardKind, 1 | 2> = {
  checklist: 1, avoid: 1, table: 1, chart: 1, stats: 1, steps: 2, examples: 2, formula: 2,
};

// ============= NORMALIZING =============

export interface NormalizeResult {
  /** best-effort spec; null only when there is no usable layout or headline */
  spec: InfographicSpec | null;
  /** contract violations: the content stage retries on these */
  errors: string[];
  /** things that were repaired or cut */
  warnings: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Plain text: no markdown, one line, single spaces. */
function clean(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return '';
  return v
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quote text without the quote marks around it (the renderer adds its own). */
function unquote(s: string): string {
  return s.replace(/^["'“‘]+/, '').replace(/["'”’]+$/, '').trim();
}

const wordCount = (s: string) => (s ? s.split(/\s+/).length : 0);

/** Pull the JSON object out of a model answer (code fences and chatter around it are fine). */
export function parseSpecJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Turn whatever the model (or an editor) produced into a spec the renderer can trust.
 * `pinned` is the layout the blueprint asked for: a different one is a contract error.
 */
export function normalizeSpec(raw: unknown, pinned?: InfographicLayout | null): NormalizeResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = parseSpecJson(raw);
  if (!isObj(o)) return { spec: null, errors: ['the answer is not a JSON object'], warnings };

  const text = (v: unknown, limit: number, what: string, chars = false): string => {
    const s = clean(v);
    const size = chars ? s.length : wordCount(s);
    if (size > limit * 2) {
      warnings.push(`${what} was cut (${size} ${chars ? 'characters' : 'words'}, limit ${limit})`);
      const cut = chars ? s.slice(0, limit * 2).trim() : s.split(/\s+/).slice(0, limit * 2).join(' ');
      return `${cut.replace(/[\s,;:.-]+$/, '')}...`;
    }
    return s;
  };
  const cap = <T>(items: T[], [min, max]: readonly [number, number], what: string, contract = true): T[] => {
    if (items.length < min) (contract ? errors : warnings).push(`${what}: ${items.length}, needs at least ${min}`);
    if (items.length > max) {
      warnings.push(`${what}: kept the first ${max} of ${items.length}`);
      return items.slice(0, max);
    }
    return items;
  };

  const layout = clean(o.layout).toLowerCase().replace(/[\s-]+/g, '_') as InfographicLayout;
  if (!INFOGRAPHIC_LAYOUTS.includes(layout)) return { spec: null, errors: [`unknown layout "${clean(o.layout)}"`], warnings };
  if (pinned && layout !== pinned) errors.push(`layout must be "${pinned}", got "${layout}"`);

  const headline = text(o.headline, LIMITS.headline, 'headline');
  if (!headline) return { spec: null, errors: ['headline is empty'], warnings };

  let highlight = text(o.highlight, LIMITS.highlight, 'highlight');
  if (highlight && !findRun(headline, highlight)) {
    warnings.push(`highlight "${highlight}" is not in the headline`);
    highlight = '';
  }
  if (!highlight) {
    const words = headline.split(/\s+/);
    highlight = words.slice(-Math.min(3, Math.max(1, Math.ceil(words.length / 3)))).join(' ');
  }

  const t = isObj(o.takeaway) ? o.takeaway : {};
  const base: Base = {
    kicker: text(o.kicker, LIMITS.kicker, 'kicker'),
    headline,
    highlight,
    sub: text(o.sub, LIMITS.sub, 'sub'),
    takeaway: { label: text(t.label, LIMITS.takeawayLabel, 'takeaway label') || 'The rule', text: text(t.text, LIMITS.takeawayText, 'takeaway') },
  };
  if (!base.takeaway.text) errors.push('takeaway.text is empty');

  const data = isObj(o.data) ? o.data : {};

  if (layout === 'pyramid') {
    const L = LIMITS.pyramid;
    const top = isObj(data.top) ? data.top : {};
    const layers = cap(
      arr(data.layers).filter(isObj).map((l, i) => {
        const m = isObj(l.metric) ? l.metric : null;
        const metric = m && clean(m.value) ? { value: text(m.value, L.metricValueChars, `layer ${i + 1} metric`, true), label: text(m.label, L.metricLabel, `layer ${i + 1} metric label`) } : null;
        return {
          name: text(l.name, L.name, `layer ${i + 1} name`),
          line: text(l.line, L.line, `layer ${i + 1} line`),
          chips: cap(arr(l.chips).map((c) => text(c, L.chip, `layer ${i + 1} chip`)).filter(Boolean), COUNTS.chips, `layer ${i + 1} chips`, false),
          metric,
        };
      }).filter((l) => l.name),
      COUNTS.pyramidLayers,
      'pyramid layers',
    );
    const co = isObj(data.callouts) ? data.callouts : {};
    const callout = (c: unknown, side: string): Callout | null => {
      if (!isObj(c)) return null;
      const title = text(c.title, L.calloutTitle, `${side} callout title`);
      const body = text(c.body, L.calloutBody, `${side} callout`);
      return title || body ? { title, body } : null;
    };
    const right = callout(co.right, 'right');
    const rightLayer = Math.round(Number(isObj(co.right) ? co.right.layer : NaN));
    const spec: InfographicSpec = {
      ...base,
      layout,
      data: {
        top: { label: text(top.label, L.topLabel, 'top label'), name: text(top.name, L.topName, 'top name'), line: text(top.line, L.topLine, 'top line') },
        layers,
        callouts: {
          left: callout(co.left, 'left'),
          right: right ? { ...right, layer: Number.isFinite(rightLayer) ? Math.min(Math.max(rightLayer, 1), Math.max(1, layers.length)) : 2 } : null,
        },
      },
    };
    if (!spec.data.top.name) errors.push('pyramid top.name is empty');
    return { spec, errors, warnings };
  }

  if (layout === 'three_column') {
    const L = LIMITS.threeColumn;
    const columns = arr(data.columns).filter(isObj).map((c, i) => {
      const level = Math.round(Number(c.level));
      return {
        title: text(c.title, L.title, `column ${i + 1} title`),
        sub: text(c.sub, L.sub, `column ${i + 1} sub`),
        level: level >= 1 && level <= 3 ? level : null,
        tag: text(c.tag, L.tag, `column ${i + 1} tag`) || null,
      };
    });
    if (columns.length !== 3) errors.push(`three_column needs exactly 3 columns, got ${columns.length}`);
    const cols = columns.slice(0, 3);
    while (cols.length < 3) cols.push({ title: '', sub: '', level: null, tag: null });
    let hot = Math.round(Number(data.highlight_column));
    if (!(hot >= 0 && hot <= 2)) {
      const tagged = cols.findIndex((c) => c.tag);
      hot = tagged >= 0 ? tagged : 2;
    }
    const rows: Row[] = cap(
      arr(data.rows).filter(isObj).map((r, i): Row | null => {
        const kind = clean(r.kind).toLowerCase();
        const label = text(r.label, L.rowLabel, `row ${i + 1} label`);
        const cells = arr(r.cells);
        if (cells.length !== 3) {
          if (cells.length < 2) {
            errors.push(`row ${i + 1} has ${cells.length} cells, needs 3`);
            return null;
          }
          warnings.push(`row ${i + 1} has ${cells.length} cells; padded to 3`);
        }
        const three = [0, 1, 2].map((j) => cells[j]);
        if (kind === 'stat') {
          return {
            label,
            kind: 'stat',
            cells: three.map((c) => (isObj(c)
              ? { value: text(c.value, L.statValueChars, `row ${i + 1} stat`, true), label: text(c.label, L.statLabel, `row ${i + 1} stat label`) }
              : { value: text(c, L.statValueChars, `row ${i + 1} stat`, true), label: '' })),
          };
        }
        const k = kind === 'quote' || kind === 'action' ? kind : 'text';
        const limit = k === 'quote' ? L.quote : k === 'action' ? L.action : L.text;
        return { label, kind: k, cells: three.map((c) => (k === 'quote' ? unquote(text(c, limit, `row ${i + 1} quote`)) : text(c, limit, `row ${i + 1} cell`))) };
      }).filter((r): r is Row => !!r),
      COUNTS.threeColumnRows,
      'three_column rows',
    );
    return { spec: { ...base, layout, data: { columns: cols, highlight_column: hot, rows } }, errors, warnings };
  }

  // reference_sheet
  const C = LIMITS.card;
  let emphasisUsed = false;
  const cards = cap(
    arr(data.cards).filter(isObj).map((c, i): Card | null => {
      const kind = clean(c.kind).toLowerCase() as CardKind;
      const what = `card ${i + 1} (${kind || 'no kind'})`;
      const emphasis = c.emphasis === true && !emphasisUsed;
      if (emphasis) emphasisUsed = true;
      const head = { title: text(c.title, C.title, `${what} title`), meta: text(c.meta, C.meta, `${what} meta`) || null, emphasis };
      const list = (v: unknown, limit: number, counts: readonly [number, number], label: string) =>
        cap(arr(v).map((x) => text(x, limit, `${what} ${label}`)).filter(Boolean), counts, `${what} ${label}`, false);
      switch (kind) {
        case 'checklist':
        case 'avoid':
          return { ...head, kind, items: list(c.items, C.item, COUNTS.items, 'items') };
        case 'table':
          return {
            ...head,
            kind,
            rows: cap(
              arr(c.rows).map((r): [string, string] => (Array.isArray(r)
                ? [text(r[0], C.tableLabel, `${what} label`), text(r[1], C.tableValue, `${what} value`)]
                : isObj(r) ? [text(r.label, C.tableLabel, `${what} label`), text(r.value, C.tableValue, `${what} value`)] : ['', '']))
                .filter(([a, b]) => a || b),
              COUNTS.tableRows, `${what} rows`, false,
            ),
          };
        case 'chart': {
          const bars = arr(c.bars).filter(isObj).map((b) => ({
            label: text(b.label, C.barLabelChars, `${what} bar label`, true),
            value: Math.max(0, Number(String(b.value ?? '').replace(/[^\d.]/g, '')) || 0),
            hot: b.hot === true,
          }));
          const max = Math.max(0, ...bars.map((b) => b.value));
          return {
            ...head,
            kind,
            bars: cap(bars.map((b) => ({ ...b, value: max > 0 ? b.value / max : 0 })), COUNTS.bars, `${what} bars`, false),
            caption: text(c.caption, C.caption, `${what} caption`),
            note: text(c.note, C.note, `${what} note`) || null,
          };
        }
        case 'stats':
          return {
            ...head,
            kind,
            stats: cap(arr(c.stats).filter(isObj).map((s) => ({ value: text(s.value, C.statValueChars, `${what} value`, true), label: text(s.label, C.statLabel, `${what} label`) })).filter((s) => s.value), COUNTS.stats, `${what} stats`, false),
          };
        case 'steps':
          return {
            ...head,
            kind,
            steps: cap(arr(c.steps).filter(isObj).map((s) => ({
              tag: text(s.tag, C.stepTagChars, `${what} tag`, true),
              title: text(s.title, C.stepTitle, `${what} step title`),
              body: text(s.body, C.stepBody, `${what} step`),
              chip: text(s.chip, C.stepChip, `${what} chip`) || null,
            })).filter((s) => s.title || s.body), COUNTS.steps, `${what} steps`, false),
          };
        case 'examples':
          return {
            ...head,
            kind,
            lines: cap(arr(c.lines).filter(isObj).map((l) => ({ text: unquote(text(l.text, C.exampleText, `${what} example`)), note: text(l.note, C.exampleNote, `${what} note`) })).filter((l) => l.text), COUNTS.exampleLines, `${what} lines`, false),
          };
        case 'formula':
          return {
            ...head,
            kind,
            parts: list(c.parts, C.formulaPart, COUNTS.formulaParts, 'parts'),
            example: unquote(text(c.example, C.formulaExample, `${what} example`)) || null,
          };
        default:
          warnings.push(`${what}: unknown card kind, dropped`);
          return null;
      }
    }).filter((c): c is Card => !!c && cardSize(c) > 0),
    COUNTS.cards,
    'reference_sheet cards',
  );
  return { spec: { ...base, layout: 'reference_sheet', data: { cards } }, errors, warnings };
}

/** Number of drawable entries in a card (0 = nothing to draw). */
export function cardSize(c: Card): number {
  switch (c.kind) {
    case 'checklist':
    case 'avoid':
      return c.items.length;
    case 'table':
      return c.rows.length;
    case 'chart':
      return c.bars.length;
    case 'stats':
      return c.stats.length;
    case 'steps':
      return c.steps.length;
    case 'examples':
      return c.lines.length;
    case 'formula':
      return c.parts.length + (c.example ? 1 : 0);
  }
}

/** Index of `run` as consecutive whole words of `headline` (case and punctuation ignored), or null. */
export function findRun(headline: string, run: string): { start: number; length: number } | null {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}%$]/gu, '');
  const words = headline.split(/\s+/).map(norm);
  const want = run.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return null;
  for (let i = 0; i + want.length <= words.length; i++) {
    if (want.every((w, j) => words[i + j] === w)) return { start: i, length: want.length };
  }
  return null;
}

/** True when the renderer can draw the spec, even if it broke the prompt's contract. */
export function isRenderable(spec: InfographicSpec): boolean {
  switch (spec.layout) {
    case 'pyramid':
      return spec.data.layers.length >= 2 && !!spec.data.top.name;
    case 'three_column':
      return spec.data.rows.length >= 2 && spec.data.columns.filter((c) => c.title).length === 3;
    case 'reference_sheet':
      return spec.data.cards.length >= 1;
  }
}

/**
 * Last resort when the model can't produce the asked layout: the same content as a
 * reference sheet, which can hold any list-shaped content.
 */
export function fallbackToReferenceSheet(spec: InfographicSpec): InfographicSpec {
  const base = { kicker: spec.kicker, headline: spec.headline, highlight: spec.highlight, sub: spec.sub, takeaway: spec.takeaway };
  if (spec.layout === 'reference_sheet') return spec;
  const cards: Card[] = [];
  if (spec.layout === 'pyramid') {
    const { layers, top } = spec.data;
    cards.push({
      kind: 'steps', title: 'The layers', meta: 'from the base up', emphasis: false,
      steps: layers.slice().reverse().slice(0, 5).map((l, i) => ({ tag: `LAYER ${i + 1}`, title: l.name, body: l.line, chip: l.metric ? `${l.metric.value} ${l.metric.label}`.trim() : null })),
    });
    if (top.name) cards.push({ kind: 'stats', title: top.label || 'The result', meta: null, emphasis: true, stats: [{ value: top.name, label: top.line }] });
    const chips = layers.flatMap((l) => l.chips).slice(0, 6);
    if (chips.length >= 2) cards.push({ kind: 'checklist', title: 'Check each layer', meta: null, emphasis: false, items: chips });
  } else {
    const { columns, rows } = spec.data;
    columns.forEach((col, j) => {
      cards.push({
        kind: 'table', title: col.title || `Option ${j + 1}`, meta: col.sub || null, emphasis: j === spec.data.highlight_column,
        rows: rows.map((r): [string, string] => [r.label, r.kind === 'stat' ? r.cells[j].value : r.cells[j]]).filter(([, v]) => v).slice(0, 6),
      });
    });
  }
  return { ...base, layout: 'reference_sheet', data: { cards } };
}

/** Every string a spec can draw, in reading order. */
export function specText(spec: InfographicSpec): string[] {
  const out: string[] = [spec.kicker, spec.headline, spec.sub, spec.takeaway.label, spec.takeaway.text];
  const add = (...s: Array<string | null | undefined>) => s.forEach((x) => x && out.push(x));
  if (spec.layout === 'pyramid') {
    const d = spec.data;
    add(d.top.label, d.top.name, d.top.line);
    d.layers.forEach((l) => add(l.name, l.line, ...l.chips, l.metric?.value, l.metric?.label));
    add(d.callouts.left?.title, d.callouts.left?.body, d.callouts.right?.title, d.callouts.right?.body);
  } else if (spec.layout === 'three_column') {
    spec.data.columns.forEach((c) => add(c.title, c.sub, c.tag));
    spec.data.rows.forEach((r) => {
      add(r.label);
      if (r.kind === 'stat') r.cells.forEach((c) => add(c.value, c.label));
      else add(...r.cells);
    });
  } else {
    for (const c of spec.data.cards) {
      add(c.title, c.meta);
      switch (c.kind) {
        case 'checklist': case 'avoid': add(...c.items); break;
        case 'table': c.rows.forEach(([a, b]) => add(a, b)); break;
        case 'chart': add(...c.bars.map((b) => b.label), c.caption, c.note); break;
        case 'stats': c.stats.forEach((s) => add(s.value, s.label)); break;
        case 'steps': c.steps.forEach((s) => add(s.tag, s.title, s.body, s.chip)); break;
        case 'examples': c.lines.forEach((l) => add(l.text, l.note)); break;
        case 'formula': add(...c.parts, c.example); break;
      }
    }
  }
  return out.filter(Boolean);
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const numKey = (n: string) => n.replace(/,/g, '');

/**
 * Numbers on the infographic that the post never mentions. The image must not say what
 * the post doesn't, so the content stage treats any as a contract error.
 */
export function numbersNotInPost(spec: InfographicSpec, post: string): string[] {
  const inPost = new Set((post.match(NUMBER) ?? []).map(numKey));
  const missing = new Set<string>();
  for (const s of specText(spec)) {
    for (const n of s.match(NUMBER) ?? []) if (!inPost.has(numKey(n))) missing.add(n);
  }
  return [...missing];
}
