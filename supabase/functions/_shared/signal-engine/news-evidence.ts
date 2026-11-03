import { normalizeCompanyName, normalizeDomain } from './normalize.ts';

export interface CanonicalNewsEvidenceInput {
  finalUrl: string;
  contentType: string | null;
  body: string;
  companyName: string;
  companyDomain?: string;
  companyAliases?: string[];
  eventType: string;
}

export interface CanonicalNewsEvidenceAssessment {
  verified: boolean;
  reason: string;
}

const EVENT_PATTERNS: Record<string, RegExp> = {
  funding: /\b(?:funding|funded|raises?|raised|series\s+[a-g]|seed|investment|financing|round)\b/i,
  acquisition: /\b(?:acquires?|acquired|acquisition|merger|buyout|takeover|bought)\b/i,
  hiring: /\b(?:hiring|hires?|hired|recruiting|job opening)\b/i,
  leadership_change: /\b(?:appointed|named|joins?|joined|promoted|chief\s+(?:executive|revenue|marketing)|vp\s+(?:of\s+)?sales|head\s+of\s+sales)\b/i,
  growth: /\b(?:opens?|expands?|launches?|selected by|partnered|revenue|growth|customer win)\b/i,
};

function normalise(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&(?:amp;)?/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function publisherContent(body: string): string {
  const cleaned = body.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // When present, article/main excludes unrelated navigation and site footers.
  const articles = [...cleaned.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)];
  const content = articles.length > 0
    ? articles.map((match) => match[1]).join(' ')
    : /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(cleaned)?.[1] ?? cleaned;
  return content.replace(/<(nav|aside|footer)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
}

function visibleText(content: string): string {
  return content.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|quot|apos|lt|gt);/gi, ' ');
}

function containsCompany(text: string, name: string, aliases: string[] = []): boolean {
  const page = ` ${normalise(text)} `;
  return [name, ...aliases].some((value) => {
    const company = normalise(normalizeCompanyName(value));
    return !!company && page.includes(` ${company} `);
  });
}

function matchesCompanyHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** A same-name article must independently identify the resolved business. */
function hasCompanyDomain(content: string, finalUrl: URL, companyDomain: string): boolean {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return false;
  if (matchesCompanyHost(finalUrl.hostname.toLowerCase(), domain)) return true;
  for (const match of content.matchAll(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    try {
      const url = new URL((match[1] ?? match[2] ?? match[3]).replace(/&amp;/gi, '&'), finalUrl);
      if (/^https?:$/.test(url.protocol) && matchesCompanyHost(url.hostname.toLowerCase(), domain)) return true;
    } catch {
      // Malformed links cannot establish a company identity.
    }
  }
  // Visible website mentions count, but hidden JSON/scripts and attributes do not.
  for (const match of visibleText(content).matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?=[\s/?:#()[\]{},.!;]|$)/gi)) {
    if (matchesCompanyHost(match[0].toLowerCase(), domain)) return true;
  }
  return false;
}

function isGoogleHost(hostname: string): boolean {
  return hostname === 'google.com'
    || hostname.endsWith('.google.com')
    || hostname === 'googleusercontent.com'
    || hostname.endsWith('.googleusercontent.com');
}

/**
 * A Google News RSS headline is discovery evidence, not proof. This gate only
 * accepts it after the redirect reaches a publisher page whose visible source
 * contains both the named company and language consistent with the event.
 */
export function assessCanonicalNewsEvidence(
  input: CanonicalNewsEvidenceInput,
): CanonicalNewsEvidenceAssessment {
  let url: URL;
  try {
    url = new URL(input.finalUrl);
  } catch {
    return { verified: false, reason: 'invalid_canonical_url' };
  }
  if (!/^https?:$/.test(url.protocol) || isGoogleHost(url.hostname.toLowerCase())) {
    return { verified: false, reason: 'not_a_publisher_url' };
  }
  if (!input.contentType?.toLowerCase().includes('text/html')) {
    return { verified: false, reason: 'publisher_content_not_html' };
  }

  const content = publisherContent(input.body);
  const text = visibleText(content);
  const page = normalise(text);
  const company = normalise(input.companyName);
  if (!page || !company) return { verified: false, reason: 'empty_publisher_content' };

  if (!containsCompany(text, input.companyName, input.companyAliases)) {
    return { verified: false, reason: 'company_not_present_on_publisher_page' };
  }

  if (input.companyDomain !== undefined && !hasCompanyDomain(content, url, input.companyDomain)) {
    return { verified: false, reason: 'company_domain_not_present_on_publisher_page' };
  }

  const pattern = EVENT_PATTERNS[input.eventType];
  if (!pattern || !pattern.test(text)) {
    return { verified: false, reason: 'event_terms_not_present_on_publisher_page' };
  }
  return { verified: true, reason: 'canonical_article_verified' };
}

/** HTTP statuses that mean "the publisher refused our fetch", not "no such page". */
export const PUBLISHER_BLOCK_STATUSES = new Set([401, 403, 405, 429]);

/**
 * Event types allowed to fall back to headline evidence. Leadership and hiring
 * headlines are excluded because the resolved "company" is too often a person
 * ("Vignesh Mani Appointed Head of Sales at Wipro"), and the headline naming
 * that person would pass a name match for the wrong entity.
 */
const HEADLINE_FALLBACK_EVENT_TYPES = new Set(['funding', 'acquisition', 'growth']);

export interface BlockedPublisherEvidenceInput {
  finalUrl: string;
  httpStatus: number;
  headline: string;
  companyName: string;
  companyDomain?: string;
  companyAliases?: string[];
  eventType: string;
}

/**
 * Fallback when a publisher blocks our fetch (bot walls answer 403 to every
 * datacenter IP, so retrying never helps). The article URL is a real, resolved
 * publisher page; we just cannot read the body. Accept the RSS headline instead,
 * but only if it names the full company as whole words AND carries event
 * language. Weaker than reading the page, so callers must record a distinct
 * evidence status rather than `canonical_article_verified`.
 */
export function assessBlockedPublisherEvidence(
  input: BlockedPublisherEvidenceInput,
): CanonicalNewsEvidenceAssessment {
  if (!PUBLISHER_BLOCK_STATUSES.has(input.httpStatus)) {
    return { verified: false, reason: `publisher_http_${input.httpStatus}` };
  }
  if (!HEADLINE_FALLBACK_EVENT_TYPES.has(input.eventType)) {
    return { verified: false, reason: `publisher_http_${input.httpStatus}` };
  }
  let url: URL;
  try {
    url = new URL(input.finalUrl);
  } catch {
    return { verified: false, reason: 'invalid_canonical_url' };
  }
  if (!/^https?:$/.test(url.protocol) || isGoogleHost(url.hostname.toLowerCase())) {
    return { verified: false, reason: 'not_a_publisher_url' };
  }

  // A blocked third-party article provides no body or link proving which
  // namesake business the headline concerns. Only a first-party URL can bind it.
  if (input.companyDomain !== undefined) {
    const domain = normalizeDomain(input.companyDomain);
    if (!domain || !matchesCompanyHost(url.hostname.toLowerCase(), domain)) {
      return { verified: false, reason: 'company_domain_not_verified_for_blocked_publisher' };
    }
  }

  if (!containsCompany(input.headline, input.companyName, input.companyAliases)) {
    return { verified: false, reason: 'company_not_in_headline' };
  }
  const pattern = EVENT_PATTERNS[input.eventType];
  if (!pattern || !pattern.test(input.headline)) {
    return { verified: false, reason: 'event_terms_not_in_headline' };
  }
  return { verified: true, reason: 'publisher_blocked_headline_verified' };
}
