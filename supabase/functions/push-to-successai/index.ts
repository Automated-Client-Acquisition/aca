/**
 * Push Lead to Success.ai
 *
 * Pushes a lead with fully personalized email content to a Success.ai campaign.
 * The email subject and body are passed as custom variables so they can be used
 * in Success.ai's email templates.
 *
 * @see https://api.success.ai/api/docs#tag/contacts/POST/v1/contact/add
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushToSuccessAiRequest {
  connectionId: string;
  campaignId: string;
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
    location?: string;
  };
  // Email content - required unless leadsOnly is true
  personalizedSubject?: string;
  personalizedBody?: string;
  customFields?: Record<string, string>;
  // For tracking (optional for leads-only pushes)
  progressId?: string;
  internalCampaignId?: string;
  // Organization ID for leads-only pushes
  organizationId?: string;
  // New: leads-only mode - push contact without email sequences
  leadsOnly?: boolean;
}

interface SuccessAiContact {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  location?: string;
  iceBreaker?: string;
  website?: string;
  customVariables?: Record<string, string>;
}

interface SuccessAiPayload {
  campaignId: string;
  contacts: SuccessAiContact[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Get encryption key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('ENCRYPTION_KEY not configured');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body: PushToSuccessAiRequest = await req.json();
    const {
      connectionId,
      campaignId,
      contact,
      personalizedSubject,
      personalizedBody,
      customFields = {},
      progressId,
      internalCampaignId,
      organizationId,
      leadsOnly = false,
    } = body;

    // Validate required fields
    if (!connectionId || !campaignId || !contact?.email) {
      throw new Error('Missing required fields: connectionId, campaignId, contact.email');
    }

    // Email content required unless leadsOnly mode
    if (!leadsOnly && (!personalizedSubject || !personalizedBody)) {
      throw new Error('Missing required fields: personalizedSubject, personalizedBody (required when leadsOnly is false)');
    }

    // Fetch connection and decrypt API key
    const { data: connection, error: connectionError } = await supabase
      .from('email_tool_connections')
      .select('*')
      .eq('id', connectionId)
      .single();

    if (connectionError || !connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }

    if (connection.tool_type !== 'successai') {
      throw new Error(`Invalid connection type: expected successai, got ${connection.tool_type}`);
    }

    const apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // Build custom variables based on mode
    const baseCustomVariables: Record<string, string> = {
      first_name: contact.firstName || '',
      job_title: contact.jobTitle || '',
      company_name: contact.company || '',
      linkedin_url: contact.linkedinUrl || '',
      ...customFields,
    };

    // Only add email content to custom variables if not in leadsOnly mode
    if (!leadsOnly && personalizedSubject && personalizedBody) {
      baseCustomVariables.email_subject = personalizedSubject;
      baseCustomVariables.email_body = personalizedBody;
    }

    // Build Success.ai contact payload
    const successAiContact: SuccessAiContact = {
      email: contact.email,
      firstName: contact.firstName || undefined,
      lastName: contact.lastName || undefined,
      companyName: contact.company || undefined,
      location: contact.location || undefined,
      website: contact.website || undefined,
      // Use iceBreaker for a personalized opener if available
      iceBreaker: customFields.iceBreaker || undefined,
      customVariables: baseCustomVariables,
    };

    const payload: SuccessAiPayload = {
      campaignId,
      contacts: [successAiContact],
    };

    // Push to Success.ai API
    const response = await fetch('https://api.success.ai/v1/contact/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error('Success.ai returned non-JSON response:', response.status, responseText);
      responseData = { error: `Non-JSON response (HTTP ${response.status}): ${responseText.slice(0, 200)}` };
    }

    console.log('Success.ai response:', response.status, JSON.stringify(responseData).slice(0, 500));

    // Success.ai returns: { status: "success", totalSent: 2, contactsUploaded: 2, ... }
    const success = response.ok && responseData.status === 'success';
    const contactsUploaded = (responseData.contactsUploaded as number) ?? 0;
    const skippedAsDuplicate = success && contactsUploaded === 0;
    const errorMessage = success ? null : (responseData.error || responseData.message || responseData.detail || JSON.stringify(responseData).slice(0, 300));

    if (skippedAsDuplicate) {
      console.warn(`Lead ${contact.email} was skipped by Success.ai (already in campaign ${campaignId})`);
    }

    // Record the handoff
    const { error: handoffError } = await supabase.from('lead_handoffs').insert({
      campaign_id: internalCampaignId || null,
      progress_id: progressId || null,
      contact_id: contact.id,
      organization_id: organizationId || null,
      tool_type: 'successai',
      connection_id: connectionId,
      external_campaign_id: campaignId,
      email_subject: leadsOnly ? null : personalizedSubject,
      email_body: leadsOnly ? null : personalizedBody,
      push_mode: leadsOnly ? 'leads_only' : 'with_sequences',
      status: success ? 'sent' : 'failed',
      external_lead_id: null, // Success.ai doesn't return lead IDs in add response
      pushed_at: new Date().toISOString(),
      error_message: errorMessage,
    });

    if (handoffError) {
      console.error('Failed to record handoff:', handoffError);
    }

    if (!success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          successAiResponse: responseData,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        uploadCount: contactsUploaded,
        totalSent: responseData.totalSent || 0,
        skippedAsDuplicate,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Push to Success.ai error:', error);
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
