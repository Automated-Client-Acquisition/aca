/**
 * Directory scrapers.
 *
 * V1 registry:
 *  - 'bbb' — Better Business Bureau search
 *  - fallback: plain Google search for `${niche} ${geo}` with non-linkedin,
 *    non-social hosts as a loose directory-like signal.
 *
 * Add more directories (NABCEP, Angi, Yelp, etc.) by extending `REGISTRY`
 * with a function matching DirectoryScraper.
 */

import type { Browser, BrowserContext } from 'playwright';
import type { CompanyScraperQuery, DiscoveredCompany, ProxyConfig } from './types.js';
import { buildProxyOption } from './proxy.js';
import { normalizeDomain } from './dedup.js';

const NAV_TIMEOUT_MS = 30_000;
const SOCIAL_HOSTS = /(facebook|instagram|twitter|x\.com|tiktok|youtube|linkedin|yelp|wikipedia)\.com/i;

type DirectoryScraper = (
  context: BrowserContext,
  query: CompanyScraperQuery,
) => Promise<DiscoveredCompany[]>;

async function scrapeBBB(
  context: BrowserContext,
  query: CompanyScraperQuery,
): Promise<DiscoveredCompany[]> {
  const page = await context.newPage();
  const url = `https://www.bbb.org/search?find_text=${encodeURIComponent(query.niche)}&find_loc=${encodeURIComponent(query.geo)}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(1_500);

    // BBB result cards — the stable-ish selector is `.card.result-card`.
    // Fall back to any anchor containing "/profile/" which BBB uses for business pages.
    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.card.result-card, div.result-card, li.result-card'));
      const out: Array<{ name: string; website: string | null; address: string | null; phone: string | null }> = [];
      for (const card of cards) {
        const name = (card.querySelector('h3, .result-business-name, a.text-blue-medium') as HTMLElement | null)?.innerText?.trim()
          ?? (card.querySelector('a[href*="/profile/"]') as HTMLElement | null)?.innerText?.trim() ?? '';
        if (!name) continue;
        const websiteAnchor = Array.from(card.querySelectorAll<HTMLAnchorElement>('a')).find((a) => /^https?:\/\//.test(a.href) && !a.href.includes('bbb.org'));
        const website = websiteAnchor?.href ?? null;
        const address = (card.querySelector('.result-address, address') as HTMLElement | null)?.innerText?.trim() ?? null;
        const phone = (card.querySelector('.result-phone, a[href^="tel:"]') as HTMLElement | null)?.innerText?.trim() ?? null;
        out.push({ name, website, address, phone });
      }
      return out;
    });

    const out: DiscoveredCompany[] = results.slice(0, query.limit).map((r) => ({
      company_name: r.name,
      domain: normalizeDomain(r.website),
      website_url: r.website,
      linkedin_url: null,
      phone: r.phone,
      address: r.address,
      source: 'directory',
      raw_html_snippet: null,
    }));
    console.log(`[bbb] collected ${out.length} companies`);
    return out;
  } catch (err) {
    console.warn('[bbb] scrape failed:', (err as Error).message);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function scrapeGoogleGeneric(
  context: BrowserContext,
  query: CompanyScraperQuery,
): Promise<DiscoveredCompany[]> {
  const page = await context.newPage();
  const q = `${query.niche} ${query.geo}`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=30`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    if (/consent\.google\.com/.test(page.url())) {
      const acceptBtn = page.locator('button:has-text("Accept all")').first();
      if (await acceptBtn.count()) await acceptBtn.click().catch(() => {});
    }
    const results = await page.evaluate((socialSrc: string) => {
      const social = new RegExp(socialSrc, 'i');
      const seen = new Set<string>();
      const out: Array<{ name: string; url: string }> = [];
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
      for (const a of anchors) {
        const href = a.href;
        if (!/^https?:\/\//.test(href)) continue;
        if (social.test(href)) continue;
        if (/google\./i.test(href)) continue;
        const h3 = a.querySelector('h3');
        if (!h3) continue;
        try {
          const host = new URL(href).hostname.replace(/^www\./, '');
          if (seen.has(host)) continue;
          seen.add(host);
          out.push({ name: h3.textContent?.trim() ?? host, url: href });
        } catch {
          /* ignore */
        }
      }
      return out;
    }, SOCIAL_HOSTS.source);

    const out: DiscoveredCompany[] = results.slice(0, query.limit).map((r) => ({
      company_name: r.name,
      domain: normalizeDomain(r.url),
      website_url: r.url,
      linkedin_url: null,
      source: 'directory',
      raw_html_snippet: null,
    }));
    console.log(`[google-generic] collected ${out.length} companies`);
    return out;
  } catch (err) {
    console.warn('[google-generic] failed:', (err as Error).message);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

const REGISTRY: Record<string, DirectoryScraper> = {
  bbb: scrapeBBB,
  google_generic: scrapeGoogleGeneric,
};

export async function scrapeDirectories(
  browser: Browser,
  query: CompanyScraperQuery,
  proxy?: ProxyConfig,
): Promise<DiscoveredCompany[]> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    proxy: buildProxyOption(proxy),
  });

  try {
    const collected: DiscoveredCompany[] = [];
    // V1: BBB first, then google-generic fallback.
    for (const key of ['bbb', 'google_generic']) {
      if (collected.length >= query.limit) break;
      const fn = REGISTRY[key];
      if (!fn) continue;
      const batch = await fn(context, query);
      collected.push(...batch);
    }
    return collected.slice(0, query.limit);
  } finally {
    await context.close().catch(() => {});
  }
}
