import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateEventRequest {
  organizationId: string;
  calendarAccountId: string;
  calendarId: string; // Unipile calendar ID
  title: string;
  body?: string;
  location?: string;
  startTime: string; // ISO timestamp
  endTime: string; // ISO timestamp
  timezone: string;
  isAllDay?: boolean;
  conferenceProvider?: 'google_meet' | 'zoom' | 'teams' | 'none';
  attendees: Array<{ email: string; name?: string }>;
  // CRM linking
  contactId?: string;
  campaignId?: string;
  progressId?: string;
  // Template
  templateId?: string;
  // Notify attendees
  notify?: boolean;
}

/**
 * Calendar Create Event Edge Function
 *
 * Creates a calendar event with optional video conferencing link.
 * Supports Google Meet, Zoom, and Teams auto-generation.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization header to identify user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    // Verify the user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Invalid authorization token');
    }

    const body: CreateEventRequest = await req.json();
    const {
      organizationId,
      calendarAccountId,
      calendarId,
      title,
      body: eventBody,
      location,
      startTime,
      endTime,
      timezone,
      isAllDay = false,
      conferenceProvider,
      attendees,
      contactId,
      campaignId,
      progressId,
      templateId,
      notify = true,
    } = body;

    if (!organizationId || !calendarAccountId || !calendarId || !title || !startTime || !endTime) {
      throw new Error('Missing required fields: organizationId, calendarAccountId, calendarId, title, startTime, endTime');
    }

    console.log(`[Calendar Create Event] Creating event for org:`, organizationId);

    // Verify user has access to this organization
    const { data: membership, error: memberError } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      throw new Error('You do not have access to this organization');
    }

    // Get the calendar account
    const { data: calendarAccount, error: accountError } = await supabase
      .from('calendar_accounts')
      .select('*')
      .eq('id', calendarAccountId)
      .eq('organization_id', organizationId)
      .single();

    if (accountError || !calendarAccount) {
      throw new Error('Calendar account not found');
    }

    // Get Unipile credentials from org's BYOK
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted, metadata')
      .eq('organization_id', organizationId)
      .eq('provider', 'unipile')
      .eq('is_valid', true)
      .maybeSingle();

    if (!apiKeyData?.key_encrypted) {
      throw new Error('Unipile API key not configured. Please add your Unipile API key in Settings > API Keys.');
    }

    console.log('[Calendar Create Event] Using BYOK');
    const unipileApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
    const unipileDsn = normalizeDsnUrl((apiKeyData.metadata as Record<string, string>)?.dsn_url);

    // Create SDK client
    const client = new UnipileClient(unipileDsn, unipileApiKey);

    // Build the event request for Unipile
    const eventRequest: Record<string, unknown> = {
      title,
      attendees: attendees.map(a => ({ email: a.email, display_name: a.name })),
      start: isAllDay
        ? { date: startTime.split('T')[0] }
        : { date_time: startTime, time_zone: timezone },
      end: isAllDay
        ? { date: endTime.split('T')[0] }
        : { date_time: endTime, time_zone: timezone },
      notify,
    };

    if (eventBody) {
      eventRequest.body = eventBody;
    }

    if (location) {
      eventRequest.location = location;
    }

    // Add conference if requested
    if (conferenceProvider && conferenceProvider !== 'none') {
      eventRequest.conference = { provider: conferenceProvider };
    }

    console.log('[Calendar Create Event] Creating event via Unipile:', JSON.stringify(eventRequest, null, 2));

    // Create the event via Unipile API
    const eventResponse = await client.request.send({
      path: `/api/v1/calendars/${calendarId}/events`,
      method: 'POST',
      query: { account_id: calendarAccount.unipile_account_id },
      body: eventRequest,
    }) as Record<string, unknown>;

    console.log('[Calendar Create Event] Unipile response:', JSON.stringify(eventResponse, null, 2));

    // Extract conference URL if generated
    const conferenceUrl = (eventResponse.conference as Record<string, unknown>)?.url ||
                          (eventResponse.conference as Record<string, unknown>)?.entry_points?.[0]?.uri ||
                          null;

    // Store the event in our database
    const { data: calendarEvent, error: insertError } = await supabase
      .from('calendar_events')
      .insert({
        organization_id: organizationId,
        calendar_account_id: calendarAccountId,
        unipile_event_id: eventResponse.id as string,
        unipile_calendar_id: calendarId,
        title,
        body: eventBody,
        location,
        start_time: startTime,
        end_time: endTime,
        timezone,
        is_all_day: isAllDay,
        conference_provider: conferenceProvider || null,
        conference_url: conferenceUrl,
        contact_id: contactId || null,
        campaign_id: campaignId || null,
        lead_progress_id: progressId || null,
        created_by: campaignId ? 'campaign_trigger' : 'manual',
        created_by_user_id: user.id,
        template_id: templateId || null,
        status: 'scheduled',
        sync_status: 'synced',
        last_sync_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Calendar Create Event] Failed to store event:', insertError);
      throw new Error('Failed to store event in database');
    }

    // Add attendees to the database
    if (attendees.length > 0) {
      const attendeeRecords = attendees.map((attendee, index) => ({
        event_id: calendarEvent.id,
        email: attendee.email,
        name: attendee.name || null,
        is_organizer: index === 0 && attendee.email === calendarAccount.email,
        response_status: 'pending',
        contact_id: index === 0 && contactId ? contactId : null,
      }));

      await supabase.from('calendar_event_attendees').insert(attendeeRecords);
    }

    // Log activity if linked to a contact
    if (contactId) {
      await supabase.from('crm_activities').insert({
        contact_id: contactId,
        organization_id: organizationId,
        type: 'meeting_scheduled',
        title: `Meeting scheduled: ${title}`,
        description: `Meeting scheduled for ${new Date(startTime).toLocaleString()}`,
        metadata: {
          event_id: calendarEvent.id,
          conference_url: conferenceUrl,
          start_time: startTime,
          end_time: endTime,
        },
        created_by: user.id,
      });
    }

    console.log('[Calendar Create Event] Event created successfully:', calendarEvent.id);

    return new Response(
      JSON.stringify({
        success: true,
        event: calendarEvent,
        unipileEventId: eventResponse.id,
        conferenceUrl,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Calendar Create Event] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
