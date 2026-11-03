import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Calendar Auth Callback Edge Function
 *
 * Called by Unipile's hosted auth when a user completes calendar authentication.
 * Stores the calendar account and fetches available calendars.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Handle GET requests — Unipile redirects the popup browser here after auth
  const reqUrl = new URL(req.url);
  if (req.method === 'GET' && reqUrl.searchParams.get('mode') === 'redirect') {
    const provider = reqUrl.searchParams.get('provider') || 'unknown';
    const isError = reqUrl.searchParams.get('error') === 'true';

    if (isError) {
      return new Response(`<!DOCTYPE html><html><head><title>Connection Failed</title></head><body>
<script>
if (window.opener) {
  window.opener.postMessage({ type: 'CALENDAR_OAUTH_ERROR', error: 'Calendar authentication failed or was cancelled' }, '*');
}
setTimeout(function() { window.close(); }, 1500);
</script>
<p>Connection failed. This window will close automatically...</p>
</body></html>`, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    return new Response(`<!DOCTYPE html><html><head><title>Calendar Connected!</title></head><body>
<script>
if (window.opener) {
  window.opener.postMessage({ type: 'CALENDAR_OAUTH_SUCCESS', provider: '${provider}' }, '*');
}
setTimeout(function() { window.close(); }, 1500);
</script>
<p>Calendar connected! This window will close automatically...</p>
</body></html>`, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get state from query params
    const url = new URL(req.url);
    const state = url.searchParams.get('state');

    console.log('[Calendar Callback] Received callback');
    console.log('[Calendar Callback] State from URL:', state);

    // Parse the body (Unipile sends JSON)
    let payload: Record<string, unknown> = {};
    if (req.method === 'POST') {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        payload = await req.json();
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const body = await req.text();
        const params = new URLSearchParams(body);
        payload = Object.fromEntries(params);
      }
    }

    console.log('[Calendar Callback] Payload:', JSON.stringify(payload, null, 2));

    const {
      account_id,
      name,
      type,
    } = payload as {
      account_id?: string;
      name?: string;
      type?: string;
    };

    // Use the name field as state if state not in URL
    const effectiveState = state || name;

    if (!effectiveState) {
      throw new Error('Missing state parameter');
    }

    if (!account_id) {
      throw new Error('Missing account_id in callback');
    }

    // Verify state and get organization ID
    const { data: stateData, error: stateError } = await supabase
      .from('oauth_states')
      .select('organization_id, expires_at, app_url')
      .eq('state', effectiveState)
      .single();

    if (stateError || !stateData) {
      console.error('[Calendar Callback] Invalid state:', stateError);
      throw new Error('Invalid or expired state parameter');
    }

    if (new Date(stateData.expires_at) < new Date()) {
      throw new Error('State parameter expired');
    }

    const organizationId = stateData.organization_id;
    const appUrl = stateData.app_url;

    console.log('[Calendar Callback] Organization ID:', organizationId);
    console.log('[Calendar Callback] Account ID:', account_id);

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

    console.log('[Calendar Callback] Using BYOK');
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl((apiKeyData.metadata as Record<string, string>)?.dsn_url);

    // Create SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Fetch full account details using SDK
    let accountDetails: Record<string, unknown> | null = null;
    try {
      accountDetails = await client.request.send({
        path: `/api/v1/accounts/${account_id}`,
        method: 'GET',
      }) as Record<string, unknown>;
      console.log('[Calendar Callback] Account details:', JSON.stringify(accountDetails, null, 2));
    } catch (e) {
      console.warn('[Calendar Callback] Could not fetch account details:', e);
    }

    // Extract provider info
    const accountType = type || accountDetails?.type || 'UNKNOWN';
    const provider = accountType.includes('GOOGLE') ? 'google' : 'microsoft';

    // Get email from account details
    const email = (accountDetails?.identifier as string) ||
                  (accountDetails?.email as string) ||
                  (accountDetails?.name as string) ||
                  'unknown@calendar.com';

    // Get the user who initiated this connection from oauth_states metadata
    // For now, we'll get the first admin/owner of the organization
    const { data: orgMember } = await supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', organizationId)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .maybeSingle();

    const userId = orgMember?.user_id;

    if (!userId) {
      throw new Error('Could not determine user for calendar connection');
    }

    // Insert the calendar account
    const { data: calendarAccount, error: insertError } = await supabase
      .from('calendar_accounts')
      .upsert({
        organization_id: organizationId,
        user_id: userId,
        unipile_account_id: account_id,
        provider,
        email,
        name: accountDetails?.name as string || email,
        status: 'active',
        last_sync_at: new Date().toISOString(),
      }, {
        onConflict: 'organization_id,unipile_account_id',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Calendar Callback] Failed to store calendar account:', insertError);
      throw new Error('Failed to store calendar account');
    }

    console.log('[Calendar Callback] Calendar account stored:', calendarAccount.id);

    // Fetch available calendars from this account
    try {
      console.log('[Calendar Callback] Fetching calendars for account:', account_id);
      const calendarsResponse = await client.request.send({
        path: '/api/v1/calendars',
        method: 'GET',
        query: { account_id },
      }) as { items?: Array<Record<string, unknown>> };

      console.log('[Calendar Callback] Calendars response:', JSON.stringify(calendarsResponse, null, 2));

      // Store calendars list in metadata for later selection
      if (calendarsResponse?.items && calendarsResponse.items.length > 0) {
        await supabase
          .from('calendar_accounts')
          .update({
            metadata: {
              calendars: calendarsResponse.items.map((cal: Record<string, unknown>) => ({
                id: cal.id,
                name: cal.name || cal.summary,
                is_primary: cal.is_primary || false,
              })),
            },
          })
          .eq('id', calendarAccount.id);
      }
    } catch (calError) {
      console.error('[Calendar Callback] Error fetching calendars:', calError);
      // Non-fatal - continue anyway
    }

    // Clean up the used state
    await supabase.from('oauth_states').delete().eq('state', effectiveState);

    // Return success HTML
    const redirectUrl = `${appUrl}/settings?calendar_connected=true&provider=${provider}&tab=calendar`;

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Calendar Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 16px;
              padding: 48px 32px;
              max-width: 400px;
              width: 100%;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              text-align: center;
            }
            .checkmark-circle {
              width: 80px;
              height: 80px;
              margin: 0 auto 24px;
              background: linear-gradient(135deg, #10b981 0%, #059669 100%);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .checkmark {
              width: 40px;
              height: 40px;
              stroke: white;
              stroke-width: 3;
              stroke-linecap: round;
              stroke-linejoin: round;
              fill: none;
            }
            h1 { font-size: 28px; font-weight: 700; color: #1f2937; margin-bottom: 12px; }
            p { font-size: 16px; color: #6b7280; line-height: 1.5; }
            .provider { font-weight: 600; color: #4f46e5; text-transform: capitalize; }
            .closing-text { margin-top: 32px; font-size: 14px; color: #9ca3af; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark-circle">
              <svg class="checkmark" viewBox="0 0 52 52">
                <path d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
              </svg>
            </div>
            <h1>Calendar Connected!</h1>
            <p>Your <span class="provider">${provider}</span> calendar has been connected successfully.</p>
            <p class="closing-text">Redirecting...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'CALENDAR_OAUTH_SUCCESS',
                provider: '${provider}'
              }, '*');
              setTimeout(() => window.close(), 2000);
            } else {
              setTimeout(() => {
                window.location.href = '${redirectUrl}';
              }, 2000);
            }
          </script>
        </body>
      </html>
    `, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('[Calendar Callback] Error:', error);

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const safeErrorHtml = errorMessage.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeErrorJs = JSON.stringify(errorMessage);

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connection Failed</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #f59e0b 0%, #dc2626 100%);
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .container {
              background: white;
              border-radius: 16px;
              padding: 48px 32px;
              max-width: 400px;
              width: 100%;
              box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
              text-align: center;
            }
            .error-circle {
              width: 80px;
              height: 80px;
              margin: 0 auto 24px;
              background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .error-icon {
              width: 40px;
              height: 40px;
              stroke: white;
              stroke-width: 3;
              stroke-linecap: round;
              fill: none;
            }
            h1 { font-size: 28px; font-weight: 700; color: #1f2937; margin-bottom: 12px; }
            .error-message {
              font-size: 14px;
              color: #dc2626;
              background: #fef2f2;
              padding: 12px 16px;
              border-radius: 8px;
              margin: 16px 0;
              border: 1px solid #fecaca;
            }
            p { font-size: 16px; color: #6b7280; line-height: 1.5; }
            .closing-text { margin-top: 24px; font-size: 14px; color: #9ca3af; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-circle">
              <svg class="error-icon" viewBox="0 0 52 52">
                <line x1="16" y1="16" x2="36" y2="36"/>
                <line x1="36" y1="16" x2="16" y2="36"/>
              </svg>
            </div>
            <h1>Connection Failed</h1>
            <div class="error-message">${safeErrorHtml}</div>
            <p>Please try connecting again or contact support.</p>
            <p class="closing-text">This window will close automatically...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'CALENDAR_OAUTH_ERROR',
                error: ${safeErrorJs}
              }, '*');
              setTimeout(() => window.close(), 3000);
            }
          </script>
        </body>
      </html>
    `, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  }
});
