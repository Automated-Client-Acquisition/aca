import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { UnipileV2Client } from '../_shared/unipile/index.ts';
import { resolveOrgV2Key, V2_PROVIDER_BY_ACA, v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { connectCompleteUrl } from '../_shared/unipile/connect-complete.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_DSN = 'https://api1.unipile.com:13111';

// All providers supported by Unipile hosted auth
const SUPPORTED_PROVIDERS = [
  'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'TELEGRAM',
  'MESSENGER', 'GOOGLE', 'OUTLOOK', 'MAIL', 'TWITTER',
];

/**
 * Unipile Connect Edge Function
 *
 * Creates a hosted authentication link for connecting accounts via Unipile.
 * v2 (apiVersion 'v2', LinkedIn, WhatsApp, Telegram, Instagram, Google, Outlook, IMAP): the org's
 * own v2 key when it saved one, otherwise ACA's platform key. v1 (Messenger, X, or apiVersion
 * omitted): the org's own v1 key and DSN, through the official SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { organizationId, provider, reconnectAccountId, apiVersion } = await req.json();

    if (!organizationId) {
      throw new Error('Organization ID is required');
    }

    // The service-role client below acts on whatever org the body names, so the
    // caller must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    if (!provider || !SUPPORTED_PROVIDERS.includes(provider.toUpperCase())) {
      throw new Error(`Provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }

    // Only an account this org already holds can be reconnected from it.
    let reconnectApiVersion: string | null = null;
    let reconnectKeyCopy: string | null = null;
    if (reconnectAccountId) {
      const { data: ownedAccount } = await supabase
        .from('unipile_accounts')
        .select('id, api_version, access_token_encrypted')
        .eq('organization_id', organizationId)
        .eq('unipile_account_id', reconnectAccountId)
        .maybeSingle();
      if (!ownedAccount) {
        return unauthorized({ status: 403, message: 'This account does not belong to your organization' }, corsHeaders);
      }
      reconnectApiVersion = ownedAccount.api_version;
      reconnectKeyCopy = ownedAccount.access_token_encrypted;
    }

    const normalizedProvider = provider.toUpperCase();
    const isReconnect = !!reconnectAccountId;
    console.log(`[Unipile Connect] ${isReconnect ? 'Reconnecting' : 'Initiating'} ${normalizedProvider} connection for org:`, organizationId);

    // v2: the org's own v2 application when it saved a v2 key, otherwise ACA's. No DSN.
    // A reconnect stays on the application the account already lives on.
    const v2Provider = V2_PROVIDER_BY_ACA[normalizedProvider];
    if (reconnectApiVersion === 'v2' || (!reconnectAccountId && apiVersion === 'v2')) {
      if (!reconnectAccountId && !v2Provider) {
        throw new Error(`${normalizedProvider} is not available on Unipile v2. Add a Unipile v1 API key in Settings > Integrations to connect it.`);
      }
      const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
      const apiKey = reconnectAccountId
        ? await v2ApiKeyForAccount({ access_token_encrypted: reconnectKeyCopy }, encryptionKey)
        : (await resolveOrgV2Key(supabase, organizationId, encryptionKey)).apiKey;
      const origin = req.headers.get('origin') || req.headers.get('referer')?.split('?')[0].replace(/\/$/, '');
      const authUrl = await createV2HostedAuthLink(
        supabase, new UnipileV2Client({ apiKey }), supabaseUrl, organizationId, origin ?? null,
        reconnectAccountId ? { accountId: reconnectAccountId } : { provider: v2Provider },
      );
      return new Response(
        JSON.stringify({ success: true, authUrl, provider: normalizedProvider, apiVersion: 'v2' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Unipile API key (checks org directly, then parent if inheriting)
    const apiKeyData = await resolveApiKey(supabase, organizationId, 'unipile');

    if (!apiKeyData?.key_encrypted) {
      throw new Error('Please add your Unipile API key and DSN URL in Settings > API Keys to use this feature.');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl(apiKeyData.metadata?.dsn_url);

    console.log('[Unipile Connect] Using organization\'s own Unipile API key (BYOK)');

    // Create Unipile SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Get the current app URL from the request origin (for redirect after auth)
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
      console.error('[Unipile Connect] Failed to store state:', stateError);
      throw new Error('Failed to initialize connection flow');
    }

    // Build the notify URL - Unipile will POST to this when auth completes
    const notifyUrl = `${supabaseUrl}/functions/v1/unipile-auth-callback?state=${state}`;

    // The popup lands on the app's /connect/complete page: Supabase serves function HTML as text/plain.
    const successRedirectUrl = connectCompleteUrl(origin, { ok: true, provider: normalizedProvider });
    const failureRedirectUrl = connectCompleteUrl(origin, {
      ok: false,
      provider: normalizedProvider,
      message: 'Authentication failed or was cancelled',
    });

    console.log('[Unipile Connect] Requesting hosted auth link via SDK...');
    console.log('[Unipile Connect] DSN:', unipileDsn);
    console.log('[Unipile Connect] Notify URL:', notifyUrl);

    // Request hosted authentication link using SDK
    let hostedAuth: Record<string, unknown>;
    try {
      // Fields shared by both the create and reconnect hosted-auth link shapes.
      const commonParams: Record<string, unknown> = {
        api_url: unipileDsn,
        name: state,
        expiresOn: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min expiry
        notify_url: notifyUrl,
        success_redirect_url: successRedirectUrl,
        failure_redirect_url: failureRedirectUrl,
        bypass_success_screen: false,
      };

      // Create and reconnect take DIFFERENT payload shapes (see Unipile's
      // HostedAuthLinkBodySchema). Reconnect MUST send type:'reconnect' with
      // reconnect_account as a bare account_id STRING and NO providers array.
      // Sending type:'create' (with reconnect_account as an object, as this
      // previously did) makes Unipile ignore the reconnect and mint a brand-new
      // account_id — leaving a duplicate on /senders (the "Expired" original
      // plus an "Available" freshly-created row for the same person).
      const hostedAuthParams: Record<string, unknown> = isReconnect
        ? {
            ...commonParams,
            type: 'reconnect',
            reconnect_account: reconnectAccountId,
          }
        : {
            ...commonParams,
            type: 'create',
            providers: [normalizedProvider],
          };

      hostedAuth = await client.account.createHostedAuthLink(hostedAuthParams) as Record<string, unknown>;
    } catch (sdkError) {
      const parsed = parseUnipileError(sdkError);
      console.error('[Unipile Connect] SDK error:', parsed.code, parsed.message);
      if (parsed.code === 'AUTHENTICATION_FAILED') {
        throw new Error('Your Unipile API key is invalid or expired. Please update it in Settings > API Keys.');
      }
      throw new Error(`Unipile API error: ${parsed.message}`);
    }

    console.log('[Unipile Connect] Hosted auth response:', JSON.stringify(hostedAuth));

    // Unipile returns the URL in the 'url' field
    const authUrl = (hostedAuth as Record<string, unknown>).url ||
                    (hostedAuth as Record<string, unknown>).hosted_auth_link;

    if (!authUrl) {
      console.error('[Unipile Connect] No auth URL in response:', hostedAuth);
      throw new Error('No authentication URL returned from Unipile');
    }

    console.log('[Unipile Connect] Generated auth URL for state:', state);

    return new Response(
      JSON.stringify({
        success: true,
        authUrl,
        state,
        provider: normalizedProvider,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Unipile Connect] Error:', error);
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

/**
 * Hosted auth link on a v2 application. `state` maps the new account to the org: the callback
 * and the account.add webhook only accept a state they find in oauth_states, never an account id
 * on its own.
 */
async function createV2HostedAuthLink(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any>,
  client: UnipileV2Client,
  supabaseUrl: string,
  organizationId: string,
  appUrl: string | null,
  target: { accountId: string } | { provider: string },
): Promise<string> {
  const state = crypto.randomUUID();
  const { error: stateError } = await supabase.from('oauth_states').insert({
    state,
    organization_id: organizationId,
    app_url: appUrl,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  if (stateError) {
    console.error('[Unipile Connect] Failed to store v2 state:', stateError);
    throw new Error('Failed to initialize connection flow');
  }

  const body: Record<string, unknown> = {
    expires_on: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    redirect_uri: `${supabaseUrl}/functions/v1/unipile-v2-auth-callback`,
    state,
  };
  // New account and reconnect are told apart by `providers` xor `account_id`.
  if ('accountId' in target) body.account_id = target.accountId;
  else body.providers = target.provider;

  const link = await client.post<{ link?: string }>('/auth/link', { body });
  if (!link?.link) throw new Error('No authentication URL returned from Unipile');
  return link.link;
}
