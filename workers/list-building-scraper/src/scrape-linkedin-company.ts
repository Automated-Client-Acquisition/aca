/**
 * LinkedIn company discovery via Google search.
 *
 * Approach: we Google `"${niche}" "${geo}" site:linkedin.com/company` and
 * harvest the result anchors. Visiting each LinkedIn about page directly
 * usually bounces to an auth wall, so we only attempt the about-page fetch
 * and gracefully degrade to "linkedin_url only" when it fails.
 *
 * LinkedIn aggressively rate-limits unauthenticated traffic. If you see
 * 999 responses, rotate proxies and/or lower limit.
 */

import type { Browser, BrowserContext } from 'playwright';
import type { DiscoveredCompany, ProxyConfig, CompanyScraperQuery } from './types.js';
import { buildProxyOption } from './proxy.js';
import { normalizeDomain } from './dedup.js';

const NAV_TIMEOUT_MS = 30_000;

export async function scrapeLinkedInCompanies(
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
    const q = `${query.niche} ${query.geo} site:linkedin.com/company`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&num=30`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });

    // Consent wall
    if (/consent\.google\.com/.test(page.url())) {
      const acceptBtn = page.locator('button:has-text("Accept all"), button:has-text("I agree")').first();
      if (await acceptBtn.count()) {
        await acceptBtn.click().catch(() => {});
        await page.waitForLoadState('domcontentloaded').catch(() => {});
      }
    }

    // Extract result anchors that point to linkedin.com/company/*
    const hits = await page.evaluate(() => {
      const seen = new Set<string>();
      const out: Array<{ href: string; title: string }> = [];
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a'));
      for (const a of anchors) {
        const href = a.href;
        const m = href.match(/https?:\/\/[a-z]{2,3}\.linkedin\.com\/company\/([^/?#]+)/i);
        if (!m) continue;
        const slug = m[1].toLowerCase();
        if (seen.has(slug)) continue;
        seen.add(slug);
        const h3 = a.querySelector('h3');
        const title = h3?.textContent?.trim() ?? slug.replace(/-/g, ' ');
        out.push({ href: `https://www.linkedin.com/company/${slug}`, title });
      }
      return out;
    });

    const out: DiscoveredCompany[] = [];
    for (const hit of hits.slice(0, query.limit)) {
      const company: DiscoveredCompany = {
        company_name: hit.title,
        domain: null,
        website_url: null,
        linkedin_url: hit.href,
        source: 'linkedin',
        raw_html_snippet: null,
      };

      // Best-effort about page hit — almost always auth-walled but occasionally works.
      try {
        const aboutPage = await context.newPage();
        await aboutPage.goto(`${hit.href}/about`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        const extracted = await aboutPage.evaluate(() => {
          const name = document.querySelector('h1')?.textContent?.trim() ?? null;
          // Employees count text — usually in a dt/dd list labelled "Company size".
          let employees: string | null = null;
          const dts = Array.from(document.querySelectorAll('dt'));
          for (const dt of dts) {
            if (/company size/i.test(dt.textContent ?? '')) {
              employees = (dt.nextElementSibling as HTMLElement | null)?.innerText?.trim() ?? null;
              break;
            }
          }
          // Website link from the overview dl
          let website: string | null = null;
          const webDt = dts.find((d) => /website/i.test(d.textContent ?? ''));
          if (webDt) {
            const a = webDt.nextElementSibling?.querySelector('a') as HTMLAnchorElement | null;
            website = a?.href ?? null;
          }
          return { name, employees, website };
        });
        if (extracted.name) company.company_name = extracted.name;
        if (extracted.employees) company.employee_signal = extracted.employees;
        if (extracted.website) {
          company.website_url = extracted.website;
          company.domain = normalizeDomain(extracted.website);
        }
        await aboutPage.close().catch(() => {});
      } catch {
        // Auth wall / rate limit — keep linkedin_url only.
      }

      out.push(company);
    }

    console.log(`[linkedin] collected ${out.length} companies for "${q}"`);
    return out;
  } finally {
    await context.close().catch(() => {});
  }
}
