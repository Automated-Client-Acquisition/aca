/**
 * Content Pipeline Worker — Fly.io
 *
 * Auto-stop HTTP service that drives long-running content generation stages
 * to completion by re-invoking the execute-stage edge function as needed.
 *
 * Architecture (continuation loop driver):
 *   - Receives POST /execute with { output_id, stage_id, ... }
 *   - Calls execute-stage edge function via HTTP
 *   - If the edge function returns partial=true (hit its internal timeout),
 *     the worker automatically re-invokes it (the edge function resumes
 *     from saved progress in the database)
 *   - Repeats until the stage completes or fails
 *   - Returns the final result to the caller
 *
 * This worker does NOT reimplement any stage execution logic — it only
 * automates the continuation loop that was previously handled by the
 * frontend's useResetStaleSceneGeneration hook.
 *
 * Long-running stages that benefit from this:
 *   - enhanced_scenes (scene_array) — batched LLM calls for 15+ scenes
 *   - voice_segments — per-scene TTS calls for many scenes
 *
 * Routes:
 *   POST /execute  — run a stage with automatic continuation, returns when done
 *   GET  /health   — returns worker stats
 *
 * Config (env vars):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 *   EDGE_FUNCTION_URL         — Base URL for edge functions (e.g. https://x.supabase.co/functions/v1)
 *   MAX_CONCURRENT            — Max simultaneous stage executions (default: 5)
 *   MAX_CONTINUATIONS         — Max re-invocations per stage (default: 20)
 *   CALL_TIMEOUT_MS           — Per-call timeout to edge function (default: 150000 = 2.5 min)
 */

import http from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL || `${SUPABASE_URL}/functions/v1`;
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '5', 10);
const MAX_CONTINUATIONS = parseInt(process.env.MAX_CONTINUATIONS || '20', 10);
const CALL_TIMEOUT_MS = parseInt(process.env.CALL_TIMEOUT_MS || '150000', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Stats
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  totalExecuted: 0,
  totalContinuations: 0,
  totalErrors: 0,
  activeExecutions: 0,
  lastExecutionAt: null as string | null,
  lastExecutionDurationMs: 0,
};

// ============================================================================
// Stage Execution with Continuation Loop
// ============================================================================

let activeExecutions = 0;

interface ExecuteRequest {
  output_id: string;
  stage_id: string;
  regenerate_clip?: number;
  regenerate_scene?: number;
  custom_prompt?: string;
  instructions?: string;
}

/**
 * Call the execute-stage edge function once.
 * Returns the parsed JSON result or throws on error.
 */
async function callEdgeFunction(payload: ExecuteRequest): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  try {
    const response = await fetch(`${EDGE_FUNCTION_URL}/execute-stage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'x-content-worker': 'true',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error ${response.status}: ${errorText.substring(0, 500)}`);
    }

    return await response.json();
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`Edge function call timed out after ${CALL_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if the stage is still in a partial/generating state by reading the DB.
 * This handles the case where the edge function timed out without returning.
 */
async function isStagePartial(outputId: string, stageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('content_outputs')
    .select('stage_data, status')
    .eq('id', outputId)
    .single();

  if (!data) return false;

  const stageData = data.stage_data?.[stageId];
  if (!stageData) return false;

  // Enhanced scenes batching: has completed_batches < total_batches
  if (
    stageData.status === 'generating' &&
    stageData.completed_batches > 0 &&
    stageData.total_batches > 0 &&
    stageData.completed_batches < stageData.total_batches
  ) {
    return true;
  }

  return false;
}

/**
 * Execute a stage with automatic continuation loop.
 *
 * The edge function's executeEnhancedScenesStage saves progress after each
 * batch and returns partial=true when approaching its timeout. This function
 * re-invokes the edge function until the stage completes.
 */
async function executeStageWithContinuation(
  req: ExecuteRequest
): Promise<{ success: boolean; result?: any; error?: string; continuations: number }> {
  const startTime = Date.now();
  const { output_id, stage_id } = req;
  let continuations = 0;

  console.log(`[Worker] Starting stage ${stage_id} for output ${output_id}`);

  while (continuations <= MAX_CONTINUATIONS) {
    try {
      const result = await callEdgeFunction(req);

      // Check if the edge function returned a partial result
      const stageResult = result?.result || result;
      const isPartial = stageResult?.partial === true || stageResult?.result?.partial === true;

      if (isPartial) {
        continuations++;
        stats.totalContinuations++;
        const completedBatches = stageResult.completed_batches || stageResult.result?.completed_batches || '?';
        const totalBatches = stageResult.total_batches || stageResult.result?.total_batches || '?';
        console.log(
          `[Worker] Stage ${stage_id} returned partial (${completedBatches}/${totalBatches}). ` +
          `Continuation ${continuations}/${MAX_CONTINUATIONS}...`
        );
        // Small delay before re-invocation to avoid hammering
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // Stage completed
      const durationMs = Date.now() - startTime;
      stats.totalExecuted++;
      stats.lastExecutionDurationMs = durationMs;
      stats.lastExecutionAt = new Date().toISOString();
      console.log(
        `[Worker] Stage ${stage_id} completed for ${output_id} in ${durationMs}ms ` +
        `(${continuations} continuations)`
      );
      return { success: true, result, continuations };
    } catch (err: any) {
      // Edge function might have timed out mid-batch — check if progress was saved
      if (err.message.includes('timed out') || err.message.includes('502') || err.message.includes('504')) {
        console.warn(`[Worker] Edge function call failed (${err.message}), checking for partial progress...`);

        // Wait a moment for DB writes to flush
        await new Promise(resolve => setTimeout(resolve, 2000));

        const hasPartialProgress = await isStagePartial(output_id, stage_id);
        if (hasPartialProgress) {
          continuations++;
          stats.totalContinuations++;
          console.log(
            `[Worker] Found partial progress for ${stage_id}. ` +
            `Continuation ${continuations}/${MAX_CONTINUATIONS}...`
          );
          continue;
        }
      }

      // Real error — no partial progress to resume from
      const durationMs = Date.now() - startTime;
      stats.totalErrors++;
      console.error(
        `[Worker] Stage ${stage_id}/${output_id} failed after ${durationMs}ms:`,
        err.message
      );
      return { success: false, error: err.message, continuations };
    }
  }

  // Exceeded max continuations
  stats.totalErrors++;
  const durationMs = Date.now() - startTime;
  console.error(
    `[Worker] Stage ${stage_id}/${output_id} exceeded max continuations (${MAX_CONTINUATIONS}) after ${durationMs}ms`
  );
  return {
    success: false,
    error: `Exceeded max continuations (${MAX_CONTINUATIONS})`,
    continuations,
  };
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    stats.activeExecutions = activeExecutions;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ...stats }));
    return;
  }

  // Execute stage
  if (req.url === '/execute' && req.method === 'POST') {
    // Public Fly endpoint that calls execute-stage with the service key: only accept
    // execute-stage's own delegation, which sends that key.
    if (req.headers['authorization'] !== `Bearer ${SUPABASE_KEY}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Check concurrency
    if (activeExecutions >= MAX_CONCURRENT) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Too many concurrent executions', activeExecutions }));
      return;
    }

    // Parse body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let payload: ExecuteRequest;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!payload.output_id || !payload.stage_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'output_id and stage_id are required' }));
      return;
    }

    // Execute with continuation — caller waits for final result
    activeExecutions++;
    try {
      const result = await executeStageWithContinuation(payload);
      res.writeHead(result.success ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      activeExecutions--;
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[Worker] Content pipeline worker listening on :${PORT}`);
  console.log(`[Worker] Edge function URL: ${EDGE_FUNCTION_URL}`);
  console.log(`[Worker] Max concurrent: ${MAX_CONCURRENT}`);
  console.log(`[Worker] Max continuations: ${MAX_CONTINUATIONS}`);
  console.log(`[Worker] Call timeout: ${CALL_TIMEOUT_MS}ms`);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  server.close(() => {
    console.log('[Worker] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 30s
  setTimeout(() => {
    console.error('[Worker] Forced exit after 30s');
    process.exit(1);
  }, 30000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception:', err);
  stats.totalErrors++;
});

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection:', reason);
  stats.totalErrors++;
});
