import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Unipile Add Post Edge Function
 *
 * Parses a LinkedIn or Instagram post URL, fetches metadata from Unipile,
 * and adds it to monitored posts for a campaign.
 * Uses the official Unipile SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { postUrl, campaignId, organizationId } = await req.json();

    if (!postUrl) {
      throw new Error('Post URL is required');
    }

    if (!campaignId) {
      throw new Error('Campaign ID is required');
    }

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    console.log(`[Add Post] Processing URL: ${postUrl}`);

    // Parse the URL to determine provider and extract post ID
    const parsed = parsePostUrl(postUrl);
    if (!parsed) {
      throw new Error('Invalid post URL. Please provide a valid LinkedIn or Instagram post URL.');
    }

    console.log(`[Add Post] Parsed: provider=${parsed.provider}, postId=${parsed.postId}`);

    // Verify the campaign exists and belongs to the organization
    const { data: campaign, error: campaignError } = await supabase
      .from('unipile_campaigns')
      .select('*, account:unipile_accounts(*)')
      .eq('id', campaignId)
      .eq('organization_id', organizationId)
      .single();

    if (campaignError || !campaign) {
      throw new Error('Campaign not found or access denied');
    }

    // Verify the campaign account matches the post provider
    if (campaign.account.provider !== parsed.provider) {
      throw new Error(`This campaign uses ${campaign.account.provider}, but the post is from ${parsed.provider}`);
    }

    // Check if post is already being monitored
    const { data: existingPost } = await supabase
      .from('unipile_monitored_posts')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('post_id', parsed.postId)
      .single();

    if (existingPost) {
      throw new Error('This post is already being monitored by this campaign');
    }

    // Get the account's API key and create SDK client
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const unipileApiKey = await decryptApiKey(campaign.account.access_token_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl(campaign.account.dsn_url);

    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Try to fetch post details from Unipile using SDK
    let postDetails: {
      title?: string;
      content?: string;
      thumbnail?: string;
      author?: string;
      authorAvatar?: string;
      created_at?: string;
    } | null = null;

    try {
      console.log(`[Add Post] Fetching post details via SDK for: ${parsed.postId}`);

      const postData = await client.users.getPost({
        account_id: campaign.account.unipile_account_id,
        post_id: parsed.postId,
      }) as Record<string, unknown>;

      console.log('[Add Post] Raw post data:', JSON.stringify(postData).substring(0, 500));

      const author = postData.author as Record<string, unknown> | undefined;
      const actor = postData.actor as Record<string, unknown> | undefined;
      const images = postData.images as Array<{ url?: string }> | undefined;

      postDetails = {
        title: (postData.title || postData.headline) as string | undefined,
        content: (postData.text || postData.content || postData.commentary) as string | undefined,
        thumbnail: (postData.thumbnail_url || postData.image || images?.[0]?.url || images?.[0]) as string | undefined,
        author: (author?.name || author?.first_name || actor?.name) as string | undefined,
        authorAvatar: (author?.profile_picture || author?.picture_url || actor?.image) as string | undefined,
        created_at: (postData.created_at || postData.date) as string | undefined,
      };
      console.log('[Add Post] Parsed post details:', postDetails);
    } catch (e) {
      console.warn('[Add Post] Could not fetch post details:', e);
    }

    // Add the post to monitored posts
    const { data: monitoredPost, error: insertError } = await supabase
      .from('unipile_monitored_posts')
      .insert({
        campaign_id: campaignId,
        organization_id: organizationId,
        post_id: parsed.postId,
        post_url: postUrl,
        provider: parsed.provider,
        post_title: postDetails?.title || null,
        post_content: postDetails?.content?.substring(0, 500) || null,
        post_thumbnail_url: postDetails?.thumbnail || null,
        post_author_name: postDetails?.author || null,
        post_author_avatar: postDetails?.authorAvatar || null,
        post_created_at: postDetails?.created_at || null,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Add Post] Failed to insert post:', insertError);
      throw new Error('Failed to add post to monitoring');
    }

    console.log(`[Add Post] Successfully added post ${monitoredPost.id}`);

    return new Response(JSON.stringify({
      success: true,
      post: {
        id: monitoredPost.id,
        postId: parsed.postId,
        postUrl: postUrl,
        provider: parsed.provider,
        title: postDetails?.title || null,
        content: postDetails?.content?.substring(0, 200) || null,
        thumbnail: postDetails?.thumbnail || null,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Add Post] Error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Parse a LinkedIn or Instagram post URL to extract provider and post ID
 */
function parsePostUrl(url: string): { provider: 'LINKEDIN' | 'INSTAGRAM'; postId: string } | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // LinkedIn patterns
    if (hostname.includes('linkedin.com')) {
      const pathname = urlObj.pathname;

      // Pattern: /posts/... with activity-ID anywhere in the path
      const activityMatch = pathname.match(/activity[:-](\d+)/i);
      if (activityMatch && pathname.includes('/posts/')) {
        return { provider: 'LINKEDIN', postId: `urn:li:activity:${activityMatch[1]}` };
      }

      // Pattern: /feed/update/urn:li:activity:ID or urn:li:share:ID
      const urnMatch = pathname.match(/urn:li:(activity|share):(\d+)/i);
      if (urnMatch) {
        return { provider: 'LINKEDIN', postId: `urn:li:${urnMatch[1]}:${urnMatch[2]}` };
      }

      // Fallback: any activity:ID pattern in the URL
      if (activityMatch) {
        return { provider: 'LINKEDIN', postId: `urn:li:activity:${activityMatch[1]}` };
      }

      throw new Error('Could not parse LinkedIn post URL');
    }

    // Instagram patterns
    if (hostname.includes('instagram.com')) {
      const pathname = urlObj.pathname;

      // Pattern: /p/shortcode or /reel/shortcode
      const instaMatch = pathname.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/i);
      if (instaMatch) {
        return { provider: 'INSTAGRAM', postId: instaMatch[2] };
      }

      throw new Error('Could not parse Instagram post URL');
    }

    return null;
  } catch (e) {
    console.error('[Parse URL] Error:', e);
    return null;
  }
}
