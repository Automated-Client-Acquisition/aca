/**
 * GHL Delete Appointment
 *
 * Deletes an appointment from a GHL calendar.
 * Updates the ghl_appointment_log record to 'cancelled' status.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  getGHLAccessToken,
  deleteGHLAppointment,
} from '../_shared/ghl-calendar-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeleteAppointmentRequest {
  organizationId: string;
  appointmentId: string; // GHL appointment/event ID
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: DeleteAppointmentRequest = await req.json();
    const { organizationId, appointmentId } = body;

    if (!organizationId || !appointmentId) {
      throw new Error('organizationId and appointmentId are required');
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase as unknown as Parameters<typeof assertOrgAccess>[1], organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Get GHL tokens
    const { accessToken } = await getGHLAccessToken(supabase, organizationId);

    // Delete from GHL
    await deleteGHLAppointment(accessToken, appointmentId);
    console.log('[GHL Delete] Deleted appointment:', appointmentId);

    // Update local audit log to 'cancelled'
    const { error: logError } = await supabase
      .from('ghl_appointment_log')
      .update({
        appointment_status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('ghl_appointment_id', appointmentId)
      .eq('organization_id', organizationId);

    if (logError) {
      console.error('[GHL Delete] Failed to update appointment log:', logError);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('ghl-delete-appointment error:', error);
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
