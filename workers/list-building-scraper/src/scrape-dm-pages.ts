/**
 * DM page scraper — walks a company website's common "people" pages and
 * extracts (name, title) pairs plus LinkedIn URLs.
 *
 * Extraction tiers:
 *  1. schema.org Person JSON-LD (highest confidence: 85)
 *  2. Visible H2/H3 with CEO/Founder/VP/Director/Head/Manager/Owner/President
 *     in an adjacent paragraph (confidence: 55)
 *  3. LinkedIn profile anchors (attached to nearest heading when available)
 *
 * Fragile part: team-page markup is bespoke per site. We do a second pass
 * over all "card-like" containers (`article`, `li`, `div` with at least one
 * heading and one paragraph) to catch sites that don't use JSON-LD.
 */

import type { Browser, BrowserContext } from 'playwright';
import type { DMCandidate, ProxyConfig } from './types.js';
import { buildProxyOption } from './proxy.js';

const NAV_TIMEOUT_MS = 30_000;
const SUBPATHS = ['', '/about', '/about-us', '/team', '/our-team', '/leadership', '/contact', '/staff', '/people'];

const DM_KEYWORDS = [
  'ceo', 'cto', 'cfo', 'cmo', 'coo', 'cro',
  'founder', 'co-founder', 'cofounder',
  'owner', 'president', 'principal',
  'vp', 'vice president',
  'head of', 'director', 'manager', 'chief',
];

function baseFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function scrapeDmPages(
  browser: Browser,
  website_url: string,
  proxy?: ProxyConfig,
): Promise<DMCandidate[]> {
  const base = baseFromUrl(website_url);
  if (!base) return [];

  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    proxy: buildProxyOption(proxy),
  });

  const collected: DMCandidate[] = [];
  try {
    const page = await context.newPage();
    for (const sub of SUBPATHS) {
      const url = base + sub;
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        if (!resp || !resp.ok()) continue;
      } catch {
        continue;
      }

      const extracted: DMCandidate[] = await page.evaluate((args) => {
        const { keywords, sourcePage } = args as { keywords: string[]; sourcePage: string };
        const out: DMCandidate[] = [];

        // ---- 1. JSON-LD Person ----
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          try {
            const parsed = JSON.parse(s.textContent || '');
            const nodes = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of nodes) {
              const graph = Array.isArray(node?.['@graph']) ? node['@graph'] : [node];
              for (const item of graph) {
                if (!item || typeof item !== 'object') continue;
                if (item['@type'] !== 'Person') continue;
                const name = String(item.name ?? '').trim();
                if (!name) continue;
                const parts = name.split(/\s+/);
                let linkedin: string | null = null;
                if (Array.isArray(item.sameAs)) {
                  linkedin = item.sameAs.find((v: unknown) => typeof v === 'string' && /linkedin\.com/i.test(String(v))) ?? null;
                } else if (typeof item.sameAs === 'string' && /linkedin\.com/i.test(item.sameAs)) {
                  linkedin = item.sameAs;
                }
                out.push({
                  first_name: parts[0],
                  last_name: parts.slice(1).join(' ') || null,
                  title: item.jobTitle ? String(item.jobTitle) : null,
                  linkedin_url: linkedin,
                  source_page: sourcePage,
                  confidence: 85,
                });
              }
            }
          } catch { /* ignore */ }
        }

        // ---- 2. heading + nearby paragraph ----
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
        for (const h of headings) {
          const name = (h.textContent || '').trim();
          if (!/^[A-Z][a-zA-ZÀ-ÿ'\-]+(?:\s+[A-Z][a-zA-ZÀ-ÿ'\-]+){1,3}$/.test(name)) continue;
          // Look at next 2 siblings or parent's next sibling for a title.
          let tail = '';
          let node: Element | null = h.nextElementSibling;
          for (let i = 0; i < 3 && node; i++) {
            tail += ' ' + (node.textContent || '');
            node = node.nextElementSibling;
          }
          if (!tail && h.parentElement) {
            tail = (h.parentElement.textContent || '').slice(0, 400);
          }
          const tailLower = tail.toLowerCase();
          const kw = keywords.find((k) => tailLower.includes(k));
          if (!kw) continue;
          const parts = name.split(/\s+/);
          if (parts.length < 2) continue;

          const idx = tailLower.indexOf(kw);
          const title = tail.slice(Math.max(0, idx - 20), Math.min(tail.length, idx + 60)).trim();

          // Try to pull a LinkedIn URL from the same card.
          let linkedin: string | null = null;
          const container = h.closest('article, li, div, section') || h.parentElement;
          if (container) {
            const a = Array.from(container.querySelectorAll('a')).find((el) =>
              /linkedin\.com\/in\//i.test((el as HTMLAnchorElement).href),
            ) as HTMLAnchorElement | undefined;
            linkedin = a?.href ?? null;
          }

          out.push({
            first_name: parts[0],
            last_name: parts.slice(1).join(' '),
            title,
            linkedin_url: linkedin,
            source_page: sourcePage,
            confidence: 55,
          });
        }
        return out;
      }, { keywords: DM_KEYWORDS, sourcePage: url });

      collected.push(...extracted);
      if (collected.length >= 40) break;
    }
  } finally {
    await context.close().catch(() => {});
  }

  // Dedupe by normalized full name, prefer highest confidence record.
  const byKey = new Map<string, DMCandidate>();
  for (const c of collected) {
    const key = `${c.first_name} ${c.last_name ?? ''}`.toLowerCase().trim();
    const prev = byKey.get(key);
    if (!prev || (c.confidence ?? 0) > (prev.confidence ?? 0)) byKey.set(key, c);
  }
  return Array.from(byKey.values());
}
