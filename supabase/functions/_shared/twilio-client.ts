/**
 * Minimal Twilio REST client (fetch + basic auth): account check and sender
 * discovery for messaging_senders. Sending comes with Phase 2 of
 * tasks/sms-whatsapp-business-2026-10-25.md.
 *
 * Credentials are an org's Account SID + Auth Token, stored in api_keys
 * (provider = 'twilio', key_encrypted = token, metadata.account_sid).
 */
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1/max';
import { decryptApiKey } from './unipile-client.ts';

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

export class TwilioError extends Error {
  /** Twilio error code (21610 = recipient opted out, 21211 = invalid number, …) */
  code: number | null = null;
  constructor(message: string, public status: number) {
    super(message);
  }
}

const API = 'https://api.twilio.com/2010-04-01';
const MESSAGING_V1 = 'https://messaging.twilio.com/v1';
const MESSAGING_V2 = 'https://messaging.twilio.com/v2';

async function twilioGet(creds: TwilioCredentials, url: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    let message = `Twilio ${res.status}`;
    try {
      const body = await res.json();
      message = body.message || message;
    } catch { /* non-JSON error body */ }
    if (res.status === 401) message = 'Invalid Account SID or Auth Token';
    throw new TwilioError(message, res.status);
  }
  return res.json();
}

/** Follows Twilio's two pagination styles (next_page_uri on 2010 API, meta.next_page_url elsewhere). */
async function getAllPages(creds: TwilioCredentials, firstUrl: string, listKey: string): Promise<any[]> {
  const items: any[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < 50; page++) {
    const body = await twilioGet(creds, url);
    items.push(...(body[listKey] ?? []));
    url = body.next_page_uri
      ? `https://api.twilio.com${body.next_page_uri}`
      : body.meta?.next_page_url ?? null;
  }
  return items;
}

export async function fetchAccount(creds: TwilioCredentials): Promise<{ sid: string; friendly_name: string; status: string; type: string }> {
  return twilioGet(creds, `${API}/Accounts/${encodeURIComponent(creds.accountSid)}.json`);
}

export interface DiscoveredSender {
  channel: 'sms' | 'whatsapp_business';
  address: string;
  address_type: 'long_code' | 'short_code' | 'toll_free' | 'alphanumeric' | 'whatsapp';
  country: string | null;
  provider_sender_id: string;
  messaging_service_sid: string | null;
  two_way: boolean;
  status: 'active' | 'pending' | 'error';
  status_detail: string | null;
  wa_display_name?: string | null;
  wa_quality_rating?: string | null;
  wa_messaging_limit?: string | null;
  metadata: Record<string, unknown>;
}

function numberInfo(e164: string): { country: string | null; tollFree: boolean } {
  const parsed = parsePhoneNumberFromString(e164);
  return { country: parsed?.country ?? null, tollFree: parsed?.getType() === 'TOLL_FREE' };
}

// Twilio WhatsApp sender statuses → messaging_senders.status
function whatsappStatus(status: string): DiscoveredSender['status'] {
  if (status === 'ONLINE' || status === 'ONLINE:UPDATING') return 'active';
  if (status === 'OFFLINE') return 'error';
  return 'pending';
}

/**
 * Every SMS-capable number, alphanumeric sender ID (on Messaging Services) and
 * WhatsApp sender on the account. A section that fails (e.g. WhatsApp not enabled)
 * is reported in `warnings` instead of failing the whole import.
 */
export async function discoverSenders(creds: TwilioCredentials): Promise<{ senders: DiscoveredSender[]; warnings: string[] }> {
  const senders: DiscoveredSender[] = [];
  const warnings: string[] = [];
  const acct = encodeURIComponent(creds.accountSid);

  try {
    const numbers = await getAllPages(creds, `${API}/Accounts/${acct}/IncomingPhoneNumbers.json?PageSize=1000`, 'incoming_phone_numbers');
    for (const n of numbers) {
      if (!n.capabilities?.sms) continue;
      const { country, tollFree } = numberInfo(n.phone_number);
      senders.push({
        channel: 'sms',
        address: n.phone_number,
        address_type: tollFree ? 'toll_free' : 'long_code',
        country,
        provider_sender_id: n.sid,
        messaging_service_sid: null,
        two_way: true,
        status: 'active',
        status_detail: null,
        metadata: { friendly_name: n.friendly_name, capabilities: n.capabilities, sms_url: n.sms_url || null },
      });
    }
  } catch (err) {
    warnings.push(`Phone numbers: ${(err as Error).message}`);
  }

  try {
    const shortCodes = await getAllPages(creds, `${API}/Accounts/${acct}/SMS/ShortCodes.json?PageSize=1000`, 'short_codes');
    for (const s of shortCodes) {
      senders.push({
        channel: 'sms',
        address: s.short_code,
        address_type: 'short_code',
        country: null,
        provider_sender_id: s.sid,
        messaging_service_sid: null,
        two_way: true,
        status: 'active',
        status_detail: null,
        metadata: { friendly_name: s.friendly_name },
      });
    }
  } catch (err) {
    warnings.push(`Short codes: ${(err as Error).message}`);
  }

  try {
    const services = await getAllPages(creds, `${MESSAGING_V1}/Services?PageSize=100`, 'services');
    for (const svc of services) {
      const alphas = await getAllPages(creds, `${MESSAGING_V1}/Services/${svc.sid}/AlphaSenders?PageSize=100`, 'alpha_senders');
      for (const a of alphas) {
        senders.push({
          channel: 'sms',
          address: a.alpha_sender,
          address_type: 'alphanumeric',
          country: null,
          provider_sender_id: a.sid,
          messaging_service_sid: svc.sid,
          two_way: false, // recipients can't reply to a name
          status: 'active',
          status_detail: null,
          metadata: { messaging_service_name: svc.friendly_name },
        });
      }
    }
  } catch (err) {
    warnings.push(`Alphanumeric senders: ${(err as Error).message}`);
  }

  try {
    const waSenders = await getAllPages(creds, `${MESSAGING_V2}/Channels/Senders?Channel=whatsapp&PageSize=100`, 'senders');
    for (const s of waSenders) {
      const e164 = String(s.sender_id ?? '').replace(/^whatsapp:/, '');
      if (!e164) continue;
      senders.push({
        channel: 'whatsapp_business',
        address: e164,
        address_type: 'whatsapp',
        country: numberInfo(e164).country,
        provider_sender_id: s.sid,
        messaging_service_sid: null,
        two_way: true,
        status: whatsappStatus(s.status),
        status_detail: s.status === 'ONLINE' ? null : s.status,
        wa_display_name: s.profile?.name ?? null,
        wa_quality_rating: s.properties?.quality_rating ?? null,
        wa_messaging_limit: s.properties?.messaging_limit ?? null,
        metadata: { twilio_status: s.status, offline_reasons: s.offline_reasons ?? null },
      });
    }
  } catch (err) {
    warnings.push(`WhatsApp senders: ${(err as Error).message}`);
  }

  return { senders, warnings };
}

/** Point a number's incoming-SMS webhook at ACA (POST). */
export async function setNumberSmsUrl(creds: TwilioCredentials, numberSid: string, url: string): Promise<void> {
  const res = await fetch(`${API}/Accounts/${encodeURIComponent(creds.accountSid)}/IncomingPhoneNumbers/${numberSid}.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ SmsUrl: url, SmsMethod: 'POST' }),
  });
  if (!res.ok) throw new TwilioError(`Setting the SMS webhook failed (${res.status})`, res.status);
}

/** Decrypt a stored api_keys row (provider = 'twilio'). */
export async function credentialsFromKeyRow(row: { key_encrypted: string; metadata: Record<string, any> | null }): Promise<TwilioCredentials> {
  const accountSid = row.metadata?.account_sid;
  if (!accountSid) throw new Error('Twilio key has no account_sid');
  const authToken = await decryptApiKey(row.key_encrypted, Deno.env.get('ENCRYPTION_KEY')!);
  return { accountSid, authToken };
}

export interface TwilioSendParams {
  to: string;              // E.164, or whatsapp:+E.164
  body?: string;
  from?: string;           // E.164 / alphanumeric ID / whatsapp:+E.164
  messagingServiceSid?: string | null;
  contentSid?: string;     // WhatsApp template (HX…)
  contentVariables?: Record<string, string>;
  statusCallback?: string;
}

export interface TwilioMessage {
  sid: string;
  status: string;
  num_segments?: string;
  error_code?: number | null;
  error_message?: string | null;
}

/** POST /Messages. Throws TwilioError with Twilio's code in `code` on rejection. */
export async function sendTwilioMessage(creds: TwilioCredentials, params: TwilioSendParams): Promise<TwilioMessage> {
  const form = new URLSearchParams({ To: params.to });
  if (params.messagingServiceSid) form.set('MessagingServiceSid', params.messagingServiceSid);
  if (params.from) form.set('From', params.from);
  if (params.body !== undefined) form.set('Body', params.body);
  if (params.contentSid) form.set('ContentSid', params.contentSid);
  if (params.contentVariables) form.set('ContentVariables', JSON.stringify(params.contentVariables));
  if (params.statusCallback) form.set('StatusCallback', params.statusCallback);

  const res = await fetch(`${API}/Accounts/${encodeURIComponent(creds.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new TwilioError(body.message || `Twilio ${res.status}`, res.status);
    err.code = body.code ?? null;
    throw err;
  }
  return body as TwilioMessage;
}

/**
 * X-Twilio-Signature check: base64(HMAC-SHA1(authToken, url + sorted form key/values)).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export async function validTwilioSignature(
  authToken: string,
  url: string,
  params: URLSearchParams,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const keys = [...new Set([...params.keys()])].sort();
  let data = url;
  for (const key of keys) for (const value of params.getAll(key)) data += key + value;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── WhatsApp templates (Content API) and sender webhooks ─────────────────────

const CONTENT_V1 = 'https://content.twilio.com/v1';

async function twilioJson(creds: TwilioCredentials, method: string, url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new TwilioError(data.message || `Twilio ${res.status}`, res.status);
    err.code = data.code ?? null;
    throw err;
  }
  return data;
}

export interface ContentTemplateInput {
  friendlyName: string;
  language: string;
  body: string;
  /** Sample value per slot ("1" → "Marie"); Meta reviews templates with these. */
  sampleVariables: Record<string, string>;
  /** Quick-reply buttons (max 3 for marketing): title shown, id returned as ButtonPayload. */
  buttons: { title: string; id: string }[];
}

export async function createContentTemplate(creds: TwilioCredentials, input: ContentTemplateInput): Promise<string> {
  const types = input.buttons.length > 0
    ? { 'twilio/quick-reply': { body: input.body, actions: input.buttons } }
    : { 'twilio/text': { body: input.body } };
  const data = await twilioJson(creds, 'POST', `${CONTENT_V1}/Content`, {
    friendly_name: input.friendlyName,
    language: input.language,
    variables: input.sampleVariables,
    types,
  });
  return data.sid as string;
}

export async function submitWhatsAppApproval(
  creds: TwilioCredentials,
  contentSid: string,
  name: string,
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION',
): Promise<{ status: string; rejection_reason: string | null }> {
  const data = await twilioJson(creds, 'POST', `${CONTENT_V1}/Content/${contentSid}/ApprovalRequests/WhatsApp`, { name, category });
  return { status: data.status ?? 'received', rejection_reason: data.rejection_reason || null };
}

export async function fetchWhatsAppApproval(
  creds: TwilioCredentials,
  contentSid: string,
): Promise<{ name: string | null; category: string | null; status: string; rejection_reason: string | null }> {
  const data = await twilioJson(creds, 'GET', `${CONTENT_V1}/Content/${contentSid}/ApprovalRequests`);
  const wa = data?.whatsapp ?? {};
  return {
    name: wa.name ?? null,
    category: wa.category ?? null,
    status: wa.status ?? 'unsubmitted',
    rejection_reason: wa.rejection_reason || null,
  };
}

export interface ContentItem {
  sid: string;
  friendly_name: string;
  language: string;
  variables: Record<string, string> | null;
  types: Record<string, { body?: string; actions?: { title: string; id?: string }[] }>;
}

export async function listContentTemplates(creds: TwilioCredentials): Promise<ContentItem[]> {
  const items: ContentItem[] = [];
  let url: string | null = `${CONTENT_V1}/Content?PageSize=500`;
  for (let page = 0; url && page < 10; page++) {
    const data = await twilioJson(creds, 'GET', url);
    items.push(...(data.contents ?? []));
    url = data.meta?.next_page_url ?? null;
  }
  return items;
}

export async function deleteContentTemplate(creds: TwilioCredentials, contentSid: string): Promise<void> {
  await twilioJson(creds, 'DELETE', `${CONTENT_V1}/Content/${contentSid}`);
}

/** WhatsApp sender's incoming-message and status webhooks. */
export async function fetchWhatsAppSenderWebhook(creds: TwilioCredentials, senderSid: string): Promise<{ callback_url: string | null }> {
  const data = await twilioJson(creds, 'GET', `${MESSAGING_V2}/Channels/Senders/${senderSid}`);
  return { callback_url: data?.webhook?.callback_url || null };
}

export async function setWhatsAppSenderWebhook(creds: TwilioCredentials, senderSid: string, url: string): Promise<void> {
  await twilioJson(creds, 'POST', `${MESSAGING_V2}/Channels/Senders/${senderSid}`, {
    webhook: { callback_url: url, callback_method: 'POST', status_callback_url: url, status_callback_method: 'POST' },
  });
}
