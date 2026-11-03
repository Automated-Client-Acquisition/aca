/**
 * Twilio adapters for the channel router (SMS below; WhatsApp Business further down): inbox replies and autopilot answers
 * on provider = 'twilio' conversations. Campaign sends go through
 * _shared/messaging/sms.ts sendCampaignSms instead (country window, caps, opt-out
 * wording); a reply to someone who just wrote in only checks opt-outs.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { TwilioError } from '../twilio-client.ts';
import { isOptedOut, loadSender, sendSmsFrom } from '../messaging/sms.ts';
import { sendWhatsAppFrom, whatsappWindowOpen } from '../messaging/whatsapp.ts';
import { ErrorCodes, type ChannelAccount, type ChannelAdapter, type OutboundMessage, type SendResult } from './types.ts';

export function createTwilioSmsAdapter(supabase: SupabaseClient): ChannelAdapter {
  return {
    channelType: 'sms',
    provider: 'twilio',

    async sendMessage(account: ChannelAccount, message: OutboundMessage): Promise<SendResult> {
      const to = message.recipientExternalId;
      if (!to?.startsWith('+')) {
        return { success: false, error: { code: ErrorCodes.INVALID_RECIPIENT, message: 'Conversation has no phone number', retryable: false } };
      }
      if (await isOptedOut(supabase, message.organizationId, to, 'sms')) {
        return { success: false, error: { code: ErrorCodes.BLOCKED_BY_USER, message: 'Contact opted out of SMS', retryable: false } };
      }

      const loaded = await loadSender(supabase, account.id);
      if (!loaded || loaded.sender.status !== 'active') {
        return { success: false, error: { code: ErrorCodes.ACCOUNT_DISCONNECTED, message: 'SMS sender is not active', retryable: false } };
      }
      if (!loaded.sender.two_way && message.senderType !== 'automation') {
        // Recipients can't reply to a sender name, so there's no thread to answer on
        return { success: false, error: { code: ErrorCodes.VALIDATION_ERROR, message: 'This SMS sender is one-way', retryable: false } };
      }

      try {
        const { sid } = await sendSmsFrom(supabase, loaded.sender, loaded.creds, to, message.content, {
          organizationId: message.organizationId,
          contactId: message.contactId,
          source: message.senderType === 'ai' ? 'autopilot' : 'inbox',
          newContact: false,
        });
        return { success: true, externalMessageId: sid, externalConversationId: to };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof TwilioError) {
          if (err.code === 21610) return { success: false, error: { code: ErrorCodes.BLOCKED_BY_USER, message: msg, retryable: false } };
          if (err.status === 401) return { success: false, error: { code: ErrorCodes.AUTHENTICATION_FAILED, message: msg, retryable: false } };
          if (err.status === 429) return { success: false, error: { code: ErrorCodes.RATE_LIMITED, message: msg, retryable: true } };
          if (err.status === 400) return { success: false, error: { code: ErrorCodes.INVALID_RECIPIENT, message: msg, retryable: false } };
        }
        return { success: false, error: { code: ErrorCodes.PROVIDER_ERROR, message: msg, retryable: true } };
      }
    },
  };
}

/**
 * Twilio WhatsApp Business adapter: free-form replies on provider = 'twilio'
 * WhatsApp threads, only inside Meta's 24h customer service window. Outside it
 * the send fails with WINDOW_CLOSED; a template has to reopen the conversation.
 */
export function createTwilioWhatsAppAdapter(supabase: SupabaseClient): ChannelAdapter {
  return {
    channelType: 'whatsapp',
    provider: 'twilio',

    async sendMessage(account: ChannelAccount, message: OutboundMessage): Promise<SendResult> {
      const to = message.recipientExternalId;
      if (!to?.startsWith('+')) {
        return { success: false, error: { code: ErrorCodes.INVALID_RECIPIENT, message: 'Conversation has no phone number', retryable: false } };
      }
      if (await isOptedOut(supabase, message.organizationId, to, 'whatsapp_business')) {
        return { success: false, error: { code: ErrorCodes.BLOCKED_BY_USER, message: 'Contact opted out of WhatsApp', retryable: false } };
      }
      if (!message.conversationId || !(await whatsappWindowOpen(supabase, message.conversationId))) {
        return {
          success: false,
          error: { code: 'WINDOW_CLOSED', message: 'WhatsApp 24-hour window is closed: send an approved template to reopen it', retryable: false },
        };
      }

      const loaded = await loadSender(supabase, account.id);
      if (!loaded || loaded.sender.status !== 'active') {
        return { success: false, error: { code: ErrorCodes.ACCOUNT_DISCONNECTED, message: 'WhatsApp sender is not active', retryable: false } };
      }

      try {
        const { sid } = await sendWhatsAppFrom(supabase, loaded.sender, loaded.creds, to, { body: message.content }, {
          organizationId: message.organizationId,
          contactId: message.contactId,
          source: message.senderType === 'ai' ? 'autopilot' : 'inbox',
          newContact: false,
        });
        return { success: true, externalMessageId: sid, externalConversationId: to };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof TwilioError) {
          if (err.code === 63016) return { success: false, error: { code: 'WINDOW_CLOSED', message: msg, retryable: false } };
          if (err.status === 401) return { success: false, error: { code: ErrorCodes.AUTHENTICATION_FAILED, message: msg, retryable: false } };
          if (err.status === 429) return { success: false, error: { code: ErrorCodes.RATE_LIMITED, message: msg, retryable: true } };
          if (err.status === 400) return { success: false, error: { code: ErrorCodes.INVALID_RECIPIENT, message: msg, retryable: false } };
        }
        return { success: false, error: { code: ErrorCodes.PROVIDER_ERROR, message: msg, retryable: true } };
      }
    },
  };
}
