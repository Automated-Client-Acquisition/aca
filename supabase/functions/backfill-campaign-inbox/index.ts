/**
 * Backfill Campaign Inbox
 *
 * One-shot function that scans campaign_lead_progress for leads that have
 * received outbound messages (or replied) but do NOT yet have a
 * crm_conversations record.  For each one it:
 *   1. Creates a crm_conversations record via get_or_create_conversation()
 *   2. Inserts crm_messages for every action_log entry (outbound + reply_detected)
 *   3. Links the conversation back to campaign_lead_progress.crm_conversation_id
 *
 * Call with optional { organizationId } to scope to one org, or omit for all.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { isServiceRoleRequest } from '../_shared/org-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // verify_jwt=false: only pg_cron / internal callers (service key) may trigger this.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const filterOrgId = body.organizationId as string | undefined;

    // Find campaign leads that have actions logged but no CRM conversation yet
    let query = supabase
      .from('campaign_lead_progress')
      .select(`
        id,
        campaign_id,
        contact_id,
        sender_account_id,
        status,
        replied_at,
        linkedin_campaigns!inner (
          id,
          name,
          organization_id
        )
      `)
      .is('crm_conversation_id', null)
      .in('status', ['in_progress', 'waiting', 'replied', 'completed', 'stopped']);

    if (filterOrgId) {
      query = query.eq('linkedin_campaigns.organization_id', filterOrgId);
    }

    const { data: progressRows, error: progressError } = await query.limit(500);

    if (progressError) {
      throw new Error(`Failed to fetch progress: ${progressError.message}`);
    }

    if (!progressRows || progressRows.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No campaign leads to backfill',
        backfilled: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[Backfill] Found ${progressRows.length} campaign leads without CRM conversations`);

    let backfilled = 0;
    let errors = 0;
    const errorDetails: Array<{ progressId: string; error: string }> = [];

    for (const progress of progressRows) {
      try {
        const campaign = progress.linkedin_campaigns as {
          id: string; name: string; organization_id: string;
        };
        const orgId = campaign.organization_id;
        const contactId = progress.contact_id;

        // Get the contact's LinkedIn identity for external_participant_id
        const { data: identity } = await supabase
          .from('crm_contact_identities')
          .select('platform_user_id')
          .eq('contact_id', contactId)
          .eq('channel', 'linkedin')
          .maybeSingle();

        // Create CRM conversation
        const { data: conversationId, error: convError } = await supabase.rpc(
          'get_or_create_conversation',
          {
            p_org_id: orgId,
            p_contact_id: contactId,
            p_channel: 'linkedin',
            p_channel_account_id: progress.sender_account_id || null,
            p_external_conversation_id: null,
            p_external_participant_id: identity?.platform_user_id || null,
            p_mailbox_id: null,
          }
        );

        if (convError || !conversationId) {
          const errMsg = convError?.message || 'No conversation ID returned';
          console.error(`[Backfill] Failed to create conversation for progress ${progress.id}:`, errMsg);
          errorDetails.push({ progressId: progress.id, error: `get_or_create_conversation: ${errMsg}` });
          errors++;
          continue;
        }

        // Fetch all action log entries for this lead (outbound messages + replies)
        const { data: actions } = await supabase
          .from('campaign_action_log')
          .select('*')
          .eq('progress_id', progress.id)
          .in('action_type', ['message', 'inmail', 'connection_request', 'reply_detected'])
          .order('executed_at', { ascending: true });

        if (actions && actions.length > 0) {
          for (const action of actions) {
            const isReply = action.action_type === 'reply_detected';

            // Dedup by external_id
            if (action.external_id) {
              const { data: existing } = await supabase
                .from('crm_messages')
                .select('id')
                .eq('external_message_id', action.external_id)
                .maybeSingle();

              if (existing) continue;
            }

            await supabase.from('crm_messages').insert({
              organization_id: orgId,
              conversation_id: conversationId,
              contact_id: contactId,
              direction: isReply ? 'inbound' : 'outbound',
              sender_type: isReply ? 'contact' : 'user',
              content: action.message_content || `[${action.action_type}]`,
              content_type: 'text',
              external_message_id: action.external_id || null,
              status: 'delivered',
              delivered_at: action.executed_at || new Date().toISOString(),
              metadata: {
                source: 'campaign_backfill',
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                action_type: action.action_type,
                node_id: action.node_id,
              },
            });
          }
        }

        // Link conversation back to progress
        await supabase
          .from('campaign_lead_progress')
          .update({ crm_conversation_id: conversationId })
          .eq('id', progress.id);

        backfilled++;
        console.log(`[Backfill] Created conversation ${conversationId} for progress ${progress.id} (${actions?.length || 0} messages)`);

      } catch (rowError) {
        const errMsg = rowError instanceof Error ? rowError.message : String(rowError);
        console.error(`[Backfill] Error processing progress ${progress.id}:`, errMsg);
        errorDetails.push({ progressId: progress.id, error: errMsg });
        errors++;
      }
    }

    console.log(`[Backfill] Done: ${backfilled} backfilled, ${errors} errors`);

    return new Response(JSON.stringify({
      success: true,
      total: progressRows.length,
      backfilled,
      errors,
      errorDetails: errorDetails.slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
