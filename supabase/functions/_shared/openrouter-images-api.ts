/**
 * OpenRouter's dedicated Image API (POST /api/v1/images).
 *
 * OpenAI image models ignore `image_config.aspect_ratio` on /chat/completions:
 * every openai/gpt-5-image run came back 1024x1024 whatever the blueprint
 * asked for (4:3, 9:16, landscape...). The Image API takes `aspect_ratio` as a
 * top-level field and honours it, but only the values the model's endpoint
 * lists (gpt-5-image: 1:1, 3:2, 2:3), so the requested ratio is snapped to the
 * closest one it accepts. Gemini honours image_config on chat, so it stays there.
 */

export const OPENROUTER_IMAGES_URL = 'https://openrouter.ai/api/v1/images';

/** Models whose chat route drops the aspect ratio, so they go through the Image API. */
export function usesOpenRouterImagesApi(model: string): boolean {
  return model.startsWith('openai/');
}

function ratioValue(ratio: string): number | null {
  const m = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/**
 * The accepted ratio closest in shape to the requested one, compared on a log
 * scale so 2:1 and 1:2 are equally far from 1:1. Returns the request unchanged
 * when it is already accepted, unparseable, or nothing is known to compare to.
 */
export function snapAspectRatio(requested: string, supported: string[]): string {
  if (supported.includes(requested)) return requested;
  const target = ratioValue(requested);
  if (target === null) return requested;
  let best = requested;
  let bestDistance = Infinity;
  for (const candidate of supported) {
    const value = ratioValue(candidate);
    if (value === null) continue;
    const distance = Math.abs(Math.log(value / target));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

const supportedRatiosCache = new Map<string, string[]>();

/**
 * Ratios any endpoint of the model accepts, from OpenRouter's public discovery
 * API (no key needed). Cached per isolate. [] when unknown, in which case the
 * request goes out unsnapped and OpenRouter clamps it.
 */
export async function supportedAspectRatios(model: string): Promise<string[]> {
  const cached = supportedRatiosCache.get(model);
  if (cached) return cached;
  try {
    const res = await fetch(`${OPENROUTER_IMAGES_URL}/models/${model}/endpoints`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const ratios = new Set<string>();
    for (const endpoint of json?.endpoints ?? []) {
      for (const value of endpoint?.supported_parameters?.aspect_ratio?.values ?? []) {
        if (typeof value === 'string' && value !== 'auto') ratios.add(value);
      }
    }
    const list = [...ratios];
    if (list.length > 0) supportedRatiosCache.set(model, list);
    return list;
  } catch (e) {
    console.warn(`[openrouter-images-api] Could not read aspect ratios for ${model}:`, e instanceof Error ? e.message : e);
    return [];
  }
}
