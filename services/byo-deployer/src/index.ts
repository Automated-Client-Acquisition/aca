/**
 * Entry point.
 *
 * - Boots the Hono HTTP server (Fly.io health checks + edge-function HMAC wake-ups)
 * - Starts the JobRunner (LISTEN on infra_byo_job_created + 30s poll)
 * - Handles graceful shutdown on SIGINT/SIGTERM
 */

import { serve } from '@hono/node-server';
import { JobRunner } from './job-runner.js';
import { createServer } from './server.js';

async function main() {
  const port = Number(process.env.PORT) || 8080;
  const runner = new JobRunner();
  const app = createServer(runner);

  // Boot the server first so Fly's health check passes during initial DB connect.
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[byo-deployer] listening on http://0.0.0.0:${info.port}`);
  });

  try {
    await runner.start();
  } catch (e) {
    console.error('[byo-deployer] runner failed to start', e);
    process.exitCode = 1;
  }

  const shutdown = async (signal: string) => {
    console.log(`[byo-deployer] ${signal} received — shutting down`);
    try { await runner.stop(); } catch (e) { console.error('runner stop failed', e); }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
