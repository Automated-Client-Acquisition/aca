/**
 * Google Postmaster Tools OAuth + API client (Phase 8.2.1).
 *
 * One OAuth client per ACA installation (env: GOOGLE_POSTMASTER_CLIENT_ID +
 * GOOGLE_POSTMASTER_CLIENT_SECRET). Each org connects once via the consent
 * popup; we store the refresh token encrypted and refresh access tokens on
 * demand.
 *
 * Scopes:
 *   https://www.googleapis.com/auth/postmaster.readonly
 *
 * Auth redirect URI:
 *   https://<project>.supabase.co/functions/v1/infra-postmaster-oauth-callback
 */

import { encryptValue, decryptValue } from './encryption.ts';

const POSTMASTER_SCOPE = 'https://www.googleapis.com/auth/postmaster.readonly';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const POSTMASTER_API = 'https://gmailpostmastertools.googleapis.com/v1';

// ── OAuth flow ──────────────────────────────────────────────────────────────

export interface OAuthClientConfig {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
}

export function getOAuthConfig(): OAuthClientConfig {
  const client_id = Deno.env.get('GOOGLE_POSTMASTER_CLIENT_ID');
  const client_secret = Deno.env.get('GOOGLE_POSTMASTER_CLIENT_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!client_id || !client_secret || !supabaseUrl) {
    throw new Error('GOOGLE_POSTMASTER_CLIENT_ID, GOOGLE_POSTMASTER_CLIENT_SECRET, SUPABASE_URL must be set');
  }
  return {
    client_id,
    client_secret,
    redirect_uri: `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/infra-postmaster-oauth-callback`,
  };
}

/**
 * Build the Google consent URL. State is the org_id (passed back unchanged) so
 * the callback knows which org to associate the token with.
 */
export function buildAuthUrl(state: string): string {
  const cfg = getOAuthConfig();
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: cfg.redirect_uri,
    response_type: 'code',
    scope: POSTMASTER_SCOPE,
    access_type: 'offline',          // Required to get a refresh_token
    prompt: 'consent',                // Force showing consent so a refresh_token is always returned
    include_granted_scopes: 'true',
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface GoogleUserInfoResponse {
  email?: string;
  email_verified?: boolean;
}

/**
 * Exchange the authorization code for refresh + access tokens.
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const cfg = getOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    redirect_uri: cfg.redirect_uri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  return await res.json() as GoogleTokenResponse;
}

/**
 * Refresh an access token using a stored refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const cfg = getOAuthConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.client_id,
    client_secret: cfg.client_secret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  return await res.json() as GoogleTokenResponse;
}

/**
 * Fetch the authorized account's email so we can show it in the UI.
 */
export async function getAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json() as GoogleUserInfoResponse;
    return json.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Revoke a refresh token. After this the token is invalid forever.
 */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, {
    method: 'POST',
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ── Token storage helpers ───────────────────────────────────────────────────

export interface StoredPostmasterTokens {
  refresh_token: string;
  access_token: string | null;
  expires_at: Date | null;
  account_email: string | null;
}

/**
 * Decrypt the stored row. Returns null if no row, expired, or decrypt fails.
 */
export async function getDecryptedTokens(
  supabase: import('https://esm.sh/@supabase/supabase-js@2.81.1').SupabaseClient<any>,
  organization_id: string,
): Promise<StoredPostmasterTokens | null> {
  const { data: row } = await supabase
    .from('postmaster_oauth_tokens')
    .select('refresh_token_encrypted, access_token_encrypted, access_token_expires_at, account_email, status')
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!row || row.status !== 'connected' || !row.refresh_token_encrypted) return null;
  try {
    return {
      refresh_token: await decryptValue(row.refresh_token_encrypted as string),
      access_token: row.access_token_encrypted ? await decryptValue(row.access_token_encrypted as string) : null,
      expires_at: row.access_token_expires_at ? new Date(row.access_token_expires_at as string) : null,
      account_email: row.account_email as string | null,
    };
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, refreshing it if expired/missing. Persists the
 * refreshed access_token back to the row.
 */
export async function getValidAccessToken(
  supabase: import('https://esm.sh/@supabase/supabase-js@2.81.1').SupabaseClient<any>,
  organization_id: string,
): Promise<string | null> {
  const stored = await getDecryptedTokens(supabase, organization_id);
  if (!stored) return null;

  // Use existing access token if it has >2 minutes of life left.
  if (stored.access_token && stored.expires_at && stored.expires_at.getTime() > Date.now() + 120_000) {
    return stored.access_token;
  }

  // Otherwise refresh.
  try {
    const refreshed = await refreshAccessToken(stored.refresh_token);
    const newAccess = refreshed.access_token;
    const newExpires = new Date(Date.now() + refreshed.expires_in * 1000);
    await supabase
      .from('postmaster_oauth_tokens')
      .update({
        access_token_encrypted: await encryptValue(newAccess),
        access_token_expires_at: newExpires.toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('organization_id', organization_id);
    return newAccess;
  } catch (e) {
    await supabase
      .from('postmaster_oauth_tokens')
      .update({ status: 'error', last_error: e instanceof Error ? e.message : 'Token refresh failed' })
      .eq('organization_id', organization_id);
    return null;
  }
}

// ── Postmaster Tools API ────────────────────────────────────────────────────

export interface PostmasterDomain {
  name: string;                                    // 'domains/sales.acquist.io'
  createTime: string;
  permission: 'OWNER' | 'READER' | string;
}

export interface PostmasterTrafficStats {
  name: string;                                    // 'domains/sales.acquist.io/trafficStats/20260429'
  userReportedSpamRatio?: number;                  // 0.0-1.0
  ipReputations?: Array<{ reputation: string; ipCount?: string; sampleIps?: string[] }>;
  domainReputation?: 'BAD' | 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | string;
  dkimSuccessRatio?: number;
  spfSuccessRatio?: number;
  dmarcSuccessRatio?: number;
  deliveryErrors?: Array<{ errorType: string; errorClass: string; errorRatio: number }>;
}

/**
 * List domains registered with Postmaster Tools for the authorized account.
 */
export async function listDomains(accessToken: string): Promise<PostmasterDomain[]> {
  const res = await fetch(`${POSTMASTER_API}/domains`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Postmaster listDomains: ${res.status} ${await res.text()}`);
  const json = await res.json() as { domains?: PostmasterDomain[] };
  return json.domains ?? [];
}

/**
 * Register a new domain with Postmaster Tools. Returns the registered domain
 * resource. Requires the user has added the google-site-verification TXT
 * record at the domain (we surface it during BYO domain provisioning).
 */
export async function registerDomain(accessToken: string, domain: string): Promise<PostmasterDomain> {
  const res = await fetch(`${POSTMASTER_API}/domains?domainName=${encodeURIComponent(domain)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmaster registerDomain: ${res.status} ${text}`);
  }
  return await res.json() as PostmasterDomain;
}

/**
 * Get the most recent traffic stats for a domain. Postmaster returns daily
 * buckets; we fetch the most recent one. Returns null on 404 (domain not yet
 * verified or has no data yet).
 */
export async function getLatestTrafficStats(
  accessToken: string,
  domain: string,
): Promise<PostmasterTrafficStats | null> {
  const url = `${POSTMASTER_API}/domains/${encodeURIComponent(domain)}/trafficStats:latest`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Postmaster getLatestTrafficStats: ${res.status} ${await res.text()}`);
  return await res.json() as PostmasterTrafficStats;
}
