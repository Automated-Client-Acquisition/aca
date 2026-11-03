import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createChannelRouter } from '../_shared/channels/index.ts';
import type { OutboundMessage } from '../_shared/channels/types.ts';
import { plainTextToHtml } from '../_shared/email-tracking.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Process Autopilot Queue — Auto-Send Processor
 *
 * Runs via pg_cron every 2 minutes. Processes queue items that have
 * metadata.auto_send = true and are still pending.
 *
 * For each item:
 * 1. Optionally runs ICP filter (if org has ICP configured and contact has profile data)
 * 2. Creates crm_messages record
 * 3. Calls crm-send-message to actually deliver via SMTP/Unipile
 * 4. Updates queue item and conversation state
 */
Deno.serve(async (req) => {
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
    // Fetch pending items marked for auto-send
    const { data: items, error: fetchError } = await supabase
      .from('inbox_autopilot_queue')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(20);

    if (fetchError) {
      throw new Error(`Failed to fetch queue items: ${fetchError.message}`);
    }

    // Filter to auto_send items only
    const autoSendItems = (items || []).filter(
      (item: any) => item.metadata?.auto_send === true
    );

    if (autoSendItems.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[AutoSend] Processing ${autoSendItems.length} auto-send items`);

    let processed = 0;
    let failed = 0;

    for (const item of autoSendItems) {
      try {
        // 1. Get conversation details
        const { data: conversation, error: convError } = await supabase
          .from('crm_conversations')
          .select('id, channel, mailbox_id, external_participant_id, channel_account_id, organization_id')
          .eq('id', item.conversation_id)
          .single();

        if (convError || !conversation) {
          console.error(`[AutoSend] Conversation not found for item ${item.id}`);
          await markFailed(supabase, item.id, item.metadata, 'Conversation not found');
          failed++;
          continue;
        }

        // Append the sending mailbox's signature to email replies, matching the same
        // behavior as manual inbox replies (sendThreadedReply). Other channels skip this.
        // Signatures are authored as rich HTML (avatar, styling, links); a plain-text
        // draft is upgraded to HTML so the signature renders as designed instead of
        // being crushed into an unstyled text blob.
        const mailboxId = conversation.mailbox_id || item.metadata?.mailbox_id || null;
        const isSmtpEmail = conversation.channel === 'email' && !!mailboxId;
        let draftContent = item.draft_message;
        let draftContentType: 'text' | 'html' = 'text';
        if (isSmtpEmail) {
          const { data: mailbox } = await supabase
            .from('email_mailboxes')
            .select('metadata')
            .eq('id', mailboxId)
            .maybeSingle();
          const signature = (mailbox?.metadata as any)?.signature as string | undefined;
          if (signature) {
            draftContent = `${plainTextToHtml(draftContent)}<br><br>${signature}`;
            draftContentType = 'html';
          }
        }

        // 2. Optional ICP filter — check if org has an active ICP and contact scores too low
        const icpResult = await checkIcpFilter(supabase, item.organization_id, item.contact_id);
        if (icpResult === 'skip') {
          console.log(`[AutoSend] ICP filter skipped item ${item.id} for contact ${item.contact_id}`);
          await supabase
            .from('inbox_autopilot_queue')
            .update({
              status: 'rejected',
              metadata: { ...item.metadata, rejected_reason: 'icp_filter_below_threshold' },
            })
            .eq('id', item.id);
          continue;
        }

        // 3. Create outbound message record
        const { data: message, error: msgError } = await supabase
          .from('crm_messages')
          .insert({
            organization_id: item.organization_id,
            conversation_id: item.conversation_id,
            contact_id: item.contact_id,
            direction: 'outbound',
            sender_type: 'ai',
            content: draftContent,
            content_type: draftContentType,
            email_subject: item.draft_subject || null,
            ai_generated: true,
            status: 'queued',
            metadata: {
              autopilot_queue_id: item.id,
              trigger_intent: item.trigger_intent,
              auto_sent: true,
            },
          })
          .select()
          .single();

        if (msgError) {
          console.error(`[AutoSend] Failed to create message for item ${item.id}:`, msgError);
          await markFailed(supabase, item.id, item.metadata, `Message create: ${msgError.message}`);
          failed++;
          continue;
        }

        // 4. Update queue item status
        await supabase
          .from('inbox_autopilot_queue')
          .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            metadata: {
              ...item.metadata,
              message_id: message.id,
              auto_processed: true,
            },
          })
          .eq('id', item.id);

        // 5. Update conversation state
        await supabase
          .from('crm_conversations')
          .update({
            last_message_at: new Date().toISOString(),
            last_message_preview: item.draft_message.substring(0, 100),
            last_message_direction: 'outbound',
            updated_at: new Date().toISOString(),
          })
          .eq('id', item.conversation_id);

        // 6. Send directly via channel router (crm-send-message requires user auth, not available here)
        if (conversation.channel_account_id || mailboxId) {
          try {
            await supabase.from('crm_messages').update({ status: 'sending' }).eq('id', message.id);

            // Build threading headers for SMTP email replies
            let inReplyTo: string | undefined;
            let emailReferences: string[] | undefined;

            if (isSmtpEmail) {
              const { data: lastInbound } = await supabase
                .from('crm_messages')
                .select('metadata, external_message_id')
                .eq('conversation_id', item.conversation_id)
                .eq('direction', 'inbound')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (lastInbound) {
                const meta = (lastInbound.metadata || {}) as Record<string, any>;
                inReplyTo = lastInbound.external_message_id || meta.email_message_id;
                if (inReplyTo) {
                  emailReferences = [...(meta.email_references || []), inReplyTo];
                }
              }
            }

            const outboundMessage: OutboundMessage = {
              id: message.id,
              organizationId: item.organization_id,
              conversationId: item.conversation_id,
              contactId: item.contact_id,
              channel: conversation.channel as any,
              recipientExternalId: conversation.external_participant_id,
              content: draftContent,
              contentType: draftContentType,
              emailSubject: item.draft_subject || undefined,
              senderType: 'ai',
              metadata: {
                ...(isSmtpEmail && {
                  mailboxId,
                  inReplyTo,
                  references: emailReferences,
                }),
              },
            };

            const router = createChannelRouter();
            const sendResult = isSmtpEmail
              ? await router.sendViaSMTP(outboundMessage)
              : await router.sendMessage(conversation.channel_account_id!, outboundMessage);

            if (!sendResult.success) {
              console.error(`[AutoSend] Send failed for item ${item.id}:`, sendResult.error);
              await supabase.from('crm_messages').update({
                status: 'failed',
                error_message: sendResult.error?.message,
                status_updated_at: new Date().toISOString(),
              }).eq('id', message.id);
            } else {
              await supabase.from('crm_messages').update({
                status: 'sent',
                external_message_id: sendResult.externalMessageId,
                status_updated_at: new Date().toISOString(),
                metadata: {
                  autopilot_queue_id: item.id,
                  trigger_intent: item.trigger_intent,
                  auto_sent: true,
                  ...(isSmtpEmail && {
                    email_message_id: sendResult.externalMessageId,
                    email_in_reply_to: inReplyTo || null,
                    email_references: emailReferences || null,
                  }),
                },
              }).eq('id', message.id);
              console.log(`[AutoSend] Message sent for item ${item.id}`);
            }
          } catch (sendError) {
            console.error(`[AutoSend] Failed to send for item ${item.id}:`, sendError);
            await supabase.from('crm_messages').update({
              status: 'failed',
              error_message: sendError instanceof Error ? sendError.message : 'Unknown send error',
              status_updated_at: new Date().toISOString(),
            }).eq('id', message.id);
          }
        } else {
          console.warn(`[AutoSend] No channel_account_id or mailbox_id for conversation ${item.conversation_id}, message created but not sent`);
        }

        processed++;
      } catch (itemError) {
        console.error(`[AutoSend] Error processing item ${item.id}:`, itemError);
        await markFailed(supabase, item.id, item.metadata,
          itemError instanceof Error ? itemError.message : 'Unknown error');
        failed++;
      }
    }

    console.log(`[AutoSend] Done: ${processed} processed, ${failed} failed`);

    return new Response(JSON.stringify({ processed, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[AutoSend] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Mark a queue item as failed with error details.
 */
async function markFailed(
  supabase: SupabaseClient<any>,
  itemId: string,
  existingMetadata: Record<string, unknown>,
  error: string,
): Promise<void> {
  await supabase
    .from('inbox_autopilot_queue')
    .update({
      status: 'rejected',
      metadata: {
        ...existingMetadata,
        auto_send_error: error,
        auto_send_failed_at: new Date().toISOString(),
      },
    })
    .eq('id', itemId);
}

/**
 * Optional ICP filter — if the org has a default ICP and the contact has
 * a lead_score, skip contacts below a threshold.
 *
 * Returns 'send' (proceed) or 'skip' (filter out).
 * If no ICP or no lead_score, always returns 'send'.
 */
async function checkIcpFilter(
  supabase: SupabaseClient<any>,
  organizationId: string,
  contactId: string,
): Promise<'send' | 'skip'> {
  try {
    // Check if org has a default ICP with a min threshold set
    const { data: icps } = await supabase
      .from('icps')
      .select('id, icp_threshold')
      .eq('organization_id', organizationId)
      .eq('is_default', true)
      .limit(1);

    const defaultIcp = icps?.[0];
    if (!defaultIcp || !defaultIcp.icp_threshold) return 'send';

    // Check contact's lead score
    const { data: contact } = await supabase
      .from('crm_contacts')
      .select('lead_score')
      .eq('id', contactId)
      .single();

    if (!contact?.lead_score) return 'send'; // No score = proceed

    if (contact.lead_score < defaultIcp.icp_threshold) {
      console.log(
        `[AutoSend ICP] Contact ${contactId} score ${contact.lead_score} below threshold ${defaultIcp.icp_threshold}`,
      );
      return 'skip';
    }

    return 'send';
  } catch {
    return 'send'; // On error, default to sending
  }
}
