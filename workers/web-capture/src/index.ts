/**
 * Web Capture Worker — Fly.io
 *
 * Dedicated worker for capturing screenshots from URLs using Playwright.
 * Receives capture requests, navigates to pages, runs AI-planned screenshot
 * sequences, uploads results to Supabase Storage, and updates stage_data.
 */

import http from 'node:http';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { performRecon } from './recon.js';
import { generatePlan, type FlowStep } from './planner.js';
import { executeSteps, type CapturedScreenshot } from './executor.js';
import type { TemplateType } from './prompts.js';

// ============================================================================
// Config
// ============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

// Browser instance — reused across requests for performance
let browser: Browser | null = null;

// Track in-flight captures for crash recovery
const inFlightOutputs = new Set<string>();

// Stats
const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  totalScreenshots: 0,
  errors: 0,
};

// ============================================================================
// Helpers
// ============================================================================

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

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;

  console.log('[WebCapture] Launching Chromium...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--single-process',
    ],
  });

  browser.on('disconnected', () => {
    console.warn('[WebCapture] Browser disconnected');
    browser = null;
  });

  console.log('[WebCapture] Chromium launched');
  return browser;
}

// ============================================================================
// Request Types
// ============================================================================

interface CaptureRequest {
  url: string;
  brief: string;
  template_type?: TemplateType;
  flow_steps?: FlowStep[];
  max_screenshots?: number;
  login?: { email: string; password: string };
  viewport?: { width: number; height: number };
  device_type?: 'desktop' | 'mobile';
  supabase_url: string;
  supabase_key: string;
  output_id: string;
  stage_id: string;
  openrouter_api_key?: string;
  llm_model?: string;
  organization_id?: string;
}

// ============================================================================
// Capture Handler
// ============================================================================

async function handleCapture(req: http.IncomingMessage, res: http.ServerResponse) {
  stats.totalRequests++;
  const startTime = Date.now();
  let context: BrowserContext | null = null;

  try {
    const body: CaptureRequest = await parseBody(req);

    // Validate required fields
    if (!body.url) return respond(res, 400, { error: 'url is required' });
    if (!body.brief) return respond(res, 400, { error: 'brief is required' });
    if (!body.supabase_url) return respond(res, 400, { error: 'supabase_url is required' });
    if (!body.supabase_key) return respond(res, 400, { error: 'supabase_key is required' });
    if (!body.output_id) return respond(res, 400, { error: 'output_id is required' });
    if (!body.stage_id) return respond(res, 400, { error: 'stage_id is required' });

    const openrouterKey = body.openrouter_api_key || OPENROUTER_API_KEY;
    if (!openrouterKey) return respond(res, 400, { error: 'OpenRouter API key is required (via body or OPENROUTER_API_KEY env)' });

    const maxScreenshots = Math.min(body.max_screenshots || 8, 15);
    const templateType = body.template_type || 'general';

    console.log(`[Capture] Starting for output ${body.output_id}`);
    console.log(`[Capture] URL: ${body.url}`);
    console.log(`[Capture] Brief: "${body.brief.slice(0, 80)}..."`);
    console.log(`[Capture] Template: ${templateType}, Max screenshots: ${maxScreenshots}`);

    inFlightOutputs.add(body.output_id);

    // Create Supabase client for this request
    const supabase = createClient(body.supabase_url, body.supabase_key);

    // Update output status to processing
    await supabase
      .from('content_outputs')
      .update({
        status: 'processing',
        current_stage: body.stage_id,
      })
      .eq('id', body.output_id);

    // Launch browser context — mobile viewport gets mobile user agent + touch support
    const isMobile = body.device_type === 'mobile';
    const brow = await getBrowser();
    context = await brow.newContext({
      viewport: body.viewport || { width: 1440, height: 900 },
      userAgent: isMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      isMobile,
      hasTouch: isMobile,
      deviceScaleFactor: isMobile ? 3 : 1,
      bypassCSP: true,
    });

    // Block heavy resources that slow down capture
    await context.route('**/*.{mp4,webm,ogg,avi}', (route) => route.abort());
    await context.route('**/analytics**', (route) => route.abort());
    await context.route('**/tracking**', (route) => route.abort());
    await context.route('**/*google-analytics*', (route) => route.abort());
    await context.route('**/*hotjar*', (route) => route.abort());
    await context.route('**/*segment*', (route) => route.abort());

    const page = await context.newPage();

    // ---- Phase 1: Recon ----
    console.log('[Capture] Phase 1: Recon');
    const recon = await performRecon(page, {
      url: body.url,
      login: body.login,
      viewport: body.viewport,
    });

    // Upload initial recon screenshot
    const reconFileName = `web-capture/${body.output_id}/recon_${Date.now()}.png`;
    await supabase.storage
      .from('content-media')
      .upload(reconFileName, recon.initialScreenshot, {
        contentType: 'image/png',
        upsert: true,
      });
    const { data: { publicUrl: reconUrl } } = supabase.storage
      .from('content-media')
      .getPublicUrl(reconFileName);

    // ---- Phase 2: Plan ----
    let steps: FlowStep[];

    if (body.flow_steps && body.flow_steps.length > 0) {
      console.log(`[Capture] Phase 2: Using ${body.flow_steps.length} manual flow steps`);
      steps = body.flow_steps;
    } else {
      console.log('[Capture] Phase 2: LLM Planning');
      steps = await generatePlan(openrouterKey, {
        domSummary: recon.domSummary,
        initialScreenshotBase64: recon.initialScreenshot.toString('base64'),
        brief: body.brief,
        templateType,
        maxScreenshots,
        currentUrl: recon.finalUrl,
      }, body.llm_model);
    }

    // ---- Phase 3: Execute ----
    console.log(`[Capture] Phase 3: Executing ${steps.length} steps`);
    const executionResult = await executeSteps(page, steps, {
      outputId: body.output_id,
      stageId: body.stage_id,
      supabase,
      openRouterApiKey: openrouterKey,
      llmModel: body.llm_model,
      organizationId: body.organization_id,
    });

    // Close browser context
    await context.close().catch(() => {});
    context = null;

    // ---- Phase 4: Store Results ----
    console.log('[Capture] Phase 4: Storing results');

    const stageResult = {
      status: 'completed',
      screenshots: executionResult.screenshots.map((s: CapturedScreenshot) => ({
        index: s.index,
        url: s.url,
        area: s.area,
        narrate: s.narrate,
        page_url: s.pageUrl,
        timestamp: s.timestamp,
        bboxes: s.bboxes,
      })),
      recon: {
        url: reconUrl,
        final_url: recon.finalUrl,
        title: recon.snapshot.title,
        meta_description: recon.snapshot.metaDescription,
        og_title: recon.snapshot.ogTitle,
        og_description: recon.snapshot.ogDescription,
        og_image: recon.snapshot.ogImage,
        headings: recon.snapshot.headings.slice(0, 20),
        load_time_ms: recon.loadTimeMs,
      },
      plan: {
        template_type: templateType,
        steps_planned: steps.length,
        steps_executed: executionResult.totalActions,
        steps_failed: executionResult.failedActions,
        was_manual: !!(body.flow_steps && body.flow_steps.length > 0),
      },
      model: body.llm_model || 'anthropic/claude-sonnet-4',
      screenshot_count: executionResult.screenshots.length,
      total_elapsed_ms: Date.now() - startTime,
      execution_elapsed_ms: executionResult.elapsedMs,
      cost: 0,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
    };

    // Fetch current stage_data to merge
    const { data: output } = await supabase
      .from('content_outputs')
      .select('stage_data, autopilot_id, generation_params')
      .eq('id', body.output_id)
      .single();

    const existingStageData = output?.stage_data || {};

    await supabase
      .from('content_outputs')
      .update({
        stage_data: {
          ...existingStageData,
          [body.stage_id]: stageResult,
        },
        current_stage: body.stage_id,
        status: 'review',
      })
      .eq('id', body.output_id);

    stats.totalScreenshots += executionResult.screenshots.length;

    // Auto-approve if autopilot or auto_approve_all
    const shouldAutoApprove = output?.autopilot_id || output?.generation_params?.auto_approve_all;
    if (shouldAutoApprove) {
      const source = output?.autopilot_id ? 'Autopilot' : 'AutoApproveAll';
      console.log(`[Capture] Auto-approving stage ${body.stage_id} (${source})`);
      try {
        await supabase.functions.invoke('approve-stage', {
          body: {
            output_id: body.output_id,
            stage_id: body.stage_id,
            action: 'approve',
            is_automated: true,
            autopilot_id: output?.autopilot_id,
          },
        });
      } catch (approveErr: any) {
        console.error(`[Capture] Auto-approve failed:`, approveErr.message);
      }
    }

    inFlightOutputs.delete(body.output_id);

    const totalElapsed = Date.now() - startTime;
    console.log(`[Capture] Complete: ${executionResult.screenshots.length} screenshots in ${totalElapsed}ms`);

    return respond(res, 200, {
      success: true,
      screenshots: executionResult.screenshots.length,
      elapsed_ms: totalElapsed,
      recon_url: reconUrl,
      plan_steps: steps.length,
      failed_actions: executionResult.failedActions,
    });
  } catch (err: any) {
    stats.errors++;
    console.error('[Capture] Error:', err);

    // Clean up browser context on error
    if (context) {
      await context.close().catch(() => {});
    }

    // Try to update output with error
    try {
      const body: CaptureRequest = await parseBody(req).catch(() => ({} as any));
      if (body.output_id && body.supabase_url && body.supabase_key) {
        inFlightOutputs.delete(body.output_id);
        const supabase = createClient(body.supabase_url, body.supabase_key);
        await supabase
          .from('content_outputs')
          .update({
            status: 'error',
            error_message: `Web capture failed: ${err.message}`,
          })
          .eq('id', body.output_id);
      }
    } catch { /* ignore */ }

    return respond(res, 500, { error: err.message });
  }
}

// ============================================================================
// Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return respond(res, 200, {
      status: 'ok',
      ...stats,
      browser_connected: browser?.isConnected() ?? false,
      uptime_s: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
    });
  }

  if (req.method === 'POST' && url.pathname === '/capture') {
    return handleCapture(req, res);
  }

  respond(res, 404, { error: 'Not found' });
});

// ============================================================================
// Startup
// ============================================================================

async function start() {
  // Pre-launch browser for faster first request
  try {
    await getBrowser();
  } catch (err: any) {
    console.error('[WebCapture] Failed to pre-launch browser:', err.message);
    // Don't exit — the browser will be launched on first request
  }

  server.listen(PORT, () => {
    console.log(`[WebCapture] Listening on port ${PORT}`);
    console.log(`[WebCapture] OpenRouter API key: ${OPENROUTER_API_KEY ? 'configured' : 'NOT SET (must be passed per-request)'}`);
  });
}

// ============================================================================
// Crash Recovery
// ============================================================================

process.on('uncaughtException', async (err) => {
  console.error('[WebCapture] FATAL uncaughtException:', err);
  stats.errors++;

  // Close browser on fatal error — it may be in a bad state
  if (browser) {
    try {
      await browser.close();
    } catch { /* ignore */ }
    browser = null;
  }

  // Note: We can't easily mark outputs as errored here because we don't
  // have the Supabase client at the module level. The in-flight tracking
  // is for logging purposes. The per-request error handler above handles
  // DB updates for normal errors.
});

process.on('SIGTERM', async () => {
  console.log('[WebCapture] SIGTERM received, shutting down...');
  if (browser) {
    await browser.close().catch(() => {});
  }
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('[WebCapture] SIGINT received, shutting down...');
  if (browser) {
    await browser.close().catch(() => {});
  }
  server.close(() => process.exit(0));
});

start();
