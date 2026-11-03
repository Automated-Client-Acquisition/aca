/**
 * Edge Function: Fetch LinkedIn Invitations via Unipile
 *
 * Retrieves pending connection invitations (sent and received) for a LinkedIn account.
 * This helps track outreach campaigns and see who has requested to connect.
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

interface FetchInvitationsRequest {
  /** The Unipile account ID to use for fetching */
  accountId: string;
  /** Type of invitations to fetch: 'sent', 'received', or 'both' */
  type?: 'sent' | 'received' | 'both';
  /** Number of items to fetch (max 100) */
  limit?: number;
  /** Cursor for pagination */
  cursor?: string;
}

interface InvitationSent {
  object: 'InvitationSent';
  id: string;
  invited_user: string | null;
  invited_user_id: string | null;
  invited_user_public_id: string | null;
  invited_user_description: string | null;
  date: string;
  parsed_datetime: string | null;
  invitation_text: string | null;
  inviter?: {
    inviter_name: string;
    inviter_id: string;
    inviter_public_identifier: string;
    inviter_description: string | null;
  };
}

interface InvitationReceived {
  object: 'InvitationReceived';
  id: string;
  inviter_name: string | null;
  inviter_id: string | null;
  inviter_public_id: string | null;
  inviter_description: string | null;
  inviter_avatar_url: string | null;
  date: string;
  parsed_datetime: string | null;
  invitation_text: string | null;
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
    const body: FetchInvitationsRequest = await req.json();
    const { accountId, type = 'both', limit = 50, cursor } = body;

    console.log('Fetch invitations request:', JSON.stringify({ accountId, type, limit, cursor }));

    if (!accountId) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: accountId' }),
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
      sent: InvitationSent[];
      received: InvitationReceived[];
      sentCursor: string | null;
      receivedCursor: string | null;
      errors: string[];
    } = {
      sent: [],
      received: [],
      sentCursor: null,
      receivedCursor: null,
      errors: [],
    };

    // Fetch sent invitations
    if (type === 'sent' || type === 'both') {
      try {
        const params = new URLSearchParams();
        params.append('account_id', accountId);
        params.append('limit', String(Math.min(limit, 100)));
        if (cursor && type === 'sent') {
          params.append('cursor', cursor);
        }

        const url = `${baseUrl}/api/v1/users/invite/sent?${params.toString()}`;
        console.log('Fetching sent invitations from URL:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          results.sent = data.items || [];
          results.sentCursor = data.cursor || null;
          console.log('Sent invitations fetched:', results.sent.length);
        } else {
          const errorBody = await response.text();
          console.error('Sent invitations API error:', response.status, errorBody);
          results.errors.push(`Sent: ${response.status}`);
        }
      } catch (error) {
        console.error('Error fetching sent invitations:', error);
        results.errors.push(`Sent: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Fetch received invitations
    if (type === 'received' || type === 'both') {
      try {
        const params = new URLSearchParams();
        params.append('account_id', accountId);
        params.append('limit', String(Math.min(limit, 100)));
        if (cursor && type === 'received') {
          params.append('cursor', cursor);
        }

        const url = `${baseUrl}/api/v1/users/invite/received?${params.toString()}`;
        console.log('Fetching received invitations from URL:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-API-KEY': apiKey,
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          results.received = data.items || [];
          results.receivedCursor = data.cursor || null;
          console.log('Received invitations fetched:', results.received.length);
        } else {
          const errorBody = await response.text();
          console.error('Received invitations API error:', response.status, errorBody);
          results.errors.push(`Received: ${response.status}`);
        }
      } catch (error) {
        console.error('Error fetching received invitations:', error);
        results.errors.push(`Received: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: results.sent,
        received: results.received,
        sentCursor: results.sentCursor,
        receivedCursor: results.receivedCursor,
        errors: results.errors.length > 0 ? results.errors : undefined,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error fetching invitations:', error);

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
