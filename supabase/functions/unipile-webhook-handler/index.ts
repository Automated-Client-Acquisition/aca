import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { chatbotModel } from '../_shared/default-models.ts';
import { isOllamaModel } from '../_shared/llm-client.ts';
import {
  generateInitialAiMessage,
  buildChatbotSystemPrompt,
} from '../_shared/icp-scorer.ts';
import { buildLeadDmMessage } from '../_shared/lead-magnet-link.ts';
import { findNodeById, getNextNode, WorkflowNode, WorkflowEdge } from '../_shared/workflow-utils.ts';
import { classifyReply } from '../_shared/reply-classifier.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { sanitizeMessageContent } from '../_shared/sanitize-message-content.ts';
import { checkUnipileWebhookSecret } from '../_shared/unipile-webhook-auth.ts';
import { enqueueCampaignEntryEvent } from '../_shared/campaign-entry-events.ts';
import { isUnipileSelfMessage } from '../_shared/campaign-entry-source-adapters.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-unipile-signature',
};

/**
 * Unipile Webhook Handler
 *
 * Receives webhooks from Unipile for:
 * - connection_accepted / relation_created: New LinkedIn connection made
 * - message_received: New DM received (for future use)
 *
 * When a new connection is detected, checks for pending leads
 * with status='awaiting_connection' and delivers the lead magnet DM.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const startTime = Date.now();

  const secretCheck = await checkUnipileWebhookSecret(req);
  if (secretCheck === 'invalid' ||
      (secretCheck === 'missing' && Deno.env.get('UNIPILE_WEBHOOK_REQUIRE_SECRET') === 'true')) {
    console.warn(`[Unipile Webhook] Rejected: webhook secret ${secretCheck}`);
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Phase 1: Parse payload and store event, then return 200 immediately.
  // All heavy processing happens in Phase 2 via EdgeRuntime.waitUntil().
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch (parseError) {
    console.error('[Unipile Webhook] Failed to parse JSON body:', parseError);
    return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const eventType = payload.event || payload.event_type || payload.type || 'unknown';
  console.log('[Unipile Webhook] Received event:', eventType);

  // Look up account (fast DB query - safe to do before responding)
  let accountId: string | null = null;
  let organizationId: string | null = null;

  if (payload.account_id) {
    const { data: account } = await supabase
      .from('unipile_accounts')
      .select('id, organization_id')
      .eq('unipile_account_id', payload.account_id)
      .maybeSingle();

    if (account) {
      accountId = account.id;
      organizationId = account.organization_id;
    }
  }

  // This endpoint has no signature check, and downstream lookups drop their org filter
  // when organizationId is null, letting a forged event match leads in every tenant
  // (fake replies stopping campaigns, lead-magnet DMs sent from customers' accounts).
  // Every genuine Unipile event carries an account_id we know, so drop the rest.
  if (!organizationId || !accountId) {
    console.warn('[Unipile Webhook] Ignoring event for unknown account:', payload.account_id ?? '(none)');
    return new Response(JSON.stringify({ success: true, ignored: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Store webhook event for audit/debugging
  const { data: webhookEvent, error: insertError } = await supabase
    .from('unipile_webhook_events')
    .insert({
      organization_id: organizationId,
      account_id: accountId,
      event_type: eventType,
      event_data: payload,
      unipile_event_id: payload.id || payload.event_id,
      unipile_account_id: payload.account_id,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    console.error('[Unipile Webhook] Failed to store event:', insertError);
  }

  // Phase 2: Defer all heavy processing to background via EdgeRuntime.waitUntil().
  // This returns the HTTP 200 to Unipile immediately, avoiding the 504 timeout.
  const processingPromise = processWebhookEvent(
    supabase, payload, eventType as string, organizationId, accountId, webhookEvent, startTime, secretCheck === 'ok'
  );

  try {
    (globalThis as any).EdgeRuntime?.waitUntil(processingPromise);
  } catch (_) {
    // waitUntil not available - fall back to awaiting inline (dev/test environments)
    await processingPromise;
  }

  return new Response(JSON.stringify({ success: true, event: eventType }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

/**
 * Process the webhook event in the background.
 * Separated from the main handler so we can return 200 immediately.
 */
async function processWebhookEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  eventType: string,
  organizationId: string | null,
  accountId: string | null,
  webhookEvent: { id: string } | null,
  startTime: number,
  verifiedSource: boolean,
) {
  try {
    // =========================================================================
    // Handle MESSAGE RECEIVED events (for auto-stop on reply)
    // =========================================================================
    if (eventType === 'message_received' ||
        eventType === 'new_message' ||
        eventType === 'message.received' ||
        eventType === 'messaging.message_received') {

      const result = await handleMessageReceived(supabase, payload, organizationId, accountId, verifiedSource);

      if (webhookEvent) {
        await supabase
          .from('unipile_webhook_events')
          .update({
            status: result.processed ? 'processed' : 'ignored',
            processed_at: new Date().toISOString(),
            processing_result: result,
          })
          .eq('id', webhookEvent.id);
      }

      await logJob(supabase, 'completed', startTime, {
        event_type: eventType,
        ...result,
      });
      return;
    }

    // =========================================================================
    // Handle CONNECTION events (for lead magnet delivery)
    // =========================================================================
    if (eventType === 'new_relation' ||
        eventType === 'connection_accepted' ||
        eventType === 'relation_created' ||
        eventType === 'connection.accepted' ||
        eventType === 'invitation.accepted') {

      const newConnectionId = payload.user_provider_id ||
                              (payload.data as any)?.user_provider_id ||
                              (payload.data as any)?.user_id ||
                              (payload.data as any)?.relation?.id ||
                              (payload.data as any)?.connection?.id ||
                              payload.user_id ||
                              payload.relation_id;

      if (newConnectionId) {
        console.log(`[Unipile Webhook] New connection detected: ${newConnectionId}`);

        const deliveredCount = await processNewConnection(
          supabase,
          newConnectionId,
          organizationId,
          accountId
        );

        console.log(`[Unipile Webhook] Delivered ${deliveredCount} lead magnets`);

        const campaignLeadsAdvanced = await advanceCampaignLeadsOnConnection(
          supabase,
          String(newConnectionId),
          organizationId,
          accountId
        );

        if (campaignLeadsAdvanced > 0) {
          console.log(`[Unipile Webhook] Advanced ${campaignLeadsAdvanced} campaign lead(s) on connection acceptance`);
        }

        // Discovery layer: bump every active unipile_inbound sub for this
        // org+account so the next pack-refresh tick pulls the new connection.
        // We don't run the full discovery pipeline inline (would duplicate
        // the run() iterator path and need a job_id) — bumping next_refresh_at
        // gets us a ~10-min upper-bound on signal-to-feed latency, which is
        // fine for a "someone connected with you" event.
        const inboundSubsBumped = await bumpUnipileInboundSubs(
          supabase,
          organizationId,
          accountId,
        );
        if (inboundSubsBumped > 0) {
          console.log(`[Unipile Webhook] Bumped ${inboundSubsBumped} unipile_inbound sub(s) for early refresh`);
        }

        if (webhookEvent) {
          await supabase
            .from('unipile_webhook_events')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
              processing_result: {
                deliveredCount,
                connectionId: newConnectionId,
                campaignLeadsAdvanced,
              },
            })
            .eq('id', webhookEvent.id);
        }

        await logJob(supabase, 'completed', startTime, {
          event_type: eventType,
          connection_id: newConnectionId,
          delivered_count: deliveredCount,
          campaign_leads_advanced: campaignLeadsAdvanced,
        });
      } else {
        console.log('[Unipile Webhook] Could not extract connection ID from payload');

        if (webhookEvent) {
          await supabase
            .from('unipile_webhook_events')
            .update({
              status: 'ignored',
              processed_at: new Date().toISOString(),
              error_message: 'Could not extract connection ID',
            })
            .eq('id', webhookEvent.id);
        }
      }
    } else {
      // Not a recognized event, mark as ignored
      if (webhookEvent) {
        await supabase
          .from('unipile_webhook_events')
          .update({
            status: 'ignored',
            processed_at: new Date().toISOString(),
          })
          .eq('id', webhookEvent.id);
      }
    }
  } catch (error) {
    console.error('[Unipile Webhook] Background processing error:', error);

    if (webhookEvent) {
      await supabase
        .from('unipile_webhook_events')
        .update({
          status: 'failed',
          processed_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : 'Unknown error',
        })
        .eq('id', webhookEvent.id);
    }

    await logJob(supabase, 'failed', startTime, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Handle message received webhook - auto-stop campaigns on reply
 */
async function handleMessageReceived(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
  organizationId: string | null,
  accountId: string | null,
  verifiedSource: boolean,
): Promise<{ processed: boolean; campaignsStopped: number; reason?: string }> {
  // Extract sender info from payload
  // Unipile webhook payload structure (observed):
  //   event: "message_received"
  //   sender: { attendee_provider_id, attendee_name, attendee_specifics: { provider } }
  //   message: "text content"
  //   message_id: "..."
  //   chat_id: "..."
  //   account_info: { type: "LINKEDIN" }
  //   is_sender: false (true if we sent it)
  const sender = payload.sender as Record<string, unknown> | undefined;
  const accountInfo = payload.account_info as Record<string, unknown> | undefined;
  const senderSpecifics = sender?.attendee_specifics as Record<string, unknown> | undefined;

  const senderId = sender?.attendee_provider_id ||
                   payload.sender_id ||
                   sender?.id ||
                   payload.from_attendee?.provider_id;

  const messageContent = payload.message ||
                         payload.text ||
                         payload.body ||
                         payload.content;

  const externalMessageId = payload.message_id ||
                            payload.id;

  // Determine channel from payload
  const provider = (
    accountInfo?.type ||
    senderSpecifics?.provider ||
    payload.provider ||
    payload.account_type ||
    'unknown'
  ) as string;
  const channelType = mapProviderToChannel(provider);

  // Skip messages we sent ourselves
  if (isUnipileSelfMessage(payload)) {
    console.log('[Unipile Webhook] Skipping our own outbound message');
    return { processed: false, campaignsStopped: 0, reason: 'Own message' };
  }

  if (!senderId) {
    console.log('[Unipile Webhook] Could not extract sender ID from message payload');
    return { processed: false, campaignsStopped: 0, reason: 'No sender ID in payload' };
  }

  console.log(`[Unipile Webhook] Message received from ${senderId} via ${channelType}`);

  // Define senderName at outer scope so it's available for both contact creation and AI chatbot check
  const senderName = (sender?.attendee_name as string) || String(senderId);

  // Find contact by platform identity
  let contactId: string | null = null;

  const identityQuery = supabase
    .from('crm_contact_identities')
    .select('contact_id')
    .eq('platform_user_id', senderId)
    .eq('channel', channelType);

  if (organizationId) {
    identityQuery.eq('organization_id', organizationId);
  }

  if (accountId) {
    identityQuery.contains('linked_account_ids', [accountId]);
  }

  const { data: identity } = await identityQuery.maybeSingle();

  if (identity) {
    contactId = identity.contact_id;
  }

  if (!contactId && organizationId && accountId) {
    const { data: identityForOtherAccount } = await supabase
      .from('crm_contact_identities')
      .select('id, contact_id, linked_account_ids, raw_connection_data')
      .eq('organization_id', organizationId)
      .eq('channel', channelType)
      .eq('platform_user_id', senderId)
      .maybeSingle();

    if (identityForOtherAccount) {
      const linkedAccountIds = (identityForOtherAccount.linked_account_ids || []) as string[];
      await supabase
        .from('crm_contact_identities')
        .update({
          linked_account_ids: [...new Set([...linkedAccountIds, accountId])],
          raw_connection_data: {
            ...((identityForOtherAccount.raw_connection_data || {}) as Record<string, unknown>),
            [accountId]: {
              linked_at: new Date().toISOString(),
              source: 'unipile_webhook_message',
              platform_user_id: String(senderId),
              display_name: senderName,
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', identityForOtherAccount.id);

      contactId = identityForOtherAccount.contact_id;
    }
  }

  // If no contact found, auto-create one so the message appears in the inbox
  if (!contactId && organizationId) {
    try {

      // Create new CRM contact
      const { data: newContact, error: contactError } = await supabase
        .from('crm_contacts')
        .insert({
          organization_id: organizationId,
          display_name: senderName,
          source: channelType,
          status: 'active',
        })
        .select('id')
        .single();

      if (contactError || !newContact) {
        console.error('[Unipile Webhook] Failed to create contact:', contactError?.message);
        return { processed: false, campaignsStopped: 0, reason: 'Failed to create contact' };
      }

      contactId = newContact.id;

      // Create identity record linking platform ID to contact
      await supabase.from('crm_contact_identities').insert({
        organization_id: organizationId,
        contact_id: contactId,
        channel: channelType,
        platform_user_id: String(senderId),
        platform_username: senderName,
        linked_account_ids: accountId ? [accountId] : [],
        raw_connection_data: accountId ? {
          [accountId]: {
            linked_at: new Date().toISOString(),
            source: 'unipile_webhook_message',
            platform_user_id: String(senderId),
            display_name: senderName,
          },
        } : {},
        is_primary: true,
      });

      // Log activity
      await supabase.from('crm_activities').insert({
        organization_id: organizationId,
        contact_id: contactId,
        activity_type: 'contact_created',
        title: 'Contact created',
        description: `New contact from ${channelType} webhook message`,
        metadata: { channel: channelType, externalId: String(senderId) },
        performed_by_type: 'system',
      });

      console.log(`[Unipile Webhook] Auto-created contact ${contactId} for sender ${senderId} (${senderName})`);
    } catch (createError) {
      console.error('[Unipile Webhook] Contact auto-creation failed:', createError);
      return { processed: false, campaignsStopped: 0, reason: 'Contact creation failed' };
    }
  }

  if (!contactId) {
    console.log(`[Unipile Webhook] No contact found and no org to create one for sender ${senderId}`);
    return { processed: false, campaignsStopped: 0, reason: 'Contact not found, no org context' };
  }

  // ============================================
  // CRM BRIDGE: Create conversation + message so reply appears in master inbox
  // ============================================
  // Pre-compute message text at block scope so both CRM bridge and AI chatbot check can use it
  const rawMsgText = messageContent ? (typeof messageContent === 'string' ? messageContent : String(messageContent)) : '';
  // Sanitize garbled/binary content that Unipile sometimes returns for LinkedIn messages
  const msgText = sanitizeMessageContent(rawMsgText) || rawMsgText;

  let crmConversationId: string | null = null;
  let crmMessageId: string | null = null;
  let conversationAutomated = false;

  if (organizationId && contactId && messageContent) {
    try {
      const extMsgId = typeof externalMessageId === 'string' ? externalMessageId : String(externalMessageId || '');

      const externalConversationId = (
        payload.chat_id || payload.conversation_id
      ) as string | undefined;

      // Always get or create CRM conversation (needed for both message insert and autopilot)
      const { data: convId } = await supabase.rpc('get_or_create_conversation', {
        p_org_id: organizationId,
        p_contact_id: contactId,
        p_channel: channelType,
        p_channel_account_id: accountId || null,
        p_external_conversation_id: externalConversationId || null,
        p_external_participant_id: typeof senderId === 'string' ? senderId : String(senderId),
        p_mailbox_id: null,
      });
      crmConversationId = convId;

      if (crmConversationId) {
        // Check for duplicate first, then insert. We cannot use upsert because
        // external_message_id only has a partial unique INDEX (not a constraint),
        // and PostgREST requires an actual constraint for onConflict resolution.
        let existingMsgId: string | null = null;
        if (extMsgId) {
          const { data: existing } = await supabase
            .from('crm_messages')
            .select('id')
            .eq('external_message_id', extMsgId)
            .eq('organization_id', organizationId)
            .maybeSingle();
          existingMsgId = existing?.id || null;
        }

        if (existingMsgId) {
          crmMessageId = existingMsgId;
          console.log(`[Unipile Webhook] CRM message already exists ${existingMsgId}, skipping insert`);
        } else {
          const { data: newMsg, error: msgError } = await supabase.from('crm_messages').insert({
            organization_id: organizationId,
            conversation_id: crmConversationId,
            contact_id: contactId,
            direction: 'inbound',
            sender_type: 'contact',
            content: msgText,
            content_type: 'text',
            external_message_id: extMsgId || null,
            external_thread_id: externalConversationId || null,
            status: 'delivered',
            delivered_at: new Date().toISOString(),
            metadata: { source: 'unipile_webhook', channel: channelType },
          }).select('id').single();

          if (msgError) {
            console.error(`[Unipile Webhook] Failed to insert CRM message:`, msgError.message);
          } else {
            crmMessageId = newMsg?.id || null;
            console.log(`[Unipile Webhook] CRM message inserted ${crmMessageId} in conversation ${crmConversationId}`);
          }
        }
      }
    } catch (crmError) {
      console.error('[Unipile Webhook] CRM bridge error:', crmError);
    }

    // ============================================
    // INBOX AUTOPILOT: Check if conversation has AI enabled
    // ============================================
    let autopilotHandled = false;
    if (crmConversationId) {
      try {
        const { data: conversation } = await supabase
          .from('crm_conversations')
          .select('ai_enabled, agent_profile_id, metadata')
          .eq('id', crmConversationId)
          .single();

        if (conversation?.ai_enabled) {
          conversationAutomated = true;
          console.log(`[Unipile Webhook] AI enabled on conversation ${crmConversationId}, running autopilot`);

          // Get org's OpenRouter key for classification + draft generation
          const { data: apiKeyData } = await supabase
            .from('api_keys')
            .select('key_encrypted')
            .eq('organization_id', organizationId)
            .eq('provider', 'openrouter')
            .maybeSingle();

          let openRouterKey = '';
          if (apiKeyData?.key_encrypted) {
            const encKey = Deno.env.get('ENCRYPTION_KEY')!;
            openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encKey);
          }

          // Classify intent
          let intent = 'neutral';
          let confidence = 0.5;
          if (openRouterKey) {
            try {
              const classification = await classifyReply(
                { from_email: '', subject: '', body_text: msgText },
                openRouterKey,
              );
              intent = classification.intent;
              confidence = classification.confidence;
            } catch (classifyErr) {
              console.warn('[Unipile Webhook] Classification failed, defaulting to neutral:', classifyErr);
            }
          }

          // Resolve lead_magnet_campaign_id from conversation metadata if present
          const leadMagnetCampaignId = conversation.metadata?.lead_magnet_campaign_id || null;

          const autopilotResult = await processAutopilot(
            supabase,
            {
              conversationId: crmConversationId,
              contactId,
              organizationId,
              intent,
              confidence,
              inboundMessageId: crmMessageId || '',
              channel: channelType,
              messageContent: msgText,
              leadMagnetCampaignId,
            },
            openRouterKey,
          );

          console.log(`[Unipile Webhook] Autopilot result: ${autopilotResult.action} (queued=${autopilotResult.queued}, sent=${autopilotResult.sent})`);
          autopilotHandled = true;
        }
      } catch (autopilotError) {
        console.error('[Unipile Webhook] Autopilot check failed:', autopilotError);
      }

      // ============================================
      // AI CHATBOT: Check for active lead magnet chatbot conversation
      // (mirrors crm-sync-inbound logic — since webhook creates CRM message first,
      //  crm-sync-inbound dedup will skip it, so we must invoke ai-respond here)
      // Skip if inbox autopilot already processed the message to avoid double-processing.
      // ============================================
      if (!autopilotHandled) try {
        const senderIdentityQuery = supabase
          .from('crm_contact_identities')
          .select('platform_user_id')
          .eq('contact_id', contactId)
          .eq('channel', channelType);

        if (accountId) {
          senderIdentityQuery.contains('linked_account_ids', [accountId]);
        }

        const { data: senderIdentity } = await senderIdentityQuery.maybeSingle();

        if (senderIdentity?.platform_user_id) {
          // Check for AI chatbot lead first
          let matchingLeadQuery = supabase
            .from('unipile_leads')
            .select('id')
            .eq('commenter_id', senderIdentity.platform_user_id)
            .eq('ai_conversation_active', true);

          if (accountId) {
            matchingLeadQuery = matchingLeadQuery.eq('sender_account_id', accountId);
          }

          const { data: matchingLead } = await matchingLeadQuery.maybeSingle();

          if (matchingLead) {
            const { data: activeChatbot } = await supabase
              .from('ai_chatbot_conversations')
              .select('id')
              .eq('lead_id', matchingLead.id)
              .eq('status', 'active')
              .maybeSingle();

            if (activeChatbot) {
              conversationAutomated = true;
              console.log(`[Unipile Webhook] Triggering AI respond for chatbot conversation ${activeChatbot.id}`);
              try {
                await supabase.functions.invoke('unipile-ai-respond', {
                  body: {
                    chatbotConversationId: activeChatbot.id,
                    messageContent: msgText,
                    senderName: senderName,
                  },
                });
              } catch (aiError) {
                console.error(`[Unipile Webhook] AI respond invocation failed:`, aiError);
              }
            }

            // Mark as replied so follow-up checker skips this lead
            await supabase
              .from('unipile_leads')
              .update({ replied_at: new Date().toISOString(), status: 'replied' })
              .eq('id', matchingLead.id)
              .is('replied_at', null);
          } else {
            // Non-AI lead — mark as replied if they're in dm_sent state
            let dmLeadQuery = supabase
              .from('unipile_leads')
              .select('id')
              .eq('commenter_id', senderIdentity.platform_user_id)
              .eq('status', 'dm_sent')
              .is('replied_at', null);

            if (accountId) {
              dmLeadQuery = dmLeadQuery.eq('sender_account_id', accountId);
            }

            const { data: dmLead } = await dmLeadQuery.maybeSingle();

            if (dmLead) {
              await supabase
                .from('unipile_leads')
                .update({ replied_at: new Date().toISOString(), status: 'replied' })
                .eq('id', dmLead.id);
              console.log(`[Unipile Webhook] Marked lead ${dmLead.id} as replied — follow-ups will stop`);
            }
          }
        }
      } catch (aiCheckError) {
        console.error('[Unipile Webhook] AI chatbot check failed:', aiCheckError);
      }
    }
  }

  // Check if this contact has any active campaign progress
  // Only stop campaigns that have stop_on_reply enabled (default: true)
  const { data: activeProgress, error: progressError } = await supabase
    .from('campaign_lead_progress')
    .select(`
      id,
      campaign_id,
      sender_account_id,
      status,
      current_node_id,
      linkedin_campaigns!inner (
        id,
        name,
        organization_id,
        stop_on_reply
      )
    `)
    .eq('contact_id', contactId)
    .in('status', ['pending', 'in_progress', 'waiting']);

  if (progressError) {
    console.error('[Unipile Webhook] Failed to fetch campaign progress:', progressError);
    return { processed: false, campaignsStopped: 0, reason: progressError.message };
  }

  if (!activeProgress || activeProgress.length === 0) {
    console.log(`[Unipile Webhook] No active campaigns for contact ${contactId}`);
  }

  console.log(`[Unipile Webhook] Contact ${contactId} replied - checking ${activeProgress?.length || 0} active campaign(s)`);

  let campaignsStopped = 0;

  for (const progress of activeProgress || []) {
    const campaign = progress.linkedin_campaigns as { id: string; name: string; organization_id: string; stop_on_reply?: boolean };

    // Check if campaign has stop_on_reply enabled (default to true if not set)
    const stopOnReply = campaign.stop_on_reply !== false;

    if (stopOnReply) {
      // Update progress to 'replied' status
      const { error: updateError } = await supabase
        .from('campaign_lead_progress')
        .update({
          status: 'replied',
          replied_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', progress.id);

      if (updateError) {
        console.error(`[Unipile Webhook] Failed to update progress ${progress.id}:`, updateError);
        continue;
      }
    } else {
      // The sequence keeps going, so later messages would land here again. Record
      // only the lead's first reply, as a stopped lead would.
      const { data: priorReply } = await supabase
        .from('campaign_action_log')
        .select('id')
        .eq('progress_id', progress.id)
        .eq('action_type', 'reply_detected')
        .limit(1)
        .maybeSingle();
      if (priorReply) continue;
      console.log(`[Unipile Webhook] Campaign ${campaign.id} has stop_on_reply disabled, logging the reply without stopping`);
    }

    // Log the reply detection as an action. conditionReplyReceived branches on this
    // row, so it is written even when the sequence keeps going.
    await supabase.from('campaign_action_log').insert({
      campaign_id: progress.campaign_id,
      progress_id: progress.id,
      contact_id: contactId,
      node_id: 'system_reply_detected',
      node_type: 'system',
      action_type: 'reply_detected',
      channel: channelType,
      status: 'success',
      external_id: externalMessageId,
      executed_at: new Date().toISOString(),
      message_content: typeof messageContent === 'string' ? messageContent.substring(0, 500) : null,
    });

    // Increment campaign analytics for reply (LinkedIn messages only for now)
    if (channelType === 'linkedin' && progress.sender_account_id) {
      await supabase.rpc('increment_campaign_analytics', {
        p_organization_id: campaign.organization_id,
        p_campaign_id: progress.campaign_id,
        p_account_id: progress.sender_account_id,
        p_metric: 'messages_replied',
        p_value: 1,
      });
    }

    // Notify external webhook if configured
    await notifyExternalWebhook(supabase, campaign.organization_id, 'lead_replied', {
      campaignId: campaign.id,
      campaignName: campaign.name,
      contactId,
      progressId: progress.id,
      channel: channelType,
      externalMessageId,
      messageContent: typeof messageContent === 'string' ? messageContent.substring(0, 500) : null,
      repliedAt: new Date().toISOString(),
    });

    if (stopOnReply) {
      campaignsStopped++;
      console.log(`[Unipile Webhook] Marked lead ${progress.id} as replied in campaign ${campaign.id}`);
    }
  }

  // Queue entry only after existing reply handling. The worker performs enrollment
  // later, so this reply cannot immediately stop a campaign it just started.
  // Headerless legacy webhooks retain inbox compatibility but cannot start outreach.
  if (verifiedSource && !conversationAutomated && organizationId && accountId && externalMessageId && crmMessageId) {
    try {
      await enqueueCampaignEntryEvent(supabase, {
        organizationId,
        type: 'message_received',
        eventId: `unipile-message:${accountId}:${String(externalMessageId)}`,
        contactId,
        accountId,
        channel: channelType,
        text: msgText,
        context: {
          native: true,
          source: 'unipile_webhook',
          messageId: crmMessageId,
          conversationId: crmConversationId,
          senderId: String(senderId),
        },
      });
    } catch (entryError) {
      // Entry capture must never interfere with inbox ingestion or reply stopping.
      console.error('[Unipile Webhook] Campaign entry queue failed:', entryError);
    }
  }

  // ============================================
  // EVALUATE AUTOMATION RULES
  // ============================================
  if (organizationId && contactId) {
    try {
      await supabase.functions.invoke('evaluate-rules', {
        body: {
          organizationId,
          triggerType: 'message_received',
          contactId,
          triggerData: {
            messageContent: typeof messageContent === 'string' ? messageContent : '',
            messageChannel: channelType,
            externalMessageId,
          },
        },
      });
    } catch (ruleError) {
      console.error('[Unipile Webhook] Rule evaluation failed:', ruleError);
      // Don't fail the webhook on rule evaluation errors
    }
  }

  return { processed: true, campaignsStopped };
}

/**
 * Map Unipile provider to channel type
 */
function mapProviderToChannel(provider: string): string {
  const providerLower = provider.toLowerCase();
  if (providerLower.includes('linkedin')) return 'linkedin';
  if (providerLower.includes('email') || providerLower.includes('gmail') || providerLower.includes('outlook')) return 'email';
  if (providerLower.includes('whatsapp')) return 'whatsapp';
  if (providerLower.includes('instagram')) return 'instagram';
  if (providerLower.includes('telegram')) return 'telegram';
  if (providerLower.includes('sms')) return 'sms';
  return 'unknown';
}

/**
 * Notify external webhook (e.g., n8n)
 */
async function notifyExternalWebhook(
  supabase: SupabaseClient,
  organizationId: string,
  event: string,
  data: Record<string, unknown>
) {
  try {
    // Get organization's webhook settings
    const { data: webhookSettings } = await supabase
      .from('organization_webhook_settings')
      .select('webhook_url, enabled_events')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .single();

    if (!webhookSettings?.webhook_url) return;

    // Check if this event type is enabled
    const enabledEvents = webhookSettings.enabled_events || [];
    if (!enabledEvents.includes(event)) return;

    await fetch(webhookSettings.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...data,
      }),
    });

    console.log(`[Unipile Webhook] External webhook sent: ${event}`);
  } catch (error) {
    console.error('[Unipile Webhook] External webhook failed:', error);
  }
}

/**
 * Bump every active `unipile_inbound` pack subscription that's bound to this
 * Unipile account so the discovery cron picks them up on its next tick (every
 * 10 min). The webhook fires on every `new_relation` — once per accepted
 * connection — so we'll only bump subs that are ALREADY watching this account.
 *
 * Why bump instead of running the discovery pipeline inline? The pipeline
 * needs an open `list_building_jobs` row + ICP scoring + DM enqueue, all of
 * which the existing pack-refresh path already wires correctly. Re-implementing
 * that here would risk drift. Worst-case latency from "connection accepted"
 * to "row appears in feed" is ~10 min; typically much less.
 */
async function bumpUnipileInboundSubs(
  supabase: SupabaseClient,
  organizationId: string | null,
  accountId: string | null,
): Promise<number> {
  if (!organizationId || !accountId) return 0;
  // accountId here is the unipile_accounts.id passed in by the webhook
  // dispatcher (it's looked up earlier in the request flow). The sub's
  // config.account_id field holds the same id.
  const { data: subs, error } = await supabase
    .from('pack_subscriptions')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('pack_key', 'unipile_inbound')
    .eq('status', 'active')
    .filter('config->>account_id', 'eq', accountId);
  if (error) {
    console.warn('[Unipile Webhook] bump query failed', error);
    return 0;
  }
  const ids = (subs as Array<{ id: string }> | null ?? []).map((s) => s.id);
  if (ids.length === 0) return 0;

  const { error: bumpErr } = await supabase
    .from('pack_subscriptions')
    .update({ next_refresh_at: new Date().toISOString() })
    .in('id', ids);
  if (bumpErr) {
    console.warn('[Unipile Webhook] bump update failed', bumpErr);
    return 0;
  }
  return ids.length;
}

/**
 * Advance campaign leads that are waiting for connection acceptance.
 * Finds leads via crm_contact_identities matching the LinkedIn user ID,
 * then advances each lead to the next node in the campaign sequence.
 */
async function advanceCampaignLeadsOnConnection(
  supabase: SupabaseClient,
  linkedInUserId: string,
  organizationId: string | null,
  accountId: string | null
): Promise<number> {
  try {
    // Find CRM contacts matching this LinkedIn user ID
    const identityQuery = supabase
      .from('crm_contact_identities')
      .select('contact_id')
      .eq('platform_user_id', linkedInUserId)
      .eq('channel', 'linkedin');

    if (organizationId) {
      identityQuery.eq('organization_id', organizationId);
    }

    if (accountId) {
      identityQuery.contains('linked_account_ids', [accountId]);
    }

    const { data: identities } = await identityQuery;

    if (!identities || identities.length === 0) {
      return 0;
    }

    const contactIds = identities.map(i => i.contact_id);

    // Find campaign leads waiting for connection acceptance from these contacts
    let waitingLeadsQuery = supabase
      .from('campaign_lead_progress')
      .select(`
        id,
        campaign_id,
        contact_id,
        sender_account_id,
        current_node_id,
        linkedin_campaigns!inner (
          id,
          organization_id,
          sequence_nodes,
          sequence_edges
        )
      `)
      .in('contact_id', contactIds)
      .eq('status', 'waiting')
      .not('connection_sent_at', 'is', null)
      .is('connection_accepted_at', null);

    if (accountId) {
      waitingLeadsQuery = waitingLeadsQuery.eq('sender_account_id', accountId);
    }

    const { data: waitingLeads } = await waitingLeadsQuery;

    if (!waitingLeads || waitingLeads.length === 0) {
      return 0;
    }

    let advancedCount = 0;

    for (const lead of waitingLeads) {
      try {
        const campaign = lead.linkedin_campaigns as {
          id: string;
          organization_id: string;
          sequence_nodes: WorkflowNode[];
          sequence_edges: WorkflowEdge[];
        };
        const nodes = campaign.sequence_nodes || [];
        const edges = campaign.sequence_edges || [];

        // Find next node via the accepted branch
        const nextNode = getNextNode(
          lead.current_node_id || '',
          nodes,
          edges,
          'accepted'
        );

        await supabase
          .from('campaign_lead_progress')
          .update({
            connection_accepted_at: new Date().toISOString(),
            current_node_id: nextNode?.id || null,
            status: nextNode ? 'pending' : 'completed',
            next_action_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', lead.id)
          .eq('status', 'waiting'); // Optimistic lock — skip if already advanced by connection-checker

        // Log the acceptance
        await supabase.from('campaign_action_log').insert({
          campaign_id: lead.campaign_id,
          progress_id: lead.id,
          contact_id: lead.contact_id,
          sender_account_id: lead.sender_account_id,
          node_id: lead.current_node_id || 'unknown',
          node_type: 'connectionRequest',
          action_type: 'connection_accepted',
          status: 'success',
          executed_at: new Date().toISOString(),
          metadata: { source: 'webhook' },
        });

        // Increment campaign analytics
        await supabase.rpc('increment_campaign_analytics', {
          p_organization_id: campaign.organization_id,
          p_campaign_id: lead.campaign_id,
          p_account_id: lead.sender_account_id,
          p_metric: 'connections_accepted',
          p_value: 1,
        });

        advancedCount++;
        console.log(`[Unipile Webhook] Advanced campaign lead ${lead.id} — connection accepted via webhook`);
      } catch (leadErr) {
        console.error(`[Unipile Webhook] Failed to advance campaign lead ${lead.id}:`, leadErr);
      }
    }

    return advancedCount;
  } catch (err) {
    console.error('[Unipile Webhook] advanceCampaignLeadsOnConnection error:', err);
    return 0;
  }
}

/**
 * Process a new connection and deliver pending lead magnets
 */
async function processNewConnection(
  supabase: SupabaseClient,
  connectionUserId: string,
  organizationId: string | null,
  accountId: string | null
): Promise<number> {
  // Build query for pending leads (include ICP and brand voice for AI chatbot)
  let query = supabase
    .from('unipile_leads')
    .select(`
      *,
      campaign:unipile_campaigns(
        *,
        account:unipile_accounts(*),
        icp:library_icps(*),
        brand_voice:library_brand_voices(*)
      )
    `)
    .eq('commenter_id', connectionUserId)
    .eq('status', 'awaiting_connection');

  // If we know the organization, filter by it for efficiency
  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  if (accountId) {
    query = query.eq('sender_account_id', accountId);
  }

  const { data: pendingLeads, error: leadsError } = await query;

  if (leadsError) {
    console.error('[Unipile Webhook] Failed to fetch pending leads:', leadsError);
    return 0;
  }

  if (!pendingLeads || pendingLeads.length === 0) {
    console.log(`[Unipile Webhook] No pending leads for connection ${connectionUserId}`);
    return 0;
  }

  console.log(`[Unipile Webhook] Found ${pendingLeads.length} pending leads`);

  let deliveredCount = 0;

  for (const lead of pendingLeads) {
    const campaign = lead.campaign;
    if (!campaign) {
      console.log(`[Unipile Webhook] Lead ${lead.id} has no campaign, skipping`);
      continue;
    }

    if (!campaign.auto_send_on_connection) {
      console.log(`[Unipile Webhook] Campaign ${campaign.id} has auto_send_on_connection disabled`);
      continue;
    }

    if (!campaign.is_active) {
      console.log(`[Unipile Webhook] Campaign ${campaign.id} is not active`);
      continue;
    }

    const account = campaign.account;
    if (!account || account.status !== 'active') {
      console.log(`[Unipile Webhook] Account for campaign ${campaign.id} is not active`);
      continue;
    }

    try {
      const dmDelaySeconds = campaign.dm_delay_seconds || 10; // Shorter delay for connection-triggered
      const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();
      const firstName = (lead.commenter_name || '').split(' ')[0] || 'there';

      // Check if AI chatbot is enabled for this campaign
      let usedAiChatbot = false;
      if (campaign.ai_chatbot_enabled && campaign.ai_chatbot_instructions) {
        try {
          usedAiChatbot = await initiateAiChatbotFromWebhook(
            supabase, lead, campaign, scheduledFor
          );
        } catch (aiErr) {
          console.error(`[Unipile Webhook] AI chatbot initiation failed, falling back to template:`, aiErr);
        }
      }

      if (!usedAiChatbot) {
        // Fall back to static template DM
        const dmMessage = buildLeadDmMessage({
          template: campaign.dm_template,
          commenterName: lead.commenter_name || firstName,
          matchedKeyword: lead.matched_keyword || '',
          leadId: lead.id,
          leadMagnetUrl: campaign.lead_magnet_url,
          supabaseUrl: Deno.env.get('SUPABASE_URL')!,
        });

        if (!dmMessage.trim()) {
          console.error(`[Unipile Webhook] Empty DM message for lead ${lead.id}, skipping`);
          continue;
        }

        const { error: queueError } = await supabase
          .from('unipile_message_queue')
          .insert({
            campaign_id: campaign.id,
            lead_id: lead.id,
            account_id: account.id,
            organization_id: campaign.organization_id,
            recipient_platform_id: connectionUserId,
            recipient_name: lead.commenter_name,
            message_text: dmMessage,
            scheduled_for: scheduledFor,
            status: 'pending',
          });

        if (queueError) {
          console.error(`[Unipile Webhook] Failed to queue DM for lead ${lead.id}:`, queueError);
          continue;
        }
      }

      // Update lead status
      await supabase
        .from('unipile_leads')
        .update({
          status: usedAiChatbot ? 'ai_chatting' : 'pending',
          is_connected: true,
          connection_detected_at: new Date().toISOString(),
          connection_source: 'webhook',
          ...(usedAiChatbot ? { ai_conversation_active: true, ai_conversation_turn_count: 1 } : {}),
        })
        .eq('id', lead.id);

      deliveredCount++;
      console.log(`[Unipile Webhook] Queued DM for lead ${lead.id}`);

      // Notify webhook if configured
      if (campaign.webhook_url) {
        try {
          await fetch(campaign.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'connection_detected',
              lead_id: lead.id,
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              commenter_id: connectionUserId,
              commenter_name: lead.commenter_name,
              matched_keyword: lead.matched_keyword,
              dm_scheduled_for: scheduledFor,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (webhookError) {
          console.error(`[Unipile Webhook] Failed to notify webhook:`, webhookError);
        }
      }

    } catch (error) {
      console.error(`[Unipile Webhook] Failed to process lead ${lead.id}:`, error);
    }
  }

  return deliveredCount;
}

/**
 * Initiate an AI chatbot conversation for a lead from the webhook handler.
 * Returns true if AI chatbot was successfully started, false to fall back to template.
 */
async function initiateAiChatbotFromWebhook(
  supabase: SupabaseClient,
  lead: Record<string, unknown>,
  campaign: Record<string, unknown>,
  scheduledFor: string,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  // Get OpenRouter API key
  const { data: apiKeyData } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', campaign.organization_id)
    .eq('provider', 'openrouter')
    .single();

  const chatbotModelIsOllama = isOllamaModel(campaign.ai_chatbot_model as string | undefined);
  if (!apiKeyData && !chatbotModelIsOllama) {
    console.warn('[Unipile Webhook] No OpenRouter API key, falling back to template');
    return false;
  }

  const encKey = Deno.env.get('ENCRYPTION_KEY')!;
  const openRouterKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encKey) : '';

  const commenterName = String(lead.commenter_name || 'there');
  const commentText = String(lead.comment_text || '');
  const icpScore = (lead.icp_score as number) ?? 50;
  const icpReasoning = (lead.icp_score_reasoning as string) ?? 'No ICP scoring performed';

  // Brand voice from joined relation
  const brandVoice = campaign.brand_voice as {
    tone: string | null;
    personality: string | null;
    writing_examples: string[] | null;
  } | null;

  const systemPrompt = buildChatbotSystemPrompt({
    commenterName,
    commenterHeadline: null, // Not available from lead record
    commentText,
    icpScore,
    icpReasoning,
    chatbotInstructions: (campaign.ai_chatbot_instructions as string) || 'Be helpful and guide the conversation.',
    brandVoice,
  });

  const aiModel = chatbotModel(campaign.ai_chatbot_model as string | null);
  const { message: initialMessage, inputTokens, outputTokens } = await generateInitialAiMessage(
    {
      commenterName,
      commenterHeadline: null,
      commentText,
      icpScore,
      icpReasoning,
      chatbotInstructions: (campaign.ai_chatbot_instructions as string) || 'Be helpful and guide the conversation.',
      brandVoice,
    },
    openRouterKey,
    aiModel,
    supabaseUrl,
    { supabase, organizationId: campaign.organization_id as string },
  );

  // Create ai_chatbot_conversations record BEFORE queueing the message
  // so the conversation exists when the message processor runs
  const { error: convError } = await supabase
    .from('ai_chatbot_conversations')
    .insert({
      organization_id: campaign.organization_id,
      campaign_id: campaign.id,
      lead_id: lead.id,
      status: 'active',
      turn_count: 1,
      max_turns: (campaign.ai_chatbot_max_turns as number) ?? 10,
      system_prompt: systemPrompt,
      conversation_history: [
        { role: 'assistant', content: initialMessage, timestamp: new Date().toISOString() },
      ],
      lead_context: {
        commenterName,
        commentText,
        icpScore,
        icpReasoning,
      },
      total_input_tokens: inputTokens,
      total_output_tokens: outputTokens,
      last_ai_response_at: new Date().toISOString(),
    });

  if (convError) {
    console.error(`[Unipile Webhook] Failed to create AI conversation:`, convError);
    return false;
  }

  // Queue the AI message
  const account = campaign.account as { id: string };
  const { error: queueError } = await supabase
    .from('unipile_message_queue')
    .insert({
      campaign_id: campaign.id,
      lead_id: lead.id,
      account_id: account.id,
      organization_id: campaign.organization_id,
      recipient_platform_id: lead.commenter_id,
      recipient_name: commenterName,
      message_text: initialMessage,
      scheduled_for: scheduledFor,
      status: 'pending',
    });

  if (queueError) {
    console.error(`[Unipile Webhook] Failed to queue AI message:`, queueError);
    // Conversation was created but message failed to queue — mark conversation as error
    await supabase
      .from('ai_chatbot_conversations')
      .update({ status: 'error' })
      .eq('lead_id', lead.id)
      .eq('campaign_id', campaign.id)
      .eq('status', 'active');
    return false;
  }

  console.log(`[Unipile Webhook] AI chatbot initiated for lead ${lead.id}`);
  return true;
}

/**
 * Log job execution
 */
async function logJob(
  supabase: SupabaseClient,
  status: string,
  startTime: number,
  result: Record<string, unknown>
) {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'process_webhook',
    status,
    items_processed: (result.itemsProcessed as number) || 0,
    items_created: (result.itemsCreated as number) || 0,
    items_failed: 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors } : null,
    duration_ms: duration,
  });
}
