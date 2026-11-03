/**
 * Edge Function: AI Chatbot Respond
 *
 * Generates and queues an AI response for an active chatbot conversation.
 * Called by crm-sync-inbound or the webhook handler when an inbound message
 * is detected on a conversation with an active AI chatbot.
 *
 * Input: { chatbotConversationId, messageContent, senderName }
 * Output: { success, message?, error? }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { chatbotModel } from '../_shared/default-models.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';
import { retrieveRelevantChunks, formatKnowledgeContext } from '../_shared/knowledge-retrieval.ts';
import { sanitizeAIOutput } from '../_shared/sanitize-ai-output.ts';
import { classifyReply, type ClassificationResult } from '../_shared/reply-classifier.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { evaluateFollowupRules } from '../_shared/followup-rule-engine.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESPONSE_COOLDOWN_MS = 60_000; // 60 seconds between AI responses
const LLM_TIMEOUT_MS = 30_000; // 30 second timeout for LLM call

interface AiRespondRequest {
  chatbotConversationId: string;
  messageContent: string;
  senderName: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  // Only unipile-webhook-handler and crm-sync-inbound call this, with service-role clients.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body: AiRespondRequest = await req.json();
    const { chatbotConversationId, messageContent, senderName } = body;

    if (!chatbotConversationId || !messageContent) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing chatbotConversationId or messageContent' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[AI Respond] Processing conversation ${chatbotConversationId}`);

    // Load conversation with campaign and lead
    const { data: conversation, error: convError } = await supabase
      .from('ai_chatbot_conversations')
      .select(`
        *,
        campaign:unipile_campaigns(
          *,
          account:unipile_accounts(id, status, provider)
        ),
        lead:unipile_leads(*)
      `)
      .eq('id', chatbotConversationId)
      .single();

    if (convError || !conversation) {
      return new Response(
        JSON.stringify({ success: false, error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Guard: conversation must be active
    if (conversation.status !== 'active') {
      console.log(`[AI Respond] Conversation ${chatbotConversationId} is ${conversation.status}, skipping`);
      return new Response(
        JSON.stringify({ success: false, error: `Conversation is ${conversation.status}` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Guard: max turns
    if (conversation.turn_count >= conversation.max_turns) {
      console.log(`[AI Respond] Max turns reached (${conversation.turn_count}/${conversation.max_turns}), handing off`);
      await handoffConversation(supabase, conversation, 'Max conversation turns reached');
      return new Response(
        JSON.stringify({ success: true, handedOff: true, reason: 'max_turns_reached' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Guard: cooldown (prevent rapid response loops)
    if (conversation.last_ai_response_at) {
      const lastResponseTime = new Date(conversation.last_ai_response_at).getTime();
      const timeSinceLastResponse = Date.now() - lastResponseTime;
      if (timeSinceLastResponse < RESPONSE_COOLDOWN_MS) {
        console.log(`[AI Respond] Cooldown active (${timeSinceLastResponse}ms < ${RESPONSE_COOLDOWN_MS}ms)`);
        return new Response(
          JSON.stringify({ success: false, error: 'Cooldown active' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const campaign = conversation.campaign;
    const lead = conversation.lead;
    // The inbox channel of the account the lead commented on (lead magnets run on LinkedIn and Instagram).
    const channel = channelForProvider(campaign?.account?.provider);
    const aiMode: string = campaign?.ai_mode || 'chatbot_only';

    // ================================================================
    // Get OpenRouter API key (needed for classification + LLM)
    // ================================================================
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', conversation.organization_id)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) {
      console.error('[AI Respond] No OpenRouter API key configured');
      return new Response(
        JSON.stringify({ success: false, error: 'No OpenRouter API key configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const encKey = Deno.env.get('ENCRYPTION_KEY')!;
    const openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encKey);

    // Get org's default LLM model
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('default_llm_model')
      .eq('organization_id', conversation.organization_id)
      .maybeSingle();
    const orgModel = orgSettings?.default_llm_model || undefined;

    // ================================================================
    // Reply Classification (runs for ALL ai_modes)
    // ================================================================
    let classification: ClassificationResult | null = null;

    try {
      classification = await classifyReply(
        { from_email: senderName || '', subject: '', body_text: messageContent },
        openRouterKey,
        orgModel,
      );

      if (classification) {
        await supabase
          .from('unipile_leads')
          .update({
            lead_intent: classification.intent,
            intent_confidence: classification.confidence,
            intent_classified_at: new Date().toISOString(),
          })
          .eq('id', conversation.lead_id);

        console.log(`[AI Respond] Classified: ${classification.intent} (${(classification.confidence * 100).toFixed(0)}%)`);
      }
    } catch (classifyErr) {
      console.warn('[AI Respond] Classification failed, continuing:', classifyErr);
    }

    // ================================================================
    // Stop Conditions (from campaign.smart_config)
    // ================================================================
    const smartConfig = (campaign?.smart_config || {}) as Record<string, unknown>;

    if (classification) {
      // Stop on auto-reply
      if (smartConfig.stop_on_auto_reply && classification.intent === 'auto_reply') {
        console.log(`[AI Respond] Stop condition: auto-reply detected for lead ${conversation.lead_id}`);
        await handoffConversation(supabase, conversation, 'Auto-reply detected (stop condition)');
        return new Response(
          JSON.stringify({ success: true, handedOff: true, reason: 'stop_on_auto_reply' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Stop on do_not_contact / unsubscribe
      if (['do_not_contact', 'unsubscribe'].includes(classification.intent)) {
        console.log(`[AI Respond] ${classification.intent} detected, stopping conversation`);
        await supabase
          .from('ai_chatbot_conversations')
          .update({
            status: 'stopped',
            handoff_at: new Date().toISOString(),
            handoff_reason: `${classification.intent} detected`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', chatbotConversationId);

        await supabase
          .from('unipile_leads')
          .update({
            ai_conversation_active: false,
            status: classification.intent === 'do_not_contact' ? 'do_not_contact' : 'skipped',
          })
          .eq('id', conversation.lead_id);

        return new Response(
          JSON.stringify({ success: true, handedOff: true, reason: classification.intent }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ================================================================
    // Autopilot Only Mode: route to unified autopilot, skip chatbot
    // ================================================================
    if (aiMode === 'autopilot_only' && campaign?.autopilot_config?.enabled) {
      const crmConversationId = await ensureCrmConversation(supabase, conversation, lead, campaign);

      if (!crmConversationId) {
        console.error(`[AI Respond] autopilot_only but no CRM conversation for lead ${conversation.lead_id}, skipping`);
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot route to autopilot: no CRM conversation' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Guard: autopilot needs a valid CRM contact
      if (!lead?.crm_contact_id) {
        console.error(`[AI Respond] autopilot_only but no CRM contact for lead ${conversation.lead_id}, skipping`);
        await supabase.from('ai_chatbot_conversations')
          .update({ metadata: { ...(conversation.metadata as any || {}), autopilot_skip_reason: 'missing_crm_contact' } })
          .eq('id', chatbotConversationId);
        return new Response(
          JSON.stringify({ success: false, error: 'Cannot route to autopilot: no CRM contact' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Store inbound message in CRM
      const { data: crmMessage, error: crmMsgError } = await supabase
        .from('crm_messages')
        .insert({
          conversation_id: crmConversationId,
          organization_id: conversation.organization_id,
          contact_id: lead.crm_contact_id,
          direction: 'inbound',
          sender_type: 'contact',
          content: messageContent,
          channel,
          status: 'received',
          metadata: {
            classification: classification ? {
              intent: classification.intent,
              confidence: classification.confidence,
            } : null,
            source: 'lead_magnet',
            chatbot_conversation_id: chatbotConversationId,
          },
        })
        .select('id')
        .single();

      if (crmMsgError) {
        console.error('[AI Respond] Failed to store inbound CRM message:', crmMsgError.message);
      }

      // Process via unified autopilot
      try {
        const autopilotResult = await processAutopilot(
          supabase,
          {
            conversationId: crmConversationId,
            contactId: lead.crm_contact_id,
            organizationId: conversation.organization_id,
            intent: classification?.intent || 'neutral',
            confidence: classification?.confidence || 0,
            inboundMessageId: crmMessage?.id || '',
            leadMagnetCampaignId: conversation.campaign_id,
            channel,
            messageContent,
            model: orgModel,
          },
          openRouterKey,
        );

        console.log(`[AI Respond] Autopilot result: ${autopilotResult.action}`);

        // Update chatbot conversation history to record what happened
        const conversationHistory = (conversation.conversation_history || []) as Array<any>;
        await supabase
          .from('ai_chatbot_conversations')
          .update({
            conversation_history: [
              ...conversationHistory,
              { role: 'user', content: messageContent, timestamp: new Date().toISOString() },
              { role: 'system', content: `[Autopilot: ${autopilotResult.action}]`, timestamp: new Date().toISOString() },
            ],
            turn_count: conversation.turn_count + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', chatbotConversationId);

        return new Response(
          JSON.stringify({ success: true, autopilot: true, action: autopilotResult.action }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (autopilotErr) {
        // In autopilot_only mode, do NOT fall through to chatbot — return error
        console.error('[AI Respond] Autopilot error in autopilot_only mode:', autopilotErr);
        return new Response(
          JSON.stringify({ success: false, error: 'Autopilot processing failed' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ================================================================
    // Check for handoff keywords in user message
    // ================================================================
    const handoffKeywords = campaign?.ai_chatbot_handoff_keywords || [];
    const messageLower = messageContent.toLowerCase();

    // Default handoff keywords if none configured
    const defaultHandoffKeywords = ['speak to someone', 'talk to a person', 'human agent', 'real person', 'talk to human'];
    const allHandoffKeywords = [...handoffKeywords, ...defaultHandoffKeywords];

    const matchedHandoffKeyword = allHandoffKeywords.find(kw =>
      messageLower.includes(kw.toLowerCase())
    );

    if (matchedHandoffKeyword) {
      console.log(`[AI Respond] Handoff keyword detected: "${matchedHandoffKeyword}"`);
      await handoffConversation(supabase, conversation, `User requested human: "${matchedHandoffKeyword}"`);

      // Notify webhook
      if (campaign?.webhook_url) {
        try {
          await fetch(campaign.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'ai_handoff_requested',
              conversation_id: chatbotConversationId,
              lead_id: conversation.lead_id,
              campaign_id: conversation.campaign_id,
              reason: `Handoff keyword: "${matchedHandoffKeyword}"`,
              conversation_history: conversation.conversation_history,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (whErr) {
          console.error('[AI Respond] Webhook notification failed:', whErr);
        }
      }

      return new Response(
        JSON.stringify({ success: true, handedOff: true, reason: 'handoff_keyword', keyword: matchedHandoffKeyword }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ================================================================
    // CRM Bridge: ensure conversation + log inbound for ALL chatbot modes
    // ================================================================
    let crmConversationId: string | null = null;

    try {
      crmConversationId = await ensureCrmConversation(supabase, conversation, lead, campaign);

      if (crmConversationId && lead?.crm_contact_id) {
        // Log the inbound message to CRM so the full thread is visible in the inbox
        const { error: crmInboundErr } = await supabase
          .from('crm_messages')
          .insert({
            conversation_id: crmConversationId,
            organization_id: conversation.organization_id,
            contact_id: lead.crm_contact_id,
            direction: 'inbound',
            sender_type: 'contact',
            content: messageContent,
            channel,
            status: 'received',
            metadata: {
              classification: classification ? {
                intent: classification.intent,
                confidence: classification.confidence,
              } : null,
              source: 'lead_magnet',
              chatbot_conversation_id: chatbotConversationId,
            },
          });

        if (crmInboundErr) {
          console.warn('[AI Respond] Failed to log inbound CRM message:', crmInboundErr.message);
        }

        // Update last_message_at on the conversation
        await supabase
          .from('crm_conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', crmConversationId);
      }
    } catch (crmErr) {
      // CRM bridge is non-critical, don't block the chatbot
      console.warn('[AI Respond] CRM bridge error (non-fatal):', crmErr);
    }

    // ================================================================
    // GHL Booking Intercept: route scheduling messages through autopilot
    // even in chatbot_only/chatbot_smart mode when calendar is configured
    // ================================================================
    if (crmConversationId && lead?.crm_contact_id && campaign?.agent_profile_id) {
      const { data: agentProfile } = await supabase
        .from('ai_agent_profiles')
        .select('config')
        .eq('id', campaign.agent_profile_id)
        .maybeSingle();

      const agentConfig = agentProfile?.config as Record<string, unknown> | null;
      const ghlCalendarId = agentConfig?.ghl_calendar_id as string | undefined;

      if (ghlCalendarId) {
        // Check for pending booking state (contact replying to email/timezone/slot request)
        const { data: convMeta } = await supabase
          .from('crm_conversations')
          .select('metadata')
          .eq('id', crmConversationId)
          .maybeSingle();

        const convMetadata = (convMeta?.metadata || {}) as Record<string, unknown>;
        const pendingBooking = convMetadata.pending_ghl_booking;

        console.log(`[AI Respond] Booking intercept check — pending_ghl_booking: ${JSON.stringify(pendingBooking)}, message: "${messageContent.substring(0, 60)}"`);

        // Check for scheduling keywords or intent
        const bookingKeywords = /\b(book\s*(me\s*)?in|lock\s*(it\s*)?in|schedule\s*(a\s*)?(call|meeting|demo)|let'?s\s+book|set\s+up\s+a?\s*(call|meeting|demo)|when\s+can\s+we\s+meet|pick\s+a\s+time|yes.{0,10}(book|schedule|lock|set\s+up)|book\s+a\s+call|want\s+to\s+book)\b/i;

        // Detect email/phone reply: if the message is just an email address or phone number,
        // check if the last outbound asked for contact info (booking flow continuation)
        const emailPattern = /^[\w.+-]+@[\w-]+\.[\w.]+$/i;
        const phonePattern = /^[\+]?[\d\s\-().]{7,}$/;
        const isContactInfoReply = emailPattern.test(messageContent.trim()) || phonePattern.test(messageContent.trim());

        let isBookingContextReply = false;
        if (isContactInfoReply && !pendingBooking) {
          // Check if the last outbound message asked for email/phone (booking flow continuation
          // even if pending_ghl_booking wasn't persisted due to race condition)
          const { data: lastOutbound } = await supabase
            .from('crm_messages')
            .select('content')
            .eq('conversation_id', crmConversationId)
            .eq('direction', 'outbound')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastOutbound?.content) {
            const askedForEmail = /\b(email|e-mail|phone|number|contact\s*(info|details)|invite)\b/i.test(lastOutbound.content);
            if (askedForEmail) {
              console.log('[AI Respond] Contact info reply detected — last outbound asked for email/phone, treating as booking flow');
              isBookingContextReply = true;

              // Ensure pending_ghl_booking is set so processAutopilot can pick it up
              await supabase.rpc('merge_conversation_metadata', {
                p_conversation_id: crmConversationId,
                p_metadata_update: {
                  pending_ghl_booking: { awaiting_email: true, calendar_id: ghlCalendarId },
                },
              });
            }
          }
        }

        const isSchedulingMessage = bookingKeywords.test(messageContent)
          || classification?.intent === 'meeting_booked'
          || !!pendingBooking
          || isBookingContextReply;

        if (isSchedulingMessage) {
          console.log(`[AI Respond] GHL booking intercept — routing to autopilot (pending=${!!pendingBooking}, contextReply=${isBookingContextReply}, intent=${classification?.intent}, keywords=${bookingKeywords.test(messageContent)})`);

          try {
            const autopilotResult = await processAutopilot(
              supabase,
              {
                conversationId: crmConversationId,
                contactId: lead.crm_contact_id,
                organizationId: conversation.organization_id,
                intent: classification?.intent || 'neutral',
                confidence: classification?.confidence || 0,
                inboundMessageId: '',
                leadMagnetCampaignId: conversation.campaign_id,
                channel,
                messageContent,
                model: orgModel,
              },
              openRouterKey,
            );

            console.log(`[AI Respond] Booking intercept autopilot result: ${autopilotResult.action}, queued=${autopilotResult.queued}, sent=${autopilotResult.sent}`);

            // If autopilot handled it (queued a draft or sent), update chatbot history and return
            if (autopilotResult.queued || autopilotResult.sent) {
              const conversationHistory = (conversation.conversation_history || []) as Array<{ role: string; content: string; timestamp: string }>;
              await supabase
                .from('ai_chatbot_conversations')
                .update({
                  conversation_history: [
                    ...conversationHistory,
                    { role: 'user', content: messageContent, timestamp: new Date().toISOString() },
                    { role: 'assistant', content: '(Handled by booking system)', timestamp: new Date().toISOString() },
                  ],
                  turn_count: conversation.turn_count + 1,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', chatbotConversationId);

              return new Response(
                JSON.stringify({ success: true, autopilot: true, action: autopilotResult.action, bookingIntercept: true }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            // If autopilot returned no action, fall through to chatbot
            console.log('[AI Respond] Booking intercept: autopilot returned no action, falling through to chatbot');
          } catch (bookingErr) {
            console.error('[AI Respond] Booking intercept error, falling through to chatbot:', bookingErr);
          }
        } else {
          console.log(`[AI Respond] Booking intercept: not a scheduling message (keywords=${bookingKeywords.test(messageContent)}, intent=${classification?.intent}, pending=${!!pendingBooking})`);
        }
      }
    }

    // ================================================================
    // Chatbot Path (chatbot_only or chatbot_smart)
    // ================================================================

    // Retrieve relevant knowledge base chunks for RAG
    let knowledgeContext = '';
    let ragTokenUsage = 0;

    try {
      const ragResult = await retrieveRelevantChunks(
        supabase,
        conversation.organization_id,
        conversation.campaign_id,
        messageContent,
        openRouterKey,
        5 // Top 5 most relevant chunks
      );

      if (ragResult.chunks.length > 0) {
        knowledgeContext = formatKnowledgeContext(ragResult.chunks);
        ragTokenUsage = ragResult.tokenUsage;
        console.log(`[AI Respond] Retrieved ${ragResult.chunks.length} knowledge chunks (${ragTokenUsage} embedding tokens)`);
      }
    } catch (ragError) {
      // RAG retrieval is non-critical, continue without it
      console.warn('[AI Respond] RAG retrieval failed, continuing without knowledge context:', ragError);
    }

    // Build system prompt with optional knowledge context
    const systemPromptWithKnowledge = knowledgeContext
      ? `${conversation.system_prompt}\n\n${knowledgeContext}`
      : conversation.system_prompt;

    // Build messages array for the LLM
    const conversationHistory = (conversation.conversation_history || []) as Array<{
      role: string;
      content: string;
      timestamp: string;
    }>;

    const messages = [
      { role: 'system', content: systemPromptWithKnowledge },
      ...conversationHistory.map(entry => ({
        role: entry.role,
        content: entry.content,
      })),
      { role: 'user', content: messageContent },
    ];

    // Call LLM
    const aiModel = chatbotModel(campaign?.ai_chatbot_model);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let aiResponse: string;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const llmResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': supabaseUrl,
        },
        body: JSON.stringify({
          model: aiModel,
          messages,
          temperature: 0.7,
          max_tokens: 400,
        }),
        signal: controller.signal,
      });

      if (!llmResponse.ok) {
        const errorText = await llmResponse.text();
        throw new Error(`OpenRouter error ${llmResponse.status}: ${errorText}`);
      }

      const llmData = await llmResponse.json();
      aiResponse = sanitizeAIOutput(llmData.choices?.[0]?.message?.content?.trim() || '');
      inputTokens = llmData.usage?.prompt_tokens || 0;
      outputTokens = llmData.usage?.completion_tokens || 0;

      if (!aiResponse) {
        throw new Error('Empty response from LLM');
      }
    } finally {
      clearTimeout(timeout);
    }

    console.log(`[AI Respond] Generated response (${aiResponse.length} chars, ${inputTokens}+${outputTokens} tokens)`);

    // Load agent profile to check require_approval setting
    const account = campaign?.account;

    if (!lead || !account) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing lead or account data' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let requireApproval = false;
    if (campaign?.agent_profile_id) {
      const { data: agentProfile } = await supabase
        .from('ai_agent_profiles')
        .select('config')
        .eq('id', campaign.agent_profile_id)
        .maybeSingle();
      if (agentProfile?.config?.require_approval) {
        requireApproval = true;
      }
    }

    // Resolve contact_id for approval queue — lead may not have crm_contact_id set yet
    let resolvedContactId = lead?.crm_contact_id as string | null;
    if (!resolvedContactId && crmConversationId) {
      const { data: conv } = await supabase
        .from('crm_conversations')
        .select('contact_id')
        .eq('id', crmConversationId)
        .maybeSingle();
      if (conv?.contact_id) {
        resolvedContactId = conv.contact_id;
        // Also backfill on the lead for future calls
        await supabase.from('unipile_leads').update({ crm_contact_id: conv.contact_id }).eq('id', lead?.id);
      }
    }

    if (requireApproval && crmConversationId && resolvedContactId) {
      // Approval mode: queue as draft in inbox_autopilot_queue for human review
      const { error: approvalError } = await supabase
        .from('inbox_autopilot_queue')
        .insert({
          organization_id: conversation.organization_id,
          conversation_id: crmConversationId,
          contact_id: resolvedContactId,
          draft_message: aiResponse,
          trigger_intent: classification?.intent || 'neutral',
          trigger_message_id: null,
          status: 'pending',
          metadata: {
            action: 'auto_reply',
            channel,
            auto_send: false,
            lead_magnet_campaign_id: conversation.campaign_id,
            chatbot_conversation_id: chatbotConversationId,
            confidence: classification?.confidence || 0,
          },
        });

      if (approvalError) {
        console.error('[AI Respond] Failed to queue for approval:', approvalError);
        return new Response(
          JSON.stringify({ success: false, error: `Approval queue failed: ${approvalError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[AI Respond] Response queued for APPROVAL (agent profile: require_approval=true)`);
    } else {
      // Auto-send mode: queue directly for delivery
      const dmDelaySeconds = campaign?.dm_delay_seconds || 15;
      const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();

      const { error: queueError } = await supabase
        .from('unipile_message_queue')
        .insert({
          campaign_id: conversation.campaign_id,
          lead_id: conversation.lead_id,
          account_id: account.id,
          organization_id: conversation.organization_id,
          recipient_platform_id: lead.commenter_id,
          recipient_name: lead.commenter_name,
          message_text: aiResponse,
          scheduled_for: scheduledFor,
          status: 'pending',
        });

      if (queueError) {
        console.error('[AI Respond] Failed to queue response:', queueError);
        return new Response(
          JSON.stringify({ success: false, error: `Queue failed: ${queueError.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update conversation: append both user message and AI response, increment turn count
    const updatedHistory = [
      ...conversationHistory,
      { role: 'user', content: messageContent, timestamp: new Date().toISOString() },
      { role: 'assistant', content: aiResponse, timestamp: new Date().toISOString() },
    ];

    const newTurnCount = conversation.turn_count + 1;

    await supabase
      .from('ai_chatbot_conversations')
      .update({
        conversation_history: updatedHistory,
        turn_count: newTurnCount,
        total_input_tokens: (conversation.total_input_tokens || 0) + inputTokens,
        total_output_tokens: (conversation.total_output_tokens || 0) + outputTokens,
        last_ai_response_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', chatbotConversationId);

    // Update lead turn count
    await supabase
      .from('unipile_leads')
      .update({
        ai_conversation_turn_count: newTurnCount,
      })
      .eq('id', conversation.lead_id);

    // Check if we hit max turns after this response
    if (newTurnCount >= conversation.max_turns) {
      console.log(`[AI Respond] Max turns reached after response, handing off`);
      await handoffConversation(supabase, { ...conversation, turn_count: newTurnCount }, 'Max conversation turns reached');
    }

    // Log job
    await supabase.from('unipile_job_logs').insert({
      job_type: 'ai_chatbot_respond',
      status: 'completed',
      result: {
        conversation_id: chatbotConversationId,
        turn_count: newTurnCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        rag_embedding_tokens: ragTokenUsage,
        response_length: aiResponse.length,
        knowledge_chunks_used: knowledgeContext ? true : false,
      },
      duration_ms: 0,
    });

    console.log(`[AI Respond] Response queued for conversation ${chatbotConversationId} (turn ${newTurnCount}, approval=${requireApproval})`);

    return new Response(
      JSON.stringify({
        success: true,
        turnCount: newTurnCount,
        responseLength: aiResponse.length,
        requireApproval,
        inputTokens,
        outputTokens,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[AI Respond] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Hand off a conversation from AI to human.
 * Updates both the conversation and lead records.
 */
async function handoffConversation(
  supabase: SupabaseClient<any>,
  conversation: Record<string, unknown>,
  reason: string
): Promise<void> {
  const conversationId = conversation.id as string;
  const leadId = conversation.lead_id as string;

  // Update conversation
  await supabase
    .from('ai_chatbot_conversations')
    .update({
      status: 'handed_off',
      handoff_at: new Date().toISOString(),
      handoff_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Update lead
  await supabase
    .from('unipile_leads')
    .update({
      ai_conversation_active: false,
      ai_handoff_requested: true,
      ai_handoff_reason: reason,
      status: 'pending', // Back to pending for human follow-up
    })
    .eq('id', leadId);

  console.log(`[AI Respond] Conversation ${conversationId} handed off: ${reason}`);

  // Evaluate follow-up rules on handoff
  const campaignId = conversation.campaign_id as string;
  const lead = conversation.lead as Record<string, unknown> | null;
  const orgId = conversation.organization_id as string;

  if (lead?.lead_intent && campaignId) {
    try {
      // Resolve CRM contact to leads table ID (follow-up rule engine expects leads.id)
      const crmContactId = lead.crm_contact_id as string | null;
      let resolvedLeadId: string | null = null;

      if (crmContactId) {
        const { data: linkedLead } = await supabase
          .from('leads')
          .select('id')
          .eq('crm_contact_id', crmContactId)
          .limit(1)
          .maybeSingle();
        resolvedLeadId = linkedLead?.id || null;
      }

      if (resolvedLeadId) {
        await evaluateFollowupRules(supabase, {
          leadMagnetCampaignId: campaignId,
          leadId: resolvedLeadId,
          organizationId: orgId,
          intent: lead.lead_intent as any,
          confidence: (lead.intent_confidence as number) || 0,
          triggerType: 'intent_match',
        });
        console.log(`[AI Respond] Follow-up rules evaluated for lead ${resolvedLeadId} on handoff`);
      } else {
        console.warn(`[AI Respond] Could not resolve CRM contact ${crmContactId} to leads table for follow-up rules`);
      }
    } catch (followupErr) {
      console.error('[AI Respond] Follow-up rules error on handoff:', followupErr);
      // Record failure for operator visibility
      await supabase.from('ai_chatbot_conversations')
        .update({ metadata: { ...(conversation.metadata as any || {}), followup_rules_error: String(followupErr) } })
        .eq('id', conversationId)
        .catch(() => {}); // best-effort
    }
  }
}

// ============================================================================
// CRM Bridge: Ensure CRM Conversation Exists
// ============================================================================

/**
 * Find or create a CRM conversation for a lead magnet lead.
 * Needed for autopilot queue entries which require a crm_conversations FK.
 */
function channelForProvider(provider: unknown): 'instagram' | 'linkedin' {
  return provider === 'INSTAGRAM' ? 'instagram' : 'linkedin';
}

async function ensureCrmConversation(
  supabase: SupabaseClient<any>,
  conversation: Record<string, unknown>,
  lead: Record<string, unknown> | null,
  campaign: Record<string, unknown> | null,
): Promise<string | null> {
  try {
    // If already linked, return it
    if (lead?.crm_conversation_id) {
      return lead.crm_conversation_id as string;
    }

    const orgId = conversation.organization_id as string;
    const commenterId = lead?.commenter_id as string | null;
    if (!commenterId) return null;

    // Find the CRM contact matching this lead's commenter_id
    const { data: identity } = await supabase
      .from('crm_contact_identities')
      .select('contact_id')
      .eq('platform_user_id', commenterId)
      .eq('organization_id', orgId)
      .limit(1)
      .maybeSingle();

    if (!identity) return null;

    // Backfill crm_contact_id on the lead if missing
    if (lead && !lead.crm_contact_id) {
      await supabase.from('unipile_leads').update({ crm_contact_id: identity.contact_id }).eq('id', lead.id);
      lead.crm_contact_id = identity.contact_id; // Update in-memory too
    }

    // Find or create conversation
    const { data: existing } = await supabase
      .from('crm_conversations')
      .select('id')
      .eq('contact_id', identity.contact_id)
      .eq('channel', channelForProvider((campaign?.account as Record<string, unknown> | undefined)?.provider))
      .eq('organization_id', orgId)
      .maybeSingle();

    if (existing) {
      // Link back to lead
      const { error: linkError } = await supabase
        .from('unipile_leads')
        .update({ crm_conversation_id: existing.id })
        .eq('id', lead?.id);
      if (linkError) console.error('[AI Respond] Failed to link existing conversation to lead:', linkError.message);
      return existing.id;
    }

    // Create new conversation
    const { data: newConv, error: convError } = await supabase
      .from('crm_conversations')
      .insert({
        organization_id: orgId,
        contact_id: identity.contact_id,
        channel: channelForProvider((campaign?.account as Record<string, unknown> | undefined)?.provider),
        status: 'open',
        last_message_at: new Date().toISOString(),
        metadata: {
          source: 'lead_magnet',
          campaign_id: conversation.campaign_id,
          campaign_name: campaign?.name || null,
        },
      })
      .select('id')
      .single();

    if (convError) {
      // Race condition: another call may have created it concurrently
      const { data: raceExisting } = await supabase
        .from('crm_conversations')
        .select('id')
        .eq('contact_id', identity.contact_id)
        .eq('channel', channelForProvider((campaign?.account as Record<string, unknown> | undefined)?.provider))
        .eq('organization_id', orgId)
        .maybeSingle();
      if (raceExisting) {
        await supabase.from('unipile_leads').update({ crm_conversation_id: raceExisting.id }).eq('id', lead?.id);
        return raceExisting.id;
      }
      console.error('[AI Respond] Failed to create CRM conversation:', convError.message);
      return null;
    }

    if (newConv) {
      const { error: linkError } = await supabase
        .from('unipile_leads')
        .update({ crm_conversation_id: newConv.id })
        .eq('id', lead?.id);
      if (linkError) console.error('[AI Respond] Failed to link new conversation to lead:', linkError.message);
      return newConv.id;
    }

    return null;
  } catch (err) {
    console.error('[AI Respond] ensureCrmConversation error:', err);
    return null;
  }
}
