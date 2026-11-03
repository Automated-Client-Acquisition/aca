/**
 * Channel Abstraction Layer
 *
 * Re-exports all channel-related types and utilities.
 */

// Types
export type {
  ChannelType,
  ChannelProvider,
  ChannelAccount,
  ChannelCredentials,
  OutboundMessage,
  InboundMessage,
  MessageAttachment,
  SendResult,
  SendError,
  ChannelAdapter,
  WebhookEvent,
  MessageSentEvent,
  MessageReceivedEvent,
  MessageFailedEvent,
  HandoffRequestedEvent,
  RateLimitConfig,
  RateLimitStatus,
} from './types.ts';

export { ErrorCodes } from './types.ts';

// Adapters
export {
  UnipileAdapter,
  createUnipileLinkedInAdapter,
  createUnipileInstagramAdapter,
  createUnipileEmailAdapter,
  createUnipileWhatsAppAdapter,
  createUnipileTelegramAdapter,
  createUnipileAdapter,
} from './unipile.ts';

// SMTP Adapter
export { createSMTPEmailAdapter } from './smtp.ts';

// Router
export { ChannelRouter, createChannelRouter, mapProviderToChannel } from './router.ts';
