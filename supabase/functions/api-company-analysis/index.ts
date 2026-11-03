/**
 * REST resource: /v1/companies/analysis
 *
 *   POST /v1/companies/analysis   analyze a contact's company, return the result
 *   GET  /v1/companies/analysis?contactId=…   read the last analysis, never crawl
 *
 * This exposes `analyze-company` to API callers. That function is the platform's
 * only company crawler: it fetches the homepage, discovers nav links scored for
 * relevance, falls back to `/about`, `/about-us`, `/services`, `/company`, and
 * escalates to crawl4ai for JS-rendered sites. Integrations kept rebuilding a
 * worse version of it because it was unreachable without a Supabase JWT — an
 * `aca_` token could not call it at all.
 *
 * Two things come back, because callers need both and they live in different
 * places:
 *
 *   - `offering` — what the company sells, extracted by the LLM and stored on
 *     `crm_contacts.enrichment_data`.
 *   - `markdown` — the crawled page text itself, from `website_scrape_cache`,
 *     keyed by domain and shared across every contact at that company.
 *
 * The crawl is the expensive half and the cache is domain-scoped, so ten
 * contacts at one company crawl once. `maxAgeDays` extends the same idea to the
 * analysis: a fresh, same-scope result is reused rather than re-crawled.
 */

import { ApiError, createResource, json, type Handler } from '../_shared/rest-api.ts';

/**
 * The subset of `enrichment_data` that answers "what do they sell". The full
 * blob also carries firmographics, LinkedIn counts and ICP plumbing that a
 * caller asking about the offering did not ask for.
 */
const OFFERING_KEYS = [
  'company_tagline',
  'company_niche',
  'company_offering',
  'company_target',
  'company_verbiage',
  'company_priorities',
  'company_tone',
  'is_b2b',
  'revenue_model',
  'estimated_company_size',
] as const;

/** Fit scoring — separate from the offering, and only meaningful with a product or ICP. */
const FIT_KEYS = [
  'icp_score',
  'icp_score_reasoning',
  'primary_need',
  'primary_need_reasoning',
  'primary_need_evidence',
  'primary_need_confidence',
  'cold_email_angle',
  'selected_outcome',
  'matched_icp',
  'decision_maker_score',
  'decision_maker_reasoning',
] as const;

/** Reuse an analysis this recent rather than re-crawling, unless told otherwise. */
const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * A crawl plus an LLM pass. The crawler cold-boots in ~15s when it has scaled to
 * zero, so this is generous on purpose — a timeout here means re-crawling from
 * scratch on the next attempt, which is worse than waiting.
 */
const ANALYZE_TIMEOUT_MS = 180_000;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) out[key] = source[key];
  }
  return out;
}

/** Reduce a stored website to the bare host `website_scrape_cache` is keyed on. */
function cacheDomain(website: unknown): string | null {
  if (typeof website !== 'string') return null;
  const trimmed = website.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Load the contact, and refuse one that belongs to another tenant.
 *
 * The platform service-role caller has no organization, and this endpoint acts
 * on exactly one tenant's contact, so it has to reject rather than guess.
 */
// deno-lint-ignore no-explicit-any
async function loadContact(supabase: any, caller: { organization_id: string | null }, contactId: string) {
  if (!caller.organization_id) {
    throw new ApiError('This endpoint requires an organization-scoped token', 403);
  }

  const { data, error } = await supabase
    .from('crm_contacts')
    .select('id, organization_id, company, company_website, enrichment_data, ai_analysis_status, ai_analyzed_at')
    .eq('id', contactId)
    .eq('organization_id', caller.organization_id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ApiError('Contact not found', 404);
  return data;
}

/**
 * Read the crawled pages for a domain.
 *
 * Expired rows are treated as absent: the cache TTL is what stops us serving a
 * company's copy from before they relaunched their site.
 */
// deno-lint-ignore no-explicit-any
async function loadMarkdown(supabase: any, domain: string | null) {
  if (!domain) return null;

  const { data, error } = await supabase
    .from('website_scrape_cache')
    .select('domain, pages, total_chars, cached_at, expires_at, tech_signals')
    .eq('domain', domain)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && Date.parse(data.expires_at) < Date.now()) return null;

  return {
    domain: data.domain,
    pages: data.pages ?? {},
    total_chars: data.total_chars ?? 0,
    cached_at: data.cached_at,
    tech_signals: data.tech_signals ?? null,
  };
}

/** Shape one contact's stored analysis into the response body. */
// deno-lint-ignore no-explicit-any
function buildResult(contact: any, markdown: unknown, extra: Record<string, unknown> = {}) {
  const enrichment = (contact.enrichment_data as Record<string, unknown>) || {};

  return {
    success: true,
    contact_id: contact.id,
    company: contact.company ?? null,
    website: contact.company_website ?? null,
    status: contact.ai_analysis_status ?? 'not_analyzed',
    analyzed_at: contact.ai_analyzed_at ?? null,
    offering: pick(enrichment, OFFERING_KEYS),
    fit: pick(enrichment, FIT_KEYS),
    detected_technologies: enrichment.detected_technologies ?? null,
    // Absent rather than empty when the crawl cache has expired or the site was
    // never readable — an empty object would read as "we crawled and found
    // nothing", which is a different fact.
    markdown,
    ...extra,
  };
}

const GET: Handler = async ({ url, supabase, caller }) => {
  const contactId = url.searchParams.get('contactId') ?? url.searchParams.get('contact_id');
  if (!contactId) throw new ApiError('contactId is required');

  const contact = await loadContact(supabase, caller, contactId);
  const markdown = await loadMarkdown(supabase, cacheDomain(contact.company_website));

  return json(buildResult(contact, markdown));
};

const POST: Handler = async ({ supabase, caller, body }) => {
  const contactId = typeof body.contactId === 'string'
    ? body.contactId
    : typeof body.contact_id === 'string'
      ? body.contact_id
      : '';
  if (!contactId) throw new ApiError('contactId is required');

  const contact = await loadContact(supabase, caller, contactId);

  // An explicit website overrides the stored one. analyze-company writes the
  // resolved value back onto the contact, so passing it here also repairs a
  // contact whose company_website is wrong or missing.
  const website = typeof body.website === 'string' && body.website.trim()
    ? body.website.trim()
    : (contact.company_website as string | null);

  if (!website) {
    throw new ApiError(
      'No website to analyze: the contact has no company_website, and none was supplied',
    );
  }

  const maxAgeDays = body.maxAgeDays === undefined && body.max_age_days === undefined
    ? DEFAULT_MAX_AGE_DAYS
    : Number(body.maxAgeDays ?? body.max_age_days);

  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) {
    throw new ApiError('maxAgeDays must be a non-negative number (0 forces a fresh crawl)');
  }

  const payload: Record<string, unknown> = {
    contactId,
    companyWebsite: website,
    // 0 means "always re-crawl": analyze-company only consults its skip check
    // when this is greater than zero.
    skipIfAnalyzedWithinDays: maxAgeDays,
  };
  if (typeof body.model === 'string') payload.model = body.model;
  if (typeof body.productId === 'string') payload.productId = body.productId;
  if (typeof body.product_id === 'string') payload.productId = body.product_id;
  if (Array.isArray(body.icpIds)) payload.icpIds = body.icpIds;
  if (Array.isArray(body.icp_ids)) payload.icpIds = body.icp_ids;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

  let analyzeBody: Record<string, unknown>;
  try {
    // Service-role, not the caller's token: analyze-company is an internal
    // function behind the platform JWT gate, and the tenant check already ran
    // above in loadContact().
    const response = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-company`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    );

    analyzeBody = await response.json().catch(() => ({}));

    if (!response.ok || analyzeBody.success === false) {
      const reason = typeof analyzeBody.error === 'string' ? analyzeBody.error : `HTTP ${response.status}`;
      throw new ApiError(`Company analysis failed: ${reason}`, 502);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        `Company analysis did not finish within ${ANALYZE_TIMEOUT_MS / 1000}s`,
        504,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  // Re-read: analyze-company writes enrichment_data itself, and the row it wrote
  // is the authoritative result. Its response body carries the analysis but not
  // the persisted shape, and not the markdown at all.
  const updated = await loadContact(supabase, caller, contactId);
  const markdown = await loadMarkdown(supabase, cacheDomain(updated.company_website ?? website));

  return json(buildResult(updated, markdown, {
    // True when a fresh, same-scope analysis was reused instead of re-crawled.
    reused: analyzeBody.skipped === true,
  }));
};

Deno.serve(createResource({ GET, POST }));
