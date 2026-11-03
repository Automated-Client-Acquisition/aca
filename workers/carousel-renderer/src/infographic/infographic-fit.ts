/**
 * Measuring for infographic layouts. Same text metrics as the carousels (Satori cannot
 * measure), and the same rule: an estimate may come out a line too many, never a line
 * too few, so a fitted block can only end up with spare room.
 */

import { type FontRef, clampToLines, textWidth, wrapLines } from '../carousel-kit.js';

/** Linear blend between a size at scale 0 and at scale 1, on a half-pixel grid. */
export const lerp = (a: number, b: number, s: number) => Math.round((a + (b - a) * s) * 2) / 2;

export const width = (font: FontRef, s: string, size: number, tracking = 0, upper = false) =>
  textWidth(font, upper ? s.toUpperCase() : s, size, tracking);

/** Lines a text takes in a box `w` wide (0 for no text). */
export function nLines(font: FontRef, s: string, size: number, w: number, tracking = 0, upper = false): number {
  if (!s) return 0;
  return Math.max(1, wrapLines(font, upper ? s.toUpperCase() : s, size, w, tracking).length);
}

export interface Clamped {
  text: string;
  lines: number;
  clamped: boolean;
}

/** The text cut to at most `max` lines (ending in "..."), and the lines it then takes. */
export function clampLines(font: FontRef, s: string, size: number, w: number, max: number, tracking = 0, upper = false): Clamped {
  const n = nLines(font, s, size, w, tracking, upper);
  if (n <= max) return { text: s, lines: n, clamped: false };
  const cut = clampToLines(s, max, (x) => nLines(font, x, size, w, tracking, upper));
  return { text: cut, lines: nLines(font, cut, size, w, tracking, upper), clamped: true };
}

/**
 * Largest scale in [0, max] whose measured height fits `budget` (steps of 0.05). Scale 1 is
 * the dense design size; above 1, sizes keep growing so thin content fills the page
 * instead of sitting small in the middle. `fits` is false when even scale 0 is too tall;
 * the caller then drops or cuts content.
 */
export function bestScale(measure: (s: number) => number, budget: number, max = 1): { s: number; height: number; fits: boolean } {
  for (let i = Math.round(max * 20); i >= 0; i--) {
    const s = i / 20;
    const h = measure(s);
    if (h <= budget) return { s, height: h, fits: true };
  }
  return { s: 0, height: measure(0), fits: false };
}

/** Rows a flex-wrap line of items takes (`gap` between items on a row). */
export function wrapRows(widths: number[], max: number, gap: number): number {
  if (!widths.length) return 0;
  let rows = 1;
  let cur = 0;
  for (const w of widths) {
    if (cur === 0) cur = w;
    else if (cur + gap + w <= max) cur += gap + w;
    else {
      rows++;
      cur = w;
    }
  }
  return rows;
}
