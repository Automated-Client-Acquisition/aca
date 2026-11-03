/**
 * Edge Function: Send LinkedIn Connection Request via Unipile
 *
 * Sends a connection invitation to a LinkedIn user with an optional personal message.
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

interface SendInvitationRequest {
  /** The Unipile account ID to send from (internal DB ID, not unipile_account_id) */
  accountId: string;
  /** The LinkedIn provider_id of the recipient */
  recipientId: string;
  /** Optional personal message to include with the invitation (max 300 chars) */
  message?: string;
  /** Optional contact ID to log activity */
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
    const body: SendInvitationRequest = await req.json();
    const { accountId, recipientId, message, contactId } = body;

    console.log('Send invitation request:', JSON.stringify({ accountId, recipientId, hasMessage: !!message, contactId }));

    if (!accountId || !recipientId) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: accountId and recipientId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate message length (LinkedIn limit is 300 characters)
    if (message && message.length > 300) {
      return new Response(
        JSON.stringify({ error: 'Message exceeds 300 character limit' }),
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

    // Get the account with its Unipile account ID
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('id, unipile_account_id, provider')
      .eq('id', accountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !account) {
      return new Response(
        JSON.stringify({ error: 'Account not found or not authorized' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (account.provider !== 'LINKEDIN') {
      return new Response(
        JSON.stringify({ error: 'Account is not a LinkedIn account' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    const requestBody: Record<string, unknown> = {
      account_id: account.unipile_account_id,
      provider_id: recipientId,
    };

    if (message) {
      requestBody.message = message;
    }

    const url = `${baseUrl}/api/v1/users/invite`;
    console.log('Sending invitation to URL:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Invitation API error:', response.status, errorText);

      // Parse common error cases
      let errorMessage = 'Failed to send invitation';
      if (response.status === 429) {
        errorMessage = 'Rate limit reached. Please try again later.';
      } else if (errorText.includes('already connected')) {
        errorMessage = 'You are already connected with this person.';
      } else if (errorText.includes('pending')) {
        errorMessage = 'A connection request is already pending for this person.';
      } else if (errorText.includes('limit')) {
        errorMessage = 'Weekly invitation limit reached.';
      } else if (errorText.includes('invalid_recipient') || errorText.includes('Recipient cannot be reached')) {
        errorMessage = 'This profile cannot be reached — it may be locked, deactivated, or the ID is invalid.';
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          details: errorText,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const result = await response.json();
    console.log('Invitation sent successfully:', result);

    // Log activity if contactId was provided
    if (contactId) {
      try {
        await supabase.from('crm_activities').insert({
          organization_id: organizationId,
          contact_id: contactId,
          activity_type: 'connection_request_sent',
          performer_type: 'user',
          performer_user_id: user.id,
          title: 'Connection request sent',
          description: message ? `Message: ${message}` : 'No message included',
          metadata: {
            channel: 'linkedin',
            channel_account_id: accountId,
            recipient_id: recipientId,
            invitation_id: result.id || result.invitation_id,
          },
        });
      } catch (activityError) {
        console.error('Failed to log activity:', activityError);
        // Don't fail the request if activity logging fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        invitationId: result.id || result.invitation_id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error sending invitation:', error);

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
