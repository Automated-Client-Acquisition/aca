import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Calendar Connect Edge Function
 *
 * Creates a hosted authentication link for connecting Google Calendar or Microsoft Outlook.
 * Uses the official Unipile SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header to identify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    const { organizationId, provider } = await req.json();

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    const validProviders = ['GOOGLE', 'MICROSOFT'];
    if (!provider || !validProviders.includes(provider.toUpperCase())) {
      throw new Error('Provider must be GOOGLE or MICROSOFT');
    }

    const normalizedProvider = provider.toUpperCase();
    console.log(`[Calendar Connect] Initiating ${normalizedProvider} calendar connection for org:`, organizationId);

    // Verify user is member of organization
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !membership) {
      throw new Error('You do not have access to this organization');
    }

    // Get Unipile credentials from org's BYOK
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (!apiKeyData?.key_encrypted) {
      throw new Error('Unipile API key not configured. Please add your Unipile API key in Settings > API Keys.');
    }

    console.log('[Calendar Connect] Using BYOK - org\'s Unipile API key');
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl((apiKeyData.metadata as Record<string, string>)?.dsn_url);
    const usingBYOK = true;

    // Create Unipile SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Get the current app URL from the request origin
    const origin = req.headers.get('origin') || req.headers.get('referer')?.split('?')[0].replace(/\/$/, '');

    // Generate unique state for tracking this auth flow
    const state = crypto.randomUUID();

    // Store state in oauth_states table for verification
    const { error: stateError } = await supabase
      .from('oauth_states')
      .insert({
        state,
        organization_id: organizationId,
        app_url: origin,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
      });

    if (stateError) {
      console.error('[Calendar Connect] Failed to store state:', stateError);
      throw new Error('Failed to initialize connection flow');
    }

    // Build the notify URL - Unipile will POST to this when auth completes
    const notifyUrl = `${supabaseUrl}/functions/v1/calendar-auth-callback?state=${state}`;

    // Build success/failure redirect URLs
    const successRedirectUrl = `${supabaseUrl}/functions/v1/calendar-auth-callback?mode=redirect&provider=${normalizedProvider.toLowerCase()}`;
    const failureRedirectUrl = `${supabaseUrl}/functions/v1/calendar-auth-callback?mode=redirect&error=true`;

    console.log('[Calendar Connect] Requesting hosted auth link via SDK...');
    console.log('[Calendar Connect] DSN:', unipileDsn);
    console.log('[Calendar Connect] Notify URL:', notifyUrl);

    // Map provider to Unipile provider name
    const unipileProvider = normalizedProvider === 'GOOGLE' ? 'GOOGLE_CALENDAR' : 'OUTLOOK';

    // Request hosted authentication link using SDK
    const hostedAuth = await client.account.createHostedAuthLink({
      type: 'create',
      providers: [unipileProvider],
      api_url: unipileDsn,
      name: state,
      expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
      notify_url: notifyUrl,
      success_redirect_url: successRedirectUrl,
      failure_redirect_url: failureRedirectUrl,
      bypass_success_screen: false,
    });

    console.log('[Calendar Connect] Hosted auth response:', JSON.stringify(hostedAuth));

    // Unipile returns the URL in the 'url' field
    const authUrl = (hostedAuth as Record<string, unknown>).url ||
                    (hostedAuth as Record<string, unknown>).hosted_auth_link;

    if (!authUrl) {
      console.error('[Calendar Connect] No auth URL in response:', hostedAuth);
      throw new Error('No authentication URL returned from Unipile');
    }

    console.log('[Calendar Connect] Generated auth URL for state:', state, 'BYOK:', usingBYOK);

    return new Response(
      JSON.stringify({
        success: true,
        authUrl,
        state,
        provider: normalizedProvider,
        usingBYOK,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Calendar Connect] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
