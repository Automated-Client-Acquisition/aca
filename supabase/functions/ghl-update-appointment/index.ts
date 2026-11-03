/**
 * GHL Update Appointment
 *
 * Updates an existing appointment in a GHL calendar.
 * Also updates the ghl_appointment_log record.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  getGHLAccessToken,
  updateGHLAppointment,
} from '../_shared/ghl-calendar-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UpdateAppointmentRequest {
  organizationId: string;
  appointmentId: string; // GHL appointment/event ID
  startTime?: string; // ISO 8601
  endTime?: string; // ISO 8601
  title?: string;
  notes?: string;
  appointmentStatus?: 'new' | 'confirmed' | 'cancelled' | 'showed' | 'noshow' | 'invalid';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: UpdateAppointmentRequest = await req.json();
    const { organizationId, appointmentId, startTime, endTime, title, notes, appointmentStatus } = body;

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

    // Build update payload
    const updates: Record<string, unknown> = {};
    if (startTime) updates.startTime = startTime;
    if (endTime) updates.endTime = endTime;
    if (title !== undefined) updates.title = title;
    if (notes !== undefined) updates.description = notes;
    if (appointmentStatus) updates.appointmentStatus = appointmentStatus;

    // Update in GHL
    const updatedAppointment = await updateGHLAppointment(accessToken, appointmentId, updates);
    console.log('[GHL Update] Updated appointment:', appointmentId);

    // Update local audit log
    const logUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (startTime) logUpdates.start_time = startTime;
    if (endTime) logUpdates.end_time = endTime;
    if (title !== undefined) logUpdates.title = title;
    if (notes !== undefined) logUpdates.notes = notes;
    if (appointmentStatus) {
      // Map GHL status to our log status
      const statusMap: Record<string, string> = {
        new: 'booked',
        confirmed: 'confirmed',
        cancelled: 'cancelled',
        showed: 'confirmed',
        noshow: 'no_show',
        invalid: 'cancelled',
      };
      logUpdates.appointment_status = statusMap[appointmentStatus] || 'booked';
    }

    const { error: logError } = await supabase
      .from('ghl_appointment_log')
      .update(logUpdates)
      .eq('ghl_appointment_id', appointmentId)
      .eq('organization_id', organizationId);

    if (logError) {
      console.error('[GHL Update] Failed to update appointment log:', logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        appointment: updatedAppointment,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('ghl-update-appointment error:', error);
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
