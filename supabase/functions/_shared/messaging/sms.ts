/**
 * SMS sending through an org's Twilio senders (messaging_senders), shared by the
 * campaign processor (smsMessage node) and the channel router (inbox replies,
 * autopilot).
 *
 * Campaign sends go through every guard: usable mobile number, opt-outs, the
 * recipient country's sending window, sender choice by country, per-sender daily
 * cap on new contacts, opt-out wording. Inbox/autopilot replies only check
 * opt-outs: they answer someone who just wrote in.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { normalizePhone, type NormalizedPhone } from '../phone.ts';
import { credentialsFromKeyRow, sendTwilioMessage, TwilioError, type TwilioCredentials } from '../twilio-client.ts';
import { isSendAllowed, nextSendWindow, rulesFor, withOptOut } from './country-rules.ts';

export interface MessagingSenderRow {
  id: string;
  organization_id: string;
  api_key_id: string | null;
  channel: 'sms' | 'whatsapp_business';
  address: string;
  address_type: 'long_code' | 'short_code' | 'toll_free' | 'alphanumeric' | 'whatsapp';
  country: string | null;
  messaging_service_sid: string | null;
  two_way: boolean;
  daily_new_contact_cap: number;
  status: string;
}

const SENDER_COLUMNS = 'id, organization_id, api_key_id, channel, address, address_type, country, messaging_service_sid, two_way, daily_new_contact_cap, status';

// libphonenumber types that can't receive an SMS
export const NON_MOBILE_LINE_TYPES = new Set(['FIXED_LINE', 'TOLL_FREE', 'PREMIUM_RATE', 'SHARED_COST', 'UAN', 'VOICEMAIL', 'PAGER']);

// Twilio error codes: https://www.twilio.com/docs/api/errors
const TWILIO_OPTED_OUT = new Set([21610]);
const TWILIO_BAD_RECIPIENT = new Set([21211, 21612, 21614, 21408, 21659]);
const TWILIO_RATE_LIMITED = new Set([20429, 14107, 30022]);

export function statusCallbackUrl(): string {
  return `${Deno.env.get('SUPABASE_URL')}/functions/v1/twilio-webhook`;
}

export interface ContactForPhone {
  id: string;
  organization_id: string;
  primary_phone?: string | null;
  phone?: string | null;
  country?: string | null;
  company_id?: string | null;
  status?: string | null;
}

/** The contact's normalised phone, recomputed when the stored number changed. */
export async function resolveContactPhone(
  supabase: SupabaseClient,
  contact: ContactForPhone,
): Promise<NormalizedPhone | null> {
  const raw = (contact.primary_phone || contact.phone || '').trim();
  if (!raw) return null;

  const { data: cached } = await supabase
    .from('crm_contact_phones')
    .select('source_phone, status, phone_e164, phone_country, line_type, country_source')
    .eq('contact_id', contact.id)
    .maybeSingle();
  if (cached && cached.source_phone === raw) return cached as NormalizedPhone;

  let companyCountry: string | null = null;
  if (contact.company_id) {
    const { data: company } = await supabase.from('crm_companies').select('country').eq('id', contact.company_id).maybeSingle();
    companyCountry = company?.country ?? null;
  }
  const { data: key } = await supabase
    .from('api_keys')
    .select('metadata')
    .eq('organization_id', contact.organization_id)
    .eq('provider', 'twilio')
    .limit(1)
    .maybeSingle();

  const result = normalizePhone(raw, {
    contact: contact.country,
    company: companyCountry,
    orgDefault: (key?.metadata as Record<string, string> | null)?.default_country ?? null,
  });
  if (!result) return null;
  await supabase.from('crm_contact_phones').upsert({
    contact_id: contact.id,
    organization_id: contact.organization_id,
    ...result,
    normalized_at: new Date().toISOString(),
  }, { onConflict: 'contact_id' });
  return result;
}

/** E.164 number an SMS can reach, or null (landline, invalid, no country code). */
export function smsReachablePhone(phone: NormalizedPhone | null): string | null {
  if (!phone || phone.status !== 'valid' || !phone.phone_e164) return null;
  if (phone.line_type && NON_MOBILE_LINE_TYPES.has(phone.line_type)) return null;
  return phone.phone_e164;
}

export async function hasActiveSmsSender(supabase: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('messaging_senders')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('channel', 'sms')
    .eq('status', 'active')
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function isOptedOut(
  supabase: SupabaseClient,
  organizationId: string,
  phoneE164: string,
  channel: 'sms' | 'whatsapp_business',
): Promise<boolean> {
  const { data } = await supabase
    .from('channel_opt_outs')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('phone_e164', phoneE164)
    .in('channel', [channel, 'all'])
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function recordOptOut(
  supabase: SupabaseClient,
  params: { organizationId: string; phoneE164: string; channel: 'sms' | 'whatsapp_business' | 'all'; source: string; contactId?: string | null; note?: string },
) {
  await supabase.from('channel_opt_outs').upsert({
    organization_id: params.organizationId,
    phone_e164: params.phoneE164,
    channel: params.channel,
    source: params.source,
    contact_id: params.contactId ?? null,
    note: params.note ?? null,
  }, { onConflict: 'organization_id,phone_e164,channel', ignoreDuplicates: true });
}

export async function loadSender(
  supabase: SupabaseClient,
  senderId: string,
): Promise<{ sender: MessagingSenderRow; creds: TwilioCredentials } | null> {
  const { data: sender } = await supabase.from('messaging_senders').select(SENDER_COLUMNS).eq('id', senderId).maybeSingle();
  if (!sender || !sender.api_key_id) return null;
  const { data: key } = await supabase.from('api_keys').select('key_encrypted, metadata').eq('id', sender.api_key_id).maybeSingle();
  if (!key) return null;
  return { sender: sender as MessagingSenderRow, creds: await credentialsFromKeyRow(key) };
}

async function newContactSendsLast24h(supabase: SupabaseClient, senderId: string): Promise<number> {
  const { count } = await supabase
    .from('messaging_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', senderId)
    .eq('new_contact', true)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  return count ?? 0;
}

async function isFirstMessage(supabase: SupabaseClient, organizationId: string, channel: string, to: string): Promise<boolean> {
  const { data } = await supabase
    .from('messaging_send_log')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('channel', channel)
    .eq('to_address', to)
    .limit(1);
  return (data?.length ?? 0) === 0;
}

type SenderPick =
  | { kind: 'sender'; sender: MessagingSenderRow; newContact: boolean }
  | { kind: 'none'; reason: string }
  | { kind: 'capped' };

/**
 * Sender for a recipient: the number already texting this contact, else one from
 * the recipient's country, else an alphanumeric ID where carriers accept them,
 * else any number (international SMS). Senders over their daily new-contact cap
 * are passed over.
 */
export async function pickSmsSender(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  to: NormalizedPhone & { phone_e164: string },
): Promise<SenderPick> {
  const { data: rows } = await supabase
    .from('messaging_senders')
    .select(SENDER_COLUMNS)
    .eq('organization_id', organizationId)
    .eq('channel', 'sms')
    .eq('status', 'active');
  const senders = (rows ?? []) as MessagingSenderRow[];
  if (senders.length === 0) return { kind: 'none', reason: 'No active SMS sender. Connect Twilio in Settings.' };

  // Same number as the existing thread, so the contact sees one conversation
  const { data: conv } = await supabase
    .from('crm_conversations')
    .select('messaging_sender_id')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .eq('channel', 'sms')
    .maybeSingle();
  const sticky = senders.find((s) => s.id === conv?.messaging_sender_id);
  const newContact = await isFirstMessage(supabase, organizationId, 'sms', to.phone_e164);
  if (sticky && !newContact) return { kind: 'sender', sender: sticky, newContact: false };

  const rules = rulesFor(to.phone_country);
  const rank = (s: MessagingSenderRow): number => {
    if (s.address_type !== 'alphanumeric' && s.country === to.phone_country) return 0;
    if (s.address_type === 'alphanumeric' && rules.alphanumericAllowed) return 1;
    if (s.address_type === 'long_code' || s.address_type === 'toll_free') return 2;
    return -1; // short codes only reach their own country; alphanumeric where banned
  };
  const ranked = (sticky ? [sticky, ...senders.filter((s) => s !== sticky)] : senders)
    .filter((s) => rank(s) >= 0)
    .sort((a, b) => (a === sticky ? -1 : b === sticky ? 1 : rank(a) - rank(b)));
  if (ranked.length === 0) {
    return { kind: 'none', reason: `No SMS sender can reach ${to.phone_country ?? 'this country'}` };
  }

  if (!newContact) return { kind: 'sender', sender: ranked[0], newContact: false };
  for (const sender of ranked) {
    if ((await newContactSendsLast24h(supabase, sender.id)) < sender.daily_new_contact_cap) {
      return { kind: 'sender', sender, newContact: true };
    }
  }
  return { kind: 'capped' };
}

export interface SendLogContext {
  organizationId: string;
  contactId: string | null;
  source: 'campaign' | 'inbox' | 'autopilot' | 'test';
  campaignId?: string | null;
  progressId?: string | null;
  newContact: boolean;
}

/** Send one SMS from a sender and log it. Throws TwilioError when Twilio rejects it. */
export async function sendSmsFrom(
  supabase: SupabaseClient,
  sender: MessagingSenderRow,
  creds: TwilioCredentials,
  to: string,
  body: string,
  ctx: SendLogContext,
): Promise<{ sid: string; logId: string }> {
  const { data: log } = await supabase
    .from('messaging_send_log')
    .insert({
      organization_id: ctx.organizationId,
      sender_id: sender.id,
      contact_id: ctx.contactId,
      channel: 'sms',
      to_address: to,
      source: ctx.source,
      campaign_id: ctx.campaignId ?? null,
      progress_id: ctx.progressId ?? null,
      new_contact: ctx.newContact,
    })
    .select('id')
    .single();

  try {
    const msg = await sendTwilioMessage(creds, {
      to,
      body,
      // Alphanumeric IDs are sent through their Messaging Service
      ...(sender.messaging_service_sid
        ? { messagingServiceSid: sender.messaging_service_sid, from: sender.address_type === 'alphanumeric' ? sender.address : undefined }
        : { from: sender.address }),
      statusCallback: statusCallbackUrl(),
    });
    if (log) {
      await supabase
        .from('messaging_send_log')
        .update({ provider_message_id: msg.sid, status: msg.status === 'sent' ? 'sent' : 'queued', segments: msg.num_segments ? Number(msg.num_segments) : null })
        .eq('id', log.id);
    }
    return { sid: msg.sid, logId: log?.id ?? '' };
  } catch (err) {
    if (log) {
      await supabase
        .from('messaging_send_log')
        .update({
          status: 'failed',
          error_code: err instanceof TwilioError && err.code ? String(err.code) : null,
          error_message: err instanceof Error ? err.message : String(err),
        })
        .eq('id', log.id);
    }
    throw err;
  }
}

/**
 * Point the contact's thread on this channel at a Twilio sender (one thread per
 * org + contact + channel). SMS threads use channel 'sms'; WhatsApp Business ones
 * share channel 'whatsapp' with Unipile WhatsApp and are told apart by provider.
 */
export async function ensureTwilioConversation(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  senderId: string,
  phoneE164: string,
  channel: 'sms' | 'whatsapp',
): Promise<string | null> {
  const { data: conversationId } = await supabase.rpc('get_or_create_conversation', {
    p_org_id: organizationId,
    p_contact_id: contactId,
    p_channel: channel,
    p_channel_account_id: null,
    p_external_conversation_id: phoneE164,
    p_external_participant_id: phoneE164,
    p_mailbox_id: null,
  });
  if (conversationId) {
    await supabase
      .from('crm_conversations')
      .update({ provider: 'twilio', messaging_sender_id: senderId, external_participant_id: phoneE164 })
      .eq('id', conversationId);
  }
  return conversationId ?? null;
}

export function ensureSmsConversation(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  senderId: string,
  phoneE164: string,
): Promise<string | null> {
  return ensureTwilioConversation(supabase, organizationId, contactId, senderId, phoneE164, 'sms');
}

export type CampaignSmsOutcome =
  | { kind: 'sent'; sid: string; to: string; senderId: string; body: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'defer'; reason: string; retryAt: Date }
  | { kind: 'fail'; reason: string };

/** smsMessage node: every guard, then the send. */
export async function sendCampaignSms(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    campaignId: string;
    progressId: string;
    contact: ContactForPhone;
    message: string;
  },
): Promise<CampaignSmsOutcome> {
  if (params.contact.status === 'unsubscribed' || params.contact.status === 'do_not_contact') {
    return { kind: 'skip', reason: 'Contact is unsubscribed' };
  }
  const phone = await resolveContactPhone(supabase, params.contact);
  if (!phone || phone.status !== 'valid' || !phone.phone_e164) {
    return { kind: 'skip', reason: phone?.status === 'no_country' ? 'Phone number has no country code' : 'No usable phone number' };
  }
  if (phone.line_type && NON_MOBILE_LINE_TYPES.has(phone.line_type)) {
    return { kind: 'skip', reason: `Not a mobile number (${phone.line_type.toLowerCase().replace(/_/g, ' ')})` };
  }
  const to = phone as NormalizedPhone & { phone_e164: string };

  if (await isOptedOut(supabase, params.organizationId, to.phone_e164, 'sms')) {
    return { kind: 'skip', reason: 'Contact opted out of SMS' };
  }

  if (!isSendAllowed(to.phone_country)) {
    const retryAt = nextSendWindow(to.phone_country);
    if (!retryAt) return { kind: 'skip', reason: `No sending window for ${to.phone_country}` };
    return { kind: 'defer', reason: `Outside sending hours for ${to.phone_country ?? 'this country'}`, retryAt };
  }

  const pick = await pickSmsSender(supabase, params.organizationId, params.contact.id, to);
  if (pick.kind === 'none') return { kind: 'skip', reason: pick.reason };
  if (pick.kind === 'capped') {
    const retryAt = nextSendWindow(to.phone_country, new Date(Date.now() + 60 * 60_000)) ?? new Date(Date.now() + 60 * 60_000);
    return { kind: 'defer', reason: 'Daily new-contact limit reached on every SMS sender', retryAt };
  }

  const loaded = await loadSender(supabase, pick.sender.id);
  if (!loaded) return { kind: 'fail', reason: 'SMS sender credentials missing. Reconnect Twilio.' };

  const body = withOptOut(params.message, to.phone_country);
  try {
    const { sid } = await sendSmsFrom(supabase, loaded.sender, loaded.creds, to.phone_e164, body, {
      organizationId: params.organizationId,
      contactId: params.contact.id,
      source: 'campaign',
      campaignId: params.campaignId,
      progressId: params.progressId,
      newContact: pick.newContact,
    });
    await ensureSmsConversation(supabase, params.organizationId, params.contact.id, loaded.sender.id, to.phone_e164);
    return { kind: 'sent', sid, to: to.phone_e164, senderId: loaded.sender.id, body };
  } catch (err) {
    const code = err instanceof TwilioError ? err.code : null;
    const message = err instanceof Error ? err.message : String(err);
    if (code && TWILIO_OPTED_OUT.has(code)) {
      await recordOptOut(supabase, { organizationId: params.organizationId, phoneE164: to.phone_e164, channel: 'sms', source: 'carrier', contactId: params.contact.id, note: message });
      return { kind: 'skip', reason: 'Contact opted out of SMS (carrier)' };
    }
    if (code && TWILIO_BAD_RECIPIENT.has(code)) return { kind: 'skip', reason: `Twilio rejected the number: ${message}` };
    if ((code && TWILIO_RATE_LIMITED.has(code)) || (err instanceof TwilioError && err.status === 429)) {
      return { kind: 'defer', reason: `Twilio rate limit: ${message}`, retryAt: new Date(Date.now() + 15 * 60_000) };
    }
    if (err instanceof TwilioError && err.status === 401) {
      await supabase.from('api_keys').update({ is_valid: false }).eq('id', loaded.sender.api_key_id);
      return { kind: 'fail', reason: 'Twilio credentials rejected. Reconnect Twilio in Settings.' };
    }
    return { kind: 'fail', reason: `SMS send failed: ${message}` };
  }
}
