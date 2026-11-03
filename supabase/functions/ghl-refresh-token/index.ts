import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { getLatestGHLOAuthTokenRow } from "../_shared/ghl-oauth.ts";

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

    // Internal-only: every caller sends the service key. organizationId comes from the body.
    if (req.headers.get('Authorization') !== `Bearer ${supabaseKey}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { organizationId } = await req.json();

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    console.log('Refreshing OAuth token for organization:', organizationId);

    // Get stored tokens
    const tokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

    if (!tokenData) {
      throw new Error('No OAuth tokens found for organization');
    }

    // Decrypt refresh token
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const refreshToken = await decryptApiKey(tokenData.refresh_token_encrypted, encryptionKey);

    // Get OAuth credentials
    const clientId = Deno.env.get('GHL_CLIENT_ID');
    const clientSecret = Deno.env.get('GHL_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error('GHL OAuth credentials not configured');
    }

    // Request new tokens using refresh token
    console.log('Requesting new tokens...');
    const tokenResponse = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token refresh failed:', tokenResponse.status, errorText);

      if (tokenResponse.status >= 400 && tokenResponse.status < 500) {
        const { error: stampError } = await supabase
          .from('ghl_oauth_tokens')
          .update({
            expires_at: '1970-01-01T00:00:00Z',
            updated_at: new Date().toISOString(),
          })
          .eq('id', tokenData.id);
        if (stampError) {
          console.error('Failed to stamp expires_at after dead refresh:', stampError);
        }
      }

      // GHL answers {"error":"invalid_grant","error_description":"Location is not active"}
      let detail = errorText.slice(0, 300);
      try {
        const parsed = JSON.parse(errorText);
        detail = [parsed?.error, parsed?.error_description].filter(Boolean).join(': ') || detail;
      } catch {
        // not JSON, keep the raw text
      }
      throw new Error(`GHL rejected token refresh (${tokenResponse.status}): ${detail}`);
    }

    const newTokenData = await tokenResponse.json();
    console.log('Token refresh successful');

    const { access_token, refresh_token: new_refresh_token, expires_in } = newTokenData;

    if (!access_token) {
      throw new Error('Missing access token in response');
    }

    // Encrypt new tokens
    const accessTokenEncrypted = await encryptApiKey(access_token, encryptionKey);
    const refreshTokenEncrypted = new_refresh_token 
      ? await encryptApiKey(new_refresh_token, encryptionKey)
      : tokenData.refresh_token_encrypted; // Keep old refresh token if not provided

    // Calculate new expiry time
    const expiresAt = new Date(Date.now() + (expires_in * 1000));

    // Update tokens in database
    const { error: updateError } = await supabase
      .from('ghl_oauth_tokens')
      .update({
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tokenData.id);

    if (updateError) {
      console.error('Failed to update tokens:', updateError);
      throw new Error('Failed to update OAuth tokens');
    }

    console.log('Tokens refreshed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Tokens refreshed successfully',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Token refresh error:', error);
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

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  try {
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}

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
