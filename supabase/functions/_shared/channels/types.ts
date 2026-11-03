/**
 * Channel Abstraction Layer - Types
 *
 * Defines common interfaces for all messaging channels.
 * This allows the CRM to work with multiple providers (Unipile, Twilio, etc.)
 * through a unified interface.
 */

// ============================================================================
// Channel Types
// ============================================================================

export type ChannelType = 'linkedin' | 'instagram' | 'email' | 'sms' | 'whatsapp' | 'telegram' | 'messenger' | 'twitter';

export type ChannelProvider = 'unipile' | 'twilio' | 'sendgrid' | 'custom';

export interface ChannelAccount {
  id: string;
  organizationId: string;
  provider: ChannelProvider;
  channelType: ChannelType;
  accountId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: 'active' | 'expired' | 'disconnected' | 'error';
  credentials: ChannelCredentials;
  metadata: Record<string, unknown>;
}

export interface ChannelCredentials {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  dsnUrl?: string;
  expiresAt?: string;
  /** Unipile stack. 'v2': accessToken is the org's own v2 key or ACA's platform key, no DSN. */
  apiVersion?: 'v1' | 'v2';
}

// ============================================================================
// Message Types
// ============================================================================

export interface OutboundMessage {
  id: string;
  organizationId: string;
  conversationId?: string;
  contactId: string;
  channel: ChannelType;

  // Recipient
  recipientExternalId: string;
  recipientDisplayName?: string;

  // Content
  content: string;
  contentType: 'text' | 'html' | 'markdown';
  attachments?: MessageAttachment[];

  // Email-specific
  emailSubject?: string;
  emailCc?: string[];
  emailBcc?: string[];

  // Sender info
  senderType: 'user' | 'ai' | 'automation' | 'system';
  senderUserId?: string;

  // Metadata
  metadata: Record<string, unknown>;
}

export interface InboundMessage {
  externalMessageId: string;
  externalConversationId?: string;

  // Sender
  senderExternalId: string;
  senderDisplayName?: string;
  senderAvatarUrl?: string;

  // Content
  content: string;
  contentType: 'text' | 'html';
  attachments?: MessageAttachment[];

  // Email-specific
  emailSubject?: string;
  emailFrom?: string;
  emailTo?: string[];
  emailCc?: string[];
  emailHeaders?: Record<string, string>;

  // Direction
  isFromMe?: boolean;

  // Timing
  sentAt: string;
  receivedAt?: string;

  // Metadata
  metadata: Record<string, unknown>;
}

export interface MessageAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'link';
  url: string;
  filename?: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
}

// ============================================================================
// Send Result Types
// ============================================================================

export interface SendResult {
  success: boolean;
  externalMessageId?: string;
  externalConversationId?: string;
  error?: SendError;
  metadata?: Record<string, unknown>;
}

export interface SendError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export const ErrorCodes = {
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  INVALID_CONVERSATION: 'INVALID_CONVERSATION',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BLOCKED_BY_USER: 'BLOCKED_BY_USER',
  ACCOUNT_DISCONNECTED: 'ACCOUNT_DISCONNECTED',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  CONTENT_REJECTED: 'CONTENT_REJECTED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  UNKNOWN: 'UNKNOWN',
} as const;

// ============================================================================
// Channel Interface
// ============================================================================

export interface ChannelAdapter {
  /**
   * Channel type this adapter handles
   */
  readonly channelType: ChannelType;

  /**
   * Provider name
   */
  readonly provider: ChannelProvider;

  /**
   * Send a message through this channel
   */
  sendMessage(
    account: ChannelAccount,
    message: OutboundMessage
  ): Promise<SendResult>;

  /**
   * Poll for new inbound messages
   */
  pollInbound?(
    account: ChannelAccount,
    since?: string
  ): Promise<InboundMessage[]>;

  /**
   * Get conversation history
   */
  getConversationHistory?(
    account: ChannelAccount,
    externalConversationId: string,
    limit?: number,
    before?: string
  ): Promise<InboundMessage[]>;

  /**
   * Check if account is still valid/connected
   */
  validateAccount?(account: ChannelAccount): Promise<boolean>;

  /**
   * Get account profile info (for display)
   */
  getAccountProfile?(account: ChannelAccount): Promise<{
    displayName: string;
    username: string;
    avatarUrl?: string;
  }>;
}

// ============================================================================
// Webhook Types
// ============================================================================

export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface MessageSentEvent extends WebhookEvent {
  event: 'message_sent';
  data: {
    messageId: string;
    conversationId?: string;
    contactId: string;
    channel: ChannelType;
    externalMessageId?: string;
    recipientId: string;
    recipientName?: string;
    preview: string;
    senderType: string;
  };
}

export interface MessageReceivedEvent extends WebhookEvent {
  event: 'message_received';
  data: {
    messageId: string;
    conversationId: string;
    contactId: string;
    channel: ChannelType;
    externalMessageId: string;
    senderId: string;
    senderName?: string;
    content: string;
    contentType: string;
  };
}

export interface MessageFailedEvent extends WebhookEvent {
  event: 'message_failed';
  data: {
    queueItemId: string;
    contactId: string;
    channel: ChannelType;
    recipientId: string;
    error: string;
    errorCode: string;
    attempts: number;
    willRetry: boolean;
  };
}

export interface HandoffRequestedEvent extends WebhookEvent {
  event: 'handoff_requested';
  data: {
    conversationId: string;
    contactId: string;
    channel: ChannelType;
    reason: string;
    triggerMessageId?: string;
    triggerKeywords?: string[];
    aiContext?: Record<string, unknown>;
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitConfig {
  maxPerMinute?: number;
  maxPerHour?: number;
  maxPerDay?: number;
  cooldownSeconds?: number;
}

export interface RateLimitStatus {
  canSend: boolean;
  reason?: string;
  retryAfter?: number; // seconds
  currentUsage: {
    minute: number;
    hour: number;
    day: number;
  };
}
