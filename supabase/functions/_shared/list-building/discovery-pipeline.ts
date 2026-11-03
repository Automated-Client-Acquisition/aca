/**
 * Shared discovery-record processing pipeline.
 *
 * Both list-building-pack-refresh (synchronous SignalBase modules + non-Apify
 * pack modules) AND list-building-apify-poller (async SignalBase via Apify
 * webhook/polling) feed records through this module. Keeping the logic in
 * one place ensures ICP scoring, dedup, persistence, signal_activity_log
 * writes, and downstream stage='dm' enqueue all behave identically across
 * both code paths.
 *
 * Spec: ACA Discovery Layer Implementation Brief v1.2, §8 + §11.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { DiscoveryRecord } from './pack-modules/types.ts';
import { scoreCompanyForListBuilding, type ICPDefinition } from '../icp-scorer.ts';
import { decryptApiKey } from '../apify-leads-utils.ts';
import { isPlausibleHumanName } from './name-validator.ts';

export interface PackSubscriptionRow {
  id: string;
  organization_id: string;
  pack_key: string;
  tier: string;
  config: Record<string, unknown>;
  refresh_cadence: 'daily' | 'weekly' | 'monthly';
  lead_list_id: string | null;
  last_refreshed_at: string | null;
  icp_id: string | null;
  icp_product_id: string | null;
  min_icp_score: number | null;
  review_band: number | null;
  destination_type: 'campaign' | 'sequence' | 'holding' | null;
  destination_id: string | null;
  daily_cap: number | null;
  weekly_cap: number | null;
}

export type SignalOutcome =
  | 'enrolled'
  | 'enrolled_holding'
  | 'review_pending'
  | 'dropped_below_threshold'
  | 'dropped_no_icp_match'
  | 'cap_hit'
  | 'failed';

export interface IcpContext {
  icp: ICPDefinition;
  openRouterApiKey: string;
}

export interface CapState {
  todayUsed: number;
  weekUsed: number;
}

export interface ScoredRecord {
  rec: DiscoveryRecord;
  icp_score: number | null;
  icp_reasoning: string | null;
  scoring_failed: boolean;
}

export interface ProcessOutcome {
  enrolled: number;
  review_pending: number;
  dropped_below_threshold: number;
  cap_hit: number;
  failed: number;
  persisted_company_ids: string[];
  errors: string[];
}

/**
 * Canonical identity for one provider event.
 *
 * A company can legitimately emit several signals on the same day (for
 * example, a funding round followed by executive hires).  Company identity is
 * therefore only one component of deduplication; it must never be used as the
 * event identity by itself.
 */
export function discoveryEventKey(rec: DiscoveryRecord): string {
  const clean = (value: unknown) => String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const raw = rec.raw_signal ?? {};
  const providerRecordId = raw.signalId ?? raw.signal_id ?? raw.id ?? raw.uuid ?? '';
  const company = rec.company.linkedin_url || rec.company.domain || rec.company.company_name;
  const type = rec.signal_metadata?.type ?? '';
  const date = rec.signal_metadata?.date ?? '';
  const evidence = rec.signal_metadata?.evidence_url || rec.source_url || providerRecordId;
  // Detail is the final fallback for providers that supply neither a stable
  // record id nor a canonical evidence URL.
  const fallback = providerRecordId || rec.signal_metadata?.detail || rec.company.company_name;
  return [rec.source, company, type, date, evidence || fallback].map(clean).join('|');
}

/**
 * A person-first signal has no independently verifiable company identity, so
 * it may enter ACA only when the provider supplied an actual senior person and
 * that person's canonical LinkedIn profile. This prevents a post author or an
 * individual contributor from being treated as a decision-maker by default.
 */
export function isEligiblePersonFirstDecisionMaker(person: DiscoveryRecord['person']): boolean {
  if (!person || !person.linkedin_url || !/linkedin\.com\/in\/[^/?#]+/i.test(person.linkedin_url)) return false;
  const title = person.title ?? '';
  const isSenior = /\b(founder|co-?founder|owner|ceo|cto|cmo|cfo|coo|cro|cio|chro|chief|president|managing director|managing partner|partner|general partner|\bgp\b|vp|vice president|svp|evp|head of|director)\b/i.test(title);
  return isSenior && isPlausibleHumanName(person.first, person.last ?? null);
}

// ---------------------------------------------------------------------------
// ICP context loader — direct icp_id preferred, falls back to product_icp_fit.
// ---------------------------------------------------------------------------
export async function loadIcpContext(
  supabase: SupabaseClient,
  organizationId: string,
  options: { icpId?: string | null; productId?: string | null },
): Promise<IcpContext | null> {
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
    console.warn('[discovery-pipeline] no openrouter key, skipping ICP scoring');
    return null;
  }
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const openRouterApiKey = await decryptApiKey(keyRow.key_encrypted as string, encryptionKey);
  return { icp: icp as ICPDefinition, openRouterApiKey };
}

// ---------------------------------------------------------------------------
// Score a single discovery record against an ICP using the OpenRouter LLM.
// ---------------------------------------------------------------------------
export async function scoreRecord(
  rec: DiscoveryRecord,
  ctx: IcpContext,
): Promise<{ score: number; reasoning: string } | null> {
  try {
    // For person-first signals (post engagement, profile monitor) the
    // "company" is actually a placeholder containing the person's name —
    // we don't have real company info at discovery time. Detect that case
    // and feed the scorer a more honest snippet so it doesn't hit the
    // "no data, default to ~50%" fallback path that produces uniform 70s.
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
        // Pass real person info through if we have it (profile monitor,
        // unipile inbound, etc.). Falls back to "Unknown" only when the
        // record genuinely has no DM hint (legacy company-only signals).
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
    console.error('[discovery-pipeline] ICP score failed', err);
    return null;
  }
}

/**
 * Run independent lead stages in parallel without allowing one list refresh
 * to exhaust the LLM/provider connection budget. Results stay in input order
 * so outcome accounting and cap application remain deterministic.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  }));

  return results;
}

export async function loadCapState(
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

export function withinCaps(state: CapState, sub: PackSubscriptionRow): boolean {
  if (sub.daily_cap != null && state.todayUsed >= sub.daily_cap) return false;
  if (sub.weekly_cap != null && state.weekUsed >= sub.weekly_cap) return false;
  return true;
}

export async function logActivity(
  supabase: SupabaseClient,
  sub: PackSubscriptionRow,
  outcome: SignalOutcome,
  rec: DiscoveryRecord,
  scored: { icp_score: number | null; icp_reasoning: string | null },
  ids: { contact_id?: string | null; discovered_company_id?: string | null } = {},
): Promise<void> {
  try {
    // Upsert (not insert) against the (subscription_id, signal_dedup_key)
    // unique index added in migration 20260620010000. ignoreDuplicates=true
    // silently no-ops re-ingestion of an evidence_url we've already logged
    // for this subscription — structural insurance against the apify-poller
    // wedge from 2026-05-21. The poller fix + watchdog should prevent
    // re-ingestion at the source, but this guarantees the row spam can't
    // happen even if a future bug regresses that.
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
            // This key intentionally contains the event type + canonical
            // evidence/record identity. The database uniqueness constraint
            // consumes it, preventing re-polls from duplicating the same event
            // without collapsing distinct signals from one company.
            signal_dedup_key: discoveryEventKey(rec),
            company_name: rec.company.company_name,
            domain: rec.company.domain,
            signal_date: rec.signal_metadata?.date,
            evidence_url: rec.signal_metadata?.evidence_url,
            icp_reasoning: scored.icp_reasoning,
            // Structured personalisation payload the producing module attached.
            // SignalMetadata.context has always carried this, but it was never
            // persisted, so anything a module computed for outreach died here.
            // The ACA engine puts confidence and corroboration_count in it —
            // the numbers that separate a legally-filed, multiply-confirmed
            // event from a single unverified mention — so it has to survive.
            signal_context: rec.signal_metadata?.context ?? null,
            // Full provider record for "show me everything" debugging /
            // template variable expansion. Renders as JSON in the UI.
            raw_signal: rec.raw_signal ?? null,
          },
        },
        { onConflict: 'subscription_id,signal_dedup_key', ignoreDuplicates: true },
      );
  } catch (err) {
    console.error('[discovery-pipeline] activity log upsert failed', err);
  }
}

// ---------------------------------------------------------------------------
// Process a batch of records: dedup → ICP score → outcome decision → persist
// → log activity → enqueue stage='dm' work items.
//
// Returns counts and the list of newly-persisted lb_discovered_companies IDs.
// ---------------------------------------------------------------------------
export async function processDiscoveryRecords(
  supabase: SupabaseClient,
  sub: PackSubscriptionRow,
  jobId: string,
  records: DiscoveryRecord[],
): Promise<ProcessOutcome> {
  const errors: string[] = [];

  // De-dup identical provider events, not companies. A single company can
  // produce funding, hiring, and leadership events in one refresh and each
  // must reach the activity log and downstream ACA/public views.
  const seen = new Set<string>();
  const deduped = records.filter((rec) => {
    const key = discoveryEventKey(rec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ICP context.
  const icpCtx: IcpContext | null =
    sub.icp_id || sub.icp_product_id
      ? await loadIcpContext(supabase, sub.organization_id, {
          icpId: sub.icp_id,
          productId: sub.icp_product_id,
        })
      : null;
  const requiresIcpScore = !!(sub.icp_id || sub.icp_product_id);
  if (requiresIcpScore && !icpCtx) {
    // Never turn an unavailable ICP into an unfiltered enrollment. That is a
    // correctness failure, not an acceptable fallback: the wrong companies
    // would otherwise be pushed to ACA and potentially enrolled in outreach.
    const reason = 'ICP set but unavailable for scoring (missing OpenRouter key or ICP row); no companies were enrolled';
    errors.push(reason);
    for (const rec of deduped) {
      await logActivity(supabase, sub, 'failed', rec, { icp_score: null, icp_reasoning: reason });
    }
    return {
      enrolled: 0,
      review_pending: 0,
      dropped_below_threshold: 0,
      cap_hit: 0,
      failed: deduped.length,
      persisted_company_ids: [],
      errors,
    };
  }

  const minScore = sub.min_icp_score ?? 70;
  const reviewBand = sub.review_band ?? 10;
  const reviewFloor = Math.max(0, minScore - reviewBand);

  let capState = await loadCapState(supabase, sub.id);

  // ICP scoring is independent per lead. Keep concurrency bounded so a
  // large refresh is faster without turning one organization into an
  // unbounded burst against the LLM provider.
  const scored: ScoredRecord[] = await mapWithConcurrency(
    deduped,
    10,
    async (rec) => {
      if (!icpCtx) return { rec, icp_score: null, icp_reasoning: null, scoring_failed: false };
      const result = await scoreRecord(rec, icpCtx);
      return {
        rec,
        icp_score: result?.score ?? null,
        icp_reasoning: result?.reasoning ?? null,
        scoring_failed: !result,
      };
    },
  );

  type Persisted = {
    id: string;
    rec: DiscoveryRecord;
    outcome: SignalOutcome;
    icp_score: number | null;
    icp_reasoning: string | null;
  };
  const persisted: Persisted[] = [];

  for (const { rec, icp_score, icp_reasoning, scoring_failed } of scored) {
    if (scoring_failed) {
      const reason = 'ICP scoring failed; company was not enrolled';
      errors.push(reason);
      await logActivity(supabase, sub, 'failed', rec, { icp_score, icp_reasoning: reason });
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

    // Persist in lb_discovered_companies. There's a partial unique index
    // (organization_id, linkedin_url) WHERE linkedin_url IS NOT NULL — same
    // canonical company across refreshes should reuse the existing row, not
    // throw a unique-violation. UPSERT does that. When linkedin_url is null
    // (rare — companies discovered by domain only), fall back to plain insert
    // since there's no unique key to conflict on.
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
    const builder = rec.company.linkedin_url
      ? supabase.from('lb_discovered_companies').upsert(companyPayload, {
          onConflict: 'organization_id,linkedin_url',
          ignoreDuplicates: false,
        })
      : supabase.from('lb_discovered_companies').insert(companyPayload);
    const { data: ins, error: insErr } = await builder.select('id').single();

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

  // Enqueue stage='dm' work items.
  // Filters before burning an Apify run on each company:
  //   1. outcome='enrolled' only — review_pending companies wait for the user
  //      to approve them via approve_signal_review_item.
  //   2. Skip companies that already have lb_decision_makers from a previous
  //      refresh — same canonical company across refreshes shouldn't re-scrape.
  //   3. Skip companies with a completed/dead dm work item in the last 7 days
  //      (matches the recover_stuck_dm_signals retry cap).
  //   4. Person-first signals (post engagers, inbound) skip dm entirely —
  //      we already have the person, just need their email.
  if (persisted.length > 0) {
    const allEnrolled = persisted.filter(({ outcome }) => outcome === 'enrolled');

    // Person-first split: records where we have a person but no real company.
    const personFirst = allEnrolled.filter(({ rec }) =>
      !rec.company.linkedin_url && !rec.company.domain && isEligiblePersonFirstDecisionMaker(rec.person));
    const enrolled = allEnrolled.filter(({ rec }) =>
      rec.company.linkedin_url || rec.company.domain);

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
      // Upsert: (company_id, linkedin_url) is UNIQUE on lb_decision_makers,
      // so refreshing the same signal subscription would re-collide on
      // every engager. Upsert returns the existing row's id when there's
      // a match, which keeps the downstream profile_email enqueue idempotent.
      const { data: insertedDms, error: dmErr } = await supabase
        .from('lb_decision_makers')
        .upsert(dmRows, { onConflict: 'company_id,linkedin_url', ignoreDuplicates: false })
        .select('id, linkedin_url');
      if (dmErr) {
        console.warn('[discovery-pipeline] person-first dm upsert failed', dmErr.message);
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
            `[discovery-pipeline] person-first: ${insertedDms.length} engagers → DMs, ` +
            `${emailItems.length} profile_email items enqueued`,
          );
        }
      }
    }

    const candidateUrls = enrolled
      .map(({ rec }) => rec.company.linkedin_url)
      .filter((u): u is string => !!u);
    const skipUrls = new Set<string>();
    if (candidateUrls.length > 0) {
      const { data: dmRows } = await supabase
        .from('lb_discovered_companies')
        .select('linkedin_url, lb_decision_makers!inner(id)')
        .eq('organization_id', sub.organization_id)
        .in('linkedin_url', candidateUrls);
      for (const row of (dmRows as Array<{ linkedin_url: string }> | null) ?? []) {
        if (row.linkedin_url) skipUrls.add(row.linkedin_url);
      }
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
        `[discovery-pipeline] dm enqueue: skipping ${skipUrls.size}/${enrolled.length} ` +
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
        },
        priority: 5,
      }));
    const CHUNK = 500;
    for (let i = 0; i < dmItems.length; i += CHUNK) {
      await supabase.from('lb_work_items').insert(dmItems.slice(i, i + CHUNK));
    }

    // (Removed) stage='enrich' enqueue — no consumer edge function exists,
    // so the rows just leaked into pending state until recover_stale cron
    // marked them dead. See pack-refresh for the same removal.
  }

  return {
    enrolled: persisted.filter((p) => p.outcome === 'enrolled').length,
    review_pending: persisted.filter((p) => p.outcome === 'review_pending').length,
    dropped_below_threshold: scored.filter(
      ({ rec }) => !persisted.find((p) => p.rec === rec),
    ).length,
    cap_hit: 0,
    failed: errors.length,
    persisted_company_ids: persisted.map((p) => p.id),
    errors,
  };
}
