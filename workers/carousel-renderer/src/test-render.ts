/**
 * Contact-sheet harness: renders fixture decks through the REAL renderer code
 * (carousel-slide-renderer.ts: same fonts, layouts, sanitizing and resvg child
 * process as production) and writes PNGs, plus a manifest that make-sheets.py
 * assembles into contact sheets.
 *
 *   npm run build && node dist/test-render.js --out <dir> \
 *     [--themes creator,editorial,...] [--aspects portrait,square] \
 *     [--decks prod,stat-heavy,...] [--brands none,blue] [--logo none|square|wide]
 *
 * Layout warnings (text that had to be trimmed, list items dropped) are collected
 * into <dir>/warnings.txt so overflow is a checked property, not just an eyeball.
 *
 * Every slide also goes through the automated layout check (layout-check.ts): the real
 * Satori geometry is scanned for text that overlaps other text or leaves the safe area.
 * Violations are written to <dir>/violations.txt and the process exits 1 if there are any.
 */

import fs from 'node:fs';
import path from 'node:path';
import { renderSlide, prepareLogo, slideToSvg, type CarouselStyle } from './carousel-slide-renderer.js';
import { checkLayout } from './layout-check.js';
import { getAllTemplates } from './carousel-templates.js';
import { BRANDS, DECKS as BASE_DECKS, LOGOS, type Deck } from './test-fixtures.js';
import { toSlideInput } from './slide-input.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Production bodies after the slide-copy normalizer (see supabase/.../dump_normalized_prod_bodies.ts):
// the "after" path end to end, drawn through the same slide-input mapping the worker uses.
const NORMALIZED = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-data', 'prod-bodies-normalized.json');
const DECKS: Deck[] = [...BASE_DECKS];
if (fs.existsSync(NORMALIZED)) {
  for (const entry of JSON.parse(fs.readFileSync(NORMALIZED, 'utf8')) as Array<{ id: string; slide: any }>) {
    DECKS.push({ id: `prodnorm-${entry.id}`, title: `Normalized prod body: ${entry.id}`, slides: [toSlideInput(entry.slide, 1, 3, '')] });
  }
}

// The overlong deck from the layout-aware slide editor (people paste text far longer than
// the AI writes), plus a synthetic one three times longer with hostile shapes: one unbroken
// long word, a 20-character keyword and stat value, 8 list items.
const TEST_DATA = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'test-data');
const LONG = path.join(TEST_DATA, 'long-edit-deck.json');
if (fs.existsSync(LONG)) {
  const raw = JSON.parse(fs.readFileSync(LONG, 'utf8')) as any[];
  DECKS.push({ id: 'long-edit', title: 'Overlong edited deck', slides: raw.map((s, i) => toSlideInput(s, i, raw.length, '')) });
  const more = (t: string) => `${t} ${t}`.slice(0, 260);
  const extreme = raw.map((s) => {
    const o: any = { ...s };
    for (const k of ['kicker', 'headline', 'body', 'before', 'after', 'stat_label', 'lead', 'footnote', 'cta_reason']) if (typeof o[k] === 'string') o[k] = more(o[k]);
    if (Array.isArray(o.items)) o.items = [...o.items, ...o.items].slice(0, 8).map(more);
    if (o.type === 'cover') o.headline = `${o.headline} Supercalifragilisticexpialidocious-pricing-page-conversion-optimisation-framework`;
    if (o.stat_value) o.stat_value = '$1,250,000,000.00';
    if (o.cta_keyword) o.cta_keyword = 'TRANSFORMATIONALLEADERSHIP';
    return o;
  });
  DECKS.push({ id: 'extreme', title: 'Synthetic extreme deck', slides: extreme.map((s, i) => toSlideInput(s, i, extreme.length, '')) });
}

const OUT = arg('out', '/tmp/carousel-renders');
const themes = arg('themes', getAllTemplates().map((t) => t.id).join(',')).split(',').filter(Boolean);
const aspects = arg('aspects', 'portrait,square').split(',').filter(Boolean);
const deckIds = arg('decks', DECKS.map((d) => d.id).join(',')).split(',').filter(Boolean);
const brandIds = arg('brands', 'none').split(',').filter(Boolean);
const logoKind = arg('logo', 'none');

const DIMS: Record<string, { w: number; h: number }> = { portrait: { w: 1080, h: 1350 }, square: { w: 1080, h: 1080 }, story: { w: 1080, h: 1920 } };

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const logo = logoKind === 'none' ? undefined : (await prepareLogo(LOGOS[logoKind as keyof typeof LOGOS])) ?? undefined;
  if (logoKind !== 'none') console.log(`logo ${logoKind}: ${logo ? `aspect ${logo.aspect.toFixed(2)}` : 'FAILED to prepare'}`);

  const manifest: Array<{ file: string; deck: string; theme: string; aspect: string; brand: string; n: number }> = [];
  const warnings: string[] = [];
  const violations: string[] = [];
  let count = 0;
  const started = Date.now();

  for (const brandId of brandIds) {
    const brand = BRANDS[brandId] ?? {};
    for (const themeId of themes) {
      const style: CarouselStyle = { template: themeId, palette: brand.palette };
      for (const aspect of aspects) {
        const dim = DIMS[aspect];
        for (const deck of DECKS.filter((d) => deckIds.includes(d.id))) {
          for (let i = 0; i < deck.slides.length; i++) {
            const slide = deck.slides[i];
            // fixtures that hold several CTAs reuse slide 3: give them distinct filenames
            const idx = deck.id === 'cta-keyword' ? i + 1 : slide.slide_number;
            const tag = `${deck.id}__${themeId}__${aspect}__${brandId}${logoKind !== 'none' ? `__logo-${logoKind}` : ''}__${String(idx).padStart(2, '0')}`;
            try {
              const opts = {
                width: dim.w,
                height: dim.h,
                authorName: brand.name,
                authorHandle: brand.handle,
                logo,
                onWarn: (m: string) => warnings.push(`${tag}: ${m}`),
              };
              const total = deck.id === 'cta-keyword' ? 3 : deck.slides.length;
              const png = await renderSlide(slide, style, total, opts);
              // geometry check on the same layout (text kept as <text> elements instead of paths)
              const geo = await slideToSvg(slide, style, total, { ...opts, onWarn: () => {} }, false);
              // every string the slide can draw, so the check can tell a whole word from a cut one
              const drawn = [...Object.values(slide).flat(), brand.name, brand.handle].filter((v) => typeof v === 'string').join(' ');
              for (const v of checkLayout(geo.svg, geo.width, geo.height, drawn)) violations.push(`${tag}: ${v.kind}: ${v.message}`);
              const file = `${tag}.png`;
              fs.writeFileSync(path.join(OUT, file), png);
              manifest.push({ file, deck: deck.id, theme: themeId, aspect, brand: brandId, n: idx });
              count++;
            } catch (err: any) {
              warnings.push(`${tag}: RENDER FAILED ${err.message}`);
              console.error(`FAILED ${tag}: ${err.message}`);
            }
          }
        }
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  fs.writeFileSync(path.join(OUT, 'warnings.txt'), warnings.join('\n') + (warnings.length ? '\n' : ''));
  fs.writeFileSync(path.join(OUT, 'violations.txt'), violations.join('\n') + (violations.length ? '\n' : ''));
  console.log(`rendered ${count} slides in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${OUT}`);
  console.log(`layout warnings: ${warnings.length}`);
  for (const w of warnings.slice(0, 40)) console.log(`  ${w}`);
  console.log(`layout check: ${violations.length} violation(s) in ${count} slides`);
  for (const v of violations.slice(0, 60)) console.log(`  ${v}`);
  if (violations.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
