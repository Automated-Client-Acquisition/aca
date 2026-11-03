import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import { decryptApiKey, parseUnipileError, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { UnipileV2Client } from '../_shared/unipile/v2-client.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { sendDirectMessage } from '../_shared/unipile/messaging-v2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Unipile Process DM Queue Edge Function
 *
 * Called by pg_cron every 1 minute to send queued DMs.
 * Uses the official Unipile SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  let messagesSent = 0;
  let messagesFailed = 0;
  let messagesSkipped = 0;
  const errors: string[] = [];

  try {
    console.log(`[Process DM Queue] Starting job ${jobId}`);

    const now = new Date().toISOString();

    // Reset messages stuck in 'processing' for over 5 minutes (crash recovery)
    const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stuckMessages } = await supabase
      .from('unipile_message_queue')
      .update({ status: 'pending', error_message: 'Reset: stuck in processing state' })
      .eq('status', 'processing')
      .lt('last_attempt_at', stuckThreshold)
      .select('id');
    if (stuckMessages && stuckMessages.length > 0) {
      console.log(`[Process DM Queue] Reset ${stuckMessages.length} stuck messages back to pending`);
    }

    // Fetch pending messages ready to send
    const { data: messages, error: messagesError } = await supabase
      .from('unipile_message_queue')
      .select(`
        *,
        sender_account:unipile_accounts!account_id(*),
        campaign:unipile_campaigns(
          *,
          account:unipile_accounts(*)
        ),
        lead:unipile_leads(*)
      `)
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(20);

    if (messagesError) {
      throw new Error(`Failed to fetch messages: ${messagesError.message}`);
    }

    if (!messages || messages.length === 0) {
      console.log('[Process DM Queue] No messages to process');
      await logJob(supabase, jobId, 'completed', startTime, { message: 'No messages to process' });
      return new Response(JSON.stringify({ success: true, message: 'No messages to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Process DM Queue] Found ${messages.length} messages to process`);

    // Track rate limits per campaign
    const campaignRateLimits: Map<string, { hourly: number; daily: number }> = new Map();

    for (const message of messages) {
      try {
        const campaign = message.campaign;
        const lead = message.lead;

        if (!campaign || !campaign.is_active) {
          console.log(`[Process DM Queue] Skipping message ${message.id} - campaign inactive`);
          await updateMessageStatus(supabase, message.id, 'cancelled', 'Campaign inactive');
          await supabase
            .from('unipile_leads')
            .update({ status: 'skipped', dm_error: 'Campaign inactive' })
            .eq('id', message.lead_id);
          messagesSkipped++;
          continue;
        }

        // Use the message-level sender account (set by poll-comments per post),
        // falling back to the campaign's primary account for legacy messages
        const account = (message.sender_account && message.sender_account.status === 'active')
          ? message.sender_account
          : campaign.account;
        if (!account || account.status !== 'active') {
          console.log(`[Process DM Queue] Skipping message ${message.id} - account not active`);
          await updateMessageStatus(supabase, message.id, 'cancelled', 'Account not active');
          await supabase
            .from('unipile_leads')
            .update({ status: 'skipped', dm_error: 'Account not active' })
            .eq('id', message.lead_id);
          messagesSkipped++;
          continue;
        }

        // Check rate limits
        const limits = await checkRateLimits(supabase, campaign, campaignRateLimits);
        if (!limits.canSend) {
          console.log(`[Process DM Queue] Rate limit reached for campaign ${campaign.id}: ${limits.reason}`);
          messagesSkipped++;
          continue;
        }

        // v2 accounts (ACA's platform key) send through the v2 chat routes; v1 through the SDK/DSN.
        const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
        const isV2 = account.api_version === 'v2';
        const v2Client = isV2 ? new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) }) : null;
        const unipileApiKey = isV2 ? '' : await decryptApiKey(account.access_token_encrypted, encryptionKey);
        const unipileDsn = normalizeDsnUrl(account.dsn_url);
        const channel = account.provider === 'INSTAGRAM' ? 'instagram' : 'linkedin';

        const client = isV2 ? null : new UnipileClient(unipileDsn, unipileApiKey);

        const attemptCount = (message.attempts || 0) + 1;

        // Atomically claim message (prevents duplicate sends from concurrent cron runs)
        const { data: claimed, error: markProcessingError } = await supabase
          .from('unipile_message_queue')
          .update({
            status: 'processing',
            attempts: attemptCount,
            last_attempt_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', message.id)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle();
        if (markProcessingError) {
          throw new Error(`Failed to mark message processing: ${markProcessingError.message}`);
        }
        if (!claimed) {
          console.log(`[Process DM Queue] Message ${message.id} already claimed by another worker, skipping`);
          messagesSkipped++;
          continue;
        }

        // Send DM via Unipile SDK
        const recipientId = message.recipient_platform_id || message.recipient_id;
        console.log(`[Process DM Queue] Sending DM to ${recipientId} via ${account.provider}`);

        // Pre-flight: verify LinkedIn connection before attempting DM
        // Skip if DB already confirmed connection (e.g. from sync or auto-accept) — Unipile API can lag
        const dbConfirmedConnection = lead?.is_connected && lead?.connection_detected_at;
        if (!isV2 && account.provider === 'LINKEDIN' && recipientId && !message.chat_id && !dbConfirmedConnection) {
          try {
            const profileUrl = `${unipileDsn}/api/v1/users/${encodeURIComponent(String(recipientId))}?account_id=${account.unipile_account_id}&notify=false`;
            const profileResp = await fetch(profileUrl, {
              headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
            });
            if (profileResp.ok) {
              const profileData = await profileResp.json();
              if (profileData.network_distance && profileData.network_distance !== 'FIRST_DEGREE') {
                console.log(`[Process DM Queue] Recipient ${recipientId} is ${profileData.network_distance}, not connected — skipping DM`);
                await updateMessageStatus(supabase, message.id, 'failed', 'Recipient is not a 1st-degree connection');
                // Reset lead to comment_reply_failed so poll-comments retries with a comment reply
                if (lead?.id) {
                  await supabase
                    .from('unipile_leads')
                    .update({ status: 'comment_reply_failed', is_connected: false, dm_error: 'Not connected — DM blocked by LinkedIn' })
                    .eq('id', lead.id);
                }
                messagesFailed++;
                continue;
              }
            }
          } catch (connCheckErr) {
            console.warn(`[Process DM Queue] Connection pre-check failed, proceeding with send:`, connCheckErr);
          }
        }

        try {
          // Check for existing chat: prior sent message to same recipient, or CRM conversation
          let existingChatId: string | null = null;

          // 1. Check unipile_message_queue for a prior sent message with a chat_id
          // (v2: only this account's chats; another account's chat id is not reachable from this one)
          let priorQuery = supabase
            .from('unipile_message_queue')
            .select('chat_id')
            .eq('recipient_platform_id', recipientId);
          if (isV2) priorQuery = priorQuery.eq('account_id', account.id);
          const { data: priorMsg } = await priorQuery
            .eq('status', 'sent')
            .not('chat_id', 'is', null)
            .not('chat_id', 'eq', '')
            .order('sent_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (priorMsg?.chat_id) {
            existingChatId = priorMsg.chat_id;
          }

          // 2. Fallback: check crm_conversations.external_conversation_id (v1 only, not account-scoped)
          if (!existingChatId && !isV2 && lead?.crm_contact_id) {
            const { data: conv } = await supabase
              .from('crm_conversations')
              .select('external_conversation_id')
              .eq('contact_id', lead.crm_contact_id)
              .eq('channel', channel)
              .not('external_conversation_id', 'is', null)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (conv?.external_conversation_id) {
              existingChatId = conv.external_conversation_id;
            }
          }

          let sendResult: Record<string, unknown>;

          if (v2Client) {
            // Into the known chat when there is one, otherwise start it (Instagram: the recipient is the
            // messaging identifier poll-comments stored as commenter_id).
            const sent = await sendDirectMessage(v2Client, account.unipile_account_id, String(recipientId), message.message_text, {
              chatId: existingChatId ?? undefined,
            });
            if (!sent.success) throw new Error(sent.error || 'Unipile v2 send failed');
            sendResult = { chat_id: sent.externalId || existingChatId || '', message_id: sent.messageId || '' };
          } else if (existingChatId) {
            // Reply to existing conversation — avoids 422 invalid_recipient
            console.log(`[Process DM Queue] Found existing chat ${existingChatId}, sending as reply`);
            sendResult = await client!.messaging.sendMessage({
              chat_id: existingChatId,
              text: message.message_text,
            }) as Record<string, unknown>;
            // Preserve the chat_id from the existing conversation
            if (!sendResult.chat_id) sendResult.chat_id = existingChatId;
          } else {
            // Start new chat via direct REST API (avoids SDK FormData
            // serialization issues that cause 422 invalid_recipient)
            const newChatResponse = await fetch(`${unipileDsn}/api/v1/chats`, {
              method: 'POST',
              headers: {
                'X-API-KEY': unipileApiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({
                account_id: account.unipile_account_id,
                attendees_ids: [recipientId],
                text: message.message_text,
              }),
            });

            if (!newChatResponse.ok) {
              const errorText = await newChatResponse.text().catch(() => '');
              const httpError = new Error(`${newChatResponse.status}: ${errorText.substring(0, 500)}`);
              (httpError as Record<string, unknown>).body = {
                status: newChatResponse.status,
                message: errorText.substring(0, 500),
              };
              throw httpError;
            }

            sendResult = await newChatResponse.json();
          }

          console.log(`[Process DM Queue] DM sent successfully:`, sendResult);

          // Update message as sent
          const { error: msgUpdateErr } = await supabase
            .from('unipile_message_queue')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              message_id: String(sendResult.id || sendResult.message_id || ''),
              chat_id: String(sendResult.chat_id || sendResult.conversation_id || ''),
            })
            .eq('id', message.id);

          if (msgUpdateErr) {
            console.error(`[Process DM Queue] Failed to update message status for ${message.id}:`, msgUpdateErr.message);
          }

          // Update lead status (preserve ai_chatting if AI conversation is active)
          const { data: currentLead } = await supabase
            .from('unipile_leads')
            .select('ai_conversation_active, status')
            .eq('id', message.lead_id)
            .maybeSingle();

          const newStatus = currentLead?.ai_conversation_active ? 'ai_chatting' : 'dm_sent';
          const { error: leadUpdateErr } = await supabase
            .from('unipile_leads')
            .update({
              status: newStatus,
              dm_sent_at: new Date().toISOString(),
            })
            .eq('id', message.lead_id);

          if (leadUpdateErr) {
            console.error(`[Process DM Queue] Failed to update lead status for ${message.lead_id}:`, leadUpdateErr.message);
          }

          // Update rate limit tracking
          const currentLimits = campaignRateLimits.get(campaign.id) || { hourly: 0, daily: 0 };
          campaignRateLimits.set(campaign.id, {
            hourly: currentLimits.hourly + 1,
            daily: currentLimits.daily + 1,
          });

          // Notify webhook of success
          if (campaign.webhook_url) {
            await notifyWebhook(campaign.webhook_url, 'dm_sent', {
              lead_id: lead?.id,
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              recipient_id: recipientId,
              recipient_name: message.recipient_name,
              message_preview: message.message_text.substring(0, 100),
              message_id: sendResult.id || sendResult.message_id,
            });
          }

          // CRM Bridge: log outbound AI response so it appears in the inbox
          const chatIdForCrm = String(sendResult.chat_id || sendResult.conversation_id || '');
          await createCrmRecordForAiResponse(
            supabase,
            message,
            lead,
            campaign,
            String(sendResult.id || sendResult.message_id || ''),
            chatIdForCrm,
            channel,
          );

          messagesSent++;
        } catch (sendError) {
          console.error(`[Process DM Queue] Failed to send DM:`, sendError);
          const parsedError = parseUnipileError(sendError);

          const maxAttempts = message.max_attempts || 3;

          // Detect "not connected" errors — route back to comment reply instead of hard fail
          const isNotConnectedError = parsedError.message.includes('no_connection_with_recipient')
            || parsedError.message.includes('not to be first degree');

          if (attemptCount >= maxAttempts || !parsedError.retryable) {
            // Max retries reached or non-retryable error
            await updateMessageStatus(supabase, message.id, 'failed', parsedError.message);

            // If not connected, reset lead to comment_reply_failed so poll-comments
            // retries with a comment reply instead of permanently failing
            const leadStatus = isNotConnectedError ? 'comment_reply_failed' : 'dm_failed';
            await supabase
              .from('unipile_leads')
              .update({
                status: leadStatus,
                dm_sent_at: null,
                dm_error: parsedError.message.substring(0, 500),
                ...(isNotConnectedError ? { is_connected: false } : {}),
              })
              .eq('id', message.lead_id);

            // Update any queued CRM message to 'failed' so inbox doesn't show false positive
            const crmContactId = lead?.crm_contact_id as string | null;
            if (crmContactId) {
              await supabase
                .from('crm_messages')
                .update({ status: 'failed' })
                .eq('status', 'queued')
                .eq('direction', 'outbound')
                .eq('content', message.message_text)
                .eq('contact_id', crmContactId);
            }

            // Notify webhook of failure
            if (campaign.webhook_url) {
              await notifyWebhook(campaign.webhook_url, 'dm_failed', {
                lead_id: lead?.id,
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                recipient_id: recipientId,
                recipient_name: message.recipient_name,
                error: parsedError.message,
                retry_count: attemptCount,
              });
            }

            messagesFailed++;
          } else {
            // Schedule retry with exponential backoff
            const retryDelay = Math.pow(2, attemptCount) * 60 * 1000; // 2min, 4min, 8min
            const retryAt = new Date(Date.now() + retryDelay).toISOString();

            await supabase
              .from('unipile_message_queue')
              .update({
                status: 'pending',
                scheduled_for: retryAt,
                error_message: parsedError.message,
              })
              .eq('id', message.id);

            console.log(`[Process DM Queue] Scheduled retry ${attemptCount} at ${retryAt}`);
          }

          errors.push(`Message ${message.id}: ${parsedError.code}`);
        }
      } catch (messageError) {
        console.error(`[Process DM Queue] Error processing message ${message.id}:`, messageError);
        errors.push(`Message ${message.id}: ${messageError instanceof Error ? messageError.message : 'Unknown error'}`);

        await updateMessageStatus(
          supabase,
          message.id,
          'failed',
          messageError instanceof Error ? messageError.message : 'Unknown error'
        );
        messagesFailed++;
      }
    }

    // Log job completion
    await logJob(supabase, jobId, 'completed', startTime, {
      messagesSent,
      messagesFailed,
      messagesSkipped,
      errors: errors.length > 0 ? errors : undefined,
    });

    console.log(`[Process DM Queue] Job ${jobId} completed: ${messagesSent} sent, ${messagesFailed} failed, ${messagesSkipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      messagesSent,
      messagesFailed,
      messagesSkipped,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Process DM Queue] Fatal error:', error);

    await logJob(supabase, jobId, 'failed', startTime, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Check rate limits for a campaign
 */
async function checkRateLimits(
  supabase: SupabaseClient<any>,
  campaign: Record<string, unknown>,
  cache: Map<string, { hourly: number; daily: number }>
): Promise<{ canSend: boolean; reason?: string }> {
  const maxPerHour = (campaign.max_dms_per_hour as number) ?? 10;
  const maxPerDay = (campaign.max_dms_per_day as number) ?? 50;

  // Check cache first
  const cached = cache.get(campaign.id as string);
  if (cached) {
    if (cached.hourly >= maxPerHour) {
      return { canSend: false, reason: 'Hourly limit reached' };
    }
    if (cached.daily >= maxPerDay) {
      return { canSend: false, reason: 'Daily limit reached' };
    }
  }

  // Query database for actual counts
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count: hourlyCount } = await supabase
    .from('unipile_message_queue')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'sent')
    .gte('sent_at', oneHourAgo);

  const { count: dailyCount } = await supabase
    .from('unipile_message_queue')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'sent')
    .gte('sent_at', startOfDay.toISOString());

  // Update cache with DB counts (ground truth) — batch sends are already included in DB
  cache.set(campaign.id as string, {
    hourly: hourlyCount || 0,
    daily: dailyCount || 0,
  });

  if ((hourlyCount || 0) >= maxPerHour) {
    return { canSend: false, reason: 'Hourly limit reached' };
  }

  if ((dailyCount || 0) >= maxPerDay) {
    return { canSend: false, reason: 'Daily limit reached' };
  }

  return { canSend: true };
}

/**
 * Update message status
 */
async function updateMessageStatus(
  supabase: SupabaseClient<any>,
  messageId: string,
  status: string,
  errorMessage?: string
) {
  await supabase
    .from('unipile_message_queue')
    .update({
      status,
      error_message: errorMessage || null,
    })
    .eq('id', messageId);
}

/**
 * Notify webhook
 */
async function notifyWebhook(webhookUrl: string, event: string, data: Record<string, unknown>) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        ...data,
        timestamp: new Date().toISOString(),
      }),
    });
    console.log(`[Process DM Queue] Webhook notification sent: ${event}`);
  } catch (error) {
    console.error(`[Process DM Queue] Webhook notification failed:`, error);
  }
}

/**
 * CRM Bridge: Create an outbound CRM message record for an AI chatbot response.
 * This makes AI-sent DMs visible in the unified inbox "Sent" tab.
 */
async function createCrmRecordForAiResponse(
  supabase: SupabaseClient<any>,
  message: Record<string, unknown>,
  lead: Record<string, unknown> | null,
  campaign: Record<string, unknown> | null,
  externalMessageId: string,
  externalChatId?: string,
  channel: 'linkedin' | 'instagram' = 'linkedin',
): Promise<void> {
  try {
    let crmContactId = lead?.crm_contact_id as string | null;
    if (!crmContactId && lead?.id) {
      // Lead wasn't linked to CRM yet — retry sync now so the DM appears in inbox
      try {
        const { data: syncedContactId } = await supabase.rpc('sync_lead_to_crm', {
          p_lead_id: lead.id as string,
        });
        if (syncedContactId) {
          crmContactId = syncedContactId;
          console.log(`[Process DM Queue] CRM bridge: synced lead ${lead.id} to contact ${crmContactId}`);
        }
      } catch (syncErr) {
        console.warn(`[Process DM Queue] CRM bridge: sync_lead_to_crm failed for lead ${lead.id}:`, syncErr);
      }
    }
    if (!crmContactId) {
      return;
    }

    // Find conversation: ensureCrmConversation in unipile-ai-respond already linked it
    let conversationId = lead?.crm_conversation_id as string | null;

    if (!conversationId) {
      // Fallback: query by contact + channel
      const orgId = message.organization_id as string;
      const { data: existing } = await supabase
        .from('crm_conversations')
        .select('id')
        .eq('contact_id', crmContactId)
        .eq('channel', channel)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (existing) {
        conversationId = existing.id;
      } else {
        // Create a new conversation
        const { data: newConv, error: convErr } = await supabase
          .from('crm_conversations')
          .insert({
            organization_id: orgId,
            contact_id: crmContactId,
            channel,
            status: 'open',
            last_message_at: new Date().toISOString(),
            metadata: {
              source: 'lead_magnet',
              campaign_id: campaign?.id || null,
              campaign_name: campaign?.name || null,
            },
            ...(externalChatId ? { external_conversation_id: externalChatId } : {}),
          })
          .select('id')
          .single();

        if (convErr) {
          // Race condition fallback
          const { data: raceExisting } = await supabase
            .from('crm_conversations')
            .select('id')
            .eq('contact_id', crmContactId)
            .eq('channel', channel)
            .eq('organization_id', orgId)
            .maybeSingle();
          conversationId = raceExisting?.id || null;
        } else {
          conversationId = newConv?.id || null;
        }
      }
    }

    if (!conversationId) {
      console.warn(`[Process DM Queue] CRM bridge: no conversation found/created for lead ${lead?.id}`);
      return;
    }

    // Try to promote an existing 'queued' CRM message (created by initiateAiChatbot)
    // to 'sent' now that the Unipile API delivery succeeded.
    const { data: promoted, error: promoteErr } = await supabase
      .from('crm_messages')
      .update({
        status: 'sent',
        external_message_id: externalMessageId || null,
      })
      .eq('conversation_id', conversationId)
      .eq('status', 'queued')
      .eq('direction', 'outbound')
      .eq('content', message.message_text as string)
      .select('id')
      .limit(1);

    if (!promoteErr && promoted && promoted.length > 0) {
      console.log(`[Process DM Queue] CRM bridge: promoted queued message ${promoted[0].id} to sent`);
    } else {
      // No queued message found — insert a new one (e.g. for template-only DMs without AI chatbot)
      const { error: msgErr } = await supabase
        .from('crm_messages')
        .insert({
          conversation_id: conversationId,
          organization_id: message.organization_id,
          contact_id: crmContactId,
          direction: 'outbound',
          sender_type: 'ai',
          content: message.message_text,
          channel,
          status: 'sent',
          external_message_id: externalMessageId || null,
          ai_generated: true,
          metadata: {
            source: 'lead_magnet_chatbot',
            campaign_id: campaign?.id || null,
            lead_id: lead?.id || null,
          },
        });

      if (msgErr) {
        console.error(`[Process DM Queue] CRM bridge: failed to insert outbound message:`, msgErr.message);
        return;
      }
    }

    // Update conversation last_message_at + external_conversation_id if available
    const convUpdates: Record<string, unknown> = { last_message_at: new Date().toISOString() };
    if (externalChatId) {
      convUpdates.external_conversation_id = externalChatId;
    }
    await supabase
      .from('crm_conversations')
      .update(convUpdates)
      .eq('id', conversationId);

    console.log(`[Process DM Queue] CRM bridge: outbound message logged for conversation ${conversationId}`);
  } catch (err) {
    // CRM bridge is non-critical — don't fail the send
    console.error(`[Process DM Queue] CRM bridge error (non-fatal):`, err);
  }
}

/**
 * Log job execution to unipile_job_logs
 */
async function logJob(
  supabase: SupabaseClient<any>,
  _jobId: string,
  status: string,
  startTime: number,
  result: Record<string, unknown>
) {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'process_dm_queue',
    status,
    items_processed: (result.messagesSent as number) || 0,
    items_created: (result.messagesSent as number) || 0,
    items_failed: (result.messagesFailed as number) || 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors, messagesSkipped: result.messagesSkipped } : null,
    duration_ms: duration,
  });
}
