/**
 * Decision-maker scraper (Module 2).
 *
 * Best-effort: fetches /about, /team, /contact on the company website and
 * tries to pull out (name, title) pairs from two places:
 *  1. schema.org Person JSON-LD blocks (highest signal)
 *  2. <h*>Name</h*> adjacent to a <p> or <span> containing a DM keyword
 *
 * If fetches fail or the site is JS-heavy, returns []. The pipeline treats
 * an empty result as "no candidates" and will fall through to its own
 * fallback path (EnrichmentRouter in the orchestrator if configured).
 */

import type { DiscoveredCompany, DMCandidate } from './types.ts';

// deno-lint-ignore no-explicit-any
type ProxyManager = any;

export interface DmScraperDeps {
  proxyManager?: ProxyManager;
}

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
    console.warn('[lb/dm-scraper] proxy pick failed:', err);
    return undefined;
  }
}

async function callWorkerScrapeDms(
  company: DiscoveredCompany,
  deps: DmScraperDeps,
): Promise<DMCandidate[] | null> {
  if (!SCRAPER_URL) return null;
  if (!company.website_url) return null;
  let domain = 'unknown';
  try { domain = new URL(company.website_url.startsWith('http') ? company.website_url : `https://${company.website_url}`).hostname; } catch { /* ignore */ }
  const proxy = await pickProxyPayload(deps.proxyManager, domain);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${SCRAPER_URL.replace(/\/$/, '')}/scrape-dms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        website_url: company.website_url,
        linkedin_url: company.linkedin_url,
        proxy,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[lb/dm-scraper] worker HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    if (!json || !Array.isArray(json.candidates)) return null;
    return json.candidates as DMCandidate[];
  } catch (err) {
    console.error('[lb/dm-scraper] worker call failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const DM_KEYWORDS = [
  'ceo', 'cto', 'cfo', 'cmo', 'coo', 'cro',
  'founder', 'co-founder', 'cofounder',
  'owner', 'president', 'principal',
  'vp', 'vice president',
  'head of', 'director', 'manager',
  'chief',
];

const SUBPATHS = ['', '/about', '/about-us', '/team', '/our-team', '/contact', '/leadership'];

async function fetchSafely(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ACA-ListBuilder/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractJsonLdPersons(html: string, sourcePage: string): DMCandidate[] {
  const out: DMCandidate[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
        for (const item of graph) {
          if (!item || typeof item !== 'object') continue;
          if (item['@type'] !== 'Person') continue;
          const name = String(item.name ?? '').trim();
          if (!name) continue;
          const parts = name.split(/\s+/);
          out.push({
            first_name: parts[0],
            last_name: parts.slice(1).join(' ') || null,
            title: item.jobTitle ? String(item.jobTitle) : null,
            linkedin_url: item.sameAs && typeof item.sameAs === 'string' && item.sameAs.includes('linkedin')
              ? item.sameAs
              : null,
            source_page: sourcePage,
            confidence: 85,
          });
        }
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }
  return out;
}

function extractHeadingPairs(html: string, sourcePage: string): DMCandidate[] {
  const out: DMCandidate[] = [];
  // Find headings followed within ~200 chars by a paragraph-ish element.
  const re = /<h[1-6][^>]*>\s*([A-Z][a-zA-ZÀ-ÿ'\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'\-]+){1,3})\s*<\/h[1-6]>([\s\S]{0,300})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    const tail = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const tailLower = tail.toLowerCase();
    const hit = DM_KEYWORDS.find((k) => tailLower.includes(k));
    if (!hit) continue;

    const parts = name.split(/\s+/);
    if (parts.length < 2) continue;

    // The title is the slice of tail up to 80 chars around the keyword.
    const kwIdx = tailLower.indexOf(hit);
    const title = tail.slice(Math.max(0, kwIdx - 20), Math.min(tail.length, kwIdx + 60)).trim();

    out.push({
      first_name: parts[0],
      last_name: parts.slice(1).join(' '),
      title,
      source_page: sourcePage,
      confidence: 55,
    });
    if (out.length >= 25) break;
  }
  return out;
}

export async function scrapeDecisionMakers(
  company: DiscoveredCompany,
  _deps: DmScraperDeps = {},
): Promise<DMCandidate[]> {
  if (!company.website_url) {
    console.log(`[lb/dm-scraper] no website for ${company.company_name}, returning []`);
    return [];
  }

  // Preferred path: delegate to the Playwright worker if configured.
  const workerResult = await callWorkerScrapeDms(company, _deps);
  if (workerResult && workerResult.length > 0) {
    console.log(`[lb/dm-scraper] worker returned ${workerResult.length} candidates for ${company.company_name}`);
    return workerResult;
  }

  // Normalize base URL.
  let base: string;
  try {
    const u = new URL(company.website_url.startsWith('http') ? company.website_url : `https://${company.website_url}`);
    base = `${u.protocol}//${u.host}`;
  } catch {
    return [];
  }

  const candidates: DMCandidate[] = [];
  for (const sub of SUBPATHS) {
    const url = base + sub;
    const html = await fetchSafely(url);
    if (!html) continue;
    candidates.push(...extractJsonLdPersons(html, url));
    candidates.push(...extractHeadingPairs(html, url));
    if (candidates.length >= 40) break;
  }

  // Dedupe by normalized full name.
  const seen = new Set<string>();
  const uniq: DMCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.first_name} ${c.last_name ?? ''}`.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(c);
  }
  return uniq;
}
