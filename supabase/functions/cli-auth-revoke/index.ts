/**
 * Edge Function: CLI Auth Revoke
 *
 * Soft-deletes (revoked_at = now()) an API token belonging to the
 * authenticated user. Authentication: Supabase JWT only.
 *
 * Input: { token_id: UUID }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json(401, { error: 'Authorization header required' });
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token.startsWith('aca_')) {
      return json(403, { error: 'Use the web app to revoke tokens.' });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json(401, { error: 'Invalid authorization token' });
    }

    const body = await req.json().catch(() => ({}));
    const tokenId: string | undefined = body?.token_id;
    if (!tokenId) {
      return json(400, { error: 'token_id is required' });
    }

    // Verify the token belongs to the caller before revoking.
    const { data: existing, error: lookupErr } = await supabase
      .from('api_tokens')
      .select('id, user_id, revoked_at')
      .eq('id', tokenId)
      .maybeSingle();
    if (lookupErr) {
      return json(500, { error: 'Failed to look up token', detail: lookupErr.message });
    }
    if (!existing || existing.user_id !== userData.user.id) {
      return json(404, { error: 'Token not found' });
    }
    if (existing.revoked_at) {
      return json(200, { id: tokenId, already_revoked: true });
    }

    const { error: updErr } = await supabase
      .from('api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId);
    if (updErr) {
      return json(500, { error: 'Failed to revoke token', detail: updErr.message });
    }

    return json(200, { id: tokenId, revoked: true });
  } catch (err) {
    const e = err as Error;
    return json(500, { error: e?.message ?? 'unknown error' });
  }
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
