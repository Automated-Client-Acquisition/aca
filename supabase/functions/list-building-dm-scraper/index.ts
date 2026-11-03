/**
 * DM Scraper — LinkedIn-via-Apify.
 *
 * Replaces the Fly Playwright DM-page crawler for stage='dm' work items.
 * Why: the Playwright crawler returns 0 DMs for ~90% of companies (Asian-
 * language sites, VC sites, sites with no public team page). LinkedIn —
 * which we already have a URL for, courtesy of SignalBase — is reliably
 * the right source.
 *
 * Flow per cron tick (every minute):
 *   1. Atomically claim up to BATCH_SIZE pending stage='dm' work items
 *      with SELECT FOR UPDATE SKIP LOCKED — bypasses claim_lb_work_items so
 *      we can also process items whose parent job is in 'failed' state,
 *      which the rerun-stuck-signals path needs).
 *   2. For each item with payload.linkedin_url: call the harvestapi
 *      LinkedIn-company-employees Apify actor.
 *   3. Filter candidates through isPlausibleHumanName (drops marketing
 *      noise, company-name reflections, ALL-CAPS headers).
 *   4. Rank surviving candidates by seniority hit on title.
 *   5. Insert top-5 into lb_decision_makers in a single insert.
 *   6. For each DM with payload.domain, enqueue a stage='pattern' work item.
 *   7. Mark the dm item completed.
 *
 * Items with no linkedin_url fall through to the existing Fly /scrape-dms
 * Playwright endpoint as a last-resort.
 *
 * Cost: harvestapi charges ~$0.005/result. 25 maxItems × $0.005 = $0.125
 * per company in the worst case (we keep top-5 but the actor charges for
 * everything it returns). At BATCH_SIZE=20/min × 60 min = 1200 companies/hr,
 * that's $150/hr at the upper bound. The job-status filter and per-org
 * daily cap (read from pack_subscriptions.config.daily_apify_cap, default
 * 1000 results/day → ~$5/day per org) keep this bounded.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import { isPlausibleHumanName } from '../_shared/list-building/name-validator.ts';
import { triggerSignalExport } from '../_shared/list-building/signal-export-trigger.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1/tools';
const QUICKENRICH_API_BASE = 'https://app.quickenrich.io/api';
const PUBLIC_SIGNALS_ORG_ID = HOUSE_ORG_ID;
const QUICKENRICH_MAX_PAGES = 5;
// Search is a separate fair-use allowance from MoltSets email enrichment.
// Unknown/entry plans stay at one returned record per minute; the configured
// unlimited plan is safely paced below its 7,500 search-record / 5h limit.
const MOLTSETS_SEARCH_LIMIT = 1;

const APIFY_ACTOR_ID = 'harvestapi~linkedin-company-employees';
const APIFY_RUNS_URL = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/runs`;
const FLY_SCRAPER_URL = Deno.env.get('LIST_BUILDING_SCRAPER_URL') ?? '';

// Linkedin URL resolver (s-r/free-linkedin-company-finder). Takes a domain,
// returns the canonical LinkedIn company URL. Used as a pre-step when
// the SignalBase record arrives without a LinkedIn URL (typical for
// hiring signals).
const LINKEDIN_FINDER_ID = 's-r~free-linkedin-company-finder---linkedin-address-from-any-site';
const LINKEDIN_FINDER_SYNC_URL = `https://api.apify.com/v2/acts/${LINKEDIN_FINDER_ID}/run-sync-get-dataset-items`;

const BATCH_SIZE = 20;
// Legacy fly-fallback path keeps a hard cap; primary path uses
// DmFilter.maxItemsPerCompany (default 5).
const TOP_DMS_PER_COMPANY = 5;
const APIFY_RUN_TIMEOUT_MS = 120_000;
const APIFY_POLL_INTERVAL_MS = 4_000;

// ============================================================================
// Per-subscription DM filter config — read from pack_subscriptions.config
// .dm_filter. Falls back to senior-only defaults when missing so existing
// subs auto-upgrade on next refresh without a UI re-edit.
// ============================================================================
interface DmFilter {
  // harvestapi seniorityLevelIds: 100-In Training, 110-Entry, 120-Senior,
  // 130-Strategic, 200-Entry Mgr, 210-Experienced Mgr, 220-Director,
  // 300-VP, 310-CXO, 320-Owner/Partner.
  seniorityLevelIds: string[];
  functionIds: string[];
  jobTitles: string[];
  maxItemsPerCompany: number;
  profileScraperMode: string;
}

const DEFAULT_DM_FILTER: DmFilter = {
  seniorityLevelIds: ['220', '300', '310', '320'],   // Director / VP / CXO / Owner
  functionIds: [],                                    // empty = all functions
  jobTitles: [],                                      // empty = all titles
  maxItemsPerCompany: 5,
  profileScraperMode: 'Full + email search ($12 per 1k)',
};

// Seniority regex — matches the strongest-hitting tokens from a job title.
// Tier 1 (founders, C-level, presidents) outranks Tier 2 (VPs, heads, chiefs)
// outranks Tier 3 (directors, partners) outranks Tier 4 (everyone else).
const TIER_1 = /\b(founder|co-?founder|owner|president|ceo|cto|cmo|cfo|coo|cro|cio|chro)\b/i;
const TIER_2 = /\b(vp|vice president|head of|chief|svp|evp)\b/i;
const TIER_3 = /\b(director|partner|gm|general manager)\b/i;

interface DmWorkItem {
  id: number;
  job_id: string;
  organization_id: string;
  payload: {
    company_id: string;
    company_name: string;
    domain: string | null;
    website_url: string | null;
    linkedin_url: string | null;
  };
}

interface HarvestCurrentPosition {
  // The actor uses `position` for the role string. `title` is a fallback
  // we keep around for older actor versions.
  position?: string | null;
  title?: string | null;
  companyName?: string | null;
  description?: string | null;
}

/**
 * Email object inside the harvestapi `emails` array (Full+email mode).
 * Confirmed shape from a live run on 2026-05-04 (Whatnot).
 */
interface HarvestEmail {
  email?: string | null;
  status?: string | null;          // 'valid' | 'risky' | 'invalid' | 'unknown'
  catchAllDomain?: boolean | null;
  validEmailServer?: boolean | null;
  free?: boolean | null;
  qualityScore?: number | null;
}

/**
 * Resolve the DM filter for a work item by walking
 * lb_work_items.job_id → list_building_jobs.metadata.pack_subscription_id
 * → pack_subscriptions.config.dm_filter. Returns DEFAULT_DM_FILTER when
 * any link in the chain is missing — keeps existing subs (no dm_filter
 * key yet) on senior-only Full+email mode automatically.
 */
async function loadDmSettings(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ filter: DmFilter; allowHouseQuickenrich: boolean }> {
  try {
    const { data: job } = await supabase
      .from('list_building_jobs')
      .select('metadata')
      .eq('id', jobId)
      .maybeSingle();
    const subId = (job as { metadata?: { pack_subscription_id?: string } } | null)?.metadata
      ?.pack_subscription_id;
    if (!subId) return { filter: DEFAULT_DM_FILTER, allowHouseQuickenrich: false };

    const { data: sub } = await supabase
      .from('pack_subscriptions')
      .select('config')
      .eq('id', subId)
      .maybeSingle();
    const config = (sub as {
      config?: { dm_filter?: Partial<DmFilter>; provider?: string };
    } | null)?.config;
    const cfg = config?.dm_filter;

    return {
      filter: {
        seniorityLevelIds: cfg?.seniorityLevelIds ?? DEFAULT_DM_FILTER.seniorityLevelIds,
        functionIds: cfg?.functionIds ?? DEFAULT_DM_FILTER.functionIds,
        jobTitles: cfg?.jobTitles ?? DEFAULT_DM_FILTER.jobTitles,
        maxItemsPerCompany: cfg?.maxItemsPerCompany ?? DEFAULT_DM_FILTER.maxItemsPerCompany,
        profileScraperMode: cfg?.profileScraperMode ?? DEFAULT_DM_FILTER.profileScraperMode,
      },
      allowHouseQuickenrich: config?.provider === 'aca_engine',
    };
  } catch {
    return { filter: DEFAULT_DM_FILTER, allowHouseQuickenrich: false };
  }
}

interface HarvestCandidate {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string | null;
  position?: string | null;
  currentJobTitle?: string | null;
  jobTitle?: string | null;
  publicIdentifier?: string;
  profileUrl?: string;
  // harvestapi-specific shape (verified against live datasets 2026-05-04):
  linkedinUrl?: string;          // canonical: https://www.linkedin.com/in/<id>
  currentPosition?: HarvestCurrentPosition[]; // singular noun, array-shaped
  currentPositions?: HarvestCurrentPosition[]; // legacy alias seen in some runs
  summary?: string | null;
  url?: string;
  // Full+email mode field. Confirmed array shape (one entry per discovered
  // email). Each entry carries the address + harvestapi's own validation.
  emails?: HarvestEmail[];
  // Belt-and-braces fallback fields (older actor versions / different runs):
  email?: string | null;
  emailStatus?: string | null;
  emailValidationStatus?: string | null;
}

interface MoltsetsPerson {
  first_name?: string | null;
  firstName?: string | null;
  last_name?: string | null;
  lastName?: string | null;
  full_name?: string | null;
  fullName?: string | null;
  name?: string | null;
  title?: string | null;
  job_title?: string | null;
  jobTitle?: string | null;
  headline?: string | null;
  linkedin_url?: string | null;
  linkedinUrl?: string | null;
  company_domain?: string | null;
  companyDomain?: string | null;
}

interface MoltsetsCredentials {
  token: string;
  searchRequestsPerMinute: number;
}

interface QuickenrichCredentials {
  token: string;
  sourceOrganizationId: string;
  domainRequestsPerMinute: number;
}

interface QuickenrichPerson {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  name?: string | null;
  title?: string | null;
  employee_linkedin?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_verification_date?: string | null;
  company_url?: string | null;
  email_domain?: string | null;
  company_name?: string | null;
  industry?: string | null;
  revenue?: string | null;
  employee_count?: string | number | null;
  country_code?: string | null;
  city?: string | null;
  region_code?: string | null;
}

interface RankedCandidate {
  first_name: string;
  last_name: string | null;
  title: string | null;
  linkedin_url: string | null;
  tier: number;
  // Full+email mode passthrough — email + raw validation status string.
  // null when the actor was run in Short mode or didn't find an email.
  email: string | null;
  email_validation_status: string | null;
}

/** Bypass claim_lb_work_items while still claiming atomically in Postgres. */
async function claimDmItems(supabase: SupabaseClient, batchSize: number): Promise<DmWorkItem[]> {
  const { data, error } = await supabase.rpc('claim_pending_dm_work_items', {
    p_batch_size: batchSize,
    p_claimed_by: 'edge:list-building-dm-scraper',
  });
  if (error) {
    console.error('[dm-scraper] atomic claim failed', error);
    return [];
  }
  return (data as DmWorkItem[]) ?? [];
}

/**
 * Increment dm_attempt_count and stamp dm_last_attempted_at on the company.
 * Called before every harvest run so the recover/rerun paths can cap retries
 * (see recover_stuck_dm_signals + dm_dead flag in migration 20260612000000).
 * Returns the new attempt count so the caller can decide whether to mark
 * the company dead.
 */
async function markDmAttempt(
  supabase: SupabaseClient,
  companyId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('lb_discovered_companies')
    .select('dm_attempt_count')
    .eq('id', companyId)
    .maybeSingle();
  if (error) {
    console.warn('[dm-scraper] markDmAttempt select failed', error);
    return 0;
  }
  const prev = (data as { dm_attempt_count?: number } | null)?.dm_attempt_count ?? 0;
  const next = prev + 1;
  const { error: updErr } = await supabase
    .from('lb_discovered_companies')
    .update({
      dm_attempt_count: next,
      dm_last_attempted_at: new Date().toISOString(),
    })
    .eq('id', companyId);
  if (updErr) {
    console.warn('[dm-scraper] markDmAttempt update failed', updErr);
  }
  return next;
}

/**
 * Mark a company as terminally unscrapeable so recover_stuck_dm_signals
 * and rerun-stuck-signals stop re-enqueueing it. Called when we've burned
 * 3 attempts without producing DMs, or up-front when we know there's no
 * scrape target (no linkedin_url and no website_url).
 */
async function markDmDead(
  supabase: SupabaseClient,
  companyId: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase
    .from('lb_discovered_companies')
    .update({ dm_dead: true, dm_dead_reason: reason })
    .eq('id', companyId);
  if (error) {
    console.warn('[dm-scraper] markDmDead failed', error);
  }
}

/**
 * Mark a work item completed. Mirrors complete_lb_work_item RPC behavior
 * but does it via a regular update so the operation is independent of job
 * status. `success=false` parks the item in 'failed' so it doesn't get
 * re-claimed; the rerun-stuck-signals path produces fresh items if needed.
 */
async function completeItem(
  supabase: SupabaseClient,
  itemId: number,
  success: boolean,
  errorMsg: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from('lb_work_items')
    .update({
      status: success ? 'completed' : 'failed',
      error: errorMsg,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (error) {
    console.warn('[dm-scraper] completeItem failed', error);
  }
}

async function releaseItemForProviderWait(
  supabase: SupabaseClient,
  itemId: number,
  provider: string,
): Promise<void> {
  const { error } = await supabase
    .from('lb_work_items')
    .update({
      status: 'pending',
      claimed_by: null,
      claimed_at: null,
      error: `${provider}_rate_wait`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId);
  if (error) console.warn(`[dm-scraper] ${provider} release failed`, error);
}

async function getApifyToken(supabase: SupabaseClient, orgId: string): Promise<string | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.error('[dm-scraper] ENCRYPTION_KEY not set');
    return null;
  }
  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!keyRow) return null;
  return decryptApiKey((keyRow as { key_encrypted: string }).key_encrypted, encryptionKey);
}

function moltsetsSearchRequestsPerMinute(plan: unknown): number {
  switch (String(plan ?? '').toLowerCase()) {
    case 'tier_997': return 250;
    case 'tier_97':
    case 'unlimited': return 20;
    default: return 1;
  }
}

async function getMoltsetsToken(supabase: SupabaseClient, orgId: string): Promise<MoltsetsCredentials | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) {
    console.error('[dm-scraper] ENCRYPTION_KEY not set');
    return null;
  }
  // resolve-api-key deliberately pins a different supabase-js minor than this
  // worker; their runtime clients are compatible but TypeScript treats them as
  // nominally distinct declarations.
  const keyRow = await resolveApiKey(
    supabase as unknown as Parameters<typeof resolveApiKey>[0],
    orgId,
    'moltsets',
  );
  if (!keyRow?.key_encrypted) return null;
  return {
    token: await decryptApiKey(keyRow.key_encrypted, encryptionKey),
    searchRequestsPerMinute: moltsetsSearchRequestsPerMinute(keyRow.metadata?.plan),
  };
}

function quickenrichDomainRequestsPerMinute(plan: unknown): number {
  return String(plan ?? '').toLowerCase() === 'gtm_unlimited' ? 6_000 : 300;
}

async function getQuickenrichToken(
  supabase: SupabaseClient,
  orgId: string,
  allowHouseFallback: boolean,
): Promise<QuickenrichCredentials | null> {
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;

  // A tenant-owned/inherited key wins. Native ACA signal subscriptions may
  // use the house key so the collector remains credential-free and every
  // tenant does not have to configure the same platform integration.
  const tenantKey = await resolveApiKey(
    supabase as unknown as Parameters<typeof resolveApiKey>[0],
    orgId,
    'quickenrich',
  );
  // Self-hosted installs have no house org (HOUSE_ORG_ID is empty).
  const houseKey = allowHouseFallback && PUBLIC_SIGNALS_ORG_ID
    ? await resolveApiKey(
      supabase as unknown as Parameters<typeof resolveApiKey>[0],
      PUBLIC_SIGNALS_ORG_ID,
      'quickenrich',
    )
    : null;
  const keyRow = tenantKey ?? houseKey;
  if (!keyRow?.key_encrypted) return null;
  return {
    token: await decryptApiKey(keyRow.key_encrypted, encryptionKey),
    sourceOrganizationId: keyRow.source_organization_id,
    domainRequestsPerMinute: quickenrichDomainRequestsPerMinute(keyRow.metadata?.plan),
  };
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

async function getCentralQuickenrichCache(
  supabase: SupabaseClient,
  domain: string,
  maxPeople: number,
): Promise<{ candidates: RankedCandidate[]; waitForCentral: boolean }> {
  const freshAfter = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: people, error: peopleError } = await supabase
    .from('public_signal_people')
    .select('full_name, title, linkedin_url, email, email_status, seniority_rank')
    .eq('source', 'quickenrich')
    .eq('domain', domain)
    .gte('enriched_at', freshAfter)
    .not('email', 'is', null)
    .order('seniority_rank', { ascending: false })
    .limit(maxPeople);

  if (peopleError) {
    console.warn('[dm-scraper] central QuickEnrich cache lookup failed', peopleError);
    return { candidates: [], waitForCentral: true };
  }

  const candidates: RankedCandidate[] = [];
  for (const row of people ?? []) {
    const fullName = String(row.full_name ?? '').trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const linkedin = String(row.linkedin_url ?? '').trim();
    const email = String(row.email ?? '').trim().toLowerCase();
    if (nameParts.length === 0 || !linkedin || !email) continue;

    const title = String(row.title ?? '').trim() || null;
    const tier = title
      ? TIER_1.test(title) ? 1
      : TIER_2.test(title) ? 2
      : TIER_3.test(title) ? 3
      : 4
      : 4;
    candidates.push({
      first_name: nameParts[0],
      last_name: nameParts.slice(1).join(' ') || null,
      title,
      linkedin_url: linkedin,
      tier,
      email,
      email_validation_status: row.email_status === 'verified' ? 'verified' : 'unknown',
    });
  }
  if (candidates.length > 0) return { candidates, waitForCentral: false };

  const { data: state, error: stateError } = await supabase
    .from('public_signal_people_enrichment_state')
    .select('status')
    .eq('domain', domain)
    .order('last_signal_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (stateError) return { candidates: [], waitForCentral: true };

  const terminalWithoutPeople = ['not_found', 'dead', 'complete'].includes(String(state?.status ?? ''));
  return { candidates: [], waitForCentral: !terminalWithoutPeople };
}

async function reserveMoltsetsSearch(
  supabase: SupabaseClient,
  orgId: string,
  requestsPerMinute: number,
): Promise<{ granted: boolean; waitMs: number }> {
  const { data, error } = await supabase.rpc('reserve_enrichment_provider_request', {
    p_organization_id: orgId,
    p_provider: 'moltsets_search',
    p_requests_per_minute: requestsPerMinute,
    p_daily_cap: null,
    p_max_wait_ms: 60_000,
  });
  if (error) {
    console.warn('[dm-scraper] MoltSets search reservation failed', error);
    return { granted: false, waitMs: 0 };
  }
  const reservation = Array.isArray(data) ? data[0] : data;
  return {
    granted: reservation?.reservation_status === 'granted',
    waitMs: Math.max(0, Number(reservation?.wait_ms) || 0),
  };
}

async function reserveQuickenrichDomainSearch(
  supabase: SupabaseClient,
  credentials: QuickenrichCredentials,
): Promise<{ granted: boolean; waitMs: number }> {
  const { data, error } = await supabase.rpc('reserve_enrichment_provider_request', {
    p_organization_id: credentials.sourceOrganizationId,
    p_provider: 'quickenrich_domain_search',
    p_requests_per_minute: credentials.domainRequestsPerMinute,
    p_daily_cap: null,
    p_max_wait_ms: 5_000,
  });
  if (error) return { granted: false, waitMs: 0 };
  const reservation = Array.isArray(data) ? data[0] : data;
  return {
    granted: reservation?.reservation_status === 'granted',
    waitMs: Math.max(0, Number(reservation?.wait_ms) || 0),
  };
}

function quickenrichRows(body: unknown): QuickenrichPerson[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? data as QuickenrichPerson[] : data && typeof data === 'object' ? [data as QuickenrichPerson] : [];
}

async function callQuickenrichDomainSearch(
  supabase: SupabaseClient,
  credentials: QuickenrichCredentials,
  domain: string,
  maxPeople: number,
): Promise<{ people: QuickenrichPerson[]; deferred: boolean }> {
  const people: QuickenrichPerson[] = [];
  for (let page = 1; page <= QUICKENRICH_MAX_PAGES; page++) {
    const reservation = await reserveQuickenrichDomainSearch(supabase, credentials);
    if (!reservation.granted) return { people, deferred: people.length === 0 };
    if (reservation.waitMs > 0) await new Promise((resolve) => setTimeout(resolve, reservation.waitMs));

    const params = new URLSearchParams({
           company_url: domain,
      has_email: '1',
      page: String(page),
    });
    const response = await fetch(`${QUICKENRICH_API_BASE}/employees/dataset-search?${params}`, {
      headers: { Authorization: `Bearer ${credentials.token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) return { people, deferred: people.length === 0 };
    if (response.status === 401 || response.status === 403) throw new Error('quickenrich_authentication_failed');
    if (response.status >= 500) throw new Error(`quickenrich_provider_${response.status}`);
    const body = await response.json().catch(() => ({})) as {
      data?: unknown;
      meta?: { last_page?: number; total?: number; per_page?: number };
    };
    if (!response.ok) return { people, deferred: false };
    const rows = quickenrichRows(body).filter((person) => {
      const returnedDomain = normalizeDomain(person.email_domain ?? person.company_url);
      return !returnedDomain || returnedDomain === domain;
    });
    people.push(...rows);

    const rankedSoFar = rankQuickenrichCandidates(people, '', domain, maxPeople);
    const lastPage = Number(body.meta?.last_page ?? 0);
    if (rankedSoFar.length >= maxPeople || rows.length === 0 || (lastPage > 0 && page >= lastPage)) break;
  }
  return { people, deferred: false };
}

function rankQuickenrichCandidates(
  people: QuickenrichPerson[],
  companyName: string,
  companyDomain: string,
  topN: number,
): RankedCandidate[] {
  const candidates: HarvestCandidate[] = people.flatMap((person) => {
    const returnedDomain = normalizeDomain(person.email_domain ?? person.company_url);
    if (returnedDomain && returnedDomain !== companyDomain) return [];
    const email = person.email?.trim().toLowerCase() ?? null;
    return [{
      firstName: person.first_name ?? undefined,
      lastName: person.last_name ?? undefined,
      fullName: person.full_name ?? person.name ?? undefined,
      jobTitle: person.title ?? undefined,
      linkedinUrl: person.employee_linkedin ?? person.linkedin_url ?? undefined,
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      emailStatus: email && person.email_verification_date ? 'valid' : (email ? 'unknown' : null),
    }];
  });
  return rankCandidates(candidates, companyName, topN)
    .filter((candidate) => candidate.tier <= 3 && !!candidate.linkedin_url);
}

async function persistQuickenrichFirmographics(
  supabase: SupabaseClient,
  item: DmWorkItem,
  domain: string,
  people: QuickenrichPerson[],
): Promise<void> {
  const row = people.find((person) =>
    person.employee_count != null || person.industry || person.revenue) ?? people[0];
  if (!row) return;
  const rawEmployeeCount = String(row.employee_count ?? '').trim();
  const parsed = /^\d+$/.test(rawEmployeeCount) ? Number.parseInt(rawEmployeeCount, 10) : NaN;
  const employeeCount = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  const values = {
    employee_count: employeeCount,
    employee_range: employeeCount == null && rawEmployeeCount ? rawEmployeeCount : null,
    revenue_range: row.revenue?.trim() || null,
    industry: row.industry?.trim() || null,
  };
  await supabase.from('lb_discovered_companies').update({
    employee_count_estimate: values.employee_count,
    revenue_range: values.revenue_range,
  }).eq('id', item.payload.company_id);
  await supabase.from('public_signal_companies').upsert({
    company_key: item.payload.company_name.trim().toLowerCase(),
    domain,
    ...values,
    country: row.country_code?.trim() || null,
    state: row.region_code?.trim() || null,
    city: row.city?.trim() || null,
    source: 'quickenrich',
    enriched_at: new Date().toISOString(),
  }, { onConflict: 'company_key' });
}

async function tryQuickenrich(
  supabase: SupabaseClient,
  item: DmWorkItem,
  maxPeople: number,
  allowHouseFallback: boolean,
): Promise<{ attempted: boolean; deferred: boolean; inserted: number }> {
  const domain = normalizeDomain(item.payload.domain ?? item.payload.website_url);
  if (!domain) return { attempted: false, deferred: false, inserted: 0 };
  const credentials = await getQuickenrichToken(supabase, item.organization_id, allowHouseFallback);
  if (!credentials) return { attempted: false, deferred: false, inserted: 0 };
  const result = await callQuickenrichDomainSearch(supabase, credentials, domain, maxPeople);
  if (result.deferred) return { attempted: false, deferred: true, inserted: 0 };
  await persistQuickenrichFirmographics(supabase, item, domain, result.people);
  const ranked = rankQuickenrichCandidates(result.people, item.payload.company_name, domain, maxPeople);
  if (ranked.length === 0) return { attempted: true, deferred: false, inserted: 0 };
  return {
    attempted: true,
    deferred: false,
    inserted: await insertDms(supabase, item, ranked, 'quickenrich:dataset-search'),
  };
}

function moltsetsPeopleFromResponse(body: unknown): MoltsetsPerson[] {
  if (Array.isArray(body)) return body as MoltsetsPerson[];
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  const candidates = [obj.results, obj.people, obj.data];
  for (const value of candidates) {
    if (Array.isArray(value)) return value as MoltsetsPerson[];
    if (value && typeof value === 'object') {
      const nested = value as Record<string, unknown>;
      if (Array.isArray(nested.people)) return nested.people as MoltsetsPerson[];
      if (Array.isArray(nested.data)) return nested.data as MoltsetsPerson[];
      if (Array.isArray(nested.results)) return nested.results as MoltsetsPerson[];
    }
  }
  return [];
}

async function callMoltsetsPeopleSearch(
  token: string,
  domain: string,
): Promise<MoltsetsPerson[]> {
  try {
    const response = await fetch(`${MOLTSETS_API_BASE}/search_people`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ company_domain: domain, limit: MOLTSETS_SEARCH_LIMIT }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      console.warn(`[dm-scraper] MoltSets people search ${response.status}`);
      return [];
    }
    return moltsetsPeopleFromResponse(body);
  } catch (error) {
    console.warn('[dm-scraper] MoltSets people search failed', error);
    return [];
  }
}

function rankMoltsetsCandidates(
  people: MoltsetsPerson[],
  companyName: string,
  companyDomain: string,
): RankedCandidate[] {
  const candidates: HarvestCandidate[] = people.flatMap((person) => {
    const returnedDomain = normalizeDomain(person.company_domain ?? person.companyDomain);
    // The provider is queried by an exact company_domain; reject any explicit
    // contradictory result rather than trusting a loose company-name match.
    if (returnedDomain && returnedDomain !== companyDomain) return [];
    const fullName = person.full_name ?? person.fullName ?? person.name ?? undefined;
    return [{
      firstName: person.first_name ?? person.firstName ?? undefined,
      lastName: person.last_name ?? person.lastName ?? undefined,
      fullName,
      jobTitle: person.title ?? person.job_title ?? person.jobTitle ?? person.headline ?? undefined,
      linkedinUrl: person.linkedin_url ?? person.linkedinUrl ?? undefined,
    }];
  });
  // MoltSets has already scoped the company. Keep only senior decision makers;
  // tier 4 would admit individual contributors into ACA.
  return rankCandidates(candidates, companyName, MOLTSETS_SEARCH_LIMIT)
    .filter((candidate) => candidate.tier <= 3 && !!candidate.linkedin_url);
}

async function tryMoltsetsFallback(
  supabase: SupabaseClient,
  item: DmWorkItem,
): Promise<{ attempted: boolean; deferred: boolean; inserted: number }> {
  const domain = normalizeDomain(item.payload.domain ?? item.payload.website_url);
  if (!domain) return { attempted: false, deferred: false, inserted: 0 };
  const credentials = await getMoltsetsToken(supabase, item.organization_id);
  if (!credentials) return { attempted: false, deferred: false, inserted: 0 };
  const reservation = await reserveMoltsetsSearch(
    supabase,
    item.organization_id,
    credentials.searchRequestsPerMinute,
  );
  if (!reservation.granted) {
    return { attempted: false, deferred: true, inserted: 0 };
  }
  if (reservation.waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, reservation.waitMs));
  }
  const people = await callMoltsetsPeopleSearch(credentials.token, domain);
  const ranked = rankMoltsetsCandidates(people, item.payload.company_name, domain);
  if (ranked.length === 0) return { attempted: true, deferred: false, inserted: 0 };
  return { attempted: true, deferred: false, inserted: await insertDms(supabase, item, ranked, 'moltsets:search_people') };
}

/**
 * Resolve a company's canonical LinkedIn URL from its domain via
 * s-r/free-linkedin-company-finder. The actor's run-sync-get-dataset-items
 * endpoint completes fast (the actor takes <2s) so sync mode works here.
 * Returns null on failure or no result.
 */
async function resolveLinkedinUrl(token: string, domain: string): Promise<string | null> {
  try {
    const url = `${LINKEDIN_FINDER_SYNC_URL}?token=${token}&format=json`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: [domain], enrichSocials: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;
    const json = await resp.json() as Array<{ linkedin_url?: string | null }>;
    const raw = Array.isArray(json) ? json[0]?.linkedin_url : null;
    if (!raw) return null;
    // Resolver returns country-prefixed URLs (e.g. "https://ao.linkedin.com/...").
    // harvestapi expects the canonical "www" form.
    return raw.replace(/^https?:\/\/[a-z]{2}\.linkedin\.com\//, 'https://www.linkedin.com/');
  } catch (err) {
    console.warn('[dm-scraper] linkedin resolver failed', err);
    return null;
  }
}

/**
 * Call harvestapi via async kickoff + poll. The sync endpoint returns
 * "[]" before the actor finishes scraping so we can't use it. Async
 * kickoff returns a run handle immediately; we poll every 4s until
 * SUCCEEDED then fetch the dataset items.
 *
 * Filter is applied actor-side (seniorityLevelIds, functionIds, jobTitles)
 * — much cheaper than scraping every employee then filtering locally.
 * profileScraperMode controls the depth/cost: 'Full + email search ($12 per 1k)'
 * returns name + title + linkedinUrl + verified email per profile.
 */
async function callHarvestActor(
  token: string,
  linkedinUrl: string,
  filter: DmFilter,
  supabase?: SupabaseClient,
  jobId?: string,
): Promise<HarvestCandidate[]> {
  const log = async (msg: string) => {
    console.log(`[dm-scraper] ${msg}`);
    if (supabase && jobId) {
      await supabase.from('lb_job_logs').insert({
        job_id: jobId, stage: 'dm', level: 'info', message: msg,
      }).then(() => undefined, () => undefined);
    }
  };

  // 0. Diagnostic: identify which Apify account this token corresponds to.
  // When the actor reports "free user run limit exceeded" but the user
  // claims they're on a paid plan, we want to know whose token we're using.
  try {
    const meResp = await fetch(`https://api.apify.com/v2/users/me?token=${token}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (meResp.ok) {
      const meJson = await meResp.json();
      const me = (meJson?.data ?? meJson) as Record<string, unknown>;
      await log(
        `apify account: id=${me.id ?? "?"} username=${me.username ?? "?"} ` +
        `email=${me.email ?? "?"} plan=${(me as { plan?: { id?: string } }).plan?.id ?? "?"} ` +
        `proxyAccess=${(me as { proxy?: { isEnabled?: boolean } }).proxy?.isEnabled ?? "?"}`,
      );
    } else {
      await log(`apify users/me ${meResp.status}: ${(await meResp.text()).slice(0, 200)}`);
    }
  } catch (err) {
    await log(`apify users/me fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1. Kick off the run.
  // Build input body: only include filter arrays when non-empty so the
  // actor's "all" defaults still apply when a user opts not to filter.
  // maxItems acts as a hard cap across the whole run; maxItemsPerCompany
  // caps per-company independently. We use the same value for both since
  // we kick off one company at a time.
  const runInput: Record<string, unknown> = {
    companies: [linkedinUrl],
    maxItems: filter.maxItemsPerCompany,
    maxItemsPerCompany: filter.maxItemsPerCompany,
    profileScraperMode: filter.profileScraperMode,
    companyBatchMode: 'one_by_one',
  };
  if (filter.seniorityLevelIds.length > 0) {
    runInput.seniorityLevelIds = filter.seniorityLevelIds;
  }
  if (filter.functionIds.length > 0) {
    runInput.functionIds = filter.functionIds;
  }
  if (filter.jobTitles.length > 0) {
    runInput.jobTitles = filter.jobTitles;
  }
  await log(
    `harvest input: mode=${filter.profileScraperMode} ` +
      `seniority=[${filter.seniorityLevelIds.join(',')}] ` +
      `functions=[${filter.functionIds.join(',')}] ` +
      `titles=[${filter.jobTitles.join(',')}] ` +
      `maxPerCompany=${filter.maxItemsPerCompany}`,
  );
  const startResp = await fetch(`${APIFY_RUNS_URL}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runInput),
    signal: AbortSignal.timeout(15_000),
  });
  if (!startResp.ok) {
    const txt = await startResp.text().catch(() => '');
    await log(`harvest kickoff ${startResp.status}: ${txt.slice(0, 200)}`);
    return [];
  }
  const startJson = await startResp.json();
  const runId = startJson?.data?.id as string | undefined;
  const datasetId = startJson?.data?.defaultDatasetId as string | undefined;
  if (!runId || !datasetId) {
    await log(`harvest kickoff malformed: ${JSON.stringify(startJson).slice(0, 200)}`);
    return [];
  }
  await log(`harvest kicked off run=${runId} dataset=${datasetId}`);

  // 2. Poll the run until terminal state.
  const deadline = Date.now() + APIFY_RUN_TIMEOUT_MS;
  let finalStatus = 'RUNNING';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, APIFY_POLL_INTERVAL_MS));
    const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!statusResp.ok) continue;
    const statusJson = await statusResp.json();
    finalStatus = (statusJson?.data?.status as string) ?? 'UNKNOWN';
    if (['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'].includes(finalStatus)) break;
  }
  if (finalStatus !== 'SUCCEEDED') {
    await log(`harvest run=${runId} terminal=${finalStatus}`);
    return [];
  }

  // 3. Fetch the dataset.
  const dsResp = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json&clean=true`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!dsResp.ok) {
    await log(`harvest dataset fetch ${dsResp.status}`);
    return [];
  }
  const items = await dsResp.json();
  const arr = Array.isArray(items) ? items : [];

  // If items=0 + run succeeded, the actor bailed out without scraping —
  // typically rental-subscription / account-credit issues. Fetch the run's
  // log so we can see WHY (rental_required, rate_limit, etc.) and persist
  // a preview to lb_job_logs.
  if (arr.length === 0) {
    try {
      const logResp = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/log?token=${token}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const logTxt = await logResp.text();
      const tail = logTxt.length > 800 ? logTxt.slice(-800) : logTxt;
      await log(`harvest run=${runId} succeeded items=0; log tail: ${tail}`);
    } catch {
      await log(`harvest run=${runId} succeeded items=0; log fetch failed`);
    }
  } else {
    await log(`harvest run=${runId} succeeded items=${arr.length}`);
  }

  return arr as HarvestCandidate[];
}

function pickTitle(c: HarvestCandidate): string | null {
  // harvestapi puts the role inside currentPosition[0].position. Older runs
  // used currentPositions[0].title — try both shapes before falling back to
  // headline (which usually reads "Title at Company").
  const live = c.currentPosition?.[0]?.position ?? c.currentPosition?.[0]?.title;
  if (live) return live;
  const legacy = c.currentPositions?.[0]?.title ?? c.currentPositions?.[0]?.position;
  if (legacy) return legacy;
  return c.position ?? c.currentJobTitle ?? c.jobTitle ?? c.headline ?? null;
}

/**
 * Pick the best email + status from the actor's `emails` array. Picks the
 * first non-empty entry — harvestapi orders these by their internal score
 * so position [0] is the candidate they're most confident about.
 *
 * Falls back to the older flat `email` field for compat with Short-mode
 * runs that happen to surface an email (rare).
 */
function pickEmail(c: HarvestCandidate): { email: string | null; status: string | null; catchAll: boolean } {
  const arr = c.emails ?? [];
  const first = arr.find((e) => e?.email);
  if (first?.email) {
    return {
      email: first.email,
      status: first.status ?? null,
      catchAll: first.catchAllDomain === true,
    };
  }
  if (c.email) {
    return {
      email: c.email,
      status: c.emailStatus ?? c.emailValidationStatus ?? null,
      catchAll: false,
    };
  }
  return { email: null, status: null, catchAll: false };
}

function pickLinkedinUrl(c: HarvestCandidate): string | null {
  if (c.linkedinUrl) return c.linkedinUrl;
  if (c.profileUrl) return c.profileUrl;
  if (c.url) return c.url;
  if (c.publicIdentifier) return `https://www.linkedin.com/in/${c.publicIdentifier}`;
  return null;
}

function splitFullName(full: string): { first: string; last: string | null } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0) return { first: '', last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function rankCandidates(
  candidates: HarvestCandidate[],
  companyName: string,
  topN: number,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const c of candidates) {
    let first = (c.firstName ?? '').trim();
    let last = (c.lastName ?? '').trim();
    if (!first && c.fullName) {
      const split = splitFullName(c.fullName);
      first = split.first;
      last = split.last ?? '';
    }
    if (!isPlausibleHumanName(first, last || null, companyName)) continue;

    const title = pickTitle(c);
    const tier = title
      ? TIER_1.test(title) ? 1
      : TIER_2.test(title) ? 2
      : TIER_3.test(title) ? 3
      : 4
      : 4;

    const emailInfo = pickEmail(c);
    ranked.push({
      first_name: first,
      last_name: last || null,
      title,
      linkedin_url: pickLinkedinUrl(c),
      tier,
      email: emailInfo.email,
      email_validation_status: emailInfo.status,
    });
  }
  ranked.sort((a, b) => a.tier - b.tier);
  return ranked.slice(0, topN);
}

/**
 * Map harvestapi validation status to lb_email_verifications.status.
 * Schema enum: verified / catch_all / not_found / retry / pending.
 *
 * - valid / verified / deliverable → verified
 * - risky / catch_all / accept_all → catch_all
 * - invalid / undeliverable → not_found
 * - unknown / null / anything else → retry
 */
function mapEmailStatus(raw: string | null): {
  status: 'verified' | 'catch_all' | 'not_found' | 'retry';
  catch_all: boolean;
} {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('valid') && !s.includes('invalid')) return { status: 'verified', catch_all: false };
  if (s === 'verified' || s === 'deliverable') return { status: 'verified', catch_all: false };
  if (s.includes('catch') || s.includes('accept_all') || s === 'risky') {
    return { status: 'catch_all', catch_all: true };
  }
  if (s.includes('invalid') || s.includes('undeliver')) {
    return { status: 'not_found', catch_all: false };
  }
  return { status: 'retry', catch_all: false };
}

async function processItem(supabase: SupabaseClient, item: DmWorkItem): Promise<{
  ok: boolean;
  reason?: string;
  dms_inserted?: number;
}> {
  const { payload } = item;
  let linkedinUrl: string | null = payload.linkedin_url;
  // Per-sub filter (seniority, function, jobTitles, profileScraperMode).
  // Falls back to senior-only Full+email defaults when the sub doesn't have
  // a dm_filter key yet — keeps existing subs auto-upgraded.
  const { filter, allowHouseQuickenrich } = await loadDmSettings(supabase, item.job_id);

  const maxPeople = Math.min(TOP_DMS_PER_COMPANY, Math.max(1, filter.maxItemsPerCompany));
  const companyDomain = normalizeDomain(payload.domain ?? payload.website_url);

  // ACA-native subscriptions never call the house QuickEnrich key from this
  // worker. The central signal queue owns that paid lookup once per domain;
  // list jobs reuse its 30-day cache or wait for its durable result/negative
  // cache. This removes the second paid lane and its cross-cron race entirely.
  if (allowHouseQuickenrich && companyDomain) {
    const central = await getCentralQuickenrichCache(supabase, companyDomain, maxPeople);
    if (central.candidates.length > 0) {
      const inserted = await insertDms(
        supabase,
        item,
        central.candidates,
        'quickenrich:central-cache',
      );
      await completeItem(supabase, item.id, true, null);
      return { ok: true, reason: 'quickenrich_central_cache', dms_inserted: inserted };
    }
    if (central.waitForCentral) {
      await releaseItemForProviderWait(supabase, item.id, 'quickenrich_central_cache');
      return { ok: true, reason: 'quickenrich_central_pending', dms_inserted: 0 };
    }
  }

  // Non-native jobs may use a tenant-owned QuickEnrich key. Their claims are
  // atomic, and the shared provider namespace serializes calls per key owner.
  if (!allowHouseQuickenrich) {
    const quickenrich = await tryQuickenrich(supabase, item, maxPeople, false);
    if (quickenrich.deferred) {
      await releaseItemForProviderWait(supabase, item.id, 'quickenrich_domain_search');
      return { ok: true, reason: 'quickenrich_rate_wait', dms_inserted: 0 };
    }
    if (quickenrich.inserted > 0) {
      await completeItem(supabase, item.id, true, null);
      return { ok: true, reason: 'quickenrich_domain_search', dms_inserted: quickenrich.inserted };
    }
  }

  // ============================================================================
  // Resolve a missing LinkedIn URL from the company's domain via the
  // s-r/free-linkedin-company-finder Apify actor. Triggered when SignalBase
  // hiring records arrive without companyLinkedinUrl (which they always do —
  // the actor returns it for funding/job-changes but not for hiring).
  // ============================================================================
  if (!linkedinUrl && (payload.domain || payload.website_url)) {
    const token = await getApifyToken(supabase, item.organization_id);
    const domain = payload.domain ?? new URL(payload.website_url!).hostname.replace(/^www\./, '');
    if (token && domain) {
      const resolved = await resolveLinkedinUrl(token, domain);
      if (resolved) {
        linkedinUrl = resolved;
        // Persist back so subsequent stages and the UI see the URL.
        await supabase
          .from('lb_discovered_companies')
          .update({ linkedin_url: resolved })
          .eq('id', payload.company_id);
        await supabase.from('lb_job_logs').insert({
          job_id: item.job_id,
          stage: 'dm',
          level: 'info',
          message: `resolved linkedin_url for ${payload.company_name}: ${resolved}`,
        }).then(() => undefined, () => undefined);
      }
    }
  }

  if (!linkedinUrl) {
    // An exact-domain MoltSets search does not need the company's LinkedIn
    // URL. Prefer it before a website crawl, and preserve the work item when
    // its shared search lane is occupied instead of losing the company.
    const moltsets = await tryMoltsetsFallback(supabase, item);
    if (moltsets.deferred) {
      await releaseItemForProviderWait(supabase, item.id, 'moltsets_search');
      return { ok: true, reason: 'moltsets_search_rate_wait', dms_inserted: 0 };
    }
    if (moltsets.attempted) {
      await completeItem(supabase, item.id, true, moltsets.inserted > 0 ? null : 'moltsets_returned_zero');
      return {
        ok: true,
        reason: moltsets.inserted > 0 ? 'moltsets_search' : 'moltsets_returned_zero',
        dms_inserted: moltsets.inserted,
      };
    }
    // Still no LinkedIn URL → fall through to the legacy Fly Playwright endpoint
    // as a last resort. If we don't even have a website_url, give up.
    if (!payload.website_url) {
      // No scrape target ever — mark dead so recover/rerun stop re-enqueueing.
      await markDmDead(supabase, payload.company_id, 'no_linkedin_no_website');
      await completeItem(supabase, item.id, true, 'no_linkedin_no_website');
      return { ok: true, reason: 'no_linkedin_no_website', dms_inserted: 0 };
    }
    if (!FLY_SCRAPER_URL) {
      await completeItem(supabase, item.id, true, 'no_linkedin_resolver_failed');
      return { ok: true, reason: 'no_linkedin_resolver_failed', dms_inserted: 0 };
    }
    try {
      const res = await fetch(`${FLY_SCRAPER_URL}/scrape-dms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website_url: payload.website_url }),
        signal: AbortSignal.timeout(APIFY_RUN_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`fly ${res.status}`);
      const data = (await res.json()) as { candidates?: HarvestCandidate[] };
      const candidates = data.candidates ?? [];
      const ranked = rankCandidates(candidates, payload.company_name, TOP_DMS_PER_COMPANY);
      const inserted = await insertDms(supabase, item, ranked);
      await completeItem(supabase, item.id, true, null);
      return { ok: true, dms_inserted: inserted };
    } catch (err) {
      console.warn('[dm-scraper] fly fallback failed', err);
      await completeItem(supabase, item.id, true, 'fly_fallback_failed');
      return { ok: true, reason: 'fly_fallback_failed', dms_inserted: 0 };
    }
  }

  // Primary path: LinkedIn-via-Apify.
  const token = await getApifyToken(supabase, item.organization_id);
  if (!token) {
    const moltsets = await tryMoltsetsFallback(supabase, item);
    if (moltsets.deferred) {
      await releaseItemForProviderWait(supabase, item.id, 'moltsets_search');
      return { ok: true, reason: 'moltsets_search_rate_wait', dms_inserted: 0 };
    }
    if (moltsets.attempted) {
      await completeItem(supabase, item.id, true, moltsets.inserted > 0 ? null : 'moltsets_returned_zero');
      return {
        ok: true,
        reason: moltsets.inserted > 0 ? 'moltsets_search' : 'moltsets_returned_zero',
        dms_inserted: moltsets.inserted,
      };
    }
    await completeItem(supabase, item.id, false, 'no_apify_token');
    return { ok: false, reason: 'no_apify_token' };
  }

  // Count this attempt BEFORE the harvest call so a crash mid-run still
  // counts against the cap (otherwise a perma-failing company that always
  // crashes the worker would never accumulate attempts).
  const attemptCount = await markDmAttempt(supabase, payload.company_id);

  const candidates = await callHarvestActor(token, linkedinUrl, filter, supabase, item.job_id);
  if (candidates.length === 0) {
    const moltsets = await tryMoltsetsFallback(supabase, item);
    if (moltsets.deferred) {
      await releaseItemForProviderWait(supabase, item.id, 'moltsets_search');
      return { ok: true, reason: 'moltsets_search_rate_wait', dms_inserted: 0 };
    }
    if (moltsets.inserted > 0) {
      await completeItem(supabase, item.id, true, null);
      return { ok: true, reason: 'moltsets_search', dms_inserted: moltsets.inserted };
    }
    // Could be a private company page, an actor-side rate limit, or a
    // genuinely no-employee company. Mark complete so we don't loop on it.
    // After 3 zero-result attempts, mark the company dead so the recover/
    // rerun paths stop re-enqueueing it forever.
    if (attemptCount >= 3) {
      await markDmDead(supabase, payload.company_id, 'apify_returned_zero_x3');
    }
    await completeItem(supabase, item.id, true, 'apify_returned_zero');
    return { ok: true, reason: 'apify_returned_zero', dms_inserted: 0 };
  }

  // For Full+email mode the actor already applied the filter, so we trust
  // its ranking and just dedupe to maxItemsPerCompany. rankCandidates still
  // applies the seniority tiers — useful when the sub is on Short mode or
  // when the actor returns more rows than maxItemsPerCompany due to caching.
  const ranked = rankCandidates(candidates, payload.company_name, filter.maxItemsPerCompany);
  if (ranked.length === 0) {
    await completeItem(supabase, item.id, true, 'all_candidates_filtered');
    return { ok: true, reason: 'all_candidates_filtered', dms_inserted: 0 };
  }

  const inserted = await insertDms(supabase, item, ranked);
  await completeItem(supabase, item.id, true, null);
  return { ok: true, dms_inserted: inserted };
}

async function insertDms(
  supabase: SupabaseClient,
  item: DmWorkItem,
  ranked: RankedCandidate[],
  sourcePageOverride?: string,
): Promise<number> {
  if (ranked.length === 0) return 0;
  // Mark the source as harvestapi-full when ANY row has an email — useful for
  // diagnostics ("which path inserted these DMs?"). Per-row source matters
  // less since we also write a per-row email verification when applicable.
  const hasAnyEmail = ranked.some((r) => !!r.email);
  const sourcePage = sourcePageOverride ?? (hasAnyEmail
    ? 'apify:harvestapi-linkedin-full-email'
    : 'apify:harvestapi-linkedin');
  const rows = ranked.map((r) => ({
    job_id: item.job_id,
    organization_id: item.organization_id,
    company_id: item.payload.company_id,
    first_name: r.first_name,
    last_name: r.last_name,
    title: r.title,
    linkedin_url: r.linkedin_url,
    source_page: sourcePage,
    confidence: 4 - r.tier, // tier 1 → conf 3, tier 4 → conf 0
    name_flags: {},
  }));
  // Upsert because (company_id, linkedin_url) is now UNIQUE (migration
  // 20260605140000). Re-running the scraper against a company already
  // scraped before would have thrown unique-violation under plain insert;
  // upsert with ignoreDuplicates skips the existing row and keeps the
  // newly-arrived data only when it's a fresh person. This matches the
  // dedup intent (one DM per company+linkedin_url).
  const { data: inserted, error } = await supabase
    .from('lb_decision_makers')
    .upsert(rows, { onConflict: 'company_id,linkedin_url', ignoreDuplicates: false })
    .select('id, first_name, last_name');
  if (error) {
    console.warn('[dm-scraper] lb_decision_makers upsert failed', error);
    return 0;
  }
  const ins = (inserted ?? []) as Array<{ id: string; first_name: string; last_name: string | null }>;

  // Pair each inserted DM with its source RankedCandidate so we can decide
  // per-row whether to write an email verification or fall through to the
  // pattern engine. Insert order matches input order, so we zip by index.
  const dmsWithEmail: Array<{
    dm_id: string;
    email: string;
    status: string | null;
  }> = [];
  const dmsForPattern: Array<{ dm_id: string; first_name: string; last_name: string }> = [];
  for (let i = 0; i < ins.length; i++) {
    const dm = ins[i];
    const cand = ranked[i];
    if (cand?.email) {
      dmsWithEmail.push({
        dm_id: dm.id,
        email: cand.email,
        status: cand.email_validation_status,
      });
    } else {
      dmsForPattern.push({
        dm_id: dm.id,
        first_name: dm.first_name,
        last_name: dm.last_name ?? '',
      });
    }
  }
  // One-line audit so we can see at a glance whether Full+email mode pulled
  // emails for this batch. If hasAnyEmail=true but dmsWithEmail.length=0
  // something is wrong with the pickEmail extraction.
  await supabase.from('lb_job_logs').insert({
    job_id: item.job_id,
    stage: 'dm',
    level: 'info',
    message:
      `dms_inserted=${ins.length} with_email=${dmsWithEmail.length} ` +
      `pattern_fallback=${dmsForPattern.length}`,
  }).then(() => undefined, () => undefined);

  // 1. Write lb_email_verifications directly for harvestapi-validated emails.
  // The export runner picks these up just like Fly-verified rows, but they
  // skip the pattern→smtp guess-and-check entirely. pattern='apify:harvestapi'
  // tells downstream code that this email came pre-validated.
  if (dmsWithEmail.length > 0) {
    const verifyRows = dmsWithEmail.map((d) => {
      const mapped = mapEmailStatus(d.status);
      return {
        dm_id: d.dm_id,
        job_id: item.job_id,
        organization_id: item.organization_id,
        email: d.email,
        status: mapped.status,
        pattern: 'apify:harvestapi',
        tier: 1,
        attempts: 1,
        catch_all: mapped.catch_all,
        smtp_response_code: null,
        verified_at: new Date().toISOString(),
      };
    });
    const { error: vErr } = await supabase.from('lb_email_verifications').insert(verifyRows);
    if (vErr) {
      console.warn('[dm-scraper] lb_email_verifications insert failed', vErr);
    } else {
      // Persist a one-line audit so we can see harvestapi emails landing
      // without grepping logs. Best-effort, swallow errors.
      await supabase.from('lb_job_logs').insert({
        job_id: item.job_id,
        stage: 'dm',
        level: 'info',
        message: `inserted ${verifyRows.length} pre-verified emails (apify:harvestapi)`,
      }).then(() => undefined, () => undefined);
      // The scheduled exporter remains the recovery path; this wake-up makes
      // verified leads eligible for CRM/list/enrollment processing immediately.
      triggerSignalExport(supabase, item.payload.company_id);
    }
  }

  // 2. Fall through to legacy pattern→smtp chain ONLY for DMs the actor
  // returned without an email (private profile, very new hire, etc.).
  // Requires a domain — when missing, the export runner will simply skip
  // these DMs at composition time.
  if (item.payload.domain && dmsForPattern.length > 0) {
    const patternItems = dmsForPattern.map((dm) => ({
      job_id: item.job_id,
      organization_id: item.organization_id,
      stage: 'pattern' as const,
      payload: {
        dm_id: dm.dm_id,
        company_id: item.payload.company_id,
        domain: item.payload.domain,
        first_name: dm.first_name,
        last_name: dm.last_name,
      },
      priority: 5,
    }));
    await supabase.from('lb_work_items').insert(patternItems);
  }

  // Bump found_dms counter on the parent job. RPC may fail if the job is in
  // failed state; swallow.
  await supabase.rpc('increment_lb_found_dms', { p_job_id: item.job_id }).then(
    () => undefined,
    () => undefined,
  );

  return ins.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // The pg_cron job sends the service-role key; the app also kicks this with a
    // signed-in user's JWT for faster feedback. It only works the shared queue, so
    // any signed-in caller may poke it, but not the public anon key.
    if (!isServiceRoleRequest(req)) {
      try {
        await authenticateRequest(req, supabase);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
    }

    const items = await claimDmItems(supabase, BATCH_SIZE);
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, claimed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let processed = 0;
    let dms_total = 0;
    let failures = 0;
    const reasons: Record<string, number> = {};
    // Process up to 5 items in parallel — Apify caps concurrent runs per
    // token at modest levels, so we don't fan out too aggressively.
    const CONCURRENCY = 5;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const chunk = items.slice(i, i + CONCURRENCY);
      const results = await Promise.all(chunk.map((it) => processItem(supabase, it)));
      for (const r of results) {
        processed += 1;
        if (r.ok) {
          dms_total += r.dms_inserted ?? 0;
          if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        } else {
          failures += 1;
          if (r.reason) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
        }
      }
    }

    console.log(
      `[dm-scraper] claimed=${items.length} processed=${processed} dms=${dms_total} failures=${failures} reasons=${JSON.stringify(reasons)}`,
    );

    // Also persist a debug snapshot to lb_job_logs so we can inspect what
    // happened from a SQL query (edge logs aren't surfacing reliably).
    if (items.length > 0) {
      await supabase.from('lb_job_logs').insert({
        job_id: items[0].job_id,
        stage: 'dm',
        level: 'info',
        message: `dm-scraper batch: claimed=${items.length} dms=${dms_total} reasons=${JSON.stringify(reasons)}`,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        claimed: items.length,
        processed,
        dms_inserted: dms_total,
        failures,
        reasons,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[dm-scraper] fatal', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
