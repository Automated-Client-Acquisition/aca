/**
 * GHL Book Appointment
 *
 * Upserts a CRM contact into GHL, then books an appointment in a GHL calendar.
 * Records the booking in ghl_appointment_log for audit trail.
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import {
  getGHLAccessToken,
  upsertGHLContact,
  createGHLAppointment,
} from '../_shared/ghl-calendar-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BookAppointmentRequest {
  organizationId: string;
  calendarId: string;
  contactId: string; // ACA CRM contact ID
  conversationId: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  timezone?: string;
  title?: string;
  notes?: string;
  sourceType: 'email_sequence' | 'linkedin_campaign' | 'lead_magnet';
  sourceId?: string;
  queueItemId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }
  // No callers in the app or crons; internal service-role use only.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: BookAppointmentRequest = await req.json();
    const {
      organizationId,
      calendarId,
      contactId,
      conversationId,
      startTime,
      endTime,
      timezone,
      title,
      notes,
      sourceType,
      sourceId,
      queueItemId,
    } = body;

    if (!organizationId || !calendarId || !contactId || !conversationId || !startTime || !endTime) {
      throw new Error('Missing required fields');
    }

    // Get GHL tokens
    const { accessToken, locationId } = await getGHLAccessToken(supabase, organizationId);

    // Fetch ACA CRM contact data
    const { data: crmContact, error: contactError } = await supabase
      .from('crm_contacts')
      .select('first_name, last_name, email, phone, company, job_title, linkedin_url')
      .eq('id', contactId)
      .single();

    if (contactError || !crmContact) {
      throw new Error(`Contact not found: ${contactId}`);
    }

    // Validate contact has email or phone (GHL requirement)
    if (!crmContact.email && !crmContact.phone) {
      throw new Error('Contact must have an email or phone number to book a GHL appointment');
    }

    // Upsert contact into GHL
    const ghlContact = await upsertGHLContact(accessToken, locationId, {
      email: crmContact.email || undefined,
      phone: crmContact.phone || undefined,
      firstName: crmContact.first_name || undefined,
      lastName: crmContact.last_name || undefined,
      companyName: crmContact.company || undefined,
      source: 'ACA Autopilot Booking',
      tags: ['autopilot-booking'],
      customFields: [
        ...(crmContact.job_title ? [{ key: 'job_title', field_value: crmContact.job_title }] : []),
        ...(crmContact.linkedin_url ? [{ key: 'linkedin_url', field_value: crmContact.linkedin_url }] : []),
      ],
    });

    const ghlContactId = ghlContact.id;
    console.log('[GHL Book] Upserted GHL contact:', ghlContactId);

    // Create appointment
    const appointment = await createGHLAppointment(accessToken, {
      calendarId,
      locationId,
      contactId: ghlContactId,
      startTime,
      endTime,
      title: title || 'Meeting',
      appointmentStatus: 'new',
      toNotify: true,
    });

    const ghlAppointmentId = appointment.id;
    console.log('[GHL Book] Created appointment:', ghlAppointmentId);

    // Log the booking
    const { error: logError } = await supabase.from('ghl_appointment_log').insert({
      organization_id: organizationId,
      conversation_id: conversationId,
      contact_id: contactId,
      ghl_calendar_id: calendarId,
      ghl_contact_id: ghlContactId,
      ghl_appointment_id: ghlAppointmentId,
      appointment_status: 'booked',
      start_time: startTime,
      end_time: endTime,
      timezone: timezone || 'UTC',
      title: title || 'Meeting',
      notes: notes || null,
      source_type: sourceType,
      source_id: sourceId || null,
      queue_item_id: queueItemId || null,
    });

    if (logError) {
      console.error('[GHL Book] Failed to log appointment:', logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        appointmentId: ghlAppointmentId,
        ghlContactId,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('ghl-book-appointment error:', error);
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
