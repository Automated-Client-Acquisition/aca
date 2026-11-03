/**
 * Infographic layouts: pyramid, three-column, reference sheet.
 *
 * Each `prepareX(spec, budget, allowDrops, env)` measures the layout into the body height
 * it is given. It first scales every size between a floor and a ceiling (largest that
 * fits). When even the floor overflows and `allowDrops` is set, content gives way in a
 * fixed order, and every step is reported through `env.warn`:
 *   pyramid       chips go first (they only show where a tier is wide and tall enough),
 *                 then layer lines are cut to one line; callouts are dropped when their
 *                 corner has no room
 *   three-column  the action row, then rows from the end (down to 3), then cell text
 *   sheet         lists to 3 items, then tighter text, then cards from the end (down to 3)
 * The returned `draw` uses exactly the measured numbers.
 */

import { type SatoriElement, box, darken, fitLine, lighten, mix } from '../carousel-kit.js';
import { type Card, type CardKind, CARD_UNITS, type InfographicSpec, type PyramidLayer } from './spec.js';
import { bestScale, clampLines, lerp, width, wrapRows } from './infographic-fit.js';
import {
  type Env,
  type Ink,
  type Prepared,
  type Tokens,
  CW,
  F,
  T,
  TAB_H,
  TAB_SIZE,
  accentFill,
  badge,
  chip,
  chipH,
  clipped,
  inkFor,
  mark,
  meter,
  pillButton,
  quoted,
  tab,
  tx,
} from './infographic-kit.js';

export interface Laid extends Prepared {
  fits: boolean;
}

type PyramidSpec = Extract<InfographicSpec, { layout: 'pyramid' }>;
type ThreeColumnSpec = Extract<InfographicSpec, { layout: 'three_column' }>;
type SheetSpec = Extract<InfographicSpec, { layout: 'reference_sheet' }>;

// ============= PYRAMID =============

const TIER_GAP = 8;
const TOP_W = 290;
const TIER_INSET = 26;
const TIER_MAX = 176;
const TIER_MIN = 92;
const METRIC_W = 118;
const CALLOUT_W = 236;
const CALLOUT_TEXT_W = CALLOUT_W - 30;

function trapezoid(id: string, w: number, h: number, topW: number, bottomW: number, fill: string, shade: string, edge: string): SatoriElement {
  const tl = (w - topW) / 2;
  const bl = (w - bottomW) / 2;
  return {
    type: 'svg',
    props: {
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      xmlns: 'http://www.w3.org/2000/svg',
      style: { position: 'absolute', top: 0, left: 0 },
      children: [
        {
          type: 'defs',
          props: {
            children: {
              type: 'linearGradient',
              props: {
                id, x1: '0', y1: '0', x2: '0', y2: '1',
                children: [
                  { type: 'stop', props: { offset: '0%', stopColor: fill } },
                  { type: 'stop', props: { offset: '100%', stopColor: shade } },
                ],
              },
            },
          },
        },
        { type: 'polygon', props: { points: `${tl},0 ${w - tl},0 ${w - bl},${h} ${bl},${h}`, fill: `url(#${id})`, stroke: edge, strokeWidth: 1.5 } },
        { type: 'line', props: { x1: tl + 3, y1: 1.5, x2: w - tl - 3, y2: 1.5, stroke: lighten(fill, 0.3), strokeWidth: 2 } },
      ],
    },
  };
}

/** Dashed connector with a dot at the start and an arrowhead at the end (body coordinates). */
function connector(color: string, w: number, h: number, d: string, start: [number, number], end: [number, number], dir: 'left' | 'right'): SatoriElement {
  const [ex, ey] = end;
  const back = dir === 'right' ? -9 : 9;
  return {
    type: 'svg',
    props: {
      width: w,
      height: h,
      viewBox: `0 0 ${w} ${h}`,
      xmlns: 'http://www.w3.org/2000/svg',
      style: { position: 'absolute', top: 0, left: 0 },
      children: [
        { type: 'path', props: { d, fill: 'none', stroke: color, strokeWidth: 2, strokeDasharray: '5 6', strokeLinecap: 'round' } },
        { type: 'circle', props: { cx: start[0], cy: start[1], r: 4, fill: color } },
        { type: 'path', props: { d: `M${ex + back} ${ey - 7} L${ex} ${ey} L${ex + back} ${ey + 7}`, fill: 'none', stroke: color, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } },
      ],
    },
  };
}

interface TierContent {
  h: number;
  draw: (k: Ink, fill: string) => SatoriElement;
}

/** `z` grows the main text in tall tiers (few layers on a tall page). */
function prepareTop(top: PyramidSpec['data']['top'], inner: number, room: number, z: number): TierContent {
  const ls = Math.round(13 * z * 2) / 2;
  let label = tx(top.label) ? fitLine(F.bold, tx(top.label), 11, 10, inner, 0.14, true) : null;
  const name = fitLine(F.black, tx(top.name), Math.round(25 * z), 18, inner, -0.03);
  let line = clampLines(F.medium, tx(top.line), ls, inner, 2);
  const height = () => (label ? label.size * 1.1 + 4 : 0) + name.size * 1.1 + (line.text ? 4 + line.lines * ls * 1.25 : 0);
  if (height() > room) label = null;
  if (height() > room) line = clampLines(F.medium, tx(top.line), ls, inner, 1);
  return {
    h: height(),
    draw: (k) => box({ flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }, [
      ...(label ? [T(label.text, F.bold, label.size, k.muted, { upper: true, tracking: 0.14, lh: 1.1, style: { flexShrink: 0 } })] : []),
      T(name.text, F.black, name.size, k.fg, { lh: 1.1, tracking: -0.03, align: 'center', style: { flexShrink: 0 } }),
      ...(line.text ? [T(line.text, F.medium, ls, k.muted, { lh: 1.25, align: 'center' })] : []),
    ]),
  };
}

function prepareLayer(layer: PyramidLayer, n: number, inner: number, room: number, z: number, env: Env): TierContent {
  const m = layer.metric;
  const value = m ? fitLine(F.black, tx(m.value), Math.round(28 * z), 18, METRIC_W - 15, -0.04) : null;
  const mLabel = m ? clampLines(F.medium, tx(m.label), 12, METRIC_W - 15, 2) : null;
  const metricH = value ? value.size + 3 + (mLabel!.lines * 12 * 1.2) : 0;
  const leftW = inner - (m ? METRIC_W + 18 : 0);
  const name = fitLine(F.black, tx(layer.name), Math.round(22 * z), 16, leftW - 38, -0.02);
  const nameH = Math.max(28, name.size * 1.1);

  let lineSize = Math.round(15 * z * 2) / 2;
  let line = clampLines(F.medium, tx(layer.line), lineSize, leftW, 2);
  const chips = layer.chips.map((c) => fitLine(F.bold, tx(c), 12, 11, leftW - 20));
  const chipRows = wrapRows(chips.map((c) => width(F.bold, c.text, c.size) + 20), leftW, 6);
  const chipsH = chipRows * chipH(12) + (chipRows - 1) * 6;
  let showChips = chips.length > 0 && leftW >= 300 && chipRows <= 2;

  const leftH = () => nameH + (line.text ? 6 + line.lines * lineSize * 1.3 : 0) + (showChips ? 10 + chipsH : 0);
  if (Math.max(leftH(), metricH) > room) showChips = false;
  if (Math.max(leftH(), metricH) > room) {
    lineSize = 14;
    line = clampLines(F.medium, tx(layer.line), lineSize, leftW, 1);
    if (line.clamped) env.warn(`pyramid layer "${tx(layer.name)}" line cut`);
  }
  const h = Math.max(leftH(), metricH);

  return {
    h,
    draw: (k, fill) => box({ alignItems: 'center', gap: 18, width: '100%' }, [
      box({ width: leftW, flexDirection: 'column', gap: 6, flexShrink: 0 }, [
        box({ alignItems: 'center', gap: 10, height: nameH }, [badge(k, n, 28), T(name.text, F.black, name.size, k.fg, { lh: 1.1, tracking: -0.02, style: { flexShrink: 0 } })]),
        ...(line.text ? [T(line.text, F.medium, lineSize, k.muted, { lh: 1.3 })] : []),
        ...(showChips
          ? [box({ flexWrap: 'wrap', gap: 6, marginTop: 4 }, chips.map((c) => box(
            { padding: '5px 9px', borderRadius: 7, background: mix(fill, k.fg, 0.1), border: `1px solid ${mix(fill, k.fg, 0.2)}` },
            T(c.text, F.bold, c.size, k.fg, { lh: 1.15, style: { flexShrink: 0 } }),
          )))]
          : []),
      ]),
      ...(value
        ? [box({ flexDirection: 'column', alignItems: 'flex-end', gap: 3, width: METRIC_W, flexShrink: 0, paddingLeft: 14, borderLeft: `1px solid ${mix(fill, k.fg, 0.22)}` }, [
          T(value.text, F.black, value.size, k.fg, { lh: 1, tracking: -0.04, align: 'right', style: { flexShrink: 0 } }),
          T(mLabel!.text, F.medium, 12, k.muted, { lh: 1.2, align: 'right' }),
        ])]
        : []),
    ]),
  };
}

interface CalloutFit {
  title: string;
  titleSize: number;
  body: string;
  h: number;
}

function fitCallout(c: { title: string; body: string }): CalloutFit {
  const title = fitLine(F.xbold, tx(c.title), 12, 10, CALLOUT_TEXT_W, 0.09, true);
  const body = clampLines(F.medium, tx(c.body), 15, CALLOUT_TEXT_W, 2);
  return { title: title.text, titleSize: title.size, body: body.text, h: 28 + (title.text ? title.size * 1.1 + 5 : 0) + body.lines * 15 * 1.3 };
}

function drawCallout(t: Tokens, c: CalloutFit, side: 'left' | 'right', env: Env): SatoriElement {
  const k = inkFor(t, t.surface);
  return box(
    {
      position: 'absolute', top: 6, [side]: 0, width: CALLOUT_W, height: c.h, flexDirection: 'column', gap: 5, padding: '13px 15px',
      borderRadius: 14, background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadow, ...clipped(env),
    },
    [
      ...(c.title ? [T(c.title, F.xbold, c.titleSize, k.hot, { upper: true, tracking: 0.09, lh: 1.1, style: { flexShrink: 0 } })] : []),
      T(c.body, F.medium, 15, k.fg, { lh: 1.3 }),
    ],
  );
}

export function preparePyramid(spec: PyramidSpec, budget: number, _allowDrops: boolean, env: Env): Laid {
  const d = spec.data;
  const L = d.layers.length;
  const n = L + 1;
  const tierH = Math.max(TIER_MIN, Math.min(TIER_MAX, Math.floor((budget - (n - 1) * TIER_GAP) / n)));
  const totalH = n * tierH + (n - 1) * TIER_GAP;
  const widthAt = (y: number) => TOP_W + ((CW - TOP_W) * y) / totalH;
  const y0 = (i: number) => i * (tierH + TIER_GAP);

  const z = Math.min(1.25, Math.max(1, tierH / 150));
  const tiers = Array.from({ length: n }, (_, i) => {
    const wc = widthAt(y0(i) + 14);
    const inner = wc - TIER_INSET * 2;
    const content = i === 0 ? prepareTop(d.top, inner, tierH - 18, z) : prepareLayer(d.layers[i - 1], L - (i - 1), inner, tierH - 20, z, env);
    return { wc, inner, content };
  });

  // callouts sit in the empty corners beside the top; their connectors point at a tier edge
  let left: { fit: CalloutFit; y: number; endX: number } | null = null;
  if (d.callouts.left) {
    const fit = fitCallout(d.callouts.left);
    const y = 6 + fit.h / 2;
    const corner = (CW - widthAt(6 + fit.h)) / 2;
    const endX = (CW - widthAt(y)) / 2 - 12;
    if (corner >= CALLOUT_W + 44 && endX - (CALLOUT_W + 12) >= 24) left = { fit, y, endX };
    else env.warn('left callout dropped: no room beside the top tier');
  }
  let right: { fit: CalloutFit; y: number; x: number; startY: number; endX: number } | null = null;
  if (d.callouts.right) {
    const fit = fitCallout(d.callouts.right);
    const x = CW - 44;
    const startY = 6 + fit.h + 8;
    const asked = Math.min(Math.max(L - d.callouts.right.layer + 1, 1), L);
    let idx = asked;
    const ok = (i: number) => {
      const y = y0(i) + tierH / 2;
      return (CW - widthAt(y)) / 2 - 44 >= 34 && y - 14 > startY;
    };
    while (idx > 1 && !ok(idx)) idx--;
    const corner = (CW - widthAt(6 + fit.h)) / 2;
    if (ok(idx) && corner >= CALLOUT_W + 10) {
      if (idx !== asked) env.warn(`right callout points at layer ${L - idx + 1} instead of ${L - asked + 1}: no room lower down`);
      const y = y0(idx) + tierH / 2;
      right = { fit, y, x, startY, endX: (CW + widthAt(y)) / 2 + 12 };
    } else env.warn('right callout dropped: no room beside the pyramid');
  }

  return {
    height: totalH,
    fits: totalH <= budget,
    draw: (t) => {
      const els: SatoriElement[] = tiers.map(({ wc, inner, content }, i) => {
        const fill = t.ramp[Math.min(i, t.ramp.length - 1)];
        const k = inkFor(t, fill);
        const top = i === 0 ? lighten(fill, 0.1) : lighten(fill, t.dark ? 0.04 : 0.08);
        const bottom = i === 0 ? t.accentDeep : darken(fill, t.dark ? 0.08 : 0.04);
        return box({ position: 'absolute', top: y0(i), left: 0, width: CW, height: tierH }, [
          trapezoid(`tier${i}`, CW, tierH, widthAt(y0(i)), widthAt(y0(i) + tierH), top, bottom, mix(fill, t.fg, 0.14)),
          box(
            { position: 'absolute', top: 0, left: (CW - wc) / 2 + TIER_INSET, width: inner, height: tierH, alignItems: 'center', paddingTop: i === 0 ? 6 : 0, ...clipped(env) },
            content.draw(k, fill),
          ),
        ]);
      });
      const hot = inkFor(t, t.bg).hot;
      if (left) {
        els.push(connector(hot, CW, totalH, `M${CALLOUT_W + 12} ${left.y} H${left.endX}`, [CALLOUT_W + 12, left.y], [left.endX, left.y], 'right'));
        els.push(drawCallout(t, left.fit, 'left', env));
      }
      if (right) {
        const { x, y, startY, endX } = right;
        els.push(connector(hot, CW, totalH, `M${x} ${startY} V${y - 14} Q${x} ${y} ${x - 14} ${y} H${endX}`, [x, startY], [endX, y], 'left'));
        els.push(drawCallout(t, right.fit, 'right', env));
      }
      return box({ position: 'relative', width: CW, height: totalH, flexShrink: 0 }, els);
    },
  };
}

// ============= THREE COLUMN =============

const RAIL_W = 149;
const COL_GAP = 12;
const COL_W = (CW - RAIL_W - 3 * COL_GAP) / 3;
const CELL_PX = 20;
const CELL_W = COL_W - CELL_PX * 2;

/** thin content may grow to this scale (1 = the dense design size) */
const MAX_SCALE = 3;

const colSizes = (s: number) => ({ title: lerp(18, 22, s), text: lerp(14.5, 17, s), quote: lerp(18, 24, s), stat: lerp(30, 46, s), padV: lerp(12, 18, s) });

export function prepareThreeColumn(spec: ThreeColumnSpec, budget: number, allowDrops: boolean, env: Env): Laid {
  const d = spec.data;
  const hotIdx = Math.min(Math.max(d.highlight_column, 0), 2);
  let rows = d.rows.slice();
  let maxText = 99;
  let maxQuote = 99;

  const head = (s: number) => {
    const z = colSizes(s);
    const cols = d.columns.map((c) => {
      const title = clampLines(F.black, tx(c.title), z.title, CELL_W, 2, -0.025);
      const sub = clampLines(F.medium, tx(c.sub), 14, CELL_W, 2);
      const tag = c.tag ? fitLine(F.bold, tx(c.tag), 11, 10, CELL_W - 66 - 10) : null;
      return { title, sub, tag, level: c.level, h: 20 + 24 + 7 + 3 + title.lines * z.title * 1.12 + (sub.text ? 7 + sub.lines * 14 * 1.25 : 0) + 16 };
    });
    return { cols, h: Math.max(...cols.map((c) => c.h)) };
  };

  const rowGeo = (row: (typeof rows)[number], s: number) => {
    const z = colSizes(s);
    const label = clampLines(F.bold, tx(row.label), 12, RAIL_W - 12, 2, 0.1, true);
    const cells = row.cells.map((cell: any) => {
      if (row.kind === 'stat') {
        const v = fitLine(F.black, tx(cell.value), z.stat, 22, CELL_W, -0.04);
        const l = clampLines(F.medium, tx(cell.label), 13, CELL_W, 2);
        return { kind: 'stat' as const, v, l, h: v.size + (l.text ? 4 + l.lines * 13 * 1.25 : 0) };
      }
      if (row.kind === 'quote') {
        const q = clampLines(F.quote, quoted(tx(cell)), z.quote, CELL_W, maxQuote);
        return { kind: 'quote' as const, q, h: q.lines * z.quote * 1.12 };
      }
      if (row.kind === 'action') {
        const a = fitLine(F.xbold, tx(cell), 15, 12, CELL_W - 28 - 23);
        return { kind: 'action' as const, a, h: a.size * 1.1 + 20 + 3 };
      }
      const c = clampLines(F.medium, tx(cell), z.text, CELL_W, maxText);
      return { kind: 'text' as const, c, h: c.lines * z.text * 1.3 };
    });
    const h = Math.max(2 * z.padV + 1 + Math.max(...cells.map((c) => c.h)), z.padV + 3 + label.lines * 15);
    return { label, cells, h, padV: z.padV, z };
  };

  const measure = (s: number) => head(s).h + rows.reduce((a, r) => a + rowGeo(r, s).h, 0);
  let fit = bestScale(measure, budget, MAX_SCALE);
  if (!fit.fits && allowDrops) {
    if (rows.some((r) => r.kind === 'action')) {
      rows = rows.filter((r) => r.kind !== 'action');
      env.warn('three-column action row dropped: no room');
      fit = bestScale(measure, budget);
    }
    while (!fit.fits && rows.length > 3) {
      env.warn(`three-column row "${tx(rows[rows.length - 1].label)}" dropped: no room`);
      rows = rows.slice(0, -1);
      fit = bestScale(measure, budget);
    }
    if (!fit.fits) {
      maxText = 2;
      maxQuote = 3;
      env.warn('three-column cell text cut to fit');
      fit = bestScale(measure, budget);
    }
  }
  const s = fit.s;
  const hd = head(s);
  const geo = rows.map((r) => rowGeo(r, s));
  const natural = hd.h + geo.reduce((a, g) => a + g.h, 0);
  const height = fit.fits ? Math.min(budget, Math.round(natural * 1.25)) : natural;

  return {
    height,
    fits: fit.fits,
    draw: (t) => {
      const colBg = (j: number) => (j === hotIdx ? t.accentSoft : t.surface);
      const inks = [0, 1, 2].map((j) => inkFor(t, colBg(j)));
      const rail = inkFor(t, t.bg);
      const colLeft = (j: number) => RAIL_W + COL_GAP + j * (COL_W + COL_GAP);
      const backs = [0, 1, 2].map((j) => box({
        position: 'absolute', top: 0, bottom: 0, left: colLeft(j), width: COL_W, borderRadius: 18, boxShadow: t.shadow,
        ...(j === hotIdx ? { background: t.accentSoft, border: `2px solid ${t.accent}` } : { background: t.surface, border: `1px solid ${t.border}` }),
      }));
      const headRow = box({ height: hd.h, flexShrink: 0 }, [
        box({ width: RAIL_W, flexShrink: 0 }),
        ...hd.cols.map((c, j) => box({ width: COL_W, marginLeft: COL_GAP, flexDirection: 'column', gap: 7, padding: `20px ${CELL_PX}px 16px`, ...clipped(env) }, [
          box({ alignItems: 'center', justifyContent: 'space-between', height: 24 }, [
            c.level ? meter(inks[j], c.level) : box({}),
            ...(c.tag ? [chip(inks[j], c.tag.text, { hot: true, size: c.tag.size })] : []),
          ]),
          T(c.title.text, F.black, colSizes(s).title, inks[j].fg, { lh: 1.12, tracking: -0.025, style: { marginTop: 3 } }),
          ...(c.sub.text ? [T(c.sub.text, F.medium, 14, inks[j].muted, { lh: 1.25 })] : []),
        ])),
      ]);
      const rowEls = geo.map((g) => box({ minHeight: g.h, flexGrow: 1 }, [
        box({ width: RAIL_W, paddingTop: g.padV + 3, paddingRight: 12, flexDirection: 'column' },
          T(g.label.text, F.bold, 12, rail.muted, { upper: true, tracking: 0.1, lh: 1.25 })),
        ...g.cells.map((cell, j) => {
          const k = inks[j];
          const hot = j === hotIdx;
          let content: SatoriElement;
          if (cell.kind === 'stat') {
            content = box({ flexDirection: 'column', gap: 4 }, [
              T(cell.v.text, F.black, cell.v.size, hot ? k.hot : k.fg, { lh: 1, tracking: -0.04, style: { flexShrink: 0 } }),
              ...(cell.l.text ? [T(cell.l.text, F.medium, 13, k.muted, { lh: 1.25 })] : []),
            ]);
          } else if (cell.kind === 'quote') content = T(cell.q.text, F.quote, g.z.quote, k.fg, { lh: 1.12 });
          else if (cell.kind === 'action') content = pillButton(k, cell.a.text, hot, cell.a.size);
          else content = T(cell.c.text, F.medium, g.z.text, k.fg, { lh: 1.3 });
          return box(
            { width: COL_W, marginLeft: COL_GAP, flexDirection: 'column', padding: `${g.padV}px ${CELL_PX}px`, borderTop: `1px solid ${k.rule}`, ...clipped(env) },
            content,
          );
        }),
      ]));
      return box({ position: 'relative', flexDirection: 'column', width: CW, height, flexShrink: 0 }, [...backs, headRow, ...rowEls]);
    },
  };
}

// ============= REFERENCE SHEET =============

const ROW_GAP = 14;
const UNIT_W = (CW - ROW_GAP * 2) / 3;
const unitsW = (u: number) => u * UNIT_W + (u - 1) * ROW_GAP;

interface CardGeo {
  h: number;
  draw: (t: Tokens) => SatoriElement;
}

interface CardOpts {
  /** cut lists to 3 entries */
  cap: boolean;
  /** cut text to fewer lines */
  tight: boolean;
}

const capList = <T>(items: T[], o: CardOpts, n = 3) => (o.cap ? items.slice(0, n) : items);

function cardTone(c: Card): 'plain' | 'soft' | 'accent' {
  if (c.emphasis) return 'accent';
  return c.kind === 'formula' ? 'soft' : 'plain';
}

function prepareCard(c: Card, w: number, units: number, s: number, o: CardOpts, env: Env): CardGeo {
  const p = lerp(14, 18, s);
  const cw = w - 2 * p - 2;
  const g = lerp(7, 11, s);
  const mb = lerp(10, 14, s);
  // the title tab grows a little with thin content so it keeps up with the text under it
  const title = fitLine(F.xbold, tx(c.title), Math.min(16, lerp(12, TAB_SIZE, s)), 11, cw * 0.72, 0.07, true);
  const tabW = width(F.xbold, title.text, title.size, 0.07, true) + 24;
  const metaRoom = cw - tabW - 10;
  const meta = c.meta && metaRoom >= 56 ? fitLine(F.medium, tx(c.meta), 13, 11, metaRoom) : null;
  const headH = title.size * 1.1 + 12;

  let contentH = 0;
  let content: (k: Ink, t: Tokens) => SatoriElement[];

  switch (c.kind) {
    case 'checklist':
    case 'avoid': {
      const b = lerp(13.5, 15.5, s);
      const items = capList(c.items, o);
      const cols = units >= 2 && items.length >= 4 ? 2 : 1;
      const colW = (cw - (cols - 1) * 18) / cols;
      const fitted = items.map((it) => clampLines(F.medium, tx(it), b, colW - 30, o.tight ? 2 : 3));
      const rowsOf: (typeof fitted)[] = [];
      for (let i = 0; i < fitted.length; i += cols) rowsOf.push(fitted.slice(i, i + cols));
      const rowH = (r: typeof fitted) => Math.max(...r.map((f) => Math.max(20, f.lines * b * 1.3)));
      contentH = rowsOf.reduce((a, r) => a + rowH(r), 0) + (rowsOf.length - 1) * g;
      content = (k) => [box({ flexDirection: 'column', gap: g }, rowsOf.map((r) => box({ gap: 18, minHeight: rowH(r) }, r.map((f) =>
        box({ gap: 10, alignItems: 'flex-start', width: colW, flexShrink: 0 }, [
          box({ marginTop: Math.max(0, (b * 1.3 - 20) / 2), flexShrink: 0 }, mark(k, c.kind === 'avoid' ? 'x' : 'check', 20)),
          box({ width: colW - 30, flexShrink: 0 }, T(f.text, F.medium, b, k.fg, { lh: 1.3 })),
        ]),
      ))))];
      break;
    }
    case 'table': {
      const ls = lerp(13, 14, s);
      const vs = lerp(14, 15, s);
      const p2 = lerp(6, 9, s);
      const rows = capList(c.rows, o).map(([l, v]) => {
        const value = fitLine(F.xbold, tx(v), vs, 11.5, cw * 0.55);
        const vw = width(F.xbold, value.text, value.size);
        const label = clampLines(F.medium, tx(l), ls, cw - vw - 12, o.tight ? 1 : 2);
        return { value, label, inner: Math.max(label.lines * ls * 1.2, value.size * 1.2) };
      });
      const rh = (i: number) => (i ? p2 : 0) + rows[i].inner + (i < rows.length - 1 ? p2 + 1 : 0);
      contentH = rows.reduce((a, _, i) => a + rh(i), 0);
      content = (k) => rows.map((r, i) => box({
        justifyContent: 'space-between', alignItems: 'center', gap: 12, height: rh(i), flexShrink: 0,
        paddingTop: i ? p2 : 0, paddingBottom: i < rows.length - 1 ? p2 : 0,
        ...(i < rows.length - 1 ? { borderBottom: `1px solid ${k.rule}` } : {}),
      }, [
        T(r.label.text, F.medium, ls, k.muted, { lh: 1.2 }),
        T(r.value.text, F.xbold, r.value.size, k.fg, { lh: 1.2, style: { flexShrink: 0 } }),
      ]));
      break;
    }
    case 'chart': {
      const bh = lerp(46, 84, s);
      const barsH = bh + 17;
      const caption = c.caption ? fitLine(F.bold, tx(c.caption), 14, 12, cw - 15) : null;
      const note = c.note ? clampLines(F.medium, tx(c.note), 13, cw, o.tight ? 1 : 2) : null;
      contentH = barsH + (caption ? g + caption.size * 1.2 : 0) + (note ? g + note.lines * 13 * 1.3 : 0);
      const bars = c.bars;
      content = (k) => [
        box({ alignItems: 'flex-end', gap: 8, height: barsH, flexShrink: 0 }, bars.map((b) =>
          box({ flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: barsH }, [
            box({
              width: '100%', height: Math.max(6, Math.round(b.value * bh)), borderRadius: 6,
              ...(b.hot ? { backgroundImage: `linear-gradient(180deg, ${lighten(k.fill, 0.12)}, ${k.fill})` } : { background: k.chipBorder }),
            }),
            T(fitLine(F.mono, tx(b.label), 11, 9, (cw - (bars.length - 1) * 8) / bars.length, 0, true).text, F.mono, 11, b.hot ? k.hot : k.muted, { lh: 1, upper: true, style: { flexShrink: 0 } }),
          ]),
        )),
        ...(caption ? [box({ alignItems: 'center', gap: 7, flexShrink: 0 }, [
          box({ width: 8, height: 8, borderRadius: 4, background: k.hot, flexShrink: 0 }),
          T(caption.text, F.bold, caption.size, k.fg, { lh: 1.2, style: { flexShrink: 0 } }),
        ])] : []),
        ...(note ? [T(note.text, F.medium, 13, k.muted, { lh: 1.3 })] : []),
      ];
      break;
    }
    case 'stats': {
      const stats = capList(c.stats, o);
      if (units >= 2) {
        const sw = (cw - (stats.length - 1) * 16) / stats.length;
        const fitted = stats.map((st) => ({
          v: fitLine(F.black, tx(st.value), lerp(26, 34, s), 18, sw, -0.04),
          l: clampLines(F.medium, tx(st.label), 13, sw, 2),
        }));
        contentH = Math.max(...fitted.map((f) => f.v.size + (f.l.text ? 4 + f.l.lines * 13 * 1.25 : 0)));
        content = (k) => [box({ gap: 16 }, fitted.map((f) => box({ width: sw, flexDirection: 'column', gap: 4, flexShrink: 0 }, [
          T(f.v.text, F.black, f.v.size, k.hot, { lh: 1, tracking: -0.04, style: { flexShrink: 0 } }),
          ...(f.l.text ? [T(f.l.text, F.medium, 13, k.muted, { lh: 1.25 })] : []),
        ])))];
      } else {
        const p2 = lerp(7, 9, s);
        const fitted = stats.map((st) => {
          const v = fitLine(F.black, tx(st.value), lerp(24, 30, s), 18, cw * 0.55, -0.04);
          const vw = width(F.black, v.text, v.size, -0.04);
          const l = clampLines(F.medium, tx(st.label), 14, cw - vw - 12, o.tight ? 1 : 2);
          return { v, l, inner: Math.max(v.size, l.lines * 14 * 1.2) };
        });
        const rh = (i: number) => (i ? p2 : 0) + fitted[i].inner + (i < fitted.length - 1 ? p2 + 1 : 0);
        contentH = fitted.reduce((a, _, i) => a + rh(i), 0);
        content = (k) => fitted.map((f, i) => box({
          alignItems: 'center', justifyContent: 'space-between', gap: 12, height: rh(i), flexShrink: 0,
          paddingTop: i ? p2 : 0, paddingBottom: i < fitted.length - 1 ? p2 : 0,
          ...(i < fitted.length - 1 ? { borderBottom: `1px solid ${mix(k.bg, k.fg, 0.22)}` } : {}),
        }, [
          T(f.v.text, F.black, f.v.size, k.fg, { lh: 1, tracking: -0.04, style: { flexShrink: 0 } }),
          T(f.l.text, F.medium, 14, k.muted, { lh: 1.2, align: 'right' }),
        ]));
      }
      break;
    }
    case 'steps': {
      const steps = capList(c.steps, o, 4);
      const sw = (cw - (steps.length - 1) * 14) / steps.length;
      const ts = lerp(15, 17, s);
      const bs = lerp(13, 14, s);
      const fitted = steps.map((st) => {
        const tag = fitLine(F.mono, tx(st.tag), 12, 10, sw - 32, 0, true);
        const title = clampLines(F.xbold, tx(st.title), ts, sw, 2);
        const body = clampLines(F.medium, tx(st.body), bs, sw, o.tight ? 2 : 3);
        const ch = st.chip ? fitLine(F.bold, tx(st.chip), 11, 10, sw - 22) : null;
        const h = 16 + (title.text ? 10 + title.lines * ts * 1.15 : 0) + (body.text ? 6 + body.lines * bs * 1.3 : 0) + (ch ? 10 + chipH(ch.size) : 0);
        return { tag, title, body, ch, h };
      });
      contentH = Math.max(...fitted.map((f) => f.h));
      content = (k) => [box({ position: 'relative', gap: 14 }, [
        box({ position: 'absolute', top: 7, left: 8, right: 8, height: 2, background: k.rule }),
        ...fitted.map((f, i) => box({ width: sw, flexDirection: 'column', flexShrink: 0 }, [
          box({ alignItems: 'center', gap: 8, height: 16 }, [
            box({ width: 16, height: 16, borderRadius: 8, flexShrink: 0, background: i === 0 ? k.hot : k.bg, border: `3px solid ${k.hot}` }),
            // a patch of the card color so the line doesn't run through the label
            box({ background: k.bg, paddingRight: 8, flexShrink: 0 }, T(f.tag.text, F.mono, f.tag.size, k.hot, { lh: 1, upper: true, style: { flexShrink: 0 } })),
          ]),
          ...(f.title.text ? [T(f.title.text, F.xbold, ts, k.fg, { lh: 1.15, style: { marginTop: 10 } })] : []),
          ...(f.body.text ? [T(f.body.text, F.medium, bs, k.muted, { lh: 1.3, style: { marginTop: 6 } })] : []),
          ...(f.ch ? [box({ marginTop: 10, flexShrink: 0 }, chip(k, f.ch.text, { size: f.ch.size }))] : []),
        ])),
      ])];
      break;
    }
    case 'examples': {
      const lines = capList(c.lines, o);
      const fitted = lines.map((l) => {
        const ch = fitLine(F.mono, tx(l.text), 13, 11, cw * 0.62 - 22);
        const chW = width(F.mono, ch.text, ch.size) + 22;
        const note = clampLines(F.medium, tx(l.note), 13, cw - chW - 12, o.tight ? 1 : 2);
        return { ch, note, h: Math.max(chipH(ch.size), note.lines * 13 * 1.2) };
      });
      contentH = fitted.reduce((a, f) => a + f.h, 0) + (fitted.length - 1) * g;
      content = (k) => [box({ flexDirection: 'column', gap: g }, fitted.map((f) =>
        box({ alignItems: 'center', justifyContent: 'space-between', gap: 12, height: f.h, flexShrink: 0 }, [
          chip(k, f.ch.text, { mono: true, size: f.ch.size }),
          T(f.note.text, F.medium, 13, k.muted, { lh: 1.2, align: 'right' }),
        ]),
      ))];
      break;
    }
    case 'formula': {
      const parts = c.parts.map((pt) => fitLine(F.bold, tx(pt), 13, 11, cw - 22));
      const plusW = width(F.black, '+', 18);
      const items = parts.flatMap((pt, i) => [...(i ? [plusW] : []), width(F.bold, pt.text, pt.size) + 22]);
      const rows = wrapRows(items, cw, 8);
      const partsH = rows * chipH(13) + (rows - 1) * 8;
      const es = lerp(17, 20, s);
      const ex = c.example ? clampLines(F.quote, quoted(tx(c.example)), es, cw, o.tight ? 3 : 4) : null;
      // the example sits one container gap plus a 4px margin below the parts
      contentH = partsH + (ex ? g + 4 + ex.lines * es * 1.18 : 0);
      content = (k) => [
        box({ alignItems: 'center', columnGap: 8, rowGap: 8, flexWrap: 'wrap', flexShrink: 0 }, parts.flatMap((pt, i) => [
          // never put text in a box narrower than one of its glyphs: Satori loops forever on it
          ...(i ? [T('+', F.black, 18, k.hot, { lh: 1, style: { flexShrink: 0 } })] : []),
          chip(k, pt.text, { hot: i === parts.length - 1, size: pt.size }),
        ])),
        ...(ex ? [T(ex.text, F.quote, es, k.fg, { lh: 1.18, style: { marginTop: 4 } })] : []),
      ];
      break;
    }
  }

  const h = 2 * p + 2 + headH + mb + contentH;
  return {
    h,
    draw: (t) => {
      const tone = cardTone(c);
      const bg = tone === 'accent' ? t.accent : tone === 'soft' ? t.accentSoft : t.surface;
      const k = inkFor(t, bg);
      const fill = tone === 'accent'
        ? { backgroundImage: accentFill(t, 155), border: `1px solid ${t.accent}` }
        : { background: bg, border: `1px solid ${tone === 'soft' ? t.accentSoftBorder : t.border}` };
      return box({ width: w, flexDirection: 'column', padding: p, borderRadius: 18, boxShadow: t.shadow, flexShrink: 0, ...fill, ...clipped(env) }, [
        box({ alignItems: 'center', justifyContent: 'space-between', gap: 10, height: headH, marginBottom: mb, flexShrink: 0 }, [
          tab(k, title.text, tone === 'accent', title.size),
          ...(meta ? [T(meta.text, F.medium, meta.size, k.muted, { lh: 1.1, align: 'right', style: { flexShrink: 0 } })] : []),
        ]),
        box({ flexDirection: 'column', gap: c.kind === 'chart' || c.kind === 'formula' ? g : 0, flexShrink: 0 }, content(k, t)),
      ]);
    },
  };
}

/** Cards into rows of 3 units, in order; a row with room left stretches its last card. */
export function packCards(cards: Card[]): Array<Array<{ card: Card; units: number }>> {
  const rows: Array<Array<{ card: Card; units: number }>> = [];
  let cur: Array<{ card: Card; units: number }> = [];
  let used = 0;
  const close = () => {
    if (!cur.length) return;
    cur[cur.length - 1].units += 3 - used;
    rows.push(cur);
    cur = [];
    used = 0;
  };
  for (const card of cards) {
    const u = CARD_UNITS[card.kind as CardKind];
    if (used + u > 3) close();
    cur.push({ card, units: u });
    used += u;
  }
  close();
  return rows;
}

export function prepareSheet(spec: SheetSpec, budget: number, allowDrops: boolean, env: Env): Laid {
  let cards = spec.data.cards.slice();
  const o: CardOpts = { cap: false, tight: false };
  const quiet: Env = { clip: env.clip, warn: () => {} };

  const layout = (s: number, e: Env) => packCards(cards).map((row) => {
    const geos = row.map(({ card, units }) => ({ units, geo: prepareCard(card, unitsW(units), units, s, o, e) }));
    return { geos, h: Math.max(...geos.map((x) => x.geo.h)) };
  });
  const measure = (s: number) => {
    const rows = layout(s, quiet);
    return rows.reduce((a, r) => a + r.h, 0) + (rows.length - 1) * ROW_GAP;
  };

  let fit = bestScale(measure, budget, MAX_SCALE);
  if (!fit.fits && allowDrops) {
    o.cap = true;
    fit = bestScale(measure, budget);
    env.warn('sheet lists cut to 3 entries');
    if (!fit.fits) {
      o.tight = true;
      env.warn('sheet text cut tighter');
      fit = bestScale(measure, budget);
    }
    while (!fit.fits && cards.length > 3) {
      env.warn(`sheet card "${tx(cards[cards.length - 1].title)}" dropped: no room`);
      cards = cards.slice(0, -1);
      fit = bestScale(measure, budget);
    }
  }
  const rows = layout(fit.s, env);
  const natural = rows.reduce((a, r) => a + r.h, 0) + (rows.length - 1) * ROW_GAP;
  const height = fit.fits ? Math.min(budget, Math.round(natural * 1.2)) : natural;

  return {
    height,
    fits: fit.fits,
    draw: (t) => box({ flexDirection: 'column', gap: ROW_GAP, width: CW, height, flexShrink: 0 }, rows.map((r) =>
      box({ gap: ROW_GAP, minHeight: r.h, flexGrow: 1, alignItems: 'stretch' }, r.geos.map((x) => x.geo.draw(t))),
    )),
  };
}
