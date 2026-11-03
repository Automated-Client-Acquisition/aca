/**
 * Inbound reply attachments.
 *
 * Files are stored in the private `inbox-attachments` bucket at
 * <organization_id>/<mailbox_id>/<message key>/<n>-<filename> and described on
 * crm_messages.attachments in the inbox's MessageAttachment shape
 * ({ type, url: '', filename, mimeType, size, storageBucket, storagePath }, or
 * `unavailable` when a file wasn't kept). Same layout as postshiba-inbound,
 * which stores PostShiba replies' files before pushing them here.
 *
 * Images embedded in the body (cid-referenced: signature logos, pasted images)
 * are not attachments here; only files the sender attached are kept.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Attachment } from 'mailparser';

export const ATTACHMENT_BUCKET = 'inbox-attachments';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // the bucket's file_size_limit

/** A file taken from a message. content is null when it was over the size cap. */
export interface RawAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer | null;
}

// Parts of a bounce/feedback report, not files anyone attached.
const REPORT_PART_TYPES = new Set(['message/delivery-status', 'message/feedback-report', 'text/rfc822-headers']);

/** False for bounce/feedback report parts, which providers can list as attachments. */
export function isAttachedFileType(contentType: string): boolean {
  return !REPORT_PART_TYPES.has(contentType.toLowerCase());
}

/** The inbox's attachment kinds (MessageAttachment.type). */
function attachmentType(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

function safeKey(value: string, max: number): string {
  return value.replace(/[^\w.-]+/g, '_').slice(-max) || 'file';
}

/** Attached files from a mailparser result; a multipart/report (bounce) has none. */
export function fromParsedAttachments(list: Attachment[] | undefined, isReport: boolean): RawAttachment[] {
  if (isReport || !list?.length) return [];
  return list
    .filter((a) => !a.related && isAttachedFileType(a.contentType || ''))
    .map((a, i) => {
      const size = a.size ?? a.content?.length ?? 0;
      return {
        filename: a.filename || `attachment-${i + 1}`,
        contentType: (a.contentType || 'application/octet-stream').toLowerCase(),
        size,
        content: a.content && size <= MAX_ATTACHMENT_BYTES ? a.content : null,
      };
    });
}

/**
 * Upload files and describe them for crm_messages.attachments. Paths are keyed
 * by the message and upserted, so filing the same message twice overwrites. A
 * file that fails to upload is listed by name as unavailable; it never fails the
 * reply.
 */
export async function storeInboundAttachments(
  supabase: SupabaseClient,
  organizationId: string,
  mailboxId: string,
  messageId: string,
  raws: RawAttachment[],
): Promise<Record<string, unknown>[]> {
  const messageKey = safeKey(messageId, 120);
  const stored: Record<string, unknown>[] = [];
  for (const [i, raw] of raws.entries()) {
    const entry = { type: attachmentType(raw.contentType), url: '', filename: raw.filename, mimeType: raw.contentType, size: raw.size };
    if (!raw.content) {
      stored.push({ ...entry, unavailable: 'too_large' });
      continue;
    }
    const path = `${organizationId}/${mailboxId}/${messageKey}/${i + 1}-${safeKey(raw.filename, 100)}`;
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, raw.content, { contentType: raw.contentType, upsert: true });
    if (error) {
      console.warn(`[Attachments] upload ${path} failed: ${error.message}`);
      stored.push({ ...entry, unavailable: 'store_failed' });
      continue;
    }
    stored.push({ ...entry, storageBucket: ATTACHMENT_BUCKET, storagePath: path });
  }
  return stored;
}
