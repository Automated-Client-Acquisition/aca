/**
 * Edge Function: Inbox Autopilot Trigger
 *
 * Triggers AI autopilot processing on an existing conversation.
 * Called when a user enables AI on a conversation that already has messages,
 * so the agent generates an initial draft for the latest inbound message.
 *
 * Input: { conversationId }
 * Output: { success, action?, queued?, error? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { classifyReply } from '../_shared/reply-classifier.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { authenticateRequest, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Authenticate (JWT or CLI token)
    let caller;
    try {
      caller = await authenticateRequest(req, supabase);
    } catch (err) {
      return unauthorized(err, corsHeaders);
    }
    const user = { id: caller.user_id };

    const { conversationId } = await req.json();

    if (!conversationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing conversationId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Fetch conversation
    const { data: conversation, error: convError } = await supabase
      .from('crm_conversations')
      .select('id, ai_enabled, channel, contact_id, organization_id, mailbox_id')
      .eq('id', conversationId)
      .single();

    if (convError || !conversation) {
      return new Response(
        JSON.stringify({ success: false, error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Verify user belongs to the conversation's organization
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', conversation.organization_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!conversation.ai_enabled) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI not enabled on this conversation' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Find the latest inbound message
    const { data: latestMessage } = await supabase
      .from('crm_messages')
      .select('id, content')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestMessage) {
      return new Response(
        JSON.stringify({ success: false, error: 'No inbound messages found' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Check if there's already a pending draft for this message
    const { data: existingDraft } = await supabase
      .from('inbox_autopilot_queue')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('trigger_message_id', latestMessage.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (existingDraft) {
      return new Response(
        JSON.stringify({ success: true, action: 'already_queued', queued: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Get OpenRouter API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', conversation.organization_id)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) {
      return new Response(
        JSON.stringify({ success: false, error: 'No OpenRouter API key configured' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);

    // Get org's default LLM model
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', conversation.organization_id)
      .maybeSingle();
    const orgModel = orgSettings?.default_llm_model || undefined;

    // Fetch recent thread context for classifier (last 5 messages for context)
    let threadContext = '';
    try {
      const { data: recentMsgs } = await supabase
        .from('crm_messages')
        .select('content, sender_type')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(5);

      if (recentMsgs && recentMsgs.length > 1) {
        threadContext = recentMsgs.reverse()
          .slice(0, -1) // exclude the latest (which is body_text)
          .map((m: any) => `${m.sender_type === 'contact' ? 'Them' : 'You'}: ${(m.content || '').slice(0, 300)}`)
          .join('\n');
      }
    } catch { /* non-critical */ }

    // Classify the latest message intent
    let intent = 'neutral';
    let confidence = 0.5;

    try {
      const classification = await classifyReply(
        {
          from_email: '',
          subject: '',
          body_text: latestMessage.content || '',
          thread_context: threadContext || undefined,
        },
        openRouterKey,
        orgModel,
      );
      intent = classification.intent;
      confidence = classification.confidence;
    } catch (classifyErr) {
      console.warn('[Autopilot Trigger] Classification failed, using neutral:', classifyErr);
    }

    // Reset escalated state when manually triggered (user re-enabled AI)
    const { data: stateCheck } = await supabase
      .from('crm_conversations')
      .select('autopilot_state')
      .eq('id', conversationId)
      .single();

    if (stateCheck?.autopilot_state?.phase === 'escalated') {
      console.log(`[Autopilot Trigger] Resetting escalated state for conversation ${conversationId}`);
      await supabase
        .from('crm_conversations')
        .update({
          autopilot_state: { phase: 'greeting', turn_count: 0, last_autopilot_at: null, escalation_reason: null },
        })
        .eq('id', conversationId);
    }

    // Run autopilot
    const result = await processAutopilot(
      supabase,
      {
        conversationId,
        contactId: conversation.contact_id,
        organizationId: conversation.organization_id,
        intent,
        confidence,
        inboundMessageId: latestMessage.id,
        channel: conversation.channel,
        mailboxId: conversation.mailbox_id || undefined,
        messageContent: latestMessage.content || '',
        model: orgModel,
      },
      openRouterKey,
    );

    console.log(`[Autopilot Trigger] Result for ${conversationId}: ${result.action}`);

    return new Response(
      JSON.stringify({ success: true, action: result.action, queued: result.queued }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[Autopilot Trigger] Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
