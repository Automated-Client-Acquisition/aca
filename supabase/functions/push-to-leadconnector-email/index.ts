/**
 * Push Lead to LeadConnector (GoHighLevel)
 *
 * Creates or updates a contact in LeadConnector with personalized email content
 * stored in custom fields, then optionally adds them to a workflow for email automation.
 *
 * Uses existing ghl_oauth_tokens for OAuth authentication.
 *
 * @see https://marketplace.gohighlevel.com/docs/ghl/contacts/create-contact
 * @see https://marketplace.gohighlevel.com/docs/ghl/contacts/add-contact-to-workflow
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient , type SupabaseClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { getLatestGHLOAuthTokenRow } from '../_shared/ghl-oauth.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushToLeadConnectorRequest {
  organizationId: string;
  workflowId?: string; // Optional: workflow to add contact to
  contact: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    jobTitle?: string;
    linkedinUrl?: string;
    phone?: string;
    website?: string;
  };
  personalizedSubject: string;
  personalizedBody: string;
  customFields?: Record<string, string>;
  tags?: string[];
  // For tracking
  progressId: string;
  internalCampaignId: string;
}

interface GHLContactPayload {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  companyName?: string;
  website?: string;
  source?: string;
  tags?: string[];
  customFields?: Array<{
    id?: string;
    key: string;
    field_value: string;
  }>;
}

/**
 * Refresh GHL access token if expired
 */
async function refreshTokenIfNeeded(
  supabase: SupabaseClient<any>,
  tokenData: any,
  organizationId: string
): Promise<string> {
  const expiresAt = new Date(tokenData.expires_at);
  const now = new Date();
  const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);

  if (minutesUntilExpiry >= 5) {
    // Token still valid, decrypt and return
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    return await decryptApiKey(tokenData.access_token_encrypted, encryptionKey);
  }

  console.log('Token expired or near expiry, refreshing...');

  // Call refresh token function
  const refreshResponse = await fetch(
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-refresh-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ organizationId }),
    }
  );

  if (!refreshResponse.ok) {
    throw new Error('Failed to refresh OAuth token');
  }

  // Re-fetch updated tokens
  const refreshedTokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

  if (!refreshedTokenData) {
    throw new Error('Failed to get refreshed tokens');
  }

  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  return await decryptApiKey(refreshedTokenData.access_token_encrypted, encryptionKey);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: PushToLeadConnectorRequest = await req.json();
    const {
      organizationId,
      workflowId,
      contact,
      personalizedSubject,
      personalizedBody,
      customFields = {},
      tags = [],
      progressId,
      internalCampaignId,
    } = body;

    // Validate required fields
    if (!organizationId || !contact?.email || !personalizedSubject || !personalizedBody) {
      throw new Error('Missing required fields: organizationId, contact.email, personalizedSubject, personalizedBody');
    }

    // Get GHL OAuth tokens for organization
    const tokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

    if (!tokenData) {
      throw new Error('LeadConnector not connected. Please connect your GHL account in Settings.');
    }

    const locationId = tokenData.location_id;

    // Get valid access token (refreshing if needed)
    const accessToken = await refreshTokenIfNeeded(supabase, tokenData, organizationId);

    // Build GHL contact payload
    const contactPayload: GHLContactPayload = {
      email: contact.email,
      firstName: contact.firstName || undefined,
      lastName: contact.lastName || undefined,
      phone: contact.phone || undefined,
      companyName: contact.company || undefined,
      website: contact.website || undefined,
      source: 'LinkedIn Campaign Handoff',
      tags: ['linkedin-campaign', ...tags],
      // Store personalized email content as custom fields
      // These can be used in GHL workflows and email templates
      customFields: [
        { key: 'email_subject', field_value: personalizedSubject },
        { key: 'email_body', field_value: personalizedBody },
        { key: 'job_title', field_value: contact.jobTitle || '' },
        { key: 'linkedin_url', field_value: contact.linkedinUrl || '' },
        // Add any additional custom fields
        ...Object.entries(customFields).map(([key, value]) => ({
          key,
          field_value: value,
        })),
      ],
    };

    // Upsert contact in GHL (create or update)
    const contactResponse = await fetch(
      `https://services.leadconnectorhq.com/contacts/upsert`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({
          ...contactPayload,
          locationId,
        }),
      }
    );

    if (!contactResponse.ok) {
      const errorText = await contactResponse.text();
      throw new Error(`GHL contact upsert failed: ${contactResponse.status} - ${errorText}`);
    }

    const contactResult = await contactResponse.json();
    const ghlContactId = contactResult.contact?.id || contactResult.id;

    console.log('Created/updated GHL contact:', ghlContactId);

    // Add to workflow if specified
    let workflowAdded = false;
    if (workflowId && ghlContactId) {
      const workflowResponse = await fetch(
        `https://services.leadconnectorhq.com/contacts/${ghlContactId}/workflow/${workflowId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({}),
        }
      );

      if (workflowResponse.ok) {
        workflowAdded = true;
        console.log('Added contact to workflow:', workflowId);
      } else {
        const workflowError = await workflowResponse.text();
        console.error('Failed to add contact to workflow:', workflowError);
      }
    }

    // Record the handoff
    const { error: handoffError } = await supabase.from('lead_handoffs').insert({
      campaign_id: internalCampaignId,
      progress_id: progressId,
      contact_id: contact.id,
      tool_type: 'leadconnector',
      connection_id: tokenData.id, // Use ghl_oauth_tokens ID as connection reference
      external_campaign_id: workflowId || null,
      external_workflow_id: workflowId || null,
      email_subject: personalizedSubject,
      email_body: personalizedBody,
      status: 'sent',
      external_lead_id: ghlContactId,
      pushed_at: new Date().toISOString(),
      error_message: null,
    });

    if (handoffError) {
      console.error('Failed to record handoff:', handoffError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        contactId: ghlContactId,
        workflowAdded,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Push to LeadConnector error:', error);
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
