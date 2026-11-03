import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { getLatestGHLOAuthTokenRow } from "../_shared/ghl-oauth.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

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

    const { organizationId } = await req.json();

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    console.log('Fetching GHL accounts for organization:', organizationId);

    // Get GHL OAuth tokens for organization
    let tokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

    if (!tokenData) {
      console.log('No OAuth tokens found for organization:', organizationId);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'LeadConnector OAuth not connected. Please connect your GHL account via OAuth to access connected social media accounts.',
          needsOAuth: true 
        }),
        { 
          status: 200, // Return 200 to avoid frontend errors
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Check if token is expired or near expiry (refresh if < 5 minutes remaining)
    const expiresAt = new Date(tokenData.expires_at);
    const now = new Date();
    const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);

    if (minutesUntilExpiry < 5) {
      console.log('Token expired or near expiry, refreshing...');
      
      // Call refresh token function
      const refreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ organizationId }),
      });

      if (!refreshResponse.ok) {
        console.log('Token refresh failed — needs reconnect');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'LeadConnector OAuth token is expired. Please reconnect your GHL account.',
            needsReconnect: true,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      // Re-fetch updated tokens
      const refreshedTokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

      if (!refreshedTokenData) {
        throw new Error('Failed to get refreshed tokens');
      }

      tokenData = refreshedTokenData;
    }

    // Decrypt access token
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const accessToken = await decryptApiKey(tokenData.access_token_encrypted, encryptionKey);
    const locationId = tokenData.location_id;

    console.log('Fetching connected accounts for location:', locationId);

    // Fetch connected social accounts from GHL
    const response = await fetch(
      `https://services.leadconnectorhq.com/social-media-posting/${locationId}/accounts`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Version': '2021-07-28',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GHL API error:', response.status, errorText);
      
      if (response.status === 401) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'LeadConnector OAuth token is invalid or expired. Please reconnect your GHL account via OAuth.',
            needsReconnect: true 
          }),
          { 
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
      
      throw new Error(`Failed to fetch accounts: ${response.status}`);
    }

    const responseData = await response.json();
    console.log('GHL API Response:', JSON.stringify(responseData, null, 2));

    // Extract accounts from GHL response structure
    const accounts = responseData.results?.accounts || responseData.accounts || [];
    
    console.log('Connected accounts count:', accounts.length);
    
    // Log first account structure for debugging
    if (accounts.length > 0) {
      console.log('Sample account structure:', JSON.stringify(accounts[0], null, 2));
    }

    // Transform accounts for frontend
    const transformedAccounts = accounts.map((account: any) => {
      // GHL uses 'isExpired' field to indicate expired connections
      const isActive = !account.isExpired;
      
      console.log(`Account ${account.name}: platform=${account.platform}, isExpired=${account.isExpired}, isActive=${isActive}`);
      
      return {
        id: account.id || account._id,
        type: account.platform, // Use 'platform' field: facebook, instagram, linkedin, youtube, tiktok, etc.
        name: account.name || account.userName,
        username: account.userName || account.username,
        profileImage: account.profileImage || account.profilePicture || account.avatar || account.avatar,
        isActive,
      };
    });

    return new Response(
      JSON.stringify({ 
        success: true, 
        accounts: transformedAccounts,
        locationId,
        ghlUserId: tokenData.ghl_user_id || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Fetch GHL accounts error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
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
