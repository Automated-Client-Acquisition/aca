/**
 * Edge Function: Fetch LinkedIn User Posts via Unipile
 *
 * Retrieves posts written by a LinkedIn user using the Unipile API.
 * Returns post content, engagement metrics, attachments, and more.
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

interface FetchUserPostsRequest {
  /** LinkedIn provider_id or public_identifier (username) */
  identifier: string;
  /** The Unipile account ID to use for fetching */
  accountId: string;
  /** Number of posts to fetch (max 100) */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
  /** Whether the identifier is a company (default: false) */
  isCompany?: boolean;
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
    const body: FetchUserPostsRequest = await req.json();
    const { identifier, accountId, limit = 20, cursor, isCompany = false } = body;

    console.log('Fetch user posts request:', JSON.stringify({ identifier, accountId, limit, cursor, isCompany }));

    if (!identifier || !accountId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: identifier, accountId' }),
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

    // Decrypt API key and create SDK client
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Missing ENCRYPTION_KEY environment variable');
    }

    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);
    const client = new UnipileClient(dsnUrl, apiKey);

    // Build request options for the SDK method
    const requestOptions: {
      account_id: string;
      identifier: string;
      limit?: number;
      cursor?: string;
      is_company?: boolean;
    } = {
      account_id: accountId,
      identifier: identifier,
      limit: Math.min(limit, 100),
    };
    if (cursor) {
      requestOptions.cursor = cursor;
    }
    if (isCompany) {
      requestOptions.is_company = true;
    }

    console.log('Fetching posts for user:', identifier, 'with params:', JSON.stringify(requestOptions));

    // Use the SDK's proper method for fetching user posts
    const postsData = await client.users.getAllPosts(requestOptions);

    console.log('Posts fetched successfully, count:', postsData?.items?.length || 0);

    return new Response(
      JSON.stringify({
        success: true,
        posts: postsData.items || [],
        cursor: postsData.cursor,
        paging: postsData.paging,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fetching user posts:', error);

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
