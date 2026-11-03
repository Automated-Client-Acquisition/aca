/**
 * Company Analyzer Worker — Fly.io
 *
 * Auto-stop HTTP service that processes company analysis jobs.
 * Triggered by the process-company-analysis-job edge function.
 * No timeout limits — runs until all contacts are processed.
 *
 * Routes:
 *   POST /process  — accepts { jobId }, kicks off processing async, returns 200 immediately
 *   GET  /health   — returns worker stats
 *
 * Config (env vars):
 *   PARALLEL_CONCURRENCY    — contacts processed in parallel per batch (default: 5)
 *   CONTACT_TIMEOUT_MS      — per-contact safety timeout in ms (default: 180000)
 *   SUPABASE_URL            — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 */

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Job endpoints require the header the edge functions send
// (supabase/functions/_shared/fly-worker-auth.ts): an HMAC of the service-role key with a
// fixed label. Without it, anyone who knew this URL and a job id could re-run any org's job.
const WORKER_AUTH_SECRET = createHmac('sha256', SUPABASE_KEY).update('aca-fly-worker-v1').digest('hex');
function isAuthorizedWorkerCall(req: http.IncomingMessage): boolean {
  const got = req.headers['x-aca-worker-auth'];
  if (typeof got !== 'string' || got.length !== WORKER_AUTH_SECRET.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(WORKER_AUTH_SECRET));
}
const BASE_CONCURRENCY = parseInt(process.env.PARALLEL_CONCURRENCY || '5', 10);
const CONTACT_TIMEOUT_MS = parseInt(process.env.CONTACT_TIMEOUT_MS || '180000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_IN_CHUNK = 50;

// Dynamic concurrency: reduce per-job parallelism when multiple jobs run concurrently
// to avoid overwhelming crawl4ai / Supabase edge functions
function getParallelConcurrency(): number {
  if (stats.activeJobs <= 1) return BASE_CONCURRENCY;        // 5 when solo
  if (stats.activeJobs === 2) return Math.max(3, Math.floor(BASE_CONCURRENCY * 0.6));  // 3 when 2 jobs
  return 2;                                                   // 2 when 3+ jobs
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface JobResult {
  contactId: string;
  status: 'success' | 'skipped' | 'failed';
  error?: string;
}

interface CompanyAnalysisJob {
  id: string;
  organization_id: string;
  contact_ids: string[];
  model: string;
  unipile_account_id: string | null;
  product_context: Record<string, unknown>;
  product_id: string | null;
  icp_ids: string[] | null;
  include_already_analyzed: boolean;
  status: string;
  results: JobResult[] | null;
  analyzed_count: number;
  skipped_count: number;
  failed_count: number;
  total_contacts: number;
}

interface Contact {
  id: string;
  display_name: string;
  company_website: string | null;
  primary_linkedin_url: string | null;
  enriched_at: string | null;
}

// ============================================================================
// Stats (exposed via /health)
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  activeJobs: 0,
  totalJobsProcessed: 0,
  totalContactsAnalyzed: 0,
  totalContactsFailed: 0,
  totalContactsSkipped: 0,
  totalErrors: 0,
  lastJobAt: null as string | null,
  lastJobId: null as string | null,
};

// ============================================================================
// Supabase client
// ============================================================================

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// Helpers
// ============================================================================

async function fetchContactsChunked(
  contactIds: string[],
  organizationId: string,
): Promise<{ data: Contact[]; error: string | null }> {
  if (contactIds.length === 0) return { data: [], error: null };

  const allContacts: Contact[] = [];
  for (let i = 0; i < contactIds.length; i += MAX_IN_CHUNK) {
    const chunk = contactIds.slice(i, i + MAX_IN_CHUNK);
    let lastError: string | null = null;

    // Retry once on failure
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id, display_name, company_website, primary_linkedin_url, enriched_at')
        .in('id', chunk)
        .eq('organization_id', organizationId);

      if (error) {
        lastError = error.message;
        console.error(`Chunk ${i / MAX_IN_CHUNK + 1} fetch failed (attempt ${attempt + 1}):`, error.message);
        if (attempt === 0) await sleep(500);
        continue;
      }

      if (data) allContacts.push(...(data as Contact[]));
      lastError = null;
      break;
    }

    if (lastError) {
      return { data: [], error: `Failed to fetch contacts chunk ${i / MAX_IN_CHUNK + 1}: ${lastError}` };
    }
  }
  return { data: allContacts, error: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await supabase
    .from('company_analysis_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId);
}

// ============================================================================
// Core: Analyze a single contact
// ============================================================================

async function analyzeOne(
  contact: Contact,
  job: CompanyAnalysisJob,
): Promise<JobResult> {
  // Mark contact as analyzing
  await supabase
    .from('crm_contacts')
    .update({ ai_analysis_status: 'analyzing' })
    .eq('id', contact.id);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONTACT_TIMEOUT_MS);

    const response = await fetch(`${SUPABASE_URL}/functions/v1/analyze-company`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contactId: contact.id,
        companyWebsite: contact.company_website,
        linkedinUrl: contact.primary_linkedin_url,
        unipileAccountId: job.unipile_account_id,
        model: job.model,
        productContext: job.product_context,
        productId: job.product_id,
        icpIds: job.icp_ids ?? undefined,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Guard against non-JSON responses (Supabase gateway 502/504 returns HTML)
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = (await response.text()).substring(0, 200);
      throw new Error(`Edge function returned non-JSON (${response.status}): ${text}`);
    }

    const result = await response.json();

    if (result.success) {
      await supabase
        .from('crm_contacts')
        .update({ ai_analysis_status: 'analyzed', ai_analyzed_at: new Date().toISOString() })
        .eq('id', contact.id);
      return { contactId: contact.id, status: 'success' };
    } else if (result.skipped) {
      await supabase
        .from('crm_contacts')
        .update({ ai_analysis_status: 'not_analyzed' })
        .eq('id', contact.id);
      return { contactId: contact.id, status: 'skipped', error: result.error || 'Skipped' };
    } else {
      console.error(`[FAIL] ${contact.display_name}: ${result.error || 'Analysis failed'}`);
      await supabase
        .from('crm_contacts')
        .update({ ai_analysis_status: 'failed' })
        .eq('id', contact.id);
      return { contactId: contact.id, status: 'failed', error: result.error || 'Analysis failed' };
    }
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === 'AbortError';
    const errorMsg = isTimeout
      ? `Analysis timed out after ${CONTACT_TIMEOUT_MS / 1000}s`
      : (error instanceof Error ? error.message : 'Unknown error');
    console.error(`Failed to analyze contact ${contact.id} (${contact.display_name}):`, errorMsg);
    await supabase
      .from('crm_contacts')
      .update({ ai_analysis_status: 'failed' })
      .eq('id', contact.id);
    return { contactId: contact.id, status: 'failed', error: errorMsg };
  }
}

// ============================================================================
// Core: Process a full job
// ============================================================================

async function processJob(jobId: string): Promise<void> {
  stats.activeJobs++;
  cancelIdleShutdown(); // Don't shutdown while processing
  stats.lastJobId = jobId;
  stats.lastJobAt = new Date().toISOString();

  console.log(`[Job ${jobId}] Starting processing`);

  try {
    // 1. Fetch job record
    const { data: job, error: jobError } = await supabase
      .from('company_analysis_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`[Job ${jobId}] Not found:`, jobError);
      return;
    }

    const typedJob = job as CompanyAnalysisJob;

    if (typedJob.status !== 'running') {
      console.log(`[Job ${jobId}] Not in running state (${typedJob.status}), skipping`);
      return;
    }

    // 2. Fetch all contacts
    const { data: contacts, error: contactsError } = await fetchContactsChunked(
      typedJob.contact_ids, typedJob.organization_id
    );

    if (contactsError) {
      console.error(`[Job ${jobId}] Failed to fetch contacts:`, contactsError);
      await updateJobFailed(jobId, contactsError);
      return;
    }

    console.log(`[Job ${jobId}] Fetched ${contacts.length} contacts`);

    // Update total_contacts
    await supabase
      .from('company_analysis_jobs')
      .update({ total_contacts: contacts.length })
      .eq('id', jobId);

    // 3. Build set of already-processed contact IDs (from resumed jobs)
    const processedIds = new Set(
      (typedJob.results || []).map(r => r.contactId)
    );

    // 4. Classify contacts
    const allSkippable: Contact[] = [];
    const allAnalyzable: Contact[] = [];

    for (const c of contacts) {
      if (processedIds.has(c.id)) continue;

      const canAnalyze = !!c.company_website || !!c.primary_linkedin_url;
      const needsAnalysis = typedJob.include_already_analyzed || !c.enriched_at;

      if (canAnalyze && needsAnalysis) {
        allAnalyzable.push(c);
      } else {
        allSkippable.push(c);
      }
    }

    console.log(`[Job ${jobId}] ${allAnalyzable.length} to analyze, ${allSkippable.length} to skip, ${processedIds.size} already processed`);

    // 5. Collect results
    const allResults: JobResult[] = [...(typedJob.results || [])];
    let analyzedCount = typedJob.analyzed_count || 0;
    let failedCount = typedJob.failed_count || 0;
    let skippedCount = typedJob.skipped_count || 0;

    // Add skipped contacts
    for (const contact of allSkippable) {
      const reason = !contact.company_website && !contact.primary_linkedin_url
        ? 'No company website or LinkedIn URL'
        : 'Already analyzed';
      allResults.push({ contactId: contact.id, status: 'skipped', error: reason });
      skippedCount++;
    }

    // 6. Process analyzable contacts in parallel batches
    // Concurrency is dynamic — reduces when multiple jobs run concurrently
    let i = 0;
    let batchNum = 0;
    while (i < allAnalyzable.length) {
      // Check if job was cancelled
      const { data: currentJob } = await supabase
        .from('company_analysis_jobs')
        .select('status')
        .eq('id', jobId)
        .single();

      if (currentJob?.status === 'cancelled') {
        console.log(`[Job ${jobId}] Cancelled, stopping`);
        break;
      }

      const concurrency = getParallelConcurrency();
      const batch = allAnalyzable.slice(i, i + concurrency);
      i += batch.length;
      batchNum++;

      const batchNames = batch.map(c => c.display_name).join(', ');
      const totalProcessed = allResults.length + batch.length;
      const progress = Math.round((totalProcessed / contacts.length) * 100);

      // Update progress
      await supabase
        .from('company_analysis_jobs')
        .update({
          progress: Math.min(progress, 99),
          current_contact_name: batchNames,
          analyzed_count: analyzedCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
        })
        .eq('id', jobId);

      console.log(`[Job ${jobId}] Batch ${batchNum} (×${concurrency}): ${batchNames} (${totalProcessed}/${contacts.length})`);

      // Run batch in parallel
      const results = await Promise.allSettled(batch.map(c => analyzeOne(c, typedJob)));

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const r = result.value;
          allResults.push(r);
          if (r.status === 'success') analyzedCount++;
          else if (r.status === 'skipped') skippedCount++;
          else failedCount++;
        } else {
          console.error(`[Job ${jobId}] Unexpected rejection:`, result.reason);
          failedCount++;
        }
      }

      // Save progress after each batch (allows resuming if worker crashes)
      await supabase
        .from('company_analysis_jobs')
        .update({
          analyzed_count: analyzedCount,
          skipped_count: skippedCount,
          failed_count: failedCount,
          results: allResults,
        })
        .eq('id', jobId);
    }

    // 7. Finalize job
    const wasCancelled = (await supabase
      .from('company_analysis_jobs')
      .select('status')
      .eq('id', jobId)
      .single()).data?.status === 'cancelled';

    const finalStatus = wasCancelled ? 'cancelled' : 'completed';
    const finalAnalyzed = allResults.filter(r => r.status === 'success').length;
    const finalSkipped = allResults.filter(r => r.status === 'skipped').length;
    const finalFailed = allResults.filter(r => r.status === 'failed').length;

    await supabase
      .from('company_analysis_jobs')
      .update({
        status: finalStatus,
        progress: 100,
        current_contact_name: null,
        analyzed_count: finalAnalyzed,
        skipped_count: finalSkipped,
        failed_count: finalFailed,
        results: allResults,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    console.log(`[Job ${jobId}] ${finalStatus}: ${finalAnalyzed} analyzed, ${finalSkipped} skipped, ${finalFailed} failed`);

    stats.totalJobsProcessed++;
    stats.totalContactsAnalyzed += finalAnalyzed;
    stats.totalContactsFailed += finalFailed;
    stats.totalContactsSkipped += finalSkipped;

  } catch (error) {
    console.error(`[Job ${jobId}] Fatal error:`, error);
    stats.totalErrors++;
    await updateJobFailed(jobId, error instanceof Error ? error.message : 'Unknown worker error');
  } finally {
    stats.activeJobs--;

    // After finishing a job, check for pending jobs that were queued while at capacity
    if (stats.activeJobs < MAX_CONCURRENT_JOBS) {
      try {
        const { data: pendingJobs } = await supabase
          .from('company_analysis_jobs')
          .select('id')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(1);

        if (pendingJobs && pendingJobs.length > 0) {
          const nextJob = pendingJobs[0];
          console.log(`[Worker] Picking up queued job ${nextJob.id}`);
          await supabase
            .from('company_analysis_jobs')
            .update({ status: 'running', started_at: new Date().toISOString() })
            .eq('id', nextJob.id);
          processJob(nextJob.id).catch(err => {
            console.error(`[Worker] Failed to process queued job ${nextJob.id}:`, err);
          });
        }
      } catch (err) {
        console.error('[Worker] Failed to check for pending jobs:', err);
      }
    }

    // If no more jobs are running/queued, schedule idle shutdown
    if (stats.activeJobs <= 0) {
      scheduleIdleShutdown();
    }
  }
}

// ============================================================================
// HTTP Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ...stats,
      maxConcurrentJobs: MAX_CONCURRENT_JOBS,
      currentConcurrency: getParallelConcurrency(),
    }));
    return;
  }

  // Process a job
  if (req.url === '/process' && req.method === 'POST') {
    if (!isAuthorizedWorkerCall(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    cancelIdleShutdown(); // New job arriving — don't shutdown
    try {
      const body = await readBody(req);
      const { jobId } = JSON.parse(body);

      if (!jobId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'jobId is required' }));
        return;
      }

      if (stats.activeJobs >= MAX_CONCURRENT_JOBS) {
        console.log(`[Worker] Rejecting job ${jobId}: at capacity (${stats.activeJobs}/${MAX_CONCURRENT_JOBS})`);
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Worker at capacity (${stats.activeJobs}/${MAX_CONCURRENT_JOBS} concurrent jobs). Try again shortly.`,
          retryAfter: 60,
        }));
        return;
      }

      // Stream progress via SSE so the edge function can confirm acceptance.
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      res.write(`data: ${JSON.stringify({ accepted: true, jobId })}\n\n`);

      // Keep-alive ping every 30s to prevent proxy/edge timeout
      const keepAlive = setInterval(() => {
        if (!res.destroyed) {
          res.write(`data: ${JSON.stringify({ ping: true, stats: { activeJobs: stats.activeJobs } })}\n\n`);
        }
      }, 30_000);

      try {
        await processJob(jobId);
        res.write(`data: ${JSON.stringify({ done: true, jobId })}\n\n`);
      } catch (err) {
        console.error(`[Job ${jobId}] Unhandled error in processJob:`, err);
        res.write(`data: ${JSON.stringify({ error: true, jobId, message: err instanceof Error ? err.message : 'Unknown error' })}\n\n`);
      } finally {
        clearInterval(keepAlive);
        res.end();
      }
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// Self-stop: since auto_stop_machines is 'off', we manage our own lifecycle.
// After all jobs finish, wait IDLE_SHUTDOWN_MS then stop via Fly Machines API.
const IDLE_SHUTDOWN_MS = parseInt(process.env.IDLE_SHUTDOWN_MS || '60000', 10); // 60s idle before shutdown
let idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleShutdown(): void {
  cancelIdleShutdown();
  if (stats.activeJobs > 0) return;

  console.log(`[Worker] No active jobs, scheduling shutdown in ${IDLE_SHUTDOWN_MS / 1000}s`);
  idleShutdownTimer = setTimeout(async () => {
    if (stats.activeJobs > 0) {
      console.log('[Worker] Job started during idle period, cancelling shutdown');
      return;
    }
    await selfStop();
  }, IDLE_SHUTDOWN_MS);
}

function cancelIdleShutdown(): void {
  if (idleShutdownTimer) {
    clearTimeout(idleShutdownTimer);
    idleShutdownTimer = null;
  }
}

async function selfStop(): Promise<void> {
  const machineId = process.env.FLY_MACHINE_ID;
  const appName = process.env.FLY_APP_NAME;

  if (!machineId || !appName) {
    console.log('[Worker] Not running on Fly.io (no FLY_MACHINE_ID), skipping self-stop');
    return;
  }

  console.log(`[Worker] Self-stopping machine ${machineId} via Fly API`);
  try {
    // Use the internal Unix socket API — no token needed
    const http = await import('node:http');
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        socketPath: '/.fly/api',
        path: `/v1/apps/${appName}/machines/${machineId}/stop`,
        method: 'POST',
      }, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          console.log(`[Worker] Self-stop response: ${res.statusCode} ${body}`);
          resolve();
        });
      });
      req.on('error', reject);
      req.end();
    });
  } catch (err) {
    console.error('[Worker] Self-stop failed:', err);
    // Fallback: just exit — Fly will restart on next request due to auto_start
    process.exit(0);
  }
}

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Worker] Company analyzer listening on 0.0.0.0:${PORT}`);

  // On startup, check for orphaned "running" jobs and resume them.
  // This handles worker crashes, deploys, and auto-stop restarts.
  try {
    const { data: orphanedJobs } = await supabase
      .from('company_analysis_jobs')
      .select('id')
      .eq('status', 'running')
      .order('created_at', { ascending: true });

    if (orphanedJobs && orphanedJobs.length > 0) {
      console.log(`[Worker] Found ${orphanedJobs.length} orphaned running job(s), resuming...`);
      for (const job of orphanedJobs) {
        console.log(`[Worker] Resuming orphaned job ${job.id}`);
        processJob(job.id).catch(err => {
          console.error(`[Worker] Failed to resume job ${job.id}:`, err);
        });
      }
    } else {
      // No orphans — schedule idle shutdown (machine was started but has nothing to do)
      scheduleIdleShutdown();
    }
  } catch (err) {
    console.error('[Worker] Failed to check for orphaned jobs:', err);
  }
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

let shutdownRequested = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownRequested) return;
  shutdownRequested = true;
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);

  // Wait for active jobs to finish (up to 30s)
  const deadline = Date.now() + 30_000;
  while (stats.activeJobs > 0 && Date.now() < deadline) {
    console.log(`[Worker] Waiting for ${stats.activeJobs} active job(s)...`);
    await sleep(2000);
  }

  if (stats.activeJobs > 0) {
    console.error(`[Worker] Force shutdown with ${stats.activeJobs} active job(s)`);
  }

  server.close(() => {
    console.log('[Worker] HTTP server closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('[Worker] Forced exit after 30s');
    process.exit(1);
  }, 30_000);
}

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });

process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception (non-fatal):', err.message);
  stats.totalErrors++;
});

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection (non-fatal):', reason);
  stats.totalErrors++;
});
