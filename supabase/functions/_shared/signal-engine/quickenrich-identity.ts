import {
  QuickenrichCompanyFinderError,
  type QuickenrichCompanyData,
} from '../enrichment/quickenrich.ts';
import { namesMatch, normalizeDomain } from './normalize.ts';

export interface QuickenrichIdentityCandidate {
  name: string;
  domain: string;
  industry?: string;
  employee_count?: number;
  country?: string;
}

export interface QuickenrichIdentitySelection {
  candidate: QuickenrichIdentityCandidate | null;
  creditsUsed: number;
  reason: 'matched' | 'not_found' | 'ambiguous';
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function invalid(detail: string): never {
  throw new QuickenrichCompanyFinderError('INVALID_RESPONSE', null, detail);
}

function websiteValue(row: Record<string, unknown>): string | undefined {
  if (typeof row.url === 'string' && row.url.trim()) return row.url;
  return typeof row.company_url === 'string' ? row.company_url : undefined;
}

/** Select an exact company match only when the returned search is complete. */
export function selectQuickenrichIdentity(
  response: unknown,
  companyName: string,
  countryHint?: string | null,
): QuickenrichIdentitySelection {
  if (!record(response) || response.success !== true || response.error) {
    invalid('Expected a successful Company Finder response');
  }
  const data = response.data;
  const rows = Array.isArray(data) ? data : record(data) ? [data] : null;
  if (!rows || !rows.every(record)) invalid('Expected Company Finder company records');
  if (rows.some((row) => typeof row.company_name !== 'string' || websiteValue(row) === undefined)) {
    invalid('Company Finder record lacks a company name or website');
  }
  if (response.meta !== undefined && !record(response.meta)) invalid('Invalid Company Finder metadata');
  const meta = record(response.meta) ? response.meta : {};
  const creditsUsed = meta.credits_used === undefined ? rows.length : meta.credits_used;
  if (typeof creditsUsed !== 'number' || !Number.isSafeInteger(creditsUsed) || creditsUsed < 0) {
    invalid('Company Finder credits_used must be a nonnegative safe integer');
  }
  if (meta.total !== undefined
    && (typeof meta.total !== 'number' || !Number.isFinite(meta.total) || meta.total < 0)) {
    invalid('Company Finder total must be a nonnegative finite number');
  }
  if (meta.has_more !== undefined && typeof meta.has_more !== 'boolean') {
    invalid('Company Finder has_more must be boolean');
  }
  // A bounded paid page can hide a second exact-name company. Cache that as an
  // ambiguous paid result, never guess from the first match or buy every page.
  if (meta.has_more === true || Number(meta.total ?? rows.length) > rows.length
    || (typeof meta.next_cursor === 'string' && meta.next_cursor.trim())) {
    return { candidate: null, creditsUsed, reason: 'ambiguous' };
  }

  const expectedCountry = typeof countryHint === 'string' && /^[a-z]{2}$/i.test(countryHint.trim())
    ? countryHint.trim().toUpperCase()
    : null;
  const candidates = new Map<string, QuickenrichIdentityCandidate>();
  for (const raw of rows) {
    const row = raw as QuickenrichCompanyData;
    // Required string fields were validated before the pagination guard.
    const candidateName = row.company_name!;
    // email_domain/final_email_domain are search aliases, not website URLs.
    const companyUrl = websiteValue(raw)!;
    if (!namesMatch(companyName, candidateName)) continue;
    // Use only a website URL/bare hostname. Reject credentials, ports, and
    // alternate protocols even though generic URL normalization accepts them.
    let website: URL;
    try {
      website = new URL(companyUrl.includes('://') ? companyUrl : `https://${companyUrl}`);
    } catch { continue; }
    if (!['http:', 'https:'].includes(website.protocol) || website.username || website.password || website.port) continue;
    const domain = normalizeDomain(companyUrl);
    if (!domain || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)
      || domain.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))
      || /^\d+(?:\.\d+){3}$/.test(domain)) continue;
    const country = typeof row.country_code === 'string' && /^[a-z]{2}$/i.test(row.country_code.trim())
      ? row.country_code.trim().toUpperCase()
      : undefined;
    if (expectedCountry && country && country !== expectedCountry) continue;
    const rawCount = String(row.employee_count ?? row.number_of_employees ?? '').trim();
    const employeeCount = /^\d+$/.test(rawCount) ? Number(rawCount) : NaN;
    if (!candidates.has(domain)) {
      candidates.set(domain, {
        name: candidateName.trim(),
        domain,
        ...(typeof row.industry === 'string' && row.industry.trim() ? { industry: row.industry.trim() } : {}),
        ...(Number.isSafeInteger(employeeCount) && employeeCount > 0 ? { employee_count: employeeCount } : {}),
        ...(country ? { country } : {}),
      });
    }
  }
  if (candidates.size > 1) return { candidate: null, creditsUsed, reason: 'ambiguous' };
  const candidate = [...candidates.values()][0] ?? null;
  return { candidate, creditsUsed, reason: candidate ? 'matched' : 'not_found' };
}

/** Contact Finder company evidence is usable only when discovery stayed free. */
export function selectQuickenrichContactIdentity(
  response: unknown,
  companyName: string,
  countryHint?: string | null,
): QuickenrichIdentitySelection {
  if (!record(response) || !record(response.meta) || response.meta.credits_used !== 0) {
    invalid('Contact Finder must report credits_used:0 for free company discovery');
  }
  return selectQuickenrichIdentity(response, companyName, countryHint);
}
