/**
 * BYO Test Send — verifies SMTP creds end-to-end for a mailbox.
 *
 * Sends a single test email via the same code path the sequence processor
 * uses, so any failure (SASL auth, relay reject, DNS, TLS, DKIM signing,
 * outbound port 25) surfaces immediately. Returns the SMTP error string and
 * a category so the UI can render an actionable message.
 *
 * Body: { organization_id, mailbox_id, recipient }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  extractSMTPCredentials,
  sendEmailViaSMTP,
} from '../_shared/smtp-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface TestSendBody {
  organization_id: string;
  mailbox_id: string;
  recipient: string;
  /**
   * Seed-list mode: deliverability services (MailReach, GlockApps) want ONE
   * message addressed to their whole seed panel. When set, `recipient` is
   * ignored and CRM mirroring is skipped — a 28-address join is not a contact.
   */
  recipients?: string[];
  /**
   * Optional content overrides. Placement (inbox vs spam) is driven as much by
   * the body as by the infrastructure, so a seed test has to send the *real*
   * campaign copy — the default plumbing text only proves SMTP works.
   * Still logged as status='filtered' so it stays out of deliverability stats.
   */
  subject?: string;
  text?: string;
  html?: string;
}

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: TestSendBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, mailbox_id, recipient, recipients, subject: subjectOverride, text: textOverride, html: htmlOverride } = body;
  const seedList = Array.isArray(recipients) ? recipients.map((r) => r.trim()).filter(Boolean) : [];
  const isSeedTest = seedList.length > 0;

  if (!organization_id || !mailbox_id || (!recipient && !isSeedTest)) {
    return jsonResponse({ success: false, error: 'organization_id, mailbox_id, and recipient or recipients[] required' }, 400);
  }
  if (isSeedTest) {
    const bad = seedList.filter((r) => !EMAIL_RE.test(r));
    if (bad.length) return jsonResponse({ success: false, error: `invalid recipients: ${bad.join(', ')}` }, 400);
  } else if (!EMAIL_RE.test(recipient.trim())) {
    return jsonResponse({ success: false, error: 'recipient must be a valid email address' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  const { data: mailbox, error: mboxErr } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, display_name, connection_type, status, metadata')
    .eq('id', mailbox_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (mboxErr) return jsonResponse({ success: false, error: mboxErr.message }, 500);
  if (!mailbox) return jsonResponse({ success: false, error: 'Mailbox not found' }, 404);

  const creds = await extractSMTPCredentials((mailbox.metadata as Record<string, unknown>) ?? {});
  if (!creds) {
    return jsonResponse({ success: false, error: 'Mailbox has no SMTP credentials. Re-provision it.' }, 400);
  }

  const sentAt = new Date().toISOString();
  const subject = subjectOverride?.trim() || `ACA test send · ${new Date().toLocaleString()}`;
  const defaultText = [
      `This is a delivery test from ACA's BYO email infrastructure.`,
      ``,
      `Mailbox: ${mailbox.email_address}`,
      `Sent at: ${sentAt}`,
      ``,
      `If you can read this, SMTP auth + relay + DKIM signing are working end-to-end.`,
      `Check the Received: headers to confirm the outbound IP and HELO name match what you configured.`,
    ].join('\n');
  const defaultHtml = `<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;color:#222;max-width:560px;margin:24px auto;padding:0 16px">
  <h2 style="margin-top:0">ACA BYO test send</h2>
  <p>This is a delivery test from <strong>${mailbox.email_address}</strong>.</p>
  <p>If you can read this, SMTP auth + relay + DKIM signing are working end-to-end.</p>
  <p style="color:#666;font-size:13px">Sent at ${sentAt}. Inspect the <code>Received:</code> headers to confirm the outbound IP and HELO match your IP rotation config.</p>
</body></html>`;

  // nodemailer accepts a comma-separated address list in `to`.
  const recipientEmail = isSeedTest ? seedList.join(', ') : recipient.trim();

  // A plain-text-only send when only `text` is overridden: real cold email is
  // text-only on the first touch, and forcing the default HTML alongside it
  // would change what we're measuring.
  const result = await sendEmailViaSMTP({
    credentials: creds,
    from_name: (mailbox.display_name as string | null) ?? (mailbox.email_address as string),
    from_email: mailbox.email_address as string,
    to_email: recipientEmail,
    subject,
    text: textOverride ?? defaultText,
    html: htmlOverride ?? (textOverride ? undefined : defaultHtml),
  });

  // Persist a row in email_send_log so the test shows up in the unified inbox /
  // sent log too. status='filtered' is reserved for "do not count this in
  // deliverability stats" so we don't pollute reply/open/bounce metrics.
  const { data: sendLog } = await supabase
    .from('email_send_log')
    .insert({
      organization_id,
      mailbox_id: mailbox.id,
      recipient_email: recipientEmail,
      subject,
      body: 'BYO infrastructure test send',
      message_id: result.message_id,
      email_message_id: result.message_id || null,
      status: result.success ? 'filtered' : 'bounced',
      sent_at: result.success ? sentAt : null,
      error_message: result.error ?? null,
    })
    .select('id')
    .single();

  // Mirror sequence-sender: create CRM contact + conversation + outbound
  // message so the inbound reply (matched via In-Reply-To → email_message_id)
  // attaches to the same thread instead of forking into a new conversation.
  if (result.success && sendLog && !isSeedTest) {
    try {
      const { data: existingContact } = await supabase
        .from('crm_contacts')
        .select('id')
        .eq('organization_id', organization_id)
        .ilike('primary_email', recipientEmail)
        .limit(1)
        .maybeSingle();

      let contactId = existingContact?.id ?? null;
      if (!contactId) {
        const namePart = recipientEmail.split('@')[0];
        const { data: newContact } = await supabase
          .from('crm_contacts')
          .insert({
            organization_id,
            first_name: namePart,
            display_name: namePart,
            primary_email: recipientEmail,
            source: 'byo_test_send',
          })
          .select('id')
          .single();
        contactId = newContact?.id ?? null;
      }

      if (contactId) {
        const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
          p_org_id: organization_id,
          p_contact_id: contactId,
          p_channel: 'email',
          p_channel_account_id: null,
          p_external_conversation_id: null,
          p_external_participant_id: recipientEmail,
          p_mailbox_id: mailbox.id,
        });

        if (conversationId) {
          const { data: crmMessage } = await supabase
            .from('crm_messages')
            .insert({
              organization_id,
              conversation_id: conversationId,
              contact_id: contactId,
              direction: 'outbound',
              sender_type: 'automation',
              content: 'BYO infrastructure test send',
              content_type: 'text',
              email_subject: subject,
              email_from: mailbox.email_address,
              email_to: [recipientEmail],
              external_message_id: result.message_id || null,
              status: 'sent',
              metadata: { send_log_id: sendLog.id, source: 'byo_test_send' },
            })
            .select('id')
            .single();
          if (crmMessage) {
            await supabase
              .from('email_send_log')
              .update({ crm_message_id: crmMessage.id })
              .eq('id', sendLog.id);
          }
        }
      }
    } catch (err) {
      console.error('[byo-test-send] non-fatal CRM write failed:', err);
    }
  }

  return jsonResponse({
    success: result.success,
    error: result.error,
    error_category: result.error_category,
    message_id: result.message_id,
  });
});
