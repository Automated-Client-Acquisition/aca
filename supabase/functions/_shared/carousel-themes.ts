/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Copy of workers/carousel-renderer/src/carousel-themes.ts.
 * Regenerate with: node scripts/generate-carousel-ports.mjs
 */

/**
 * Carousel themes.
 *
 * A theme is a set of design tokens (colors, type, marker style, decoration) that
 * the shared layouts in carousel-layouts.ts draw with. Layouts decide structure
 * from the content (point, list, stat, compare, statement); themes decide the look.
 *
 * Color discipline: one dominant color, one accent, neutrals. The brand palette is
 * mapped, not pasted: the accent is picked by contrast against the theme's own
 * background, and text is always readable. With no brand palette a theme uses its
 * signature colors.
 *
 * Pure TypeScript (no Node or Deno APIs): copied to supabase/functions/_shared.
 */

import {
  type FontRef,
  type Palette,
  type RenderAssets,
  type SatoriElement,
  box,
  ensureContrast,
  luminance,
  mix,
  pickAccent,
  readableOn,
  rgba,
  darken,
  lighten,
} from './carousel-kit.ts';

// ============= TYPES =============

export type SlideKind = 'cover' | 'content' | 'cta';
export type HighlightStyle = 'color' | 'marker' | 'italic' | 'tape';
export type ListMarker = 'numeral' | 'square' | 'check';
export type ProgressStyle = 'segments' | 'line';
export type KickerStyle = 'plain' | 'rule' | 'pill' | 'tag';

export interface DecorContext {
  w: number;
  h: number;
  assets: RenderAssets;
  slideNumber: number;
  total: number;
}

export interface Tokens {
  kind: SlideKind;
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  faint: string;
  rule: string;
  accent: string;
  /** accent as TEXT on the background (contrast-safe); accent itself is for fills */
  accentText: string;
  onAccent: string;
  surface: string;
  surfaceBorder: string;

  display: FontRef;
  displayUpper: boolean;
  displayTracking: number;
  displayLeading: number;
  /** cover headline px range at 1080 wide */
  coverSize: [number, number];
  /** content headline px range */
  contentSize: [number, number];
  body: FontRef;
  bodyLeading: number;
  label: FontRef;
  labelTracking: number;
  numeral: FontRef;
  /** font for `highlight: 'italic'` */
  italic: FontRef;

  highlight: HighlightStyle;
  marker: ListMarker;
  kicker: KickerStyle;
  progress: ProgressStyle;
  headerRule: boolean;
  identity: 'top' | 'bottom-right';
  /** where the cover text block sits in its area */
  coverAnchor: 'bottom' | 'center' | 'top';
  radius: number;
  /** grain overlay opacity, 0 = none */
  grain: number;
  /** hard-edged offset panels instead of soft cards */
  hardShadow: boolean;

  decor: (c: DecorContext) => SatoriElement[];
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  category: 'light' | 'dark' | 'vibrant';
  tokens(kind: SlideKind, p: Palette): Tokens;
}

// ============= SHARED PIECES =============

const INK = '#111114';
const PAPER = '#F6F2EA';

const INTER = (weight: number): FontRef => ({ family: 'Inter', weight });
const BRICOLAGE: FontRef = { family: 'Bricolage Grotesque', weight: 800 };
const SERIF: FontRef = { family: 'Instrument Serif', weight: 400 };
const SERIF_ITALIC: FontRef = { family: 'Instrument Serif', weight: 400, italic: true };
const ANTON: FontRef = { family: 'Anton', weight: 400 };
const MONO = (weight: number): FontRef => ({ family: 'Space Mono', weight });

function fill(style: Record<string, any>, children?: SatoriElement[]): SatoriElement {
  return box({ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', ...style }, children);
}

function circle(size: number, left: number | string, top: number | string, bg: string, extra: Record<string, any> = {}): SatoriElement {
  return box({ position: 'absolute', left, top, width: size, height: size, borderRadius: '50%', background: bg, ...extra });
}

const noDecor = () => [] as SatoriElement[];

/** A rectangular frame drawn as four bars (a bordered empty box only draws its top edge in Satori). */
function frameBorder(w: number, h: number, inset: number, thickness: number, color: string): SatoriElement[] {
  const bar = (top: number, left: number, width: number, height: number) =>
    box({ position: 'absolute', top, left, width, height, background: color });
  return [
    bar(inset, inset, w - inset * 2, thickness),
    bar(h - inset - thickness, inset, w - inset * 2, thickness),
    bar(inset, inset, thickness, h - inset * 2),
    bar(inset, w - inset - thickness, thickness, h - inset * 2),
  ];
}

/** Fill in the tokens every theme shares; a theme overrides what it needs. */
function base(over: Partial<Tokens> & Pick<Tokens, 'kind' | 'dark' | 'bg' | 'fg' | 'accent' | 'display' | 'body' | 'label' | 'numeral'>): Tokens {
  const onAccent = readableOn(over.accent, '#FFFFFF', INK);
  return {
    accentText: ensureContrast(over.accent, over.bg.startsWith('#') ? over.bg : over.fg === '#FFFFFF' ? '#000000' : '#FFFFFF', 3),
    muted: rgba(over.fg, 0.66),
    faint: rgba(over.fg, 0.42),
    rule: rgba(over.fg, over.dark ? 0.16 : 0.14),
    onAccent,
    surface: rgba(over.fg, over.dark ? 0.05 : 0.04),
    surfaceBorder: rgba(over.fg, over.dark ? 0.14 : 0.1),
    displayUpper: false,
    displayTracking: -0.03,
    displayLeading: 1.02,
    coverSize: [104, 148],
    contentSize: [68, 88],
    bodyLeading: 1.38,
    labelTracking: 0.14,
    italic: SERIF_ITALIC,
    highlight: 'marker',
    marker: 'numeral',
    kicker: 'plain',
    progress: 'segments',
    headerRule: false,
    identity: 'top',
    coverAnchor: 'bottom',
    radius: 20,
    grain: 0.06,
    hardShadow: false,
    decor: noDecor,
    ...over,
  };
}

/** Is `hex` a usable brand color (not white-ish, not black-ish)? */
function usable(hex: string | undefined): hex is string {
  if (!hex) return false;
  const l = luminance(hex);
  return l > 0.02 && l < 0.85;
}

/**
 * The brand color that carries a cover or a field: dark enough for white text and not a
 * pastel. The first of primary, secondary, accent that qualifies (the primary is the brand);
 * a brand with only pastels gets the theme's own color, and its pastels become accents.
 */
function brandField(p: Palette, fallback: string): string {
  if (!p.custom) return fallback;
  const ok = [p.primary, p.secondary, p.accent].filter((c) => c && luminance(c) > 0.012 && luminance(c) < 0.42);
  return ok.length ? ok[0] : fallback;
}

// ============= CREATOR (clean, big type, marker highlights) =============

const creator: Theme = {
  id: 'creator',
  name: 'Creator',
  description: 'Bold brand-color cover, clean off-white slides, marker highlights',
  category: 'light',
  tokens(kind, p) {
    const field = brandField(p, '#15151A');
    const paper = mix('#FAF9F5', p.custom ? field : '#FAF9F5', p.custom ? 0.035 : 0);
    if (kind === 'content') {
      const accent = pickAccent(p.custom ? [p.accent, p.secondary, field] : ['#FF5A1F', '#FF7A2F'], paper, 2.6);
      return base({
        kind, dark: false, bg: paper, fg: '#101114', accent,
        display: BRICOLAGE, body: INTER(500), label: INTER(700), numeral: BRICOLAGE,
        highlight: 'marker', marker: 'check', displayTracking: -0.035, grain: 0.045,
        surface: '#FFFFFF', surfaceBorder: 'rgba(16,17,20,0.09)',
        decor: (c) => [
          box({ position: 'absolute', top: 0, left: 0, width: 190, height: 14, background: accent }),
          c.slideNumber % 2 === 0
            ? circle(520, c.w - 300, -240, rgba(accent, 0.07))
            : circle(460, -220, c.h - 260, rgba(accent, 0.07)),
        ],
      });
    }
    const fg = readableOn(field, '#FFFFFF', INK);
    const accent = pickAccent(p.custom ? [p.accent, p.secondary, lighten(field, 0.55)] : ['#FF5A1F', '#FFB020'], field, 1.7);
    return base({
      kind, dark: luminance(field) < 0.45, bg: field, fg, accent,
      display: BRICOLAGE, body: INTER(500), label: INTER(700), numeral: BRICOLAGE,
      highlight: 'marker', marker: 'check', displayTracking: -0.04, grain: 0.07,
      coverSize: [112, 184],
      surface: rgba(fg, 0.1), surfaceBorder: rgba(fg, 0.22),
      decor: (c) => [
        fill({ backgroundImage: `linear-gradient(165deg, ${lighten(field, 0.1)} 0%, ${field} 42%, ${darken(field, 0.32)} 100%)` }),
        circle(760, c.w - 420, -300, rgba('#FFFFFF', 0.07)),
        circle(520, -240, c.h - 300, rgba('#000000', 0.12)),
      ],
    });
  },
};

// ============= EDITORIAL (serif, hairlines, paper) =============

const editorial: Theme = {
  id: 'editorial',
  name: 'Editorial',
  description: 'Serif headlines, italic highlights, hairline rules on warm paper',
  category: 'light',
  tokens(kind, p) {
    const paper = p.custom && luminance(p.background) > 0.8 && p.background.toUpperCase() !== '#FFFFFF' ? p.background : PAPER;
    const ink = '#16130F';
    const accent = pickAccent(p.custom ? [p.accent, p.secondary, p.primary] : ['#C2361A', '#D9480F'], kind === 'cta' ? ink : paper, 3);
    const dark = kind === 'cta';
    const bg = dark ? ink : paper;
    const fg = dark ? PAPER : ink;
    return base({
      kind, dark, bg, fg, accent: dark ? ensureContrast(accent, ink, 3.2) : accent,
      display: SERIF, body: INTER(400), label: MONO(700), numeral: SERIF_ITALIC, italic: SERIF_ITALIC,
      highlight: 'italic', marker: 'numeral', kicker: 'rule', progress: 'line', headerRule: true,
      displayTracking: -0.02, displayLeading: 0.98, bodyLeading: 1.42, labelTracking: 0.1,
      coverSize: [128, 232], contentSize: [78, 112], grain: dark ? 0.06 : 0.085, radius: 4,
      decor: (c) => (kind === 'content' ? [] : [
        box({ position: 'absolute', top: 44, left: 84, width: c.w - 168, height: 3, background: dark ? PAPER : ink }),
        box({ position: 'absolute', top: 54, left: 84, width: c.w - 168, height: 1, background: rgba(dark ? PAPER : ink, 0.5) }),
      ]),
    });
  },
};

// ============= NOIR (dark, crisp, one glowing accent) =============

const noir: Theme = {
  id: 'noir',
  name: 'Noir',
  description: 'Near-black with grain, crisp type and a single glowing accent',
  category: 'dark',
  tokens(kind, p) {
    const tint = p.custom ? brandField(p, '#7C5CFF') : '#6E7BFF';
    const bg = mix('#0A0A0D', tint, 0.09);
    const accent = pickAccent(p.custom ? [p.accent, lighten(tint, 0.15), p.secondary] : ['#D7FF3F', '#B4FF39'], bg, 4.5);
    return base({
      kind, dark: true, bg, fg: '#F3F2EE', accent,
      display: INTER(800), body: INTER(400), label: MONO(400), numeral: INTER(900),
      highlight: 'color', marker: 'square', kicker: 'pill', progress: 'segments',
      displayTracking: -0.045, displayLeading: 1.0, bodyLeading: 1.42, labelTracking: 0.14,
      coverSize: [108, 180], contentSize: [68, 92], grain: 0.075, radius: 22,
      surface: 'rgba(255,255,255,0.045)', surfaceBorder: 'rgba(255,255,255,0.13)',
      decor: () => [
        fill({ backgroundImage: `radial-gradient(circle at ${kind === 'content' ? 88 : 82}% ${kind === 'content' ? 4 : 10}%, ${rgba(accent, kind === 'content' ? 0.16 : 0.3)} 0%, ${rgba(accent, 0)} 52%)` }),
        ...(kind === 'cover' ? [fill({ backgroundImage: `radial-gradient(circle at 6% 96%, ${rgba(tint, 0.2)} 0%, ${rgba(tint, 0)} 46%)` })] : []),
      ],
    });
  },
};

// ============= HALFTONE (gritty poster: grain, halftone, condensed caps, red) =============

const halftone: Theme = {
  id: 'halftone',
  name: 'Halftone',
  description: 'Gritty print poster: grain, halftone dots, condensed caps, one red accent',
  category: 'dark',
  tokens(kind, p) {
    const bg = '#0F0D0C';
    const fg = '#EFE9DD';
    const accent = p.custom ? pickAccent([p.accent, p.primary, p.secondary], bg, 3.2) : '#E0301E';
    return base({
      kind, dark: true, bg, fg, accent,
      display: ANTON, body: INTER(500), label: MONO(700), numeral: ANTON,
      highlight: 'tape', marker: 'square', kicker: 'tag', progress: 'segments', identity: 'bottom-right',
      displayUpper: true, displayTracking: 0.005, displayLeading: 0.98, bodyLeading: 1.36, labelTracking: 0.12,
      coverSize: [140, 290], contentSize: [80, 150], coverAnchor: 'top', grain: 0.2, radius: 2,
      surface: 'rgba(239,233,221,0.06)', surfaceBorder: 'rgba(239,233,221,0.28)',
      decor: (c) => [
        c.assets.halftone
          ? fill({ backgroundImage: `url(${c.assets.halftone})`, backgroundSize: `${c.w}px ${c.h}px`, opacity: kind === 'content' ? 0.13 : 0.2, ...(c.slideNumber % 2 === 0 ? { transform: 'scaleX(-1)' } : {}) })
          : fill({}),
        ...frameBorder(c.w, c.h, 30, 2, rgba(fg, 0.2)),
      ],
    });
  },
};

// ============= BRUTALIST (color blocks, thick borders, hard shadows) =============

const brutalist: Theme = {
  id: 'brutalist',
  name: 'Brutalist',
  description: 'Flat color blocks, thick ink borders, hard offset shadows, mono labels',
  category: 'vibrant',
  tokens(kind, p) {
    const block = p.custom ? (usable(p.accent) ? p.accent : brandField(p, '#FFD60A')) : '#FFD60A';
    const ink = '#0E0E0E';
    if (kind === 'content') {
      const bg = '#EFEBE1';
      const accent = pickAccent(p.custom ? [p.accent, block, p.secondary] : ['#FFD60A', '#FF5A36'], bg, 1.15);
      return base({
        kind, dark: false, bg, fg: ink, accent,
        display: INTER(900), body: INTER(500), label: MONO(700), numeral: INTER(900),
        highlight: 'marker', marker: 'numeral', kicker: 'tag', progress: 'segments',
        displayUpper: true, displayTracking: -0.03, displayLeading: 0.98, labelTracking: 0.06,
        accentText: ink, contentSize: [62, 82], radius: 0, grain: 0.06, hardShadow: true,
        surface: '#FFFFFF', surfaceBorder: ink, rule: ink,
        decor: (c) => frameBorder(c.w, c.h, 28, 6, ink),
      });
    }
    const fg = readableOn(block, '#FFFFFF', ink);
    const accent = fg === ink ? ink : '#FFFFFF';
    return base({
      kind, dark: luminance(block) < 0.4, bg: block, fg, accent,
      display: INTER(900), body: INTER(500), label: MONO(700), numeral: INTER(900),
      highlight: 'marker', marker: 'numeral', kicker: 'tag', progress: 'segments',
      displayUpper: true, displayTracking: -0.03, displayLeading: 0.96, labelTracking: 0.06,
      coverSize: [100, 170], radius: 0, grain: 0.06, hardShadow: true, coverAnchor: 'center',
      surface: fg === ink ? '#FFFFFF' : ink, surfaceBorder: ink, rule: fg,
      decor: (c) => frameBorder(c.w, c.h, 28, 6, ink),
    });
  },
};

// ============= SPOTLIGHT (immersive brand-color field) =============

const spotlight: Theme = {
  id: 'spotlight',
  name: 'Spotlight',
  description: 'Immersive brand-color field with grain, oversized type, white marker highlights',
  category: 'vibrant',
  tokens(kind, p) {
    const field = brandField(p, '#F0481F');
    const alt = kind === 'content';
    const tone = alt ? darken(field, 0.42) : field;
    const fg = readableOn(tone, '#FFFFFF', INK);
    const accent = fg === '#FFFFFF' ? '#FFFFFF' : INK;
    return base({
      kind, dark: luminance(tone) < 0.4, bg: tone, fg, accent,
      display: BRICOLAGE, body: INTER(500), label: INTER(700), numeral: BRICOLAGE,
      highlight: 'marker', marker: 'check', kicker: 'pill', progress: 'segments',
      displayTracking: -0.04, displayLeading: 1.0, labelTracking: 0.16,
      coverSize: [116, 184], contentSize: [70, 94], grain: 0.075, radius: 22,
      surface: rgba(fg, 0.1), surfaceBorder: rgba(fg, 0.24),
      decor: (c) => [
        fill({ backgroundImage: `linear-gradient(${alt ? 200 : 160}deg, ${alt ? darken(field, 0.3) : lighten(field, 0.12)} 0%, ${tone} 46%, ${darken(tone, 0.34)} 100%)` }),
        circle(c.w * 0.86, c.w * 0.36, -c.w * 0.4, rgba('#FFFFFF', alt ? 0.05 : 0.09)),
        circle(c.w * 0.62, -c.w * 0.3, c.h - c.w * 0.34, rgba('#000000', 0.13)),
      ],
    });
  },
};

// ============= REGISTRY =============

const THEMES: Theme[] = [creator, editorial, noir, halftone, brutalist, spotlight];

export const THEME_MAP: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** Old template ids keep resolving: each maps to the nearest theme. */
export const TEMPLATE_ALIASES: Record<string, string> = {
  classic: 'creator',
  minimal_grid: 'creator',
  soft_wave: 'creator',
  midnight: 'noir',
  neon_frame: 'noir',
  gradient_orbs: 'noir',
  ink_blot: 'noir',
  duotone: 'spotlight',
  mesh: 'spotlight',
  geometric: 'spotlight',
  split_screen: 'brutalist',
  corner_accent: 'editorial',
  magazine: 'editorial',
  photo_frame: 'editorial',
  poster: 'halftone',
};

export const DEFAULT_THEME_ID = 'creator';

export function resolveThemeId(id: string | undefined | null): string {
  if (id && THEME_MAP[id]) return id;
  if (id && TEMPLATE_ALIASES[id]) return TEMPLATE_ALIASES[id];
  return DEFAULT_THEME_ID;
}

export function getTheme(id: string | undefined | null): Theme {
  return THEME_MAP[resolveThemeId(id)];
}

export function getAllThemes(): Theme[] {
  return THEMES;
}

