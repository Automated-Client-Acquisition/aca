import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, encryptApiKey, isPersistableProvider, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { unipileWebhookHeaders } from '../_shared/unipile-webhook-auth.ts';
import { redirectToConnectComplete } from '../_shared/unipile/connect-complete.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_DSN = 'https://api1.unipile.com:13111';

function splitDisplayName(displayName: string | null): { firstName: string | null; lastName: string | null } {
  const normalized = (displayName || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { firstName: null, lastName: null };

  const [firstName, ...lastNameParts] = normalized.split(' ');
  return {
    firstName: firstName || null,
    lastName: lastNameParts.join(' ') || null,
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Unipile Auth Callback Edge Function
 *
 * Called by Unipile's hosted auth when a user completes authentication.
 * Uses the official Unipile SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Helper: sanitize strings for safe HTML/JS interpolation
  const sanitizeForHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const sanitizeAlphaNum = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

  // Handle GET requests — Unipile redirects the popup browser here after auth (links created
  // before connect started redirecting straight to the app). Supabase serves function HTML as
  // text/plain, so send the popup to the app's /connect/complete page.
  const reqUrl = new URL(req.url);
  if (req.method === 'GET' && reqUrl.searchParams.get('mode') === 'redirect') {
    const provider = sanitizeAlphaNum(reqUrl.searchParams.get('provider') || '');
    const isError = reqUrl.searchParams.get('error') === 'true';
    return redirectToConnectComplete(null, {
      ok: !isError,
      provider: provider || null,
      message: isError ? 'Authentication failed or was cancelled' : null,
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Get state from query params
    const url = new URL(req.url);
    const state = url.searchParams.get('state');

    console.log('[Unipile Callback] Received callback');
    console.log('[Unipile Callback] State from URL:', state);

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

    console.log('[Unipile Callback] Payload:', JSON.stringify(payload, null, 2));

    const {
      account_id,
      name,
      type,
      connection_params,
    } = payload as {
      account_id?: string;
      name?: string;
      type?: string;
      connection_params?: Record<string, unknown>;
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
      console.error('[Unipile Callback] Invalid state:', stateError);
      throw new Error('Invalid or expired state parameter');
    }

    if (new Date(stateData.expires_at) < new Date()) {
      throw new Error('State parameter expired');
    }

    const organizationId = stateData.organization_id;
    const appUrl = stateData.app_url;

    console.log('[Unipile Callback] Organization ID:', organizationId);
    console.log('[Unipile Callback] Account ID:', account_id);

    // Get Unipile credentials (checks org directly, then parent if inheriting)
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

    const apiKeyData = await resolveApiKey(supabase, organizationId, 'unipile');

    if (!apiKeyData?.key_encrypted) {
      throw new Error('Unipile API key not configured. Please add your API key in Settings > API Keys.');
    }

    console.log(`[Unipile Callback] Using Unipile API key from org: ${apiKeyData.source_organization_id}`);
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl(apiKeyData.metadata?.dsn_url);

    // Create SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Fetch full account details using SDK
    let accountDetails: Record<string, unknown> | null = null;
    try {
      accountDetails = await client.request.send({
        path: ['accounts', String(account_id)],
        method: 'GET',
      }) as Record<string, unknown>;
      console.log('[Unipile Callback] Account details:', JSON.stringify(accountDetails, null, 2));
    } catch (e) {
      console.warn('[Unipile Callback] Could not fetch account details:', e);
    }

    // Extract profile info
    const provider = String(type || accountDetails?.type || '').toUpperCase();
    if (!isPersistableProvider(provider)) {
      console.error(`[Unipile Callback] unsupported account type '${type || accountDetails?.type}' for ${account_id}`);
      throw new Error(`Unsupported account type: ${type || accountDetails?.type || 'missing'}`);
    }
    const connParams = connection_params || accountDetails?.connection_params as Record<string, unknown>;
    const imParams = connParams?.im as Record<string, unknown>;
    const displayName = stringOrNull(accountDetails?.name) || stringOrNull(imParams?.username);
    const username = stringOrNull(imParams?.username);
    // Fetch avatar from the user's own LinkedIn profile
    let avatarUrl: string | null = null;
    const profileIdentifier = imParams?.publicIdentifier || imParams?.id;
    if (profileIdentifier) {
      try {
        const profileRes = await fetch(
          `${unipileDsn}/api/v1/users/${encodeURIComponent(String(profileIdentifier))}?account_id=${account_id}`,
          {
            method: 'GET',
            headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
          }
        );
        if (profileRes.ok) {
          const profile = await profileRes.json() as Record<string, unknown>;
          avatarUrl = (
            profile?.profile_picture_url ||
            profile?.avatar_url ||
            profile?.picture_url ||
            profile?.image_url ||
            null
          ) as string | null;
        }
      } catch (e) {
        console.warn('[Unipile Callback] Could not fetch profile avatar:', e);
      }
    }

    // Encrypt the API key for storage
    const accessTokenEncrypted = await encryptApiKey(unipileApiKey, encryptionKey);
    const senderNameParts = splitDisplayName(displayName);

    // Upsert the account into our database
    const { data: accountData, error: accountError } = await supabase
      .from('unipile_accounts')
      .upsert({
        organization_id: organizationId,
        unipile_account_id: account_id,
        provider,
        display_name: displayName,
        first_name: senderNameParts.firstName,
        last_name: senderNameParts.lastName,
        username: username,
        profile_url: null,
        avatar_url: avatarUrl,
        access_token_encrypted: accessTokenEncrypted,
        dsn_url: unipileDsn,
        status: 'active',
        last_synced_at: new Date().toISOString(),
        metadata: {
          connection_params: connParams,
          sources: accountDetails?.sources,
        },
      }, {
        onConflict: 'organization_id,unipile_account_id',
      })
      .select()
      .single();

    if (accountError) {
      console.error('[Unipile Callback] Failed to store account:', accountError);
      throw new Error('Failed to store account credentials');
    }

    console.log('[Unipile Callback] Account stored successfully:', accountData?.id);

    // ── Auto-migrate references from stale duplicates of this same profile ──
    // Connecting an already-connected profile with a 'create' link (instead of
    // 'reconnect') makes Unipile mint a new account_id, so a new row. Older active
    // rows for the SAME provider user (connection_params.im.id) are stale: migrate
    // campaigns and pending messages to the new account, then mark them disconnected.
    // Other accounts of the same provider are separate senders and must be left
    // alone; matching on provider alone disconnected them and scrubbed them from
    // every campaign.
    const providerUserId = stringOrNull(imParams?.id);
    if (accountData?.id && providerUserId) {
      const upperProvider = String(provider).toUpperCase();
      const { data: staleAccounts } = await supabase
        .from('unipile_accounts')
        .select('id, unipile_account_id')
        .eq('organization_id', organizationId)
        .eq('provider', upperProvider)
        .eq('status', 'active')
        .eq('metadata->connection_params->im->>id', providerUserId)
        .neq('id', accountData.id);

      if (staleAccounts && staleAccounts.length > 0) {
        for (const stale of staleAccounts) {
          console.log(`[Unipile Callback] Migrating references from stale account ${stale.id} (${stale.unipile_account_id}) to new account ${accountData.id}`);

          // Migrate campaign references
          const { data: migratedCampaigns } = await supabase
            .from('unipile_campaigns')
            .update({ account_id: accountData.id })
            .eq('account_id', stale.id)
            .select('id');

          // Migrate pending messages in the DM queue
          const { data: migratedQueueItems } = await supabase
            .from('unipile_message_queue')
            .update({ account_id: accountData.id })
            .eq('account_id', stale.id)
            .eq('status', 'pending')
            .select('id');

          // Mark old account as disconnected — this triggers handle_sender_account_disconnected
          // which clears sender_account_id on pending campaign leads and freezes in-progress ones
          await supabase
            .from('unipile_accounts')
            .update({
              status: 'disconnected',
              error_message: `Superseded by reconnected account ${accountData.id}`,
            })
            .eq('id', stale.id);

          console.log(`[Unipile Callback] Migrated ${migratedCampaigns?.length ?? 0} campaigns, ${migratedQueueItems?.length ?? 0} pending messages from stale account ${stale.id}`);
        }
      }
    }

    // Register webhooks for the connected account
    // Unipile requires separate webhooks per source type
    if (accountData?.id) {
      const upperProvider = String(provider).toUpperCase();
      const webhookUrl = `${supabaseUrl}/functions/v1/unipile-webhook-handler`;
      const webhookIds: string[] = [];

      // 1. Messaging webhook (all providers)
      try {
        console.log('[Unipile Callback] Registering messaging webhook for account:', account_id);
        const msgWebhook = await client.request.send({
          path: ['webhooks'],
          method: 'POST',
          body: {
            account_ids: [account_id],
            request_url: webhookUrl,
            source: 'messaging',
            events: ['message_received'],
            format: 'json',
            enabled: true,
            headers: await unipileWebhookHeaders(),
          },
        }) as Record<string, unknown>;
        console.log('[Unipile Callback] Messaging webhook registered:', msgWebhook);
        const msgId = msgWebhook.id || msgWebhook.webhook_id;
        if (msgId) webhookIds.push(String(msgId));
      } catch (webhookError) {
        console.error('[Unipile Callback] Error registering messaging webhook:', webhookError);
      }

      // 2. Users webhook for LinkedIn (new_relation events)
      if (upperProvider === 'LINKEDIN') {
        try {
          console.log('[Unipile Callback] Registering users webhook for account:', account_id);
          const usersWebhook = await client.request.send({
            path: ['webhooks'],
            method: 'POST',
            body: {
              account_ids: [account_id],
              request_url: webhookUrl,
              source: 'users',
              events: ['new_relation'],
              format: 'json',
              enabled: true,
              headers: await unipileWebhookHeaders(),
            },
          }) as Record<string, unknown>;
          console.log('[Unipile Callback] Users webhook registered:', usersWebhook);
          const usersId = usersWebhook.id || usersWebhook.webhook_id;
          if (usersId) webhookIds.push(String(usersId));
        } catch (webhookError) {
          console.error('[Unipile Callback] Error registering users webhook:', webhookError);
        }
      }

      // Store webhook IDs in account metadata
      if (webhookIds.length > 0) {
        await supabase
          .from('unipile_accounts')
          .update({
            metadata: {
              ...(accountData.metadata as Record<string, unknown>),
              webhook_ids: webhookIds,
              webhook_registered_at: new Date().toISOString(),
            },
          })
          .eq('id', accountData.id);
      }
    }

    // Trigger initial sync asynchronously
    if (accountData?.id) {
      try {
        const syncUrl = `${supabaseUrl}/functions/v1/unipile-sync-history`;
        const syncPromise = fetch(syncUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_id: accountData.id,
            limit: 50,
            messages_per_conversation: 20,
          }),
        }).catch(console.error);

        if ((globalThis as any).EdgeRuntime?.waitUntil) {
          (globalThis as any).EdgeRuntime.waitUntil(syncPromise);
        }
      } catch (syncError) {
        console.error('[Unipile Callback] Error triggering sync:', syncError);
      }
    }

    // For LinkedIn, also backfill the user's network so campaigns targeting
    // existing connections work immediately without the user clicking "Sync".
    if (accountData?.id && String(provider).toUpperCase() === 'LINKEDIN') {
      try {
        const connectionsSyncUrl = `${supabaseUrl}/functions/v1/unipile-sync-connections`;
        const connectionsPromise = fetch(connectionsSyncUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account_id: accountData.id,
            limit: 1000,
            max_total: 5000,
          }),
        }).catch(console.error);

        if ((globalThis as any).EdgeRuntime?.waitUntil) {
          (globalThis as any).EdgeRuntime.waitUntil(connectionsPromise);
        }
      } catch (connectionsError) {
        console.error('[Unipile Callback] Error triggering connections sync:', connectionsError);
      }
    }

    // Clean up the used state
    await supabase.from('oauth_states').delete().eq('state', effectiveState);

    // Return success HTML
    const redirectUrl = `${appUrl}/settings?unipile_connected=true&provider=${String(provider).toLowerCase()}&tab=integrations`;

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Connected Successfully</title>
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
            .provider { font-weight: 600; color: #4f46e5; }
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
            <h1>Connected Successfully!</h1>
            <p>Your <span class="provider">${sanitizeForHtml(String(provider))}</span> account has been connected.</p>
            <p class="closing-text">Redirecting...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'UNIPILE_OAUTH_SUCCESS',
                provider: '${sanitizeAlphaNum(String(provider).toLowerCase())}'
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
    console.error('[Unipile Callback] Error:', error);

    const rawErrorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorMessage = sanitizeForHtml(rawErrorMessage);

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
            <div class="error-message">${errorMessage}</div>
            <p>Please try connecting again or contact support.</p>
            <p class="closing-text">This window will close automatically...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'UNIPILE_OAUTH_ERROR',
                error: '${errorMessage}'
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
