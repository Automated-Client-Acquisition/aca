/**
 * Approve and Push Sequence Edge Function
 *
 * Approves reviewed email sequences and pushes them to the external email tool.
 * After push, advances the campaign lead progress accordingly.
 *
 * Endpoint: POST /approve-and-push-sequence
 * Body: { sequenceIds: string[] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getNextNode, type WorkflowNode, type WorkflowEdge } from '../_shared/workflow-utils.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ApproveAndPushRequest {
  sequenceIds: string[];
}

interface SequenceEmail {
  step: number;
  subject: string;
  body: string;
  delay_days: number;
}

interface NodeConfig {
  connectionId?: string;
  externalCampaignId?: string;
  externalWorkflowId?: string;
  exitAfterHandoff?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const body: ApproveAndPushRequest = await req.json();
    const { sequenceIds } = body;

    if (!sequenceIds || sequenceIds.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'sequenceIds is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: sequenceOrgs, error: sequenceOrgsError } = await supabase
      .from('contact_email_sequences')
      .select('organization_id')
      .in('id', sequenceIds);

    if (sequenceOrgsError) {
      throw new Error(`Failed to load sequences: ${sequenceOrgsError.message}`);
    }
    if (!sequenceOrgs || sequenceOrgs.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Sequences not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The service-role client acts on whatever rows the body names, so the caller
    // must be able to access each row's org (a valid anon-key JWT alone is not enough).
    // One inaccessible org rejects the whole request before anything is pushed.
    for (const orgId of new Set(sequenceOrgs.map((s) => s.organization_id as string))) {
      try { await assertOrgAccess(req, supabase, orgId); } catch (authErr) { return unauthorized(authErr, corsHeaders); }
    }

    const results: Array<{ sequenceId: string; status: 'success' | 'failed'; error?: string }> = [];

    for (const sequenceId of sequenceIds) {
      try {
        const result = await approveAndPushOne(supabase, sequenceId);
        results.push({ sequenceId, ...result });
      } catch (err) {
        console.error(`[approve-and-push] Error for sequence ${sequenceId}:`, err);
        results.push({
          sequenceId,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    const pushed = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;

    return new Response(
      JSON.stringify({ success: failed === 0, pushed, failed, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[approve-and-push] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function approveAndPushOne(
  supabase: SupabaseClient<any>,
  sequenceId: string,
): Promise<{ status: 'success' | 'failed'; error?: string }> {
  // 1. Fetch the sequence
  const { data: sequence, error: seqError } = await supabase
    .from('contact_email_sequences')
    .select('*')
    .eq('id', sequenceId)
    .eq('status', 'ready')
    .single();

  if (seqError || !sequence) {
    return { status: 'failed', error: 'Sequence not found or not in ready status' };
  }

  const emails = sequence.emails as SequenceEmail[];
  const toolType = sequence.tool_type as string;
  const nodeConfig = sequence.node_config as NodeConfig | null;

  if (!toolType) {
    return { status: 'failed', error: 'Sequence has no tool_type configured' };
  }

  // 2. Fetch contact details
  const { data: contact, error: contactError } = await supabase
    .from('crm_contacts')
    .select('id, first_name, last_name, display_name, company, job_title, primary_email, primary_linkedin_url, phone, website')
    .eq('id', sequence.contact_id)
    .single();

  if (contactError || !contact) {
    return { status: 'failed', error: 'Contact not found' };
  }

  if (!contact.primary_email) {
    return { status: 'failed', error: 'Contact has no email address' };
  }

  // 3. Build custom fields from (potentially edited) emails
  const customFields: Record<string, string> = {};
  emails.forEach((email, index) => {
    const num = index + 1;
    customFields[`email_subject_${num}`] = email.subject;
    customFields[`email_body_${num}`] = email.body;
  });
  customFields['email_count'] = String(emails.length);

  const personalizedSubject = emails[0]?.subject || '';
  const personalizedBody = emails[0]?.body || '';

  // 4. Determine which push function to call
  let pushFunction: string;
  let pushBody: Record<string, unknown>;

  if (toolType === 'smartlead') {
    pushFunction = 'push-to-smartlead';
    pushBody = {
      connectionId: nodeConfig?.connectionId,
      campaignId: nodeConfig?.externalCampaignId,
      contact: {
        id: contact.id,
        email: contact.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contact.company,
        jobTitle: contact.job_title,
        linkedinUrl: contact.primary_linkedin_url,
        phone: contact.phone,
      },
      personalizedSubject,
      personalizedBody,
      customFields,
      progressId: sequence.progress_id,
      internalCampaignId: sequence.campaign_id,
    };
  } else if (toolType === 'instantly') {
    pushFunction = 'push-to-instantly';
    pushBody = {
      connectionId: nodeConfig?.connectionId,
      campaignId: nodeConfig?.externalCampaignId,
      contact: {
        id: contact.id,
        email: contact.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contact.company,
        jobTitle: contact.job_title,
        linkedinUrl: contact.primary_linkedin_url,
        phone: contact.phone,
        website: contact.website,
      },
      personalizedSubject,
      personalizedBody,
      customFields,
      progressId: sequence.progress_id,
      internalCampaignId: sequence.campaign_id,
    };
  } else if (toolType === 'leadconnector') {
    pushFunction = 'push-to-leadconnector-email';
    pushBody = {
      organizationId: sequence.organization_id,
      workflowId: nodeConfig?.externalWorkflowId,
      contact: {
        id: contact.id,
        email: contact.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contact.company,
        jobTitle: contact.job_title,
        linkedinUrl: contact.primary_linkedin_url,
        phone: contact.phone,
        website: contact.website,
      },
      personalizedSubject,
      personalizedBody,
      customFields,
      progressId: sequence.progress_id,
      internalCampaignId: sequence.campaign_id,
    };
  } else if (toolType === 'zapmail') {
    pushFunction = 'push-to-zapmail';
    pushBody = {
      contact: {
        id: contact.id,
        email: contact.primary_email,
        firstName: contact.first_name,
        lastName: contact.last_name,
        company: contact.company,
        jobTitle: contact.job_title,
        linkedinUrl: contact.primary_linkedin_url,
      },
      personalizedSubject,
      personalizedBody,
      customFields,
      sequenceName: `Reviewed · ${contact.first_name || contact.primary_email}`,
      organizationId: sequence.organization_id,
      progressId: sequence.progress_id,
      internalCampaignId: sequence.campaign_id,
    };
  } else {
    return { status: 'failed', error: `Unknown tool type: ${toolType}` };
  }

  // 5. Push to external tool
  console.log(`[approve-and-push] Pushing sequence ${sequenceId} to ${pushFunction}`);

  const { data: pushResult, error: pushError } = await supabase.functions.invoke(pushFunction, {
    body: pushBody,
  });

  if (pushError) {
    console.error(`[approve-and-push] Push failed:`, pushError.message);
    return { status: 'failed', error: pushError.message };
  }

  if (!pushResult?.success) {
    console.error(`[approve-and-push] Push returned failure:`, pushResult?.error);
    return { status: 'failed', error: pushResult?.error || 'Push failed' };
  }

  console.log(`[approve-and-push] Push successful for sequence ${sequenceId}`);

  // 6. Update sequence status
  await supabase
    .from('contact_email_sequences')
    .update({
      status: 'pushed',
      pushed_to_tool: toolType,
      pushed_at: new Date().toISOString(),
      external_campaign_id: nodeConfig?.externalCampaignId || null,
      connection_id: nodeConfig?.connectionId || null,
    })
    .eq('id', sequenceId);

  // 7. Advance campaign lead progress
  if (sequence.progress_id) {
    const exitAfterHandoff = nodeConfig?.exitAfterHandoff !== false;

    if (exitAfterHandoff) {
      // Mark as handed off and exit campaign
      await supabase
        .from('campaign_lead_progress')
        .update({
          status: 'handed_off',
          current_node_id: null,
        })
        .eq('id', sequence.progress_id);
    } else {
      // Advance to next node — need to read campaign sequence to find next node
      await advanceToNextNode(supabase, sequence.progress_id, sequence.campaign_id);
    }
  }

  // 8. Log to campaign action log
  if (sequence.campaign_id && sequence.progress_id) {
    await supabase.from('campaign_action_log').insert({
      campaign_id: sequence.campaign_id,
      progress_id: sequence.progress_id,
      contact_id: sequence.contact_id,
      node_id: 'review-approved',
      node_type: toolType === 'zapmail' ? 'sendToZapMail' : toolType === 'leadconnector' ? 'sendToLeadConnector' : toolType === 'instantly' ? 'sendToInstantly' : 'sendToSmartlead',
      action_type: 'email_handoff',
      channel: 'email',
      status: 'success',
      external_id: pushResult.leadId || pushResult.contactId || null,
      executed_at: new Date().toISOString(),
      message_content: `${emails.length}-email sequence pushed to ${toolType}`,
      ai_generated: true,
    });
  }

  return { status: 'success' };
}

/**
 * Advance lead progress to the next node in the campaign sequence.
 */
async function advanceToNextNode(
  supabase: SupabaseClient<any>,
  progressId: string,
  campaignId: string | null,
) {
  if (!campaignId) {
    // No campaign context — just mark as completed
    await supabase
      .from('campaign_lead_progress')
      .update({ status: 'completed', current_node_id: null })
      .eq('id', progressId);
    return;
  }

  // Get the current node ID from progress
  const { data: progress } = await supabase
    .from('campaign_lead_progress')
    .select('current_node_id')
    .eq('id', progressId)
    .single();

  if (!progress?.current_node_id) {
    await supabase
      .from('campaign_lead_progress')
      .update({ status: 'completed', current_node_id: null })
      .eq('id', progressId);
    return;
  }

  // Get campaign sequence
  const { data: campaign } = await supabase
    .from('linkedin_campaigns')
    .select('sequence_nodes, sequence_edges')
    .eq('id', campaignId)
    .single();

  if (!campaign?.sequence_nodes) {
    await supabase
      .from('campaign_lead_progress')
      .update({ status: 'completed', current_node_id: null })
      .eq('id', progressId);
    return;
  }

  const nodes = campaign.sequence_nodes as WorkflowNode[];
  const edges = (campaign.sequence_edges || []) as WorkflowEdge[];

  const nextNode = getNextNode(progress.current_node_id, nodes, edges);

  await supabase
    .from('campaign_lead_progress')
    .update({
      current_node_id: nextNode?.id || null,
      status: nextNode ? 'pending' : 'completed',
      next_action_at: new Date().toISOString(),
    })
    .eq('id', progressId);
}
