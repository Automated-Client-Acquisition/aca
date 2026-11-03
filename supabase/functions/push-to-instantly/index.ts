/**
 * Push Lead to Instantly
 *
 * Pushes a lead with fully personalized email content to an Instantly campaign.
 * The email content is stored in the 'personalization' field which can be used
 * in Instantly's email templates.
 *
 * @see https://developer.instantly.ai/api/v2/lead
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushToInstantlyRequest {
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

interface InstantlyLeadPayload {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone?: string;
  website?: string;
  personalization?: string;
  campaign?: string;
  custom_variables?: Record<string, string>;
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
    const body: PushToInstantlyRequest = await req.json();
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

    if (connection.tool_type !== 'instantly') {
      throw new Error(`Invalid connection type: expected instantly, got ${connection.tool_type}`);
    }

    const apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // Build custom variables based on mode
    const baseCustomVariables: Record<string, string> = {
      first_name: contact.firstName || '',
      last_name: contact.lastName || '',
      company_name: contact.company || '',
      job_title: contact.jobTitle || '',
      linkedin_url: contact.linkedinUrl || '',
      ...customFields,
    };

    // Only add email content to custom variables if not in leadsOnly mode
    if (!leadsOnly && personalizedSubject && personalizedBody) {
      baseCustomVariables.email_subject = personalizedSubject;
      baseCustomVariables.email_body = personalizedBody;
    }

    // Build Instantly lead payload
    // Instantly uses 'personalization' field for custom email content
    // and 'custom_variables' for additional merge fields
    const leadPayload: InstantlyLeadPayload = {
      email: contact.email,
      first_name: contact.firstName || undefined,
      last_name: contact.lastName || undefined,
      company_name: contact.company || undefined,
      phone: contact.phone || undefined,
      website: contact.website || undefined,
      // Use personalization field for the email body (only if not leadsOnly)
      personalization: leadsOnly ? undefined : personalizedBody,
      // Associate with campaign
      campaign: campaignId,
      // Store all personalization data as custom variables
      custom_variables: baseCustomVariables,
    };

    // Push to Instantly API v2
    const instantlyUrl = `https://api.instantly.ai/api/v2/leads`;
    const response = await fetch(instantlyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(leadPayload),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error('Instantly returned non-JSON response:', response.status, responseText);
      responseData = { error: `Non-JSON response (HTTP ${response.status}): ${responseText.slice(0, 200)}` };
    }

    console.log('Instantly response:', response.status, JSON.stringify(responseData).slice(0, 500));

    // Determine success and extract lead ID
    const success = response.ok;
    const externalLeadId = (responseData as any).id || null;
    const errorMessage = success ? null : (responseData.error || responseData.message || responseData.detail || JSON.stringify(responseData).slice(0, 300));

    // Record the handoff
    const { error: handoffError } = await supabase.from('lead_handoffs').insert({
      campaign_id: internalCampaignId || null,
      progress_id: progressId || null,
      contact_id: contact.id,
      organization_id: organizationId || null,
      tool_type: 'instantly',
      connection_id: connectionId,
      external_campaign_id: campaignId,
      email_subject: leadsOnly ? null : personalizedSubject,
      email_body: leadsOnly ? null : personalizedBody,
      push_mode: leadsOnly ? 'leads_only' : 'with_sequences',
      status: success ? 'sent' : 'failed',
      external_lead_id: externalLeadId,
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
          instantlyResponse: responseData,
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
        leadId: externalLeadId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Push to Instantly error:', error);
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
