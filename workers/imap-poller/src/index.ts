/**
 * IMAP Poller Worker — Fly.io
 *
 * Long-running Node.js process that maintains persistent IMAP connections
 * to all email mailboxes using IDLE mode for real-time push notifications.
 *
 * Architecture:
 *   - Connection pool holds one persistent ImapFlow per mailbox
 *   - IDLE mode triggers instant fetch on new mail (exists event)
 *   - Lifecycle manager syncs pool with DB every 30s
 *   - Spam folder scanning runs periodically (every 5 min)
 *   - Auto-reconnect with exponential backoff on connection loss
 *   - Health check + connection details endpoints for Fly.io
 *
 * Config (env vars):
 *   POOL_SYNC_INTERVAL_MS  — sync pool with DB interval (default: 30000)
 *   SPAM_SCAN_INTERVAL_MS  — spam folder scan interval (default: 300000)
 *   MAX_CONNECTIONS         — max persistent connections (default: 250)
 *   MAILBOX_TIMEOUT_MS     — per-fetch timeout (default: 45000)
 */

import http from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { extractSMTPCredentials, decryptApiKey } from './crypto.js';
import {
  ImapConnectionPool,
  type InboundEmailMessage,
  type ManagedConnection,
} from './imap-client.js';
import { GraphMailPoller, type GraphMailbox } from './graph-poller.js';
import { storeInboundAttachments } from './attachments.js';
import {
  calculateOOOResumeAt,
  detectAutoReply,
  detectBounce,
  detectOutOfOffice,
  detectWarmup,
  isSystemEmail,
  processReplyForConversationEnrollments,
  processReplyForEnrollment,
} from './reply-processing.js';
import { classifyNdr } from './delivery-failure.js';
import { classifyReply } from './reply-classifier.js';
import { evaluateFollowupRules } from './followup-rules.js';
import { computeMomentum } from './momentum.js';
import { processAutopilot } from './autopilot.js';
import { parseOOOReturnDate } from './ooo-date-parser.js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const POOL_SYNC_INTERVAL_MS = parseInt(process.env.POOL_SYNC_INTERVAL_MS || '30000', 10);
const SPAM_SCAN_INTERVAL_MS = parseInt(process.env.SPAM_SCAN_INTERVAL_MS || '300000', 10);
const PERIODIC_FETCH_INTERVAL_MS = parseInt(process.env.PERIODIC_FETCH_INTERVAL_MS || '120000', 10); // 2 min
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '250', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// ============================================================================
// Stats (exposed via /health)
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  totalSyncCycles: 0,
  totalEmailsFetched: 0,
  totalMatched: 0,
  totalCrmCreated: 0,
  totalErrors: 0,
  totalIdleEvents: 0,
  lastSyncAt: null as string | null,
  pool: { total: 0, connecting: 0, idle: 0, fetching: 0, reconnecting: 0, dead: 0 },
  graph: { polled: 0, emailsFetched: 0, lastPollAt: null as string | null },
};

// ============================================================================
// Supabase Client + Connection Pool (initialized in main)
// ============================================================================

let supabase: SupabaseClient;
let pool: ImapConnectionPool;
let graphPoller: GraphMailPoller;

// ============================================================================
// Webhook-poll job queue
// ============================================================================
//
// Root cause of a real incident (2026-09-04): once ~1,900 mailboxes carried
// live Graph subscriptions, /webhook-poll started receiving a sustained
// 4-22 pokes/minute. Each poke previously fired its own unbounded, uncapped
// handleWebhookPoll() call — under that load, many ran concurrently on this
// single 1-vCPU process with no queue and no visibility, and some mailboxes'
// actual processing (Graph delta fetch + full reply pipeline) queued behind
// others for over 20 minutes despite the poke itself arriving in under a
// second. The notification path was never the bottleneck; unbounded
// concurrent execution on one small machine was.
//
// Fix: cap how many run at once, queue the rest FIFO, and coalesce repeat
// pokes for a mailbox that's already queued/in-flight (a second poke for the
// same busy mailbox is redundant — the pending/running fetch already covers
// whatever mail triggered it, since it's a full delta fetch, not "the one
// message from this notification"). Log queue wait and run time per job so a
// future slowdown shows up immediately instead of requiring after-the-fact
// log forensics across two services.
const WEBHOOK_POLL_CONCURRENCY = parseInt(process.env.WEBHOOK_POLL_CONCURRENCY || '6', 10);
const webhookQueue: string[] = [];
const webhookQueuedAt = new Map<string, number>();
let webhookActive = 0;
const webhookStats = { processed: 0, coalesced: 0, totalWaitMs: 0, totalRunMs: 0, maxWaitMs: 0, maxRunMs: 0 };

function enqueueWebhookPoll(mailboxId: string): void {
  if (webhookQueuedAt.has(mailboxId)) {
    webhookStats.coalesced++;
    return;
  }
  webhookQueuedAt.set(mailboxId, Date.now());
  webhookQueue.push(mailboxId);
  drainWebhookQueue();
}

function drainWebhookQueue(): void {
  while (webhookActive < WEBHOOK_POLL_CONCURRENCY && webhookQueue.length > 0) {
    const mailboxId = webhookQueue.shift()!;
    const queuedAt = webhookQueuedAt.get(mailboxId)!;
    const waitMs = Date.now() - queuedAt;
    webhookActive++;
    webhookStats.totalWaitMs += waitMs;
    webhookStats.maxWaitMs = Math.max(webhookStats.maxWaitMs, waitMs);
    if (waitMs > 5000) {
      console.warn(`[WebhookPoll] Queued ${waitMs}ms before starting ${mailboxId} (depth was ${webhookQueue.length + 1}, active ${webhookActive})`);
    }

    const startedAt = Date.now();
    handleWebhookPoll(mailboxId)
      .catch((err) => {
        console.error(`[WebhookPoll] Failed for mailbox ${mailboxId}:`, err);
      })
      .finally(() => {
        const runMs = Date.now() - startedAt;
        webhookStats.processed++;
        webhookStats.totalRunMs += runMs;
        webhookStats.maxRunMs = Math.max(webhookStats.maxRunMs, runMs);
        if (waitMs + runMs > 15000) {
          console.warn(`[WebhookPoll] ${mailboxId} total ${waitMs + runMs}ms (wait ${waitMs}ms + run ${runMs}ms)`);
        }
        webhookQueuedAt.delete(mailboxId);
        webhookActive--;
        drainWebhookQueue();
      });
  }
}

// ============================================================================
// Health Check Server
// ============================================================================

// This app previously had no [http_service] in fly.toml — port 8080 was only
// reachable over Fly's internal machine health-check path, never the public
// internet. Adding a public Graph-webhook forwarding target (below) required
// adding [http_service], which makes EVERY route on this port internet-
// reachable for the first time — including /connections (per-mailbox
// connection metadata) and /backfill (triggers a full rewind-rescan of every
// mailbox). Both are now gated behind the same shared secret as /webhook-poll
// so exposing the port doesn't also expose an open rescan/info-disclosure
// endpoint. /health stays open — Fly's own checker hits it, and it carries
// nothing beyond aggregate counters.
function isAuthorizedInternalRequest(req: http.IncomingMessage): boolean {
  const configuredSecret = process.env.INTERNAL_WEBHOOK_SECRET;
  return !!configuredSecret && req.headers['x-internal-secret'] === configuredSecret;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      ...stats,
      webhookQueue: {
        depth: webhookQueue.length,
        active: webhookActive,
        concurrency: WEBHOOK_POLL_CONCURRENCY,
        ...webhookStats,
        avgWaitMs: webhookStats.processed ? Math.round(webhookStats.totalWaitMs / webhookStats.processed) : 0,
        avgRunMs: webhookStats.processed ? Math.round(webhookStats.totalRunMs / webhookStats.processed) : 0,
      },
    }));
  } else if (req.url === '/connections' && req.method === 'GET') {
    if (!isAuthorizedInternalRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pool ? pool.getConnectionDetails() : []));
  } else if (req.url === '/webhook-poll' && req.method === 'POST') {
    // Real-time trigger from the Graph webhook edge function (graph-mail-webhook):
    // "this one mailbox has new mail" — do a targeted single-mailbox delta fetch
    // instead of waiting for the sequential reconciliation sweep.
    if (!isAuthorizedInternalRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let rawBody = '';
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
      // Ack immediately — the poke's caller (the edge function) already ack'd
      // Graph and isn't waiting on us. Do the fetch async.
      let mailboxId: string | undefined;
      try {
        mailboxId = JSON.parse(rawBody || '{}').mailboxId;
      } catch (err) {
        console.error('[WebhookPoll] Bad request body:', (err as Error).message);
        return;
      }
      if (!mailboxId) {
        console.warn('[WebhookPoll] Request missing mailboxId');
        return;
      }
      if (supabase && graphPoller) {
        enqueueWebhookPoll(mailboxId);
      } else {
        console.warn(`[WebhookPoll] Worker not fully started yet — dropping poke for ${mailboxId}`);
      }
    });
  } else if (req.url === '/inbound-email' && req.method === 'POST') {
    // Pushed replies for mailboxes with no IMAP (PostShiba catch-all inboxes):
    // the postshiba-inbound edge function verifies the provider's signature and
    // posts one normalized message here. Processed before answering, so a
    // failure reaches the edge function and the provider retries; the
    // crm_messages Message-ID dedupe makes retries safe.
    if (!isAuthorizedInternalRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let rawBody = '';
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      handlePushedInboundEmail(rawBody)
        .then((result) => {
          res.writeHead(result.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.body));
        })
        .catch((err) => {
          console.error('[InboundEmail] Failed:', err);
          stats.totalErrors++;
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        });
    });
  } else if (req.url === '/recover-replies' && req.method === 'POST') {
    if (!isAuthorizedInternalRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    let rawBody = '';
    req.on('data', (chunk) => { rawBody += chunk; });
    req.on('end', () => {
      recoverReplies(rawBody)
        .then((result) => {
          res.writeHead(result.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.body));
        })
        .catch((err) => {
          console.error('[Recover] Failed:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (err as Error).message }));
        });
    });
  } else if (req.url?.startsWith('/backfill') && req.method === 'POST') {
    if (!isAuthorizedInternalRequest(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }
    // One-time backfill: rewind lastUid and re-scan recent messages
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const rewindBy = parseInt(url.searchParams.get('rewind') || '200', 10);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'started', rewindBy }));
    // Run async — don't block the response
    if (pool) {
      pool.backfillAll(rewindBy).then((result) => {
        console.log(`[Worker] Backfill complete: ${result.connections} connections, ${result.fetched} emails fetched, ${result.errors} errors`);
      }).catch((err) => {
        console.error('[Worker] Backfill failed:', err);
      });
    }
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`[Worker] Health check listening on :${PORT}`);
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

let shutdownRequested = false;

async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  shutdownRequested = true;

  // Drain the connection pool first
  if (pool) {
    await pool.shutdown(10_000);
  }

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

// Safety net: prevent crash on stray unhandled errors (e.g. ImapFlow socket timeouts)
process.on('uncaughtException', (err) => {
  console.error('[Worker] Uncaught exception (non-fatal):', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection (non-fatal):', reason);
});

// ============================================================================
// Main Lifecycle Manager
// ============================================================================

const GRAPH_POLL_INTERVAL_MS = parseInt(process.env.GRAPH_POLL_INTERVAL_MS || '60000', 10); // 1 min
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '60000', 10);
const MAIN_LOOP_STALL_MS = parseInt(process.env.MAIN_LOOP_STALL_MS || '900000', 10); // 15 min

let lastMainLoopProgressAt = Date.now();
let lastHeartbeatAt = 0;
let heartbeatWriteInFlight: Promise<void> | null = null;
let heartbeatContext = { mailboxesTotal: 0, m365Total: 0, imapTotal: 0 };

function markMainLoopProgress(): void {
  lastMainLoopProgressAt = Date.now();
  // The reconciliation sweep is intentionally serial to respect Graph limits
  // and can take longer than the monitor's 30-minute stale threshold. Keep its
  // liveness signal current while work is actually advancing.
  void writeHeartbeat();
}

async function writeHeartbeat(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  if (heartbeatWriteInFlight) {
    await heartbeatWriteInFlight;
    // A cycle-start beat must include the mailbox totals fetched immediately
    // before it, even if an earlier progress-only beat is still finishing.
    if (!force) return;
  }

  lastHeartbeatAt = now;
  const write = (async () => {
    try {
      const hbISO = new Date().toISOString();
      await supabase.from('worker_heartbeats').upsert({
        worker: 'imap-poller',
        last_run_at: hbISO,
        updated_at: hbISO,
        metrics: {
          mailboxes_total: heartbeatContext.mailboxesTotal,
          m365_total: heartbeatContext.m365Total,
          imap_total: heartbeatContext.imapTotal,
          imap_pool: pool?.getStats(),
          graph: stats.graph,
          sync_cycles: stats.totalSyncCycles,
          errors_total: stats.totalErrors,
          last_progress_at: new Date(lastMainLoopProgressAt).toISOString(),
        },
      }, { onConflict: 'worker' });
    } catch (hbErr) {
      console.warn('[Worker] Heartbeat write failed:', (hbErr as Error).message);
    } finally {
      heartbeatWriteInFlight = null;
    }
  })();
  heartbeatWriteInFlight = write;
  return write;
}

function startMainLoopWatchdog(): void {
  const intervalMs = Math.min(Math.max(Math.floor(MAIN_LOOP_STALL_MS / 3), 30_000), 60_000);
  setInterval(() => {
    if (shutdownRequested || Date.now() - lastMainLoopProgressAt <= MAIN_LOOP_STALL_MS) return;
    console.error(`[Worker] Main loop made no progress for ${MAIN_LOOP_STALL_MS}ms; exiting for Fly restart`);
    process.exit(1);
  }, intervalMs).unref();
}

// PostgREST caps a single response at `max-rows` (1000 on Supabase by default).
// The pollable fleet is larger than that (1600+ mailboxes), so a plain
// `.select()` silently returns only the first page — every mailbox past the cap
// is NEVER polled and its inbound replies never reach the system. Page through
// explicitly with `.range()` so the WHOLE fleet is fetched each cycle.
const MAILBOX_PAGE_SIZE = 1000;

async function fetchAllPollableMailboxes(client: SupabaseClient): Promise<any[]> {
  const all: any[] = [];
  for (let from = 0; ; from += MAILBOX_PAGE_SIZE) {
    const { data, error } = await client
      .from('email_mailboxes')
      .select('id, organization_id, email_address, display_name, metadata, imap_connected, connection_type, created_at, sending_domain_id')
      .in('status', ['ready', 'active', 'warming'])
      .eq('imap_connected', true)
      // PostShiba senders have no IMAP: their replies arrive via postshiba-inbound -> /inbound-email.
      .neq('connection_type', 'postshiba')
      .order('created_at', { ascending: true })
      .range(from, from + MAILBOX_PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    const page = data || [];
    all.push(...page);
    if (page.length < MAILBOX_PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  pool = new ImapConnectionPool({
    onNewEmails: handleNewEmails,
    onAuthFailure: handleAuthFailure,
    onAuthFailureReset: handleAuthRecovery,
    maxConnections: MAX_CONNECTIONS,
  });
  graphPoller = new GraphMailPoller(supabase);
  startMainLoopWatchdog();

  // Handle spam folder events from the pool
  pool.on('spam', handleSpamEmails);

  console.log(`[Worker] IMAP Poller starting — pool mode, syncInterval=${POOL_SYNC_INTERVAL_MS}ms, spamInterval=${SPAM_SCAN_INTERVAL_MS}ms, maxConn=${MAX_CONNECTIONS}`);

  let lastSpamScanAt = 0;
  let lastPeriodicFetchAt = 0;
  let lastGraphPollAt = 0;

  while (!shutdownRequested) {
    try {
      // 1. Fetch ALL active/warming + imap_connected mailboxes from DB.
      // Paginated — a single .select() is capped at PostgREST max-rows (1000),
      // which would silently strand the 600+ mailboxes past the cap (never
      // polled → their replies never ingested).
      let mailboxes: any[];
      try {
        mailboxes = await fetchAllPollableMailboxes(supabase);
        markMainLoopProgress();
      } catch (mbErr) {
        console.error('[Worker] Failed to fetch mailboxes:', (mbErr as Error).message);
        await sleep(POOL_SYNC_INTERVAL_MS);
        continue;
      }

      // Split into IMAP mailboxes and M365/Graph mailboxes
      const imapMailboxes = mailboxes.filter((m: any) => m.connection_type !== 'm365');
      const m365Mailboxes = mailboxes.filter((m: any) => m.connection_type === 'm365');
      heartbeatContext = {
        mailboxesTotal: mailboxes.length,
        m365Total: m365Mailboxes.length,
        imapTotal: imapMailboxes.length,
      };

      // 2. Sync IMAP pool — add new connections, remove stale ones
      const syncResult = await pool.sync(
        imapMailboxes,
        (metadata, mailbox) => {
          const creds = extractSMTPCredentials(metadata, mailbox.email_address);
          if (!creds?.imap_host || !creds?.imap_username || !creds?.imap_password) return null;
          return {
            imap_host: creds.imap_host,
            imap_port: creds.imap_port || 993,
            imap_username: creds.imap_username,
            imap_password: creds.imap_password,
          };
        },
      );
      markMainLoopProgress();

      if (syncResult.added > 0 || syncResult.removed > 0) {
        console.log(`[Pool] Synced: +${syncResult.added} -${syncResult.removed}, active=${syncResult.active}`);
      }

      // Force a beat at cycle start. Subsequent beats are refreshed while the
      // serial Graph sweep advances, so a large healthy fleet is not mistaken
      // for a stalled worker.
      await writeHeartbeat(true);

      // 3. Graph polling for M365 mailboxes (every GRAPH_POLL_INTERVAL_MS)
      const now = Date.now();
      if (m365Mailboxes.length > 0 && now - lastGraphPollAt > GRAPH_POLL_INTERVAL_MS) {
        await pollGraphMailboxes(m365Mailboxes);
        lastGraphPollAt = now;
      }

      // 4. Wake event-based snoozed conversations
      try {
        const { data: wakeResult } = await supabase.rpc('wake_event_snoozed_conversations');
        if (wakeResult && wakeResult > 0) {
          console.log(`[Worker] Woke ${wakeResult} event-snoozed conversations`);
        }
      } catch { /* non-fatal */ }
      try {
        const { data: resumed } = await supabase.rpc('resume_due_ooo_email_enrollments');
        if (resumed && resumed > 0) {
          console.log(`[Worker] Resumed ${resumed} OOO-paused email enrollments`);
        }
      } catch { /* non-fatal */ }

      // 5. Periodic spam folder scan
      if (now - lastSpamScanAt > SPAM_SCAN_INTERVAL_MS) {
        const spamResult = await pool.scanAllSpamFolders();
        if (spamResult.scanned > 0 || spamResult.errors > 0) {
          console.log(`[Pool] Spam scan: ${spamResult.scanned} scanned, ${spamResult.errors} errors`);
        }
        lastSpamScanAt = now;
      }

      // 6. Periodic catch-up fetch — polls all idle IMAP connections for missed emails
      if (now - lastPeriodicFetchAt > PERIODIC_FETCH_INTERVAL_MS) {
        const fetchResult = await pool.periodicFetchAll();
        if (fetchResult.fetched > 0 || fetchResult.errors > 0) {
          console.log(`[Pool] Periodic fetch: ${fetchResult.fetched} emails, ${fetchResult.errors} errors`);
        }
        lastPeriodicFetchAt = now;
      }

      // 7. Update stats
      stats.totalSyncCycles++;
      stats.lastSyncAt = new Date().toISOString();
      stats.pool = pool.getStats();
      markMainLoopProgress();

    } catch (error) {
      console.error('[Worker] Sync cycle error:', error);
      stats.totalErrors++;
    }

    await sleep(POOL_SYNC_INTERVAL_MS);
  }
}

// ============================================================================
// Graph Polling Handler
// ============================================================================

async function pollGraphMailboxes(rawMailboxes: any[]): Promise<void> {
  const sendingDomainById = new Map<string, string>(
    rawMailboxes
      .filter((m: any) => m.sending_domain_id)
      .map((m: any) => [m.id, m.sending_domain_id])
  );

  // Some M365 mailbox rows were created without sending_domain_id. Those rows
  // were permanently skipped by Graph polling. Resolve the domain from the
  // mailbox address as a fallback, and persist the repair so future cycles do
  // not have to infer it again.
  const missingDomainRows = rawMailboxes.filter((m: any) => !m.sending_domain_id);
  if (missingDomainRows.length > 0) {
    const domainNamesByOrg = new Map<string, Set<string>>();
    for (const mb of missingDomainRows) {
      const domainName = String(mb.email_address || '').split('@')[1]?.toLowerCase();
      if (!domainName || !mb.organization_id) continue;
      const existing = domainNamesByOrg.get(mb.organization_id) || new Set<string>();
      existing.add(domainName);
      domainNamesByOrg.set(mb.organization_id, existing);
    }

    for (const [organizationId, domainNames] of domainNamesByOrg) {
      const { data: matchedDomains, error } = await supabase
        .from('email_sending_domains')
        .select('id, organization_id, domain, m365_tenant_id')
        .eq('organization_id', organizationId)
        .in('domain', Array.from(domainNames));

      if (error) {
        console.warn(`[Graph] Failed to resolve missing sending domains for org ${organizationId}: ${error.message}`);
        continue;
      }

      const domainByName = new Map<string, any>(
        (matchedDomains || []).map((d: any) => [String(d.domain).toLowerCase(), d])
      );

      for (const mb of missingDomainRows.filter((m: any) => m.organization_id === organizationId)) {
        const domainName = String(mb.email_address || '').split('@')[1]?.toLowerCase();
        const domain = domainName ? domainByName.get(domainName) : null;
        if (!domain?.id) continue;

        sendingDomainById.set(mb.id, domain.id);

        const { error: updateError } = await supabase
          .from('email_mailboxes')
          .update({ sending_domain_id: domain.id })
          .eq('id', mb.id);

        if (updateError) {
          console.warn(`[Graph] Failed to backfill sending_domain_id for ${mb.email_address}: ${updateError.message}`);
        } else {
          console.log(`[Graph] Backfilled sending_domain_id for ${mb.email_address}`);
        }
      }
    }
  }

  // Resolve domain → tenant_id
  const domainIds = [...new Set(sendingDomainById.values())];
  const { data: domains } = await supabase
    .from('email_sending_domains')
    .select('id, m365_tenant_id')
    .in('id', domainIds.length > 0 ? domainIds : ['__none__']);

  const m365TenantIdByDomainId = new Map<string, string>(
    (domains || [])
      .filter((d: any) => d.m365_tenant_id)
      .map((d: any) => [d.id, d.m365_tenant_id])
  );

  const tenantRowIds = [...new Set(m365TenantIdByDomainId.values())];
  const { data: tenants } = await supabase
    .from('m365_tenants')
    .select('id, tenant_id')
    .in('id', tenantRowIds.length > 0 ? tenantRowIds : ['__none__']);

  const tenantIdByRowId = new Map<string, string>(
    (tenants || [])
      .filter((t: any) => t.tenant_id)
      .map((t: any) => [t.id, t.tenant_id])
  );

  const graphMailboxes: GraphMailbox[] = [];
  for (const mb of rawMailboxes) {
    const meta = (mb.metadata || {}) as Record<string, unknown>;
    const domainId = sendingDomainById.get(mb.id);
    if (!domainId) { console.warn(`[Graph] No domain for mailbox ${mb.email_address} — skipping`); continue; }
    const m365TenantRowId = m365TenantIdByDomainId.get(domainId);
    if (!m365TenantRowId) { console.warn(`[Graph] No m365 tenant for mailbox ${mb.email_address} — skipping`); continue; }
    const tenantId = tenantIdByRowId.get(m365TenantRowId);
    if (!tenantId) { console.warn(`[Graph] No tenant_id for mailbox ${mb.email_address} — skipping`); continue; }

    graphMailboxes.push({
      id: mb.id,
      organization_id: mb.organization_id,
      email_address: mb.email_address,
      display_name: mb.display_name || null,
      metadata: meta,
      tenant_id: tenantId,
      created_at: mb.created_at || null,
    });
  }

  if (graphMailboxes.length === 0) return;

  console.log(`[Graph] Polling ${graphMailboxes.length} M365 mailbox(es)...`);

  let totalFetched = 0;
  let totalMatched = 0;

  for (const mb of graphMailboxes) {
    let emails: InboundEmailMessage[] = [];
    try {
      emails = await graphPoller.pollMailbox(mb);
    } catch (err) {
      console.error(`[Graph] Poll error for ${mb.email_address}:`, err);
      stats.totalErrors++;
      continue;
    } finally {
      // A Graph fetch is bounded, but the rest of this pipeline includes
      // networked services. This gives the watchdog a precise progress signal
      // and lets it recover the process if any later operation wedges.
      markMainLoopProgress();
    }

    // Small delay between mailboxes to avoid Graph rate limits.
    await new Promise(r => setTimeout(r, 200));

    if (emails.length === 0) continue;
    totalFetched += emails.length;

    const mailboxInfo = {
      id: mb.id,
      organization_id: mb.organization_id,
      email_address: mb.email_address,
      display_name: mb.display_name,
    };

    console.log(`[Graph] ${mb.email_address}: ${emails.length} new email(s)`);

    for (const email of emails) {
      try {
        const result = await processInboundEmail(supabase, mailboxInfo, email);
        if (result.matched) totalMatched++;
        if (result.crmCreated) stats.totalCrmCreated++;
      } catch (err) {
        console.error(`[Graph] Error processing email ${email.message_id}:`, err);
        stats.totalErrors++;
      }
    }
    markMainLoopProgress();
  }

  if (totalFetched > 0) {
    console.log(`[Graph] Processed ${totalFetched} emails, ${totalMatched} matched`);
  }

  stats.graph.polled += graphMailboxes.length;
  stats.graph.emailsFetched += totalFetched;
  stats.graph.lastPollAt = new Date().toISOString();
  stats.totalEmailsFetched += totalFetched;
  stats.totalMatched += totalMatched;
}

// ============================================================================
// Webhook-triggered single-mailbox poll (real-time path)
// ============================================================================
//
// Deliberately separate from pollGraphMailboxes()'s batch tenant-resolution
// above rather than refactored to share it — that batch path is the proven,
// currently-load-bearing reconciliation sweep, and duplicating a small amount
// of lookup logic here is a safer tradeoff than touching it.

/**
 * Resolve one raw email_mailboxes row into the GraphMailbox shape
 * pollMailbox() needs (mirrors the per-mailbox resolution inside
 * pollGraphMailboxes, minus its batch backfill-sending_domain_id repair —
 * that repair still runs on the reconciliation sweep, so any mailbox missing
 * sending_domain_id gets fixed there and just misses the fast path until then).
 */
async function resolveGraphMailbox(mb: any): Promise<GraphMailbox | null> {
  if (!mb.sending_domain_id) {
    console.warn(`[WebhookPoll] Mailbox ${mb.email_address} has no sending_domain_id yet — skipping fast path`);
    return null;
  }

  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('m365_tenant_id')
    .eq('id', mb.sending_domain_id)
    .maybeSingle();
  if (!domain?.m365_tenant_id) {
    console.warn(`[WebhookPoll] No m365 tenant row for mailbox ${mb.email_address}`);
    return null;
  }

  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('id', domain.m365_tenant_id)
    .maybeSingle();
  if (!tenant?.tenant_id) {
    console.warn(`[WebhookPoll] No tenant_id for mailbox ${mb.email_address}`);
    return null;
  }

  return {
    id: mb.id,
    organization_id: mb.organization_id,
    email_address: mb.email_address,
    display_name: mb.display_name || null,
    metadata: (mb.metadata || {}) as Record<string, unknown>,
    tenant_id: tenant.tenant_id,
    created_at: mb.created_at || null,
  };
}

/**
 * Handle a Graph-webhook poke for one mailbox: fetch its delta since the
 * stored cursor (same pollMailbox() the reconciliation sweep uses, so
 * behavior — dedup, tombstone filtering, delta-link persistence — is
 * identical) and process whatever's new immediately, instead of waiting for
 * the next sweep cycle.
 */
async function handleWebhookPoll(mailboxId: string): Promise<void> {
  const { data: mb, error } = await supabase
    .from('email_mailboxes')
    .select('id, organization_id, email_address, display_name, metadata, sending_domain_id, created_at')
    .eq('id', mailboxId)
    .maybeSingle();

  if (error || !mb) {
    console.warn(`[WebhookPoll] Mailbox ${mailboxId} not found: ${error?.message || 'no row'}`);
    return;
  }

  const graphMailbox = await resolveGraphMailbox(mb);
  if (!graphMailbox) return;

  let emails: InboundEmailMessage[] = [];
  try {
    emails = await graphPoller.pollMailbox(graphMailbox);
  } catch (err) {
    console.error(`[WebhookPoll] Poll error for ${mb.email_address}:`, (err as Error).message);
    return;
  }

  if (emails.length === 0) return;

  console.log(`[WebhookPoll] ${mb.email_address}: ${emails.length} new email(s) via webhook`);

  const mailboxInfo = {
    id: mb.id,
    organization_id: mb.organization_id,
    email_address: mb.email_address,
    display_name: mb.display_name,
  };

  for (const email of emails) {
    try {
      const result = await processInboundEmail(supabase, mailboxInfo, email);
      if (result.matched) stats.totalMatched++;
      if (result.crmCreated) stats.totalCrmCreated++;
      stats.totalEmailsFetched++;
    } catch (err) {
      console.error(`[WebhookPoll] Error processing email ${email.message_id}:`, err);
      stats.totalErrors++;
    }
  }
}

/**
 * One pushed inbound message (POST /inbound-email). Body:
 * { mailbox_id, email: { message_id, in_reply_to, references[], from_email,
 *   from_name, to_emails[], subject, text_body, html_body, date } }
 */
async function handlePushedInboundEmail(rawBody: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!supabase) return { status: 503, body: { error: 'worker not started' } };

  let payload: any;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }
  const e = payload?.email;
  if (typeof payload?.mailbox_id !== 'string' || !e || typeof e.message_id !== 'string' || typeof e.from_email !== 'string') {
    return { status: 400, body: { error: 'mailbox_id and email.message_id/from_email are required' } };
  }

  const { data: mb, error } = await supabase
    .from('email_mailboxes')
    .select('id, organization_id, email_address, display_name')
    .eq('id', payload.mailbox_id)
    .maybeSingle();
  if (error) throw new Error(`Mailbox lookup failed: ${error.message}`);
  if (!mb) return { status: 404, body: { error: 'mailbox not found' } };

  const email: InboundEmailMessage = {
    uid: 0,
    message_id: e.message_id,
    in_reply_to: typeof e.in_reply_to === 'string' && e.in_reply_to ? e.in_reply_to : null,
    references: Array.isArray(e.references) ? e.references.filter((r: unknown) => typeof r === 'string') : [],
    from_email: e.from_email.toLowerCase(),
    from_name: typeof e.from_name === 'string' ? e.from_name : '',
    to_emails: Array.isArray(e.to_emails) ? e.to_emails.filter((t: unknown) => typeof t === 'string') : [],
    subject: typeof e.subject === 'string' ? e.subject : '',
    text_body: typeof e.text_body === 'string' ? e.text_body : '',
    html_body: typeof e.html_body === 'string' ? e.html_body : '',
    date: e.date && !Number.isNaN(new Date(e.date).getTime()) ? new Date(e.date) : null,
    attachments: Array.isArray(e.attachments)
      ? e.attachments.filter((a: unknown) => !!a && typeof a === 'object' && !Array.isArray(a))
      : undefined,
  };

  const result = await processInboundEmail(supabase, mb, email);
  stats.totalEmailsFetched++;
  if (result.matched) stats.totalMatched++;
  if (result.crmCreated) stats.totalCrmCreated++;
  console.log(`[InboundEmail] ${mb.email_address}: ${email.message_id} from ${email.from_email} (matched=${result.matched})`);
  return { status: 200, body: { ok: true, ...result } };
}

// ============================================================================
// Pool Event Handlers
// ============================================================================

async function handleNewEmails(
  mailboxId: string,
  emails: InboundEmailMessage[],
  conn: ManagedConnection,
): Promise<void> {
  stats.totalIdleEvents++;

  // Look up mailbox info from connection
  const mailbox = {
    id: conn.mailboxId,
    organization_id: conn.orgId,
    email_address: conn.emailAddress,
    display_name: null as string | null,
  };

  console.log(`[Pool] ${conn.emailAddress}: ${emails.length} new email(s) since UID ${conn.lastUid}`);
  stats.totalEmailsFetched += emails.length;

  let matched = 0, crmCreated = 0;

  for (const email of emails) {
    try {
      if (email.from_email === conn.emailAddress.toLowerCase()) {
        continue;
      }
      const result = await processInboundEmail(supabase, mailbox, email);
      if (result.matched) matched++;
      if (result.crmCreated) crmCreated++;
    } catch (err) {
      console.error(`[Pool] Error processing email UID ${email.uid}:`, err);
      stats.totalErrors++;
    }
  }

  stats.totalMatched += matched;
  stats.totalCrmCreated += crmCreated;

  // Update last_imap_uid in DB
  const highestUid = emails[emails.length - 1]?.uid || conn.lastUid;
  if (highestUid > (conn.metadata?.last_imap_uid as number || 0)) {
    // Key-scoped patch so we never clobber a concurrently written avatar_url
    // (full metadata read-modify-write here used to revert fresh avatars).
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_set: { last_imap_uid: highestUid },
    });
    conn.metadata = { ...(conn.metadata || {}), last_imap_uid: highestUid };
  }

  // Clear stale IMAP auth error/fail-count flags on successful processing
  if ((conn.metadata as any)?.imap_auth_error || (conn.metadata as any)?.imap_auth_fail_count) {
    const cleaned = { ...(conn.metadata || {}) };
    delete (cleaned as any).imap_auth_error;
    delete (cleaned as any).imap_auth_failed_at;
    delete (cleaned as any).imap_auth_fail_count;
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_unset: ['imap_auth_error', 'imap_auth_failed_at', 'imap_auth_fail_count'],
    });
    conn.metadata = cleaned;
  }

  if (emails.length > 0) {
    console.log(`[Pool] ${conn.emailAddress}: processed ${emails.length} emails, ${matched} matched, ${crmCreated} CRM`);
  }
}

async function handleAuthRecovery(
  mailboxId: string,
  conn: ManagedConnection,
): Promise<void> {
  await supabase.rpc('apply_mailbox_metadata_patch', {
    p_id: mailboxId,
    p_set: { imap_auth_fail_count: 0 },
    p_unset: ['imap_auth_error', 'imap_auth_failed_at'],
  });
}

async function handleAuthFailure(
  mailboxId: string,
  conn: ManagedConnection,
  error: any,
): Promise<void> {
  // Only count REAL credential failures — not connection limits or transient errors.
  const errText = (error?.responseText || error?.message || '').toLowerCase();
  const isRealAuthFailure = error?.authenticationFailed &&
    !errText.includes('too many') &&
    !errText.includes('simultaneous') &&
    !errText.includes('connection limit') &&
    !errText.includes('rate limit') &&
    !errText.includes('try again') &&
    !errText.includes('temporarily') &&
    // Outlook closes TLS without close_notify — imapflow surfaces this as "Command failed"
    // which incorrectly sets authenticationFailed=true. Treat as transient, not a cred failure.
    error?.message !== 'Command failed' &&
    !errText.includes('unexpectedeof') &&
    !errText.includes('unexpected eof') &&
    !errText.includes('peer closed');

  if (!isRealAuthFailure) {
    if (error?.authenticationFailed) {
      console.warn(`[Pool] ${conn.emailAddress} connection rejected (transient): ${error?.responseText || error?.message}`);
    }
    return;
  }

  const prevCount = ((conn.metadata as any)?.imap_auth_fail_count as number) || 0;
  const failCount = prevCount + 1;

  if (failCount >= 3) {
    console.warn(`[Pool] Disabling IMAP for ${conn.emailAddress} after ${failCount} consecutive auth failures`);
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_set: {
        imap_auth_error: error?.responseText || 'Invalid credentials — please reconnect IMAP',
        imap_auth_failed_at: new Date().toISOString(),
        imap_auth_fail_count: failCount,
      },
    });
    await supabase
      .from('email_mailboxes')
      .update({ imap_connected: false })
      .eq('id', mailboxId);
  } else {
    console.warn(`[Pool] Auth failure ${failCount}/3 for ${conn.emailAddress} — will retry`);
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_set: { imap_auth_fail_count: failCount },
    });
    conn.metadata = { ...(conn.metadata || {}), imap_auth_fail_count: failCount };
  }
}

async function handleSpamEmails(
  mailboxId: string,
  folderPath: string,
  emails: InboundEmailMessage[],
  conn: ManagedConnection,
): Promise<void> {
  let highestUid = conn.lastJunkUid;

  for (const email of emails) {
    try {
      let matchedSendLog: any = null;

      if (email.in_reply_to) {
        const variants = messageIdVariants(email.in_reply_to);
        const { data } = await supabase
          .from('email_send_log')
          .select('id, status')
          .in('email_message_id', variants)
          .eq('organization_id', conn.orgId)
          .limit(1)
          .maybeSingle();
        if (data) matchedSendLog = data;
      }

      if (!matchedSendLog && email.references.length > 0) {
        for (const ref of email.references) {
          const variants = messageIdVariants(ref);
          const { data } = await supabase
            .from('email_send_log')
            .select('id, status')
            .in('email_message_id', variants)
            .eq('organization_id', conn.orgId)
            .limit(1)
            .maybeSingle();
          if (data) { matchedSendLog = data; break; }
        }
      }

      if (matchedSendLog && !['spam', 'bounced', 'replied'].includes(matchedSendLog.status)) {
        await supabase.from('email_send_log').update({ status: 'spam' }).eq('id', matchedSendLog.id);
        console.log(`[Pool] Marked send_log ${matchedSendLog.id} as spam`);
      }
    } catch { /* continue */ }

    if (email.uid > highestUid) highestUid = email.uid;
  }

  if (highestUid > conn.lastJunkUid) {
    await supabase.rpc('apply_mailbox_metadata_patch', {
      p_id: mailboxId,
      p_set: { last_junk_uid: highestUid },
    });
    conn.metadata = { ...(conn.metadata || {}), last_junk_uid: highestUid };
  }
}

// ============================================================================
// Process Single Inbound Email
// ============================================================================

interface ProcessResult {
  matched: boolean;
  crmCreated: boolean;
}

// Nodemailer stores Message-ID with angle brackets (<abc@domain>),
// but ImapFlow's envelope.inReplyTo strips them (abc@domain).
// Return both variants so we can match regardless of what's stored in DB.
function messageIdVariants(id: string): string[] {
  const bare = id.replace(/^<|>$/g, '');
  const bracketed = bare.startsWith('<') ? bare : `<${bare}>`;
  return [bare, bracketed];
}

/**
 * CRM contact ids for an email, case-insensitive, via the crm_contact_ids_by_email
 * RPC (index on organization_id + lower(primary_email)). A PostgREST
 * `.ilike('primary_email', …)` can't use that index and times out (8 s) on orgs
 * with millions of contacts; read as "no contact", that dropped replies. Throws
 * on error so a failed lookup is never mistaken for an unknown sender.
 */
async function findContactIdsByEmail(supabase: SupabaseClient, organizationId: string, email: string): Promise<string[]> {
  if (!email) return [];
  const { data, error } = await supabase.rpc('crm_contact_ids_by_email', {
    p_organization_id: organizationId,
    p_email: email,
  });
  if (error) throw new Error(`Contact lookup for ${email} failed: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

/**
 * update_conversation_on_message stamps last_message_at/preview/direction from
 * the inserted row, so filing an old reply would wind the conversation back.
 * Re-point them at the conversation's actual latest message.
 */
async function restoreConversationLatest(supabase: SupabaseClient, conversationId: string): Promise<void> {
  const { data: latest } = await supabase
    .from('crm_messages')
    .select('created_at, content, direction')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return;
  await supabase
    .from('crm_conversations')
    .update({
      last_message_at: latest.created_at,
      last_message_preview: (latest.content || '').slice(0, 100),
      last_message_direction: latest.direction,
    })
    .eq('id', conversationId);
}

/**
 * POST /recover-replies — re-fetch m365 mailboxes' mail for given windows and
 * file what never reached the inbox. Body: { items: [{ mailbox_id, from, to }] }
 * (ISO times). Messages already in crm_messages (by Message-ID) are skipped.
 */
async function recoverReplies(rawBody: string): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!supabase || !graphPoller) return { status: 503, body: { error: 'worker not started' } };
  let payload: any;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return { status: 400, body: { error: 'invalid json' } };
  }
  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0 || items.length > 200) return { status: 400, body: { error: 'items: 1 to 200 required' } };

  const results: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const summary: Record<string, unknown> = { mailbox_id: item?.mailbox_id, fetched: 0, already: 0, recovered: 0, skipped: 0 };
    try {
      const { data: mb } = await supabase
        .from('email_mailboxes')
        .select('id, organization_id, email_address, display_name, metadata, created_at, sending_domain_id, connection_type')
        .eq('id', item?.mailbox_id)
        .maybeSingle();
      if (!mb) throw new Error('mailbox not found');
      if (mb.connection_type !== 'm365') throw new Error(`recovery supports m365 mailboxes only, not ${mb.connection_type}`);
      const graphMailbox = await resolveGraphMailbox(mb);
      if (!graphMailbox) throw new Error('could not resolve the m365 tenant');

      const emails = await graphPoller.fetchMessagesBetween(graphMailbox, item.from, item.to);
      summary.fetched = emails.length;
      for (const email of emails) {
        if (email.message_id) {
          const { data: existing } = await supabase
            .from('crm_messages')
            .select('id')
            .eq('organization_id', mb.organization_id)
            .eq('external_message_id', email.message_id)
            .limit(1)
            .maybeSingle();
          if (existing) {
            summary.already = (summary.already as number) + 1;
            continue;
          }
        }
        const result = await processInboundEmail(supabase, mb, email, { recovery: true });
        if (result.crmCreated) {
          summary.recovered = (summary.recovered as number) + 1;
          console.log(`[Recover] ${mb.email_address}: filed ${email.message_id} from ${email.from_email}`);
        } else {
          summary.skipped = (summary.skipped as number) + 1;
        }
      }
    } catch (err) {
      summary.error = (err as Error).message;
    }
    results.push(summary);
  }
  return { status: 200, body: { ok: true, results } };
}

/**
 * `recovery`: file a reply that was fetched earlier but never reached the inbox
 * (POST /recover-replies). It only creates the missing CRM message: the send
 * log, enrollments and classification already ran the first time, and the
 * autopilot must not answer a weeks-old message.
 */
async function processInboundEmail(
  supabase: SupabaseClient,
  mailbox: { id: string; organization_id: string; email_address: string; display_name: string | null },
  email: InboundEmailMessage,
  opts: { recovery?: boolean } = {},
): Promise<ProcessResult> {
  const recovery = opts.recovery === true;
  let matchedSendLog: any = null;

  // Strategy 1a: In-Reply-To → email_send_log.email_message_id
  if (email.in_reply_to) {
    const variants = messageIdVariants(email.in_reply_to);
    const { data } = await supabase
      .from('email_send_log')
      .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status')
      .in('email_message_id', variants)
      .eq('organization_id', mailbox.organization_id)
      .limit(1)
      .maybeSingle();
    if (data) matchedSendLog = data;
  }

  // Strategy 1b: In-Reply-To → crm_messages.external_message_id
  if (!matchedSendLog && email.in_reply_to) {
    const variants = messageIdVariants(email.in_reply_to);
    const { data: crmMsg } = await supabase
      .from('crm_messages')
      .select('conversation_id, organization_id')
      .in('external_message_id', variants)
      .eq('organization_id', mailbox.organization_id)
      .eq('direction', 'outbound')
      .limit(1)
      .maybeSingle();

    if (crmMsg) {
      const { data: sendLog } = await supabase
        .from('email_send_log')
        .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status')
        .eq('recipient_email', email.from_email)
        .eq('organization_id', mailbox.organization_id)
        .eq('mailbox_id', mailbox.id)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sendLog) matchedSendLog = sendLog;
    }
  }

  // Strategy 1c: References header → email_send_log.email_message_id
  // Some clients set References but not In-Reply-To
  if (!matchedSendLog && email.references.length > 0) {
    for (const ref of email.references) {
      const variants = messageIdVariants(ref);
      const { data } = await supabase
        .from('email_send_log')
        .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status')
        .in('email_message_id', variants)
        .eq('organization_id', mailbox.organization_id)
        .limit(1)
        .maybeSingle();
      if (data) {
        matchedSendLog = data;
        break;
      }
    }
  }

  // Strategy 2: Fallback — match by sender email when they have an active sequence enrollment.
  // Catches replies where the email client stripped In-Reply-To / References headers
  // (e.g. Google Workspace auto-replies, forwarding rules, some mobile clients).
  // Scoped to same mailbox + active enrollment to avoid the false-positive issue
  // that caused the old unscoped Strategy 2 to be removed.
  if (!matchedSendLog) {
    const { data: fallbackSendLog } = await supabase
      .from('email_send_log')
      .select('id, mailbox_id, sequence_id, lead_id, organization_id, recipient_email, status')
      .eq('recipient_email', email.from_email)
      .eq('mailbox_id', mailbox.id)
      .eq('organization_id', mailbox.organization_id)
      .in('status', ['sent', 'delivered', 'opened', 'clicked'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackSendLog?.sequence_id) {
      const { data: activeEnrollment } = await supabase
        .from('email_sequence_enrollments')
        .select('id')
        .eq('sequence_id', fallbackSendLog.sequence_id)
        .eq('lead_id', fallbackSendLog.lead_id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (activeEnrollment) {
        console.log(`[Reply Processing] Fallback match: ${email.from_email} → send_log ${fallbackSendLog.id} (active enrollment, no threading headers)`);
        matchedSendLog = fallbackSendLog;
      }
    }
  }

  const isBounce = detectBounce(email.from_email, email.from_name, email.subject);
  const isOutOfOffice = !isBounce && detectOutOfOffice(email.subject, email.text_body);
  const isAutoReply = !isBounce && (isOutOfOffice || detectAutoReply(email.subject, email.text_body));
  const parsedOOOReturnDate = isOutOfOffice ? parseOOOReturnDate(email.text_body || '') : null;
  const oooResumeAt = isOutOfOffice ? calculateOOOResumeAt(parsedOOOReturnDate) : undefined;
  const isWarmup = detectWarmup(email.text_body, email.html_body);

  // Warmup emails: skip CRM record creation entirely — don't pollute inbox
  if (isWarmup) {
    return { matched: !!matchedSendLog, crmCreated: false };
  }

  if (matchedSendLog) {
    if (recovery) {
      // Already recorded on the send log and enrollment when first fetched.
    } else if (isBounce) {
      // Classify the NDR from the remote server's diagnostic. Only a dead
      // recipient suppresses the lead; a 5.7.x reputation/tenant block is our
      // sending identity being refused and must keep the lead.
      const ndr = classifyNdr(email.subject, email.text_body);
      const { classification } = ndr;

      // error_category='hard_bounce' + status='bounced' is what fires the global
      // contact-suppression trigger; everything else stays a delivery failure
      // that never touches the lead.
      await supabase
        .from('email_send_log')
        .update({
          status: ndr.sendLogStatus,
          error_category: classification.category,
          error_message: (classification.diagnostic || email.subject || 'NDR with no diagnostic').slice(0, 2000),
          ...(ndr.suppressRecipient ? { bounced_at: new Date().toISOString() } : {}),
        })
        .eq('id', matchedSendLog.id);

      if (ndr.suppressRecipient) {
        if (matchedSendLog.sequence_id && matchedSendLog.lead_id) {
          await supabase
            .from('email_sequence_enrollments')
            .update({ status: 'bounced', updated_at: new Date().toISOString() })
            .eq('sequence_id', matchedSendLog.sequence_id)
            .eq('lead_id', matchedSendLog.lead_id)
            .eq('status', 'active');
        }

        if (matchedSendLog.lead_id) {
          await supabase
            .from('leads')
            .update({ email_status: 'bounced' })
            .eq('id', matchedSendLog.lead_id);
        }
      }
      console.log(
        `[Reply Processing] NDR for send_log ${matchedSendLog.id}: ${classification.category} ` +
          `(${classification.enhancedCode ?? classification.smtpCode ?? 'no code'}) → ${ndr.sendLogStatus}` +
          (ndr.suppressRecipient ? ', lead marked bounced' : ', lead kept'),
      );
    } else if (isAutoReply) {
      // OOO / auto-reply — don't count as a real reply in analytics
      await supabase
        .from('email_send_log')
        .update({ status: 'auto_replied', replied_at: new Date().toISOString() })
        .eq('id', matchedSendLog.id);

      await processReplyForEnrollment(supabase, matchedSendLog, email.from_email, isAutoReply, {
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
    } else {
      // Real human reply
      await supabase
        .from('email_send_log')
        .update({ status: 'replied', replied_at: new Date().toISOString() })
        .eq('id', matchedSendLog.id);

      await processReplyForEnrollment(supabase, matchedSendLog, email.from_email, isAutoReply, {
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
    }

    // Bounces/NDRs belong to the originating send record, not to a sender-side
    // CRM contact or reply conversation. Creating a "Mail Delivery System"
    // contact here polluted reply metrics despite the correct bounce status.
    if (isBounce) {
      console.log(`[CRM] Bounce/NDR from ${email.from_email} — skipping CRM records`);
      return { matched: true, crmCreated: false };
    }

    // Create CRM records for genuine replies and automatic replies only.
    const crmResult = await createCrmRecords(supabase, mailbox, email, matchedSendLog.lead_id, false, matchedSendLog);

    if (recovery) {
      if (crmResult.conversationId) await restoreConversationLatest(supabase, crmResult.conversationId);
      return { matched: true, crmCreated: crmResult.success };
    }

    if (crmResult.success && crmResult.conversationId) {
      if (isOutOfOffice && oooResumeAt) {
        await supabase.from('crm_conversations').update({
          status: 'snoozed',
          snooze_type: 'until_ooo_ends',
          snooze_context: {
            parsed_return_date: (parsedOOOReturnDate || oooResumeAt).toISOString().split('T')[0],
            resume_at: oooResumeAt.toISOString(),
            used_fallback_date: !parsedOOOReturnDate,
          },
          snoozed_until: oooResumeAt.toISOString(),
        }).eq('id', crmResult.conversationId);
      }

      const continuationCount = await processReplyForConversationEnrollments(supabase, {
        organizationId: mailbox.organization_id,
        conversationId: crmResult.conversationId,
        fromEmail: email.from_email,
        isAutoReply,
        isOutOfOffice,
        resumeAt: oooResumeAt,
      });
      if (continuationCount > 0) {
        console.log(`[Reply Processing] Applied disposition to ${continuationCount} conversation-linked enrollment(s)`);
      }
    }

    await runClassificationPipeline(supabase, mailbox, email, matchedSendLog, crmResult);

    return { matched: true, crmCreated: crmResult.success };
  }

  // No match — gate on whether sender is known before creating visible CRM records
  // Check if sender is a known CRM contact
  const knownContactId = (await findContactIdsByEmail(supabase, mailbox.organization_id, email.from_email))[0];
  const knownContact = knownContactId ? { id: knownContactId } : null;

  // Check if sender is a known lead
  const { data: knownLead } = await supabase
    .from('leads')
    .select('id')
    .eq('organization_id', mailbox.organization_id)
    .ilike('email', email.from_email)
    .limit(1)
    .maybeSingle();

  // Both known and unknown senders create CRM records the same way. Genuine
  // automated mail (bounces/noreply/DMARC) is still flagged is_system inside
  // createCrmRecords() via isSystemEmail(). Warmup pool noise that slips past
  // detectWarmup is filtered post-ingest by the user's per-org exclusion
  // keywords (Inbox UI: src/pages/Inbox.tsx — `inbox-exclusion-keywords-*`
  // localStorage). Real first-touch humans land in the inbox visibly.
  const crmResult = await createCrmRecords(
    supabase, mailbox, email, knownLead?.id || null,
    isBounce || isSystemEmail(email.from_email, email.subject),
  );

  if (recovery) {
    if (crmResult.conversationId) await restoreConversationLatest(supabase, crmResult.conversationId);
    return { matched: false, crmCreated: crmResult.success };
  }

  if (crmResult.success && crmResult.conversationId) {
    if (isOutOfOffice && oooResumeAt) {
      await supabase.from('crm_conversations').update({
        status: 'snoozed',
        snooze_type: 'until_ooo_ends',
        snooze_context: {
          parsed_return_date: (parsedOOOReturnDate || oooResumeAt).toISOString().split('T')[0],
          resume_at: oooResumeAt.toISOString(),
          used_fallback_date: !parsedOOOReturnDate,
        },
        snoozed_until: oooResumeAt.toISOString(),
      }).eq('id', crmResult.conversationId);
    }

    await processReplyForConversationEnrollments(supabase, {
      organizationId: mailbox.organization_id,
      conversationId: crmResult.conversationId,
      fromEmail: email.from_email,
      isAutoReply,
      isOutOfOffice,
      resumeAt: oooResumeAt,
    });
  }

  // Autopilot only fires for senders already in the CRM — strangers should be
  // triaged by a human, not auto-replied to.
  if (knownContact || knownLead) {
    await runAutopilotForConversation(supabase, mailbox, email, crmResult);
  }

  return { matched: false, crmCreated: crmResult.success };
}

// ============================================================================
// Classification Pipeline
// ============================================================================

async function runClassificationPipeline(
  supabase: SupabaseClient,
  mailbox: { id: string; organization_id: string },
  email: InboundEmailMessage,
  matchedSendLog: any,
  crmResult: CrmCreateResult,
): Promise<void> {
  try {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    let openRouterKey: string | null = null;

    try {
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', mailbox.organization_id)
        .eq('provider', 'openrouter')
        .single();
      if (apiKeyData?.key_encrypted && encryptionKey) {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      }
    } catch { /* non-fatal */ }

    if (!openRouterKey || !crmResult.success || !crmResult.conversationId) return;

    // Get org's default LLM model
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', mailbox.organization_id)
      .maybeSingle();
    const orgModel = orgSettings?.default_llm_model || undefined;

    const classification = await classifyReply({
      from_email: email.from_email,
      subject: email.subject || '',
      body_text: email.text_body || '',
      original_outbound_subject: matchedSendLog.subject,
    }, openRouterKey, orgModel);

    // Store classification on message
    if (crmResult.messageId) {
      const { data: msgData } = await supabase
        .from('crm_messages')
        .select('metadata')
        .eq('id', crmResult.messageId)
        .single();

      await supabase.from('crm_messages').update({
        metadata: {
          ...((msgData?.metadata as any) || {}),
          classification: {
            intent: classification.intent,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
            needs_human_review: classification.needs_human_review,
            classified_at: new Date().toISOString(),
          },
        },
      }).eq('id', crmResult.messageId);
    }

    // Update conversation lead_intent
    await supabase.from('crm_conversations')
      .update({ lead_intent: classification.intent })
      .eq('id', crmResult.conversationId);

    // Unsubscribe / Do-Not-Contact — mirror email-unsubscribe edge function logic
    if ((classification.intent === 'unsubscribe' || classification.intent === 'do_not_contact') && matchedSendLog.lead_id) {
      try {
        const now = new Date().toISOString();

        // 1. Mark send log entry as unsubscribed
        await supabase
          .from('email_send_log')
          .update({ unsubscribed_at: now })
          .eq('id', matchedSendLog.id);

        // 2. Mark ALL active enrollments for this lead in this org as unsubscribed
        const { data: orgSequences } = await supabase
          .from('email_sequences')
          .select('id')
          .eq('organization_id', mailbox.organization_id);

        if (orgSequences && orgSequences.length > 0) {
          await supabase
            .from('email_sequence_enrollments')
            .update({ status: 'unsubscribed', updated_at: now })
            .eq('lead_id', matchedSendLog.lead_id)
            .in('sequence_id', orgSequences.map((s: any) => s.id))
            .in('status', ['active', 'paused', 'replied']);
        }

        // 3. Mark CRM contact as unsubscribed
        if (email.from_email) {
          const contactIds = await findContactIdsByEmail(supabase, mailbox.organization_id, email.from_email);
          if (contactIds.length > 0) {
            await supabase
              .from('crm_contacts')
              .update({ status: 'unsubscribed', updated_at: now })
              .in('id', contactIds);
          }
        }

        console.log(`[Reply Processing] Auto-unsubscribed lead ${matchedSendLog.lead_id} (intent: ${classification.intent})`);
      } catch (err) {
        console.error('[Reply Processing] Unsubscribe action error (non-fatal):', err);
      }
    }

    // Follow-up rules
    if (matchedSendLog.sequence_id && matchedSendLog.lead_id) {
      await evaluateFollowupRules(supabase, {
        sequenceId: matchedSendLog.sequence_id,
        leadId: matchedSendLog.lead_id,
        organizationId: mailbox.organization_id,
        intent: classification.intent,
        confidence: classification.confidence,
        triggerType: 'intent_match',
      });
    }

    // Momentum
    try {
      const momentum = await computeMomentum(supabase, crmResult.conversationId, mailbox.organization_id);
      await supabase.from('crm_conversations').update({
        momentum_score: momentum.score,
        momentum_trend: momentum.trend,
      }).eq('id', crmResult.conversationId);
    } catch { /* non-fatal */ }

    // Autopilot — prefer CRM contactId, fall back to lead_id for legacy sequences
    try {
      const autopilotContactId = crmResult.contactId || matchedSendLog.lead_id;
      if (!detectOutOfOffice(email.subject, email.text_body) && crmResult.conversationId && autopilotContactId) {
        await processAutopilot(supabase, {
          conversationId: crmResult.conversationId,
          contactId: autopilotContactId,
          organizationId: mailbox.organization_id,
          intent: classification.intent,
          confidence: classification.confidence,
          inboundMessageId: crmResult.messageId || '',
          channel: 'email',
          mailboxId: mailbox.id,
          sequenceId: matchedSendLog.sequence_id,
          messageContent: email.text_body || '',
          model: orgModel,
        }, openRouterKey);
      }
    } catch { /* non-fatal */ }

  } catch (err) {
    console.error('[Pool] Classification pipeline error (non-fatal):', err);
  }
}

// ============================================================================
// Autopilot for Conversations (no matchedSendLog required)
// ============================================================================

/**
 * Lightweight autopilot trigger for conversations with ai_enabled = true.
 * Used when there is no matchedSendLog, or when matchedSendLog lacks a lead_id.
 * Mirrors the logic in inbox-autopilot-trigger edge function.
 */
async function runAutopilotForConversation(
  supabase: SupabaseClient,
  mailbox: { id: string; organization_id: string },
  email: InboundEmailMessage,
  crmResult: CrmCreateResult,
): Promise<void> {
  if (!crmResult.success || !crmResult.conversationId || !crmResult.contactId) return;

  try {
    // Check if conversation has AI enabled
    const { data: conversation } = await supabase
      .from('crm_conversations')
      .select('ai_enabled')
      .eq('id', crmResult.conversationId)
      .single();

    if (!conversation?.ai_enabled) return;

    // Get OpenRouter API key
    const encryptionKey = process.env.ENCRYPTION_KEY;
    let openRouterKey: string | null = null;

    try {
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', mailbox.organization_id)
        .eq('provider', 'openrouter')
        .single();
      if (apiKeyData?.key_encrypted && encryptionKey) {
        openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
      }
    } catch { /* non-fatal */ }

    if (!openRouterKey) return;

    // Get org's default LLM model
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', mailbox.organization_id)
      .maybeSingle();
    const orgModel = orgSettings?.default_llm_model || undefined;

    // Classify the inbound message
    const classification = await classifyReply({
      from_email: email.from_email,
      subject: email.subject || '',
      body_text: email.text_body || '',
    }, openRouterKey, orgModel);

    // Store classification on message
    if (crmResult.messageId) {
      const { data: msgData } = await supabase
        .from('crm_messages')
        .select('metadata')
        .eq('id', crmResult.messageId)
        .single();

      await supabase.from('crm_messages').update({
        metadata: {
          ...((msgData?.metadata as any) || {}),
          classification: {
            intent: classification.intent,
            confidence: classification.confidence,
            reasoning: classification.reasoning,
            needs_human_review: classification.needs_human_review,
            classified_at: new Date().toISOString(),
          },
        },
      }).eq('id', crmResult.messageId);
    }

    // Update conversation lead_intent
    await supabase.from('crm_conversations')
      .update({ lead_intent: classification.intent })
      .eq('id', crmResult.conversationId);

    // Unsubscribe / Do-Not-Contact — no send log, but still mark contact + find enrollments by email
    if ((classification.intent === 'unsubscribe' || classification.intent === 'do_not_contact') && email.from_email) {
      try {
        const now = new Date().toISOString();

        // Mark CRM contact as unsubscribed
        const contactIds = await findContactIdsByEmail(supabase, mailbox.organization_id, email.from_email);
        if (contactIds.length > 0) {
          await supabase
            .from('crm_contacts')
            .update({ status: 'unsubscribed', updated_at: now })
            .in('id', contactIds);
        }

        // Find lead by email and unsubscribe all active enrollments
        const { data: leads } = await supabase
          .from('leads')
          .select('id')
          .ilike('email', email.from_email)
          .eq('organization_id', mailbox.organization_id);

        if (leads && leads.length > 0) {
          const { data: orgSequences } = await supabase
            .from('email_sequences')
            .select('id')
            .eq('organization_id', mailbox.organization_id);

          if (orgSequences && orgSequences.length > 0) {
            for (const lead of leads) {
              await supabase
                .from('email_sequence_enrollments')
                .update({ status: 'unsubscribed', updated_at: now })
                .eq('lead_id', lead.id)
                .in('sequence_id', orgSequences.map((s: any) => s.id))
                .in('status', ['active', 'paused', 'replied']);
            }
          }
        }

        console.log(`[Reply Processing] Auto-unsubscribed contact ${email.from_email} (intent: ${classification.intent}, no send log)`);
      } catch (err) {
        console.error('[Reply Processing] Unsubscribe action error (non-fatal):', err);
      }
    }

    // Momentum
    try {
      const momentum = await computeMomentum(supabase, crmResult.conversationId, mailbox.organization_id);
      await supabase.from('crm_conversations').update({
        momentum_score: momentum.score,
        momentum_trend: momentum.trend,
      }).eq('id', crmResult.conversationId);
    } catch { /* non-fatal */ }

    // Autopilot — use CRM contactId
    try {
      if (!detectOutOfOffice(email.subject, email.text_body)) {
        await processAutopilot(supabase, {
          conversationId: crmResult.conversationId,
          contactId: crmResult.contactId,
          organizationId: mailbox.organization_id,
          intent: classification.intent,
          confidence: classification.confidence,
          inboundMessageId: crmResult.messageId || '',
          channel: 'email',
          mailboxId: mailbox.id,
          messageContent: email.text_body || '',
          model: orgModel,
        }, openRouterKey);
      }
    } catch { /* non-fatal */ }

  } catch (err) {
    console.error('[Pool] Autopilot-for-conversation error (non-fatal):', err);
  }
}

// ============================================================================
// CRM Record Creation
// ============================================================================

interface CrmCreateResult {
  success: boolean;
  conversationId?: string;
  messageId?: string;
  contactId?: string;
}

/**
 * The reply's files in crm_messages.attachments' shape. Pushed replies arrive
 * with them stored; polled mail is stored here, so only mail that gets filed
 * costs a download and upload. A failure is logged and never drops the reply.
 */
async function resolveAttachments(
  supabase: SupabaseClient,
  mailbox: { id: string; organization_id: string; email_address: string },
  email: InboundEmailMessage,
): Promise<Record<string, unknown>[]> {
  if (email.attachments) return email.attachments;
  if (!email.loadAttachments) return [];
  try {
    const raws = await email.loadAttachments();
    if (raws.length === 0) return [];
    return await storeInboundAttachments(supabase, mailbox.organization_id, mailbox.id, email.message_id || `uid-${email.uid}`, raws);
  } catch (err) {
    console.warn(`[Attachments] ${mailbox.email_address} ${email.message_id}: ${(err as Error).message}`);
    return [];
  }
}

async function createCrmRecords(
  supabase: SupabaseClient,
  mailbox: { id: string; organization_id: string; email_address: string },
  email: InboundEmailMessage,
  leadId: string | null,
  isSystem = false,
  sourceSendLog?: { id?: string; sequence_id?: string | null; lead_id?: string | null },
): Promise<CrmCreateResult> {
  try {
    // Find or create CRM contact
    let contactId: string | null = null;

    const existingContactId = (await findContactIdsByEmail(supabase, mailbox.organization_id, email.from_email))[0];

    if (existingContactId) {
      contactId = existingContactId;
    } else if (leadId) {
      const { data: lead } = await supabase
        .from('leads')
        .select('source_id')
        .eq('id', leadId)
        .single();

      if (lead?.source_id) {
        // The email lookup above already missed; match on the lead's source contact.
        const { data: linkedContact } = await supabase
          .from('crm_contacts')
          .select('id')
          .eq('organization_id', mailbox.organization_id)
          .eq('source_id', lead.source_id)
          .limit(1)
          .maybeSingle();
        if (linkedContact) contactId = linkedContact.id;
      }
    }

    if (!contactId) {
      if (isSystem) {
        // Bounce/daemon/noreply sender with no existing contact: keep it out of
        // the CRM entirely — a "Mail Delivery System" contact poisons reply stats.
        console.log(`[CRM] System sender ${email.from_email} unknown — not creating contact`);
        return { success: false };
      }
      const nameParts = (email.from_name || '').split(' ');
      const firstName = nameParts[0] || email.from_email.split('@')[0];
      const lastName = nameParts.slice(1).join(' ') || null;
      const displayName = lastName ? `${firstName} ${lastName}` : firstName;
      const { data: newContact, error: contactError } = await supabase
        .from('crm_contacts')
        .insert({
          organization_id: mailbox.organization_id,
          first_name: firstName,
          last_name: lastName,
          display_name: displayName,
          primary_email: email.from_email,
          source: 'email_inbound',
        })
        .select('id')
        .single();
      if (contactError) {
        // Created concurrently (or a case variant exists): use that contact.
        const raced = contactError.code === '23505'
          ? (await findContactIdsByEmail(supabase, mailbox.organization_id, email.from_email))[0]
          : undefined;
        if (!raced) {
          console.error(`[CRM] Failed to create contact for ${email.from_email}:`, contactError.message);
          return { success: false };
        }
        contactId = raced;
      } else {
        contactId = newContact!.id;
      }
    }

    // Get or create a mailbox-scoped email conversation. The production RPC can
    // be stale on some projects and collapse the same sender across different
    // inboxes, so enforce the mailbox scope here instead of relying on the RPC.
    let conversationId: string | null = null;
    const { data: existingConversation, error: existingConvError } = await supabase
      .from('crm_conversations')
      .select('id')
      .eq('organization_id', mailbox.organization_id)
      .eq('contact_id', contactId)
      .eq('channel', 'email')
      .eq('mailbox_id', mailbox.id)
      .limit(1)
      .maybeSingle();

    if (existingConvError) {
      console.error(`[CRM] Failed to look up conversation for ${email.from_email}:`, existingConvError.message);
      return { success: false };
    }

    if (existingConversation?.id) {
      conversationId = existingConversation.id;
      await supabase
        .from('crm_conversations')
        .update({
          external_participant_id: email.from_email,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    } else {
      const { data: newConversation, error: convInsertError } = await supabase
        .from('crm_conversations')
        .insert({
          organization_id: mailbox.organization_id,
          contact_id: contactId,
          channel: 'email',
          external_participant_id: email.from_email,
          mailbox_id: mailbox.id,
          status: 'open',
        })
        .select('id')
        .single();

      if (convInsertError || !newConversation?.id) {
        console.error(`[CRM] Failed to create conversation for ${email.from_email}:`, convInsertError?.message);
        return { success: false };
      }
      conversationId = newConversation.id;
    }

    // Tag system conversations (bounces, noreply, DMARC, notifications)
    if (isSystemEmail(email.from_email, email.subject)) {
      await supabase
        .from('crm_conversations')
        .update({ is_system: true, status: 'closed', unread_count: 0 })
        .eq('id', conversationId)
        .eq('is_system', false);
    } else {
      // Reopen archived conversations on inbound (trigger only reopens 'closed')
      await supabase
        .from('crm_conversations')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('status', 'archived');
    }

    // Dedup check — if message exists but has empty content, update it with re-parsed body
    if (email.message_id) {
      const { data: existingMsg } = await supabase
        .from('crm_messages')
        .select('id, content, conversation_id, attachments')
        .eq('external_message_id', email.message_id)
        .eq('organization_id', mailbox.organization_id)
        .limit(1)
        .maybeSingle();
      if (existingMsg) {
        const newContent = email.html_body || email.text_body || '';
        const updateExisting: Record<string, unknown> = {};
        if (existingMsg.conversation_id !== conversationId) {
          updateExisting.conversation_id = conversationId;
          updateExisting.contact_id = contactId;
        }
        if ((!existingMsg.content || existingMsg.content.trim() === '') && newContent.trim()) {
          updateExisting.content = newContent;
          updateExisting.content_type = email.html_body ? 'html' : 'text';
        }
        // Add files the filed copy is missing (filed before attachments were
        // kept, or a replay that carries them); never replace stored ones.
        const isStored = (a: any) => !!a?.storagePath || !!a?.url;
        if ((email.attachments?.length || email.loadAttachments) && !(existingMsg.attachments ?? []).some(isStored)) {
          const files = await resolveAttachments(supabase, mailbox, email);
          if (files.some(isStored)) updateExisting.attachments = files;
        }
        if (Object.keys(updateExisting).length > 0) {
          await supabase.from('crm_messages').update(updateExisting).eq('id', existingMsg.id);
          console.log(`[CRM] Reconciled existing message ${existingMsg.id} for ${email.from_email}`);
        }
        return { success: true, conversationId: conversationId as string, messageId: existingMsg.id, contactId: contactId! };
      }
    }

    // Insert inbound message
    const bodyContent = email.html_body || email.text_body || '';
    const attachments = await resolveAttachments(supabase, mailbox, email);
    const { data: insertedMsg, error: msgError } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: mailbox.organization_id,
        conversation_id: conversationId,
        contact_id: contactId,
        direction: 'inbound',
        sender_type: 'contact',
        content: bodyContent,
        content_type: email.html_body ? 'html' : 'text',
        email_subject: email.subject,
        email_from: email.from_email,
        external_message_id: email.message_id || null,
        attachments,
        metadata: {
          email_from_name: email.from_name,
          email_in_reply_to: email.in_reply_to,
          email_references: email.references,
          source_send_log_id: sourceSendLog?.id || null,
          source_sequence_id: sourceSendLog?.sequence_id || null,
          source_lead_id: sourceSendLog?.lead_id || null,
          source: 'imap_poller_worker',
        },
        created_at: email.date?.toISOString() || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (msgError) {
      console.error(`[CRM] Failed to insert message for ${email.from_email}:`, msgError.message);
      return { success: false };
    }

    return { success: true, conversationId: conversationId as string, messageId: insertedMsg?.id, contactId: contactId! };
  } catch (err) {
    console.error(`[CRM] Unexpected error creating CRM records for ${email.from_email}:`, err);
    return { success: false };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Start
// ============================================================================

main().catch((err) => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
