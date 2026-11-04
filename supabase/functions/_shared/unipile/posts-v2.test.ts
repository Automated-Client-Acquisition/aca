import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { Buffer } from 'node:buffer';
import { assertCompanyPageAccessV2, listCompanyPagesV2, publishLinkedInPostV2, V2_MAX_MEDIA_BYTES } from './posts-v2.ts';

type Call = { method: string; path: string; body?: Record<string, unknown> };

function fakeClient(responses: Record<string, unknown>, calls: Call[], fail: string[] = []) {
  const handle = (method: string) => async (path: string, opts?: { body?: unknown }) => {
    calls.push({ method, path, body: opts?.body as Record<string, unknown> | undefined });
    if (fail.some((f) => path.includes(f))) throw new Error('boom');
    return responses[path] ?? {};
  };
  return { get: handle('GET'), post: handle('POST') } as never;
}

const fakeDownload = (bytes = 3) => async (_url: string, kind: 'image' | 'video'): Promise<[string, Buffer]> =>
  [`${kind}.${kind === 'image' ? 'png' : 'mp4'}`, Buffer.alloc(bytes, 1)];

Deno.test('posts as the member with base64 attachments, then comments on the returned id', async () => {
  const calls: Call[] = [];
  const client = fakeClient({ '/acc_1/posts': { object: 'PostCreated', id: 'urn:li:share:7' } }, calls);
  let recorded = false;
  const res = await publishLinkedInPostV2(client, 'acc_1', undefined,
    { caption: 'Hello', images: ['https://cdn.example.com/a.png'], followUpComment: 'Link in here' },
    async () => { recorded = true; }, fakeDownload());
  assertEquals(res.post_id, 'urn:li:share:7');
  assertEquals(recorded, true);
  assertEquals(calls[0].path, '/acc_1/posts');
  assertEquals(calls[0].body?.text, 'Hello');
  assertEquals(calls[0].body?.post_as, undefined);
  assertEquals(calls[0].body?.attachments, [{ filename: 'image.png', content_type: 'image/png', content: 'AQEB' }]);
  assertEquals(calls[1].path, `/acc_1/posts/${encodeURIComponent('urn:li:share:7')}/comments`);
  assertEquals(calls[1].body, { text: 'Link in here' });
});

Deno.test('posts and comments as a company page', async () => {
  const calls: Call[] = [];
  const client = fakeClient({ '/acc_1/posts': { post_id: 'p9' } }, calls);
  await publishLinkedInPostV2(client, 'acc_1', '12345', { caption: 'Hi', followUpComment: 'c' }, async () => {}, fakeDownload());
  assertEquals(calls[0].body?.post_as, '12345');
  assertEquals(calls[1].body, { text: 'c', comment_as: '12345' });
});

Deno.test('a failed first comment is a warning, never an error (no retry, no double post)', async () => {
  const calls: Call[] = [];
  const client = fakeClient({ '/acc_1/posts': { id: 'p1' } }, calls, ['/comments']);
  const res = await publishLinkedInPostV2(client, 'acc_1', undefined, { caption: 'Hi', followUpComment: 'c' }, async () => {}, fakeDownload());
  assertEquals(res.post_id, 'p1');
  assertEquals(typeof res.warning, 'string');
});

Deno.test('media over the v2 cap is rejected before anything is posted', async () => {
  const calls: Call[] = [];
  const client = fakeClient({}, calls);
  await assertRejects(() => publishLinkedInPostV2(client, 'acc_1', undefined,
    { caption: 'x', videoUrl: 'https://cdn.example.com/v.mp4' }, async () => {}, fakeDownload(V2_MAX_MEDIA_BYTES + 1)));
  assertEquals(calls.length, 0);
});

Deno.test('company pages parse from items, keep numeric ids only, and gate page access', async () => {
  const calls: Call[] = [];
  const client = fakeClient({ '/acc_1/linkedin/company/pages': { items: [
    { id: '111', name: 'Growth Consulting' }, { id: 222, display_name: 'ACA' }, { id: 'abc', name: 'bad' }, { id: '333' },
  ] } }, calls);
  const pages = await listCompanyPagesV2(client, 'acc_1');
  assertEquals(pages.map((p) => p.id), ['111', '222']);
  await assertCompanyPageAccessV2(client, 'acc_1', '222');
  await assertRejects(() => assertCompanyPageAccessV2(client, 'acc_1', '999'));
});
