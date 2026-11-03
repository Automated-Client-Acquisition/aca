/**
 * List Building Verifier Worker — Fly.io
 *
 * Polls lb_work_items for stage='smtp' (and optionally 'pattern' and 'icp'),
 * processes batches using per-MX connection pools, and enqueues the next
 * stage's items via the list-building-enqueue-next edge function.
 */

import http from 'node:http';
import dns from 'node:dns/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MxPool } from './mx-pool.js';
import { startHeartbeat } from './heartbeat.js';
import { ProxyShard } from './proxy-shard.js';
import { generatePermutations, runPatternBatch, type PatternPayload } from './permutation-worker.js';
import { scoreIcp, writeEnrichedLead, type IcpPayload } from './icp-worker.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const WORKER_STAGES = (process.env.WORKER_STAGES || 'discovery,dm,enrich,pattern,smtp,icp')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// The list-building-scraper worker. ACA Cloud sets it in fly.toml; self-hosters set
// their own. Without it the scrape stages (discovery, dm, enrich) can't run.
const SCRAPER_URL = (process.env.LIST_BUILDING_SCRAPER_URL || '').replace(/\/+$/, '');
const WORKER_ID = process.env.FLY_ALLOC_ID || `verifier-${Math.random().toString(36).slice(2, 10)}`;
const HELO_DOMAIN = process.env.HELO_DOMAIN || 'verify.aca.internal';
const MAIL_FROM = process.env.MAIL_FROM || 'verify@verify.aca.internal';

if (!SCRAPER_URL) {
  console.warn('[verifier] LIST_BUILDING_SCRAPER_URL is not set: scrape stages (discovery, dm, enrich) will fail');
}

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[verifier] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const stats = {
  startedAt: Date.now(),
  completedItems: 0,
  failedItems: 0,
  inFlight: 0,
  lastThroughputWindowStart: Date.now(),
  recentCompletions: 0,
  throughputPerSec: 0,
  currentJobId: null as string | null,
};

let shuttingDown = false;
let pool: MxPool | null = null;
const proxyShard = new ProxyShard(supabase, WORKER_ID);

// ============================================================================
// MX cache
// ============================================================================
const mxCache = new Map<string, string>();
async function resolveMx(domain: string): Promise<string | null> {
  const hit = mxCache.get(domain);
  if (hit) return hit;
  try {
    const records = await dns.resolveMx(domain);
    records.sort((a, b) => a.priority - b.priority);
    const host = records[0]?.exchange ?? null;
    if (host) mxCache.set(domain, host);
    return host;
  } catch {
    return null;
  }
}

// ============================================================================
// Queue helpers
// ============================================================================
interface WorkItem {
  id: number;
  job_id: string;
  organization_id: string;
  stage: string;
  payload: Record<string, unknown>;
}

async function claim(stage: string, batchSize: number): Promise<WorkItem[]> {
  const { data, error } = await supabase.rpc('claim_lb_work_items', {
    p_worker_id: WORKER_ID,
    p_stage: stage,
    p_batch_size: batchSize,
  });
  if (error) {
    console.warn('[verifier] claim failed', error);
    return [];
  }
  return (data ?? []) as WorkItem[];
}

async function complete(itemId: number, ok: boolean, err: string | null): Promise<void> {
  const { error } = await supabase.rpc('complete_lb_work_item', {
    p_item_id: itemId,
    p_ok: ok,
    p_err: err,
  });
  if (error) console.warn('[verifier] complete failed', error);
}

// ============================================================================
// Stage processors
// ============================================================================
async function processSmtpBatch(items: WorkItem[]): Promise<void> {
  if (!pool) return;
  // Flatten: each item holds a single candidate email.
  await Promise.all(items.map(async (item) => {
    stats.inFlight++;
    try {
      const payload = item.payload as {
        domain: string;
        email: string;
        pattern: string;
        company_id: string;
        first_name: string;
        last_name: string;
        tier: number;
      };
      const mx = await resolveMx(payload.domain);
      if (!mx) {
        await complete(item.id, true, null); // treat as terminal skip
        return;
      }
      const result = await pool!.verify(mx, payload.email);

      // Map RcptResult.kind to the canonical lb_email_verifications.status enum.
      const status =
        result.kind === 'ok' ? 'verified'
        : result.kind === 'rejected' ? 'not_found'
        : result.kind === 'rate_limited' ? 'retry'
        : 'failed';

      // Look up the DM row by (company, name). The pattern-stage payload
      // doesn't carry dm_id, so we resolve it here. This is one extra round
      // trip per item but lb_decision_makers has an index on company_id and
      // we typically deal with <50 candidates per company.
      const { data: dmRow } = await supabase
        .from('lb_decision_makers')
        .select('id')
        .eq('company_id', payload.company_id)
        .eq('first_name', payload.first_name)
        .eq('last_name', payload.last_name)
        .order('created_at', { ascending: false })
        .limit(1);
      const dmId = (dmRow?.[0] as { id?: string } | undefined)?.id;

      if (dmId) {
        // Write to the canonical lb_email_verifications. Replaces the previous
        // best-effort write to lb_verified_emails (which never existed in this
        // project's schema and silently no-op'd on every smtp item).
        const { error: insErr } = await supabase.from('lb_email_verifications').insert({
          dm_id: dmId,
          job_id: item.job_id,
          organization_id: item.organization_id,
          email: payload.email,
          pattern: payload.pattern,
          tier: payload.tier,
          status,
          smtp_response_code: result.code || null,
          catch_all: false,
          attempts: 1,
          error: result.kind === 'error' ? result.raw : null,
        });
        if (insErr) {
          // Don't fail the work item — log and continue. The audit trail loss
          // is preferable to keeping the queue stuck.
          console.warn('[verifier] lb_email_verifications insert failed', insErr.message);
        }
      } else {
        console.warn(
          '[verifier] no dm_id resolved for company=%s name=%s %s; skipping ev row',
          payload.company_id, payload.first_name, payload.last_name,
        );
      }

      if (result.kind === 'ok') {
        // Enqueue the icp stage for this lead (minimal payload — the icp
        // worker will join against company/contact tables to hydrate).
        await fetch(`${SUPABASE_URL}/functions/v1/list-building-enqueue-next`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            job_id: item.job_id,
            stage: 'icp',
            payloads: [{
              company_id: payload.company_id,
              verified_email: payload.email,
              first_name: payload.first_name,
              last_name: payload.last_name,
            }],
          }),
        }).catch(() => {});
      }
      await complete(item.id, true, null);
      stats.completedItems++;
      stats.recentCompletions++;
    } catch (err) {
      stats.failedItems++;
      await complete(item.id, false, err instanceof Error ? err.message : String(err));
    } finally {
      stats.inFlight--;
    }
  }));
}

async function processPatternBatch(items: WorkItem[]): Promise<void> {
  const shaped = items.map((i) => ({
    id: i.id,
    job_id: i.job_id,
    payload: i.payload as unknown as PatternPayload,
  }));
  try {
    await runPatternBatch(
      supabase,
      `${SUPABASE_URL}/functions/v1`,
      SERVICE_KEY,
      shaped,
    );
    for (const item of items) {
      await complete(item.id, true, null);
      stats.completedItems++;
      stats.recentCompletions++;
    }
  } catch (err) {
    for (const item of items) {
      stats.failedItems++;
      await complete(item.id, false, err instanceof Error ? err.message : String(err));
    }
  }
}

// ---------------------------------------------------------------------------
// Stage: discovery
// Call the scraper worker, insert companies, enqueue one dm item per company.
// ---------------------------------------------------------------------------
async function processDiscoveryBatch(items: WorkItem[]): Promise<void> {
  for (const item of items) {
    stats.inFlight++;
    try {
      const payload = item.payload as {
        query: { niche: string; geo: string; sources?: string[]; limit?: number };
      };
      const res = await fetch(`${SCRAPER_URL}/scrape-companies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: {
            niche: payload.query?.niche ?? '',
            geo: payload.query?.geo ?? '',
            sources: payload.query?.sources ?? ['google_maps', 'google_search', 'directory'],
            limit: payload.query?.limit ?? 50,
          },
        }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`scraper ${res.status}`);
      const data = (await res.json()) as { companies?: Array<Record<string, unknown>> };
      const companies = data.companies ?? [];

      if (companies.length === 0) {
        await supabase
          .from('list_building_jobs')
          .update({ total_companies: 0, updated_at: new Date().toISOString() })
          .eq('id', item.job_id);
        await complete(item.id, true, null);
        continue;
      }

      const rows = companies.map((c) => ({
        job_id: item.job_id,
        organization_id: item.organization_id,
        company_name: (c.company_name as string) ?? (c.name as string) ?? 'Unknown',
        domain: (c.domain as string) ?? null,
        website_url: (c.website_url as string) ?? null,
        linkedin_url: (c.linkedin_url as string) ?? null,
        phone: (c.phone as string) ?? null,
        address: (c.address as string) ?? null,
        city: (c.city as string) ?? null,
        state: (c.state as string) ?? null,
        country: (c.country as string) ?? null,
        employee_signal: (c.employee_signal as string) ?? null,
        source: (c.source as string) ?? 'google_search',
        raw_html_snippet: (c.raw_html_snippet as string) ?? null,
      }));
      // Upsert to dedup re-discovered companies on (organization_id, linkedin_url).
      // The non-partial unique index treats NULL linkedin_url as distinct, so
      // domain-only rows still insert as new each time.
      const { data: inserted } = await supabase
        .from('lb_discovered_companies')
        .upsert(rows, {
          onConflict: 'organization_id,linkedin_url',
          ignoreDuplicates: false,
        })
        .select('id, domain, website_url, company_name, linkedin_url');

      await supabase
        .from('list_building_jobs')
        .update({
          total_companies: companies.length,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.job_id);

      const dmPayloads = (inserted ?? []).map((c) => ({
        company_id: c.id,
        domain: c.domain,
        website_url: c.website_url,
        linkedin_url: c.linkedin_url,
        company_name: c.company_name,
      }));
      if (dmPayloads.length > 0) {
        const dmRows = dmPayloads.map((p) => ({
          job_id: item.job_id,
          organization_id: item.organization_id,
          stage: 'dm',
          payload: p,
          priority: 5,
        }));
        await supabase.from('lb_work_items').insert(dmRows);
      }

      // Enqueue enrich work items for companies with domains (runs in
      // parallel with DM scraping - independent pipeline branch).
      const enrichPayloads = (inserted ?? [])
        .filter((c) => c.domain)
        .map((c) => ({
          job_id: item.job_id,
          organization_id: item.organization_id,
          stage: 'enrich',
          payload: {
            company_id: c.id,
            domain: c.domain,
            job_id: item.job_id,
            organization_id: item.organization_id,
          },
          priority: 3,
        }));
      if (enrichPayloads.length > 0) {
        await supabase.from('lb_work_items').insert(enrichPayloads);
      }

      await complete(item.id, true, null);
      stats.completedItems++;
      stats.recentCompletions++;
    } catch (err) {
      stats.failedItems++;
      await complete(item.id, false, err instanceof Error ? err.message : String(err));
    } finally {
      stats.inFlight--;
    }
  }
}

// ---------------------------------------------------------------------------
// Stage: dm
// Call scraper worker /scrape-dms, take the first candidate, insert row,
// enqueue pattern stage item.
// ---------------------------------------------------------------------------
async function processDmBatch(items: WorkItem[]): Promise<void> {
  await Promise.all(items.map(async (item) => {
    stats.inFlight++;
    try {
      const payload = item.payload as {
        company_id: string;
        domain: string | null;
        website_url: string | null;
        linkedin_url: string | null;
        company_name: string;
        person_hint?: {
          first?: string;
          last?: string;
          title?: string;
          linkedin_url?: string;
        } | null;
        signal_type?: string | null;
      };
      const hinted = payload.person_hint;
      if (hinted?.first) {
        const firstName = hinted.first.trim();
        const lastName = (hinted.last ?? '').trim();
        if (!firstName) {
          await complete(item.id, true, null);
          return;
        }
        const { data: dmRow } = await supabase
          .from('lb_decision_makers')
          .insert({
            job_id: item.job_id,
            organization_id: item.organization_id,
            company_id: payload.company_id,
            first_name: firstName,
            last_name: lastName || null,
            title: hinted.title ?? null,
            linkedin_url: hinted.linkedin_url ?? null,
            source_page: hinted.linkedin_url ?? payload.linkedin_url ?? null,
            confidence: 92,
            name_flags: { source: 'signalbase_person_hint', signal_type: payload.signal_type ?? null },
          })
          .select('id')
          .single();
        await supabase
          .from('list_building_jobs')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', item.job_id);
        await supabase.rpc('increment_lb_found_dms', { p_job_id: item.job_id }).then(
          () => {},
          () => {},
        );
        if (dmRow && payload.domain) {
          await supabase.from('lb_work_items').insert({
            job_id: item.job_id,
            organization_id: item.organization_id,
            stage: 'pattern',
            payload: {
              dm_id: dmRow.id,
              company_id: payload.company_id,
              domain: payload.domain,
              first_name: firstName,
              last_name: lastName,
            },
            priority: 6,
          });
        }
        await complete(item.id, true, null);
        stats.completedItems++;
        stats.recentCompletions++;
        return;
      }
      if (!payload.website_url) {
        await complete(item.id, true, null);
        return;
      }
      const res = await fetch(`${SCRAPER_URL}/scrape-dms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          website_url: payload.website_url,
          linkedin_url: payload.linkedin_url,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`scraper ${res.status}`);
      const data = (await res.json()) as { candidates?: Array<Record<string, unknown>> };
      const candidates = data.candidates ?? [];
      if (candidates.length === 0) {
        await complete(item.id, true, null);
        return;
      }
      // Simple rank: prefer candidates whose title looks like a DM.
      const dmKeywords = /(ceo|founder|owner|president|vp|vice|director|head|chief|partner)/i;
      candidates.sort((a, b) => {
        const at = ((a.title as string) || '').match(dmKeywords) ? 1 : 0;
        const bt = ((b.title as string) || '').match(dmKeywords) ? 1 : 0;
        return bt - at;
      });
      const best = candidates[0];
      const firstName = ((best.first_name as string) || '').trim();
      const lastName = ((best.last_name as string) || '').trim();
      if (!firstName) {
        await complete(item.id, true, null);
        return;
      }
      const { data: dmRow } = await supabase
        .from('lb_decision_makers')
        .insert({
          job_id: item.job_id,
          organization_id: item.organization_id,
          company_id: payload.company_id,
          first_name: firstName,
          last_name: lastName || null,
          title: (best.title as string) ?? null,
          linkedin_url: (best.linkedin_url as string) ?? null,
          source_page: (best.source_page as string) ?? null,
          confidence: (best.confidence as number) ?? null,
          name_flags: {},
        })
        .select('id')
        .single();
      await supabase
        .from('list_building_jobs')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', item.job_id);
      await supabase.rpc('increment_lb_found_dms', { p_job_id: item.job_id }).then(
        () => {},
        () => {},
      );
      if (dmRow && payload.domain) {
        await supabase.from('lb_work_items').insert({
          job_id: item.job_id,
          organization_id: item.organization_id,
          stage: 'pattern',
          payload: {
            dm_id: dmRow.id,
            company_id: payload.company_id,
            domain: payload.domain,
            first_name: firstName,
            last_name: lastName,
          },
          priority: 5,
        });
      }
      await complete(item.id, true, null);
      stats.completedItems++;
      stats.recentCompletions++;
    } catch (err) {
      stats.failedItems++;
      await complete(item.id, false, err instanceof Error ? err.message : String(err));
    } finally {
      stats.inFlight--;
    }
  }));
}

async function processIcpBatch(items: WorkItem[]): Promise<void> {
  if (!OPENROUTER_API_KEY) {
    for (const item of items) await complete(item.id, false, 'OPENROUTER_API_KEY not set');
    return;
  }
  await Promise.all(items.map(async (item) => {
    stats.inFlight++;
    try {
      const payload = item.payload as unknown as IcpPayload;
      const result = await scoreIcp(OPENROUTER_API_KEY, payload);
      await writeEnrichedLead(supabase, payload, result);
      await complete(item.id, true, null);
      stats.completedItems++;
      stats.recentCompletions++;
    } catch (err) {
      stats.failedItems++;
      await complete(item.id, false, err instanceof Error ? err.message : String(err));
    } finally {
      stats.inFlight--;
    }
  }));
}

// ---------------------------------------------------------------------------
// Stage: enrich
// Calls scraper /enrich-domains, upserts into lb_domain_index, backfills
// lb_discovered_companies with location/phone/employee data.
// ---------------------------------------------------------------------------
interface EnrichedDomainResult {
  domain: string;
  title: string | null;
  meta_description: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address_raw: string | null;
  phone: string | null;
  email: string | null;
  tech_stack: string[];
  industry_keywords: string[];
  schema_org_type: string | null;
  employee_signal: string | null;
}

async function processEnrichBatch(items: WorkItem[]): Promise<void> {
  // Batch domains together (up to 10 at a time to the scraper)
  const CHUNK_SIZE = 10;
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const domains = chunk
      .map((item) => (item.payload as { domain?: string }).domain)
      .filter((d): d is string => !!d);

    if (domains.length === 0) {
      for (const item of chunk) {
        await complete(item.id, true, null);
        stats.completedItems++;
        stats.recentCompletions++;
      }
      continue;
    }

    try {
      stats.inFlight += chunk.length;
      const res = await fetch(`${SCRAPER_URL}/enrich-domains`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domains }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) throw new Error(`scraper enrich ${res.status}`);
      const data = (await res.json()) as { results?: EnrichedDomainResult[] };
      const results = data.results ?? [];

      // Build a lookup by domain for quick access
      const resultMap = new Map<string, EnrichedDomainResult>();
      for (const r of results) {
        resultMap.set(r.domain, r);
      }

      for (const item of chunk) {
        const payload = item.payload as {
          domain?: string;
          company_id?: string;
          organization_id?: string;
        };
        const orgId = item.organization_id;
        const domain = payload.domain;
        if (!domain) {
          await complete(item.id, true, null);
          stats.completedItems++;
          stats.recentCompletions++;
          continue;
        }

        const enriched = resultMap.get(domain);
        if (!enriched) {
          await complete(item.id, true, null);
          stats.completedItems++;
          stats.recentCompletions++;
          continue;
        }

        // Upsert into lb_domain_index
        await supabase
          .from('lb_domain_index')
          .upsert({
            organization_id: orgId,
            domain: enriched.domain,
            website_url: `https://${enriched.domain}`,
            title: enriched.title,
            meta_description: enriched.meta_description,
            country: enriched.country,
            state: enriched.state,
            city: enriched.city,
            address_raw: enriched.address_raw,
            phone: enriched.phone,
            email: enriched.email,
            tech_stack: enriched.tech_stack,
            industry_keywords: enriched.industry_keywords,
            schema_org_type: enriched.schema_org_type,
            employee_signal: enriched.employee_signal,
            source: 'homepage_enrichment',
            enriched_at: new Date().toISOString(),
          }, { onConflict: 'organization_id,domain' })
          .then(() => {}, (err) => {
            console.warn('[verifier] lb_domain_index upsert failed', err);
          });

        // Backfill lb_discovered_companies with enriched location data
        if (payload.company_id) {
          const updates: Record<string, unknown> = {};
          if (enriched.city) updates.city = enriched.city;
          if (enriched.state) updates.state = enriched.state;
          if (enriched.country) updates.country = enriched.country;
          if (enriched.phone) updates.phone = enriched.phone;
          if (enriched.employee_signal) updates.employee_signal = enriched.employee_signal;
          if (Object.keys(updates).length > 0) {
            await supabase
              .from('lb_discovered_companies')
              .update(updates)
              .eq('id', payload.company_id)
              .then(() => {}, () => {});
          }
        }

        await complete(item.id, true, null);
        stats.completedItems++;
        stats.recentCompletions++;
      }
    } catch (err) {
      for (const item of chunk) {
        stats.failedItems++;
        await complete(item.id, false, err instanceof Error ? err.message : String(err));
      }
    } finally {
      stats.inFlight -= chunk.length;
    }
  }
}

// ============================================================================
// Main loop
// ============================================================================
function computeThroughput(): number {
  const now = Date.now();
  const elapsedMs = now - stats.lastThroughputWindowStart;
  if (elapsedMs < 1000) return stats.throughputPerSec;
  const perSec = stats.recentCompletions / (elapsedMs / 1000);
  stats.throughputPerSec = Math.round(perSec * 100) / 100;
  stats.recentCompletions = 0;
  stats.lastThroughputWindowStart = now;
  return stats.throughputPerSec;
}

interface WorkerConfig {
  discovery_workers?: number;
  dm_workers?: number;
  pattern_workers?: number;
  smtp_workers?: number;
  icp_workers?: number;
  batch_size?: number;
}

async function loadWorkerConfigForJob(jobId: string): Promise<WorkerConfig> {
  const { data } = await supabase
    .from('list_building_jobs')
    .select('worker_config')
    .eq('id', jobId)
    .single();
  return (data?.worker_config ?? {}) as WorkerConfig;
}

async function loop(): Promise<void> {
  while (!shuttingDown) {
    try {
      let did = 0;
      for (const stage of WORKER_STAGES) {
        const batchSize =
          stage === 'smtp' ? 15 :
          stage === 'pattern' ? 20 :
          stage === 'discovery' ? 1 :
          stage === 'dm' ? 5 :
          stage === 'enrich' ? 10 :
          5;
        const items = await claim(stage, batchSize);
        if (items.length === 0) continue;
        did += items.length;
        stats.currentJobId = items[0].job_id;
        void loadWorkerConfigForJob(items[0].job_id).catch(() => ({}));
        if (stage === 'discovery') await processDiscoveryBatch(items);
        else if (stage === 'dm') await processDmBatch(items);
        else if (stage === 'enrich') await processEnrichBatch(items);
        else if (stage === 'pattern') await processPatternBatch(items);
        else if (stage === 'smtp') await processSmtpBatch(items);
        else if (stage === 'icp') await processIcpBatch(items);
      }
      computeThroughput();
      if (did === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error('[verifier] loop error', err);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// ============================================================================
// HTTP: /health
// ============================================================================
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      worker_id: WORKER_ID,
      uptime_s: Math.floor((Date.now() - stats.startedAt) / 1000),
      in_flight: stats.inFlight,
      completed: stats.completedItems,
      failed: stats.failedItems,
      throughput_per_sec: stats.throughputPerSec,
      stages: WORKER_STAGES,
      proxies: proxyShard.size(),
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ============================================================================
// Startup
// ============================================================================
async function main(): Promise<void> {
  await proxyShard.load();
  const proxy = proxyShard.current();
  pool = new MxPool({
    supabase,
    heloDomain: HELO_DOMAIN,
    mailFrom: MAIL_FROM,
    proxy,
    maxConcurrencyPerMx: 10,
  });

  const stopHeartbeat = startHeartbeat(
    supabase,
    WORKER_ID,
    () => ({
      kind: 'verifier',
      current_job_id: stats.currentJobId,
      in_flight_items: stats.inFlight,
      throughput_per_sec: stats.throughputPerSec,
    }),
  );

  server.listen(PORT, () => {
    console.log(`[verifier] ${WORKER_ID} listening on ${PORT} stages=${WORKER_STAGES.join(',')}`);
  });

  const shutdown = async () => {
    console.log('[verifier] shutdown');
    shuttingDown = true;
    stopHeartbeat();
    try { if (pool) await pool.drain(); } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await loop();
}

// Keep imports used to satisfy type checker.
void generatePermutations;

main().catch((err) => {
  console.error('[verifier] fatal', err);
  process.exit(1);
});
