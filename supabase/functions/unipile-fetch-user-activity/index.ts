/**
 * Edge Function: Fetch LinkedIn User Activity via Unipile
 *
 * Retrieves activity data for a LinkedIn user including:
 * - Comments they made on other posts
 * - Reactions they gave to posts/comments
 *
 * @see https://developer.unipile.com/docs/nodejs-sdk
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FetchUserActivityRequest {
  /** LinkedIn provider_id or public_identifier (username) */
  identifier: string;
  /** The Unipile account ID to use for fetching */
  accountId: string;
  /** Number of items to fetch per type (max 100) */
  limit?: number;
  /** Types of activity to fetch */
  types?: ('comments' | 'reactions')[];
}

interface LinkedInComment {
  object: 'Comment';
  id: string;
  post_id: string;
  post_urn: string;
  thread_id?: string;
  author: string | null;
  author_details: {
    id: string | null;
    headline: string | null;
    profile_url: string | null;
    profile_picture_url: string | null;
    network_distance: string | null;
  };
  date: string;
  text: string;
  reaction_counter: number;
  reply_counter: number;
  impressions_counter?: number;
  user_reacted?: string;
}

interface LinkedInReaction {
  object: 'PostReaction';
  value: 'LIKE' | 'PRAISE' | 'APPRECIATION' | 'EMPATHY' | 'INTEREST' | 'ENTERTAINMENT';
  post_id: string;
  comment_id?: string;
  author: {
    id: string;
    type: 'INDIVIDUAL' | 'COMPANY';
    name: string | null;
    headline: string | null;
    profile_url: string | null;
    profile_picture_url: string | null;
    network_distance?: string;
  };
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
    const body: FetchUserActivityRequest = await req.json();
    const { identifier, accountId, limit = 20, types = ['comments', 'reactions'] } = body;

    console.log('Fetch user activity request:', JSON.stringify({ identifier, accountId, limit, types }));

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

    // Verify the account belongs to this organization
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider')
      .eq('unipile_account_id', accountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not authorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Unipile credentials from org's BYOK
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (apiKeyError || !apiKeyData?.key_encrypted) {
      return new Response(
        JSON.stringify({ error: 'Unipile API key not configured. Please add your Unipile API key in Settings > API Keys.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const baseUrl = normalizeDsnUrl((apiKeyData.metadata as Record<string, string>)?.dsn_url);

    const results: {
      comments: LinkedInComment[];
      reactions: LinkedInReaction[];
      errors: string[];
    } = {
      comments: [],
      reactions: [],
      errors: [],
    };

    // Fetch comments
    if (types.includes('comments')) {
      try {
        const params = new URLSearchParams();
        params.append('account_id', accountId);
        params.append('limit', String(Math.min(limit, 100)));

        const url = `${baseUrl}/api/v1/users/${encodeURIComponent(identifier)}/comments?${params.toString()}`;
        console.log('Fetching comments from URL:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          results.comments = data.items || [];
          console.log('Comments fetched:', results.comments.length);
        } else {
          const errorBody = await response.text();
          console.error('Comments API error:', response.status, errorBody);
          results.errors.push(`Comments: ${response.status}`);
        }
      } catch (error) {
        console.error('Error fetching comments:', error);
        results.errors.push(`Comments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Fetch reactions
    if (types.includes('reactions')) {
      try {
        const params = new URLSearchParams();
        params.append('account_id', accountId);
        params.append('limit', String(Math.min(limit, 100)));

        const url = `${baseUrl}/api/v1/users/${encodeURIComponent(identifier)}/reactions?${params.toString()}`;
        console.log('Fetching reactions from URL:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          results.reactions = data.items || [];
          console.log('Reactions fetched:', results.reactions.length);
        } else {
          const errorBody = await response.text();
          console.error('Reactions API error:', response.status, errorBody);
          results.errors.push(`Reactions: ${response.status}`);
        }
      } catch (error) {
        console.error('Error fetching reactions:', error);
        results.errors.push(`Reactions: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        comments: results.comments,
        reactions: results.reactions,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fetching user activity:', error);

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
