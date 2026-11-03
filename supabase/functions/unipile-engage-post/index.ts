/**
 * Edge Function: Engage with LinkedIn Post via Unipile
 *
 * Adds a reaction (like, celebrate, etc.) or comment to a LinkedIn post.
 * Used for warming up prospects before outreach campaigns.
 *
 * @see https://developer.unipile.com/docs/nodejs-sdk
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ReactionType = 'like' | 'celebrate' | 'support' | 'love' | 'insightful' | 'funny';

interface EngagePostRequest {
  /** The Unipile account ID to use */
  accountId: string;
  /** The post ID to engage with */
  postId: string;
  /** Type of engagement: 'reaction' or 'comment' */
  action: 'reaction' | 'comment';
  /** For reactions: the type of reaction */
  reactionType?: ReactionType;
  /** For comments: the comment text */
  commentText?: string;
  /** Optional: comment ID if reacting to a comment instead of the post */
  commentId?: string;
  /** Optional: contact ID to log activity */
  contactId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify the user's JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const body: EngagePostRequest = await req.json();
    const { accountId, postId, action, reactionType, commentText, commentId, contactId } = body;

    console.log('Engage post request:', JSON.stringify({ accountId, postId, action, reactionType, commentId, contactId }));
    console.log('Raw body keys:', JSON.stringify(Object.keys(body)));

    // Validation
    if (!accountId || !postId || !action) {
      console.error('Validation failed:', JSON.stringify({ accountId: !!accountId, postId: !!postId, action: !!action, rawBody: JSON.stringify(body) }));
      return new Response(
        JSON.stringify({ error: `Missing required fields: accountId=${!!accountId}, postId=${!!postId}, action=${!!action}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'reaction' && !reactionType) {
      return new Response(
        JSON.stringify({ error: 'reactionType is required for reaction action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'comment' && !commentText) {
      return new Response(
        JSON.stringify({ error: 'commentText is required for comment action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userError) {
      return new Response(
        JSON.stringify({ error: 'Failed to get user organization' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    // Verify the account belongs to this organization and get credentials
    // accountId may be either the external Unipile ID or the internal UUID
    let account: { id: string; unipile_account_id: string; provider: string; access_token_encrypted: string; dsn_url: string | null } | null = null;

    // Try external Unipile ID first
    const { data: byExternal } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider, access_token_encrypted, dsn_url')
      .eq('unipile_account_id', accountId)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (byExternal) {
      account = byExternal;
    } else {
      // Fall back to internal UUID
      const { data: byInternal } = await supabase
        .from('unipile_accounts')
        .select('id, unipile_account_id, provider, access_token_encrypted, dsn_url')
        .eq('id', accountId)
        .eq('organization_id', organizationId)
        .maybeSingle();
      account = byInternal;
    }

    if (!account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not authorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Decrypt API key and create SDK client
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Missing ENCRYPTION_KEY environment variable');
    }

    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const client = new UnipileClient(dsnUrl, apiKey);
    const unipileAccountId = account.unipile_account_id;

    let responseData: Record<string, unknown>;

    if (action === 'reaction') {
      // Add reaction to post using SDK
      console.log('Adding reaction to post:', postId, 'type:', reactionType);

      const reactionParams: {
        account_id: string;
        post_id: string;
        reaction_type?: string;
        comment_id?: string;
      } = {
        account_id: unipileAccountId,
        post_id: postId,
        reaction_type: reactionType,
      };

      // If reacting to a comment, add comment_id
      if (commentId) {
        reactionParams.comment_id = commentId;
      }

      responseData = await client.users.sendPostReaction(reactionParams) as Record<string, unknown>;
      console.log('Reaction added successfully');
    } else {
      // Add comment to post using SDK
      console.log('Adding comment to post:', postId);

      const commentParams: {
        account_id: string;
        post_id: string;
        text: string;
        comment_id?: string;
      } = {
        account_id: unipileAccountId,
        post_id: postId,
        text: commentText!,
      };

      // If replying to a comment, add comment_id
      if (commentId) {
        commentParams.comment_id = commentId;
      }

      responseData = await client.users.sendPostComment(commentParams) as Record<string, unknown>;
      console.log('Comment added successfully');
    }

    // Log activity if contactId provided
    if (contactId) {
      try {
        await supabase.from('crm_activities').insert({
          organization_id: organizationId,
          contact_id: contactId,
          user_id: user.id,
          type: action === 'reaction' ? 'linkedin_reaction' : 'linkedin_comment',
          description: action === 'reaction'
            ? `Added ${reactionType} reaction to post`
            : `Commented on post: "${commentText?.substring(0, 100)}${(commentText?.length || 0) > 100 ? '...' : ''}"`,
          metadata: {
            post_id: postId,
            action_type: action,
            reaction_type: reactionType,
            comment_text: commentText,
            account_id: accountId,
          },
        });
        console.log('Activity logged for contact:', contactId);
      } catch (activityError) {
        console.error('Failed to log activity:', activityError);
        // Don't fail the request if activity logging fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        action,
        postId,
        reactionType: action === 'reaction' ? reactionType : undefined,
        data: responseData,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error engaging with post:', error);

    const parsedError = parseUnipileError(error);

    return new Response(
      JSON.stringify({
        success: false,
        error: parsedError.message,
        code: parsedError.code,
        retryable: parsedError.retryable,
      }),
      {
        status: parsedError.status || 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
