import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { createChannelRouter } from "../_shared/channels/index.ts";
import type { OutboundMessage, RateLimitConfig } from "../_shared/channels/types.ts";
import { isServiceRoleRequest } from '../_shared/org-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * CRM Process Message Queue Edge Function
 *
 * Called by pg_cron every 1 minute to process the unified message queue.
 * Handles all channels: LinkedIn, Instagram, Email (via Unipile).
 *
 * Flow:
 * 1. Fetch pending messages where scheduled_for <= now
 * 2. Group by channel account for rate limiting
 * 3. Check channel limits (organization-level daily/hourly limits)
 * 4. Check rate limits per account (platform-level)
 * 5. Send via appropriate channel adapter
 * 6. Record channel usage for limit tracking
 * 7. Create message record in crm_messages
 * 8. Update conversation stats
 * 9. Notify n8n webhook if configured
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
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

  const router = createChannelRouter();
  const jobId = crypto.randomUUID();
  const startTime = Date.now();

  let messagesSent = 0;
  let messagesFailed = 0;
  let messagesSkipped = 0;
  const errors: string[] = [];

  try {
    console.log(`[CRM Queue] Starting job ${jobId}`);

    // Fetch pending messages ready to process
    const { data: queueItems, error: queueError } = await supabase
      .rpc('get_pending_crm_messages', { p_limit: 20 });

    if (queueError) {
      throw new Error(`Failed to fetch queue items: ${queueError.message}`);
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('[CRM Queue] No messages to process');
      return new Response(JSON.stringify({
        success: true,
        message: 'No messages to process',
        jobId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[CRM Queue] Found ${queueItems.length} messages to process`);

    // Track rate limits per account
    const accountRateLimits: Map<string, { used: number; config: RateLimitConfig }> = new Map();

    for (const item of queueItems) {
      try {
        // Skip if no channel account configured
        if (!item.channel_account_id) {
          console.log(`[CRM Queue] Skipping ${item.id} - no channel account`);
          await updateQueueStatus(supabase, item.id, 'failed', 'No channel account configured');
          messagesFailed++;
          continue;
        }

        // Map queue channel to CRM channel type
        const crmChannel = mapToCrmChannel(item.channel);

        // Check organization-level channel limits FIRST
        if (crmChannel) {
          const { data: limitCheck, error: limitError } = await supabase.rpc('check_channel_limit', {
            p_organization_id: item.organization_id,
            p_channel: crmChannel,
            p_channel_account_id: item.channel_account_id,
          });

          if (limitError) {
            console.error(`[CRM Queue] Error checking channel limits:`, limitError);
          } else if (limitCheck && limitCheck.length > 0) {
            const limit = limitCheck[0];
            if (!limit.allowed) {
              console.log(`[CRM Queue] Channel limit reached for ${crmChannel}: ${limit.reason}`);
              await updateQueueStatus(supabase, item.id, 'rate_limited', `Channel limit: ${limit.reason}`);
              messagesSkipped++;
              continue;
            }
            console.log(`[CRM Queue] Channel limit OK: ${limit.daily_used}/${limit.daily_limit} daily, ${limit.remaining} remaining`);
          }
        }

        // Check per-account rate limits (platform-level)
        const accountKey = item.channel_account_id;
        let rateData = accountRateLimits.get(accountKey);

        if (!rateData) {
          // Get rate limit config (default values)
          const rateLimitConfig: RateLimitConfig = {
            maxPerMinute: 5,
            maxPerHour: 30,
            maxPerDay: 200,
          };

          const status = await router.checkRateLimits(item.channel_account_id, rateLimitConfig);

          if (!status.canSend) {
            console.log(`[CRM Queue] Rate limited for account ${accountKey}: ${status.reason}`);
            await updateQueueStatus(supabase, item.id, 'rate_limited', status.reason);
            messagesSkipped++;
            continue;
          }

          rateData = { used: status.currentUsage.hour, config: rateLimitConfig };
          accountRateLimits.set(accountKey, rateData);
        }

        // Check if we've exceeded limits in this batch
        if (rateData.config.maxPerHour && rateData.used >= rateData.config.maxPerHour) {
          console.log(`[CRM Queue] Batch rate limit reached for ${accountKey}`);
          messagesSkipped++;
          continue;
        }

        // Mark as processing
        await supabase
          .from('crm_message_queue')
          .update({
            status: 'processing',
            last_attempt_at: new Date().toISOString(),
            attempts: item.attempts + 1,
          })
          .eq('id', item.id);

        // Build outbound message
        const outboundMessage: OutboundMessage = {
          id: item.id,
          organizationId: item.organization_id,
          conversationId: item.conversation_id,
          contactId: item.contact_id,
          channel: item.channel,
          recipientExternalId: item.recipient_external_id,
          recipientDisplayName: item.recipient_display_name,
          content: item.content,
          contentType: item.content_type || 'text',
          attachments: item.attachments || [],
          emailSubject: item.email_subject,
          emailCc: item.email_cc,
          emailBcc: item.email_bcc,
          senderType: item.sender_type || 'user',
          senderUserId: item.sender_user_id,
          metadata: item.metadata || {},
        };

        // Send via channel router
        console.log(`[CRM Queue] Sending message ${item.id} to ${item.recipient_external_id} via ${item.channel}`);

        const result = await router.sendMessage(item.channel_account_id, outboundMessage);

        if (!result.success) {
          console.error(`[CRM Queue] Send failed:`, result.error);

          const newAttempts = item.attempts + 1;
          const maxAttempts = item.max_attempts || 3;

          if (newAttempts >= maxAttempts || !result.error?.retryable) {
            // Permanent failure
            await updateQueueStatus(supabase, item.id, 'failed', result.error?.message);
            await logActivity(supabase, item, 'message_failed', {
              error: result.error?.message,
              errorCode: result.error?.code,
              attempts: newAttempts,
            });

            // Notify webhook if configured
            await notifyWebhook(supabase, item.organization_id, 'message_failed', {
              queueItemId: item.id,
              contactId: item.contact_id,
              channel: item.channel,
              recipientId: item.recipient_external_id,
              error: result.error?.message,
              errorCode: result.error?.code,
              attempts: newAttempts,
              willRetry: false,
            });

            messagesFailed++;
          } else {
            // Schedule retry with exponential backoff
            const retryDelay = Math.pow(2, newAttempts) * 60 * 1000; // 2min, 4min, 8min
            const nextRetry = new Date(Date.now() + retryDelay).toISOString();

            await supabase
              .from('crm_message_queue')
              .update({
                status: 'pending',
                error_message: result.error?.message,
                error_code: result.error?.code,
                next_retry_at: nextRetry,
              })
              .eq('id', item.id);

            console.log(`[CRM Queue] Scheduled retry at ${nextRetry}`);
          }

          errors.push(`${item.id}: ${result.error?.message}`);
          continue;
        }

        // Success! Update existing message record or create new one if not exists
        const existingMessageId = item.metadata?.message_id;
        let messageRecord = null;

        if (existingMessageId) {
          // Update the existing message created by useSendMessage
          const { data, error: updateError } = await supabase
            .from('crm_messages')
            .update({
              status: 'sent',
              external_message_id: result.externalMessageId,
              metadata: {
                ...item.metadata,
                queueItemId: item.id,
                externalConversationId: result.externalConversationId,
              },
            })
            .eq('id', existingMessageId)
            .select()
            .single();

          if (updateError) {
            console.error(`[CRM Queue] Failed to update message record:`, updateError);
          } else {
            messageRecord = data;
          }
        } else {
          // Create new message record (for messages queued without pre-creation)
          const { data, error: messageError } = await supabase
            .from('crm_messages')
            .insert({
              organization_id: item.organization_id,
              conversation_id: item.conversation_id,
              contact_id: item.contact_id,
              direction: 'outbound',
              sender_type: item.sender_type || 'user',
              sender_user_id: item.sender_user_id,
              content: item.content,
              content_type: item.content_type || 'text',
              attachments: item.attachments || [],
              external_message_id: result.externalMessageId,
              email_subject: item.email_subject,
              email_cc: item.email_cc,
              email_bcc: item.email_bcc,
              status: 'sent',
              ai_generated: item.sender_type === 'ai',
              metadata: {
                ...item.metadata,
                queueItemId: item.id,
                externalConversationId: result.externalConversationId,
              },
            })
            .select()
            .single();

          if (messageError) {
            console.error(`[CRM Queue] Failed to create message record:`, messageError);
          } else {
            messageRecord = data;
          }
        }

        // Update queue item as sent
        await supabase
          .from('crm_message_queue')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            external_message_id: result.externalMessageId,
            message_id: messageRecord?.id,
            error_message: null,
            error_code: null,
          })
          .eq('id', item.id);

        // Log activity
        await logActivity(supabase, item, 'message_sent', {
          messageId: messageRecord?.id,
          externalMessageId: result.externalMessageId,
          channel: item.channel,
        });

        // Update rate limit tracking
        rateData.used++;

        // Record channel usage for limit tracking
        if (crmChannel) {
          await supabase.rpc('increment_channel_usage', {
            p_organization_id: item.organization_id,
            p_channel: crmChannel,
            p_channel_account_id: item.channel_account_id,
            p_status: 'sent',
          });
        }

        // Notify webhook
        await notifyWebhook(supabase, item.organization_id, 'message_sent', {
          messageId: messageRecord?.id,
          conversationId: item.conversation_id,
          contactId: item.contact_id,
          channel: item.channel,
          externalMessageId: result.externalMessageId,
          recipientId: item.recipient_external_id,
          recipientName: item.recipient_display_name,
          preview: item.content.substring(0, 100),
          senderType: item.sender_type,
        });

        messagesSent++;
        console.log(`[CRM Queue] Message ${item.id} sent successfully`);

      } catch (itemError) {
        console.error(`[CRM Queue] Error processing ${item.id}:`, itemError);
        errors.push(`${item.id}: ${itemError instanceof Error ? itemError.message : 'Unknown error'}`);

        await updateQueueStatus(
          supabase,
          item.id,
          'failed',
          itemError instanceof Error ? itemError.message : 'Unknown error'
        );
        messagesFailed++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[CRM Queue] Job ${jobId} completed in ${duration}ms: ${messagesSent} sent, ${messagesFailed} failed, ${messagesSkipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      duration,
      messagesSent,
      messagesFailed,
      messagesSkipped,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[CRM Queue] Fatal error:', error);

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
 * Update queue item status
 */
async function updateQueueStatus(
  supabase: SupabaseClient<any>,
  itemId: string,
  status: string,
  errorMessage?: string
) {
  await supabase
    .from('crm_message_queue')
    .update({
      status,
      error_message: errorMessage || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId);
}

/**
 * Log activity for a contact
 */
async function logActivity(
  supabase: SupabaseClient<any>,
  item: {
    organization_id: string;
    contact_id: string;
    sender_type?: string;
    sender_user_id?: string;
  },
  activityType: string,
  metadata: Record<string, unknown>
) {
  try {
    await supabase.from('crm_activities').insert({
      organization_id: item.organization_id,
      contact_id: item.contact_id,
      activity_type: activityType,
      title: activityType === 'message_sent' ? 'Message sent' : 'Message failed',
      metadata,
      performed_by_type: item.sender_type === 'ai' ? 'automation' : 'user',
      performed_by_user_id: item.sender_user_id,
    });
  } catch (error) {
    console.error('[CRM Queue] Failed to log activity:', error);
  }
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
    // Get organization's default webhook URL from settings
    // For now, we'll check if there's a webhook configured on active campaigns
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

    console.log(`[CRM Queue] Webhook sent: ${event}`);
  } catch (error) {
    console.error('[CRM Queue] Webhook failed:', error);
  }
}

/**
 * Map queue channel to CRM channel type for limit tracking
 */
function mapToCrmChannel(channel: string): string | null {
  const mapping: Record<string, string> = {
    // LinkedIn channels
    'linkedin': 'linkedin_message',
    'linkedin_dm': 'linkedin_message',
    'linkedin_message': 'linkedin_message',
    'linkedin_invitation': 'linkedin_invitation',
    'linkedin_connect': 'linkedin_invitation',
    'linkedin_comment': 'linkedin_comment',
    // Email
    'email': 'email',
    'gmail': 'email',
    'outlook': 'email',
    // Instagram
    'instagram': 'instagram_dm',
    'instagram_dm': 'instagram_dm',
    // Twitter
    'twitter': 'twitter_dm',
    'twitter_dm': 'twitter_dm',
    // SMS & WhatsApp
    'sms': 'sms',
    'whatsapp': 'whatsapp',
  };

  return mapping[channel.toLowerCase()] || null;
}
