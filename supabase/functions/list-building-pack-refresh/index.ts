/**
 * ACA Discovery Layer — Pack Refresh Dispatcher.
 *
 * Cron-invoked every 10 minutes. For each `pack_subscriptions` row that is
 * `active` and whose `next_refresh_at <= now()`:
 *   1. Create a `list_building_jobs` row (status=running) with metadata
 *      linking back to the subscription + pack key.
 *   2. Create a `pack_refresh_jobs` row to track per-refresh stats.
 *   3. Iterate the pack's source modules, write `lb_discovered_companies`
 *      rows with the signal_metadata embedded.
 *   4. Bulk-enqueue `dm` work items for each company so the existing
 *      list-building workers pick up DM scrape → pattern → SMTP → ICP.
 *   5. Advance `next_refresh_at` per cadence + bump `last_refreshed_at`.
 *
 * POST body is optional: `{ subscription_id?: string }` to force-run a single
 * subscription (used by the "Refresh now" UI button). Without a body, scans
 * all due subscriptions.
 *
 * Spec: ACA Discovery Layer Implementation Brief v1.2, §8 + §11.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { getPackDefinition, getPackModules } from '../_shared/list-building/pack-modules/registry.ts';
import type { DiscoveryRecord } from '../_shared/list-building/pack-modules/types.ts';
import { scoreCompanyForListBuilding, type ICPDefinition } from '../_shared/icp-scorer.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';
import {
  discoveryEventKey,
  isEligiblePersonFirstDecisionMaker,
  mapWithConcurrency,
} from '../_shared/list-building/discovery-pipeline.ts';

const PER_MODULE_LIMIT = 10;
const PER_MODULE_TIMEOUT_MS = 60_000;

interface PackSubscriptionRow {
  id: string;
  organization_id: string;
  pack_key: string;
  tier: string;
  config: Record<string, unknown>;
  refresh_cadence: 'daily' | 'weekly' | 'monthly' | 'custom';
  /** Required when refresh_cadence = 'custom'. Min 60 (1h). */
  refresh_interval_minutes: number | null;
  lead_list_id: string | null;
  last_refreshed_at: string | null;
  // Signal-feature additions
  icp_id: string | null;            // direct reference to library_icps (preferred)
  icp_product_id: string | null;     // legacy: ICP via product → product_icp_fit
  min_icp_score: number | null;
  review_band: number | null;
  destination_type: 'campaign' | 'sequence' | 'holding' | null;
  destination_id: string | null;
  daily_cap: number | null;
  weekly_cap: number | null;
}

type SignalOutcome =
  | 'enrolled'
  | 'enrolled_holding'
  | 'review_pending'
  | 'dropped_below_threshold'
  | 'dropped_no_icp_match'
  | 'cap_hit'
  | 'failed';

interface ScoredRecord {
  rec: DiscoveryRecord;
  icp_score: number | null;        // null when no ICP set on the subscription
  icp_reasoning: string | null;
  scoring_failed: boolean;
}

function nextRefreshAt(
  cadence: 'daily' | 'weekly' | 'monthly' | 'custom',
  intervalMinutes: number | null,
): string {
  const now = new Date();
  switch (cadence) {
    case 'daily':
      now.setUTCDate(now.getUTCDate() + 1);
      break;
    case 'weekly':
      now.setUTCDate(now.getUTCDate() + 7);
      break;
    case 'monthly':
      now.setUTCMonth(now.getUTCMonth() + 1);
      break;
    case 'custom': {
      // Fallback to daily if a sub somehow has cadence='custom' but no
      // interval set — shouldn't happen given the CHECK constraint, but
      // defending against direct DB writes.
      const minutes = intervalMinutes && intervalMinutes >= 60 ? intervalMinutes : 24 * 60;
      now.setTime(now.getTime() + minutes * 60_000);
      break;
    }
  }
  return now.toISOString();
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms) as unknown as number;
      }),
    ]);
  } catch (err) {
    console.warn(`[pack-refresh] ${label} aborted`, err);
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function listDueSubscriptions(
  supabase: SupabaseClient,
  forceId?: string,
): Promise<PackSubscriptionRow[]> {
  let query = supabase
    .from('pack_subscriptions')
    .select(
      'id, organization_id, pack_key, tier, config, refresh_cadence, refresh_interval_minutes, lead_list_id, last_refreshed_at, '
      + 'icp_id, icp_product_id, min_icp_score, review_band, destination_type, destination_id, daily_cap, weekly_cap',
    )
    .eq('status', 'active')
    .limit(20);

  if (forceId) {
    query = query.eq('id', forceId);
  } else {
    query = query.lte('next_refresh_at', new Date().toISOString());
  }
  const { data, error } = await query;
  if (error) {
    console.error('[pack-refresh] subscription query failed', error);
    return [];
  }
  // Via unknown: the client's error union (GenericStringError[]) doesn't
  // structurally overlap the row type, so a direct assertion is rejected.
  return (data as unknown as PackSubscriptionRow[]) ?? [];
}

// ============================================================================
// ICP scoring + destination routing helpers (signals-feature path)
// ============================================================================

interface IcpContext {
  icp: ICPDefinition;
  openRouterApiKey: string;
}

async function loadIcpContext(
  supabase: SupabaseClient,
  organizationId: string,
  options: { icpId?: string | null; productId?: string | null },
): Promise<IcpContext | null> {
  // Direct ICP path is preferred. Fall back to product_icp_fit for legacy
  // subscriptions that still use icp_product_id.
  let icpId = options.icpId ?? null;
  if (!icpId && options.productId) {
    const { data: fits } = await supabase
      .from('product_icp_fit')
      .select('icp_id')
      .eq('product_id', options.productId)
      .order('fit_score', { ascending: false })
      .limit(1);
    icpId = fits?.[0]?.icp_id ?? null;
  }
  if (!icpId) return null;

  const { data: icp } = await supabase
    .from('library_icps')
    .select('name, summary, description, pain_points, desires, objections, language_style, tags, target_locations')
    .eq('id', icpId)
    .maybeSingle();
  if (!icp) return null;

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', organizationId)
    .eq('provider', 'openrouter')
    .eq('is_valid', true)
    .maybeSingle();
  if (!keyRow) {
    console.warn('[pack-refresh] no openrouter key, skipping ICP scoring');
    return null;
  }
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;

  const openRouterApiKey = await decryptApiKey(keyRow.key_encrypted as string, encryptionKey);

  return { icp: icp as ICPDefinition, openRouterApiKey };
}

async function scoreRecord(
  rec: DiscoveryRecord,
  ctx: IcpContext,
): Promise<{ score: number; reasoning: string } | null> {
  try {
    // Person-first signals (post engagers, unipile inbound) carry the
    // engager on rec.person — feed that to the scorer so we don't hit
    // the "all dimensions undetermined → 50% fallback" trap.
    const isPersonFirst =
      !rec.company.domain &&
      !rec.company.website_url &&
      !rec.company.linkedin_url &&
      !!rec.person?.linkedin_url;

    const personSnippet = rec.person
      ? `Person-first signal — no company info available yet. ` +
        `Engager: ${rec.person.first ?? ''} ${rec.person.last ?? ''}. ` +
        `Title/headline: ${rec.person.title || 'Unknown'}. ` +
        `Source: ${rec.signal_metadata?.detail ?? rec.source}. ` +
        `Score primarily on the seniority + type dimensions; mark size/geo/industry as ~50% when undetermined.`
      : '';

    const breakdown = await scoreCompanyForListBuilding(
      {
        company: {
          company_name: rec.company.company_name,
          domain: rec.company.domain ?? null,
          website_url: rec.company.website_url ?? null,
          linkedin_url: rec.company.linkedin_url ?? null,
          country: (rec.company as { country?: string | null }).country ?? null,
          employee_signal: (rec.company as { employee_signal?: string | null }).employee_signal ?? null,
          employee_count_estimate:
            (rec.company as { employee_count_estimate?: number | null }).employee_count_estimate ?? null,
          raw_html_snippet: isPersonFirst ? personSnippet : null,
        },
        // Pass real person info through if we have it. Falls back to "Unknown"
        // only when the record genuinely has no DM hint.
        dm: rec.person
          ? {
              first_name: rec.person.first || 'Unknown',
              last_name: rec.person.last || undefined,
              title: rec.person.title || undefined,
              linkedin_url: rec.person.linkedin_url || undefined,
            }
          : { first_name: 'Unknown' },
        icpDefinition: ctx.icp,
      },
      ctx.openRouterApiKey,
      'https://aca.app',
    );
    const total = Math.max(
      0,
      Math.min(
        100,
        breakdown.industry + breakdown.size + breakdown.geo + breakdown.seniority + breakdown.type,
      ),
    );
    return { score: total, reasoning: breakdown.reasoning };
  } catch (err) {
    console.error('[pack-refresh] ICP score failed', err);
    return null;
  }
}

interface CapState {
  todayUsed: number;
  weekUsed: number;
}

async function loadCapState(
  supabase: SupabaseClient,
  subscriptionId: string,
): Promise<CapState> {
  const { data } = await supabase.rpc('signal_enrollment_counts', { p_subscription_id: subscriptionId });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    todayUsed: (row?.today_count as number) ?? 0,
    weekUsed: (row?.week_count as number) ?? 0,
  };
}

function withinCaps(state: CapState, sub: PackSubscriptionRow): boolean {
  if (sub.daily_cap != null && state.todayUsed >= sub.daily_cap) return false;
  if (sub.weekly_cap != null && state.weekUsed >= sub.weekly_cap) return false;
  return true;
}

async function logActivity(
  supabase: SupabaseClient,
  sub: PackSubscriptionRow,
  outcome: SignalOutcome,
  rec: DiscoveryRecord,
  scored: { icp_score: number | null; icp_reasoning: string | null },
  ids: { contact_id?: string | null; discovered_company_id?: string | null } = {},
): Promise<void> {
  try {
    const signalContext = rec.signal_metadata?.context ?? {};
    const companyContext = (signalContext.company as Record<string, unknown> | null) ?? {};
    const sourceUrls = Array.isArray(signalContext.source_urls)
      ? signalContext.source_urls
      : rec.signal_metadata?.evidence_url
        ? [rec.signal_metadata.evidence_url]
        : [];
    // Upsert against (subscription_id, signal_dedup_key) — see
    // discovery-pipeline.ts logActivity for the full rationale + migration ref.
    await supabase
      .from('signal_activity_log')
      .upsert(
        {
          subscription_id: sub.id,
          organization_id: sub.organization_id,
          contact_id: ids.contact_id ?? null,
          discovered_company_id: ids.discovered_company_id ?? null,
          outcome,
          icp_score: scored.icp_score,
          signal_type: rec.signal_metadata?.type ?? null,
          signal_detail: rec.signal_metadata?.detail ?? null,
          destination_type: sub.destination_type,
          destination_id: sub.destination_id,
          data: {
            signal_dedup_key: discoveryEventKey(rec),
            company_name: rec.company.company_name,
            domain: rec.company.domain,
            company_website: rec.company.website_url,
            company_linkedin: rec.company.linkedin_url,
            company_industry: companyContext.industry ?? null,
            company_employee_count: companyContext.employee_count ?? null,
            company_description: companyContext.description ?? null,
            signal_date: rec.signal_metadata?.date,
            evidence_url: rec.signal_metadata?.evidence_url,
            source_urls: sourceUrls,
            signal_context: signalContext,
            outreach_context: signalContext.outreach_context ?? rec.signal_metadata?.detail ?? null,
            signal_confidence: signalContext.confidence_score ?? null,
            signal_verification_status: signalContext.verification_status ?? null,
            icp_reasoning: scored.icp_reasoning,
            // Module-emitted payload (post_url, engagement_kind, monitored_profile, etc.)
            // Carried verbatim so the UI can surface signal-type-specific glance lines
            // without a schema migration each time we add a pack module.
            raw_signal: rec.raw_signal ?? null,
          },
        },
        { onConflict: 'subscription_id,signal_dedup_key', ignoreDuplicates: true },
      );
  } catch (err) {
    console.error('[pack-refresh] activity log upsert failed', err);
  }
}

async function processSubscription(
  supabase: SupabaseClient,
  sub: PackSubscriptionRow,
  sinceOverride?: string,
): Promise<{ companies: number; modules: number; refreshJobId: string | null; jobId: string | null; errors: string[]; apify_runs_queued: number }> {
  const errors: string[] = [];
  const pack = getPackDefinition(sub.pack_key);
  if (!pack) {
    errors.push(`unknown pack_key=${sub.pack_key}`);
    return { companies: 0, modules: 0, refreshJobId: null, jobId: null, errors, apify_runs_queued: 0 };
  }

  // Which engine produces this subscription's signals. Existing subscriptions
  // remain on SignalBase during the shadow rollout. Set
  // config.provider='aca_engine' on a canary subscription to compare results;
  // changing the registry default is the eventual cutover action.
  const packModules = getPackModules(
    pack,
    (sub.config as { provider?: string } | null)?.provider,
  );

  // Create list_building_jobs row
  const { data: job, error: jobErr } = await supabase
    .from('list_building_jobs')
    .insert({
      organization_id: sub.organization_id,
      name: `${pack.label} — auto-refresh ${new Date().toISOString().slice(0, 10)}`,
      status: 'running',
      query: {
        pack_key: pack.key,
        pack_subscription_id: sub.id,
        sources: packModules.map((m) => `pack:${m.key}`),
        ...sub.config,
      },
      target_list_id: sub.lead_list_id,
      worker_config: { triggered_by: 'pack_refresh' },
      started_at: new Date().toISOString(),
      metadata: {
        pack_subscription_id: sub.id,
        pack_key: pack.key,
        tier: pack.tier,
      },
    })
    .select('id')
    .single();

  if (jobErr || !job) {
    errors.push(`job_insert_failed: ${jobErr?.message ?? 'unknown'}`);
    return { companies: 0, modules: 0, refreshJobId: null, jobId: null, errors, apify_runs_queued: 0 };
  }
  const jobId = job.id as string;

  // Create pack_refresh_jobs row
  const { data: refreshJob } = await supabase
    .from('pack_refresh_jobs')
    .insert({
      subscription_id: sub.id,
      organization_id: sub.organization_id,
      list_building_job_id: jobId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  const refreshJobId = (refreshJob?.id as string | undefined) ?? null;

  // Lookback window for module filters.
  const sinceIso = sinceOverride
    ?? sub.last_refreshed_at
    ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // ============================================================================
  // ASYNC PATH: modules with kickoff() → launch on Apify, persist run handles,
  // return immediately. The list-building-apify-poller cron resumes processing
  // once each run completes and writes its dataset.
  //
  // SYNC PATH: modules without kickoff() → consume run() iterator inline.
  // Records flow into processDiscoveryRecords below.
  // ============================================================================
  const collected: DiscoveryRecord[] = [];
  const apifyRunHandles: Array<{
    run_id: string;
    dataset_id: string;
    module_key: string;
    signal_type: string;
    source: string;
    status: 'pending';
    started_at: string;
  }> = [];

  for (const mod of packModules) {
    if (typeof mod.kickoff === 'function') {
      try {
        // Pull from sub.config.max_results_per_refresh. Default lowered from
        // 500 → 200 because:
        //   - SignalBase pages = 100/page, so 500 = 5 parallel actor runs
        //   - Funding/job-changes typically have 30-150 fresh records per
        //     day, so pages 2-5 frequently return empty (per Apify run
        //     dashboard report from May 7)
        //   - 200 = 2 pages = enough headroom for hot days, no waste on
        //     typical days
        // Users who want bigger sweeps (e.g. weekly catch-up cadence) can
        // bump this in sub.config.max_results_per_refresh up to the 1000 cap.
        const cfgMax = (sub.config as { max_results_per_refresh?: number })?.max_results_per_refresh;
        const refreshLimit = typeof cfgMax === 'number' && cfgMax > 0
          ? Math.min(cfgMax, 1000)
          : 200;
        const handles = await mod.kickoff({
          organizationId: sub.organization_id,
          filters: sub.config,
          sinceIso,
          limit: refreshLimit,
        });
        for (const h of handles) {
          apifyRunHandles.push({ ...h, status: 'pending', started_at: new Date().toISOString() });
        }
        await supabase.from('lb_job_logs').insert({
          job_id: jobId,
          stage: 'discovery',
          level: 'info',
          message: `pack module ${mod.key} kicked off ${handles.length} async run(s)`,
        });
      } catch (err) {
        errors.push(`module ${mod.key} kickoff failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      // Sync path.
      //
      // This used to be an emergency fallback for Apify modules, so a hardcoded
      // PER_MODULE_LIMIT of 10 was harmless. It is now the PRIMARY path for the
      // aca_engine provider, where it silently capped every refresh at 10 leads
      // no matter how many events were promotable — observed as 10/10 against a
      // backlog of 67. Honour the same max_results_per_refresh knob the async
      // path already respects, and keep the small default only for modules that
      // genuinely are falling back.
      const cfgMax = (sub.config as { max_results_per_refresh?: number })?.max_results_per_refresh;
      const syncLimit = typeof cfgMax === 'number' && cfgMax > 0
        ? Math.min(cfgMax, 1000)
        : (typeof mod.kickoff === 'function' ? PER_MODULE_LIMIT : 200);
      const moduleRecords: DiscoveryRecord[] = [];
      const consume = async () => {
        for await (const rec of mod.run({
          organizationId: sub.organization_id,
          filters: sub.config,
          sinceIso,
          limit: syncLimit,
        })) {
          moduleRecords.push(rec);
          if (moduleRecords.length >= syncLimit) break;
        }
      };
      const ok = await withTimeout(consume(), PER_MODULE_TIMEOUT_MS, `module:${mod.key}`);
      if (ok === null && moduleRecords.length === 0) {
        errors.push(`module ${mod.key} timed out or errored`);
      }
      collected.push(...moduleRecords);
      await supabase.from('lb_job_logs').insert({
        job_id: jobId,
        stage: 'discovery',
        level: 'info',
        message: `pack module ${mod.key} yielded ${moduleRecords.length} records (sync)`,
      });
    }
  }

  // Persist async run handles so the poller can resume them.
  if (apifyRunHandles.length > 0 && refreshJobId) {
    await supabase
      .from('pack_refresh_jobs')
      .update({ apify_runs: apifyRunHandles })
      .eq('id', refreshJobId);
  }

  // Preserve distinct events from the same company; only exact provider-event
  // replays should be deduplicated.
  const seen = new Set<string>();
  const deduped = collected.filter((rec) => {
    const key = discoveryEventKey(rec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ============================================================================
  // Signals-feature path: ICP score → route → log → insert (or drop)
  // ============================================================================
  const icpCtx: IcpContext | null =
    sub.icp_id || sub.icp_product_id
      ? await loadIcpContext(supabase, sub.organization_id, {
          icpId: sub.icp_id,
          productId: sub.icp_product_id,
        })
      : null;
  const requiresIcpScore = !!(sub.icp_id || sub.icp_product_id);
  if (requiresIcpScore && !icpCtx) {
    errors.push('ICP set but unavailable for scoring (missing OpenRouter key or ICP row); no companies will be enrolled');
  }

  const minScore = sub.min_icp_score ?? 70;
  const reviewBand = sub.review_band ?? 10;
  const reviewFloor = Math.max(0, minScore - reviewBand);

  let capState = await loadCapState(supabase, sub.id);

  // Each lead can be scored independently. Bounded concurrency reduces
  // time-to-first-qualified-lead while keeping provider pressure controlled.
  const scored: ScoredRecord[] = await mapWithConcurrency(
    deduped,
    10,
    async (rec) => {
      if (!icpCtx) {
        return {
          rec,
          icp_score: null,
          icp_reasoning: null,
          scoring_failed: requiresIcpScore,
        };
      }
      const result = await scoreRecord(rec, icpCtx);
      return {
        rec,
        icp_score: result?.score ?? null,
        icp_reasoning: result?.reasoning ?? null,
        scoring_failed: !result,
      };
    },
  );

  // Decide outcome per record. Records that pass threshold enter the existing
  // discovery pipeline (lb_discovered_companies + dm queue). Borderline records
  // also enter the pipeline but get a signal_review_queue row. Below-threshold
  // records are dropped without persisting.
  type Persisted = { id: string; rec: DiscoveryRecord; outcome: SignalOutcome; icp_score: number | null; icp_reasoning: string | null; review_status?: 'pending' };
  const persisted: Persisted[] = [];

  for (const { rec, icp_score, icp_reasoning, scoring_failed } of scored) {
    if (scoring_failed) {
      await logActivity(supabase, sub, 'failed', rec, {
        icp_score,
        icp_reasoning: 'ICP scoring failed; company was not enrolled',
      });
      continue;
    }
    let outcome: SignalOutcome;
    if (icpCtx && icp_score != null) {
      if (icp_score >= minScore) outcome = 'enrolled';
      else if (icp_score >= reviewFloor) outcome = 'review_pending';
      else outcome = 'dropped_below_threshold';
    } else {
      outcome = 'enrolled';
    }

    if (outcome === 'enrolled' && !withinCaps(capState, sub)) {
      outcome = 'cap_hit';
    }

    if (outcome === 'dropped_below_threshold' || outcome === 'cap_hit') {
      await logActivity(supabase, sub, outcome, rec, { icp_score, icp_reasoning });
      continue;
    }

    // Persist in lb_discovered_companies. UPSERT on (organization_id,
    // linkedin_url) — same canonical company across refreshes reuses the
    // existing row instead of failing the partial unique index.
    const companyPayload = {
      job_id: jobId,
      organization_id: sub.organization_id,
      company_name: rec.company.company_name,
      domain: rec.company.domain,
      website_url: rec.company.website_url,
      linkedin_url: rec.company.linkedin_url,
      country: (rec.company as { country?: string }).country ?? null,
      employee_signal: (rec.company as { employee_signal?: string }).employee_signal ?? null,
      employee_count_estimate:
        (rec.company as { employee_count_estimate?: number }).employee_count_estimate ?? null,
      source: rec.source,
      raw_html_snippet: rec.signal_metadata
        ? `__signal__:${JSON.stringify({ ...rec.signal_metadata, subscription_id: sub.id })}`
        : (rec.company.raw_html_snippet ?? null),
    };
    const companyBuilder = rec.company.linkedin_url
      ? supabase.from('lb_discovered_companies').upsert(companyPayload, {
          onConflict: 'organization_id,linkedin_url',
          ignoreDuplicates: false,
        })
      : supabase.from('lb_discovered_companies').insert(companyPayload);
    const { data: ins, error: insErr } = await companyBuilder.select('id').single();

    if (insErr || !ins) {
      errors.push(`company_insert_failed: ${insErr?.message ?? 'unknown'}`);
      await logActivity(supabase, sub, 'failed', rec, { icp_score, icp_reasoning });
      continue;
    }

    if (outcome === 'enrolled') {
      capState = { todayUsed: capState.todayUsed + 1, weekUsed: capState.weekUsed + 1 };
    }

    persisted.push({ id: ins.id, rec, outcome, icp_score, icp_reasoning });

    if (outcome === 'review_pending') {
      await supabase.from('signal_review_queue').insert({
        organization_id: sub.organization_id,
        subscription_id: sub.id,
        discovered_company_id: ins.id,
        icp_score,
        icp_score_reasoning: icp_reasoning,
        signal_type: rec.signal_metadata?.type ?? null,
        signal_date: rec.signal_metadata?.date ?? null,
        signal_detail: rec.signal_metadata?.detail ?? null,
        evidence_url: rec.signal_metadata?.evidence_url ?? null,
        status: 'pending',
      });
    }

    await logActivity(supabase, sub, outcome, rec, { icp_score, icp_reasoning }, {
      discovered_company_id: ins.id,
    });
  }

  // Enqueue DM stage work items.
  // Three filters before we burn an Apify run on each:
  //   1. outcome='enrolled' only — review_pending companies wait for the user
  //      to approve via approve_signal_review_item (which has its own enqueue).
  //   2. Skip companies that already have lb_decision_makers for this org —
  //      same canonical company across refreshes shouldn't re-scrape.
  //   3. Skip if a completed dm work item exists for the same linkedin_url
  //      in the last 7 days (matches the recover_stuck_dm_signals retry cap).
  //   4. Person-first signals (post engagers, inbound) skip dm entirely —
  //      we already have the person, just need their email.
  if (persisted.length > 0) {
    const allEnrolled = persisted.filter(({ outcome }) => outcome === 'enrolled');

    // Split into person-first vs company-first.
    // Person-first = no company info but person is set (post engager,
    // unipile inbound). The "company_name" is actually the engager's name.
    const personFirst = allEnrolled.filter(({ rec }) =>
      !rec.company.linkedin_url && !rec.company.domain && isEligiblePersonFirstDecisionMaker(rec.person));
    const enrolled = allEnrolled.filter(({ rec }) =>
      rec.company.linkedin_url || rec.company.domain);

    // For person-first records: insert engager directly into lb_decision_makers
    // (we already have the DM — no need to scrape a fake company), then enqueue
    // a profile_email work item to find their email via harvestapi profile scraper.
    if (personFirst.length > 0) {
      const dmRows = personFirst.map(({ id, rec }) => ({
        company_id: id,
        job_id: jobId,
        organization_id: sub.organization_id,
        first_name: (rec.person!.first || rec.company.company_name).slice(0, 100),
        last_name: rec.person!.last || null,
        title: rec.person!.title || null,
        linkedin_url: rec.person!.linkedin_url || null,
        source_page: rec.signal_metadata?.evidence_url ?? rec.source_url ?? null,
        claude_reasoning: 'Direct from post engagement / inbound signal — engager IS the decision-maker.',
        confidence: 90,
        name_flags: { source: 'person_first_signal' },
      }));
      // Upsert: (company_id, linkedin_url) is UNIQUE on lb_decision_makers
      // (migration 20260605140000 + 20260605180000), so re-refreshes
      // would collide. Returns the existing row's id on conflict so the
      // downstream profile_email enqueue stays idempotent.
      const { data: insertedDms, error: dmErr } = await supabase
        .from('lb_decision_makers')
        .upsert(dmRows, { onConflict: 'company_id,linkedin_url', ignoreDuplicates: false })
        .select('id, linkedin_url');
      if (dmErr) {
        console.warn('[pack-refresh] person-first dm upsert failed', dmErr.message);
      } else if (insertedDms?.length) {
        const emailItems = (insertedDms as Array<{ id: string; linkedin_url: string | null }>).
          filter((d) => d.linkedin_url).
          map((d) => ({
            job_id: jobId,
            organization_id: sub.organization_id,
            stage: 'profile_email' as const,
            payload: {
              dm_id: d.id,
              linkedin_url: d.linkedin_url,
            },
            priority: 6,
          }));
        if (emailItems.length > 0) {
          await supabase.from('lb_work_items').insert(emailItems);
          console.log(
            `[pack-refresh] person-first: ${insertedDms.length} engagers → DMs, ` +
            `${emailItems.length} profile_email items enqueued (skipping dm/harvestapi-company-employees)`,
          );
        }
      }
    }

    // Bulk-check which linkedin_urls already have DMs or recent completes.
    const candidateUrls = enrolled
      .map(({ rec }) => rec.company.linkedin_url)
      .filter((u): u is string => !!u);
    const skipUrls = new Set<string>();
    if (candidateUrls.length > 0) {
      // Already-have-DMs check (joins via lb_discovered_companies on linkedin_url)
      const { data: dmRows } = await supabase
        .from('lb_discovered_companies')
        .select('linkedin_url, lb_decision_makers!inner(id)')
        .eq('organization_id', sub.organization_id)
        .in('linkedin_url', candidateUrls);
      for (const row of (dmRows as Array<{ linkedin_url: string }> | null) ?? []) {
        if (row.linkedin_url) skipUrls.add(row.linkedin_url);
      }
      // Recent-completed-dm check (avoid re-scraping zero-result companies)
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: recentDm } = await supabase
        .from('lb_work_items')
        .select('payload')
        .eq('organization_id', sub.organization_id)
        .eq('stage', 'dm')
        .in('status', ['completed', 'dead'])
        .gte('created_at', sevenDaysAgo);
      for (const row of (recentDm as Array<{ payload: Record<string, unknown> }> | null) ?? []) {
        const u = row.payload?.linkedin_url as string | undefined;
        if (u && candidateUrls.includes(u)) skipUrls.add(u);
      }
    }
    if (skipUrls.size > 0) {
      console.log(
        `[pack-refresh] dm enqueue: skipping ${skipUrls.size}/${enrolled.length} ` +
        `companies that already have DMs or were scraped in the last 7 days`,
      );
    }

    const dmItems = enrolled
      .filter(({ rec }) => !rec.company.linkedin_url || !skipUrls.has(rec.company.linkedin_url))
      .map(({ id, rec }) => ({
        job_id: jobId,
        organization_id: sub.organization_id,
        stage: 'dm' as const,
        payload: {
          company_id: id,
          company_name: rec.company.company_name,
          domain: rec.company.domain,
          website_url: rec.company.website_url,
          linkedin_url: rec.company.linkedin_url,
          person_hint: rec.person ?? null,
          signal_type: rec.signal_metadata?.type ?? null,
        },
        priority: 5,
      }));
    const CHUNK = 500;
    for (let i = 0; i < dmItems.length; i += CHUNK) {
      await supabase.from('lb_work_items').insert(dmItems.slice(i, i + CHUNK));
    }

    // (Removed) stage='enrich' enqueue. The work items had no consumer
    // edge function, so every refresh leaked dozens of pending rows that
    // the recover_stale_lb_work_items cron eventually marked dead. Pure
    // DB pollution, no Apify cost. If we re-introduce a domain-enrichment
    // stage later, restore an enqueue block here AND wire up a worker.
  }

  const inserted = persisted;
  const enrolledCount = persisted.filter((p) => p.outcome === 'enrolled').length;
  const reviewCount = persisted.filter((p) => p.outcome === 'review_pending').length;
  const droppedCount = scored.filter(({ rec }) => !persisted.find((p) => p.rec === rec)).length;

  await supabase
    .from('list_building_jobs')
    .update({
      total_companies: inserted.length,
      progress: 20,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (refreshJobId) {
    // If async runs are pending, leave status='running' and finished_at NULL
    // so the poller can finalize when all runs complete. Otherwise close out.
    const hasPendingAsync = apifyRunHandles.length > 0;
    await supabase
      .from('pack_refresh_jobs')
      .update({
        status: hasPendingAsync
          ? 'running'
          : (errors.length > 0 && inserted.length === 0 ? 'failed' : 'running'),
        contacts_added: enrolledCount + reviewCount,
        contacts_skipped: droppedCount,
        errors,
        ...(hasPendingAsync ? {} : { finished_at: new Date().toISOString() }),
      })
      .eq('id', refreshJobId);
  }

  // Bump subscription. Even if async runs are still in flight, we've kicked
  // them off — count as refreshed so the cadence picker doesn't re-fire.
  await supabase
    .from('pack_subscriptions')
    .update({
      next_refresh_at: nextRefreshAt(sub.refresh_cadence, sub.refresh_interval_minutes),
      last_refreshed_at: new Date().toISOString(),
    })
    .eq('id', sub.id);

  return {
    companies: inserted.length,
    modules: pack.modules.length,
    refreshJobId,
    jobId,
    errors,
    apify_runs_queued: apifyRunHandles.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    let forceId: string | undefined;
    let sinceOverride: string | undefined;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body && typeof body === 'object') {
          if (typeof body.subscription_id === 'string') forceId = body.subscription_id;
          if (typeof body.since_iso === 'string') sinceOverride = body.since_iso;
        }
      } catch { /* empty body is fine */ }
    }

    // The due-subscriptions sweep is the pg_cron job's (service-role key). A user
    // may only force-run a subscription of an org they can access.
    if (!isServiceRoleRequest(req)) {
      if (!forceId) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
      const { data: subRow } = await supabase
        .from('pack_subscriptions')
        .select('organization_id')
        .eq('id', forceId)
        .maybeSingle();
      try {
        await assertOrgAccess(req, supabase, subRow?.organization_id);
      } catch (authErr) {
        return unauthorized(authErr, corsHeaders);
      }
    }

    const subs = await listDueSubscriptions(supabase, forceId);
    const results = [];
    for (const sub of subs) {
      const r = await processSubscription(supabase, sub, sinceOverride);
      results.push({
        subscription_id: sub.id,
        pack_key: sub.pack_key,
        ...r,
      });
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[pack-refresh] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
