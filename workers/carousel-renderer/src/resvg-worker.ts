/**
 * resvg Child Process Worker
 *
 * Runs resvg rendering in an isolated CHILD PROCESS so that a native Rust panic
 * (SIGABRT) only kills this process, not the main HTTP server.
 *
 * Worker threads are NOT sufficient because Rust's abort() kills the entire process.
 * Child processes provide true isolation — a SIGABRT in the child is just an exit code to the parent.
 *
 * Communication via stdin (JSON) → stdout (JSON):
 *   IN:  { svg: string, width: number }
 *   OUT: { ok: true, pngBase64: string } | { ok: false, error: string }
 */

import { Resvg } from '@resvg/resvg-js';

/** Write result to stdout, wait for flush, then exit. */
function writeAndExit(data: string, code: number): void {
  // stdout.write() returns false when the kernel buffer is full.
  // process.exit() before flush truncates output → parent sees corrupted JSON.
  // Using the callback ensures all data is flushed before exit.
  const flushed = process.stdout.write(data, () => process.exit(code));
  if (!flushed) {
    // Backpressure — wait for drain before the callback fires
    process.stdout.once('drain', () => {}); // callback handles exit
  }
}

// Read all of stdin
const chunks: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(Buffer.concat(chunks).toString());
    const { svg, width } = input as { svg: string; width: number };

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width' as const, value: width },
    });

    // Check inner bbox before render — if null/zero, skip to avoid panic
    const bbox = resvg.innerBBox();
    if (!bbox || bbox.width === 0 || bbox.height === 0) {
      writeAndExit(JSON.stringify({
        ok: false,
        error: `SVG has empty/zero bounding box (${JSON.stringify(bbox)}) — cannot render`,
      }), 0);
      return;
    }

    const pngData = resvg.render();
    const pngBuffer = Buffer.from(pngData.asPng());

    writeAndExit(JSON.stringify({
      ok: true,
      pngBase64: pngBuffer.toString('base64'),
    }), 0);
  } catch (err: any) {
    writeAndExit(JSON.stringify({
      ok: false,
      error: err.message || 'resvg render failed',
    }), 1);
  }
});
