/**
 * Carousel Slide Renderer
 *
 * Renders carousel slides as PNG images from structured text content + brand voice.
 * Uses Satori (HTML/CSS → SVG) + resvg-wasm (SVG → PNG) for server-side rendering.
 *
 * This replaces the old Replicate/Flux image generation approach, which produced
 * inconsistent AI-generated images. Instead, we render clean branded templates
 * with text overlays — like PostNitro, Canva, etc.
 */

import satori from 'npm:satori@0.12.0';
import { Resvg, initWasm } from 'npm:@resvg/resvg-wasm@2.6.2';
import { getTemplate, sanitizeText } from './carousel-templates.ts';

// Track WASM initialization
let wasmInitialized = false;

/**
 * Initialize resvg WASM. Must be called once before rendering.
 */
async function ensureWasmInitialized() {
  if (wasmInitialized) return;
  try {
    const wasmUrl = 'https://unpkg.com/@aspect-build/resvg-wasm-simd@2.6.2/index_bg.wasm';

    // Try index_bg.wasm from the package
    const wasmResponse = await fetch(
      'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm'
    );

    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch resvg WASM: ${wasmResponse.status}`);
    }

    await initWasm(wasmResponse);
    wasmInitialized = true;
    console.log('[CarouselRenderer] resvg WASM initialized');
  } catch (error) {
    // If already initialized (duplicate call), that's fine
    if (error instanceof Error && error.message.includes('already been initialized')) {
      wasmInitialized = true;
      return;
    }
    throw error;
  }
}

// ============= TYPES =============

export interface SlideContent {
  slide_number: number;
  type: 'cover' | 'content' | 'cta';
  headline: string;
  body?: string;
}

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
  template?: string; // Template ID from carousel-templates registry
  logo?: string;
  backgroundImage?: string; // Public URL for custom background image
}

export interface RenderOptions {
  width?: number;
  height?: number;
  authorName?: string;
  authorHandle?: string;
}

// ============= FONT LOADING =============

// We load Inter from Google Fonts at 4 weights for proper typographic hierarchy
const fontCache: Record<number, ArrayBuffer> = {};

async function loadFont(weight: number): Promise<ArrayBuffer> {
  if (fontCache[weight]) return fontCache[weight];

  // Satori needs TTF/OTF font data (not woff2).
  // Use Google Fonts API v2 with a non-woff2 User-Agent to get TTF format.
  const cssUrl = `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&display=swap`;

  // A simple User-Agent gets TTF from Google Fonts (no woff2 support advertised)
  const cssResponse = await fetch(cssUrl, {
    headers: { 'User-Agent': 'satori' },
  });
  const css = await cssResponse.text();

  // Try TTF first, then woff2, then any gstatic URL
  const fontUrlMatch = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/)
    || css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/)
    || css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!fontUrlMatch) {
    console.error('[loadFont] Could not extract font URL. CSS snippet:', css.substring(0, 500));
    throw new Error('Could not extract font URL from Google Fonts CSS');
  }

  console.log(`[loadFont] Fetching font (weight=${weight}): ${fontUrlMatch[1].substring(0, 80)}...`);
  const fontResponse = await fetch(fontUrlMatch[1]);
  const fontData = await fontResponse.arrayBuffer();

  // Verify it looks like a valid font (TTF starts with 0x00010000 or 'true', woff2 with 'wOF2')
  const sig = new Uint8Array(fontData.slice(0, 4));
  const sigStr = String.fromCharCode(...sig);
  console.log(`[loadFont] Font signature: 0x${Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')} ("${sigStr}")`);

  fontCache[weight] = fontData;
  return fontData;
}

// ============= EMOJI HANDLING =============

/** Cache for fetched emoji SVGs */
const emojiSvgCache = new Map<string, string>();

/**
 * Satori loadAdditionalAsset callback — fetches Twemoji SVGs for emoji characters.
 * Returns an SVG string that Satori renders inline at the correct font size.
 */
async function loadEmoji(code: string, _text: string): Promise<string> {
  if (emojiSvgCache.has(code)) return emojiSvgCache.get(code)!;

  // Convert emoji code points to Twemoji filename format (lowercase hex, joined with -)
  const filename = code.split('-').map(s => s.toLowerCase()).join('-');
  const url = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${filename}.svg`;

  // Helper: encode SVG as data URI so resvg can parse it safely in <image href="...">
  const toDataUri = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

  try {
    const resp = await fetch(url);
    if (resp.ok) {
      const svg = await resp.text();
      const dataUri = toDataUri(svg);
      emojiSvgCache.set(code, dataUri);
      return dataUri;
    }
  } catch {
    // Ignore fetch errors for emojis
  }

  // Return empty SVG if emoji not found
  const fallback = toDataUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"></svg>');
  emojiSvgCache.set(code, fallback);
  return fallback;
}

/**
 * Satori loadAdditionalAsset callback.
 * Handles emoji graphemes by returning Twemoji SVGs.
 */
async function loadAdditionalAsset(code: string, segment: string): Promise<string> {
  if (code === 'emoji') {
    const codePoints = [...segment]
      .map(c => c.codePointAt(0)!.toString(16))
      .join('-');
    return loadEmoji(codePoints, segment);
  }
  return '';
}

// ============= COLOR UTILITIES =============

/** Parse a hex color to RGB components */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/** Lighten a hex color by a percentage (0-1) */
function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Darken a hex color by a percentage (0-1) */
function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = Math.max(0, Math.round(rgb.r * (1 - amount)));
  const g = Math.max(0, Math.round(rgb.g * (1 - amount)));
  const b = Math.max(0, Math.round(rgb.b * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ============= DEFAULT PALETTE =============

const DEFAULT_PALETTE = {
  primary: '#2563EB',    // Blue
  secondary: '#7C3AED',  // Purple
  background: '#FFFFFF',
  text: '#1A1A2E',
  accent: '#F59E0B',     // Amber
};

/** Relative luminance (0 = black, 1 = white) per WCAG formula */
function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function resolvePalette(style?: CarouselStyle) {
  let p: any = style?.palette || {};
  // Defensive: if palette somehow arrives as an array, map positionally
  if (Array.isArray(p)) {
    console.log('[resolvePalette] Converting array palette to object:', p);
    p = { primary: p[0], secondary: p[1], background: p[2], text: p[3], accent: p[4] || p[1] };
  }
  let primary = p.primary || DEFAULT_PALETTE.primary;
  let secondary = p.secondary || DEFAULT_PALETTE.secondary;
  const background = p.background || DEFAULT_PALETTE.background;
  const text = p.text || DEFAULT_PALETTE.text;
  let accent = p.accent || p.secondary || DEFAULT_PALETTE.accent;

  // Templates assume primary is a saturated/dark brand color used for cover backgrounds
  // with white text on top. If primary is too light (luminance > 0.5), swap with secondary
  // or darken it so white text remains readable.
  const primaryLum = luminance(primary);
  const secondaryLum = luminance(secondary);

  if (primaryLum > 0.5) {
    if (secondaryLum <= 0.5) {
      // Secondary is darker — swap them
      console.log(`[resolvePalette] Primary ${primary} too light (lum=${primaryLum.toFixed(2)}), swapping with secondary ${secondary}`);
      const tmp = primary;
      primary = secondary;
      secondary = tmp;
    } else {
      // Both are light — darken primary significantly
      console.log(`[resolvePalette] Both primary ${primary} and secondary ${secondary} are light, darkening primary`);
      primary = darkenColor(primary, 0.55);
    }
  }

  // Ensure accent is not identical to primary (common when brand voice only has 1-2 colors)
  if (accent === primary) {
    accent = secondary;
  }

  return { primary, secondary, background, text, accent };
}

// ============= SLIDE TEMPLATES (Fallback — used when template not found) =============

/** Progress bar — thin line showing slide position */
function buildProgressBar(current: number, total: number, activeColor: string, trackColor: string) {
  const pct = (current / total) * 100;
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', width: '100%', height: '4px', borderRadius: '2px',
        background: trackColor, overflow: 'hidden',
      },
      children: [{
        type: 'div',
        props: {
          style: { width: `${pct}%`, height: '100%', borderRadius: '2px', background: activeColor },
        },
      }],
    },
  };
}

function buildCoverSlide(
  slide: SlideContent,
  palette: ReturnType<typeof resolvePalette>,
  totalSlides: number,
  _options: RenderOptions
) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: `linear-gradient(145deg, ${palette.primary}, ${darkenColor(palette.primary, 0.35)})`,
        padding: '64px', fontFamily: 'Inter',
        position: 'relative', overflow: 'hidden',
      },
      children: [
        // Accent orb
        { type: 'div', props: { style: { position: 'absolute', top: '-180px', right: '-120px', width: '500px', height: '500px', borderRadius: '50%', background: `rgba(${hexToRgb(palette.accent)?.r || 255},${hexToRgb(palette.accent)?.g || 200},${hexToRgb(palette.accent)?.b || 0},0.2)` } } },
        // Top: slide counter
        { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: '6px' }, children: [
          { type: 'div', props: { style: { fontSize: '18px', fontWeight: 700, color: palette.accent, letterSpacing: '0.05em' }, children: String(slide.slide_number).padStart(2, '0') } },
          { type: 'div', props: { style: { fontSize: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.4)' }, children: '/' } },
          { type: 'div', props: { style: { fontSize: '14px', fontWeight: 500, color: 'rgba(255,255,255,0.4)' }, children: String(totalSlides).padStart(2, '0') } },
        ] } },
        { type: 'div', props: { style: { flex: 1 } } },
        // Headline
        { type: 'div', props: { style: { fontSize: '80px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.05, letterSpacing: '-0.04em', maxWidth: '95%', textShadow: '0 4px 24px rgba(0,0,0,0.3)', marginBottom: slide.body ? '20px' : '0' }, children: slide.headline } },
        // Body
        ...(slide.body ? [{ type: 'div', props: { style: { fontSize: '36px', fontWeight: 400, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, maxWidth: '90%' }, children: slide.body } }] : []),
        { type: 'div', props: { style: { flex: 1 } } },
        buildProgressBar(slide.slide_number, totalSlides, '#FFFFFF', 'rgba(255,255,255,0.2)'),
      ],
    },
  };
}

function buildContentSlide(
  slide: SlideContent,
  palette: ReturnType<typeof resolvePalette>,
  totalSlides: number,
  _options: RenderOptions
) {
  const textColor = palette.text;
  const accentColor = palette.primary;

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: lightenColor(accentColor, 0.95),
        padding: '64px', fontFamily: 'Inter',
        position: 'relative', overflow: 'hidden',
      },
      children: [
        // Top accent gradient
        { type: 'div', props: { style: { position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: `linear-gradient(90deg, ${accentColor}, ${palette.accent || palette.secondary})` } } },
        // Big watermark number
        { type: 'div', props: { style: { position: 'absolute', top: '-40px', right: '40px', fontSize: '280px', fontWeight: 800, color: accentColor, opacity: 0.04, lineHeight: 1, letterSpacing: '-0.05em' }, children: String(slide.slide_number).padStart(2, '0') } },
        // Counter
        { type: 'div', props: { style: { display: 'flex', alignItems: 'baseline', gap: '6px' }, children: [
          { type: 'div', props: { style: { fontSize: '18px', fontWeight: 700, color: accentColor, letterSpacing: '0.05em' }, children: String(slide.slide_number).padStart(2, '0') } },
          { type: 'div', props: { style: { fontSize: '14px', fontWeight: 500, color: `rgba(0,0,0,0.25)` }, children: '/' } },
          { type: 'div', props: { style: { fontSize: '14px', fontWeight: 500, color: `rgba(0,0,0,0.25)` }, children: String(totalSlides).padStart(2, '0') } },
        ] } },
        { type: 'div', props: { style: { height: '24px' } } },
        { type: 'div', props: { style: { flex: 1 } } },
        // Content card
        { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', background: '#FFFFFF', borderRadius: '24px', padding: '48px 44px', boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 24px 60px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.04)', borderLeft: `4px solid ${accentColor}`, width: '100%' }, children: [
          { type: 'div', props: { style: { fontSize: '64px', fontWeight: 800, color: textColor, lineHeight: 1.05, letterSpacing: '-0.04em', maxWidth: '95%', marginBottom: slide.body ? '16px' : '0' }, children: slide.headline } },
          ...(slide.body ? [{ type: 'div', props: { style: { fontSize: '36px', fontWeight: 400, color: '#666666', lineHeight: 1.5, maxWidth: '90%' }, children: slide.body } }] : []),
        ] } },
        { type: 'div', props: { style: { flex: 1 } } },
        buildProgressBar(slide.slide_number, totalSlides, accentColor, lightenColor(accentColor, 0.85)),
      ],
    },
  };
}

function buildCtaSlide(
  slide: SlideContent,
  palette: ReturnType<typeof resolvePalette>,
  totalSlides: number,
  options: RenderOptions
) {
  const accentBg = palette.accent || '#FFFFFF';
  const accentFg = luminance(accentBg) > 0.4 ? '#1a1a1a' : '#FFFFFF';

  return {
    type: 'div',
    props: {
      style: {
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        width: '100%', height: '100%',
        background: `linear-gradient(145deg, ${palette.primary}, ${palette.secondary || darkenColor(palette.primary, 0.2)})`,
        padding: '64px', fontFamily: 'Inter',
        textAlign: 'center', position: 'relative', overflow: 'hidden',
      },
      children: [
        // Accent orbs
        { type: 'div', props: { style: { position: 'absolute', top: '-120px', right: '-120px', width: '400px', height: '400px', borderRadius: '50%', background: 'rgba(255,255,255,0.06)' } } },
        { type: 'div', props: { style: { position: 'absolute', bottom: '-80px', left: '-80px', width: '300px', height: '300px', borderRadius: '50%', background: 'rgba(255,255,255,0.04)' } } },
        // Headline
        { type: 'div', props: { style: { fontSize: '68px', fontWeight: 800, color: '#FFFFFF', lineHeight: 1.05, letterSpacing: '-0.04em', maxWidth: '85%', textShadow: '0 4px 24px rgba(0,0,0,0.3)', marginBottom: slide.body ? '20px' : '48px' }, children: slide.headline } },
        // Body
        ...(slide.body ? [{ type: 'div', props: { style: { fontSize: '36px', fontWeight: 400, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5, marginBottom: '48px', maxWidth: '85%' }, children: slide.body } }] : []),
        // CTA button
        { type: 'div', props: { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '22px 56px', borderRadius: '16px', background: `linear-gradient(135deg, ${accentBg}, ${darkenColor(accentBg, 0.2)})`, color: accentFg, fontSize: '28px', fontWeight: 700, marginBottom: '48px', boxShadow: `0 8px 32px rgba(0,0,0,0.25)` }, children: options.authorHandle ? `@${options.authorHandle.replace('@', '')}` : 'Follow for more' } },
        buildProgressBar(slide.slide_number, totalSlides, '#FFFFFF', 'rgba(255,255,255,0.2)'),
      ],
    },
  };
}

// ============= MAIN RENDER FUNCTION =============

/**
 * Render a single carousel slide to a PNG buffer.
 */
export async function renderSlide(
  slide: SlideContent,
  style: CarouselStyle,
  totalSlides: number,
  options: RenderOptions = {}
): Promise<Uint8Array> {
  await ensureWasmInitialized();

  const width = options.width || 1080;
  const height = options.height || 1080;
  const palette = resolvePalette(style);

  // Sanitize slide text — em dashes, smart quotes, etc.
  const cleanSlide = {
    ...slide,
    headline: sanitizeText(slide.headline),
    body: slide.body ? sanitizeText(slide.body) : undefined,
  };

  // Resolve template from registry
  const templateId = style?.template || 'creator';
  const template = getTemplate(templateId);
  console.log(`[CarouselRenderer] Using template: ${template.id}`);

  // Select builder based on slide type
  let element: any;
  switch (cleanSlide.type) {
    case 'cover':
      element = template.buildCover(cleanSlide, palette, totalSlides, options);
      break;
    case 'cta':
      element = template.buildCta(cleanSlide, palette, totalSlides, options);
      break;
    default:
      element = template.buildContent(cleanSlide, palette, totalSlides, options);
      break;
  }

  // Inject background image + semi-transparent overlay if configured
  if (style.backgroundImage && element?.props?.children) {
    const bgLayer = {
      type: 'img',
      props: {
        src: style.backgroundImage,
        style: {
          position: 'absolute' as const,
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover' as const,
          objectPosition: 'center',
        },
      },
    };
    // Semi-transparent overlay using template's existing background color
    const existingBg = element.props.style?.background || palette.primary;
    const overlayLayer = {
      type: 'div',
      props: {
        style: {
          position: 'absolute' as const,
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: existingBg,
          opacity: 0.7,
        },
      },
    };
    // Prepend bg image + overlay before all content children
    element.props.children = [bgLayer, overlayLayer, ...element.props.children];
    console.log(`[CarouselRenderer] Injected background image for slide ${slide.slide_number}`);
  }

  // Load fonts (4 weights for proper typographic hierarchy)
  const [fontLight, fontRegular, fontBold, fontBlack] = await Promise.all([
    loadFont(300), loadFont(400), loadFont(700), loadFont(900),
  ]);

  // Render to SVG with Satori (with emoji support via Twemoji)
  const svg = await satori(element, {
    width,
    height,
    fonts: [
      { name: 'Inter', data: fontLight, weight: 300, style: 'normal' as const },
      { name: 'Inter', data: fontRegular, weight: 400, style: 'normal' as const },
      { name: 'Inter', data: fontRegular, weight: 500, style: 'normal' as const },
      { name: 'Inter', data: fontBold, weight: 700, style: 'normal' as const },
      { name: 'Inter', data: fontBlack, weight: 800, style: 'normal' as const },
      { name: 'Inter', data: fontBlack, weight: 900, style: 'normal' as const },
      // The layout engine names display families that only the Fly worker vendors
      // (assets/fonts). This standalone copy has no font files, so they fall back to Inter.
      ...['Instrument Serif', 'Anton', 'Bricolage Grotesque', 'Space Mono'].flatMap((name) => [
        { name, data: fontRegular, weight: 400 as const, style: 'normal' as const },
        { name, data: fontBold, weight: 700 as const, style: 'normal' as const },
        { name, data: fontBlack, weight: 800 as const, style: 'normal' as const },
      ]),
    ],
    loadAdditionalAsset,
  });

  // Convert SVG to PNG with resvg
  const resvg = new Resvg(svg, {
    fitTo: {
      mode: 'width',
      value: width,
    },
  });

  const pngData = resvg.render();
  return pngData.asPng();
}

/**
 * Render all slides in a carousel.
 * Returns an array of { slide_number, png } objects.
 */
export async function renderAllSlides(
  slides: SlideContent[],
  style: CarouselStyle,
  options: RenderOptions = {}
): Promise<Array<{ slide_number: number; png: Uint8Array }>> {
  const totalSlides = slides.length;
  const results: Array<{ slide_number: number; png: Uint8Array }> = [];

  // Render sequentially to avoid WASM memory issues
  for (const slide of slides) {
    const png = await renderSlide(slide, style, totalSlides, options);
    results.push({ slide_number: slide.slide_number, png });
    console.log(`[CarouselRenderer] Rendered slide ${slide.slide_number}/${totalSlides} (${png.length} bytes)`);
  }

  return results;
}

export default { renderSlide, renderAllSlides };
