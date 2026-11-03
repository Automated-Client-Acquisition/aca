/**
 * WhatsApp Business Platform sends through an org's Twilio WhatsApp senders.
 *
 * Meta's rule: a business can only start (or restart) a conversation with an
 * approved template. Free-form text is allowed for 24 hours after the contact's
 * last message (the "customer service window"). Campaign steps therefore send
 * templates; inbox replies and autopilot send free text inside the window only.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { NormalizedPhone } from '../phone.ts';
import { sendTwilioMessage, TwilioError, type TwilioCredentials } from '../twilio-client.ts';
import { isSendAllowed, nextSendWindow, rulesFor } from './country-rules.ts';
import {
  ensureTwilioConversation,
  isOptedOut,
  loadSender,
  NON_MOBILE_LINE_TYPES,
  recordOptOut,
  resolveContactPhone,
  statusCallbackUrl,
  type ContactForPhone,
  type MessagingSenderRow,
  type SendLogContext,
} from './sms.ts';

export const WINDOW_MS = 24 * 60 * 60 * 1000;

// Twilio WhatsApp error codes: https://www.twilio.com/docs/api/errors
const WA_NOT_ON_WHATSAPP = new Set([63003, 63024]);
const WA_USER_MARKETING_LIMIT = new Set([63049]); // Meta's per-user marketing cap: skip, not a failure
const WA_RATE_LIMITED = new Set([63018, 20429]);
const WA_TEMPLATE_PROBLEM = new Set([63016, 63027, 63028, 63040, 63041, 63042]);

/** "{{1}} … {{2}}" → ["1", "2"] (each slot once, numeric order). */
export function templateSlots(body: string): string[] {
  const slots = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) slots.add(m[1]);
  return [...slots].sort((a, b) => Number(a) - Number(b));
}

export function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, slot) => values[slot] ?? '');
}

export interface ContactForTemplate extends ContactForPhone {
  first_name?: string | null;
  last_name?: string | null;
  display_name?: string | null;
  company?: string | null;
  job_title?: string | null;
  city?: string | null;
  email?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

/** Contact fields a template slot can map to (the builder shows the same list). */
function fieldValue(contact: ContactForTemplate, field: string): string {
  if (field.startsWith('text:')) return field.slice(5);
  if (field.startsWith('custom_')) {
    const v = contact.custom_fields?.[field.slice(7)];
    return v === null || v === undefined ? '' : String(v);
  }
  switch (field) {
    case 'first_name': return contact.first_name || '';
    case 'last_name': return contact.last_name || '';
    case 'full_name': return [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.display_name || '';
    case 'company': return contact.company || '';
    case 'job_title': return contact.job_title || '';
    case 'city': return contact.city || '';
    case 'country': return contact.country || '';
    case 'email': return contact.email || '';
    default: return '';
  }
}

/** Slot values for one contact, or the first slot that has no value (Meta rejects empty parameters). */
export function templateValues(
  body: string,
  mapping: Record<string, string>,
  contact: ContactForTemplate,
): { values: Record<string, string> } | { missing: string } {
  const values: Record<string, string> = {};
  for (const slot of templateSlots(body)) {
    const field = mapping[slot];
    const value = field ? fieldValue(contact, field).trim() : '';
    if (!value) return { missing: `{{${slot}}}${field ? ` (${field})` : ''}` };
    values[slot] = value;
  }
  return { values };
}

/** Is the 24h customer service window open on this conversation? */
export async function whatsappWindowOpen(supabase: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('crm_messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return !!data && Date.now() - new Date(data.created_at).getTime() < WINDOW_MS;
}

/** "1K Customers/24hr" → 1000, "Unlimited" → Infinity, unknown → 250 (Meta's starting tier). */
export function parseMessagingLimit(limit: string | null): number {
  if (!limit) return 250;
  if (/unlimited/i.test(limit)) return Infinity;
  const m = limit.match(/([\d.]+)\s*([KkMm]?)/);
  if (!m) return 250;
  return Number(m[1]) * (m[2].toUpperCase() === 'K' ? 1_000 : m[2].toUpperCase() === 'M' ? 1_000_000 : 1);
}

export async function sendWhatsAppFrom(
  supabase: SupabaseClient,
  sender: MessagingSenderRow,
  creds: TwilioCredentials,
  to: string,
  content: { body: string } | { contentSid: string; variables: Record<string, string> },
  ctx: SendLogContext,
): Promise<{ sid: string }> {
  const { data: log } = await supabase
    .from('messaging_send_log')
    .insert({
      organization_id: ctx.organizationId,
      sender_id: sender.id,
      contact_id: ctx.contactId,
      channel: 'whatsapp_business',
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
      to: `whatsapp:${to}`,
      from: `whatsapp:${sender.address}`,
      ...('body' in content ? { body: content.body } : { contentSid: content.contentSid, contentVariables: content.variables }),
      statusCallback: statusCallbackUrl(),
    });
    if (log) await supabase.from('messaging_send_log').update({ provider_message_id: msg.sid, status: 'queued' }).eq('id', log.id);
    return { sid: msg.sid };
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

async function isFirstWhatsApp(supabase: SupabaseClient, organizationId: string, to: string): Promise<boolean> {
  const { data } = await supabase
    .from('messaging_send_log')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('channel', 'whatsapp_business')
    .eq('to_address', to)
    .limit(1);
  return (data?.length ?? 0) === 0;
}

async function businessInitiatedLast24h(supabase: SupabaseClient, senderId: string): Promise<{ newContacts: number; all: number }> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const [{ count: newContacts }, { count: all }] = await Promise.all([
    supabase.from('messaging_send_log').select('id', { count: 'exact', head: true })
      .eq('sender_id', senderId).eq('new_contact', true).gte('created_at', since),
    supabase.from('messaging_send_log').select('id', { count: 'exact', head: true })
      .eq('sender_id', senderId).eq('source', 'campaign').gte('created_at', since),
  ]);
  return { newContacts: newContacts ?? 0, all: all ?? 0 };
}

type WhatsAppSenderPick =
  | { kind: 'sender'; sender: MessagingSenderRow; newContact: boolean }
  | { kind: 'none'; reason: string }
  | { kind: 'capped' };

/**
 * The number already talking to this contact, else one from the contact's
 * country, else any. Passes over senders at their ACA daily new-contact cap or at
 * Meta's messaging limit (business-initiated conversations per 24h).
 */
async function pickWhatsAppSender(
  supabase: SupabaseClient,
  organizationId: string,
  contactId: string,
  to: NormalizedPhone & { phone_e164: string },
): Promise<WhatsAppSenderPick> {
  const { data: rows } = await supabase
    .from('messaging_senders')
    .select('id, organization_id, api_key_id, channel, address, address_type, country, messaging_service_sid, two_way, daily_new_contact_cap, status, wa_messaging_limit')
    .eq('organization_id', organizationId)
    .eq('channel', 'whatsapp_business')
    .eq('status', 'active');
  const senders = (rows ?? []) as (MessagingSenderRow & { wa_messaging_limit: string | null })[];
  if (senders.length === 0) return { kind: 'none', reason: 'No active WhatsApp Business sender. Register one in Twilio, then Sync senders.' };

  const { data: conv } = await supabase
    .from('crm_conversations')
    .select('messaging_sender_id, provider')
    .eq('organization_id', organizationId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .maybeSingle();
  const sticky = conv?.provider === 'twilio' ? senders.find((s) => s.id === conv.messaging_sender_id) : undefined;
  const newContact = await isFirstWhatsApp(supabase, organizationId, to.phone_e164);

  const ordered = [
    ...(sticky ? [sticky] : []),
    ...senders.filter((s) => s !== sticky && s.country === to.phone_country),
    ...senders.filter((s) => s !== sticky && s.country !== to.phone_country),
  ];
  for (const sender of ordered) {
    const usage = await businessInitiatedLast24h(supabase, sender.id);
    if (usage.all >= parseMessagingLimit(sender.wa_messaging_limit)) continue;
    if (newContact && usage.newContacts >= sender.daily_new_contact_cap) continue;
    return { kind: 'sender', sender, newContact };
  }
  return { kind: 'capped' };
}

export type CampaignWhatsAppOutcome =
  | { kind: 'sent'; sid: string; to: string; senderId: string; body: string }
  | { kind: 'skip'; reason: string }
  | { kind: 'defer'; reason: string; retryAt: Date }
  | { kind: 'fail'; reason: string };

/** whatsappTemplate node: every guard, then the template send. */
export async function sendCampaignWhatsAppTemplate(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    campaignId: string;
    progressId: string;
    contact: ContactForTemplate;
    templateId: string;
  },
): Promise<CampaignWhatsAppOutcome> {
  if (params.contact.status === 'unsubscribed' || params.contact.status === 'do_not_contact') {
    return { kind: 'skip', reason: 'Contact is unsubscribed' };
  }

  const { data: template } = await supabase
    .from('whatsapp_templates')
    .select('id, name, category, body, variables, provider_content_sid, approval_status')
    .eq('id', params.templateId)
    .eq('organization_id', params.organizationId)
    .maybeSingle();
  if (!template) return { kind: 'fail', reason: 'WhatsApp template not found. Pick one on the step.' };
  if (template.approval_status !== 'approved' || !template.provider_content_sid) {
    // Waiting for Meta is temporary; a rejected template needs the user
    if (template.approval_status === 'pending' || template.approval_status === 'submitted') {
      return { kind: 'defer', reason: `Template "${template.name}" is waiting for Meta approval`, retryAt: new Date(Date.now() + 60 * 60_000) };
    }
    return { kind: 'fail', reason: `Template "${template.name}" is ${template.approval_status}, not approved` };
  }

  const phone = await resolveContactPhone(supabase, params.contact);
  if (!phone || phone.status !== 'valid' || !phone.phone_e164) {
    return { kind: 'skip', reason: phone?.status === 'no_country' ? 'Phone number has no country code' : 'No usable phone number' };
  }
  if (phone.line_type && NON_MOBILE_LINE_TYPES.has(phone.line_type)) {
    return { kind: 'skip', reason: `Not a mobile number (${phone.line_type.toLowerCase().replace(/_/g, ' ')})` };
  }
  const to = phone as NormalizedPhone & { phone_e164: string };

  if (await isOptedOut(supabase, params.organizationId, to.phone_e164, 'whatsapp_business')) {
    return { kind: 'skip', reason: 'Contact opted out of WhatsApp' };
  }

  const marketing = template.category === 'marketing';
  if (marketing && !rulesFor(to.phone_country).whatsappMarketingAllowed) {
    return { kind: 'skip', reason: `Meta doesn't deliver WhatsApp marketing templates to ${to.phone_country} numbers` };
  }
  if (marketing && !isSendAllowed(to.phone_country)) {
    const retryAt = nextSendWindow(to.phone_country);
    if (!retryAt) return { kind: 'skip', reason: `No sending window for ${to.phone_country}` };
    return { kind: 'defer', reason: `Outside sending hours for ${to.phone_country ?? 'this country'}`, retryAt };
  }

  const filled = templateValues(template.body, template.variables ?? {}, params.contact);
  if ('missing' in filled) return { kind: 'skip', reason: `No value for ${filled.missing}` };

  const pick = await pickWhatsAppSender(supabase, params.organizationId, params.contact.id, to);
  if (pick.kind === 'none') return { kind: 'skip', reason: pick.reason };
  if (pick.kind === 'capped') {
    return { kind: 'defer', reason: 'Every WhatsApp sender is at its daily limit', retryAt: new Date(Date.now() + 60 * 60_000) };
  }

  const loaded = await loadSender(supabase, pick.sender.id);
  if (!loaded) return { kind: 'fail', reason: 'WhatsApp sender credentials missing. Reconnect Twilio.' };

  try {
    const { sid } = await sendWhatsAppFrom(supabase, loaded.sender, loaded.creds, to.phone_e164,
      { contentSid: template.provider_content_sid, variables: filled.values },
      {
        organizationId: params.organizationId,
        contactId: params.contact.id,
        source: 'campaign',
        campaignId: params.campaignId,
        progressId: params.progressId,
        newContact: pick.newContact,
      });
    await ensureTwilioConversation(supabase, params.organizationId, params.contact.id, loaded.sender.id, to.phone_e164, 'whatsapp');
    return { kind: 'sent', sid, to: to.phone_e164, senderId: loaded.sender.id, body: renderTemplate(template.body, filled.values) };
  } catch (err) {
    const code = err instanceof TwilioError ? err.code : null;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 21610) {
      await recordOptOut(supabase, { organizationId: params.organizationId, phoneE164: to.phone_e164, channel: 'whatsapp_business', source: 'carrier', contactId: params.contact.id, note: message });
      return { kind: 'skip', reason: 'Contact opted out of WhatsApp' };
    }
    if (code && WA_NOT_ON_WHATSAPP.has(code)) return { kind: 'skip', reason: 'Number is not on WhatsApp' };
    if (code && WA_USER_MARKETING_LIMIT.has(code)) return { kind: 'skip', reason: "Meta's per-user marketing limit: not delivered" };
    if ((code && WA_RATE_LIMITED.has(code)) || (err instanceof TwilioError && err.status === 429)) {
      return { kind: 'defer', reason: `Twilio rate limit: ${message}`, retryAt: new Date(Date.now() + 15 * 60_000) };
    }
    if (code && WA_TEMPLATE_PROBLEM.has(code)) return { kind: 'fail', reason: `Template rejected at send: ${message}` };
    if (err instanceof TwilioError && err.status === 401) {
      await supabase.from('api_keys').update({ is_valid: false }).eq('id', loaded.sender.api_key_id);
      return { kind: 'fail', reason: 'Twilio credentials rejected. Reconnect Twilio in Settings.' };
    }
    return { kind: 'fail', reason: `WhatsApp send failed: ${message}` };
  }
}
