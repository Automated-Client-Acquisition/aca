/**
 * Edge Function: CLI Auth Issue
 *
 * Mints a new long-lived API token for the authenticated user, bound to their
 * current active organization. Plaintext is returned ONCE; only the SHA-256
 * hash is persisted.
 *
 * Authentication: Supabase JWT only (never an existing API token — issuing
 * tokens from a token would enable privilege escalation if a token leaks).
 *
 * Input:  { name: string, expires_in_days?: number, scopes?: string[] }
 * Output: { id, name, token: <plaintext>, token_prefix, expires_at, organization_id, scopes }
 *
 * Every token gets `cli`. `network` and `network:credentials` are only issued
 * when the organization's ACA Network access is approved; `network:credentials`
 * implies `network`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { generateApiToken, TOKEN_SCOPES, type TokenScope } from '../_shared/cli-auth.ts';

const DEFAULT_EXPIRY_DAYS = 365;
const MAX_EXPIRY_DAYS = 365 * 2;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Strictly require a JWT (not an API token).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(401, { error: 'Authorization header required' });
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token.startsWith('aca_')) {
      return json(403, {
        error: 'API tokens cannot issue other API tokens. Sign in via the web app to create a token.',
      });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json(401, { error: 'Invalid authorization token' });
    }
    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const name: string | undefined = body?.name?.trim();
    const expiresInDays: number = clampExpiry(body?.expires_in_days);

    if (!name) {
      return json(400, { error: 'name is required' });
    }
    if (name.length > 80) {
      return json(400, { error: 'name must be 80 characters or less' });
    }

    // Resolve org from users table (same pattern as the app).
    const { data: userRow, error: rowErr } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (rowErr) {
      return json(500, { error: 'Failed to resolve user organization' });
    }
    const organizationId =
      (userRow?.active_organization_id as string | undefined) ||
      (userRow?.organization_id as string | undefined);
    if (!organizationId) {
      return json(403, { error: 'User has no active organization. Switch organizations in the app first.' });
    }

    const requested: unknown[] = Array.isArray(body?.scopes) ? body.scopes : [];
    const unknownScope = requested.find((s) => !TOKEN_SCOPES.includes(s as TokenScope));
    if (unknownScope !== undefined) {
      return json(400, { error: `Unknown scope: ${String(unknownScope)}` });
    }
    const scopes = new Set<TokenScope>(['cli', ...(requested as TokenScope[])]);
    if (scopes.has('network:credentials')) scopes.add('network');

    if (scopes.has('network')) {
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .select('network_status')
        .eq('id', organizationId)
        .maybeSingle();
      if (orgErr) {
        return json(500, { error: 'Failed to check network access' });
      }
      if (org?.network_status !== 'approved') {
        return json(403, {
          error: 'Network scopes need approved ACA Network access. Apply in Settings → ACA Network.',
        });
      }
    }

    // Mint the token.
    const { plaintext, hash, prefix } = await generateApiToken();
    const expiresAt = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();

    const { data: inserted, error: insErr } = await supabase
      .from('api_tokens')
      .insert({
        user_id: user.id,
        organization_id: organizationId,
        name,
        token_hash: hash,
        token_prefix: prefix,
        expires_at: expiresAt,
        scopes: [...scopes],
      })
      .select('id, name, token_prefix, expires_at, organization_id, created_at, scopes')
      .single();

    if (insErr) {
      // Duplicate name? Surface a clean error.
      if (insErr.code === '23505') {
        return json(409, { error: 'A token with that name already exists. Choose a different name.' });
      }
      return json(500, { error: 'Failed to create token', detail: insErr.message });
    }

    return json(200, {
      id: inserted.id,
      name: inserted.name,
      token: plaintext, // shown ONCE
      token_prefix: inserted.token_prefix,
      expires_at: inserted.expires_at,
      organization_id: inserted.organization_id,
      created_at: inserted.created_at,
      scopes: inserted.scopes,
    });
  } catch (err) {
    const e = err as Error;
    return json(500, { error: e?.message ?? 'unknown error' });
  }
});

function clampExpiry(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_EXPIRY_DAYS;
  return Math.min(Math.max(Math.floor(input), 1), MAX_EXPIRY_DAYS);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
