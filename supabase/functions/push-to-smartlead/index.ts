/**
 * Push Lead to Smartlead
 *
 * Pushes a lead with fully personalized email content to a Smartlead campaign.
 * The email subject and body are passed as custom fields so they can be used
 * in Smartlead's email templates with variables like {{email_subject}}, {{email_body}}.
 *
 * @see https://api.smartlead.ai/reference/add-leads-to-a-campaign-by-id
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@^2.39.0';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PushToSmartleadRequest {
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

interface SmartleadLeadPayload {
  lead_list: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    phone_number?: string;
    website?: string;
    linkedin_profile?: string;
    custom_fields: Record<string, string>;
  }>;
  settings: {
    ignore_global_block_list: boolean;
    ignore_unsubscribe_list: boolean;
    ignore_community_bounce_list: boolean;
    ignore_duplicate_leads_in_other_campaign: boolean;
    return_lead_ids: boolean;
  };
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
    const body: PushToSmartleadRequest = await req.json();
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

    if (connection.tool_type !== 'smartlead') {
      throw new Error(`Invalid connection type: expected smartlead, got ${connection.tool_type}`);
    }

    const apiKey = await decryptApiKey(connection.api_key_encrypted, encryptionKey);

    // Build custom fields based on mode
    const baseCustomFields: Record<string, string> = {
      first_name: contact.firstName || '',
      job_title: contact.jobTitle || '',
      company_name: contact.company || '',
      ...customFields,
    };

    // Only add email content to custom fields if not in leadsOnly mode
    if (!leadsOnly && personalizedSubject && personalizedBody) {
      baseCustomFields.email_subject = personalizedSubject;
      baseCustomFields.email_body = personalizedBody;
    }

    // Build Smartlead lead payload
    const leadPayload: SmartleadLeadPayload = {
      lead_list: [
        {
          email: contact.email,
          first_name: contact.firstName || undefined,
          last_name: contact.lastName || undefined,
          company_name: contact.company || undefined,
          phone_number: contact.phone || undefined,
          website: contact.website || undefined,
          linkedin_profile: contact.linkedinUrl || undefined,
          custom_fields: baseCustomFields,
        },
      ],
      settings: {
        ignore_global_block_list: false,
        ignore_unsubscribe_list: false,
        ignore_community_bounce_list: false,
        ignore_duplicate_leads_in_other_campaign: true, // Allow same lead in multiple campaigns
        return_lead_ids: true,
      },
    };

    // Push to Smartlead API
    const smartleadUrl = `https://server.smartlead.ai/api/v1/campaigns/${campaignId}/leads?api_key=${apiKey}`;
    const response = await fetch(smartleadUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(leadPayload),
    });

    const responseText = await response.text();
    let responseData: Record<string, unknown>;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      console.error('Smartlead returned non-JSON response:', response.status, responseText);
      responseData = { error: `Non-JSON response (HTTP ${response.status}): ${responseText.slice(0, 200)}` };
    }

    console.log('Smartlead response:', response.status, JSON.stringify(responseData).slice(0, 500));

    // Extract lead ID from response
    let externalLeadId: string | null = null;
    if ((responseData as any).emailToLeadIdMap?.newlyAddedLeads?.[contact.email]) {
      externalLeadId = (responseData as any).emailToLeadIdMap.newlyAddedLeads[contact.email];
    } else if ((responseData as any).emailToLeadIdMap?.existingLeads?.[contact.email]) {
      externalLeadId = (responseData as any).emailToLeadIdMap.existingLeads[contact.email];
    }

    // Determine success
    const success = response.ok && (responseData.ok !== false);
    const errorMessage = success ? null : (responseData.error || responseData.message || responseData.detail || JSON.stringify(responseData).slice(0, 300));

    // Record the handoff
    const { error: handoffError } = await supabase.from('lead_handoffs').insert({
      campaign_id: internalCampaignId || null,
      progress_id: progressId || null,
      contact_id: contact.id,
      organization_id: organizationId || null,
      tool_type: 'smartlead',
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
          smartleadResponse: responseData,
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
        uploadCount: responseData.upload_count || 1,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Push to Smartlead error:', error);
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
