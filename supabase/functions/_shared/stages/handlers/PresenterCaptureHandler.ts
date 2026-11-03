/**
 * Custom Handler: Presenter Web Capture Stage
 *
 * Calls the web-capture Fly.io worker to:
 * 1. Open the target URL in headless Playwright
 * 2. Recon the page (DOM, elements, initial screenshot)
 * 3. Use LLM to plan a step-by-step capture flow
 * 4. Execute Playwright actions (clicks, scrolls, screenshots)
 * 5. Upload all screenshots to Supabase Storage
 * 6. Return structured output: { screenshots, page_metadata }
 *
 * Worker URL is read from the WEB_CAPTURE_WORKER_URL env var.
 */

import type { ExecutionContext, StageDefinition, StageResult } from '../../execution/types.ts';
import type { ExecutionEngine } from '../../execution/ExecutionEngine.ts';

// Default timeout for the capture worker
// Needs to be generous: page navigation + LLM planning + execution + screenshot upload to Supabase storage
const CAPTURE_TIMEOUT_MS = 180_000;

interface CaptureWorkerRequest {
  url: string;
  brief: string;
  template_type?: string;
  max_screenshots?: number;
  supabase_url: string;
  supabase_key: string;
  output_id: string;
  stage_id: string;
  viewport?: { width: number; height: number };
  device_type?: 'desktop' | 'mobile';
}

interface ScreenshotData {
  url: string;
  narration_hint: string;
  elements?: Array<{
    selector: string;
    bounds: { x: number; y: number; width: number; height: number };
    text: string;
    type: string;
  }>;
  step_index: number;
}

interface PageMetadata {
  title: string;
  description: string;
  url: string;
  og_image?: string;
}

/**
 * HTTP response from the web-capture worker.
 * NOTE: The worker stores full results (screenshots array, recon data) directly
 * in the database via stage_data. The HTTP response is only a summary.
 * After a successful response, we read the full data from the DB.
 */
interface CaptureWorkerHttpResponse {
  success: boolean;
  screenshots: number; // count, not array
  elapsed_ms: number;
  recon_url: string;
  plan_steps: number;
  failed_actions: number;
}

/**
 * Call the Playwright web-capture Fly.io worker.
 */
async function callPlaywrightWorker(
  requestBody: CaptureWorkerRequest,
  workerUrl: string,
  context: ExecutionContext
): Promise<CaptureWorkerHttpResponse> {
  const response = await fetch(`${workerUrl}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': Deno.env.get('WORKER_INTERNAL_KEY') || '',
    },
    body: JSON.stringify({
      ...requestBody,
      openrouter_api_key: context.apiKeys?.openrouter || '',
      organization_id: context.organizationId,
    }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Web capture worker error ${response.status}: ${errorBody}`
    );
  }

  return await response.json();
}

/**
 * Call the crawl4AI worker. Same request shape as Playwright worker.
 */
async function callCrawl4AIWorker(
  requestBody: CaptureWorkerRequest,
  crawl4aiUrl: string,
  context: ExecutionContext
): Promise<CaptureWorkerHttpResponse> {
  const response = await fetch(`${crawl4aiUrl}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': Deno.env.get('WORKER_INTERNAL_KEY') || '',
    },
    body: JSON.stringify({
      ...requestBody,
      openrouter_api_key: context.apiKeys?.openrouter || '',
      organization_id: context.organizationId,
    }),
    signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `crawl4AI worker error ${response.status}: ${errorBody}`
    );
  }

  return await response.json();
}

/**
 * Try crawl4AI first (if configured), fall back to Playwright worker.
 */
async function callCaptureWorker(
  requestBody: CaptureWorkerRequest,
  playwrightWorkerUrl: string,
  context: ExecutionContext
): Promise<CaptureWorkerHttpResponse> {
  const crawl4aiUrl = Deno.env.get('CRAWL4AI_WORKER_URL');

  if (crawl4aiUrl) {
    try {
      console.log('[PresenterCapture] Trying crawl4AI worker:', crawl4aiUrl);
      const result = await callCrawl4AIWorker(requestBody, crawl4aiUrl, context);
      console.log('[PresenterCapture] crawl4AI succeeded');
      return result;
    } catch (error) {
      console.warn('[PresenterCapture] crawl4AI failed, falling back to Playwright:', (error as Error).message);
    }
  }

  console.log('[PresenterCapture] Using Playwright worker:', playwrightWorkerUrl);
  try {
    return await callPlaywrightWorker(requestBody, playwrightWorkerUrl, context);
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(
        `Web capture worker timed out after ${CAPTURE_TIMEOUT_MS / 1000}s. ` +
        'The page may be too complex or the worker may be unavailable.'
      );
    }
    throw error;
  }
}

/**
 * Execute the web capture stage.
 * Calls the Fly.io web-capture worker and returns screenshots + page metadata.
 */
export async function executeWebCaptureStage(
  context: ExecutionContext,
  _stageDef: StageDefinition,
  _engine: ExecutionEngine
): Promise<StageResult> {
  console.log('[PresenterCaptureHandler] Starting web capture stage');

  // 1. Resolve the worker URL from environment
  const workerUrl = Deno.env.get('WEB_CAPTURE_WORKER_URL');
  if (!workerUrl) {
    throw new Error(
      'WEB_CAPTURE_WORKER_URL environment variable is not configured. ' +
      'Deploy the web-capture Fly.io worker and set the URL.'
    );
  }

  // 2. Extract capture configuration from rawGenerationParams and rawConfiguration
  const rawParams = context.rawGenerationParams || {};
  const rawConfig = context.rawConfiguration || {};

  // Target URL — required. Check video_config (unified video pipeline), presenter_config (per-idea URL),
  // then top-level fields, then blueprint web_capture config.
  const videoConfig = rawParams.video_config || rawConfig.video_config || {};
  const presenterConfig = rawParams.presenter_config || rawConfig.presenter_config || {};
  const slotValues = rawParams.slot_values || {};
  const targetUrl: string =
    slotValues.source_url ||
    videoConfig.source_url || videoConfig.sourceUrl || videoConfig.url ||
    presenterConfig.url ||
    rawParams.url ||
    rawConfig.url ||
    rawConfig.web_capture?.url ||
    '';

  if (!targetUrl) {
    throw new Error(
      'No target URL configured for web_capture stage. ' +
      'Set `url` in the blueprint configuration.'
    );
  }

  // Optional fields
  const templateType: string | undefined =
    rawParams.template_type ||
    rawConfig.template_type ||
    rawConfig.web_capture?.template_type;

  const maxScreenshots: number =
    rawParams.max_screenshots ||
    rawConfig.max_screenshots ||
    rawConfig.web_capture?.max_screenshots ||
    8;

  // Brief: use idea context as fallback
  const brief: string =
    rawParams.brief ||
    rawConfig.brief ||
    context.ideaContext ||
    'Capture the key content from this page';

  // Supabase credentials for the worker to upload screenshots
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for web capture worker');
  }

  // Resolve orientation — check presenter_config first, then top-level, then fallback
  const orientation: string =
    presenterConfig.orientation ||
    rawParams.orientation ||
    rawConfig.orientation ||
    rawConfig.video_orientation ||
    rawParams.video_orientation ||
    (context.outputConfig?.aspectRatio === '16:9' ? 'landscape' : 'portrait');

  // Viewport lookup table — dimensions × deviceScaleFactor must match the Remotion
  // composition size.  Portrait 360×640 @ 3× = 1080×1920 (9:16).
  // Landscape 1920×1080 @ 1× = 1920×1080 (16:9).
  const VIEWPORT_MAP: Record<string, { width: number; height: number; deviceType: string }> = {
    portrait:  { width: 360,  height: 640,  deviceType: 'mobile' },
    landscape: { width: 1920, height: 1080, deviceType: 'desktop' },
    square:    { width: 1080, height: 1080, deviceType: 'desktop' },
  };

  const viewportConfig = VIEWPORT_MAP[orientation] || VIEWPORT_MAP.portrait;
  const viewport = { width: viewportConfig.width, height: viewportConfig.height };

  console.log('[PresenterCaptureHandler] Capture config:', {
    url: targetUrl,
    template_type: templateType,
    max_screenshots: maxScreenshots,
    brief_length: brief.length,
    worker_url: workerUrl,
    orientation,
    viewport,
    device_type: viewportConfig.deviceType,
  });

  // 3. Build request body
  const requestBody: CaptureWorkerRequest = {
    url: targetUrl,
    brief,
    template_type: templateType,
    max_screenshots: maxScreenshots,
    supabase_url: supabaseUrl,
    supabase_key: supabaseServiceKey,
    output_id: context.outputId,
    stage_id: context.stageId,
    viewport,
    device_type: viewportConfig.deviceType as 'desktop' | 'mobile',
  };

  // 4. Call capture worker — try crawl4AI first (if configured), fall back to Playwright
  const httpResponse = await callCaptureWorker(requestBody, workerUrl, context);

  // 5. Validate the HTTP summary
  if (!httpResponse.success) {
    throw new Error('Web capture worker returned failure');
  }

  if (httpResponse.screenshots === 0) {
    throw new Error(
      `Web capture worker returned 0 screenshots for URL: ${targetUrl}. ` +
      'The page may require authentication or the URL may be unreachable.'
    );
  }

  // 6. Read the full stage data from the database
  // The worker already wrote { screenshots: [...], recon: {...}, ... } to stage_data[stage_id]
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.81.1');
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: output } = await supabase
    .from('content_outputs')
    .select('stage_data')
    .eq('id', context.outputId)
    .single();

  const stageData = output?.stage_data?.[context.stageId];

  if (!stageData?.screenshots || stageData.screenshots.length === 0) {
    throw new Error('Web capture worker completed but no screenshot data found in database');
  }

  console.log('[PresenterCaptureHandler] Capture complete:', {
    screenshots: stageData.screenshots.length,
    duration_ms: httpResponse.elapsed_ms,
    recon_title: stageData.recon?.title,
  });

  // 7. Return the stage result — the data is already in the DB, but we return
  // the content so the execution engine can pass it to downstream stages.
  return {
    content: {
      screenshots: stageData.screenshots,
      page_metadata: {
        title: stageData.recon?.title || '',
        description: stageData.recon?.meta_description || '',
        url: stageData.recon?.url || targetUrl,
        og_image: stageData.recon?.og_image,
      },
      total_screenshots: stageData.screenshots.length,
      capture_duration_ms: httpResponse.elapsed_ms,
      template_type: templateType,
      source_url: targetUrl,
    },
    status: 'completed',
  };
}

export default executeWebCaptureStage;
