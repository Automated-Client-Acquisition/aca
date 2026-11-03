/**
 * Unipile post engagement fetchers — one page of reactions or comments.
 * Extracted unchanged from linkedin-post-import so the one-shot importer and
 * the lead-list-source-poller share identical fetch/normalization behavior.
 */

import type { UnipileAccountRef } from './post-resolver.ts';
import { isDisconnectedAccountError } from '../unipile-client.ts';

// Unipile 'value' → LinkedIn display name
const REACTION_TYPE_MAP: Record<string, string> = {
  'PRAISE': 'CELEBRATE',
  'APPRECIATION': 'SUPPORT',
  'EMPATHY': 'LOVE',
  'INTEREST': 'INSIGHTFUL',
  'ENTERTAINMENT': 'FUNNY',
};

/**
 * True when a reaction passes the user's reaction-type filter.
 * Empty filter = all types pass.
 */
export function matchesReactionFilter(reaction: Record<string, unknown>, reactionTypes: string[]): boolean {
  if (reactionTypes.length === 0) return true;
  const reactionType = ((reaction.value || reaction.type || 'LIKE') as string).toUpperCase();
  const mappedType = REACTION_TYPE_MAP[reactionType] || reactionType;
  return reactionTypes.includes(reactionType) || reactionTypes.includes(mappedType);
}

export interface EngagementPage {
  ok: boolean;
  status: number;
  rateLimited: boolean;
  // True on a Unipile 401 / `errors/disconnected_account` — distinct from a
  // generic !ok so callers can flip the account status and park the source
  // instead of silently treating it as "no engagement".
  disconnected: boolean;
  items: Record<string, unknown>[];
  cursor: string | null;
  errorText?: string;
}

async function fetchEngagementPage(
  account: UnipileAccountRef,
  socialId: string,
  endpoint: 'reactions' | 'comments',
  cursor: string | null,
  limit: number,
  logPrefix: string,
): Promise<EngagementPage> {
  const { dsnUrl, apiKey, unipileAccountId } = account;
  let apiUrl = `${dsnUrl}/api/v1/posts/${socialId}/${endpoint}?account_id=${unipileAccountId}&limit=${limit}`;
  if (cursor) {
    apiUrl += `&cursor=${cursor}`;
  }

  const response = await fetch(apiUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`${logPrefix} ${endpoint} API error: ${response.status} - ${errorText}`);
    return {
      ok: false,
      status: response.status,
      rateLimited: response.status === 429,
      disconnected: response.status === 401 || isDisconnectedAccountError(errorText),
      items: [],
      cursor: null,
      errorText,
    };
  }

  const data = await response.json();
  const items = (endpoint === 'reactions'
    ? data.items || data.reactions || data.results
    : data.items || data.comments || data.results) || [];

  return {
    ok: true,
    status: response.status,
    rateLimited: false,
    disconnected: false,
    items: Array.isArray(items) ? items : [],
    cursor: data.cursor || data.next_cursor || null,
  };
}

export function fetchReactionsPage(
  account: UnipileAccountRef,
  socialId: string,
  cursor: string | null,
  limit = 25,
  logPrefix = '[LinkedIn Engagement]',
): Promise<EngagementPage> {
  return fetchEngagementPage(account, socialId, 'reactions', cursor, limit, logPrefix);
}

export function fetchCommentsPage(
  account: UnipileAccountRef,
  socialId: string,
  cursor: string | null,
  limit = 25,
  logPrefix = '[LinkedIn Engagement]',
): Promise<EngagementPage> {
  return fetchEngagementPage(account, socialId, 'comments', cursor, limit, logPrefix);
}

/**
 * Extract the engager profile + stable user id from a reaction item.
 * Unipile returns an author object with id, name, headline, profile_url, ...
 */
export function extractReactionAuthor(reaction: Record<string, unknown>): { userId: string | null; author: Record<string, unknown> } {
  const author = reaction.author as Record<string, unknown> | undefined;
  const userId = (author?.id || reaction.user_id || reaction.actor_id) as string | undefined;
  return { userId: userId || null, author: author || reaction };
}

/**
 * Extract the engager profile + stable user id from a comment item.
 * Unipile returns author_details (object) and author (name string).
 */
export function extractCommentAuthor(comment: Record<string, unknown>): { userId: string | null; author: Record<string, unknown> } {
  const authorDetails = (comment.author_details || comment.author) as Record<string, unknown> | undefined;
  const userId = (authorDetails?.id || comment.author_id || comment.user_id) as string | undefined;
  const author = {
    ...(authorDetails || {}),
    name: typeof comment.author === 'string' ? comment.author : authorDetails?.name,
  };
  return { userId: userId || null, author };
}
