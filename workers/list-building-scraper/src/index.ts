/**
 * ACA List Building Scraper Worker — Fly.io
 *
 * Playwright-backed HTTP service exposing:
 *   GET  /health
 *   POST /scrape-companies
 *   POST /scrape-dms
 *
 * Mirrors the shape of workers/web-capture. Single shared Chromium browser,
 * new BrowserContext per request, context closed in finally blocks.
 *
 * ToS note (spec section 10): robots.txt is not consulted — this is
 * user-controlled prospecting, and compliance lives with the client.
 */

import http from 'node:http';
import { chromium, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';

import type { CompanyScraperQuery, DiscoveredCompany, DMCandidate, ProxyConfig } from './types.js';
import { scrapeGoogleMaps } from './scrape-maps.js';
import { scrapeLinkedInCompanies } from './scrape-linkedin-company.js';
import { scrapeDirectories } from './scrape-directories.js';
import { scrapeDmPages } from './scrape-dm-pages.js';
import { scrapeCommonCrawl } from './scrape-common-crawl.js';
import { dedupeCompanies } from './dedup.js';
import { enrichHomepage, type EnrichedDomain } from './enrich-homepage.js';

// ============================================================================
// Config
// ============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Supabase client — optional, only used if we decide to log runs from the
// worker side later. Kept here to mirror web-capture's init pattern.
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

let browser: Browser | null = null;

const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  companyRequests: 0,
  dmRequests: 0,
  enrichRequests: 0,
  errors: 0,
};

// ============================================================================
// Helpers
// ============================================================================

function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function respond(res: http.ServerResponse, status: number, body: any) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  console.log('[LB-Scraper] Launching Chromium...');
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--single-process',
    ],
  });
  browser.on('disconnected', () => {
    console.warn('[LB-Scraper] Browser disconnected');
    browser = null;
  });
  console.log('[LB-Scraper] Chromium launched');
  return browser;
}

/** Retry a nav-bound async op up to `retries` times with exponential backoff. */
async function withRetries<T>(label: string, retries: number, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message ?? String(err);
      console.warn(`[LB-Scraper] ${label} attempt ${i + 1} failed: ${msg}`);
      if (i < retries) await new Promise((r) => setTimeout(r, 1_000 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/** 60s overall per-request deadline. */
function withDeadline<T>(ms: number, p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`deadline ${ms}ms exceeded`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

// ============================================================================
// Handlers
// ============================================================================

interface ScrapeCompaniesBody {
  query: CompanyScraperQuery;
  proxy?: ProxyConfig;
}

async function handleScrapeCompanies(req: http.IncomingMessage, res: http.ServerResponse) {
  stats.totalRequests++;
  stats.companyRequests++;
  const startTime = Date.now();

  try {
    const body = (await parseBody(req)) as ScrapeCompaniesBody;
    if (!body.query || !body.query.niche) {
      return respond(res, 400, { error: 'query.niche is required' });
    }
    const query: CompanyScraperQuery = {
      niche: body.query.niche,
      geo: body.query.geo ?? '',
      sources: Array.isArray(body.query.sources) && body.query.sources.length > 0
        ? body.query.sources
        : ['google_maps', 'directory', 'linkedin'],
      limit: Math.min(Math.max(body.query.limit ?? 25, 1), 200),
    };

    console.log(`[LB-Scraper] /scrape-companies niche="${query.niche}" geo="${query.geo}" sources=${query.sources.join(',')} limit=${query.limit}`);

    const brow = await getBrowser();

    const work = (async () => {
      const collected: DiscoveredCompany[] = [];
      for (const source of query.sources) {
        if (collected.length >= query.limit) break;
        const remaining: CompanyScraperQuery = { ...query, limit: query.limit - collected.length };
        try {
          let batch: DiscoveredCompany[] = [];
          if (source === 'google_maps') {
            batch = await withRetries('google_maps', 2, () => scrapeGoogleMaps(brow, remaining, body.proxy));
          } else if (source === 'linkedin') {
            batch = await withRetries('linkedin', 2, () => scrapeLinkedInCompanies(brow, remaining, body.proxy));
          } else if (source === 'directory') {
            batch = await withRetries('directory', 2, () => scrapeDirectories(brow, remaining, body.proxy));
          } else if (source === 'common_crawl') {
            batch = await withRetries('common_crawl', 1, () => scrapeCommonCrawl(remaining));
          } else {
            console.warn(`[LB-Scraper] unknown source "${source}"`);
          }
          collected.push(...batch);
        } catch (err) {
          console.error(`[LB-Scraper] source "${source}" failed:`, (err as Error).message);
        }
      }
      return dedupeCompanies(collected).slice(0, query.limit);
    })();

    const companies = await withDeadline(180_000, work);

    const elapsed = Date.now() - startTime;
    console.log(`[LB-Scraper] /scrape-companies -> ${companies.length} results in ${elapsed}ms`);
    return respond(res, 200, { companies, elapsed_ms: elapsed });
  } catch (err: any) {
    stats.errors++;
    console.error('[LB-Scraper] /scrape-companies error:', err);
    return respond(res, 500, { error: err.message || String(err) });
  }
}

interface ScrapeDmsBody {
  website_url: string;
  linkedin_url?: string;
  proxy?: ProxyConfig;
}

async function handleScrapeDms(req: http.IncomingMessage, res: http.ServerResponse) {
  stats.totalRequests++;
  stats.dmRequests++;
  const startTime = Date.now();

  try {
    const body = (await parseBody(req)) as ScrapeDmsBody;
    if (!body.website_url) {
      return respond(res, 400, { error: 'website_url is required' });
    }
    console.log(`[LB-Scraper] /scrape-dms website=${body.website_url}`);

    const brow = await getBrowser();
    const work = withRetries('scrape-dms', 2, () => scrapeDmPages(brow, body.website_url, body.proxy));
    const candidates: DMCandidate[] = await withDeadline(120_000, work);

    const elapsed = Date.now() - startTime;
    console.log(`[LB-Scraper] /scrape-dms -> ${candidates.length} candidates in ${elapsed}ms`);
    return respond(res, 200, { candidates, elapsed_ms: elapsed });
  } catch (err: any) {
    stats.errors++;
    console.error('[LB-Scraper] /scrape-dms error:', err);
    return respond(res, 500, { error: err.message || String(err) });
  }
}

// ============================================================================
// POST /enrich-domains
// ============================================================================

interface EnrichDomainsBody {
  domains: string[];
  proxy?: ProxyConfig;
}

async function handleEnrichDomains(req: http.IncomingMessage, res: http.ServerResponse) {
  stats.totalRequests++;
  stats.enrichRequests++;
  const startTime = Date.now();

  try {
    const body = (await parseBody(req)) as EnrichDomainsBody;
    if (!Array.isArray(body.domains) || body.domains.length === 0) {
      return respond(res, 400, { error: 'domains[] is required and must be non-empty' });
    }
    const domains = body.domains.slice(0, 50); // cap at 50 per request
    console.log(`[LB-Scraper] /enrich-domains count=${domains.length}`);

    const brow = await getBrowser();

    const work = (async () => {
      const results: EnrichedDomain[] = [];
      // Process in chunks of 5 for concurrency control
      for (let i = 0; i < domains.length; i += 5) {
        const chunk = domains.slice(i, i + 5);
        const batch = await Promise.all(
          chunk.map((d) => enrichHomepage(brow, d, body.proxy)),
        );
        results.push(...batch);
      }
      return results;
    })();

    const results = await withDeadline(180_000, work);
    const elapsed = Date.now() - startTime;
    console.log(`[LB-Scraper] /enrich-domains -> ${results.length} results in ${elapsed}ms`);
    return respond(res, 200, { results, elapsed_ms: elapsed });
  } catch (err: any) {
    stats.errors++;
    console.error('[LB-Scraper] /enrich-domains error:', err);
    return respond(res, 500, { error: err.message || String(err) });
  }
}

// ============================================================================
// Server
// ============================================================================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return respond(res, 200, {
      ok: true,
      uptime: Math.floor((Date.now() - new Date(stats.startedAt).getTime()) / 1000),
      browserConnected: browser?.isConnected() ?? false,
      ...stats,
    });
  }

  if (req.method === 'POST' && url.pathname === '/scrape-companies') {
    return handleScrapeCompanies(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/scrape-dms') {
    return handleScrapeDms(req, res);
  }

  if (req.method === 'POST' && url.pathname === '/enrich-domains') {
    return handleEnrichDomains(req, res);
  }

  return respond(res, 404, { error: 'Not found' });
});

// ============================================================================
// Startup / shutdown
// ============================================================================

async function start() {
  try { await getBrowser(); }
  catch (err: any) {
    console.error('[LB-Scraper] Failed to pre-launch browser:', err.message);
  }
  server.listen(PORT, () => {
    console.log(`[LB-Scraper] Listening on port ${PORT}`);
    console.log(`[LB-Scraper] Supabase client: ${supabase ? 'configured' : 'not configured'}`);
  });
}

process.on('uncaughtException', async (err) => {
  console.error('[LB-Scraper] FATAL uncaughtException:', err);
  stats.errors++;
  if (browser) {
    try { await browser.close(); } catch { /* ignore */ }
    browser = null;
  }
});

process.on('SIGTERM', async () => {
  console.log('[LB-Scraper] SIGTERM, shutting down');
  if (browser) await browser.close().catch(() => {});
  server.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('[LB-Scraper] SIGINT, shutting down');
  if (browser) await browser.close().catch(() => {});
  server.close(() => process.exit(0));
});

start();
