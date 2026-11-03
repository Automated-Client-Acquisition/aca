/**
 * Carousel Slide Renderer (Node.js version)
 *
 * Renders carousel slides as PNG images from structured text content + brand voice.
 * Uses Satori (HTML/CSS → SVG) + @resvg/resvg-js (SVG → PNG) for server-side rendering.
 *
 * IMPORTANT: resvg rendering runs in an isolated worker thread so that a native Rust
 * panic (geom.rs unwrap on None) only kills the worker thread, not the main process.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { satoriIsolated } from './satori-pool.js';
import { FONT_FACES, getTemplate, type LogoAsset, type Palette, type RenderAssets, type RenderOptions, type SlideContent } from './carousel-templates.js';

// ============= TYPES =============

export type { SlideContent, RenderOptions, LogoAsset } from './carousel-templates.js';

export interface CarouselStyle {
  palette?: {
    primary?: string;
    secondary?: string;
    background?: string;
    text?: string;
    accent?: string;
  };
  fontStyle?: string;
  accentStyle?: string;
  visualTemplate?: string;
  template?: string;
  logo?: string;
  backgroundImage?: string;
}

// ============= FONT + ASSET LOADING =============

// Fonts and textures are vendored in assets/ (see scripts/fetch-fonts.mjs): the
// worker never contacts Google Fonts for them. assets/ sits next to both src/ and
// dist/, so the same path works under tsx and after tsc.
const __dirname_ = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname_, '..', 'assets');

type LoadedFont = { name: string; data: Buffer | ArrayBuffer; weight: 400 | 500 | 700 | 800 | 900 | number; style: 'normal' | 'italic' };
let fontPromise: Promise<LoadedFont[]> | null = null;

/** Runtime fallback for a missing vendored Inter (should never be needed). */
async function fetchInterFromGoogle(weight: number): Promise<ArrayBuffer> {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&display=swap`, { headers: { 'User-Agent': 'satori' } })).text();
  const m = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!m) throw new Error('Could not extract font URL from Google Fonts CSS');
  return (await fetch(m[1])).arrayBuffer();
}

/** The vendored font faces, loaded once. Exported for the infographic renderer. */
export async function loadFonts(): Promise<LoadedFont[]> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    const fonts: LoadedFont[] = [];
    const missing: typeof FONT_FACES = [];
    for (const face of FONT_FACES) {
      const file = path.join(ASSETS_DIR, 'fonts', face.file);
      try {
        fonts.push({ name: face.family, data: fs.readFileSync(file), weight: face.weight, style: face.italic ? 'italic' : 'normal' });
      } catch {
        missing.push(face);
      }
    }
    if (missing.length) {
      console.warn(`[loadFonts] ${missing.length} vendored font file(s) missing (${missing.map((m) => m.file).join(', ')}); falling back to Inter`);
      const inter = fonts.find((f) => f.name === 'Inter' && f.weight === 700)?.data ?? (await fetchInterFromGoogle(700));
      for (const face of missing) fonts.push({ name: face.family, data: inter, weight: face.weight, style: face.italic ? 'italic' : 'normal' });
    }
    console.log(`[loadFonts] ${fonts.length} font faces loaded from ${ASSETS_DIR}`);
    return fonts;
  })().catch((err) => { fontPromise = null; throw err; });
  return fontPromise;
}

let assetsCache: RenderAssets | null = null;

export function loadAssets(): RenderAssets {
  if (assetsCache) return assetsCache;
  const read = (name: string): string | undefined => {
    try {
      return `data:image/png;base64,${fs.readFileSync(path.join(ASSETS_DIR, name)).toString('base64')}`;
    } catch {
      console.warn(`[loadAssets] ${name} missing; texture skipped`);
      return undefined;
    }
  };
  assetsCache = { grain: read('grain.png'), halftone: read('halftone.png') };
  return assetsCache;
}

// ============= LOGO =============

function pngSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  return null;
}

function jpegSize(b: Buffer): { w: number; h: number } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function svgSize(text: string): { w: number; h: number } | null {
  const vb = text.match(/viewBox\s*=\s*"([\d.\s-]+)"/);
  if (vb) {
    const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
    if (w > 0 && h > 0) return { w, h };
  }
  const w = text.match(/\swidth\s*=\s*"([\d.]+)/);
  const h = text.match(/\sheight\s*=\s*"([\d.]+)/);
  return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
}

/**
 * Fetch a brand logo into a data URI the renderer can embed. Any failure returns
 * null (the header falls back to an initial avatar): a logo must never fail a render.
 */
export async function prepareLogo(url: string | undefined | null, timeoutMs = 4000): Promise<LogoAsset | null> {
  if (!url || typeof url !== 'string') return null;
  try {
    let buf: Buffer;
    let mime: string;
    if (url.startsWith('data:')) {
      const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
      if (!m) return null;
      mime = m[1];
      buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    } else {
      if (!/^https?:\/\//i.test(url)) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) return null;
        mime = (res.headers.get('content-type') || '').split(';')[0].trim();
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 3_000_000) return null;
        buf = Buffer.from(ab);
      } finally {
        clearTimeout(timer);
      }
    }
    let size: { w: number; h: number } | null = null;
    let outMime = '';
    if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') { size = pngSize(buf); outMime = 'image/png'; }
    else if (buf[0] === 0xff && buf[1] === 0xd8) { size = jpegSize(buf); outMime = 'image/jpeg'; }
    else if (/svg/.test(mime) || buf.toString('utf8', 0, 300).includes('<svg')) {
      size = svgSize(buf.toString('utf8'));
      outMime = 'image/svg+xml';
    }
    if (!outMime || !size || size.w <= 0 || size.h <= 0) return null; // WebP, GIF and the like: fall back to the avatar
    return { dataUri: `data:${outMime};base64,${buf.toString('base64')}`, aspect: size.w / size.h };
  } catch (err: any) {
    console.warn(`[prepareLogo] ${err?.name === 'AbortError' ? 'timed out' : err?.message || 'failed'}; using the initial avatar`);
    return null;
  }
}

// ============= EMOJI HANDLING =============

const emojiSvgCache = new Map<string, string>();

async function loadEmoji(code: string, _text: string): Promise<string> {
  if (emojiSvgCache.has(code)) return emojiSvgCache.get(code)!;
  const filename = code.split('-').map(s => s.toLowerCase()).join('-');
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${filename}.svg`;
  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const svg = await resp.text();
      // Encode as data URI so resvg can parse it safely in <image href="...">
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      emojiSvgCache.set(code, dataUri);
      return dataUri;
    }
  } catch { /* ignore */ }
  const fallback = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"></svg>').toString('base64');
  emojiSvgCache.set(code, fallback);
  return fallback;
}

/** Emoji glyphs for Satori. Exported for the satori worker thread. */
export async function loadAdditionalAsset(code: string, segment: string): Promise<string> {
  if (code === 'emoji') {
    const codePoints = [...segment].map(c => c.codePointAt(0)!.toString(16)).join('-');
    return loadEmoji(codePoints, segment);
  }
  return '';
}

// ============= COLOR UTILITIES =============

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
  const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
  const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ============= PALETTE =============

const DEFAULT_PALETTE = {
  primary: '#2563EB',
  secondary: '#7C3AED',
  background: '#FFFFFF',
  text: '#1A1A2E',
  accent: '#F59E0B',
};

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

const HEX = /^#?([a-f\d]{3}|[a-f\d]{6})$/i;
const asHex = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !HEX.test(v.trim())) return undefined;
  const h = v.trim().replace('#', '');
  return `#${h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h}`;
};

/**
 * Brand palette for the themes. `custom` is false when the brand supplied no usable
 * color: themes then use their own signature colors instead of a default blue.
 */
export function resolvePalette(style?: CarouselStyle): Palette {
  let p: any = style?.palette || {};
  // Defensive: if palette somehow arrives as an array, map positionally
  if (Array.isArray(p)) {
    console.log('[resolvePalette] Converting array palette to object:', p);
    p = { primary: p[0], secondary: p[1], background: p[2], text: p[3], accent: p[4] || p[1] };
  }
  const primaryIn = asHex(p.primary);
  const secondaryIn = asHex(p.secondary);
  const accentIn = asHex(p.accent);
  const custom = !!(primaryIn || secondaryIn || accentIn);

  const primary = primaryIn || DEFAULT_PALETTE.primary;
  const secondary = secondaryIn || DEFAULT_PALETTE.secondary;
  const background = asHex(p.background) || DEFAULT_PALETTE.background;
  const text = asHex(p.text) || DEFAULT_PALETTE.text;
  let accent = accentIn || secondaryIn || DEFAULT_PALETTE.accent;

  // Brand colors pass through untouched: the themes decide which color carries a cover (a
  // pastel primary becomes the marker color on an ink field, not a muddy darkened field).
  if (custom && accent === primary) accent = secondary;
  return { primary, secondary, background, text, accent, custom };
}

// ============= SVG SANITIZATION =============

/**
 * Aggressively sanitize SVG output from Satori before passing to resvg.
 *
 * resvg has known Rust panics in geom.rs when encountering:
 * - Elements with zero width/height
 * - viewBox with zero dimensions
 * - Filter regions that compute to zero-size rects
 * - NaN values in attributes
 * - Negative dimensions
 */
export function sanitizeSvg(svg: string): string {
  let s = svg;

  // 1. Fix width="0" or height="0" on any element
  s = s.replace(/\bwidth="0"/g, 'width="1"');
  s = s.replace(/\bheight="0"/g, 'height="1"');

  // 2. Fix viewBox with zero dimensions
  s = s.replace(/viewBox="([^"]*?)(\s+)0(\s+)0"/g, (match, prefix, s1, s2) => {
    return `viewBox="${prefix}${s1}1${s2}1"`;
  });
  s = s.replace(/viewBox="(\d+)\s+(\d+)\s+0\s+(\d+)"/g, 'viewBox="$1 $2 1 $3"');
  s = s.replace(/viewBox="(\d+)\s+(\d+)\s+(\d+)\s+0"/g, 'viewBox="$1 $2 $3 1"');

  // 3. Fix NaN values in any attribute — replace with 0
  s = s.replace(/="NaN"/g, '="0"');
  s = s.replace(/="nan"/g, '="0"');

  // 4. Fix negative width/height (not position — just dimensions)
  s = s.replace(/\bwidth="-[\d.]+"/g, 'width="1"');
  s = s.replace(/\bheight="-[\d.]+"/g, 'height="1"');

  // 5. Fix feGaussianBlur with stdDeviation="0" or missing — these can cause filter regions to collapse
  s = s.replace(/stdDeviation="0"/g, 'stdDeviation="0.01"');
  s = s.replace(/stdDeviation="0 0"/g, 'stdDeviation="0.01 0.01"');

  // 6. Remove completely empty <filter> blocks (no primitives) — they produce None bbox
  s = s.replace(/<filter[^>]*>\s*<\/filter>/g, '');

  // 7. Fix filter regions with zero size — ensure filterUnits primitives have min 1px region
  s = s.replace(/\bfilterUnits="[^"]*"\s+x="([^"]*)"\s+y="([^"]*)"\s+width="0"/g,
    'filterUnits="userSpaceOnUse" x="$1" y="$2" width="1"');
  s = s.replace(/\bfilterUnits="[^"]*"\s+x="([^"]*)"\s+y="([^"]*)"\s+width="([^"]*)"\s+height="0"/g,
    'filterUnits="userSpaceOnUse" x="$1" y="$2" width="$3" height="1"');

  // 8. Ensure all <rect> elements have non-zero dimensions
  s = s.replace(/<rect([^>]*)\bwidth="0"([^>]*)>/g, '<rect$1width="1"$2>');
  s = s.replace(/<rect([^>]*)\bheight="0"([^>]*)>/g, '<rect$1height="1"$2>');

  // 9. Nuclear option: convert ALL filters to userSpaceOnUse with fixed pixel bounds.
  //
  // Satori generates SVG <filter> with objectBoundingBox percentages for CSS boxShadow
  // and textShadow. On small elements these percentages become astronomical and cause
  // resvg Rust panics. Even clamping percentages isn't fully reliable because resvg
  // computes the filter region in absolute coords and can still overflow.
  //
  // Strategy: Switch every filter to userSpaceOnUse with generous fixed-pixel bounds
  // derived from the SVG viewBox. This completely sidesteps the percentage calculation.
  const viewBoxMatch = s.match(/viewBox="(\d+)\s+(\d+)\s+(\d+)\s+(\d+)"/);
  const svgW = viewBoxMatch ? parseInt(viewBoxMatch[3]) : 1080;
  const svgH = viewBoxMatch ? parseInt(viewBoxMatch[4]) : 1350;
  const pad = 200; // 200px padding for shadow overflow

  s = s.replace(/<filter\s+id="([^"]+)"([^>]*)>/g, (_match, id) => {
    return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-${pad}" y="-${pad}" width="${svgW + pad * 2}" height="${svgH + pad * 2}">`;
  });

  // 10. Clean up empty <defs></defs> blocks
  s = s.replace(/<defs>\s*<\/defs>/g, '');

  // 11. Fix degenerate zero-radius arcs (A0,0 or a0,0) — resvg panics on these.
  // Satori generates A0,0 arcs for corners without borderRadius (e.g. chevron arrows).
  // A zero-radius arc is geometrically a no-op, so replace with line-to commands.
  s = s.replace(/[Aa]0,0[\s,]+0[\s,]+[01][\s,]+[01][\s,]+([-\d.]+),([-\d.]+)/g, 'L$1,$2');

  return s;
}

// ============= CHILD PROCESS RESVG =============

// Resolve path to the compiled resvg-worker.js
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RESVG_WORKER_PATH = path.join(__dirname, 'resvg-worker.js');

const RENDER_TIMEOUT_MS = 30_000; // 30s per slide

/**
 * Render SVG to PNG using resvg in an isolated CHILD PROCESS.
 *
 * Worker threads are NOT sufficient because Rust's abort() kills the entire
 * node process. A child process provides true isolation — SIGABRT in the
 * child is just an exit signal to the parent.
 */
export function renderSvgToPng(svg: string, width: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const child = execFile('node', [RESVG_WORKER_PATH], {
      timeout: RENDER_TIMEOUT_MS,
      maxBuffer: 50 * 1024 * 1024, // 50MB for base64 PNG output
      encoding: 'utf-8',
    }, (error, stdout, stderr) => {
      if (error) {
        const sig = (error as any).signal;
        if (sig === 'SIGABRT' || sig === 'SIGSEGV' || sig === 'SIGBUS') {
          return settle(() => reject(new Error(`resvg Rust panic (${sig}) — SVG content caused native crash`)));
        }
        if ((error as any).killed) {
          return settle(() => reject(new Error(`resvg child process timed out after ${RENDER_TIMEOUT_MS}ms`)));
        }
        return settle(() => reject(new Error(`resvg child process error: ${error.message}`)));
      }

      // Validate stdout is complete JSON — if the child was killed mid-write
      // (SIGABRT during stdout.write), we get truncated output without error
      if (!stdout || !stdout.trim()) {
        return settle(() => reject(new Error('resvg child produced no output (likely crashed)')));
      }

      try {
        const result = JSON.parse(stdout);
        if (result.ok && result.pngBase64) {
          settle(() => resolve(new Uint8Array(Buffer.from(result.pngBase64, 'base64'))));
        } else {
          settle(() => reject(new Error(result.error || 'resvg child returned failure')));
        }
      } catch (parseErr: any) {
        // Truncated JSON = child crashed mid-output (SIGABRT during write)
        settle(() => reject(new Error('resvg child crashed during rendering (truncated output)')));
      }
    });

    // Send SVG via stdin
    if (child.stdin) {
      child.stdin.write(JSON.stringify({ svg, width }));
      child.stdin.end();
    } else {
      settle(() => reject(new Error('Could not write to resvg child process stdin')));
    }
  });
}

// ============= MAIN RENDER FUNCTION =============

/**
 * The slide as an SVG string (Satori output, not yet sanitized). `embedFont: false` keeps text
 * as <text> elements with real positions instead of glyph paths, which is what the layout
 * check (layout-check.ts) reads; production always embeds.
 */
export async function slideToSvg(
  slide: SlideContent,
  style: CarouselStyle,
  totalSlides: number,
  options: RenderOptions = {},
  embedFont = true,
): Promise<{ svg: string; width: number; height: number }> {
  // Portrait 4:5 is the default: it is what Instagram and LinkedIn favor.
  const width = options.width || 1080;
  const height = options.height || 1350;
  const palette = resolvePalette(style);

  const templateId = style?.template || 'creator';
  const template = getTemplate(templateId);

  const renderOptions: RenderOptions = {
    ...options,
    width,
    height,
    assets: options.assets ?? loadAssets(),
    onWarn: options.onWarn ?? ((m) => console.warn(`[CarouselLayout] ${m}`)),
  };

  let element: any;
  switch (slide.type) {
    case 'cover':
      element = template.buildCover(slide, palette, totalSlides, renderOptions);
      break;
    case 'cta':
      element = template.buildCta(slide, palette, totalSlides, renderOptions);
      break;
    default:
      element = template.buildContent(slide, palette, totalSlides, renderOptions);
      break;
  }

  // in the satori worker thread: a layout that loops can't hang the server (satori-pool.ts)
  const svg = await satoriIsolated(element, { width, height, embedFont });
  return { svg, width, height };
}

export async function renderSlide(
  slide: SlideContent,
  style: CarouselStyle,
  totalSlides: number,
  options: RenderOptions = {}
): Promise<Uint8Array> {
  const { svg, width } = await slideToSvg(slide, style, totalSlides, options);

  // Sanitize SVG to prevent resvg panics
  const sanitizedSvg = sanitizeSvg(svg);

  // Render in isolated child process: a Rust panic kills only the child, not us
  try {
    return await renderSvgToPng(sanitizedSvg, width);
  } catch (err) {
    // Dump SVG on crash for debugging
    const dumpPath = `/tmp/crash-slide-${slide.slide_number}-${Date.now()}.svg`;
    try { fs.writeFileSync(dumpPath, sanitizedSvg); console.error(`[CarouselRenderer] SVG dumped to ${dumpPath} (${sanitizedSvg.length} chars)`); } catch {}
    throw err;
  }
}

export async function renderAllSlides(
  slides: SlideContent[],
  style: CarouselStyle,
  options: RenderOptions = {}
): Promise<Array<{ slide_number: number; png: Uint8Array; error?: string }>> {
  const totalSlides = slides.length;
  const results: Array<{ slide_number: number; png: Uint8Array; error?: string }> = [];

  for (const slide of slides) {
    try {
      const png = await renderSlide(slide, style, totalSlides, options);
      results.push({ slide_number: slide.slide_number, png });
      console.log(`[CarouselRenderer] Rendered slide ${slide.slide_number}/${totalSlides} (${png.length} bytes)`);
    } catch (err: any) {
      console.error(`[CarouselRenderer] Slide ${slide.slide_number} render failed:`, err.message);
      // Retry once: resvg crashes can be non-deterministic (memory layout dependent)
      try {
        console.log(`[CarouselRenderer] Retrying slide ${slide.slide_number}...`);
        const png = await renderSlide(slide, style, totalSlides, options);
        results.push({ slide_number: slide.slide_number, png });
        console.log(`[CarouselRenderer] Retry succeeded for slide ${slide.slide_number} (${png.length} bytes)`);
      } catch (retryErr: any) {
        console.error(`[CarouselRenderer] Slide ${slide.slide_number} retry also failed:`, retryErr.message);
        // Return empty PNG placeholder so the batch continues
        results.push({ slide_number: slide.slide_number, png: new Uint8Array(0), error: retryErr.message });
      }
    }
  }

  return results;
}
