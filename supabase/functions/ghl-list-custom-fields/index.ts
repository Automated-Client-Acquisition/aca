/**
 * GHL List Custom Fields
 *
 * Fetches available custom fields from a GHL location.
 * Used in the Lead Delivery trigger dialog to let users pick
 * which GHL custom fields receive conversation thread and lead source data.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { getGHLAccessToken, listGHLCustomFields } from '../_shared/ghl-calendar-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { organizationId } = await req.json();

    if (!organizationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'organizationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const { accessToken, locationId } = await getGHLAccessToken(supabase, organizationId);
    const customFields = await listGHLCustomFields(accessToken, locationId);

    return new Response(
      JSON.stringify({ success: true, customFields }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[ghl-list-custom-fields] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
