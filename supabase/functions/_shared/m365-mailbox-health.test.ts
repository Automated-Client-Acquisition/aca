import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { m365RetestStatus, testM365MailboxConnection, type M365HealthMailbox } from './m365-mailbox-health.ts';

const mailbox: M365HealthMailbox = {
  organization_id: 'org-one',
  status: 'disconnected',
  metadata: { m365_user_id: 'shared/user', m365_admin_email: 'admin@example.test' },
};

function tenantDb(tenantId: string | null = 'tenant-one') {
  const filters: Record<string, string> = {};
  const query = {
    select() { return query; },
    eq(key: string, value: string) { filters[key] = value; return query; },
    maybeSingle() {
      assertEquals(filters, { organization_id: 'org-one', admin_email: 'admin@example.test' });
      return Promise.resolve({ data: tenantId ? { tenant_id: tenantId } : null, error: null });
    },
  };
  return { from(table: string) { assertEquals(table, 'm365_tenants'); return query; } } as unknown as Parameters<typeof testM365MailboxConnection>[0];
}

Deno.test('Graph mailbox check uses the sender tenant and only reads the inbox', async () => {
  const result = await testM365MailboxConnection(tenantDb(), mailbox,
    (tenantId) => {
      assertEquals(tenantId, 'tenant-one');
      return Promise.resolve('test-token');
    },
    (url, options) => {
      assertEquals(String(url), 'https://graph.microsoft.com/v1.0/users/shared%2Fuser/mailFolders/inbox?$select=id');
      assertEquals(options?.method, 'GET');
      assertEquals(options?.body, undefined);
      assertEquals(options?.headers, { Authorization: 'Bearer test-token', Accept: 'application/json' });
      return Promise.resolve(new Response('{}', { status: 200 }));
    },
  );
  assertEquals(result, { success: true });
  assertEquals(m365RetestStatus(mailbox, result.success), 'ready');
});

Deno.test('Graph authorization failure stays disconnected without SMTP fallback', async () => {
  const result = await testM365MailboxConnection(tenantDb(), mailbox,
    () => Promise.resolve('test-token'),
    () => Promise.resolve(new Response('Access denied', { status: 403 })),
  );
  assertEquals(result.success, false);
  assertStringIncludes(result.error!, 'Graph API 403');
  assertEquals(m365RetestStatus(mailbox, result.success), 'disconnected');
});

Deno.test('Graph connection failure cannot recover the mailbox', async () => {
  const result = await testM365MailboxConnection(tenantDb(), mailbox,
    () => Promise.resolve('test-token'),
    () => Promise.reject(new Error('Graph unreachable')),
  );
  assertEquals(result, { success: false, error: 'Graph unreachable' });
  assertEquals(m365RetestStatus(mailbox, result.success), 'disconnected');
});

Deno.test('missing Graph identity fails before tenant lookup or token acquisition', async () => {
  const missing = { ...mailbox, metadata: { m365_user_id: 'shared-user' } };
  const client = { from() { throw new Error('must not look up tenant'); } } as unknown as Parameters<typeof testM365MailboxConnection>[0];
  const result = await testM365MailboxConnection(client, missing,
    () => { throw new Error('must not request token'); },
  );
  assertEquals(result.success, false);
  assertStringIncludes(result.error!, 'Missing M365');
});

Deno.test('missing sender tenant and token errors do not fall through to recovery', async () => {
  const missing = await testM365MailboxConnection(tenantDb(null), mailbox,
    () => { throw new Error('must not request token'); },
  );
  assertEquals(missing, { success: false, error: 'M365 sending tenant not found' });
  const invalid = await testM365MailboxConnection(tenantDb(), mailbox,
    () => Promise.reject(new Error('Invalid client credentials')),
  );
  assertEquals(invalid, { success: false, error: 'Invalid client credentials' });
});

Deno.test('connection recovery preserves manual, domain and capability holds', () => {
  for (const reason of ['manual', 'domain_paused', 'domain_not_sendable', 'tenant_mail_send_missing']) {
    const held = { ...mailbox, metadata: { ...mailbox.metadata, paused_reason: reason } };
    assertEquals(m365RetestStatus(held, true), 'paused');
  }
  assertEquals(m365RetestStatus({ ...mailbox, status: 'paused' }, true), 'paused');
  assertEquals(m365RetestStatus({ ...mailbox, status: 'burned' }, true), 'burned');
  assertEquals(m365RetestStatus({ ...mailbox, status: 'warming' }, true), 'warming');
});

Deno.test('archived mailbox is never re-enabled by a connection test', () => {
  const archived = { ...mailbox, status: 'archived' };
  assertEquals(m365RetestStatus(archived, true), 'archived');
  assertEquals(m365RetestStatus(archived, false), 'archived');
});
