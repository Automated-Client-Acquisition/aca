/**
 * GHL Calendar Client (shared)
 *
 * Encapsulates all GoHighLevel Calendar API interactions:
 *   - listCalendars: GET /calendars/
 *   - getFreeSlots: GET /calendars/:calendarId/free-slots
 *   - createAppointment: POST /calendars/events/appointments
 *   - upsertContact: POST /contacts/upsert
 *
 * All functions use the GHL REST API with OAuth Bearer token auth.
 *
 * @see https://marketplace.gohighlevel.com/docs/ghl/calendars
 */

import { createClient , type SupabaseClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { getLatestGHLOAuthTokenRow } from './ghl-oauth.ts';
import { decryptApiKey } from './unipile-client.ts';

// ============================================================================
// Constants
// ============================================================================

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-04-15';

// ============================================================================
// Types
// ============================================================================

export interface GHLCalendar {
  id: string;
  name: string;
  description?: string;
  calendarType?: string;
  locationId: string;
  groupId?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface GHLFreeSlotsMap {
  [date: string]: {
    slots: string[];
  };
}

export interface CreateAppointmentInput {
  calendarId: string;
  locationId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title?: string;
  description?: string;
  appointmentStatus?: string;
  assignedUserId?: string;
  address?: string;
  meetingLocationType?: string;
  toNotify?: boolean;
}

export interface GHLAppointment {
  id: string;
  calendarId: string;
  locationId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title: string;
  appointmentStatus: string;
  [key: string]: unknown;
}

export interface GHLContactInput {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  website?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  tags?: string[];
  source?: string;
  customFields?: Array<{ key: string; field_value: string }>;
}

export interface GHLContactResult {
  id: string;
  [key: string]: unknown;
}

// ============================================================================
// Token Management
// ============================================================================

/**
 * Get a valid GHL access token, refreshing if needed.
 * Reusable across all GHL edge functions.
 */
export async function getGHLAccessToken(
  supabase: SupabaseClient<any>,
  organizationId: string,
): Promise<{ accessToken: string; locationId: string }> {
  let tokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

  if (!tokenData) {
    throw new Error('LeadConnector not connected. Please connect your GHL account in Settings.');
  }

  const expiresAt = new Date(tokenData.expires_at);
  const now = new Date();
  const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);

  let accessToken: string;

  if (minutesUntilExpiry >= 5) {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    accessToken = await decryptApiKey(tokenData.access_token_encrypted, encryptionKey);
  } else {
    console.log('[GHL] Token expired or near expiry, refreshing...');

    const refreshResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-refresh-token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ organizationId }),
      },
    );

    if (!refreshResponse.ok) {
      throw new Error('Failed to refresh GHL OAuth token');
    }

    const refreshedTokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

    if (!refreshedTokenData) {
      throw new Error('Failed to get refreshed tokens');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    accessToken = await decryptApiKey(refreshedTokenData.access_token_encrypted, encryptionKey);

    tokenData = refreshedTokenData;
    return { accessToken, locationId: tokenData.location_id };
  }

  return { accessToken, locationId: tokenData.location_id };
}

// ============================================================================
// Calendar API
// ============================================================================

/**
 * List all calendars in a GHL location.
 */
export async function listGHLCalendars(
  accessToken: string,
  locationId: string,
): Promise<GHLCalendar[]> {
  const url = `${GHL_BASE_URL}/calendars/?locationId=${encodeURIComponent(locationId)}&showDrafted=false`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL listCalendars failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.calendars || [];
}

/**
 * Get free slots for a calendar between a date range.
 *
 * @param startDateMs - Start date in milliseconds
 * @param endDateMs - End date in milliseconds (max 31 days from start)
 * @param timezone - Optional timezone (e.g. 'America/New_York')
 */
export async function getGHLFreeSlots(
  accessToken: string,
  calendarId: string,
  startDateMs: number,
  endDateMs: number,
  timezone?: string,
): Promise<GHLFreeSlotsMap> {
  const params = new URLSearchParams({
    startDate: startDateMs.toString(),
    endDate: endDateMs.toString(),
  });
  if (timezone) params.set('timezone', timezone);

  const url = `${GHL_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/free-slots?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL getFreeSlots failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Create an appointment in a GHL calendar.
 */
export async function createGHLAppointment(
  accessToken: string,
  input: CreateAppointmentInput,
): Promise<GHLAppointment> {
  // GHL requires UTC ISO 8601 timestamps (e.g. "2026-03-03T09:00:00Z")
  // Convert any offset format like "2026-03-03T10:00:00+01:00" to UTC
  const toUtcIso = (ts: string): string => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toISOString();
  };

  const body: Record<string, unknown> = {
    calendarId: input.calendarId,
    locationId: input.locationId,
    contactId: input.contactId,
    startTime: toUtcIso(input.startTime),
    endTime: toUtcIso(input.endTime),
    title: input.title || 'Meeting',
    appointmentStatus: input.appointmentStatus || 'new',
    toNotify: input.toNotify ?? true,
  };

  if (input.description) body.description = input.description;
  if (input.assignedUserId) body.assignedUserId = input.assignedUserId;
  if (input.address) body.address = input.address;
  if (input.meetingLocationType) body.meetingLocationType = input.meetingLocationType;

  const response = await fetch(`${GHL_BASE_URL}/calendars/events/appointments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL createAppointment failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Update an existing appointment in a GHL calendar.
 *
 * @see https://marketplace.gohighlevel.com/docs/ghl/calendars/edit-appointment/
 */
export async function updateGHLAppointment(
  accessToken: string,
  eventId: string,
  updates: Partial<Omit<CreateAppointmentInput, 'calendarId' | 'locationId' | 'contactId'>>,
): Promise<GHLAppointment> {
  const body: Record<string, unknown> = {};

  if (updates.startTime) body.startTime = updates.startTime;
  if (updates.endTime) body.endTime = updates.endTime;
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.appointmentStatus) body.appointmentStatus = updates.appointmentStatus;
  if (updates.assignedUserId !== undefined) body.assignedUserId = updates.assignedUserId;
  if (updates.address !== undefined) body.address = updates.address;
  if (updates.meetingLocationType !== undefined) body.meetingLocationType = updates.meetingLocationType;
  if (updates.toNotify !== undefined) body.toNotify = updates.toNotify;

  const response = await fetch(`${GHL_BASE_URL}/calendars/events/appointments/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL updateAppointment failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Delete an appointment/event in a GHL calendar.
 *
 * @see https://marketplace.gohighlevel.com/docs/ghl/calendars/delete-event/
 */
export async function deleteGHLAppointment(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const response = await fetch(`${GHL_BASE_URL}/calendars/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL deleteAppointment failed: ${response.status} - ${errorText}`);
  }
}

/**
 * Upsert a contact in GHL (create or update by email).
 */
export async function upsertGHLContact(
  accessToken: string,
  locationId: string,
  contact: GHLContactInput,
): Promise<GHLContactResult> {
  if (!contact.email && !contact.phone) {
    throw new Error('GHL requires email or phone to create a contact');
  }

  const payload: Record<string, unknown> = {
    locationId,
    email: contact.email || undefined,
    phone: contact.phone || undefined,
    firstName: contact.firstName || undefined,
    lastName: contact.lastName || undefined,
    companyName: contact.companyName || undefined,
    website: contact.website || undefined,
    source: contact.source || 'ACA Autopilot',
    tags: contact.tags || [],
  };

  if (contact.customFields && contact.customFields.length > 0) {
    payload.customFields = contact.customFields;
  }

  const response = await fetch(`${GHL_BASE_URL}/contacts/upsert`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Version': GHL_API_VERSION,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL upsertContact failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return { id: data.contact?.id || data.id, ...data };
}

// ============================================================================
// Custom Fields
// ============================================================================

export interface GHLCustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
}

/**
 * List all custom fields for a GHL location.
 */
export async function listGHLCustomFields(
  accessToken: string,
  locationId: string,
): Promise<GHLCustomField[]> {
  const response = await fetch(
    `${GHL_BASE_URL}/locations/${locationId}/customFields`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
        'Version': GHL_API_VERSION,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GHL listCustomFields failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return (data.customFields || []) as GHLCustomField[];
}
