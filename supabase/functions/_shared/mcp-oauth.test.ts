import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  assertScope,
  OAuthError,
  parseScope,
  resolveMcpAccessToken,
  validateDynamicRedirectUris,
} from './mcp-oauth.ts';

Deno.test('parseScope accepts known scopes and de-duplicates them', () => {
  assertEquals(parseScope('contacts:read contacts:write contacts:read'), ['contacts:read', 'contacts:write']);
});

function mockTokenDatabase(overrides: Record<string, unknown> = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const token = {
    id: 'token-id', client_id: 'client-id', user_id: 'user-id',
    organization_id: 'organization-id', scopes: ['workspace:read'],
    access_expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
  const database = {
    from(table: string) {
      assertEquals(table, 'mcp_oauth_tokens');
      return {
        select() {
          return {
            eq(column: string, hash: string) {
              assertEquals(column, 'access_token_hash');
              assertEquals(hash.length, 64);
              return { maybeSingle: async () => ({ data: token, error: null }) };
            },
          };
        },
        update(fields: Record<string, unknown>) {
          updates.push(fields);
          return {
            eq: async (column: string, id: string) => {
              assertEquals(column, 'id');
              assertEquals(id, token.id);
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { database: database as unknown as SupabaseClient, updates };
}

Deno.test('read-only token validation returns the caller without usage writes', async () => {
  const { database, updates } = mockTokenDatabase();
  const caller = await resolveMcpAccessToken(database, 'aca_mcp_synthetic_test_token', {
    trackLastUsed: false,
  });
  assertEquals(caller, {
    token_id: 'token-id', client_id: 'client-id', user_id: 'user-id',
    organization_id: 'organization-id', scopes: ['workspace:read'],
  });
  assertEquals(updates, []);
});

Deno.test('default token validation retains last-used telemetry', async () => {
  const { database, updates } = mockTokenDatabase();
  const before = Date.now();
  await resolveMcpAccessToken(database, 'aca_mcp_synthetic_test_token');
  assertEquals(updates.length, 1);
  assertEquals(Object.keys(updates[0]), ['last_used_at']);
  const recordedAt = new Date(String(updates[0].last_used_at)).getTime();
  assertEquals(recordedAt >= before && recordedAt <= Date.now(), true);
});

Deno.test('expired or revoked tokens reject before usage telemetry changes', async () => {
  for (const overrides of [
    { access_expires_at: new Date(Date.now() - 1_000).toISOString() },
    { revoked_at: new Date().toISOString() },
  ]) {
    const { database, updates } = mockTokenDatabase(overrides);
    const error = await assertRejects(
      () => resolveMcpAccessToken(database, 'aca_mcp_synthetic_test_token'),
      OAuthError,
    );
    assertEquals(error.code, 'AUTH_REQUIRED');
    assertEquals(updates, []);
  }
});

Deno.test('parseScope rejects an unknown scope', () => {
  const error = assertThrows(() => parseScope('contacts:read admin:*'), OAuthError);
  assertEquals(error.code, 'invalid_scope');
});

Deno.test('assertScope rejects a write without the granted scope', () => {
  const error = assertThrows(() => assertScope({ user_id: 'u', organization_id: 'o', client_id: 'c', token_id: 't', scopes: ['contacts:read'] }, 'contacts:write'), OAuthError);
  assertEquals(error.code, 'INSUFFICIENT_SCOPE');
});

Deno.test('dynamic registration accepts HTTPS and Codex loopback redirects', () => {
  assertEquals(
    validateDynamicRedirectUris([
      'https://client.example/callback',
      'http://127.0.0.1:45678/callback/codex-id',
      'http://[::1]:45678/callback/codex-id',
    ]),
    [
      'https://client.example/callback',
      'http://127.0.0.1:45678/callback/codex-id',
      'http://[::1]:45678/callback/codex-id',
    ],
  );
});

Deno.test('dynamic registration rejects non-loopback HTTP redirects', () => {
  const error = assertThrows(
    () => validateDynamicRedirectUris(['http://client.example/callback']),
    OAuthError,
  );
  assertEquals(error.code, 'invalid_client_metadata');
});
