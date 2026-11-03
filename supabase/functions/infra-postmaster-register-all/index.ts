/**
 * Phase 8.2.1 — Register all of an org's BYO sending domains with Google
 * Postmaster Tools after OAuth connect.
 *
 * Postmaster registration only succeeds if the user has the domain's TXT
 * verification record set. We attempt registration anyway; failures are
 * stored as warnings and the user can re-run from the UI after adding records.
 *
 * Body: { organization_id }  — called by the OAuth callback or manually
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getValidAccessToken, registerDomain } from '../_shared/postmaster-oauth.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  // The service-role client acts on whatever org the body names, so the caller
  // must be able to access it (a valid anon-key JWT alone is not enough).
  try {
    await assertOrgAccess(req, supabase, organization_id);
  } catch (authErr) {
    return unauthorized(authErr, corsHeaders);
  }

  const accessToken = await getValidAccessToken(supabase, organization_id);
  if (!accessToken) {
    return jsonResponse({ success: false, error: 'Postmaster not connected for this organization' }, 400);
  }

  const { data: domains } = await supabase
    .from('email_sending_domains')
    .select('id, domain, metadata')
    .eq('organization_id', organization_id)
    .eq('infra_type', 'byo');

  const results: Array<{ domain: string; status: 'registered' | 'already' | 'error'; error?: string }> = [];

  for (const d of (domains ?? []) as Array<{ id: string; domain: string; metadata: Record<string, unknown> | null }>) {
    try {
      await registerDomain(accessToken, d.domain);
      results.push({ domain: d.domain, status: 'registered' });
      const meta = d.metadata ?? {};
      await supabase
        .from('email_sending_domains')
        .update({ metadata: { ...meta, postmaster_registered_at: new Date().toISOString() } })
        .eq('id', d.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      // 409/ALREADY_EXISTS → mark as already-registered, not an error.
      if (/already exists|409/.test(msg)) {
        results.push({ domain: d.domain, status: 'already' });
        const meta = d.metadata ?? {};
        await supabase
          .from('email_sending_domains')
          .update({ metadata: { ...meta, postmaster_registered_at: new Date().toISOString() } })
          .eq('id', d.id);
      } else {
        results.push({ domain: d.domain, status: 'error', error: msg });
        const meta = d.metadata ?? {};
        await supabase
          .from('email_sending_domains')
          .update({ metadata: { ...meta, postmaster_register_error: msg } })
          .eq('id', d.id);
      }
    }
  }

  return jsonResponse({ success: true, results });
});
