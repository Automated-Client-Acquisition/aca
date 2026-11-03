/**
 * Sequence Sender Worker — Fly.io
 *
 * Long-running Node.js process that continuously processes due email sequence
 * enrollments. Replaces the email-sequence-processor edge function cron.
 *
 * Architecture:
 *   - Work is claimed per ORG via claim_sequence_send_batch: the worker leases
 *     up to ORG_CONCURRENCY orgs (oldest due first) and gets at most
 *     PER_ORG_BATCH due enrollments for each. One org's backlog can therefore
 *     only ever occupy one lane, never delay other orgs' sends.
 *   - Each leased org runs in its own lane; lanes run in parallel, and inside a
 *     lane enrollments are processed sequentially (same logic as before).
 *   - Leases make it safe to run several machines: an org is only ever
 *     processed by one lane on one machine at a time.
 *   - Health check endpoint for Fly.io at /health
 *
 * Config (env vars):
 *   ORG_CONCURRENCY     — orgs processed in parallel per machine (default: 8)
 *   PER_ORG_BATCH       — enrollments claimed per org lease (default: 25)
 *   LEASE_SECONDS       — org lease length, renewed per enrollment (default: 300)
 *   POLL_INTERVAL_MS    — idle sleep / per-org cooldown in ms (default: 5000)
 *   POSTSHIBA_CONCURRENCY — minimum sends at once for sequences pinned to
 *                         PostShiba senders only (default: 8); raised with the
 *                         cluster's hourly cap up to POSTSHIBA_MAX_CONCURRENCY
 *                         (default: 24). Paced to the cluster's hourly and daily
 *                         caps and spread over each sequence's send window.
 *                         Every other sender stays one at a time.
 */

import http from 'node:http';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { extractSMTPCredentials } from './crypto.js';
import { selectMailbox, recordSendResult, resetDailyCounters, countReadyMailboxes, isMailboxStillWarming } from './email-rotation.js';
import { resolveMailboxPool, type MailboxSelectionConfig } from './mailbox-pool.js';
import { selectMailboxAdvanced, getProviderFromRecipient } from './esp-matching.js';
import { applyAIFilters, type AIFilterSettings } from './ai-lead-filter.js';
import { prepareEmailBody, buildUnsubscribeAnchor, buildTextOnlyUnsubscribeHtml, type TrackingSettings } from './email-tracking.js';
import { sendEmailViaSMTP } from './smtp-client.js';
import { sendEmailViaGraph } from './graph-client.js';
import { checkFeatureAccess } from './feature-access.js';

// ============================================================================
// Config
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ORG_CONCURRENCY = parseInt(process.env.ORG_CONCURRENCY || '8', 10);
const PER_ORG_BATCH = parseInt(process.env.PER_ORG_BATCH || '25', 10);
const LEASE_SECONDS = parseInt(process.env.LEASE_SECONDS || '300', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
// An org whose lane came back full likely has more due right now: re-claim it
// quickly rather than waiting a whole poll interval.
const BUSY_ORG_COOLDOWN_MS = 1000;
// PostShiba takes 4-15 s to accept each message over SMTP, so its senders don't
// go through the one-at-a-time lane: a sequence pinned to PostShiba senders only
// sends several at once, paced to the cluster's caps.
const POSTSHIBA_CONCURRENCY = parseInt(process.env.POSTSHIBA_CONCURRENCY || '8', 10);
const POSTSHIBA_MAX_CONCURRENCY = parseInt(process.env.POSTSHIBA_MAX_CONCURRENCY || '24', 10);
// Seconds a PostShiba send holds a slot, for sizing concurrency to the hourly cap.
const POSTSHIBA_SECONDS_PER_SEND = 6;
// Enrollments held back by the cluster's caps come back within this window.
const POSTSHIBA_CLUSTER_DEFER_MS = 10 * 60 * 1000;
// Enrollments held back to spread a sequence over its send window come back within this one.
const POSTSHIBA_SPREAD_DEFER_MS = 60 * 60 * 1000;
// Daily counter reset + orphaned-row reaper. Both are idempotent, so running
// them on every machine is safe.
const MAINTENANCE_INTERVAL_MS = 60_000;
// Unique per process: a restarted machine must not inherit its old leases.
const WORKER_ID = `${process.env.FLY_MACHINE_ID || os.hostname()}:${process.pid}:${Date.now()}`;
const PORT = parseInt(process.env.PORT || '8080', 10);

// Host that serves unsubscribe links when the org has no VERIFIED tracking domain.
// Every verified tracking domain CNAMEs to this same proxy, so both branches serve
// the identical short /u/<id> path — a recipient never sees a supabase.co URL.
const UNSUBSCRIBE_FALLBACK_BASE = `https://${process.env.UNSUBSCRIBE_FALLBACK_HOST || 't.automatedclientacquisition.com'}`;

// Timezone used when a sequence has none. every send-window helper
// (hours, weekend, rescheduling) MUST agree on it: when they didn't ('UTC' vs New York), a
// sequence saved with timezone: null was judged outside hours in one zone and
// rescheduled "into the window" of the other, one minute ahead, forever.
const FALLBACK_TIMEZONE = 'America/New_York';

// CRM contact statuses that hard-suppress a sequence send (PECR / opt-out).
const SUPPRESSED_CONTACT_STATUSES = new Set(['unsubscribed', 'do_not_contact', 'bounced']);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// The fallback host is ACA Cloud's tracking proxy, which writes to ACA Cloud's
// database. A self-hosted install sending with it would give recipients
// unsubscribe links that never reach its own suppression list.
if (process.env.ACA_SELF_HOSTED === 'true' && !process.env.UNSUBSCRIBE_FALLBACK_HOST) {
  console.error('Set UNSUBSCRIBE_FALLBACK_HOST to the host serving your tracking-proxy (self-hosted installs must not send unsubscribe links to ACA Cloud)');
  process.exit(1);
}

// ============================================================================
// M365 tenant resolution (for the Graph send path)
// ============================================================================

/**
 * Resolve an M365 tenant GUID from a mailbox's admin email (m365_tenants keyed
 * by organization_id + admin_email — same lookup infra-m365-heal-passwords uses).
 * Results, including misses, are cached for the process lifetime: one DB lookup
 * per (org, admin) pair. A miss (null) → no tenant on record → caller uses SMTP.
 */
const m365TenantIdCache = new Map<string, string | null>();

async function resolveM365TenantId(
  supabase: SupabaseClient,
  organizationId: string,
  adminEmail: string,
): Promise<string | null> {
  const key = `${organizationId}|${adminEmail}`;
  const cached = m365TenantIdCache.get(key);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('organization_id', organizationId)
    .eq('admin_email', adminEmail)
    .maybeSingle();

  if (error) {
    // Transient DB error — don't cache; fall back to SMTP this time, retry next.
    console.warn(`[Graph] tenant lookup failed for ${adminEmail}: ${error.message}`);
    return null;
  }

  const tenantId = (data?.tenant_id as string | undefined) ?? null;
  m365TenantIdCache.set(key, tenantId);
  return tenantId;
}

// ============================================================================
// Types
// ============================================================================

interface SequenceSettings {
  mailbox_ids?: string[];
  /**
   * Auto pool rule. When mode='auto' the frozen mailbox_ids list is ignored and
   * the pool is resolved from tags + health at send time. See mailbox-pool.ts.
   */
  mailbox_selection?: MailboxSelectionConfig | null;
  stop_on_reply?: boolean;
  stop_on_auto_reply?: boolean;
  stop_company_on_reply?: boolean;
  open_tracking?: boolean;
  click_tracking?: boolean;
  custom_tracking_domain?: string | null;
  daily_limit?: number;
  max_new_leads_per_day?: number | null;
  min_time_gap_minutes?: number;
  random_additional_minutes?: number;
  prioritize_new_leads?: boolean;
  send_window?: { start: string; end: string };
  timezone?: string;
  skip_weekends?: boolean;
  provider_matching?: boolean;
  ai_filter_unlikely_reply?: 'send' | 'skip';
  ai_filter_hostile?: 'send' | 'skip';
  first_email_text_only?: boolean;
  sisr_enabled?: boolean;
  hypersend_mode?: boolean;
  esp_routing_rules?: Array<{ recipient_domain: string; provider: string }>;
  limit_per_company_domain?: number | null;
  unsubscribe_header?: boolean;
  unsubscribe_link_footer?: boolean;
  unsubscribe_footer_text?: string | null;
  allow_risky_emails?: boolean;
  cc?: string[];
  bcc?: string[];
  auto_optimize_ab?: boolean;
  ab_winning_metric?: 'open_rate' | 'click_rate' | 'reply_rate';
  ab_sample_size?: number;
  variable_defaults?: Record<string, string>;
}

interface SequenceStep {
  order: number;
  type: 'email' | 'delay' | 'condition' | 'ab_test';
  delay_hours?: number;
  subject?: string;
  body?: string;
  condition_type?: 'opened' | 'clicked' | 'replied' | 'bounced';
  condition_timeout_hours?: number;
  variants?: Array<{ id: string; subject: string; body: string; split_percentage: number; is_winner?: boolean }>;
}

// Default settings applied when fields are missing from the database
const DEFAULT_SETTINGS: Partial<SequenceSettings> = {
  send_window: { start: '08:00', end: '18:00' },
  timezone: 'America/New_York',
  skip_weekends: true,
  daily_limit: 30,
  min_time_gap_minutes: 9,
  random_additional_minutes: 5,
};

function applyDefaultSettings(raw: SequenceSettings): SequenceSettings {
  return { ...DEFAULT_SETTINGS, ...raw };
}

// ============================================================================
// Stats (exposed via /health)
// ============================================================================

const stats = {
  startedAt: new Date().toISOString(),
  totalCycles: 0,
  totalEnrollmentsProcessed: 0,
  totalSent: 0,
  totalSkipped: 0,
  totalFiltered: 0,
  totalErrors: 0,
  lastCycleAt: null as string | null,
  lastCycleDurationMs: 0,
  lastCycleEnrollments: 0,
  isProcessing: false,
  activeLanes: 0,
  workerId: '',
  lastResetDate: '',
};

// ============================================================================
// Health Check Server
// ============================================================================

const server = http.createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
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
  // main() stops claiming, lets in-flight lanes finish their current
  // enrollment, releases leases and exits. The timer is only a backstop; leases
  // left behind by a forced exit expire after LEASE_SECONDS.
  shutdownRequested = true;
  server.close();
  setTimeout(() => {
    console.error('[Worker] Forced exit after 25s');
    process.exit(1);
  }, 25000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================================================
// Main Loop
// ============================================================================

async function main() {
  stats.workerId = WORKER_ID;
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { fetch: (...args) => fetch(...args) },
  });

  console.log(
    `[Worker] Sequence Sender starting — worker=${WORKER_ID}, orgConcurrency=${ORG_CONCURRENCY}, ` +
    `perOrgBatch=${PER_ORG_BATCH}, leaseSeconds=${LEASE_SECONDS}, interval=${POLL_INTERVAL_MS}ms`,
  );
  console.log(`[Worker] Supabase URL: ${SUPABASE_URL.substring(0, 40)}...`);

  // One lane per leased org. Different orgs send in parallel; inside a lane an
  // org's enrollments are processed one at a time, exactly as before, so the
  // mailbox daily_sent / sequence daily-limit checks never race with each other.
  const lanes = new Map<string, Promise<void>>();
  // Per-org pause between lanes, so rows that stay due without being
  // rescheduled can't spin in a tight loop. Mirrors the old POLL_INTERVAL sleep.
  const orgCooldownUntil = new Map<string, number>();
  let lastMaintenanceAt = 0;

  while (!shutdownRequested) {
    try {
      if (Date.now() - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
        lastMaintenanceAt = Date.now();
        await runMaintenance(supabase);
      }

      const nowMs = Date.now();
      for (const [orgId, until] of orgCooldownUntil) {
        if (until <= nowMs) orgCooldownUntil.delete(orgId);
      }

      const freeLanes = ORG_CONCURRENCY - lanes.size;
      let startedLanes = 0;
      if (freeLanes > 0) {
        const { data: claimed, error: claimError } = await supabase.rpc('claim_sequence_send_batch', {
          p_worker_id: WORKER_ID,
          p_max_orgs: freeLanes,
          p_per_org: PER_ORG_BATCH,
          p_lease_seconds: LEASE_SECONDS,
          p_exclude_org_ids: [...lanes.keys(), ...orgCooldownUntil.keys()],
        });

        if (claimError) {
          console.error('[Worker] Failed to claim enrollments:', claimError.message);
          stats.totalErrors++;
        } else {
          const byOrg = new Map<string, string[]>();
          for (const row of (claimed || []) as { enrollment_id: string; organization_id: string }[]) {
            const ids = byOrg.get(row.organization_id) || [];
            ids.push(row.enrollment_id);
            byOrg.set(row.organization_id, ids);
          }

          for (const [orgId, enrollmentIds] of byOrg) {
            if (lanes.has(orgId)) continue; // defensive: never two lanes for one org
            const lane = processOrgLane(supabase, orgId, enrollmentIds)
              .catch((err) => {
                console.error(`[Worker] Lane for org ${orgId} crashed:`, err);
                stats.totalErrors++;
              })
              .finally(async () => {
                const drained = enrollmentIds.length < PER_ORG_BATCH;
                orgCooldownUntil.set(orgId, Date.now() + (drained ? POLL_INTERVAL_MS : BUSY_ORG_COOLDOWN_MS));
                try {
                  await supabase.rpc('release_sequence_sender_org_leases', {
                    p_worker_id: WORKER_ID,
                    p_org_ids: [orgId],
                  });
                } catch (releaseErr) {
                  // The lease simply expires after LEASE_SECONDS.
                  console.error(`[Worker] Failed to release lease for org ${orgId}:`, releaseErr);
                }
                lanes.delete(orgId);
              });
            lanes.set(orgId, lane);
            startedLanes++;
          }
        }
      }

      stats.activeLanes = lanes.size;
      stats.isProcessing = lanes.size > 0;

      if (lanes.size === 0) {
        await sleep(POLL_INTERVAL_MS);
      } else if (startedLanes === 0) {
        // Nothing new to start: wait for a lane to free up, but re-check
        // regularly so a newly-due org gets a free lane without delay.
        await Promise.race([...lanes.values(), sleep(POLL_INTERVAL_MS)]);
      }
    } catch (error) {
      console.error('[Worker] Fatal cycle error:', error);
      stats.totalErrors++;
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // Graceful drain: lanes stop between enrollments once shutdownRequested is set,
  // so no send is cut off mid-flight. Then hand leases back so another machine
  // can pick these orgs up immediately instead of waiting for expiry.
  console.log(`[Worker] Draining ${lanes.size} active lane(s)...`);
  await Promise.allSettled([...lanes.values()]);
  try {
    await supabase.rpc('release_sequence_sender_org_leases', { p_worker_id: WORKER_ID, p_org_ids: null });
  } catch (releaseErr) {
    console.error('[Worker] Failed to release leases on shutdown:', releaseErr);
  }
  console.log('[Worker] Drained, exiting');
  process.exit(0);
}

async function runMaintenance(supabase: SupabaseClient): Promise<void> {
  // Daily counter reset (once per UTC day)
  const today = new Date().toISOString().split('T')[0];
  if (today !== stats.lastResetDate) {
    console.log(`[Worker] Resetting daily counters for ${today}...`);
    try {
      const resetCount = await resetDailyCounters(supabase);
      console.log(`[Worker] Reset daily counters for ${resetCount} mailboxes`);
    } catch (resetErr) {
      console.error('[Worker] Failed to reset daily counters (continuing):', resetErr);
    }
    stats.lastResetDate = today;
  }

  // Reaper: finalize rows orphaned in 'sending' by a prior cycle that threw
  // mid-send (a DB/network blip between the 'sending' insert and the finalize
  // update). Without this the row never resolves and — because the enrollment's
  // next_send_at was never advanced — the same lead is retried every cycle,
  // flooding email_send_log with duplicate 'sending' rows. We call a bounded
  // SQL function (FOR UPDATE SKIP LOCKED) in a loop so a large backlog can't
  // time out or deadlock; a 10-minute grace leaves in-flight sends untouched.
  try {
    // Small per-statement batch: a 10k-row UPDATE (plus index maintenance)
    // exceeds the DB role's statement_timeout under load. 2k stays well under
    // it; the loop still drains up to 200k/cycle, enough to clear any realistic
    // backlog within a couple of cycles.
    const REAP_BATCH = 2000;
    let totalReaped = 0;
    for (let i = 0; i < 100; i++) {
      const { data: reaped, error: reapErr } = await supabase.rpc(
        'reap_orphaned_sending_emails',
        { p_grace_minutes: 10, p_batch_limit: REAP_BATCH }
      );
      if (reapErr) {
        console.error('[Worker] Reaper RPC failed (continuing):', reapErr.message);
        break;
      }
      const n = (reaped as number) || 0;
      totalReaped += n;
      if (n < REAP_BATCH) break; // backlog drained
    }
    if (totalReaped > 0) {
      console.warn(`[Worker] Reaped ${totalReaped} orphaned 'sending' rows older than 10min`);
    }
  } catch (reapErr) {
    console.error('[Worker] Reaper failed (continuing):', reapErr);
  }
}

/**
 * Process one leased org's claimed enrollments, one at a time.
 *
 * The lease guarantees no other lane (on this or any machine) is processing
 * this org, and it is renewed before every enrollment. If renewal fails the
 * lease was lost (e.g. the lane stalled past LEASE_SECONDS and another worker
 * took the org), so we stop immediately rather than risk a double send.
 */
async function processOrgLane(
  supabase: SupabaseClient,
  laneOrgId: string,
  enrollmentIds: string[],
): Promise<void> {
  const laneStart = Date.now();
  const now = new Date();
  const nowISO = now.toISOString();

  // Re-read the claimed rows with the same filters the claim used: a row may
  // have been paused/advanced between the claim and this read.
  //
  // !inner on email_sequences is required: a plain embed returns the row with a
  // null sequence and the status filter matches nothing (verified against
  // PostgREST: a bad alias 400s rather than silently matching everything).
  // The claim only hands out enrollments of ACTIVE sequences, oldest due first,
  // which is what prevents the 2026-08-03 treadmill (97.6% of fetched rows were
  // skip-only rows of paused sequences) and FIFO starvation.
  const { data: fetched, error: fetchError } = await supabase
    .from('email_sequence_enrollments')
    .select(`
      id, sequence_id, lead_id, current_step, status,
      next_send_at, mailbox_id, variant_assignments, condition_waiting_since, custom_data, metadata,
      email_sequences:sequence_id!inner (
        id, organization_id, steps, settings, status, tracking_domain_id
      )
    `)
    .in('id', enrollmentIds)
    .eq('status', 'active')
    .eq('email_sequences.status', 'active')
    .lte('next_send_at', nowISO)
    .order('next_send_at', { ascending: true });

  if (fetchError) {
    console.error(`[Worker] Org ${laneOrgId}: failed to fetch claimed enrollments:`, fetchError.message);
    stats.totalErrors++;
    return;
  }

  const enrollments = (fetched || []) as any[];
  if (enrollments.length === 0) return;
  console.log(`[Worker] Org ${laneOrgId}: processing ${enrollments.length} due enrollment(s)`);

  // Sort: prioritize_new_leads puts step-0 enrollments first
  enrollments.sort((a: any, b: any) => {
    const aSettings = (a as any).email_sequences?.settings || {};
    const bSettings = (b as any).email_sequences?.settings || {};
    const aPrioritize = aSettings.prioritize_new_leads ? 1 : 0;
    const bPrioritize = bSettings.prioritize_new_leads ? 1 : 0;
    const aScore = aPrioritize && a.current_step === 0 ? 0 : 1;
    const bScore = bPrioritize && b.current_step === 0 ? 0 : 1;
    return aScore - bScore;
  });

  let sentCount = 0;
  let skippedCount = 0;
  let filteredCount = 0;
  let errorCount = 0;
  let graphSentCount = 0;       // M365 sends that went out over Graph
  let smtpFallbackCount = 0;    // M365 sends that fell back to SMTP (Graph unavailable)

  // Track daily sends per sequence for daily_limit enforcement
  const sequenceDailySends: Record<string, number> = {};
  const sequenceNewLeadsToday: Record<string, number> = {};
  const domainSendsToday: Record<string, number> = {};
  // Cache resolved tracking domain strings per tracking_domain_id
  const trackingDomainCache: Record<string, string | null> = {};
  // Cache the org's verified default tracking domain (fallback when a
  // sequence has no tracking_domain_id of its own). Keyed by organization_id.
  const orgDefaultTrackingDomainCache: Record<string, string | null> = {};
  // Cache whether a resolved tracking domain string is DNS-verified. Only a
  // verified domain may carry unsubscribe links. Keyed by "orgId:domain".
  const trackingDomainVerifiedCache: Record<string, boolean> = {};
  // Mailboxes that got disconnected mid-batch — skip remaining enrollments for them
  const disconnectedMailboxIds = new Set<string>();

  // Batch-fetch org-level custom field placeholder defaults (for {{custom_<key>}}
  // fallback when a lead has no value). Keyed by organization_id, merged with
  // per-sequence settings.variable_defaults at the substitution call site
  // (sequence-level default wins over the org-wide placeholder).
  const orgIds = [...new Set(
    enrollments.map((e: any) => e.email_sequences?.organization_id).filter(Boolean)
  )] as string[];
  const orgCustomFieldDefaultsMap = new Map<string, Record<string, string>>();
  if (orgIds.length > 0) {
    const { data: customFieldDefs } = await supabase
      .from('crm_custom_field_defs')
      .select('organization_id, field_key, default_value')
      .in('organization_id', orgIds)
      .not('default_value', 'is', null);
    for (const def of (customFieldDefs || [])) {
      const existing = orgCustomFieldDefaultsMap.get(def.organization_id) || {};
      existing[`custom_${def.field_key}`] = def.default_value;
      orgCustomFieldDefaultsMap.set(def.organization_id, existing);
    }
  }

  // Daily-cap slots held by sends still in flight. Parallel PostShiba sends
  // check `sent + in flight`, so running several at once can't overshoot a cap.
  const inFlight: Record<string, number> = {};

  // One enrollment, start to finish. `hold` reserves a daily-cap slot until the
  // enrollment finishes. Returns 'stop' when the lane must end (shutdown or
  // lease lost); every other early exit is a plain return.
  const processOne = async (enrollment: any, hold: (key: string) => void): Promise<'stop' | void> => {
    if (shutdownRequested) return 'stop';

    const stillLeased = await renewOrgLease(supabase, laneOrgId);
    if (!stillLeased) {
      console.warn(`[Worker] Org ${laneOrgId}: lease lost, stopping lane before enrollment ${enrollment.id}`);
      return 'stop';
    }

    // Tracks the send_log row opened in 'sending' this iteration so the catch
    // block can finalize it (instead of orphaning it) if anything throws
    // between the insert and the success/failure update.
    let openSendLogId: string | null = null;
    try {
      const sequence = (enrollment as any).email_sequences;
      console.log(`[Worker] Processing enrollment ${enrollment.id} step=${enrollment.current_step} sequence=${enrollment.sequence_id} hasSequence=${!!sequence} seqStatus=${sequence?.status}`);
      if (!sequence || sequence.status !== 'active') {
        console.log(`[Worker] SKIP ${enrollment.id}: sequence inactive or missing — deferring 1h`);
        // Defer instead of tight-looping: an active enrollment whose sequence is
        // draft/paused would otherwise be re-fetched every poll cycle forever.
        // Pushing next_send_at out lets it self-heal if the sequence goes active.
        await supabase
          .from('email_sequence_enrollments')
          .update({ next_send_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(), updated_at: nowISO })
          .eq('id', enrollment.id);
        skippedCount++;
        return;
      }

      const settings: SequenceSettings = applyDefaultSettings(sequence.settings || {});
      const steps: SequenceStep[] = sequence.steps || [];
      const organizationId = sequence.organization_id;

      // Resolve the mailbox pool for this sequence. In auto mode this
      // re-derives the pool from tags + health on every cycle (60s cache),
      // so mailboxes that recover, or that were added since the sequence was
      // built, get picked up without anyone reopening the picker.
      const pool = await resolveMailboxPool(supabase, organizationId, sequence.id, settings);
      const poolMailboxIds = pool.mailboxIds;
      if (pool.mode === 'auto' && pool.shortfall) {
        console.warn(
          `[Worker] Sequence ${sequence.id}: auto pool short by ${pool.shortfall}/day — ` +
          `${pool.eligibleCount} eligible mailbox(es) provide ${pool.capacity}/day. Tag more inboxes or raise their daily limits.`,
        );
      }

      // Check feature access
      const featureCheck = await checkFeatureAccess(supabase, organizationId, 'email_campaigns');
      if (!featureCheck.allowed) {
        console.log(`[Worker] SKIP ${enrollment.id}: feature not allowed (${featureCheck.reason})`);
        skippedCount++;
        return;
      }

      // Get current step
      let currentStep = steps.find((s: SequenceStep) => s.order === enrollment.current_step);

      if (!currentStep) {
        console.log(`[Worker] SKIP ${enrollment.id}: no step at order ${enrollment.current_step}`);
        await completeEnrollment(supabase, enrollment.id);
        skippedCount++;
        return;
      }

      // Advance past delay/condition steps
      let conditionWaiting = false;
      while (currentStep && currentStep.type !== 'email' && currentStep.type !== 'ab_test') {
        if (currentStep.type === 'delay') {
          const nextOrder: number = currentStep.order + 1;
          const nextStep: SequenceStep | undefined = steps.find((s: SequenceStep) => s.order === nextOrder);
          if (!nextStep) {
            await completeEnrollment(supabase, enrollment.id);
            currentStep = undefined as any;
            break;
          }

          // If this is the first step (order 0), the delay was NOT applied by a
          // prior advanceEnrollment call — we need to apply it now and defer.
          if (currentStep.order === 0) {
            const delayHours = currentStep.delay_hours || 0;
            if (delayHours > 0) {
              const delayedSendAt = new Date(Date.now() + delayHours * 60 * 60 * 1000);
              const adjustedSendAt = adjustToSendWindow(delayedSendAt, settings);
              await supabase
                .from('email_sequence_enrollments')
                .update({
                  current_step: nextOrder,
                  next_send_at: adjustedSendAt.toISOString(),
                  condition_waiting_since: null,
                  updated_at: nowISO,
                })
                .eq('id', enrollment.id);
              enrollment.current_step = nextOrder;
              currentStep = nextStep;
              console.log(`[Worker] Enrollment ${enrollment.id}: applied step-0 delay of ${delayHours}h, deferred to ${adjustedSendAt.toISOString()}`);
              conditionWaiting = true; // prevent sending this cycle
              break;
            }
          }

          // For non-first delay steps, the delay was already applied by the
          // previous advanceEnrollment call. Just skip past to the next step.
          await supabase
            .from('email_sequence_enrollments')
            .update({
              current_step: nextOrder,
              next_send_at: new Date(Date.now() + 60_000).toISOString(),
              condition_waiting_since: null,
              updated_at: nowISO,
            })
            .eq('id', enrollment.id);
          enrollment.current_step = nextOrder;
          currentStep = nextStep;
          console.log(`[Worker] Enrollment ${enrollment.id}: skipped past delay step ${nextOrder - 1}`);
          continue;
        } else if (currentStep.type === 'condition') {
          const conditionType = currentStep.condition_type || 'replied';
          const timeoutHours = currentStep.condition_timeout_hours || 48;

          const prevEmailStepOrder = findPreviousEmailStep(steps, currentStep.order);
          if (prevEmailStepOrder === null) {
            const nextOrder: number = currentStep.order + 1;
            const nextStep: SequenceStep | undefined = steps.find((s: SequenceStep) => s.order === nextOrder);
            if (!nextStep) {
              await completeEnrollment(supabase, enrollment.id);
              currentStep = undefined as any;
              break;
            }
            await supabase
              .from('email_sequence_enrollments')
              .update({ current_step: nextOrder, condition_waiting_since: null, updated_at: nowISO })
              .eq('id', enrollment.id);
            enrollment.current_step = nextOrder;
            currentStep = nextStep;
            continue;
          }

          const { data: prevSendLog } = await supabase
            .from('email_send_log')
            .select('id, status, opened_at, clicked_at, replied_at, bounced_at')
            .eq('sequence_id', sequence.id)
            .eq('lead_id', enrollment.lead_id)
            .eq('sequence_step', prevEmailStepOrder)
            .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied', 'bounced'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const conditionMet = isConditionMet(conditionType, prevSendLog);

          if (conditionMet) {
            const nextOrder: number = currentStep.order + 1;
            const nextStep: SequenceStep | undefined = steps.find((s: SequenceStep) => s.order === nextOrder);
            if (!nextStep) {
              await completeEnrollment(supabase, enrollment.id);
              currentStep = undefined as any;
              break;
            }
            await supabase
              .from('email_sequence_enrollments')
              .update({ current_step: nextOrder, condition_waiting_since: null, updated_at: nowISO })
              .eq('id', enrollment.id);
            enrollment.current_step = nextOrder;
            currentStep = nextStep;
            continue;
          }

          const waitingSince = enrollment.condition_waiting_since
            ? new Date(enrollment.condition_waiting_since)
            : null;

          if (!waitingSince) {
            await supabase
              .from('email_sequence_enrollments')
              .update({
                condition_waiting_since: nowISO,
                next_send_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
                updated_at: nowISO,
              })
              .eq('id', enrollment.id);
            conditionWaiting = true;
            break;
          }

          const elapsedHours = (now.getTime() - waitingSince.getTime()) / (1000 * 60 * 60);

          if (elapsedHours >= timeoutHours) {
            await supabase
              .from('email_sequence_enrollments')
              .update({
                status: 'completed',
                condition_waiting_since: null,
                next_send_at: null,
                updated_at: nowISO,
              })
              .eq('id', enrollment.id);
            currentStep = undefined as any;
            break;
          }

          // Check stop conditions while waiting
          const { data: stopReplies } = await supabase
            .from('email_send_log')
            .select('id, status')
            .eq('sequence_id', sequence.id)
            .eq('lead_id', enrollment.lead_id)
            .in('status', ['replied', 'bounced', 'spam'])
            .limit(1);

          if (stopReplies && stopReplies.length > 0 && settings.stop_on_reply !== false) {
            const replyStatus = stopReplies[0].status;
            await supabase
              .from('email_sequence_enrollments')
              .update({ status: replyStatus, condition_waiting_since: null, next_send_at: null, updated_at: nowISO })
              .eq('id', enrollment.id);
            currentStep = undefined as any;
            break;
          }

          await supabase
            .from('email_sequence_enrollments')
            .update({
              next_send_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
              updated_at: nowISO,
            })
            .eq('id', enrollment.id);
          conditionWaiting = true;
          break;
        } else {
          break;
        }
      }

      if (conditionWaiting || !currentStep || (currentStep.type !== 'email' && currentStep.type !== 'ab_test')) {
        console.log(`[Worker] SKIP ${enrollment.id}: condition waiting or non-email step (type=${currentStep?.type}, conditionWaiting=${conditionWaiting})`);
        skippedCount++;
        return;
      }

      // ========================================
      // Guard checks
      // ========================================

      // Weekend check must run BEFORE business hours so we always reschedule to Monday
      if (isWeekend(now, settings)) {
        const nextMonday = getNextMonday(now, settings);
        await updateNextSend(supabase, enrollment.id, nextMonday);
        console.log(`[Worker] SKIP ${enrollment.id}: weekend, rescheduled to ${nextMonday}`);
        skippedCount++;
        return;
      }

      if (!isWithinBusinessHours(now, settings, enrollment.mailbox_id || undefined)) {
        const nextWindow = adjustToSendWindow(
          new Date(now.getTime() + 60_000),
          settings,
          getMailboxStartOffsetMinutes(settings, enrollment.mailbox_id || undefined),
        );
        await updateNextSend(supabase, enrollment.id, nextWindow.toISOString());
        console.log(`[Worker] SKIP ${enrollment.id}: outside business hours, rescheduled to ${nextWindow.toISOString()}`);
        skippedCount++;
        return;
      }

      if (settings.daily_limit) {
        const seqKey = sequence.id;
        if (!sequenceDailySends[seqKey]) {
          sequenceDailySends[seqKey] = await countSequenceSendsToday(supabase, sequence.id);
        }
        if (sequenceDailySends[seqKey] + (inFlight[`seq:${seqKey}`] || 0) >= settings.daily_limit) {
          const tomorrow = adjustToSendWindow(new Date(now.getTime() + 24 * 3_600_000), settings);
          await updateNextSend(supabase, enrollment.id, tomorrow.toISOString());
          console.log(`[Worker] SKIP ${enrollment.id}: daily limit reached (${sequenceDailySends[seqKey]}/${settings.daily_limit}), rescheduled to ${tomorrow.toISOString()}`);
          skippedCount++;
          return;
        }
        hold(`seq:${seqKey}`);
      }

      if (settings.max_new_leads_per_day != null && enrollment.current_step === 0) {
        const seqKey = `new_${sequence.id}`;
        if (!sequenceNewLeadsToday[seqKey]) {
          sequenceNewLeadsToday[seqKey] = await countNewLeadsSendsToday(supabase, sequence.id);
        }
        if (sequenceNewLeadsToday[seqKey] + (inFlight[`seq:${seqKey}`] || 0) >= settings.max_new_leads_per_day) {
          const tomorrow = adjustToSendWindow(new Date(now.getTime() + 24 * 3_600_000), settings);
          await updateNextSend(supabase, enrollment.id, tomorrow.toISOString());
          console.log(`[Worker] SKIP ${enrollment.id}: max new leads/day reached (${sequenceNewLeadsToday[seqKey]}/${settings.max_new_leads_per_day}), rescheduled to ${tomorrow.toISOString()}`);
          skippedCount++;
          return;
        }
        hold(`seq:${seqKey}`);
      }

      // Load lead data
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('*, assigned_mailbox_id, last_sequence_email_at')
        .eq('id', enrollment.lead_id)
        .single();

      if (leadError || !lead) {
        errorCount++;
        return;
      }

      // Hard unsubscribe / suppression guard (PECR).
      // The unsubscribe cascade only flips enrollments it can match by
      // lead_id, so a re-enrolled contact, a duplicate lead_id, or a status
      // set outside the cascade (manual/bulk edit, CSV import) leaves an
      // active enrollment pointing at a suppressed contact. This guard is
      // independent of the opt-in AI filter and re-reads the CRM contact.
      if (lead.source === 'crm_contact' && lead.source_id) {
        const { data: contactStatus } = await supabase
          .from('crm_contacts')
          .select('status')
          .eq('id', lead.source_id)
          .maybeSingle();
        if (contactStatus && SUPPRESSED_CONTACT_STATUSES.has(contactStatus.status)) {
          await supabase.from('email_send_log').insert({
            organization_id: organizationId,
            mailbox_id: enrollment.mailbox_id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: 'filtered',
            error_message: `contact_${contactStatus.status}`,
            created_at: nowISO,
          });
          await supabase
            .from('email_sequence_enrollments')
            .update({ status: 'unsubscribed', updated_at: nowISO })
            .eq('id', enrollment.id);
          console.log(`[Worker] SUPPRESS ${enrollment.id}: contact ${lead.source_id} status=${contactStatus.status}`);
          filteredCount++;
          return;
        }
      }

      // Risky email filter
      if (!settings.allow_risky_emails) {
        let emailStatus = lead.email_status || 'unknown';

        if (emailStatus === 'unknown' && lead.source === 'crm_contact' && lead.source_id) {
          const { data: contactEnrichment } = await supabase
            .from('crm_contacts')
            .select('enrichment_data')
            .eq('id', lead.source_id)
            .maybeSingle();

          if (contactEnrichment?.enrichment_data) {
            const enrichment = contactEnrichment.enrichment_data as Record<string, any>;
            if (enrichment.email_status) {
              emailStatus = deriveEmailStatus(enrichment.email_status);
            } else if (enrichment.emailConfidence != null) {
              emailStatus = emailStatusFromConfidence(Number(enrichment.emailConfidence));
            }

            if (emailStatus !== 'unknown') {
              await supabase
                .from('leads')
                .update({ email_status: emailStatus })
                .eq('id', enrollment.lead_id);
            }
          }
        }

        if (emailStatus === 'invalid' || emailStatus === 'risky' || emailStatus === 'bounced') {
          await supabase.from('email_send_log').insert({
            organization_id: organizationId,
            mailbox_id: enrollment.mailbox_id,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: 'filtered',
            error_message: `email_status_${emailStatus}`,
            created_at: nowISO,
          });
          await advanceEnrollment(supabase, enrollment, steps, settings);
          filteredCount++;
          return;
        }
      }

      // Cross-sequence throttle
      if (lead.last_sequence_email_at) {
        const hoursSinceLastEmail = (now.getTime() - new Date(lead.last_sequence_email_at).getTime()) / 3_600_000;
        if (hoursSinceLastEmail < 24) {
          const tomorrow = adjustToSendWindow(new Date(now.getTime() + 24 * 3_600_000), settings);
          await updateNextSend(supabase, enrollment.id, tomorrow.toISOString());
          console.log(`[Worker] SKIP ${enrollment.id}: cross-sequence throttle, rescheduled to ${tomorrow.toISOString()}`);
          skippedCount++;
          return;
        }
      }

      // Domain limiter
      if (settings.limit_per_company_domain != null) {
        const domain = lead.email?.split('@')[1]?.toLowerCase();
        if (domain) {
          if (!domainSendsToday[domain]) {
            domainSendsToday[domain] = await countDomainSendsToday(supabase, organizationId, domain);
          }
          if (domainSendsToday[domain] >= settings.limit_per_company_domain) {
            const tomorrow = adjustToSendWindow(new Date(now.getTime() + 24 * 3_600_000), settings);
            await updateNextSend(supabase, enrollment.id, tomorrow.toISOString());
            console.log(`[Worker] SKIP ${enrollment.id}: domain limit reached for ${domain}, rescheduled to ${tomorrow.toISOString()}`);
            skippedCount++;
            return;
          }
        }
      }

      // AI filtering
      const aiSettings: Partial<AIFilterSettings> = {
        ai_filter_unlikely_reply: settings.ai_filter_unlikely_reply,
        ai_filter_hostile: settings.ai_filter_hostile,
      };
      const filterResult = await applyAIFilters(supabase, lead, organizationId, aiSettings);
      if (filterResult.action === 'skip') {
        await supabase.from('email_send_log').insert({
          organization_id: organizationId,
          mailbox_id: enrollment.mailbox_id,
          sequence_id: sequence.id,
          sequence_step: enrollment.current_step,
          lead_id: enrollment.lead_id,
          recipient_email: lead.email,
          status: 'filtered',
          error_message: filterResult.reason,
          created_at: nowISO,
        });
        await advanceEnrollment(supabase, enrollment, steps, settings);
        filteredCount++;
        return;
      }

      // Re-verify enrollment is still active (IMAP poller may have updated it since batch fetch)
      const { data: freshStatus } = await supabase
        .from('email_sequence_enrollments')
        .select('status')
        .eq('id', enrollment.id)
        .single();

      if (freshStatus && freshStatus.status !== 'active') {
        console.log(`[Sequence Sender] Enrollment ${enrollment.id} no longer active (${freshStatus.status}), skipping`);
        skippedCount++;
        return;
      }

      // Stop conditions
      const { data: existingReplies } = await supabase
        .from('email_send_log')
        .select('id, status')
        .eq('sequence_id', sequence.id)
        .eq('lead_id', enrollment.lead_id)
        .in('status', ['replied', 'bounced', 'spam'])
        // A domain-reputation refusal is not a recipient bounce — the
        // address is fine, our sending domain was refused. Reconciliation
        // now records those as 'blocked' so they never reach this filter,
        // but legacy rows written as 'bounced' before that change would
        // still suppress a good lead forever. Belt and braces.
        //
        // .or(...is.null,...) rather than .neq: in SQL, NULL <> 'x' is NULL,
        // so a bare .neq would silently drop every genuine bounce (they
        // carry no error_category) and disable the stop condition entirely.
        .or('error_category.is.null,error_category.neq.reputation_block')
        .limit(1);

      if (existingReplies && existingReplies.length > 0) {
        const replyStatus = existingReplies[0].status;
        await supabase
          .from('email_sequence_enrollments')
          .update({ status: replyStatus, updated_at: nowISO })
          .eq('id', enrollment.id);
        skippedCount++;
        return;
      }

      // Company-level stop
      if (settings.stop_company_on_reply) {
        const companyDomain = lead.email?.split('@')[1]?.toLowerCase();
        if (companyDomain) {
          const companyReplied = await checkCompanyReplied(supabase, sequence.id, companyDomain);
          if (companyReplied) {
            await supabase
              .from('email_sequence_enrollments')
              .update({ status: 'paused', updated_at: nowISO })
              .eq('id', enrollment.id);
            skippedCount++;
            return;
          }
        }
      }

      // ========================================
      // Mailbox selection
      // ========================================

      let mailboxId = enrollment.mailbox_id;
      let mailbox: any = null;

      // Continuation enrollments (interested-reply follow-ups, MCP/agent enrolls) must keep
      // the SAME mailbox + thread the prospect already replied to. When an anchor resolves,
      // the thread mailbox is authoritative — we wait for it rather than rotate to a stranger.
      const continuation = await resolveContinuationAnchor(supabase, enrollment, organizationId);
      if (continuation) {
        mailboxId = continuation.mailboxId;
      }

      // Skip enrollments assigned to mailboxes that disconnected during this batch
      if (mailboxId && disconnectedMailboxIds.has(mailboxId)) {
        skippedCount++;
        return;
      }

      // Pre-compute recipient provider for provider matching checks
      const recipientProvider = settings.provider_matching ? getProviderFromRecipient(lead.email) : null;

      // Continuation: bind to the thread's mailbox; never rotate to a different sender.
      // On success sets `mailbox`, so the rotation tiers below short-circuit via their guards.
      if (continuation) {
        const { data: pinned } = await supabase
          .from('email_mailboxes')
          .select('id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate')
          .eq('id', mailboxId)
          .eq('status', 'ready')
          .eq('imap_connected', true)
          .maybeSingle();

        const pinnedLimit = pinned
          ? ((settings.hypersend_mode && pinned.health_score > 0.80 && (pinned.bounce_rate ?? 0) < 0.05)
              ? pinned.daily_limit * 3
              : pinned.daily_limit)
          : 0;

        if (pinned && pinned.daily_sent < pinnedLimit) {
          mailbox = pinned;
          if (enrollment.mailbox_id !== pinned.id) {
            await supabase
              .from('email_sequence_enrollments')
              .update({ mailbox_id: pinned.id, updated_at: nowISO })
              .eq('id', enrollment.id);
          }
        } else if (pinned) {
          // Healthy but at its daily cap — wait for tomorrow's window rather than switching inbox.
          const tomorrow = adjustToSendWindow(new Date(now.getTime() + 24 * 3_600_000), settings);
          await updateNextSend(supabase, enrollment.id, tomorrow.toISOString());
          console.log(`[Worker] WAIT ${enrollment.id}: continuation mailbox at daily cap, rescheduled to ${tomorrow.toISOString()}`);
          skippedCount++;
          return;
        } else {
          // Paused/disconnected/missing — back off; after 5 strikes mark terminal so it
          // surfaces in the UI instead of silently switching senders mid-thread.
          const priorSkips = ((enrollment.custom_data as any)?.no_mailbox_skips as number) ?? 0;
          const skips = priorSkips + 1;
          if (skips >= 5) {
            await supabase
              .from('email_sequence_enrollments')
              .update({ status: 'sender_disconnected', updated_at: nowISO })
              .eq('id', enrollment.id);
            await supabase.from('email_send_log').insert({
              organization_id: organizationId,
              mailbox_id: mailboxId,
              sequence_id: sequence.id,
              sequence_step: enrollment.current_step,
              lead_id: enrollment.lead_id,
              recipient_email: lead.email,
              status: 'skipped',
              error_message: 'continuation_sender_unavailable',
              created_at: nowISO,
            });
            console.log(`[Worker] ${enrollment.id}: continuation mailbox ${mailboxId} unavailable x${skips} → sender_disconnected`);
            skippedCount++;
            return;
          }
          const backoffMin = Math.min(30 * Math.pow(2, Math.min(priorSkips, 4)), 360);
          const retryTime = adjustToSendWindow(new Date(now.getTime() + backoffMin * 60_000), settings);
          await supabase
            .from('email_sequence_enrollments')
            .update({
              next_send_at: retryTime.toISOString(),
              custom_data: { ...((enrollment.custom_data as Record<string, any>) || {}), no_mailbox_skips: skips },
              updated_at: nowISO,
            })
            .eq('id', enrollment.id);
          console.log(`[Worker] WAIT ${enrollment.id}: continuation mailbox ${mailboxId} unavailable (skip #${skips}), backed off ${backoffMin}min`);
          skippedCount++;
          return;
        }
      }

      // 1. Global lead-to-mailbox assignment
      if (!mailboxId && lead.assigned_mailbox_id) {
        const { data: globalMailbox } = await supabase
          .from('email_mailboxes')
          .select('id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate, warmup_enabled, warmup_day')
          .eq('id', lead.assigned_mailbox_id)
          .eq('status', 'ready')
          .eq('imap_connected', true)
          .single();

        if (globalMailbox && isMailboxStillWarming(globalMailbox)) {
          // Pre-assigned while still warming (e.g. enrolled before the
          // warmup exclusion) — fall through to rotation for a graduated
          // inbox rather than putting campaign traffic on a warming one.
          console.log(`[Worker] Global assignment ${globalMailbox.id} still warming — falling through to rotation`);
        } else if (globalMailbox) {
          // Provider matching override: skip global assignment if provider doesn't match
          if (recipientProvider && globalMailbox.provider && globalMailbox.provider !== recipientProvider) {
            console.log(`[Worker] Provider mismatch on global assignment: mailbox=${globalMailbox.provider}, recipient=${recipientProvider} — falling through to rotation`);
            mailboxId = null;
          } else {
            const effectiveLimit = (settings.hypersend_mode && globalMailbox.health_score > 0.80 && (globalMailbox.bounce_rate ?? 0) < 0.05)
              ? globalMailbox.daily_limit * 3
              : globalMailbox.daily_limit;

            if (globalMailbox.daily_sent < effectiveLimit) {
              mailbox = globalMailbox;
              mailboxId = globalMailbox.id;
              await supabase
                .from('email_sequence_enrollments')
                .update({ mailbox_id: mailbox.id, updated_at: nowISO })
                .eq('id', enrollment.id);
            }
          }
        }
      }

      // 2. Enrollment-level sticky mailbox
      if (mailboxId && !mailbox) {
        const { data: stickyMailbox } = await supabase
          .from('email_mailboxes')
          .select('id, email_address, provider, health_score, daily_sent, daily_limit, last_send_at, metadata, status, connection_type, display_name, first_name, last_name, bounce_rate, warmup_enabled, warmup_day')
          .eq('id', mailboxId)
          .eq('status', 'ready')
          .eq('imap_connected', true)
          .single();

        if (stickyMailbox && isMailboxStillWarming(stickyMailbox)) {
          // Sticky to a mailbox that hasn't graduated warmup — drop the
          // stickiness and rotate onto a graduated inbox instead.
          console.log(`[Worker] Sticky mailbox ${stickyMailbox.id} still warming — falling through to rotation`);
          mailboxId = null;
        } else if (stickyMailbox) {
          // Provider matching override: skip sticky if provider doesn't match
          if (recipientProvider && stickyMailbox.provider && stickyMailbox.provider !== recipientProvider) {
            console.log(`[Worker] Provider mismatch on sticky mailbox: mailbox=${stickyMailbox.provider}, recipient=${recipientProvider} — falling through to rotation`);
            mailboxId = null;
          } else {
            const effectiveLimit = (settings.hypersend_mode && stickyMailbox.health_score > 0.80 && (stickyMailbox.bounce_rate ?? 0) < 0.05)
              ? stickyMailbox.daily_limit * 3
              : stickyMailbox.daily_limit;

            if (stickyMailbox.daily_sent < effectiveLimit) {
              mailbox = stickyMailbox;
            } else {
              mailboxId = null;
            }
          }
        } else {
          mailboxId = null;
        }
      }

      // 3. Fresh rotation
      if (!mailboxId) {
        const hasAdvancedFeatures = settings.sisr_enabled
          || settings.hypersend_mode
          || (settings.esp_routing_rules && settings.esp_routing_rules.length > 0)
          || settings.provider_matching;

        if (hasAdvancedFeatures) {
          mailbox = await selectMailboxAdvanced(supabase, {
            organizationId,
            recipientEmail: lead.email,
            mailboxIds: poolMailboxIds ?? undefined,
            providerMatching: settings.provider_matching,
            espRoutingRules: settings.esp_routing_rules,
            sisrEnabled: settings.sisr_enabled,
            hypersendMode: settings.hypersend_mode,
            leadId: enrollment.lead_id,
          });
        } else {
          mailbox = await selectMailbox(supabase, organizationId, {
            mailboxIds: poolMailboxIds,
          });
        }

        if (!mailbox) {
          // Tell a genuinely empty/disconnected pool (actionable: the user must
          // connect or assign a mailbox) apart from a pool that's merely
          // throttled right now (transient: all mailboxes over daily limit /
          // health-filtered). Surfaces a precise reason to the UI.
          const readyCount = await countReadyMailboxes(supabase, organizationId, poolMailboxIds);
          // In auto mode an empty pool means the tag rule matched nothing —
          // that is a configuration problem, not a throttled fleet, and it
          // needs a distinct reason so the UI can say which one it is.
          const reason = pool.mode === 'auto' && pool.eligibleCount === 0
            ? 'no_mailbox_matches_rule'
            : readyCount === 0 ? 'assigned_mailbox_missing' : 'no_mailbox_available';

          // Escalating backoff (30m → cap 6h) keyed on consecutive skips, so a
          // persistently-stuck enrollment stops re-spinning (and re-logging)
          // every 30 min forever. The enrollment stays active and auto-heals
          // the moment a mailbox becomes available — no manual resume needed.
          const priorSkips = ((enrollment.custom_data as any)?.no_mailbox_skips as number) ?? 0;
          const skips = priorSkips + 1;
          // A PostShiba-only pool that is ready but unavailable is out of daily
          // volume: capacity returns tomorrow, so wait for the next send day
          // rather than retrying every 30 min to 6 h.
          const postshibaOutOfVolume = postshibaSequences.has(sequence.id) && reason === 'no_mailbox_available';
          const backoffMin = postshibaOutOfVolume ? 24 * 60 : Math.min(30 * Math.pow(2, Math.min(priorSkips, 4)), 360);
          const retryTime = adjustToSendWindow(new Date(now.getTime() + backoffMin * 60_000), settings);
          await supabase
            .from('email_sequence_enrollments')
            .update({
              next_send_at: retryTime.toISOString(),
              custom_data: { ...((enrollment.custom_data as Record<string, any>) || {}), no_mailbox_skips: skips },
              updated_at: nowISO,
            })
            .eq('id', enrollment.id);
          console.log(`[Worker] SKIP ${enrollment.id}: ${reason} (skip #${skips}), backed off ${backoffMin}min to ${retryTime.toISOString()}`);
          await supabase.from('email_send_log').insert({
            organization_id: organizationId,
            sequence_id: sequence.id,
            sequence_step: enrollment.current_step,
            lead_id: enrollment.lead_id,
            recipient_email: lead.email,
            status: 'skipped',
            error_message: reason,
            created_at: nowISO,
          });
          skippedCount++;
          return;
        }

        await supabase
          .from('email_sequence_enrollments')
          .update({ mailbox_id: mailbox.id, updated_at: nowISO })
          .eq('id', enrollment.id);

        await supabase
          .from('leads')
          .update({ assigned_mailbox_id: mailbox.id, updated_at: nowISO })
          .eq('id', enrollment.lead_id);
      }

      // Clear the no-mailbox backoff counter now that a mailbox resolved, so
      // a recovered pool doesn't keep its escalated backoff on the next step.
      if (((enrollment.custom_data as any)?.no_mailbox_skips as number) > 0) {
        const { no_mailbox_skips, ...restCustomData } = (enrollment.custom_data as Record<string, any>) || {};
        await supabase
          .from('email_sequence_enrollments')
          .update({ custom_data: restCustomData, updated_at: nowISO })
          .eq('id', enrollment.id);
      }

      // ========================================
      // Prepare and send email
      // ========================================

      // Resolve A/B variant
      let subject = currentStep.subject || '';
      let body = currentStep.body || '';
      let variantId: string | null = null;

      if (currentStep.variants && currentStep.variants.length > 0) {
        const variant = await resolveVariant(supabase, enrollment, currentStep, sequence.id, settings);
        subject = variant.subject;
        body = variant.body;
        variantId = variant.variantId || null;

        if (variant.isNewAssignment && variant.variantId) {
          const assignments = enrollment.variant_assignments || {};
          const stepKey = String(currentStep.order);
          await supabase
            .from('email_sequence_enrollments')
            .update({
              variant_assignments: { ...assignments, [stepKey]: variant.variantId },
              updated_at: nowISO,
            })
            .eq('id', enrollment.id);
        }
      }

      // Enrich lead with CRM contact data
      const enrichedLead = await enrichLeadWithCrmData(supabase, lead);

      // Variable substitution
      const customData = (enrollment as any).custom_data || {};
      const mailboxSenderName = (mailbox?.display_name as string) || '';
      // Prefer the dedicated first_name/last_name columns; fall back to splitting the
      // display name on the first space (composed last names stay intact).
      const mailboxContext = {
        signature: (mailbox?.metadata as any)?.signature || '',
        senderName: mailboxSenderName,
        senderFirstName: (mailbox?.first_name as string) || mailboxSenderName.split(' ')[0] || '',
        senderLastName: (mailbox?.last_name as string) || mailboxSenderName.split(' ').slice(1).join(' ') || '',
      };
      const orgCustomFieldDefaults = orgCustomFieldDefaultsMap.get(organizationId) || {};
      const variableDefaults = { ...orgCustomFieldDefaults, ...(settings.variable_defaults || {}) };
      const unresolvedTokens = new Set<string>();
      subject = substituteVariables(subject, enrichedLead, enrollment.id, customData, mailboxContext, variableDefaults, unresolvedTokens);
      body = substituteVariables(body, enrichedLead, enrollment.id, customData, mailboxContext, variableDefaults, unresolvedTokens);

      // Re: threading
      let inReplyTo: string | undefined;
      let emailReferences: string[] | undefined;

      if (continuation) {
        // Continuation: thread onto the original conversation on every step, overriding the
        // step's own subject so it lands in the same thread the prospect replied to.
        const base = (continuation.subject || '').replace(/^Re:\s*/i, '');
        if (base) subject = `Re: ${base}`;
        if (continuation.inReplyTo) {
          inReplyTo = continuation.inReplyTo;
          emailReferences = continuation.references && continuation.references.length > 0
            ? continuation.references
            : [continuation.inReplyTo];
        }
      } else if (!subject && enrollment.current_step > 0) {
        const { data: prevSend } = await supabase
          .from('email_send_log')
          .select('subject, email_message_id, email_in_reply_to, email_references')
          .eq('sequence_id', sequence.id)
          .eq('lead_id', enrollment.lead_id)
          .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (prevSend) {
          const prevSubject = (prevSend.subject || '').replace(/^Re:\s*/i, '');
          subject = prevSubject ? `Re: ${prevSubject}` : '';

          if (prevSend.email_message_id) {
            inReplyTo = prevSend.email_message_id;
            const prevRefs: string[] = prevSend.email_references || [];
            emailReferences = [...prevRefs, prevSend.email_message_id];
          }
        }
      }

      // ============================================================
      // Guard: never send an email whose contact variables could not resolve.
      // ============================================================
      // substituteVariables() resolves an unknown {{var}} to '' (step 6), so a
      // token that cannot be filled no longer leaks as raw braces -- it turns
      // into a hole in the sentence. That is still a wrong email: a step
      // reading "You're on . Want me to send the 3 things?" is worse than no
      // email, and it is invisible in the send log because the send succeeds.
      //
      // This happened for real. The `Local reviews · leader v2` sequence was
      // copied from the GAP sequence and kept its step 0 verbatim:
      //
      //   {{custom_competitor}} is sitting on {{custom_number_comp_reviews}}
      //   Google reviews. You're on {{custom_number_own_reviews}}.
      //
      // A LEADER row is one with no rival by definition -- the enrichment
      // writes `angle=leader` and deliberately writes no `competitor` and no
      // `number_comp_reviews` -- so both tokens were unresolvable for every
      // contact in that bucket while `number_own_reviews` resolved fine. A
      // real prospect received copy with a hole where the competitor belonged.
      //
      // All the fields ARE registered in crm_custom_field_defs, so a registry
      // check would NOT have caught this. The fields are registered; the
      // bucket simply has no value for them, and only 1 of the 33 registered
      // fields carries a default_value, so there is no fallback either.
      // Catching it requires asking "does THIS contact have THIS value".
      //
      // Fails closed, same as the blank-body guard below: pause the
      // enrollment rather than looping on it every tick, and record which
      // tokens were missing so the operator can see the cause. Deliberately
      // does not invent a value -- a fabricated competitor name in a real
      // prospect's inbox is worse than a held send.
      // Mailbox-supplied variables legitimately resolve to '' when the mailbox
      // has no signature block or display name. That is an existing,
      // acceptable degradation -- the email still reads correctly, it just has
      // no sign-off. Holding on it would pause every enrollment in the org, so
      // their early-return branches never reach the fallback collector.
      // Capture fallback names during substitution: scanning rendered text
      // cannot detect tokens that step 6 has already erased.
      const unresolved = [...unresolvedTokens];
      if (unresolved.length > 0) {
        console.error(
          `[Worker] Unresolved ${unresolved.length} token(s) ${unresolved.map((t) => `{{${t}}}`).join(', ')} for enrollment ${enrollment.id} (step ${enrollment.current_step}) — pausing instead of sending`,
        );
        await supabase
          .from('email_sequence_enrollments')
          .update({
            status: 'paused',
            metadata: {
              ...((enrollment as any).metadata || {}),
              blocked_reason: 'unresolved_variable',
              blocked_at: nowISO,
              blocked_detail: `unresolved: ${unresolved.join(', ')}`,
            },
            updated_at: nowISO,
          })
          .eq('id', enrollment.id);
        await supabase.from('email_send_log').insert({
          organization_id: organizationId,
          mailbox_id: mailbox.id,
          sequence_id: sequence.id,
          sequence_step: enrollment.current_step,
          lead_id: enrollment.lead_id,
          recipient_email: lead.email,
          status: 'filtered',
          error_message: `unresolved_variable: ${unresolved.slice(0, 5).join(', ')}`,
          created_at: nowISO,
        });
        errorCount++;
        return;
      }

      // ============================================================
      // Guard: never send a blank email.
      // ============================================================
      // substituteVariables() resolves an unknown {{var}} to '' by design, so
      // a step written entirely out of per-contact variables
      // ({{email_subject_1}} / {{email_body_1}}) renders to NOTHING when the
      // enrollment carries no custom_data — e.g. a lead pulled in by the
      // auto-enroll cron rather than by lead processing, which is the only
      // path that writes that content. On 2026-08-06 that sent 61 empty
      // emails (23 bounced) before anyone noticed.
      //
      // Fails closed: pause the enrollment rather than looping on it every
      // tick, and record why so the UI/operator can see it.
      // Mirrors the same guard in supabase/functions/email-sequence-processor.
      const bodyText = body
        .replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .trim();
      if (!subject.trim() || !bodyText) {
        console.error(
          `[Worker] Blank ${!subject.trim() ? 'subject' : ''}${!subject.trim() && !bodyText ? ' and ' : ''}${!bodyText ? 'body' : ''} for enrollment ${enrollment.id} (step ${enrollment.current_step}) — pausing instead of sending`,
        );
        await supabase
          .from('email_sequence_enrollments')
          .update({
            status: 'paused',
            metadata: {
              ...((enrollment as any).metadata || {}),
              blocked_reason: 'missing_content',
              blocked_at: nowISO,
              blocked_detail: !subject.trim() && !bodyText
                ? 'subject and body rendered empty'
                : (!subject.trim() ? 'subject rendered empty' : 'body rendered empty'),
            },
            updated_at: nowISO,
          })
          .eq('id', enrollment.id);
        errorCount++;
        return;
      }

      // Create send_log entry
      const { data: sendLog, error: logError } = await supabase
        .from('email_send_log')
        .insert({
          organization_id: organizationId,
          mailbox_id: mailbox.id,
          campaign_id: null,
          lead_id: enrollment.lead_id,
          sequence_id: sequence.id,
          sequence_step: enrollment.current_step,
          variant_id: variantId,
          recipient_email: lead.email,
          subject,
          body,
          status: 'sending',
          created_at: nowISO,
        })
        .select('id')
        .single();

      if (logError || !sendLog) {
        errorCount++;
        return;
      }
      openSendLogId = sendLog.id;

      // Resolve tracking domain from email_tracking_domains table
      const tdId = sequence.tracking_domain_id;
      let trackingDomain: string | null = null;
      if (tdId) {
        if (tdId in trackingDomainCache) {
          trackingDomain = trackingDomainCache[tdId];
        } else {
          const { data: tdRow } = await supabase
            .from('email_tracking_domains')
            .select('domain')
            .eq('id', tdId)
            .single();
          trackingDomain = tdRow?.domain || null;
          trackingDomainCache[tdId] = trackingDomain;
        }
      }

      // Backward compat: fall back to deprecated custom_tracking_domain in settings
      if (!trackingDomain && settings.custom_tracking_domain) {
        trackingDomain = settings.custom_tracking_domain;
        console.warn(`[Worker] Sequence ${sequence.id}: using deprecated custom_tracking_domain from settings — migrate to tracking domains table`);
      }

      // Fallback: a sequence with no tracking_domain_id of its own should use
      // the org's verified DEFAULT tracking domain rather than failing to send.
      // Without this, one sequence saved without picking a domain silently
      // stalls every enrollment on `missing_tracking_domain` even though the
      // org has a perfectly good verified domain (observed: Acquist OÜ).
      if (!trackingDomain) {
        if (organizationId in orgDefaultTrackingDomainCache) {
          trackingDomain = orgDefaultTrackingDomainCache[organizationId];
        } else {
          // Prefer a verified default domain.
          const { data: defTd } = await supabase
            .from('email_tracking_domains')
            .select('domain')
            .eq('organization_id', organizationId)
            .eq('is_verified', true)
            .eq('is_default', true)
            .limit(1)
            .maybeSingle();
          let resolved = defTd?.domain || null;
          // If no verified domain exists yet, fall back to the org's default
          // domain even when unverified rather than stalling every enrollment
          // on `missing_tracking_domain` for weeks (observed: ffbe.com, whose
          // default trk.ffbe.com sat unverified, silently killing a sequence
          // for 24 days). Tracking links may not resolve until DNS is verified,
          // but sending beats silent death — and the warning surfaces the gap.
          if (!resolved) {
            const { data: anyDefTd } = await supabase
              .from('email_tracking_domains')
              .select('domain')
              .eq('organization_id', organizationId)
              .eq('is_default', true)
              .limit(1)
              .maybeSingle();
            if (anyDefTd?.domain) {
              resolved = anyDefTd.domain;
              console.warn(`[Worker] Sequence ${sequence.id}: org has no VERIFIED tracking domain — falling back to UNVERIFIED default ${resolved}; verify its DNS so tracking links resolve`);
            }
          }
          trackingDomain = resolved;
          orgDefaultTrackingDomainCache[organizationId] = trackingDomain;
        }
        if (trackingDomain) {
          console.warn(`[Worker] Sequence ${sequence.id}: no tracking_domain_id set — falling back to org default tracking domain`);
        }
      }

      if (!trackingDomain) {
        console.error(`[Worker] No tracking domain for sequence ${sequence.id} — skipping send`);
        await supabase
          .from('email_send_log')
          .update({ status: 'skipped', error_message: 'missing_tracking_domain' })
          .eq('id', sendLog.id);
        skippedCount++;
        return;
      }

      // Unsubscribe URL — Smartlead/Instantly shape: https://<domain>/u/<send-log-id>.
      // The send log's random v4 UUID IS the token: 122 bits of unguessable
      // entropy, already written, and it resolves to org + lead server-side, so
      // there is nothing to sign and no long HMAC blob in the link. (The endpoint
      // still verifies legacy HMAC tokens for mail already in flight.)
      //
      // Host: prefer the org's own tracking domain, and only a VERIFIED one —
      // trackingDomain above may be an unverified fallback (deliberately, so sends
      // don't stall), survivable for click tracking but not for opt-out. Otherwise
      // ACA's proxy host, never SUPABASE_URL: every verified tracking domain CNAMEs
      // to that same proxy, so both branches serve the identical short path and a
      // recipient never sees "…supabase.co/functions/v1/…" in a cold email.
      const unsubToken = sendLog.id;
      const verifiedCacheKey = `${organizationId}:${trackingDomain}`;
      if (!(verifiedCacheKey in trackingDomainVerifiedCache)) {
        const { data: tdVerified } = await supabase
          .from('email_tracking_domains')
          .select('is_verified')
          .eq('organization_id', organizationId)
          .eq('domain', trackingDomain)
          .maybeSingle();
        trackingDomainVerifiedCache[verifiedCacheKey] = tdVerified?.is_verified === true;
      }
      const unsubscribeBase = trackingDomainVerifiedCache[verifiedCacheKey]
        ? `https://${trackingDomain}`
        : UNSUBSCRIBE_FALLBACK_BASE;
      const unsubscribeUrl = `${unsubscribeBase}/u/${unsubToken}`;

      // Late-resolve {{unsubscribe_link}} in subject and body (couldn't resolve earlier without sendLogId).
      // Body renders as HTML except for a text-only first step, so give a manually-placed
      // variable a real hyperlink with human anchor text — never the bare URL, which is a
      // signed token on an infra host and reads like a phishing link.
      const isFirstStep = enrollment.current_step === 0;
      const bodyIsHtml = !(settings.first_email_text_only && isFirstStep);
      const unsubscribeBodyValue = bodyIsHtml
        ? buildUnsubscribeAnchor(unsubscribeUrl, settings.unsubscribe_footer_text)
        : unsubscribeUrl;
      const hadUnsubVar = body.includes('{{unsubscribe_link}}') || subject.includes('{{unsubscribe_link}}');
      body = body.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeBodyValue);
      subject = subject.replace(/\{\{unsubscribe_link\}\}/g, unsubscribeUrl);

      // Update send_log with resolved body if {{unsubscribe_link}} was used
      if (hadUnsubVar) {
        await supabase
          .from('email_send_log')
          .update({ subject, body })
          .eq('id', sendLog.id);
      }

      // Apply tracking

      const trackingSettings: TrackingSettings = {
        open_tracking: settings.open_tracking ?? false,
        // Defaults off, same as open_tracking. A wrapped click-through link points at a
        // shared tracking domain used across every sending domain in the org — one
        // burned/complained-about domain poisons that domain's own reputation as a link
        // target, which then drags down placement for every OTHER domain sharing it,
        // even ones with a clean history of their own (confirmed 2026-09-22: all 12
        // active Acquist domains shared t.automatedclientacquisition.com).
        click_tracking: settings.click_tracking ?? false,
        custom_tracking_domain: trackingDomain,
        first_email_text_only: settings.first_email_text_only,
        unsubscribe_link_footer: settings.unsubscribe_link_footer,
        unsubscribe_footer_text: settings.unsubscribe_footer_text,
      };

      const processedBody = prepareEmailBody(body, sendLog.id, lead.email, trackingSettings, isFirstStep, unsubscribeUrl);
      const isHtml = !trackingSettings.first_email_text_only || !isFirstStep;
      const textOnlyHtmlCompanion = isHtml
        ? undefined
        : buildTextOnlyUnsubscribeHtml(body, trackingSettings, unsubscribeUrl);

      // Build headers
      const headers: Record<string, string> = {};
      if (settings.unsubscribe_header !== false) {
        const mailboxDomain = mailbox.email_address.split('@')[1];
        headers['List-Unsubscribe'] = `<${unsubscribeUrl}>, <mailto:unsubscribe@${mailboxDomain}>`;
        headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
      }
      // PostShiba strips this header before delivery and echoes it on every
      // delivery/bounce/complaint event, so postshiba-events can find this send.
      if (mailbox.connection_type === 'postshiba') {
        headers['X-Capsule-Unique-Args'] = JSON.stringify({ send_log_id: sendLog.id });
      }

      // Decide the send path. M365 mailboxes send via Graph (app-only,
      // no per-mailbox password) — symmetric with inbound Graph polling and
      // immune to the SMTP password drift that disconnects them. SMTP creds
      // are still extracted (best-effort) as a non-regressive fallback: if
      // Graph can't send for an app-level reason, we retry over SMTP.
      const mailboxMeta = (mailbox.metadata || {}) as Record<string, unknown>;
      const m365UserId = mailboxMeta.m365_user_id as string | undefined;
      const m365AdminEmail = mailboxMeta.m365_admin_email as string | undefined;
      let graphTenantId: string | null = null;
      if (mailbox.connection_type === 'm365' && m365UserId && m365AdminEmail) {
        graphTenantId = await resolveM365TenantId(supabase, organizationId, m365AdminEmail);
      }
      const useGraph = graphTenantId !== null && !!m365UserId;
      // Graph-eligibility is derived from metadata alone, independent of the
      // per-process tenant-lookup cache — so a mailbox stays "Graph-primary"
      // even on a cycle where the tenant lookup transiently failed and it
      // fell to direct SMTP. Used to shield it from SMTP-535 disconnects.
      const graphEligible = mailbox.connection_type === 'm365' && !!m365UserId && !!m365AdminEmail;

      const smtpCreds = extractSMTPCredentials(mailbox.metadata || {});
      if (!useGraph && !smtpCreds) {
        // No Graph path and no usable SMTP credentials — cannot send.
        errorCount++;
        return;
      }

      // Pre-send guard
      {
        const { data: freshMailbox } = await supabase
          .from('email_mailboxes')
          .select('daily_sent, daily_limit, status')
          .eq('id', mailbox.id)
          .single();

        const mailboxInFlight = inFlight[`mbx:${mailbox.id}`] || 0;
        if (!freshMailbox || freshMailbox.status !== 'ready' || freshMailbox.daily_sent + mailboxInFlight >= freshMailbox.daily_limit) {
          await supabase
            .from('email_send_log')
            .update({ status: 'skipped', error_message: 'mailbox_limit_or_status_changed' })
            .eq('id', sendLog.id);
          skippedCount++;
          return;
        }
        hold(`mbx:${mailbox.id}`);
      }

      const sendPayload = {
        from_name: mailbox.display_name || mailbox.email_address,
        from_email: mailbox.email_address,
        to_email: lead.email,
        subject,
        html: isHtml ? processedBody : textOnlyHtmlCompanion,
        text: !isHtml ? processedBody : undefined,
        cc: settings.cc,
        bcc: settings.bcc,
        headers,
        in_reply_to: inReplyTo,
        references: emailReferences,
        // PostShiba can take 15+ s to accept a message, so wait longer, and carry
        // our own Message-ID so a send that times out still threads (see below).
        ...(mailbox.connection_type === 'postshiba'
          ? { socket_timeout_ms: 60_000, message_id: `<${randomUUID()}@${mailbox.email_address.split('@')[1]}>` }
          : {}),
      };

      let sendResult;
      if (useGraph) {
        sendResult = await sendEmailViaGraph({
          tenantId: graphTenantId!,
          userId: m365UserId!,
          ...sendPayload,
        });
        if (sendResult.fallbackToSmtp && smtpCreds) {
          // Graph couldn't send for an app-level reason (e.g. Mail.Send not
          // yet consented) or a transient token/consent-propagation blip.
          // Retry over SMTP so we never regress vs the old SMTP-only path.
          // A 535 here won't bench the mailbox — it's Graph-primary (see the
          // graphPrimary handling in recordSendResult).
          console.warn(`[Worker] Graph unavailable for ${mailbox.email_address}, falling back to SMTP`);
          sendResult = await sendEmailViaSMTP({ credentials: smtpCreds, ...sendPayload });
          smtpFallbackCount++;
        } else if (sendResult.success) {
          graphSentCount++;
        }
      } else {
        sendResult = await sendEmailViaSMTP({ credentials: smtpCreds!, ...sendPayload });
      }

      // A PostShiba timeout is ambiguous: PostShiba may have accepted the message
      // after the data went over. Retrying it sent duplicates (2026-10-23), so it
      // is recorded as sent, unconfirmed; the events webhook confirms or bounces it.
      let unconfirmed = false;
      if (!sendResult.success && mailbox.connection_type === 'postshiba' && 'timed_out' in sendResult && sendResult.timed_out) {
        console.warn(`[Worker] PostShiba timed out on enrollment ${enrollment.id}: recording as sent (unconfirmed), not retrying`);
        sendResult = { success: true, message_id: sendPayload.message_id || '' };
        unconfirmed = true;
      }

      if (sendResult.success) {
        await supabase
          .from('email_send_log')
          .update({
            status: 'sent',
            sent_at: nowISO,
            body: processedBody,
            ...(unconfirmed ? { error_message: 'SMTP timed out after handing over the message; awaiting PostShiba events' } : {}),
            email_message_id: sendResult.message_id || null,
            email_in_reply_to: inReplyTo || null,
            email_references: emailReferences || null,
          })
          .eq('id', sendLog.id);

        await recordSendResult(supabase, mailbox.id, true);

        if (variantId) {
          await supabase.rpc('increment_variant_stat', {
            p_variant_id: variantId,
            p_column: 'sent',
          });
        }

        await createCrmRecordForOutboundEmail(
          supabase, organizationId, lead, mailbox,
          subject, processedBody, sendLog.id, sendResult.message_id, isHtml
        );

        await advanceEnrollment(supabase, enrollment, steps, settings);

        await supabase
          .from('leads')
          .update({ last_sequence_email_at: nowISO })
          .eq('id', enrollment.lead_id);

        const seqKey = sequence.id;
        sequenceDailySends[seqKey] = (sequenceDailySends[seqKey] || 0) + 1;
        if (enrollment.current_step === 0) {
          const newKey = `new_${sequence.id}`;
          sequenceNewLeadsToday[newKey] = (sequenceNewLeadsToday[newKey] || 0) + 1;
        }
        const domain = lead.email?.split('@')[1]?.toLowerCase();
        if (domain) {
          domainSendsToday[domain] = (domainSendsToday[domain] || 0) + 1;
        }

        sentCount++;
      } else {
        const category = sendResult.error_category;
        const isRealBounce = category === 'hard_bounce';

        await supabase
          .from('email_send_log')
          .update({
            status: isRealBounce ? 'bounced' : 'failed',
            error_message: sendResult.error || 'SMTP send failed',
            error_category: category || null,
            bounced_at: isRealBounce ? nowISO : null,
          })
          .eq('id', sendLog.id);

        // Receiver/list refusals remain diagnostic; only transport failures
        // count toward the sender circuit breaker.
        // An SMTP auth failure (535) on a Graph-primary M365 mailbox is
        // treated as transient (no bench) — see recordSendResult(graphPrimary).
        const result = await recordSendResult(supabase, mailbox.id, false, sendResult.error || 'SMTP error', category, { graphPrimary: graphEligible });

        // Mark lead as bounced so future sequences skip this email
        if (category === 'hard_bounce') {
          await supabase.from('leads').update({ email_status: 'bounced' }).eq('id', enrollment.lead_id);
        }

        // Auth error disconnected the mailbox — add to skip set so we don't
        // waste cycles on remaining enrollments assigned to it this batch
        if (result.disconnected) {
          disconnectedMailboxIds.add(mailbox.id);
        }

        errorCount++;
      }

    } catch (error) {
      console.error(`[Worker] Error processing enrollment ${enrollment.id}:`, error);
      const errMsg = error instanceof Error ? error.message : String(error);
      // Finalize any send_log row left open in 'sending' so it isn't orphaned.
      // The status guard ensures we never overwrite a row already resolved to
      // sent/failed/skipped earlier in this iteration.
      if (openSendLogId) {
        try {
          await supabase
            .from('email_send_log')
            .update({
              status: 'failed',
              error_message: `worker_exception: ${errMsg}`.slice(0, 500),
              error_category: 'network_error',
            })
            .eq('id', openSendLogId)
            .eq('status', 'sending');
        } catch (finErr) {
          console.error(`[Worker] Failed to finalize orphaned send_log ${openSendLogId}:`, finErr);
        }
      }
      // Push the enrollment forward so a thrown iteration doesn't tight-loop and
      // re-create 'sending' rows for the same lead every poll cycle.
      try {
        await supabase
          .from('email_sequence_enrollments')
          .update({
            next_send_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', enrollment.id);
      } catch (reschedErr) {
        console.error(`[Worker] Failed to reschedule enrollment ${enrollment.id} after error:`, reschedErr);
      }
      errorCount++;
    }
  };

  const run = async (enrollment: any): Promise<'stop' | void> => {
    const held: string[] = [];
    try {
      return await processOne(enrollment, (key) => {
        inFlight[key] = (inFlight[key] || 0) + 1;
        held.push(key);
      });
    } finally {
      for (const key of held) inFlight[key] = Math.max(0, (inFlight[key] || 0) - 1);
    }
  };

  // PostShiba-only sequences send several at a time, paced to the cluster's
  // caps and spread over their send window. Everything else keeps the
  // one-at-a-time lane.
  const postshibaSequences = await postshibaOnlySequences(supabase, enrollments);
  const parallel = enrollments.filter((e: any) => postshibaSequences.has(e.sequence_id));
  const sequential = enrollments.filter((e: any) => !postshibaSequences.has(e.sequence_id));
  const paced = parallel.length > 0
    ? await pacePostshibaSends(supabase, laneOrgId, parallel, postshibaSequences)
    : { now: [], concurrency: POSTSHIBA_CONCURRENCY };
  const parallelNow = paced.now;

  await Promise.all([
    (async () => {
      for (const enrollment of sequential) {
        if ((await run(enrollment)) === 'stop') break;
      }
    })(),
    runWithConcurrency(parallelNow, paced.concurrency, run),
  ]);

  // Update stats
  const cycleDuration = Date.now() - laneStart;
  stats.totalCycles++;
  stats.totalEnrollmentsProcessed += enrollments.length;
  stats.totalSent += sentCount;
  stats.totalSkipped += skippedCount;
  stats.totalFiltered += filteredCount;
  stats.totalErrors += errorCount;
  stats.lastCycleAt = new Date().toISOString();
  stats.lastCycleDurationMs = cycleDuration;
  stats.lastCycleEnrollments = enrollments.length;

  if (sentCount > 0 || errorCount > 0) {
    console.log(`[Worker] Lane #${stats.totalCycles} org=${laneOrgId}: ${enrollments.length} enrollments, ${sentCount} sent (${graphSentCount} via Graph, ${smtpFallbackCount} SMTP-fallback), ${skippedCount} skipped, ${filteredCount} filtered, ${errorCount} errors (${cycleDuration}ms)`);
  }
}

/** Run fn over items, at most `limit` at a time; stops starting new ones once any returns 'stop'. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<'stop' | void>,
): Promise<void> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++];
      if ((await fn(item)) === 'stop') stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/**
 * Sequences in this batch whose pinned senders are all PostShiba, with the
 * senders' combined daily limit. Auto pools draw from the whole org's fleet, so
 * they stay on the one-at-a-time lane.
 */
async function postshibaOnlySequences(supabase: SupabaseClient, enrollments: any[]): Promise<Map<string, { senderDailyLimit: number }>> {
  const pinned = new Map<string, string[]>();
  for (const e of enrollments) {
    const seq = e.email_sequences;
    if (!seq || pinned.has(seq.id)) continue;
    const settings = seq.settings || {};
    const ids: string[] = settings.mailbox_ids || [];
    if ((settings.mailbox_selection?.mode ?? 'manual') === 'manual' && ids.length > 0) pinned.set(seq.id, ids);
  }
  const result = new Map<string, { senderDailyLimit: number }>();
  if (pinned.size === 0) return result;

  const allIds = [...new Set([...pinned.values()].flat())];
  const { data, error } = await supabase.from('email_mailboxes').select('id, connection_type, daily_limit, status').in('id', allIds);
  if (error) {
    console.warn(`[Worker] PostShiba sender lookup failed, sending one at a time: ${error.message}`);
    return result;
  }
  const byId = new Map((data || []).map((m: any) => [m.id, m]));
  for (const [seqId, ids] of pinned) {
    if (!ids.every((id) => byId.get(id)?.connection_type === 'postshiba')) continue;
    const senderDailyLimit = ids.reduce((sum, id) => {
      const m: any = byId.get(id);
      return sum + (m.status === 'ready' ? m.daily_limit || 0 : 0);
    }, 0);
    result.set(seqId, { senderDailyLimit });
  }
  return result;
}

/**
 * Which PostShiba enrollments go out now, and how many at once.
 *
 * 1. Spread: each sequence sends what is left of its day (the lower of its
 *    daily_limit and its senders' daily limits) evenly over the hours left in
 *    its send window, instead of all of it in the first few minutes.
 * 2. Cluster: never past the cluster's hourly or 24-hour cap, counted across
 *    every org on the same PostShiba cluster (postshiba_cluster_send_counts).
 *    Over the hourly cap PostShiba queues SMTP mail, so it would only land late.
 *
 * Held enrollments are rescheduled across the next hour (spread) or ten minutes
 * (cluster) in a few bulk updates, so they come back a few at a time instead of
 * all being re-claimed together. Outside a sequence's window, nothing is held
 * here: processOne reschedules those to the window as usual. Without known caps
 * (or if a lookup fails) nothing is held.
 */
async function pacePostshibaSends(
  supabase: SupabaseClient,
  orgId: string,
  enrollments: any[],
  sequences: Map<string, { senderDailyLimit: number }>,
): Promise<{ now: any[]; concurrency: number }> {
  const nowDate = new Date();
  const spreadHeld: any[] = [];
  const allowed: any[] = [];

  const bySequence = new Map<string, any[]>();
  for (const e of enrollments) bySequence.set(e.sequence_id, [...(bySequence.get(e.sequence_id) || []), e]);

  for (const [sequenceId, items] of bySequence) {
    const settings = applyDefaultSettings(items[0].email_sequences?.settings || {});
    const hoursLeft = sendWindowHoursLeft(nowDate, settings);
    if (hoursLeft === null) {
      allowed.push(...items);
      continue;
    }
    const dayCapacity = Math.min(settings.daily_limit || Infinity, sequences.get(sequenceId)?.senderDailyLimit ?? Infinity);
    if (!Number.isFinite(dayCapacity)) {
      allowed.push(...items);
      continue;
    }
    const [sentToday, sentLastHour] = await Promise.all([
      countSequenceSendsToday(supabase, sequenceId),
      countSequenceSendsSince(supabase, sequenceId, new Date(nowDate.getTime() - 3_600_000)),
    ]);
    const perHour = Math.ceil(Math.max(0, dayCapacity - sentToday) / Math.max(hoursLeft, 1));
    const budget = Math.max(0, perHour - sentLastHour);
    allowed.push(...items.slice(0, budget));
    spreadHeld.push(...items.slice(budget));
    if (items.length > budget) {
      console.log(`[Worker] Sequence ${sequenceId}: spreading ${Math.max(0, dayCapacity - sentToday)} left today over ${hoursLeft.toFixed(1)}h (${perHour}/h, ${sentLastHour} in the last hour), held ${items.length - budget}`);
    }
  }

  let concurrency = POSTSHIBA_CONCURRENCY;
  let clusterHeld: any[] = [];
  let now = allowed;
  const { data, error } = await supabase.rpc('postshiba_cluster_send_counts', { p_org_id: orgId });
  const counts = Array.isArray(data) ? data[0] : data;
  if (error) {
    console.warn(`[Worker] PostShiba cluster count failed for org ${orgId}, not pacing to the cluster: ${error.message}`);
  } else if (counts) {
    const perHour = counts.emails_per_hour || 0;
    const perDay = counts.emails_per_day || 0;
    if (perHour > 0) {
      concurrency = Math.min(POSTSHIBA_MAX_CONCURRENCY, Math.max(POSTSHIBA_CONCURRENCY, Math.ceil((perHour * POSTSHIBA_SECONDS_PER_SEND) / 3600)));
    }
    const budget = Math.min(
      perHour > 0 ? perHour - Number(counts.sent_last_hour || 0) : Infinity,
      perDay > 0 ? perDay - Number(counts.sent_last_day || 0) : Infinity,
    );
    if (budget < now.length) {
      const keep = Math.max(0, budget);
      clusterHeld = now.slice(keep);
      now = now.slice(0, keep);
      console.log(`[Worker] Org ${orgId}: PostShiba cluster caps ${perHour}/h, ${perDay}/day (${counts.sent_last_hour} in the last hour, ${counts.sent_last_day} in 24h), held ${clusterHeld.length}`);
    }
  }

  await Promise.all([
    deferAcross(supabase, spreadHeld, POSTSHIBA_SPREAD_DEFER_MS),
    deferAcross(supabase, clusterHeld, POSTSHIBA_CLUSTER_DEFER_MS),
  ]);
  return { now, concurrency };
}

/**
 * Hours left in today's send window, or null when the sequence isn't in its
 * window right now (or has none), so there is nothing to spread.
 */
function sendWindowHoursLeft(now: Date, settings: SequenceSettings): number | null {
  if (!settings.send_window || !isWithinBusinessHours(now, settings) || isWeekend(now, settings)) return null;
  const local = getLocalTime(now, settings.timezone || FALLBACK_TIMEZONE);
  const [endH, endM] = settings.send_window.end.split(':').map(Number);
  return Math.max(0, (endH * 60 + endM - (local.hours * 60 + local.minutes)) / 60);
}

/** Reschedule enrollments over the next `windowMs`, in six evenly spaced bulk updates. */
async function deferAcross(supabase: SupabaseClient, enrollments: any[], windowMs: number): Promise<void> {
  if (enrollments.length === 0) return;
  const slots = 6;
  const nowISO = new Date().toISOString();
  await Promise.all(Array.from({ length: slots }, async (_, slot) => {
    const ids = enrollments.filter((_, i) => i % slots === slot).map((e: any) => e.id);
    if (ids.length === 0) return;
    const until = new Date(Date.now() + (windowMs * (slot + 1)) / slots).toISOString();
    const { error } = await supabase
      .from('email_sequence_enrollments')
      .update({ next_send_at: until, updated_at: nowISO })
      .in('id', ids);
    if (error) console.warn(`[Worker] Failed to defer ${ids.length} PostShiba enrollments: ${error.message}`);
  }));
}

async function renewOrgLease(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('renew_sequence_sender_org_lease', {
    p_worker_id: WORKER_ID,
    p_org_id: orgId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) {
    // Fail closed: without a confirmed lease another worker may own this org.
    console.error(`[Worker] Lease renewal failed for org ${orgId}:`, error.message);
    return false;
  }
  return data === true;
}


// Start
main().catch((err) => {
  console.error('[Worker] Unhandled error:', err);
  process.exit(1);
});

// ============================================================================
// Helper Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getMailboxWindowOffset(mailboxId: string, maxOffsetMinutes: number): number {
  let hash = 0;
  for (let i = 0; i < mailboxId.length; i++) {
    hash = ((hash << 5) - hash + mailboxId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % (maxOffsetMinutes + 1);
}

/**
 * Minutes a mailbox's send window starts after the sequence's window start.
 * Staggers inboxes so they don't all fire at 08:00. 0 when there is no mailbox.
 */
function getMailboxStartOffsetMinutes(settings: SequenceSettings, mailboxId?: string): number {
  if (!mailboxId || !settings.send_window) return 0;
  const [startH, startM] = settings.send_window.start.split(':').map(Number);
  const [endH, endM] = settings.send_window.end.split(':').map(Number);
  const windowDuration = (endH * 60 + endM) - (startH * 60 + startM);
  const maxOffset = Math.min(60, Math.floor(windowDuration * 0.15));
  return maxOffset > 0 ? getMailboxWindowOffset(mailboxId, maxOffset) : 0;
}

function isWithinBusinessHours(now: Date, settings: SequenceSettings, mailboxId?: string): boolean {
  if (!settings.send_window) return true;

  const tz = settings.timezone || FALLBACK_TIMEZONE;
  const localTime = getLocalTime(now, tz);
  const localHourMin = localTime.hours * 60 + localTime.minutes;

  const [startH, startM] = settings.send_window.start.split(':').map(Number);
  const [endH, endM] = settings.send_window.end.split(':').map(Number);
  const startMin = startH * 60 + startM + getMailboxStartOffsetMinutes(settings, mailboxId);
  const endMin = endH * 60 + endM;

  return localHourMin >= startMin && localHourMin < endMin;
}

function isWeekend(now: Date, settings: SequenceSettings): boolean {
  if (!settings.skip_weekends) return false;
  const tz = settings.timezone || FALLBACK_TIMEZONE;
  const localTime = getLocalTime(now, tz);
  return localTime.dayOfWeek === 0 || localTime.dayOfWeek === 6;
}

function getLocalTime(date: Date, timezone: string): { hours: number; minutes: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const hours = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
  const minutes = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // ?? not ||: Sunday is 0, and `|| 1` silently reported it as Monday,
  // letting skip_weekends sequences send all day Sunday.
  return { hours, minutes, dayOfWeek: dayMap[weekday] ?? 1 };
}

function setLocalTime(date: Date, hour: number, minute: number, timezone: string): Date {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = dateFormatter.format(date);

  const localDateTimeStr = `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = date.toLocaleString('en-US', { timeZone: timezone });
  const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

  return new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
}

/**
 * Move `candidate` into the send window. Pass the mailbox's start offset when
 * rescheduling after an isWithinBusinessHours(…, mailboxId) miss: without it,
 * a time between the window start and the mailbox's staggered start counts as
 * "inside" here but "outside" there, so the enrollment was rescheduled one
 * minute ahead and skipped again, every minute, for up to an hour a day.
 */
function adjustToSendWindow(candidate: Date, settings: SequenceSettings, startOffsetMinutes = 0): Date {
  const tz = settings.timezone || FALLBACK_TIMEZONE;
  const sendWindow = settings.send_window;
  if (!sendWindow) return candidate;

  const [baseStartH, baseStartM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = baseStartH * 60 + baseStartM + startOffsetMinutes;
  const windowEndMin = endH * 60 + endM;
  const startH = Math.floor(windowStartMin / 60);
  const startM = windowStartMin % 60;

  let adjusted = new Date(candidate.getTime());
  for (let attempt = 0; attempt < 10; attempt++) {
    const local = getLocalTime(adjusted, tz);
    const localMin = local.hours * 60 + local.minutes;
    const isWeekendDay = local.dayOfWeek === 0 || local.dayOfWeek === 6;

    if (settings.skip_weekends && isWeekendDay) {
      const daysUntilMonday = local.dayOfWeek === 0 ? 1 : (8 - local.dayOfWeek);
      adjusted = new Date(adjusted.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      continue;
    }

    if (localMin < windowStartMin) {
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      break;
    }

    if (localMin >= windowEndMin) {
      adjusted = new Date(adjusted.getTime() + 24 * 60 * 60 * 1000);
      adjusted = setLocalTime(adjusted, startH, startM, tz);
      adjusted = new Date(adjusted.getTime() + Math.random() * 15 * 60 * 1000);
      continue;
    }

    break;
  }

  return adjusted;
}

function getNextMonday(now: Date, settings: SequenceSettings): string {
  const tz = settings.timezone || FALLBACK_TIMEZONE;
  const localTime = getLocalTime(now, tz);
  const daysUntilMonday = localTime.dayOfWeek === 0 ? 1 : (8 - localTime.dayOfWeek);

  const windowStart = settings.send_window?.start || '08:00';
  const [startH, startM] = windowStart.split(':').map(Number);

  // Advance to Monday, then set local time to the send window start
  const nextMonday = new Date(now.getTime() + daysUntilMonday * 24 * 60 * 60 * 1000);
  const result = setLocalTime(nextMonday, startH, startM, tz);

  return result.toISOString();
}

async function countSequenceSendsToday(supabase: SupabaseClient, sequenceId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', sequenceId)
    .gte('sent_at', `${today}T00:00:00Z`)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied']);

  return count || 0;
}

async function countSequenceSendsSince(supabase: SupabaseClient, sequenceId: string, since: Date): Promise<number> {
  const { count } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', sequenceId)
    .gte('sent_at', since.toISOString())
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied']);

  return count || 0;
}

async function countNewLeadsSendsToday(supabase: SupabaseClient, sequenceId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', sequenceId)
    .eq('sequence_step', 0)
    .gte('sent_at', `${today}T00:00:00Z`)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied']);

  return count || 0;
}

async function countDomainSendsToday(supabase: SupabaseClient, orgId: string, domain: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .ilike('recipient_email', `%@${domain}`)
    .gte('sent_at', `${today}T00:00:00Z`)
    .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied']);

  return count || 0;
}

async function checkCompanyReplied(supabase: SupabaseClient, sequenceId: string, domain: string): Promise<boolean> {
  const { data } = await supabase
    .from('email_send_log')
    .select('id')
    .eq('sequence_id', sequenceId)
    .eq('status', 'replied')
    .ilike('recipient_email', `%@${domain}`)
    .limit(1);

  return (data?.length || 0) > 0;
}

function findPreviousEmailStep(steps: SequenceStep[], beforeOrder: number): number | null {
  for (let i = beforeOrder - 1; i >= 0; i--) {
    const step = steps.find(s => s.order === i);
    if (step && (step.type === 'email' || step.type === 'ab_test')) {
      return i;
    }
  }
  return null;
}

function isConditionMet(
  conditionType: string,
  sendLog: { status: string; opened_at: string | null; clicked_at: string | null; replied_at: string | null; bounced_at: string | null } | null
): boolean {
  if (!sendLog) return false;

  switch (conditionType) {
    case 'opened':
      return !!(sendLog.opened_at || sendLog.clicked_at || sendLog.replied_at);
    case 'clicked':
      return !!sendLog.clicked_at;
    case 'replied':
      return !!sendLog.replied_at;
    case 'bounced':
      return !!sendLog.bounced_at;
    default:
      return false;
  }
}

async function resolveVariant(
  supabase: SupabaseClient,
  enrollment: any,
  step: SequenceStep,
  sequenceId: string,
  settings: SequenceSettings
): Promise<{ subject: string; body: string; variantId?: string; isNewAssignment: boolean }> {
  const variants = step.variants || [];
  if (variants.length === 0) {
    return { subject: step.subject || '', body: step.body || '', isNewAssignment: false };
  }

  const { data: dbVariants } = await supabase
    .from('email_ab_variants')
    .select('id, variant_label, subject, body, split_percentage, sent, opened, clicked, replied, bounced, is_winner')
    .eq('sequence_id', sequenceId)
    .eq('step_index', step.order);

  const liveVariants = (dbVariants && dbVariants.length > 0) ? dbVariants : variants;

  const winner = liveVariants.find((v: any) => v.is_winner === true);
  if (winner) {
    return { subject: winner.subject, body: winner.body, variantId: winner.id, isNewAssignment: false };
  }

  if (settings.auto_optimize_ab && dbVariants && dbVariants.length > 1) {
    const sampleSize = settings.ab_sample_size || 100;
    const metric = settings.ab_winning_metric || 'reply_rate';
    const allReachedSample = dbVariants.every((v: any) => (v.sent || 0) >= sampleSize);

    if (allReachedSample) {
      const rated = dbVariants.map((v: any) => {
        const delivered = Math.max(1, (v.sent || 0) - (v.bounced || 0));
        return {
          ...v,
          open_rate: (v.opened || 0) / delivered,
          click_rate: (v.clicked || 0) / delivered,
          reply_rate: (v.replied || 0) / delivered,
        };
      });

      const best = rated.reduce((a: any, b: any) => {
        if (b[metric] > a[metric]) return b;
        if (b[metric] === a[metric] && (b.sent || 0) > (a.sent || 0)) return b;
        return a;
      });

      await supabase
        .from('email_ab_variants')
        .update({ is_winner: false })
        .eq('sequence_id', sequenceId)
        .eq('step_index', step.order);

      await supabase
        .from('email_ab_variants')
        .update({ is_winner: true })
        .eq('id', best.id);

      console.log(`[Worker] Auto-optimized: variant ${best.variant_label} declared winner for sequence ${sequenceId} step ${step.order} (${metric}: ${(best[metric] * 100).toFixed(1)}%)`);

      return { subject: best.subject, body: best.body, variantId: best.id, isNewAssignment: false };
    }
  }

  const assignments = enrollment.variant_assignments || {};
  const stepKey = String(step.order);

  if (assignments[stepKey]) {
    const assigned = liveVariants.find((v: any) => v.id === assignments[stepKey]);
    if (assigned) {
      return { subject: assigned.subject, body: assigned.body, variantId: assigned.id, isNewAssignment: false };
    }
  }

  const totalSplit = liveVariants.reduce((sum: number, v: any) => sum + (v.split_percentage || 0), 0);
  let random = Math.random() * totalSplit;

  for (const variant of liveVariants) {
    random -= (variant as any).split_percentage || 0;
    if (random <= 0) {
      return { subject: (variant as any).subject, body: (variant as any).body, variantId: (variant as any).id, isNewAssignment: true };
    }
  }

  const fallback = liveVariants[0] as any;
  return { subject: fallback.subject, body: fallback.body, variantId: fallback.id, isNewAssignment: true };
}

async function enrichLeadWithCrmData(
  supabase: SupabaseClient,
  lead: Record<string, any>
): Promise<Record<string, any>> {
  let contact: any = null;

  // 1. Direct lookup via source_id (fastest, for leads created from CRM contacts)
  if (lead.source === 'crm_contact' && lead.source_id) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('company, company_website, full_name, job_title, city, state, country, enrichment_data, discovery_metadata, custom_fields, notion_preview_url, linkedin_bio, home_page_text')
      .eq('id', lead.source_id)
      .maybeSingle();
    contact = data;
  }

  // 2. Fallback: look up CRM contact by email within the same org (case-insensitive)
  if (!contact && lead.email && lead.organization_id) {
    const { data } = await supabase
      .from('crm_contacts')
      .select('company, company_website, full_name, job_title, city, state, country, enrichment_data, discovery_metadata, custom_fields, notion_preview_url, linkedin_bio, home_page_text')
      .eq('organization_id', lead.organization_id)
      .ilike('primary_email', lead.email)
      .maybeSingle();
    contact = data;
  }

  // The sequence editor offers {{full_name}}, {{city}} and {{website}}
  // (EMAIL_VARIABLES in src/lib/email-sequence-utils.ts), but `leads` has none
  // of those columns, so each one has to be filled here or it sends blank.
  // Empty values become null so the sequence's variable_defaults still apply.
  const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null;

  if (contact) {
    const enrichment = (contact.enrichment_data || {}) as Record<string, any>;
    const discovery = (contact.discovery_metadata || {}) as Record<string, any>;
    const enrichedLead: Record<string, any> = {
      ...lead,
      company: lead.company || contact.company,
      job_title: lead.job_title || contact.job_title,
      full_name: fullName || contact.full_name || null,
      city: contact.city || null,
      website: contact.company_website || null,
      headline: enrichment.headline || contact.job_title,
      location: contact.city || [contact.city, contact.state, contact.country].filter(Boolean).join(', '),
      industry: enrichment.industry,
      linkedin_bio: contact.linkedin_bio,
      home_page_text: contact.home_page_text,
      ai_primary_need: enrichment.primary_need,
      ai_primary_need_reason: enrichment.primary_need_reasoning,
      ai_primary_need_evidence: enrichment.primary_need_evidence,
      ai_primary_need_confidence: enrichment.primary_need_confidence,
      ai_cold_email_angle: enrichment.cold_email_angle,
      ai_company_niche: enrichment.company_niche,
      ai_company_offering: enrichment.company_offering,
      ai_company_target: enrichment.company_target,
      ai_company_tagline: enrichment.company_tagline,
      ai_best_hook: enrichment.best_post_hook,
      ai_linkedin_topic_1: enrichment.linkedin_topics?.[0],
      ai_priority_1: enrichment.company_priorities?.[0],
      ai_growth_signal_1: enrichment.growth_signals?.[0]?.signal,
      ai_latest_funding: enrichment.latest_funding_round,
      ai_funding_amount: enrichment.funding_amount,
      // Buying-signal fields from discovery_metadata. Note the two key
      // conventions: the event uses bare `signal_*`, the company/person block
      // uses `ai_signal_*`. These mirror campaign-processor's TemplateContext —
      // without them every {{ai_signal_*}} token resolves to '' at send.
      ai_signal_type: discovery.signal_type,
      ai_signal_date: discovery.signal_date,
      ai_signal_detail: discovery.signal_detail,
      ai_signal_context: discovery.signal_outreach_context,
      ai_signal_source_url: discovery.signal_source_url || discovery.directory_evidence_url,
      ai_signal_amount: discovery.ai_signal_amount,
      ai_signal_investors: discovery.ai_signal_investors,
      ai_signal_person: discovery.ai_signal_person,
      ai_signal_new_role: discovery.ai_signal_new_role,
      ai_signal_company_website: discovery.ai_signal_company_website,
      ai_signal_company_linkedin: discovery.ai_signal_company_linkedin,
      ai_signal_company_industry: discovery.ai_signal_company_industry,
      // push-moltsets-to-aca stopped mirroring these into ai_signal_* keys, so
      // fall back to the canonical company_* keys it still writes.
      ai_signal_company_size: discovery.ai_signal_company_size || discovery.company_employee_range,
      ai_signal_revenue: discovery.ai_signal_revenue || discovery.company_revenue_range,
      notion_preview_url: contact.notion_preview_url,
    };

    const customFields = (contact.custom_fields || {}) as Record<string, any>;
    for (const [key, value] of Object.entries(customFields)) {
      if (value != null) {
        enrichedLead[`custom_${key}`] = String(value);
      }
    }

    return enrichedLead;
  }

  return { ...lead, full_name: fullName };
}

/**
 * Resolve flat spintax: `{a|b|c}` -> one of the branches, chosen uniformly.
 * Single-brace tokens like {{first_name}} (no `|`) and unmatched literals are
 * left alone.
 *
 * Deliberately duplicated, not shared. Three runtimes need this (Node here,
 * Deno in supabase/functions/_shared/workflow-utils.ts, Vite in
 * src/lib/message-variables.ts) and this worker's Docker build context is
 * workers/sequence-sender/ alone, so no repo-root module is importable by all
 * three without reworking the build. Eight dependency-free lines are not worth
 * that. Keep the three copies byte-identical; call this only from
 * substituteVariables() below, never directly from a send path — a send path
 * that skipped it is exactly how raw {a|b|c} shipped to production.
 */
function resolveSpintax(text: string): string {
  if (!text || text.indexOf('|') === -1) return text;
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

// custom_data values (e.g. custom_email_1_body) are AI-written per-contact content
// that the SENDER NAME rule in generate-email-sequence tells the model to embed a
// {{sender_first_name}} / {{sender_last_name}} placeholder into, mid-sentence. Those
// values are spliced into the outer template as a single replace() callback return,
// which is never re-scanned for further {{...}} matches — so a token nested inside
// custom_data was never getting resolved at all, regardless of whether it was spelled
// correctly. Resolve it here, against the same mailboxContext, before it's spliced in.
// Also repairs the near-miss {{sender_first_}} the model sometimes emits instead of
// the full token (see repair-sender-placeholders.ts in the Deno edge functions for
// the same fix at generation time) — belt and suspenders, since this worker is a
// separate deployable from the edge functions.
function resolveNestedSenderTokens(value: string, mailboxContext?: { senderFirstName?: string; senderLastName?: string }): string {
  if (!value || value.indexOf('sender_first') === -1 && value.indexOf('sender_last') === -1) return value;
  return value
    .replace(/\{\{\s*sender_first[a-z_]*\s*\}\}/gi, mailboxContext?.senderFirstName || '')
    .replace(/\{\{\s*sender_last[a-z_]*\s*\}\}/gi, mailboxContext?.senderLastName || '');
}

function substituteVariables(text: string, lead: Record<string, any>, enrollmentId?: string, customData?: Record<string, any>, mailboxContext?: { signature?: string; senderName?: string; senderFirstName?: string; senderLastName?: string }, variableDefaults?: Record<string, string>, unresolved?: Set<string>): string {
  // Tiptap uses spans to make merge tags atomic in the editor. Older saved
  // steps contain those spans, so replacing {{signature}} directly would also
  // replace the token inside `data-variable-token`. Because a signature is
  // HTML, that breaks the attribute and emits both a malformed fragment and a
  // second signature. The editor now persists plain tokens; unwrap legacy
  // chips here so every outgoing email is repaired too.
  text = text.replace(
    /<span\b(?=[^>]*\bdata-(?:variable|spintax)-token\s*=)([^>]*)>[\s\S]*?<\/span>/gi,
    (_match, attributes: string) => {
      const token = attributes.match(
        /\bdata-(?:variable|spintax)-token\s*=\s*(["'])(.*?)\1/i
      );
      return token?.[2] || '';
    },
  );

  // Auto-linkify URL variables so they appear as clickable hyperlinks in HTML emails
  const maybeLink = (vn: string, val: string) =>
    vn.endsWith('_url') && /^https?:\/\//i.test(val) ? `<a href="${val}">${val}</a>` : val;

  const interpolated = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, varName) => {
    // 0. Skip unsubscribe_link — resolved later after send_log creation (needs sendLogId for token)
    if (varName === 'unsubscribe_link' || varName === 'unsubscribeLink') {
      return '{{unsubscribe_link}}';
    }

    // 1. Mailbox-level variables (signature/sender name come from the sending mailbox)
    if (varName === 'signature') {
      return mailboxContext?.signature || '';
    }
    if (varName === 'sender_first_name' || varName === 'senderFirstName') {
      return mailboxContext?.senderFirstName || '';
    }
    if (varName === 'sender_last_name' || varName === 'senderLastName') {
      return mailboxContext?.senderLastName || '';
    }
    if (varName === 'sender_name' || varName === 'senderName') {
      return mailboxContext?.senderName || '';
    }

    // 2. Check per-enrollment custom_data first (AI-generated content from shared templates)
    if (customData) {
      if (customData[varName] !== undefined && customData[varName] !== null && customData[varName] !== '') {
        return maybeLink(varName, resolveNestedSenderTokens(String(customData[varName]), mailboxContext));
      }
      const withPrefix = `custom_${varName}`;
      if (customData[withPrefix] !== undefined && customData[withPrefix] !== null && customData[withPrefix] !== '') {
        return maybeLink(varName, resolveNestedSenderTokens(String(customData[withPrefix]), mailboxContext));
      }
      // Handle {{email_subject_N}} / {{email_body_N}} → custom_email_N_subject / custom_email_N_body
      // User-facing variables use email_subject_1 format, but custom_data stores as custom_email_1_subject
      const emailVarMatch = varName.match(/^email_(subject|body)_(\d+)$/);
      if (emailVarMatch) {
        const remapped = `custom_email_${emailVarMatch[2]}_${emailVarMatch[1]}`;
        if (customData[remapped] !== undefined && customData[remapped] !== null && customData[remapped] !== '') {
          return maybeLink(varName, resolveNestedSenderTokens(String(customData[remapped]), mailboxContext));
        }
      }
    }

    // 3. Check lead data
    const value = lead[varName];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return maybeLink(varName, String(value));
    }

    // 4. Common aliases (camelCase → snake_case and vice versa)
    const aliases: Record<string, string> = {
      first_name: 'first_name',
      firstName: 'first_name',
      last_name: 'last_name',
      lastName: 'last_name',
      company: 'company',
      companyName: 'company',
      company_name: 'company',
      email: 'email',
      title: 'job_title',
      jobTitle: 'job_title',
      job_title: 'job_title',
      headline: 'headline',
      location: 'location',
      industry: 'industry',
      aiPrimaryNeed: 'ai_primary_need',
      aiPrimaryNeedReason: 'ai_primary_need_reason',
      aiPrimaryNeedEvidence: 'ai_primary_need_evidence',
      aiPrimaryNeedConfidence: 'ai_primary_need_confidence',
      aiColdEmailAngle: 'ai_cold_email_angle',
      aiCompanyNiche: 'ai_company_niche',
      aiCompanyOffering: 'ai_company_offering',
      aiCompanyTarget: 'ai_company_target',
      aiCompanyTagline: 'ai_company_tagline',
      aiBestHook: 'ai_best_hook',
      aiLinkedInTopic1: 'ai_linkedin_topic_1',
      aiPriority1: 'ai_priority_1',
      aiGrowthSignal1: 'ai_growth_signal_1',
      aiLatestFunding: 'ai_latest_funding',
      aiFundingAmount: 'ai_funding_amount',
      ai_primary_need: 'ai_primary_need',
      ai_company_niche: 'ai_company_niche',
      ai_company_offering: 'ai_company_offering',
      ai_company_target: 'ai_company_target',
      ai_best_hook: 'ai_best_hook',
      ai_priority_1: 'ai_priority_1',
    };

    const aliasedKey = aliases[varName];
    if (aliasedKey && lead[aliasedKey] !== undefined && lead[aliasedKey] !== null && String(lead[aliasedKey]).trim() !== '') {
      return maybeLink(varName, String(lead[aliasedKey]));
    }

    // 5. Sequence-level variable defaults (user-configured fallbacks)
    if (variableDefaults) {
      const defaultVal = variableDefaults[varName] ?? (aliasedKey ? variableDefaults[aliasedKey] : undefined);
      if (defaultVal !== undefined && defaultVal !== '') {
        return maybeLink(varName, defaultVal);
      }
    }

    // 6. Final fallback — report missing contact data before erasing the token.
    // Mailbox variables and unsubscribe_link return above and are never blocked.
    unresolved?.add(varName);
    console.warn(`[Worker] Unresolved variable "{{${varName}}}" for ${enrollmentId ? `enrollment ${enrollmentId}` : 'unknown enrollment'}, lead ${lead.id || 'unknown'}`);
    return '';
  });

  return resolveSpintax(interpolated);
}

function sampleFromSendWindow(settings: SequenceSettings, targetDate: Date): Date {
  const sendWindow = settings.send_window;
  if (!sendWindow) return targetDate;

  const [startH, startM] = sendWindow.start.split(':').map(Number);
  const [endH, endM] = sendWindow.end.split(':').map(Number);
  const windowStartMin = startH * 60 + startM;
  const windowEndMin = endH * 60 + endM;
  const windowDuration = windowEndMin - windowStartMin;

  if (windowDuration <= 0) return targetDate;

  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  let normalizedPosition = 0.40 + z * 0.20;
  normalizedPosition = Math.max(0.05, Math.min(0.95, normalizedPosition));

  const sampledMinuteOfDay = Math.round(windowStartMin + normalizedPosition * windowDuration);
  const sampledHour = Math.floor(sampledMinuteOfDay / 60);
  const sampledMin = sampledMinuteOfDay % 60;

  const tz = settings.timezone || FALLBACK_TIMEZONE;
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateStr = dateFormatter.format(targetDate);

  const localDateTimeStr = `${dateStr}T${String(sampledHour).padStart(2, '0')}:${String(sampledMin).padStart(2, '0')}:00`;
  const utcStr = targetDate.toLocaleString('en-US', { timeZone: 'UTC' });
  const localStr = targetDate.toLocaleString('en-US', { timeZone: tz });
  const offsetMs = new Date(utcStr).getTime() - new Date(localStr).getTime();

  return new Date(new Date(localDateTimeStr + 'Z').getTime() + offsetMs);
}

async function advanceEnrollment(
  supabase: SupabaseClient,
  enrollment: any,
  steps: SequenceStep[],
  settings: SequenceSettings
): Promise<void> {
  const nextStepOrder = enrollment.current_step + 1;
  const nextStep = steps.find((s: SequenceStep) => s.order === nextStepOrder);

  if (!nextStep) {
    await completeEnrollment(supabase, enrollment.id);
    return;
  }

  const delayHours = nextStep.delay_hours || 24;
  let nextSendAt: Date;

  if (delayHours >= 12 && settings.send_window) {
    const baseTarget = new Date(Date.now() + delayHours * 60 * 60 * 1000);
    nextSendAt = sampleFromSendWindow(settings, baseTarget);
  } else {
    const delayMs = delayHours * 60 * 60 * 1000;
    const minGapMs = (settings.min_time_gap_minutes || 0) * 60 * 1000;
    const jitterMs = Math.random() * (settings.random_additional_minutes || 0) * 60 * 1000;
    nextSendAt = new Date(Date.now() + delayMs + minGapMs + jitterMs);
  }

  // Ensure the calculated time falls within send window on a valid day
  nextSendAt = adjustToSendWindow(nextSendAt, settings);

  await supabase
    .from('email_sequence_enrollments')
    .update({
      current_step: nextStepOrder,
      next_send_at: nextSendAt.toISOString(),
      condition_waiting_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollment.id);
}

async function completeEnrollment(supabase: SupabaseClient, enrollmentId: string): Promise<void> {
  await supabase
    .from('email_sequence_enrollments')
    .update({
      status: 'completed',
      next_send_at: null,
      condition_waiting_since: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId);
}

async function updateNextSend(supabase: SupabaseClient, enrollmentId: string, nextSendAt: string): Promise<void> {
  await supabase
    .from('email_sequence_enrollments')
    .update({
      next_send_at: nextSendAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', enrollmentId);
}

async function createCrmRecordForOutboundEmail(
  supabase: SupabaseClient,
  organizationId: string,
  lead: Record<string, any>,
  mailbox: any,
  subject: string,
  body: string,
  sendLogId: string,
  messageId: string,
  isHtml: boolean,
): Promise<void> {
  try {
    let contactId = lead.source === 'crm_contact' ? lead.source_id : null;

    if (!contactId) {
      const { data: contact } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('organization_id', organizationId)
        .ilike('primary_email', lead.email)
        .maybeSingle();

      contactId = contact?.id;
    }

    if (!contactId) {
      const { data: newContact } = await supabase
        .from('crm_contacts')
        .insert({
          organization_id: organizationId,
          display_name: [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.email,
          first_name: lead.first_name || null,
          last_name: lead.last_name || null,
          primary_email: lead.email,
          company: lead.company || null,
          job_title: lead.job_title || null,
          source_channel: 'email',
        })
        .select('id')
        .single();

      contactId = newContact?.id;
    }

    if (!contactId) return;

    const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
      p_org_id: organizationId,
      p_contact_id: contactId,
      p_channel: 'email',
      p_channel_account_id: null,
      p_external_conversation_id: null,
      p_external_participant_id: lead.email,
      p_mailbox_id: mailbox.id,
    });

    if (!conversationId) return;

    const preview = body.replace(/<[^>]*>/g, '').substring(0, 100);
    const { data: crmMessage } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        contact_id: contactId,
        direction: 'outbound',
        sender_type: 'automation',
        content: body,
        content_type: isHtml ? 'html' : 'text',
        email_subject: subject,
        email_from: mailbox.email_address,
        email_to: [lead.email],
        external_message_id: messageId || null,
        status: 'sent',
        metadata: { send_log_id: sendLogId, source: 'email_sequence' },
      })
      .select('id')
      .single();

    if (crmMessage) {
      await supabase
        .from('email_send_log')
        .update({ crm_message_id: crmMessage.id })
        .eq('id', sendLogId);
    }
  } catch (error) {
    console.error('[Worker] Failed to create CRM record (non-fatal):', error);
  }
}

/**
 * Continuation anchor: when a follow-up enrollment should continue an existing email thread
 * (interested-reply follow-ups, or MCP/agent enrolls that pass continue_from_conversation_id),
 * resolve the mailbox that owns the thread + the Message-ID / References / subject to reply onto.
 * Returns null for ordinary cold enrollments (no marker) — they keep rotating + start a fresh thread.
 */
interface ContinuationAnchor {
  mailboxId: string;
  inReplyTo?: string;
  references?: string[];
  subject?: string;
}

async function resolveContinuationAnchor(
  supabase: any,
  enrollment: any,
  organizationId: string,
): Promise<ContinuationAnchor | null> {
  const meta = (enrollment.metadata as Record<string, any>) || {};
  const conversationId: string | undefined = meta.continue_from_conversation_id;
  const sourceSequenceId: string | undefined = meta.source_sequence_id;
  if (!conversationId && !sourceSequenceId) return null;

  // Path A — explicit conversation (MCP / external agent / UI): thread onto the latest message.
  if (conversationId) {
    const { data: conv } = await supabase
      .from('crm_conversations')
      .select('id, mailbox_id')
      .eq('id', conversationId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (conv?.mailbox_id) {
      const anchor: ContinuationAnchor = { mailboxId: conv.mailbox_id };
      const { data: recentMessages } = await supabase
        .from('crm_messages')
        .select('external_message_id, email_subject, metadata, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(10);

      type RecentConversationMessage = {
        external_message_id?: string | null;
        email_subject?: string | null;
        metadata?: Record<string, unknown> | null;
      };
      const messages = (recentMessages || []) as RecentConversationMessage[];
      const latestMessage = messages[0];
      const threadMessage = messages.find((message) => {
        const metadata = message.metadata || {};
        return !!(metadata.email_message_id || message.external_message_id);
      });

      if (threadMessage) {
        const m = threadMessage.metadata || {};
        const messageId = m.email_message_id || threadMessage.external_message_id;
        if (typeof messageId === 'string') {
          anchor.inReplyTo = messageId;
          anchor.references = [
            ...(Array.isArray(m.email_references)
              ? m.email_references.filter((value): value is string => typeof value === 'string')
              : []),
            messageId,
          ];
        }
      }
      if (latestMessage?.email_subject) anchor.subject = latestMessage.email_subject;
      return anchor;
    }
  }

  // Path B — source sequence (internal follow-up engine records metadata.source_sequence_id):
  // anchor on the lead's last real send in that sequence.
  if (sourceSequenceId) {
    const { data: src } = await supabase
      .from('email_send_log')
      .select('mailbox_id, subject, email_message_id, email_references')
      .eq('sequence_id', sourceSequenceId)
      .eq('lead_id', enrollment.lead_id)
      .in('status', ['sent', 'delivered', 'opened', 'clicked', 'replied'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (src?.mailbox_id) {
      const anchor: ContinuationAnchor = { mailboxId: src.mailbox_id };
      if (src.email_message_id) {
        anchor.inReplyTo = src.email_message_id;
        anchor.references = [...((src.email_references as string[]) || []), src.email_message_id];
      }
      if (src.subject) anchor.subject = src.subject;
      return anchor;
    }
  }

  return null;
}

function deriveEmailStatus(raw: string): string {
  const normalized = (raw || '').toLowerCase().trim();
  switch (normalized) {
    case 'valid':
    case 'verified':
      return 'valid';
    case 'invalid':
      return 'invalid';
    case 'risky':
    case 'guessed':
    case 'accept_all':
    case 'accept-all':
      return 'risky';
    case 'catch_all':
    case 'catch-all':
    case 'catchall':
      return 'catch_all';
    default:
      return 'unknown';
  }
}

function emailStatusFromConfidence(confidence: number): string {
  if (confidence >= 80) return 'valid';
  if (confidence >= 50) return 'risky';
  if (confidence > 0) return 'invalid';
  return 'unknown';
}
