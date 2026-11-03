/**
 * Campaign Processor Worker — Fly.io
 *
 * Event-driven orchestrator that detects ready campaign leads and dispatches
 * them to the campaign-processor edge function for execution.
 *
 * Architecture:
 *   - Supabase Realtime subscription for instant detection of ready leads
 *   - Polling loop (30s) as safety net for missed events
 *   - Work queue (Set) for deduplication
 *   - Worker pool with configurable concurrency
 *   - Business hours caching per organization
 *   - Health check endpoint for Fly.io at /health
 *
 * The worker does NOT reimplement campaign processing logic — it delegates
 * to the edge function via HTTP POST { processLeadId, campaignId }.
 */

import http from 'node:http';
import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EDGE_FUNCTION_URL = process.env.EDGE_FUNCTION_URL!;
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const PORT = parseInt(process.env.PORT || '8080', 10);
const CACHE_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[Worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!EDGE_FUNCTION_URL) {
  console.error('[Worker] Missing EDGE_FUNCTION_URL');
  process.exit(1);
}

// ============================================================================
// Types
// ============================================================================

interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  workDays: number[];
}

interface LeadProgressRow {
  id: string;
  campaign_id: string;
  status: string;
  next_action_at: string | null;
  connection_sent_at: string | null;
  connection_accepted_at: string | null;
  is_test_contact: boolean;
}

// ============================================================================
// Stats (exposed via /health)
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  totalCycles: 0,
  totalProcessed: 0,
  totalErrors: 0,
  totalSkipped: 0,
  totalRealtimeEvents: 0,
  queueSize: 0,
  activeWorkers: 0,
  lastCycleAt: null as string | null,
  lastCycleDurationMs: 0,
  lastCycleQueued: 0,
  isProcessing: false,
  realtimeConnected: false,
};

// ============================================================================
// Health Check Server
// ============================================================================

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    stats.queueSize = workQueue.size;
    stats.activeWorkers = activeWorkers.size;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ...stats }));
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

function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}, shutting down gracefully...`);
  shutdownRequested = true;

  // Unsubscribe from Realtime
  if (realtimeChannel) {
    realtimeChannel.unsubscribe();
  }
  if (campaignChannel) {
    campaignChannel.unsubscribe();
  }

  server.close(() => {
    console.log('[Worker] HTTP server closed');
    process.exit(0);
  });

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

// ============================================================================
// Work Queue + Worker Pool
// ============================================================================

const workQueue = new Set<string>(); // Set of lead progress IDs
const activeWorkers = new Set<string>(); // Currently processing lead IDs

// Map: leadId → campaignId (populated from DB, cached for efficiency)
const leadCampaignMap = new Map<string, string>();

// Map: leadId → senderAccountId (populated from DB, cached for account-level concurrency guard)
const leadSenderMap = new Map<string, string>();
// Set of sender account IDs currently in-flight (prevents concurrent sends from same account)
const inFlightAccounts = new Set<string>();

// ============================================================================
// Caches
// ============================================================================

// campaignId → orgId
const campaignOrgMap = new Map<string, string>();
// orgId → BusinessHoursConfig
const businessHoursCache = new Map<string, BusinessHoursConfig>();
// Active campaign IDs
const activeCampaigns = new Set<string>();

let lastCacheRefresh = 0;

// 'HH:MM:SS' → hour number
function parseHour(timeStr: string | null, fallback: number): number {
  if (!timeStr) return fallback;
  const hour = parseInt(timeStr.split(':')[0], 10);
  return Number.isNaN(hour) ? fallback : hour;
}

async function refreshCaches(supabase: SupabaseClient): Promise<void> {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_REFRESH_MS) return;
  lastCacheRefresh = now;

  try {
    // Refresh active campaigns + org mapping
    const { data: campaigns } = await supabase
      .from('linkedin_campaigns')
      .select('id, organization_id')
      .eq('status', 'active');

    if (campaigns) {
      activeCampaigns.clear();
      for (const c of campaigns) {
        activeCampaigns.add(c.id);
        campaignOrgMap.set(c.id, c.organization_id);
      }
    }

    // Refresh business hours for all active orgs.
    // Source of truth is organization_channel_limits — same table and shape the
    // campaign-processor edge function reads in getBusinessHoursConfig().
    const orgIds = [...new Set(campaignOrgMap.values())];
    if (orgIds.length > 0) {
      const { data: orgLimits, error: limitsError } = await supabase
        .from('organization_channel_limits')
        .select('organization_id, business_hours_only, business_hours_start, business_hours_end, timezone, active_days')
        .eq('channel', 'linkedin_invitation')
        .in('organization_id', orgIds);

      if (limitsError) throw limitsError;

      businessHoursCache.clear();
      if (orgLimits) {
        for (const l of orgLimits) {
          if (!l.business_hours_only) continue;
          businessHoursCache.set(l.organization_id, {
            enabled: true,
            timezone: l.timezone || 'UTC',
            startHour: parseHour(l.business_hours_start, 9),
            endHour: parseHour(l.business_hours_end, 17),
            workDays: l.active_days || [1, 2, 3, 4, 5],
          });
        }
      }
    }

    console.log(`[Worker] Cache refreshed: ${activeCampaigns.size} active campaigns, ${businessHoursCache.size} org business hours`);
  } catch (err) {
    console.error('[Worker] Cache refresh error:', err);
  }
}

// ============================================================================
// Business Hours Check (ported from workflow-utils.ts)
// ============================================================================

function isWithinBusinessHours(config?: BusinessHoursConfig): boolean {
  if (!config || !config.enabled) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone || 'UTC',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(now);
  const hourPart = parts.find((p) => p.type === 'hour');
  const weekdayPart = parts.find((p) => p.type === 'weekday');

  if (!hourPart || !weekdayPart) return true;

  const currentHour = parseInt(hourPart.value, 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const currentDay = weekdayMap[weekdayPart.value] ?? 1;

  const workDays = config.workDays || [1, 2, 3, 4, 5];
  if (!workDays.includes(currentDay)) return false;

  const startHour = config.startHour ?? 9;
  const endHour = config.endHour ?? 17;
  return currentHour >= startHour && currentHour < endHour;
}

// ============================================================================
// Lead Processing via Edge Function
// ============================================================================

async function getCampaignIdForLead(supabase: SupabaseClient, leadId: string): Promise<string | null> {
  // Check in-memory cache first
  const cached = leadCampaignMap.get(leadId);
  if (cached && activeCampaigns.has(cached)) return cached;

  // Fetch from DB (include sender_account_id for account-level concurrency guard)
  const { data } = await supabase
    .from('campaign_lead_progress')
    .select('campaign_id, sender_account_id')
    .eq('id', leadId)
    .single();

  if (data?.campaign_id) {
    leadCampaignMap.set(leadId, data.campaign_id);
    if (data.sender_account_id) {
      leadSenderMap.set(leadId, data.sender_account_id);
    }
    return data.campaign_id;
  }

  return null;
}

async function processLeadViaEdgeFunction(supabase: SupabaseClient, leadId: string): Promise<void> {
  const campaignId = await getCampaignIdForLead(supabase, leadId);
  if (!campaignId) {
    stats.totalSkipped++;
    return;
  }

  // Check if campaign is still active
  if (!activeCampaigns.has(campaignId)) {
    stats.totalSkipped++;
    return;
  }

  // Check business hours for this campaign's org
  const orgId = campaignOrgMap.get(campaignId);
  if (orgId) {
    const bhConfig = businessHoursCache.get(orgId);
    if (!isWithinBusinessHours(bhConfig)) {
      stats.totalSkipped++;
      return;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000); // 2 min timeout

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ processLeadId: leadId, campaignId }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const result = await response.json();
    stats.totalProcessed++;

    if (!result.success) {
      stats.totalErrors++;
      console.error(`[Worker] Edge function error for lead ${leadId}:`, result.error);
    }
  } catch (err) {
    stats.totalErrors++;
    if (err instanceof Error && err.name === 'AbortError') {
      console.error(`[Worker] Timeout processing lead ${leadId}`);
    } else {
      console.error(`[Worker] Error processing lead ${leadId}:`, err);
    }
  }
}

// ============================================================================
// Worker Pool (drains work queue with concurrency limit)
// ============================================================================

async function drainQueue(supabase: SupabaseClient): Promise<void> {
  while (!shutdownRequested) {
    if (workQueue.size === 0 || activeWorkers.size >= CONCURRENCY) {
      await sleep(100);
      continue;
    }

    const leadId = workQueue.values().next().value;
    if (!leadId) {
      await sleep(100);
      continue;
    }
    workQueue.delete(leadId);

    // Skip if already being processed
    if (activeWorkers.has(leadId)) continue;

    // Account-level concurrency guard: prevent two leads from the same sender
    // account being processed simultaneously (avoids cooldown race condition)
    const senderAccountId = leadSenderMap.get(leadId);
    if (senderAccountId && inFlightAccounts.has(senderAccountId)) {
      // Re-queue — will be picked up after the current lead for this account finishes
      workQueue.add(leadId);
      await sleep(50);
      continue;
    }

    activeWorkers.add(leadId);
    if (senderAccountId) inFlightAccounts.add(senderAccountId);

    // Fire and forget — pool manages concurrency
    processLeadViaEdgeFunction(supabase, leadId)
      .catch((err) => {
        console.error(`[Worker] Unhandled error processing ${leadId}:`, err);
        stats.totalErrors++;
      })
      .finally(() => {
        activeWorkers.delete(leadId);
        if (senderAccountId) inFlightAccounts.delete(senderAccountId);
      });
  }
}

// ============================================================================
// Realtime Subscription
// ============================================================================

let realtimeChannel: RealtimeChannel | null = null;
let campaignChannel: RealtimeChannel | null = null;

function setupRealtimeSubscription(supabase: SupabaseClient): void {
  // Subscribe to campaign_lead_progress updates
  realtimeChannel = supabase.channel('campaign-leads-ready')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'campaign_lead_progress',
    }, (payload) => {
      stats.totalRealtimeEvents++;
      const row = payload.new as LeadProgressRow;

      // Only queue leads that are ready for processing
      if (!['pending', 'in_progress', 'waiting'].includes(row.status)) return;

      // Skip test contacts
      if (row.is_test_contact) return;

      // Skip connection-waiting leads
      if (row.connection_sent_at && !row.connection_accepted_at) return;

      // Check next_action_at
      if (row.next_action_at && new Date(row.next_action_at) > new Date()) return;

      workQueue.add(row.id);
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'campaign_lead_progress',
    }, (payload) => {
      stats.totalRealtimeEvents++;
      const row = payload.new as LeadProgressRow;

      // New lead added to campaign — queue if pending
      if (row.status === 'pending' && !row.is_test_contact) {
        workQueue.add(row.id);
      }
    })
    .subscribe((status) => {
      stats.realtimeConnected = status === 'SUBSCRIBED';
      console.log(`[Worker] Realtime campaign_lead_progress: ${status}`);
    });

  // Subscribe to campaign status changes (activation)
  campaignChannel = supabase.channel('campaigns-active')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'linkedin_campaigns',
    }, async (payload) => {
      const newRow = payload.new as { id: string; status: string; organization_id: string };

      if (newRow.status === 'active') {
        // Campaign just activated — add to cache and queue all pending leads
        activeCampaigns.add(newRow.id);
        campaignOrgMap.set(newRow.id, newRow.organization_id);

        console.log(`[Worker] Campaign ${newRow.id} activated, fetching pending leads...`);

        try {
          const { data: leads } = await supabase
            .from('campaign_lead_progress')
            .select('id')
            .eq('campaign_id', newRow.id)
            .eq('is_test_contact', false)
            .in('status', ['pending', 'in_progress'])
            .or('next_action_at.is.null,next_action_at.lte.' + new Date().toISOString())
            .limit(BATCH_SIZE);

          if (leads?.length) {
            console.log(`[Worker] Queued ${leads.length} leads for newly activated campaign ${newRow.id}`);
            leads.forEach(l => workQueue.add(l.id));
          }
        } catch (err) {
          console.error(`[Worker] Error fetching leads for activated campaign ${newRow.id}:`, err);
        }
      } else if (newRow.status !== 'active') {
        // Campaign deactivated — remove from cache
        activeCampaigns.delete(newRow.id);
      }
    })
    .subscribe((status) => {
      console.log(`[Worker] Realtime linkedin_campaigns: ${status}`);
    });
}

// ============================================================================
// Polling Loop (Safety Net)
// ============================================================================

async function pollingLoop(supabase: SupabaseClient): Promise<void> {
  while (!shutdownRequested) {
    try {
      const cycleStart = Date.now();
      stats.isProcessing = true;

      // Refresh caches periodically
      await refreshCaches(supabase);

      const now = new Date().toISOString();

      // Fetch ready leads across all active campaigns
      const { data: leads, error } = await supabase
        .from('campaign_lead_progress')
        .select('id, campaign_id, connection_sent_at, connection_accepted_at')
        .eq('is_test_contact', false)
        .in('status', ['pending', 'in_progress', 'waiting'])
        .or(`next_action_at.is.null,next_action_at.lte.${now}`)
        .order('created_at', { ascending: true })
        .limit(BATCH_SIZE);

      if (error) {
        console.error('[Worker] Polling query error:', error.message);
        stats.totalErrors++;
      } else if (leads?.length) {
        let queued = 0;
        for (const lead of leads) {
          // Skip connection-waiting leads
          if (lead.connection_sent_at && !lead.connection_accepted_at) continue;

          // Cache campaign mapping
          if (lead.campaign_id) {
            leadCampaignMap.set(lead.id, lead.campaign_id);
          }

          workQueue.add(lead.id);
          queued++;
        }
        stats.lastCycleQueued = queued;
      } else {
        stats.lastCycleQueued = 0;
      }

      stats.totalCycles++;
      stats.lastCycleAt = new Date().toISOString();
      stats.lastCycleDurationMs = Date.now() - cycleStart;
      stats.isProcessing = false;

    } catch (err) {
      console.error('[Worker] Polling cycle error:', err);
      stats.totalErrors++;
      stats.isProcessing = false;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ============================================================================
// Main
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) },
  });

  console.log(`[Worker] Campaign Processor Orchestrator starting`);
  console.log(`[Worker] Config: concurrency=${CONCURRENCY}, poll=${POLL_INTERVAL_MS}ms, batch=${BATCH_SIZE}`);
  console.log(`[Worker] Edge function: ${EDGE_FUNCTION_URL.substring(0, 50)}...`);

  // 1. Refresh caches immediately
  await refreshCaches(supabase);

  // 2. Set up Realtime subscriptions
  setupRealtimeSubscription(supabase);

  // 3. Do an initial poll to catch any leads ready right now
  console.log('[Worker] Running initial poll...');
  const now = new Date().toISOString();
  const { data: initialLeads } = await supabase
    .from('campaign_lead_progress')
    .select('id, campaign_id, connection_sent_at, connection_accepted_at')
    .eq('is_test_contact', false)
    .in('status', ['pending', 'in_progress', 'waiting'])
    .or(`next_action_at.is.null,next_action_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (initialLeads?.length) {
    let queued = 0;
    for (const lead of initialLeads) {
      if (lead.connection_sent_at && !lead.connection_accepted_at) continue;
      if (lead.campaign_id) leadCampaignMap.set(lead.id, lead.campaign_id);
      workQueue.add(lead.id);
      queued++;
    }
    console.log(`[Worker] Initial poll: queued ${queued} leads`);
  }

  // 4. Start worker pool + polling loop concurrently
  console.log('[Worker] Starting worker pool and polling loop...');

  // These run forever (until shutdown)
  Promise.all([
    drainQueue(supabase),
    pollingLoop(supabase),
  ]).catch((err) => {
    console.error('[Worker] Fatal error in main loops:', err);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('[Worker] Fatal startup error:', err);
  process.exit(1);
});
