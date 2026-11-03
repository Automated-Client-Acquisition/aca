/**
 * Google News RSS collector for ACA's first-party signal engine.
 *
 * The query registry is intentionally versioned here. Hermes kept it in an
 * off-host script, which made source drift invisible to ACA. All query matches
 * share one signal_sources row: overlapping queries must not manufacture
 * corroboration for the same article.
 */
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { fetchText, RateLimiter } from '../http.js';
import type { RawObservation } from '../types.js';

export type GoogleSignalType = 'funding' | 'acquisition' | 'hiring' | 'leadership_change' | 'growth';

export interface GoogleNewsQuery {
  type: GoogleSignalType;
  query: string;
}

const group = (type: GoogleSignalType, queries: string[]): GoogleNewsQuery[] =>
  queries.map((query) => ({ type, query }));

/** 83 live queries recovered from collect-free-buying-signals.py. */
export const GOOGLE_NEWS_QUERIES: GoogleNewsQuery[] = [
  ...group('funding', [
    '"raises" "Series A" startup', '"raises" "Series B" startup',
    '"raises" "Series C" startup', '"raised" "seed round" startup',
    '"secures" "funding" startup', '"closes" "funding round" startup',
    '"raises" "$" "million" SaaS', 'site:techcrunch.com startup raised million',
    'site:news.crunchbase.com raised Series funding', 'site:finsmes.com raises funding',
    'site:businesswire.com raises funding startup', 'site:prnewswire.com raises funding startup',
    '"closes" "Series B"', 'site:eu-startups.com raised funding',
    'site:tech.eu funding', 'site:sifted.eu raised', '"Series A" "led by"',
    '"closes" "$" "million" round', 'site:techcrunch.com series funding',
    'site:venturebeat.com funding', 'site:crunchbase.com "raises" "Series"',
    'site:news.crunchbase.com "raises" "million"',
    'site:news.crunchbase.com "Series A" "led by"',
    'site:crunchbase.com "secures" "funding"', '"pre-seed" "raised" startup',
    '"seed round" "raised" "million"', '"angel round" startup funding',
    '"bootstrapped" "raises first" funding', 'site:techcrunch.com seed funding startup',
    'site:news.crunchbase.com seed round',
  ]),
  ...group('acquisition', [
    '"acquires" "startup"', '"has acquired" "startup"',
    '"announces acquisition of" "startup"', '"acquired by" "startup"',
    '"merges with" startup', '"completes acquisition" startup',
    'site:techcrunch.com acquires startup', 'site:prnewswire.com acquired startup',
    'site:businesswire.com acquisition startup', 'site:finsmes.com acquisition',
    '"buyout" "startup"', '"takes over" startup', 'site:tech.eu acquisition',
    '"merger" "startup"', 'site:news.crunchbase.com "acquires" startup',
    'site:crunchbase.com "acquisition" "billion"',
  ]),
  ...group('hiring', [
    '"is hiring a" "VP" "Sales"', '"is hiring a" "Head of Sales"',
    '"is hiring a" "Chief Revenue Officer"', '"hiring a VP of"',
    '"seeks VP of Sales"', '"looking for a VP" Sales', '"appoints" "VP of Sales"',
    '"announced the appointment of" "Sales"', '"to lead" "sales team"',
    'hiring "VP of Sales" site:linkedin.com',
    'hiring "Head of Sales" site:linkedin.com',
    'hiring "VP Sales" site:linkedin.com/jobs',
  ]),
  ...group('leadership_change', [
    '"appointed" "Chief Revenue Officer"', '"named" "Chief Revenue Officer"',
    '"joins as" "Chief Revenue Officer"', '"joins as" "VP of Sales"',
    '"appointed" "VP of Sales"', '"joins as" "Chief Marketing Officer"',
    '"appointed" "Head of Sales"', '"named" "VP of Sales"',
    '"announced" "new VP of Sales"', '"new Chief Revenue Officer" "joins"',
    '"joins" "as VP of Sales"', '"takes over as" "VP Sales"',
    '"promoted to" "VP Sales"', 'site:businesswire.com "appointed" "chief revenue"',
    '"has been appointed" "head of sales"',
  ]),
  ...group('growth', [
    '"opens new office" startup', '"expands to" "new market" startup',
    '"launches" "new product" SaaS', '"announced a new" customer win',
    '"selected by" "as its" vendor', '"partnered with" "platform"',
    '"grows" "revenue" 100', '"doubled revenue"',
    '"tripled" "annual recurring revenue"', '"record growth" startup',
  ]),
];

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
const limiter = new RateLimiter(2);

const EVENT_TERMS: Record<GoogleSignalType, RegExp> = {
  funding: /(?:\b(?:raise[sd]?|secures?|closes?)\b.{0,100}\b(?:funding|series\s+[a-g]|seed|round|investment|financing)\b|\b(?:series\s+[a-g]|seed|pre-seed)\b.{0,80}\b(?:round|funding|financing)\b|\$\s?\d+(?:\.\d+)?\s?(?:m|b|million|billion)\b)/i,
  acquisition: /\b(acquire[sd]?|acquisition|merger|buyout|bought|buys?|takeover)\b/i,
  hiring: /\b(hiring|hires?|seeks?|looking for|appoints?|appointment)\b/i,
  leadership_change: /\b(appointed|named|joins?|promoted|new\s+(?:chief|vp|head))\b/i,
  growth: /\b(opens?|expands?|launches?|selected by|partnered|revenue|growth)\b/i,
};

const COMPANY_PATTERNS: Record<GoogleSignalType, RegExp[]> = {
  funding: [/^(.+?)\s+(?:raises?|raised|secures?|secured|closes?|closed|lands?)\b/i],
  acquisition: [
    /\b(?:acquires?|acquired|buys?|bought)\s+(?:an?\s+|the\s+)?(?:[a-z-]+\s+){0,6}([A-Z][A-Za-z0-9&.-]{1,50})\b/,
    /^(.+?)\s+(?:acquires?|acquired|buys?|bought|merges?)\b/i,
  ],
  hiring: [/^(.+?)\s+(?:is\s+)?hiring\b/i, /^(.+?)\s+(?:appoints?|hires?|seeks?)\b/i],
  leadership_change: [/^(.+?)\s+(?:appoints?|appointed|names?|named|hires?|hired)\b/i],
  growth: [/^(.+?)\s+(?:opens?|expands?|launches?|grows?|doubled|tripled|partners?)\b/i],
};

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '#text' in value) return String((value as { '#text': unknown })['#text']).trim();
  return '';
}

export function cleanCompany(raw: string): string | null {
  let cleaned = raw
    .replace(/\s+[|–—-]\s+[^|–—-]+$/, '')
    .replace(/^(?:exclusive:\s*|startup\s+|saas startup\s+|ai startup\s+)/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:|–—-]+|[\s:|–—-]+$/g, '')
    .trim();
  // Headlines often lead with a description ("Voice AI startup Navana.ai")
  // rather than the name. Keep only the proper-name suffix when one exists.
  const described = cleaned.match(/^(?:[\w’'-]+\s+){1,5}(?:startup|platform|company|firm|brand)\s+(.+)$/i);
  if (described?.[1] && /^[A-Z0-9]/.test(described[1])) cleaned = described[1].trim();
  if (cleaned.length < 2 || cleaned.length > 80) return null;
  if (/^(?:(?:the|a|an|startup|company|firm|series\s+[a-g])\b|\$?\d)/i.test(cleaned)) return null;
  if (/\b(jobs?|careers?|recruitment|how|why|inside)\b/i.test(cleaned)) return null;
  if (/\b(?:startup|platform|company|firm|brand)$/i.test(cleaned)) return null;
  return cleaned;
}

export function extractCompany(title: string, type: GoogleSignalType): string | null {
  const withoutPublisher = title.replace(/\s+[|–—-]\s+[^|–—-]+$/, '').trim();
  for (const pattern of COMPANY_PATTERNS[type]) {
    const match = pattern.exec(withoutPublisher);
    if (match?.[1]) return cleanCompany(match[1]);
  }
  return null;
}

/** Stable across overlapping queries and Google redirect-token changes. */
export function googleArticleId(sourceName: string, title: string): string {
  const normalizedTitle = title
    .replace(/\s+[|–—-]\s+[^|–—-]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return createHash('sha256')
    .update(`${sourceName.toLowerCase().trim()}|${normalizedTitle}`)
    .digest('hex');
}

export function filterFreshObservations(
  observations: RawObservation[],
  seen: Set<string>,
): { fresh: RawObservation[]; duplicates: number } {
  const fresh: RawObservation[] = [];
  let duplicates = 0;
  for (const observation of observations) {
    if (seen.has(observation.external_id)) {
      duplicates++;
      continue;
    }
    seen.add(observation.external_id);
    fresh.push(observation);
  }
  return { fresh, duplicates };
}

interface ParsedRssItem {
  guid?: unknown;
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  source?: unknown;
}

function rssItems(payload: string): ParsedRssItem[] {
  const parsed = xml.parse(payload) as { rss?: { channel?: { item?: ParsedRssItem | ParsedRssItem[] } } };
  const rawItems = parsed.rss?.channel?.item;
  return rawItems == null ? [] : Array.isArray(rawItems) ? rawItems : [rawItems];
}

export function parseGoogleNewsRss(payload: string, type: GoogleSignalType, query: string): RawObservation[] {
  const observations: RawObservation[] = [];

  for (const item of rssItems(payload)) {
    const title = text(item.title);
    const link = text(item.link);
    if (!title || !link || !EVENT_TERMS[type].test(title)) continue;
    const company = extractCompany(title, type);
    if (!company) continue;
    const published = new Date(text(item.pubDate));
    const sourceName = text(item.source) || 'Google News';
    const guid = text(item.guid);

    observations.push({
      external_id: googleArticleId(sourceName, title),
      source_url: link,
      title,
      structured: {
        event_type: type,
        company_name: company,
        headline: title,
        publisher: sourceName,
        discovery_query: query,
        evidence_url: link,
        evidence_status: 'rss_headline_only',
        source_guid: guid || null,
      },
      entity_hints: { company_name: company },
      event_type: type,
      published_at: Number.isNaN(published.getTime()) ? undefined : published.toISOString(),
    });
  }
  return observations;
}

export interface GoogleNewsCollectionResult {
  observations: RawObservation[];
  queriesRun: number;
  queriesFailed: number;
  queriesLimited: number;
  sourceCappedQueries: number;
  limitedQueryLabels: string[];
  cappedQueryLabels: string[];
  duplicatesFiltered: number;
  seenExternalIds: string[];
  errors: string[];
}

export async function collectGoogleNews(opts: {
  days?: number;
  perQuery?: number;
  seenExternalIds?: string[];
  signal?: AbortSignal;
} = {}): Promise<GoogleNewsCollectionResult> {
  const days = Math.max(1, Math.min(30, opts.days ?? 2));
  // Google News RSS has no continuation token. Consume its full documented
  // response envelope by default and report feeds that land on the apparent
  // 100-item source cap so incompleteness is operationally visible.
  const perQuery = Math.max(1, Math.min(100, opts.perQuery ?? 100));
  const observations = new Map<string, RawObservation>();
  const seen = new Set(opts.seenExternalIds ?? []);
  const errors: string[] = [];
  let queriesRun = 0;
  let queriesLimited = 0;
  let sourceCappedQueries = 0;
  const limitedQueryLabels: string[] = [];
  const cappedQueryLabels: string[] = [];
  let duplicatesFiltered = 0;

  // Small parallel batches keep a full sweep quick without hammering Google.
  for (let i = 0; i < GOOGLE_NEWS_QUERIES.length; i += 4) {
    if (opts.signal?.aborted) break;
    const batch = GOOGLE_NEWS_QUERIES.slice(i, i + 4);
    await Promise.all(batch.map(async ({ type, query }) => {
      const url = 'https://news.google.com/rss/search?' + new URLSearchParams({
        q: `${query} when:${days}d`, hl: 'en-US', gl: 'US', ceid: 'US:en',
      });
      try {
        const body = await fetchText(url, {
          headers: { 'User-Agent': 'ACA Signal Engine/1.0' },
          limiter,
          signal: opts.signal,
        });
        queriesRun++;
        const payload = body ?? '';
        const parsed = parseGoogleNewsRss(payload, type, query);
        if (parsed.length > perQuery) {
          queriesLimited++;
          limitedQueryLabels.push(`${type}: ${query}`);
        }
        if (rssItems(payload).length >= 100) {
          sourceCappedQueries++;
          cappedQueryLabels.push(`${type}: ${query}`);
        }
        const filtered = filterFreshObservations(parsed.slice(0, perQuery), seen);
        duplicatesFiltered += filtered.duplicates;
        for (const observation of filtered.fresh) {
          observations.set(observation.external_id, observation);
        }
      } catch (error) {
        errors.push(`${type}/${query}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }

  return {
    observations: [...observations.values()],
    queriesRun,
    queriesFailed: errors.length,
    queriesLimited,
    sourceCappedQueries,
    limitedQueryLabels,
    cappedQueryLabels,
    duplicatesFiltered,
    seenExternalIds: [...seen].slice(-20_000),
    errors,
  };
}
