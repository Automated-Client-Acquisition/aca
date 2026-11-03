/**
 * GHL List Calendars
 *
 * Fetches and caches GHL calendars for a location.
 * Returns cached data if less than 5 minutes old, unless force=true.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { getGHLAccessToken, listGHLCalendars } from '../_shared/ghl-calendar-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { organizationId, force } = await req.json();

    if (!organizationId) {
      throw new Error('organizationId is required');
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Check cache first (unless force refresh)
    if (!force) {
      const { data: cached } = await supabase
        .from('ghl_calendar_cache')
        .select('*')
        .eq('organization_id', organizationId)
        .order('last_synced_at', { ascending: false })
        .limit(1);

      if (cached && cached.length > 0) {
        const lastSync = new Date(cached[0].last_synced_at).getTime();
        if (Date.now() - lastSync < CACHE_TTL_MS) {
          // Return all cached calendars for this org
          const { data: allCached } = await supabase
            .from('ghl_calendar_cache')
            .select('*')
            .eq('organization_id', organizationId)
            .eq('is_active', true)
            .order('calendar_name');

          return new Response(
            JSON.stringify({ success: true, calendars: allCached || [], cached: true }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // Fetch fresh from GHL
    const { accessToken, locationId } = await getGHLAccessToken(supabase, organizationId);
    const calendars = await listGHLCalendars(accessToken, locationId);

    // Get existing cached calendar IDs for this org
    const { data: existingCache } = await supabase
      .from('ghl_calendar_cache')
      .select('calendar_id')
      .eq('organization_id', organizationId);

    const existingIds = new Set((existingCache || []).map((c: any) => c.calendar_id));
    const freshIds = new Set(calendars.map((c) => c.id));

    // Upsert calendars into cache
    for (const cal of calendars) {
      await supabase
        .from('ghl_calendar_cache')
        .upsert(
          {
            organization_id: organizationId,
            location_id: locationId,
            calendar_id: cal.id,
            calendar_name: cal.name,
            calendar_description: cal.description || null,
            calendar_type: cal.calendarType || null,
            group_id: cal.groupId || null,
            is_active: true,
            raw_data: cal,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,calendar_id' },
        );
    }

    // Mark removed calendars as inactive
    for (const existingId of existingIds) {
      if (!freshIds.has(existingId)) {
        await supabase
          .from('ghl_calendar_cache')
          .update({ is_active: false, last_synced_at: new Date().toISOString() })
          .eq('organization_id', organizationId)
          .eq('calendar_id', existingId);
      }
    }

    // Return fresh data
    const { data: refreshed } = await supabase
      .from('ghl_calendar_cache')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .order('calendar_name');

    return new Response(
      JSON.stringify({ success: true, calendars: refreshed || [], cached: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('ghl-list-calendars error:', error);

    // Detect auth / scope issues
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    const needsReauth =
      errorMsg.includes('401') ||
      errorMsg.includes('Unauthorized') ||
      errorMsg.includes('403') ||
      errorMsg.includes('Failed to refresh GHL OAuth token') ||
      errorMsg.includes('not connected');

    return new Response(
      JSON.stringify({
        success: false,
        error: needsReauth
          ? 'GHL connection expired. Please reconnect your LeadConnector account in Settings.'
          : errorMsg,
        needsReauth,
      }),
      {
        status: needsReauth ? 403 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
