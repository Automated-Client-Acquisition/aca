/**
 * Threaded reply sender (shared)
 *
 * One place that sends a reply INTO an existing CRM conversation, preserving the
 * conversation's mailbox and the email thread (Re: subject + In-Reply-To / References).
 * For email conversations with a mailbox it sends via SMTP; for every other channel it
 * routes through Unipile. It records the outbound crm_messages row and updates the
 * conversation, so the next reply (by anyone) threads correctly off it.
 *
 * Consolidates the logic that was duplicated in:
 *   - crm-send-message (user-initiated reply)
 *   - process-autopilot-queue (AI auto-reply)
 *   - mcp send_conversation_reply (external agent reply)
 */

import { createChannelRouter } from './channels/index.ts';
import type { OutboundMessage } from './channels/types.ts';
import { plainTextToHtml } from './email-tracking.ts';
import { flattenReplyParagraphs } from './email-paragraphs.ts';

export interface ThreadedReplyInput {
  organizationId: string;
  conversationId: string;
  content: string;
  contentType?: 'text' | 'html' | 'markdown';
  /** Email subject. Omit on follow-ups to let the thread subject stand. */
  subject?: string;
  senderType?: 'user' | 'ai' | 'automation' | 'system';
  senderUserId?: string;
  attachments?: Array<{ type: string; url: string; filename?: string }>;
  cc?: string[];
  bcc?: string[];
  /** Reuse an already-created crm_messages row instead of inserting one. */
  messageId?: string;
  /** Extra metadata recorded on the message (e.g. { source: 'mcp_external_agent' }). */
  metadata?: Record<string, unknown>;
}

export interface ThreadedReplyResult {
  success: boolean;
  messageId?: string;
  externalMessageId?: string;
  error?: string;
  errorCode?: string;
}

export async function sendThreadedReply(
  supabase: any,
  input: ThreadedReplyInput,
): Promise<ThreadedReplyResult> {
  // 1. Load + org-scope the conversation (the mailbox/thread anchor lives here)
  const { data: conv, error: convErr } = await supabase
    .from('crm_conversations')
    .select('id, organization_id, contact_id, channel, channel_account_id, external_participant_id, mailbox_id, provider, messaging_sender_id')
    .eq('id', input.conversationId)
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (convErr || !conv) {
    return { success: false, error: 'Conversation not found', errorCode: 'INVALID_CONVERSATION' };
  }

  const isSmtpEmail = conv.channel === 'email' && !!conv.mailbox_id;
  // Twilio threads keep their sender in messaging_sender_id; the router resolves it.
  const isTwilio = conv.provider === 'twilio';
  if (!isSmtpEmail && !conv.channel_account_id && !(isTwilio && conv.messaging_sender_id)) {
    return { success: false, error: 'Conversation has no sending account', errorCode: 'ACCOUNT_DISCONNECTED' };
  }
  if (!conv.external_participant_id) {
    return { success: false, error: 'Conversation has no recipient', errorCode: 'INVALID_RECIPIENT' };
  }

  const senderType = input.senderType || 'automation';
  let contentType = input.contentType || 'text';

  // Append the sending mailbox's signature to email replies, same as a professional
  // sender's own client would. Other channels (LinkedIn, WhatsApp, etc.) skip this.
  // Signatures are authored as rich HTML (avatar, styling, links) — stripping that
  // down to plain text for a text-mode reply produced an ugly, unstyled blob (e.g.
  // a mailto link rendering as "name@x.com (mailto:name@x.com)"). Upgrade the reply
  // to HTML instead so the signature always renders as designed.
  let content = input.content;
  if (contentType === 'html') {
    content = flattenReplyParagraphs(content);
  }
  if (isSmtpEmail) {
    const { data: mailbox } = await supabase
      .from('email_mailboxes')
      .select('metadata')
      .eq('id', conv.mailbox_id)
      .maybeSingle();
    const signature = (mailbox?.metadata as any)?.signature as string | undefined;
    if (signature) {
      if (contentType !== 'html') {
        content = plainTextToHtml(content);
        contentType = 'html';
      }
      content = `${content}<br><br>${signature}`;
    }
  }

  // 2. Create (or reuse) the outbound message row
  let messageId = input.messageId;
  if (!messageId) {
    const { data: msg, error: msgErr } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: input.organizationId,
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        direction: 'outbound',
        sender_type: senderType,
        sender_user_id: input.senderUserId || null,
        content,
        content_type: contentType,
        attachments: input.attachments || [],
        email_subject: input.subject || null,
        email_cc: input.cc || null,
        email_bcc: input.bcc || null,
        status: 'sending',
        metadata: input.metadata || {},
      })
      .select('id')
      .single();
    if (msgErr || !msg) {
      return { success: false, error: 'Failed to create message record' };
    }
    messageId = msg.id;
  } else {
    await supabase.from('crm_messages').update({ status: 'sending' }).eq('id', messageId);
  }

  // 3. Email threading: reply onto the latest OTHER message in the thread (any direction)
  //    that has a Message-ID, so a chain of replies keeps threading. Replies sent through
  //    Microsoft Graph store none (Graph doesn't return it), so the very latest message is
  //    often our own reply without one; walking back to the newest message with an ID
  //    keeps In-Reply-To/References instead of sending an unthreaded email.
  let inReplyTo: string | undefined;
  let emailReferences: string[] | undefined;
  let subject = input.subject;
  if (isSmtpEmail) {
    const { data: recent } = await supabase
      .from('crm_messages')
      .select('metadata, external_message_id, email_subject')
      .eq('conversation_id', conv.id)
      .neq('id', messageId)
      .order('created_at', { ascending: false })
      .limit(25);

    for (const m of (recent || []) as Array<Record<string, any>>) {
      const meta = (m.metadata || {}) as Record<string, any>;
      // Outbound stores the Message-ID in metadata.email_message_id; inbound in external_message_id.
      const id = meta.email_message_id || m.external_message_id;
      if (id) {
        inReplyTo = id;
        emailReferences = [...((meta.email_references as string[]) || []), id];
        break;
      }
    }

    // Keep the thread's subject. Without one the adapter sends "Re: (no subject)", which
    // reads as a new conversation and breaks threading in Gmail and Outlook.
    if (!subject) {
      // Skip "(no subject)" left by earlier replies that hit this bug, so the original
      // subject comes back.
      const threadSubject = ((recent || []) as Array<Record<string, any>>)
        .map((m) => (m.email_subject || '').trim())
        .find((s) => s && !/\(no subject\)/i.test(s));
      if (threadSubject) subject = /^\s*re\s*:/i.test(threadSubject) ? threadSubject : `Re: ${threadSubject}`;
    }
  }

  // 4. Send via the channel router (SMTP for email-with-mailbox, Unipile otherwise)
  const outbound: OutboundMessage = {
    id: messageId!,
    organizationId: input.organizationId,
    conversationId: conv.id,
    contactId: conv.contact_id,
    channel: conv.channel as any,
    recipientExternalId: conv.external_participant_id,
    content,
    contentType,
    attachments: (input.attachments as any) || [],
    emailSubject: subject,
    emailCc: input.cc,
    emailBcc: input.bcc,
    senderType,
    senderUserId: input.senderUserId,
    metadata: {
      ...(input.metadata || {}),
      ...(isSmtpEmail && {
        mailboxId: conv.mailbox_id,
        inReplyTo,
        references: emailReferences,
      }),
    },
  };

  const router = createChannelRouter();
  const result = isSmtpEmail
    ? await router.sendViaSMTP(outbound)
    : await router.sendMessage(conv.channel_account_id!, outbound);

  // 5. Persist the outcome on the message
  if (!result.success) {
    await supabase
      .from('crm_messages')
      .update({
        status: 'failed',
        error_message: result.error?.message,
        status_updated_at: new Date().toISOString(),
      })
      .eq('id', messageId);
    return {
      success: false,
      messageId,
      error: result.error?.message || 'Failed to send message',
      errorCode: result.error?.code,
    };
  }

  await supabase
    .from('crm_messages')
    .update({
      status: 'sent',
      external_message_id: result.externalMessageId,
      email_subject: subject || null,
      status_updated_at: new Date().toISOString(),
      metadata: {
        ...(input.metadata || {}),
        externalConversationId: result.externalConversationId,
        ...(isSmtpEmail && {
          email_message_id: result.externalMessageId,
          email_in_reply_to: inReplyTo || null,
          email_references: emailReferences || null,
        }),
      },
    })
    .eq('id', messageId);

  // 6. Bump the conversation's last-message + counters (same RPC crm-send-message uses)
  await supabase.rpc('update_conversation_on_message', {
    p_conversation_id: conv.id,
    p_organization_id: input.organizationId,
    p_last_message_preview: (input.content || '').substring(0, 100) || '[Attachment]',
    p_direction: 'outbound',
  });

  return { success: true, messageId, externalMessageId: result.externalMessageId };
}
