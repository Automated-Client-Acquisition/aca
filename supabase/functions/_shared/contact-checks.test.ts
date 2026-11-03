import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  contactReach,
  enteredViaTrigger,
  entryChannel,
  instagramUsername,
  reachableOn,
  resolveContactCheck,
  routeChannels,
  routeHandles,
  routeOrder,
  whatsappIdFromPhone,
} from './contact-checks.ts';

Deno.test('resolveContactCheck maps nodes saved before checks existed', () => {
  assertEquals(resolveContactCheck({ check: 'linkedinConnected', channel: 'email' }), 'linkedinConnected');
  assertEquals(resolveContactCheck({ channel: 'linkedin' }), 'linkedinUrl');
  assertEquals(resolveContactCheck({}), 'email');
  assertEquals(resolveContactCheck({ channel: 'whatsapp' }), 'phone');
  assertEquals(resolveContactCheck({ channel: 'whatsapp', checkRegistration: true }), 'whatsappRegistered');
  assertEquals(resolveContactCheck({ channel: 'messenger' }), null);
  assertEquals(resolveContactCheck({ check: 'bogus', channel: 'telegram' }), 'telegram');
});

Deno.test('routeChannels keeps known channels once, in order', () => {
  assertEquals(routeChannels({ channels: ['email', 'linkedin', 'email', 'fax', 'whatsapp'] }), ['email', 'linkedin', 'whatsapp']);
  assertEquals(routeChannels({}), []);
  assertEquals(routeHandles({ channels: ['instagram'] }), ['instagram', 'none']);
});

Deno.test('contactReach counts the columns the send steps fall back to', () => {
  const reach = contactReach(
    { email: ' jane@acme.com ', linkedin_url: 'https://linkedin.com/in/jane', phone: '(555) 010 2030', custom_fields: {} },
    [],
  );
  assertEquals(reach.email, 'jane@acme.com');
  assertEquals(reachableOn(reach, 'linkedin'), true);
  assertEquals(reachableOn(reach, 'email'), true);
  assertEquals(reach.phone, '(555) 010 2030');
  // A national number has no country code, so it is not a WhatsApp id.
  assertEquals(reachableOn(reach, 'whatsapp'), false);
  assertEquals(reachableOn(reach, 'instagram'), false);
  assertEquals(reachableOn(reach, 'telegram'), false);
});

Deno.test('contactReach reads the Instagram column before custom fields', () => {
  const reach = contactReach(
    { instagram_url: 'https://www.instagram.com/jane.doe/?hl=en', custom_fields: { instagram: '@someone.else' } },
    [],
  );
  assertEquals(reach.instagramHandle, 'jane.doe');
  assertEquals(reachableOn(reach, 'instagram'), true);
});

Deno.test('contactReach prefers resolved identities', () => {
  const reach = contactReach(
    { email: null, linkedin_url: null, phone: null, custom_fields: { 'IG Handle': '@jane.doe' } },
    [
      { channel: 'linkedin', platform_user_id: 'ACoAAA123', platform_profile_url: 'https://linkedin.com/in/jane' },
      { channel: 'whatsapp', platform_user_id: '123456789012345@lid' },
      { channel: 'telegram', platform_user_id: '' },
    ],
  );
  assertEquals(reach.linkedinId, 'ACoAAA123');
  assertEquals(reach.linkedinUrl, 'https://linkedin.com/in/jane');
  assertEquals(reach.instagramHandle, 'jane.doe');
  assertEquals(reach.whatsappId, '123456789012345@lid');
  assertEquals(reachableOn(reach, 'instagram'), true);
  assertEquals(reachableOn(reach, 'telegram'), false);
});

Deno.test('whatsappIdFromPhone needs a country code', () => {
  assertEquals(whatsappIdFromPhone('+44 7700 900123'), '447700900123@s.whatsapp.net');
  assertEquals(whatsappIdFromPhone('0033 6 12 34 56 78'), '33612345678@s.whatsapp.net');
  assertEquals(whatsappIdFromPhone('07700 900123'), null);
  assertEquals(whatsappIdFromPhone('(555) 010 2030'), null);
  assertEquals(whatsappIdFromPhone('+1 23'), null);
  assertEquals(whatsappIdFromPhone(null), null);
});

Deno.test('instagramUsername reads handles and profile URLs', () => {
  assertEquals(instagramUsername('https://www.instagram.com/jane.doe/?hl=en'), 'jane.doe');
  assertEquals(instagramUsername('@jane_doe'), 'jane_doe');
  assertEquals(instagramUsername('not a handle'), null);
  assertEquals(instagramUsername(''), null);
});

Deno.test('entry checks read the trigger and channel a lead came in on', () => {
  const entry = { trigger_id: 'rule-1', channel: 'instagram', type: 'message_received', native: true };
  assertEquals(enteredViaTrigger(entry, undefined), true);
  assertEquals(enteredViaTrigger(entry, ''), true);
  assertEquals(enteredViaTrigger(entry, 'rule-1'), true);
  assertEquals(enteredViaTrigger(entry, 'rule-2'), false);
  assertEquals(enteredViaTrigger(null, undefined), false);
  assertEquals(entryChannel(entry), 'instagram');
  assertEquals(entryChannel({ trigger_id: 'rule-3', channel: null }), null);
  assertEquals(entryChannel({ channel: 'sms' }), null);
});

Deno.test('routeOrder puts the channel they reached out on first, when listed', () => {
  const data = { channels: ['linkedin', 'email', 'instagram'], entryChannelFirst: true };
  assertEquals(routeOrder(data, { channel: 'instagram' }), ['instagram', 'linkedin', 'email']);
  assertEquals(routeOrder(data, { channel: 'whatsapp' }), ['linkedin', 'email', 'instagram']);
  assertEquals(routeOrder(data, null), ['linkedin', 'email', 'instagram']);
  assertEquals(routeOrder({ ...data, entryChannelFirst: false }, { channel: 'instagram' }), ['linkedin', 'email', 'instagram']);
});
