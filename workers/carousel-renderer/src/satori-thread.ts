/**
 * Worker-thread side of satori-pool.ts: loads the fonts once, then turns element trees
 * into SVG, one message at a time.
 */

import { parentPort } from 'node:worker_threads';
import satori from 'satori';
import { loadAdditionalAsset, loadFonts } from './carousel-slide-renderer.js';
import type { SatoriJob } from './satori-pool.js';

if (!parentPort) throw new Error('satori-thread must run as a worker thread');
const port = parentPort;

port.on('message', async (m: { id: number; element: any; job: SatoriJob }) => {
  try {
    const fonts = await loadFonts();
    const svg = await satori(m.element, {
      width: m.job.width,
      height: m.job.height,
      fonts: fonts as any,
      embedFont: m.job.embedFont,
      loadAdditionalAsset,
    });
    port.postMessage({ id: m.id, svg });
  } catch (err: any) {
    port.postMessage({ id: m.id, error: err?.message || String(err) });
  }
});
