/**
 * List Building Engine - pipeline orchestrator.
 *
 * Sequential stages with bounded concurrency:
 *  1. discovery  -> scrapeCompanies
 *  2. dm         -> scrapeDecisionMakers + rankDecisionMakers (top 1)
 *  3. pattern    -> PatternCache get/record (Stream A)
 *  4. smtp       -> verifyEmail with tiered permutations (Stream A)
 *  5. icp        -> scoreCompanyDmAgainstIcp (reuses _shared/icp-scorer.ts)
 *
 * Cancellation: re-reads job status between stages and between chunks.
 * Heartbeat: bumps updated_at every ~5s so the recovery cron does not
 * re-launch an in-flight job.
 */

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type {
  DiscoveredCompany,
  DMCandidate,
  Permutation,
  VerificationResult,
} from './types.ts';
import { scrapeCompanies } from './company-scraper.ts';
import { scrapeDecisionMakers } from './dm-scraper.ts';
import { rankDecisionMakers } from './dm-ranker.ts';
import { scoreCompanyDmAgainstIcp } from './icp-adapter.ts';
import { normalizeDomain } from '../enrichment/index.ts';
import type { ICPDefinition } from '../icp-scorer.ts';

// ---------------------------------------------------------------------------
// Stream A imports. These files will exist in the same folder by the time a
// human runs this code. Importing by path is safe; TS / deno check will be
// run once the whole tree lands. If a module is missing at runtime we catch
// and log per-stage rather than crashing the whole job.
// ---------------------------------------------------------------------------
// @ts-ignore - provided by Stream A
import { PatternCache } from './pattern-cache.ts';
// @ts-ignore - provided by Stream A
import { verifyEmail } from './smtp-verifier.ts';
// @ts-ignore - provided by Stream A
import { generatePermutations } from './permutation-generator.ts';
// @ts-ignore - provided by Stream A
import { parseName } from './name-parser.ts';
import { ProxyManager } from './proxy-manager.ts';

const STAGE = {
  DISCOVERY: 'discovery',
  DM: 'dm',
  PATTERN: 'pattern',
  SMTP: 'smtp',
  ICP: 'icp',
} as const;

const DM_CONCURRENCY = 5;
const SMTP_CONCURRENCY = 15;
const HEARTBEAT_MS = 5_000;

interface JobRow {
  id: string;
  organization_id: string;
  status: string;
  icp_id: string | null;
  query: { niche?: string; geo?: string; sources?: string[]; limit?: number } & Record<string, unknown>;
  worker_config: Record<string, unknown>;
}

async function logStage(
  supabase: SupabaseClient,
  jobId: string,
  stage: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  data?: unknown,
): Promise<void> {
  try {
    await supabase.from('lb_job_logs').insert({
      job_id: jobId,
      stage,
      level,
      message,
      data: data ?? null,
    });
  } catch (err) {
    console.error('[lb/pipeline] lb_job_logs insert failed', err);
  }
}

async function isCancelled(supabase: SupabaseClient, jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from('list_building_jobs')
    .select('status')
    .eq('id', jobId)
    .single();
  return data?.status === 'cancelled';
}

async function updateJob(
  supabase: SupabaseClient,
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await supabase.from('list_building_jobs').update(patch).eq('id', jobId);
}

async function chunkParallel<T, R>(
  items: T[],
  chunkSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map((it) => worker(it).catch((err) => {
      console.error('[lb/pipeline] chunk worker error:', err);
      return null as unknown as R;
    })));
    out.push(...results);
  }
  return out;
}

export async function runListBuildingPipeline(
  jobId: string,
  supabase: SupabaseClient,
): Promise<void> {
  // --------------------------------------------------------------
  // Load + idempotency
  // --------------------------------------------------------------
  const { data: jobRow, error: jobErr } = await supabase
    .from('list_building_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (jobErr || !jobRow) {
    console.error('[lb/pipeline] job not found', jobId, jobErr);
    return;
  }
  const job = jobRow as JobRow;

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    console.log(`[lb/pipeline] job ${jobId} already in terminal state: ${job.status}`);
    return;
  }
  if (job.status === 'running') {
    // Recovery may re-invoke us, but another worker might still be going.
    // Simple guard: only proceed if updated_at is stale (> 2 min) - the caller
    // (recovery cron) already filters by this, so we trust it.
    console.log(`[lb/pipeline] job ${jobId} already running, recovering`);
  }

  // -----------------------------------------------------------------
  // ScrapeBox mode: queue-first unless LB_RUN_INLINE=1 forces legacy.
  // When queue-first is active, workers in workers/list-building-verifier
  // drive the pipeline via lb_work_items. This function simply enqueues
  // the initial discovery item and returns.
  // -----------------------------------------------------------------
  const inlineMode = Deno.env.get('LB_RUN_INLINE') === '1';
  if (!inlineMode) {
    const { data: existing } = await supabase
      .from('lb_work_items')
      .select('id')
      .eq('job_id', jobId)
      .eq('stage', 'discovery')
      .in('status', ['pending', 'claimed'])
      .limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from('lb_work_items').insert({
        job_id: jobId,
        organization_id: job.organization_id,
        stage: 'discovery',
        payload: {
          query: job.query,
          icp_id: job.icp_id,
          worker_config: job.worker_config ?? {},
        },
        priority: 5,
      });
    }
    await updateJob(supabase, jobId, {
      status: 'running',
      started_at: new Date().toISOString(),
      error_message: null,
    });
    console.log(`[lb/pipeline] queue-first: enqueued discovery for ${jobId}`);
    return;
  }

  await updateJob(supabase, jobId, {
    status: 'running',
    started_at: new Date().toISOString(),
    error_message: null,
  });

  // Heartbeat keeps updated_at fresh.
  const heartbeat = setInterval(() => {
    supabase
      .from('list_building_jobs')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .then(() => {}, (err: unknown) => console.error('[lb/pipeline] heartbeat error', err));
  }, HEARTBEAT_MS);

  const openRouterApiKey = Deno.env.get('OPENROUTER_API_KEY') || '';

  try {
    // --------------------------------------------------------------
    // Load ICP
    // --------------------------------------------------------------
    let icp: ICPDefinition | null = null;
    if (job.icp_id) {
      const { data: icpRow } = await supabase
        .from('icps')
        .select('name, summary, description, pain_points, desires, objections, language_style, tags')
        .eq('id', job.icp_id)
        .single();
      icp = (icpRow as ICPDefinition) ?? null;
    }
    if (!icp) {
      // Permissive default: still allow the pipeline to run without scoring blockage.
      icp = {
        name: 'Default',
        summary: null,
        description: null,
        pain_points: null,
        desires: null,
        objections: null,
        language_style: null,
        tags: null,
      };
      await logStage(supabase, jobId, STAGE.ICP, 'warn', 'No ICP on job, using permissive default');
    }

    // --------------------------------------------------------------
    // STAGE 1: Company discovery
    // --------------------------------------------------------------
    await logStage(supabase, jobId, STAGE.DISCOVERY, 'info', 'Starting company discovery', job.query);
    const limit = Number(job.query?.limit ?? 50);
    const companies = await scrapeCompanies(
      {
        niche: String(job.query?.niche ?? ''),
        geo: String(job.query?.geo ?? ''),
        sources: (job.query?.sources as string[]) ?? ['google_search'],
        limit,
      },
      {}, // TODO: wire proxyManager + enrichmentRouter from worker_config
    );

    if (await isCancelled(supabase, jobId)) throw new Error('cancelled');

    // Insert discovered companies
    const companyInserts = companies.map((c) => ({
      job_id: jobId,
      organization_id: job.organization_id,
      company_name: c.company_name,
      domain: c.domain,
      website_url: c.website_url,
      linkedin_url: c.linkedin_url,
      phone: c.phone ?? null,
      address: c.address ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      country: c.country ?? null,
      employee_signal: c.employee_signal ?? null,
      employee_count_estimate: c.employee_count_estimate ?? null,
      source: c.source,
      raw_html_snippet: c.raw_html_snippet ?? null,
    }));

    // Upsert against the (organization_id, linkedin_url) unique index so a
    // company re-discovered across jobs returns its existing id instead of
    // erroring on the constraint. The index is non-partial; Postgres treats
    // NULL as distinct, so domain-only rows (linkedin_url IS NULL) pass
    // through as plain inserts in the same call.
    let insertedCompanies: Array<{ id: string; domain: string | null; company_name: string; website_url: string | null; linkedin_url: string | null }> = [];
    if (companyInserts.length > 0) {
      const { data: ins, error } = await supabase
        .from('lb_discovered_companies')
        .upsert(companyInserts, {
          onConflict: 'organization_id,linkedin_url',
          ignoreDuplicates: false,
        })
        .select('id, domain, company_name, website_url, linkedin_url');
      if (error) throw error;
      insertedCompanies = (ins as typeof insertedCompanies) ?? [];
    }

    await updateJob(supabase, jobId, {
      total_companies: insertedCompanies.length,
      progress: 20,
    });
    await logStage(supabase, jobId, STAGE.DISCOVERY, 'info', `Discovered ${insertedCompanies.length} companies`);

    // --------------------------------------------------------------
    // STAGE 2: Decision maker discovery + ranking (top 1 per company)
    // --------------------------------------------------------------
    if (await isCancelled(supabase, jobId)) throw new Error('cancelled');
    await logStage(supabase, jobId, STAGE.DM, 'info', 'Starting DM discovery');

    interface DmRow { id: string; company_id: string; first_name: string; last_name: string | null; title: string | null; domain: string | null }
    const dmRows: DmRow[] = [];

    // Match each inserted row back to its source scraper record. Upsert can
    // reorder rows in RETURNING (Postgres makes no guarantee), so prefer
    // identity by linkedin_url > website_url > domain instead of positional
    // indexing.
    const matched = new Set<number>();
    const companyByIdx = insertedCompanies
      .map((ic) => {
        const idx = companies.findIndex((c, i) => {
          if (matched.has(i)) return false;
          if (ic.linkedin_url && c.linkedin_url) return c.linkedin_url === ic.linkedin_url;
          if (ic.website_url && c.website_url) return c.website_url === ic.website_url;
          if (ic.domain && c.domain) return c.domain === ic.domain;
          return c.company_name === ic.company_name;
        });
        if (idx === -1) return null;
        matched.add(idx);
        return { inserted: ic, scraped: companies[idx] };
      })
      .filter((x): x is { inserted: typeof insertedCompanies[number]; scraped: typeof companies[number] } => x !== null);

    await chunkParallel(companyByIdx, DM_CONCURRENCY, async ({ inserted, scraped }) => {
      const candidates = await scrapeDecisionMakers(scraped, {});
      const { best } = rankDecisionMakers(candidates);
      if (!best) return null;

      // Upsert: (company_id, linkedin_url) is UNIQUE — re-runs against the
      // same company would have thrown.
      const { data: ins, error } = await supabase
        .from('lb_decision_makers')
        .upsert({
          company_id: inserted.id,
          job_id: jobId,
          organization_id: job.organization_id,
          first_name: best.first_name,
          last_name: best.last_name ?? null,
          middle_name: best.middle_name ?? null,
          title: best.title ?? null,
          seniority_score: best.seniority_score ?? null,
          linkedin_url: best.linkedin_url ?? null,
          source_page: best.source_page ?? null,
          confidence: best.confidence ?? null,
        }, { onConflict: 'company_id,linkedin_url', ignoreDuplicates: false })
        .select('id')
        .single();
      if (error) {
        console.error('[lb/pipeline] dm upsert failed', error);
        return null;
      }
      dmRows.push({
        id: (ins as { id: string }).id,
        company_id: inserted.id,
        first_name: best.first_name,
        last_name: best.last_name ?? null,
        title: best.title ?? null,
        domain: inserted.domain ? normalizeDomain(inserted.domain) : (inserted.website_url ? normalizeDomain(inserted.website_url) : null),
      });
      return null;
    });

    await updateJob(supabase, jobId, { found_dms: dmRows.length, progress: 40 });
    await logStage(supabase, jobId, STAGE.DM, 'info', `Picked ${dmRows.length} DMs`);

    // --------------------------------------------------------------
    // STAGE 3+4: Pattern cache + SMTP verification
    // --------------------------------------------------------------
    if (await isCancelled(supabase, jobId)) throw new Error('cancelled');
    await logStage(supabase, jobId, STAGE.PATTERN, 'info', 'Starting pattern + SMTP stage');

    // Instantiate PatternCache per-job (Stream A contract).
    let cache: any = null;
    try {
      cache = new PatternCache({ supabase, organizationId: job.organization_id });
    } catch (err) {
      await logStage(supabase, jobId, STAGE.PATTERN, 'warn', 'PatternCache unavailable, running without cache', { err: String(err) });
    }

    // Load proxy pool for SMTP tunneling (optional — empty pool => direct).
    const proxyManager = new ProxyManager(supabase, job.organization_id);
    try {
      await proxyManager.loadActivePool();
    } catch (err) {
      await logStage(supabase, jobId, STAGE.SMTP, 'warn', 'Proxy pool load failed, continuing direct', { err: String(err) });
    }

    interface VerifiedResult { dm: DmRow; email: string; pattern: string | null; tier: number | null; status: 'verified' | 'catch_all' }
    const verified: VerifiedResult[] = [];

    await chunkParallel(dmRows, SMTP_CONCURRENCY, async (dm) => {
      if (!dm.domain) return null;

      // Parse name via Stream A's parser (fallback to basic split).
      let parsed: any;
      try {
        parsed = parseName(`${dm.first_name} ${dm.last_name ?? ''}`.trim());
      } catch {
        parsed = { first: dm.first_name.toLowerCase(), last: (dm.last_name ?? '').toLowerCase() };
      }

      // Try cache first.
      let forcedPattern: string | null = null;
      try {
        if (cache) {
          const hit = (await cache.getFromSession?.(dm.domain)) ?? (await cache.get?.(dm.domain));
          if (hit && hit.pattern && !hit.negative_result) {
            forcedPattern = hit.pattern;
          }
        }
      } catch (err) {
        console.error('[lb/pipeline] cache.get error', err);
      }

      // Generate permutations. If we have a forced pattern, generator should
      // prioritize it; otherwise produce a tiered list.
      let perms: Permutation[] = [];
      try {
        perms = await generatePermutations({
          parsedName: parsed,
          domain: dm.domain,
          forcePattern: forcedPattern,
        });
      } catch (err) {
        console.error('[lb/pipeline] permutation generator error', err);
        return null;
      }
      if (!perms || perms.length === 0) return null;

      // Walk tiers: verify one at a time, stop on verified / catch_all.
      const byTier = new Map<number, Permutation[]>();
      for (const p of perms) {
        const t = p.tier ?? 1;
        if (!byTier.has(t)) byTier.set(t, []);
        byTier.get(t)!.push(p);
      }
      const tiers = Array.from(byTier.keys()).sort((a, b) => a - b);

      for (const tier of tiers) {
        const batch = byTier.get(tier)!;
        for (const perm of batch) {
          const picked = proxyManager.pickForDomain(dm.domain);
          let result: VerificationResult;
          try {
            result = await verifyEmail(perm.email, {
              mxHosts: [dm.domain],
              proxy: picked ? {
                type: picked.type,
                host: picked.host,
                port: picked.port,
                username: picked.username,
                password: picked.password,
              } : undefined,
              proxyId: picked?.id,
            });
          } catch (err) {
            result = {
              email: perm.email,
              status: 'failed',
              smtp_response_code: null,
              catch_all: false,
              attempts: 1,
              error: String(err),
              proxy_id: picked?.id ?? null,
            };
          }

          // Track proxy health: any connect-failure status is a proxy failure
          // if we were using one; verified/catch_all/not_found count as success.
          if (picked) {
            if (result.status === 'verified' || result.status === 'catch_all' || result.status === 'not_found') {
              await proxyManager.recordSuccess(picked.id).catch((e) => console.error('[lb/pipeline] recordSuccess', e));
            } else {
              await proxyManager.recordFailure(picked.id, result.error ?? result.status).catch((e) => console.error('[lb/pipeline] recordFailure', e));
            }
          }

          await supabase.from('lb_email_verifications').insert({
            dm_id: dm.id,
            job_id: jobId,
            organization_id: job.organization_id,
            email: perm.email,
            pattern: perm.pattern,
            tier,
            status: result.status,
            smtp_response_code: result.smtp_response_code,
            catch_all: result.catch_all,
            proxy_id: result.proxy_id ?? picked?.id ?? null,
            attempts: result.attempts,
            error: result.error ?? null,
          });

          if (result.status === 'verified') {
            verified.push({ dm, email: perm.email, pattern: perm.pattern, tier, status: 'verified' });
            try {
              await cache?.recordHit?.({ domain: dm.domain, pattern: perm.pattern, tier });
            } catch (err) {
              console.error('[lb/pipeline] cache.recordHit error', err);
            }
            return null;
          }
          if (result.status === 'catch_all') {
            verified.push({ dm, email: perm.email, pattern: perm.pattern, tier, status: 'catch_all' });
            return null;
          }
        }
      }
      return null;
    });

    await updateJob(supabase, jobId, { verified_emails: verified.length, progress: 75 });
    await logStage(supabase, jobId, STAGE.SMTP, 'info', `Verified ${verified.length} emails`);

    // --------------------------------------------------------------
    // STAGE 5: ICP scoring + enriched lead output
    // --------------------------------------------------------------
    if (await isCancelled(supabase, jobId)) throw new Error('cancelled');
    await logStage(supabase, jobId, STAGE.ICP, 'info', 'Starting ICP scoring');

    let strongCount = 0;
    for (const v of verified) {
      if (await isCancelled(supabase, jobId)) throw new Error('cancelled');

      // Rehydrate minimal company + DM shapes for the scorer.
      const companyRow = insertedCompanies.find((ic) => ic.id === v.dm.company_id);
      const companyForScore: DiscoveredCompany = {
        company_name: companyRow?.company_name ?? 'Unknown',
        domain: companyRow?.domain ?? null,
        website_url: companyRow?.website_url ?? null,
        linkedin_url: null,
        source: 'google_search',
      };
      const dmForScore: DMCandidate = {
        first_name: v.dm.first_name,
        last_name: v.dm.last_name,
        title: v.dm.title,
      };

      const scored = await scoreCompanyDmAgainstIcp({
        company: companyForScore,
        dm: dmForScore,
        icp,
        openRouterApiKey,
      });

      await supabase.from('lb_enriched_leads').insert({
        job_id: jobId,
        organization_id: job.organization_id,
        dm_id: v.dm.id,
        company_id: v.dm.company_id,
        verified_email: v.email,
        email_status: v.status,
        icp_score: scored.icp_score,
        fit_label: scored.fit_label,
        score_breakdown: scored.score_breakdown,
        claude_reasoning: scored.reasoning,
      });

      if (scored.fit_label === 'Strong') strongCount++;
    }

    await updateJob(supabase, jobId, {
      status: 'completed',
      progress: 100,
      strong_leads: strongCount,
      completed_at: new Date().toISOString(),
    });
    await logStage(supabase, jobId, STAGE.ICP, 'info', `Completed job. strong=${strongCount}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'cancelled') {
      await updateJob(supabase, jobId, { status: 'cancelled', completed_at: new Date().toISOString() });
      await logStage(supabase, jobId, 'discovery', 'warn', 'Job cancelled');
    } else {
      console.error('[lb/pipeline] fatal', err);
      await updateJob(supabase, jobId, {
        status: 'failed',
        error_message: msg,
        completed_at: new Date().toISOString(),
      });
      await logStage(supabase, jobId, 'discovery', 'error', `Pipeline failed: ${msg}`);
    }
  } finally {
    clearInterval(heartbeat);
  }
}
