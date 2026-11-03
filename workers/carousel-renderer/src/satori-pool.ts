/**
 * Satori in a worker thread, with a timeout.
 *
 * Satori can loop forever on some layouts (text inside a box narrower than one of its
 * glyphs never finishes wrapping). It runs synchronously, so in the main thread a hang
 * blocks the whole server and no timeout can fire. In a worker thread the main thread
 * stays free, and `worker.terminate()` stops even a tight loop.
 *
 * One long-lived thread loads the fonts once and renders requests one after another. On a
 * timeout or crash the thread is thrown away (requests queued behind the stuck one fail
 * too; callers retry) and the next request starts a fresh one.
 *
 * resvg stays in its own child process (resvg-worker.ts): a native Rust abort kills a
 * whole process, which a thread cannot contain.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const THREAD_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'satori-thread.js');
const TIMEOUT_MS = Number(process.env.SATORI_TIMEOUT_MS) || 20_000;

export interface SatoriJob {
  width: number;
  height: number;
  embedFont: boolean;
}

interface Pending {
  resolve: (svg: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

let thread: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(err: Error) {
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
    pending.delete(id);
  }
}

function discard(reason: Error) {
  const t = thread;
  thread = null;
  failAll(reason);
  if (t) void t.terminate();
}

function spawn(): Worker {
  const t = new Worker(THREAD_PATH);
  t.on('message', (m: { id: number; svg?: string; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(m.error));
    else p.resolve(m.svg ?? '');
  });
  t.on('error', (err) => {
    if (thread === t) discard(err instanceof Error ? err : new Error(String(err)));
  });
  t.on('exit', (code) => {
    if (thread === t) discard(new Error(`satori thread exited (code ${code})`));
  });
  // the pending request's timer keeps the process alive while a render is in flight
  t.unref();
  return t;
}

/** Render a Satori element tree to SVG in the worker thread. Rejects after `timeoutMs`. */
export function satoriIsolated(element: unknown, job: SatoriJob, timeoutMs = TIMEOUT_MS): Promise<string> {
  if (!thread) thread = spawn();
  const t = thread;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      console.error(`[SatoriPool] render ${id} took longer than ${timeoutMs}ms; restarting the satori thread`);
      // fail this one first so its error names the timeout, then everything queued behind it
      const p = pending.get(id)!;
      pending.delete(id);
      p.reject(new Error(`Satori layout timed out after ${timeoutMs}ms`));
      if (thread === t) discard(new Error('satori thread restarted after a timeout'));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    t.postMessage({ id, element, job });
  });
}
