/**
 * postshiba-inbound
 *
 * Receives replies from a PostShiba domain's catch-all inbox. PostShiba POSTs
 * each inbound message as JSON to postshiba-inbound/<postshiba_inbox_token>,
 * signed with that inbox's webhook secret:
 *   X-Capsule-Timestamp: unix seconds
 *   X-Capsule-Signature: sha256=<hex HMAC-SHA256 of `${timestamp}.${rawBody}`>
 *
 * After checking the signature and the inbox id, the reply's attachments are
 * stored in the private inbox-attachments bucket and the reply is handed to the
 * aca-imap-poller worker (POST /inbound-email), which files it with the same
 * processInboundEmail every other mailbox uses: thread matching, CRM
 * conversation, enrollment stop, classification, autopilot.
 *
 * Any failure returns a non-2xx so PostShiba retries (it keeps a message for
 * 168 hours). The worker dedupes on Message-ID, so retries are safe.
 * verify_jwt is off: PostShiba can't send a Supabase JWT; the signature is the auth.
 * Plan: tasks/postshiba-integration-2026-10-22.md (Phase 3).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptValue } from '../_shared/encryption.ts';
import { verifyCapsuleSignature } from '../_shared/postshiba-webhook.ts';

function respond(status: number, message?: string) {
  return new Response(message ?? null, { status, headers: message ? { 'Content-Type': 'text/plain' } : undefined });
}

/** "Jane Doe <jane@acme.com>" -> { email: "jane@acme.com", name: "Jane Doe" } */
function parseAddress(value: unknown): { email: string; name: string } {
  const raw = typeof value === 'string' ? value.trim() : '';
  const angle = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    return { email: angle[2].trim().toLowerCase(), name: angle[1].trim().replace(/^"|"$/g, '') };
  }
  return { email: raw.toLowerCase(), name: '' };
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

const ATTACHMENT_BUCKET = 'inbox-attachments';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // the bucket's file_size_limit

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The inbox's attachment kinds (MessageAttachment.type). */
function attachmentType(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/**
 * PostShiba sends each attachment's bytes on the webhook (content_base64) and
 * deletes them once a delivery succeeds, so they are stored before answering.
 * Paths are keyed by the PostShiba message id and upserted, so a retry
 * overwrites rather than duplicates. A failed upload throws: the webhook
 * answers 5xx and PostShiba retries with the bytes still there.
 * Returns entries in crm_messages.attachments' shape; a file with no bytes or
 * over the size cap is listed by name with `unavailable` set.
 */
async function storeAttachments(
  supabase: SupabaseClient,
  organizationId: string,
  mailboxId: string,
  // deno-lint-ignore no-explicit-any
  message: any,
): Promise<Record<string, unknown>[]> {
  const list = Array.isArray(message.attachments) ? message.attachments : [];
  const stored: Record<string, unknown>[] = [];
  for (const [i, att] of list.entries()) {
    const filename = typeof att?.filename === 'string' && att.filename.trim() ? att.filename.trim() : `attachment-${i + 1}`;
    const mimeType = typeof att?.content_type === 'string' && att.content_type ? att.content_type.toLowerCase() : 'application/octet-stream';
    const entry = { type: attachmentType(mimeType), url: '', filename, mimeType, size: Number(att?.size) || undefined };

    if (typeof att?.content_base64 !== 'string' || !att.content_base64) {
      stored.push({ ...entry, unavailable: 'no_content' });
      continue;
    }
    const bytes = base64ToBytes(att.content_base64);
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      stored.push({ ...entry, size: bytes.length, unavailable: 'too_large' });
      continue;
    }

    const safeName = filename.replace(/[^\w.-]+/g, '_').slice(-100);
    const path = `${organizationId}/${mailboxId}/${message.id}/${i + 1}-${safeName}`;
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, bytes, { contentType: mimeType, upsert: true });
    if (error) throw new Error(`attachment ${i + 1} (${filename}) upload failed: ${error.message}`);
    stored.push({ ...entry, size: bytes.length, storageBucket: ATTACHMENT_BUCKET, storagePath: path });
  }
  return stored;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return respond(405);

  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return respond(404);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('id, organization_id, domain, postshiba_inbox_id, postshiba_inbox_secret_encrypted')
      .eq('postshiba_inbox_token', token)
      .eq('infra_type', 'postshiba')
      .maybeSingle();
    if (!domain?.postshiba_inbox_secret_encrypted) return respond(404);

    const rawBody = await req.text();
    const secret = await decryptValue(domain.postshiba_inbox_secret_encrypted);
    const valid = await verifyCapsuleSignature(rawBody, req.headers.get('X-Capsule-Timestamp'), req.headers.get('X-Capsule-Signature'), secret);
    if (!valid) return respond(401, 'invalid signature');

    // deno-lint-ignore no-explicit-any
    let message: any;
    try {
      message = JSON.parse(rawBody);
    } catch {
      return respond(400, 'invalid json');
    }
    if (message?.inbox_id !== domain.postshiba_inbox_id) return respond(403, 'wrong inbox');

    // deno-lint-ignore no-explicit-any
    const headers: Record<string, any> = message.headers ?? {};
    const recipient = parseAddress(firstString(message.envelope?.rcpt_to) || message.to).email;

    // The sender the reply was addressed to. A catch-all hit on an address with
    // no sender (a removed one, or a typo) goes to the domain's oldest sender so
    // the reply still reaches the inbox.
    const { data: exact } = await supabase
      .from('email_mailboxes')
      .select('id, email_address')
      .eq('organization_id', domain.organization_id)
      .eq('connection_type', 'postshiba')
      .eq('email_address', recipient)
      .maybeSingle();
    let mailbox = exact;
    if (!mailbox) {
      const { data: fallback } = await supabase
        .from('email_mailboxes')
        .select('id, email_address')
        .eq('organization_id', domain.organization_id)
        .eq('connection_type', 'postshiba')
        .eq('sending_domain_id', domain.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      mailbox = fallback;
    }
    if (!mailbox) {
      // Nothing on this domain to attach it to; retrying won't change that.
      console.warn(`[postshiba-inbound] ${domain.domain}: no sender for ${recipient}, message ${message.id} dropped`);
      return respond(204);
    }

    const from = parseAddress(headers.from || message.from);
    const fromEmail = from.email || parseAddress(message.envelope?.mail_from).email;
    const toEmails = [recipient, ...String(headers.to ?? '').split(',').map((a) => parseAddress(a).email)]
      .filter((a, i, all) => a && all.indexOf(a) === i);
    const email = {
      message_id: firstString(headers['message-id']) || `postshiba-${message.id}@${domain.domain}`,
      in_reply_to: message.in_reply_to || firstString(headers['in-reply-to']) || null,
      references: String(headers.references ?? '').split(/\s+/).filter(Boolean),
      from_email: fromEmail,
      from_name: from.name,
      to_emails: toEmails,
      subject: message.subject ?? firstString(headers.subject),
      text_body: message.text ?? '',
      html_body: message.html ?? '',
      date: firstString(headers.date) || null,
      attachments: await storeAttachments(supabase, domain.organization_id, mailbox.id, message),
    };

    const pollerUrl = Deno.env.get('IMAP_POLLER_WEBHOOK_URL');
    const internalSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET');
    if (!pollerUrl || !internalSecret) {
      console.error('[postshiba-inbound] IMAP_POLLER_WEBHOOK_URL / INTERNAL_WEBHOOK_SECRET not configured');
      return respond(503);
    }
    const res = await fetch(`${new URL(pollerUrl).origin}/inbound-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
      body: JSON.stringify({ mailbox_id: mailbox.id, email }),
    });
    if (!res.ok) {
      console.error(`[postshiba-inbound] worker returned ${res.status} for message ${message.id}: ${(await res.text()).slice(0, 300)}`);
      return respond(502);
    }

    console.log(`[postshiba-inbound] ${domain.domain}: filed ${message.id} from ${fromEmail} to ${mailbox.email_address}`);
    return respond(204);
  } catch (err) {
    console.error('[postshiba-inbound] unhandled:', err);
    return respond(500);
  }
});
