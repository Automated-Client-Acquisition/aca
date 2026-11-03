/**
 * Edge Function: CLI Auth List
 *
 * Lists the authenticated user's API tokens. Never returns plaintext or hash.
 * Authentication: Supabase JWT only.
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
      return json(403, { error: 'Use the web app to view your tokens.' });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json(401, { error: 'Invalid authorization token' });
    }

    const { data: rows, error } = await supabase
      .from('api_tokens')
      .select(
        'id, name, token_prefix, scopes, last_used_at, expires_at, revoked_at, created_at, organization_id',
      )
      .eq('user_id', userData.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return json(500, { error: 'Failed to list tokens', detail: error.message });
    }

    return json(200, { tokens: rows ?? [] });
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
