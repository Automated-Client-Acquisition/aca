/**
 * Carousel Renderer Worker — Fly.io
 *
 * Renders carousel slides and infographics with Satori + resvg-js. Receives render requests
 * from the execute-stage edge function, renders PNGs, uploads them to user-configured
 * storage (R2/S3/B2) and updates stage_data.
 *
 *   POST /render              carousel slides for an output (all, or one with regenerate_slide)
 *   POST /render-infographic  an infographic for an output, or a preview from an inline spec
 *   GET  /health
 *
 * POST routes require the `x-render-secret` header once RENDER_WORKER_SECRET is set (the
 * same value as the edge functions' secret). Unset, they stay open, so the secret can be
 * rolled out callers first.
 */

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { renderSlide, renderAllSlides, prepareLogo, type SlideContent, type CarouselStyle, type RenderOptions } from './carousel-slide-renderer.js';
import { uploadToUserStorage } from './storage-upload.js';
import { toSlideInput } from './slide-input.js';
import { renderInfographicPng } from './infographic/infographic-renderer.js';
import type { BrandColors, ThemeChoice } from './infographic/infographic-kit.js';

// ============= CONFIG =============

const PORT = parseInt(process.env.PORT || '8080', 10);
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const RENDER_SECRET = process.env.RENDER_WORKER_SECRET || '';

let supabase: SupabaseClient;

// Track in-flight output IDs so we can mark them as errored on crash
const inFlightOutputs = new Set<string>();

// Stats
const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalSlides: 0,
  errors: 0,
};

// ============= HELPERS =============

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function respond(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** True when the request carries the shared secret, or when no secret is configured yet. */
function authorized(req: http.IncomingMessage): boolean {
  if (!RENDER_SECRET) return true;
  const given = Buffer.from(String(req.headers['x-render-secret'] || ''));
  const want = Buffer.from(RENDER_SECRET);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** The brand voice snapshot dispatch stored on the output, if any. */
function brandVoiceOf(output: any): any {
  const libraryElements = output.generation_params?.library_elements || {};
  const raw = libraryElements.library_brand_voices || libraryElements.brand_voice || libraryElements.brand;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Mark an output failed. 'failed' is the status the content_outputs CHECK allows ('error' is not). */
async function failOutput(outputId: string, message: string) {
  try {
    await supabase.from('content_outputs').update({ status: 'failed', error_message: message }).eq('id', outputId);
  } catch { /* best effort */ }
}

/** Approve the stage for autopilot runs and auto_approve_all jobs (mirrors execute-stage). */
async function autoApprove(output: any, outputId: string, stageId: string) {
  if (!output.autopilot_id && !output.generation_params?.auto_approve_all) return;
  const source = output.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
  console.log(`[Render] Auto-approving stage ${stageId} (${source})`);
  try {
    await supabase.functions.invoke('approve-stage', {
      body: { output_id: outputId, stage_id: stageId, action: 'approve', is_automated: true, autopilot_id: output.autopilot_id },
    });
  } catch (approveErr: any) {
    console.error(`[Render] Auto-approve failed:`, approveErr.message);
  }
}

/** Brand name, @handle and logo for the slide header, from the brand voice and output config. */
async function resolveIdentity(output: any, brandVoice: any, carouselStyle: CarouselStyle): Promise<Pick<RenderOptions, 'authorName' | 'authorHandle' | 'logo'>> {
  const oc = output.generation_params?.output_config || {};
  const mc = output.generation_params?.model_config || {};
  const handle = oc.authorHandle || mc.carousel_handle || '';
  const name = oc.authorName || brandVoice?.name || '';
  const logoRaw = carouselStyle.logo as any;
  const logoUrl = typeof logoRaw === 'string' ? logoRaw : logoRaw?.url || logoRaw?.src;
  const logo = await prepareLogo(logoUrl);
  return { authorName: name || undefined, authorHandle: handle || undefined, logo: logo ?? undefined };
}

/**
 * Upload a slide PNG to user storage with fallback to Supabase content-media bucket.
 */
async function uploadSlide(
  supabase: SupabaseClient,
  organizationId: string,
  storagePath: string,
  data: Uint8Array,
): Promise<{ url: string; warning?: string }> {
  // Try user-configured storage first
  try {
    const url = await uploadToUserStorage(supabase, organizationId, data, storagePath, 'image');
    return { url };
  } catch (err: any) {
    console.warn(`[Upload] User storage failed (${err.message}), falling back to Supabase bucket`);
  }

  // Fallback: Supabase content-media bucket
  const fileName = storagePath.split('/').pop() || storagePath;
  const { error } = await supabase.storage
    .from('content-media')
    .upload(fileName, data, { contentType: 'image/png', upsert: true });

  if (error) {
    throw new Error(`Both user storage and Supabase fallback failed: ${error.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from('content-media').getPublicUrl(fileName);
  return { url: publicUrl, warning: 'Stored in Supabase fallback — user storage upload failed' };
}

// ============= RENDER HANDLER =============

interface RenderRequest {
  output_id: string;
  stage_id?: string;
  // Inline data — if provided, skip DB fetch
  slides?: SlideContent[];
  style?: CarouselStyle;
  options?: RenderOptions;
  // Single slide regen
  regenerate_slide?: number;
}

async function handleRender(body: RenderRequest, res: http.ServerResponse) {
  stats.totalRequests++;
  const startTime = Date.now();

  try {
    const { output_id, regenerate_slide } = body;

    if (!output_id) {
      return respond(res, 400, { error: 'output_id is required' });
    }

    console.log(`[Render] Starting for output ${output_id}${regenerate_slide !== undefined ? ` (slide ${regenerate_slide})` : ''}`);

    // Track in-flight so we can mark as errored on unexpected crash
    inFlightOutputs.add(output_id);

    // Fetch output from DB to get slide content, brand voice, etc.
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('id, stage_data, generation_params, status, generation_cost, autopilot_id, organization_id')
      .eq('id', output_id)
      .single();

    if (fetchError || !output) {
      stats.errors++;
      return respond(res, 404, { error: `Output not found: ${fetchError?.message}` });
    }

    // Get slide content from carousel_content stage
    // Handle both legacy format (slides at root) and new engine format (slides nested under content)
    const carouselContent = output.stage_data?.carousel_content;
    const slideContentData = carouselContent?.slides
      || carouselContent?.content?.slides
      || carouselContent?.scenes
      || carouselContent?.content?.scenes
      || [];

    if (!slideContentData.length) {
      stats.errors++;
      console.error('[Render] No slide content found. carousel_content keys:', Object.keys(carouselContent || {}));
      return respond(res, 400, { error: 'No slide content found — carousel_content stage must complete first' });
    }

    // Log first slide to debug empty text issues
    const firstSlide = slideContentData[0];
    console.log(`[Render] First slide data: headline=${JSON.stringify(firstSlide?.headline)?.substring(0, 80)}, body=${JSON.stringify(firstSlide?.body)?.substring(0, 80)}, type=${firstSlide?.type}`);

    // Build carousel style from brand voice
    const brandVoice = brandVoiceOf(output);

    const carouselStyle: CarouselStyle = body.style || {};
    if (brandVoice && !body.style) {
      console.log(`[Render] Using brand voice: ${brandVoice.name}`);
      const colorPalette = brandVoice.color_palette;
      if (colorPalette) {
        if (typeof colorPalette === 'object') {
          carouselStyle.palette = colorPalette;
        } else {
          try { carouselStyle.palette = JSON.parse(colorPalette); } catch { /* ignore */ }
        }
      }
      carouselStyle.fontStyle = brandVoice.font_style;
      carouselStyle.accentStyle = brandVoice.accent_style;
      carouselStyle.visualTemplate = brandVoice.visual_template;

      const outputConfig = output.generation_params?.output_config || {};
      carouselStyle.template = outputConfig.carouselTemplate
        || brandVoice.visual_template
        || 'creator';

      if (brandVoice.logos?.length > 0) {
        carouselStyle.logo = brandVoice.logos[0];
      } else if (brandVoice.logo) {
        carouselStyle.logo = brandVoice.logo;
      }
    }

    if (!carouselStyle.template) {
      const outputConfig = output.generation_params?.output_config || {};
      carouselStyle.template = outputConfig.carouselTemplate || 'creator';
    }

    // Apply custom palette overrides from blueprint output_config
    {
      const oc = output.generation_params?.output_config || {};
      if (oc.customPalette) {
        const cp = oc.customPalette;
        console.log('[Render] Applying custom palette overrides');
        carouselStyle.palette = {
          ...(carouselStyle.palette || {}),
          ...(cp.primary && { primary: cp.primary }),
          ...(cp.secondary && { secondary: cp.secondary }),
          ...(cp.background && { background: cp.background }),
          ...(cp.text && { text: cp.text }),
          ...(cp.accent && { accent: cp.accent }),
        };
      }
      if (oc.backgroundImageUrl) {
        carouselStyle.backgroundImage = oc.backgroundImageUrl;
      }
    }

    // Resolve aspect ratio
    // Portrait 4:5 (1080x1350) is the default. carousel_style.aspectRatio is derived from
    // output_config.aspectRatio with a square fallback, so it carries no extra information.
    const outputConfigAR = output.generation_params?.output_config || {};
    const arRaw = outputConfigAR.aspectRatio || 'portrait';
    const arDims: Record<string, { w: number; h: number }> = {
      'square': { w: 1080, h: 1080 },
      '1:1': { w: 1080, h: 1080 },
      'portrait': { w: 1080, h: 1350 },
      '4:5': { w: 1080, h: 1350 },
      'story': { w: 1080, h: 1920 },
      'reel': { w: 1080, h: 1920 },
      '9:16': { w: 1080, h: 1920 },
      'landscape': { w: 1080, h: 1080 },
    };
    const dims = arDims[arRaw] || { w: 1080, h: 1350 };
    const identity = await resolveIdentity(output, brandVoice, carouselStyle);
    // Fit warnings ("slide 3 (content:list): dropped 1 item(s)") are kept per slide so the
    // slide editor can tell people their text was shrunk or trimmed to fit.
    const warningsBySlide = new Map<number, string[]>();
    const onWarn = (m: string) => {
      console.warn(`[Render] ${m}`);
      const n = Number(m.match(/^slide (\d+)/)?.[1]);
      if (Number.isFinite(n)) warningsBySlide.set(n, [...(warningsBySlide.get(n) ?? []), m]);
    };
    const renderOptions: RenderOptions = { width: dims.w, height: dims.h, ...identity, ...(body.options || {}), onWarn };
    console.log(`[Render] Aspect ratio: ${arRaw} → ${dims.w}x${dims.h}`);

    // Handle single slide regeneration
    if (regenerate_slide !== undefined) {
      const targetSlide = slideContentData.find((s: any) => (s.slide_number || s.scene) === regenerate_slide);
      if (!targetSlide) {
        stats.errors++;
        return respond(res, 404, { error: `Slide ${regenerate_slide} not found` });
      }

      const targetIdx = slideContentData.indexOf(targetSlide);
      const slideInput: SlideContent = toSlideInput(targetSlide, targetIdx, slideContentData.length, output.generation_params?.output_config?.ctaButtonText || '');

      const png = await renderSlide(slideInput, carouselStyle, slideContentData.length, renderOptions);
      const storagePath = `content-outputs/images/carousel_${output_id}_slide_${regenerate_slide}_${Date.now()}.png`;

      const { url: publicUrl, warning } = await uploadSlide(supabase, output.organization_id, storagePath, png);
      if (warning) console.warn(`[Render] Slide ${regenerate_slide}: ${warning}`);

      // Merge into existing slides
      const existingSlides = output.stage_data?.carousel_slides?.slides || [];
      const slideWarnings = warningsBySlide.get(regenerate_slide) ?? [];
      const updatedSlides = existingSlides.map((s: any) => {
        if (s.slide_number !== regenerate_slide) return s;
        const { render_warnings: _old, ...rest } = s;
        return {
          ...rest,
          image_url: publicUrl,
          status: 'completed',
          regenerated_at: new Date().toISOString(),
          ...(slideWarnings.length ? { render_warnings: slideWarnings } : {}),
        };
      });

      const stageResult = {
        slides: updatedSlides,
        style: carouselStyle,
        model: 'satori/resvg-js',
        status: 'awaiting_approval',
        cost: 0,
      };

      // Update stage_data
      await supabase
        .from('content_outputs')
        .update({
          stage_data: {
            ...output.stage_data,
            carousel_slides: stageResult,
          },
        })
        .eq('id', output_id);

      stats.totalSlides++;
      console.log(`[Render] Slide ${regenerate_slide} regenerated in ${Date.now() - startTime}ms`);
      return respond(res, 200, { success: true, slide: regenerate_slide, url: publicUrl });
    }

    // Full render: all slides
    const configCtaText = output.generation_params?.output_config?.ctaButtonText || '';
    const slideInputs: SlideContent[] = slideContentData.map((s: any, idx: number) => toSlideInput(s, idx, slideContentData.length, configCtaText));

    console.log(`[Render] Rendering ${slideInputs.length} slides...`);
    const rendered = await renderAllSlides(slideInputs, carouselStyle, renderOptions);

    // Upload all PNGs (with retry for transient storage errors)
    const slides: any[] = [];
    for (const { slide_number, png, error: renderError } of rendered) {
      const sourceSlide = slideContentData.find((s: any) => (s.slide_number || s.scene) === slide_number);

      // Handle slides that failed rendering (e.g. resvg bbox validation)
      if (renderError || png.length === 0) {
        console.error(`[Render] Slide ${slide_number} had render error: ${renderError}`);
        slides.push({
          slide_number,
          type: sourceSlide?.type || 'content',
          headline: sourceSlide?.headline || '',
          body: sourceSlide?.body || '',
          status: 'rejected',
          error: renderError || 'Empty render output',
        });
        continue;
      }

      const storagePath = `content-outputs/images/carousel_${output_id}_slide_${slide_number}_${Date.now()}.png`;

      let publicUrl: string;
      let storageWarning: string | undefined;
      try {
        const result = await uploadSlide(supabase, output.organization_id, storagePath, png);
        publicUrl = result.url;
        storageWarning = result.warning;
      } catch (uploadErr: any) {
        console.error(`[Render] Upload failed for slide ${slide_number}:`, uploadErr);
        slides.push({
          slide_number,
          type: sourceSlide?.type || 'content',
          headline: sourceSlide?.headline || '',
          body: sourceSlide?.body || '',
          status: 'rejected',
          error: uploadErr.message,
        });
        continue;
      }

      if (storageWarning) console.warn(`[Render] Slide ${slide_number}: ${storageWarning}`);
      console.log(`[Render] Slide ${slide_number} uploaded (${png.length} bytes)`);

      const slideWarnings = warningsBySlide.get(slide_number) ?? [];
      slides.push({
        slide_number,
        type: sourceSlide?.type || 'content',
        headline: sourceSlide?.headline || '',
        body: sourceSlide?.body || '',
        image_url: publicUrl,
        status: 'completed',
        completed_at: new Date().toISOString(),
        ...(slideWarnings.length ? { render_warnings: slideWarnings } : {}),
      });
    }

    const stageResult = {
      slides,
      style: carouselStyle,
      slideCount: slides.length,
      model: 'satori/resvg-js',
      started_at: new Date().toISOString(),
      cost: 0,
      status: 'awaiting_approval',
    };

    // Update stage_data and output status
    const stageId = body.stage_id || 'carousel_slides';
    await supabase
      .from('content_outputs')
      .update({
        stage_data: {
          ...output.stage_data,
          [stageId]: stageResult,
        },
        current_stage: stageId,
        status: 'review',
      })
      .eq('id', output_id);

    stats.totalSlides += slides.length;
    const elapsed = Date.now() - startTime;
    console.log(`[Render] Complete: ${slides.length} slides in ${elapsed}ms`);

    // Auto-approve if autopilot or auto_approve_all is set (mirrors execute-stage behavior)
    await autoApprove(output, output_id, stageId);

    return respond(res, 200, {
      success: true,
      slides: slides.length,
      elapsed_ms: elapsed,
    });
  } catch (err: any) {
    stats.errors++;
    console.error('[Render] Error:', err);
    // the body was read once by the router: re-reading a consumed request hung here before
    if (body.output_id) await failOutput(body.output_id, `Carousel render failed: ${err.message}`);
    return respond(res, 500, { error: err.message });
  } finally {
    if (body.output_id) inFlightOutputs.delete(body.output_id);
  }
}

// ============= INFOGRAPHIC HANDLER =============

interface InfographicRequest {
  /** pipeline mode: render the output's stage_data.infographic_content.spec */
  output_id?: string;
  /** stage that receives the result (default 'image', which every publish path reads) */
  stage_id?: string;
  /** preview mode: render this spec and return the PNG; nothing is stored */
  spec?: unknown;
  colors?: BrandColors | null;
  theme?: ThemeChoice;
  identity?: { name?: string; handle?: string; logo_url?: string };
  /** preview only: 1 = 1080x1350 (default), 2 = 2160x2700 */
  scale?: number;
}

/** Brand colors: the brand voice palette, then the blueprint's custom palette on top. */
function infographicColors(output: any, brandVoice: any): BrandColors | null {
  let palette: any = brandVoice?.color_palette ?? null;
  if (typeof palette === 'string') {
    try { palette = JSON.parse(palette); } catch { palette = null; }
  }
  const custom = output.generation_params?.output_config?.customPalette || null;
  if (!palette && !custom) return null;
  return { ...(palette || {}), ...(custom || {}) };
}

async function handleRenderInfographic(body: InfographicRequest, res: http.ServerResponse) {
  stats.totalRequests++;
  const startTime = Date.now();

  // Preview: inline spec in, PNG out. No DB reads or writes.
  if (body.spec !== undefined && !body.output_id) {
    try {
      const logo = body.identity?.logo_url ? await prepareLogo(body.identity.logo_url) : null;
      const scale = body.scale === 2 ? 2 : 1;
      const r = await renderInfographicPng({
        spec: body.spec,
        colors: body.colors ?? null,
        theme: body.theme ?? 'auto',
        identity: { name: body.identity?.name ?? '', handle: body.identity?.handle ?? '', logo },
      }, scale);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'X-Infographic-Layout': r.layout,
        'X-Infographic-Theme': r.theme,
        'X-Infographic-Warnings': String(r.warnings.length),
      });
      res.end(Buffer.from(r.png));
      console.log(`[Infographic] Preview ${r.layout}/${r.theme} in ${Date.now() - startTime}ms (${r.warnings.length} warnings)`);
      return;
    } catch (err: any) {
      stats.errors++;
      console.error('[Infographic] Preview failed:', err.message);
      return respond(res, 400, { error: err.message });
    }
  }

  const outputId = body.output_id;
  if (!outputId) return respond(res, 400, { error: 'output_id or spec is required' });
  const stageId = body.stage_id || 'image';
  inFlightOutputs.add(outputId);

  try {
    const { data: output, error: fetchError } = await supabase
      .from('content_outputs')
      .select('id, stage_data, generation_params, status, autopilot_id, organization_id')
      .eq('id', outputId)
      .single();
    if (fetchError || !output) {
      stats.errors++;
      return respond(res, 404, { error: `Output not found: ${fetchError?.message}` });
    }

    const content = output.stage_data?.infographic_content;
    const spec = content?.spec ?? content?.content?.spec;
    if (!spec) {
      stats.errors++;
      return respond(res, 400, { error: 'No infographic spec found: infographic_content must complete first' });
    }

    const oc = output.generation_params?.output_config || {};
    const mc = output.generation_params?.model_config || {};
    const brandVoice = brandVoiceOf(output);
    const logoRaw = brandVoice?.logos?.[0] ?? brandVoice?.logo;
    const logoUrl = typeof logoRaw === 'string' ? logoRaw : logoRaw?.url || logoRaw?.src;
    const r = await renderInfographicPng({
      spec,
      colors: infographicColors(output, brandVoice),
      theme: oc.infographicTheme || mc.infographic_theme || 'auto',
      identity: {
        name: oc.authorName || mc.infographic_author_name || brandVoice?.name || '',
        handle: oc.authorHandle || mc.infographic_handle || '',
        logo: await prepareLogo(logoUrl),
      },
    }, 2);
    for (const w of r.warnings) console.warn(`[Infographic] ${outputId}: ${w}`);

    const storagePath = `content-outputs/images/infographic_${outputId}_${Date.now()}.png`;
    const { url, warning } = await uploadSlide(supabase, output.organization_id, storagePath, r.png);
    if (warning) console.warn(`[Infographic] ${outputId}: ${warning}`);

    // Same shape as a social post's image stage, so publish, push-to-ghl and X read it unchanged.
    const stageResult = {
      url,
      image_url: url,
      model: 'satori/resvg-js',
      cost: 0,
      layout: r.layout,
      theme: r.theme,
      width: r.width,
      height: r.height,
      ...(r.warnings.length ? { render_warnings: r.warnings } : {}),
      status: 'awaiting_approval',
      completed_at: new Date().toISOString(),
    };
    await supabase
      .from('content_outputs')
      .update({
        stage_data: { ...output.stage_data, [stageId]: stageResult },
        current_stage: stageId,
        status: 'review',
        error_message: null,
      })
      .eq('id', outputId);

    const elapsed = Date.now() - startTime;
    console.log(`[Infographic] ${outputId}: ${r.layout}/${r.theme} rendered and stored in ${elapsed}ms`);
    await autoApprove(output, outputId, stageId);
    return respond(res, 200, { success: true, url, layout: r.layout, theme: r.theme, warnings: r.warnings.length, elapsed_ms: elapsed });
  } catch (err: any) {
    stats.errors++;
    console.error(`[Infographic] ${outputId} failed:`, err);
    await failOutput(outputId, `Infographic render failed: ${err.message}`);
    return respond(res, 500, { error: err.message });
  } finally {
    inFlightOutputs.delete(outputId);
  }
}

// ============= SERVER =============

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return respond(res, 200, {
      status: 'ok',
      ...stats,
      uptime_s: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
    });
  }

  if (req.method === 'POST' && (url.pathname === '/render' || url.pathname === '/render-infographic')) {
    if (!authorized(req)) return respond(res, 401, { error: 'unauthorized' });
    let body: any;
    try {
      body = (await parseBody(req)) ?? {};
    } catch (err: any) {
      return respond(res, 400, { error: err.message });
    }
    return url.pathname === '/render' ? handleRender(body, res) : handleRenderInfographic(body, res);
  }

  respond(res, 404, { error: 'Not found' });
});

// ============= STARTUP =============

function start() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  server.listen(PORT, () => {
    console.log(`[CarouselRenderer] Listening on port ${PORT}`);
    console.log(`[CarouselRenderer] Auth: ${RENDER_SECRET ? 'x-render-secret required' : 'OFF (RENDER_WORKER_SECRET not set)'}`);
    console.log(`[CarouselRenderer] Supabase: ${SUPABASE_URL}`);
  });
}

// Process-level crash protection: if resvg panics (native Rust abort), mark in-flight outputs as errored.
// uncaughtException can sometimes catch native addon errors before process dies.
process.on('uncaughtException', async (err) => {
  console.error('[CarouselRenderer] FATAL uncaughtException:', err);
  stats.errors++;

  // Mark all in-flight outputs as errored so they don't get re-requested on restart
  if (supabase && inFlightOutputs.size > 0) {
    console.error(`[CarouselRenderer] Marking ${inFlightOutputs.size} in-flight outputs as errored...`);
    for (const outputId of inFlightOutputs) {
      try {
        await failOutput(outputId, `Render crashed: ${err.message || 'native panic'}`);
        console.error(`[CarouselRenderer] Marked output ${outputId} as errored`);
      } catch { /* best effort */ }
    }
    inFlightOutputs.clear();
  }

  // Don't exit — keep the server alive for future requests
  // The current request's response is already lost, but new requests can still be served
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[CarouselRenderer] SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[CarouselRenderer] SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

start();
