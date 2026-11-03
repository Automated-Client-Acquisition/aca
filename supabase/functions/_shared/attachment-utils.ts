/**
 * Attachment Utilities
 *
 * Shared helpers for resolving attachment URLs to binary data
 * and determining the correct Unipile FormData field names.
 */

// Re-use the MessageAttachment type from the channel layer
interface AttachmentInput {
  type: string; // 'image' | 'video' | 'audio' | 'file' | 'link'
  url: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

export interface ResolvedAttachment {
  blob: Blob;
  filename: string;
  mimeType: string;
  type: string;
}

/**
 * Fetch binary data for each attachment URL.
 * Skips 'link' type and any URLs that fail to fetch.
 */
export async function resolveAttachmentBinaries(
  attachments: AttachmentInput[]
): Promise<ResolvedAttachment[]> {
  const resolved: ResolvedAttachment[] = [];

  for (const att of attachments) {
    if (!att.url || att.type === 'link') continue;

    try {
      const response = await fetch(att.url);
      if (!response.ok) {
        console.error(`[Attachments] Failed to fetch ${att.url}: ${response.status}`);
        continue;
      }

      const blob = await response.blob();
      const filename = att.filename || deriveFilename(att.url, att.mimeType);
      const mimeType = att.mimeType || blob.type || 'application/octet-stream';

      resolved.push({ blob, filename, mimeType, type: att.type });
    } catch (error) {
      console.error(`[Attachments] Error resolving ${att.url}:`, error);
    }
  }

  return resolved;
}

/**
 * Determine the correct Unipile FormData field name for an attachment.
 *
 * - voice_message: audio on LinkedIn / WhatsApp (dedicated field)
 * - video_message: video on LinkedIn (dedicated field)
 * - attachments:   everything else (generic, works on all channels)
 */
export function getUnipileAttachmentField(
  type: string,
  channel: string,
  usedFields?: Set<string>
): 'voice_message' | 'video_message' | 'attachments' {
  // Dedicated fields only accept a single file each.
  // If already used, fall back to generic 'attachments'.
  if (type === 'audio' && (channel === 'linkedin' || channel === 'whatsapp')) {
    if (usedFields?.has('voice_message')) return 'attachments';
    usedFields?.add('voice_message');
    return 'voice_message';
  }
  if (type === 'video' && channel === 'linkedin') {
    if (usedFields?.has('video_message')) return 'attachments';
    usedFields?.add('video_message');
    return 'video_message';
  }
  return 'attachments';
}

/**
 * Append all resolved attachments to a FormData object using the correct field names.
 */
export function appendAttachmentsToFormData(
  formData: FormData,
  resolved: ResolvedAttachment[],
  channel: string
): void {
  const usedFields = new Set<string>();

  for (const att of resolved) {
    const field = getUnipileAttachmentField(att.type, channel, usedFields);
    const file = new File([att.blob], att.filename, { type: att.mimeType });
    formData.append(field, file);
  }
}

export interface EncodedAttachment {
  filename: string;
  mimeType: string;
  contentBytes: string; // base64
}

/**
 * Base64-encode resolved attachment blobs for JSON-based send APIs
 * (e.g. Microsoft Graph's fileAttachment.contentBytes).
 */
export async function resolvedAttachmentsToBase64(
  resolved: ResolvedAttachment[]
): Promise<EncodedAttachment[]> {
  const out: EncodedAttachment[] = [];

  for (const att of resolved) {
    const bytes = new Uint8Array(await att.blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    out.push({ filename: att.filename, mimeType: att.mimeType, contentBytes: btoa(binary) });
  }

  return out;
}

function deriveFilename(url: string, mimeType?: string): string {
  try {
    const urlPath = new URL(url).pathname;
    const basename = urlPath.split('/').pop() || 'attachment';
    if (basename.includes('.')) return basename;
    const ext = mimeType?.split('/')[1] || 'bin';
    return `${basename}.${ext}`;
  } catch {
    return `attachment.${mimeType?.split('/')[1] || 'bin'}`;
  }
}
