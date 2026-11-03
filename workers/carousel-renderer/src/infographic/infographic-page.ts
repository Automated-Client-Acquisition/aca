/**
 * The parts every infographic shares: header (kicker, headline with a highlighted run,
 * subtitle), takeaway bar, author pill, and the page that stacks them around a layout.
 *
 * Every part has an explicit height from `prepare`, so the page geometry is exactly the
 * measured one and the spill check can prove nothing was drawn outside its box.
 */

import { type SatoriElement, box, fitLine, rgba, wrapHeadline } from '../carousel-kit.js';
import { findRun, type InfographicSpec, type Takeaway } from './spec.js';
import { clampLines, width } from './infographic-fit.js';
import {
  type Env,
  type Identity,
  type Prepared,
  type Tokens,
  CW,
  F,
  H,
  PAD,
  PAD_BOTTOM,
  T,
  W,
  accentFill,
  clipped,
  inkFor,
  tx,
} from './infographic-kit.js';

const HEAD_MAX = CW - 40;
const HEAD_TRACK = -0.04;
const HEAD_LH = 1.06;
const SUB_SIZE = 20;
const SUB_LH = 1.35;
const SUB_MAX = 820;

const BODY_TOP = 26;
const BODY_BOTTOM = 22;
const FOOTER_GAP = 18;
export const FOOTER_H = 54;

// ============= HEADER =============

/**
 * Kicker pill, headline, optional subtitle. The headline takes the biggest size that
 * keeps it on 2 lines (3 at a smaller size), with balanced lines, and its highlighted
 * phrase is one unbreakable piece so it never splits across lines.
 */
export function prepareHeader(spec: InfographicSpec, withSub: boolean, env: Env): Prepared {
  const kickerRaw = tx(spec.kicker);
  const kicker = kickerRaw ? fitLine(F.bold, kickerRaw, 14, 11, HEAD_MAX - 40, 0.12, true) : null;
  const kickerH = kicker ? kicker.size * 1.1 + 16 : 0;
  if (kicker?.clamped) env.warn('kicker cut');

  let headline = tx(spec.headline);
  const hlRun = (s: string) => {
    const r = findRun(s, tx(spec.highlight));
    return r ? s.split(/\s+/).slice(r.start, r.start + r.length).join(' ') : '';
  };
  const rows = (s: string, size: number, w: number) => {
    const run = hlRun(s);
    const runFits = !!run && width(F.black, run, size, HEAD_TRACK) <= w * 0.97;
    return wrapHeadline(F.black, s, runFits ? run : '', size, w * 0.97, HEAD_TRACK);
  };

  let size = 0;
  let lines = 0;
  for (const z of [58, 56, 54, 52, 50, 48, 46]) {
    if (rows(headline, z, HEAD_MAX) <= 2) { size = z; lines = rows(headline, z, HEAD_MAX); break; }
  }
  if (!size) {
    for (const z of [52, 50, 48, 46, 44, 42]) {
      if (rows(headline, z, HEAD_MAX) <= 3) { size = z; lines = rows(headline, z, HEAD_MAX); break; }
    }
  }
  if (!size) {
    size = 42;
    const words = headline.split(/\s+/);
    while (words.length > 1 && rows(`${words.join(' ')}...`, size, HEAD_MAX) > 3) words.pop();
    headline = `${words.join(' ')}...`;
    lines = rows(headline, size, HEAD_MAX);
    env.warn('headline cut to 3 lines');
  }

  // balanced lines: the narrowest box that keeps the same line count
  let boxW = HEAD_MAX;
  if (lines > 1) {
    const run = hlRun(headline);
    const pieces = [...(run ? [run] : []), ...headline.split(/\s+/)];
    const widest = Math.max(...pieces.map((p) => width(F.black, p, size, HEAD_TRACK)));
    for (let w = HEAD_MAX; w >= widest / 0.97; w -= 8) {
      if (rows(headline, size, w) > lines) break;
      boxW = w;
    }
  }

  const sub = withSub && tx(spec.sub) ? clampLines(F.medium, tx(spec.sub), SUB_SIZE, SUB_MAX, 2) : null;
  if (sub?.clamped) env.warn('subtitle cut to 2 lines');

  const headH = lines * size * HEAD_LH;
  const height = (kicker ? kickerH + 18 : 0) + headH + (sub ? 14 + sub.lines * SUB_SIZE * SUB_LH : 0);

  // the run as one piece when it fits a line, else word by word
  const run = hlRun(headline);
  const r = run ? findRun(headline, run) : null;
  const words = headline.split(/\s+/);
  const runFits = !!run && width(F.black, run, size, HEAD_TRACK) <= boxW * 0.97;
  const pieces: Array<{ text: string; lit: boolean }> = [];
  words.forEach((w, i) => {
    const inRun = !!r && i >= r.start && i < r.start + r.length;
    if (inRun && runFits) {
      if (i === r!.start) pieces.push({ text: run, lit: true });
    } else pieces.push({ text: w, lit: inRun });
  });

  return {
    height,
    draw: (t) =>
      box({ flexDirection: 'column', alignItems: 'center', height, flexShrink: 0 }, [
        ...(kicker
          ? [box(
            { height: kickerH, padding: '7px 16px', borderRadius: 999, background: t.accentSoft, border: `1px solid ${t.accentSoftBorder}`, marginBottom: 18, flexShrink: 0 },
            T(kicker.text, F.bold, kicker.size, t.accentText, { upper: true, tracking: 0.12, lh: 1.1, style: { flexShrink: 0 } }),
          )]
          : []),
        box(
          { flexWrap: 'wrap', justifyContent: 'center', alignContent: 'flex-start', columnGap: Math.round(size * 0.25), width: Math.ceil(boxW), height: headH, flexShrink: 0, ...clipped(env) },
          pieces.map((p) => T(p.text, F.black, size, p.lit ? t.accentText : t.fg, { lh: HEAD_LH, tracking: HEAD_TRACK, style: { flexShrink: 0 } })),
        ),
        ...(sub
          ? [box({ marginTop: 14, width: SUB_MAX, height: sub.lines * SUB_SIZE * SUB_LH, justifyContent: 'center', flexShrink: 0, ...clipped(env) },
            T(sub.text, F.medium, SUB_SIZE, t.muted, { lh: SUB_LH, align: 'center' }))]
          : []),
      ]),
  };
}

// ============= TAKEAWAY =============

const BAR_PAD_L = 18;
const BAR_PAD_R = 24;
const BAR_PAD_Y = 18;
const BAR_GAP = 18;
const BAR_LH = 1.28;

/** The one-sentence lesson on a solid accent bar. */
export function prepareTakeaway(tk: Takeaway, env: Env): Prepared {
  const label = fitLine(F.xbold, tx(tk.label) || 'The rule', 13, 11, 190, 0.1, true);
  const labelBoxW = width(F.xbold, label.text, label.size, 0.1, true) + 26;
  const labelH = label.size * 1.1 + 16;
  const textW = CW - BAR_PAD_L - BAR_PAD_R - labelBoxW - BAR_GAP;
  const raw = tx(tk.text);
  let size = 18;
  let line = clampLines(F.bold, raw, 18, textW, 2, -0.01);
  for (const z of [21, 20, 19]) {
    const c = clampLines(F.bold, raw, z, textW, 2, -0.01);
    if (!c.clamped) { size = z; line = c; break; }
  }
  if (line.clamped) env.warn('takeaway cut to 2 lines');
  const textH = line.lines * size * BAR_LH;
  const height = Math.max(labelH, textH) + BAR_PAD_Y * 2;
  return {
    height,
    draw: (t) => {
      const k = inkFor(t, t.accent);
      return box(
        {
          height, alignItems: 'center', gap: BAR_GAP, padding: `${BAR_PAD_Y}px ${BAR_PAD_R}px ${BAR_PAD_Y}px ${BAR_PAD_L}px`,
          borderRadius: 18, backgroundImage: accentFill(t, 120), boxShadow: t.shadow, flexShrink: 0,
        },
        [
          box(
            { padding: '7px 12px', borderRadius: 10, background: rgba(k.fg, 0.16), border: `1px solid ${rgba(k.fg, 0.22)}`, flexShrink: 0 },
            T(label.text, F.xbold, label.size, k.fg, { upper: true, tracking: 0.1, lh: 1.1, style: { flexShrink: 0 } }),
          ),
          box({ width: textW, height: textH, flexShrink: 0, ...clipped(env) }, T(line.text, F.bold, size, k.fg, { lh: BAR_LH, tracking: -0.01 })),
        ],
      );
    },
  };
}

// ============= AUTHOR PILL =============

/** Avatar (square logo, or initials), name, handle. A wide logo replaces the avatar. */
export function prepareFooter(identity: Identity, env: Env): Prepared {
  const name = fitLine(F.bold, tx(identity.name), 16, 13, 360, 0);
  const handle = fitLine(F.medium, tx(identity.handle), 16, 13, 300, 0);
  if (name.clamped || handle.clamped) env.warn('footer name or handle cut');
  const logo = identity.logo ?? null;
  const wide = !!logo && logo.aspect > 1.33;
  const initials = (identity.name || identity.handle || '?').replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return {
    height: FOOTER_H,
    draw: (t) => {
      const avatar = logo && !wide
        ? { type: 'img', props: { src: logo.dataUri, width: 38, height: 38, style: { width: 38, height: 38, borderRadius: 19, objectFit: 'cover' } } }
        : box(
          { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundImage: accentFill(t, 140), flexShrink: 0 },
          T(initials, F.xbold, 14, t.onAccent, { lh: 1, style: { flexShrink: 0 } }),
        );
      const lead = wide
        ? { type: 'img', props: { src: logo!.dataUri, height: 24, width: Math.min(140, Math.round(24 * logo!.aspect)), style: { height: 24, width: Math.min(140, Math.round(24 * logo!.aspect)), objectFit: 'contain', marginLeft: 8 } } }
        : avatar;
      const parts: SatoriElement[] = [lead];
      if (name.text) parts.push(T(name.text, F.bold, name.size, t.fg, { lh: 1.1, style: { flexShrink: 0 } }));
      if (name.text && handle.text) parts.push(box({ width: 4, height: 4, borderRadius: 2, background: t.muted, flexShrink: 0 }));
      if (handle.text) parts.push(T(handle.text, F.medium, handle.size, t.muted, { lh: 1.1, style: { flexShrink: 0 } }));
      return box({ justifyContent: 'center', height: FOOTER_H, flexShrink: 0 }, [
        box({ alignItems: 'center', gap: 12, padding: '7px 20px 7px 7px', borderRadius: 999, background: t.surface, border: `1px solid ${t.border}` }, parts),
      ]);
    },
  };
}

// ============= PAGE =============

/** Height left for the layout between the header and the takeaway bar. */
export const bodyBudget = (headH: number, barH: number) =>
  H - PAD - PAD_BOTTOM - headH - BODY_TOP - BODY_BOTTOM - barH - FOOTER_GAP - FOOTER_H;

export function drawPage(t: Tokens, env: Env, head: Prepared, body: Prepared, budget: number, bar: Prepared, foot: Prepared): SatoriElement {
  return box(
    {
      width: W,
      height: H,
      flexDirection: 'column',
      backgroundColor: t.bg,
      backgroundImage: t.glow,
      padding: `${PAD}px ${PAD}px ${PAD_BOTTOM}px`,
      fontFamily: 'Inter',
    },
    [
      head.draw(t),
      box(
        { height: budget, marginTop: BODY_TOP, marginBottom: BODY_BOTTOM, flexDirection: 'column', justifyContent: 'center', flexShrink: 0, ...clipped(env) },
        body.draw(t),
      ),
      bar.draw(t),
      box({ height: FOOTER_GAP, flexShrink: 0 }),
      foot.draw(t),
    ],
  );
}
