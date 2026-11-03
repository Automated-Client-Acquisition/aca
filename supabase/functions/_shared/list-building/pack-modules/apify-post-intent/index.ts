/**
 * LinkedIn Topic-Intent pack module — pack_key `linkedin_post_intent`.
 *
 * Keyword search across LinkedIn posts. Surfaces individuals who recently
 * posted about a topic the user solves for. The post AUTHOR becomes the
 * prospect.
 *
 * Backed by harvestapi/linkedin-post-search (buIWk2uOUzTmcLsuB).
 *
 * Async pattern: kickoff() POSTs to the actor, returns AsyncRunHandle
 * immediately. apify-poller picks up dataset items and calls mapRecord().
 *
 * Cost: ~$0.005 per post returned. 50-result run ≈ $0.25.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../../../apify-leads-utils.ts';
import type { PackModule, AsyncRunHandle, DiscoveryRecord, PackRunConfig } from '../types.ts';

const ACTOR_ID = 'harvestapi~linkedin-post-search';

interface PostIntentConfig {
  search_query?: string;
  /** harvestapi `postedLimit`: '1h' | '24h' | 'week' | 'month'. */
  posted_limit?: '1h' | '24h' | 'week' | 'month';
  /** Hard cap on posts. Default 50. */
  limit?: number;
  /** Filter authors by industry (LinkedIn industry IDs). Optional. */
  author_industry_ids?: string[];
  /** Filter authors by company names. Optional. */
  authors_companies?: string[];
}

interface HarvestapiPostRow {
  postUrl?: string;
  url?: string;
  text?: string;
  textSnippet?: string;
  postedDate?: string;
  postedAt?: string;
  reactionsCount?: number;
  commentsCount?: number;
  author?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    headline?: string;
    linkedinUrl?: string;
    publicIdentifier?: string;
    companyName?: string;
    companyLinkedinUrl?: string;
    location?: string;
    country?: string;
  };
  [key: string]: unknown;
}

async function getApifyToken(orgId: string): Promise<string | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return null;
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', orgId)
    .eq('provider', 'apify')
    .eq('is_valid', true)
    .maybeSingle();
  if (!data) return null;
  return decryptApiKey((data as { key_encrypted: string }).key_encrypted, encryptionKey);
}

export const linkedinPostIntentModule: PackModule = {
  key: 'linkedin_post_intent',
  pack: 'linkedin_post_intent',
  tier: 'signal',
  label: 'LinkedIn Topic Intent',

  async *run(_config: PackRunConfig): AsyncIterable<DiscoveryRecord> {
    // No-op. Async path only.
  },

  async kickoff({ organizationId, filters, sinceIso }: PackRunConfig): Promise<AsyncRunHandle[]> {
    const cfg = filters as PostIntentConfig;
    const query = (cfg.search_query ?? '').trim();
    if (!query) {
      console.warn('[post-intent] no search_query — skipping kickoff');
      return [];
    }

    const apifyToken = await getApifyToken(organizationId);
    if (!apifyToken) {
      console.warn('[post-intent] no Apify key for org', organizationId);
      return [];
    }

    // Cadence-aware postedLimit: tighten the bucket based on sinceIso
    // (last refresh time) so daily cadence doesn't re-scan a full week
    // of posts every day. Uses the smallest bucket that still covers
    // the gap since last refresh, capped at the user's configured
    // posted_limit (treated as the maximum reach).
    type PostedLimit = '1h' | '24h' | 'week' | 'month';
    const userBucket: PostedLimit = cfg.posted_limit ?? 'week';
    const BUCKETS: Record<PostedLimit, number> = {
      '1h': 3_600_000,
      '24h': 86_400_000,
      'week': 7 * 86_400_000,
      'month': 30 * 86_400_000,
    };
    const userBucketMs = BUCKETS[userBucket];
    let effectivePostedLimit: PostedLimit = userBucket;
    if (sinceIso) {
      const sinceMs = Date.now() - Date.parse(sinceIso);
      // Smallest bucket that covers the since gap, never exceeding the user cap.
      const candidates: PostedLimit[] = ['1h', '24h', 'week', 'month'];
      for (const b of candidates) {
        if (BUCKETS[b] >= sinceMs && BUCKETS[b] <= userBucketMs) {
          effectivePostedLimit = b;
          break;
        }
      }
      console.log(
        `[post-intent] effective postedLimit=${effectivePostedLimit} ` +
        `(user=${userBucket}, sinceIso=${sinceIso})`,
      );
    }

    const input: Record<string, unknown> = {
      searchQueries: [query],
      maxPosts: cfg.limit ?? 50,
      postedLimit: effectivePostedLimit,
      sortBy: 'date',          // freshest first — discovery wants latest signals
      profileScraperMode: 'Short ($4 per 1k)',
      scrapePages: 1,
    };
    if (cfg.author_industry_ids?.length) input.authorsIndustryId = cfg.author_industry_ids;
    if (cfg.authors_companies?.length) input.authorsCompanies = cfg.authors_companies;

    const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${apifyToken}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        console.error('[post-intent] kickoff failed', resp.status, await resp.text().catch(() => ''));
        return [];
      }
      const json = await resp.json();
      const data = (json?.data ?? json) as { id?: string; defaultDatasetId?: string };
      if (!data.id || !data.defaultDatasetId) return [];
      console.log(`[post-intent] kicked off run=${data.id} dataset=${data.defaultDatasetId} q="${query}"`);
      return [{
        run_id: data.id,
        dataset_id: data.defaultDatasetId,
        module_key: 'linkedin_post_intent',
        signal_type: 'linkedin_post_intent',
        source: 'linkedin_post_intent',
      }];
    } catch (err) {
      console.error('[post-intent] kickoff threw', err);
      return [];
    }
  },

  mapRecord(raw: Record<string, unknown>, ctx) {
    const r = raw as HarvestapiPostRow;
    const author = r.author;
    if (!author) return null;

    const first = (author.firstName ?? '').trim();
    const last = (author.lastName ?? '').trim();
    const full = (author.fullName ?? `${first} ${last}`).trim();
    const linkedinUrl = author.linkedinUrl
      ?? (author.publicIdentifier ? `https://www.linkedin.com/in/${author.publicIdentifier}` : undefined);

    if (!full || !linkedinUrl) return null;
    // Org pages have /company/ not /in/ — discovery wants individuals.
    if (linkedinUrl.includes('/company/')) return null;

    const postUrl = r.postUrl ?? r.url ?? '';
    const text = (r.text ?? r.textSnippet ?? '').trim();
    const snippet = text.length > 100 ? text.slice(0, 97) + '…' : text;

    return {
      // We have an author + their company affiliation from the headline +
      // the optional companyName field. Use companyName when present.
      company: {
        company_name: author.companyName?.trim() || full,  // fallback to person name when company unknown
        domain: null,
        website_url: null,
        linkedin_url: author.companyLinkedinUrl ?? null,
        country: author.country ?? null,
        source: 'linkedin' as const,
        raw_html_snippet: null,
      },
      person: {
        first,
        last,
        title: (author.headline ?? '').trim(),
        linkedin_url: linkedinUrl,
      },
      signal_metadata: {
        type: 'linkedin_post_intent',
        date: (r.postedDate ?? r.postedAt ?? new Date().toISOString()).slice(0, 10),
        detail: snippet ? `Posted: "${snippet}"` : 'Posted on LinkedIn matching topic',
        evidence_url: postUrl,
      },
      source: ctx.moduleKey,
      source_url: postUrl || linkedinUrl,
      raw_signal: raw,
    };
  },
};
