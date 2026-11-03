import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isZapmailSyncable, zapmailWorkspaceIds, verifyZapmailRecovery, resolveZapmailSyncScope } from './zapmail-sync-policy.ts';

const org = '11111111-1111-1111-1111-111111111111';
const otherOrg = '22222222-2222-2222-2222-222222222222';

Deno.test('user sync always scopes to authenticated org and rejects cross-tenant requests', () => {
  assertEquals(resolveZapmailSyncScope({}, false, org), { organizationId: org, mailboxIds: [], limit: 100 });
  assertEquals(resolveZapmailSyncScope({ organization_id: otherOrg }, false, org), { error: 'Forbidden', status: 403 });
  assertEquals(resolveZapmailSyncScope({}, false, null), { error: 'Forbidden', status: 403 });
});

Deno.test('service sync accepts a bounded explicit org and mailbox list', () => {
  assertEquals(resolveZapmailSyncScope({ organization_id: org, mailbox_ids: [otherOrg], limit: 3 }, true, null),
    { organizationId: org, mailboxIds: [otherOrg], limit: 3 });
  assertEquals('error' in resolveZapmailSyncScope({ mailbox_ids: ['bad-id'] }, true, null), true);
  assertEquals('error' in resolveZapmailSyncScope({ limit: 201 }, true, null), true);
  assertEquals('error' in resolveZapmailSyncScope({ limit: '3' }, true, null), true);
  assertEquals('error' in resolveZapmailSyncScope(null, true, null), true);
  assertEquals('error' in resolveZapmailSyncScope([], true, null), true);
});

Deno.test('legacy null-connection rows require a saved ZapMail identifier', () => {
  const legacy = { connection_type: null, status: 'ready' };
  assertEquals(isZapmailSyncable(legacy), false);
  assertEquals(isZapmailSyncable({ ...legacy, zapmail_mailbox_id: 'vendor-mailbox' }), true);
  assertEquals(isZapmailSyncable({ ...legacy, zapmail_api_key_id: 'vendor-key' }), true);
  assertEquals(isZapmailSyncable({ ...legacy, metadata: { zapmail_workspace_id: 'vendor-workspace' } }), true);
  assertEquals(isZapmailSyncable({ ...legacy, zapmail_mailbox_id: '', zapmail_api_key_id: ' ' }), false);
  assertEquals(isZapmailSyncable({ ...legacy, connection_type: 'smtp', zapmail_mailbox_id: 'vendor-mailbox' }), false);
});

Deno.test('disconnected rows are checked but archived and intentional holds are excluded', () => {
  assertEquals(isZapmailSyncable({ connection_type: 'zapmail', status: 'disconnected' }), true);
  for (const status of ['archived', 'burned', 'paused']) {
    assertEquals(isZapmailSyncable({ connection_type: 'zapmail', status }), false);
  }
  for (const paused_reason of ['manual', 'domain_paused', 'domain_not_sendable', 'bounce_spike']) {
    assertEquals(isZapmailSyncable({ connection_type: 'zapmail', status: 'disconnected', metadata: { paused_reason } }), false);
  }
});

Deno.test('saved workspace wins over the key default, and legacy inventory checks every saved workspace', () => {
  assertEquals(zapmailWorkspaceIds({ zapmail_workspace_id: 'client' }, ['agency', 'client']), ['client']);
  assertEquals(zapmailWorkspaceIds({}, ['agency', 'client', 'agency']), ['agency', 'client']);
  assertEquals(zapmailWorkspaceIds({}, []), []);
});

Deno.test('provider presence alone does not reconnect: SMTP and IMAP must pass', async () => {
  let calls = 0;
  const smtp = () => { calls++; return Promise.resolve({ success: true }); };
  const imap = () => { calls++; return Promise.resolve({ success: false, error: 'Invalid credentials' }); };
  const failed = await verifyZapmailRecovery('ACTIVE', () => Promise.resolve({}), smtp, imap);
  assertEquals(failed, { success: false, smtp_ok: true, imap_ok: false, error: 'IMAP: Invalid credentials' });
  assertEquals(calls, 2);
  const healthy = await verifyZapmailRecovery('ACTIVE', () => Promise.resolve({}), smtp, smtp);
  assertEquals(healthy, { success: true, smtp_ok: true, imap_ok: true });
});

Deno.test('inactive or missing credentials cannot recover, and failed SMTP never sends or tests IMAP', async () => {
  const never = () => { throw new Error('must not run'); };
  assertEquals((await verifyZapmailRecovery('EXPIRED', never, never, never)).success, false);
  assertEquals((await verifyZapmailRecovery('ACTIVE', () => Promise.resolve(null), never, never)).success, false);
  const failed = await verifyZapmailRecovery('ACTIVE', () => Promise.resolve({}),
    () => Promise.resolve({ success: false, error: '535' }), never);
  assertEquals(failed, { success: false, smtp_ok: false, imap_ok: false, error: 'SMTP: 535' });
});
