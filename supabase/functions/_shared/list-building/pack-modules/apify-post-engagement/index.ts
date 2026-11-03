/**
 * LinkedIn Post Engagement pack module — pack_key `linkedin_post_engagement`.
 *
 * Pulls everyone who reacted to (or commented on) one or more target
 * LinkedIn posts. Use cases:
 *   - "Who liked our launch post?" → content-warmed inbound leads
 *   - "Who reacted to a competitor's product announcement?" → defection signals
 *
 * Backed by harvestapi actors:
 *   - harvestapi/linkedin-post-reactions  (S6mgSO5lezSZKi0zN)
 *   - harvestapi/linkedin-post-comments   (ZI6ykbLlGS3APaPE8)
 *
 * Async pattern (mirrors signalbase): kickoff() POSTs to the actor,
 * returns AsyncRunHandle immediately. apify-poller resumes when Apify
 * marks the run SUCCEEDED, calls mapRecord() on each dataset item.
 *
 * Cost: ~$0.005-0.010 per result. A 200-reactor post ≈ $1-2.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../../../apify-leads-utils.ts';
import type { PackModule, AsyncRunHandle, DiscoveryRecord, PackRunConfig } from '../types.ts';

const REACTIONS_ACTOR = 'harvestapi~linkedin-post-reactions';
const COMMENTS_ACTOR = 'harvestapi~linkedin-post-comments';
const PROFILE_POSTS_ACTOR = 'harvestapi~linkedin-profile-posts';

interface PostEngagementConfig {
  /** Mode A — specific post URLs to scrape commenters/reactors from. */
  post_urls?: string[];
  /**
   * Mode B — competitor / thought-leader profile URLs to MONITOR. We pull
   * their recent posts via harvestapi/linkedin-profile-posts (one actor
   * call covers posts + reactions + comments per post). Each refresh
   * checks for new posts since `posts_lookback`.
   */
  monitor_profile_urls?: string[];
  /** Which engagement types to pull (Mode A only). Default: both. */
  engagement_types?: Array<'reactions' | 'comments'>;
  /** Hard cap per actor run. Default 100. Tune to control cost. */
  limit?: number;
  /** Mode A — comment-side lookback. '24h' | 'week' | 'month'. */
  comments_lookback?: '24h' | 'week' | 'month';
  /** Mode B — how recent the monitored profile's posts must be. Default 'week'. */
  posts_lookback?: '24h' | 'week' | 'month';
  /** Mode B — max posts per profile to scrape engagement from. Default 5. */
  max_posts_per_profile?: number;
  /** Mode B — max reactions/comments per post. Default 50. */
  max_engagement_per_post?: number;
}

interface HarvestapiPersonRow {
  // Reaction-side payload (one row per reactor)
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string | null;
  position?: string | null;
  linkedinUrl?: string;
  publicIdentifier?: string;
  reactionType?: string;       // 'LIKE' | 'CELEBRATE' | 'SUPPORT' | etc.
  // Comment-side payload (one row per comment)
  commentText?: string;
  commentDate?: string;
  author?: {
    firstName?: string;
    lastName?: string;
    headline?: string;
    linkedinUrl?: string;
  };
  // Both
  postUrl?: string;
  // Catch-all so we don't lose data we haven't enumerated
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

async function kickoffActor(
  actorId: string,
  apifyToken: string,
  input: Record<string, unknown>,
): Promise<{ run_id: string; dataset_id: string } | null> {
  const url = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.error(`[post-engagement] kickoff ${actorId} failed`, resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const json = await resp.json();
    const data = (json?.data ?? json) as { id?: string; defaultDatasetId?: string };
    if (!data.id || !data.defaultDatasetId) return null;
    return { run_id: data.id, dataset_id: data.defaultDatasetId };
  } catch (err) {
    console.error(`[post-engagement] kickoff ${actorId} threw`, err);
    return null;
  }
}

function buildModule(opts: {
  source: 'reactions' | 'comments';
  actorId: string;
  moduleKey: string;
  label: string;
}): PackModule {
  return {
    key: opts.moduleKey,
    pack: 'linkedin_post_engagement',
    tier: 'signal',
    label: opts.label,

    // Sync fallback — never used because we always have kickoff(). The
    // PackModule contract requires it for type safety.
    async *run(_config: PackRunConfig): AsyncIterable<DiscoveryRecord> {
      // No-op. Async path is the only supported flow.
    },

    async kickoff({ organizationId, filters }: PackRunConfig): Promise<AsyncRunHandle[]> {
      const cfg = filters as PostEngagementConfig;
      const posts = (cfg.post_urls ?? []).filter((u) => typeof u === 'string' && u.trim());
      if (posts.length === 0) return [];

      // Skip this module if it's not enabled in the user's selected types.
      const enabled = cfg.engagement_types ?? ['reactions', 'comments'];
      if (!enabled.includes(opts.source)) return [];

      const apifyToken = await getApifyToken(organizationId);
      if (!apifyToken) {
        console.warn('[post-engagement] no Apify key for org', organizationId);
        return [];
      }

      const baseInput: Record<string, unknown> = {
        posts,
        maxItems: cfg.limit ?? 100,
        // Short mode = name + headline + linkedinUrl, the cheapest profile depth.
        // Sufficient for the discovery layer — full enrichment happens later
        // via dm-scraper / harvestapi-linkedin-profile-scraper if needed.
        profileScraperMode: 'Short ($4 per 1k)',
      };
      if (opts.source === 'comments') {
        baseInput.postedLimit = cfg.comments_lookback ?? 'month';
        baseInput.scrapeReplies = false;
      }

      const handle = await kickoffActor(opts.actorId, apifyToken, baseInput);
      if (!handle) return [];

      console.log(`[${opts.moduleKey}] kicked off run=${handle.run_id} dataset=${handle.dataset_id} for ${posts.length} post(s)`);
      return [{
        run_id: handle.run_id,
        dataset_id: handle.dataset_id,
        module_key: opts.moduleKey,
        signal_type: 'linkedin_post_engagement',
        source: opts.moduleKey,
      }];
    },

    mapRecord(raw: Record<string, unknown>, ctx) {
      const r = raw as HarvestapiPersonRow;

      // Reactions actor: top-level person fields. Comments actor: nests
      // person under `author`.
      const person = (r.author && typeof r.author === 'object')
        ? (r.author as HarvestapiPersonRow)
        : r;

      const first = (person.firstName ?? '').trim();
      const last = (person.lastName ?? '').trim();
      const full = (person.fullName ?? `${first} ${last}`).trim();
      const linkedinUrl = person.linkedinUrl
        ?? (person.publicIdentifier ? `https://www.linkedin.com/in/${person.publicIdentifier}` : undefined);

      // Person posts have a profile URL; org pages don't. Filter org-page
      // engagement out — we want individual prospects, not corporate accounts.
      if (!linkedinUrl) return null;
      if (!full) return null;
      if (linkedinUrl.includes('/company/')) return null;

      const title = (person.headline ?? person.position ?? '').trim();
      const postUrl = (r.postUrl as string | undefined) ?? '';
      const engagementVerb = opts.source === 'reactions'
        ? `Reacted${r.reactionType ? ` (${(r.reactionType as string).toLowerCase()})` : ''}`
        : `Commented`;

      // We don't have company info in the engagement payload — title often
      // contains it ("Head of Sales at Acme") but parsing that's unreliable.
      // Leave company_name as the LinkedIn page name placeholder; downstream
      // dm-scraper / enrichment fills in the company on first contact.
      return {
        company: {
          company_name: full,  // person-level signal — using their name as the company placeholder
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
          title,
          linkedin_url: linkedinUrl,
        },
        signal_metadata: {
          type: 'linkedin_post_engagement',
          date: new Date().toISOString().slice(0, 10),
          detail: postUrl
            ? `${engagementVerb} a LinkedIn post`
            : `${engagementVerb} on LinkedIn`,
          evidence_url: postUrl,
        },
        source: ctx.moduleKey,
        source_url: postUrl || linkedinUrl,
        raw_signal: raw,
      };
    },
  };
}

export const linkedinPostReactionsModule = buildModule({
  source: 'reactions',
  actorId: REACTIONS_ACTOR,
  moduleKey: 'linkedin_post_reactions',
  label: 'LinkedIn Post Reactions',
});

export const linkedinPostCommentsModule = buildModule({
  source: 'comments',
  actorId: COMMENTS_ACTOR,
  moduleKey: 'linkedin_post_comments',
  label: 'LinkedIn Post Comments',
});

// ============================================================================
// Mode B — Profile Monitor.
//
// Single-actor flow: harvestapi/linkedin-profile-posts with scrapeReactions=
// true and scrapeComments=true. The actor pulls each profile's recent posts
// AND the reactors/commenters per post in one async run. We get one dataset
// item per (post, engager) tuple, which mapRecord turns into a DiscoveryRecord.
//
// Use case: continuously monitor 1-N competitor / thought-leader LinkedIn
// profiles. Every refresh tick scans posts published since `posts_lookback`,
// surfacing whoever engaged.
// ============================================================================

interface ProfilePostRow {
  // Top-level post fields
  postUrl?: string;
  url?: string;
  text?: string;
  textSnippet?: string;
  postedDate?: string;
  postedAt?: string;
  reactionsCount?: number;
  commentsCount?: number;
  // The post's author (the monitored profile)
  author?: {
    firstName?: string;
    lastName?: string;
    fullName?: string;
    linkedinUrl?: string;
  };
  // Per-engager records — when scrapeReactions=true, each reactor is its own
  // row at the dataset level (postNestedReactions=false). Same for comments.
  // The engager's profile is at the top level.
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  position?: string;
  linkedinUrl?: string;
  publicIdentifier?: string;
  reactionType?: string;
  commentText?: string;
  // Indicates the row's role within the dataset
  itemType?: 'post' | 'reaction' | 'comment';
  [key: string]: unknown;
}

export const linkedinPostProfileMonitorModule: PackModule = {
  key: 'linkedin_post_profile_monitor',
  pack: 'linkedin_post_engagement',
  tier: 'signal',
  label: 'LinkedIn Profile Monitor',

  async *run(_config: PackRunConfig): AsyncIterable<DiscoveryRecord> {
    // Async-only.
  },

  async kickoff({ organizationId, filters }: PackRunConfig): Promise<AsyncRunHandle[]> {
    const cfg = filters as PostEngagementConfig;
    const profiles = (cfg.monitor_profile_urls ?? []).filter((u) => typeof u === 'string' && u.trim());
    if (profiles.length === 0) return [];

    const apifyToken = await getApifyToken(organizationId);
    if (!apifyToken) {
      console.warn('[profile-monitor] no Apify key for org', organizationId);
      return [];
    }

    const input: Record<string, unknown> = {
      targetUrls: profiles,
      maxPosts: cfg.max_posts_per_profile ?? 5,
      postedLimit: cfg.posts_lookback ?? 'week',
      // Pull engagement INLINE — saves a chained actor call.
      scrapeReactions: true,
      scrapeComments: true,
      maxReactions: cfg.max_engagement_per_post ?? 50,
      maxComments: cfg.max_engagement_per_post ?? 50,
      // Emit each engager as its own dataset item (vs nesting inside posts).
      // Easier for mapRecord to flatten without per-item array iteration.
      postNestedReactions: false,
      postNestedComments: false,
      // Skip actual reposts/quote posts — they distort engagement signal.
      includeQuotePosts: false,
      includeReposts: false,
      profileScraperMode: 'Short ($4 per 1k)',
      reactionsProfileScraperMode: 'Short ($4 per 1k)',
      commentsProfileScraperMode: 'Short ($4 per 1k)',
    };

    const url = `https://api.apify.com/v2/acts/${PROFILE_POSTS_ACTOR}/runs?token=${apifyToken}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) {
        console.error('[profile-monitor] kickoff failed', resp.status, await resp.text().catch(() => ''));
        return [];
      }
      const json = await resp.json();
      const data = (json?.data ?? json) as { id?: string; defaultDatasetId?: string };
      if (!data.id || !data.defaultDatasetId) return [];
      console.log(`[profile-monitor] kicked off run=${data.id} for ${profiles.length} profile(s)`);
      return [{
        run_id: data.id,
        dataset_id: data.defaultDatasetId,
        module_key: 'linkedin_post_profile_monitor',
        signal_type: 'linkedin_post_engagement',
        source: 'linkedin_post_profile_monitor',
      }];
    } catch (err) {
      console.error('[profile-monitor] kickoff threw', err);
      return [];
    }
  },

  mapRecord(raw: Record<string, unknown>, ctx) {
    const r = raw as ProfilePostRow;

    // Skip "post" items — those are the monitored profile's posts (the post
    // author is the COMPETITOR, not a prospect). We only want reaction +
    // comment items where the engager is a third party.
    if (r.itemType === 'post') return null;

    // Engager's profile fields are at top level.
    const first = (r.firstName ?? '').trim();
    const last = (r.lastName ?? '').trim();
    const full = (r.fullName ?? `${first} ${last}`).trim();
    const linkedinUrl = r.linkedinUrl
      ?? (r.publicIdentifier ? `https://www.linkedin.com/in/${r.publicIdentifier}` : undefined);

    if (!full || !linkedinUrl) return null;
    // Filter out the post author itself (engaged-with-own-post — not a prospect).
    if (r.author?.linkedinUrl && linkedinUrl === r.author.linkedinUrl) return null;
    // Filter org pages (we want individuals, not corporate accounts).
    if (linkedinUrl.includes('/company/')) return null;

    const title = (r.headline ?? r.position ?? '').trim();
    const postUrl = r.postUrl ?? r.url ?? '';
    const postSnippet = (r.text ?? r.textSnippet ?? '').slice(0, 80);
    const verb = r.itemType === 'reaction'
      ? `Reacted${r.reactionType ? ` (${(r.reactionType as string).toLowerCase()})` : ''}`
      : 'Commented on';
    const authorName = r.author?.fullName ?? r.author?.firstName ?? 'a profile we monitor';

    return {
      company: {
        company_name: full,
        domain: null,
        website_url: null,
        linkedin_url: null,
        country: null,
        source: 'linkedin' as const,
        raw_html_snippet: null,
      },
      person: { first, last, title, linkedin_url: linkedinUrl },
      signal_metadata: {
        type: 'linkedin_post_engagement',
        date: (r.postedDate ?? r.postedAt ?? new Date().toISOString()).slice(0, 10),
        detail: postSnippet
          ? `${verb} ${authorName}'s post: "${postSnippet}${postSnippet.length === 80 ? '…' : ''}"`
          : `${verb} ${authorName}'s post`,
        evidence_url: postUrl,
      },
      source: ctx.moduleKey,
      source_url: postUrl || linkedinUrl,
      raw_signal: raw,
    };
  },
};
