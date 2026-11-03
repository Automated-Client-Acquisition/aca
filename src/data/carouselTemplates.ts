/**
 * Carousel Template Metadata (Frontend)
 *
 * Display-only metadata for the template picker in the blueprint form.
 * Theme IDs must match the renderer's registry (workers/carousel-renderer/src/carousel-themes.ts).
 *
 * The renderer has six themes. Every layout (cover, point, list, stat, compare,
 * statement, CTA) is drawn by one shared engine and follows the slide's content;
 * a theme only decides the look. The 16 template ids that existed before still
 * work: each is an alias of the nearest theme (see CAROUSEL_TEMPLATE_ALIASES), so
 * saved blueprints keep rendering.
 *
 * The preview colors are each theme's signature look, used when the brand voice has
 * no palette. With a brand palette the renderer maps it onto the same theme.
 */

export interface CarouselTemplatePreview {
  /** CSS background for the miniature cover slide */
  coverBg: string;
  /** CSS background for the miniature content slide */
  contentBg: string;
  /** Text color on cover */
  coverText: string;
  /** Text color on content */
  contentText: string;
  /** Accent color used for decorations, bars, counters */
  accent: string;
  /** Secondary accent for dual-tone effects */
  accent2?: string;
  /** Style of decorative elements: orbs, lines, blocks, none */
  decoStyle: 'orb' | 'line' | 'diagonal' | 'block' | 'wave' | 'mesh' | 'corner' | 'none';
  /** Whether content slide uses a card container */
  hasContentCard: boolean;
  /** Whether cover is dark (affects text rendering) */
  coverDark: boolean;
  /** Whether content slide is dark */
  contentDark: boolean;
}

export interface CarouselTemplateInfo {
  id: string;
  name: string;
  description: string;
  category: 'light' | 'dark' | 'vibrant';
  preview: CarouselTemplatePreview;
}

export const CAROUSEL_TEMPLATES: CarouselTemplateInfo[] = [
  {
    id: 'creator',
    name: 'Creator',
    description: 'Bold color cover, clean off-white slides, marker highlights',
    category: 'light',
    preview: {
      coverBg: 'linear-gradient(165deg, #23232B, #15151A 45%, #0D0D10)',
      contentBg: '#FAF9F5',
      coverText: '#FFFFFF',
      contentText: '#101114',
      accent: '#FF5A1F',
      decoStyle: 'orb',
      hasContentCard: false,
      coverDark: true,
      contentDark: false,
    },
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'Serif headlines, italic highlights and hairline rules on warm paper',
    category: 'light',
    preview: {
      coverBg: '#F6F2EA',
      contentBg: '#F6F2EA',
      coverText: '#16130F',
      contentText: '#16130F',
      accent: '#C2361A',
      decoStyle: 'line',
      hasContentCard: false,
      coverDark: false,
      contentDark: false,
    },
  },
  {
    id: 'noir',
    name: 'Noir',
    description: 'Near-black with grain, crisp type and one glowing accent',
    category: 'dark',
    preview: {
      coverBg: 'radial-gradient(circle at 82% 10%, rgba(215,255,63,0.28), transparent 55%), #0B0B0F',
      contentBg: '#0B0B0F',
      coverText: '#F3F2EE',
      contentText: '#F3F2EE',
      accent: '#D7FF3F',
      decoStyle: 'orb',
      hasContentCard: false,
      coverDark: true,
      contentDark: true,
    },
  },
  {
    id: 'halftone',
    name: 'Halftone',
    description: 'Gritty print poster: grain, halftone dots, condensed caps, one red accent',
    category: 'dark',
    preview: {
      coverBg: '#0F0D0C',
      contentBg: '#0F0D0C',
      coverText: '#EFE9DD',
      contentText: '#EFE9DD',
      accent: '#E0301E',
      decoStyle: 'mesh',
      hasContentCard: false,
      coverDark: true,
      contentDark: true,
    },
  },
  {
    id: 'brutalist',
    name: 'Brutalist',
    description: 'Flat color blocks, thick ink borders, hard shadows and mono labels',
    category: 'vibrant',
    preview: {
      coverBg: '#FFD60A',
      contentBg: '#EFEBE1',
      coverText: '#0E0E0E',
      contentText: '#0E0E0E',
      accent: '#FFD60A',
      accent2: '#0E0E0E',
      decoStyle: 'block',
      hasContentCard: true,
      coverDark: false,
      contentDark: false,
    },
  },
  {
    id: 'spotlight',
    name: 'Spotlight',
    description: 'Immersive brand-color field with grain, oversized type and white markers',
    category: 'vibrant',
    preview: {
      coverBg: 'linear-gradient(160deg, #F76B45, #F0481F 46%, #B02E12)',
      contentBg: 'linear-gradient(200deg, #A93312, #6F1F0B)',
      coverText: '#FFFFFF',
      contentText: '#FFFFFF',
      accent: '#FFFFFF',
      decoStyle: 'orb',
      hasContentCard: false,
      coverDark: true,
      contentDark: true,
    },
  },
];

/** Old template ids each map to the nearest theme. Mirrors TEMPLATE_ALIASES in the renderer. */
export const CAROUSEL_TEMPLATE_ALIASES: Record<string, string> = {
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

export const DEFAULT_CAROUSEL_TEMPLATE = 'creator';

/** The theme a saved template id renders as (old ids resolve through the aliases). */
export function resolveCarouselTemplateId(id: string | null | undefined): string {
  if (id && CAROUSEL_TEMPLATES.some((t) => t.id === id)) return id;
  if (id && CAROUSEL_TEMPLATE_ALIASES[id]) return CAROUSEL_TEMPLATE_ALIASES[id];
  return DEFAULT_CAROUSEL_TEMPLATE;
}
