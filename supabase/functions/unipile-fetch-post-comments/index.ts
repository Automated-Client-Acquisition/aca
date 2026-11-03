/**
 * Edge Function: Fetch LinkedIn Post Comments via Unipile
 *
 * Retrieves comments (and commenter profiles) on a specific post using the Unipile API.
 * Companion to unipile-fetch-user-posts for ad-hoc commenter scraping.
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

interface FetchPostCommentsRequest {
  /** Post social_id (preferred) or id, as returned by unipile-fetch-user-posts */
  postId: string;
  /** The Unipile account ID to use for fetching */
  accountId: string;
  /** Number of comments to fetch (max 100) */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: FetchPostCommentsRequest = await req.json();
    const { postId, accountId, limit = 100, cursor } = body;

    if (!postId || !accountId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: postId, accountId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider, access_token_encrypted, dsn_url')
      .eq('unipile_account_id', accountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not authorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Missing ENCRYPTION_KEY environment variable');
    }

    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const client = new UnipileClient(dsnUrl, apiKey);

    const requestOptions: { account_id: string; post_id: string; limit?: number; cursor?: string } = {
      account_id: accountId,
      post_id: postId,
      limit: Math.min(limit, 100),
    };
    if (cursor) {
      requestOptions.cursor = cursor;
    }

    const commentsData = await client.users.getAllPostComments(requestOptions);

    return new Response(
      JSON.stringify({
        success: true,
        comments: commentsData.items || [],
        cursor: commentsData.cursor,
        total_items: commentsData.total_items,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error fetching post comments:', error);
    const parsedError = parseUnipileError(error);
    return new Response(
      JSON.stringify({
        success: false,
        error: parsedError.message,
        code: parsedError.code,
        retryable: parsedError.retryable,
      }),
      { status: parsedError.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
