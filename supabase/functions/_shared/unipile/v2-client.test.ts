import { assert, assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { accountPath, UnipileV2Client, UNIPILE_V2_BASE_URL } from './v2-client.ts';
import { UnipileApiError } from './errors.ts';

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

// Replays the scripted replies in order; the last one repeats. Every call is recorded.
function scripted(replies: Array<Reply | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const reply = replies[Math.min(calls.length, replies.length) - 1];
    if (reply instanceof Error) return Promise.reject(reply);
    const text = typeof reply.body === 'string'
      ? reply.body
      : reply.body === undefined ? '' : JSON.stringify(reply.body);
    // 204 responses cannot carry a body, not even an empty string.
    const body = text === '' ? null : text;
    return Promise.resolve(new Response(body, { status: reply.status ?? 200, headers: reply.headers }));
  };
  return { fetch, calls };
}

function clientWith(fetch: (url: string, init: RequestInit) => Promise<Response>, options = {}) {
  return new UnipileV2Client({ apiKey: 'test-key', fetch, retryBaseDelayMs: 0, ...options });
}

Deno.test('sends the key to the fixed v2 host and caches nothing by default', async () => {
  const { fetch, calls } = scripted([{ body: [] }]);
  await clientWith(fetch).get(accountPath('acc_1', '/chats'), { query: { limit: 20, cursor: undefined } });

  assertEquals(calls[0].url, `${UNIPILE_V2_BASE_URL}/acc_1/chats?limit=20`);
  assertEquals(calls[0].init.method, 'GET');
  const headers = calls[0].init.headers as Record<string, string>;
  assertEquals(headers['X-API-KEY'], 'test-key');
  assertEquals(headers['Cache-Control'], undefined);
});

Deno.test('sends Cache-Control: no-cache when asked, for pollers', async () => {
  const { fetch, calls } = scripted([{ body: { data: [] } }]);
  await clientWith(fetch).get('/accounts', { noCache: true });

  assertEquals((calls[0].init.headers as Record<string, string>)['Cache-Control'], 'no-cache');
});

Deno.test('encodes timezone offsets so the + survives the query string', async () => {
  const { fetch, calls } = scripted([{ body: { data: [] } }]);
  await clientWith(fetch).get('/acc_1/chats', { query: { before: '2026-10-08T10:00:00+02:00' } });

  assert(calls[0].url.includes('%2B02'));
  assertEquals(new URL(calls[0].url).searchParams.get('before'), '2026-10-08T10:00:00+02:00');
});

Deno.test('turns an RFC 7807 body into a UnipileApiError with a stable code', async () => {
  const { fetch } = scripted([{
    status: 401,
    body: {
      object: 'Error',
      status: 401,
      type: 'api/missing_authorization',
      title: 'API Key is missing in the request',
      req_id: 'req-1',
    },
  }]);
  const error = await assertRejects(() => clientWith(fetch).get('/accounts'), UnipileApiError);

  assertEquals(error.code, 'AUTHENTICATION_FAILED');
  assertEquals(error.status, 401);
  assertEquals(error.type, 'api/missing_authorization');
  assertEquals(error.reqId, 'req-1');
  assertEquals(error.message, 'API Key is missing in the request');
  assertEquals(error.retryable, false);
});

Deno.test('maps provider/invalid_authorization to DISCONNECTED_ACCOUNT', async () => {
  const { fetch } = scripted([{
    status: 401,
    body: { type: 'provider/invalid_authorization', title: 'Account needs reconnecting', detail: 'Log in again' },
  }]);
  const error = await assertRejects(() => clientWith(fetch).get('/acc_1/chats'), UnipileApiError);

  assertEquals(error.code, 'DISCONNECTED_ACCOUNT');
  assertEquals(error.message, 'Log in again');
});

Deno.test('retries a POST after a 429 when Retry-After is short', async () => {
  const { fetch, calls } = scripted([
    { status: 429, headers: { 'retry-after': '0' }, body: { type: 'api/too_many_requests' } },
    { body: { object: 'Message', id: 'msg_1' } },
  ]);
  const result = await clientWith(fetch).post<{ id: string }>(
    accountPath('acc_1', '/chats/chat_1/messages'),
    { body: { text: 'hi' } },
  );

  assertEquals(result.id, 'msg_1');
  assertEquals(calls.length, 2);
  assertEquals(calls[1].init.body, JSON.stringify({ text: 'hi' }));
});

Deno.test('does not wait out a Retry-After longer than the cap', async () => {
  const { fetch, calls } = scripted([
    { status: 429, headers: { 'retry-after': '120' }, body: { type: 'api/too_many_requests' } },
    { body: {} },
  ]);
  const error = await assertRejects(
    () => clientWith(fetch, { maxRetryAfterSeconds: 30 }).post('/acc_1/chats'),
    UnipileApiError,
  );

  assertEquals(error.code, 'RATE_LIMITED');
  assertEquals(error.retryAfterSeconds, 120);
  assertEquals(error.retryable, true);
  assertEquals(calls.length, 1);
});

Deno.test('does not retry a write after a provider 5xx, since it may have landed', async () => {
  const { fetch, calls } = scripted([
    { status: 502, body: { type: 'provider/server_error', status: 502 } },
    { body: {} },
  ]);
  const error = await assertRejects(
    () => clientWith(fetch).post('/acc_1/chats', { body: {} }),
    UnipileApiError,
  );

  assertEquals(error.code, 'PROVIDER_ERROR');
  assertEquals(calls.length, 1);
});

Deno.test('retries a GET through a 5xx and returns the later success', async () => {
  const { fetch, calls } = scripted([
    { status: 502, body: { type: 'provider/server_error' } },
    { body: { data: [{ id: 'chat_1' }] } },
  ]);
  const result = await clientWith(fetch).get<{ data: Array<{ id: string }> }>('/acc_1/chats');

  assertEquals(result.data[0].id, 'chat_1');
  assertEquals(calls.length, 2);
});

Deno.test('gives up on GET network failures after maxRetries', async () => {
  const { fetch, calls } = scripted([new TypeError('fetch failed')]);
  const error = await assertRejects(
    () => clientWith(fetch, { maxRetries: 2 }).get('/accounts'),
    UnipileApiError,
  );

  assertEquals(error.code, 'NETWORK_ERROR');
  assertEquals(error.retryable, true);
  assertEquals(calls.length, 3);
});

Deno.test('keeps the status for plain-text proxy errors that are not RFC 7807', async () => {
  const { fetch } = scripted([{ status: 503, body: 'upstream connect error' }]);
  const error = await assertRejects(
    () => clientWith(fetch, { maxRetries: 0 }).get('/accounts'),
    UnipileApiError,
  );

  assertEquals(error.code, 'PROVIDER_ERROR');
  assertEquals(error.status, 503);
  assertEquals(error.type, null);
});

Deno.test('returns undefined for 204 responses', async () => {
  const { fetch } = scripted([{ status: 204 }]);
  const result = await clientWith(fetch).delete('/acc_1/chats/chat_1');

  assertEquals(result, undefined);
});

Deno.test('accountPath encodes the id and requires a leading slash', () => {
  assertEquals(accountPath('acc_1', '/chats'), '/acc_1/chats');
  assertEquals(accountPath('acc 1/x', '/chats'), '/acc%201%2Fx/chats');
  assertThrows(() => accountPath('acc_1', 'chats'));
});
