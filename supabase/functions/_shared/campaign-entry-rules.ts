/** ACA owns entry qualification and campaign admission; integrations own wider automation. */
export const CAMPAIGN_ENTRY_TYPES = ['connection_request', 'message_received', 'post_comment', 'keyword_match', 'signal', 'integration_event', 'list_member_added'] as const;
export type CampaignEntryType = typeof CAMPAIGN_ENTRY_TYPES[number];

export interface CampaignEntryTrigger {
  id: string;
  name: string;
  createdAt?: string;
  type: CampaignEntryType;
  enabled: boolean;
  accountIds: string[];
  channel: string;
  keywords: string[];
  keywordSource?: 'messages' | 'comments' | 'integration';
  postIds: string[];
  signalTypes: string[];
  listIds?: string[];
  eventName: string;
  qualification: { enabled: boolean; productId: string; minScore: number };
  onMatch: 'enroll' | 'accept_and_enroll' | 'review';
  onMismatch: 'ignore' | 'decline';
}

export interface CampaignEntryEvent {
  organizationId: string;
  type: CampaignEntryType;
  eventId: string;
  contactId: string;
  accountId?: string | null;
  channel?: string;
  text?: string;
  postId?: string;
  signalType?: string;
  eventName?: string;
  listId?: string;
  context?: Record<string, unknown>;
  campaignId?: string;
}

export function normalizeEntryPostId(value: string): string {
  if (/^\d+$/.test(value.trim())) return `urn:li:activity:${value.trim()}`;
  const match = value.match(/(activity|ugcPost)[-:](\d+)/i);
  return match ? `urn:li:${match[1].toLowerCase() === 'ugcpost' ? 'ugcPost' : 'activity'}:${match[2]}` : value.trim();
}

export function entryTriggerProblem(trigger: CampaignEntryTrigger): string | null {
  if (!trigger || !trigger.id || !CAMPAIGN_ENTRY_TYPES.includes(trigger.type)) return 'Trigger type or identifier is invalid';
  const arrays = [trigger.accountIds, trigger.keywords, trigger.postIds, trigger.signalTypes];
  if (arrays.some(values => !Array.isArray(values) || values.length > 100 || values.some(value => typeof value !== 'string' || value.length > 1000))) return 'Trigger filters are invalid';
  if (trigger.postIds.length > 20) return 'Watch at most 20 LinkedIn posts per trigger';
  if (trigger.type === 'list_member_added') {
    if (!Array.isArray(trigger.listIds) || !trigger.listIds.length || trigger.listIds.length > 100 || trigger.listIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) return 'Choose at least one valid lead list (at most 100)';
    if (trigger.channel !== 'any' || trigger.accountIds.length) return 'List additions use any channel without a receiving account';
  }
  const native = trigger.type === 'connection_request' || trigger.type === 'message_received' || trigger.type === 'post_comment' || (trigger.type === 'keyword_match' && trigger.keywordSource !== 'integration');
  if (native && !trigger.accountIds.length) return 'Choose at least one receiving account';
  if (trigger.channel && !['any', 'linkedin', 'email', 'whatsapp', 'instagram', 'telegram', 'sms'].includes(trigger.channel)) return 'Trigger channel is invalid';
  if (trigger.type === 'connection_request' && (trigger.channel !== 'linkedin' || trigger.qualification?.enabled !== true)) return 'Incoming invitations require LinkedIn and ICP qualification';
  if ((trigger.type === 'post_comment' || (trigger.type === 'keyword_match' && trigger.keywordSource === 'comments')) && !trigger.postIds.length) return 'Choose a post to watch';
  if (trigger.type === 'keyword_match' && (!trigger.keywords.some(word => word.trim()) || (trigger.keywordSource && !['messages', 'comments', 'integration'].includes(trigger.keywordSource)))) return 'Choose keywords and a valid monitoring source';
  if (trigger.type === 'integration_event' && !trigger.eventName?.trim()) return 'Choose an integration event name';
  if (!['enroll', 'accept_and_enroll', 'review'].includes(trigger.onMatch) || !['ignore', 'decline'].includes(trigger.onMismatch)) return 'Trigger outcome is invalid';
  if (trigger.type !== 'connection_request' && (trigger.onMatch === 'accept_and_enroll' || trigger.onMismatch === 'decline')) return 'Invitation decisions are only available for incoming invitations';
  if (trigger.qualification?.enabled !== false && (!trigger.qualification?.productId || !Number.isFinite(trigger.qualification.minScore) || trigger.qualification.minScore < 0 || trigger.qualification.minScore > 100)) return 'Choose a product and ICP threshold';
  return null;
}

function wordsMatch(text: string, keywords: string[]): boolean {
  const normalized = text.normalize('NFKC').toLocaleLowerCase();
  const wordCharacter = /[\p{L}\p{N}_]/u;
  return keywords.some(word => {
    const phrase = word.trim().normalize('NFKC').toLocaleLowerCase();
    if (!phrase) return false;
    let offset = normalized.indexOf(phrase);
    while (offset !== -1) {
      const before = normalized[offset - 1] || '';
      const after = normalized[offset + phrase.length] || '';
      if ((!wordCharacter.test(phrase[0]) || !wordCharacter.test(before)) && (!wordCharacter.test(phrase[phrase.length - 1]) || !wordCharacter.test(after))) return true;
      offset = normalized.indexOf(phrase, offset + 1);
    }
    return false;
  });
}

export function entryTriggerMatches(trigger: CampaignEntryTrigger, event: CampaignEntryEvent): boolean {
  if (!trigger.enabled || entryTriggerProblem(trigger)) return false;
  if (trigger.accountIds?.length && (!event.accountId || !trigger.accountIds.includes(event.accountId))) return false;
  if (trigger.channel && trigger.channel !== 'any' && trigger.channel !== event.channel) return false;
  if (trigger.type === 'keyword_match') {
    const source = trigger.keywordSource || 'messages';
    const expected = source === 'messages' ? 'message_received' : source === 'comments' ? 'post_comment' : 'keyword_match';
    if (event.type !== expected || !trigger.keywords?.length || !wordsMatch(event.text || '', trigger.keywords)) return false;
    if (source === 'comments' && !trigger.postIds?.length) return false;
  } else if (trigger.type !== event.type) return false;
  if (trigger.type === 'list_member_added') {
    const listId = event.listId;
    return typeof listId === 'string' && (trigger.listIds || []).some(id => id.toLowerCase() === listId.toLowerCase());
  }
  if ((trigger.type === 'post_comment' || (trigger.type === 'keyword_match' && trigger.keywordSource === 'comments'))) {
    if (!trigger.postIds?.length || !event.postId || !trigger.postIds.map(normalizeEntryPostId).includes(normalizeEntryPostId(event.postId))) return false;
  }
  if (trigger.type !== 'keyword_match' && trigger.keywords?.length && !wordsMatch(event.text || '', trigger.keywords)) return false;
  if (trigger.type === 'signal' && trigger.signalTypes?.length && !trigger.signalTypes.some(type => type.toLowerCase() === (event.signalType || '').toLowerCase())) return false;
  if (trigger.type === 'integration_event' && (!trigger.eventName?.trim() || trigger.eventName.trim() !== event.eventName)) return false;
  return true;
}

export function entryQualificationDecision(trigger: CampaignEntryTrigger, score: unknown, approved = false): 'match' | 'mismatch' | 'review' {
  if (approved || trigger.qualification?.enabled === false) return 'match';
  if (!trigger.qualification?.productId || typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) return 'review';
  const minimum = trigger.qualification.minScore;
  if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) return 'review';
  return score >= minimum ? 'match' : 'mismatch';
}

/** A score from another product (or a stale/general B2B score) is never qualification evidence. */
export function scopedEntryScore(row: { icp_score?: unknown; product_id?: string; analyzed_at?: string } | null, productId: string, now = Date.now()): number | null {
  if (!row || row.product_id !== productId || !row.analyzed_at || !Number.isFinite(Date.parse(row.analyzed_at)) || now - Date.parse(row.analyzed_at) > 30 * 86400000 || Date.parse(row.analyzed_at) > now + 60000) return null;
  return typeof row.icp_score === 'number' && Number.isFinite(row.icp_score) && row.icp_score >= 0 && row.icp_score <= 100 ? row.icp_score : null;
}

/** Never persist provider secrets in the activity feed, even from an integration. */
export function safeEntryContext(value: Record<string, unknown> = {}, depth = 0): Record<string, unknown> {
  if (depth >= 8) return {};
  const blocked = /secret|token|authorization|api[_-]?key|password|credential/i;
  return Object.fromEntries(Object.entries(value).slice(0, 100).filter(([key]) => !blocked.test(key)).map(([key, child]) => [key,
    Array.isArray(child) ? child.slice(0, 100).map(item => item && typeof item === 'object' ? safeEntryContext(item as Record<string, unknown>, depth + 1) : typeof item === 'string' ? item.slice(0, 10000) : item)
      : child && typeof child === 'object' ? safeEntryContext(child as Record<string, unknown>, depth + 1) : typeof child === 'string' ? child.slice(0, 10000) : child,
  ]));
}
