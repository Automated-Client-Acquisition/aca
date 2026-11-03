/**
 * Unified auth for edge functions called by both the ACA app (Supabase JWT)
 * and the aca-cli (long-lived API token).
 *
 * - JWT in `Authorization: Bearer <jwt>` → resolved via supabase.auth.getUser,
 *   org derived from `public.users.active_organization_id || organization_id`
 *   (matches existing app pattern).
 * - API token in `Authorization: Bearer aca_<48 chars>` → resolved via
 *   `public.validate_api_token(sha256_hex(token))`. Org is whatever the token
 *   was issued for (frozen at issuance time).
 *
 * Returns { user_id, organization_id, auth_method } on success. Throws on
 * any failure; callers should catch and return a 401 response.
 *
 * Usage:
 *
 *   import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';
 *
 *   try {
 *     const { user_id, organization_id } = await authenticateRequest(req, supabase);
 *     // ...
 *   } catch (err) {
 *     return unauthorized(err, corsHeaders);
 *   }
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export interface AuthenticatedCaller {
  user_id: string;
  organization_id: string;
  auth_method: 'jwt' | 'api_token';
  token_id?: string; // present only for api_token
  scopes?: string[]; // present only for api_token
}

const API_TOKEN_PREFIX = 'aca_';

/**
 * Token scopes.
 *
 * - `cli`: everything that existed before scopes were enforced. Every token has
 *   it, so resources that declare no scope keep working for old tokens.
 * - `network`: /v1/network (ACA Network: tenants, mailboxes, warmup). Only issued
 *   to organizations whose network_status is 'approved'.
 * - `network:credentials`: reading mailbox sending credentials. Implies `network`.
 */
export const TOKEN_SCOPES = ['cli', 'network', 'network:credentials'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/**
 * Whether the caller may use a scope. Session (JWT) callers act as the signed-in
 * user and are not scope-limited; only API tokens carry scopes.
 */
export function callerHasScope(caller: AuthenticatedCaller, scope: TokenScope): boolean {
  if (caller.auth_method !== 'api_token') return true;
  return (caller.scopes ?? []).includes(scope);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function authenticateRequest(
  req: Request,
  supabase: SupabaseClient,
): Promise<AuthenticatedCaller> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new AuthError('Authorization header required');
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    throw new AuthError('Missing bearer token');
  }

  if (token.startsWith(API_TOKEN_PREFIX)) {
    return await resolveApiToken(token, supabase);
  }
  return await resolveJwt(token, supabase);
}

async function resolveJwt(
  token: string,
  supabase: SupabaseClient,
): Promise<AuthenticatedCaller> {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new AuthError('Invalid authorization token');
  }
  const user = data.user;

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('organization_id, active_organization_id')
    .eq('id', user.id)
    .maybeSingle();

  if (userErr) {
    throw new AuthError('Failed to resolve user organization', 500);
  }
  const organization_id =
    (userRow?.active_organization_id as string | undefined) ||
    (userRow?.organization_id as string | undefined);
  if (!organization_id) {
    throw new AuthError('User has no organization assigned');
  }
  return { user_id: user.id, organization_id, auth_method: 'jwt' };
}

async function resolveApiToken(
  token: string,
  supabase: SupabaseClient,
): Promise<AuthenticatedCaller> {
  const tokenHash = await sha256Hex(token);
  const { data, error } = await supabase.rpc('validate_api_token', { p_token_hash: tokenHash });
  if (error) {
    throw new AuthError('Token validation failed', 500);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.user_id || !row?.organization_id) {
    throw new AuthError('Invalid or revoked API token');
  }
  return {
    user_id: row.user_id,
    organization_id: row.organization_id,
    auth_method: 'api_token',
    token_id: row.token_id,
    scopes: row.scopes,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function unauthorized(err: unknown, corsHeaders: Record<string, string>): Response {
  const e = err as AuthError;
  const status = e?.status ?? 401;
  const message = e?.message ?? 'Unauthorized';
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Token generation helpers (used by cli-auth-issue)
// ---------------------------------------------------------------------------

/**
 * Generate a new API token. Returns the plaintext (to show the user once)
 * and the SHA-256 hash (to store in the database).
 *
 * Plaintext format: `aca_<43 base64url chars>` (32 random bytes → 43 chars).
 */
export async function generateApiToken(): Promise<{
  plaintext: string;
  hash: string;
  prefix: string;
}> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = base64urlEncode(bytes);
  const plaintext = `${API_TOKEN_PREFIX}${raw}`;
  const hash = await sha256Hex(plaintext);
  const prefix = plaintext.slice(0, 12); // `aca_` + 8 chars
  return { plaintext, hash, prefix };
}

function base64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
