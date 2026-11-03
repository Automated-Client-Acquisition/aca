/**
 * Company discovery scraper (Module 1).
 *
 * Honest state of the world:
 *  - google_search: works natively via a plain fetch + regex. Best-effort.
 *  - google_maps:   stub (JS-heavy, needs a Playwright worker). Returns [].
 *  - directory:     stub. Returns [].
 *  - linkedin:      stub. Returns [].
 *
 * When the native path yields nothing, and the caller passed an
 * `enrichmentRouter`, we call it once per missing company slot to let an
 * existing Apollo/Hunter/etc. adapter fill the gap. This is the spec's
 * "Company Discovery fallback".
 */

import type { DiscoveredCompany } from './types.ts';
import { normalizeDomain, type EnrichmentRouter } from '../enrichment/index.ts';

// ProxyManager is built by Stream A. Import by path even if missing at author time.
// deno-lint-ignore no-explicit-any
type ProxyManager = any;

const SCRAPER_URL = Deno.env.get('LIST_BUILDING_SCRAPER_URL') ?? '';

async function pickProxyPayload(pm: ProxyManager | undefined, domain: string) {
  if (!pm) return undefined;
  try {
    if (typeof pm.loadActivePool === 'function' && !pm.loaded) {
      await pm.loadActivePool();
    }
    const pick = typeof pm.pickForDomain === 'function' ? pm.pickForDomain(domain) : null;
    if (!pick) return undefined;
    return {
      host: pick.host,
      port: pick.port,
      username: pick.username ?? undefined,
      password: pick.password ?? undefined,
    };
  } catch (err) {
    console.warn('[lb/company-scraper] proxy pick failed:', err);
    return undefined;
  }
}

async function callWorkerScrapeCompanies(
  query: CompanyScraperQuery,
  deps: CompanyScraperDeps,
): Promise<DiscoveredCompany[] | null> {
  if (!SCRAPER_URL) return null;
  const proxy = await pickProxyPayload(deps.proxyManager, 'google.com');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${SCRAPER_URL.replace(/\/$/, '')}/scrape-companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, proxy }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[lb/company-scraper] worker HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (!json || !Array.isArray(json.companies)) return null;
    return json.companies as DiscoveredCompany[];
  } catch (err) {
    console.error('[lb/company-scraper] worker call failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface CompanyScraperQuery {
  niche: string;
  geo: string;
  sources: string[];
  limit: number;
}

export interface CompanyScraperDeps {
  proxyManager?: ProxyManager;
  enrichmentRouter?: EnrichmentRouter;
}

// ---------------------------------------------------------------------------
// Google Search (native, best-effort)
// ---------------------------------------------------------------------------
async function scrapeGoogleSearch(
  q: CompanyScraperQuery,
  deps: CompanyScraperDeps,
): Promise<DiscoveredCompany[]> {
  const query = `${q.niche} ${q.geo} site:linkedin.com/company`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  try {
    // TODO(stream-A): route through deps.proxyManager when available.
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      console.warn(`[lb/company-scraper] google_search HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();

    // Very loose regex - Google HTML changes constantly. We look for linkedin.com/company/* links.
    // Also grab the title text that typically sits inside <h3>...</h3> near the link.
    const out: DiscoveredCompany[] = [];
    const linkRe = /https?:\/\/[a-z]{2,3}\.linkedin\.com\/company\/([^"'&?\s]+)/gi;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(html)) !== null) {
      const slug = m[1].replace(/\/$/, '').toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);

      // Try to pull a nearby <h3> title (within 400 chars before the match).
      const window = html.slice(Math.max(0, m.index - 400), m.index);
      const titleMatch = window.match(/<h3[^>]*>([^<]{3,120})<\/h3>/i);
      const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ');

      out.push({
        company_name: title,
        domain: null,
        website_url: null,
        linkedin_url: `https://www.linkedin.com/company/${slug}`,
        source: 'google_search',
        raw_html_snippet: window.slice(-300),
      });
      if (out.length >= q.limit) break;
    }
    return out;
  } catch (err) {
    console.error('[lb/company-scraper] google_search error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stubs - Stream B will replace these with Playwright workers.
// ---------------------------------------------------------------------------
async function scrapeGoogleMaps(
  _q: CompanyScraperQuery,
  _deps: CompanyScraperDeps,
): Promise<DiscoveredCompany[]> {
  console.warn('[lb/company-scraper] google_maps: STUB (TODO: Playwright worker)');
  return [];
}

async function scrapeDirectory(
  _q: CompanyScraperQuery,
  _deps: CompanyScraperDeps,
): Promise<DiscoveredCompany[]> {
  console.warn('[lb/company-scraper] directory: STUB');
  return [];
}

async function scrapeLinkedin(
  _q: CompanyScraperQuery,
  _deps: CompanyScraperDeps,
): Promise<DiscoveredCompany[]> {
  console.warn('[lb/company-scraper] linkedin: STUB');
  return [];
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export async function scrapeCompanies(
  query: CompanyScraperQuery,
  deps: CompanyScraperDeps = {},
): Promise<DiscoveredCompany[]> {
  // Preferred path: delegate to the Playwright worker if LIST_BUILDING_SCRAPER_URL is set.
  const workerResult = await callWorkerScrapeCompanies(query, deps);
  if (workerResult && workerResult.length > 0) {
    console.log(`[lb/company-scraper] worker returned ${workerResult.length} companies`);
    return workerResult.slice(0, query.limit);
  }

  const sources = query.sources && query.sources.length > 0
    ? query.sources
    : ['google_search'];

  const collected: DiscoveredCompany[] = [];

  for (const src of sources) {
    if (collected.length >= query.limit) break;
    let batch: DiscoveredCompany[] = [];
    switch (src) {
      case 'google_search':
        batch = await scrapeGoogleSearch(query, deps);
        break;
      case 'google_maps':
        batch = await scrapeGoogleMaps(query, deps);
        break;
      case 'directory':
        batch = await scrapeDirectory(query, deps);
        break;
      case 'linkedin':
        batch = await scrapeLinkedin(query, deps);
        break;
      default:
        console.warn(`[lb/company-scraper] unknown source: ${src}`);
    }
    collected.push(...batch);
  }

  // Dedupe by normalized domain when present, otherwise by linkedin_url, else company_name.
  const byKey = new Map<string, DiscoveredCompany>();
  for (const c of collected) {
    const key =
      (c.domain && normalizeDomain(c.domain)) ||
      c.linkedin_url ||
      c.company_name.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, c);
  }

  // Obvious-junk filter.
  const filtered = Array.from(byKey.values()).filter((c) => {
    if (c.website_url && c.website_url.includes('wikipedia.org')) return false;
    return true;
  });

  // Enrichment fallback: if we came up short AND a router was provided, try to
  // enrich by company name/domain for the gap. Best-effort, one call per gap.
  if (filtered.length < query.limit && deps.enrichmentRouter) {
    const deficit = query.limit - filtered.length;
    console.log(`[lb/company-scraper] native scraping short by ${deficit}, using EnrichmentRouter fallback`);
    // Without a seed list, we can only enrich by niche as company name. This is
    // intentionally conservative - we don't hallucinate companies. We just try
    // one company-typed enrichment on the niche as a seed and bail if empty.
    try {
      const r = await deps.enrichmentRouter.enrich({
        contactId: 'lb-discovery-fallback',
        organizationId: 'lb-discovery-fallback',
        input: { companyName: query.niche },
        enrichmentTypes: ['company'],
      });
      if (r.success && r.data.company) {
        filtered.push({
          company_name: r.data.company.name,
          domain: r.data.company.domain ? normalizeDomain(r.data.company.domain) : null,
          website_url: r.data.company.website ?? null,
          linkedin_url: r.data.company.linkedinUrl ?? null,
          city: null,
          country: r.data.company.location ?? null,
          source: 'directory',
          raw_html_snippet: null,
        });
      }
    } catch (err) {
      console.warn('[lb/company-scraper] enrichment fallback failed:', err);
    }
  }

  return filtered.slice(0, query.limit);
}
