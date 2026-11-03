/**
 * Infographic renderer: spec + brand → Satori tree → SVG → PNG.
 *
 * The spec is normalized again here (a hand-edited spec must never break a render) and
 * falls back to a reference sheet when its layout can't be drawn. The page is fitted in
 * up to three attempts: everything; without the subtitle; then with the layout's own
 * drops and cuts. Whatever had to give way is returned in `warnings`.
 */

import type { SatoriElement } from '../carousel-kit.js';
import { renderSvgToPng, sanitizeSvg } from '../carousel-slide-renderer.js';
import { satoriIsolated } from '../satori-pool.js';
import { type InfographicLayout, type InfographicSpec, fallbackToReferenceSheet, isRenderable, normalizeSpec } from './spec.js';
import { type BrandColors, type Env, type Identity, type Theme, type ThemeChoice, H, W, brandPalette, infographicTokens } from './infographic-kit.js';
import { bodyBudget, drawPage, prepareFooter, prepareHeader, prepareTakeaway } from './infographic-page.js';
import { type Laid, prepareSheet, preparePyramid, prepareThreeColumn } from './infographic-layouts.js';

export interface InfographicInput {
  /** a spec, or the raw JSON/string a model or editor produced */
  spec: unknown;
  colors?: BrandColors | null;
  theme?: ThemeChoice;
  identity: Identity;
  /** spill-check mode: every container clips what it holds */
  clip?: boolean;
}

export interface BuiltInfographic {
  element: SatoriElement;
  spec: InfographicSpec;
  layout: InfographicLayout;
  theme: Theme;
  warnings: string[];
}

function prepareLayout(spec: InfographicSpec, budget: number, allowDrops: boolean, env: Env): Laid {
  switch (spec.layout) {
    case 'pyramid':
      return preparePyramid(spec, budget, allowDrops, env);
    case 'three_column':
      return prepareThreeColumn(spec, budget, allowDrops, env);
    case 'reference_sheet':
      return prepareSheet(spec, budget, allowDrops, env);
  }
}

export function buildInfographic(input: InfographicInput): BuiltInfographic {
  const n = normalizeSpec(input.spec);
  if (!n.spec) throw new Error(`infographic spec is unusable: ${n.errors.join('; ')}`);
  let spec = n.spec;
  const warnings = [...n.warnings];
  if (!isRenderable(spec)) {
    warnings.push(`${spec.layout} can't be drawn from this content; drawn as a reference sheet`);
    spec = fallbackToReferenceSheet(spec);
    if (!isRenderable(spec)) throw new Error('infographic spec has nothing to draw');
  }

  const palette = brandPalette(input.colors, input.theme ?? 'auto');
  const t = infographicTokens(palette);
  const clip = !!input.clip;

  const attempt = (withSub: boolean, allowDrops: boolean) => {
    const notes: string[] = [];
    const env: Env = { clip, warn: (m) => notes.push(m) };
    const head = prepareHeader(spec, withSub, env);
    const bar = prepareTakeaway(spec.takeaway, env);
    const foot = prepareFooter(input.identity, env);
    const budget = bodyBudget(head.height, bar.height);
    const body = prepareLayout(spec, budget, allowDrops, env);
    return { env, notes, head, bar, foot, budget, body };
  };

  let a = attempt(true, false);
  if (!a.body.fits && spec.sub) {
    a = attempt(false, false);
    a.notes.push('subtitle dropped: no room');
  }
  if (!a.body.fits) {
    const hadSub = !!spec.sub;
    a = attempt(false, true);
    if (hadSub) a.notes.push('subtitle dropped: no room');
  }
  if (!a.body.fits) a.notes.push(`${spec.layout} still taller than the page (${Math.round(a.body.height)}px for ${Math.round(a.budget)}px)`);

  return {
    element: drawPage(t, a.env, a.head, a.body, a.budget, a.bar, a.foot),
    spec,
    layout: spec.layout,
    theme: palette.theme,
    warnings: [...warnings, ...a.notes],
  };
}

/** The infographic as SVG. `embedFont: false` keeps text as <text> for the layout check. */
export async function infographicToSvg(input: InfographicInput, embedFont = true): Promise<BuiltInfographic & { svg: string }> {
  const built = buildInfographic(input);
  // in the satori worker thread: a layout that loops can't hang the server
  const svg = await satoriIsolated(built.element, { width: W, height: H, embedFont });
  return { ...built, svg };
}

/** The infographic as PNG, rasterized in the isolated resvg child process (2x = 2160x2700). */
export async function renderInfographicPng(input: InfographicInput, scale = 2): Promise<BuiltInfographic & { png: Uint8Array; width: number; height: number }> {
  const { svg, ...built } = await infographicToSvg(input);
  const png = await renderSvgToPng(sanitizeSvg(svg), W * scale);
  return { ...built, png, width: W * scale, height: H * scale };
}
