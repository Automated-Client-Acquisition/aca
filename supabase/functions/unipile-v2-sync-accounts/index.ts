/**
 * Unipile v2 account sync (user-facing, called when Settings > Senders opens).
 *
 * Imports accounts the org linked on its own v2 application (for example from the Unipile
 * dashboard), refreshes statuses, and makes sure the application's webhook endpoint exists so
 * replies reach the inbox. Accounts on ACA's platform application are only refreshed, never
 * discovered: those arrive through hosted auth.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { isUnipileApiError } from '../_shared/unipile/index.ts';
import { syncV2AccountsForOrg } from '../_shared/unipile/v2-accounts.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { organizationId } = await req.json().catch(() => ({}));
    if (!organizationId) return json({ success: false, error: 'organizationId is required' }, 400);

    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const result = await syncV2AccountsForOrg(supabase, organizationId, Deno.env.get('ENCRYPTION_KEY')!, supabaseUrl);
    console.log(`[Unipile v2 Sync] org ${organizationId}:`, JSON.stringify(result));
    return json({ success: true, ...result });
  } catch (error) {
    const message = isUnipileApiError(error)
      ? `Unipile: ${error.message}`
      : error instanceof Error ? error.message : 'Unknown error';
    console.error('[Unipile v2 Sync] Error:', message);
    return json({ success: false, error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
