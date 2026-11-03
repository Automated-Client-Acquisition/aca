/**
 * Unipile Channel Adapter (SDK-based)
 *
 * Implements the ChannelAdapter interface for Unipile using the official SDK.
 * Supports all Unipile messaging channels:
 * - LinkedIn (messages, connection requests, InMail)
 * - Instagram (DMs)
 * - Email (Gmail, Outlook, IMAP)
 * - WhatsApp (messages)
 * - Telegram (messages)
 *
 * @see https://developer.unipile.com/docs/nodejs-sdk
 */

import { UnipileClient } from 'npm:unipile-node-sdk@^1.4';
import type {
  ChannelAdapter,
  ChannelAccount,
  ChannelType,
  ChannelProvider,
  OutboundMessage,
  InboundMessage,
  SendResult,
} from './types.ts';
import { parseUnipileError, normalizeDsnUrl } from '../unipile-client.ts';
import { resolveAttachmentBinaries, appendAttachmentsToFormData } from '../attachment-utils.ts';
import { sanitizeMessageContent } from '../sanitize-message-content.ts';
import { UnipileV2Client } from '../unipile/v2-client.ts';
import { sendLinkedInMessage } from '../unipile/linkedin-v2.ts';
import { sendDirectMessage, sendEmail as sendV2Email, whatsAppUserId } from '../unipile/messaging-v2.ts';

// ============================================================================
// Unipile Adapter
// ============================================================================

export class UnipileAdapter implements ChannelAdapter {
  readonly channelType: ChannelType;
  readonly provider: ChannelProvider = 'unipile';

  constructor(channelType: ChannelType) {
    this.channelType = channelType;
  }

  /**
   * Create a Unipile SDK client from account credentials
   */
  private createClient(account: ChannelAccount): UnipileClient {
    const dsnUrl = normalizeDsnUrl(account.credentials.dsnUrl);
    const apiKey = account.credentials.accessToken;

    if (!apiKey) {
      throw new Error('No API key available');
    }

    return new UnipileClient(dsnUrl, apiKey);
  }

  /**
   * Unipile v2 account. Text messages on LinkedIn, WhatsApp, Telegram and Instagram, and email.
   */
  private async sendMessageV2(account: ChannelAccount, message: OutboundMessage): Promise<SendResult> {
    if (!['linkedin', 'whatsapp', 'telegram', 'instagram', 'email'].includes(this.channelType)) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `${this.channelType} is not supported on Unipile v2 accounts yet`, retryable: false },
      };
    }
    if (message.attachments && message.attachments.length > 0) {
      return {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Attachments are not supported on Unipile v2 accounts yet', retryable: false },
      };
    }

    const client = new UnipileV2Client({ apiKey: account.credentials.accessToken! });
    const chatId = message.metadata?.externalConversationId as string | undefined;
    let result;
    if (this.channelType === 'linkedin') {
      result = await sendLinkedInMessage(client, account.accountId, message.recipientExternalId, message.content, { chatId });
    } else if (this.channelType === 'email') {
      result = await sendV2Email(client, account.accountId, message.recipientExternalId, message.emailSubject || 'No Subject', message.content, {
        html: message.contentType === 'html',
        cc: message.emailCc,
        bcc: message.emailBcc,
      });
    } else {
      const recipient = this.channelType === 'whatsapp'
        ? whatsAppUserId(message.recipientExternalId)
        : message.recipientExternalId;
      result = await sendDirectMessage(client, account.accountId, recipient, message.content, { chatId });
    }
    if (!result.success) {
      const text = result.error ?? 'Send failed';
      return {
        success: false,
        error: {
          code: /disconnected_account/.test(text) ? 'AUTHENTICATION_FAILED'
            : /temporary provider limit/.test(text) ? 'RATE_LIMITED'
            : 'PROVIDER_ERROR',
          message: text,
          retryable: /temporary provider limit|^5\d\d|^network/.test(text),
        },
      };
    }
    return {
      success: true,
      externalMessageId: result.messageId,
      externalConversationId: result.externalId,
    };
  }

  /**
   * Send a message via Unipile
   */
  async sendMessage(
    account: ChannelAccount,
    message: OutboundMessage
  ): Promise<SendResult> {
    if (!account.credentials.accessToken) {
      return {
        success: false,
        error: {
          code: 'AUTHENTICATION_FAILED',
          message: 'No API key available',
          retryable: false,
        },
      };
    }

    if (account.credentials.apiVersion === 'v2') {
      return this.sendMessageV2(account, message);
    }

    try {
      const hasAttachments = message.attachments && message.attachments.length > 0;
      const client = this.createClient(account);

      if (this.channelType === 'email') {
        if (hasAttachments) {
          return await this.sendEmailWithAttachments(account, message);
        }
        // Email sending via Unipile SDK
        const result = await client.request.send({
          path: '/api/v1/emails',
          method: 'POST',
          body: {
            account_id: account.accountId,
            to: [message.recipientExternalId],
            subject: message.emailSubject || 'No Subject',
            text: message.content,
            html: message.contentType === 'html' ? message.content : undefined,
            cc: message.emailCc,
            bcc: message.emailBcc,
          },
        });

        console.log(`[Unipile:${this.channelType}] Email sent:`, result);
        return {
          success: true,
          externalMessageId: result.id || result.email_id,
          externalConversationId: result.thread_id,
          metadata: result,
        };
      }

      // Chat-based channels: LinkedIn, Instagram, WhatsApp, Telegram, etc.
      // When attachments are present, use raw HTTP with FormData
      if (hasAttachments) {
        return await this.sendChatWithAttachments(account, message);
      }

      // Text-only: use Unipile SDK
      const externalConversationId = message.metadata?.externalConversationId as string | undefined;

      let result: Record<string, unknown>;
      const startNewChat = () => client.messaging.startNewChat({
        account_id: account.accountId,
        attendees_ids: [message.recipientExternalId],
        text: message.content,
      });

      if (externalConversationId) {
        try {
          result = await client.messaging.sendMessage({
            chat_id: externalConversationId,
            text: message.content,
          });
        } catch (error) {
          // A stale chat id (chat gone or re-synced): fall back to the 1:1 chat.
          if (parseUnipileError(error).code !== 'NOT_FOUND' || !message.recipientExternalId) throw error;
          console.warn(`[Unipile:${this.channelType}] Chat ${externalConversationId} not found, starting a new chat`);
          result = await startNewChat();
        }
      } else {
        result = await startNewChat();
      }

      console.log(`[Unipile:${this.channelType}] Message sent:`, result);

      return {
        success: true,
        externalMessageId: (result.id || result.message_id) as string | undefined,
        externalConversationId: (result.chat_id || result.id) as string | undefined,
        metadata: result,
      };
    } catch (error) {
      console.error(`[Unipile:${this.channelType}] Send failed:`, error);
      const parsedError = parseUnipileError(error);

      return {
        success: false,
        error: {
          code: parsedError.code,
          message: parsedError.message,
          retryable: parsedError.retryable,
        },
      };
    }
  }

  /**
   * Send a chat message with file/voice/video attachments via raw HTTP + FormData.
   * The SDK's sendMessage/startNewChat only accept text, so we use the REST API directly.
   */
  private async sendChatWithAttachments(
    account: ChannelAccount,
    message: OutboundMessage
  ): Promise<SendResult> {
    const dsnUrl = normalizeDsnUrl(account.credentials.dsnUrl);
    const apiKey = account.credentials.accessToken!;
    const externalConversationId = message.metadata?.externalConversationId as string | undefined;

    const resolved = await resolveAttachmentBinaries(message.attachments!);
    if (resolved.length === 0 && !message.content) {
      return { success: false, error: { code: 'VALIDATION_ERROR', message: 'No content or valid attachments', retryable: false } };
    }

    const formData = new FormData();

    let url: string;
    if (externalConversationId) {
      // Reply to existing chat
      url = `${dsnUrl}/api/v1/chats/${encodeURIComponent(externalConversationId)}/messages`;
    } else {
      // Start new chat
      url = `${dsnUrl}/api/v1/chats`;
      formData.append('account_id', account.accountId);
      formData.append('attendees_ids', JSON.stringify([message.recipientExternalId]));
    }

    if (message.content) {
      formData.append('text', message.content);
    }

    appendAttachmentsToFormData(formData, resolved, this.channelType);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      body: formData,
    });

    if (response.status === 404 && externalConversationId && message.recipientExternalId) {
      // A stale chat id (chat gone or re-synced): fall back to the 1:1 chat.
      console.warn(`[Unipile:${this.channelType}] Chat ${externalConversationId} not found, starting a new chat`);
      return this.sendChatWithAttachments(account, {
        ...message,
        metadata: { ...(message.metadata || {}), externalConversationId: undefined },
      });
    }

    const result = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      console.error(`[Unipile:${this.channelType}] Attachment send failed:`, result);
      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: (result.message || result.error || `HTTP ${response.status}`) as string,
          retryable: response.status >= 500,
        },
      };
    }

    console.log(`[Unipile:${this.channelType}] Message with attachments sent:`, result);
    return {
      success: true,
      externalMessageId: (result.id || result.message_id) as string | undefined,
      externalConversationId: (result.chat_id || result.id) as string | undefined,
      metadata: result,
    };
  }

  /**
   * Send email with file attachments via raw HTTP + FormData.
   */
  private async sendEmailWithAttachments(
    account: ChannelAccount,
    message: OutboundMessage
  ): Promise<SendResult> {
    const dsnUrl = normalizeDsnUrl(account.credentials.dsnUrl);
    const apiKey = account.credentials.accessToken!;

    const resolved = await resolveAttachmentBinaries(message.attachments!);

    const formData = new FormData();
    formData.append('account_id', account.accountId);
    formData.append('to', JSON.stringify([{ identifier: message.recipientExternalId }]));
    formData.append('subject', message.emailSubject || 'No Subject');
    formData.append('body', message.content || '');
    if (message.emailCc?.length) formData.append('cc', JSON.stringify(message.emailCc.map(e => ({ identifier: e }))));
    if (message.emailBcc?.length) formData.append('bcc', JSON.stringify(message.emailBcc.map(e => ({ identifier: e }))));

    for (const att of resolved) {
      const file = new File([att.blob], att.filename, { type: att.mimeType });
      formData.append('attachments', file);
    }

    const response = await fetch(`${dsnUrl}/api/v1/emails`, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Accept': 'application/json' },
      body: formData,
    });

    const result = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      console.error(`[Unipile:email] Email attachment send failed:`, result);
      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: (result.message || result.error || `HTTP ${response.status}`) as string,
          retryable: response.status >= 500,
        },
      };
    }

    console.log(`[Unipile:email] Email with attachments sent:`, result);
    return {
      success: true,
      externalMessageId: (result.id || result.email_id) as string | undefined,
      externalConversationId: (result.thread_id) as string | undefined,
      metadata: result,
    };
  }

  /**
   * Poll for new inbound messages
   */
  async pollInbound(
    account: ChannelAccount,
    since?: string
  ): Promise<InboundMessage[]> {
    if (!account.credentials.accessToken) {
      throw new Error('No API key available');
    }

    try {
      const client = this.createClient(account);
      const messages: InboundMessage[] = [];

      if (this.channelType === 'email') {
        // Email polling - use raw request as SDK may not have this
        const result = await client.request.send({
          path: '/api/v1/emails',
          method: 'GET',
          query: {
            account_id: account.accountId,
            ...(since && { since }),
          },
        }) as { items?: unknown[] };

        for (const email of result.items || []) {
          const e = email as Record<string, unknown>;
          if (e.direction === 'incoming' || e.folder === 'inbox') {
            const from = e.from as { email?: string; name?: string } | string;
            const to = e.to as Array<{ email: string }> | string[];

            messages.push({
              externalMessageId: e.id as string,
              externalConversationId: e.thread_id as string | undefined,
              senderExternalId: typeof from === 'object' ? from.email || '' : from || '',
              senderDisplayName: typeof from === 'object' ? from.name : undefined,
              content: (e.text || e.html || '') as string,
              contentType: e.html ? 'html' : 'text',
              emailSubject: e.subject as string | undefined,
              emailFrom: typeof from === 'object' ? from.email : from,
              emailTo: Array.isArray(to) ? to.map(t => typeof t === 'object' ? t.email : t) : undefined,
              emailCc: (e.cc as Array<{ email: string }>)?.map(c => c.email),
              sentAt: (e.date || e.created_at) as string,
              metadata: { unipile: email },
            });
          }
        }
      } else {
        // LinkedIn/Instagram - get all chats using SDK
        const result = await client.messaging.getAllChats({
          account_id: account.accountId,
          ...(since && { since }),
        });

        const chats = (result as { items?: unknown[] }).items || [];

        for (const chat of chats) {
          const c = chat as Record<string, unknown>;
          const lastMessage = c.last_message as Record<string, unknown> | undefined;

          if (lastMessage) {
            const isFromMe = !!lastMessage.is_from_me;
            // Prefer body (may contain HTML with <br> for line breaks) over text (plain, no breaks)
            const rawBody = (lastMessage.body || '') as string;
            const rawText = (lastMessage.text || '') as string;
            const bodyHasHtml = /<(?:br|p|div|span|a)\b/i.test(rawBody);
            let msgContent = bodyHasHtml && rawBody ? rawBody : (rawText || rawBody || '');
            const msgContentType = bodyHasHtml && rawBody ? 'html' : 'text';
            // Sanitize garbled/binary content from Unipile
            msgContent = sanitizeMessageContent(msgContent) || msgContent;

            messages.push({
              externalMessageId: lastMessage.id as string,
              externalConversationId: c.id as string,
              senderExternalId: (lastMessage.sender_id || c.attendee_id) as string,
              senderDisplayName: (lastMessage.sender_name || c.attendee_name) as string | undefined,
              senderAvatarUrl: c.attendee_avatar as string | undefined,
              isFromMe,
              content: msgContent,
              contentType: msgContentType as 'text' | 'html',
              attachments: (lastMessage.attachments as Array<{
                type: string;
                url: string;
                filename?: string;
                size?: number;
                mime_type?: string;
              }>)?.map(a => ({
                type: a.type,
                url: a.url,
                filename: a.filename,
                size: a.size,
                mimeType: a.mime_type,
              })),
              sentAt: (lastMessage.created_at || c.updated_at) as string,
              metadata: { unipile: { chat, message: lastMessage } },
            });
          }
        }
      }

      return messages;
    } catch (error) {
      console.error(`[Unipile:${this.channelType}] Poll error:`, error);
      throw error;
    }
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(
    account: ChannelAccount,
    externalConversationId: string,
    limit = 50,
    before?: string
  ): Promise<InboundMessage[]> {
    if (!account.credentials.accessToken) {
      throw new Error('No API key available');
    }

    try {
      const client = this.createClient(account);
      const messages: InboundMessage[] = [];

      if (this.channelType === 'email') {
        // Email thread history
        const result = await client.request.send({
          path: '/api/v1/emails',
          method: 'GET',
          query: {
            thread_id: externalConversationId,
            limit: String(limit),
            ...(before && { before }),
          },
        }) as { items?: unknown[] };

        for (const item of result.items || []) {
          const i = item as Record<string, unknown>;
          const from = i.from as { email?: string; name?: string } | undefined;

          messages.push({
            externalMessageId: i.id as string,
            externalConversationId,
            senderExternalId: from?.email || '',
            senderDisplayName: from?.name,
            content: (i.text || i.html || '') as string,
            contentType: i.html ? 'html' : 'text',
            emailSubject: i.subject as string | undefined,
            emailFrom: from?.email,
            sentAt: (i.created_at || i.date) as string,
            metadata: { unipile: item },
          });
        }
      } else {
        // Chat message history using SDK
        const result = await client.messaging.getAllMessagesFromChat({
          chat_id: externalConversationId,
          limit,
          ...(before && { before }),
        });

        const items = (result as { items?: unknown[]; messages?: unknown[] }).items ||
                      (result as { messages?: unknown[] }).messages || [];

        for (const item of items) {
          const i = item as Record<string, unknown>;

          // Prefer body (may contain HTML with <br> for line breaks) over text (plain, no breaks)
          const rawBody = (i.body || '') as string;
          const rawText = (i.text || '') as string;
          const bodyHasHtml = /<(?:br|p|div|span|a)\b/i.test(rawBody);
          let histContent = bodyHasHtml && rawBody ? rawBody : (rawText || rawBody || '');
          const histContentType = bodyHasHtml && rawBody ? 'html' : 'text';
          // Sanitize garbled/binary content from Unipile
          histContent = sanitizeMessageContent(histContent) || histContent;

          messages.push({
            externalMessageId: i.id as string,
            externalConversationId,
            senderExternalId: (i.sender_id || '') as string,
            senderDisplayName: i.sender_name as string | undefined,
            content: histContent,
            contentType: histContentType as 'text' | 'html',
            sentAt: (i.created_at || i.timestamp) as string,
            metadata: { unipile: item },
          });
        }
      }

      return messages;
    } catch (error) {
      console.error(`[Unipile:${this.channelType}] Get history error:`, error);
      throw error;
    }
  }

  /**
   * Validate account connection
   */
  async validateAccount(account: ChannelAccount): Promise<boolean> {
    if (!account.credentials.accessToken) {
      return false;
    }

    try {
      const client = this.createClient(account);

      // Use SDK to get account info
      // The SDK might have account.getAccount() or similar
      const result = await client.request.send({
        path: `/api/v1/accounts/${account.accountId}`,
        method: 'GET',
      }) as { status?: string };

      return result.status === 'active' || result.status === 'connected';
    } catch {
      return false;
    }
  }

  /**
   * Get account profile
   */
  async getAccountProfile(account: ChannelAccount): Promise<{
    displayName: string;
    username: string;
    avatarUrl?: string;
  }> {
    if (!account.credentials.accessToken) {
      throw new Error('No API key available');
    }

    const client = this.createClient(account);

    const result = await client.request.send({
      path: `/api/v1/accounts/${account.accountId}`,
      method: 'GET',
    }) as Record<string, unknown>;

    return {
      displayName: (result.display_name || result.name || account.displayName || 'Unknown') as string,
      username: (result.username || result.email || account.username || '') as string,
      avatarUrl: (result.avatar_url || result.profile_image) as string | undefined,
    };
  }
}

// ============================================================================
// WhatsApp-Specific Methods
// ============================================================================

/**
 * Check if a phone number is registered on WhatsApp
 * Uses Unipile SDK to verify before sending messages
 */
export async function checkWhatsAppNumber(
  client: UnipileClient,
  accountId: string,
  phoneNumber: string
): Promise<{ exists: boolean; formattedNumber?: string }> {
  try {
    // Use Unipile API to check if phone number is on WhatsApp
    const result = await client.request.send({
      path: '/api/v1/chats',
      method: 'POST',
      body: {
        account_id: accountId,
        attendees_ids: [phoneNumber],
        // Dry run check - some providers support this
        dry_run: true,
      },
    }) as Record<string, unknown>;

    return {
      exists: !result.error,
      formattedNumber: (result.attendee_id || result.recipient_id) as string | undefined,
    };
  } catch {
    // If API call fails, assume number doesn't exist on WhatsApp
    return { exists: false };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createUnipileLinkedInAdapter(): UnipileAdapter {
  return new UnipileAdapter('linkedin');
}

export function createUnipileInstagramAdapter(): UnipileAdapter {
  return new UnipileAdapter('instagram');
}

export function createUnipileEmailAdapter(): UnipileAdapter {
  return new UnipileAdapter('email');
}

export function createUnipileWhatsAppAdapter(): UnipileAdapter {
  return new UnipileAdapter('whatsapp');
}

export function createUnipileTelegramAdapter(): UnipileAdapter {
  return new UnipileAdapter('telegram');
}

/**
 * Create adapter for any Unipile-supported channel
 */
export function createUnipileAdapter(channelType: ChannelType): UnipileAdapter {
  return new UnipileAdapter(channelType);
}
