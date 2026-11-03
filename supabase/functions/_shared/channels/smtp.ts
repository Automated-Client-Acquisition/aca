/**
 * SMTP Channel Adapter
 *
 * Sends emails via SMTP from email_mailboxes (not Unipile).
 * Used for replying from the inbox to email conversations that
 * originated from our own SMTP-connected mailboxes.
 */

import type {
  ChannelAdapter,
  ChannelAccount,
  OutboundMessage,
  SendResult,
} from './types.ts';
import { sendEmailViaSMTP, extractSMTPCredentials } from '../smtp-client.ts';
import { sendEmailViaGraph } from '../m365-client.ts';
import { resolveAttachmentBinaries, resolvedAttachmentsToBase64, type ResolvedAttachment } from '../attachment-utils.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

/**
 * Create an SMTP email adapter for the channel router.
 */
export function createSMTPEmailAdapter(): ChannelAdapter {
  return {
    channelType: 'email',
    provider: 'custom',

    async sendMessage(
      _account: ChannelAccount,
      message: OutboundMessage
    ): Promise<SendResult> {
      // The mailbox ID is passed via message.metadata.mailboxId
      const mailboxId = message.metadata?.mailboxId as string;
      if (!mailboxId) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'mailboxId is required in message metadata for SMTP send',
            retryable: false,
          },
        };
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Fetch mailbox (scoped to organization for security)
      const { data: mailbox, error: mbError } = await supabase
        .from('email_mailboxes')
        .select('id, email_address, display_name, metadata, status, connection_type')
        .eq('id', mailboxId)
        .eq('organization_id', message.organizationId)
        .single();

      if (mbError || !mailbox) {
        return {
          success: false,
          error: {
            code: 'ACCOUNT_DISCONNECTED',
            message: `Mailbox ${mailboxId} not found`,
            retryable: false,
          },
        };
      }

      if (mailbox.status !== 'ready') {
        return {
          success: false,
          error: {
            code: 'ACCOUNT_DISCONNECTED',
            message: `Mailbox is ${mailbox.status}, not ready`,
            retryable: false,
          },
        };
      }

      // Build threading headers
      const inReplyTo = message.metadata?.inReplyTo as string | undefined;
      const references = message.metadata?.references as string[] | undefined;

      // Fetch attachment binaries once so both the Graph and SMTP branches below
      // can reuse them without re-fetching from storage.
      const resolvedAttachments = message.attachments?.length
        ? await resolveAttachmentBinaries(message.attachments)
        : [];

      // A fulfillment email must never claim success after silently dropping
      // the promised file. Ordinary replies retain the historical best-effort
      // behavior, but a marked lead-magnet delivery fails closed.
      if (
        message.metadata?.lead_magnet_delivery === true &&
        (message.attachments?.length || 0) !== resolvedAttachments.length
      ) {
        return {
          success: false,
          error: {
            code: 'ATTACHMENT_FAILED',
            message: 'The lead magnet attachment could not be loaded. Nothing was sent.',
            retryable: true,
          },
        };
      }

      // M365 managed mailboxes send via Microsoft Graph (OAuth app permission) —
      // the same transport campaign sends use. This removes the dependency on a
      // decryptable per-mailbox SMTP password (which can drift / fail to decrypt)
      // and sidesteps Microsoft's Basic-auth SMTP blocks. SMTP stays as the
      // fallback for tenants without Graph Mail.Send consent and is the only
      // path for non-M365 (ZapMail / BYO) mailboxes.
      if (mailbox.connection_type === 'm365') {
        const graphResult = await trySendViaGraph(supabase, mailbox, message, {
          inReplyTo,
          references,
        }, resolvedAttachments);
        if (graphResult?.success) {
          return graphResult;
        }
        console.warn(
          `[SMTP Adapter] Graph send unavailable/failed for ${mailbox.email_address}; ` +
            `falling back to SMTP. Reason: ${graphResult?.error?.message ?? 'tenant/sender unresolved'}`,
        );
      }

      // Decrypt SMTP credentials
      const creds = await extractSMTPCredentials(mailbox.metadata || {});
      if (!creds) {
        return {
          success: false,
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Failed to decrypt SMTP credentials for mailbox',
            retryable: false,
          },
        };
      }

      // Send via SMTP
      const result = await sendEmailViaSMTP({
        credentials: creds,
        from_name: mailbox.display_name || mailbox.email_address,
        from_email: mailbox.email_address,
        to_email: message.recipientExternalId,
        subject: message.emailSubject || 'Re: (no subject)',
        html: message.contentType === 'html' ? message.content : undefined,
        text: message.contentType !== 'html' ? message.content : undefined,
        cc: message.emailCc,
        bcc: message.emailBcc,
        in_reply_to: inReplyTo,
        references,
        attachments: resolvedAttachments.length
          ? await Promise.all(resolvedAttachments.map(async (att) => ({
              filename: att.filename,
              contentType: att.mimeType,
              content: new Uint8Array(await att.blob.arrayBuffer()),
            })))
          : undefined,
      });

      if (!result.success) {
        const nonRetryable = result.error_category === 'hard_bounce' || result.error_category === 'auth_error';
        return {
          success: false,
          error: {
            code: result.error_category === 'auth_error' ? 'AUTHENTICATION_FAILED' : 'PROVIDER_ERROR',
            message: result.error || 'SMTP send failed',
            retryable: !nonRetryable,
          },
        };
      }

      // Also log in email_send_log for tracking/analytics
      try {
        await supabase
          .from('email_send_log')
          .insert({
            organization_id: message.organizationId,
            crm_message_id: message.id,
            mailbox_id: mailboxId,
            recipient_email: message.recipientExternalId,
            subject: message.emailSubject || '',
            body: message.content,
            status: 'sent',
            sent_at: new Date().toISOString(),
            email_message_id: result.message_id,
            email_in_reply_to: inReplyTo || null,
            email_references: references || null,
            created_at: new Date().toISOString(),
          });
      } catch (logErr) {
        console.error('[SMTP Adapter] Failed to log send:', logErr);
      }

      return {
        success: true,
        externalMessageId: result.message_id,
        metadata: {
          mailbox_email: mailbox.email_address,
          smtp_message_id: result.message_id,
        },
      };
    },
  };
}

interface MailboxRow {
  id: string;
  email_address: string;
  display_name: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  connection_type: string | null;
}

/**
 * Attempt to send an inbox reply via Microsoft Graph for an M365 mailbox.
 *
 * Returns a successful SendResult when Graph accepts the message, a failed
 * SendResult when Graph rejects it, or null when we can't even attempt Graph
 * (tenant/sender unresolved). In the latter two cases the caller falls back to
 * SMTP, so this never short-circuits a deliverable message.
 */
async function trySendViaGraph(
  supabase: SupabaseClient,
  mailbox: MailboxRow,
  message: OutboundMessage,
  threading: { inReplyTo?: string; references?: string[] },
  resolvedAttachments: ResolvedAttachment[] = [],
): Promise<SendResult | null> {
  const meta = (mailbox.metadata || {}) as Record<string, unknown>;
  const adminEmail = meta.m365_admin_email as string | undefined;
  const senderUserId = (meta.m365_user_id as string | undefined) || mailbox.email_address;

  // Resolve the Azure AD tenant GUID for this mailbox (admin_email + org).
  if (!adminEmail) return null;
  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('organization_id', message.organizationId)
    .eq('admin_email', adminEmail)
    .maybeSingle();
  const tenantId = tenant?.tenant_id as string | undefined;
  if (!tenantId) return null;

  const isHtml = message.contentType === 'html';
  const graph = await sendEmailViaGraph({
    tenantId,
    senderUserId,
    toEmail: message.recipientExternalId,
    subject: message.emailSubject || 'Re: (no subject)',
    html: isHtml ? message.content : undefined,
    text: isHtml ? undefined : message.content,
    cc: message.emailCc,
    bcc: message.emailBcc,
    inReplyTo: threading.inReplyTo,
    references: threading.references,
    saveToSentItems: true,
    attachments: resolvedAttachments.length
      ? await resolvedAttachmentsToBase64(resolvedAttachments)
      : undefined,
  });

  if (!graph.success) {
    return {
      success: false,
      error: {
        code: graph.code === 'ErrorAccessDenied' ? 'AUTHENTICATION_FAILED' : 'PROVIDER_ERROR',
        message: graph.error || 'Graph send failed',
        retryable: false,
      },
    };
  }

  // Mirror the SMTP path's analytics logging. Graph returns no Message-Id
  // synchronously (202 Accepted), so email_message_id stays null.
  try {
    await supabase.from('email_send_log').insert({
      organization_id: message.organizationId,
      crm_message_id: message.id,
      mailbox_id: mailbox.id,
      recipient_email: message.recipientExternalId,
      subject: message.emailSubject || '',
      body: message.content,
      status: 'sent',
      sent_at: new Date().toISOString(),
      email_in_reply_to: threading.inReplyTo || null,
      email_references: threading.references || null,
      created_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.error('[SMTP Adapter] Failed to log Graph send:', logErr);
  }

  return {
    success: true,
    metadata: {
      mailbox_email: mailbox.email_address,
      transport: 'graph',
    },
  };
}
