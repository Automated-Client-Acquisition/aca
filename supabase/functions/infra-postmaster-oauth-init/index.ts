/**
 * Phase 8.2.1 — Start the Google Postmaster Tools OAuth flow.
 *
 * Body: { organization_id }
 * Returns: { auth_url } — the URL to open in a popup. The redirect lands at
 * infra-postmaster-oauth-callback which finishes the flow.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { buildAuthUrl } from '../_shared/postmaster-oauth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: { organization_id?: string };
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id } = body;
  if (!organization_id) return jsonResponse({ success: false, error: 'organization_id required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  try {
    const auth_url = buildAuthUrl(organization_id);
    return jsonResponse({ success: true, auth_url });
  } catch (e) {
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Failed to build auth URL — check GOOGLE_POSTMASTER_CLIENT_ID secret',
    }, 500);
  }
});
