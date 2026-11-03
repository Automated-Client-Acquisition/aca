import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { UnipileV2Client, UNIPILE_V2_BASE_URL } from './v2-client.ts';
import { isInstagramComment } from '../unipile-client.ts';
import { listOwnPosts, listPostComments, ownUserId, resolveMessagingId, toV1InstagramComment } from './instagram-v2.ts';

function scripted(bodies: unknown[]) {
  const urls: string[] = [];
  const fetch = (url: string): Promise<Response> => {
    urls.push(url);
    const body = bodies[Math.min(urls.length, bodies.length) - 1];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  return { client: new UnipileV2Client({ apiKey: 'k', fetch, retryBaseDelayMs: 0 }), urls };
}

const comment = {
  object: 'Comment',
  id: '1801',
  text: 'BUILD please',
  created_at: '2026-11-02T10:00:00Z',
  author: { id: '555', public_identifier: 'jane.doe', display_name: 'Jane', specifics: {} },
};

Deno.test('own user id comes from the stored metadata before asking users/me', async () => {
  const { client, urls } = scripted([{ id: 'me-1' }]);
  assertEquals(await ownUserId(client, 'acc_1', { unipile_v2: { user_id: 'u-9' } }), 'u-9');
  assertEquals(urls.length, 0);
  assertEquals(await ownUserId(client, 'acc_1', {}), 'me-1');
  assertEquals(urls[0], `${UNIPILE_V2_BASE_URL}/acc_1/users/me`);
});

Deno.test('posts come back in the v1 shape, following next_cursor', async () => {
  const { client, urls } = scripted([
    { data: [{ id: 'p1', text: 'Reel', share_url: 'https://instagram.com/reel/x', created_at: '2026-11-01T09:00:00Z', author: { display_name: 'Cedric' } }], next_cursor: 'c2' },
    { data: [{ id: 'p2' }] },
  ]);
  const posts = await listOwnPosts(client, 'acc_1', 'u-9');
  assertEquals(posts.map((p) => p.id), ['p1', 'p2']);
  assertEquals(posts[0].social_id, 'p1');
  assertEquals(posts[0].share_url, 'https://instagram.com/reel/x');
  assertEquals((posts[0].author as Record<string, unknown>).name, 'Cedric');
  assertEquals(urls[1], `${UNIPILE_V2_BASE_URL}/acc_1/users/u-9/posts?cursor=c2`);
});

Deno.test('a v2 comment parses as a v1 Instagram comment', () => {
  const c = toV1InstagramComment(comment);
  assertEquals(isInstagramComment(c), true);
  assertEquals(c.provider_id, '1801');
  assertEquals(c.author.provider_id, '555');
  assertEquals(c.author.public_identifier, 'jane.doe');
  assertEquals(c.created_at, Date.parse('2026-11-02T10:00:00Z') / 1000);
});

Deno.test('comments resume from the stored cursor and return the next one', async () => {
  const { client, urls } = scripted([{ data: [comment], next_cursor: null }]);
  const { comments, lastCursor } = await listPostComments(client, 'acc_1', 'p1', 'c7');
  assertEquals(comments.length, 1);
  assertEquals(lastCursor, null);
  assertEquals(urls[0], `${UNIPILE_V2_BASE_URL}/acc_1/posts/p1/comments?cursor=c7`);
});

Deno.test('messaging id: from the comment when present, else from the profile', async () => {
  const { client, urls } = scripted([{ id: '555', specifics: { messaging_identifier: '1784' } }]);
  const withId = toV1InstagramComment({ ...comment, author: { ...comment.author, specifics: { messaging_identifier: '1700' } } });
  assertEquals(await resolveMessagingId(client, 'acc_1', withId), '1700');
  assertEquals(urls.length, 0);
  assertEquals(await resolveMessagingId(client, 'acc_1', toV1InstagramComment(comment)), '1784');
  assertEquals(urls[0], `${UNIPILE_V2_BASE_URL}/acc_1/users/555`);
});
