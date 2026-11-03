/**
 * Infographic kit: brand colors, design tokens and the drawing primitives every
 * infographic layout is built from.
 *
 * A brand gives at most a background, a text color and an accent; a theme (light or
 * dark) picks the field. Everything else (surfaces, hairlines, muted text, a
 * contrast-safe accent for text, a five-step accent ramp for hierarchy layouts) is
 * derived, so no layout ever names a color and any palette works.
 *
 * Components draw with an Ink: the text colors readable on the surface they sit on
 * (a card, the accent card, a pyramid tier), computed from that surface.
 *
 * Layouts work in two steps. `prepare` measures (the carousel text metrics, so no Satori
 * call), fits sizes and cuts text; `draw` builds the Satori tree from exactly those
 * numbers. Measuring never needs colors, so fitting does not depend on the brand.
 */

import {
  type FontRef,
  type LogoAsset,
  type SatoriElement,
  box,
  contrast,
  darken,
  ensureContrast,
  hexToRgb,
  icon,
  lighten,
  luminance,
  mix,
  pickAccent,
  rgbToHex,
  rgba,
  saturation,
  stripEmoji,
  text,
} from '../carousel-kit.js';
import { normalizeDashes } from '../dash-rules.js';

// ============= PAGE GEOMETRY =============

export const W = 1080;
export const H = 1350;
export const PAD = 44;
export const PAD_BOTTOM = 34;
/** content width */
export const CW = W - PAD * 2;

// ============= BRAND =============

export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'auto';

/** Colors as a brand stores them (brand voice color_palette or a blueprint override). */
export interface BrandColors {
  primary?: string | null;
  secondary?: string | null;
  background?: string | null;
  text?: string | null;
  accent?: string | null;
}

export interface BrandPalette {
  background: string;
  text: string;
  accent: string;
  theme: Theme;
}

/** Name, handle and logo in the author pill at the bottom. */
export interface Identity {
  name: string;
  handle: string;
  logo?: LogoAsset | null;
}

export const DEFAULT_ACCENT = '#2B59F0';
const LIGHT_FIELD = '#F5F3EF';
const LIGHT_INK = '#14161F';
const DARK_INK = '#ECEEF0';

const hex = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const c = hexToRgb(v.trim());
  return c ? rgbToHex(c) : null;
};

/**
 * The three colors an infographic is drawn from. The accent is the first saturated brand
 * color (accent, primary, secondary); `auto` takes the theme from the brand background.
 * A brand background or text color is only kept when it suits the theme and reads well.
 */
export function brandPalette(colors: BrandColors | null | undefined, choice: ThemeChoice = 'auto'): BrandPalette {
  const c = colors ?? {};
  const candidates = [c.accent, c.primary, c.secondary].map(hex).filter((x): x is string => !!x);
  const accent = candidates.find((x) => saturation(x) >= 0.25) ?? candidates[0] ?? DEFAULT_ACCENT;
  const bgIn = hex(c.background);
  const textIn = hex(c.text);
  const theme: Theme = choice === 'auto' ? (bgIn && luminance(bgIn) < 0.3 ? 'dark' : 'light') : choice;
  if (theme === 'light') {
    const background = bgIn && luminance(bgIn) >= 0.75 ? bgIn : LIGHT_FIELD;
    return { background, text: textIn && contrast(textIn, background) >= 7 ? textIn : LIGHT_INK, accent, theme };
  }
  const background = bgIn && luminance(bgIn) <= 0.04 ? bgIn : mix(accent, '#0B0D10', 0.94);
  const textColor = textIn && luminance(textIn) > 0.6 && contrast(textIn, background) >= 7 ? textIn : DARK_INK;
  return { background, text: textColor, accent, theme };
}

// ============= TOKENS =============

export interface Tokens {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  surface: string;
  border: string;
  accent: string;
  accentDeep: string;
  accentText: string;
  onAccent: string;
  accentSoft: string;
  accentSoftBorder: string;
  /** strongest first: hierarchy layouts color their levels with it */
  ramp: string[];
  lightInk: string;
  darkInk: string;
  shadow: string;
  glow: string;
}

export function infographicTokens(p: BrandPalette): Tokens {
  const bg = p.background;
  const fg = p.text;
  const dark = p.theme === 'dark';
  const lightInk = dark ? fg : '#FFFFFF';
  const darkInk = dark ? bg : fg;
  const surface = dark ? mix(bg, fg, 0.06) : mix(bg, '#FFFFFF', 0.72);
  // fills keep the brand color (a yellow stays yellow, with dark text on it); only a color
  // too close to the field to see is nudged. Text uses accentText, which reads at 4.5:1.
  const accent = pickAccent([p.accent], bg, 1.4);
  return {
    dark,
    bg,
    fg,
    muted: mix(fg, bg, 0.36),
    surface,
    border: mix(bg, fg, dark ? 0.15 : 0.13),
    accent,
    accentDeep: darken(accent, dark ? 0.3 : 0.22),
    accentText: ensureContrast(ensureContrast(accent, bg, 4.5), surface, 4.5),
    onAccent: pickInk(accent, lightInk, darkInk),
    accentSoft: mix(accent, dark ? bg : surface, dark ? 0.84 : 0.9),
    accentSoftBorder: mix(accent, bg, dark ? 0.6 : 0.72),
    ramp: [0, 0.3, 0.5, 0.66, 0.8].map((t) => mix(accent, bg, t)),
    lightInk,
    darkInk,
    shadow: dark ? '0 12px 32px rgba(0,0,0,0.35)' : `0 10px 28px ${rgba(fg, 0.07)}`,
    glow: `linear-gradient(180deg, ${rgba(accent, dark ? 0.16 : 0.08)} 0%, ${rgba(accent, 0)} 38%)`,
  };
}

function pickInk(fill: string, lightInk: string, darkInk: string): string {
  return contrast(fill, lightInk) >= contrast(fill, darkInk) ? lightInk : darkInk;
}

// ============= INK =============

export interface Ink {
  bg: string;
  fg: string;
  muted: string;
  rule: string;
  /** emphasis color for text and icons: the accent when it reads on this surface, else the ink */
  hot: string;
  hotSoft: string;
  onHot: string;
  /** accent as a fill (tabs, bars, buttons): the brand color itself unless it vanishes here */
  fill: string;
  onFill: string;
  chipBg: string;
  chipBorder: string;
}

export function inkFor(t: Tokens, bg: string): Ink {
  const fg = pickInk(bg, t.lightInk, t.darkInk);
  const hot = contrast(t.accent, bg) < 2.2 ? fg : ensureContrast(t.accent, bg, 4.5);
  const fill = contrast(t.accent, bg) >= 1.3 ? t.accent : hot;
  return {
    bg,
    fg,
    muted: mix(fg, bg, 0.34),
    rule: mix(fg, bg, 0.84),
    hot,
    hotSoft: mix(hot, bg, 0.84),
    onHot: pickInk(hot, t.lightInk, t.darkInk),
    fill,
    onFill: pickInk(fill, t.lightInk, t.darkInk),
    chipBg: mix(bg, fg, 0.07),
    chipBorder: mix(bg, fg, 0.16),
  };
}

// ============= TYPE =============

export const F: Record<'black' | 'xbold' | 'bold' | 'medium' | 'quote' | 'mono', FontRef> = {
  black: { family: 'Inter', weight: 900 },
  xbold: { family: 'Inter', weight: 800 },
  bold: { family: 'Inter', weight: 700 },
  medium: { family: 'Inter', weight: 500 },
  quote: { family: 'Instrument Serif', weight: 400, italic: true },
  mono: { family: 'Space Mono', weight: 700 },
};

/**
 * Text ready to measure and draw: house dash rules, no emoji, single spaces. `<`, `>`
 * and `&` stay: Satori escapes them (the carousel sanitizer strips them, which is why
 * "<3%" came out as "3%").
 */
export function tx(s: string | null | undefined): string {
  if (!s) return '';
  return stripEmoji(normalizeDashes(String(s))).replace(/\s+/g, ' ').trim();
}

/** Curly quotes around a quote, with typographic apostrophes inside. */
export const quoted = (s: string) => `“${s.replace(/'/g, '’')}”`;

interface TOpts {
  lh?: number;
  tracking?: number;
  upper?: boolean;
  align?: 'left' | 'center' | 'right';
  style?: Record<string, any>;
}

/** A text block. Content must already be prepared (`tx`, fitted, cut). */
export function T(content: string, font: FontRef, size: number, color: string, o: TOpts = {}): SatoriElement {
  return text(content, {
    font,
    size,
    color,
    lh: o.lh ?? 1.3,
    tracking: o.tracking,
    upper: o.upper,
    align: o.align,
    extra: { flexShrink: 1, ...o.style },
  });
}

// ============= PREPARE / DRAW =============

/** Per render: warnings, and the spill-check mode that clips every container. */
export interface Env {
  clip: boolean;
  warn: (m: string) => void;
}

/** A measured piece of the page and the function that draws it with those exact numbers. */
export interface Prepared {
  height: number;
  draw: (t: Tokens) => SatoriElement;
}

/** `overflow: hidden` in spill-check mode (a render that differs from the normal one spilled). */
export const clipped = (env: Env): Record<string, string> => (env.clip ? { overflow: 'hidden' } : {});

// ============= PRIMITIVES =============

export const TAB_SIZE = 13;
/** height of a card title tab (text 1.1 lh + 5px padding top and bottom + border) */
export const TAB_H = TAB_SIZE * 1.1 + 12;

/** Card title: a small filled pill (`size` is the fitted font size). */
export function tab(k: Ink, label: string, onAccentCard = false, size = TAB_SIZE): SatoriElement {
  return box(
    {
      padding: '5px 11px',
      borderRadius: 8,
      flexShrink: 0,
      ...(onAccentCard
        ? { background: rgba(k.fg, 0.16), border: `1px solid ${rgba(k.fg, 0.24)}` }
        : { background: k.fill, border: `1px solid ${k.fill}` }),
    },
    T(label, F.xbold, size, onAccentCard ? k.fg : k.onFill, { upper: true, tracking: 0.07, lh: 1.1, style: { flexShrink: 0 } }),
  );
}

/** chip height for a font size: 1.15 lh + 5px padding top and bottom + border */
export const chipH = (size: number) => size * 1.15 + 12;

export function chip(k: Ink, label: string, o: { mono?: boolean; hot?: boolean; size?: number } = {}): SatoriElement {
  return box(
    {
      padding: '5px 10px',
      borderRadius: 8,
      flexShrink: 0,
      background: o.hot ? k.fill : k.chipBg,
      border: `1px solid ${o.hot ? k.fill : k.chipBorder}`,
    },
    T(label, o.mono ? F.mono : F.bold, o.size ?? 13, o.hot ? k.onFill : k.fg, { lh: 1.15, style: { flexShrink: 0 } }),
  );
}

export function badge(k: Ink, n: number | string, size = 28): SatoriElement {
  return box(
    {
      width: size, height: size, borderRadius: size / 2, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
      background: rgba(k.fg, 0.12), border: `1px solid ${rgba(k.fg, 0.22)}`,
    },
    T(String(n), F.xbold, Math.round(size * 0.48), k.fg, { lh: 1, style: { flexShrink: 0 } }),
  );
}

export function meter(k: Ink, n: number, of = 3): SatoriElement {
  return box({ gap: 4, alignItems: 'center' }, Array.from({ length: of }, (_, i) =>
    box({ width: 18, height: 7, borderRadius: 4, background: i < n ? k.fill : k.chipBorder }),
  ));
}

/** A round check (or cross) mark. */
export function mark(k: Ink, kind: 'check' | 'x', size = 20): SatoriElement {
  return box(
    {
      width: size, height: size, borderRadius: size / 2, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
      background: kind === 'check' ? k.hotSoft : k.chipBg,
      border: `1px solid ${kind === 'check' ? mix(k.hot, k.bg, 0.6) : k.chipBorder}`,
    },
    icon(kind, Math.round(size * 0.6), kind === 'check' ? k.hot : k.muted, 3.2),
  );
}

export function pillButton(k: Ink, label: string, hot: boolean, size = 15): SatoriElement {
  return box(
    {
      alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 999,
      ...(hot ? { background: k.fill, border: `1.5px solid ${k.fill}` } : { border: `1.5px solid ${mix(k.fg, k.bg, 0.55)}` }),
    },
    [T(label, F.xbold, size, hot ? k.onFill : k.fg, { lh: 1.1, style: { flexShrink: 0 } }), icon('arrow', size, hot ? k.onFill : k.fg, 2.8)],
  );
}

/** Accent fill for the accent card, the takeaway bar and the avatar. */
export const accentFill = (t: Tokens, deg = 150) => `linear-gradient(${deg}deg, ${lighten(t.accent, 0.06)} 0%, ${t.accentDeep} 100%)`;
