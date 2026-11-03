/**
 * WhatsApp, Telegram, Instagram and email sends on Unipile v2. LinkedIn has its own inbox-based
 * routes in linkedin-v2.ts.
 *
 * Errors use the same "<status>: <type> <message> (marker)" strings as linkedin-v2.ts.
 */

import { isUnipileApiError } from './errors.ts';
import { v2ErrorString, type V2ActionResult } from './linkedin-v2.ts';
import { accountPath, type UnipileV2Client } from './v2-client.ts';

/**
 * WhatsApp user ids are `<international number>@s.whatsapp.net` (or `@lid` when Unipile handed
 * one back). A bare phone number is turned into the first form.
 */
export function whatsAppUserId(recipient: string): string {
  if (recipient.includes('@')) return recipient;
  return `${recipient.replace(/\D/g, '')}@s.whatsapp.net`;
}

/**
 * Sends a 1:1 message: into the known chat when there is one, otherwise starts the chat.
 * `users_ids` is a string on purpose: an array starts a group chat.
 */
export async function sendDirectMessage(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
  text: string,
  options: { chatId?: string } = {},
): Promise<V2ActionResult> {
  try {
    if (options.chatId) {
      try {
        const sent = await client.post<{ message_id?: string | string[] | null }>(
          accountPath(accountId, `/chats/${encodeURIComponent(options.chatId)}/messages/send`),
          { body: { text } },
        );
        return { success: true, externalId: options.chatId, messageId: firstId(sent?.message_id) };
      } catch (error) {
        // A stale stored chat id: fall through and start the chat again.
        if (!(isUnipileApiError(error) && error.code === 'NOT_FOUND')) throw error;
      }
    }

    const started = await client.post<{ chat_id?: string; message_id?: string | string[] | null }>(
      accountPath(accountId, '/chats/send'),
      { body: { users_ids: userId, text } },
    );
    return { success: true, externalId: started?.chat_id, messageId: firstId(started?.message_id) };
  } catch (error) {
    return { success: false, error: v2ErrorString(error) };
  }
}

/** Sends an email from a Google, Outlook or IMAP account. */
export async function sendEmail(
  client: UnipileV2Client,
  accountId: string,
  to: string,
  subject: string,
  body: string,
  options: { html?: boolean; replyToMessageId?: string; cc?: string[]; bcc?: string[] } = {},
): Promise<V2ActionResult> {
  try {
    const payload: Record<string, unknown> = {
      to: [{ email: to }],
      subject,
      [options.html ? 'html' : 'plain_text']: body,
    };
    if (options.replyToMessageId) payload.reply_to_message_id = options.replyToMessageId;
    if (options.cc?.length) payload.cc = options.cc.map((email) => ({ email }));
    if (options.bcc?.length) payload.bcc = options.bcc.map((email) => ({ email }));

    const sent = await client.post<{ id?: string; message_id?: string }>(
      accountPath(accountId, '/emails/send'),
      { body: payload },
    );
    return { success: true, externalId: sent?.id, messageId: sent?.message_id ?? sent?.id };
  } catch (error) {
    return { success: false, error: v2ErrorString(error) };
  }
}

function firstId(id: string | string[] | null | undefined): string | undefined {
  if (Array.isArray(id)) return id[0];
  return id ?? undefined;
}
