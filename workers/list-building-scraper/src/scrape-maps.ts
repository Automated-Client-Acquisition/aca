/**
 * Google Maps scraper.
 *
 * DOM assumptions (fragile — Google ships changes constantly):
 *  - Results pane is role=feed, each result card is role=article.
 *  - Card name lives in a `.fontHeadlineSmall` element.
 *  - Website anchor has data-item-id="authority".
 *  - Phone anchor has data-item-id starting with "phone:tel:".
 *  - Address is in a button with data-item-id="address".
 *  - Consent wall may appear on /consent path; we accept-all then retry.
 *
 * If Google restructures the DOM, update the selectors below. We log the
 * number of cards we see so you can spot the regression quickly in logs.
 */

import type { Browser, BrowserContext } from 'playwright';
import type { DiscoveredCompany, ProxyConfig, CompanyScraperQuery } from './types.js';
import { buildProxyOption } from './proxy.js';
import { normalizeDomain } from './dedup.js';

const NAV_TIMEOUT_MS = 30_000;

export async function scrapeGoogleMaps(
  browser: Browser,
  query: CompanyScraperQuery,
  proxy?: ProxyConfig,
): Promise<DiscoveredCompany[]> {
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    proxy: buildProxyOption(proxy),
  });

  try {
    const page = await context.newPage();
    const searchText = `${query.niche} ${query.geo}`.trim();
    const url = `https://www.google.com/maps/search/${encodeURIComponent(searchText)}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Consent wall — click "Accept all" if present.
    if (/consent\.google\.com/.test(page.url())) {
      const acceptBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
      if (await acceptBtn.count()) {
        await acceptBtn.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT_MS }).catch(() => {});
      }
    }

    // Wait for either the results feed or a single-result panel.
    await page
      .waitForSelector('div[role="feed"], div[role="main"]', { timeout: NAV_TIMEOUT_MS })
      .catch(() => {});

    // Scroll the feed to load more cards. Bounded so we stop at limit.
    const feed = page.locator('div[role="feed"]').first();
    const hasFeed = (await feed.count()) > 0;
    if (hasFeed) {
      for (let i = 0; i < 10; i++) {
        const cardCount = await page.locator('div[role="feed"] > div[role="article"], div[role="feed"] a.hfpxzc').count();
        if (cardCount >= query.limit) break;
        await feed.evaluate((el) => el.scrollBy(0, el.clientHeight)).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    // Extract everything from the list panel in one page.evaluate pass.
    // Clicking into each card's detail panel is fragile (Google randomizes the
    // "hfpxzc" anchor behavior and detail pane loads async). The list panel
    // already contains name, rating, address, and an external website link.
    const collected = await page.evaluate((maxLimit: number) => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];
      const cards = Array.from(feed.querySelectorAll('a.hfpxzc')) as HTMLAnchorElement[];
      const results: Array<{
        name: string | null;
        website: string | null;
        address: string | null;
        phone: string | null;
      }> = [];
      for (const card of cards.slice(0, maxLimit)) {
        // Parent container holds name + metadata row.
        const container = card.closest('div[jsaction]') || card.parentElement;
        if (!container) continue;
        const name =
          (card.getAttribute('aria-label') || '').trim() ||
          (container.querySelector('.fontHeadlineSmall') as HTMLElement | null)?.innerText?.trim() ||
          null;
        // Website anchor is a separate <a> sibling with aria-label starting with "Website".
        const siteAnchor = container.querySelector('a[aria-label^="Website"]') as HTMLAnchorElement | null;
        const website = siteAnchor?.href || null;
        // Address + phone appear in the sub-row of divs after the name. Fall back to a scan.
        const rowText = (container.textContent || '').replace(/\s+/g, ' ').trim();
        const phoneMatch = rowText.match(/(\+?\d[\d\s().-]{8,}\d)/);
        results.push({
          name,
          website,
          address: null,
          phone: phoneMatch ? phoneMatch[1].trim() : null,
        });
      }
      return results;
    }, query.limit);

    const out: DiscoveredCompany[] = [];
    for (const row of collected) {
      if (!row.name) continue;
      out.push({
        company_name: row.name,
        domain: normalizeDomain(row.website),
        website_url: row.website,
        linkedin_url: null,
        phone: row.phone,
        address: row.address,
        source: 'google_maps',
        raw_html_snippet: null,
      });
    }

    console.log(`[maps] collected ${out.length} companies for "${searchText}"`);
    return out;
  } finally {
    await context.close().catch(() => {});
  }
}
