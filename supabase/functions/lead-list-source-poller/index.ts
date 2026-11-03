import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDsnUrl, isDisconnectedAccountError } from '../_shared/unipile-client.ts';
import { extractPostInfo, resolveSocialId, type UnipileAccountRef } from '../_shared/linkedin-engagement/post-resolver.ts';
import {
  fetchReactionsPage,
  fetchCommentsPage,
  matchesReactionFilter,
  extractReactionAuthor,
  extractCommentAuthor,
} from '../_shared/linkedin-engagement/engagement-fetcher.ts';
import { processUser, decryptApiKey } from '../_shared/linkedin-engagement/process-user.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG_PREFIX = '[Lead List Source Poller]';

// How many due sources one cron tick will process at most.
const POLL_BATCH_SIZE = 20;
// Claim lock TTL — must exceed the worst-case single-source poll duration.
const CLAIM_LOCK_SECONDS = 600;
// Stop starting new sources after this much wall-clock time; the rest stay due.
const WALL_CLOCK_MS = 50000;
// Per-post drain budget: a heavier post yields and continues on the next tick.
const POST_POLL_BUDGET_MS = 35000;
// Engagement paging caps per poll (re-page from start; dedup absorbs overlap).
const PAGE_LIMIT = 50;
const MAX_PAGES_PER_ENDPOINT = 20;
// Creator sources: how deep to walk a profile's post history, and how many
// child post-watches to spawn per poll (full-history backfill).
const MAX_POST_PAGES_PER_CREATOR = 8;
const CREATOR_POSTS_PAGE_SIZE = 50;
const MAX_CHILD_SPAWNS = 80;
// State size caps.
const PROCESSED_IDS_CAP = 5000;
const KNOWN_POST_IDS_CAP = 1000;
// Consecutive failures before a source is parked as status='error'.
const MAX_STRIKES = 5;
// Empty polls before the effective interval starts doubling, and its ceiling.
const BACKOFF_AFTER_EMPTY_POLLS = 3;
const MAX_INTERVAL_MINUTES = 1440;
// Creator watchers never back off on empty polls (a quiet day doesn't mean the
// creator stopped posting) and are capped at a steady cadence so a same-day post
// is picked up within one interval instead of up to 24h later.
const CREATOR_MAX_INTERVAL_MINUTES = 360;

// deno-lint-ignore no-explicit-any
type Supabase = any;

interface PollResult {
  imported: number;
  spawned: number;
  newState: Record<string, unknown>;
  emptyPoll: boolean;
  rateLimited: boolean;
  // True when Unipile reports the account is logged out / disconnected
  // (401 / `errors/disconnected_account`). The caller flips the account status
  // and parks the source with a visible error instead of recording "no leads".
  disconnected?: boolean;
  // True when the source has more to pull and should be re-polled almost
  // immediately instead of waiting the normal interval.
  continueSoon?: boolean;
}

interface SourceRow {
  id: string;
  organization_id: string;
  list_id: string;
  parent_source_id: string | null;
  source_type: 'linkedin_post' | 'linkedin_creator';
  source_url: string;
  source_key: string;
  account_id: string | null;
  config: Record<string, unknown>;
  state: Record<string, unknown>;
  status: string;
  consecutive_errors: number;
  poll_interval_minutes: number;
  expires_at: string | null;
  total_imported: number;
}

interface AccountRow {
  id: string;
  organization_id: string;
  unipile_account_id: string;
  access_token_encrypted: string;
  dsn_url: string;
  provider: string;
  status: string;
}

/**
 * Lead List Source Poller
 *
 * Cron-invoked (see migration 20260710100100). Walks due lead_list_sources:
 *  - linkedin_post: count-delta check, then re-pages reactions/comments and
 *    appends new engagers to the list via the shared processUser path.
 *  - linkedin_creator: lists the profile's recent posts and spawns child
 *    linkedin_post sources for new ones, so all engagement fetching shares
 *    one code path.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const startTime = Date.now();
  const tally = { polled: 0, imported: 0, spawned: 0, skippedLocked: 0, skippedRateLimited: 0, errored: 0, disconnected: 0, expired: 0 };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Expire post sources whose watch window has passed.
    const { data: expiredRows } = await supabase
      .from('lead_list_sources')
      .update({ status: 'expired' })
      .in('status', ['active', 'paused'])
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString())
      .select('id');
    tally.expired = expiredRows?.length || 0;

    // Pick up due sources, oldest first.
    const { data: candidates, error: fetchError } = await supabase
      .from('lead_list_sources')
      .select('id, organization_id, list_id, parent_source_id, source_type, source_url, source_key, account_id, config, state, status, consecutive_errors, poll_interval_minutes, expires_at, total_imported')
      .eq('status', 'active')
      .lte('next_poll_at', new Date().toISOString())
      .order('next_poll_at', { ascending: true })
      .limit(POLL_BATCH_SIZE * 2);

    if (fetchError) throw new Error(`Failed to fetch due sources: ${fetchError.message}`);

    const sources = (candidates || []) as SourceRow[];
    const accountCache = new Map<string, AccountRow | null>();
    // Accounts that returned a LinkedIn 429 this tick — skip their other sources
    // for the rest of the run so we don't keep hammering a throttled account.
    const rateLimitedAccounts = new Set<string>();
    let started = 0;

    for (const source of sources) {
      if (started >= POLL_BATCH_SIZE) break;
      if (Date.now() - startTime > WALL_CLOCK_MS) {
        console.log(`${LOG_PREFIX} Wall clock guard hit, leaving remaining sources for next tick`);
        break;
      }
      started++;

      const { data: claimedId } = await supabase.rpc('claim_lead_list_source', {
        p_source_id: source.id,
        p_lock_seconds: CLAIM_LOCK_SECONDS,
      });
      if (!claimedId) {
        tally.skippedLocked++;
        continue;
      }

      try {
        // --- Resolve a usable LinkedIn account -----------------------------
        const account = await resolveAccount(supabase, source, accountCache);
        if (!account) {
          await recordSourceError(supabase, source, 'No active LinkedIn account available');
          tally.errored++;
          continue;
        }

        // Skip if this account already got throttled earlier in the tick
        if (rateLimitedAccounts.has(account.id)) {
          await deferSource(supabase, source, 60);
          tally.skippedRateLimited++;
          continue;
        }

        const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
        const accountRef: UnipileAccountRef = {
          unipileAccountId: account.unipile_account_id,
          dsnUrl: normalizeDsnUrl(account.dsn_url),
          apiKey,
        };

        // --- Poll ------------------------------------------------------------
        let result: PollResult;
        if (source.source_type === 'linkedin_post') {
          result = await pollPostSource(supabase, source, accountRef);
        } else {
          result = await pollCreatorSource(supabase, source, accountRef);
        }

        if (result.disconnected) {
          // Unipile says the account is logged out / disconnected. The DB flag
          // may still read 'active' (it lags), so flip it here — that's ground
          // truth and it surfaces on /senders. Park the source with a visible
          // error so a dead account no longer looks like a healthy, quiet
          // watcher, and skip this account's other sources for the rest of the
          // tick. It self-heals: the next successful poll clears error_message.
          rateLimitedAccounts.add(account.id);
          account.status = 'disconnected';
          await markAccountDisconnected(supabase, account.id);
          await parkSourceDisconnected(supabase, source, 60);
          tally.disconnected++;
          continue;
        }

        if (result.rateLimited) {
          // LinkedIn throttled this account — back off its sources this tick.
          rateLimitedAccounts.add(account.id);
          await deferSource(supabase, source, 60);
          tally.skippedRateLimited++;
          continue;
        }

        tally.polled++;
        tally.imported += result.imported;
        tally.spawned += result.spawned;

        const previousEmpty = (source.state.empty_polls as number) || 0;
        const emptyPolls = result.emptyPoll ? previousEmpty + 1 : 0;
        const now = new Date();
        // A source with more to pull (heavy post mid-drain, or a creator that hit
        // the per-poll spawn cap) is re-queued almost immediately so the backfill
        // keeps moving; otherwise use the source-type cadence below.
        const nextPollAt = result.continueSoon
          ? new Date(now.getTime() + 60_000)
          : new Date(now.getTime() + nextIntervalMinutes(source, emptyPolls) * 60000);

        await supabase
          .from('lead_list_sources')
          .update({
            state: {
              ...result.newState,
              empty_polls: emptyPolls,
              last_account_id: account.id,
            },
            status: 'active',
            error_message: null,
            consecutive_errors: 0,
            last_polled_at: now.toISOString(),
            ...(result.imported > 0 ? { last_new_leads_at: now.toISOString() } : {}),
            total_imported: source.total_imported + result.imported,
            next_poll_at: nextPollAt.toISOString(),
          })
          .eq('id', source.id);

      } catch (err) {
        console.error(`${LOG_PREFIX} Error polling source ${source.id}:`, err);
        await recordSourceError(supabase, source, err instanceof Error ? err.message : 'Unknown error');
        tally.errored++;
      } finally {
        await supabase.rpc('release_lead_list_source', { p_source_id: source.id });
      }
    }

    console.log(`${LOG_PREFIX} Tick done:`, JSON.stringify(tally));
    return new Response(JSON.stringify({ success: true, ...tally }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`${LOG_PREFIX} Fatal error:`, error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      ...tally,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Empty polls back the interval off: base until BACKOFF_AFTER_EMPTY_POLLS,
 * then doubling per extra empty poll, capped at MAX_INTERVAL_MINUTES.
 * Derived from the counter so the user-configured base is never mutated.
 */
function effectiveInterval(baseMinutes: number, emptyPolls: number): number {
  const doublings = Math.max(0, emptyPolls - (BACKOFF_AFTER_EMPTY_POLLS - 1));
  return Math.min(baseMinutes * Math.pow(2, doublings), MAX_INTERVAL_MINUTES);
}

/**
 * Next poll cadence by source type. Post watchers back off as they go quiet
 * (a post stops drawing engagement). Creator watchers must NOT — a creator with
 * no new post today is still likely to post tomorrow, and backing off means a
 * fresh post is discovered up to a full interval late, past its high-engagement
 * window. Keep creators on a steady cadence capped at CREATOR_MAX_INTERVAL_MINUTES.
 */
function nextIntervalMinutes(source: SourceRow, emptyPolls: number): number {
  if (source.source_type === 'linkedin_creator') {
    return Math.min(source.poll_interval_minutes, CREATOR_MAX_INTERVAL_MINUTES);
  }
  return effectiveInterval(source.poll_interval_minutes, emptyPolls);
}

/**
 * Preferred account if active, else the org's least-recently-used active
 * LinkedIn account (avoiding state.last_account_id when possible).
 */
async function resolveAccount(
  supabase: Supabase,
  source: SourceRow,
  cache: Map<string, AccountRow | null>,
): Promise<AccountRow | null> {
  const fields = 'id, organization_id, unipile_account_id, access_token_encrypted, dsn_url, provider, status';

  if (source.account_id) {
    if (!cache.has(source.account_id)) {
      const { data } = await supabase
        .from('unipile_accounts')
        .select(fields)
        .eq('id', source.account_id)
        .maybeSingle();
      cache.set(source.account_id, (data as AccountRow) || null);
    }
    const configured = cache.get(source.account_id);
    if (configured && configured.status === 'active' && configured.provider === 'LINKEDIN') {
      return configured;
    }
  }

  // Fallback: any active LinkedIn account in the org
  const { data: orgAccounts } = await supabase
    .from('unipile_accounts')
    .select(fields)
    .eq('organization_id', source.organization_id)
    .eq('provider', 'LINKEDIN')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  const accounts = (orgAccounts || []) as AccountRow[];
  if (accounts.length === 0) return null;

  const lastUsed = source.state.last_account_id as string | undefined;
  return accounts.find(a => a.id !== lastUsed) || accounts[0];
}

async function recordSourceError(supabase: Supabase, source: SourceRow, message: string): Promise<void> {
  const strikes = source.consecutive_errors + 1;
  await supabase
    .from('lead_list_sources')
    .update({
      consecutive_errors: strikes,
      error_message: message,
      status: strikes >= MAX_STRIKES ? 'error' : 'active',
      last_polled_at: new Date().toISOString(),
      next_poll_at: new Date(Date.now() + source.poll_interval_minutes * 60000).toISOString(),
    })
    .eq('id', source.id);
}

/** Push a source's next poll out without touching error counters. */
async function deferSource(supabase: Supabase, source: SourceRow, minutes: number): Promise<void> {
  await supabase
    .from('lead_list_sources')
    .update({ next_poll_at: new Date(Date.now() + minutes * 60000).toISOString() })
    .eq('id', source.id);
}

/**
 * Park a source whose account is disconnected: keep it active (so it resumes
 * automatically once the account reconnects and the next poll clears this), but
 * stamp a visible error_message and defer, without striking it toward permanent
 * 'error' — the fault is the account, not the source. Mirrors the sender-side
 * senderOutage +1h park.
 */
async function parkSourceDisconnected(supabase: Supabase, source: SourceRow, minutes: number): Promise<void> {
  await supabase
    .from('lead_list_sources')
    .update({
      error_message: 'LinkedIn account disconnected — reconnect the sender in Settings to resume this watcher.',
      last_polled_at: new Date().toISOString(),
      next_poll_at: new Date(Date.now() + minutes * 60000).toISOString(),
    })
    .eq('id', source.id);
}

/**
 * Flip a Unipile account to 'disconnected' the moment the provider returns a
 * disconnected/401 error, rather than waiting for the periodic account sync to
 * notice. The stale 'active' flag is exactly what masked the last incident.
 */
async function markAccountDisconnected(supabase: Supabase, accountId: string): Promise<void> {
  const { error } = await supabase
    .from('unipile_accounts')
    .update({
      status: 'disconnected',
      error_message: 'Account disconnected from provider. Please reconnect in Settings.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .neq('status', 'disconnected');
  if (error) {
    console.error(`${LOG_PREFIX} Failed to mark account ${accountId} disconnected:`, error.message);
  } else {
    console.warn(`${LOG_PREFIX} Marked account ${accountId} disconnected after Unipile 401/disconnected_account`);
  }
}

// ============================================================================
// Post source polling
// ============================================================================

async function pollPostSource(
  supabase: Supabase,
  source: SourceRow,
  accountRef: UnipileAccountRef,
): Promise<PollResult> {
  const config = source.config as {
    include_reactors?: boolean;
    include_commenters?: boolean;
    reaction_types?: string[];
  };
  const includeReactors = config.include_reactors !== false;
  const includeCommenters = config.include_commenters !== false;
  const reactionTypes = config.reaction_types || [];

  const state = { ...source.state };
  delete state.poller_lock_at;

  // Resolve and cache social_id on first poll
  let socialId = state.social_id as string | undefined;
  if (!socialId) {
    socialId = await resolveSocialId(accountRef, source.source_url, LOG_PREFIX) || undefined;
    if (!socialId) {
      throw new Error(`Could not resolve social_id for post: ${source.source_url}`);
    }
    state.social_id = socialId;
  }

  // Cheap count-delta check: skip paging when engagement counters are unchanged.
  const postResponse = await fetch(
    `${accountRef.dsnUrl}/api/v1/posts/${encodeURIComponent(socialId)}?account_id=${accountRef.unipileAccountId}`,
    { headers: { 'X-API-KEY': accountRef.apiKey, 'Accept': 'application/json' } },
  );

  if (postResponse.status === 429) {
    return { imported: 0, spawned: 0, newState: state, emptyPoll: false, rateLimited: true };
  }

  let skipPaging = false;
  // Latest engagement counts, committed to the watermark only after a full
  // drain — so a post that breaks early (budget/timeout) is re-paged next poll.
  let newReactionCount: number | undefined;
  let newCommentCount: number | undefined;
  if (postResponse.ok) {
    const postData = await postResponse.json();
    const reactionCount = postData.reaction_counter ?? postData.reactions_count;
    const commentCount = postData.comment_counter ?? postData.comments_count;
    const countsKnown = typeof reactionCount === 'number' && typeof commentCount === 'number';
    const countsUnchanged = countsKnown
      && state.last_reaction_count === reactionCount
      && state.last_comment_count === commentCount;

    if (countsKnown) {
      newReactionCount = reactionCount;
      newCommentCount = commentCount;
    }
    // Only trust the delta when we have a previous snapshot; otherwise page.
    skipPaging = countsUnchanged
      && typeof source.state.last_reaction_count === 'number'
      && typeof source.state.last_comment_count === 'number';
  } else {
    const errorText = await postResponse.text();
    // A 401 / disconnected_account is the account, not the post — surface it as
    // a real fault instead of silently paging into more failures.
    if (postResponse.status === 401 || isDisconnectedAccountError(errorText)) {
      console.error(`${LOG_PREFIX} Source ${source.id}: account disconnected on post lookup (${postResponse.status}): ${errorText.substring(0, 150)}`);
      return { imported: 0, spawned: 0, newState: state, emptyPoll: false, rateLimited: false, disconnected: true };
    }
    console.log(`${LOG_PREFIX} Post lookup failed (${postResponse.status}), paging anyway: ${errorText.substring(0, 150)}`);
  }

  if (skipPaging) {
    console.log(`${LOG_PREFIX} Source ${source.id}: engagement counts unchanged, skipping`);
    return { imported: 0, spawned: 0, newState: state, emptyPoll: true, rateLimited: false };
  }

  const pollStart = Date.now();
  const processedIds = new Set<string>((state.processed_provider_ids as string[]) || []);
  let imported = 0;
  let fullyDrained = true;

  const sourceData = {
    source_id: source.id,
    post_url: source.source_url,
    ...(source.parent_source_id ? { parent_source_id: source.parent_source_id } : {}),
  };

  const endpoints: Array<{ include: boolean; fetchPage: typeof fetchReactionsPage; kind: 'reactions' | 'comments' }> = [
    { include: includeReactors, fetchPage: fetchReactionsPage, kind: 'reactions' },
    { include: includeCommenters, fetchPage: fetchCommentsPage, kind: 'comments' },
  ];

  for (const endpoint of endpoints) {
    if (!endpoint.include) continue;

    let cursor: string | null = null;
    for (let pageNum = 0; pageNum < MAX_PAGES_PER_ENDPOINT; pageNum++) {
      const page = await endpoint.fetchPage(accountRef, socialId, cursor, PAGE_LIMIT, LOG_PREFIX);

      if (page.rateLimited) {
        state.processed_provider_ids = Array.from(processedIds).slice(-PROCESSED_IDS_CAP);
        return { imported, spawned: 0, newState: state, emptyPoll: false, rateLimited: true };
      }
      if (page.disconnected) {
        state.processed_provider_ids = Array.from(processedIds).slice(-PROCESSED_IDS_CAP);
        return { imported, spawned: 0, newState: state, emptyPoll: false, rateLimited: false, disconnected: true };
      }
      if (!page.ok || page.items.length === 0) break;

      for (const item of page.items) {
        const { userId, author } = endpoint.kind === 'reactions'
          ? extractReactionAuthor(item)
          : extractCommentAuthor(item);

        if (endpoint.kind === 'reactions' && !matchesReactionFilter(item, reactionTypes)) continue;
        if (!userId || processedIds.has(userId)) continue;
        processedIds.add(userId);

        try {
          const result = await processUser(
            supabase,
            source.organization_id,
            source.list_id,
            author,
            endpoint.kind === 'reactions' ? 'post_reactor' : 'post_commenter',
            sourceData,
            LOG_PREFIX,
          );
          if (result === 'imported') imported++;
        } catch (err) {
          console.error(`${LOG_PREFIX} Error processing engager:`, err);
        }

        await new Promise(resolve => setTimeout(resolve, 20));
      }

      cursor = page.cursor;
      if (!cursor) break;
      // Guard the edge-function wall clock: a very heavy post drains across
      // multiple polls rather than risking a mid-run timeout.
      if (Date.now() - pollStart > POST_POLL_BUDGET_MS) {
        fullyDrained = false;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!fullyDrained) break;
  }

  state.processed_provider_ids = Array.from(processedIds).slice(-PROCESSED_IDS_CAP);
  // Advance the count watermark only on a complete drain; a partial drain keeps
  // the old counts so the next poll re-pages and picks up where the cap left off
  // (dedup via processed_provider_ids + the members unique constraint).
  if (fullyDrained) {
    if (typeof newReactionCount === 'number') state.last_reaction_count = newReactionCount;
    if (typeof newCommentCount === 'number') state.last_comment_count = newCommentCount;
  }
  return {
    imported,
    spawned: 0,
    newState: state,
    // A partial drain still has more to pull — don't treat it as an empty poll
    // (which would trigger backoff and slow the backfill down).
    emptyPoll: fullyDrained && imported === 0,
    rateLimited: false,
    continueSoon: !fullyDrained,
  };
}

// ============================================================================
// Creator source polling — discover new posts, spawn child post sources
// ============================================================================

/** Extract the LinkedIn slug from a profile URL, or return the input as-is. */
function extractProfileIdentifier(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.includes('/') && !trimmed.includes('linkedin.com')) return trimmed;
  const match = trimmed.match(/linkedin\.com\/(?:in|company)\/([^/?#]+)/i);
  return match?.[1] ?? trimmed;
}

async function pollCreatorSource(
  supabase: Supabase,
  source: SourceRow,
  accountRef: UnipileAccountRef,
): Promise<PollResult> {
  const config = source.config as {
    include_reactors?: boolean;
    include_commenters?: boolean;
    reaction_types?: string[];
    watch_days?: number;
    post_lookback_days?: number;
    max_posts_per_poll?: number;
  };
  // post_lookback_days <= 0 (or unset) means full history — walk every post.
  const lookbackDays = config.post_lookback_days ?? 0;
  const lookbackCutoff = lookbackDays > 0 ? Date.now() - lookbackDays * 86_400_000 : 0;
  const watchDays = config.watch_days || 60;

  const state = { ...source.state };
  delete state.poller_lock_at;

  // Resolve and cache the creator's provider_id on first poll
  let providerId = state.provider_id as string | undefined;
  if (!providerId) {
    const identifier = extractProfileIdentifier(source.source_url);
    // ACoAA...-style ids can skip the lookup
    if (/^[A-Z]{4}[A-Za-z0-9_-]{20,}$/.test(identifier)) {
      providerId = identifier;
    } else {
      const profileResponse = await fetch(
        `${accountRef.dsnUrl}/api/v1/users/${encodeURIComponent(identifier)}?notify=false&account_id=${accountRef.unipileAccountId}`,
        { headers: { 'X-API-KEY': accountRef.apiKey, 'Accept': 'application/json' } },
      );
      if (profileResponse.status === 429) {
        return { imported: 0, spawned: 0, newState: state, emptyPoll: false, rateLimited: true };
      }
      if (!profileResponse.ok) {
        const errorText = await profileResponse.text();
        // Disconnected account: flip status + park rather than strike the source.
        if (profileResponse.status === 401 || isDisconnectedAccountError(errorText)) {
          return { imported: 0, spawned: 0, newState: state, emptyPoll: false, rateLimited: false, disconnected: true };
        }
        throw new Error(`Could not resolve creator profile "${identifier}": ${profileResponse.status} ${errorText.substring(0, 150)}`);
      }
      const profileData = await profileResponse.json();
      providerId = profileData.provider_id;
      if (!providerId) {
        throw new Error(`No provider_id returned for creator profile "${identifier}"`);
      }
    }
    state.provider_id = providerId;
  }

  const knownPostIds = new Set<string>((state.known_post_ids as string[]) || []);
  let spawned = 0;
  let reachedLookback = false;
  let cursor: string | null = null;

  // Walk the creator's post history page by page (newest first). For a full
  // backfill (lookbackDays <= 0) we page until the history is exhausted or the
  // spawn cap is hit; with a lookback window we stop once posts fall outside it.
  for (let pageNum = 0; pageNum < MAX_POST_PAGES_PER_CREATOR && spawned < MAX_CHILD_SPAWNS && !reachedLookback; pageNum++) {
    let postsUrl = `${accountRef.dsnUrl}/api/v1/users/${encodeURIComponent(providerId)}/posts?account_id=${accountRef.unipileAccountId}&limit=${CREATOR_POSTS_PAGE_SIZE}`;
    if (cursor) postsUrl += `&cursor=${cursor}`;

    const postsResponse = await fetch(postsUrl, {
      headers: { 'X-API-KEY': accountRef.apiKey, 'Accept': 'application/json' },
    });

    if (postsResponse.status === 429) {
      state.known_post_ids = Array.from(knownPostIds).slice(-KNOWN_POST_IDS_CAP);
      return { imported: 0, spawned, newState: state, emptyPoll: false, rateLimited: true };
    }
    if (!postsResponse.ok) {
      const errorText = await postsResponse.text();
      // Disconnected account: flip status + park rather than strike the source.
      if (postsResponse.status === 401 || isDisconnectedAccountError(errorText)) {
        state.known_post_ids = Array.from(knownPostIds).slice(-KNOWN_POST_IDS_CAP);
        return { imported: 0, spawned, newState: state, emptyPoll: false, rateLimited: false, disconnected: true };
      }
      // A mid-backfill page failure shouldn't discard the posts already spawned
      if (pageNum === 0) {
        throw new Error(`Could not fetch creator posts: ${postsResponse.status} ${errorText.substring(0, 150)}`);
      }
      console.warn(`${LOG_PREFIX} Creator post page ${pageNum} failed (${postsResponse.status}), stopping pagination`);
      break;
    }

    const postsData = await postsResponse.json();
    const posts = (postsData.items || []) as Array<{
      id?: string;
      social_id?: string;
      share_url?: string;
      parsed_datetime?: string;
      date?: string;
      is_repost?: boolean;
    }>;
    cursor = postsData.cursor || postsData.next_cursor || null;

    if (posts.length === 0) break;

    for (const post of posts) {
      if (spawned >= MAX_CHILD_SPAWNS) break;
      if (post.is_repost) continue;

      const postKey = post.social_id || post.id;
      if (!postKey || knownPostIds.has(postKey)) continue;

      const postTimestamp = Date.parse(post.parsed_datetime ?? post.date ?? '');
      // Enforce the lookback window only when both a window and a parseable
      // timestamp exist. Posts are newest-first, so once we cross the cutoff we
      // can stop paging entirely.
      if (lookbackCutoff > 0 && !Number.isNaN(postTimestamp) && postTimestamp < lookbackCutoff) {
        knownPostIds.add(postKey);
        reachedLookback = true;
        break;
      }

      const shareUrl = post.share_url || '';
      const { activityId } = extractPostInfo(shareUrl);
      const sourceKey = activityId || postKey;

      const { error: insertError } = await supabase
        .from('lead_list_sources')
        .upsert({
          organization_id: source.organization_id,
          list_id: source.list_id,
          parent_source_id: source.id,
          source_type: 'linkedin_post',
          source_url: shareUrl || source.source_url,
          source_key: sourceKey,
          account_id: source.account_id,
          config: {
            include_reactors: config.include_reactors !== false,
            include_commenters: config.include_commenters !== false,
            reaction_types: config.reaction_types || [],
            watch_days: watchDays,
          },
          // Pre-seed social_id so the child never needs the 4-strategy resolver
          state: post.social_id ? { social_id: post.social_id } : {},
          status: 'active',
          poll_interval_minutes: 360,
          next_poll_at: new Date().toISOString(),
          // Watch each post for watch_days from NOW, not from its (possibly old)
          // publish date — otherwise backfilled posts would expire on spawn.
          expires_at: new Date(Date.now() + watchDays * 86_400_000).toISOString(),
        }, { onConflict: 'list_id,source_key', ignoreDuplicates: true });

      if (insertError) {
        console.error(`${LOG_PREFIX} Failed to spawn child source for post ${postKey}:`, insertError.message);
      } else {
        spawned++;
      }
      knownPostIds.add(postKey);
    }

    if (!cursor) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  state.known_post_ids = Array.from(knownPostIds).slice(-KNOWN_POST_IDS_CAP);
  // If we hit the per-poll spawn cap there are likely more posts to discover —
  // re-poll soon to keep the backfill moving instead of waiting 12h.
  const morePostsLikely = spawned >= MAX_CHILD_SPAWNS;
  return {
    imported: 0,
    spawned,
    newState: state,
    emptyPoll: spawned === 0,
    rateLimited: false,
    continueSoon: morePostsLikely,
  };
}
