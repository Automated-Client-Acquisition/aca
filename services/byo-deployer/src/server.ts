/**
 * Hono HTTP server.
 *
 * Public endpoints:
 *   GET  /health                — liveness probe
 *
 * HMAC-protected endpoints (called by edge functions):
 *   POST /jobs/run-now          — { job_id } — wakes the runner immediately
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { JobRunner } from './job-runner.js';

interface RunNowBody { job_id?: string; ts?: number }

function verifyHmac(secret: string, signatureHeader: string | undefined, body: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = signatureHeader.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

export function createServer(runner: JobRunner): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({
    ok: true,
    service: process.env.DEPLOYER_NAME || 'aca-byo-deployer',
    ts: new Date().toISOString(),
  }));

  app.post('/jobs/run-now', async (c) => {
    const secret = process.env.DEPLOYER_TRIGGER_SECRET;
    if (!secret) return c.json({ ok: false, error: 'DEPLOYER_TRIGGER_SECRET not configured' }, 500);

    const raw = await c.req.text();
    const sig = c.req.header('X-ACA-Signature');
    if (!verifyHmac(secret, sig, raw)) {
      return c.json({ ok: false, error: 'Invalid signature' }, 401);
    }

    let parsed: RunNowBody = {};
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }
    if (!parsed.job_id) return c.json({ ok: false, error: 'job_id required' }, 400);

    // Reject very-stale requests (defense against replay)
    if (parsed.ts && Math.abs(Date.now() - parsed.ts) > 5 * 60 * 1000) {
      return c.json({ ok: false, error: 'Request expired' }, 401);
    }

    void runner.processNext().catch((e) => console.error('[server] processNext failed', e));
    return c.json({ ok: true, accepted: parsed.job_id });
  });

  return app;
}
