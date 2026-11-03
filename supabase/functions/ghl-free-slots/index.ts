/**
 * GHL Free Slots
 *
 * Fetches available time slots for a GHL calendar within a date range.
 * Called by the autopilot module and optionally from the frontend for preview.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { getGHLAccessToken, getGHLFreeSlots } from '../_shared/ghl-calendar-client.ts';
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

    const { organizationId, calendarId, startDate, endDate, timezone } = await req.json();

    if (!organizationId || !calendarId || !startDate || !endDate) {
      throw new Error('organizationId, calendarId, startDate, and endDate are required');
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Convert YYYY-MM-DD strings to millisecond timestamps
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();

    if (isNaN(startMs) || isNaN(endMs)) {
      throw new Error('Invalid date format. Use YYYY-MM-DD.');
    }

    // Max 31 days per GHL API constraint
    const daysDiff = (endMs - startMs) / (1000 * 60 * 60 * 24);
    if (daysDiff > 31) {
      throw new Error('Date range cannot exceed 31 days');
    }

    console.log(`[ghl-free-slots] Request: org=${organizationId}, cal=${calendarId}, range=${startDate}→${endDate}, tz=${timezone}`);

    const { accessToken } = await getGHLAccessToken(supabase, organizationId);
    console.log(`[ghl-free-slots] Got GHL access token, fetching free slots...`);

    const slots = await getGHLFreeSlots(accessToken, calendarId, startMs, endMs, timezone);
    const slotDays = Object.keys(slots || {}).length;
    const totalSlots = Object.values(slots || {}).reduce((sum: number, d: any) => sum + (d?.slots?.length || 0), 0);
    console.log(`[ghl-free-slots] GHL returned ${slotDays} days with ${totalSlots} total slots. Raw: ${JSON.stringify(slots).substring(0, 500)}`);

    return new Response(
      JSON.stringify({ success: true, slots }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('ghl-free-slots error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }
});
