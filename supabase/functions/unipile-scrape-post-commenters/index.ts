/**
 * Edge Function: Scrape LinkedIn Post Commenters via Unipile
 *
 * Given a creator's LinkedIn public identifier, lists their posts within a
 * lookback window and fetches commenter profiles for each post using the
 * Unipile REST API directly (proven pattern from linkedin-post-import /
 * unipile-auto-add-posts — bypasses SDK client-side validation quirks).
 *
 * One-off ad-hoc lead-gen scrape, not tied to a monitored-post campaign.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapeRequest {
  /** LinkedIn public identifier (the slug in linkedin.com/in/<slug>) */
  identifier: string;
  /** The Unipile account ID (unipile_account_id, not internal uuid) to fetch through */
  accountId: string;
  /** Only include posts published within this many days */
  daysBack?: number;
  /** Max posts to scan in this single call (keep small — edge functions have a 150s budget) */
  maxPosts?: number;
  /** Resume post listing from this cursor (returned as nextPostsCursor by a previous call) */
  postsCursor?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body: ScrapeRequest = await req.json();
    const { identifier, accountId, daysBack = 60, maxPosts = 5, postsCursor } = body;

    if (!identifier || !accountId) {
      return new Response(JSON.stringify({ error: 'Missing required fields: identifier, accountId' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userError) {
      return new Response(JSON.stringify({ error: 'Failed to get user organization' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider, access_token_encrypted, dsn_url')
      .eq('unipile_account_id', accountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Account not found or not authorized' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Missing ENCRYPTION_KEY environment variable');
    }

    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // ── Step 1: list posts (raw REST), capped to maxPosts per call so we stay
    // well under the edge function's 150s budget. Caller paginates across
    // multiple calls using nextPostsCursor to cover the full daysBack window. ──
    const posts: Array<Record<string, unknown>> = [];
    let cursor: string | null = postsCursor || null;
    let page = 0;
    const MAX_PAGES = 3;
    let stoppedEarly = false;
    let reachedEndOfHistory = false;

    while (page < MAX_PAGES && posts.length < maxPosts) {
      let postsUrl = `${dsnUrl}/api/v1/users/${encodeURIComponent(identifier)}/posts?account_id=${encodeURIComponent(accountId)}&limit=20`;
      if (cursor) postsUrl += `&cursor=${encodeURIComponent(cursor)}`;

      const resp = await fetch(postsUrl, {
        headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return new Response(JSON.stringify({
          success: false,
          error: `Posts API ${resp.status}: ${errText.substring(0, 300)}`,
        }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await resp.json() as { items?: Array<Record<string, unknown>>; cursor?: string | null };
      const items = data.items || [];

      for (const p of items) {
        if (posts.length >= maxPosts) break;
        const dateStr = (p.parsed_datetime || p.date) as string | undefined;
        const postDate = dateStr ? new Date(dateStr) : null;
        if (postDate && postDate < cutoff) {
          stoppedEarly = true;
          break;
        }
        posts.push(p);
      }

      cursor = data.cursor || null;
      page++;
      if (!cursor) reachedEndOfHistory = true;
      if (!cursor || items.length === 0 || stoppedEarly || posts.length >= maxPosts) break;
    }

    // ── Step 2: fetch comments for each post within window (raw REST) ──
    const commentersByProfile = new Map<string, Record<string, unknown>>();
    const postSummaries: Array<{ postId: string; shareUrl: string; date: string; commentCount: number }> = [];
    const errors: string[] = [];

    for (const post of posts) {
      const postId = (post.social_id || post.id) as string;
      if (!postId) continue;

      let commentCursor: string | null = null;
      let commentPage = 0;
      let commentsForPost = 0;

      while (commentPage < 3) {
        let commentsUrl = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/comments?account_id=${encodeURIComponent(accountId)}&limit=100`;
        if (commentCursor) commentsUrl += `&cursor=${encodeURIComponent(commentCursor)}`;

        const resp = await fetch(commentsUrl, {
          headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
        });

        if (!resp.ok) {
          const errText = await resp.text().catch(() => '');
          errors.push(`Comments ${resp.status} for post ${postId}: ${errText.substring(0, 200)}`);
          break;
        }

        const data = await resp.json() as {
          items?: Array<{
            id: string; text: string; date: string;
            author: string | null;
            author_details?: {
              id: string | null; headline: string | null; profile_url: string | null;
              network_distance: string | null; public_identifier?: string | null;
            };
          }>;
          cursor?: string | null;
        };

        const items = data.items || [];
        commentsForPost += items.length;

        for (const c of items) {
          const details = c.author_details;
          const profileKey = details?.public_identifier || details?.profile_url || details?.id || c.author || c.id;
          if (!profileKey) continue;
          if (!commentersByProfile.has(String(profileKey))) {
            commentersByProfile.set(String(profileKey), {
              name: c.author || 'Unknown',
              headline: details?.headline || null,
              profileUrl: details?.profile_url || null,
              publicIdentifier: details?.public_identifier || null,
              providerId: details?.id || null,
              networkDistance: details?.network_distance || null,
              firstSeenCommentText: c.text || '',
              firstSeenPostId: postId,
              firstSeenAt: c.date || null,
            });
          }
        }

        commentCursor = data.cursor || null;
        commentPage++;
        if (!commentCursor || items.length === 0) break;
      }

      postSummaries.push({
        postId,
        shareUrl: (post.share_url as string) || '',
        date: (post.parsed_datetime || post.date) as string || '',
        commentCount: commentsForPost,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      windowDays: daysBack,
      postsScanned: posts.length,
      posts: postSummaries,
      commenters: Array.from(commentersByProfile.values()),
      totalUniqueCommenters: commentersByProfile.size,
      errors: errors.length > 0 ? errors : undefined,
      // Pass this back in as `postsCursor` to continue scanning older posts within the window.
      // null/absent means either we hit daysBack cutoff or the creator's post history ended.
      nextPostsCursor: (!stoppedEarly && !reachedEndOfHistory && cursor) ? cursor : null,
      donePaginating: stoppedEarly || reachedEndOfHistory,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error scraping post commenters:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
