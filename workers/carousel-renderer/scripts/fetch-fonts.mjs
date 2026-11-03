#!/usr/bin/env node
/**
 * Vendor the carousel fonts into assets/fonts/ (static TTF instances).
 *
 * Every family here is licensed under the SIL Open Font License 1.1, which
 * allows bundling and redistribution. Satori cannot read variable fonts or
 * WOFF2, so this asks the Google Fonts CSS API (with a non-browser user agent)
 * for one static TTF instance per family/weight/style, the same technique the
 * renderer used to use at runtime.
 *
 * Usage (from workers/carousel-renderer):  node scripts/fetch-fonts.mjs [--force]
 * Run it once, commit assets/fonts/. The worker reads the files from disk and
 * never contacts Google Fonts for these families.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'fonts');
const FORCE = process.argv.includes('--force');

// family (Google Fonts name), then [weight, italic] instances, then the file stem used on disk.
const FONTS = [
  { family: 'Inter', stem: 'Inter', instances: [[400, false], [500, false], [700, false], [800, false], [900, false]] },
  { family: 'Instrument Serif', stem: 'InstrumentSerif', instances: [[400, false], [400, true]] },
  { family: 'Anton', stem: 'Anton', instances: [[400, false]] },
  { family: 'Bricolage Grotesque', stem: 'BricolageGrotesque', instances: [[700, false], [800, false]] },
  { family: 'Space Mono', stem: 'SpaceMono', instances: [[400, false], [700, false]] },
];

const weightName = { 400: 'Regular', 500: 'Medium', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };

async function fetchInstance(family, weight, italic) {
  const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
  const css = await (await fetch(cssUrl, { headers: { 'User-Agent': 'satori' } })).text();
  const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/) || css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!match) throw new Error(`No font URL in CSS for ${family} ${weight}${italic ? ' italic' : ''}: ${css.slice(0, 200)}`);
  const res = await fetch(match[1]);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${match[1]}`);
  return Buffer.from(await res.arrayBuffer());
}

function looksLikeSfnt(buf) {
  const tag = buf.subarray(0, 4).toString('latin1');
  return buf.length > 10_000 && (buf.readUInt32BE(0) === 0x00010000 || tag === 'true' || tag === 'OTTO');
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const { family, stem, instances } of FONTS) {
  for (const [weight, italic] of instances) {
    const style = weight === 400 ? (italic ? 'Italic' : 'Regular') : `${weightName[weight]}${italic ? 'Italic' : ''}`;
    const dest = path.join(OUT, `${stem}-${style}.ttf`);
    if (fs.existsSync(dest) && !FORCE) {
      console.log(`skip  ${path.basename(dest)} (exists)`);
      continue;
    }
    const data = await fetchInstance(family, weight, italic);
    if (!looksLikeSfnt(data)) throw new Error(`${family} ${weight}: response is not a TrueType/OpenType file (${data.length} bytes)`);
    fs.writeFileSync(dest, data);
    total += data.length;
    console.log(`saved ${path.basename(dest)} (${(data.length / 1024).toFixed(0)} KB)`);
  }
}
console.log(`done, ${(total / 1024).toFixed(0)} KB written to ${OUT}`);
