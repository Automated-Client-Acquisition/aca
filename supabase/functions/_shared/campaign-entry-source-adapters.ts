import type { CampaignEntryEvent } from './campaign-entry-events.ts';

/** Unipile delivers the account owner's sent messages through the same webhook. */
export function isUnipileSelfMessage(payload: Record<string, unknown>): boolean {
  if ([true, 1, 'true', '1'].includes(payload.is_sender as boolean | number | string)) return true;
  const sender = payload.sender as Record<string, unknown> | undefined;
  const account = payload.account_info as Record<string, unknown> | undefined;
  const senderId = sender?.attendee_provider_id ?? payload.sender_id ?? sender?.id;
  const accountUserId = account?.user_id;
  return !!accountUserId && !!senderId && String(accountUserId) === String(senderId);
}

const EXTERNAL_EVENT_TYPES = new Set([
  'message_received', 'post_comment', 'keyword_match', 'signal', 'integration_event',
]);
const SECRET_FIELD = /secret|password|authorization|credential|token|api[_-]?key|invitation|provider[_-]?action/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keep integration evidence useful without storing credentials or provider action data. */
function safeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (typeof value === 'string') return value.slice(0, 6000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 24).map(item => safeMetadata(item, depth + 1)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return undefined;
  const entries = Object.entries(value).slice(0, 64)
    .filter(([key]) => !SECRET_FIELD.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key))
    .map(([key, entry]) => [key.slice(0, 120), safeMetadata(entry, depth + 1)])
    .filter(([, entry]) => entry !== undefined);
  return Object.fromEntries(entries);
}

function optionalString(data: Record<string, unknown>, key: string, maxLength = 6000): string | undefined {
  if (data[key] === undefined || data[key] === null) return undefined;
  if (typeof data[key] !== 'string') throw new Error(`${key} must be a string`);
  const value = (data[key] as string).trim();
  if (value.length > maxLength) throw new Error(`${key} exceeds ${maxLength} characters`);
  return value || undefined;
}

/** External workflows supply evidence; only server-polled invites can authorize provider decisions. */
export function buildExternalCampaignEntryEvent(
  organizationId: string,
  contactId: string | undefined,
  data: Record<string, unknown> | undefined,
  sourceEventId?: string,
): CampaignEntryEvent {
  if (!contactId) throw new Error('A contact is required for campaign_event');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('campaign_event data is required');
  const type = optionalString(data, 'type', 80);
  if (!type || !EXTERNAL_EVENT_TYPES.has(type)) {
    throw new Error('type must be message_received, post_comment, keyword_match, signal, or integration_event');
  }
  const eventId = optionalString(data, 'event_id', 240) || optionalString({ source_event_id: sourceEventId }, 'source_event_id', 240);
  if (!eventId || eventId.length > 240) throw new Error('A stable event_id of at most 240 characters is required');
  const campaignId = optionalString(data, 'campaign_id', 36);
  if (campaignId && !UUID.test(campaignId)) throw new Error('campaign_id must be a UUID');
  const channel = optionalString(data, 'channel', 40);
  if (channel && !['linkedin', 'email', 'whatsapp', 'instagram', 'telegram', 'sms'].includes(channel)) {
    throw new Error('channel must be a supported campaign channel');
  }
  return {
    organizationId,
    contactId,
    type: type as CampaignEntryEvent['type'],
    eventId: `integration:${eventId}`,
    campaignId,
    channel,
    text: optionalString(data, 'text'),
    postId: optionalString(data, 'post_id', 512),
    signalType: optionalString(data, 'signal_type', 120),
    eventName: optionalString(data, 'event_name', 240),
    context: {
      source: 'integration',
      metadata: safeMetadata(data.metadata) ?? {},
    },
  };
}
