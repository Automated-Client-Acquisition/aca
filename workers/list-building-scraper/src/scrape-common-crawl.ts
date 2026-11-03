/**
 * Common Crawl discovery source.
 *
 * Queries the Hugging Face `commoncrawl/host-index-testing-v2` parquet dataset
 * via DuckDB over httpfs. Zero ingestion: the parquet files are streamed over
 * HTTPS and DuckDB reads only the row groups needed for our filter.
 *
 * Filters applied:
 *  - keyword LIKE on registered domain (e.g. "hvac" -> %hvac%)
 *  - TLD allowlist (default: com, io, co, ai, net, org)
 *  - fetch_200 > min_pages (filters out parked/dead domains)
 *  - fetch_200_lote_pct < 30 (mostly English content)
 *
 * Note: this stage returns unenriched domain rows. Homepage enrichment
 * (title, address, tech stack) is a separate downstream pass (Phase 2).
 */

import { DuckDBInstance } from '@duckdb/node-api';
import type { DiscoveredCompany, CompanyScraperQuery } from './types.js';

/**
 * Latest Common Crawl partition. Bump when HF publishes a newer crawl.
 * You can check the latest at:
 *   https://huggingface.co/datasets/commoncrawl/host-index-testing-v2
 */
const DEFAULT_CRAWL = process.env.COMMON_CRAWL_PARTITION || 'CC-MAIN-2025-18';

const DEFAULT_TLDS = ['com', 'io', 'co', 'ai', 'net', 'org'];

let instance: DuckDBInstance | null = null;

async function getInstance(): Promise<DuckDBInstance> {
  if (instance) return instance;
  instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();
  try {
    // Point DuckDB's httpfs at Debian's CA bundle — without this the default
    // libcurl built into the extension can't find a cert store and every
    // HTTPS read fails with "Problem with the SSL CA cert".
    // node:20-slim has /etc/ssl/certs/ca-certificates.crt via ca-certificates
    // package (pulled in by Playwright's --with-deps install).
    const caCandidates = [
      '/etc/ssl/certs/ca-certificates.crt',
      '/etc/pki/tls/certs/ca-bundle.crt',
      '/etc/ssl/cert.pem',
    ];
    const fs = await import('node:fs');
    const caPath = caCandidates.find((p) => fs.existsSync(p));
    if (caPath) {
      await conn.run(`SET ca_cert_file='${caPath}';`);
      console.log(`[cc] ca_cert_file=${caPath}`);
    } else {
      console.warn('[cc] no CA bundle found at standard paths');
    }
    await conn.run(`INSTALL httpfs;`);
    await conn.run(`LOAD httpfs;`);
  } finally {
    conn.closeSync();
  }
  return instance;
}

interface CommonCrawlRow {
  domain: string;
  tld: string;
  pages: number;
  pagerank: number;
  foreign_pct: number;
}

/**
 * Turn a niche string into an array of LIKE patterns. We keep this simple on
 * purpose: the host-index only matches against the registered domain, so
 * multi-word niches need to be expanded into their most likely single-word
 * tokens that vendors put in their domain name.
 *
 * "HVAC Texas" -> ["hvac"]
 * "solar installers" -> ["solar"]
 * "dental office" -> ["dental", "dentist"]
 * "AI agency" -> ["ai", "agency"]
 */
function nicheToKeywords(niche: string): string[] {
  const words = niche
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // Drop filler, geo tokens, and any token shorter than 4 chars — LIKE '%xx%'
    // at 2-3 chars matches half the web (think "ac" in facebook/oracle/aclu).
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));

  // Expand high-value synonyms, but also drop any synonym <4 chars.
  const expanded = new Set<string>(words);
  for (const w of words) {
    const syns = SYNONYMS[w];
    if (syns) for (const s of syns) if (s.length >= 4) expanded.add(s);
  }
  return [...expanded];
}

const STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'in', 'of', 'for', 'with',
  // Common geo noise — the host-index has no geo, so these never help.
  'usa', 'us', 'uk', 'europe', 'texas', 'california', 'london', 'paris',
  'new', 'york', 'city', 'state', 'country', 'national', 'global',
]);

const SYNONYMS: Record<string, string[]> = {
  hvac: ['heating', 'cooling'],
  solar: ['solarpanel', 'pv'],
  dental: ['dentist', 'dentistry'],
  dentist: ['dental'],
  lawyer: ['law', 'legal', 'attorney'],
  plumber: ['plumbing'],
  roofer: ['roofing'],
  saas: ['software', 'cloud'],
  agency: ['agencies'],
};

export async function scrapeCommonCrawl(
  query: CompanyScraperQuery,
  opts?: { tlds?: string[]; minPages?: number; crawl?: string },
): Promise<DiscoveredCompany[]> {
  const limit = Math.max(1, Math.min(query.limit || 100, 5000));
  const tlds = opts?.tlds ?? DEFAULT_TLDS;
  const minPages = opts?.minPages ?? 3;
  const crawl = opts?.crawl ?? DEFAULT_CRAWL;

  const keywords = nicheToKeywords(query.niche);
  if (keywords.length === 0) {
    console.log('[cc] empty keyword set, skipping');
    return [];
  }

  const inst = await getInstance();
  const conn = await inst.connect();
  try {
    // DuckDB positional parameter binding is limited for LIKE patterns — we
    // inline-escape the keywords instead. keywords come from server-side
    // splitting of niche text, never from untrusted network input.
    const likeClauses = keywords
      .map((k) => `url_host_registered_domain LIKE '%${k.replace(/'/g, "''")}%'`)
      .join(' OR ');

    const tldList = tlds.map((t) => `'${t.replace(/'/g, "''")}'`).join(',');

    // DuckDB's httpfs can't enumerate a remote directory, so we fetch the
    // parquet file list from HF's dataset tree API and pass concrete URLs
    // into DuckDB's read_parquet().
    const fileUrls = await listCrawlParquetFiles(crawl);
    if (fileUrls.length === 0) {
      console.warn(`[cc] no parquet files listed for crawl=${crawl}`);
      return [];
    }
    const urlList = fileUrls.map((u) => `'${u}'`).join(', ');
    const parquetSource = `read_parquet([${urlList}])`;

    const sql = `
      SELECT
        url_host_registered_domain AS domain,
        url_host_tld AS tld,
        fetch_200 AS pages,
        COALESCE(prank10, 0.0) AS pagerank,
        COALESCE(fetch_200_lote_pct, 0) AS foreign_pct
      FROM ${parquetSource}
      WHERE url_host_tld IN (${tldList})
        AND fetch_200 >= ${minPages}
        AND COALESCE(fetch_200_lote_pct, 0) < 40
        AND (${likeClauses})
      ORDER BY fetch_200 DESC
      LIMIT ${limit}
    `;

    console.log(`[cc] query keywords=${keywords.join(',')} tlds=${tlds.join(',')} limit=${limit}`);
    const started = Date.now();
    const reader = await conn.runAndReadAll(sql);
    const rows = reader.getRowObjects() as unknown as Array<{
      domain: string;
      tld: string;
      pages: number | bigint;
      pagerank: number;
      foreign_pct: number | bigint;
    }>;
    console.log(`[cc] ${rows.length} rows in ${Date.now() - started}ms`);

    const out: DiscoveredCompany[] = rows.map((r) => {
      const domain = r.domain;
      return {
        company_name: guessCompanyNameFromDomain(domain),
        domain,
        website_url: `https://${domain}`,
        linkedin_url: null,
        phone: null,
        address: null,
        source: 'common_crawl',
        raw_html_snippet: null,
      };
    });
    return out;
  } finally {
    conn.closeSync();
  }
}

/**
 * Query HF's dataset tree API to enumerate the parquet files for a given
 * Common Crawl partition. Cached per crawl id for the process lifetime.
 */
const fileListCache = new Map<string, string[]>();
async function listCrawlParquetFiles(crawl: string): Promise<string[]> {
  const cached = fileListCache.get(crawl);
  if (cached) return cached;
  const treeUrl = `https://huggingface.co/api/datasets/commoncrawl/host-index-testing-v2/tree/main/data/crawl%3D${encodeURIComponent(crawl)}`;
  const res = await fetch(treeUrl);
  if (!res.ok) {
    console.warn(`[cc] HF tree ${res.status} for ${treeUrl}`);
    return [];
  }
  const entries = (await res.json()) as Array<{ type: string; path: string }>;
  const urls = entries
    .filter((e) => e.type === 'file' && e.path.endsWith('.parquet'))
    .map((e) => `https://huggingface.co/datasets/commoncrawl/host-index-testing-v2/resolve/main/${e.path}`);
  fileListCache.set(crawl, urls);
  console.log(`[cc] listed ${urls.length} parquet files for crawl=${crawl}`);
  return urls;
}

/**
 * Best-effort derivation of a display name from the registered domain.
 *   "texashvacrepair.com" -> "Texashvacrepair"
 *   "clear-creek-heat.com" -> "Clear Creek Heat"
 * This is a placeholder until the Phase 2 homepage enrichment pass replaces
 * it with the actual page title.
 */
function guessCompanyNameFromDomain(domain: string): string {
  const stem = domain.split('.')[0];
  if (!stem) return domain;
  const parts = stem.split(/[-_]/);
  if (parts.length > 1) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
