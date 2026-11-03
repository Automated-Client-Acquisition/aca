/**
 * Playwright Action Executor
 *
 * Loops through planned steps, executes Playwright actions,
 * captures screenshots, handles failures with LLM-powered recovery,
 * and uploads results to Supabase Storage.
 */

import type { Page } from 'playwright';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlowStep } from './planner.js';
import { planRecovery } from './planner.js';
import { extractDOMSnapshot, summarizeDOMSnapshot } from './dom-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface CapturedScreenshot {
  index: number;
  url: string;
  area: string;
  narrate: string;
  pageUrl: string;
  timestamp: string;
  bboxes?: Array<{ selector: string; text: string; x: number; y: number; width: number; height: number }>;
}

export interface ExecutionResult {
  screenshots: CapturedScreenshot[];
  totalActions: number;
  failedActions: number;
  elapsedMs: number;
}

export interface ExecutorOptions {
  outputId: string;
  stageId: string;
  supabase: SupabaseClient;
  openRouterApiKey: string;
  llmModel?: string;
  organizationId?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_ACTIONS = 20;
const TOTAL_TIMEOUT_MS = 60_000;
const ACTION_TIMEOUT_MS = 8_000;
const STORAGE_BUCKET = 'content-media';

// ============================================================================
// Screenshot Upload
// ============================================================================

async function uploadScreenshot(
  supabase: SupabaseClient,
  outputId: string,
  index: number,
  pngBuffer: Buffer,
): Promise<string> {
  const fileName = `web-capture/${outputId}/screenshot_${index}_${Date.now()}.png`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, pngBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    throw new Error(`Screenshot upload failed: ${error.message}`);
  }

  const { data: { publicUrl } } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(fileName);

  return publicUrl;
}

// ============================================================================
// Element Bbox Extraction
// ============================================================================

async function extractVisibleBboxes(page: Page): Promise<Array<{ selector: string; text: string; x: number; y: number; width: number; height: number }>> {
  return page.evaluate(() => {
    const results: Array<{ selector: string; text: string; x: number; y: number; width: number; height: number }> = [];
    const selectors = 'button, a, [role="button"], [role="tab"], h1, h2, h3, input, select, [class*="card"], [class*="feature"], [class*="pricing"]';

    document.querySelectorAll(selectors).forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;

      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;

      // Only include elements in the current viewport
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      const text = (el.textContent || '').trim().slice(0, 50);
      if (!text) return;

      let selector = '';
      if (el.id) selector = `#${el.id}`;
      else if (el.getAttribute('aria-label')) selector = `[aria-label="${el.getAttribute('aria-label')}"]`;
      else selector = `${el.tagName.toLowerCase()}.${Array.from(el.classList).slice(0, 2).join('.')}`;

      results.push({
        selector,
        text,
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    });

    return results.slice(0, 30);
  });
}

// ============================================================================
// Individual Action Executors
// ============================================================================

async function executeClick(page: Page, step: FlowStep): Promise<void> {
  if (!step.selector) throw new Error('Click action requires a selector');

  // Try Playwright's text-based selector first, then CSS
  try {
    const locator = page.locator(step.selector).first();
    await locator.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
  } catch {
    // Fallback: try alternative selector strategies
    // Handle :has-text() pseudo-selector from our DOM builder
    const hasTextMatch = step.selector.match(/:has-text\("([^"]+)"\)/);
    if (hasTextMatch) {
      const text = hasTextMatch[1];
      const tag = step.selector.split(':')[0];
      const locator = page.locator(`${tag}:text("${text}")`).first();
      await locator.click({ timeout: ACTION_TIMEOUT_MS });
    } else {
      throw new Error(`Element not found: ${step.selector}`);
    }
  }
}

async function executeScroll(page: Page, step: FlowStep): Promise<void> {
  if (step.to) {
    // Check if it's a pixel offset
    const pixelOffset = parseInt(step.to, 10);
    if (!isNaN(pixelOffset)) {
      await page.evaluate((offset) => window.scrollTo({ top: offset, behavior: 'smooth' }), pixelOffset);
    } else {
      // It's a CSS selector — scroll to that element
      try {
        const locator = page.locator(step.to).first();
        await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT_MS });
      } catch {
        // Fallback: scroll by a viewport height
        await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' }));
      }
    }
  } else {
    // Default: scroll down by 80% of viewport
    await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' }));
  }
}

async function executeType(page: Page, step: FlowStep): Promise<void> {
  if (!step.selector) throw new Error('Type action requires a selector');
  if (!step.value) throw new Error('Type action requires a value');

  const locator = page.locator(step.selector).first();
  await locator.waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
  await locator.fill(step.value);
}

async function captureScreenshot(
  page: Page,
  step: FlowStep,
  index: number,
  supabase: SupabaseClient,
  outputId: string,
): Promise<CapturedScreenshot> {
  // Capture viewport screenshot
  const pngBuffer = Buffer.from(await page.screenshot({ type: 'png', fullPage: false }));

  // Extract bounding boxes of visible interactive elements
  const bboxes = await extractVisibleBboxes(page);

  // Upload to Supabase Storage
  const url = await uploadScreenshot(supabase, outputId, index, pngBuffer);

  return {
    index,
    url,
    area: step.area || `Screenshot ${index}`,
    narrate: step.narrate || '',
    pageUrl: page.url(),
    timestamp: new Date().toISOString(),
    bboxes,
  };
}

// ============================================================================
// Main Executor
// ============================================================================

export async function executeSteps(
  page: Page,
  steps: FlowStep[],
  options: ExecutorOptions,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const screenshots: CapturedScreenshot[] = [];
  let totalActions = 0;
  let failedActions = 0;
  let screenshotIndex = 0;

  console.log(`[Executor] Starting execution of ${steps.length} steps`);

  for (let i = 0; i < steps.length; i++) {
    // Safety checks
    if (totalActions >= MAX_ACTIONS) {
      console.warn(`[Executor] Hit max action limit (${MAX_ACTIONS}), stopping`);
      break;
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= TOTAL_TIMEOUT_MS) {
      console.warn(`[Executor] Hit total timeout (${TOTAL_TIMEOUT_MS}ms), stopping`);
      break;
    }

    const step = steps[i];
    totalActions++;

    console.log(`[Executor] Step ${i + 1}/${steps.length}: ${step.action}${step.selector ? ` on "${step.selector}"` : ''}${step.to ? ` to "${step.to}"` : ''}`);

    try {
      switch (step.action) {
        case 'click':
          await executeClick(page, step);
          break;

        case 'scroll':
          await executeScroll(page, step);
          break;

        case 'wait':
          await page.waitForTimeout(Math.min(step.ms || 500, 3000));
          break;

        case 'type':
          await executeType(page, step);
          break;

        case 'screenshot': {
          screenshotIndex++;
          const captured = await captureScreenshot(
            page,
            step,
            screenshotIndex,
            options.supabase,
            options.outputId,
          );
          screenshots.push(captured);
          console.log(`[Executor] Screenshot ${screenshotIndex} captured: ${captured.area}`);
          break;
        }

        default:
          console.warn(`[Executor] Unknown action: ${step.action}, skipping`);
          break;
      }
    } catch (err: any) {
      failedActions++;
      console.error(`[Executor] Step ${i + 1} failed (${step.action}): ${err.message}`);

      // Attempt LLM-powered recovery for non-screenshot actions
      if (step.action !== 'screenshot' && step.action !== 'wait' && options.openRouterApiKey) {
        try {
          console.log('[Executor] Attempting LLM recovery...');

          // Get current page state for recovery context
          const recoveryScreenshot = Buffer.from(await page.screenshot({ type: 'png' }));
          const snapshot = await page.evaluate(extractDOMSnapshot, 3000);
          const domSummary = summarizeDOMSnapshot(snapshot);

          const recovery = await planRecovery(options.openRouterApiKey, {
            failedStep: { action: step.action, selector: step.selector },
            errorMessage: err.message,
            domSummary,
            screenshotBase64: recoveryScreenshot.toString('base64'),
          }, options.llmModel);

          console.log(`[Executor] Recovery suggestion: ${recovery.action} — ${recovery.reason}`);

          // Execute recovery action (only one level deep, no recursion)
          if (recovery.action === 'click' && recovery.selector) {
            try {
              await page.locator(recovery.selector).first().click({ timeout: ACTION_TIMEOUT_MS });
              console.log('[Executor] Recovery click succeeded');
            } catch {
              console.warn('[Executor] Recovery click also failed, moving on');
            }
          } else if (recovery.action === 'scroll') {
            await executeScroll(page, { action: 'scroll', to: recovery.to });
          } else if (recovery.action === 'wait') {
            await page.waitForTimeout(Math.min(recovery.ms || 500, 2000));
          }
          // 'skip' => do nothing, move to next step
        } catch (recoveryErr: any) {
          console.error(`[Executor] Recovery failed: ${recoveryErr.message}`);
        }
      }

      // If the failed action was a screenshot, try to capture anyway
      if (step.action === 'screenshot') {
        try {
          screenshotIndex++;
          const fallback = await captureScreenshot(
            page,
            { ...step, area: `${step.area || 'Screenshot'} (fallback)` },
            screenshotIndex,
            options.supabase,
            options.outputId,
          );
          screenshots.push(fallback);
          console.log(`[Executor] Fallback screenshot ${screenshotIndex} captured`);
        } catch (fallbackErr: any) {
          console.error(`[Executor] Even fallback screenshot failed: ${fallbackErr.message}`);
        }
      }
    }
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`[Executor] Execution complete: ${screenshots.length} screenshots, ${failedActions} failures, ${elapsedMs}ms`);

  return {
    screenshots,
    totalActions,
    failedActions,
    elapsedMs,
  };
}
