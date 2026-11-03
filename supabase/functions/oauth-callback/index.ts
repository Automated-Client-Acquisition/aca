import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // COMPREHENSIVE DEBUG LOGGING
    const url = new URL(req.url);
    console.log('=== OAUTH CALLBACK DEBUG ===');
    console.log('Full URL:', req.url);
    console.log('Request Method:', req.method);
    console.log('Query Parameters:', Object.fromEntries(url.searchParams));
    console.log('Headers:', Object.fromEntries(req.headers.entries()));

    // Try to get code and state from multiple sources
    let code = url.searchParams.get('code');
    let state = url.searchParams.get('state');
    let error = url.searchParams.get('error');
    let errorDescription = url.searchParams.get('error_description');

    // Check for POST body if not in query params
    if (!code && !state && req.method === 'POST') {
      try {
        const contentType = req.headers.get('content-type') || '';
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const body = await req.text();
          console.log('POST body (raw):', body);
          const formData = new URLSearchParams(body);
          code = formData.get('code');
          state = formData.get('state');
          error = formData.get('error');
          errorDescription = formData.get('error_description');
          console.log('Extracted from POST body:', { code, state, error, errorDescription });
        } else if (contentType.includes('application/json')) {
          const jsonBody = await req.json();
          console.log('POST body (JSON):', jsonBody);
          code = jsonBody.code;
          state = jsonBody.state;
          error = jsonBody.error;
          errorDescription = jsonBody.error_description;
        }
      } catch (e) {
        console.error('Failed to parse POST body:', e);
      }
    }

    console.log('Final extracted values:', { code: code ? 'present' : 'missing', state: state ? 'present' : 'missing', error, errorDescription });

    // Check for OAuth error response from provider
    if (error) {
      throw new Error(`OAuth provider error: ${error} - ${errorDescription || 'No description'}`);
    }

    if (!code) {
      throw new Error('Missing authorization code');
    }

    // State parameter is REQUIRED for CSRF protection — no fallback
    if (!state) {
      throw new Error('Missing state parameter — OAuth callback must include state for security');
    }

    console.log('Processing OAuth callback with state:', state);

    // Verify state to prevent CSRF
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_states')
      .select('organization_id, expires_at, app_url')
      .eq('state', state)
      .single();

    if (stateError || !stateData) {
      console.error('Invalid state:', stateError);
      throw new Error('Invalid or expired state parameter');
    }

    // Check if state expired
    if (new Date(stateData.expires_at) < new Date()) {
      // Clean up expired state
      await supabase.from('oauth_states').delete().eq('state', state);
      throw new Error('State parameter expired');
    }

    // NOTE: state row is deleted *after* successful token exchange (below).
    // Deleting here would race against link-prefetchers, antivirus URL scanners,
    // and double-redirects, surfacing as "Invalid or expired state parameter"
    // on the user's real attempt.

    const organizationId = stateData.organization_id;

    // Get OAuth credentials
    const clientId = Deno.env.get('GHL_CLIENT_ID');
    const clientSecret = Deno.env.get('GHL_CLIENT_SECRET');
    
    // Hardcode redirect URI - it's public and needs to match GHL exactly
    const redirectUri = `${supabaseUrl}/functions/v1/oauth-callback`;

    if (!clientId || !clientSecret) {
      throw new Error('GHL OAuth credentials not configured');
    }

    // Exchange code for tokens
    console.log('Exchanging code for tokens...');
    const tokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      throw new Error(`Failed to exchange code for tokens: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    console.log('Token exchange successful');

    // Extract data from token response
    const { access_token, refresh_token, expires_in, locationId, companyId, scope } = tokenData;

    if (!access_token || !refresh_token) {
      throw new Error('Missing tokens in response');
    }

    // Encrypt tokens
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const accessTokenEncrypted = await encryptApiKey(access_token, encryptionKey);
    const refreshTokenEncrypted = await encryptApiKey(refresh_token, encryptionKey);

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Store tokens in database (upsert to handle reconnection)
    const { error: tokenError } = await supabase
      .from('ghl_oauth_tokens')
      .upsert({
        organization_id: organizationId,
        location_id: locationId,
        company_id: companyId,
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: expiresAt.toISOString(),
        scopes: scope ? scope.split(' ') : [],
      }, {
        onConflict: 'organization_id,location_id',
      });

    if (tokenError) {
      console.error('Failed to store tokens:', tokenError);
      throw new Error('Failed to store OAuth tokens');
    }

    // Token exchange + storage succeeded — now retire the one-time state.
    // Best-effort delete; if a duplicate callback already removed it, that's fine.
    await supabase.from('oauth_states').delete().eq('state', state);

    console.log('OAuth flow completed successfully for organization:', organizationId);

    // Return postMessage HTML to close popup and notify parent window
    return new Response(`<!DOCTYPE html><html><head><title>Connected!</title></head><body>
<script>
if (window.opener) {
  window.opener.postMessage({ type: 'GHL_OAUTH_SUCCESS', provider: 'leadconnector' }, '*');
}
setTimeout(function() { window.close(); }, 1500);
</script>
<p>LeadConnector connected successfully! This window will close automatically...</p>
</body></html>`, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const safeError = JSON.stringify(errorMessage);
    return new Response(`<!DOCTYPE html><html><head><title>Connection Failed</title></head><body>
<script>
if (window.opener) {
  window.opener.postMessage({ type: 'GHL_OAUTH_ERROR', error: ${safeError} }, '*');
}
setTimeout(function() { window.close(); }, 2000);
</script>
<p>Connection failed. This window will close automatically...</p>
</body></html>`, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }
});

// Encrypt API key using AES-256-GCM
async function encryptApiKey(plaintext: string, encryptionKeyHex: string): Promise<string> {
  const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encodedText
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}
