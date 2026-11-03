import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { createChannelRouter } from '../_shared/channels/index.ts';
import type { OutboundMessage } from '../_shared/channels/types.ts';
import { plainTextToHtml } from '../_shared/email-tracking.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AutopilotActionRequest {
  queueItemId: string;
  action: 'approve' | 'reject';
  editedMessage?: string;
}

/**
 * Inbox Autopilot Action Edge Function
 *
 * Handles approval or rejection of AI-drafted autopilot queue items.
 * On approval: creates a crm_messages record and updates conversation state.
 * On rejection: marks the queue item as rejected.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Authenticate user from Bearer token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's organization
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('organization_id, active_organization_id')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const organizationId = userData.active_organization_id || userData.organization_id;

    // Parse request body
    const body: AutopilotActionRequest = await req.json();

    if (!body.queueItemId || !body.action) {
      return new Response(JSON.stringify({
        error: 'Missing required fields',
        required: ['queueItemId', 'action'],
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.action !== 'approve' && body.action !== 'reject') {
      return new Response(JSON.stringify({ error: 'action must be "approve" or "reject"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the queue item (scoped to organization for security)
    const { data: queueItem, error: queueError } = await supabase
      .from('inbox_autopilot_queue')
      .select('*')
      .eq('id', body.queueItemId)
      .eq('organization_id', organizationId)
      .single();

    if (queueError || !queueItem) {
      return new Response(JSON.stringify({ error: 'Queue item not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (queueItem.status !== 'pending') {
      return new Response(JSON.stringify({
        error: `Queue item already ${queueItem.status}`,
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle rejection — atomic update with status guard to prevent race conditions
    if (body.action === 'reject') {
      const { data: rejectedItem, error: rejectError } = await supabase
        .from('inbox_autopilot_queue')
        .update({
          status: 'rejected',
          approved_by: user.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', body.queueItemId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (rejectError) {
        throw new Error(`Failed to reject queue item: ${rejectError.message}`);
      }

      if (!rejectedItem) {
        return new Response(JSON.stringify({ error: 'Queue item was already processed' }), {
          status: 409,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log(`[Autopilot Action] Rejected queue item ${body.queueItemId}`);

      return new Response(JSON.stringify({ success: true, action: 'rejected' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle approval
    // 1. Get the conversation details (for channel, mailbox_id, external_participant_id)
    const { data: conversation, error: convError } = await supabase
      .from('crm_conversations')
      .select('id, channel, mailbox_id, external_participant_id, channel_account_id')
      .eq('id', queueItem.conversation_id)
      .eq('organization_id', organizationId)
      .single();

    if (convError || !conversation) {
      throw new Error('Conversation not found for queue item');
    }

    // 2. Build message content (use edited message if provided)
    const messageContent = body.editedMessage || queueItem.draft_message;

    // 2b. Derive email subject for threading (fallback if draft_subject is null)
    const isSmtpEmail = conversation.channel === 'email' && !!conversation.mailbox_id;
    let emailSubject = queueItem.draft_subject || undefined;
    if (!emailSubject && isSmtpEmail) {
      const { data: subjectMsg } = await supabase
        .from('crm_messages')
        .select('email_subject')
        .eq('conversation_id', queueItem.conversation_id)
        .not('email_subject', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subjectMsg?.email_subject) {
        const subj = subjectMsg.email_subject;
        emailSubject = /^re:\s/i.test(subj) ? subj : `Re: ${subj}`;
      }
    }

    // 2c. Append the sending mailbox's signature, matching manual inbox replies
    // (sendThreadedReply) and full-auto sends (process-autopilot-queue). Signatures
    // are authored as rich HTML (avatar, styling, links); the plain-text draft is
    // upgraded to HTML so the signature renders as designed instead of being
    // crushed into an unstyled text blob.
    let sendContent = messageContent;
    let sendContentType: 'text' | 'html' = 'text';
    if (isSmtpEmail) {
      const { data: mailbox } = await supabase
        .from('email_mailboxes')
        .select('metadata')
        .eq('id', conversation.mailbox_id)
        .maybeSingle();
      const signature = (mailbox?.metadata as any)?.signature as string | undefined;
      if (signature) {
        sendContent = `${plainTextToHtml(sendContent)}<br><br>${signature}`;
        sendContentType = 'html';
      }
    }

    // 3. Create the outbound message record in crm_messages
    const { data: message, error: msgError } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: organizationId,
        conversation_id: queueItem.conversation_id,
        contact_id: queueItem.contact_id,
        direction: 'outbound',
        sender_type: 'ai',
        sender_user_id: user.id,
        content: sendContent,
        content_type: sendContentType,
        email_subject: emailSubject || null,
        ai_generated: true,
        status: 'queued',
        metadata: {
          autopilot_queue_id: body.queueItemId,
          trigger_intent: queueItem.trigger_intent,
          approved_by: user.id,
          edited: !!body.editedMessage,
        },
      })
      .select()
      .single();

    if (msgError) {
      throw new Error(`Failed to create message: ${msgError.message}`);
    }

    // 4. Update the queue item as approved (atomic guard prevents double-approval race)
    const { data: approvedItem, error: approveError } = await supabase
      .from('inbox_autopilot_queue')
      .update({
        status: 'approved',
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        metadata: {
          ...(queueItem.metadata || {}),
          message_id: message.id,
          edited_message: body.editedMessage || null,
        },
      })
      .eq('id', body.queueItemId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (approveError) {
      throw new Error(`Failed to mark queue item as approved: ${approveError.message}`);
    }

    if (!approvedItem) {
      // Another user already approved/rejected this item — clean up orphaned message
      await supabase.from('crm_messages').delete().eq('id', message.id);
      return new Response(JSON.stringify({
        error: 'Queue item was already processed by another user',
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 5. Send directly via channel router (bypasses crm-send-message auth requirement)
    // Conversation metadata update happens AFTER successful send to avoid stale state on race
    if (conversation.channel_account_id || conversation.mailbox_id) {
      try {
        // Update status to 'sending'
        await supabase
          .from('crm_messages')
          .update({ status: 'sending' })
          .eq('id', message.id);

        // Build threading headers for SMTP email replies
        let inReplyTo: string | undefined;
        let emailReferences: string[] | undefined;

        if (isSmtpEmail) {
          const { data: lastInbound } = await supabase
            .from('crm_messages')
            .select('metadata, external_message_id')
            .eq('conversation_id', queueItem.conversation_id)
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

        // Build outbound message
        const outboundMessage: OutboundMessage = {
          id: message.id,
          organizationId,
          conversationId: queueItem.conversation_id,
          contactId: queueItem.contact_id,
          channel: conversation.channel as any,
          recipientExternalId: conversation.external_participant_id,
          content: sendContent,
          contentType: sendContentType,
          emailSubject: emailSubject,
          senderType: 'ai',
          senderUserId: user.id,
          metadata: {
            ...(isSmtpEmail && {
              mailboxId: conversation.mailbox_id,
              inReplyTo,
              references: emailReferences,
            }),
          },
        };

        // Send via appropriate path
        const router = createChannelRouter();
        const sendResult = isSmtpEmail
          ? await router.sendViaSMTP(outboundMessage)
          : await router.sendMessage(conversation.channel_account_id!, outboundMessage);

        if (!sendResult.success) {
          console.error('[Autopilot Action] Send failed:', sendResult.error);
          await supabase
            .from('crm_messages')
            .update({
              status: 'failed',
              error_message: sendResult.error?.message,
              status_updated_at: new Date().toISOString(),
            })
            .eq('id', message.id);
        } else {
          // Update message status to sent
          await supabase
            .from('crm_messages')
            .update({
              status: 'sent',
              external_message_id: sendResult.externalMessageId,
              status_updated_at: new Date().toISOString(),
              metadata: {
                autopilot_queue_id: body.queueItemId,
                trigger_intent: queueItem.trigger_intent,
                approved_by: user.id,
                edited: !!body.editedMessage,
                ...(isSmtpEmail && {
                  email_message_id: sendResult.externalMessageId,
                  email_in_reply_to: inReplyTo || null,
                  email_references: emailReferences || null,
                }),
              },
            })
            .eq('id', message.id);

          // Update conversation metadata only after successful send
          await supabase
            .from('crm_conversations')
            .update({
              last_message_at: new Date().toISOString(),
              last_message_preview: messageContent.substring(0, 100),
              last_message_direction: 'outbound',
              updated_at: new Date().toISOString(),
            })
            .eq('id', queueItem.conversation_id)
            .eq('organization_id', organizationId);

          console.log(`[Autopilot Action] Message sent successfully`);
        }
      } catch (sendError) {
        console.error('[Autopilot Action] Failed to send message:', sendError);
        await supabase
          .from('crm_messages')
          .update({
            status: 'failed',
            error_message: sendError instanceof Error ? sendError.message : 'Unknown send error',
            status_updated_at: new Date().toISOString(),
          })
          .eq('id', message.id);
      }
    }

    console.log(`[Autopilot Action] Approved queue item ${body.queueItemId}, message ${message.id}`);

    return new Response(JSON.stringify({
      success: true,
      action: 'approved',
      messageId: message.id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Autopilot Action] Error:', error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
