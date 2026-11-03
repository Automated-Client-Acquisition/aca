/**
 * QuickEnrich Enrichment Adapter
 *
 * QuickEnrich is a B2B contact enrichment API similar to MoltSets, providing:
 * - Email search (LinkedIn URL OR company+name)  1000 req/min (6000 GTM Unlimited)
 * - Phone search (same params)                    1000 req/min
 * - Reverse email lookup                          1000 req/min
 * - Domain search (company_url + title)            300 req/min
 * - Contact Finder (discovery, free)               120 req/min
 * - Company Finder (1 credit per company)          120 req/min
 *
 * Enrichment (email/phone) uses:
 *   GET /api/employees/search      — email enrichment
 *   GET /api/employees/phone-search — phone enrichment
 *   GET /api/employees/email-search — reverse lookup (email -> profile)
 *
 * Discovery (separate concerns, exposed as helper methods for list-building):
 *   GET  /api/employees/dataset-search      — domain+title search (up to 20/page)
 *   POST /api/employees/contact-finder     — filtered discovery (free, paginated via cursor)
 *   POST /api/companies/company-finder     — company discovery (1 credit/company)
 *
 * Auth: Bearer token  (Authorization: Bearer YOUR_API_KEY)
 * Rate-limit headers are returned by the API; our scheduler paces via
 * reserveEnrichmentProviderRequest so callers never burst into 429s.
 *
 * Docs: https://app.quickenrich.io/docs
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type {
  EnrichmentAdapter,
  EnrichmentInput,
  EnrichmentResult,
  EnrichmentType,
  EnrichedData,
  EnrichmentErrorCode,
} from './index.ts';
import {
  refundRateLimitedProviderRequest,
  reserveEnrichmentProviderRequest,
} from './rate-limit.ts';

const QUICKENRICH_API_BASE = 'https://app.quickenrich.io/api';

// ── Plan limits ────────────────────────────────────────────────────────────
export type QuickenrichPlanTier = 'standard' | 'gtm_unlimited';

export const QUICKENRICH_PLAN_LIMITS: Record<QuickenrichPlanTier, {
  reqPerMin: number;
  dailyCap: number | null;
  domainReqPerMin: number;
  finderReqPerMin: number;
}> = {
  // Standard API key: documented limits per endpoint
  standard:      { reqPerMin: 1000, dailyCap: null, domainReqPerMin: 300, finderReqPerMin: 120 },
  // GTM Unlimited: 6000/min on all endpoints
  gtm_unlimited: { reqPerMin: 6000, dailyCap: null, domainReqPerMin: 6000, finderReqPerMin: 6000 },
};

// ── API shapes ─────────────────────────────────────────────────────────────
interface QuickenrichEmployeeData {
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  employee_phone?: string;
  employee_phone_type?: string;
  employee_linkedin?: string;
  email_verification_date?: string;
  company_url?: string;
  company_name?: string;
  email_domain?: string;
  company_linked?: string;
  company_phone?: string;
  industry?: string;
  revenue?: string;
  employee_count?: string;
  address?: string;
  city?: string;
  region_code?: string;
  zip?: string;
  country_code?: string;
}

interface QuickenrichSearchResponse {
  success?: boolean;
  message?: string;
  code?: number;
  data?: QuickenrichEmployeeData | QuickenrichEmployeeData[];
  meta?: {
    credits_used?: number;
    remaining_credits?: number;
    reason?: string;
    page?: number;
    per_page?: number;
    total?: number;
    last_page?: number;
  };
  error?: { code?: string; message?: string };
}

interface QuickenrichPhoneResponse extends QuickenrichSearchResponse {}
interface QuickenrichEmailLookupResponse extends QuickenrichSearchResponse {}

// Company Finder returns url/employee_count, unlike employee searches. The
// include_full_text flag adds home_page_text to the normal company fields.
export interface QuickenrichCompanyData {
  company_name?: string;
  url?: string;
  email_domain?: string;
  final_email_domain?: string;
  employee_count?: string | number;
  linkedin_url?: string;
  // Legacy response aliases retained for callers with older cached records.
  company_url?: string;
  home_page_text?: string;
  industry?: string;
  number_of_employees?: string;
  revenue?: string;
  country_code?: string;
  city?: string;
}

export interface QuickenrichCompanyFinderResponse {
  success?: boolean;
  message?: string;
  code?: number;
  data?: QuickenrichCompanyData | QuickenrichCompanyData[];
  meta?: {
    credits_used?: number;
    remaining_credits?: number;
    page?: number;
    per_page?: number;
    total?: number;
    last_page?: number;
    next_cursor?: string | null;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string };
}

export type QuickenrichCompanyFinderErrorCode =
  | 'RATE_LIMITED'
  | 'AUTHENTICATION_FAILED'
  | 'INSUFFICIENT_CREDITS'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR';

/** Operational failures must never be recorded as a company-level miss. */
export class QuickenrichCompanyFinderError extends Error {
  constructor(
    readonly code: QuickenrichCompanyFinderErrorCode,
    readonly httpStatus: number | null,
    readonly detail: string,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`QuickEnrich finder ${code.toLowerCase()}: ${detail}`);
    this.name = 'QuickenrichCompanyFinderError';
  }
}

// Contact Finder helpers (discovery, free)
export interface QuickenrichContactFinderFilter {
  title?: { include: string[]; exclude: string[] };
  locality?: { include: string[]; exclude: string[] };
  company_name?: { include: string[]; exclude: string[] };
  company_url?: { include: string[]; exclude: string[] };
  number_of_employees?: { include: string[]; exclude: string[] };
  revenue?: { include: string[]; exclude: string[] };
  city?: { include: string[]; exclude: string[] };
  country_code?: { include: string[]; exclude: string[] };
  industry_linkedin?: { include: string[]; exclude: string[] };
  bio_li?: { include: string[]; exclude: string[] };
  services?: { include: string[]; exclude: string[] };
  has_email?: boolean;
  has_phone?: boolean;
  page?: number;
  per_page?: number;
  cursor?: string;
}

export interface QuickenrichCompanyFinderFilter {
  home_page_text?: { include: string[]; exclude: string[] };
  bio_li?: { include: string[]; exclude: string[] };
  services?: { include: string[]; exclude: string[] };
  industry?: { include: string[]; exclude: string[] };
  number_of_employees?: { include: string[]; exclude: string[] };
  revenue?: { include: string[]; exclude: string[] };
  country_code?: { include: string[]; exclude: string[] };
  city?: { include: string[]; exclude: string[] };
  company_name?: { include: string[]; exclude: string[] };
  company_url?: string;
  include_full_text?: boolean;
  page?: number;
  per_page?: number;
  cursor?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function normalizeLinkedinUrl(url: string): string {
  return url.trim();
}

function normalizeCompanyUrl(url: string): string {
  if (!url) return '';
  let v = url.trim().toLowerCase();
  if (!v.startsWith('http')) v = 'https://' + v;
  return v;
}

function buildSearchParams(input: EnrichmentInput): URLSearchParams | null {
  const params = new URLSearchParams();
  if (input.linkedinUrl) {
    params.set('linkedin_url', normalizeLinkedinUrl(input.linkedinUrl));
    // If we also have company+name, send them too — API will try LinkedIn first then fallback
    if (input.companyDomain) params.set('company_url', normalizeCompanyUrl(input.companyDomain));
    else if (input.companyName) params.set('company_url', input.companyName);
    if (input.firstName) params.set('first_name', input.firstName);
    if (input.lastName) params.set('last_name', input.lastName);
    return params;
  }
  // Without LinkedIn, need company_url + first_name + last_name
  const companyUrl = input.companyDomain || input.companyName;
  if (companyUrl && input.firstName && input.lastName) {
    params.set('company_url', normalizeCompanyUrl(companyUrl));
    params.set('first_name', input.firstName);
    params.set('last_name', input.lastName);
    return params;
  }
  // Try parsing fullName
  if (companyUrl && input.fullName) {
    const parts = input.fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      params.set('company_url', normalizeCompanyUrl(companyUrl));
      params.set('first_name', parts[0]);
      params.set('last_name', parts.slice(1).join(' '));
      return params;
    }
  }
  return null;
}

function mapEmployeeToEnrichedData(emp: QuickenrichEmployeeData): EnrichedData {
  const data: EnrichedData = {};

  if (emp.email && emp.email !== 'N/A') {
    data.email = emp.email;
    data.emailLastValidatedAt = emp.email_verification_date ?? null;
  }
  if (emp.employee_phone && emp.employee_phone !== 'N/A') {
    data.phone = emp.employee_phone;
    const t = (emp.employee_phone_type ?? '').toLowerCase();
    if (t === 'mobile' || t === 'direct' || t === 'work' || t === 'hq') {
      data.phoneType = t as EnrichedData['phoneType'];
    } else if (t) {
      data.phoneType = 'direct';
    }
  }
  if (emp.title) data.title = emp.title;
  if (emp.city) data.city = emp.city;
  if (emp.region_code) data.state = emp.region_code;
  if (emp.country_code) data.country = emp.country_code;

  // Social
  if (emp.employee_linkedin) {
    data.socialProfiles = [{ platform: 'linkedin', url: emp.employee_linkedin }];
  }

  // Company firmographics
  if (emp.company_name || emp.company_url) {
    const rawDomain = emp.email_domain
      || (emp.company_url ? emp.company_url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase() : undefined);
    data.company = {
      name: emp.company_name ?? '',
      domain: rawDomain,
      website: emp.company_url,
      industry: emp.industry,
      size: emp.employee_count,
      revenue: emp.revenue,
      linkedinUrl: emp.company_linked,
    };
  }

  // Keep full raw for write-through
  data.rawResponse = { ...emp } as Record<string, unknown>;

  return data;
}

// ── Adapter ────────────────────────────────────────────────────────────────
export class QuickenrichAdapter implements EnrichmentAdapter {
  readonly provider = 'quickenrich' as const;
  readonly supportedTypes: EnrichmentType[] = ['email', 'phone', 'full'];
  readonly creditsPerEnrichment = 1;

  canHandle(input: EnrichmentInput, types: EnrichmentType[]): boolean {
    if (!types.includes('email') && !types.includes('phone') && !types.includes('full')) return false;
    // Can handle if: has linkedin_url, OR has company+name
    if (input.linkedinUrl && input.linkedinUrl.includes('/in/')) return true;
    // Also accept any linkedin_url (not just /in/ — QuickEnrich docs say exact match, but company pages may still work)
    if (input.linkedinUrl) return true;
    const hasCompany = !!(input.companyDomain || input.companyName);
    const hasName = !!(input.firstName && input.lastName) || !!(input.fullName && input.fullName.trim().split(/\s+/).length >= 2);
    if (hasCompany && hasName) return true;
    // Email reverse lookup is a separate path but we support it if caller asks for email with just an email
    if (input.email && types.includes('email')) return true;
    return false;
  }

  async enrich(
    apiKey: string,
    input: EnrichmentInput,
    types: EnrichmentType[],
  ): Promise<EnrichmentResult> {
    const wantsEmail = types.includes('email') || types.includes('full');
    const wantsPhone = types.includes('phone') || types.includes('full');

    // Route: if only phone requested, use phone-search; otherwise email search (which also returns phone)
    // If input is email-only, use reverse lookup
    try {
      // Email-only reverse lookup path
      if (input.email && !input.linkedinUrl && !(input.companyDomain || input.companyName)) {
        return await this.enrichByEmail(apiKey, input.email);
      }

      if (wantsPhone && !wantsEmail && types.length === 1) {
        return await this.enrichPhone(apiKey, input);
      }

      // Default: email search (covers email + also returns phone/title/company)
      return await this.enrichEmail(apiKey, input);
    } catch (error) {
      return {
        success: false,
        provider: this.provider,
        creditsUsed: 0,
        data: {},
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          retryable: true,
        },
      };
    }
  }

  private async enrichEmail(apiKey: string, input: EnrichmentInput): Promise<EnrichmentResult> {
    const params = buildSearchParams(input);
    if (!params) {
      return {
        success: false,
        provider: this.provider,
        creditsUsed: 0,
        data: {},
        error: { code: 'INVALID_INPUT', message: 'QuickEnrich requires linkedin_url OR (company_url + first_name + last_name)', retryable: false },
      };
    }

    const url = `${QUICKENRICH_API_BASE}/employees/search?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (res.status === 429) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'RATE_LIMITED', message: 'QuickEnrich rate limit hit', retryable: true } };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid QuickEnrich API key', retryable: false } };
    }

    const body: QuickenrichSearchResponse = await res.json().catch(() => ({} as any));

    if (!res.ok) {
      const code: EnrichmentErrorCode = res.status >= 500 ? 'PROVIDER_ERROR' : 'UNKNOWN';
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code, message: (body as any)?.message || `QuickEnrich API ${res.status}`, retryable: code === 'PROVIDER_ERROR' } };
    }

    // API returns { success:true, data:{...}} or { success:true, data:[] } on miss
    const rawData = body.data;
    if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
      return { success: false, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 0, data: {}, error: { code: 'NOT_FOUND', message: body.message || 'No email found', retryable: false } };
    }
    const emp = Array.isArray(rawData) ? rawData[0] : rawData as QuickenrichEmployeeData;
    if (!emp.email || emp.email === 'N/A') {
      return { success: false, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 0, data: {}, error: { code: 'NOT_FOUND', message: 'No email found for this profile', retryable: false } };
    }

    const data = mapEmployeeToEnrichedData(emp);
    // Preserve meta for credit tracking
    data.rawResponse = { ...(data.rawResponse as object), _meta: body.meta } as Record<string, unknown>;

    return {
      success: true,
      provider: this.provider,
      creditsUsed: body.meta?.credits_used ?? 1,
      data,
    };
  }

  private async enrichPhone(apiKey: string, input: EnrichmentInput): Promise<EnrichmentResult> {
    const params = buildSearchParams(input);
    if (!params) {
      return {
        success: false,
        provider: this.provider,
        creditsUsed: 0,
        data: {},
        error: { code: 'INVALID_INPUT', message: 'QuickEnrich phone search requires linkedin_url OR (company_url + first_name + last_name)', retryable: false },
      };
    }
    const url = `${QUICKENRICH_API_BASE}/employees/phone-search?${params.toString()}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    if (res.status === 429) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'RATE_LIMITED', message: 'QuickEnrich rate limit hit', retryable: true } };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid QuickEnrich API key', retryable: false } };
    }
    const body: QuickenrichPhoneResponse = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const code: EnrichmentErrorCode = res.status >= 500 ? 'PROVIDER_ERROR' : 'UNKNOWN';
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code, message: (body as any)?.message || `QuickEnrich API ${res.status}`, retryable: code === 'PROVIDER_ERROR' } };
    }
    const rawData = body.data;
    if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
      return { success: false, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 0, data: {}, error: { code: 'NOT_FOUND', message: body.message || 'No phone found', retryable: false } };
    }
    const emp = Array.isArray(rawData) ? rawData[0] : rawData as QuickenrichEmployeeData;
    if (!emp.employee_phone || emp.employee_phone === 'N/A') {
      return { success: false, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 0, data: {}, error: { code: 'NOT_FOUND', message: 'No phone found for this profile', retryable: false } };
    }
    const data = mapEmployeeToEnrichedData(emp);
    data.rawResponse = { ...(data.rawResponse as object), _meta: body.meta } as Record<string, unknown>;
    return { success: true, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 1, data };
  }

  private async enrichByEmail(apiKey: string, email: string): Promise<EnrichmentResult> {
    const url = `${QUICKENRICH_API_BASE}/employees/email-search?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    if (res.status === 429) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'RATE_LIMITED', message: 'QuickEnrich rate limit hit', retryable: true } };
    }
    if (res.status === 401 || res.status === 403) {
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid QuickEnrich API key', retryable: false } };
    }
    const body: QuickenrichEmailLookupResponse = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const code: EnrichmentErrorCode = res.status >= 500 ? 'PROVIDER_ERROR' : 'UNKNOWN';
      return { success: false, provider: this.provider, creditsUsed: 0, data: {}, error: { code, message: (body as any)?.message || `QuickEnrich API ${res.status}`, retryable: code === 'PROVIDER_ERROR' } };
    }
    const rawData = body.data;
    if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) {
      return { success: false, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 0, data: {}, error: { code: 'NOT_FOUND', message: body.message || 'No record found for email', retryable: false } };
    }
    const emp = Array.isArray(rawData) ? rawData[0] : rawData as QuickenrichEmployeeData;
    const data = mapEmployeeToEnrichedData(emp);
    data.rawResponse = { ...(data.rawResponse as object), _meta: body.meta } as Record<string, unknown>;
    // Ensure email is set from lookup input if not in response
    if (!data.email) data.email = email;
    return { success: true, provider: this.provider, creditsUsed: body.meta?.credits_used ?? 1, data };
  }

    async validateApiKey(apiKey: string): Promise<boolean> {
    try {
        // No dedicated health endpoint — probe the reverse email lookup with a
        // well-formed, non-reserved domain. Auth is checked before param
        // validation, so ONLY 401/403 means a bad key; 404/422/200 all count as
        // authenticated.
      const res = await fetch(`${QUICKENRICH_API_BASE}/employees/email-search?email=probe.verify@verify-aca-integration-8a2f.com`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      });
      return res.status !== 401 && res.status !== 403;
    } catch {
      return false;
    }
  }

  // ── Discovery helpers (not part of EnrichmentAdapter but exposed for list-building) ──

  /**
   * Domain search: company_url + optional title, paginated 20/page.
   * Charges 1 credit/page without title, or 1 per contact with email/phone when title is set.
   */
  static async domainSearch(
    apiKey: string,
    companyUrl: string,
    opts?: { title?: string; page?: number; hasEmail?: boolean },
  ): Promise<QuickenrichSearchResponse> {
    const params = new URLSearchParams({ company_url: companyUrl });
    if (opts?.title) params.set('title', opts.title);
    if (opts?.page) params.set('page', String(opts.page));
    // The live API uses Laravel's boolean validator, which rejects the query
    // string "true" despite the docs example. 1 is accepted as boolean true.
    if (opts?.hasEmail) params.set('has_email', '1');
    const res = await fetch(`${QUICKENRICH_API_BASE}/employees/dataset-search?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    return await res.json() as QuickenrichSearchResponse;
  }

  /**
   * Contact Finder: filtered discovery (free, credits_used:0). Use cursor for deep pagination.
   */
  static async contactFinder(
    apiKey: string,
    filters: QuickenrichContactFinderFilter,
    options?: { timeoutMs?: number },
  ): Promise<QuickenrichSearchResponse & { meta?: { next_cursor?: string | null; has_more?: boolean } }> {
    return await guardedFinderRequest(apiKey, filters, 'employees/contact-finder', options) as unknown as
      QuickenrichSearchResponse & { meta?: { next_cursor?: string | null; has_more?: boolean } };
  }

  /**
   * Company Finder: filtered company discovery (1 credit per company returned).
   */
  static async companyFinder(
    apiKey: string,
    filters: QuickenrichCompanyFinderFilter,
    options?: { timeoutMs?: number },
  ): Promise<QuickenrichCompanyFinderResponse> {
    return await guardedFinderRequest(apiKey, filters, 'companies/company-finder', options);
  }
}

/** Both discovery endpoints share operational errors and a whole-response deadline. */
async function guardedFinderRequest(
  apiKey: string,
  filters: QuickenrichCompanyFinderFilter | QuickenrichContactFinderFilter,
  endpoint: 'companies/company-finder' | 'employees/contact-finder',
  options?: { timeoutMs?: number },
): Promise<QuickenrichCompanyFinderResponse> {
  const controller = new AbortController();
  const timeoutMs = Math.min(12_000, Math.max(1, options?.timeoutMs ?? 12_000));
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let httpStatus: number | null = null;
  try {
    const res = await fetch(`${QUICKENRICH_API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
      signal: controller.signal,
    });
    httpStatus = res.status;
    // Keep the timeout armed until the body has arrived, not just headers.
    const text = await res.text();
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch { /* An error response can be an HTML gateway page. */ }
    const error = body?.error && typeof body.error === 'object'
      ? body.error as Record<string, unknown>
      : null;
    const detail = String(error?.message ?? (typeof body?.error === 'string' ? body.error : body?.message) ?? `HTTP ${res.status}`).slice(0, 250);
    const effectiveCode = Number(error?.code ?? body?.code ?? res.status);
    const errorText = `${error?.code ?? body?.code ?? ''} ${detail}`;
    const retryHeader = Number(res.headers.get('retry-after'));
    const retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null;
    if (!res.ok || body?.success === false || body?.error) {
      const code: QuickenrichCompanyFinderErrorCode =
        res.status === 429 || effectiveCode === 429 || /rate.?limit|too many requests/i.test(errorText)
          ? 'RATE_LIMITED'
          : res.status === 402 || effectiveCode === 402 || /insufficient[ _-]*(?:credit|token|balance)|out of[ _-]*(?:credit|token)|credit[ _-]*(?:exhausted|limit|balance)/i.test(errorText)
          ? 'INSUFFICIENT_CREDITS'
          : res.status === 401 || res.status === 403 || effectiveCode === 401 || effectiveCode === 403
            || /auth|invalid[ _-]*(?:api[ _-]*)?key|unauthorized|forbidden/i.test(errorText)
          ? 'AUTHENTICATION_FAILED'
          : 'PROVIDER_ERROR';
      throw new QuickenrichCompanyFinderError(code, res.status, detail, retryAfterSeconds);
    }
    const data = body?.data;
    const isRow = (value: unknown) => !!value && typeof value === 'object' && !Array.isArray(value);
    if (body?.success !== true || (!Array.isArray(data) && !isRow(data))
      || (Array.isArray(data) && !data.every(isRow))) {
      throw new QuickenrichCompanyFinderError('INVALID_RESPONSE', res.status, 'Expected success:true and record data');
    }
    return body as unknown as QuickenrichCompanyFinderResponse;
  } catch (error) {
    if (error instanceof QuickenrichCompanyFinderError) throw error;
    throw new QuickenrichCompanyFinderError(
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      httpStatus,
      timedOut ? 'Request or response body exceeded the timeout' : 'Could not fetch Finder response',
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ── Scheduler helpers (mirrors moltsets.ts exports) ───────────────────────
export type QuickenrichRequestReservation = {
  status: 'granted' | 'daily_exhausted' | 'rate_wait';
  reservationId: string | null;
  waitMs: number;
  scheduledAt: string | null;
  dailyUsed: number;
  dailyCap: number | null;
  requestsPerMinute: number;
};

export async function reserveQuickenrichRequest(
  supabase: SupabaseClient,
  organizationId: string,
  limits: { requestsPerMinute: number; dailyCap: number | null },
  maxWaitMs = 110_000,
): Promise<QuickenrichRequestReservation> {
  const reservation = await reserveEnrichmentProviderRequest(
    supabase,
    organizationId,
    'quickenrich',
    {
      requestsPerMinute: limits.requestsPerMinute,
      dailyCap: limits.dailyCap,
    },
    maxWaitMs,
  );
  return {
    ...reservation,
    dailyCap: reservation.dailyCap ?? limits.dailyCap,
  };
}

export async function refundRateLimitedQuickenrichRequest(
  supabase: SupabaseClient,
  reservationId: string | null,
): Promise<void> {
  await refundRateLimitedProviderRequest(supabase, reservationId);
}
