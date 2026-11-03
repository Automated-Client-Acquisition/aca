/**
 * Channel checks behind the campaign builder's "If Channel Available" and "Route by Channel" nodes.
 *
 * Presence answers come from the same data the send steps use, so "available" means the step can
 * reach the lead: a LinkedIn identity or crm_contacts.linkedin_url, an email identity or
 * crm_contacts.email, an Instagram identity or
 * crm_contacts.instagram_url (or an instagram custom field), a WhatsApp identity or a
 * phone number with a country code, a normalised mobile number for SMS. The Unipile checks (profile found, already connected, WhatsApp
 * registered) need a sender account and run in campaign-processor. The entry checks read
 * campaign_lead_progress.entry_context, which admit_campaign_trigger_event writes for leads a
 * campaign trigger brought in.
 *
 * src/lib/sequence-utils.ts keeps the frontend copy of the check and channel lists.
 */

export type ContactCheck =
  | 'linkedinUrl'
  | 'linkedinOnUnipile'
  | 'linkedinConnected'
  | 'email'
  | 'instagram'
  | 'instagramOnUnipile'
  | 'phone'
  | 'whatsappRegistered'
  | 'smsMobile'
  | 'telegram'
  | 'senderConnected'
  | 'enteredViaTrigger'
  | 'enteredOnChannel';

export const CONTACT_CHECKS: readonly ContactCheck[] = [
  'linkedinUrl',
  'linkedinOnUnipile',
  'linkedinConnected',
  'email',
  'instagram',
  'instagramOnUnipile',
  'phone',
  'whatsappRegistered',
  'smsMobile',
  'telegram',
  'senderConnected',
  'enteredViaTrigger',
  'enteredOnChannel',
];

/** Checks that call Unipile through a sender account. */
export const UNIPILE_CHECKS: ReadonlySet<ContactCheck> = new Set([
  'linkedinOnUnipile',
  'linkedinConnected',
  'instagramOnUnipile',
  'whatsappRegistered',
]);

export const CONTACT_CHECK_LABELS: Record<ContactCheck, string> = {
  linkedinUrl: 'Has a LinkedIn URL',
  linkedinOnUnipile: 'LinkedIn profile found',
  linkedinConnected: 'Already connected on LinkedIn',
  email: 'Has an email',
  instagram: 'Has an Instagram handle',
  instagramOnUnipile: 'Instagram profile found',
  phone: 'Has a phone number',
  whatsappRegistered: 'On WhatsApp',
  smsMobile: 'Can receive SMS',
  telegram: 'Has Telegram',
  senderConnected: 'Sender connected',
  enteredViaTrigger: 'Came in through a trigger',
  enteredOnChannel: 'Came in on a channel',
};

export type RouteChannel = 'linkedin' | 'email' | 'instagram' | 'whatsapp' | 'telegram' | 'sms';

export const ROUTE_CHANNELS: readonly RouteChannel[] = ['linkedin', 'email', 'instagram', 'whatsapp', 'telegram', 'sms'];

/**
 * Channels whose sends go through a Unipile sender on the campaign. Email is left out: an email
 * branch can hand the lead to an email sequence, which sends from mailboxes, not Unipile.
 */
export const UNIPILE_SENDER_CHANNELS: readonly RouteChannel[] = ['linkedin', 'instagram', 'whatsapp', 'telegram'];

/** Route by Channel's exit for leads no listed channel can reach. */
export const ROUTE_NONE = 'none';

/** A check's answer. 'retry' means a sender outage blocked it; the lead waits and tries again. */
export type CheckOutcome = 'yes' | 'no' | 'retry';

export function isContactCheck(value: unknown): value is ContactCheck {
  return typeof value === 'string' && (CONTACT_CHECKS as readonly string[]).includes(value);
}

export function isRouteChannel(value: unknown): value is RouteChannel {
  return typeof value === 'string' && (ROUTE_CHANNELS as readonly string[]).includes(value);
}

/**
 * The check an "If Channel Available" node runs. Nodes saved before `check` existed carry only
 * `channel` (+ `checkRegistration` for WhatsApp); null means a channel with no matching check, which
 * keeps the old identity lookup.
 */
export function resolveContactCheck(data: Record<string, unknown>): ContactCheck | null {
  if (isContactCheck(data.check)) return data.check;
  switch (data.channel ?? 'email') {
    case 'linkedin':
      return 'linkedinUrl';
    case 'email':
      return 'email';
    case 'instagram':
      return 'instagram';
    case 'whatsapp':
      return data.checkRegistration === true ? 'whatsappRegistered' : 'phone';
    case 'telegram':
      return 'telegram';
    default:
      return null;
  }
}

/** Route by Channel's channels in priority order: known channels only, each once. */
export function routeChannels(data: Record<string, unknown>): RouteChannel[] {
  const raw = Array.isArray(data.channels) ? data.channels : [];
  return [...new Set(raw.filter(isRouteChannel))];
}

/** The trigger rule id a lead entered through, if a trigger brought it in. */
export function entryTriggerId(entry: unknown): string | null {
  const id = entryField(entry, 'trigger_id');
  return typeof id === 'string' && id ? id : null;
}

/** The channel a triggered lead reached out on (message, comment, invitation), if any. */
export function entryChannel(entry: unknown): RouteChannel | null {
  const channel = entryField(entry, 'channel');
  return isRouteChannel(channel) ? channel : null;
}

/** Entered through `triggerId`, or through any trigger when no trigger is picked. */
export function enteredViaTrigger(entry: unknown, triggerId: unknown): boolean {
  const entered = entryTriggerId(entry);
  if (!entered) return false;
  return typeof triggerId !== 'string' || !triggerId || entered === triggerId;
}

/**
 * Route by Channel's order for one lead. With entryChannelFirst, the channel a triggered lead
 * reached out on moves to the front, when the node lists it.
 */
export function routeOrder(data: Record<string, unknown>, entry: unknown): RouteChannel[] {
  const channels = routeChannels(data);
  const first = data.entryChannelFirst === true ? entryChannel(entry) : null;
  return first && channels.includes(first) ? [first, ...channels.filter((c) => c !== first)] : channels;
}

function entryField(entry: unknown, key: string): unknown {
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>)[key] : undefined;
}

/** Route by Channel's source handles: one per channel, then the no-channel exit. */
export function routeHandles(data: Record<string, unknown>): string[] {
  return [...routeChannels(data), ROUTE_NONE];
}

export interface ContactChannelFields {
  email?: string | null;
  linkedin_url?: string | null;
  phone?: string | null;
  /** crm_contacts.instagram_url: a profile URL, @handle or bare handle. */
  instagram_url?: string | null;
  custom_fields?: unknown;
  /** E.164 mobile number an SMS can go to (crm_contact_phones), resolved by the caller. */
  sms_phone?: string | null;
}

export interface ContactIdentityFields {
  channel: string;
  platform_user_id: string | null;
  platform_username?: string | null;
  platform_profile_url?: string | null;
}

/** Where a lead can be reached, from stored data only. */
export interface ContactReach {
  linkedinUrl: string | null;
  /** Unipile provider id, once the URL has been resolved. */
  linkedinId: string | null;
  email: string | null;
  instagramHandle: string | null;
  /** Messaging id, once the handle has been resolved. */
  instagramId: string | null;
  phone: string | null;
  /** WhatsApp user id: the stored identity, or a phone with a country code. */
  whatsappId: string | null;
  telegramId: string | null;
  /** Normalised mobile number for SMS (Twilio senders). */
  smsPhone: string | null;
}

export function contactReach(contact: ContactChannelFields, identities: ContactIdentityFields[]): ContactReach {
  const identity = (channel: string) => identities.find((i) => i.channel === channel && clean(i.platform_user_id));
  const linkedin = identity('linkedin');
  const instagram = identity('instagram');
  const whatsapp = identity('whatsapp');
  const telegram = identity('telegram');
  const email = identity('email');

  return {
    linkedinUrl: clean(contact.linkedin_url) || clean(linkedin?.platform_profile_url),
    linkedinId: clean(linkedin?.platform_user_id),
    email: clean(email?.platform_user_id) || clean(contact.email),
    instagramHandle: instagramUsername(contact.instagram_url)
      || instagramHandleFromCustomFields(contact.custom_fields)
      || instagramUsername(instagram?.platform_username),
    instagramId: clean(instagram?.platform_user_id),
    phone: clean(contact.phone),
    whatsappId: clean(whatsapp?.platform_user_id) || whatsappIdFromPhone(contact.phone),
    telegramId: clean(telegram?.platform_user_id),
    smsPhone: clean(contact.sms_phone),
  };
}

/** Presence check for one channel: can that channel's send step reach the lead? */
export function reachableOn(reach: ContactReach, channel: RouteChannel): boolean {
  switch (channel) {
    case 'linkedin':
      return !!(reach.linkedinId || reach.linkedinUrl);
    case 'email':
      return !!reach.email;
    case 'instagram':
      return !!(reach.instagramId || reach.instagramHandle);
    case 'whatsapp':
      return !!reach.whatsappId;
    case 'telegram':
      return !!reach.telegramId;
    case 'sms':
      return !!reach.smsPhone;
  }
}

/**
 * WhatsApp id for a phone written with its country code (+44…, 0044…). National numbers are
 * skipped: without a country code there is no safe way to build the id.
 */
export function whatsappIdFromPhone(phone: string | null | undefined): string | null {
  const raw = clean(phone);
  if (!raw) return null;
  const international = raw.startsWith('+') ? raw.slice(1) : raw.startsWith('00') ? raw.slice(2) : null;
  if (international === null) return null;
  const digits = international.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

// Keys a CSV import or the API would plausibly use: instagram, instagram_url, IG Handle, …
const INSTAGRAM_FIELD = /^(instagram|ig)([ _-]?(url|handle|username|profile))?$/i;

function instagramHandleFromCustomFields(customFields: unknown): string | null {
  if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) return null;
  for (const [key, value] of Object.entries(customFields as Record<string, unknown>)) {
    if (!INSTAGRAM_FIELD.test(key.trim()) || typeof value !== 'string') continue;
    const handle = instagramUsername(value);
    if (handle) return handle;
  }
  return null;
}

/** "@jane.doe", "jane.doe" or "https://www.instagram.com/jane.doe/" → "jane.doe". */
export function instagramUsername(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  const fromUrl = raw.match(/instagram\.com\/([^/?#\s]+)/i)?.[1];
  const handle = (fromUrl ?? raw).replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}
