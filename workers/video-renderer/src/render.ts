import path from 'node:path';
import fs from 'node:fs';
import { bundle } from '@remotion/bundler';
import {
  renderMedia,
  selectComposition,
  ensureBrowser,
  openBrowser,
  makeCancelSignal,
} from '@remotion/renderer';
import type { HeadlessBrowser } from '@remotion/renderer';
import type { RenderInput } from './types.js';
import { getResolution } from './types.js';

let cachedBundleLocation: string | null = null;
let sharedBrowser: HeadlessBrowser | null = null;

// Use system Chromium if available (Docker), otherwise let Remotion download
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || null;

// Track active cancel signals by output_id
const activeCancelSignals = new Map<string, { cancelSignal: any; cancel: () => void }>();

/**
 * Bundle the Remotion project. Cached after first call for fast re-renders.
 */
async function ensureBundle(): Promise<string> {
  if (cachedBundleLocation && fs.existsSync(cachedBundleLocation)) {
    return cachedBundleLocation;
  }

  console.log('[render] Bundling Remotion project...');
  const start = Date.now();

  cachedBundleLocation = await bundle({
    entryPoint: path.join(import.meta.dirname, 'remotion', 'Root.js'),
    webpackOverride: (config) => config,
  });

  console.log(`[render] Bundle complete in ${Date.now() - start}ms`);
  return cachedBundleLocation;
}

/**
 * Open a shared browser instance for reuse across renders.
 */
async function ensureSharedBrowser(): Promise<HeadlessBrowser> {
  if (sharedBrowser) return sharedBrowser;

  console.log('[render] Opening shared browser instance...');
  sharedBrowser = await openBrowser('chrome', {
    ...(CHROMIUM_PATH ? { browserExecutable: CHROMIUM_PATH } : {}),
    chromiumOptions: {
      enableMultiProcessOnLinux: true,
      gl: 'angle-egl',
      disableWebSecurity: true,
    },
  });

  return sharedBrowser;
}

/**
 * Pre-warm: bundle + ensure browser are ready before first render request.
 */
export async function warmUp(): Promise<void> {
  const start = Date.now();
  await Promise.all([
    ensureBundle(),
    ensureBrowser({
      ...(CHROMIUM_PATH ? { browserExecutable: CHROMIUM_PATH } : {}),
    }),
    ensureSharedBrowser(),
  ]);
  console.log(`[render] Warm-up complete in ${Date.now() - start}ms`);
}

/**
 * Cancel an in-progress render by output_id.
 * Returns true if a render was found and cancelled.
 */
export function cancelRender(outputId: string): boolean {
  const entry = activeCancelSignals.get(outputId);
  if (entry) {
    entry.cancel();
    activeCancelSignals.delete(outputId);
    console.log(`[render] Cancelled render for ${outputId}`);
    return true;
  }
  return false;
}

export interface RenderProgress {
  progress: number;
  renderedFrames: number;
  encodedFrames: number;
  totalFrames: number;
  renderedDoneIn: number | null;
  encodedDoneIn: number | null;
  stitchStage: string;
}

/** Env the compositions read (Remotion doesn't forward the worker's env on its own). */
const COMPOSITION_ENV: Record<string, string> = process.env.ACA_ASSETS_URL
  ? { ACA_ASSETS_URL: process.env.ACA_ASSETS_URL }
  : {};

/**
 * Render a video using Remotion.
 *
 * Routes to the correct composition:
 * - DynamicVideo: when remotion_code is present (motion graphics from code)
 * - StoryboardVideo: when clips are present (scene-based videos)
 */
export async function renderVideo(
  data: RenderInput,
  onProgress?: (progress: RenderProgress) => void,
): Promise<string> {
  const bundleLocation = await ensureBundle();
  const browser = await ensureSharedBrowser();
  const resolution = getResolution(data.aspect_ratio, data.resolution, data.fps);

  // Pick composition based on what's in the render input
  const compositionId = data.remotion_code?.trim() ? 'DynamicVideo' : 'StoryboardVideo';

  console.log(`[render] Selecting composition "${compositionId}" (${resolution.width}x${resolution.height}@${resolution.fps}fps)...`);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps: data as unknown as Record<string, unknown>,
    envVariables: COMPOSITION_ENV,
    puppeteerInstance: browser,
    timeoutInMilliseconds: 90_000,
  });

  const outputPath = `/tmp/video-${data.output_id}-${Date.now()}.mp4`;

  console.log(`[render] Rendering ${composition.durationInFrames} frames...`);
  const start = Date.now();

  // Create cancel signal for this render
  const { cancelSignal, cancel } = makeCancelSignal();
  activeCancelSignals.set(data.output_id, { cancelSignal, cancel });

  try {
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: outputPath,
      inputProps: data as unknown as Record<string, unknown>,
      envVariables: COMPOSITION_ENV,
      puppeteerInstance: browser,
      chromiumOptions: {
        enableMultiProcessOnLinux: true,
        gl: 'angle-egl',
        disableWebSecurity: true,
      },
      concurrency: '50%',
      timeoutInMilliseconds: 90_000,
      cancelSignal,
      onProgress: (p) => {
        if (onProgress) {
          onProgress({
            progress: p.progress,
            renderedFrames: p.renderedFrames,
            encodedFrames: p.encodedFrames,
            totalFrames: composition.durationInFrames,
            renderedDoneIn: p.renderedDoneIn,
            encodedDoneIn: p.encodedDoneIn,
            stitchStage: p.stitchStage,
          });
        }
      },
      // Quality settings
      crf: 18,
      pixelFormat: 'yuv420p',
      enforceAudioTrack: true,
      audioCodec: 'aac',
    });
  } finally {
    activeCancelSignals.delete(data.output_id);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const fileSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
  console.log(`[render] Complete: ${elapsed}s, ${fileSizeMB}MB`);

  return outputPath;
}
