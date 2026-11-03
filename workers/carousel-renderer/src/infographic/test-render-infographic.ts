/**
 * Infographic harness: every fixture × brand × theme through the real renderer code, plus
 * three checks per render:
 *   - layout check (layout-check.ts): text overlapping text, or leaving the page margins
 *   - spill check: the page rendered again with every container clipping what it holds;
 *     any pixel that changes was drawn outside its box (text running out of a card)
 *   - warnings: what the fitter had to drop or cut
 * plus a few spec checks (parsing, the number guard, the fallback).
 *
 *   npm run build && node dist/infographic/test-render-infographic.js --out <dir> [--only pyramid-normal,...]
 *
 * Exits 1 on any layout violation, spill or failed spec check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { box } from '../carousel-kit.js';
import { loadFonts, sanitizeSvg } from '../carousel-slide-renderer.js';
import { satoriIsolated } from '../satori-pool.js';
import { checkLayout } from '../layout-check.js';
import { F, H, T, W } from './infographic-kit.js';
import { infographicToSvg, type InfographicInput } from './infographic-renderer.js';
import { FIXTURE_BRANDS, FIXTURES } from './infographic-fixtures.js';
import { fallbackToReferenceSheet, isRenderable, normalizeSpec, numbersNotInPost, specText } from './spec.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = arg('out', '/tmp/infographic-renders');
const ONLY = arg('only', '').split(',').filter(Boolean);
const THEMES = ['light', 'dark'] as const;

function pixels(svg: string): Uint8Array {
  return new Resvg(sanitizeSvg(svg), { fitTo: { mode: 'width', value: W } }).render().pixels;
}

/**
 * Regions that differ between the normal render and the clipped one. Thin slivers are a
 * glyph's own overhang at a box edge (a descender below the last line box, a 1px
 * overshoot on right-aligned text), so only regions taller than 5px and wider than 2px
 * count: a line of text pushed out of its card is at least an x-height tall.
 */
function diff(a: Uint8Array, b: Uint8Array): { count: number; regions: string[] } {
  const hot = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < a.length; i += 4, p++) {
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 40) hot[p] = 1;
  }
  const regions: string[] = [];
  let count = 0;
  const stack: number[] = [];
  for (let p = 0; p < hot.length; p++) {
    if (hot[p] !== 1) continue;
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
    hot[p] = 2;
    stack.push(p);
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % W;
      const y = (q - x) / W;
      n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      // 8-connected, with a 2px reach so anti-aliased glyph fragments join up
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx;
        if (hot[r] === 1) { hot[r] = 2; stack.push(r); }
      }
    }
    if (y1 - y0 + 1 > 5 && x1 - x0 + 1 > 2) {
      count += n;
      regions.push(`${x0},${y0}-${x1},${y1}`);
    }
  }
  return { count, regions };
}

function specChecks(): string[] {
  const failures: string[] = [];
  const expect = (ok: boolean, what: string) => { if (!ok) failures.push(what); };

  const fenced = '```json\n' + JSON.stringify(FIXTURES[0].spec) + '\n```';
  const n = normalizeSpec(fenced);
  expect(!!n.spec && n.errors.length === 0, `fenced JSON parses cleanly (errors: ${n.errors.join('; ')})`);
  expect(normalizeSpec('not json').spec === null, 'garbage is rejected');
  expect(normalizeSpec(FIXTURES[0].spec, 'three_column').errors.some((e) => e.includes('layout must be')), 'a pinned layout mismatch is an error');

  const post = 'The 4 layers. Under 80 words, 1 line, layer 1 or 2. Bounce rate under 3%. 2-3 inboxes, 14 days of warmup. 95%+ inbox placement. The right 500 beat a random 5,000.';
  const missing = numbersNotInPost(n.spec!, post);
  expect(missing.length === 0, `numbers in the post are accepted (flagged: ${missing.join(', ')})`);
  expect(numbersNotInPost(n.spec!, 'no numbers here').includes('95'), 'numbers not in the post are flagged');

  const thin = normalizeSpec({ ...(FIXTURES[0].spec as any), data: { ...(FIXTURES[0].spec as any).data, layers: [(FIXTURES[0].spec as any).data.layers[0]] } });
  expect(thin.errors.some((e) => e.includes('pyramid layers')), 'a 1-layer pyramid breaks the contract');
  expect(!!thin.spec && !isRenderable(thin.spec), 'a 1-layer pyramid is not renderable');
  const fb = fallbackToReferenceSheet(thin.spec!);
  expect(fb.layout === 'reference_sheet' && isRenderable(fb), 'the fallback is a renderable sheet');

  const hl = normalizeSpec({ ...(FIXTURES[0].spec as any), highlight: 'not in it' });
  expect(!!hl.spec && hl.spec.highlight.length > 0 && hl.warnings.some((w) => w.includes('highlight')), 'a highlight not in the headline is replaced');
  return failures;
}

/** The spill check must catch a real spill: three lines of text in a box one line tall. */
async function spillSelfTest(): Promise<string[]> {
  const fonts = await loadFonts();
  const page = (clip: boolean) => box({ width: W, height: H, background: '#FFFFFF', padding: 100 }, [
    box({ width: 300, height: 24, ...(clip ? { overflow: 'hidden' } : {}) }, T('A line that wraps onto a second line and then a third one', F.medium, 18, '#111111')),
  ]);
  const render = async (clip: boolean) => pixels(await satori(page(clip), { width: W, height: H, fonts: fonts as any }));
  const d = diff(await render(false), await render(true));
  return d.regions.length ? [] : ['spill self-test: a box overflowing by two lines was not caught'];
}

/**
 * A layout Satori loops on (a glyph wider than its box) must time out in the worker thread
 * instead of hanging the process, and the next render must work on a fresh thread.
 */
async function hangSelfTest(): Promise<string[]> {
  const hang = box({ width: 400, height: 100 }, [box({ width: 12, flexShrink: 0 }, T('+', F.black, 18, '#111111'))]);
  const ok = box({ width: 400, height: 100 }, T('fine', F.medium, 18, '#111111'));
  const job = { width: 400, height: 100, embedFont: true };
  const started = Date.now();
  let timedOut = false;
  try {
    await satoriIsolated(hang, job, 2000);
  } catch (e: any) {
    timedOut = /timed out/.test(e.message);
  }
  const out: string[] = [];
  if (!timedOut) out.push('hang self-test: the looping layout did not time out');
  if (Date.now() - started > 6000) out.push('hang self-test: the timeout took too long');
  try {
    const svg = await satoriIsolated(ok, job, 10000);
    if (!svg.startsWith('<svg')) out.push('hang self-test: the render after the timeout returned no SVG');
  } catch (e: any) {
    out.push(`hang self-test: the render after the timeout failed: ${e.message}`);
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const failures = [...specChecks(), ...(await spillSelfTest()), ...(await hangSelfTest())];
  for (const f of failures) console.log(`SPEC CHECK FAILED: ${f}`);

  const manifest: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const problems: string[] = [];
  const started = Date.now();
  let count = 0;

  for (const fx of FIXTURES.filter((f) => !ONLY.length || ONLY.includes(f.id))) {
    for (const brand of FIXTURE_BRANDS) {
      for (const theme of THEMES) {
        const tag = `${fx.id}__${brand.id}__${theme}`;
        const input: InfographicInput = { spec: fx.spec, colors: brand.colors, theme, identity: brand.identity };
        try {
          const normal = await infographicToSvg(input);
          const base = pixels(normal.svg);
          fs.writeFileSync(path.join(OUT, `${tag}.png`), new Resvg(sanitizeSvg(normal.svg), { fitTo: { mode: 'width', value: W } }).render().asPng());

          const clipped = await infographicToSvg({ ...input, clip: true });
          const spill = diff(base, pixels(clipped.svg));
          if (spill.regions.length) problems.push(`${tag}: spill: ${spill.count} px drawn outside their box (${spill.regions.slice(0, 4).join(' ')})`);

          const geo = await infographicToSvg(input, false);
          const drawn = [...specText(normal.spec), brand.identity.name, brand.identity.handle].join(' ');
          for (const v of checkLayout(geo.svg, W, H, drawn, 40, 30).filter((x) => x.kind === 'overlap' || x.kind === 'outside' || x.kind === 'cut')) {
            problems.push(`${tag}: ${v.kind}: ${v.message}`);
          }
          for (const w of normal.warnings) warnings.push(`${tag}: ${w}`);
          manifest.push({ file: `${tag}.png`, fixture: fx.id, group: fx.group, brand: brand.id, theme, layout: normal.layout, warnings: normal.warnings.length, spill: spill.count });
          count++;
        } catch (err: any) {
          problems.push(`${tag}: RENDER FAILED ${err.message}`);
          console.error(`FAILED ${tag}: ${err.stack}`);
        }
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(OUT, 'warnings.txt'), warnings.join('\n') + (warnings.length ? '\n' : ''));
  fs.writeFileSync(path.join(OUT, 'problems.txt'), problems.join('\n') + (problems.length ? '\n' : ''));
  console.log(`rendered ${count} infographics in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${OUT}`);
  console.log(`spec checks: ${failures.length ? `${failures.length} FAILED` : 'ok'}`);
  console.log(`warnings: ${warnings.length}`);
  console.log(`problems (layout check + spill): ${problems.length}`);
  for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
  if (problems.length || failures.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
