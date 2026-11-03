import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { createChannelRouter, mapProviderToChannel } from "../_shared/channels/index.ts";
import type { InboundMessage, ChannelType } from "../_shared/channels/types.ts";
import { classifyReply } from '../_shared/reply-classifier.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * CRM Sync Inbound Edge Function
 *
 * NOT SCHEDULED: no pg_cron job calls this (checked on prod 2026-10-21). Live
 * inbound comes only from unipile-webhook-handler, so a missed webhook is not
 * recovered. Before scheduling it as a backstop, note it reads only each chat's
 * last message and runs its own campaign-stop/autopilot path alongside the
 * webhook's. Polls for new inbound messages and syncs them into the CRM.
 *
 * Flow:
 * 1. Get all active channel accounts
 * 2. Poll each account for new messages since last sync
 * 3. Match sender to existing contact or create new one
 * 4. Get or create conversation
 * 5. Insert message into crm_messages
 * 6. Update conversation stats
 * 7. Evaluate automation rules
 * 8. Notify n8n webhook if configured
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const router = createChannelRouter();
  const jobId = crypto.randomUUID();
  const startTime = Date.now();

  let messagesReceived = 0;
  let contactsCreated = 0;
  let conversationsCreated = 0;
  const errors: string[] = [];

  try {
    console.log(`[CRM Sync] Starting job ${jobId}`);

    // Get all active accounts
    const { data: accounts, error: accountsError } = await supabase
      .from('unipile_accounts')
      .select('*')
      .eq('status', 'active');

    if (accountsError) {
      throw new Error(`Failed to fetch accounts: ${accountsError.message}`);
    }

    if (!accounts || accounts.length === 0) {
      console.log('[CRM Sync] No active accounts to sync');
      return new Response(JSON.stringify({
        success: true,
        message: 'No active accounts',
        jobId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[CRM Sync] Processing ${accounts.length} accounts`);

    for (const account of accounts) {
      try {
        const channelType = mapProviderToChannel(account.provider);
        const since = account.last_synced_at || new Date(Date.now() - 2 * 60 * 1000).toISOString();

        console.log(`[CRM Sync] Polling ${account.id} (${channelType}) since ${since}`);

        // Poll for new messages
        let inboundMessages: InboundMessage[];
        try {
          inboundMessages = await router.pollInbound(account.id, channelType, since);
        } catch (pollError) {
          console.error(`[CRM Sync] Poll failed for ${account.id}:`, pollError);
          errors.push(`Account ${account.id}: ${pollError instanceof Error ? pollError.message : 'Poll failed'}`);

          // Update account error status
          await supabase
            .from('unipile_accounts')
            .update({
              error_message: pollError instanceof Error ? pollError.message : 'Poll failed',
              updated_at: new Date().toISOString(),
            })
            .eq('id', account.id);

          continue;
        }

        if (inboundMessages.length === 0) {
          // Update last synced even if no messages
          await supabase
            .from('unipile_accounts')
            .update({
              last_synced_at: new Date().toISOString(),
              error_message: null,
            })
            .eq('id', account.id);

          continue;
        }

        console.log(`[CRM Sync] Found ${inboundMessages.length} new messages for ${account.id}`);

        for (const message of inboundMessages) {
          try {
            // Quick dedup check before doing heavier work (contact/conversation creation)
            const { data: existingMessage } = await supabase
              .from('crm_messages')
              .select('id')
              .eq('external_message_id', message.externalMessageId)
              .maybeSingle();

            if (existingMessage) {
              console.log(`[CRM Sync] Message ${message.externalMessageId} already exists`);
              continue;
            }

            // For outbound messages, skip contact creation (we sent it, not the contact)
            // For inbound, find/create contact as normal
            let contactId: string;
            if (message.isFromMe) {
              // Try to find contact by external conversation ID - look up who we're talking to
              const { data: existingConv } = await supabase
                .from('crm_conversations')
                .select('contact_id')
                .eq('organization_id', account.organization_id)
                .eq('external_conversation_id', message.externalConversationId)
                .single();

              if (existingConv) {
                contactId = existingConv.contact_id;
              } else {
                // No conversation yet - try to find the recipient in CRM by their Unipile attendee ID
                const chat = (message.metadata?.unipile as Record<string, unknown>)?.chat as Record<string, unknown> | undefined;
                const attendeeId = chat?.attendee_id as string | undefined;

                if (attendeeId) {
                  const { data: identity } = await supabase
                    .from('crm_contact_identities')
                    .select('contact_id')
                    .eq('organization_id', account.organization_id)
                    .eq('channel', channelType)
                    .eq('platform_user_id', attendeeId)
                    .maybeSingle();

                  if (identity) {
                    contactId = identity.contact_id;
                  } else {
                    console.log(`[CRM Sync] Skipping outbound message ${message.externalMessageId} - recipient not in CRM`);
                    continue;
                  }
                } else {
                  console.log(`[CRM Sync] Skipping outbound message ${message.externalMessageId} - no attendee ID`);
                  continue;
                }
              }
            } else {
              const { contactId: foundContactId, isNew: isNewContact } = await findOrCreateContact(
                supabase,
                account.organization_id,
                channelType,
                message
              );
              if (isNewContact) {
                contactsCreated++;
              }
              contactId = foundContactId;
            }

            // Get or create conversation
            const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
              p_org_id: account.organization_id,
              p_contact_id: contactId,
              p_channel: channelType,
              p_channel_account_id: account.id,
              p_external_conversation_id: message.externalConversationId,
              p_external_participant_id: message.senderExternalId,
            });

            if (!conversationId) {
              console.error(`[CRM Sync] Failed to get/create conversation`);
              continue;
            }

            // Check if this is a new conversation
            const { data: convCheck } = await supabase
              .from('crm_conversations')
              .select('message_count')
              .eq('id', conversationId)
              .single();

            if (convCheck?.message_count === 0) {
              conversationsCreated++;
            }

            // Upsert message - ignoreDuplicates prevents race condition with webhook handler
            const { data: newMessage, error: messageError } = await supabase
              .from('crm_messages')
              .upsert({
                organization_id: account.organization_id,
                conversation_id: conversationId,
                contact_id: contactId,
                direction: message.isFromMe ? 'outbound' : 'inbound',
                sender_type: message.isFromMe ? 'user' : 'contact',
                content: message.content,
                content_type: message.contentType || 'text',
                attachments: message.attachments || [],
                external_message_id: message.externalMessageId,
                external_thread_id: message.externalConversationId,
                email_subject: message.emailSubject,
                email_from: message.emailFrom,
                email_to: message.emailTo,
                email_cc: message.emailCc,
                email_headers: message.emailHeaders,
                status: 'delivered',
                delivered_at: message.sentAt,
                metadata: message.metadata || {},
              }, {
                onConflict: 'external_message_id',
                ignoreDuplicates: true,
              })
              .select()
              .single();

            if (messageError) {
              console.error(`[CRM Sync] Failed to insert message:`, messageError);
              errors.push(`Message insert: ${messageError.message}`);
              continue;
            }

            // Log activity
            await supabase.from('crm_activities').insert({
              organization_id: account.organization_id,
              contact_id: contactId,
              activity_type: message.isFromMe ? 'message_sent' : 'message_received',
              title: message.isFromMe ? 'Message sent' : 'Message received',
              description: message.content.substring(0, 100),
              metadata: {
                channel: channelType,
                messageId: newMessage.id,
                externalMessageId: message.externalMessageId,
              },
              performed_by_type: message.isFromMe ? 'user' : 'contact',
            });

            // Only process inbound-specific logic (webhooks, autopilot, reply detection) for received messages
            if (message.isFromMe) {
              messagesReceived++;
              console.log(`[CRM Sync] Saved outbound message ${newMessage.id}`);
              continue;
            }

            // Notify webhook
            await notifyWebhook(supabase, account.organization_id, 'message_received', {
              messageId: newMessage.id,
              conversationId,
              contactId,
              channel: channelType,
              externalMessageId: message.externalMessageId,
              senderId: message.senderExternalId,
              senderName: message.senderDisplayName,
              content: message.content,
              contentType: message.contentType,
            });

            // Check if AI is enabled for this conversation
            const { data: conversation } = await supabase
              .from('crm_conversations')
              .select('ai_enabled, ai_context, metadata, channel')
              .eq('id', conversationId)
              .single();

            if (conversation?.ai_enabled) {
              // Send to n8n for AI processing (legacy webhook path)
              await notifyWebhook(supabase, account.organization_id, 'ai_message_received', {
                messageId: newMessage.id,
                conversationId,
                contactId,
                channel: channelType,
                content: message.content,
                aiContext: conversation.ai_context,
                senderName: message.senderDisplayName,
              });

              // Built-in autopilot: classify reply and run processAutopilot
              try {
                const openRouterKey = await getOrgOpenRouterKey(supabase, account.organization_id);

                // Get org's default LLM model
                const { data: orgSettings } = await supabase
                  .from('organization_settings')
                  .select('default_llm_model')
                  .eq('organization_id', account.organization_id)
                  .maybeSingle();
                const orgModel = orgSettings?.default_llm_model || undefined;

                // Classify intent (falls back to 'neutral' if no API key or on error)
                let intent = 'neutral';
                let confidence = 0.5;

                if (openRouterKey) {
                  const classification = await classifyReply(
                    { from_email: '', subject: '', body_text: message.content },
                    openRouterKey,
                    orgModel,
                  );
                  intent = classification.intent;
                  confidence = classification.confidence;
                }

                // Always run autopilot — even without classification, 'neutral' rule fires
                const autopilotResult = await processAutopilot(
                  supabase,
                  {
                    conversationId,
                    contactId,
                    organizationId: account.organization_id,
                    intent,
                    confidence,
                    inboundMessageId: newMessage.id,
                    channel: channelType,
                    messageContent: message.content,
                    model: orgModel,
                  },
                  openRouterKey || '',
                );
                console.log(`[CRM Sync] Inbox autopilot result for ${conversationId}: ${autopilotResult.action}`);
              } catch (autopilotErr) {
                console.error(`[CRM Sync] Inbox autopilot error:`, autopilotErr);
              }
            }

            // ============================================
            // AI CHATBOT: Check for active AI conversation
            // ============================================
            try {
              // Find active AI chatbot conversations for this contact's leads
              const { data: activeLeads } = await supabase
                .from('unipile_leads')
                .select('id')
                .eq('organization_id', account.organization_id)
                .eq('ai_conversation_active', true);

              if (activeLeads && activeLeads.length > 0) {
                // Check if sender matches any active lead by commenter_id via identity
                const { data: senderIdentity } = await supabase
                  .from('crm_contact_identities')
                  .select('platform_user_id')
                  .eq('contact_id', contactId)
                  .eq('channel', channelType)
                  .single();

                if (senderIdentity) {
                  const { data: matchingLead } = await supabase
                    .from('unipile_leads')
                    .select('id')
                    .eq('commenter_id', senderIdentity.platform_user_id)
                    .eq('ai_conversation_active', true)
                    .single();

                  if (matchingLead) {
                    const { data: activeChatbot } = await supabase
                      .from('ai_chatbot_conversations')
                      .select('id')
                      .eq('lead_id', matchingLead.id)
                      .eq('status', 'active')
                      .single();

                    if (activeChatbot) {
                      console.log(`[CRM Sync] Triggering AI respond for chatbot conversation ${activeChatbot.id}`);
                      try {
                        await supabase.functions.invoke('unipile-ai-respond', {
                          body: {
                            chatbotConversationId: activeChatbot.id,
                            messageContent: message.content,
                            senderName: message.senderDisplayName || 'Unknown',
                          },
                        });
                      } catch (aiError) {
                        console.error(`[CRM Sync] AI respond invocation failed:`, aiError);
                      }
                    }
                  }
                }
              }
            } catch (aiCheckError) {
              console.error('[CRM Sync] AI chatbot check failed:', aiCheckError);
              // Don't fail the sync on AI chatbot errors
            }

            // ============================================
            // EVALUATE AUTOMATION RULES
            // ============================================
            try {
              await supabase.functions.invoke('evaluate-rules', {
                body: {
                  organizationId: account.organization_id,
                  triggerType: 'message_received',
                  contactId,
                  triggerData: {
                    messageId: newMessage.id,
                    conversationId,
                    messageContent: message.content,
                    messageChannel: channelType,
                  },
                },
              });
            } catch (ruleError) {
              console.error('[CRM Sync] Rule evaluation failed:', ruleError);
              // Don't fail the sync on rule evaluation errors
            }

            messagesReceived++;
            console.log(`[CRM Sync] Saved message ${newMessage.id}`);

            // ============================================
            // AUTO-STOP CAMPAIGNS ON REPLY
            // ============================================
            // Check if this contact has any active campaign progress
            // Only stop campaigns that have stop_on_reply enabled
            const { data: activeProgress } = await supabase
              .from('campaign_lead_progress')
              .select(`
                id,
                campaign_id,
                sender_account_id,
                status,
                current_node_id,
                linkedin_campaigns:campaign_id (
                  name,
                  organization_id,
                  stop_on_reply
                )
              `)
              .eq('contact_id', contactId)
              .in('status', ['pending', 'in_progress', 'waiting']);

            if (activeProgress && activeProgress.length > 0) {
              console.log(`[CRM Sync] Contact ${contactId} replied - checking ${activeProgress.length} active campaign(s)`);

              for (const progress of activeProgress) {
                const campaign = progress.linkedin_campaigns as Record<string, unknown>;

                // Check if campaign has stop_on_reply enabled (default to true if not set)
                const stopOnReply = campaign?.stop_on_reply !== false;

                if (!stopOnReply) {
                  console.log(`[CRM Sync] Campaign ${progress.campaign_id} has stop_on_reply disabled, skipping`);
                  continue;
                }

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
                  console.error(`[CRM Sync] Failed to update progress ${progress.id}:`, updateError);
                  continue;
                }

                // Log the reply detection as an action
                await supabase.from('campaign_action_log').insert({
                  campaign_id: progress.campaign_id,
                  progress_id: progress.id,
                  contact_id: contactId,
                  node_id: 'system_reply_detected',
                  node_type: 'system',
                  action_type: 'reply_detected',
                  channel: channelType,
                  status: 'success',
                  external_id: message.externalMessageId,
                  executed_at: new Date().toISOString(),
                });

                // Increment campaign analytics for reply
                if (progress.sender_account_id) {
                  await supabase.rpc('increment_campaign_analytics', {
                    p_organization_id: campaign?.organization_id as string,
                    p_campaign_id: progress.campaign_id,
                    p_account_id: progress.sender_account_id,
                    p_metric: 'messages_replied',
                    p_value: 1,
                  });
                }

                // Notify webhook for external integrations
                await notifyWebhook(supabase, account.organization_id, 'lead_replied', {
                  campaignId: progress.campaign_id,
                  campaignName: campaign?.name,
                  contactId,
                  progressId: progress.id,
                  channel: channelType,
                  messageId: newMessage.id,
                  messageContent: message.content.substring(0, 500),
                  repliedAt: new Date().toISOString(),
                });

                console.log(`[CRM Sync] Marked lead ${progress.id} as replied in campaign ${progress.campaign_id}`);
              }
            }

          } catch (msgError) {
            console.error(`[CRM Sync] Error processing message:`, msgError);
            errors.push(`Message: ${msgError instanceof Error ? msgError.message : 'Unknown'}`);
          }
        }

        // Update last synced
        await supabase
          .from('unipile_accounts')
          .update({
            last_synced_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', account.id);

      } catch (accountError) {
        console.error(`[CRM Sync] Error processing account ${account.id}:`, accountError);
        errors.push(`Account ${account.id}: ${accountError instanceof Error ? accountError.message : 'Unknown'}`);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CRM Sync] Job ${jobId} completed in ${duration}ms: ${messagesReceived} messages, ${contactsCreated} new contacts, ${conversationsCreated} new conversations`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      duration,
      messagesReceived,
      contactsCreated,
      conversationsCreated,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[CRM Sync] Fatal error:', error);

    return new Response(JSON.stringify({
      success: false,
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Find existing contact or create new one
 */
async function findOrCreateContact(
  supabase: SupabaseClient<any>,
  organizationId: string,
  channel: ChannelType,
  message: InboundMessage
): Promise<{ contactId: string; isNew: boolean }> {
  // Try to find by identity
  const { data: existingIdentity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id')
    .eq('organization_id', organizationId)
    .eq('channel', channel)
    .eq('platform_user_id', message.senderExternalId)
    .single();

  if (existingIdentity) {
    return { contactId: existingIdentity.contact_id, isNew: false };
  }

  // Create new contact
  const { data: newContact, error: contactError } = await supabase
    .from('crm_contacts')
    .insert({
      organization_id: organizationId,
      display_name: message.senderDisplayName || message.senderExternalId,
      avatar_url: message.senderAvatarUrl,
      email: channel === 'email' ? message.senderExternalId : null,
      source: channel,
      status: 'active',
    })
    .select()
    .single();

  if (contactError || !newContact) {
    throw new Error(`Failed to create contact: ${contactError?.message}`);
  }

  // Create identity
  await supabase.from('crm_contact_identities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    channel,
    platform_user_id: message.senderExternalId,
    platform_username: message.senderDisplayName,
    platform_avatar_url: message.senderAvatarUrl,
    is_primary: true,
  });

  // Log activity
  await supabase.from('crm_activities').insert({
    organization_id: organizationId,
    contact_id: newContact.id,
    activity_type: 'contact_created',
    title: 'Contact created',
    description: `New contact from ${channel} message`,
    metadata: { channel, externalId: message.senderExternalId },
    performed_by_type: 'system',
  });

  return { contactId: newContact.id, isNew: true };
}

/**
 * Notify webhook (n8n or other automation)
 */
async function notifyWebhook(
  supabase: SupabaseClient<any>,
  organizationId: string,
  event: string,
  data: Record<string, unknown>
) {
  try {
    // Get organization's webhook URL
    const { data: campaigns } = await supabase
      .from('unipile_campaigns')
      .select('webhook_url')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .not('webhook_url', 'is', null)
      .limit(1);

    const webhookUrl = campaigns?.[0]?.webhook_url;
    if (!webhookUrl) return;

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        timestamp: new Date().toISOString(),
        ...data,
      }),
    });

    console.log(`[CRM Sync] Webhook sent: ${event}`);
  } catch (error) {
    console.error('[CRM Sync] Webhook failed:', error);
  }
}

/**
 * Get the organization's OpenRouter API key for AI features.
 */
async function getOrgOpenRouterKey(
  supabase: SupabaseClient<any>,
  organizationId: string,
): Promise<string | null> {
  try {
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const { data: apiKeyData } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'openrouter')
      .single();

    if (!apiKeyData) return null;
    return await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
  } catch {
    return null;
  }
}
