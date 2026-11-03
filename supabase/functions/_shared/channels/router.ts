/**
 * Channel Router
 *
 * Routes messages to the appropriate channel adapter based on channel type.
 * Handles adapter selection, credential decryption, and error normalization.
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type {
  ChannelAdapter,
  ChannelAccount,
  ChannelType,
  OutboundMessage,
  SendResult,
  InboundMessage,
  RateLimitConfig,
  RateLimitStatus,
} from './types.ts';
import {
  createUnipileLinkedInAdapter,
  createUnipileInstagramAdapter,
  createUnipileEmailAdapter,
  createUnipileWhatsAppAdapter,
  createUnipileTelegramAdapter,
  createUnipileAdapter,
} from './unipile.ts';
import { createSMTPEmailAdapter } from './smtp.ts';
import { createTwilioSmsAdapter, createTwilioWhatsAppAdapter } from './twilio.ts';
import { normalizeDsnUrl } from '../unipile-client.ts';
import { UNIPILE_V2_BASE_URL } from '../unipile/index.ts';
import { v2ApiKeyForAccount } from '../unipile/v2-accounts.ts';

// Map Unipile DB provider values to our ChannelType
const PROVIDER_TO_CHANNEL: Record<string, ChannelType> = {
  linkedin: 'linkedin',
  instagram: 'instagram',
  email: 'email',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  messenger: 'messenger',
  twitter: 'twitter',
  // Email variants map to 'email' channel
  google: 'email',
  outlook: 'email',
  mail: 'email',
  // Legacy
  sms: 'sms',
};

export function mapProviderToChannel(provider: string): ChannelType {
  return PROVIDER_TO_CHANNEL[provider.toLowerCase()] || provider.toLowerCase() as ChannelType;
}

// ============================================================================
// Channel Router
// ============================================================================

export class ChannelRouter {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private supabase: SupabaseClient;
  private encryptionKey: string;

  constructor(supabase: SupabaseClient, encryptionKey: string) {
    this.supabase = supabase;
    this.encryptionKey = encryptionKey;

    // Register adapters for all Unipile-supported channels
    this.registerAdapter('unipile:linkedin', createUnipileLinkedInAdapter());
    this.registerAdapter('unipile:instagram', createUnipileInstagramAdapter());
    this.registerAdapter('unipile:email', createUnipileEmailAdapter());
    this.registerAdapter('unipile:whatsapp', createUnipileWhatsAppAdapter());
    this.registerAdapter('unipile:telegram', createUnipileTelegramAdapter());
    this.registerAdapter('unipile:messenger', createUnipileAdapter('messenger'));
    this.registerAdapter('unipile:twitter', createUnipileAdapter('twitter'));

    // SMTP email adapter (for mailbox-based email conversations)
    this.registerAdapter('smtp:email', createSMTPEmailAdapter());

    // Twilio SMS + WhatsApp Business (provider = 'twilio' conversations, sender in messaging_senders)
    this.registerAdapter('twilio:sms', createTwilioSmsAdapter(supabase));
    this.registerAdapter('twilio:whatsapp', createTwilioWhatsAppAdapter(supabase));
  }

  /**
   * Send an email via SMTP (bypasses unipile_accounts lookup).
   * Used for inbox replies on email conversations with a mailbox_id.
   */
  async sendViaSMTP(message: OutboundMessage): Promise<SendResult> {
    const adapter = this.adapters.get('smtp:email');
    if (!adapter) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: 'SMTP adapter not registered',
          retryable: false,
        },
      };
    }

    // SMTP adapter doesn't use ChannelAccount — pass a dummy
    const dummyAccount = {
      id: 'smtp-direct',
      organizationId: message.organizationId,
      provider: 'custom' as const,
      channelType: 'email' as const,
      accountId: 'smtp',
      displayName: null,
      username: null,
      avatarUrl: null,
      status: 'active' as const,
      credentials: {},
      metadata: {},
    };

    return adapter.sendMessage(dummyAccount, message);
  }

  private async sendViaTwilio(senderId: string | null, message: OutboundMessage): Promise<SendResult> {
    const adapter = this.adapters.get(`twilio:${message.channel}`);
    if (!adapter) {
      return { success: false, error: { code: 'PROVIDER_ERROR', message: `No Twilio adapter for channel: ${message.channel}`, retryable: false } };
    }
    if (!senderId) {
      return { success: false, error: { code: 'ACCOUNT_DISCONNECTED', message: 'Conversation has no Twilio sender', retryable: false } };
    }
    // The adapter loads the sender and its credentials itself
    const account: ChannelAccount = {
      id: senderId,
      organizationId: message.organizationId,
      provider: 'twilio',
      channelType: message.channel,
      accountId: senderId,
      displayName: null,
      username: null,
      avatarUrl: null,
      status: 'active',
      credentials: {},
      metadata: {},
    };
    return adapter.sendMessage(account, message);
  }

  /**
   * Register a channel adapter
   */
  registerAdapter(key: string, adapter: ChannelAdapter): void {
    this.adapters.set(key, adapter);
  }

  /**
   * Get adapter for a channel type and provider
   */
  getAdapter(channelType: ChannelType, provider = 'unipile'): ChannelAdapter | null {
    return this.adapters.get(`${provider}:${channelType}`) || null;
  }

  /**
   * Send a message through the appropriate channel
   */
  async sendMessage(
    accountId: string,
    message: OutboundMessage
  ): Promise<SendResult> {
    // Twilio threads keep their sender in messaging_sender_id (channel_account_id is
    // an FK to unipile_accounts), so callers pass whatever channel_account_id holds.
    if (message.conversationId) {
      const { data: conv } = await this.supabase
        .from('crm_conversations')
        .select('provider, messaging_sender_id')
        .eq('id', message.conversationId)
        .maybeSingle();
      if (conv?.provider === 'twilio') return this.sendViaTwilio(conv.messaging_sender_id, message);
    }

    // Get account details
    const account = await this.getAccount(accountId);
    if (!account) {
      return {
        success: false,
        error: {
          code: 'ACCOUNT_DISCONNECTED',
          message: 'Account not found',
          retryable: false,
        },
      };
    }

    // Get adapter
    const adapter = this.getAdapter(message.channel, 'unipile');
    if (!adapter) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_ERROR',
          message: `No adapter for channel: ${message.channel}`,
          retryable: false,
        },
      };
    }

    // Reply inside the conversation's existing chat instead of starting a new one.
    // A Unipile chat id only works for the account that owns the chat.
    if (message.channel !== 'email' && message.conversationId && !message.metadata?.externalConversationId) {
      const { data: conv } = await this.supabase
        .from('crm_conversations')
        .select('external_conversation_id, channel_account_id')
        .eq('id', message.conversationId)
        .maybeSingle();
      if (conv?.external_conversation_id && conv.channel_account_id === accountId) {
        message = {
          ...message,
          metadata: { ...(message.metadata || {}), externalConversationId: conv.external_conversation_id },
        };
      }
    }

    // Send message
    return adapter.sendMessage(account, message);
  }

  /**
   * Poll for inbound messages on an account
   */
  async pollInbound(
    accountId: string,
    channelType: ChannelType,
    since?: string
  ): Promise<InboundMessage[]> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const adapter = this.getAdapter(channelType, 'unipile');
    if (!adapter || !adapter.pollInbound) {
      throw new Error(`Polling not supported for channel: ${channelType}`);
    }

    return adapter.pollInbound(account, since);
  }

  /**
   * Get conversation history
   */
  async getConversationHistory(
    accountId: string,
    channelType: ChannelType,
    externalConversationId: string,
    limit?: number,
    before?: string
  ): Promise<InboundMessage[]> {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error('Account not found');
    }

    const adapter = this.getAdapter(channelType, 'unipile');
    if (!adapter || !adapter.getConversationHistory) {
      throw new Error(`History not supported for channel: ${channelType}`);
    }

    return adapter.getConversationHistory(account, externalConversationId, limit, before);
  }

  /**
   * Validate an account connection
   */
  async validateAccount(accountId: string, channelType: ChannelType): Promise<boolean> {
    const account = await this.getAccount(accountId);
    if (!account) {
      return false;
    }

    const adapter = this.getAdapter(channelType, 'unipile');
    if (!adapter || !adapter.validateAccount) {
      return true; // Assume valid if no validation method
    }

    return adapter.validateAccount(account);
  }

  /**
   * Get account from database and decrypt credentials
   */
  private async getAccount(accountId: string): Promise<ChannelAccount | null> {
    const { data, error } = await this.supabase
      .from('unipile_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (error || !data) {
      console.error(`[ChannelRouter] Failed to get account ${accountId}:`, error);
      return null;
    }

    // Check status
    if (data.status !== 'active') {
      console.warn(`[ChannelRouter] Account ${accountId} is not active: ${data.status}`);
      return null;
    }

    // v2 accounts: the org's own key copy when the row has one, otherwise ACA's platform key.
    if (data.api_version === 'v2') {
      let v2Key: string;
      try {
        v2Key = await v2ApiKeyForAccount(data, this.encryptionKey);
      } catch (keyError) {
        console.error(`[ChannelRouter] No Unipile v2 key for ${accountId}:`, keyError);
        return null;
      }
      return {
        id: data.id,
        organizationId: data.organization_id,
        provider: 'unipile',
        channelType: mapProviderToChannel(data.provider),
        accountId: data.unipile_account_id,
        displayName: data.display_name,
        username: data.username,
        avatarUrl: data.avatar_url,
        status: data.status,
        credentials: { accessToken: v2Key, dsnUrl: UNIPILE_V2_BASE_URL, apiVersion: 'v2' },
        metadata: data.metadata || {},
      };
    }

    // Decrypt access token
    let accessToken: string;
    try {
      accessToken = await this.decryptApiKey(data.access_token_encrypted);
    } catch (decryptError) {
      console.error(`[ChannelRouter] Failed to decrypt token for ${accountId}:`, decryptError);
      return null;
    }

    return {
      id: data.id,
      organizationId: data.organization_id,
      provider: 'unipile',
      channelType: mapProviderToChannel(data.provider),
      accountId: data.unipile_account_id,
      displayName: data.display_name,
      username: data.username,
      avatarUrl: data.avatar_url,
      status: data.status,
      credentials: {
        accessToken,
        dsnUrl: normalizeDsnUrl(data.dsn_url),
      },
      metadata: data.metadata || {},
    };
  }

  /**
   * Check rate limits for an account/channel
   */
  async checkRateLimits(
    accountId: string,
    config: RateLimitConfig
  ): Promise<RateLimitStatus> {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    // Count sent messages in different time windows
    const { count: minuteCount } = await this.supabase
      .from('crm_message_queue')
      .select('*', { count: 'exact', head: true })
      .eq('channel_account_id', accountId)
      .eq('status', 'sent')
      .gte('sent_at', oneMinuteAgo);

    const { count: hourCount } = await this.supabase
      .from('crm_message_queue')
      .select('*', { count: 'exact', head: true })
      .eq('channel_account_id', accountId)
      .eq('status', 'sent')
      .gte('sent_at', oneHourAgo);

    const { count: dayCount } = await this.supabase
      .from('crm_message_queue')
      .select('*', { count: 'exact', head: true })
      .eq('channel_account_id', accountId)
      .eq('status', 'sent')
      .gte('sent_at', startOfDay.toISOString());

    const usage = {
      minute: minuteCount || 0,
      hour: hourCount || 0,
      day: dayCount || 0,
    };

    // Check limits
    if (config.maxPerMinute && usage.minute >= config.maxPerMinute) {
      return {
        canSend: false,
        reason: 'Per-minute limit reached',
        retryAfter: 60 - (now.getSeconds()),
        currentUsage: usage,
      };
    }

    if (config.maxPerHour && usage.hour >= config.maxPerHour) {
      return {
        canSend: false,
        reason: 'Hourly limit reached',
        retryAfter: 60 * (60 - now.getMinutes()),
        currentUsage: usage,
      };
    }

    if (config.maxPerDay && usage.day >= config.maxPerDay) {
      return {
        canSend: false,
        reason: 'Daily limit reached',
        retryAfter: undefined, // Try again tomorrow
        currentUsage: usage,
      };
    }

    return {
      canSend: true,
      currentUsage: usage,
    };
  }

  /**
   * Decrypt API key using AES-256-GCM
   */
  private async decryptApiKey(encryptedBase64: string): Promise<string> {
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertextWithTag = combined.slice(12);

    const keyBytes = new Uint8Array(
      this.encryptionKey.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertextWithTag
    );

    return new TextDecoder().decode(decrypted);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createChannelRouter(): ChannelRouter {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey);
  return new ChannelRouter(supabase, encryptionKey);
}
