/**
 * Company identity resolution — the part that killed v1.
 *
 * Every observation arrives with a company *name* and, if we're lucky, a CIK or
 * an ATS token. Everything downstream (ICP scoring, email discovery, outreach)
 * needs a *domain*. Bridging that gap is the whole job, and the v1 scrapers
 * (removed in 1a812ac8) spent 364 LOC of heuristics failing at it.
 *
 * The strategy here is a cost ladder — always take the cheapest rung that can
 * answer, and only fall through to a paid lookup when nothing free will do:
 *
 *   0. CIK           — exact, permanent, free           (EDGAR)
 *   1. board URL     — exact, free                      (ATS on own domain)
 *   2. identity cache— free, and grows every run        (company_identities)
 *   3. CRM seed      — free, 168k rows already in hand  (crm_companies)
 *   4. QuickEnrich   — paid Company Finder, provider-specific cache/lease
 *      MoltSets      — legacy provider when QuickEnrich is not configured
 *   5. give up       — record the attempt so we don't re-buy the same miss
 *
 * Rung 4 is the only one that costs money, and the cache in front of it means a
 * company is bought at most once no matter how many signals mention it. That is
 * the difference between per-signal enrichment (which does not scale) and
 * per-company enrichment (which amortises to nothing).
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { QuickenrichAdapter, QuickenrichCompanyFinderError } from '../enrichment/quickenrich.ts';
import { selectQuickenrichIdentity, selectQuickenrichContactIdentity } from './quickenrich-identity.ts';
import { domainFromBoardUrl, namesMatch, normalizeCompanyName, normalizeDomain } from './normalize.ts';

const MOLTSETS_API_BASE = 'https://api.moltsets.com/api/v1/tools';

/**
 * Raised when the MoltSets SEARCH quota is exhausted.
 *
 * This is not an ordinary rate limit. MoltSets bills two independent quotas and
 * they fail very differently:
 *
 *   enrich/lookup  (reverse_linkedin_lookup, linkedin_to_*)  replenishes, ~50 records/min
 *   search         (search_companies, search_people)          LOCKS FOR DAYS
 *
 * On 2026-08-08 `analyze-company` used search_companies for exactly what this
 * resolver does — turning a company name into a domain — exhausted the search
 * window, and 3,829 of 3,924 calls failed. It stayed broken for two days and
 * was invisible, because the failure path returned null and read downstream as
 * a per-company "no match".
 *
 * So this is a distinct error type on purpose: the caller must abort the whole
 * run, not retry the row. Retrying against a locked quota is what turned that
 * incident from an outage into a silent multi-day one.
 */
export class MoltsetsSearchLockedError extends Error {
  constructor(readonly retryAfterSeconds: number | null, readonly detail: string) {
    super(`MoltSets search quota locked${retryAfterSeconds ? ` for ${retryAfterSeconds}s` : ''}: ${detail}`);
    this.name = 'MoltsetsSearchLockedError';
  }
}

/**
 * The provider has no usable balance. This is operationally distinct from a
 * company-level miss: consuming attempts would make every queued observation
 * permanently fail before an operator can replenish the shared key.
 */
export class MoltsetsSearchUnavailableError extends Error {
  constructor(readonly detail: string) {
    super(`MoltSets search unavailable: ${detail}`);
  }
}

export interface EntityHints {
  company_name?: string;
  domain?: string;
  website_url?: string;
  linkedin_url?: string;
  cik?: string;
  ats_provider?: string;
  ats_token?: string;
  country?: string;
  state?: string;
  industry?: string;
}

export interface CompanyIdentity {
  id: string;
  name: string;
  name_normalized: string;
  domain: string | null;
  linkedin_url: string | null;
  cik: string | null;
  resolved_via: string | null;
  resolution_attempts: number;
  updated_at: string | null;
}

const IDENTITY_COLUMNS =
  'id, name, name_normalized, domain, linkedin_url, cik, resolved_via, resolution_attempts, updated_at';

/** Total paid lookups we will ever spend on one company. */
export const MAX_RESOLUTION_ATTEMPTS = 2;
/** Wait this long before spending the second one. */
const RETRY_COOLDOWN_DAYS = 30;

/**
 * Negative cache: should we spend another paid lookup on a company we already
 * failed to resolve?
 *
 * This is the guard that keeps enrichment cost proportional to *companies*
 * rather than *signals*. Without it, every fresh observation naming an
 * unresolvable company buys the same miss again — and unresolvable companies
 * are exactly the ones that keep showing up, because nothing ever removes them
 * from the feed.
 *
 * A "no confident name match" is deterministic against a fixed provider index,
 * so an immediate retry is guaranteed to return the same answer and waste the
 * call. The only thing that changes the outcome is the provider adding the
 * company, which happens on a scale of weeks — hence the cooldown rather than
 * a plain attempts cap.
 */
function shouldRetryResolution(identity: CompanyIdentity): boolean {
  if (identity.domain) return false; // already resolved; nothing to retry
  if (identity.resolution_attempts >= MAX_RESOLUTION_ATTEMPTS) return false;
  if (identity.resolution_attempts > 0 && identity.updated_at) {
    const ageMs = Date.now() - new Date(identity.updated_at).getTime();
    if (ageMs < RETRY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

export interface ResolveDeps {
  supabase: SupabaseClient;
  quickenrichToken?: string | null;
  /** Reserve a maximum number of returned company credits, not just requests. */
  reserveQuickenrich?: () => Promise<number>;
  settleQuickenrich?: (reserved: number, used: number) => void;
  reserveQuickenrichDiscovery?: () => Promise<void>;
  /** Legacy paid provider, used when QuickEnrich is not configured. */
  moltsetsToken?: string | null;
  /** Called before each paid lookup; return false to skip (budget exhausted). */
  reserveMoltsets?: () => Promise<boolean>;
}

export interface ResolveOutcome {
  identity: CompanyIdentity | null;
  via: string;
  /** True when this call spent a paid MoltSets lookup. */
  billed: boolean;
  creditsUsed?: number;
  paidAttempted?: boolean;
}

// ---------------------------------------------------------------------------
// Cache lookups (free)
// ---------------------------------------------------------------------------

async function findByCik(supabase: SupabaseClient, cik: string): Promise<CompanyIdentity | null> {
  // CIKs are zero-padded inconsistently across EDGAR surfaces ("0001710501"
  // in the XML, "1710501" in the index). Store and query the padded form so
  // the two never miss each other.
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  const { data } = await supabase
    .from('company_identities')
    .select(IDENTITY_COLUMNS)
    .eq('cik', padded)
    .maybeSingle();
  return (data as CompanyIdentity) ?? null;
}

async function findByDomain(supabase: SupabaseClient, domain: string): Promise<CompanyIdentity | null> {
  const { data } = await supabase
    .from('company_identities')
    .select(IDENTITY_COLUMNS)
    .eq('domain', domain)
    .maybeSingle();
  return (data as CompanyIdentity) ?? null;
}

/**
 * Name lookup, resolved rows first.
 *
 * Returns null when more than one *resolved* identity shares the name: that is
 * a genuine collision (two different companies) and picking either one would be
 * a coin flip on which company gets credited with the signal.
 */
async function findByName(
  supabase: SupabaseClient,
  nameNormalized: string,
): Promise<CompanyIdentity | null | 'ambiguous'> {
  const { data } = await supabase
    .from('company_identities')
    .select(IDENTITY_COLUMNS)
    .eq('name_normalized', nameNormalized)
    .limit(5);
  const rows = (data ?? []) as CompanyIdentity[];
  if (rows.length === 0) return null;
  const resolved = rows.filter((r) => r.domain);
  if (resolved.length > 1) return 'ambiguous';
  return resolved[0] ?? rows[0];
}

/**
 * Rung 3: reuse companies we already hold — 168k in the CRM, 742k in the pool.
 *
 * Two bugs lived here and both failed silently, which is the worst way for a
 * free rung to fail: every miss fell straight through to the paid search rung,
 * the exact behaviour that locked the MoltSets search quota for two days in
 * August.
 *
 *   1. It selected a `website` column that does not exist on crm_companies
 *      (it is `website_url`), so PostgREST errored on every call.
 *   2. The error was never checked — `const { data }` discarded it — so the
 *      broken query read as "no match" rather than "this rung is broken".
 *
 * It also compared a *normalized* name against the *raw* name column with an
 * exact ILIKE, so "Eulerity, Inc." could never match "eulerity". Now it prefix-
 * matches to get candidates and applies the same conservative namesMatch gate
 * used everywhere else.
 */
async function findInSeedTables(
  supabase: SupabaseClient,
  nameNormalized: string,
  rawName: string,
): Promise<{ domain: string; name: string; via: string } | null> {
  const prefix = `${nameNormalized}%`;

  const { data: crm, error: crmErr } = await supabase
    .from('crm_companies')
    .select('name, domain, website_url')
    .not('domain', 'is', null)
    .ilike('name', prefix)
    .limit(10);
  if (crmErr) {
    // Loud, because a silently broken free rung is indistinguishable from a
    // genuine miss and pushes the cost onto the quota that fails hardest.
    console.error(`[signal-resolve] crm_companies seed lookup failed: ${crmErr.message}`);
  }

  const crmMatches = ((crm ?? []) as Array<{ name: string; domain: string | null; website_url: string | null }>)
    .filter((r) => namesMatch(rawName, r.name))
    .map((r) => ({ domain: normalizeDomain(r.domain ?? r.website_url), name: r.name }))
    .filter((r): r is { domain: string; name: string } => !!r.domain);

  const crmDomains = new Set(crmMatches.map((m) => m.domain));
  if (crmDomains.size === 1) {
    return { ...crmMatches[0], via: 'crm_seed' };
  }
  // More than one distinct domain for the same name is a real collision, and
  // guessing which is right is how a signal gets credited to the wrong company.
  if (crmDomains.size > 1) return null;

  const { data: pool, error: poolErr } = await supabase
    .from('lead_pool_verified')
    .select('company_name, domain')
    .not('domain', 'is', null)
    .ilike('company_name', prefix)
    .limit(10);
  if (poolErr) {
    console.error(`[signal-resolve] lead_pool_verified seed lookup failed: ${poolErr.message}`);
    return null;
  }

  const poolMatches = ((pool ?? []) as Array<{ company_name: string; domain: string | null }>)
    .filter((r) => namesMatch(rawName, r.company_name))
    .map((r) => ({ domain: normalizeDomain(r.domain), name: r.company_name }))
    .filter((r): r is { domain: string; name: string } => !!r.domain);

  const poolDomains = new Set(poolMatches.map((m) => m.domain));
  if (poolDomains.size === 1) return { ...poolMatches[0], via: 'pool_seed' };
  return null;
}

// ---------------------------------------------------------------------------
// Rung 4: MoltSets (paid)
// ---------------------------------------------------------------------------

/**
 * Name -> domain via MoltSets full-text company search.
 *
 * The provider returns ranked results, and taking the top hit blindly is how a
 * resolver mis-attributes signals. We require the winning record's name to pass
 * the same conservative gate we'd apply anywhere else — an unresolved company
 * costs us one lead, a wrongly-resolved one costs us credibility with whoever
 * receives that outreach.
 */
const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR',
]);

/**
 * EDGAR reports a two-letter code that is a US state for domestic issuers and a
 * country for foreign ones. When it is a US state we know the country outright,
 * which narrows the search and keeps overseas namesakes from outranking the
 * entity that actually filed — the Sugarfina Corp / Sugarfina Australia case.
 */
function countryFromHints(hints: { country?: string; state?: string }): string | undefined {
  if (hints.country) return hints.country;
  if (hints.state && US_STATES.has(hints.state.toUpperCase())) return 'United States';
  return undefined;
}

async function searchMoltsetsByName(
  token: string,
  name: string,
  filters: { country?: string; state?: string },
): Promise<{ domain: string; name: string; industry?: string; employee_count?: number } | null> {
  const body: Record<string, unknown> = { query: name, limit: 10 };
  const country = countryFromHints(filters);
  if (country) body.country = country;

  const resp = await fetch(`${MOLTSETS_API_BASE}/search_companies`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (resp.status === 404) return null;

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    // fair_use_limit_exceeded is the search window being spent. It arrives as a
    // 429 or a 4xx whose body names the limit, and carries retry_after in
    // SECONDS (204533 = 2d8h observed). Surface it loudly and distinctly —
    // logging it as an ordinary miss is what hid the 2026-08-08 outage.
    const retryAfterHeader = Number(resp.headers.get('retry-after'));
    const retryMatch = /"retry_after"\s*:\s*(\d+)/.exec(text);
    const retryAfter = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader
      : retryMatch ? Number(retryMatch[1]) : null;

    if (resp.status === 429 || /fair_use_limit_exceeded|window unlocks/i.test(text)) {
      console.error(
        `[signal-resolve] MoltSets SEARCH QUOTA LOCKED — aborting run. retry_after=${retryAfter ?? 'unknown'}s. ` +
        `This quota is shared with other consumers and stays locked for days; do not retry.`,
      );
      throw new MoltsetsSearchLockedError(retryAfter, text.slice(0, 200));
    }
    if (resp.status === 402 || /insufficient_tokens|insufficient (?:credit|balance)|out of (?:credit|token)/i.test(text)) {
      console.error('[signal-resolve] MoltSets SEARCH UNAVAILABLE — preserve queued observations until credits are restored.');
      throw new MoltsetsSearchUnavailableError(text.slice(0, 200));
    }
    throw new Error(`MoltSets search_companies ${resp.status}: ${text.slice(0, 200)}`);
  }

  // The REST endpoint nests one level deeper than the MCP wrapper:
  // { results: { results: [...] } }. Accept both so a provider-side change
  // doesn't silently turn every company into a miss.
  const json = (await resp.json().catch(() => null)) as { results?: unknown } | null;
  const outer = json?.results;
  const list: Array<Record<string, unknown>> = Array.isArray(outer)
    ? (outer as Array<Record<string, unknown>>)
    : outer && typeof outer === 'object' && Array.isArray((outer as { results?: unknown }).results)
      ? ((outer as { results: Array<Record<string, unknown>> }).results)
      : [];

  for (const row of list) {
    const candidateName = String(row.name ?? row.company_name ?? '');
    const domain = normalizeDomain(String(row.domain ?? row.website ?? ''));
    if (!domain || !candidateName) continue;
    if (!namesMatch(name, candidateName)) continue;

    const rawCount = row.employee_count ?? row.employeeCount;
    const count = typeof rawCount === 'number' ? rawCount : Number.parseInt(String(rawCount ?? ''), 10);
    return {
      domain,
      name: candidateName,
      industry: typeof row.industry === 'string' ? row.industry : undefined,
      employee_count: Number.isFinite(count) && count > 0 ? count : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

async function upsertIdentity(
  supabase: SupabaseClient,
  fields: {
    name: string;
    domain?: string | null;
    cik?: string | null;
    linkedin_url?: string | null;
    industry?: string | null;
    employee_count?: number | null;
    country?: string | null;
    resolved_via: string;
  },
): Promise<CompanyIdentity | null> {
  const nameNormalized = normalizeCompanyName(fields.name);
  const cik = fields.cik ? fields.cik.replace(/\D/g, '').padStart(10, '0') : null;

  // Domain is the canonical key when present, so an existing row wins over a
  // new insert — that is what makes the cache accumulate instead of fragment.
  if (fields.domain) {
    const existing = await findByDomain(supabase, fields.domain);
    if (existing) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (cik && !existing.cik) patch.cik = cik;
      if (Object.keys(patch).length > 1) {
        await supabase.from('company_identities').update(patch).eq('id', existing.id);
      }
      return existing;
    }

    // PROMOTE an existing unresolved placeholder rather than inserting beside it.
    //
    // A placeholder created by an earlier failed attempt already holds this CIK,
    // and cik is uniquely indexed — so inserting here raises a unique violation,
    // the error path looks up the brand-new domain, finds nothing, and returns
    // null. The lookup we just paid for is silently discarded and the row stays
    // unresolved forever. Observed live: 8 successful MoltSets hits, 0 resolved.
    if (cik) {
      const byCik = await findByCik(supabase, cik);
      if (byCik && !byCik.domain) {
        const { data: promoted } = await supabase
          .from('company_identities')
          .update({
            domain: fields.domain,
            website_url: fields.domain ? `https://${fields.domain}` : null,
            name: fields.name,
            name_normalized: nameNormalized,
            industry: fields.industry ?? null,
            employee_count: fields.employee_count ?? null,
            country: fields.country ?? null,
            resolved_via: fields.resolved_via,
            resolved_at: new Date().toISOString(),
            last_resolution_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', byCik.id)
          .select(IDENTITY_COLUMNS)
          .maybeSingle();
        if (promoted) return promoted as CompanyIdentity;
      }
    }

    // Same promotion for name-keyed placeholders (sources with no CIK).
    const byNamePlaceholder = await findByName(supabase, nameNormalized);
    if (byNamePlaceholder && byNamePlaceholder !== 'ambiguous' && !byNamePlaceholder.domain) {
      const { data: promoted } = await supabase
        .from('company_identities')
        .update({
          domain: fields.domain,
          website_url: `https://${fields.domain}`,
          cik: cik ?? byNamePlaceholder.cik,
          industry: fields.industry ?? null,
          employee_count: fields.employee_count ?? null,
          country: fields.country ?? null,
          resolved_via: fields.resolved_via,
          resolved_at: new Date().toISOString(),
          last_resolution_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', byNamePlaceholder.id)
        .select(IDENTITY_COLUMNS)
        .maybeSingle();
      if (promoted) return promoted as CompanyIdentity;
    }
  }

  const { data, error } = await supabase
    .from('company_identities')
    .insert({
      name: fields.name,
      name_normalized: nameNormalized,
      domain: fields.domain ?? null,
      cik,
      linkedin_url: fields.linkedin_url ?? null,
      industry: fields.industry ?? null,
      employee_count: fields.employee_count ?? null,
      country: fields.country ?? null,
      resolved_via: fields.resolved_via,
      resolved_at: fields.domain ? new Date().toISOString() : null,
      // Always 0 here. The caller owns the increment, and seeding this at 1 for
      // unresolved rows double-counted: a single failed lookup landed straight
      // on MAX_RESOLUTION_ATTEMPTS, so the cooldown retry could never fire.
      resolution_attempts: 0,
    })
    .select(IDENTITY_COLUMNS)
    .maybeSingle();

  if (error) {
    // Concurrent tick already created it — re-read rather than fail the row.
    if (fields.domain) return findByDomain(supabase, fields.domain);
    if (cik) return findByCik(supabase, cik);
    return null;
  }
  return (data as CompanyIdentity) ?? null;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export async function resolveCompany(
  deps: ResolveDeps,
  hints: EntityHints,
  boardUrl?: string | null,
): Promise<ResolveOutcome> {
  const { supabase } = deps;
  const name = hints.company_name?.trim() || hints.ats_token?.trim() || '';

  let cikPlaceholder: CompanyIdentity | null = null;
  // Rung 0 — CIK. Exact and permanent.
  if (hints.cik) {
    const hit = await findByCik(supabase, hints.cik);
    // Preserve unresolved placeholders for promotion after the free paths.
    if (hit?.domain) {
      return { identity: hit, via: 'cache_cik', billed: false };
    }
    cikPlaceholder = hit;
  }

  // Rung 1 — a domain we were handed, or one the board URL reveals for free.
  const directDomain =
    normalizeDomain(hints.domain ?? hints.website_url) ?? domainFromBoardUrl(boardUrl);
  if (directDomain) {
    const hit = await findByDomain(supabase, directDomain);
    if (hit) return { identity: hit, via: 'cache_domain', billed: false };
    const created = await upsertIdentity(supabase, {
      name: name || directDomain,
      domain: directDomain,
      cik: hints.cik ?? null,
      industry: hints.industry ?? null,
      country: hints.country ?? null,
      resolved_via: boardUrl && !hints.domain ? 'ats_board_url' : 'hint_domain',
    });
    return { identity: created, via: 'hint_domain', billed: false };
  }

  if (!name) return { identity: null, via: 'no_name', billed: false };
  const nameNormalized = normalizeCompanyName(name);
  if (!nameNormalized) return { identity: null, via: 'no_name', billed: false };

  // Rung 2 — identity cache by name.
  const byName = await findByName(supabase, nameNormalized);
  if (byName === 'ambiguous') {
    return { identity: null, via: 'ambiguous_name', billed: false };
  }
  if (byName?.domain) return { identity: byName, via: 'cache_name', billed: false };
  // Rung 3 — companies we already hold (CRM, then the verified pool).
  const seed = await findInSeedTables(supabase, nameNormalized, name);
  if (seed) {
    const created = await upsertIdentity(supabase, {
      name: seed.name,
      domain: seed.domain,
      cik: hints.cik ?? null,
      country: hints.country ?? null,
      resolved_via: seed.via,
    });
    return { identity: created, via: seed.via, billed: false };
  }

  // Prefer the funded Company Finder. Its own provider cache lets it try a
  // company missed by MoltSets without buying the same QuickEnrich miss again.
  if (deps.quickenrichToken) {
    const placeholder = cikPlaceholder ?? byName ?? await upsertIdentity(supabase, {
      name, domain: null, cik: hints.cik ?? null,
      country: hints.country ?? null, resolved_via: 'unresolved',
    });
    const country = quickenrichCountry(hints);
    const key = { p_provider: 'quickenrich', p_name: nameNormalized, p_country: country ?? '' };
    const { data: claim, error: claimError } = await supabase.rpc('claim_signal_company_lookup', key);
    if (claimError) throw new QuickenrichCompanyFinderError('PROVIDER_ERROR', null, `lookup lease: ${claimError.message}`, null);
    const lease = claim?.[0];
    if (!lease || lease.status !== 'granted') {
      return { identity: placeholder, via: lease?.status === 'busy' ? 'quickenrich_busy' : 'quickenrich_negative_cache', billed: false };
    }
    const finish = async (outcome: string, credits: number) => {
      const { data, error } = await supabase.rpc('finish_signal_company_lookup', {
        ...key, p_token: lease.token, p_outcome: outcome, p_credits: credits,
      });
      if (error || data !== true) throw new Error(`lookup cache save failed: ${error?.message ?? 'lease lost'}`);
    };
    let reserved = 0;
    let responseReceived = false;
    try {
      reserved = deps.reserveQuickenrich ? await deps.reserveQuickenrich() : 1;
      if (reserved <= 0) {
        await finish('unavailable', 0);
        return { identity: placeholder, via: 'quickenrich_budget', billed: false };
      }
      // Re-read after obtaining the global name lease: another observation may
      // have resolved this identity while we were waiting for capacity.
      const cached = await findByName(supabase, nameNormalized);
      if (cached && cached !== 'ambiguous' && cached.domain) {
        deps.settleQuickenrich?.(reserved, 0);
        reserved = 0;
        await finish('unavailable', 0);
        return { identity: cached, via: 'cache_name', billed: false };
      }
      const response = await QuickenrichAdapter.companyFinder(deps.quickenrichToken, {
        company_name: { include: [name], exclude: [] },
        ...(country ? { country_code: { include: [country], exclude: [] } } : {}),
        include_full_text: true, page: 1, per_page: reserved,
      });
      responseReceived = true;
      let result = selectQuickenrichIdentity(response, name, country);
      let source = 'company';
      if (result.reason === 'not_found' && result.creditsUsed === 0 && Array.isArray(response.data) && response.data.length === 0) {
        // Company Finder's name index can miss a company present in the
        // provider's contact dataset. Discovery is free and includes websites.
        // A complete bounded page is mandatory: do not infer identity from the
        // first employees of a potentially ambiguous/truncated company search.
        responseReceived = false; // the empty company result spent no credits
        await deps.reserveQuickenrichDiscovery?.();
        const contacts = await QuickenrichAdapter.contactFinder(deps.quickenrichToken, {
          company_name: { include: [name], exclude: [] },
          ...(country ? { country_code: { include: [country], exclude: [] } } : {}),
          page: 1, per_page: 100,
        });
        result = selectQuickenrichContactIdentity(contacts, name, country);
        responseReceived = true;
        source = 'contacts';
      }
      deps.settleQuickenrich?.(reserved, result.creditsUsed);
      reserved = 0;
      let identity = placeholder;
      if (result.candidate) {
        const found = result.candidate;
        identity = await upsertIdentity(supabase, {
          name: found.name, domain: found.domain, cik: hints.cik ?? null,
          industry: found.industry ?? hints.industry ?? null,
          employee_count: found.employee_count ?? null,
          country: found.country ?? hints.country ?? null, resolved_via: 'quickenrich',
        });
        if (!identity?.domain) throw new Error('QuickEnrich match could not be persisted');
      }
      await finish(result.reason, result.creditsUsed);
      return { identity, via: `quickenrich_${source === 'contacts' ? 'contacts_' : ''}${result.reason}`, billed: result.creditsUsed > 0,
        creditsUsed: result.creditsUsed, paidAttempted: true };
    } catch (error) {
      // A valid response may already have spent credits. Preserve its reserved
      // attempt if persistence fails; known provider outages refund it.
      if (!responseReceived) {
        deps.settleQuickenrich?.(reserved, 0);
        await finish('unavailable', 0);
      }
      if (error instanceof QuickenrichCompanyFinderError) throw error;
      throw new QuickenrichCompanyFinderError('PROVIDER_ERROR', null,
        error instanceof Error ? error.message : String(error), null);
    }
  }

  // Negative provider caches gate paid spending, after all free paths.
  const legacyPlaceholder = cikPlaceholder ?? byName;
  if (legacyPlaceholder && !shouldRetryResolution(legacyPlaceholder)) {
    return { identity: legacyPlaceholder, via: 'negative_cache_name', billed: false };
  }

  // Legacy rung 4 — paid lookup, gated by budget.
  if (deps.moltsetsToken) {
    const allowed = deps.reserveMoltsets ? await deps.reserveMoltsets() : true;
    if (allowed) {
      const found = await searchMoltsetsByName(deps.moltsetsToken, name, {
        country: hints.country ?? undefined,
        state: hints.state ?? undefined,
      });
      if (found) {
        const created = await upsertIdentity(supabase, {
          name: found.name,
          domain: found.domain,
          cik: hints.cik ?? null,
          industry: found.industry ?? hints.industry ?? null,
          employee_count: found.employee_count ?? null,
          country: hints.country ?? null,
          resolved_via: 'moltsets',
        });
        return { identity: created, via: 'moltsets', billed: true };
      }
      // A miss still costs a call, and re-buying the same miss every time the
      // company files again is how an enrichment bill quietly runs away. Record
      // the unresolved identity so the attempt counter can gate future tries.
      const placeholder = byName ?? (await upsertIdentity(supabase, {
        name,
        domain: null,
        cik: hints.cik ?? null,
        country: hints.country ?? null,
        resolved_via: 'unresolved',
      }));
      if (placeholder) {
        await supabase
          .from('company_identities')
          .update({
            resolution_attempts: (await currentAttempts(supabase, placeholder.id)) + 1,
            last_resolution_error: 'moltsets: no confident name match',
            updated_at: new Date().toISOString(),
          })
          .eq('id', placeholder.id);
      }
      return { identity: placeholder, via: 'moltsets_miss', billed: true };
    }
  }

  const placeholder = byName ?? (await upsertIdentity(supabase, {
    name,
    domain: null,
    cik: hints.cik ?? null,
    country: hints.country ?? null,
    resolved_via: 'unresolved',
  }));
  return { identity: placeholder, via: 'unresolved', billed: false };
}

async function currentAttempts(supabase: SupabaseClient, id: string): Promise<number> {
  const { data } = await supabase
    .from('company_identities')
    .select('resolution_attempts')
    .eq('id', id)
    .maybeSingle();
  return Number(data?.resolution_attempts ?? 0);
}

function quickenrichCountry(hints: EntityHints): string | undefined {
  const country = countryFromHints(hints)?.trim().toUpperCase();
  if (country === 'UNITED STATES' || country === 'USA') return 'US';
  if (country === 'UNITED KINGDOM' || country === 'UK') return 'GB';
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined;
}
