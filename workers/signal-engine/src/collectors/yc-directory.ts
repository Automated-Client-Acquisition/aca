/**
 * Y Combinator directory collector.
 *
 * YC exposes the directory as a public, server-rendered page rather than a
 * documented company-list API. We retain the raw directory observation and
 * treat it as identity evidence, not as a buying event. That prevents the old
 * pipeline's mistake of turning directory membership into artificial intent.
 */
import { createHash } from 'node:crypto';
import { fetchText, fetchWithRetry, RateLimiter } from '../http.js';
import type { RawObservation } from '../types.js';

const YC_DIRECTORY_URL = 'https://www.ycombinator.com/companies';
const limiter = new RateLimiter(0.5);
const YC_INDEX = 'YCCompany_production';
const YC_PAGE_SIZE = 250;

export interface YcCompany {
  name: string;
  slug: string;
  website?: string;
  batch?: string;
  status?: string;
  location?: string;
  description?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function candidateFromObject(value: Record<string, unknown>): YcCompany | null {
  const name = str(value.name) ?? str(value.company_name) ?? str(value.companyName);
  const slug = str(value.slug) ?? str(value.company_slug) ?? str(value.companySlug);
  if (!name || !slug) return null;

  const website = str(value.website) ?? str(value.website_url) ?? str(value.url);
  return {
    name,
    slug,
    website: website?.includes('ycombinator.com/companies/') ? undefined : website,
    batch: str(value.batch),
    status: str(value.status),
    location: str(value.location) ?? str(value.all_locations),
    description: str(value.one_liner) ?? str(value.oneLiner) ?? str(value.description),
  };
}

function visit(value: unknown, output: Map<string, YcCompany>, seen: Set<unknown>): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output, seen);
    return;
  }
  const object = value as Record<string, unknown>;
  const candidate = candidateFromObject(object);
  if (candidate) output.set(candidate.slug, candidate);
  for (const nested of Object.values(object)) visit(nested, output, seen);
}

/** Extract JSON script bodies without executing page JavaScript. */
export function parseYcDirectoryHtml(html: string): YcCompany[] {
  const companies = new Map<string, YcCompany>();
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      visit(JSON.parse(match[1]), companies, new Set());
    } catch {
      // Pages often contain unrelated application/json scripts. A malformed
      // optional blob must not discard valid blobs parsed earlier.
    }
  }
  return [...companies.values()];
}

interface AlgoliaOptions {
  app: string;
  key: string;
}

export function parseYcAlgoliaOptions(html: string): AlgoliaOptions | null {
  const match = html.match(/window\.AlgoliaOpts\s*=\s*(\{[^;]+\})\s*;/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Partial<AlgoliaOptions>;
    return str(value.app) && str(value.key) ? { app: value.app!, key: value.key! } : null;
  } catch {
    return null;
  }
}

interface AlgoliaResult {
  hits?: Array<Record<string, unknown>>;
  facets?: { batch?: Record<string, number> };
  nbHits?: number;
  nbPages?: number;
  page?: number;
  hitsPerPage?: number;
}

interface AlgoliaRequest {
  indexName: string;
  params: string;
}

async function algoliaRequest(
  credentials: AlgoliaOptions,
  requests: AlgoliaRequest[],
  signal?: AbortSignal,
): Promise<AlgoliaResult[]> {
  const response = await fetchWithRetry(
    `https://${credentials.app}-dsn.algolia.net/1/indexes/*/queries`,
    {
      method: 'POST',
      body: JSON.stringify({ requests }),
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': credentials.app,
        'X-Algolia-API-Key': credentials.key,
        'User-Agent': 'ACA Signal Engine/1.0',
      },
      limiter,
      signal,
    },
  );
  if (!response) return [];
  const payload = await response.json() as { results?: AlgoliaResult[] };
  return payload.results ?? [];
}

function searchParams(extra: Record<string, string> = {}): string {
  return new URLSearchParams({
    query: '',
    hitsPerPage: '1000',
    attributesToRetrieve: JSON.stringify([
      'name', 'slug', 'website', 'batch', 'status', 'all_locations', 'one_liner',
    ]),
    ...extra,
  }).toString();
}

export function ycContinuationRequests(
  batches: string[],
  firstPages: AlgoliaResult[],
): AlgoliaRequest[] {
  const requests: AlgoliaRequest[] = [];
  for (let index = 0; index < batches.length; index++) {
    const result = firstPages[index];
    const pages = Math.max(1, Number(result?.nbPages ?? 1));
    const accessible = pages * Number(result?.hitsPerPage ?? YC_PAGE_SIZE);
    if (Number(result?.nbHits ?? 0) > accessible) {
      throw new Error(`YC batch ${batches[index]} exceeds Algolia's accessible pagination window`);
    }
    for (let page = 1; page < pages; page++) {
      requests.push({
        indexName: YC_INDEX,
        params: searchParams({
          hitsPerPage: String(YC_PAGE_SIZE),
          page: String(page),
          facetFilters: JSON.stringify([`batch:${batches[index]}`]),
        }),
      });
    }
  }
  return requests;
}

/**
 * YC's HTML is now a shell backed by its public, search-only Algolia index.
 * Credentials are read from the live page exactly as the browser does; nothing
 * is hardcoded. Querying per batch avoids Algolia's 1,000-result pagination cap.
 */
async function fetchYcCompanies(html: string, signal?: AbortSignal): Promise<{
  companies: YcCompany[];
  expected: number;
  pagesFetched: number;
}> {
  const credentials = parseYcAlgoliaOptions(html);
  if (!credentials) {
    const companies = parseYcDirectoryHtml(html);
    return { companies, expected: companies.length, pagesFetched: 1 };
  }

  const initial = await algoliaRequest(credentials, [{
    indexName: YC_INDEX,
    params: searchParams({ facets: 'batch', hitsPerPage: '1' }),
  }], signal);
  const batches = Object.keys(initial[0]?.facets?.batch ?? {});
  const expected = Number(initial[0]?.nbHits ?? 0);
  if (batches.length === 0 || expected === 0) {
    throw new Error('YC directory did not expose batch facets or a result total');
  }
  const companies = new Map<string, YcCompany>();
  let pagesFetched = 1;

  for (let offset = 0; offset < batches.length; offset += 20) {
    const batchChunk = batches.slice(offset, offset + 20);
    const requests = batchChunk.map((batch) => ({
      indexName: YC_INDEX,
      params: searchParams({
        hitsPerPage: String(YC_PAGE_SIZE),
        page: '0',
        facetFilters: JSON.stringify([`batch:${batch}`]),
      }),
    }));
    const results = await algoliaRequest(credentials, requests, signal);
    pagesFetched += results.length;
    for (const result of results) {
      for (const hit of result.hits ?? []) {
        const company = candidateFromObject(hit);
        if (company) companies.set(company.slug, company);
      }
    }

    const remaining = ycContinuationRequests(batchChunk, results);
    for (let pageOffset = 0; pageOffset < remaining.length; pageOffset += 20) {
      const pageResults = await algoliaRequest(
        credentials,
        remaining.slice(pageOffset, pageOffset + 20),
        signal,
      );
      pagesFetched += pageResults.length;
      for (const result of pageResults) {
        for (const hit of result.hits ?? []) {
          const company = candidateFromObject(hit);
          if (company) companies.set(company.slug, company);
        }
      }
    }
  }
  if (companies.size !== expected) {
    throw new Error(`YC pagination incomplete: collected ${companies.size} of ${expected} companies`);
  }
  return { companies: [...companies.values()], expected, pagesFetched };
}

function normalizeDomain(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export async function collectYcDirectory(opts: { signal?: AbortSignal } = {}): Promise<{
  observations: RawObservation[];
  companiesFound: number;
  pagesFetched: number;
}> {
  const html = await fetchText(YC_DIRECTORY_URL, {
    headers: { 'User-Agent': 'ACA Signal Engine/1.0' },
    limiter,
    signal: opts.signal,
  });
  const result = await fetchYcCompanies(html ?? '', opts.signal);
  const companies = result.companies;
  if (companies.length === 0) {
    throw new Error('YC directory parser returned zero companies; page contract may have changed');
  }

  const observedAt = new Date().toISOString();
  return {
    companiesFound: companies.length,
    pagesFetched: result.pagesFetched,
    observations: companies.map((company) => {
      const domain = normalizeDomain(company.website);
      const directoryUrl = `${YC_DIRECTORY_URL}/${encodeURIComponent(company.slug)}`;
      return {
        external_id: company.slug || createHash('sha256').update(company.name).digest('hex'),
        source_url: directoryUrl,
        title: `${company.name} — Y Combinator directory`,
        structured: {
          event_type: 'directory_presence',
          company_name: company.name,
          directory: 'y_combinator',
          directory_url: directoryUrl,
          website: company.website ?? null,
          batch: company.batch ?? null,
          status: company.status ?? null,
          location: company.location ?? null,
          description: company.description ?? null,
          observed_at: observedAt,
        },
        entity_hints: {
          company_name: company.name,
          domain,
          website_url: company.website,
        },
        event_type: 'directory_presence',
        published_at: observedAt,
      };
    }),
  };
}
