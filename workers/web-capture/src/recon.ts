/**
 * Recon Module — Initial Page Analysis
 *
 * Opens the target URL, optionally logs in, dismisses popups,
 * extracts DOM structure, and takes an initial full-page screenshot.
 */

import type { Page } from 'playwright';
import { extractDOMSnapshot, summarizeDOMSnapshot, type DOMSnapshot } from './dom-utils.js';

// ============================================================================
// Types
// ============================================================================

export interface ReconOptions {
  url: string;
  login?: { email: string; password: string };
  viewport?: { width: number; height: number };
}

export interface ReconResult {
  snapshot: DOMSnapshot;
  domSummary: string;
  initialScreenshot: Buffer;
  finalUrl: string;
  loadTimeMs: number;
}

// ============================================================================
// Cookie / Popup Dismissal
// ============================================================================

const POPUP_DISMISS_SELECTORS = [
  // Cookie consent
  'button:has-text("Accept")',
  'button:has-text("Accept All")',
  'button:has-text("Accept all")',
  'button:has-text("Accept cookies")',
  'button:has-text("Allow all")',
  'button:has-text("Allow All")',
  'button:has-text("Got it")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("OK")',
  '[id*="cookie"] button',
  '[class*="cookie"] button',
  '[id*="consent"] button',
  '[class*="consent"] button',
  '[data-testid*="cookie"] button',
  // Generic close buttons on overlays
  '[class*="modal"] [class*="close"]',
  '[class*="popup"] [class*="close"]',
  '[class*="overlay"] [class*="close"]',
  '[class*="banner"] [class*="close"]',
  'button[aria-label="Close"]',
  'button[aria-label="Dismiss"]',
  'button[aria-label="close"]',
];

async function dismissPopups(page: Page): Promise<void> {
  for (const selector of POPUP_DISMISS_SELECTORS) {
    try {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 300 }).catch(() => false);
      if (visible) {
        await el.click({ timeout: 1000 }).catch(() => {});
        // Small wait for the popup animation to finish
        await page.waitForTimeout(300);
        break; // One dismiss is usually enough
      }
    } catch {
      // Not found, try next
    }
  }
}

// ============================================================================
// Login Handler
// ============================================================================

async function handleLogin(page: Page, login: { email: string; password: string }): Promise<void> {
  console.log('[Recon] Attempting login...');

  // Look for common email/username fields
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="user"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="username" i]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
  ];

  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="password" i]',
    'input[autocomplete="current-password"]',
  ];

  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Login")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
  ];

  // Fill email
  for (const sel of emailSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.fill(login.email);
        break;
      }
    } catch { /* continue */ }
  }

  // Fill password
  for (const sel of passwordSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.fill(login.password);
        break;
      }
    } catch { /* continue */ }
  }

  // Click submit
  for (const sel of submitSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click();
        break;
      }
    } catch { /* continue */ }
  }

  // Wait for navigation after login
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  console.log('[Recon] Login attempt completed, now at:', page.url());
}

// ============================================================================
// Main Recon
// ============================================================================

export async function performRecon(page: Page, options: ReconOptions): Promise<ReconResult> {
  const startTime = Date.now();

  // Set viewport
  const viewport = options.viewport || { width: 1440, height: 900 };
  await page.setViewportSize(viewport);

  // Navigate
  console.log(`[Recon] Navigating to ${options.url}...`);
  await page.goto(options.url, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });

  // Wait for network to settle (but don't wait forever)
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {
    console.log('[Recon] Network idle timeout — proceeding with current state');
  });

  // Handle login if credentials provided
  if (options.login) {
    await handleLogin(page, options.login);
  }

  // Dismiss cookie banners and popups
  await dismissPopups(page);

  // Small stabilization wait
  await page.waitForTimeout(500);

  // Extract DOM snapshot
  console.log('[Recon] Extracting DOM snapshot...');
  const snapshot = await page.evaluate(extractDOMSnapshot, 5000);

  // Generate summary for LLM
  const domSummary = summarizeDOMSnapshot(snapshot);

  // Take initial full-page screenshot
  console.log('[Recon] Taking initial screenshot...');
  const initialScreenshot = await page.screenshot({
    type: 'png',
    fullPage: false, // Viewport only for initial recon
  });

  const loadTimeMs = Date.now() - startTime;
  console.log(`[Recon] Complete in ${loadTimeMs}ms. URL: ${page.url()}, Headings: ${snapshot.headings.length}, Clickables: ${snapshot.clickables.length}`);

  return {
    snapshot,
    domSummary,
    initialScreenshot: Buffer.from(initialScreenshot),
    finalUrl: page.url(),
    loadTimeMs,
  };
}
