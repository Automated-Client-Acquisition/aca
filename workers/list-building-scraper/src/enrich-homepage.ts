/**
 * Homepage enrichment - fetches a domain's homepage via Playwright and
 * extracts structured data: title, description, location, phone, email,
 * tech stack, industry keywords, schema.org type, and employee signals.
 */

import type { Browser, BrowserContext } from 'playwright';
import type { ProxyConfig } from './types.js';

// ============================================================================
// Types
// ============================================================================

export interface EnrichedDomain {
  domain: string;
  title: string | null;
  meta_description: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address_raw: string | null;
  phone: string | null;
  email: string | null;
  tech_stack: string[];
  industry_keywords: string[];
  schema_org_type: string | null;
  employee_signal: string | null;
}

// ============================================================================
// US state abbreviation lookup
// ============================================================================

const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

const STATE_NAME_TO_ABBR: Record<string, string> = {};
for (const [abbr, name] of Object.entries(US_STATES)) {
  STATE_NAME_TO_ABBR[name.toLowerCase()] = abbr;
}

function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (US_STATES[trimmed.toUpperCase()]) return trimmed.toUpperCase();
  const abbr = STATE_NAME_TO_ABBR[trimmed.toLowerCase()];
  return abbr ?? trimmed;
}

// ============================================================================
// Tech stack signatures
// ============================================================================

interface TechSignature {
  name: string;
  patterns: string[];
}

const TECH_SIGNATURES: TechSignature[] = [
  { name: 'wordpress', patterns: ['wp-content', 'wp-includes'] },
  { name: 'shopify', patterns: ['Shopify.', 'cdn.shopify.com'] },
  { name: 'nextjs', patterns: ['_next/', '__next'] },
  { name: 'wix', patterns: ['wix.com', 'parastorage.com'] },
  { name: 'squarespace', patterns: ['squarespace.com', 'sqsp.'] },
  { name: 'hubspot', patterns: ['hubspot'] },
  { name: 'webflow', patterns: ['webflow.'] },
  { name: 'gatsby', patterns: ['gatsby'] },
  { name: 'react', patterns: ['__react', 'react-root', 'data-reactroot', '_reactRoot'] },
  { name: 'angular', patterns: ['ng-version', 'ng-app', 'angular.'] },
  { name: 'vue', patterns: ['__vue', 'data-v-', 'Vue.'] },
  { name: 'bootstrap', patterns: ['bootstrap.min.css', 'bootstrap.min.js'] },
  { name: 'tailwind', patterns: ['tailwindcss', 'tailwind.'] },
  { name: 'stripe', patterns: ['js.stripe.com', 'stripe.'] },
  { name: 'intercom', patterns: ['intercom', 'intercomSettings'] },
  { name: 'drift', patterns: ['drift.com', 'driftt.'] },
  { name: 'google_analytics', patterns: ['google-analytics', 'gtag', 'ga.js'] },
  { name: 'google_tag_manager', patterns: ['gtm.js', 'googletagmanager'] },
  { name: 'facebook_pixel', patterns: ['facebook.net/en_US/fbevents', 'fbq('] },
  { name: 'hotjar', patterns: ['hotjar'] },
  { name: 'segment', patterns: ['segment.com/analytics', 'analytics.js/v1'] },
  { name: 'crisp', patterns: ['crisp.chat'] },
  { name: 'tawk', patterns: ['tawk.to'] },
  { name: 'zendesk', patterns: ['zendesk'] },
  { name: 'freshworks', patterns: ['freshdesk', 'freshchat'] },
  { name: 'mailchimp', patterns: ['mailchimp'] },
  { name: 'klaviyo', patterns: ['klaviyo'] },
];

function detectTechStack(html: string): string[] {
  const lower = html.toLowerCase();
  const found = new Set<string>();
  for (const sig of TECH_SIGNATURES) {
    for (const pat of sig.patterns) {
      if (lower.includes(pat.toLowerCase())) {
        found.add(sig.name);
        break;
      }
    }
  }
  return Array.from(found);
}

// ============================================================================
// Industry keyword extraction
// ============================================================================

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'from',
  'that', 'this', 'with', 'they', 'will', 'each', 'make', 'like',
  'just', 'over', 'such', 'take', 'than', 'them', 'very', 'when',
  'what', 'your', 'about', 'which', 'their', 'would', 'there', 'could',
  'other', 'into', 'more', 'some', 'these', 'then', 'home', 'page',
  'welcome', 'best', 'free', 'here', 'also', 'back', 'after', 'only',
  'come', 'made', 'find', 'before', 'many', 'where', 'much', 'know',
  'help', 'call', 'contact', 'today', 'website', 'site', 'click',
  'learn', 'read', 'more', 'need', 'most', 'right', 'well', 'work',
  'first', 'even', 'new', 'want', 'because', 'good', 'give', 'look',
  'how', 'may', 'get', 'use', 'now', 'way', 'who', 'did', 'its',
  'let', 'say', 'she', 'too', 'does', 'been', 'being',
]);

function extractIndustryKeywords(title: string | null, description: string | null): string[] {
  const text = [title ?? '', description ?? ''].join(' ').toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (w.length <= 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    result.push(w);
    if (result.length >= 10) break;
  }
  return result;
}

// ============================================================================
// Main enrichment function
// ============================================================================

export async function enrichHomepage(
  browser: Browser,
  domain: string,
  proxy?: ProxyConfig,
): Promise<EnrichedDomain> {
  const empty: EnrichedDomain = {
    domain,
    title: null,
    meta_description: null,
    country: null,
    state: null,
    city: null,
    address_raw: null,
    phone: null,
    email: null,
    tech_stack: [],
    industry_keywords: [],
    schema_org_type: null,
    employee_signal: null,
  };

  let ctx: BrowserContext | null = null;
  try {
    const ctxOptions: Record<string, unknown> = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
    };
    if (proxy) {
      ctxOptions.proxy = {
        server: `http://${proxy.host}:${proxy.port}`,
        username: proxy.username,
        password: proxy.password,
      };
    }
    ctx = await browser.newContext(ctxOptions);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);

    await page.goto(`https://${domain}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    // Get full HTML source for tech stack detection
    const htmlSource = await page.content();
    const techStack = detectTechStack(htmlSource);

    // Extract structured data from the page
    const extracted = await page.evaluate(() => {
      const result: Record<string, unknown> = {};

      // Title
      result.title = document.title || null;

      // Meta description
      const metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
      const ogDesc = document.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
      result.meta_description = metaDesc?.content || ogDesc?.content || null;

      // OG location tags
      const ogLocality = document.querySelector('meta[property="og:locality"]') as HTMLMetaElement | null;
      const ogRegion = document.querySelector('meta[property="og:region"]') as HTMLMetaElement | null;
      const ogCountry = document.querySelector('meta[property="og:country-name"]') as HTMLMetaElement | null;
      result.og_city = ogLocality?.content || null;
      result.og_state = ogRegion?.content || null;
      result.og_country = ogCountry?.content || null;

      // Schema.org JSON-LD
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      const schemaData: Array<Record<string, unknown>> = [];
      ldScripts.forEach((s) => {
        try {
          const parsed = JSON.parse(s.textContent || '');
          if (Array.isArray(parsed)) {
            schemaData.push(...parsed);
          } else {
            schemaData.push(parsed);
          }
        } catch { /* ignore malformed JSON-LD */ }
      });
      result.schema_data = schemaData;

      // Address tag
      const addressEl = document.querySelector('address');
      result.address_tag = addressEl?.innerText?.trim() || null;

      // Footer text for address regex
      const footer = document.querySelector('footer');
      result.footer_text = footer?.innerText?.trim()?.slice(0, 2000) || null;

      // Phone from tel: links
      const telLink = document.querySelector('a[href^="tel:"]');
      result.tel_href = telLink?.getAttribute('href')?.replace('tel:', '')?.trim() || null;

      // Email from mailto: links
      const mailLinks = document.querySelectorAll('a[href^="mailto:"]');
      const emails: string[] = [];
      mailLinks.forEach((a) => {
        const href = a.getAttribute('href')?.replace('mailto:', '')?.split('?')[0]?.trim();
        if (href) emails.push(href);
      });
      result.mailto_emails = emails;

      // Get body text for employee signal and email/phone regex
      result.body_text = document.body?.innerText?.slice(0, 10000) || '';

      return result;
    });

    // Process schema.org data
    let schemaCity: string | null = null;
    let schemaState: string | null = null;
    let schemaCountry: string | null = null;
    let schemaAddress: string | null = null;
    let schemaPhone: string | null = null;
    let schemaOrgType: string | null = null;

    const schemaData = (extracted.schema_data as Array<Record<string, unknown>>) || [];
    const orgTypes = ['LocalBusiness', 'Organization', 'Store', 'Restaurant',
      'MedicalBusiness', 'LegalService', 'FinancialService', 'RealEstateAgent',
      'AutoDealer', 'AutomotiveBusiness', 'HomeAndConstructionBusiness',
      'ProfessionalService', 'SportsActivityLocation', 'EntertainmentBusiness'];

    for (const schema of schemaData) {
      const sType = (schema['@type'] as string) || '';
      // Check if type matches any org type (handle arrays)
      const types = Array.isArray(sType) ? sType : [sType];
      for (const t of types) {
        if (orgTypes.some((ot) => t.includes(ot))) {
          schemaOrgType = t;
          break;
        }
      }

      const address = schema.address as Record<string, unknown> | undefined;
      if (address) {
        schemaCity = (address.addressLocality as string) || schemaCity;
        schemaState = (address.addressRegion as string) || schemaState;
        schemaCountry = (address.addressCountry as string) || schemaCountry;
        const streetAddr = (address.streetAddress as string) || '';
        const postalCode = (address.postalCode as string) || '';
        if (streetAddr || postalCode) {
          schemaAddress = [streetAddr, schemaCity, schemaState, postalCode, schemaCountry]
            .filter(Boolean).join(', ');
        }
      }

      if (schema.telephone) {
        schemaPhone = String(schema.telephone);
      }
    }

    // Determine location: schema.org > OG tags > address regex
    let city = schemaCity || (extracted.og_city as string) || null;
    let state = normalizeState(schemaState || (extracted.og_state as string) || null);
    let country = (schemaCountry || (extracted.og_country as string) || null);
    let addressRaw = schemaAddress || (extracted.address_tag as string) || null;

    // Try US address regex on footer if we're missing location data
    if (!city || !state) {
      const footerText = (extracted.footer_text as string) || '';
      const bodyText = (extracted.body_text as string) || '';
      const searchText = footerText || bodyText;
      const addressMatch = searchText.match(
        /\d{1,5}\s[\w\s]+(?:St|Ave|Blvd|Dr|Rd|Ln|Way|Ct|Pl|Street|Avenue|Boulevard|Drive|Road|Lane|Court|Place)[\w\s.,]+?\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*,?\s*([A-Z]{2})\s*(\d{5})?/
      );
      if (addressMatch) {
        if (!city) city = addressMatch[1]?.trim() || null;
        if (!state) state = normalizeState(addressMatch[2]);
        if (!addressRaw) addressRaw = addressMatch[0]?.trim() || null;
        if (!country) country = 'US';
      }
    }

    // Phone: schema.org > tel: link > regex
    let phone = schemaPhone || (extracted.tel_href as string) || null;
    if (!phone) {
      const bodyText = (extracted.body_text as string) || '';
      const phoneMatch = bodyText.match(/(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/);
      if (phoneMatch) phone = phoneMatch[1].trim();
    }

    // Email: mailto > regex (skip generic addresses)
    const genericPrefixes = ['info@', 'noreply@', 'no-reply@', 'support@', 'admin@', 'webmaster@', 'postmaster@'];
    const mailtoEmails = (extracted.mailto_emails as string[]) || [];
    let email = mailtoEmails.find((e) => !genericPrefixes.some((p) => e.toLowerCase().startsWith(p))) || null;
    if (!email && mailtoEmails.length > 0) email = mailtoEmails[0];
    if (!email) {
      const bodyText = (extracted.body_text as string) || '';
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const matches = bodyText.match(emailRegex) || [];
      email = matches.find((e) => !genericPrefixes.some((p) => e.toLowerCase().startsWith(p))) || matches[0] || null;
    }

    // Employee signal
    let employeeSignal: string | null = null;
    const bodyText = (extracted.body_text as string) || '';
    const empPatterns = [
      /team\s+of\s+(\d+)/i,
      /(\d+)\s+employees/i,
      /our\s+(\d+)\s+staff/i,
      /(\d+)-person/i,
      /(\d+)\+?\s+team\s+members/i,
    ];
    for (const pat of empPatterns) {
      const m = bodyText.match(pat);
      if (m) {
        employeeSignal = m[0];
        break;
      }
    }

    // Industry keywords from title + description
    const title = (extracted.title as string) || null;
    const metaDesc = (extracted.meta_description as string) || null;
    const industryKeywords = extractIndustryKeywords(title, metaDesc);

    return {
      domain,
      title,
      meta_description: metaDesc,
      country,
      state,
      city,
      address_raw: addressRaw,
      phone,
      email,
      tech_stack: techStack,
      industry_keywords: industryKeywords,
      schema_org_type: schemaOrgType,
      employee_signal: employeeSignal,
    };
  } catch (err) {
    console.warn(`[enrich-homepage] failed for ${domain}: ${(err as Error).message}`);
    return empty;
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }
}
