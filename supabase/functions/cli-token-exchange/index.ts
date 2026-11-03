/**
 * Edge Function: CLI Token Exchange
 *
 * Exchanges a long-lived `aca_` API token for a short-lived real Supabase
 * session (access_token + refresh_token). Needed because PostgREST's own JWT
 * verification rejects any Authorization bearer that isn't a 3-part signed
 * JWT — an `aca_` token can authenticate edge functions (via
 * `_shared/cli-auth.ts`) but was never usable directly against
 * `/rest/v1/*`, which is what most read commands in aca-cli hit.
 *
 * Mechanism: mint an admin magiclink for the token's user, then redeem it
 * server-side via the public `/auth/v1/verify` endpoint to get a genuine
 * GoTrue session — the same trick `request-workspace-magic-link` uses to
 * land a freshly-provisioned user in the app already authenticated, just
 * consumed here instead of following a redirect.
 *
 * Authentication: `aca_` API token only. A caller that already has a JWT
 * doesn't need to exchange it for another one.
 *
 * Input:  none (token carries everything via Authorization header)
 * Output: { access_token, refresh_token, expires_in, user_id, organization_id }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { authenticateRequest, unauthorized, AuthError } from '../_shared/cli-auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const caller = await authenticateRequest(req, supabase);
    if (caller.auth_method !== 'api_token') {
      throw new AuthError('Only aca_ API tokens can be exchanged. A JWT is already a session.', 400);
    }

    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(caller.user_id);
    if (userErr || !userData?.user?.email) {
      throw new AuthError('Could not resolve the token owner\'s account', 500);
    }
    const email = userData.user.email;

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const hashedToken = linkData?.properties?.hashed_token;
    if (linkErr || !hashedToken) {
      console.error('[cli-token-exchange] generateLink failed:', linkErr);
      throw new AuthError('Failed to mint a session for this token', 500);
    }

    const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      // hashed_token is a token hash, not a raw OTP: `token` would make GoTrue
      // demand an email/phone alongside it and 400.
      body: JSON.stringify({ type: 'magiclink', token_hash: hashedToken }),
    });
    if (!verifyRes.ok) {
      const body = await verifyRes.text();
      console.error('[cli-token-exchange] verify failed:', verifyRes.status, body);
      throw new AuthError('Failed to redeem session token', 500);
    }
    const session = (await verifyRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!session.access_token) {
      throw new AuthError('Session redemption returned no access token', 500);
    }

    return json(200, {
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? null,
      expires_in: session.expires_in ?? 3600,
      user_id: caller.user_id,
      organization_id: caller.organization_id,
    });
  } catch (err) {
    return unauthorized(err, corsHeaders);
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
