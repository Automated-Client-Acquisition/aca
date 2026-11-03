/**
 * Unipile Profile Monitor — pack module for `linkedin_post_engagement` (mode B).
 *
 * Watches a list of LinkedIn profiles (competitors / creators / customers /
 * your own) and yields every reactor + commenter on their recent posts.
 *
 * Why Unipile and not Apify here?
 *   The user already pays for a Unipile-connected LinkedIn account. Per-call
 *   cost = $0. Apify would charge ~$0.005/result, ie. $30 for an 8-profile
 *   weekly refresh. The data is identical (LinkedIn's public API surface)
 *   so paying twice makes no sense.
 *
 *   Apify mode (apify-post-engagement/) is kept around for users without a
 *   connected Unipile account and for one-off "specific posts" captures.
 *
 * Async safety: synchronous `run()` iterator. Bounded request budget per
 * tick (max ~150 HTTP calls = profiles × posts × ~2 endpoints + page list).
 * Typical 10 profiles × 5 posts × 2 endpoints = 110 calls, ~30s wall time.
 *
 * Endpoints used (all DSN-relative):
 *   GET /api/v1/users/{identifier}/posts?account_id=X&limit=N      list profile's posts
 *   GET /api/v1/posts/{social_id}/reactions?account_id=X&limit=N   reactors
 *   GET /api/v1/posts/{social_id}/comments?account_id=X&limit=N    commenters
 *
 * Caveat: LinkedIn applies per-account rate limits (~200-500 actions/day
 * depending on account age/seniority). Daily refresh of 10 profiles × 5
 * posts is fine; if we ever 429 we surface a console warning and stop the
 * tick — the next refresh resumes via cursor (TODO: persist cursor).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../../../apify-leads-utils.ts';
import { normalizeDsnUrl } from '../../../unipile-client.ts';
import type { PackModule, DiscoveryRecord, PackRunConfig } from '../types.ts';

interface ProfileMonitorConfig {
  /** unipile_accounts.id */
  account_id?: string;
  /** LinkedIn profile URLs or public_identifiers (slugs) of profiles to watch. */
  monitor_profile_urls?: string[];
  /** Posts per profile to scan. Capped at 20 to stay inside rate-limit budget. */
  max_posts_per_profile?: number;
  /** Engagers per post to capture. Capped at 100 (Unipile page max). */
  max_engagement_per_post?: number;
  /** Lookback window for posts. Anything older than this is skipped. */
  posts_lookback?: '24h' | 'week' | 'month';
  /** Which engagement types to capture. Defaults to both. */
  engagement_types?: Array<'reactions' | 'comments'>;
  /** Skip records we've already messaged within the last N days (same semantics as unipile_inbound). */
  exclude_if_outbound_within_days?: number;
}

interface UnipileAccountRow {
  id: string;
  unipile_account_id: string | null;
  access_token_encrypted: string;
  dsn_url: string | null;
  provider: string;
  status: string;
}

const POST_LIST_LIMIT = 50;
const ENGAGEMENT_PAGE_LIMIT = 100;       // Unipile per-page max
const MAX_ENGAGEMENT_PAGES_PER_POST = 5;  // 500 engagers/post — covers >99% of B2B posts
const HARD_REQUEST_BUDGET = 300;          // ~10 profiles × 5 posts × ~5 calls each, with headroom
const LOOKBACK_MS: Record<NonNullable<ProfileMonitorConfig['posts_lookback']>, number> = {
  '24h': 86_400_000,
  'week': 7 * 86_400_000,
  'month': 30 * 86_400_000,
};

/**
 * Extract the LinkedIn slug from a URL like https://www.linkedin.com/in/john-doe/
 * If the input is already a slug or provider id (e.g. "ACoAAB...") returns it as-is.
 */
function extractIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  // Already a provider id or slug
  if (!trimmed.includes('/') && !trimmed.includes('linkedin.com')) return trimmed;
  // URL — extract /in/<slug> or /company/<slug>
  const match = trimmed.match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i);
  return match?.[1] ?? trimmed;
}

function isCompanyUrl(input: string): boolean {
  return /linkedin\.com\/company\//i.test(input);
}

async function loadAccount(orgId: string, accountId: string): Promise<UnipileAccountRow | null> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data } = await supabase
    .from('unipile_accounts')
    .select('id, unipile_account_id, access_token_encrypted, dsn_url, provider, status')
    .eq('organization_id', orgId)
    .eq('id', accountId)
    .maybeSingle();
  return (data as UnipileAccountRow | null) ?? null;
}

/**
 * Same recency-filter helper as unipile-inbound — load LinkedIn URLs we've
 * messaged in the last N days so we can skip them in the yield loop.
 */
async function loadRecentOutboundLinkedinUrls(
  orgId: string,
  days: number,
): Promise<Set<string>> {
  if (days <= 0) return new Set();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabase
    .from('crm_messages')
    .select('crm_contacts!inner(primary_linkedin_url, organization_id)')
    .eq('direction', 'outbound')
    .gte('created_at', cutoff)
    .eq('crm_contacts.organization_id', orgId)
    .not('crm_contacts.primary_linkedin_url', 'is', null);
  const out = new Set<string>();
  type Row = { crm_contacts?: { primary_linkedin_url?: string | null } | null };
  for (const r of (data ?? []) as Row[]) {
    const u = r.crm_contacts?.primary_linkedin_url;
    if (u) out.add(normalizeLinkedinUrl(u));
  }
  return out;
}

function normalizeLinkedinUrl(url: string | null | undefined): string {
  if (!url) return '';
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^[a-z]{2}\.linkedin\.com/, 'linkedin.com')
    .replace(/^www\./, '')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '');
}

async function unipileGet<T>(
  url: string,
  apiKey: string,
): Promise<T | null> {
  try {
    const resp = await fetch(url, {
      headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`[unipile-profile-monitor] ${resp.status} on ${url}: ${body.slice(0, 200)}`);
      return null;
    }
    return await resp.json() as T;
  } catch (err) {
    console.warn(`[unipile-profile-monitor] fetch failed on ${url}`, err);
    return null;
  }
}

/**
 * Resolve a LinkedIn slug (or already-resolved provider id) to the canonical
 * provider_id (ACoAA... for users, numeric for companies). The /posts endpoint
 * is reliable with provider_ids; slugs work intermittently. This 1-call
 * lookup adds ~1 request per profile but bullet-proofs the rest of the flow.
 *
 * Mirrors the resolution pattern used in campaign-processor:resolveLinkedInIdentity.
 */
async function resolveProviderId(
  identifier: string,
  dsnUrl: string,
  apiKey: string,
  accountQuery: string,
): Promise<{ providerId: string; isCompany: boolean } | null> {
  // If it already looks like a provider_id (ACoAA... or all-numeric for company),
  // we can skip the lookup. ACoAA prefix is LinkedIn's stable user id format.
  if (/^[A-Z]{4}[A-Za-z0-9_-]{20,}$/.test(identifier)) {
    return { providerId: identifier, isCompany: false };
  }
  const url = `${dsnUrl}/api/v1/users/${encodeURIComponent(identifier)}?notify=false${accountQuery}`;
  const resp = await unipileGet<{
    provider_id?: string;
    public_identifier?: string;
    is_company?: boolean;
    object?: string;
  }>(url, apiKey);
  if (!resp?.provider_id) {
    console.warn(`[unipile-profile-monitor] could not resolve "${identifier}" to a provider_id`);
    return null;
  }
  return {
    providerId: resp.provider_id,
    isCompany: Boolean(resp.is_company),
  };
}

interface UnipilePostListResponse {
  items?: Array<{
    id?: string;
    social_id?: string;
    share_url?: string;
    text?: string;
    parsed_datetime?: string;
    date?: string;
    is_repost?: boolean;
    author?: { name?: string; public_identifier?: string };
  }>;
  cursor?: string | null;
}

interface UnipileReactionListResponse {
  items?: Array<{
    value?: string;  // LIKE / PRAISE / etc.
    author?: {
      id?: string;
      name?: string | null;
      headline?: string | null;
      profile_url?: string | null;
      profile_picture_url?: string | null;
      network_distance?: string;
      type?: 'INDIVIDUAL' | 'COMPANY';
    };
  }>;
  // Reactions endpoint nests cursor under `paging`
  paging?: { cursor?: string | null };
}

interface UnipileCommentListResponse {
  items?: Array<{
    id?: string;
    text?: string;
    date?: string;
    author?: string | null;  // display name
    author_details?: {
      id?: string | null;
      headline?: string | null;
      profile_url?: string | null;
      profile_picture_url?: string | null;
      network_distance?: string | null;
    };
  }>;
  // Comments endpoint exposes cursor at top level
  cursor?: string | null;
}

function splitName(full: string): { first: string; last: string } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function reactionToRecord(
  reaction: NonNullable<UnipileReactionListResponse['items']>[number],
  postSnippet: string,
  postUrl: string,
  profileUrl: string,
): DiscoveryRecord | null {
  const a = reaction.author;
  if (!a || a.type === 'COMPANY') return null;  // skip company reactors
  const name = (a.name ?? '').trim();
  if (!name) return null;
  const linkedinUrl = a.profile_url;
  if (!linkedinUrl) return null;
  const { first, last } = splitName(name);

  return {
    company: {
      company_name: name,
      domain: null,
      website_url: null,
      linkedin_url: null,
      country: null,
      source: 'linkedin' as const,
      raw_html_snippet: null,
    },
    person: {
      first,
      last,
      title: a.headline ?? '',
      linkedin_url: linkedinUrl,
    },
    signal_metadata: {
      type: 'linkedin_post_engagement',
      date: new Date().toISOString().slice(0, 10),
      detail: `Reacted to "${postSnippet.slice(0, 80)}"`,
      // evidence_url points to the POST, not the engager — so clicking
      // takes the user to the source they engaged with.
      evidence_url: postUrl || linkedinUrl,
    },
    source: 'unipile_profile_monitor',
    source_url: linkedinUrl,
    raw_signal: {
      signalType: 'linkedin_post_engagement',
      engagement_kind: 'reaction',
      reaction_type: reaction.value,
      monitored_profile: profileUrl,
      post_url: postUrl,
      post_snippet: postSnippet,
      engager_linkedin_url: linkedinUrl,
      engager_headline: a.headline ?? '',
    } as Record<string, unknown>,
  };
}

function commentToRecord(
  comment: NonNullable<UnipileCommentListResponse['items']>[number],
  postSnippet: string,
  postUrl: string,
  profileUrl: string,
): DiscoveryRecord | null {
  const fullName = typeof comment.author === 'string' ? comment.author.trim() : '';
  if (!fullName) return null;
  const linkedinUrl = comment.author_details?.profile_url;
  if (!linkedinUrl) return null;
  const { first, last } = splitName(fullName);

  return {
    company: {
      company_name: fullName,
      domain: null,
      website_url: null,
      linkedin_url: null,
      country: null,
      source: 'linkedin' as const,
      raw_html_snippet: null,
    },
    person: {
      first,
      last,
      title: comment.author_details?.headline ?? '',
      linkedin_url: linkedinUrl,
    },
    signal_metadata: {
      type: 'linkedin_post_engagement',
      date: new Date().toISOString().slice(0, 10),
      detail: `Commented "${(comment.text ?? '').slice(0, 60)}" on "${postSnippet.slice(0, 60)}"`,
      // evidence_url points to the POST, not the engager.
      evidence_url: postUrl || linkedinUrl,
    },
    source: 'unipile_profile_monitor',
    source_url: linkedinUrl,
    raw_signal: {
      signalType: 'linkedin_post_engagement',
      engagement_kind: 'comment',
      comment_text: comment.text,
      monitored_profile: profileUrl,
      post_url: postUrl,
      post_snippet: postSnippet,
      engager_linkedin_url: linkedinUrl,
      engager_headline: comment.author_details?.headline ?? '',
    } as Record<string, unknown>,
  };
}

export const unipileProfileMonitorModule: PackModule = {
  key: 'unipile_profile_monitor',
  pack: 'linkedin_post_engagement',
  tier: 'signal',
  label: 'Profile Monitor (Unipile)',

  async *run(config: PackRunConfig): AsyncIterable<DiscoveryRecord> {
    const cfg = (config.filters ?? {}) as ProfileMonitorConfig;
    const profileUrls = cfg.monitor_profile_urls ?? [];
    if (!cfg.account_id) {
      console.warn('[unipile-profile-monitor] no account_id in config — skipping');
      return;
    }
    if (profileUrls.length === 0) {
      console.warn('[unipile-profile-monitor] no profiles to monitor — skipping');
      return;
    }

    const account = await loadAccount(config.organizationId, cfg.account_id);
    if (!account) {
      console.warn('[unipile-profile-monitor] account not found', cfg.account_id);
      return;
    }
    // 'active' is the canonical status set by the connect flow (matches what
    // campaign-processor and other consumers filter on). Earlier 'OK'/'connected'
    // were artifacts of the original Unipile API payload — kept as aliases so
    // older accounts that never got migrated still work.
    const goodStatuses = new Set(['active', 'OK', 'connected']);
    if (!goodStatuses.has(account.status)) {
      console.warn(`[unipile-profile-monitor] account ${cfg.account_id} status=${account.status} — skipping`);
      return;
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      console.error('[unipile-profile-monitor] ENCRYPTION_KEY not set');
      return;
    }
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const accountQuery = account.unipile_account_id
      ? `&account_id=${encodeURIComponent(account.unipile_account_id)}`
      : '';

    const maxPosts = Math.max(1, Math.min(20, cfg.max_posts_per_profile ?? 5));
    // Cadence-aware cutoff: use whichever window is TIGHTER between
    //   - cfg.posts_lookback (user's static cap, e.g. "week")
    //   - sinceIso (when this signal was last refreshed; reflects refresh
    //     cadence — daily ≈ 24h, weekly ≈ 7 days, etc.)
    // Effect:
    //   - First refresh (no sinceIso): scan posts_lookback window (full backfill)
    //   - Subsequent daily refreshes: scan ~24h, skipping posts already
    //     scanned yesterday — Unipile API budget shrinks 7× on daily cadence
    //     with weekly lookback
    //   - Weekly refreshes with monthly lookback: scan ~7 days, etc.
    // posts_lookback acts as the maximum reach (you never scan further back
    // than what the user configured), sinceIso acts as the freshness floor.
    const lookbackMs = LOOKBACK_MS[cfg.posts_lookback ?? 'week'];
    const lookbackCutoffTs = Date.now() - lookbackMs;
    const sinceCutoffTs = config.sinceIso ? Date.parse(config.sinceIso) : 0;
    const cutoffTs = Number.isFinite(sinceCutoffTs) && sinceCutoffTs > lookbackCutoffTs
      ? sinceCutoffTs
      : lookbackCutoffTs;
    if (config.sinceIso) {
      const days = Math.round((Date.now() - cutoffTs) / 86_400_000);
      console.log(
        `[unipile-profile-monitor] effective lookback ~${days}d ` +
        `(posts_lookback=${cfg.posts_lookback ?? 'week'}, sinceIso=${config.sinceIso})`,
      );
    }
    const types = cfg.engagement_types ?? ['reactions', 'comments'];
    const wantReactions = types.includes('reactions');
    const wantComments = types.includes('comments');

    const excludeDays = Math.max(0, cfg.exclude_if_outbound_within_days ?? 0);
    const excludedUrls = excludeDays > 0
      ? await loadRecentOutboundLinkedinUrls(config.organizationId, excludeDays)
      : new Set<string>();
    if (excludedUrls.size > 0) {
      console.log(
        `[unipile-profile-monitor] excluding ${excludedUrls.size} recently-DM'd contacts (within ${excludeDays}d)`,
      );
    }

    let requestsUsed = 0;
    const yielded = new Set<string>();  // dedup by normalized linkedin_url within this tick

    for (const profileUrlOrSlug of profileUrls) {
      if (config.signal?.aborted) return;
      if (requestsUsed >= HARD_REQUEST_BUDGET) {
        console.warn(
          `[unipile-profile-monitor] hit ${HARD_REQUEST_BUDGET}-request budget; stopping. ` +
          `Profiles remaining: ${profileUrls.length - profileUrls.indexOf(profileUrlOrSlug)}`,
        );
        return;
      }

      const slug = extractIdentifier(profileUrlOrSlug);
      if (!slug) {
        console.warn(`[unipile-profile-monitor] could not extract identifier from "${profileUrlOrSlug}"`);
        continue;
      }
      const isCompanyHint = isCompanyUrl(profileUrlOrSlug);

      // 1a. Resolve slug → provider_id. Slugs sometimes work directly on /posts,
      //     but the resolved provider_id is reliable across edge cases (locale
      //     subdomains, vanity URLs, recently-renamed profiles).
      const resolved = await resolveProviderId(slug, dsnUrl, apiKey, accountQuery);
      requestsUsed++;
      if (!resolved) continue;
      const { providerId, isCompany: isCompanyFromApi } = resolved;
      const isCompany = isCompanyFromApi || isCompanyHint;

      // 1b. List the profile's posts using the canonical provider_id.
      const postsUrl =
        `${dsnUrl}/api/v1/users/${encodeURIComponent(providerId)}/posts` +
        `?limit=${POST_LIST_LIMIT}${accountQuery}` +
        (isCompany ? '&is_company=true' : '');
      const postsResp = await unipileGet<UnipilePostListResponse>(postsUrl, apiKey);
      requestsUsed++;
      if (!postsResp?.items?.length) continue;

      const fresh = postsResp.items
        .filter((p) => {
          if (p.is_repost) return false;  // skip reposts — engagers belong to original post
          const ts = Date.parse(p.parsed_datetime ?? p.date ?? '');
          if (!Number.isFinite(ts)) return true;  // be permissive on missing timestamp
          return ts >= cutoffTs;
        })
        .slice(0, maxPosts);

      for (const post of fresh) {
        if (config.signal?.aborted) return;
        if (requestsUsed >= HARD_REQUEST_BUDGET) return;

        const postSocialId = post.social_id ?? post.id;
        if (!postSocialId) continue;
        const postSnippet = (post.text ?? '').replace(/\s+/g, ' ').trim();
        const postUrl = post.share_url ?? '';

        // 2. Reactions — paginate up to MAX_ENGAGEMENT_PAGES_PER_POST.
        if (wantReactions) {
          let cursor: string | null | undefined = null;
          for (let page = 0; page < MAX_ENGAGEMENT_PAGES_PER_POST; page++) {
            if (config.signal?.aborted) return;
            if (requestsUsed >= HARD_REQUEST_BUDGET) break;
            // Annotated to break the inference cycle: the URL reads `cursor`,
            // `cursor` is assigned from the response, and the response is
            // fetched using the URL.
            const rurl: string =
              `${dsnUrl}/api/v1/posts/${encodeURIComponent(postSocialId)}/reactions` +
              `?limit=${ENGAGEMENT_PAGE_LIMIT}${accountQuery}` +
              (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
            const rresp: UnipileReactionListResponse | null = await unipileGet<UnipileReactionListResponse>(rurl, apiKey);
            requestsUsed++;
            const items = rresp?.items ?? [];
            for (const r of items) {
              const rec = reactionToRecord(r, postSnippet, postUrl, profileUrlOrSlug);
              // person is optional on DiscoveryRecord; a reaction without one
              // would throw here rather than being skipped.
              if (!rec?.person) continue;
              const norm = normalizeLinkedinUrl(rec.person.linkedin_url);
              if (!norm || yielded.has(norm)) continue;
              if (excludedUrls.has(norm)) continue;
              yielded.add(norm);
              yield rec;
            }
            cursor = rresp?.paging?.cursor ?? null;
            if (!cursor || items.length < ENGAGEMENT_PAGE_LIMIT) break;
          }
        }

        // 3. Comments — paginate up to MAX_ENGAGEMENT_PAGES_PER_POST.
        if (wantComments) {
          if (config.signal?.aborted) return;
          if (requestsUsed >= HARD_REQUEST_BUDGET) continue;
          let cursor: string | null | undefined = null;
          for (let page = 0; page < MAX_ENGAGEMENT_PAGES_PER_POST; page++) {
            if (config.signal?.aborted) return;
            if (requestsUsed >= HARD_REQUEST_BUDGET) break;
            // Same inference cycle as the reactions loop above.
            const curl: string =
              `${dsnUrl}/api/v1/posts/${encodeURIComponent(postSocialId)}/comments` +
              `?limit=${ENGAGEMENT_PAGE_LIMIT}${accountQuery}` +
              (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
            const cresp: UnipileCommentListResponse | null = await unipileGet<UnipileCommentListResponse>(curl, apiKey);
            requestsUsed++;
            const items = cresp?.items ?? [];
            for (const c of items) {
              const rec = commentToRecord(c, postSnippet, postUrl, profileUrlOrSlug);
              if (!rec?.person) continue;
              const norm = normalizeLinkedinUrl(rec.person.linkedin_url);
              if (!norm || yielded.has(norm)) continue;
              if (excludedUrls.has(norm)) continue;
              yielded.add(norm);
              yield rec;
            }
            cursor = cresp?.cursor ?? null;
            if (!cursor || items.length < ENGAGEMENT_PAGE_LIMIT) break;
          }
        }
      }
    }

    console.log(
      `[unipile-profile-monitor] tick complete: ${requestsUsed} HTTP calls, ${yielded.size} unique engagers`,
    );
  },
};
