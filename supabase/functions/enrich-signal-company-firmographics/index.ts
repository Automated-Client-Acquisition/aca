/**
 * Edge Function: enrich-signal-company-firmographics
 * ----------------------------------------------------------------------------
 * Fills `lb_discovered_companies.employee_count_estimate` / `revenue_range` for
 * signal sources that do not carry firmographics, so the signal auto-add rule's
 * employee_bands / revenue_bands gates (migration 20260807170000) can actually
 * be used on them.
 *
 * WHY THIS EXISTS
 * The SignalBase pack module writes an exact headcount on ingest, so hiring /
 * funding / acquisition signals gate correctly today. Every other source writes
 * none — public_linkedin_signals (5,503 companies), common_crawl (4,553),
 * google_maps (3,673), sec_form_d / producthunt / techcrunch /
 * unipile_profile_monitor. An unknown firmographic FAILS a set gate by design,
 * so a "no solopreneurs" rule on those sources rejects 100% of candidates.
 *
 * THREE LANES, CHEAPEST FIRST
 *   A. lead_pool_verified by domain — free, no provider call. Grows in value as
 *      the pool fills, so it runs first even though it matches little today.
 *   B. MoltSets `reverse_linkedin_lookup` anchored on a decision-maker's
 *      personal /in/ URL. This is the LOOKUP quota (~15k/5h, replenishing).
 *      One call returns the company's exact employee_count, employee_range,
 *      revenue_range AND website_url.
 *   C. MoltSets `search_companies` by domain — the SEARCH quota, which locks
 *      for DAYS once spent. OPT-IN ONLY (`allowDomainSearch: true`), hard
 *      capped per run, and it trips a breaker that stops the whole run on the
 *      first sign of exhaustion. On 2026-08-08 analyze-company used this
 *      endpoint casually and 3,829 of 3,924 calls failed for two days.
 *
 * WHY LANE B IS THE LOAD-BEARING ONE
 * 1,131 of the 1,132 public_linkedin_signals companies that have a personal
 * LinkedIn URL also have NO domain — and the custom-branch gate joins
 * `lb_discovered_companies` to the contact BY domain. So headcount alone would
 * not even be reachable. reverse_linkedin_lookup returns `company.website_url`
 * in the same record, so one call fixes both halves.
 *
 * Lane B calls the endpoint directly rather than through MoltsetsAdapter: the
 * adapter's contract is email-centric and it discards the company block when a
 * profile resolves without a business address (returns NOT_FOUND, data: {}).
 * Here the firmographics ARE the product and the email is incidental.
 *
 * A miss stamps `firmographics_checked_at` too, so the provider's "don't know"
 * is not re-bought on the next run.
 *
 * POST body (all optional):
 *   { organizationId, limit, sources: string[], dryRun, allowDomainSearch,
 *     recheckDays }
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import {
  refundRateLimitedMoltsetsRequest,
  reserveMoltsetsRequest,
  type MoltsetsPlanTier,
} from '../_shared/enrichment/moltsets.ts';
import { resolveMoltsetsPacing } from '../_shared/enrichment/moltsets-budget.ts';
import { reportEnrichmentProviderRecord } from '../_shared/enrichment/rate-limit.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-enrich-secret, x-cron-secret',
};

const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1/tools';
/** Leave room under the platform's 150s kill so the run reports its own totals. */
const MAX_RUN_MS = 120_000;
/** Headcount and revenue move slowly; a company answered once is left alone. */
const DEFAULT_RECHECK_DAYS = 90;
/** Ceiling on lane C per run. Deliberately small — see the header. */
const DOMAIN_SEARCH_CAP = 25;

type Company = {
  id: string;
  organization_id: string;
  company_name: string | null;
  domain: string | null;
  website_url: string | null;
  source: string | null;
  employee_count_estimate: number | null;
  revenue_range: string | null;
  /** Personal /in/ URL that can resolve this company, chosen by the RPC. */
  anchor_linkedin_url: string | null;
};

type Firmographics = {
  company_name: string | null;
  employee_count: number | null;
  employee_range: string | null;
  revenue_range: string | null;
  website_url: string | null;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const host = new URL(String(value).includes('://') ? String(value) : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/** Drops the provider's placeholders so "Unknown" never reads as a band. */
function cleanFirmographic(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return ['unknown', 'n/a', 'none'].includes(text.toLowerCase()) ? null : text;
}

function parseCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Company name, stripped to something two sources can be compared on. */
function normalizeCompanyName(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|bv|nv|sa|sas|srl|spa|pty|plc|ag|ab|oy|group|holdings?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Does the record we just bought actually describe the company on this row?
 *
 * Both anchors can drift. A decision-maker who changed employers resolves to
 * their CURRENT company (reverse_linkedin_lookup is person-level truth), and
 * the CRM-contact anchor matches on company NAME, which collides — the same
 * hazard that forced a domain gate onto the public signal people
 * (20260807…name collisions). Writing an unrelated company's headcount into a
 * gate is worse than leaving the gate unknown, because unknown at least fails
 * closed. So a mismatch stamps the attempt and writes nothing.
 */
function nameMatches(rowName: string | null, providerName: string | null): boolean {
  const a = normalizeCompanyName(rowName);
  const b = normalizeCompanyName(providerName);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * What we write back. `employee_signal` mirrors the SignalBase module's shape
 * ("2323 employees (signalbase)") so provenance stays readable in the table;
 * the gate reads the integer, not this string.
 */
function buildPatch(f: Firmographics, existing: Company, source: string): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    firmographics_checked_at: new Date().toISOString(),
    firmographics_source: (f.employee_count || f.revenue_range) ? source : null,
  };
  if (f.employee_count !== null && existing.employee_count_estimate === null) {
    patch.employee_count_estimate = f.employee_count;
    patch.employee_signal = `${f.employee_count} employees (${source})`;
  }
  if (f.revenue_range && !existing.revenue_range) patch.revenue_range = f.revenue_range;

  // The custom-branch gate reaches this row BY domain, so a company with no
  // domain is unreachable no matter how good its headcount is. Fill it when the
  // provider hands one over, never overwrite one we already trust.
  const learnedDomain = normalizeDomain(f.website_url);
  if (learnedDomain && !normalizeDomain(existing.domain)) {
    patch.domain = learnedDomain;
    if (!existing.website_url) patch.website_url = f.website_url;
  }
  return patch;
}

/**
 * Lane B. Direct call, kept deliberately tolerant of response shape: MoltSets
 * nests results one level deeper on some endpoints than others.
 */
async function reverseLinkedinLookup(
  token: string,
  linkedinUrl: string,
): Promise<{ firmographics: Firmographics | null; rateLimited: boolean }> {
  const res = await fetch(`${MOLTSETS_API_BASE}/reverse_linkedin_lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedin_url: linkedinUrl }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) return { firmographics: null, rateLimited: true };
  // 404 = profile not in the index, 422 = URL the provider won't accept.
  // Both are honest answers, not failures to retry.
  if (res.status === 404 || res.status === 422) return { firmographics: null, rateLimited: false };
  if (!res.ok) throw new Error(`MoltSets reverse_linkedin_lookup ${res.status}`);

  const body = await res.json().catch(() => null) as { results?: Record<string, unknown> } | null;
  const company = (body?.results?.company ?? {}) as Record<string, unknown>;
  if (!company || Object.keys(company).length === 0) return { firmographics: null, rateLimited: false };

  return {
    firmographics: {
      company_name: cleanFirmographic(company.name),
      employee_count: parseCount(company.employee_count),
      employee_range: cleanFirmographic(company.employee_range),
      revenue_range: cleanFirmographic(company.revenue_range),
      website_url: cleanFirmographic(company.website_url),
    },
    rateLimited: false,
  };
}

/**
 * Lane C. Same parser as enrich-signal-people's public-feed path.
 * `exhausted` is the breaker: MoltSets answers a spent search quota with a
 * 402/403/429, and one of those must stop the run rather than burn through the
 * remaining candidates producing identical failures.
 */
async function searchCompanyByDomain(
  token: string,
  domain: string,
): Promise<{ firmographics: Firmographics | null; exhausted: boolean }> {
  const res = await fetch(`${MOLTSETS_API_BASE}/search_companies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, limit: 1 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 402 || res.status === 403 || res.status === 429) {
    return { firmographics: null, exhausted: true };
  }
  if (res.status === 404) return { firmographics: null, exhausted: false };
  if (!res.ok) throw new Error(`MoltSets search_companies ${res.status}`);

  const body = await res.json().catch(() => null) as { results?: unknown } | null;
  const outer = body?.results;
  const list = Array.isArray(outer)
    ? outer
    : (outer && typeof outer === 'object' && Array.isArray((outer as { results?: unknown }).results)
        ? (outer as { results: unknown[] }).results
        : []);
  const first = (list[0] ?? null) as Record<string, unknown> | null;
  if (!first) return { firmographics: null, exhausted: false };

  return {
    firmographics: {
      // Lane C keyed on the domain itself, so there is nothing to disambiguate
      // — the row's own name is echoed back to satisfy the shared guard.
      company_name: cleanFirmographic(first.name ?? first.company_name) ?? null,
      employee_count: parseCount(first.employee_count ?? first.employeeCount),
      employee_range: cleanFirmographic(first.employee_range ?? first.employeeRange),
      revenue_range: cleanFirmographic(first.revenue_range ?? first.revenueRange),
      website_url: cleanFirmographic(first.website_url ?? first.websiteUrl),
    },
    exhausted: false,
  };
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!supabaseUrl || !serviceKey || !encryptionKey) {
      return response({ error: 'Missing required environment variables' }, 500);
    }

    // Same optional shared-secret gate as enrich-signal-people: internal task.
    const requiredSecret = Deno.env.get('SIGNAL_ENRICH_SECRET');
    if (requiredSecret && req.headers.get('x-enrich-secret') !== requiredSecret) {
      return response({ error: 'Forbidden' }, 403);
    }

    const startedAt = Date.now();
    const supabase = createClient(supabaseUrl, serviceKey) as unknown as SupabaseClient;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;

    const limit = Math.min(500, Math.max(1, Number(body.limit) > 0 ? Number(body.limit) : 100));
    const dryRun = body.dryRun === true;
    const allowDomainSearch = body.allowDomainSearch === true;
    const recheckDays = Number(body.recheckDays) > 0 ? Number(body.recheckDays) : DEFAULT_RECHECK_DAYS;
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null;
    const sources = Array.isArray(body.sources) ? (body.sources as string[]).filter(Boolean) : null;

    // ---- Candidates ---------------------------------------------------------
    // Selection and anchoring are one RPC. Picking "missing headcount, newest
    // first" here instead put 21 of every 25 slots on companies with no anchor,
    // and an unanchored company is never stamped — so a stable ordering re-served
    // the same dead rows every run and the sweep never reached the ~1,850 it can
    // actually resolve. A row is a candidate only if it arrives with the URL that
    // will resolve it.
    const { data: candidateRows, error: candidateError } = await supabase.rpc(
      'signal_firmographic_candidates',
      {
        p_org: organizationId,
        p_sources: sources,
        p_recheck_days: recheckDays,
        p_limit: limit,
        p_include_domain_only: allowDomainSearch,
      },
    );
    if (candidateError) throw new Error(`Could not load companies: ${candidateError.message}`);
    const candidates = (candidateRows ?? []) as Company[];
    if (candidates.length === 0) {
      return response({ ok: true, candidates: 0, filled: 0, note: 'nothing resolvable to enrich' });
    }

    const summary = {
      candidates: candidates.length,
      anchored: candidates.filter((c) => !!c.anchor_linkedin_url).length,
      fromPool: 0,
      fromReverseLinkedin: 0,
      fromDomainSearch: 0,
      domainsLearned: 0,
      domainCollisions: 0,
      anchorMismatches: 0,
      missesStamped: 0,
      orgsSkippedNoKey: 0,
      orgsSkippedExhausted: 0,
      searchQuotaExhausted: false,
      timedOut: false,
      errors: [] as string[],
    };

    const applyPatch = async (company: Company, patch: Record<string, unknown>) => {
      if (dryRun) return;
      const { error } = await supabase
        .from('lb_discovered_companies')
        .update(patch)
        .eq('id', company.id);
      if (!error) return;

      // Two signal companies can resolve to the same domain (a rebrand, or the
      // same employer discovered under two names), and the table holds a unique
      // (org, domain) per signal source. The firmographics are still correct and
      // still worth having — the domain is the part that cannot land. Retry
      // without it rather than throwing away a paid record.
      if (error.code === '23505' && 'domain' in patch) {
        const { domain: _d, website_url: _w, ...withoutDomain } = patch;
        const { error: retryError } = await supabase
          .from('lb_discovered_companies')
          .update(withoutDomain)
          .eq('id', company.id);
        if (retryError) { summary.errors.push(`${company.id}: ${retryError.message}`); return; }
        summary.domainCollisions++;
        summary.domainsLearned--; // counted optimistically at call time
        return;
      }
      summary.errors.push(`${company.id}: ${error.message}`);
    };

    // ---- Lane A: the pool, free --------------------------------------------
    const remaining: Company[] = [];
    const byDomain = new Map<string, Company[]>();
    for (const c of candidates) {
      const d = normalizeDomain(c.domain);
      if (!d) { remaining.push(c); continue; }
      const bucket = byDomain.get(d);
      if (bucket) bucket.push(c); else byDomain.set(d, [c]);
    }

    if (byDomain.size > 0) {
      const domains = [...byDomain.keys()];
      const hits = new Map<string, Firmographics>();
      for (let i = 0; i < domains.length; i += 200) {
        const { data: poolRows, error: poolError } = await supabase
          .from('lead_pool_verified')
          .select('domain, employee_count, employee_range, revenue_range')
          .in('domain', domains.slice(i, i + 200))
          .not('employee_count', 'is', null);
        if (poolError) { summary.errors.push(`pool: ${poolError.message}`); break; }
        for (const row of (poolRows ?? []) as Record<string, unknown>[]) {
          const d = String(row.domain ?? '');
          if (d && !hits.has(d)) {
            hits.set(d, {
              company_name: null,
              employee_count: parseCount(row.employee_count),
              employee_range: cleanFirmographic(row.employee_range),
              revenue_range: cleanFirmographic(row.revenue_range),
              website_url: null,
            });
          }
        }
      }
      for (const [domain, companiesForDomain] of byDomain) {
        const hit = hits.get(domain);
        for (const company of companiesForDomain) {
          if (!hit) { remaining.push(company); continue; }
          await applyPatch(company, buildPatch(hit, company, 'lead_pool'));
          summary.fromPool++;
        }
      }
    }

    // ---- Provider lanes, per org -------------------------------------------
    const byOrg = new Map<string, Company[]>();
    for (const c of remaining) {
      const bucket = byOrg.get(c.organization_id);
      if (bucket) bucket.push(c); else byOrg.set(c.organization_id, [c]);
    }

    let domainSearchesThisRun = 0;

    for (const [orgId, orgCompanies] of byOrg) {
      if (Date.now() - startedAt > MAX_RUN_MS) { summary.timedOut = true; break; }

      const keyRow = await resolveApiKey(supabase, orgId, 'moltsets');
      if (!keyRow?.key_encrypted) { summary.orgsSkippedNoKey++; continue; }
      const token = await decryptApiKey(keyRow.key_encrypted, encryptionKey);

      // Pace against MoltSets' own fair-use accounting, like every other caller
      // sharing this org's key — otherwise a backfill sweep starves the email
      // enrichment that shares the same budget.
      const limits = await resolveMoltsetsPacing(
        supabase,
        orgId,
        token,
        (keyRow.metadata?.plan as MoltsetsPlanTier | undefined) ?? null,
      );
      if (!limits) { summary.errors.push(`Org ${orgId}: MoltSets key has no plan tier configured`); continue; }
      if (limits.exhausted) { summary.orgsSkippedExhausted++; continue; }

      for (const company of orgCompanies) {
        if (Date.now() - startedAt > MAX_RUN_MS) { summary.timedOut = true; break; }

        const anchor = company.anchor_linkedin_url;
        const domain = normalizeDomain(company.domain);
        let firmographics: Firmographics | null = null;
        let lane: string | null = null;

        // ---- Lane B: reverse_linkedin_lookup (lookup quota) -----------------
        if (anchor) {
          const reservation = await reserveMoltsetsRequest(supabase, orgId, limits, 30_000);
          if (reservation.status !== 'granted') {
            // Daily cap or a rate wait longer than we're willing to hold. Leave
            // the company unstamped so the next run picks it up untouched.
            continue;
          }
          try {
            const result = await reverseLinkedinLookup(token, anchor);
            await reportEnrichmentProviderRecord(supabase, orgId, 'moltsets', !!result.firmographics);
            if (result.rateLimited) {
              await refundRateLimitedMoltsetsRequest(supabase, reservation.reservationId);
              summary.errors.push(`Org ${orgId}: MoltSets rate limited, stopping org`);
              break;
            }
            // Person-level truth: the record describes where this person works
            // NOW, which is not necessarily the company on this row.
            if (result.firmographics && !nameMatches(company.company_name, result.firmographics.company_name)) {
              summary.anchorMismatches++;
            } else if (result.firmographics) {
              firmographics = result.firmographics;
              lane = 'moltsets_reverse_linkedin';
            }
          } catch (err) {
            summary.errors.push(`${company.id}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        }

        // ---- Lane C: search_companies (search quota — opt-in, capped) -------
        if (!firmographics && allowDomainSearch && domain && !summary.searchQuotaExhausted) {
          if (domainSearchesThisRun >= DOMAIN_SEARCH_CAP) {
            // Not an error — say so rather than letting a silent cap read as
            // "covered everything".
            continue;
          }
          const reservation = await reserveMoltsetsRequest(supabase, orgId, limits, 30_000);
          if (reservation.status !== 'granted') continue;
          domainSearchesThisRun++;
          try {
            const result = await searchCompanyByDomain(token, domain);
            if (result.exhausted) {
              summary.searchQuotaExhausted = true;
              // Loud on purpose: the 2026-08-08 outage was invisible because
              // both failure branches logged at info level and returned null.
              console.error(`[signal-firmographics] MoltSets SEARCH quota exhausted for org ${orgId} — stopping lane C for this run`);
              await refundRateLimitedMoltsetsRequest(supabase, reservation.reservationId);
              continue;
            }
            if (result.firmographics) { firmographics = result.firmographics; lane = 'moltsets_search_companies'; }
          } catch (err) {
            summary.errors.push(`${company.id}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        }

        // Nothing to look up with, or the provider had nothing. Stamp the
        // attempt either way — an unanswerable company must not be re-bought.
        if (!firmographics || !lane) {
          if (anchor || (allowDomainSearch && domain)) {
            await applyPatch(company, {
              firmographics_checked_at: new Date().toISOString(),
              firmographics_source: null,
            });
            summary.missesStamped++;
          }
          continue;
        }

        const patch = buildPatch(firmographics, company, lane);
        if (patch.domain) summary.domainsLearned++;
        await applyPatch(company, patch);
        if (lane === 'moltsets_reverse_linkedin') summary.fromReverseLinkedin++;
        else summary.fromDomainSearch++;
      }
    }

    const filled = summary.fromPool + summary.fromReverseLinkedin + summary.fromDomainSearch;
    return response({
      ok: true,
      dryRun,
      filled,
      ...summary,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[signal-firmographics] run failed:', error);
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
