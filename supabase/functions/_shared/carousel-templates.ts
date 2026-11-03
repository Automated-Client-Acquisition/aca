/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Copy of workers/carousel-renderer/src/carousel-templates.ts.
 * Regenerate with: node scripts/generate-carousel-ports.mjs
 */

/**
 * Carousel slide template registry.
 *
 * Public entry point of the layout engine. Six themes (creator, editorial, noir,
 * halftone, brutalist, spotlight) draw every slide through one shared layout
 * layer (carousel-layouts.ts), so structure follows the content (point, list,
 * stat, compare, statement) and the theme only decides the look. The 16 template
 * ids that existed before still resolve, each to its nearest theme.
 *
 * Modules: carousel-kit (types, color, text fitting, icons), carousel-themes
 * (design tokens), carousel-layouts (the layouts). This file, carousel-kit,
 * carousel-layouts, carousel-themes and carousel-text-metrics are copied to
 * supabase/functions/_shared by scripts/generate-carousel-ports.mjs.
 */

import { type Palette, type RenderOptions, type SatoriElement, type SlideContent } from './carousel-kit.ts';
import { buildSlideElement } from './carousel-layouts.ts';
import { getAllThemes, resolveThemeId, type Theme } from './carousel-themes.ts';

export type { Palette, RenderOptions, SlideContent, LogoAsset, RenderAssets, SlideLayout } from './carousel-kit.ts';
export { FONT_FACES, sanitizeText, lighten, darken } from './carousel-kit.ts';
export { TEMPLATE_ALIASES, resolveThemeId as resolveTemplateId } from './carousel-themes.ts';

type SlideBuilder = (slide: SlideContent, palette: Palette, totalSlides: number, options: RenderOptions) => SatoriElement;

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  category: 'light' | 'dark' | 'vibrant';
  buildCover: SlideBuilder;
  buildContent: SlideBuilder;
  buildCta: SlideBuilder;
}

function toTemplate(theme: Theme): TemplateDefinition {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    category: theme.category,
    buildCover: (slide, palette, total, opts) => buildSlideElement(slide, 'cover', theme.tokens('cover', palette), total, opts),
    buildContent: (slide, palette, total, opts) => buildSlideElement(slide, 'content', theme.tokens('content', palette), total, opts),
    buildCta: (slide, palette, total, opts) => buildSlideElement(slide, 'cta', theme.tokens('cta', palette), total, opts),
  };
}

const REGISTRY: Record<string, TemplateDefinition> = Object.fromEntries(getAllThemes().map((t) => [t.id, toTemplate(t)]));

/** Any template id, old or new: unknown ids get the default theme. */
export function getTemplate(id: string | undefined | null): TemplateDefinition {
  return REGISTRY[resolveThemeId(id)];
}

/** The theme ids the picker offers. Old ids are aliases (see TEMPLATE_ALIASES). */
export function getTemplateIds(): string[] {
  return Object.keys(REGISTRY);
}

export function getAllTemplates(): TemplateDefinition[] {
  return Object.values(REGISTRY);
}

export default { getTemplate, getTemplateIds, getAllTemplates };
