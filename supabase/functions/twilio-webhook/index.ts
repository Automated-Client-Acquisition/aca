/**
 * Twilio webhook: inbound SMS / WhatsApp Business messages and delivery status callbacks.
 *
 * Twilio posts application/x-www-form-urlencoded and signs it with the account's
 * auth token (X-Twilio-Signature), so verify_jwt is off and every request is
 * checked against the token of the org that owns the number.
 *
 *  - Status callback (MessageStatus set): updates messaging_send_log and the
 *    crm_messages row with that MessageSid.
 *  - Inbound message: STOP/START keywords → channel_opt_outs; otherwise files the
 *    reply in the contact's SMS thread, stops campaigns with stop_on_reply, logs
 *    reply_detected (conditionReplyReceived branches on it), runs inbox autopilot
 *    and automation rules, same as the Unipile webhook does for chat channels.
 *
 * Responds with empty TwiML so Twilio sends no auto-reply of ours (Twilio's own
 * opt-out handling still answers STOP).
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { credentialsFromKeyRow, validTwilioSignature } from '../_shared/twilio-client.ts';
import { normalizePhone } from '../_shared/phone.ts';
import { optKeyword } from '../_shared/messaging/country-rules.ts';
import { ensureTwilioConversation, recordOptOut, statusCallbackUrl } from '../_shared/messaging/sms.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { classifyReply } from '../_shared/reply-classifier.ts';
import { processAutopilot } from '../_shared/conversation-autopilot.ts';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(status = 200) {
  return new Response(EMPTY_TWIML, { status, headers: { 'Content-Type': 'text/xml' } });
}

// Twilio MessageStatus → messaging_send_log.status / crm_messages.status
const LOG_STATUS: Record<string, string> = {
  accepted: 'queued', scheduled: 'queued', queued: 'queued', sending: 'queued',
  sent: 'sent', delivered: 'delivered', read: 'read', undelivered: 'undelivered', failed: 'failed', canceled: 'failed',
};
const CRM_STATUS: Record<string, string> = {
  sent: 'sent', delivered: 'delivered', read: 'read', undelivered: 'failed', failed: 'failed', canceled: 'failed',
};

async function tokenFor(supabase: SupabaseClient, apiKeyId: string | null): Promise<string | null> {
  if (!apiKeyId) return null;
  const { data: key } = await supabase.from('api_keys').select('key_encrypted, metadata').eq('id', apiKeyId).maybeSingle();
  if (!key) return null;
  try {
    return (await credentialsFromKeyRow(key)).authToken;
  } catch {
    return null;
  }
}

async function handleStatus(supabase: SupabaseClient, req: Request, form: URLSearchParams) {
  const sid = form.get('MessageSid');
  const status = (form.get('MessageStatus') || '').toLowerCase();
  if (!sid) return twiml();

  const { data: log } = await supabase
    .from('messaging_send_log')
    .select('id, organization_id, sender_id, contact_id, to_address, channel, status')
    .eq('provider_message_id', sid)
    .maybeSingle();
  if (!log) return twiml(); // not one of ours (or sent outside ACA)

  const { data: sender } = await supabase.from('messaging_senders').select('api_key_id').eq('id', log.sender_id).maybeSingle();
  const token = await tokenFor(supabase, sender?.api_key_id ?? null);
  if (!token || !(await validTwilioSignature(token, statusCallbackUrl(), form, req.headers.get('X-Twilio-Signature')))) {
    console.warn(`[twilio-webhook] bad signature on status for ${sid}`);
    return twiml(403);
  }

  const errorCode = form.get('ErrorCode');
  const update: Record<string, unknown> = { status: LOG_STATUS[status] ?? log.status };
  if (errorCode) update.error_code = errorCode;
  await supabase.from('messaging_send_log').update(update).eq('id', log.id);

  const crmStatus = CRM_STATUS[status];
  if (crmStatus) {
    const now = new Date().toISOString();
    await supabase
      .from('crm_messages')
      .update({
        status: crmStatus,
        status_updated_at: now,
        ...(crmStatus === 'delivered' ? { delivered_at: now } : {}),
        ...(crmStatus === 'failed' && errorCode ? { error_message: `Twilio error ${errorCode}` } : {}),
      })
      .eq('organization_id', log.organization_id)
      .eq('external_message_id', sid);
  }

  // 21610: the number has opted out at the carrier/Twilio level
  if (errorCode === '21610') {
    await recordOptOut(supabase, {
      organizationId: log.organization_id, phoneE164: log.to_address, channel: log.channel,
      source: 'carrier', contactId: log.contact_id, note: 'Twilio 21610',
    });
  }
  return twiml();
}

async function findOrCreateContact(
  supabase: SupabaseClient,
  organizationId: string,
  from: string,
  displayName: string | null,
): Promise<string | null> {
  const { data: phones } = await supabase
    .from('crm_contact_phones')
    .select('contact_id')
    .eq('organization_id', organizationId)
    .eq('phone_e164', from)
    .limit(5);
  const ids = (phones ?? []).map((p) => p.contact_id);
  if (ids.length > 1) {
    // Several contacts share the number: the one already texting with us
    const { data: conv } = await supabase
      .from('crm_conversations')
      .select('contact_id')
      .eq('organization_id', organizationId)
      .in('channel', ['sms', 'whatsapp'])
      .in('contact_id', ids)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (conv) return conv.contact_id;
  }
  if (ids.length > 0) return ids[0];

  // Unknown number: create a contact so the message reaches the inbox
  const { data: contact, error } = await supabase
    .from('crm_contacts')
    .insert({ organization_id: organizationId, display_name: displayName || from, primary_phone: from, source: 'sms_inbound' })
    .select('id')
    .single();
  if (error || !contact) {
    console.error('[twilio-webhook] contact create failed:', error?.message);
    return null;
  }
  const normalized = normalizePhone(from);
  if (normalized) {
    await supabase.from('crm_contact_phones').upsert({
      contact_id: contact.id, organization_id: organizationId, ...normalized, normalized_at: new Date().toISOString(),
    }, { onConflict: 'contact_id' });
  }
  return contact.id;
}

/** Stop (or just mark) the contact's active campaigns, as the Unipile webhook does. */
async function recordCampaignReply(
  supabase: SupabaseClient,
  contactId: string,
  messageSid: string,
  text: string,
  stopAll: boolean,
  channel: 'sms' | 'whatsapp',
) {
  const { data: progress } = await supabase
    .from('campaign_lead_progress')
    .select('id, campaign_id, linkedin_campaigns!inner ( id, stop_on_reply )')
    .eq('contact_id', contactId)
    .in('status', ['pending', 'in_progress', 'waiting']);

  for (const p of progress ?? []) {
    const campaign = p.linkedin_campaigns as unknown as { id: string; stop_on_reply?: boolean };
    const stop = stopAll || campaign.stop_on_reply !== false;
    if (stop) {
      await supabase
        .from('campaign_lead_progress')
        .update({ status: 'replied', replied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', p.id);
    } else {
      const { data: prior } = await supabase
        .from('campaign_action_log')
        .select('id')
        .eq('progress_id', p.id)
        .eq('action_type', 'reply_detected')
        .limit(1)
        .maybeSingle();
      if (prior) continue;
    }
    await supabase.from('campaign_action_log').insert({
      campaign_id: p.campaign_id,
      progress_id: p.id,
      contact_id: contactId,
      node_id: 'system_reply_detected',
      node_type: 'system',
      action_type: 'reply_detected',
      channel,
      status: 'success',
      external_id: messageSid,
      executed_at: new Date().toISOString(),
      message_content: text.substring(0, 500),
    });
  }
}

async function runAutopilot(
  supabase: SupabaseClient,
  params: { organizationId: string; contactId: string; conversationId: string; messageId: string; text: string; channel: 'sms' | 'whatsapp' },
): Promise<boolean> {
  const { data: conversation } = await supabase
    .from('crm_conversations')
    .select('ai_enabled, metadata')
    .eq('id', params.conversationId)
    .single();
  if (!conversation?.ai_enabled) return false;

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', params.organizationId)
    .eq('provider', 'openrouter')
    .maybeSingle();
  const openRouterKey = keyRow?.key_encrypted ? await decryptApiKey(keyRow.key_encrypted, Deno.env.get('ENCRYPTION_KEY')!) : '';

  let intent = 'neutral';
  let confidence = 0.5;
  if (openRouterKey) {
    try {
      const classification = await classifyReply({ from_email: '', subject: '', body_text: params.text }, openRouterKey);
      intent = classification.intent;
      confidence = classification.confidence;
    } catch (err) {
      console.warn('[twilio-webhook] classification failed, defaulting to neutral:', err);
    }
  }

  await processAutopilot(supabase, {
    conversationId: params.conversationId,
    contactId: params.contactId,
    organizationId: params.organizationId,
    intent,
    confidence,
    inboundMessageId: params.messageId,
    channel: params.channel,
    messageContent: params.text,
    leadMagnetCampaignId: (conversation.metadata as Record<string, string> | null)?.lead_magnet_campaign_id || undefined,
  }, openRouterKey);
  return true;
}

async function handleInbound(supabase: SupabaseClient, req: Request, form: URLSearchParams) {
  const accountSid = form.get('AccountSid');
  const messageSid = form.get('MessageSid') || form.get('SmsSid');
  const isWhatsApp = (form.get('From') || '').startsWith('whatsapp:');
  const to = (form.get('To') || '').replace(/^whatsapp:/, '');
  const fromRaw = (form.get('From') || '').replace(/^whatsapp:/, '');
  // Quick-reply taps arrive with the button's text in Body and its id in ButtonPayload
  const buttonText = form.get('ButtonText');
  const text = form.get('Body') || buttonText || '';
  if (!accountSid || !messageSid || !to || !fromRaw) return twiml(400);

  const senderChannel = isWhatsApp ? 'whatsapp_business' : 'sms';
  const threadChannel = isWhatsApp ? 'whatsapp' : 'sms';
  const from = normalizePhone(fromRaw)?.phone_e164 ?? fromRaw;

  // The same number can be connected in several orgs: file the message in each
  const { data: senders } = await supabase
    .from('messaging_senders')
    .select('id, organization_id, api_key_id')
    .eq('channel', senderChannel)
    .eq('address', to);
  if (!senders || senders.length === 0) {
    console.warn(`[twilio-webhook] inbound to unknown number ${to}`);
    return twiml();
  }

  let verified = false;
  for (const sender of senders) {
    const token = await tokenFor(supabase, sender.api_key_id);
    if (!token || !(await validTwilioSignature(token, statusCallbackUrl(), form, req.headers.get('X-Twilio-Signature')))) continue;
    verified = true;
    const organizationId = sender.organization_id;

    const contactId = await findOrCreateContact(supabase, organizationId, from, form.get('ProfileName'));
    if (!contactId) continue;

    // Meta's marketing opt-out button reads "Stop promotions"
    const keyword = buttonText && /stop/i.test(buttonText) ? 'stop' : optKeyword(text);
    if (keyword === 'stop') {
      await recordOptOut(supabase, {
        organizationId, phoneE164: from, channel: senderChannel,
        source: buttonText ? 'button' : 'keyword', contactId, note: text.slice(0, 100),
      });
    } else if (keyword === 'start') {
      await supabase.from('channel_opt_outs').delete().eq('organization_id', organizationId).eq('phone_e164', from).eq('channel', senderChannel);
    }

    const conversationId = await ensureTwilioConversation(supabase, organizationId, contactId, sender.id, from, threadChannel);
    if (!conversationId) continue;

    const { data: existing } = await supabase
      .from('crm_messages')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('external_message_id', messageSid)
      .maybeSingle();
    if (existing) continue; // Twilio retried a delivery we already filed

    const { data: message, error } = await supabase
      .from('crm_messages')
      .insert({
        organization_id: organizationId,
        conversation_id: conversationId,
        contact_id: contactId,
        direction: 'inbound',
        sender_type: 'contact',
        content: text,
        content_type: 'text',
        external_message_id: messageSid,
        external_thread_id: from,
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        metadata: {
          source: 'twilio_webhook',
          channel: threadChannel,
          provider: 'twilio',
          to,
          num_media: form.get('NumMedia') ?? '0',
          ...(buttonText ? { button_text: buttonText, button_payload: form.get('ButtonPayload') } : {}),
          ...(form.get('ProfileName') ? { profile_name: form.get('ProfileName') } : {}),
        },
      })
      .select('id')
      .single();
    if (error || !message) {
      console.error('[twilio-webhook] message insert failed:', error?.message);
      continue;
    }

    // A STOP always ends every campaign for the contact, whatever stop_on_reply says
    await recordCampaignReply(supabase, contactId, messageSid, text, keyword === 'stop', threadChannel);

    if (keyword !== 'stop') {
      try {
        await runAutopilot(supabase, { organizationId, contactId, conversationId, messageId: message.id, text, channel: threadChannel });
      } catch (err) {
        console.error('[twilio-webhook] autopilot failed:', err);
      }
      try {
        await supabase.functions.invoke('evaluate-rules', {
          body: {
            organizationId,
            triggerType: 'message_received',
            contactId,
            triggerData: { messageContent: text, messageChannel: threadChannel, externalMessageId: messageSid },
          },
        });
      } catch (err) {
        console.error('[twilio-webhook] rule evaluation failed:', err);
      }
    }
  }

  if (!verified) {
    console.warn(`[twilio-webhook] bad signature on inbound ${messageSid} to ${to}`);
    return twiml(403);
  }
  return twiml();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await req.text());
  } catch {
    return twiml(400);
  }

  try {
    const status = form.get('MessageStatus');
    if (status && status.toLowerCase() !== 'received') return await handleStatus(supabase, req, form);
    return await handleInbound(supabase, req, form);
  } catch (err) {
    console.error('[twilio-webhook] error:', err);
    // 500 makes Twilio retry; fine for transient DB errors
    return twiml(500);
  }
});
