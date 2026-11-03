/**
 * LinkedIn Classic actions on Unipile v2, for unipile_accounts rows with api_version = 'v2'.
 *
 * Errors come back as strings shaped like the v1 send errors ("<status>: <type> <message>")
 * with the markers the campaign processor already reacts to:
 * - "disconnected_account"     -> flips the sender to disconnected
 * - "temporary provider limit" -> long backoff instead of failing the lead
 * - "account_restricted"       -> non-retryable
 * - "invalid_recipient"        -> re-resolves the lead's LinkedIn identity once
 *
 * Verified live on 2026-10-23 (docs/planning/unipile-v2-reference.md 8.2.1): CLASSIC_PRIMARY is the
 * main inbox, the generic chat list is 501 for LinkedIn, profile ids are ACo… member ids.
 */

import { isUnipileApiError, type UnipileApiError } from './errors.ts';
import { accountPath, type UnipileV2Client } from './v2-client.ts';

export const LINKEDIN_CLASSIC_INBOX = 'CLASSIC_PRIMARY';

export interface V2ActionResult {
  success: boolean;
  externalId?: string;
  messageId?: string;
  error?: string;
}

export interface V2LinkedInProfile {
  id: string;
  public_identifier?: string;
  first_name?: string;
  last_name?: string;
  display_name?: string;
  description?: string;
  profile_url?: string;
  public_picture_url?: string;
  specifics?: {
    network_distance?: string;
    relation_request?: { id?: string } | null;
    relation_request_status?: string | null;
    [key: string]: unknown;
  };
}

/** Formats a v2 failure like the v1 error strings, adding the markers the processor matches on. */
export function v2ErrorString(error: unknown): string {
  if (!isUnipileApiError(error)) {
    return error instanceof Error ? error.message : String(error);
  }
  const base = `${error.status ?? 'network'}: ${error.type ?? error.code} ${error.message}`;
  return `${base}${markerFor(error)}`;
}

function markerFor(error: UnipileApiError): string {
  switch (error.code) {
    case 'DISCONNECTED_ACCOUNT':
      return ' (disconnected_account)';
    case 'RATE_LIMITED':
      return ' (temporary provider limit)';
    case 'ACTION_REQUIRED':
      return ' (account_restricted)';
    case 'NOT_FOUND':
      return ' (invalid_recipient)';
    default:
      return '';
  }
}

/** Profile by ACo… id or public identifier. `fresh` skips Unipile's 1-hour cache. */
export function getProfile(
  client: UnipileV2Client,
  accountId: string,
  identifier: string,
  fresh = false,
): Promise<V2LinkedInProfile> {
  return client.get<V2LinkedInProfile>(
    accountPath(accountId, `/users/${encodeURIComponent(identifier)}`),
    { noCache: fresh },
  );
}

export async function sendRelationRequest(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
  message?: string,
): Promise<V2ActionResult> {
  try {
    const body: Record<string, unknown> = { user_id: userId };
    if (message) body.message = message;
    const res = await client.post<{ id?: string }>(
      accountPath(accountId, '/users/me/relation-requests'),
      { body },
    );
    return { success: true, externalId: res?.id };
  } catch (error) {
    // Already invited: let the lead wait for acceptance instead of retrying.
    if (isUnipileApiError(error) && /already/i.test(`${error.type} ${error.message}`)) {
      return { success: true };
    }
    return { success: false, error: v2ErrorString(error) };
  }
}

/** The existing 1:1 chat with a user, if this account has one. */
export async function findChatWithUser(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
): Promise<string | null> {
  try {
    const res = await client.get<{ data?: Array<{ chat_id?: string }> }>(
      accountPath(accountId, `/users/${encodeURIComponent(userId)}/chat`),
      { noCache: true },
    );
    return res?.data?.find((c) => c.chat_id)?.chat_id ?? null;
  } catch (error) {
    if (isUnipileApiError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Sends a LinkedIn message: into the existing chat when there is one, otherwise starts a 1:1 chat
 * from the classic inbox. `users_ids` is a string on purpose: an array starts a group chat.
 */
export async function sendLinkedInMessage(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
  text: string,
  options: { chatId?: string; inmail?: boolean; subject?: string } = {},
): Promise<V2ActionResult> {
  try {
    const chatId = options.inmail
      ? null
      : options.chatId ?? await findChatWithUser(client, accountId, userId);

    if (chatId) {
      try {
        const sent = await client.post<{ message_id?: string | string[] | null }>(
          accountPath(accountId, `/chats/${encodeURIComponent(chatId)}/messages/send`),
          { body: { text } },
        );
        return { success: true, externalId: chatId, messageId: firstId(sent?.message_id) };
      } catch (error) {
        // A stale stored chat id: fall through and start the chat again.
        if (!(isUnipileApiError(error) && error.code === 'NOT_FOUND')) throw error;
      }
    }

    const body: Record<string, unknown> = { users_ids: userId, text };
    if (options.inmail) {
      body.specifics = { linkedin: { classic: { inmail: true } } };
      if (options.subject) body.name = options.subject;
    }
    const started = await client.post<{ chat_id?: string; message_id?: string | string[] | null }>(
      accountPath(accountId, `/inboxes/${LINKEDIN_CLASSIC_INBOX}/chats/send`),
      { body },
    );
    return { success: true, externalId: started?.chat_id, messageId: firstId(started?.message_id) };
  } catch (error) {
    return { success: false, error: v2ErrorString(error) };
  }
}

export async function viewProfile(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
): Promise<V2ActionResult> {
  try {
    await getProfile(client, accountId, userId, true);
    return { success: true };
  } catch (error) {
    return { success: false, error: v2ErrorString(error) };
  }
}

/** Pending sent invitations, keyed by invited user id (ACo…), valued by relation request id. */
export async function listPendingSentRequests(
  client: UnipileV2Client,
  accountId: string,
  maxPages = 10,
): Promise<Map<string, string>> {
  const pending = new Map<string, string>();
  const limit = 100;
  for (let page = 0, offset = 0; page < maxPages; page++, offset += limit) {
    const res = await client.get<{ data?: Array<{ id?: string; user?: { id?: string } }> }>(
      accountPath(accountId, '/users/me/relation-requests'),
      { noCache: true, query: { type: 'sent', offset, limit } },
    );
    const items = res?.data ?? [];
    for (const item of items) {
      if (item.user?.id && item.id) pending.set(item.user.id, item.id);
    }
    if (items.length < limit) break;
  }
  return pending;
}

export async function cancelRelationRequest(
  client: UnipileV2Client,
  accountId: string,
  requestId: string,
): Promise<V2ActionResult> {
  try {
    await client.post(
      accountPath(accountId, `/users/me/relation-requests/${encodeURIComponent(requestId)}/cancel`),
    );
    return { success: true };
  } catch (error) {
    return { success: false, error: v2ErrorString(error) };
  }
}

function firstId(id: string | string[] | null | undefined): string | undefined {
  if (Array.isArray(id)) return id[0];
  return id ?? undefined;
}
