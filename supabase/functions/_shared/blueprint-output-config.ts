/**
 * Blueprint Look settings -> output_config.
 *
 * A carousel blueprint keeps its shape, template, slide count, CTA and handle in
 * model_config. The Run screen (src/hooks/useBlueprintRun.ts) turns them into an
 * output_config itself, but autopilots, MCP and the API dispatch without one, so
 * every carousel they made fell back to a square 'landscape' default on the
 * default template. Dispatch merges these defaults under whatever output_config
 * the caller sent, so explicit per-run and per-autopilot choices still win.
 *
 * Keep the derivation in sync with useBlueprintRun.ts.
 */

const CAROUSEL_SHAPES: Record<string, string> = {
  portrait: 'portrait',
  '4:5': 'portrait',
  vertical: 'portrait',
  square: 'square',
  '1:1': 'square',
};

/**
 * Feed carousels are 4:5 or 1:1. Anything else (a leftover 'landscape' default,
 * 16:9, 9:16) is not a carousel shape, so it's dropped and the blueprint's
 * shape applies instead of the renderer silently squaring it.
 */
export function normalizeCarouselShape(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return CAROUSEL_SHAPES[value.trim().toLowerCase()];
}

export function blueprintOutputDefaults(
  pipeline: string | undefined,
  modelConfig: Record<string, any> | null | undefined,
): Record<string, unknown> | undefined {
  const mc = modelConfig ?? {};
  if (pipeline === 'instagram_carousel') {
    return {
      aspectRatio: normalizeCarouselShape(mc.output_config_defaults?.aspectRatio) ?? 'portrait',
      carouselTemplate: mc.carousel_template || 'creator',
      slideCount: mc.carousel_slide_count || 5,
      ...(mc.carousel_cta_text ? { ctaButtonText: mc.carousel_cta_text } : {}),
      ...(mc.carousel_handle ? { authorHandle: mc.carousel_handle } : {}),
      ...(mc.carousel_custom_palette ? { customPalette: mc.carousel_custom_palette } : {}),
      ...(mc.carousel_background_image ? { backgroundImageUrl: mc.carousel_background_image } : {}),
    };
  }
  if (pipeline === 'instagram_carousel_ai') {
    return {
      aspectRatio: mc.output_config_defaults?.aspectRatio || 'portrait',
      slideCount: mc.carousel_slide_count || 5,
      ...(mc.carousel_cta_text ? { ctaButtonText: mc.carousel_cta_text } : {}),
    };
  }
  return undefined;
}

/** Blueprint defaults, overridden by the caller's non-empty output_config fields. */
export function resolveOutputConfig(
  pipeline: string | undefined,
  modelConfig: Record<string, any> | null | undefined,
  explicit: Record<string, any> | null | undefined,
): Record<string, any> | undefined {
  const defaults = blueprintOutputDefaults(pipeline, modelConfig);
  if (!defaults) return explicit ?? undefined;

  const overrides: Record<string, any> = {};
  for (const [key, value] of Object.entries(explicit ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    overrides[key] = value;
  }
  // The template renderer only draws 4:5 and 1:1. AI-image carousels pass the
  // caller's shape through untouched: their providers map it themselves.
  if (pipeline === 'instagram_carousel' && 'aspectRatio' in overrides) {
    const shape = normalizeCarouselShape(overrides.aspectRatio);
    if (shape) overrides.aspectRatio = shape;
    else delete overrides.aspectRatio;
  }
  return { ...defaults, ...overrides };
}
