/**
 * Shared media resolution utilities for Remotion compositions.
 * Extracts Pexels stock search and Replicate AI image generation
 * from editor-chat into reusable functions.
 */

// ── Types ──────────────────────────────────────────────────────────

export interface StockMediaResult {
  id: string;
  url: string;
  thumbnail: string;
  duration?: number;
}

export interface AIImageResult {
  url: string;
  prompt: string;
}

// ── Pexels Stock Search ────────────────────────────────────────────

export async function searchStockMedia(
  query: string,
  type: 'videos' | 'photos' = 'videos',
  orientation: 'portrait' | 'landscape' = 'landscape',
  pexelsKey?: string | null
): Promise<StockMediaResult[]> {
  const key = pexelsKey || Deno.env.get('PEXELS_API_KEY');
  if (!key) throw new Error('Pexels API not configured');

  const endpoint = type === 'videos'
    ? 'https://api.pexels.com/videos/search'
    : 'https://api.pexels.com/v1/search';

  const url = `${endpoint}?query=${encodeURIComponent(query)}&per_page=1&orientation=${orientation}`;
  const response = await fetch(url, { headers: { Authorization: key } });
  if (!response.ok) throw new Error(`Pexels error: ${response.status}`);

  const data = await response.json();

  if (type === 'videos') {
    return (data.videos || []).slice(0, 1).map((v: any) => {
      const file = v.video_files?.find((f: any) => f.quality === 'hd' || f.quality === 'sd') || v.video_files?.[0];
      return { id: String(v.id), url: file?.link || '', thumbnail: v.image || '', duration: v.duration };
    });
  } else {
    return (data.photos || []).slice(0, 1).map((p: any) => ({
      id: String(p.id), url: p.src?.large2x || p.src?.large || '', thumbnail: p.src?.medium || '',
    }));
  }
}

// ── Replicate AI Image Generation ──────────────────────────────────

export async function generateAIImage(
  prompt: string,
  replicateKey: string,
  aspectRatio: string = '16:9'
): Promise<AIImageResult> {
  const response = await fetch(
    'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${replicateKey}`,
        'Content-Type': 'application/json',
        Prefer: 'wait',
      },
      body: JSON.stringify({ input: { prompt, aspect_ratio: aspectRatio, num_outputs: 1 } }),
    }
  );
  if (!response.ok) throw new Error(`Image gen failed: ${await response.text()}`);

  let prediction = await response.json();

  if (prediction.status !== 'succeeded') {
    const pollUrl = `https://api.replicate.com/v1/predictions/${prediction.id}`;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const pollResp = await fetch(pollUrl, { headers: { Authorization: `Bearer ${replicateKey}` } });
      if (!pollResp.ok) continue;
      prediction = await pollResp.json();
      if (prediction.status === 'succeeded') break;
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Image gen ${prediction.status}`);
      }
    }
  }

  if (prediction.status === 'succeeded') {
    const imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    return { url: imageUrl, prompt };
  }

  throw new Error('Image gen timed out');
}

// ── Placeholder Resolution ─────────────────────────────────────────

/**
 * Parse and resolve media placeholders in Remotion TSX code.
 *
 * Supported patterns:
 *   STOCK_VIDEO("query")  -> Pexels video URL
 *   STOCK_IMAGE("query")  -> Pexels image URL
 *   AI_IMAGE("prompt")    -> Replicate Flux image URL
 *
 * Returns the code with all placeholders replaced by real URLs.
 */
export async function resolveMediaPlaceholders(
  code: string,
  opts: {
    replicateKey?: string;
    pexelsKey?: string;
    aspectRatio?: 'portrait' | 'landscape' | 'square';
  } = {}
): Promise<{ resolvedCode: string; resolvedCount: number; errors: string[] }> {
  const orientation = opts.aspectRatio === 'portrait' ? 'portrait' : 'landscape';
  const imageAspect = opts.aspectRatio === 'portrait' ? '9:16' : opts.aspectRatio === 'square' ? '1:1' : '16:9';

  const errors: string[] = [];
  let resolvedCount = 0;

  // Collect all placeholders
  const stockVideoPattern = /STOCK_VIDEO\("([^"]+)"\)/g;
  const stockImagePattern = /STOCK_IMAGE\("([^"]+)"\)/g;
  const aiImagePattern = /AI_IMAGE\("([^"]+)"\)/g;

  // Deduplicate queries
  const stockVideoQueries = new Map<string, string>(); // placeholder -> query
  const stockImageQueries = new Map<string, string>();
  const aiImagePrompts = new Map<string, string>();

  let match: RegExpExecArray | null;
  while ((match = stockVideoPattern.exec(code)) !== null) {
    stockVideoQueries.set(match[0], match[1]);
  }
  while ((match = stockImagePattern.exec(code)) !== null) {
    stockImageQueries.set(match[0], match[1]);
  }
  while ((match = aiImagePattern.exec(code)) !== null) {
    aiImagePrompts.set(match[0], match[1]);
  }

  let resolvedCode = code;

  // Resolve all in parallel
  const promises: Promise<void>[] = [];

  for (const [placeholder, query] of stockVideoQueries) {
    promises.push(
      searchStockMedia(query, 'videos', orientation, opts.pexelsKey)
        .then(results => {
          if (results.length > 0) {
            resolvedCode = resolvedCode.replaceAll(placeholder, results[0].url);
            resolvedCount++;
          } else {
            errors.push(`No stock video found for: "${query}"`);
          }
        })
        .catch(err => { errors.push(`Stock video search failed for "${query}": ${err.message}`); })
    );
  }

  for (const [placeholder, query] of stockImageQueries) {
    promises.push(
      searchStockMedia(query, 'photos', orientation, opts.pexelsKey)
        .then(results => {
          if (results.length > 0) {
            resolvedCode = resolvedCode.replaceAll(placeholder, results[0].url);
            resolvedCount++;
          } else {
            errors.push(`No stock image found for: "${query}"`);
          }
        })
        .catch(err => { errors.push(`Stock image search failed for "${query}": ${err.message}`); })
    );
  }

  for (const [placeholder, prompt] of aiImagePrompts) {
    if (!opts.replicateKey) {
      errors.push(`AI image skipped (no Replicate key): "${prompt}"`);
      continue;
    }
    promises.push(
      generateAIImage(prompt, opts.replicateKey, imageAspect)
        .then(result => {
          resolvedCode = resolvedCode.replaceAll(placeholder, result.url);
          resolvedCount++;
        })
        .catch(err => { errors.push(`AI image gen failed for "${prompt}": ${err.message}`); })
    );
  }

  await Promise.all(promises);

  return { resolvedCode, resolvedCount, errors };
}
